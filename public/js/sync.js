const SyncModule = {
  async getPendingCount() {
    const pending = await Store.getPendingAttempts();
    return pending.length;
  },

  // Pushes every queued attempt to /api/sync/quiz-attempt. Each has a
  // clientAttemptUUID so re-running this after a partial failure never
  // creates duplicate attempts server-side.
  async syncAll(onProgress) {
    const pending = await Store.getPendingAttempts();
    const results = { succeeded: 0, failed: 0, errors: [] };

    for (const attempt of pending) {
      try {
        const result = await Api.syncQuizAttempt({
          quizId: attempt.QuizID,
          clientAttemptUUID: attempt.clientAttemptUUID,
          startTime: attempt.startTime,
          endTime: attempt.endTime,
          responses: attempt.responses,
        });
        await Store.saveSyncedAttempt({
          AttemptID: result.attemptId || (result.attempt && result.attempt.AttemptID),
          QuizID: attempt.QuizID,
          score: result.score !== undefined ? result.score : result.attempt && result.attempt.Score,
          totalPoints: result.totalPoints,
          syncedAt: Date.now(),
        });
        await Store.removePendingAttempt(attempt.localId);
        results.succeeded++;
      } catch (err) {
        results.failed++;
        results.errors.push({ attempt, message: err.message });
      }
      if (onProgress) onProgress(results.succeeded + results.failed, pending.length);
    }
    return results;
  },

  async updatePendingBadge() {
    const count = await this.getPendingCount();
    const badge = document.getElementById('pending-badge');
    if (badge) {
      badge.textContent = count;
      badge.classList.toggle('hidden', count === 0);
    }
  },
};
