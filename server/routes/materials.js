const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const pool = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const ALLOWED_MIME = {
  'application/pdf': 'Document',
  'image/jpeg': 'Image',
  'image/png': 'Image',
};

const MAX_FILE_SIZE = (parseInt(process.env.MAX_FILE_SIZE_MB, 10) || 50) * 1024 * 1024;

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `${unique}${path.extname(file.originalname)}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME[file.mimetype]) {
      return cb(new Error('Only PDF, JPEG, and PNG files are allowed'));
    }
    cb(null, true);
  },
});

// POST /api/materials/module/:moduleId - upload material (Instructor, owner only)
router.post(
  '/module/:moduleId',
  authenticate,
  requireRole('Instructor'),
  (req, res) => {
    upload.single('file')(req, res, async (err) => {
      if (err) return res.status(400).json({ error: err.message });
      try {
        const [[mod]] = await pool.query(
          `SELECT m.ModuleID, c.InstructorID FROM Modules m
           JOIN Courses c ON m.CourseID = c.CourseID WHERE m.ModuleID = ?`,
          [req.params.moduleId]
        );
        if (!mod) return res.status(404).json({ error: 'Module not found' });
        if (mod.InstructorID !== req.user.userId) {
          fs.unlinkSync(req.file.path);
          return res.status(403).json({ error: 'Not your course' });
        }
        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

        const materialType = ALLOWED_MIME[req.file.mimetype];
        const { title, sequenceOrder } = req.body;

        const [result] = await pool.query(
          `INSERT INTO Materials (ModuleID, Title, MaterialType, FileURL, FileSize, MimeType, SequenceOrder)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            req.params.moduleId,
            title || req.file.originalname,
            materialType,
            `/uploads/${req.file.filename}`,
            req.file.size,
            req.file.mimetype,
            sequenceOrder || 0,
          ]
        );
        res.status(201).json({ materialId: result.insertId, fileURL: `/uploads/${req.file.filename}` });
      } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Upload failed' });
      }
    });
  }
);

// GET /api/materials/:id/download - stream file (used for offline download-to-IndexedDB).
// Also records a MaterialViews row for students — this is what the Course
// Progress Summary report counts as "viewed". Recorded here rather than a
// separate endpoint because downloading IS how a student accesses content in
// this offline-first design; there's no other "view" action to distinguish.
router.get('/:id/download', authenticate, async (req, res) => {
  const [[material]] = await pool.query(
    `SELECT mat.*, c.CourseID, c.InstructorID
     FROM Materials mat
     JOIN Modules m ON mat.ModuleID = m.ModuleID
     JOIN Courses c ON m.CourseID = c.CourseID
     WHERE mat.MaterialID = ?`,
    [req.params.id]
  );
  if (!material) return res.status(404).json({ error: 'Material not found' });

  if (req.user.role === 'Student') {
    const [[enrollment]] = await pool.query(
      'SELECT EnrollmentID FROM Enrollments WHERE StudentID = ? AND CourseID = ?',
      [req.user.userId, material.CourseID]
    );
    if (!enrollment) {
      return res.status(403).json({ error: 'Enroll in this course to download its materials', requiresEnrollment: true });
    }
  } else if (req.user.role === 'Instructor') {
    if (String(material.InstructorID) !== String(req.user.userId)) {
      return res.status(403).json({ error: 'Not your course' });
    }
  } else {
    return res.status(403).json({ error: 'Insufficient permissions' });
  }

  const filePath = path.join(__dirname, '..', material.FileURL.replace(/^\/uploads\//, 'uploads/'));
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File missing on server' });

  if (req.user.role === 'Student') {
    try {
      await pool.query('INSERT IGNORE INTO MaterialViews (StudentID, MaterialID) VALUES (?, ?)', [
        req.user.userId,
        req.params.id,
      ]);
    } catch (err) {
      // Don't let a progress-tracking write failure block the actual download.
      console.error('[progress] Failed to record material view:', err.message);
    }
  }

  res.setHeader('Content-Type', material.MimeType);
  res.setHeader('Content-Disposition', `attachment; filename="${material.Title}"`);
  res.sendFile(filePath);
});

// DELETE /api/materials/:id - remove a material (Instructor, owner only).
// Deletes the DB row and the uploaded file on disk.
router.delete('/:id', authenticate, requireRole('Instructor'), async (req, res) => {
  const [[material]] = await pool.query(
    `SELECT mat.*, c.InstructorID FROM Materials mat
     JOIN Modules md ON mat.ModuleID = md.ModuleID
     JOIN Courses c ON md.CourseID = c.CourseID
     WHERE mat.MaterialID = ?`,
    [req.params.id]
  );
  if (!material) return res.status(404).json({ error: 'Material not found' });
  if (material.InstructorID !== req.user.userId) return res.status(403).json({ error: 'Not your course' });

  try {
    await pool.query('DELETE FROM Materials WHERE MaterialID = ?', [req.params.id]);
    const filePath = path.join(__dirname, '..', material.FileURL.replace(/^\/uploads\//, 'uploads/'));
    fs.unlink(filePath, () => {}); // best-effort cleanup
    res.json({ message: 'Material deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not delete material' });
  }
});

module.exports = router;
