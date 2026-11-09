const Chat = (() => {
  // A conversation is the team room (_peer === null) or a private chat with one member.
  let _peer = null;
  let _members = [];          // other team members, for the conversation tabs
  let _unread = { total: 0, team: 0, dms: {} };
  let _messages = [];
  let _lastId = 0;
  let _timer = null;
  let _busy = false;
  let _files = [];
  const _drafts = {};         // unsent text per conversation, so switching tabs doesn't lose it
  const MAX_FILE = 25 * 1024 * 1024;
  const MAX_FILES = 10;

  const _canChat = () => !!(App.me && App.me.id);
  const _key = () => (_peer === null ? 'team' : String(_peer));
  const _peerName = () => _members.find(u => u.id === _peer)?.name || 'this member';

  function _err(e, fallback) {
    try { return JSON.parse(e.message).error || fallback; } catch (_) { return fallback; }
  }

  function _bodyHtml(text) {
    // escape first, then highlight @mentions in the escaped text
    return escHtml(text).replace(/(^|\s)@([a-z0-9]+)/gi, '$1<span class="chat-mention">@$2</span>');
  }

  function _time(iso) {
    const d = new Date(iso);
    const t = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    return d.toDateString() === new Date().toDateString()
      ? t
      : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' + t;
  }

  function _size(n) {
    return n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
  }

  const _isImage = name => /\.(jpe?g|png|gif|webp)$/i.test(name || '');

  function _fileHtml(m) {
    if (!m.files?.length) return '';
    const url = f => `/api/chat/file/${f.id}`;
    const images = m.files.filter(f => _isImage(f.name));
    const others = m.files.filter(f => !_isImage(f.name));
    return (images.length ? `<div class="chat-imgs">${images.map(f =>
        `<a href="${url(f)}" target="_blank" rel="noopener"><img class="chat-img" src="${url(f)}" alt="${escHtml(f.name)}" loading="lazy"></a>`).join('')}</div>` : '') +
      others.map(f =>
        `<a class="chat-file" href="${url(f)}" download>📄 <span>${escHtml(f.name)}</span> <em>${_size(f.size || 0)}</em></a>`).join('');
  }

  // Adds to (rather than replaces) the pending attachments, so picking or
  // pasting several times builds up one message.
  function _addFiles(list) {
    for (const f of list) {
      if (_files.length >= MAX_FILES) { Toast.show(`Max ${MAX_FILES} files per message`, 'error'); break; }
      if (f.size > MAX_FILE) { Toast.show(`${f.name} is too large (max 25 MB each)`, 'error'); continue; }
      _files.push(f);
    }
    _renderFiles();
  }

  function removeFile(i) {
    _files.splice(i, 1);
    _renderFiles();
  }

  function _clearFiles() {
    _files = [];
    _renderFiles();
  }

  function _renderFiles() {
    const box = document.getElementById('chat-files');
    document.getElementById('chat-file').value = '';
    box.classList.toggle('hidden', !_files.length);
    box.innerHTML = _files.map((f, i) =>
      `<div class="chat-file-chip"><span>📎 ${escHtml(f.name)} <em>${_size(f.size)}</em></span><button type="button" class="btn-icon" onclick="Chat.removeFile(${i})" aria-label="Remove ${escHtml(f.name)}">✕</button></div>`
    ).join('');
  }

  function _messageHtml(m) {
    if (m.kind === 'system') {
      return `<div class="chat-msg chat-system">${escHtml(m.body)}<span class="chat-time">${_time(m.created_at)}</span></div>`;
    }
    const mine = App.me && m.user_id === App.me.id;
    return `<div class="chat-msg ${mine ? 'chat-mine' : ''} ${m.kind === 'alert' ? 'chat-alert-msg' : ''}">
      <div class="chat-meta">${m.kind === 'alert' ? '<span class="chat-alert-tag">ALERT</span>' : ''}<strong>${escHtml(m.name)}</strong><span class="chat-time">${_time(m.created_at)}</span></div>
      ${_fileHtml(m)}
      ${m.body ? `<div class="chat-body">${_bodyHtml(m.body)}</div>` : ''}
    </div>`;
  }

  function _render() {
    const box = document.getElementById('chat-messages');
    const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
    box.innerHTML = _messages.length
      ? _messages.map(_messageHtml).join('')
      : `<div class="empty-state"><div class="empty-state-icon">✉</div><div class="empty-state-title">No messages yet</div><div class="empty-state-sub">${_peer === null ? 'Say hello to the team' : 'Start a private conversation with ' + escHtml(_peerName())}</div></div>`;
    if (nearBottom) box.scrollTop = box.scrollHeight;
  }

  function _renderTabs() {
    const dot = n => n ? `<span class="chat-tab-badge">${n > 99 ? '99+' : n}</span>` : '';
    const tab = (peer, label, n) =>
      `<button type="button" class="chat-tab ${peer === _peer ? 'active' : ''}" onclick="Chat.open(${peer})">${label}${dot(n)}</button>`;
    document.getElementById('chat-tabs').innerHTML =
      tab(null, '# Team', _unread.team) +
      (_canChat() ? _members.map(u => tab(u.id, escHtml(u.name), _unread.dms[u.id])).join('') : '');
  }

  function _renderCompose() {
    document.getElementById('chat-compose').style.display = _canChat() ? '' : 'none';
    document.getElementById('chat-input').placeholder = _peer === null
      ? 'Message the team… use @name to notify someone'
      : `Private message to ${_peerName()}… (they'll get an email)`;
    document.getElementById('chat-alert-label').textContent = _peer === null
      ? 'Alert everyone (sends email)'
      : 'Mark as urgent';
  }

  function _applyUnread(u) {
    _unread = u;
    const badge = document.getElementById('badge-chat');
    badge.textContent = u.total > 99 ? '99+' : u.total;
    badge.classList.toggle('hidden', !u.total);
    _renderTabs();
  }

  const _q = extra => (_peer === null ? '' : `with=${_peer}&`) + extra;

  async function _markRead() {
    if (!_canChat()) return;
    const cur = _key();
    try {
      await API.post('/api/chat/read', { with: _peer });
      // clear this conversation's count locally right away; the next poll confirms it
      const u = { ..._unread, dms: { ..._unread.dms } };
      const had = cur === 'team' ? u.team : (u.dms[cur] || 0);
      if (cur === 'team') u.team = 0; else delete u.dms[cur];
      u.total = Math.max(0, u.total - had);
      _applyUnread(u);
    } catch (_) {}
  }

  async function _loadMembers() {
    try {
      const all = await API.get('/api/users');
      _members = all.filter(u => u.id !== App.me?.id);
    } catch (_) {}
  }

  async function load() {
    await _loadMembers();
    _renderTabs();
    _renderCompose();
    await _loadConversation();
  }

  async function _loadConversation() {
    const asked = _peer;
    try {
      const msgs = await API.get('/api/chat?' + _q('x=1'));
      if (asked !== _peer) return; // switched tabs while loading
      _messages = msgs;
      _lastId = _messages.length ? _messages[_messages.length - 1].id : 0;
      _render();
      const box = document.getElementById('chat-messages');
      box.scrollTop = box.scrollHeight;
      if (!_canChat()) {
        box.insertAdjacentHTML('beforeend', '<div class="chat-msg chat-system">You\'re signed in with the shared password. Add yourself under Members and sign in with your own email to post and send private messages.</div>');
      }
      _markRead();
    } catch (e) { Toast.show('Failed to load chat', 'error'); }
  }

  function open(peer) {
    if (peer === _peer) return;
    _drafts[_key()] = document.getElementById('chat-input').value;
    _peer = peer;
    _clearFiles();
    const input = document.getElementById('chat-input');
    input.value = _drafts[_key()] || '';
    document.getElementById('chat-alert').checked = false;
    _messages = []; _lastId = 0;
    _render();
    _renderTabs();
    _renderCompose();
    _loadConversation();
  }

  async function _poll() {
    if (_busy || document.hidden) return;
    _busy = true;
    const asked = _peer;
    try {
      if (App.currentSection === 'chat') {
        const fresh = await API.get('/api/chat?' + _q('after=' + _lastId));
        if (asked === _peer && fresh.length) {
          _messages.push(...fresh);
          _lastId = fresh[fresh.length - 1].id;
          _render();
          _markRead();
        }
      }
      if (_canChat()) _applyUnread(await API.get('/api/chat/unread'));
    } catch (_) {} finally { _busy = false; }
  }

  function startPolling() {
    if (_timer) return;
    _loadMembers().then(() => { _renderTabs(); _poll(); });
    _timer = setInterval(_poll, 5000);
  }

  async function send() {
    const input = document.getElementById('chat-input');
    const alertBox = document.getElementById('chat-alert');
    const body = input.value.trim();
    if (!body && !_files.length) return;
    if (alertBox.checked && _peer === null &&
        !confirm('Send this as an alert? Everyone on the team will get an email.')) return;
    const btn = document.getElementById('chat-send');
    const sentTo = _peer;
    btn.disabled = true;
    try {
      let payload = { body, alert: alertBox.checked, to: sentTo };
      if (_files.length) {
        payload = new FormData();
        payload.append('body', body);
        payload.append('alert', alertBox.checked ? '1' : '0');
        if (sentTo !== null) payload.append('to', sentTo);
        _files.forEach(f => payload.append('files', f));
      }
      const msg = await API.post('/api/chat', payload);
      _clearFiles();
      input.value = '';
      input.style.height = '';
      alertBox.checked = false;
      if (sentTo === _peer) {
        if (msg.id > _lastId) { _messages.push(msg); _lastId = msg.id; }
        _render();
        document.getElementById('chat-messages').scrollTop = 1e9;
        _markRead();
      }
    } catch (e) {
      Toast.show(_err(e, 'Failed to send'), 'error');
    } finally { btn.disabled = false; input.focus(); }
  }

  document.addEventListener('DOMContentLoaded', () => {
    const input = document.getElementById('chat-input');
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    });
    document.getElementById('chat-file').addEventListener('change', e => _addFiles([...e.target.files]));
    // Pasting a screenshot / copied image attaches it
    input.addEventListener('paste', e => {
      const pasted = [...(e.clipboardData?.files || [])];
      if (pasted.length) { e.preventDefault(); _addFiles(pasted); }
    });
    input.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 120) + 'px';
    });
  });

  return { load, send, startPolling, removeFile, open };
})();
