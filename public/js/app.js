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
    App.loadDashboard();
  },

  toggleSidebar() {
    const open = document.getElementById('sidebar').classList.toggle('open');
    document.getElementById('sidebar-overlay').classList.toggle('visible', open);
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
      case 'dashboard':   App.loadDashboard(); break;
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

  async loadDashboard() {
    try {
      const [cars, maint, parts, tools, cleaning, costs, events] = await Promise.all([
        API.get('/api/cars'),
        API.get('/api/maintenance'),
        API.get('/api/parts'),
        API.get('/api/tools'),
        API.get('/api/cleaning'),
        API.get('/api/costs'),
        API.get('/api/events'),
      ]);

      const totalSpend = costs.reduce((sum, c) => sum + (c.amount || 0), 0);
      const active = cars.filter(c => c.status === 'Active').length;
      const restoration = cars.filter(c => c.status === 'Restoration').length;
      const pending = maint.filter(m => !m.completed).length;
      const upcomingEvents = events.filter(e => { const d = daysUntil(e.date); return d !== null && d >= 0; });
      const lowSupplies = cleaning.filter(c => c.status === 'Low' || c.status === 'Out of Stock').length;

      const html = `
        <div class="stats-grid">
          <div class="stat-card">
            <div class="stat-label">Total Cars</div>
            <div class="stat-value accent">${cars.length}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Active</div>
            <div class="stat-value">${active}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Restoration</div>
            <div class="stat-value">${restoration}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Pending Maint.</div>
            <div class="stat-value">${pending}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Upcoming Events</div>
            <div class="stat-value">${upcomingEvents.length}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Parts in Stock</div>
            <div class="stat-value">${parts.length}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Tools</div>
            <div class="stat-value">${tools.length}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Total Spend</div>
            <div class="stat-value" style="font-size:18px">${fmt$(totalSpend)}</div>
          </div>
        </div>

        <div class="dash-grid">
          <div class="dash-panel">
            <div class="dash-panel-header">
              <span class="dash-panel-title">Fleet Status</span>
            </div>
            <div class="dash-panel-body">
              ${cars.length === 0
                ? '<div style="color:var(--text-muted);font-size:12px;padding:8px 0">No cars added yet.</div>'
                : cars.map(c => `
                <div class="dash-row">
                  <div>
                    <div class="dash-row-label">${escHtml(c.year)} ${escHtml(c.make)} ${escHtml(c.model)}</div>
                    <div class="dash-row-meta">${escHtml(c.color)} · ${escHtml(c.mileage)} mi</div>
                  </div>
                  <div class="dash-row-right">
                    ${App.carStatusBadge(c.status)}
                  </div>
                </div>`).join('')}
            </div>
          </div>

          <div class="dash-panel">
            <div class="dash-panel-header">
              <span class="dash-panel-title">Upcoming Events</span>
            </div>
            <div class="dash-panel-body">
              ${upcomingEvents.length === 0
                ? '<div style="color:var(--text-muted);font-size:12px;padding:8px 0">No upcoming events.</div>'
                : upcomingEvents.slice(0, 6).map(e => {
                  const d = daysUntil(e.date);
                  return `
                  <div class="dash-row">
                    <div>
                      <div class="dash-row-label">${escHtml(e.title)}</div>
                      <div class="dash-row-meta">${escHtml(e.location || e.type || '')} · ${fmtDate(e.date)}</div>
                    </div>
                    <div class="dash-row-right" style="color:${d <= 7 ? 'var(--orange)' : 'var(--text-muted)'};font-size:11px">
                      ${d === 0 ? 'Today' : d === 1 ? 'Tomorrow' : `${d}d away`}
                    </div>
                  </div>`;
                }).join('')}
            </div>
          </div>

          <div class="dash-panel">
            <div class="dash-panel-header">
              <span class="dash-panel-title">Pending Maintenance</span>
            </div>
            <div class="dash-panel-body">
              ${maint.filter(m => !m.completed).length === 0
                ? '<div style="color:var(--text-muted);font-size:12px;padding:8px 0">All clear — no pending tasks.</div>'
                : maint.filter(m => !m.completed).slice(0, 6).map(m => {
                  const d = daysUntil(m.due_date);
                  const status = d === null ? 'upcoming' : d < 0 ? 'overdue' : d <= 14 ? 'due-soon' : 'upcoming';
                  return `
                  <div class="dash-row">
                    <div>
                      <div class="dash-row-label">${escHtml(m.title)}</div>
                      <div class="dash-row-meta">${escHtml(m.car_name || 'General')} · ${fmtDate(m.due_date)}</div>
                    </div>
                    <div>${App.maintBadge(status)}</div>
                  </div>`;
                }).join('')}
            </div>
          </div>

          <div class="dash-panel">
            <div class="dash-panel-header">
              <span class="dash-panel-title">Supplies Status</span>
            </div>
            <div class="dash-panel-body">
              ${cleaning.length === 0
                ? '<div style="color:var(--text-muted);font-size:12px;padding:8px 0">No supplies added yet.</div>'
                : cleaning.map(c => `
                <div class="dash-row">
                  <div>
                    <div class="dash-row-label">${escHtml(c.product)}</div>
                    <div class="dash-row-meta">${escHtml(c.brand)} · ${escHtml(c.qty)} ${escHtml(c.unit)}</div>
                  </div>
                  <div>${App.cleaningBadge(c.status)}</div>
                </div>`).join('')}
            </div>
          </div>
        </div>
      `;
      document.getElementById('dashboard-content').innerHTML = html;
    } catch (err) {
      if (err.message === 'Session expired') return;
      document.getElementById('dashboard-content').innerHTML = `
        <div style="color:var(--red);padding:20px">
          Failed to load dashboard: ${escHtml(err.message)}<br>
          <button class="btn btn-secondary" style="margin-top:12px" onclick="App.loadDashboard()">Retry</button>
        </div>`;
    }
  },

  carStatusBadge(status) {
    const map = {
      'Active':      'badge-active',
      'Restoration': 'badge-restoration',
      'Storage':     'badge-storage',
      'For Sale':    'badge-for-sale',
    };
    return `<span class="badge ${map[status] || 'badge-neutral'}">${escHtml(status)}</span>`;
  },

  maintBadge(status) {
    const map = {
      overdue:   'badge-overdue',
      'due-soon': 'badge-due-soon',
      upcoming:  'badge-upcoming',
      completed: 'badge-completed',
    };
    const labels = { overdue: 'Overdue', 'due-soon': 'Due Soon', upcoming: 'Upcoming', completed: 'Done' };
    return `<span class="badge ${map[status] || 'badge-neutral'}">${labels[status] || status}</span>`;
  },

  cleaningBadge(status) {
    const map = { 'In Stock': 'badge-in-stock', 'Low': 'badge-low', 'Out of Stock': 'badge-out' };
    return `<span class="badge ${map[status] || 'badge-neutral'}">${escHtml(status)}</span>`;
  },

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
