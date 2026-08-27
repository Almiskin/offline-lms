const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const pool = require('../db');
const { authenticate } = require('../middleware/auth');
const { sendPasswordResetEmail } = require('../mailer');

const router = express.Router();
const SALT_ROUNDS = 12;

// Brute-force protection: cap repeated attempts per IP. Login is the
// sensitive one (password guessing); register/forgot-password are capped
// more loosely mainly to stop automated abuse/enumeration, not because a
// legitimate user is likely to hit the limit.
// Rate limiting is skipped in the test environment: the test suite registers
// many accounts back-to-back on purpose (fresh users per test for isolation),
// which would otherwise trip these limiters and produce flaky, unrelated
// failures. Login-rate-limit behavior itself is covered by a dedicated test
// that constructs its own limiter instance — see tests/rateLimit.test.js.
const skipInTest = () => process.env.NODE_ENV === 'test';

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please try again in a few minutes.' },
  skipSuccessfulRequests: true, // only failed attempts count toward the limit
  skip: skipInTest,
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many accounts created from this network. Please try again later.' },
  skip: skipInTest,
});

const passwordResetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many password reset requests. Please try again in a few minutes.' },
  skip: skipInTest,
});

function isValidPassword(pw) {
  // At least 8 chars, containing both letters and numbers (per proposal 4.1.1a)
  return typeof pw === 'string' && pw.length >= 8 && /[a-zA-Z]/.test(pw) && /[0-9]/.test(pw);
}

// POST /api/auth/register
router.post('/register', registerLimiter, async (req, res) => {
  try {
    const { firstName, lastName, email, password, role } = req.body;

    if (!firstName || !lastName || !email || !password) {
      return res.status(400).json({ error: 'All fields are required' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Invalid email address' });
    }
    if (!isValidPassword(password)) {
      return res.status(400).json({ error: 'Password must be at least 8 characters and include letters and numbers' });
    }
    const finalRole = role === 'Instructor' ? 'Instructor' : 'Student';

    const [existing] = await pool.query('SELECT UserID FROM Users WHERE Email = ?', [email]);
    if (existing.length > 0) {
      return res.status(409).json({ error: 'An account with this email already exists' });
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const [result] = await pool.query(
      'INSERT INTO Users (FirstName, LastName, Email, PasswordHash, Role) VALUES (?, ?, ?, ?, ?)',
      [firstName, lastName, email, passwordHash, finalRole]
    );

    const token = jwt.sign(
      { userId: result.insertId, role: finalRole },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
    );

    res.status(201).json({
      token,
      user: { userId: result.insertId, firstName, lastName, email, role: finalRole },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// POST /api/auth/login
router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const [rows] = await pool.query(
      'SELECT UserID, FirstName, LastName, Email, PasswordHash, Role, IsActive FROM Users WHERE Email = ?',
      [email]
    );
    if (rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    const user = rows[0];
    if (!user.IsActive) {
      return res.status(403).json({ error: 'This account has been deactivated' });
    }

    const match = await bcrypt.compare(password, user.PasswordHash);
    if (!match) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    await pool.query('UPDATE Users SET LastLoginDate = NOW() WHERE UserID = ?', [user.UserID]);

    const token = jwt.sign(
      { userId: user.UserID, role: user.Role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
    );

    res.json({
      token,
      user: {
        userId: user.UserID,
        firstName: user.FirstName,
        lastName: user.LastName,
        email: user.Email,
        role: user.Role,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// GET /api/auth/me - lets the client re-verify who's logged in when online
router.get('/me', authenticate, async (req, res) => {
  const [rows] = await pool.query(
    'SELECT UserID, FirstName, LastName, Email, Role FROM Users WHERE UserID = ?',
    [req.user.userId]
  );
  if (rows.length === 0) return res.status(404).json({ error: 'User not found' });
  res.json({ user: rows[0] });
});

// POST /api/auth/forgot-password - issues a time-bound reset token and
// actually emails it. Uses real SMTP if configured (see server/mailer.js),
// otherwise an Ethereal test inbox whose preview link is logged server-side
// — so this works end-to-end in a demo without requiring mail credentials.
router.post('/forgot-password', passwordResetLimiter, async (req, res) => {
  try {
    const { email } = req.body;
    const [rows] = await pool.query('SELECT UserID FROM Users WHERE Email = ?', [email]);
    if (rows.length === 0) {
      // Do not reveal whether the email exists
      return res.json({ message: 'If that email is registered, a reset link has been sent.' });
    }
    const resetToken = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
    await pool.query('UPDATE Users SET ResetToken = ?, ResetTokenExpires = ? WHERE UserID = ?', [
      resetToken,
      expires,
      rows[0].UserID,
    ]);

    let previewUrl = null;
    if (!skipInTest()) {
      try {
        const result = await sendPasswordResetEmail(email, resetToken);
        previewUrl = result.previewUrl || null;
      } catch (mailErr) {
        // Don't fail the request just because email delivery had a problem —
        // the token is still valid; log it so the student isn't stuck.
        console.error('[email] Failed to send reset email:', mailErr.message);
      }
    }

    const response = { message: 'If that email is registered, a reset link has been sent.' };
    if (previewUrl) response.devPreviewUrl = previewUrl; // only present when using the Ethereal fallback
    res.json(response);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not process request' });
  }
});

// POST /api/auth/reset-password
router.post('/reset-password', async (req, res) => {
  try {
    const { token, newPassword } = req.body;
    if (!isValidPassword(newPassword)) {
      return res.status(400).json({ error: 'Password must be at least 8 characters and include letters and numbers' });
    }
    const [rows] = await pool.query(
      'SELECT UserID FROM Users WHERE ResetToken = ? AND ResetTokenExpires > NOW()',
      [token]
    );
    if (rows.length === 0) {
      return res.status(400).json({ error: 'Reset link is invalid or has expired' });
    }
    const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    await pool.query(
      'UPDATE Users SET PasswordHash = ?, ResetToken = NULL, ResetTokenExpires = NULL WHERE UserID = ?',
      [passwordHash, rows[0].UserID]
    );
    res.json({ message: 'Password updated successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not reset password' });
  }
});

module.exports = router;
