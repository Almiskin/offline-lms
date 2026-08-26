const appEl = () => document.getElementById('app');

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

function requireAuthOrRedirect() {
  if (!Auth.isLoggedIn()) {
    Router.navigate('/login');
    return false;
  }
  return true;
}

// Reusable modal form, used instead of prompt()/confirm() for anything
// beyond a single yes/no. Renders `fields` as labeled inputs/textareas,
// resolves with an object of {name: value} on Save, or null on Cancel/Escape.
function openFormModal({ title, fields, submitLabel = 'Save' }) {
  return new Promise((resolve) => {
    // Defensive cleanup: remove any stuck leftover modal before creating a new one
    document.querySelectorAll('.modal-overlay').forEach((el) => el.remove());

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal-box">
        <h3>${escapeHtml(title)}</h3>
        <form id="modal-form">
          ${fields
            .map(
              (f) => `
            <label for="modal-field-${f.name}">${escapeHtml(f.label)}</label>
            ${
              f.type === 'textarea'
                ? `<textarea id="modal-field-${f.name}" rows="3">${escapeHtml(f.value || '')}</textarea>`
                : `<input id="modal-field-${f.name}" type="${f.type || 'text'}" value="${escapeHtml(f.value || '')}" ${f.required ? 'required' : ''} />`
            }`
            )
            .join('')}
          <div class="modal-actions">
            <button type="button" id="modal-cancel-btn" class="btn secondary modal-cancel-btn">Cancel</button>
            <button type="submit" class="btn">${escapeHtml(submitLabel)}</button>
          </div>
        </form>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector(`#modal-field-${fields[0].name}`)?.focus();

    function close(result) {
      overlay.remove();
      document.removeEventListener('keydown', onKeydown);
      resolve(result);
    }
    function onKeydown(e) {
      if (e.key === 'Escape') close(null);
    }
    document.addEventListener('keydown', onKeydown);

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close(null);
    });
    overlay.querySelector('.modal-cancel-btn').addEventListener('click', () => close(null));
    overlay.querySelector('form').addEventListener('submit', (e) => {
      e.preventDefault();
      const result = {};
      fields.forEach((f) => {
        result[f.name] = overlay.querySelector(`#modal-field-${f.name}`).value;
      });
      close(result);
    });
  });
}

function updateNavVisibility() {
  const nav = document.getElementById('main-nav');
  const userInfo = document.getElementById('user-info');
  if (Auth.isLoggedIn()) {
    nav.classList.remove('hidden');
    userInfo.textContent = `${Auth.currentUser.firstName} (${Auth.currentUser.role})`;
  } else {
    nav.classList.add('hidden');
  }
}

// ---------- LOGIN / REGISTER ----------

function renderLogin() {
  appEl().innerHTML = `
    <div class="form-container card">
      <h2>Log in</h2>
      <div id="login-error" class="error-msg"></div>
      <form id="login-form">
        <label>Email</label>
        <input type="email" id="login-email" required />
        <label>Password</label>
        <input type="password" id="login-password" required />
        <button class="btn" type="submit" style="width:100%">Log in</button>
      </form>
      <p style="margin-top:12px;font-size:0.85rem">
        No account? <a href="#/register">Register</a> &middot;
        <a href="#/forgot-password">Forgot password?</a>
      </p>
    </div>`;

  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById('login-error');
    errorEl.textContent = '';
    try {
      await Auth.login({
        email: document.getElementById('login-email').value.trim(),
        password: document.getElementById('login-password').value,
      });
      updateNavVisibility();
      Router.navigate('/dashboard');
    } catch (err) {
      errorEl.textContent = err.isOffline
        ? 'You appear to be offline. Logging in for the first time requires an internet connection.'
        : err.message;
    }
  });
}

function renderRegister() {
  appEl().innerHTML = `
    <div class="form-container card">
      <h2>Create account</h2>
      <div id="reg-error" class="error-msg"></div>
      <form id="register-form">
        <label>First name</label><input id="reg-first" required />
        <label>Last name</label><input id="reg-last" required />
        <label>Email</label><input type="email" id="reg-email" required />
        <label>Password (min 8 chars, letters + numbers)</label>
        <input type="password" id="reg-password" required />
        <label>I am a</label>
        <select id="reg-role">
          <option value="Student">Student</option>
          <option value="Instructor">Instructor</option>
        </select>
        <button class="btn" type="submit" style="width:100%">Register</button>
      </form>
      <p style="margin-top:12px;font-size:0.85rem">Already have an account? <a href="#/login">Log in</a></p>
    </div>`;

  document.getElementById('register-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById('reg-error');
    errorEl.textContent = '';
    try {
      await Auth.register({
        firstName: document.getElementById('reg-first').value.trim(),
        lastName: document.getElementById('reg-last').value.trim(),
        email: document.getElementById('reg-email').value.trim(),
        password: document.getElementById('reg-password').value,
        role: document.getElementById('reg-role').value,
      });
      updateNavVisibility();
      Router.navigate('/dashboard');
    } catch (err) {
      errorEl.textContent = err.message;
    }
  });
}

function renderForgotPassword() {
  appEl().innerHTML = `
    <div class="form-container card">
      <h2>Reset password</h2>
      <div id="fp-msg"></div>
      <form id="fp-form">
        <label>Email</label>
        <input type="email" id="fp-email" required />
        <button class="btn" type="submit" style="width:100%">Send reset link</button>
      </form>
    </div>`;
  document.getElementById('fp-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msgEl = document.getElementById('fp-msg');
    try {
      const res = await Api.forgotPassword(document.getElementById('fp-email').value.trim());
      msgEl.innerHTML = `<p class="success-msg">${escapeHtml(res.message)}</p>`;
    } catch (err) {
      msgEl.innerHTML = `<p class="error-msg">${escapeHtml(err.message)}</p>`;
    }
  });
}

// ---------- DASHBOARD ----------

async function renderDashboard() {
  if (!requireAuthOrRedirect()) return;
  appEl().innerHTML = `<div class="card">Loading courses…</div>`;

  let courses = [];
  let source = 'server';
  if (Connectivity.isOnline) {
    try {
      const data = await Api.listCourses();
      courses = data.courses;
      await Store.cacheCourseList(courses);
    } catch (_) {
      courses = await Store.getCachedCourseList();
      source = 'cache';
    }
  } else {
    courses = await Store.getCachedCourseList();
    source = 'cache';
  }

  const createBtn = Auth.isInstructor()
    ? `<button class="btn" id="new-course-btn">+ New Course</button>`
    : '';

  appEl().innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
      <h2>Courses</h2>
      ${createBtn}
    </div>
    ${source === 'cache' && Connectivity.isOnline === false ? '<p class="tag needs-net">Showing downloaded courses only (offline)</p>' : ''}
    <div id="course-list"></div>
  `;

  const listEl = document.getElementById('course-list');
  if (courses.length === 0) {
    listEl.innerHTML = `<div class="card">No courses ${source === 'cache' ? 'downloaded yet' : 'available yet'}.</div>`;
  } else {
    listEl.innerHTML = courses
      .map((c) => {
        // Instructors always have full access to their own courses; students
        // need to enroll first (see courses.js: GET /:id enforces this).
        const needsEnroll = Auth.currentUser.role === 'Student' && !c.IsEnrolled;
        const actionHtml = needsEnroll
          ? `<button class="btn enroll-btn" data-course-id="${c.CourseID}" ${!Connectivity.isOnline ? 'disabled title="Enrolling requires an internet connection"' : ''}>Enroll</button>`
          : `<a class="btn" href="#/course/${c.CourseID}">Open</a>`;
        return `
      <div class="card">
        <h3>${escapeHtml(c.Title)} <span style="color:var(--muted);font-weight:400;font-size:0.85rem">(${escapeHtml(c.CourseCode)})</span></h3>
        <p style="color:var(--muted)">${escapeHtml(c.Description || '')}</p>
        ${actionHtml}
      </div>`;
      })
      .join('');
  }

  if (Auth.isInstructor()) {
    document.getElementById('new-course-btn').addEventListener('click', () => Router.navigate('/new-course'));
  }

  document.querySelectorAll('.enroll-btn').forEach((btn) =>
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.textContent = 'Enrolling…';
      try {
        await Api.enrollInCourse(btn.dataset.courseId);
        Router.navigate(`/course/${btn.dataset.courseId}`);
      } catch (err) {
        alert(err.message);
        btn.disabled = false;
        btn.textContent = 'Enroll';
      }
    })
  );
}

function renderNewCourse() {
  if (!requireAuthOrRedirect()) return;
  appEl().innerHTML = `
    <div class="form-container card">
      <h2>New Course</h2>
      <div id="nc-error" class="error-msg"></div>
      <form id="nc-form">
        <label>Course Code</label><input id="nc-code" required />
        <label>Title</label><input id="nc-title" required />
        <label>Description</label><textarea id="nc-desc" rows="3"></textarea>
        <button class="btn" type="submit" style="width:100%">Create</button>
      </form>
    </div>`;
  document.getElementById('nc-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const res = await Api.createCourse({
        courseCode: document.getElementById('nc-code').value.trim(),
        title: document.getElementById('nc-title').value.trim(),
        description: document.getElementById('nc-desc').value.trim(),
      });
      Router.navigate(`/course/${res.courseId}`);
    } catch (err) {
      document.getElementById('nc-error').textContent = err.message;
    }
  });
}

// ---------- COURSE DETAIL ----------

async function renderCourseDetail({ id }) {
  if (!requireAuthOrRedirect()) return;
  appEl().innerHTML = `<div class="card">Loading…</div>`;

  let course, modules, fromCache = false;
  if (Connectivity.isOnline) {
    try {
      const data = await Api.getCourse(id);
      course = data.course;
      modules = data.modules;
    } catch (err) {
      if (err.status === 403) {
        appEl().innerHTML = `
          <div class="card">
            <p>You need to enroll in this course before you can view its content.</p>
            <button class="btn" id="enroll-inline-btn">Enroll now</button>
          </div>`;
        document.getElementById('enroll-inline-btn').addEventListener('click', async () => {
          try {
            await Api.enrollInCourse(id);
            renderCourseDetail({ id });
          } catch (e) {
            alert(e.message);
          }
        });
        return;
      }
      const cached = await Store.getCachedCourseDetail(id);
      if (cached) { course = cached.course; modules = cached.modules; fromCache = true; }
    }
  } else {
    const cached = await Store.getCachedCourseDetail(id);
    if (cached) { course = cached.course; modules = cached.modules; fromCache = true; }
  }

  if (!course) {
    appEl().innerHTML = `<div class="card">This course isn't available offline yet. Connect to the internet to view it.</div>`;
    return;
  }

  const downloaded = await Store.getAllDownloaded();
  const downloadedIds = new Set(downloaded.map((d) => d.MaterialID));

  let moduleHtml = '';
  for (const mod of modules) {
    const materialsHtml = (mod.materials || [])
      .map((mat) => {
        const isDown = downloadedIds.has(mat.MaterialID);
        const instructorDeleteBtn = Auth.isInstructor()
          ? `<button class="btn danger delete-material-btn" data-id="${mat.MaterialID}" ${!Connectivity.isOnline ? 'disabled' : ''}>Delete</button>`
          : '';
        return `
        <div class="material-row" data-material='${escapeHtml(JSON.stringify(mat))}'>
          <div>
            📄 ${escapeHtml(mat.Title)}
            <span class="tag ${isDown ? 'available' : 'needs-net'}">${isDown ? 'Available offline' : 'Needs download'}</span>
          </div>
          <div>
            ${isDown ? `<button class="btn secondary open-material-btn" data-id="${mat.MaterialID}">Open</button>
                        <button class="btn danger remove-material-btn" data-id="${mat.MaterialID}">Remove</button>`
                     : `<button class="btn download-material-btn" data-id="${mat.MaterialID}" ${!Connectivity.isOnline ? 'disabled' : ''}>Download</button>`}
            ${instructorDeleteBtn}
          </div>
        </div>`;
      })
      .join('');

    const quizzesHtml = (mod.quizzes || [])
      .map((q) => `
        <div class="material-row">
          <div>📝 ${escapeHtml(q.Title)}</div>
          <div>
            ${
              Auth.isInstructor()
                ? `<a class="btn secondary" href="#/quiz-stats/${q.QuizID}">View Stats</a>
                   <button class="btn danger delete-quiz-btn" data-id="${q.QuizID}" ${!Connectivity.isOnline ? 'disabled' : ''}>Delete</button>`
                : `<a class="btn" href="#/quiz/${q.QuizID}">Take Quiz</a>`
            }
          </div>
        </div>`)
      .join('');

    const instructorModuleControls = Auth.isInstructor()
      ? `<div style="display:flex;gap:8px;margin-bottom:8px">
           <button class="btn secondary edit-module-btn" data-module-id="${mod.ModuleID}" ${!Connectivity.isOnline ? 'disabled' : ''}>Edit Module</button>
           <button class="btn danger delete-module-btn" data-module-id="${mod.ModuleID}" ${!Connectivity.isOnline ? 'disabled' : ''}>Delete Module</button>
         </div>`
      : '';

    const uploadForm = Auth.isInstructor()
      ? `${instructorModuleControls}
         <form class="upload-form" data-module-id="${mod.ModuleID}" style="margin-top:8px">
           <input type="file" accept=".pdf,.jpg,.jpeg,.png" required ${!Connectivity.isOnline ? 'disabled' : ''} />
           <button class="btn secondary" type="submit" ${!Connectivity.isOnline ? 'disabled title="Uploading requires an internet connection"' : ''}>Upload Material</button>
         </form>
         <button class="btn secondary add-quiz-btn" data-module-id="${mod.ModuleID}" style="margin-top:8px" ${!Connectivity.isOnline ? 'disabled title="Creating quizzes requires an internet connection"' : ''}>+ Add Quiz</button>`
      : '';

    moduleHtml += `
      <div class="card">
        <h3>${escapeHtml(mod.ModuleTitle)}</h3>
        <p style="color:var(--muted)">${escapeHtml(mod.Description || '')}</p>
        ${materialsHtml || '<p style="color:var(--muted)">No materials yet.</p>'}
        ${quizzesHtml}
        ${uploadForm}
      </div>`;
  }

  const addModuleBtn = Auth.isInstructor()
    ? `<button class="btn secondary" id="add-module-btn" ${!Connectivity.isOnline ? 'disabled title="Adding modules requires an internet connection"' : ''}>+ Add Module</button>`
    : '';
  const courseOwnerControls =
    Auth.isInstructor() && String(course.InstructorID) === String(Auth.currentUser.userId)
      ? `<button class="btn secondary" id="edit-course-btn" ${!Connectivity.isOnline ? 'disabled' : ''}>Edit Course</button>
         <button class="btn ${course.IsPublished ? 'secondary' : ''}" id="publish-toggle-btn" ${!Connectivity.isOnline ? 'disabled' : ''}>${course.IsPublished ? 'Unpublish' : 'Publish'}</button>
         <button class="btn danger" id="delete-course-btn" ${!Connectivity.isOnline ? 'disabled' : ''}>Delete Course</button>
         <a class="btn secondary" href="#/course-progress/${id}">View Progress Summary</a>`
      : '';

  // Progress bar: students see their own completion %, computed server-side
  // from materials viewed + quizzes attempted. Only fetched online — this is
  // a live report, not something cached for offline viewing.
  let progressHtml = '';
  if (!Auth.isInstructor() && Connectivity.isOnline) {
    try {
      const { progress } = await Api.myCourseProgress(id);
      progressHtml = `
        <div class="card">
          <p style="margin:0 0 6px 0"><strong>Your progress: ${progress.completionPercentage}%</strong>
             <span style="color:var(--muted)">(${progress.materialsViewed}/${progress.materialsTotal} materials viewed,
             ${progress.quizzesAttempted}/${progress.quizzesTotal} quizzes attempted)</span></p>
          <div class="progress-bar"><div class="progress-bar-fill" style="width:${progress.completionPercentage}%"></div></div>
        </div>`;
    } catch (_) {
      // Non-critical — just skip showing the progress bar if this fails.
    }
  }

  appEl().innerHTML = `
    <a href="#/dashboard">&larr; Back to courses</a>
    <h2>${escapeHtml(course.Title)}</h2>
    <p style="color:var(--muted)">${escapeHtml(course.Description || '')}</p>
    ${Auth.isInstructor() && !Connectivity.isOnline ? '<p class="tag needs-net">Course administration requires an internet connection.</p>' : ''}
    <div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap">
      <button class="btn" id="download-course-btn" ${!Connectivity.isOnline ? 'disabled' : ''}>⬇ Download entire course for offline</button>
      ${addModuleBtn}
      ${courseOwnerControls}
    </div>
    ${progressHtml}
    <div id="download-progress"></div>
    ${moduleHtml || '<div class="card">No modules yet.</div>'}
  `;

  if (document.getElementById('edit-course-btn')) {
    document.getElementById('edit-course-btn').addEventListener('click', async () => {
      const result = await openFormModal({
        title: 'Edit Course',
        submitLabel: 'Save Changes',
        fields: [
          { name: 'title', label: 'Course title', value: course.Title, required: true },
          { name: 'description', label: 'Description', type: 'textarea', value: course.Description || '' },
        ],
      });
      if (!result) return;
      try {
        await Api.editCourse(id, { title: result.title, description: result.description });
        renderCourseDetail({ id });
      } catch (err) {
        alert(err.message);
      }
    });
  }

  if (document.getElementById('publish-toggle-btn')) {
    document.getElementById('publish-toggle-btn').addEventListener('click', async () => {
      try {
        await Api.publishCourse(id, !course.IsPublished);
        renderCourseDetail({ id });
      } catch (err) {
        alert(err.message);
      }
    });
  }
  
  if (document.getElementById('delete-course-btn')) {
    document.getElementById('delete-course-btn').addEventListener('click', async () => {
      if (!confirm(`Delete "${course.Title}" and everything in it? This cannot be undone.`)) return;
      try {
        await Api.deleteCourse(id);
        Router.navigate('/dashboard');
      } catch (err) {
        alert(err.message);
      }
    });
  }

  document.getElementById('download-course-btn').addEventListener('click', async () => {
    const progressEl = document.getElementById('download-progress');
    progressEl.innerHTML = 'Downloading…';
    try {
      const result = await OfflineManager.downloadCourseForOffline(id, (done, total) => {
        progressEl.innerHTML = `Downloading… ${done}/${total}`;
      });
      progressEl.innerHTML = `<p class="success-msg">Downloaded ${result.materialsCount} materials and ${result.quizzesCount} quizzes for offline use.</p>`;
      renderCourseDetail({ id });
    } catch (err) {
      progressEl.innerHTML = `<p class="error-msg">${escapeHtml(err.message)}</p>`;
    }
  });

  document.querySelectorAll('.download-material-btn').forEach((btn) =>
    btn.addEventListener('click', async () => {
      const row = btn.closest('.material-row');
      const mat = JSON.parse(row.dataset.material);
      btn.disabled = true;
      btn.textContent = 'Downloading…';
      try {
        await OfflineManager.downloadMaterial(mat);
        renderCourseDetail({ id });
      } catch (err) {
        alert(err.message);
        btn.disabled = false;
        btn.textContent = 'Download';
      }
    })
  );

  document.querySelectorAll('.open-material-btn').forEach((btn) =>
    btn.addEventListener('click', () => OfflineManager.openDownloadedMaterial(Number(btn.dataset.id)))
  );

  document.querySelectorAll('.delete-material-btn').forEach((btn) =>
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this material? This cannot be undone.')) return;
      try {
        await Api.deleteMaterial(btn.dataset.id);
        await Store.removeDownloadedMaterial(Number(btn.dataset.id)); // clean up local copy too, if any
        renderCourseDetail({ id });
      } catch (err) {
        alert(err.message);
      }
    })
  );

  document.querySelectorAll('.delete-quiz-btn').forEach((btn) =>
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this quiz and all student attempts on it? This cannot be undone.')) return;
      try {
        await Api.deleteQuiz(btn.dataset.id);
        renderCourseDetail({ id });
      } catch (err) {
        alert(err.message);
      }
    })
  );

  document.querySelectorAll('.edit-module-btn').forEach((btn) =>
    btn.addEventListener('click', async () => {
      const modId = btn.dataset.moduleId;
      const mod = modules.find((m) => String(m.ModuleID) === String(modId));
      const result = await openFormModal({
        title: 'Edit Module',
        submitLabel: 'Save Changes',
        fields: [
          { name: 'moduleTitle', label: 'Module title', value: mod ? mod.ModuleTitle : '', required: true },
          { name: 'description', label: 'Description', type: 'textarea', value: mod ? mod.Description || '' : '' },
        ],
      });
      if (!result) return;
      try {
        await Api.editModule(id, modId, { moduleTitle: result.moduleTitle, description: result.description });
        renderCourseDetail({ id });
      } catch (err) {
        alert(err.message);
      }
    })
  );

  document.querySelectorAll('.delete-module-btn').forEach((btn) =>
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this module and everything in it (materials, quizzes)? This cannot be undone.')) return;
      try {
        await Api.deleteModule(id, btn.dataset.moduleId);
        renderCourseDetail({ id });
      } catch (err) {
        alert(err.message);
      }
    })
  );

  document.querySelectorAll('.remove-material-btn').forEach((btn) =>
    btn.addEventListener('click', async () => {
      await OfflineManager.removeMaterial(Number(btn.dataset.id));
      renderCourseDetail({ id });
    })
  );

  document.querySelectorAll('.upload-form').forEach((form) =>
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fileInput = form.querySelector('input[type=file]');
      const fd = new FormData();
      fd.append('file', fileInput.files[0]);
      fd.append('title', fileInput.files[0].name);
      try {
        await Api.uploadMaterial(form.dataset.moduleId, fd);
        renderCourseDetail({ id });
      } catch (err) {
        alert(err.message);
      }
    })
  );

  if (document.getElementById('add-module-btn')) {
    document.getElementById('add-module-btn').addEventListener('click', async () => {
      const result = await openFormModal({
        title: 'Add Module',
        submitLabel: 'Add Module',
        fields: [
          { name: 'moduleTitle', label: 'Module title', required: true },
          { name: 'description', label: 'Description (optional)', type: 'textarea' },
        ],
      });
      if (!result) return;
      try {
        await Api.addModule(id, { moduleTitle: result.moduleTitle, description: result.description });
        renderCourseDetail({ id });
      } catch (err) {
        alert(err.message);
      }
    });
  }

  document.querySelectorAll('.add-quiz-btn').forEach((btn) =>
    btn.addEventListener('click', () => Router.navigate(`/new-quiz/${btn.dataset.moduleId}`))
  );
}

// ---------- QUIZ CREATION (Instructor) ----------

function renderNewQuiz({ moduleId }) {
  if (!requireAuthOrRedirect()) return;
  appEl().innerHTML = `
    <div class="card">
      <h2>New Quiz</h2>
      <div id="nq-error" class="error-msg"></div>
      <label>Title</label><input id="nq-title" />
      <label>Instructions</label><textarea id="nq-instructions" rows="2"></textarea>
      <div id="questions-container"></div>
      <button class="btn secondary" id="add-question-btn" type="button">+ Add Question</button>
      <br/><br/>
      <button class="btn" id="save-quiz-btn">Save Quiz</button>
    </div>`;

  let questionCount = 0;
  function addQuestionBlock() {
    questionCount++;
    const qid = questionCount;
    const div = document.createElement('div');
    div.className = 'card';
    div.dataset.qid = qid;
    div.innerHTML = `
      <label>Question ${qid}</label>
      <input class="q-text" />
      <div class="options-container">
        ${[0, 1, 2, 3]
          .map(
            (i) => `<div style="display:flex;gap:8px;align-items:center">
              <input type="radio" name="correct-${qid}" class="opt-correct" value="${i}" />
              <input class="opt-text" placeholder="Option ${i + 1}" style="flex:1" />
            </div>`
          )
          .join('')}
      </div>
      <button class="btn secondary add-option-btn" type="button">+ Add Option</button>`;
    document.getElementById('questions-container').appendChild(div);
  }
  addQuestionBlock();

  document.getElementById('add-question-btn').addEventListener('click', addQuestionBlock);
  document.getElementById('questions-container').addEventListener('click', (e) => {
    const addOptionBtn = e.target.closest('.add-option-btn');
    if (!addOptionBtn) return;

    const questionBlock = addOptionBtn.closest('[data-qid]');
    const optionsContainer = questionBlock.querySelector('.options-container');
    const optionIndex = optionsContainer.querySelectorAll('.opt-text').length;
    const optionRow = document.createElement('div');
    optionRow.style.cssText = 'display:flex;gap:8px;align-items:center';
    optionRow.innerHTML = `
      <input type="radio" name="correct-${questionBlock.dataset.qid}" class="opt-correct" value="${optionIndex}" />
      <input class="opt-text" placeholder="Option ${optionIndex + 1}" style="flex:1" />`;
    optionsContainer.appendChild(optionRow);
  });

  document.getElementById('save-quiz-btn').addEventListener('click', async () => {
    const errorEl = document.getElementById('nq-error');
    errorEl.textContent = '';
    const questionBlocks = document.querySelectorAll('#questions-container > div');
    const questions = [];
    for (const block of questionBlocks) {
      const questionText = block.querySelector('.q-text').value.trim();
      const optionInputs = block.querySelectorAll('.opt-text');
      const correctRadio = block.querySelector('.opt-correct:checked');
      const options = Array.from(optionInputs)
        .map((inp, i) => ({ optionText: inp.value.trim(), isCorrect: correctRadio && Number(correctRadio.value) === i }))
        .filter((o) => o.optionText);
      if (questionText && options.length >= 2) {
        questions.push({ questionText, options });
      }
    }
    try {
      await Api.createQuiz(moduleId, {
        title: document.getElementById('nq-title').value.trim(),
        instructions: document.getElementById('nq-instructions').value.trim(),
        showOneAtATime: false,
        questions,
      });
      history.back();
    } catch (err) {
      errorEl.textContent = err.message;
    }
  });
}

// ---------- QUIZ TAKING ----------

async function renderQuizTaking({ id }) {
  if (!requireAuthOrRedirect()) return;
  appEl().innerHTML = `<div class="card">Loading quiz…</div>`;

  let data;
  try {
    data = await QuizModule.loadQuiz(id);
  } catch (err) {
    appEl().innerHTML = `<div class="card error-msg">${escapeHtml(err.message)}</div>`;
    return;
  }

  const { quiz, questions } = data;
  const startTime = new Date().toISOString();
  const answers = {}; // questionId -> optionId

  function renderQuestions() {
    return questions
      .map(
        (q) => `
      <div class="card">
        <p><strong>${escapeHtml(q.QuestionText)}</strong></p>
        ${(q.options || [])
          .map(
            (o) => `
          <div class="quiz-option ${answers[q.QuestionID] === o.OptionID ? 'selected' : ''}"
               data-question="${q.QuestionID}" data-option="${o.OptionID}">
            ${escapeHtml(o.OptionText)}
          </div>`
          )
          .join('')}
      </div>`
      )
      .join('');
  }

  appEl().innerHTML = `
    <h2>${escapeHtml(quiz.Title)}</h2>
    <p style="color:var(--muted)">${escapeHtml(quiz.Instructions || '')}</p>
    ${!Connectivity.isOnline ? '<p class="tag needs-net">Offline — your answers will be saved locally and synced later.</p>' : ''}
    <div id="quiz-questions">${renderQuestions()}</div>
    <button class="btn" id="submit-quiz-btn">Submit Quiz</button>
  `;

  function wireOptionClicks() {
    document.querySelectorAll('.quiz-option').forEach((opt) =>
      opt.addEventListener('click', () => {
        answers[Number(opt.dataset.question)] = Number(opt.dataset.option);
        document.getElementById('quiz-questions').innerHTML = renderQuestions();
        wireOptionClicks();
      })
    );
  }
  wireOptionClicks();

  document.getElementById('submit-quiz-btn').addEventListener('click', async () => {
    const responses = questions.map((q) => ({
      questionId: q.QuestionID,
      selectedOptionId: answers[q.QuestionID] || null,
    }));
    const unanswered = responses.filter((r) => r.selectedOptionId === null).length;
    if (unanswered > 0 && !confirm(`${unanswered} question(s) unanswered. Submit anyway?`)) return;

    await QuizModule.submitAttemptLocally(id, startTime, responses);
    await SyncModule.updatePendingBadge();

    appEl().innerHTML = `
      <div class="card">
        <h2>Quiz saved</h2>
        <p>Your answers have been saved on this device. ${Connectivity.isOnline
          ? 'You are online — head to the Sync page to submit and see your score.'
          : 'They will be submitted automatically once you sync while online.'}</p>
        <a class="btn" href="#/sync">Go to Sync</a>
        <a class="btn secondary" href="#/dashboard">Back to Courses</a>
      </div>`;
  });
}

// ---------- SYNC PAGE ----------

async function renderSyncPage() {
  if (!requireAuthOrRedirect()) return;
  const pending = await Store.getPendingAttempts();

  appEl().innerHTML = `
    <h2>Synchronization</h2>
    <div class="card">
      <p>${pending.length} item(s) waiting to sync.</p>
      <button class="btn" id="sync-now-btn" ${!Connectivity.isOnline ? 'disabled' : ''}>
        ${Connectivity.isOnline ? 'Sync Now' : 'Offline — connect to sync'}
      </button>
      <div id="sync-progress"></div>
    </div>
    <div id="sync-list">
      ${pending
        .map(
          (a) => `<div class="card">Quiz #${a.QuizID} attempt — <span class="tag pending">Pending</span></div>`
        )
        .join('')}
    </div>
  `;

  const btn = document.getElementById('sync-now-btn');
  if (btn) {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      const progressEl = document.getElementById('sync-progress');
      const result = await SyncModule.syncAll((done, total) => {
        progressEl.textContent = `Syncing ${done}/${total}…`;
      });
      progressEl.innerHTML = `<p class="success-msg">${result.succeeded} synced successfully.${
        result.failed ? ` ${result.failed} failed — will retry next sync.` : ''
      }</p>`;
      await SyncModule.updatePendingBadge();
      renderSyncPage();
    });
  }
}

// ---------- REPORTS ----------

async function renderReports() {
  if (!requireAuthOrRedirect()) return;
  appEl().innerHTML = `<div class="card">Loading results…</div>`;
  const { serverHistory, pending } = await ReportsModule.myHistoryCombined();

  appEl().innerHTML = `
    <h2>My Quiz Results</h2>
    ${pending.length ? `<p class="tag pending">${pending.length} attempt(s) not yet synced</p>` : ''}
    ${
      serverHistory.length === 0
        ? '<div class="card">No synced results yet.</div>'
        : serverHistory
            .map(
              (h) => `
        <div class="card">
          <strong>${escapeHtml(h.QuizTitle)}</strong>
          <div class="progress-bar"><div class="progress-bar-fill" style="width:${h.Score}%"></div></div>
          <p>${Number(h.Score).toFixed(1)}% &middot; ${new Date(h.StartTime).toLocaleDateString()}</p>
        </div>`
            )
            .join('')
    }
  `;
}

// ---------- INSTRUCTOR QUIZ STATISTICS ----------

let statsChartInstance = null;

async function renderQuizStats({ id }) {
  if (!requireAuthOrRedirect()) return;
  if (!Auth.isInstructor()) {
    appEl().innerHTML = `<div class="card error-msg">Instructor access only.</div>`;
    return;
  }
  appEl().innerHTML = `<div class="card">Loading statistics…</div>`;

  if (!Connectivity.isOnline) {
    appEl().innerHTML = `<div class="card">Quiz statistics require an internet connection (they're computed live from synced results).</div>`;
    return;
  }

  let data;
  try {
    data = await Api.quizStatistics(id);
  } catch (err) {
    appEl().innerHTML = `<div class="card error-msg">${escapeHtml(err.message)}</div>`;
    return;
  }

  const { stats, scores, distribution } = data;

  appEl().innerHTML = `
    <a href="#/dashboard">&larr; Back to courses</a>
    <h2>Quiz Statistics</h2>
    <div class="card">
      <p><strong>${stats.attemptCount}</strong> attempt(s) &middot;
         Avg: <strong>${stats.avgScore ? Number(stats.avgScore).toFixed(1) : '—'}%</strong> &middot;
         High: <strong>${stats.maxScore ?? '—'}%</strong> &middot;
         Low: <strong>${stats.minScore ?? '—'}%</strong></p>
    </div>
    <div class="card">
      <h3>Score Distribution</h3>
      <canvas id="distribution-chart" height="120"></canvas>
    </div>
    <div class="card">
      <h3>Student Scores</h3>
      ${
        scores.length === 0
          ? '<p>No synced attempts yet.</p>'
          : `<table style="width:100%;border-collapse:collapse">
              <thead><tr style="text-align:left;border-bottom:1px solid var(--border)">
                <th style="padding:6px 0">Student</th><th>Score</th><th>Date</th>
              </tr></thead>
              <tbody>
                ${scores
                  .map(
                    (s) => `<tr style="border-bottom:1px solid var(--border)">
                      <td style="padding:6px 0">${escapeHtml(s.FirstName)} ${escapeHtml(s.LastName)}</td>
                      <td>${Number(s.Score).toFixed(1)}%</td>
                      <td>${new Date(s.StartTime).toLocaleDateString()}</td>
                    </tr>`
                  )
                  .join('')}
              </tbody>
            </table>`
      }
    </div>
  `;

  if (statsChartInstance) {
    statsChartInstance.destroy();
    statsChartInstance = null;
  }
  const ctx = document.getElementById('distribution-chart');
  if (ctx && window.Chart) {
    statsChartInstance = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: ['0-49%', '50-69%', '70-89%', '90-100%'],
        datasets: [
          {
            label: 'Students',
            data: [distribution['0-49'], distribution['50-69'], distribution['70-89'], distribution['90-100']],
            backgroundColor: ['#dc2626', '#d97706', '#2563eb', '#16a34a'],
          },
        ],
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } },
      },
    });
  }
}

// ---------- INSTRUCTOR COURSE PROGRESS SUMMARY ----------

async function renderCourseProgress({ id }) {
  if (!requireAuthOrRedirect()) return;
  if (!Auth.isInstructor()) {
    appEl().innerHTML = `<div class="card error-msg">Instructor access only.</div>`;
    return;
  }
  appEl().innerHTML = `<div class="card">Loading progress summary…</div>`;

  if (!Connectivity.isOnline) {
    appEl().innerHTML = `<div class="card">Progress summaries require an internet connection.</div>`;
    return;
  }

  let summary;
  try {
    const data = await Api.courseProgressSummary(id);
    summary = data.summary;
  } catch (err) {
    appEl().innerHTML = `<div class="card error-msg">${escapeHtml(err.message)}</div>`;
    return;
  }

  appEl().innerHTML = `
    <a href="#/course/${id}">&larr; Back to course</a>
    <h2>Course Progress Summary</h2>
    ${
      summary.length === 0
        ? '<div class="card">No students enrolled yet.</div>'
        : summary
            .map(
              (s) => `
        <div class="card">
          <p style="margin:0 0 6px 0"><strong>${escapeHtml(s.firstName)} ${escapeHtml(s.lastName)}</strong>
             <span style="color:var(--muted)"> — ${s.completionPercentage}% complete</span></p>
          <div class="progress-bar"><div class="progress-bar-fill" style="width:${s.completionPercentage}%"></div></div>
          <p style="color:var(--muted);margin:6px 0 0 0;font-size:0.85rem">
            ${s.materialsViewed}/${s.materialsTotal} materials viewed &middot;
            ${s.quizzesAttempted}/${s.quizzesTotal} quizzes attempted &middot;
            Enrolled ${new Date(s.enrollmentDate).toLocaleDateString()}
            ${s.lastAccessedDate ? `&middot; Last active ${new Date(s.lastAccessedDate).toLocaleDateString()}` : ''}
          </p>
        </div>`
            )
            .join('')
    }
  `;
}

// ---------- ROUTES ----------

Router.add('/login', renderLogin);
Router.add('/register', renderRegister);
Router.add('/forgot-password', renderForgotPassword);
Router.add('/dashboard', renderDashboard);
Router.add('/new-course', renderNewCourse);
Router.add('/course/:id', renderCourseDetail);
Router.add('/new-quiz/:moduleId', renderNewQuiz);
Router.add('/quiz/:id', renderQuizTaking);
Router.add('/quiz-stats/:id', renderQuizStats);
Router.add('/course-progress/:id', renderCourseProgress);
Router.add('/sync', renderSyncPage);
Router.add('/reports', renderReports);

// ---------- BOOTSTRAP ----------

document.getElementById('logout-btn').addEventListener('click', async () => {
  await Auth.logout();
  updateNavVisibility();
  Router.navigate('/login');
});

Connectivity.onChange(async (isOnline) => {
  updateNavVisibility();
  if (isOnline && Auth.isLoggedIn() && Auth.currentUser.role === 'Student') {
    try {
      await SyncModule.syncAll();
      await SyncModule.updatePendingBadge();
    } catch (_) {
      // Keep attempts queued; the manual Sync page can retry later.
    }
  }
});

(async function bootstrap() {
  Router.init();
  Connectivity.init();
  await Auth.init();
  updateNavVisibility();
  await SyncModule.updatePendingBadge();

  if (!window.location.hash) {
    window.location.hash = Auth.isLoggedIn() ? '#/dashboard' : '#/login';
  }
  Router.resolve();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/service-worker.js').catch((err) => console.error('SW registration failed', err));
  }
})();
