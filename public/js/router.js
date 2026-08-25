const Router = {
  routes: [],

  add(pattern, handler) {
    // pattern like '/course/:id'
    const paramNames = [];
    const regexStr = pattern.replace(/:[^/]+/g, (m) => {
      paramNames.push(m.slice(1));
      return '([^/]+)';
    });
    this.routes.push({ regex: new RegExp(`^${regexStr}$`), paramNames, handler });
  },

  async resolve() {
    const hash = window.location.hash.slice(1) || '/login';
    const [path] = hash.split('?');
    for (const route of this.routes) {
      const match = path.match(route.regex);
      if (match) {
        const params = {};
        route.paramNames.forEach((name, i) => (params[name] = match[i + 1]));
        await route.handler(params);
        return;
      }
    }
    document.getElementById('app').innerHTML = '<div class="card">Page not found.</div>';
  },

  navigate(path) {
    window.location.hash = path;
  },

  init() {
    window.addEventListener('hashchange', () => this.resolve());
  },
};
