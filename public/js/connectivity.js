// Tracks online/offline state. navigator.onLine is a starting signal but is
// unreliable (it can be true while the server is actually unreachable), so we
// back it up with a lightweight health-check ping whenever the browser thinks
// we're online.
const Connectivity = {
  isOnline: navigator.onLine,
  listeners: [],

  onChange(fn) {
    this.listeners.push(fn);
  },

  notify() {
    this.listeners.forEach((fn) => fn(this.isOnline));
  },

  async verify() {
    if (!navigator.onLine) {
      this.setStatus(false);
      return false;
    }
    try {
      const res = await fetch('/api/health', { cache: 'no-store' });
      this.setStatus(res.ok);
      return res.ok;
    } catch {
      this.setStatus(false);
      return false;
    }
  },

  setStatus(online) {
    const changed = this.isOnline !== online;
    this.isOnline = online;
    this.updateUI();
    if (changed) this.notify();
  },

  updateUI() {
    const dot = document.getElementById('connectivity-status');
    const banner = document.getElementById('offline-banner');
    if (dot) {
      dot.classList.toggle('online', this.isOnline);
      dot.classList.toggle('offline', !this.isOnline);
      dot.title = this.isOnline ? 'Online' : 'Offline';
    }
    if (banner) banner.classList.toggle('hidden', this.isOnline);
  },

  init() {
    window.addEventListener('online', () => this.verify());
    window.addEventListener('offline', () => this.setStatus(false));
    this.verify();
    setInterval(() => this.verify(), 15000);
  },
};
