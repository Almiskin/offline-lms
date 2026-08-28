const request = require('supertest');
const path = require('path');
const fs = require('fs');
const { resetDatabase, closeDatabase } = require('./testUtils');
const app = require('../app');

jest.setTimeout(30000);

let instructorToken;
let otherInstructorToken;
let studentToken;

async function registerUser(role, email) {
  const res = await request(app).post('/api/auth/register').send({
    firstName: 'Test', lastName: role, email, password: 'Passw0rd', role,
  });
  return res.body.token;
}

beforeEach(async () => {
  await resetDatabase();
  instructorToken = await registerUser('Instructor', 'edit-owner@example.com');
  otherInstructorToken = await registerUser('Instructor', 'edit-other@example.com');
  studentToken = await registerUser('Student', 'edit-student@example.com');
});

afterAll(async () => {
  await closeDatabase();
});

describe('Course edit/delete', () => {
  let courseId;

  beforeEach(async () => {
    const res = await request(app).post('/api/courses').set('Authorization', `Bearer ${instructorToken}`)
      .send({ courseCode: 'EDIT1', title: 'Original Title', description: 'Original desc' });
    courseId = res.body.courseId;
  });

  it('allows the owner to edit the title', async () => {
    const res = await request(app).patch(`/api/courses/${courseId}`).set('Authorization', `Bearer ${instructorToken}`)
      .send({ title: 'Updated Title' });
    expect(res.status).toBe(200);

    const check = await request(app).get(`/api/courses/${courseId}`).set('Authorization', `Bearer ${instructorToken}`);
    expect(check.body.course.Title).toBe('Updated Title');
    expect(check.body.course.Description).toBe('Original desc'); // untouched fields preserved
  });

  it('blocks a non-owning instructor from editing', async () => {
    const res = await request(app).patch(`/api/courses/${courseId}`).set('Authorization', `Bearer ${otherInstructorToken}`)
      .send({ title: 'Hijacked' });
    expect(res.status).toBe(403);
  });

  it('blocks students from editing', async () => {
    const res = await request(app).patch(`/api/courses/${courseId}`).set('Authorization', `Bearer ${studentToken}`)
      .send({ title: 'Hijacked' });
    expect(res.status).toBe(403);
  });

  it('rejects clearing the title to empty', async () => {
    const res = await request(app).patch(`/api/courses/${courseId}`).set('Authorization', `Bearer ${instructorToken}`)
      .send({ title: '' });
    expect(res.status).toBe(400);
  });

  it('allows the owner to delete the course', async () => {
    const res = await request(app).delete(`/api/courses/${courseId}`).set('Authorization', `Bearer ${instructorToken}`);
    expect(res.status).toBe(200);

    const check = await request(app).get(`/api/courses/${courseId}`).set('Authorization', `Bearer ${instructorToken}`);
    expect(check.status).toBe(404);
  });

  it('blocks a non-owning instructor from deleting', async () => {
    const res = await request(app).delete(`/api/courses/${courseId}`).set('Authorization', `Bearer ${otherInstructorToken}`);
    expect(res.status).toBe(403);
  });

  it('cascades: deleting a course removes its modules', async () => {
    const modRes = await request(app).post(`/api/courses/${courseId}/modules`).set('Authorization', `Bearer ${instructorToken}`)
      .send({ moduleTitle: 'Will be deleted' });
    expect(modRes.status).toBe(201);

    await request(app).delete(`/api/courses/${courseId}`).set('Authorization', `Bearer ${instructorToken}`);

    const { pool } = require('./testUtils');
    const [rows] = await pool.query('SELECT * FROM Modules WHERE ModuleID = ?', [modRes.body.moduleId]);
    expect(rows.length).toBe(0);
  });
});

describe('Module edit/delete', () => {
  let courseId, moduleId;

  beforeEach(async () => {
    const course = await request(app).post('/api/courses').set('Authorization', `Bearer ${instructorToken}`)
      .send({ courseCode: 'MODEDIT1', title: 'Module Edit Course' });
    courseId = course.body.courseId;
    const mod = await request(app).post(`/api/courses/${courseId}/modules`).set('Authorization', `Bearer ${instructorToken}`)
      .send({ moduleTitle: 'Original Module' });
    moduleId = mod.body.moduleId;
  });

  it('allows the owner to rename a module', async () => {
    const res = await request(app)
      .patch(`/api/courses/${courseId}/modules/${moduleId}`)
      .set('Authorization', `Bearer ${instructorToken}`)
      .send({ moduleTitle: 'Renamed Module' });
    expect(res.status).toBe(200);
  });

  it('blocks a non-owning instructor from editing a module', async () => {
    const res = await request(app)
      .patch(`/api/courses/${courseId}/modules/${moduleId}`)
      .set('Authorization', `Bearer ${otherInstructorToken}`)
      .send({ moduleTitle: 'Hijacked' });
    expect(res.status).toBe(403);
  });

  it('allows the owner to delete a module', async () => {
    const res = await request(app)
      .delete(`/api/courses/${courseId}/modules/${moduleId}`)
      .set('Authorization', `Bearer ${instructorToken}`);
    expect(res.status).toBe(200);
  });

  it('404s deleting a module that belongs to a different course', async () => {
    const otherCourse = await request(app).post('/api/courses').set('Authorization', `Bearer ${instructorToken}`)
      .send({ courseCode: 'MODEDIT2', title: 'Other Course' });
    const res = await request(app)
      .delete(`/api/courses/${otherCourse.body.courseId}/modules/${moduleId}`)
      .set('Authorization', `Bearer ${instructorToken}`);
    expect(res.status).toBe(404);
  });
});

describe('Material delete', () => {
  let courseId, moduleId, materialId, uploadedFilePath;

  beforeEach(async () => {
    const course = await request(app).post('/api/courses').set('Authorization', `Bearer ${instructorToken}`)
      .send({ courseCode: 'MATDEL1', title: 'Material Delete Course' });
    courseId = course.body.courseId;
    const mod = await request(app).post(`/api/courses/${courseId}/modules`).set('Authorization', `Bearer ${instructorToken}`)
      .send({ moduleTitle: 'M1' });
    moduleId = mod.body.moduleId;

    const tmpFile = path.join(__dirname, 'fixture.pdf');
    fs.writeFileSync(tmpFile, '%PDF-1.4\ntest content\n%%EOF');

    const upload = await request(app)
      .post(`/api/materials/module/${moduleId}`)
      .set('Authorization', `Bearer ${instructorToken}`)
      .attach('file', tmpFile)
      .field('title', 'Test Material');
    materialId = upload.body.materialId;
    uploadedFilePath = path.join(__dirname, '..', upload.body.fileURL.replace(/^\/uploads\//, 'uploads/'));
    fs.unlinkSync(tmpFile);
  });

  it('deletes the material row and the file on disk', async () => {
    expect(fs.existsSync(uploadedFilePath)).toBe(true);

    const res = await request(app).delete(`/api/materials/${materialId}`).set('Authorization', `Bearer ${instructorToken}`);
    expect(res.status).toBe(200);

    // fs.unlink in the route is async/best-effort — give it a tick
    await new Promise((r) => setTimeout(r, 100));
    expect(fs.existsSync(uploadedFilePath)).toBe(false);
  });

  it('blocks a non-owning instructor from deleting a material', async () => {
    const res = await request(app).delete(`/api/materials/${materialId}`).set('Authorization', `Bearer ${otherInstructorToken}`);
    expect(res.status).toBe(403);
  });
});

describe('Quiz delete', () => {
  it('allows the owner to delete a quiz and blocks non-owners', async () => {
    const course = await request(app).post('/api/courses').set('Authorization', `Bearer ${instructorToken}`)
      .send({ courseCode: 'QUIZDEL1', title: 'Quiz Delete Course' });
    const mod = await request(app).post(`/api/courses/${course.body.courseId}/modules`).set('Authorization', `Bearer ${instructorToken}`)
      .send({ moduleTitle: 'M1' });
    const quiz = await request(app).post(`/api/quizzes/module/${mod.body.moduleId}`).set('Authorization', `Bearer ${instructorToken}`)
      .send({
        title: 'Doomed Quiz',
        questions: [{ questionText: 'Q1', options: [{ optionText: 'A', isCorrect: true }, { optionText: 'B', isCorrect: false }] }],
      });

    const blockedDelete = await request(app).delete(`/api/quizzes/${quiz.body.quizId}`).set('Authorization', `Bearer ${otherInstructorToken}`);
    expect(blockedDelete.status).toBe(403);

    const res = await request(app).delete(`/api/quizzes/${quiz.body.quizId}`).set('Authorization', `Bearer ${instructorToken}`);
    expect(res.status).toBe(200);

    const check = await request(app).get(`/api/quizzes/${quiz.body.quizId}`).set('Authorization', `Bearer ${instructorToken}`);
    expect(check.status).toBe(404);
  });
});
