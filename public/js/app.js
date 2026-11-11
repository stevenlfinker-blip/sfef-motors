// ── Toast ──────────────────────────────────────────
const Toast = {
  show(msg, type = 'success') {
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = msg;
    document.getElementById('toast-container').appendChild(el);
    setTimeout(() => el.remove(), 3200);
  }
};

// ── Modal ──────────────────────────────────────────
const Modal = {
  _onSubmit: null,
  show(title, html, onSubmit, opts = {}) {
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-body').innerHTML = html;
    document.getElementById('modal-overlay').classList.remove('hidden');
    this._onSubmit = onSubmit;
    const submitBtn = document.getElementById('modal-submit');
    submitBtn.textContent = opts.submitLabel || 'Save';
    submitBtn.onclick = () => onSubmit();
    if (opts.hideFooter) document.getElementById('modal-footer').style.display = 'none';
    else document.getElementById('modal-footer').style.display = '';
    // Focus first input
    setTimeout(() => {
      const first = document.querySelector('#modal-body input, #modal-body select, #modal-body textarea');
      if (first) first.focus();
    }, 50);
  },
  hide() {
    document.getElementById('modal-overlay').classList.add('hidden');
    document.getElementById('modal-body').innerHTML = '';
    this._onSubmit = null;
  }
};
// Close modal on overlay click
document.getElementById('modal-overlay').addEventListener('click', e => {
  if (e.target === document.getElementById('modal-overlay')) Modal.hide();
});

// ── Navigation ─────────────────────────────────────
const SECTION_TITLES = {
  dashboard:   'Dashboard',
  watchlist:   'Acquisition Watchlist',
  drive:       'Driving Conditions',
  cars:        'Fleet · Cars',
  maintenance: 'Fleet · Maintenance',
  market:      'Fleet · Market Analytics',
  parts:       'Inventory · Parts',
  tools:       'Inventory · Tools',
  cleaning:    'Inventory · Cleaning',
  other:       'Inventory · Other',
  expenses:    'Finances · Expenses',
  events:      'Schedule · Events',
  chat:        'Team · Chat',
  team:        'Team · Members',
};

const App = {
  currentSection: 'dashboard',
  me: null, // { id, name, isAdmin, email, notify_email } — id is null for shared-password sessions

  async init() {
    // Nav clicks
    document.querySelectorAll('.nav-item[data-section]').forEach(el => {
      el.addEventListener('click', () => App.navigate(el.dataset.section));
    });

    // Clock
    App.updateClock();
    setInterval(App.updateClock, 1000);

    // Who's signed in — needed before Maintenance/Team/Chat render
    try { App.me = await API.get('/api/users/me'); } catch (_) {}
    Chat.startPolling();
    Push.sync();

    // Tapping a notification while the app is open: the service worker asks
    // this window to jump to that conversation.
    navigator.serviceWorker?.addEventListener('message', e => {
      if (e.data?.type === 'open') App.openUrl(e.data.url);
    });

    // Load initial data for badges
    App.refreshBadges();

    // Opened from a notification (/?chat=… or /?section=…) — go straight there
    if (!App.openUrl(location.search)) Dashboard.load();
    if (location.search) history.replaceState(null, '', '/');
  },

  // Handles notification links. Returns true if it navigated somewhere.
  openUrl(url) {
    const q = new URLSearchParams(String(url).includes('?') ? String(url).split('?')[1] : '');
    if (q.has('chat')) {
      const c = q.get('chat');
      Chat.preselect(c === 'team' ? null : Number(c));
      App.navigate('chat');
      return true;
    }
    if (q.get('section') && SECTION_TITLES[q.get('section')]) {
      App.navigate(q.get('section'));
      return true;
    }
    return false;
  },

  // Stop this device's notifications for this account, then sign out.
  async signOut() {
    try { await Push.disable(); } catch (_) {}
    window.location = '/logout';
  },

  toggleSidebar() {
    const open = document.getElementById('sidebar').classList.toggle('open');
    const overlay = document.getElementById('sidebar-overlay');
    overlay.classList.toggle('visible', open);
    if (open) {
      // iOS fires a ghost click on the overlay 300ms after touchstart; block it
      overlay.style.pointerEvents = 'none';
      setTimeout(() => { overlay.style.pointerEvents = ''; }, 400);
    }
  },
  closeSidebar() {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebar-overlay').classList.remove('visible');
  },

  navigate(section) {
    // Hide all sections
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    document.getElementById(`section-${section}`).classList.add('active');

    // Update sidebar nav
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    document.querySelector(`.nav-item[data-section="${section}"]`)?.classList.add('active');

    // Update bottom nav — only the 4 primary tabs; More stays neutral
    document.querySelectorAll('.bnav-item[data-section]').forEach(el => el.classList.remove('active'));
    document.querySelector(`.bnav-item[data-section="${section}"]`)?.classList.add('active');

    // Update title
    document.getElementById('page-title').textContent = SECTION_TITLES[section] || section;

    App.currentSection = section;
    App.closeSidebar(); // always close sidebar after navigating on mobile

    // Load section data
    switch (section) {
      case 'dashboard':   Dashboard.load(); break;
      case 'watchlist':   Dashboard.loadWatchlist(); break;
      case 'drive':       Drive.load(); break;
      case 'cars':        Cars.load(); break;
      case 'maintenance': Maintenance.load(); break;
      case 'parts':       Parts.load(); break;
      case 'tools':       Tools.load(); break;
      case 'cleaning':    Cleaning.load(); break;
      case 'other':       Other.load(); break;
      case 'market':      Market.load(); break;
      case 'expenses':    Expenses.load(); break;
      case 'events':      Events.load(); break;
      case 'chat':        Chat.load(); break;
      case 'team':        Team.load(); break;
    }
  },

  updateClock() {
    const now = new Date();
    document.getElementById('clock').textContent =
      now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) +
      '  ' + now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  },

  async refreshBadges() {
    try {
      const [cars, maint, parts, tools, cleaning, events, other, watchlist] = await Promise.all([
        API.get('/api/cars'),
        API.get('/api/maintenance'),
        API.get('/api/parts'),
        API.get('/api/tools'),
        API.get('/api/cleaning'),
        API.get('/api/events'),
        API.get('/api/other'),
        API.get('/api/watchlist').catch(() => []),
      ]);
      document.getElementById('badge-watchlist').textContent = watchlist.length;
      document.getElementById('badge-cars').textContent = cars.length;
      document.getElementById('badge-maintenance').textContent = maint.filter(m => !m.completed).length;
      document.getElementById('badge-parts').textContent = parts.length;
      document.getElementById('badge-tools').textContent = tools.length;
      document.getElementById('badge-cleaning').textContent = cleaning.length;
      document.getElementById('badge-other').textContent = other.length;
      document.getElementById('badge-events').textContent = events.filter(e => {
        const d = daysUntil(e.date);
        return d !== null && d >= 0;
      }).length;
    } catch (_) {}
  },

  maintBadge(status) {
    const map = {
      'completed': ['Done',     '#2ecc71'],
      'overdue':   ['Overdue',  '#e74c3c'],
      'due-soon':  ['Due Soon', '#f5a623'],
      'upcoming':  ['Upcoming', '#00d4ff'],
    };
    const [label, color] = map[status] || ['—', 'var(--text-muted)'];
    return `<span style="color:${color};font-weight:600;font-size:11px">${label}</span>`;
  },

  cleaningBadge(status) {
    const map = { 'In Stock': '#00d4ff', 'Low': '#f5a623', 'Out of Stock': '#e74c3c' };
    const color = map[status] || 'var(--text-muted)';
    return `<span style="color:${color};font-weight:600;font-size:11px">${escHtml(status || '—')}</span>`;
  },

  // Keep for compatibility
  loadDashboard() { Dashboard.load(); },

  // Import helpers
  importData() {
    document.getElementById('import-text').value = '';
    document.getElementById('import-file').value = '';
    document.getElementById('import-overlay').classList.remove('hidden');
  },

  handleImportFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => { document.getElementById('import-text').value = ev.target.result; };
    reader.readAsText(file);
  },

  async executeImport() {
    const text = document.getElementById('import-text').value.trim();
    if (!text) { Toast.show('No data to import', 'error'); return; }
    let data;
    try { data = JSON.parse(text); }
    catch (e) { Toast.show('Invalid JSON', 'error'); return; }
    try {
      const result = await API.post('/api/import', data);
      document.getElementById('import-overlay').classList.add('hidden');
      Toast.show(`Imported: ${result.counts.cars} cars, ${result.counts.tools} tools, ${result.counts.cleaning} supplies`, 'success');
      App.refreshBadges();
      App.navigate(App.currentSection);
    } catch (err) {
      Toast.show('Import failed: ' + err.message, 'error');
    }
  },
};

// Phones: size the app to the part of the screen actually visible. iOS
// Safari's 100vh includes the area behind its toolbars, and on-screen
// keyboards cover the page instead of shrinking it — so the chat box ended up
// hidden. Tracking visualViewport fixes both, and .kb-open lets CSS hide the
// bottom tab bar while typing. Touch devices only, and not while pinch-zoomed.
(function fitToVisibleScreen() {
  const vv = window.visualViewport;
  if (!vv || !window.matchMedia('(pointer: coarse)').matches) return;
  const root = document.documentElement;
  const update = () => {
    if (vv.scale > 1.01) return;
    root.style.setProperty('--app-h', vv.height + 'px');
    root.classList.add('has-app-h');
    root.classList.toggle('kb-open', window.innerHeight - vv.height > 150);
    if (window.scrollY) window.scrollTo(0, 0); // iOS pans the page when focusing an input
  };
  vv.addEventListener('resize', update);
  vv.addEventListener('scroll', update);
  update();
})();

document.addEventListener('DOMContentLoaded', () => App.init());
