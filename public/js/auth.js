const Auth = {
  currentUser: null,

  async init() {
    const session = await Store.getSession();
    if (session) this.currentUser = session.user;
    return this.currentUser;
  },

  async register({ firstName, lastName, email, password, role }) {
    const data = await Api.register({ firstName, lastName, email, password, role });
    await Store.setSession(data.token, data.user);
    this.currentUser = data.user;
    return data.user;
  },

  async login({ email, password }) {
    const data = await Api.login({ email, password });
    await Store.setSession(data.token, data.user);
    this.currentUser = data.user;
    return data.user;
  },

  async logout() {
    await Store.clearSession();
    this.currentUser = null;
  },

  isLoggedIn() {
    return !!this.currentUser;
  },

  isInstructor() {
    return this.currentUser && this.currentUser.role === 'Instructor';
  },
};
