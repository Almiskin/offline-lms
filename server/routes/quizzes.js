const express = require('express');
const pool = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

// GET /api/quizzes/:id - full quiz for taking (questions + options, no IsCorrect leaked to students)
router.get('/:id', authenticate, async (req, res) => {
  const [[quiz]] = await pool.query('SELECT * FROM Quizzes WHERE QuizID = ?', [req.params.id]);
  if (!quiz) return res.status(404).json({ error: 'Quiz not found' });

  const [questions] = await pool.query(
    'SELECT QuestionID, QuestionText, SequenceOrder FROM Questions WHERE QuizID = ? ORDER BY SequenceOrder',
    [req.params.id]
  );
  for (const q of questions) {
    const isInstructor = req.user.role === 'Instructor';
    const [options] = await pool.query(
      `SELECT OptionID, OptionText, SequenceOrder${isInstructor ? ', IsCorrect' : ''}
       FROM Options WHERE QuestionID = ? ORDER BY SequenceOrder`,
      [q.QuestionID]
    );
    q.options = options;
  }

  res.json({ quiz, questions });
});

// POST /api/quizzes/module/:moduleId - create quiz with questions/options (Instructor, owner only)
router.post('/module/:moduleId', authenticate, requireRole('Instructor'), async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const [[mod]] = await conn.query(
      `SELECT m.ModuleID, c.InstructorID FROM Modules m
       JOIN Courses c ON m.CourseID = c.CourseID WHERE m.ModuleID = ?`,
      [req.params.moduleId]
    );
    if (!mod) return res.status(404).json({ error: 'Module not found' });
    if (mod.InstructorID !== req.user.userId) return res.status(403).json({ error: 'Not your course' });

    const { title, instructions, showOneAtATime, questions } = req.body;
    if (!title || !Array.isArray(questions) || questions.length === 0) {
      return res.status(400).json({ error: 'Title and at least one question are required' });
    }
    for (const q of questions) {
      if (!q.questionText || !Array.isArray(q.options) || q.options.length < 2) {
        return res.status(400).json({ error: 'Each question needs text and at least two options' });
      }
      if (!q.options.some((o) => o.isCorrect)) {
        return res.status(400).json({ error: 'Each question needs exactly one correct answer' });
      }
    }

    await conn.beginTransaction();
    const [quizResult] = await conn.query(
      'INSERT INTO Quizzes (ModuleID, Title, Instructions, ShowOneAtATime) VALUES (?, ?, ?, ?)',
      [req.params.moduleId, title, instructions || null, !!showOneAtATime]
    );
    const quizId = quizResult.insertId;

    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      const [qResult] = await conn.query(
        'INSERT INTO Questions (QuizID, QuestionText, SequenceOrder) VALUES (?, ?, ?)',
        [quizId, q.questionText, i]
      );
      for (let j = 0; j < q.options.length; j++) {
        const o = q.options[j];
        await conn.query(
          'INSERT INTO Options (QuestionID, OptionText, IsCorrect, SequenceOrder) VALUES (?, ?, ?, ?)',
          [qResult.insertId, o.optionText, !!o.isCorrect, j]
        );
      }
    }

    await conn.commit();
    res.status(201).json({ quizId });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).json({ error: 'Could not create quiz' });
  } finally {
    conn.release();
  }
});

// GET /api/quizzes/:id/history - student's own attempt history for a quiz
router.get('/:id/history', authenticate, async (req, res) => {
  const [rows] = await pool.query(
    `SELECT AttemptID, StartTime, EndTime, Score, TotalPoints, SyncStatus
     FROM QuizAttempts WHERE QuizID = ? AND StudentID = ? ORDER BY StartTime DESC`,
    [req.params.id, req.user.userId]
  );
  res.json({ attempts: rows });
});

// DELETE /api/quizzes/:id - remove a quiz (Instructor, owner only).
// Questions/Options/QuizAttempts/Responses cascade via FK ON DELETE CASCADE.
// There's no PATCH/edit route deliberately: once a quiz has attempts, editing
// its questions in place would silently invalidate those students' scores.
// Delete-and-recreate is the safer pattern here, same as most LMS platforms.
router.delete('/:id', authenticate, requireRole('Instructor'), async (req, res) => {
  const [[quiz]] = await pool.query(
    `SELECT q.QuizID, c.InstructorID FROM Quizzes q
     JOIN Modules m ON q.ModuleID = m.ModuleID
     JOIN Courses c ON m.CourseID = c.CourseID
     WHERE q.QuizID = ?`,
    [req.params.id]
  );
  if (!quiz) return res.status(404).json({ error: 'Quiz not found' });
  if (quiz.InstructorID !== req.user.userId) return res.status(403).json({ error: 'Not your quiz' });

  await pool.query('DELETE FROM Quizzes WHERE QuizID = ?', [req.params.id]);
  res.json({ message: 'Quiz deleted' });
});

module.exports = router;
