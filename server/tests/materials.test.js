const request = require('supertest');
const { resetDatabase, closeDatabase } = require('./testUtils');
const app = require('../app');

let instructorToken;
let studentToken;
let moduleId;

async function registerUser(role, email) {
  const res = await request(app).post('/api/auth/register').send({
    firstName: 'Test', lastName: role, email, password: 'Passw0rd', role,
  });
  return res.body.token;
}

beforeEach(async () => {
  await resetDatabase();
  instructorToken = await registerUser('Instructor', 'matinstructor@example.com');
  studentToken = await registerUser('Student', 'matstudent@example.com');

  const course = await request(app).post('/api/courses').set('Authorization', `Bearer ${instructorToken}`)
    .send({ courseCode: 'MAT1', title: 'Materials Course' });
  const mod = await request(app).post(`/api/courses/${course.body.courseId}/modules`)
    .set('Authorization', `Bearer ${instructorToken}`).send({ moduleTitle: 'Module 1' });
  moduleId = mod.body.moduleId;
});

afterAll(async () => {
  await closeDatabase();
});

describe('POST /api/materials/module/:moduleId', () => {
  it('uploads a PDF and records correct metadata', async () => {
    const res = await request(app)
      .post(`/api/materials/module/${moduleId}`)
      .set('Authorization', `Bearer ${instructorToken}`)
      .attach('file', Buffer.from('%PDF-1.4 test content'), { filename: 'test.pdf', contentType: 'application/pdf' })
      .field('title', 'Test Material');
    expect(res.status).toBe(201);
    expect(res.body.materialId).toBeDefined();
    expect(res.body.fileURL).toMatch(/^\/uploads\//);
  });

  it('rejects disallowed file types', async () => {
    const res = await request(app)
      .post(`/api/materials/module/${moduleId}`)
      .set('Authorization', `Bearer ${instructorToken}`)
      .attach('file', Buffer.from('not a real exe'), { filename: 'virus.exe', contentType: 'application/x-msdownload' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when no file is uploaded', async () => {
    const res = await request(app)
      .post(`/api/materials/module/${moduleId}`)
      .set('Authorization', `Bearer ${instructorToken}`)
      .field('title', 'Missing File');

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no file/i);
  });

  it('blocks students from uploading', async () => {
    const res = await request(app)
      .post(`/api/materials/module/${moduleId}`)
      .set('Authorization', `Bearer ${studentToken}`)
      .attach('file', Buffer.from('%PDF-1.4'), { filename: 'test.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(403);
  });

  it('blocks upload to a module the instructor does not own', async () => {
    const otherToken = await registerUser('Instructor', 'matintruder2@example.com');
    const res = await request(app)
      .post(`/api/materials/module/${moduleId}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .attach('file', Buffer.from('%PDF-1.4'), { filename: 'sneaky.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(403);
  });
});

describe('GET /api/materials/:id/download', () => {
  let courseId;
  let materialId;
  let outsiderStudentToken;
  let otherInstructorToken;

  beforeEach(async () => {
    const course = await request(app).post('/api/courses').set('Authorization', `Bearer ${instructorToken}`)
      .send({ courseCode: 'MATDL1', title: 'Material Download Course' });
    courseId = course.body.courseId;

    await request(app).patch(`/api/courses/${courseId}/publish`)
      .set('Authorization', `Bearer ${instructorToken}`)
      .send({ isPublished: true });
    await request(app).post(`/api/courses/${courseId}/enroll`)
      .set('Authorization', `Bearer ${studentToken}`);

    const mod = await request(app).post(`/api/courses/${courseId}/modules`)
      .set('Authorization', `Bearer ${instructorToken}`)
      .send({ moduleTitle: 'Download Module' });

    const upload = await request(app)
      .post(`/api/materials/module/${mod.body.moduleId}`)
      .set('Authorization', `Bearer ${instructorToken}`)
      .attach('file', Buffer.from('%PDF-1.4 test content'), {
        filename: 'download-test.pdf',
        contentType: 'application/pdf',
      })
      .field('title', 'Download Test Material');
    materialId = upload.body.materialId;

    outsiderStudentToken = await registerUser('Student', 'mat-outsider@example.com');
    otherInstructorToken = await registerUser('Instructor', 'mat-other-instructor@example.com');
  });

  it('blocks an unenrolled student from directly downloading a material', async () => {
    const res = await request(app)
      .get(`/api/materials/${materialId}/download`)
      .set('Authorization', `Bearer ${outsiderStudentToken}`);

    expect(res.status).toBe(403);
  });

  it('allows an enrolled student to directly download a material', async () => {
    const res = await request(app)
      .get(`/api/materials/${materialId}/download`)
      .set('Authorization', `Bearer ${studentToken}`);

    expect(res.status).toBe(200);
  });

  it('blocks a non-owning instructor from directly downloading a material', async () => {
    const res = await request(app)
      .get(`/api/materials/${materialId}/download`)
      .set('Authorization', `Bearer ${otherInstructorToken}`);

    expect(res.status).toBe(403);
  });
});

// Material delete coverage lives in tests/editDelete.test.js (it also
// verifies the uploaded file is actually removed from disk, not just the DB
// row) to keep delete-related assertions in one place.
