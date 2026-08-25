require('dotenv').config();
const app = require('./app');

// Safety net: Express 4 does not catch rejected promises thrown inside async
// route handlers automatically. Individual routes should still use try/catch
// (most do), but this prevents any one missed case from taking the whole
// server down — it logs the error and keeps serving other requests instead
// of crashing the process.
process.on('unhandledRejection', (err) => {
  console.error('Unhandled promise rejection:', err);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Offline LMS server running on http://localhost:${PORT}`));
