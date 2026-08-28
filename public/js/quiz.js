function generateClientAttemptUUID() {
  if (crypto.randomUUID) return crypto.randomUUID();

  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0'));
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10).join('')}`;
}

const QuizModule = {
  async loadQuiz(quizId) {
    if (Connectivity.isOnline) {
      try {
        const data = await Api.getQuiz(quizId);
        await Store.cacheQuiz(data.quiz, data.questions);
        return data;
      } catch (e) {
        // fall through to cache
      }
    }
    const cached = await Store.getCachedQuiz(quizId);
    if (!cached) throw new Error('This quiz has not been downloaded for offline use.');
    return { quiz: cached.quiz, questions: cached.questions };
  },

  // Saves a completed attempt locally as "pending". This happens whether the
  // student is online or offline — per the proposal's manual-sync design,
  // submission to the server only happens when the student explicitly syncs.
  async submitAttemptLocally(quizId, startTime, responses) {
    const localAttempt = {
      QuizID: Number(quizId),
      clientAttemptUUID: generateClientAttemptUUID(),
      startTime,
      endTime: new Date().toISOString(),
      responses, // [{questionId, selectedOptionId}]
    };
    await Store.queueAttempt(localAttempt);
    return localAttempt;
  },
};
