const request = require('supertest');
const crypto = require('crypto');
const { resetDatabase, closeDatabase } = require('./testUtils');
const app = require('../app');

let instructorToken;
let studentToken;
let moduleId;
let quizId;
let optionIds; // { q1Correct, q1Wrong, q2Correct, q2Wrong }

async function registerUser(role, email) {
  const res = await request(app).post('/api/auth/register').send({
    firstName: 'Test', lastName: role, email, password: 'Passw0rd', role,
  });
  return res.body.token;
}

beforeEach(async () => {
  await resetDatabase();
  instructorToken = await registerUser('Instructor', 'quizinstructor@example.com');
  studentToken = await registerUser('Student', 'quizstudent@example.com');

  const course = await request(app).post('/api/courses').set('Authorization', `Bearer ${instructorToken}`)
    .send({ courseCode: 'QZ1', title: 'Quiz Course' });
  const courseId = course.body.courseId;
  await request(app).patch(`/api/courses/${courseId}/publish`).set('Authorization', `Bearer ${instructorToken}`)
    .send({ isPublished: true });
  await request(app).post(`/api/courses/${courseId}/enroll`).set('Authorization', `Bearer ${studentToken}`);

  const mod = await request(app).post(`/api/courses/${courseId}/modules`).set('Authorization', `Bearer ${instructorToken}`)
    .send({ moduleTitle: 'Quiz Module' });
  moduleId = mod.body.moduleId;

  const quiz = await request(app).post(`/api/quizzes/module/${moduleId}`).set('Authorization', `Bearer ${instructorToken}`)
    .send({
      title: 'Two Question Quiz',
      questions: [
        { questionText: 'Q1', options: [{ optionText: 'Right', isCorrect: true }, { optionText: 'Wrong', isCorrect: false }] },
        { questionText: 'Q2', options: [{ optionText: 'Right', isCorrect: true }, { optionText: 'Wrong', isCorrect: false }] },
      ],
    });
  quizId = quiz.body.quizId;

  const full = await request(app).get(`/api/quizzes/${quizId}`).set('Authorization', `Bearer ${instructorToken}`);
  const [q1, q2] = full.body.questions;
  optionIds = {
    q1: q1.QuestionID, q1Correct: q1.options.find((o) => o.IsCorrect).OptionID, q1Wrong: q1.options.find((o) => !o.IsCorrect).OptionID,
    q2: q2.QuestionID, q2Correct: q2.options.find((o) => o.IsCorrect).OptionID, q2Wrong: q2.options.find((o) => !o.IsCorrect).OptionID,
  };
});

afterAll(async () => {
  await closeDatabase();
});

describe('Quiz creation', () => {
  it('rejects a quiz with no questions', async () => {
    const res = await request(app).post(`/api/quizzes/module/${moduleId}`).set('Authorization', `Bearer ${instructorToken}`)
      .send({ title: 'Empty', questions: [] });
    expect(res.status).toBe(400);
  });

  it('rejects a question with no correct answer marked', async () => {
    const res = await request(app).post(`/api/quizzes/module/${moduleId}`).set('Authorization', `Bearer ${instructorToken}`)
      .send({
        title: 'No correct answer',
        questions: [{ questionText: 'Q1', options: [{ optionText: 'A', isCorrect: false }, { optionText: 'B', isCorrect: false }] }],
      });
    expect(res.status).toBe(400);
  });

  it('rejects a question with more than one correct answer', async () => {
    const res = await request(app)
      .post(`/api/quizzes/module/${moduleId}`)
      .set('Authorization', `Bearer ${instructorToken}`)
      .send({
        title: 'Invalid Multiple Correct Answers',
        questions: [
          {
            questionText: 'Which option is correct?',
            options: [
              { optionText: 'Option A', isCorrect: true },
              { optionText: 'Option B', isCorrect: true },
              { optionText: 'Option C', isCorrect: false },
            ],
          },
        ],
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/exactly one correct answer/i);
  });

  it('hides IsCorrect from students but shows it to instructors', async () => {
    const studentView = await request(app).get(`/api/quizzes/${quizId}`).set('Authorization', `Bearer ${studentToken}`);
    expect(studentView.body.questions[0].options[0].IsCorrect).toBeUndefined();

    const instructorView = await request(app).get(`/api/quizzes/${quizId}`).set('Authorization', `Bearer ${instructorToken}`);
    expect(instructorView.body.questions[0].options[0].IsCorrect).toBeDefined();
  });

  it('rejects an unenrolled student from viewing a quiz', async () => {
    const unenrolledStudentToken = await registerUser('Student', 'unenrolled-quizstudent@example.com');
    const res = await request(app).get(`/api/quizzes/${quizId}`)
      .set('Authorization', `Bearer ${unenrolledStudentToken}`);

    expect(res.status).toBe(403);
    expect(res.body.requiresEnrollment).toBe(true);
  });

  it('rejects a non-owning instructor from viewing a quiz', async () => {
    const otherInstructorToken = await registerUser('Instructor', 'other-quiz-instructor@example.com');
    const res = await request(app).get(`/api/quizzes/${quizId}`)
      .set('Authorization', `Bearer ${otherInstructorToken}`);

    expect(res.status).toBe(403);
  });

  it('blocks an enrolled student from viewing a quiz after the course is unpublished', async () => {
    const { pool } = require('./testUtils');
    await pool.query('UPDATE Courses SET IsPublished = FALSE WHERE CourseID = (SELECT CourseID FROM Modules WHERE ModuleID = ?)', [moduleId]);

    const res = await request(app).get(`/api/quizzes/${quizId}`)
      .set('Authorization', `Bearer ${studentToken}`);

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/not published/i);
  });
});

describe('POST /api/sync/quiz-attempt', () => {
  it('computes the score server-side from the correct answers, ignoring anything the client claims', async () => {
    const res = await request(app).post('/api/sync/quiz-attempt').set('Authorization', `Bearer ${studentToken}`).send({
      quizId,
      clientAttemptUUID: crypto.randomUUID(),
      startTime: new Date().toISOString(),
      endTime: new Date().toISOString(),
      responses: [
        { questionId: optionIds.q1, selectedOptionId: optionIds.q1Correct },
        { questionId: optionIds.q2, selectedOptionId: optionIds.q2Wrong },
      ],
    });
    expect(res.status).toBe(201);
    expect(res.body.score).toBe(50);
    expect(res.body.correctCount).toBe(1);
  });

  it('scores 100% when everything is correct', async () => {
    const res = await request(app).post('/api/sync/quiz-attempt').set('Authorization', `Bearer ${studentToken}`).send({
      quizId,
      clientAttemptUUID: crypto.randomUUID(),
      startTime: new Date().toISOString(),
      endTime: new Date().toISOString(),
      responses: [
        { questionId: optionIds.q1, selectedOptionId: optionIds.q1Correct },
        { questionId: optionIds.q2, selectedOptionId: optionIds.q2Correct },
      ],
    });
    expect(res.body.score).toBe(100);
  });

  it('is idempotent: re-syncing the same clientAttemptUUID does not create a duplicate attempt', async () => {
    const uuid = crypto.randomUUID();
    const payload = {
      quizId,
      clientAttemptUUID: uuid,
      startTime: new Date().toISOString(),
      endTime: new Date().toISOString(),
      responses: [
        { questionId: optionIds.q1, selectedOptionId: optionIds.q1Correct },
        { questionId: optionIds.q2, selectedOptionId: optionIds.q2Correct },
      ],
    };

    const first = await request(app).post('/api/sync/quiz-attempt').set('Authorization', `Bearer ${studentToken}`).send(payload);
    expect(first.body.alreadySynced).toBe(false);

    const second = await request(app).post('/api/sync/quiz-attempt').set('Authorization', `Bearer ${studentToken}`).send(payload);
    expect(second.body.alreadySynced).toBe(true);
    expect(second.body.attempt.AttemptID).toBe(first.body.attemptId);

    const { pool } = require('./testUtils');
    const [rows] = await pool.query('SELECT COUNT(*) AS c FROM QuizAttempts WHERE QuizID = ?', [quizId]);
    expect(rows[0].c).toBe(1);
  });

  it('blocks an unenrolled student from synchronizing a quiz attempt', async () => {
    const outsiderToken = await registerUser('Student', 'sync-outsider@example.com');

    const res = await request(app)
      .post('/api/sync/quiz-attempt')
      .set('Authorization', `Bearer ${outsiderToken}`)
      .send({
        quizId,
        clientAttemptUUID: 'unenrolled-sync-test-uuid',
        startTime: new Date().toISOString(),
        endTime: new Date().toISOString(),
        responses: [{ questionId: optionIds.q1, selectedOptionId: optionIds.q1Correct }],
      });

    expect(res.status).toBe(403);
  });

  it('blocks instructors from submitting quiz attempts', async () => {
    const res = await request(app).post('/api/sync/quiz-attempt').set('Authorization', `Bearer ${instructorToken}`).send({
      quizId,
      clientAttemptUUID: crypto.randomUUID(),
      startTime: new Date().toISOString(),
      endTime: new Date().toISOString(),
      responses: [],
    });
    expect(res.status).toBe(403);
  });
});

// Quiz delete coverage lives in tests/editDelete.test.js to keep it in one place.

describe('GET /api/reports/quiz/:id/statistics', () => {
  beforeEach(async () => {
    // one perfect, one zero attempt
    await request(app).post('/api/sync/quiz-attempt').set('Authorization', `Bearer ${studentToken}`).send({
      quizId, clientAttemptUUID: crypto.randomUUID(), startTime: new Date().toISOString(), endTime: new Date().toISOString(),
      responses: [
        { questionId: optionIds.q1, selectedOptionId: optionIds.q1Correct },
        { questionId: optionIds.q2, selectedOptionId: optionIds.q2Correct },
      ],
    });
  });

  it('returns correct aggregate statistics to the owning instructor', async () => {
    const res = await request(app).get(`/api/reports/quiz/${quizId}/statistics`).set('Authorization', `Bearer ${instructorToken}`);
    expect(res.status).toBe(200);
    expect(res.body.stats.attemptCount).toBe(1);
    expect(Number(res.body.stats.maxScore)).toBe(100);
    expect(res.body.distribution['90-100']).toBe(1);
  });

  it('blocks students from viewing instructor statistics', async () => {
    const res = await request(app).get(`/api/reports/quiz/${quizId}/statistics`).set('Authorization', `Bearer ${studentToken}`);
    expect(res.status).toBe(403);
  });

  it('blocks a non-owning instructor from viewing the statistics', async () => {
    const otherToken = await registerUser('Instructor', 'notowner@example.com');
    const res = await request(app).get(`/api/reports/quiz/${quizId}/statistics`).set('Authorization', `Bearer ${otherToken}`);
    expect(res.status).toBe(403);
  });
});
