# Offline-Compatible Learning Platform

A Progressive Web App for low-connectivity learning environments, built per
the project proposal: students browse courses, download materials and quizzes
for offline use, take quizzes without a connection, and sync results manually
or automatically after reconnecting.

Tested end-to-end in this build environment: registration, login, course
creation, module creation, file upload, quiz creation, enrollment enforcement,
offline-attempt sync with server-side scoring, idempotent re-sync, both
report endpoints, the instructor score-distribution chart, and the full
password-reset flow (token issuance, single-use enforcement, old/new password
behavior) — all verified working against a live MySQL-compatible database.

## Documentation

Full supporting documentation for examination submission is in `docs/`:
- `System_Documentation.docx` \u2014 architecture, database design, full API reference, security measures, offline-sync design rationale, and key design decisions
- `User_Manual.docx` \u2014 step-by-step Student and Instructor guides
- `Test_Report.docx` \u2014 automated test suite summary, detailed coverage, manual/integration testing evidence, and defects found and fixed during development
- `Defect_Log.md` \u2014 final source-code security/correctness audit addendum and regression-testing record

## Stack

- **Backend:** Node.js, Express, MySQL (mysql2), bcrypt, JWT, multer
- **Frontend:** Vanilla JS (ES6), Dexie.js (IndexedDB wrapper), Service Worker
- No frontend framework/build step — matches the proposal's tech stack exactly

## Setup

1. **Install MySQL** (or MariaDB) and create the schema:
   ```
   mysql -u root -p < server/schema.sql
   ```

2. **Configure environment:**
   ```
   cp .env.example .env
   # edit .env: set DB_PASSWORD and a real JWT_SECRET
   # optionally set SMTP_HOST/SMTP_USER/SMTP_PASS for real password-reset emails;
   # leave blank to use the automatic Ethereal test-inbox fallback
   ```
  For tests, copy `.env.test.example` to `.env.test` and set the local
  `DB_PASSWORD`. The `.env.test` file is ignored and must not be committed.

3. **Install and run:**
   ```
   npm install
   npm start
   ```
   Visit `http://localhost:3000`. Register an Instructor account first to
   create courses; register a Student account to browse/download/take quizzes.

4. **Test offline mode:** In Chrome DevTools → Application → Service Workers,
   check "Offline", or use the Network tab's offline toggle. Download a course
   first while online, then go offline and confirm materials still open and
   quizzes can still be taken. Reconnect and use the Sync page.

## Design decisions worth knowing about (see also the flags raised alongside this build)

- **Token expiry vs. offline access:** the JWT still expires after 24h as
  specified, but expiry is only checked on *server* API calls. Content
  already downloaded into IndexedDB opens with no server round-trip at all,
  so an expired token never blocks access to previously-downloaded material —
  only a fresh sync or new download requires logging in again.
- **Scores are always recomputed server-side** from the stored correct
  answers when a quiz attempt syncs. The client's local tally is never
  trusted, since an offline device is an easy place to tamper with a
  locally-cached score.
- **Idempotent sync:** each locally-queued attempt carries a client-generated
  UUID. Re-submitting the same UUID (e.g., after a dropped connection mid-sync)
  returns the original result instead of creating a duplicate attempt.
- **Administrator role** appears in the original comprehensive doc's schema
  but not in the functional requirements — left out of this build. Add it
  back deliberately if you decide you need a third permission tier.
- **Enrollment** is self-serve: any student can `POST /api/courses/:id/enroll`
  in any published course, and viewing a course's content requires that
  enrollment first (instructors always have access to their own courses).
  Swap in an approval step if you need gated access instead.
- **Login rate limiting** is per-IP (10 failed attempts / 15 min on `/login`,
  looser caps on register/forgot-password). That means a shared network —
  a school computer lab behind one NAT IP, for instance — shares the limit
  across everyone on it. Switch to a per-account counter if that's a problem
  for your deployment.
- **Score-distribution chart** lives on a new instructor-only "View Stats"
  page per quiz (Chart.js, vendored locally so the service worker still
  caches it for offline app-shell loading).

## Automated tests

```
npm test
```

Runs 78 tests across 9 files (Jest + Supertest, plus jsdom-based frontend
tests) against a dedicated `learning_platform_test` database (never touches
your dev data):

- `server/tests/auth.test.js` — registration validation, login, password
  reset including single-use token enforcement
- `server/tests/courses.test.js` — course/module creation, ownership checks,
  enrollment enforcement
- `server/tests/editDelete.test.js` — edit and delete for courses, modules,
  materials (including verifying the uploaded file is actually removed from
  disk, not just the DB row), and quizzes
- `server/tests/materials.test.js` — file upload validation (allowed types,
  size, ownership)
- `server/tests/progress.test.js` — Course Progress Summary calculation
  (materials viewed + quizzes attempted), including edge cases like viewing
  the same material twice not double-counting
- `server/tests/quiz.test.js` — quiz creation validation, server-side scoring
  (ignores whatever the client claims), idempotent offline-sync, and
  statistics access control
- `server/tests/rateLimit.test.js` — verifies the rate-limiting mechanism
  itself, isolated from the main suite
- `public/js/tests/modal.test.js` — the reusable modal form component
  (rendering, submit/cancel/backdrop-click, XSS-safety of injected values),
  run in a real jsdom environment rather than just syntax-checked
- `public/js/tests/quiz-ui.test.js` — quiz display-mode selection, one-at-a-time
  navigation, answer preservation, and final submission behavior

Before running for the first time, create the test database:
```
mysql -u root -p -e "CREATE DATABASE learning_platform_test;"
tail -n +6 server/schema.sql | mysql -u root -p learning_platform_test
```
Then copy `.env.test.example` to `.env.test`, set its local `DB_PASSWORD`, and
adjust its other `DB_*` values to match your MySQL setup. The generated
`.env.test` file is ignored by Git.

A GitHub Actions workflow (`.github/workflows/test.yml`) runs this same suite
automatically on every push/PR, spinning up a throwaway MySQL service
container — no setup needed on your end beyond pushing to GitHub.

## Course Progress Summary

Added per the proposal's §5.4(f): students see a live progress bar on each
course page (% complete = materials viewed + quizzes attempted, out of the
total). Instructors get a per-course "View Progress Summary" page listing
every enrolled student's completion %, materials/quizzes breakdown,
enrollment date, and last-active date. Verified with dedicated tests
covering the 0%/50%/100% cases and that re-viewing the same material doesn't
inflate the count.

## Known gaps / next steps (out of scope for this pass)

- If you deploy for real, replace the Ethereal fallback with real SMTP
  credentials (Gmail, SendGrid, your institution's mail server, etc.) — the
  Ethereal path is dev/demo-only and doesn't deliver anywhere real.
- Quizzes are delete-and-recreate only, deliberately: once a quiz might have
  student attempts, editing its questions in place would silently invalidate
  those students' scores. If you need in-place quiz editing, you'd want to
  version quizzes or block edits only after the first attempt is recorded.
