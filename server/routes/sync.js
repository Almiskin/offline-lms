const express = require('express');
const pool = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

// POST /api/sync/quiz-attempt
// Body: { quizId, clientAttemptUUID, startTime, endTime, responses: [{questionId, selectedOptionId}] }
// Scores are always (re)computed server-side from the correct answers stored in
// the DB — the client's own tally is never trusted, since offline devices are
// an easy place to tamper with a locally-cached "score".
// Idempotent: re-submitting the same clientAttemptUUID for the same student/quiz
// returns the existing result instead of creating a duplicate (handles retried
// syncs after a flaky reconnect).
router.post('/quiz-attempt', authenticate, requireRole('Student'), async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { quizId, clientAttemptUUID, startTime, endTime, responses } = req.body;
    if (!quizId || !clientAttemptUUID || !Array.isArray(responses)) {
      return res.status(400).json({ error: 'quizId, clientAttemptUUID, and responses are required' });
    }

    const [[quizAccess]] = await conn.query(
      `SELECT q.QuizID, c.CourseID, c.IsPublished
       FROM Quizzes q
       JOIN Modules m ON q.ModuleID = m.ModuleID
       JOIN Courses c ON m.CourseID = c.CourseID
       WHERE q.QuizID = ?`,
      [quizId]
    );

    if (!quizAccess) {
      return res.status(404).json({ error: 'Quiz not found' });
    }

    if (!quizAccess.IsPublished) {
      return res.status(403).json({ error: 'Course is not published' });
    }

    const [[enrollment]] = await conn.query(
      `SELECT EnrollmentID
       FROM Enrollments
       WHERE StudentID = ? AND CourseID = ?`,
      [req.user.userId, quizAccess.CourseID]
    );

    if (!enrollment) {
      return res.status(403).json({ error: 'You are not enrolled in this course' });
    }

    const [existing] = await conn.query(
      'SELECT * FROM QuizAttempts WHERE StudentID = ? AND QuizID = ? AND ClientAttemptUUID = ?',
      [req.user.userId, quizId, clientAttemptUUID]
    );
    if (existing.length > 0) {
      const [existingResponses] = await conn.query(
        'SELECT * FROM Responses WHERE AttemptID = ?',
        [existing[0].AttemptID]
      );
      return res.json({ attempt: existing[0], responses: existingResponses, alreadySynced: true });
    }

    // Fetch correct answers for every question in this quiz
    const [correctRows] = await conn.query(
      `SELECT o.QuestionID, o.OptionID FROM Options o
       JOIN Questions q ON o.QuestionID = q.QuestionID
       WHERE q.QuizID = ? AND o.IsCorrect = TRUE`,
      [quizId]
    );
    const correctByQuestion = {};
    correctRows.forEach((r) => (correctByQuestion[r.QuestionID] = r.OptionID));

    const [questionRows] = await conn.query('SELECT QuestionID FROM Questions WHERE QuizID = ?', [quizId]);
    const totalPoints = questionRows.length;

    let scoreCount = 0;
    const gradedResponses = responses.map((r) => {
      const isCorrect = correctByQuestion[r.questionId] === r.selectedOptionId;
      if (isCorrect) scoreCount += 1;
      return { ...r, isCorrect };
    });
    const score = totalPoints > 0 ? (scoreCount / totalPoints) * 100 : 0;

    // mysql2 needs real Date objects (or 'YYYY-MM-DD HH:MM:SS' strings), not
    // raw ISO-8601 strings with a trailing 'Z' — it does not convert those.
    const startDate = startTime ? new Date(startTime) : new Date();
    const endDate = endTime ? new Date(endTime) : new Date();

    await conn.beginTransaction();
    const [attemptResult] = await conn.query(
      `INSERT INTO QuizAttempts (StudentID, QuizID, ClientAttemptUUID, StartTime, EndTime, Score, TotalPoints, SyncStatus)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'Synced')`,
      [req.user.userId, quizId, clientAttemptUUID, startDate, endDate, score, totalPoints]
    );
    const attemptId = attemptResult.insertId;

    for (const r of gradedResponses) {
      await conn.query(
        'INSERT INTO Responses (AttemptID, QuestionID, SelectedOptionID, IsCorrect) VALUES (?, ?, ?, ?)',
        [attemptId, r.questionId, r.selectedOptionId || null, r.isCorrect]
      );
    }
    await conn.commit();

    res.status(201).json({
      attemptId,
      score,
      totalPoints,
      correctCount: scoreCount,
      responses: gradedResponses,
      alreadySynced: false,
    });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).json({ error: 'Sync failed' });
  } finally {
    conn.release();
  }
});

module.exports = router;
