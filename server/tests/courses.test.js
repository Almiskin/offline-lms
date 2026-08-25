const request = require('supertest');
const { resetDatabase, closeDatabase } = require('./testUtils');
const app = require('../app');

let instructorToken;
let studentToken;

async function registerUser(role, email) {
  const res = await request(app).post('/api/auth/register').send({
    firstName: 'Test', lastName: role, email, password: 'Passw0rd', role,
  });
  return res.body.token;
}

beforeEach(async () => {
  await resetDatabase();
  instructorToken = await registerUser('Instructor', 'instructor@example.com');
  studentToken = await registerUser('Student', 'student@example.com');
});

afterAll(async () => {
  await closeDatabase();
});

describe('POST /api/courses', () => {
  it('allows an instructor to create a course', async () => {
    const res = await request(app)
      .post('/api/courses')
      .set('Authorization', `Bearer ${instructorToken}`)
      .send({ courseCode: 'CS100', title: 'Intro to CS' });
    expect(res.status).toBe(201);
    expect(res.body.courseId).toBeDefined();
  });

  it('blocks a student from creating a course', async () => {
    const res = await request(app)
      .post('/api/courses')
      .set('Authorization', `Bearer ${studentToken}`)
      .send({ courseCode: 'CS100', title: 'Intro to CS' });
    expect(res.status).toBe(403);
  });

  it('rejects duplicate course codes', async () => {
    await request(app).post('/api/courses').set('Authorization', `Bearer ${instructorToken}`)
      .send({ courseCode: 'DUP1', title: 'First' });
    const res = await request(app).post('/api/courses').set('Authorization', `Bearer ${instructorToken}`)
      .send({ courseCode: 'DUP1', title: 'Second' });
    expect(res.status).toBe(409);
  });
});

describe('Enrollment enforcement', () => {
  let courseId;

  beforeEach(async () => {
    const createRes = await request(app)
      .post('/api/courses')
      .set('Authorization', `Bearer ${instructorToken}`)
      .send({ courseCode: 'ENR1', title: 'Enrollment Course' });
    courseId = createRes.body.courseId;
    await request(app)
      .patch(`/api/courses/${courseId}/publish`)
      .set('Authorization', `Bearer ${instructorToken}`)
      .send({ isPublished: true });
  });

  it('blocks a student from viewing course content before enrolling', async () => {
    const res = await request(app).get(`/api/courses/${courseId}`).set('Authorization', `Bearer ${studentToken}`);
    expect(res.status).toBe(403);
    expect(res.body.requiresEnrollment).toBe(true);
  });

  it('allows viewing after enrollment', async () => {
    const enrollRes = await request(app)
      .post(`/api/courses/${courseId}/enroll`)
      .set('Authorization', `Bearer ${studentToken}`);
    expect(enrollRes.status).toBe(201);

    const viewRes = await request(app).get(`/api/courses/${courseId}`).set('Authorization', `Bearer ${studentToken}`);
    expect(viewRes.status).toBe(200);
    expect(viewRes.body.course.CourseID).toBe(courseId);
  });

  it('handles re-enrolling gracefully instead of erroring', async () => {
    await request(app).post(`/api/courses/${courseId}/enroll`).set('Authorization', `Bearer ${studentToken}`);
    const res = await request(app).post(`/api/courses/${courseId}/enroll`).set('Authorization', `Bearer ${studentToken}`);
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/already enrolled/i);
  });

  it('always allows the owning instructor to view their own course', async () => {
    const res = await request(app).get(`/api/courses/${courseId}`).set('Authorization', `Bearer ${instructorToken}`);
    expect(res.status).toBe(200);
  });

  it('blocks a different instructor from viewing someone else\'s unpublished/owned course content', async () => {
    const otherToken = await registerUser('Instructor', 'other-instructor@example.com');
    const res = await request(app).get(`/api/courses/${courseId}`).set('Authorization', `Bearer ${otherToken}`);
    expect(res.status).toBe(403);
  });

  it('rejects enrollment in an unpublished course', async () => {
    const draft = await request(app)
      .post('/api/courses')
      .set('Authorization', `Bearer ${instructorToken}`)
      .send({ courseCode: 'DRAFT1', title: 'Draft Course' });
    const res = await request(app)
      .post(`/api/courses/${draft.body.courseId}/enroll`)
      .set('Authorization', `Bearer ${studentToken}`);
    expect(res.status).toBe(403);
  });
});

describe('Modules', () => {
  it('lets the owning instructor add a module', async () => {
    const course = await request(app).post('/api/courses').set('Authorization', `Bearer ${instructorToken}`)
      .send({ courseCode: 'MOD1', title: 'Module Course' });
    const res = await request(app)
      .post(`/api/courses/${course.body.courseId}/modules`)
      .set('Authorization', `Bearer ${instructorToken}`)
      .send({ moduleTitle: 'Week 1' });
    expect(res.status).toBe(201);
    expect(res.body.moduleId).toBeDefined();
  });

  it('blocks a non-owning instructor from adding a module', async () => {
    const course = await request(app).post('/api/courses').set('Authorization', `Bearer ${instructorToken}`)
      .send({ courseCode: 'MOD2', title: 'Module Course 2' });
    const otherToken = await registerUser('Instructor', 'other2@example.com');
    const res = await request(app)
      .post(`/api/courses/${course.body.courseId}/modules`)
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ moduleTitle: 'Sneaky Module' });
    expect(res.status).toBe(403);
  });
});

// Edit/delete coverage for courses, modules, materials, and quizzes lives in
// tests/editDelete.test.js to keep it in one place.
