const express = require('express');
const pool = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

// GET /api/reports/my-quiz-history - student's own results across all quizzes
router.get('/my-quiz-history', authenticate, requireRole('Student'), async (req, res) => {
  const [rows] = await pool.query(
    `SELECT qa.AttemptID, q.Title AS QuizTitle, qa.StartTime, qa.Score, qa.TotalPoints
     FROM QuizAttempts qa JOIN Quizzes q ON qa.QuizID = q.QuizID
     WHERE qa.StudentID = ? AND qa.SyncStatus = 'Synced'
     ORDER BY qa.StartTime DESC`,
    [req.user.userId]
  );
  res.json({ history: rows });
});

// GET /api/reports/quiz/:id/statistics - instructor view of a quiz's performance
router.get('/quiz/:id/statistics', authenticate, requireRole('Instructor'), async (req, res) => {
  const [[owns]] = await pool.query(
    `SELECT c.InstructorID FROM Quizzes q
     JOIN Modules m ON q.ModuleID = m.ModuleID
     JOIN Courses c ON m.CourseID = c.CourseID
     WHERE q.QuizID = ?`,
    [req.params.id]
  );
  if (!owns) return res.status(404).json({ error: 'Quiz not found' });
  if (owns.InstructorID !== req.user.userId) return res.status(403).json({ error: 'Not your quiz' });

  const [[stats]] = await pool.query(
    `SELECT COUNT(*) AS attemptCount, AVG(Score) AS avgScore, MAX(Score) AS maxScore, MIN(Score) AS minScore
     FROM QuizAttempts WHERE QuizID = ? AND SyncStatus = 'Synced'`,
    [req.params.id]
  );
  const [scores] = await pool.query(
    `SELECT u.FirstName, u.LastName, qa.Score, qa.StartTime
     FROM QuizAttempts qa JOIN Users u ON qa.StudentID = u.UserID
     WHERE qa.QuizID = ? AND qa.SyncStatus = 'Synced' ORDER BY qa.Score DESC`,
    [req.params.id]
  );

  const distribution = { '0-49': 0, '50-69': 0, '70-89': 0, '90-100': 0 };
  scores.forEach((s) => {
    const sc = parseFloat(s.Score);
    if (sc < 50) distribution['0-49']++;
    else if (sc < 70) distribution['50-69']++;
    else if (sc < 90) distribution['70-89']++;
    else distribution['90-100']++;
  });

  res.json({ stats, scores, distribution });
});

// GET /api/reports/course/:id/progress - the current student's own completion
// progress for one course: % of materials viewed + quizzes attempted.
router.get('/course/:id/progress', authenticate, requireRole('Student'), async (req, res) => {
  const courseId = req.params.id;

  const [[enrollment]] = await pool.query(
    'SELECT EnrollmentID FROM Enrollments WHERE StudentID = ? AND CourseID = ?',
    [req.user.userId, courseId]
  );
  if (!enrollment) return res.status(403).json({ error: 'Not enrolled in this course' });

  const progress = await computeCourseProgress(courseId, req.user.userId);
  if (!progress) return res.status(404).json({ error: 'Course not found' });
  res.json({ progress });
});

// GET /api/reports/course/:id/progress-summary - instructor view of every
// enrolled student's completion progress for the course (Instructor, owner only).
router.get('/course/:id/progress-summary', authenticate, requireRole('Instructor'), async (req, res) => {
  const courseId = req.params.id;

  const [[course]] = await pool.query('SELECT InstructorID FROM Courses WHERE CourseID = ?', [courseId]);
  if (!course) return res.status(404).json({ error: 'Course not found' });
  if (course.InstructorID !== req.user.userId) return res.status(403).json({ error: 'Not your course' });

  const [students] = await pool.query(
    `SELECT u.UserID, u.FirstName, u.LastName, e.EnrollmentDate, e.LastAccessedDate
     FROM Enrollments e JOIN Users u ON e.StudentID = u.UserID
     WHERE e.CourseID = ? ORDER BY u.LastName, u.FirstName`,
    [courseId]
  );

  const summary = [];
  for (const student of students) {
    const progress = await computeCourseProgress(courseId, student.UserID);
    summary.push({
      studentId: student.UserID,
      firstName: student.FirstName,
      lastName: student.LastName,
      enrollmentDate: student.EnrollmentDate,
      lastAccessedDate: student.LastAccessedDate,
      ...progress,
    });
  }

  res.json({ summary });
});

// Shared calculation used by both progress endpoints above: completion % is
// (materials viewed + quizzes attempted) / (total materials + total quizzes)
// for the given student in the given course. Returns null if the course
// doesn't exist so callers can 404.
async function computeCourseProgress(courseId, studentId) {
  const [[course]] = await pool.query('SELECT CourseID FROM Courses WHERE CourseID = ?', [courseId]);
  if (!course) return null;

  const [[materialsTotal]] = await pool.query(
    `SELECT COUNT(*) AS c FROM Materials mat JOIN Modules m ON mat.ModuleID = m.ModuleID WHERE m.CourseID = ?`,
    [courseId]
  );
  const [[materialsViewed]] = await pool.query(
    `SELECT COUNT(DISTINCT mv.MaterialID) AS c FROM MaterialViews mv
     JOIN Materials mat ON mv.MaterialID = mat.MaterialID
     JOIN Modules m ON mat.ModuleID = m.ModuleID
     WHERE m.CourseID = ? AND mv.StudentID = ?`,
    [courseId, studentId]
  );
  const [[quizzesTotal]] = await pool.query(
    `SELECT COUNT(*) AS c FROM Quizzes q JOIN Modules m ON q.ModuleID = m.ModuleID WHERE m.CourseID = ?`,
    [courseId]
  );
  const [[quizzesAttempted]] = await pool.query(
    `SELECT COUNT(DISTINCT qa.QuizID) AS c FROM QuizAttempts qa
     JOIN Quizzes q ON qa.QuizID = q.QuizID
     JOIN Modules m ON q.ModuleID = m.ModuleID
     WHERE m.CourseID = ? AND qa.StudentID = ? AND qa.SyncStatus = 'Synced'`,
    [courseId, studentId]
  );

  const totalItems = materialsTotal.c + quizzesTotal.c;
  const completedItems = materialsViewed.c + quizzesAttempted.c;
  const completionPercentage = totalItems === 0 ? 0 : Math.round((completedItems / totalItems) * 100);

  return {
    materialsTotal: materialsTotal.c,
    materialsViewed: materialsViewed.c,
    quizzesTotal: quizzesTotal.c,
    quizzesAttempted: quizzesAttempted.c,
    completionPercentage,
  };
}

module.exports = router;
