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
      clientAttemptUUID: crypto.randomUUID(),
      startTime,
      endTime: new Date().toISOString(),
      responses, // [{questionId, selectedOptionId}]
    };
    await Store.queueAttempt(localAttempt);
    return localAttempt;
  },
};
