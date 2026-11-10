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
      <td class="td-primary"><strong>${escHtml(u.name)}</strong>${u.id === App.me?.id ? ' <span style="color:var(--text-muted);font-size:11px">(you)</span>' : ''}</td>
      <td data-label="Email">${escHtml(u.email || '—')}</td>
      <td data-label="Role">${u.is_admin ? 'Admin' : 'Member'}</td>
      <td data-label="Email alerts">${u.notify_email ? 'On' : 'Off'}</td>
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

  const PUSH_STATUS = {
    enabled: '✓ On for this device',
    off: 'Off for this device',
    denied: 'Blocked — allow notifications for this site in your phone/browser settings',
    'needs-install': 'iPhone: tap Share → Add to Home Screen, then open SFEF Motors from the icon',
    unsupported: 'Not supported in this browser',
  };

  async function _renderPushRow() {
    const el = document.getElementById('s-push-row');
    if (!el) return;
    const st = await Push.status();
    el.innerHTML = `
      <div style="font-size:13px;margin-bottom:8px">${escHtml(PUSH_STATUS[st])}</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${st === 'off' ? '<button type="button" class="btn btn-primary btn-sm" onclick="Team.pushEnable()">Turn on for this device</button>' : ''}
        ${st === 'enabled' ? '<button type="button" class="btn btn-secondary btn-sm" onclick="Team.pushTest()">Send test notification</button><button type="button" class="btn btn-ghost btn-sm" onclick="Team.pushDisable()">Turn off for this device</button>' : ''}
      </div>`;
  }

  async function pushEnable() {
    try {
      const st = await Push.enable();
      if (st === 'enabled') { document.getElementById('s-push').checked = true; Toast.show('Notifications on for this device'); }
      else Toast.show(PUSH_STATUS[st] || 'Notifications not turned on', 'error');
    } catch (e) { Toast.show(e.message, 'error'); }
    _renderPushRow();
  }

  async function pushDisable() {
    await Push.disable();
    Toast.show('Notifications off for this device');
    _renderPushRow();
  }

  function _deviceName(ua) {
    ua = ua || '';
    const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android'
      : /Macintosh/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'Device';
    const br = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome'
      : /Safari\//.test(ua) ? 'Safari' : '';
    return br && os !== 'iPhone' && os !== 'iPad' ? `${os} · ${br}` : os;
  }

  // Per-device delivery report: sent by the server → arrived on the device.
  function _reportHtml(devices, startedAt, done) {
    const rows = devices.map(d => {
      const sentNow = d.last_sent_at && d.last_sent_at >= startedAt;
      const gotNow = d.last_received_at && d.last_received_at >= startedAt;
      let msg;
      if (!sentNow) msg = '⚪ Not sent';
      else if (/^rejected/.test(d.last_result)) msg = `❌ Rejected by the notification service — ${escHtml(d.last_result)}`;
      else if (gotNow && d.last_device_error) msg = `⚠️ Arrived, but the device couldn't show it: ${escHtml(d.last_device_error)}`;
      else if (gotNow) msg = '✅ Arrived on the device. If no banner showed, the device\'s own notification settings or Focus mode are hiding it.';
      else msg = done ? '❌ Never arrived on the device' : '⏳ Waiting for the device…';
      const isThis = d.user_agent === navigator.userAgent.slice(0, 200) ? ' (this device)' : '';
      return `<div style="padding:6px 0;border-top:1px solid var(--border)"><strong>${escHtml(_deviceName(d.user_agent))}${isThis}</strong><br>${msg}</div>`;
    }).join('');
    return `<div style="margin-top:10px;font-size:12px">${rows || 'No devices are signed up.'}</div>`;
  }

  async function pushTest() {
    const box = document.getElementById('s-push-report');
    try {
      const r = await API.post('/api/push/test', {});
      if (!box) { Toast.show(r.sent ? 'Test sent' : 'No devices received it', r.sent ? 'success' : 'error'); return; }
      // Devices report back within a few seconds; give them up to 20.
      for (let i = 0; i < 10; i++) {
        const devices = await API.get('/api/push/devices');
        const waiting = devices.some(d => d.last_sent_at >= r.startedAt && !/^rejected/.test(d.last_result) && !(d.last_received_at >= r.startedAt));
        box.innerHTML = _reportHtml(devices, r.startedAt, !waiting || i === 9);
        if (!waiting) break;
        await new Promise(res => setTimeout(res, 2000));
      }
    } catch (e) { Toast.show(_err(e, 'Test failed'), 'error'); }
  }

  function openSettings() {
    Modal.show('My Settings', `
      <div class="form-row"><label>Notifications on this device</label><div id="s-push-row" style="font-size:13px;color:var(--text-muted)">Checking…</div><div id="s-push-report"></div></div>
      <div class="form-row"><label class="checkbox-row"><input type="checkbox" id="s-push" ${App.me.notify_push ? 'checked' : ''}><span>Send me push notifications (all my devices)</span></label></div>
      <div class="form-row"><label class="checkbox-row"><input type="checkbox" id="s-previews" ${App.me.push_previews ? 'checked' : ''}><span>Show private message text in notifications (off = just who it's from)</span></label></div>
      <div class="form-row"><label class="checkbox-row"><input type="checkbox" id="s-notify" ${App.me.notify_email ? 'checked' : ''}><span>Send me email alerts (assignments, @mentions, team alerts, private messages)</span></label></div>
      <div class="form-row"><label>Current Password (only to change it)</label><input type="password" id="s-current" autocomplete="current-password"></div>
      <div class="form-row"><label>New Password (8+ characters)</label><input type="password" id="s-new" autocomplete="new-password"></div>`,
      async () => {
        const payload = {
          notify_email: document.getElementById('s-notify').checked ? 1 : 0,
          notify_push: document.getElementById('s-push').checked ? 1 : 0,
          push_previews: document.getElementById('s-previews').checked ? 1 : 0,
        };
        const np = document.getElementById('s-new').value;
        if (np) { payload.password = np; payload.current_password = document.getElementById('s-current').value; }
        try {
          await API.put('/api/users/me', payload);
          App.me = await API.get('/api/users/me');
          Modal.hide(); Toast.show('Settings saved'); load();
        } catch (e) { Toast.show(_err(e, 'Failed to save settings'), 'error'); }
      });
    _renderPushRow();
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

  return { load, openAdd, openEdit, del, openSettings, openTestEmail, pushEnable, pushDisable, pushTest };
})();
