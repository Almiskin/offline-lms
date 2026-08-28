// Client-side IndexedDB schema (Dexie.js wrapper).
// This is the heart of the offline-first design: everything the student needs
// while disconnected lives here, independent of whether the server JWT is
// still valid (see server/middleware/auth.js for the reasoning).
const db = new Dexie('OfflineLMS-v2');

db.version(1).stores({
  session: 'id', // single row, id='current' -> { token, user, tokenIssuedAt }
  courses: '[userId+CourseID], userId, CourseID',
  courseDetails: '[userId+CourseID], userId, CourseID', // full course incl. modules/materials/quizzes JSON
  downloadedMaterials: '[userId+MaterialID], userId, MaterialID, CourseID', // + blob field
  quizCache: '[userId+QuizID], userId, QuizID, CourseID',
  pendingAttempts: '++localId, userId, QuizID', // queued for sync, keyed locally
  syncedAttempts: '[userId+AttemptID], userId, AttemptID, QuizID', // results already confirmed by server
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

  async getCurrentUserId() {
    const session = await this.getSession();
    return session && session.user ? session.user.userId : null;
  },

  async cacheCourseList(courses) {
    const userId = await this.getCurrentUserId();
    if (userId == null) return;
    return db.courses.bulkPut(courses.map((course) => ({ ...course, userId, CourseID: Number(course.CourseID) })));
  },
  async getCachedCourseList() {
    const userId = await this.getCurrentUserId();
    if (userId == null) return [];
    return db.courses.where('userId').equals(userId).toArray();
  },

  async cacheCourseDetail(courseId, course, modules) {
    const userId = await this.getCurrentUserId();
    if (userId == null) return;
    return db.courseDetails.put({ userId, CourseID: Number(courseId), course, modules, cachedAt: Date.now() });
  },
  async getCachedCourseDetail(courseId) {
    const userId = await this.getCurrentUserId();
    if (userId == null) return undefined;
    return db.courseDetails.get([userId, Number(courseId)]);
  },

  async saveDownloadedMaterial(material, blob) {
    const userId = await this.getCurrentUserId();
    if (userId == null) return;
    return db.downloadedMaterials.put({ ...material, userId, MaterialID: Number(material.MaterialID), blob, downloadedAt: Date.now() });
  },
  async getDownloadedMaterial(materialId) {
    const userId = await this.getCurrentUserId();
    if (userId == null) return undefined;
    return db.downloadedMaterials.get([userId, Number(materialId)]);
  },
  async isMaterialDownloaded(materialId) {
    const m = await this.getDownloadedMaterial(materialId);
    return !!m;
  },
  async removeDownloadedMaterial(materialId) {
    const userId = await this.getCurrentUserId();
    if (userId == null) return;
    return db.downloadedMaterials.delete([userId, Number(materialId)]);
  },
  async getAllDownloaded() {
    const userId = await this.getCurrentUserId();
    if (userId == null) return [];
    return db.downloadedMaterials.where('userId').equals(userId).toArray();
  },
  async getStorageUsageBytes() {
    const all = await this.getAllDownloaded();
    return all.reduce((sum, m) => sum + (m.blob ? m.blob.size : 0), 0);
  },

  async cacheQuiz(quiz, questions) {
    const userId = await this.getCurrentUserId();
    if (userId == null) return;
    return db.quizCache.put({ userId, QuizID: Number(quiz.QuizID), CourseID: quiz.CourseID, quiz, questions, cachedAt: Date.now() });
  },
  async getCachedQuiz(quizId) {
    const userId = await this.getCurrentUserId();
    if (userId == null) return undefined;
    return db.quizCache.get([userId, Number(quizId)]);
  },

  async queueAttempt(attempt) {
    const userId = await this.getCurrentUserId();
    if (userId == null) return;
    return db.pendingAttempts.add({ ...attempt, userId });
  },
  async getPendingAttempts() {
    const userId = await this.getCurrentUserId();
    if (userId == null) return [];
    return db.pendingAttempts.where('userId').equals(userId).toArray();
  },
  async removePendingAttempt(localId) {
    return db.pendingAttempts.delete(localId);
  },
  async saveSyncedAttempt(result) {
    const userId = await this.getCurrentUserId();
    if (userId == null) return;
    return db.syncedAttempts.put({ ...result, userId, AttemptID: Number(result.AttemptID) });
  },
  async getSyncedAttempts() {
    const userId = await this.getCurrentUserId();
    if (userId == null) return [];
    return db.syncedAttempts.where('userId').equals(userId).toArray();
  },
};
