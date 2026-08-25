// Rate limiting is skipped in the real app under NODE_ENV=test (see
// routes/auth.js) so the rest of the suite isn't flaky. This file verifies
// the rate-limiting *mechanism itself* works, using a small standalone app
// with the limiter force-enabled, independent of that skip.
const express = require('express');
const request = require('supertest');
const rateLimit = require('express-rate-limit');

function buildTestApp() {
  const app = express();
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 3,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many attempts' },
  });
  app.get('/limited', limiter, (req, res) => res.json({ ok: true }));
  return app;
}

describe('rate limiting mechanism', () => {
  it('allows requests up to the limit, then returns 429', async () => {
    const app = buildTestApp();
    for (let i = 0; i < 3; i++) {
      const res = await request(app).get('/limited');
      expect(res.status).toBe(200);
    }
    const blocked = await request(app).get('/limited');
    expect(blocked.status).toBe(429);
  });
});
