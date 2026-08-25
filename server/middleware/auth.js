const jwt = require('jsonwebtoken');

// NOTE ON THE TOKEN-EXPIRY / OFFLINE-ACCESS TRADEOFF
// The proposal requires both (a) tokens that expire after 24h and (b) sessions
// that "persist offline". These conflict if taken literally: a student offline
// for >24h would be locked out of content they already downloaded.
// Resolution used here: this middleware only guards SERVER API calls (login,
// upload, sync, fresh course listing, etc). Access to content already cached
// in the browser's IndexedDB/Cache Storage never calls this middleware at all
// — the front-end reads straight from local storage when offline, regardless
// of token validity. The token only needs to be valid again once the device
// reconnects and talks to the server (e.g. to sync quiz attempts).
function authenticate(req, res, next) {
  const header = req.headers['authorization'];
  const token = header && header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Authentication token required' });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, payload) => {
    if (err) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
    req.user = payload; // { userId, role }
    next();
  });
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

module.exports = { authenticate, requireRole };
