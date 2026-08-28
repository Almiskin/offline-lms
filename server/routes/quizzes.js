const express = require('express');
const multer = require('multer');
const mammoth = require('mammoth');
const { parse: parseCsv } = require('csv-parse/sync');
const pool = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();
const importUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } });

function validateImportedQuestions(questions) {
  if (!Array.isArray(questions) || questions.length === 0) {
    throw new Error('Import must contain at least one question');
  }
  return questions.map((question, index) => {
    if (!question.questionText || !Array.isArray(question.options) || question.options.length < 2) {
      throw new Error(`Question ${index + 1} needs text and at least two options`);
    }
    const options = question.options
      .map((option) => ({ optionText: String(option.optionText || '').trim(), isCorrect: option.isCorrect === true }))
      .filter((option) => option.optionText);
    if (options.length < 2) throw new Error(`Question ${index + 1} needs at least two non-empty options`);
    if (options.filter((option) => option.isCorrect).length !== 1) {
      throw new Error(`Question ${index + 1} must have exactly one correct answer`);
    }
    return { questionText: String(question.questionText).trim(), options };
  });
}

async function parseImportedQuestions(file) {
  const extension = file.originalname.toLowerCase().split('.').pop();
  if (extension === 'json') {
    const parsed = JSON.parse(file.buffer.toString('utf8'));
    return validateImportedQuestions(parsed.questions || parsed);
  }
  if (extension === 'csv') {
    const rows = parseCsv(file.buffer.toString('utf8'), { columns: true, skip_empty_lines: true, bom: true, trim: true });
    const questions = rows.map((row) => ({
      questionText: row.questionText || row.question,
      options: ['A', 'B', 'C', 'D'].map((letter) => ({
        optionText: row[`option${letter}`],
        isCorrect: String(row.correctAnswer || '').trim().toUpperCase() === letter,
      })),
    }));
    return validateImportedQuestions(questions);
  }
  if (extension === 'docx') {
    const result = await mammoth.extractRawText({ buffer: file.buffer });
    const questions = [];
    let current = null;
    for (const rawLine of result.value.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) continue;
      const questionMatch = line.match(/^(?:Question\s*\d+\s*[:.)-]?\s*|Q\s*\d+\s*[:.)-]?\s*)(.+)$/i);
      const optionMatch = line.match(/^([A-D])\s*[.)-]\s*(.+)$/i);
      const correctMatch = line.match(/^Correct\s*(?:answer)?\s*[:=-]\s*([A-D])$/i);
      if (questionMatch) {
        current = { questionText: questionMatch[1], options: [] };
        questions.push(current);
      } else if (optionMatch && current) {
        current.options.push({ optionText: optionMatch[2], isCorrect: false, letter: optionMatch[1].toUpperCase() });
      } else if (correctMatch && current) {
        const correctLetter = correctMatch[1].toUpperCase();
        current.options.forEach((option) => { option.isCorrect = option.letter === correctLetter; delete option.letter; });
      }
    }
    return validateImportedQuestions(questions);
  }
  throw new Error('Only .json, .csv, and .docx quiz imports are supported');
}

// GET /api/quizzes/:id - full quiz for taking (questions + options, no IsCorrect leaked to students)
router.get('/:id', authenticate, async (req, res) => {
  const [[quizRow]] = await pool.query(
        `SELECT q.*, c.CourseID AS ParentCourseID, c.InstructorID AS ParentInstructorID,
          c.IsPublished AS ParentCoursePublished
     FROM Quizzes q
     JOIN Modules m ON q.ModuleID = m.ModuleID
     JOIN Courses c ON m.CourseID = c.CourseID
     WHERE q.QuizID = ?`,
    [req.params.id]
  );
  if (!quizRow) return res.status(404).json({ error: 'Quiz not found' });

  const { ParentCourseID, ParentInstructorID, ...quiz } = quizRow;

  const isInstructor = req.user.role === 'Instructor';
  if (isInstructor) {
    if (String(ParentInstructorID) !== String(req.user.userId)) {
      return res.status(403).json({ error: 'Not your course' });
    }
  } else if (req.user.role === 'Student') {
    if (!quizRow.ParentCoursePublished) {
      return res.status(403).json({ error: 'Course is not published' });
    }
    const [[enrollment]] = await pool.query(
      'SELECT EnrollmentID FROM Enrollments WHERE StudentID = ? AND CourseID = ?',
      [req.user.userId, ParentCourseID]
    );
    if (!enrollment) {
      return res.status(403).json({ error: 'Enroll in this course to view its quiz', requiresEnrollment: true });
    }
  } else {
    return res.status(403).json({ error: 'Insufficient permissions' });
  }

  const [questions] = await pool.query(
    'SELECT QuestionID, QuestionText, SequenceOrder FROM Questions WHERE QuizID = ? ORDER BY SequenceOrder',
    [req.params.id]
  );
  for (const q of questions) {
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
      const correctCount = q.options.filter((option) => option.isCorrect === true).length;
      if (correctCount !== 1) {
        return res.status(400).json({ error: 'Each question must have exactly one correct answer' });
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

// POST /api/quizzes/module/:moduleId/import - preview questions from JSON, CSV, or DOCX.
router.post('/module/:moduleId/import', authenticate, requireRole('Instructor'), importUpload.single('file'), async (req, res) => {
  try {
    const [[mod]] = await pool.query(
      `SELECT m.ModuleID, c.InstructorID FROM Modules m
       JOIN Courses c ON m.CourseID = c.CourseID WHERE m.ModuleID = ?`,
      [req.params.moduleId]
    );
    if (!mod) return res.status(404).json({ error: 'Module not found' });
    if (String(mod.InstructorID) !== String(req.user.userId)) return res.status(403).json({ error: 'Not your course' });
    if (!req.file) return res.status(400).json({ error: 'No import file uploaded' });

    const questions = await parseImportedQuestions(req.file);
    res.json({ questions, count: questions.length });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Could not parse quiz import' });
  }
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
