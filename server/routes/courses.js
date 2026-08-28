const express = require('express');
const pool = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

// Shared ownership check used by every edit/delete route below: confirms the
// course exists and that the requesting instructor owns it. Returns the
// course row on success, or sends the appropriate error response and
// returns null (caller should just `return` when it gets null back).
async function requireOwnedCourse(req, res, courseId) {
  const [[course]] = await pool.query('SELECT * FROM Courses WHERE CourseID = ?', [courseId]);
  if (!course) {
    res.status(404).json({ error: 'Course not found' });
    return null;
  }
  if (course.InstructorID !== req.user.userId) {
    res.status(403).json({ error: 'Not your course' });
    return null;
  }
  return course;
}

// GET /api/courses - list published courses (all authenticated users), with
// each course flagged as enrolled/not-enrolled for the current student so the
// UI can show "Enroll" vs "Open".
router.get('/', authenticate, async (req, res) => {
  const [rows] = await pool.query(
    `SELECT c.CourseID, c.CourseCode, c.Title, c.Description, c.IsPublished,
            u.FirstName AS InstructorFirstName, u.LastName AS InstructorLastName,
            e.EnrollmentID IS NOT NULL AS IsEnrolled
     FROM Courses c
     JOIN Users u ON c.InstructorID = u.UserID
     LEFT JOIN Enrollments e ON e.CourseID = c.CourseID AND e.StudentID = ?
     WHERE c.IsPublished = TRUE OR c.InstructorID = ?
     ORDER BY c.CreatedDate DESC`,
    [req.user.userId, req.user.userId]
  );
  res.json({ courses: rows });
});

// POST /api/courses/:id/enroll - student self-enrolls in a published course.
// The proposal doesn't describe an approval workflow, so self-enrollment
// (like joining an open Moodle course) is the simplest model consistent with
// the requirements. Swap this for an approval queue if you need gated access.
router.post('/:id/enroll', authenticate, requireRole('Student'), async (req, res) => {
  const [[course]] = await pool.query('SELECT IsPublished FROM Courses WHERE CourseID = ?', [req.params.id]);
  if (!course) return res.status(404).json({ error: 'Course not found' });
  if (!course.IsPublished) return res.status(403).json({ error: 'This course is not open for enrollment' });

  try {
    await pool.query('INSERT INTO Enrollments (StudentID, CourseID) VALUES (?, ?)', [
      req.user.userId,
      req.params.id,
    ]);
    res.status(201).json({ message: 'Enrolled' });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(200).json({ message: 'Already enrolled' });
    }
    console.error(err);
    res.status(500).json({ error: 'Could not enroll' });
  }
});

// GET /api/courses/:id - course with modules and materials (for browsing/download).
// Students must be enrolled; instructors can always view their own courses.
router.get('/:id', authenticate, async (req, res) => {
  const courseId = req.params.id;
  const [[course]] = await pool.query('SELECT * FROM Courses WHERE CourseID = ?', [courseId]);
  if (!course) return res.status(404).json({ error: 'Course not found' });

  if (req.user.role === 'Student') {
    if (!course.IsPublished) {
      return res.status(403).json({ error: 'Course is not published' });
    }
    const [[enrollment]] = await pool.query(
      'SELECT EnrollmentID FROM Enrollments WHERE StudentID = ? AND CourseID = ?',
      [req.user.userId, courseId]
    );
    if (!enrollment) {
      return res.status(403).json({ error: 'Enroll in this course to view its content', requiresEnrollment: true });
    }
    await pool.query('UPDATE Enrollments SET LastAccessedDate = NOW() WHERE StudentID = ? AND CourseID = ?', [
      req.user.userId,
      courseId,
    ]);
  } else if (course.InstructorID !== req.user.userId) {
    return res.status(403).json({ error: 'Not your course' });
  }

  const [modules] = await pool.query(
    'SELECT * FROM Modules WHERE CourseID = ? ORDER BY SequenceOrder',
    [courseId]
  );
  for (const mod of modules) {
    const [materials] = await pool.query(
      'SELECT MaterialID, Title, MaterialType, FileURL, FileSize, MimeType, SequenceOrder FROM Materials WHERE ModuleID = ? ORDER BY SequenceOrder',
      [mod.ModuleID]
    );
    const [quizzes] = await pool.query(
      'SELECT QuizID, Title, Instructions, ShowOneAtATime FROM Quizzes WHERE ModuleID = ?',
      [mod.ModuleID]
    );
    mod.materials = materials;
    mod.quizzes = quizzes;
  }

  res.json({ course, modules });
});

// POST /api/courses - create course (Instructor only)
router.post('/', authenticate, requireRole('Instructor'), async (req, res) => {
  try {
    const { courseCode, title, description } = req.body;
    if (!courseCode || !title) {
      return res.status(400).json({ error: 'Course code and title are required' });
    }
    const [result] = await pool.query(
      'INSERT INTO Courses (CourseCode, Title, Description, InstructorID) VALUES (?, ?, ?, ?)',
      [courseCode, title, description || null, req.user.userId]
    );
    res.status(201).json({ courseId: result.insertId });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Course code already in use' });
    }
    console.error(err);
    res.status(500).json({ error: 'Could not create course' });
  }
});

// PATCH /api/courses/:id/publish - toggle publish status (Instructor, owner only)
router.patch('/:id/publish', authenticate, requireRole('Instructor'), async (req, res) => {
  const course = await requireOwnedCourse(req, res, req.params.id);
  if (!course) return;

  await pool.query('UPDATE Courses SET IsPublished = ? WHERE CourseID = ?', [
    !!req.body.isPublished,
    req.params.id,
  ]);
  res.json({ message: 'Updated' });
});

// PATCH /api/courses/:id - edit course details (Instructor, owner only)
router.patch('/:id', authenticate, requireRole('Instructor'), async (req, res) => {
  const course = await requireOwnedCourse(req, res, req.params.id);
  if (!course) return;

  const title = req.body.title !== undefined ? req.body.title : course.Title;
  const description = req.body.description !== undefined ? req.body.description : course.Description;
  const courseCode = req.body.courseCode !== undefined ? req.body.courseCode : course.CourseCode;
  if (!title || !courseCode) {
    return res.status(400).json({ error: 'Course code and title cannot be empty' });
  }

  try {
    await pool.query('UPDATE Courses SET Title = ?, Description = ?, CourseCode = ? WHERE CourseID = ?', [
      title,
      description,
      courseCode,
      req.params.id,
    ]);
    res.json({ message: 'Course updated' });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Course code already in use' });
    }
    console.error(err);
    res.status(500).json({ error: 'Could not update course' });
  }
});

// DELETE /api/courses/:id - delete a course and everything under it
// (Instructor, owner only). Modules/Materials/Quizzes/Enrollments cascade via
// FK ON DELETE CASCADE in the schema, but uploaded files on disk do not
// delete themselves — clean those up first so we don't leak orphaned files.
router.delete('/:id', authenticate, requireRole('Instructor'), async (req, res) => {
  const course = await requireOwnedCourse(req, res, req.params.id);
  if (!course) return;

  try {
    const [materials] = await pool.query(
      `SELECT m.FileURL FROM Materials m
       JOIN Modules md ON m.ModuleID = md.ModuleID
       WHERE md.CourseID = ?`,
      [req.params.id]
    );
    await pool.query('DELETE FROM Courses WHERE CourseID = ?', [req.params.id]);

    const fs = require('fs');
    const path = require('path');
    for (const m of materials) {
      const filePath = path.join(__dirname, '..', m.FileURL.replace(/^\/uploads\//, 'uploads/'));
      fs.unlink(filePath, () => {}); // best-effort; don't fail the request over a missing file
    }
    res.json({ message: 'Course deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not delete course' });
  }
});

// POST /api/courses/:id/modules - add a module (Instructor, owner only)
router.post('/:id/modules', authenticate, requireRole('Instructor'), async (req, res) => {
  const course = await requireOwnedCourse(req, res, req.params.id);
  if (!course) return;

  const { moduleTitle, description, sequenceOrder } = req.body;
  if (!moduleTitle) return res.status(400).json({ error: 'Module title is required' });

  const [result] = await pool.query(
    'INSERT INTO Modules (CourseID, ModuleTitle, Description, SequenceOrder) VALUES (?, ?, ?, ?)',
    [req.params.id, moduleTitle, description || null, sequenceOrder || 0]
  );
  res.status(201).json({ moduleId: result.insertId });
});

// PATCH /api/courses/:id/modules/:moduleId - edit a module (Instructor, owner only)
router.patch('/:id/modules/:moduleId', authenticate, requireRole('Instructor'), async (req, res) => {
  const course = await requireOwnedCourse(req, res, req.params.id);
  if (!course) return;

  const [[mod]] = await pool.query('SELECT * FROM Modules WHERE ModuleID = ? AND CourseID = ?', [
    req.params.moduleId,
    req.params.id,
  ]);
  if (!mod) return res.status(404).json({ error: 'Module not found' });

  const moduleTitle = req.body.moduleTitle !== undefined ? req.body.moduleTitle : mod.ModuleTitle;
  const description = req.body.description !== undefined ? req.body.description : mod.Description;
  if (!moduleTitle) return res.status(400).json({ error: 'Module title cannot be empty' });

  await pool.query('UPDATE Modules SET ModuleTitle = ?, Description = ? WHERE ModuleID = ?', [
    moduleTitle,
    description,
    req.params.moduleId,
  ]);
  res.json({ message: 'Module updated' });
});

// DELETE /api/courses/:id/modules/:moduleId - delete a module and its
// materials/quizzes (Instructor, owner only). Cleans up uploaded files first,
// same reasoning as the course-delete route above.
router.delete('/:id/modules/:moduleId', authenticate, requireRole('Instructor'), async (req, res) => {
  const course = await requireOwnedCourse(req, res, req.params.id);
  if (!course) return;

  const [[mod]] = await pool.query('SELECT ModuleID FROM Modules WHERE ModuleID = ? AND CourseID = ?', [
    req.params.moduleId,
    req.params.id,
  ]);
  if (!mod) return res.status(404).json({ error: 'Module not found' });

  try {
    const [materials] = await pool.query('SELECT FileURL FROM Materials WHERE ModuleID = ?', [req.params.moduleId]);
    await pool.query('DELETE FROM Modules WHERE ModuleID = ?', [req.params.moduleId]);

    const fs = require('fs');
    const path = require('path');
    for (const m of materials) {
      const filePath = path.join(__dirname, '..', m.FileURL.replace(/^\/uploads\//, 'uploads/'));
      fs.unlink(filePath, () => {});
    }
    res.json({ message: 'Module deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not delete module' });
  }
});

module.exports = router;
