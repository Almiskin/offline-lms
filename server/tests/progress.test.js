const request = require('supertest');
const crypto = require('crypto');
const { resetDatabase, closeDatabase } = require('./testUtils');
const app = require('../app');

let instructorToken;
let studentToken;
let courseId;
let moduleId;
let materialId;
let quizId;

async function registerUser(role, email) {
  const res = await request(app).post('/api/auth/register').send({
    firstName: 'Test', lastName: role, email, password: 'Passw0rd', role,
  });
  return res.body.token;
}

beforeEach(async () => {
  await resetDatabase();
  instructorToken = await registerUser('Instructor', 'proginstructor@example.com');
  studentToken = await registerUser('Student', 'progstudent@example.com');

  const course = await request(app).post('/api/courses').set('Authorization', `Bearer ${instructorToken}`)
    .send({ courseCode: 'PROG1', title: 'Progress Course' });
  courseId = course.body.courseId;
  await request(app).patch(`/api/courses/${courseId}/publish`).set('Authorization', `Bearer ${instructorToken}`)
    .send({ isPublished: true });
  await request(app).post(`/api/courses/${courseId}/enroll`).set('Authorization', `Bearer ${studentToken}`);

  const mod = await request(app).post(`/api/courses/${courseId}/modules`).set('Authorization', `Bearer ${instructorToken}`)
    .send({ moduleTitle: 'Module 1' });
  moduleId = mod.body.moduleId;

  const upload = await request(app)
    .post(`/api/materials/module/${moduleId}`)
    .set('Authorization', `Bearer ${instructorToken}`)
    .attach('file', Buffer.from('%PDF-1.4'), { filename: 'material.pdf', contentType: 'application/pdf' });
  materialId = upload.body.materialId;

  const quiz = await request(app).post(`/api/quizzes/module/${moduleId}`).set('Authorization', `Bearer ${instructorToken}`)
    .send({
      title: 'Progress Quiz',
      questions: [{ questionText: 'Q1', options: [{ optionText: 'A', isCorrect: true }, { optionText: 'B', isCorrect: false }] }],
    });
  quizId = quiz.body.quizId;
});

afterAll(async () => {
  await closeDatabase();
});

describe('GET /api/reports/course/:id/progress (student)', () => {
  it('starts at 0% before anything is viewed or attempted', async () => {
    const res = await request(app).get(`/api/reports/course/${courseId}/progress`).set('Authorization', `Bearer ${studentToken}`);
    expect(res.status).toBe(200);
    expect(res.body.progress.completionPercentage).toBe(0);
    expect(res.body.progress.materialsTotal).toBe(1);
    expect(res.body.progress.quizzesTotal).toBe(1);
  });

  it('reaches 50% after viewing the one material (1 of 2 total items)', async () => {
    await request(app).get(`/api/materials/${materialId}/download`).set('Authorization', `Bearer ${studentToken}`);
    const res = await request(app).get(`/api/reports/course/${courseId}/progress`).set('Authorization', `Bearer ${studentToken}`);
    expect(res.body.progress.materialsViewed).toBe(1);
    expect(res.body.progress.completionPercentage).toBe(50);
  });

  it('reaches 100% after viewing the material and attempting the quiz', async () => {
    await request(app).get(`/api/materials/${materialId}/download`).set('Authorization', `Bearer ${studentToken}`);

    const quizDetail = await request(app).get(`/api/quizzes/${quizId}`).set('Authorization', `Bearer ${studentToken}`);
    const question = quizDetail.body.questions[0];
    await request(app).post('/api/sync/quiz-attempt').set('Authorization', `Bearer ${studentToken}`).send({
      quizId,
      clientAttemptUUID: crypto.randomUUID(),
      startTime: new Date().toISOString(),
      endTime: new Date().toISOString(),
      responses: [{ questionId: question.QuestionID, selectedOptionId: question.options[0].OptionID }],
    });

    const res = await request(app).get(`/api/reports/course/${courseId}/progress`).set('Authorization', `Bearer ${studentToken}`);
    expect(res.body.progress.completionPercentage).toBe(100);
  });

  it('does not double-count viewing the same material twice', async () => {
    await request(app).get(`/api/materials/${materialId}/download`).set('Authorization', `Bearer ${studentToken}`);
    await request(app).get(`/api/materials/${materialId}/download`).set('Authorization', `Bearer ${studentToken}`);
    const res = await request(app).get(`/api/reports/course/${courseId}/progress`).set('Authorization', `Bearer ${studentToken}`);
    expect(res.body.progress.materialsViewed).toBe(1);
  });

  it('blocks a student who is not enrolled', async () => {
    const outsiderToken = await registerUser('Student', 'outsider@example.com');
    const res = await request(app).get(`/api/reports/course/${courseId}/progress`).set('Authorization', `Bearer ${outsiderToken}`);
    expect(res.status).toBe(403);
  });
});

describe('GET /api/reports/course/:id/progress-summary (instructor)', () => {
  it('lists every enrolled student with their completion percentage', async () => {
    await request(app).get(`/api/materials/${materialId}/download`).set('Authorization', `Bearer ${studentToken}`);

    const res = await request(app).get(`/api/reports/course/${courseId}/progress-summary`).set('Authorization', `Bearer ${instructorToken}`);
    expect(res.status).toBe(200);
    expect(res.body.summary).toHaveLength(1);
    expect(res.body.summary[0].completionPercentage).toBe(50);
    expect(res.body.summary[0].firstName).toBe('Test');
  });

  it('blocks students from viewing the summary', async () => {
    const res = await request(app).get(`/api/reports/course/${courseId}/progress-summary`).set('Authorization', `Bearer ${studentToken}`);
    expect(res.status).toBe(403);
  });

  it('blocks a non-owning instructor', async () => {
    const otherToken = await registerUser('Instructor', 'progintruder@example.com');
    const res = await request(app).get(`/api/reports/course/${courseId}/progress-summary`).set('Authorization', `Bearer ${otherToken}`);
    expect(res.status).toBe(403);
  });
});
