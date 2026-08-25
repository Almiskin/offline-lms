const API_BASE = '/api';

async function apiRequest(method, path, body, { isFormData = false } = {}) {
  const session = await Store.getSession();
  const headers = {};
  if (!isFormData) headers['Content-Type'] = 'application/json';
  if (session && session.token) headers['Authorization'] = `Bearer ${session.token}`;

  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: isFormData ? body : body ? JSON.stringify(body) : undefined,
    });
  } catch (networkErr) {
    const err = new Error('Network unavailable');
    err.isOffline = true;
    throw err;
  }

  let data = null;
  try {
    data = await res.json();
  } catch (_) {
    /* no body */
  }

  if (!res.ok) {
    const err = new Error((data && data.error) || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

const Api = {
  register: (payload) => apiRequest('POST', '/auth/register', payload),
  login: (payload) => apiRequest('POST', '/auth/login', payload),
  me: () => apiRequest('GET', '/auth/me'),
  forgotPassword: (email) => apiRequest('POST', '/auth/forgot-password', { email }),
  resetPassword: (token, newPassword) => apiRequest('POST', '/auth/reset-password', { token, newPassword }),

  listCourses: () => apiRequest('GET', '/courses'),
  getCourse: (id) => apiRequest('GET', `/courses/${id}`),
  enrollInCourse: (id) => apiRequest('POST', `/courses/${id}/enroll`),
  createCourse: (payload) => apiRequest('POST', '/courses', payload),
  editCourse: (id, payload) => apiRequest('PATCH', `/courses/${id}`, payload),
  deleteCourse: (id) => apiRequest('DELETE', `/courses/${id}`),
  publishCourse: (id, isPublished) => apiRequest('PATCH', `/courses/${id}/publish`, { isPublished }),
  addModule: (courseId, payload) => apiRequest('POST', `/courses/${courseId}/modules`, payload),
  editModule: (courseId, moduleId, payload) => apiRequest('PATCH', `/courses/${courseId}/modules/${moduleId}`, payload),
  deleteModule: (courseId, moduleId) => apiRequest('DELETE', `/courses/${courseId}/modules/${moduleId}`),

  uploadMaterial: (moduleId, formData) =>
    apiRequest('POST', `/materials/module/${moduleId}`, formData, { isFormData: true }),
  downloadMaterialUrl: (materialId) => `${API_BASE}/materials/${materialId}/download`,
  deleteMaterial: (materialId) => apiRequest('DELETE', `/materials/${materialId}`),

  getQuiz: (id) => apiRequest('GET', `/quizzes/${id}`),
  createQuiz: (moduleId, payload) => apiRequest('POST', `/quizzes/module/${moduleId}`, payload),
  deleteQuiz: (id) => apiRequest('DELETE', `/quizzes/${id}`),
  quizHistory: (id) => apiRequest('GET', `/quizzes/${id}/history`),

  syncQuizAttempt: (payload) => apiRequest('POST', '/sync/quiz-attempt', payload),

  myQuizHistory: () => apiRequest('GET', '/reports/my-quiz-history'),
  quizStatistics: (id) => apiRequest('GET', `/reports/quiz/${id}/statistics`),
  myCourseProgress: (courseId) => apiRequest('GET', `/reports/course/${courseId}/progress`),
  courseProgressSummary: (courseId) => apiRequest('GET', `/reports/course/${courseId}/progress-summary`),
};
