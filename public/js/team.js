const Team = (() => {
  let _users = [];

  function _err(e, fallback) {
    try { return JSON.parse(e.message).error || fallback; } catch (_) { return fallback; }
  }

  async function load() {
    const admin = !!App.me?.isAdmin;
    document.getElementById('team-add-btn').style.display = admin ? '' : 'none';
    document.getElementById('team-test-email-btn').style.display = admin ? '' : 'none';
    document.getElementById('team-settings-btn').style.display = App.me?.id ? '' : 'none';
    try {
      _users = await API.get('/api/users');
      render();
    } catch (e) { Toast.show('Failed to load members', 'error'); }
  }

  function render() {
    const admin = !!App.me?.isAdmin;
    const tbody = document.getElementById('team-tbody');
    if (!_users.length) {
      tbody.innerHTML = `<tr><td colspan="5"><div class="empty-state">
        <div class="empty-state-icon">☺</div>
        <div class="empty-state-title">No team members yet</div>
        <div class="empty-state-sub">${admin ? 'Add everyone, including yourself, then sign in with your own email' : ''}</div>
      </div></td></tr>`;
      return;
    }
    tbody.innerHTML = _users.map(u => `<tr>
      <td><strong>${escHtml(u.name)}</strong>${u.id === App.me?.id ? ' <span style="color:var(--text-muted);font-size:11px">(you)</span>' : ''}</td>
      <td>${escHtml(u.email || '—')}</td>
      <td>${u.is_admin ? 'Admin' : 'Member'}</td>
      <td>${u.notify_email ? 'On' : 'Off'}</td>
      <td><div class="td-actions">${admin ? `
        <button class="btn btn-ghost btn-sm" onclick="Team.openEdit(${u.id})">Edit</button>
        ${u.id !== App.me?.id ? `<button class="btn btn-ghost btn-sm" style="color:var(--red)" onclick="Team.del(${u.id})">✕</button>` : ''}` : ''}
      </div></td>
    </tr>`).join('');
  }

  function _formHtml(u = {}) {
    return `
      <div class="form-row"><label>Name *</label>
        <input type="text" id="u-name" value="${escHtml(u.name || '')}" placeholder="First Last">
        <div style="font-size:11px;color:var(--text-muted);margin-top:4px">@mentions use the first name, so each first name must be unique.</div></div>
      <div class="form-row"><label>Email *</label>
        <input type="email" id="u-email" value="${escHtml(u.email || '')}" autocomplete="off"></div>
      <div class="form-row"><label>${u.id ? 'New Password (leave blank to keep)' : 'Password * (8+ characters)'}</label>
        <input type="password" id="u-password" autocomplete="new-password"></div>
      <div class="form-row"><label class="checkbox-row"><input type="checkbox" id="u-admin" ${u.is_admin ? 'checked' : ''}><span>Admin (can manage members)</span></label></div>
      <div class="form-row"><label class="checkbox-row"><input type="checkbox" id="u-notify" ${u.id && !u.notify_email ? '' : 'checked'}><span>Send email alerts</span></label></div>`;
  }

  function _collect() {
    return {
      name: document.getElementById('u-name').value.trim(),
      email: document.getElementById('u-email').value.trim(),
      password: document.getElementById('u-password').value,
      is_admin: document.getElementById('u-admin').checked ? 1 : 0,
      notify_email: document.getElementById('u-notify').checked ? 1 : 0,
    };
  }

  function openAdd() {
    Modal.show('Add Member', _formHtml(), async () => {
      try {
        await API.post('/api/users', _collect());
        Modal.hide(); Toast.show('Member added'); load();
      } catch (e) { Toast.show(_err(e, 'Failed to add member'), 'error'); }
    });
  }

  function openEdit(id) {
    const u = _users.find(x => x.id === id);
    if (!u) return;
    Modal.show('Edit Member', _formHtml(u), async () => {
      try {
        await API.put(`/api/users/${id}`, _collect());
        Modal.hide(); Toast.show('Member updated'); load();
        if (id === App.me?.id) App.me = await API.get('/api/users/me');
      } catch (e) { Toast.show(_err(e, 'Failed to update member'), 'error'); }
    });
  }

  async function del(id) {
    const u = _users.find(x => x.id === id);
    if (!confirm(`Remove ${u?.name || 'this member'}? Their work orders become unassigned.`)) return;
    try { await API.del(`/api/users/${id}`); Toast.show('Member removed'); load(); }
    catch (e) { Toast.show(_err(e, 'Failed to remove member'), 'error'); }
  }

  function openSettings() {
    Modal.show('My Settings', `
      <div class="form-row"><label class="checkbox-row"><input type="checkbox" id="s-notify" ${App.me.notify_email ? 'checked' : ''}><span>Send me email alerts (assignments, @mentions, team alerts)</span></label></div>
      <div class="form-row"><label>Current Password (only to change it)</label><input type="password" id="s-current" autocomplete="current-password"></div>
      <div class="form-row"><label>New Password (8+ characters)</label><input type="password" id="s-new" autocomplete="new-password"></div>`,
      async () => {
        const payload = { notify_email: document.getElementById('s-notify').checked ? 1 : 0 };
        const np = document.getElementById('s-new').value;
        if (np) { payload.password = np; payload.current_password = document.getElementById('s-current').value; }
        try {
          await API.put('/api/users/me', payload);
          App.me = await API.get('/api/users/me');
          Modal.hide(); Toast.show('Settings saved'); load();
        } catch (e) { Toast.show(_err(e, 'Failed to save settings'), 'error'); }
      });
  }

  function openTestEmail() {
    Modal.show('Send Test Email', `
      <div class="form-row"><label>Send to</label>
        <input type="email" id="t-to" value="${escHtml(App.me?.email || '')}" placeholder="you@example.com"></div>
      <div id="t-result" style="font-size:13px;line-height:1.5"></div>`,
      async () => {
        const to = document.getElementById('t-to').value.trim();
        const out = document.getElementById('t-result');
        const btn = document.getElementById('modal-submit');
        btn.disabled = true;
        out.innerHTML = '<span style="color:var(--text-muted)">Sending… (up to 15 seconds)</span>';
        try {
          const r = await API.post('/api/users/test-email', { to });
          out.innerHTML = r.ok
            ? `<span style="color:var(--green)">✓ Sent from ${escHtml(r.from)}. Check ${escHtml(to)} (and its Spam folder).</span>`
            : `<div style="color:var(--red)">✕ Failed: ${escHtml(r.error)}</div>${r.hint ? `<div style="margin-top:6px">${escHtml(r.hint)}</div>` : ''}`;
        } catch (e) {
          out.innerHTML = `<span style="color:var(--red)">✕ ${escHtml(_err(e, 'Request failed'))}</span>`;
        } finally { btn.disabled = false; }
      }, { submitLabel: 'Send' });
  }

  return { load, openAdd, openEdit, del, openSettings, openTestEmail };
})();
