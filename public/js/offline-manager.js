const OfflineManager = {
  async downloadMaterial(material) {
    const session = await Store.getSession();
    const res = await fetch(Api.downloadMaterialUrl(material.MaterialID), {
      headers: { Authorization: `Bearer ${session.token}` },
    });
    if (!res.ok) throw new Error('Download failed');
    const blob = await res.blob();
    await Store.saveDownloadedMaterial(material, blob);
    return blob;
  },

  async downloadCourseForOffline(courseId, onProgress) {
    const detail = await Api.getCourse(courseId);
    await Store.cacheCourseDetail(courseId, detail.course, detail.modules);

    const allMaterials = [];
    const allQuizzes = [];
    detail.modules.forEach((m) => {
      (m.materials || []).forEach((mat) => allMaterials.push(mat));
      (m.quizzes || []).forEach((q) => allQuizzes.push(q));
    });

    let done = 0;
    for (const mat of allMaterials) {
      await this.downloadMaterial(mat);
      done++;
      if (onProgress) onProgress(done, allMaterials.length + allQuizzes.length);
    }
    for (const q of allQuizzes) {
      const full = await Api.getQuiz(q.QuizID);
      await Store.cacheQuiz(full.quiz, full.questions);
      done++;
      if (onProgress) onProgress(done, allMaterials.length + allQuizzes.length);
    }
    return { materialsCount: allMaterials.length, quizzesCount: allQuizzes.length };
  },

  async openDownloadedMaterial(materialId) {
    const record = await Store.getDownloadedMaterial(materialId);
    if (!record) throw new Error('Not downloaded');
    const url = URL.createObjectURL(record.blob);
    window.open(url, '_blank');
  },

  async removeMaterial(materialId) {
    return Store.removeDownloadedMaterial(materialId);
  },

  async storageSummary() {
    const bytes = await Store.getStorageUsageBytes();
    let quotaInfo = { usage: bytes, quota: null };
    if (navigator.storage && navigator.storage.estimate) {
      const est = await navigator.storage.estimate();
      quotaInfo.quota = est.quota;
      quotaInfo.browserUsage = est.usage;
    }
    return quotaInfo;
  },
};

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let val = bytes;
  while (val >= 1024 && i < units.length - 1) {
    val /= 1024;
    i++;
  }
  return `${val.toFixed(1)} ${units[i]}`;
}
