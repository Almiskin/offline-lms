process.env.NODE_ENV = 'test';

const pool = require('../db');

// Wipes all tables between test files so each file starts from a clean slate.
// Order matters because of foreign keys — children before parents.
async function resetDatabase() {
  const tables = [
    'Responses',
    'QuizAttempts',
    'MaterialViews',
    'Options',
    'Questions',
    'Quizzes',
    'Materials',
    'Modules',
    'Enrollments',
    'Courses',
    'Users',
  ];
  await pool.query('SET FOREIGN_KEY_CHECKS = 0');
  for (const t of tables) {
    await pool.query(`TRUNCATE TABLE ${t}`);
  }
  await pool.query('SET FOREIGN_KEY_CHECKS = 1');
}

async function closeDatabase() {
  await pool.end();
}

module.exports = { resetDatabase, closeDatabase, pool };
