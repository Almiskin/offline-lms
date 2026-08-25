const nodemailer = require('nodemailer');

// If real SMTP credentials are set in .env, use them. Otherwise, fall back to
// an auto-generated Ethereal test account (https://ethereal.email) — this
// sends nowhere real but gives a genuine inbox URL you can open and see the
// email, so password reset actually works end-to-end for a demo/grading
// session without requiring you to own a mail server.
let transporterPromise = null;

async function getTransporter() {
  if (transporterPromise) return transporterPromise;

  if (process.env.SMTP_HOST) {
    transporterPromise = Promise.resolve(
      nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT) || 587,
        secure: process.env.SMTP_SECURE === 'true',
        auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
      })
    );
  } else {
    transporterPromise = nodemailer.createTestAccount().then((testAccount) =>
      nodemailer.createTransport({
        host: 'smtp.ethereal.email',
        port: 587,
        secure: false,
        auth: { user: testAccount.user, pass: testAccount.pass },
      })
    );
    console.log('[email] No SMTP_HOST configured — using a temporary Ethereal test inbox for this session.');
  }
  return transporterPromise;
}

async function sendPasswordResetEmail(toEmail, resetToken) {
  const transporter = await getTransporter();
  const resetLink = `${process.env.APP_URL || 'http://localhost:3000'}/#/reset-password?token=${resetToken}`;

  const info = await transporter.sendMail({
    from: '"Offline Learning Platform" <no-reply@offline-lms.local>',
    to: toEmail,
    subject: 'Reset your password',
    text: `We received a request to reset your password. Use this link (valid for 1 hour): ${resetLink}\n\nIf you didn't request this, you can ignore this email.`,
    html: `<p>We received a request to reset your password.</p><p><a href="${resetLink}">Click here to reset it</a> (valid for 1 hour).</p><p>If you didn't request this, you can ignore this email.</p>`,
  });

  const previewUrl = nodemailer.getTestMessageUrl(info);
  if (previewUrl) {
    console.log(`[email] Password reset email sent — preview it here: ${previewUrl}`);
  }
  return { previewUrl };
}

module.exports = { sendPasswordResetEmail };
