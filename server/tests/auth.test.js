const request = require('supertest');
const { resetDatabase, closeDatabase } = require('./testUtils');
const app = require('../app');

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await closeDatabase();
});

describe('POST /api/auth/register', () => {
  it('registers a new student with a valid payload', async () => {
    const res = await request(app).post('/api/auth/register').send({
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
      password: 'Passw0rd',
      role: 'Student',
    });
    expect(res.status).toBe(201);
    expect(res.body.token).toBeDefined();
    expect(res.body.user.role).toBe('Student');
    expect(res.body.user.email).toBe('ada@example.com');
  });

  it('rejects a password under 8 characters', async () => {
    const res = await request(app).post('/api/auth/register').send({
      firstName: 'A', lastName: 'B', email: 'short@example.com', password: 'ab1',
    });
    expect(res.status).toBe(400);
  });

  it('rejects a password with no digits', async () => {
    const res = await request(app).post('/api/auth/register').send({
      firstName: 'A', lastName: 'B', email: 'nodigits@example.com', password: 'abcdefgh',
    });
    expect(res.status).toBe(400);
  });

  it('rejects duplicate emails', async () => {
    const payload = { firstName: 'A', lastName: 'B', email: 'dup@example.com', password: 'Passw0rd' };
    await request(app).post('/api/auth/register').send(payload);
    const res = await request(app).post('/api/auth/register').send(payload);
    expect(res.status).toBe(409);
  });

  it('defaults to Student role if an invalid role is supplied', async () => {
    const res = await request(app).post('/api/auth/register').send({
      firstName: 'A', lastName: 'B', email: 'weirdrole@example.com', password: 'Passw0rd', role: 'SuperAdmin',
    });
    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe('Student');
  });
});

describe('POST /api/auth/login', () => {
  beforeEach(async () => {
    await request(app).post('/api/auth/register').send({
      firstName: 'Login', lastName: 'Test', email: 'logintest@example.com', password: 'Passw0rd',
    });
  });

  it('logs in with correct credentials', async () => {
    const res = await request(app).post('/api/auth/login').send({
      email: 'logintest@example.com', password: 'Passw0rd',
    });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
  });

  it('rejects an incorrect password', async () => {
    const res = await request(app).post('/api/auth/login').send({
      email: 'logintest@example.com', password: 'WrongPass1',
    });
    expect(res.status).toBe(401);
  });

  it('rejects a nonexistent email', async () => {
    const res = await request(app).post('/api/auth/login').send({
      email: 'doesnotexist@example.com', password: 'Passw0rd',
    });
    expect(res.status).toBe(401);
  });
});

describe('GET /api/auth/me', () => {
  it('returns 401 with no token', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('returns the current user with a valid token', async () => {
    const reg = await request(app).post('/api/auth/register').send({
      firstName: 'Me', lastName: 'User', email: 'meuser@example.com', password: 'Passw0rd',
    });
    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${reg.body.token}`);
    expect(res.status).toBe(200);
    expect(res.body.user.Email).toBe('meuser@example.com');
  });
});

describe('Password reset flow', () => {
  it('issues a reset token that can be used exactly once', async () => {
    await request(app).post('/api/auth/register').send({
      firstName: 'Reset', lastName: 'Flow', email: 'resetflow@example.com', password: 'OldPass1',
    });

    // Read the token straight from the DB — email delivery is a separate
    // concern (server/mailer.js) and isn't what this test is verifying.
    const { pool } = require('./testUtils');
    await request(app).post('/api/auth/forgot-password').send({ email: 'resetflow@example.com' });
    const [[row]] = await pool.query('SELECT ResetToken FROM Users WHERE Email = ?', ['resetflow@example.com']);
    expect(row.ResetToken).toBeTruthy();

    const resetRes = await request(app).post('/api/auth/reset-password').send({
      token: row.ResetToken, newPassword: 'NewPass1',
    });
    expect(resetRes.status).toBe(200);

    const oldLogin = await request(app).post('/api/auth/login').send({
      email: 'resetflow@example.com', password: 'OldPass1',
    });
    expect(oldLogin.status).toBe(401);

    const newLogin = await request(app).post('/api/auth/login').send({
      email: 'resetflow@example.com', password: 'NewPass1',
    });
    expect(newLogin.status).toBe(200);

    // Reusing the same token should now fail
    const reuseRes = await request(app).post('/api/auth/reset-password').send({
      token: row.ResetToken, newPassword: 'AnotherPass1',
    });
    expect(reuseRes.status).toBe(400);
  });

  it('does not reveal whether an email is registered', async () => {
    const res = await request(app).post('/api/auth/forgot-password').send({ email: 'nobody@example.com' });
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/if that email is registered/i);
  });
});
