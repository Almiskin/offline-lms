const ReportsModule = {
  async myHistoryCombined() {
    // Merges server-confirmed history with any locally-synced-but-not-yet-refreshed
    // results, and shows still-pending attempts separately.
    let serverHistory = [];
    if (Connectivity.isOnline) {
      try {
        const data = await Api.myQuizHistory();
        serverHistory = data.history;
      } catch (_) {
        /* fall back to local */
      }
    }
    const pending = await Store.getPendingAttempts();
    return { serverHistory, pending };
  },
};
