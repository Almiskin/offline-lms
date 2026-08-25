const mysql = require('mysql2/promise');
const path = require('path');

// Tests run with NODE_ENV=test and load .env.test instead of .env, so they
// hit a separate database (learning_platform_test) and never touch dev data.
require('dotenv').config({
  path: process.env.NODE_ENV === 'test' ? path.join(__dirname, '..', '.env.test') : path.join(__dirname, '..', '.env'),
});

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'learning_platform',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

module.exports = pool;
