// Client-side IndexedDB schema (Dexie.js wrapper).
// This is the heart of the offline-first design: everything the student needs
// while disconnected lives here, independent of whether the server JWT is
// still valid (see server/middleware/auth.js for the reasoning).
const db = new Dexie('OfflineLMS');

db.version(1).stores({
  session: 'id', // single row, id='current' -> { token, user, tokenIssuedAt }
  courses: 'CourseID',
  courseDetails: 'CourseID', // full course incl. modules/materials/quizzes JSON
  downloadedMaterials: 'MaterialID, CourseID', // + blob field
  quizCache: 'QuizID, CourseID',
  pendingAttempts: '++localId, QuizID', // queued for sync, keyed locally
  syncedAttempts: 'AttemptID, QuizID', // results already confirmed by server
});

const Store = {
  async getSession() {
    return db.session.get('current');
  },
  async setSession(token, user) {
    return db.session.put({ id: 'current', token, user, tokenIssuedAt: Date.now() });
  },
  async clearSession() {
    return db.session.delete('current');
  },

  async cacheCourseList(courses) {
    return db.courses.bulkPut(courses);
  },
  async getCachedCourseList() {
    return db.courses.toArray();
  },

  async cacheCourseDetail(courseId, course, modules) {
    return db.courseDetails.put({ CourseID: courseId, course, modules, cachedAt: Date.now() });
  },
  async getCachedCourseDetail(courseId) {
    return db.courseDetails.get(Number(courseId));
  },

  async saveDownloadedMaterial(material, blob) {
    return db.downloadedMaterials.put({ ...material, blob, downloadedAt: Date.now() });
  },
  async getDownloadedMaterial(materialId) {
    return db.downloadedMaterials.get(Number(materialId));
  },
  async isMaterialDownloaded(materialId) {
    const m = await db.downloadedMaterials.get(Number(materialId));
    return !!m;
  },
  async removeDownloadedMaterial(materialId) {
    return db.downloadedMaterials.delete(Number(materialId));
  },
  async getAllDownloaded() {
    return db.downloadedMaterials.toArray();
  },
  async getStorageUsageBytes() {
    const all = await db.downloadedMaterials.toArray();
    return all.reduce((sum, m) => sum + (m.blob ? m.blob.size : 0), 0);
  },

  async cacheQuiz(quiz, questions) {
    return db.quizCache.put({ QuizID: quiz.QuizID, quiz, questions, cachedAt: Date.now() });
  },
  async getCachedQuiz(quizId) {
    return db.quizCache.get(Number(quizId));
  },

  async queueAttempt(attempt) {
    return db.pendingAttempts.add(attempt);
  },
  async getPendingAttempts() {
    return db.pendingAttempts.toArray();
  },
  async removePendingAttempt(localId) {
    return db.pendingAttempts.delete(localId);
  },
  async saveSyncedAttempt(result) {
    return db.syncedAttempts.put(result);
  },
  async getSyncedAttempts() {
    return db.syncedAttempts.toArray();
  },
};
