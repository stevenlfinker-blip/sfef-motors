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
  cars:        'Fleet · Cars',
  maintenance: 'Fleet · Maintenance',
  parts:       'Inventory · Parts',
  tools:       'Inventory · Tools',
  cleaning:    'Inventory · Cleaning',
  costs:       'Finances · Costs',
  events:      'Schedule · Events',
};

const App = {
  currentSection: 'dashboard',

  init() {
    // Nav clicks
    document.querySelectorAll('.nav-item[data-section]').forEach(el => {
      el.addEventListener('click', () => App.navigate(el.dataset.section));
    });

    // Clock
    App.updateClock();
    setInterval(App.updateClock, 1000);

    // Load initial data for badges
    App.refreshBadges();

    // Load dashboard
    Dashboard.load();
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

    // Update nav
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    document.querySelector(`.nav-item[data-section="${section}"]`)?.classList.add('active');

    // Update title
    document.getElementById('page-title').textContent = SECTION_TITLES[section] || section;

    App.currentSection = section;
    App.closeSidebar(); // always close sidebar after navigating on mobile

    // Load section data
    switch (section) {
      case 'dashboard':   Dashboard.load(); break;
      case 'cars':        Cars.load(); break;
      case 'maintenance': Maintenance.load(); break;
      case 'parts':       Parts.load(); break;
      case 'tools':       Tools.load(); break;
      case 'cleaning':    Cleaning.load(); break;
      case 'costs':       Costs.load(); break;
      case 'events':      Events.load(); break;
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
      const [cars, maint, parts, tools, cleaning, events] = await Promise.all([
        API.get('/api/cars'),
        API.get('/api/maintenance'),
        API.get('/api/parts'),
        API.get('/api/tools'),
        API.get('/api/cleaning'),
        API.get('/api/events'),
      ]);
      document.getElementById('badge-cars').textContent = cars.length;
      document.getElementById('badge-maintenance').textContent = maint.filter(m => !m.completed).length;
      document.getElementById('badge-parts').textContent = parts.length;
      document.getElementById('badge-tools').textContent = tools.length;
      document.getElementById('badge-cleaning').textContent = cleaning.length;
      document.getElementById('badge-events').textContent = events.filter(e => {
        const d = daysUntil(e.date);
        return d !== null && d >= 0;
      }).length;
    } catch (_) {}
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

document.addEventListener('DOMContentLoaded', () => App.init());
