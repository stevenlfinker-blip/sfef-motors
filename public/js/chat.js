const Chat = (() => {
  // A conversation is the team room (_peer === null) or a private chat with one member.
  let _peer = null;
  let _members = [];          // other team members, for the conversation tabs
  let _unread = { total: 0, team: 0, dms: {} };
  let _messages = [];
  let _lastId = 0;
  let _timer = null;
  let _busy = false;
  let _stick = true;           // keep the view pinned to the newest message
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
    return (images.length ? `<div class="chat-imgs ${images.length > 1 ? 'multi' : ''}">${images.map(f =>
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
    if (_stick) _scrollToEnd(); // the compose box just grew/shrank
  }

  function _messageHtml(m) {
    if (m.kind === 'system' || m.kind === 'cleared') {
      return `<div class="chat-msg chat-system">${escHtml(m.body)}<span class="chat-time">${_time(m.created_at)}</span></div>`;
    }
    const mine = App.me && m.user_id === App.me.id;
    return `<div class="chat-msg ${mine ? 'chat-mine' : ''} ${m.kind === 'alert' ? 'chat-alert-msg' : ''}">
      <div class="chat-meta">${m.kind === 'alert' ? '<span class="chat-alert-tag">ALERT</span>' : ''}<strong>${escHtml(m.name)}</strong><span class="chat-time">${_time(m.created_at)}</span></div>
      ${_fileHtml(m)}
      ${m.body ? `<div class="chat-body">${_bodyHtml(m.body)}</div>` : ''}
    </div>`;
  }

  function _scrollToEnd() {
    const box = document.getElementById('chat-messages');
    box.scrollTop = box.scrollHeight;
  }

  function _render() {
    const box = document.getElementById('chat-messages');
    box.innerHTML = _messages.length
      ? _messages.map(_messageHtml).join('')
      : `<div class="empty-state"><div class="empty-state-icon">✉</div><div class="empty-state-title">No messages yet</div><div class="empty-state-sub">${_peer === null ? 'Say hello to the team' : 'Start a private conversation with ' + escHtml(_peerName())}</div></div>`;
    // Photos load after this render and grow the list; keep pinned to the
    // bottom as each one arrives, unless the user has scrolled up to read.
    box.querySelectorAll('img').forEach(img => img.addEventListener('load', () => { if (_stick) _scrollToEnd(); }));
    if (_stick) _scrollToEnd();
  }

  function _renderTabs() {
    const dot = n => n ? `<span class="chat-tab-badge">${n > 99 ? '99+' : n}</span>` : '';
    const tab = (peer, label, n) =>
      `<button type="button" class="chat-tab ${peer === _peer ? 'active' : ''}" onclick="Chat.open(${peer})">${label}${dot(n)}</button>`;
    document.getElementById('chat-tabs').innerHTML =
      tab(null, '# Team', _unread.team) +
      (_canChat() ? _members.map(u => tab(u.id, escHtml(u.name), _unread.dms[u.id])).join('') : '');
    // on a phone the tab strip scrolls sideways — keep the open one visible
    document.querySelector('#chat-tabs .chat-tab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  // ── @mention autocomplete (team room only — private chats email anyway) ──
  // Handle must match the server's handleOf(): first word, letters/digits, lowercase.
  const _handleOf = name => String(name || '').trim().split(/\s+/)[0].normalize('NFD').toLowerCase().replace(/[^a-z0-9]/g, '');
  let _mention = null; // { start, matches, sel } while the list is open

  function _closeMentions() {
    _mention = null;
    document.getElementById('chat-mentions').classList.add('hidden');
  }

  function _updateMentions() {
    const input = document.getElementById('chat-input');
    const before = input.value.slice(0, input.selectionStart);
    const m = _peer === null && before.match(/(^|\s)@([a-z0-9]*)$/i);
    if (!m) return _closeMentions();
    const q = m[2].toLowerCase();
    const matches = _members
      .filter(u => _handleOf(u.name).startsWith(q) || u.name.toLowerCase().includes(q))
      .slice(0, 6);
    _mention = { start: before.length - m[2].length - 1, matches, sel: 0 };
    _renderMentions();
  }

  function _renderMentions() {
    const box = document.getElementById('chat-mentions');
    box.classList.remove('hidden');
    if (!_members.length) {
      box.innerHTML = '<div class="chat-mention-empty">No teammates yet — add them under Members</div>';
      return;
    }
    if (!_mention.matches.length) {
      box.innerHTML = '<div class="chat-mention-empty">No matching teammate</div>';
      return;
    }
    // mousedown + preventDefault keeps focus (and the caret) in the textarea
    box.innerHTML = _mention.matches.map((u, i) =>
      `<div class="chat-mention-opt ${i === _mention.sel ? 'active' : ''}" role="option"
            onmousedown="event.preventDefault(); Chat.pickMention(${i})">
        <strong>${escHtml(u.name)}</strong> <span>@${escHtml(_handleOf(u.name))}</span>
      </div>`).join('');
  }

  function pickMention(i) {
    if (!_mention?.matches[i]) return;
    const input = document.getElementById('chat-input');
    const handle = '@' + _handleOf(_mention.matches[i].name) + ' ';
    const caret = input.selectionStart;
    input.value = input.value.slice(0, _mention.start) + handle + input.value.slice(caret);
    const pos = _mention.start + handle.length;
    input.setSelectionRange(pos, pos);
    _closeMentions();
    input.focus();
  }

  // Returns true if the key was used by the open mention list.
  function _mentionKey(e) {
    if (!_mention) return false;
    const n = _mention.matches.length;
    if (e.key === 'Escape') { _closeMentions(); return true; }
    if (!n) return false;
    if (e.key === 'ArrowDown') { _mention.sel = (_mention.sel + 1) % n; _renderMentions(); return true; }
    if (e.key === 'ArrowUp')   { _mention.sel = (_mention.sel - 1 + n) % n; _renderMentions(); return true; }
    if (e.key === 'Enter' || e.key === 'Tab') { pickMention(_mention.sel); return true; }
    return false;
  }

  function _renderCompose() {
    document.getElementById('chat-compose').style.display = _canChat() ? '' : 'none';
    const clearBtn = document.getElementById('chat-clear-btn');
    clearBtn.classList.toggle('hidden', _peer === null ? !App.me?.isAdmin : !_canChat());
    clearBtn.title = _peer === null ? 'Clear team chat (everyone)' : 'Clear this chat (just for you)';
    // kept short so it fits on one line on a phone
    const first = _peerName().split(' ')[0];
    document.getElementById('chat-input').placeholder = _peer === null
      ? 'Message the team (@ to mention)'
      : `Message ${first} · emails them`;
    document.getElementById('chat-alert-label').textContent = _peer === null ? 'Alert all (email)' : 'Urgent';
  }

  function _applyUnread(u) {
    _unread = u;
    for (const id of ['badge-chat', 'bnav-badge-chat']) {
      const badge = document.getElementById(id);
      badge.textContent = u.total > 99 ? '99+' : u.total;
      badge.classList.toggle('hidden', !u.total);
    }
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
      _stick = true;
      _render();
      const box = document.getElementById('chat-messages');
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
    _closeMentions();
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
          // someone cleared the team chat: drop everything before that note
          const cut = fresh.map(m => m.kind).lastIndexOf('cleared');
          if (cut >= 0) { _messages = []; fresh.splice(0, cut); }
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

  async function clear() {
    const ok = confirm(_peer === null
      ? 'Clear the team chat for EVERYONE? All team messages and their files will be permanently deleted.'
      : `Clear your chat with ${_peerName()}? It disappears for you only — ${_peerName()} keeps their copy.`);
    if (!ok) return;
    try {
      await API.post('/api/chat/clear', { with: _peer });
      Toast.show('Chat cleared');
      _loadConversation();
    } catch (e) { Toast.show(_err(e, 'Failed to clear chat'), 'error'); }
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
        _stick = true;
        _scrollToEnd();
        _markRead();
      }
    } catch (e) {
      Toast.show(_err(e, 'Failed to send'), 'error');
    } finally { btn.disabled = false; input.focus(); }
  }

  document.addEventListener('DOMContentLoaded', () => {
    const input = document.getElementById('chat-input');
    const box = document.getElementById('chat-messages');
    box.addEventListener('scroll', () => {
      _stick = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
    }, { passive: true });
    input.addEventListener('keydown', e => {
      if (_mentionKey(e)) { e.preventDefault(); return; }
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    });
    input.addEventListener('keyup', e => {
      if (!['ArrowUp', 'ArrowDown', 'Enter', 'Tab', 'Escape'].includes(e.key)) _updateMentions();
    });
    input.addEventListener('click', _updateMentions);
    input.addEventListener('blur', () => setTimeout(_closeMentions, 150));
    document.getElementById('chat-file').addEventListener('change', e => _addFiles([...e.target.files]));
    // Pasting a screenshot / copied image attaches it
    input.addEventListener('paste', e => {
      const pasted = [...(e.clipboardData?.files || [])];
      if (pasted.length) { e.preventDefault(); _addFiles(pasted); }
    });
    input.addEventListener('input', () => {
      _updateMentions();
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 120) + 'px';
    });
  });

  return { load, send, startPolling, removeFile, open, pickMention, clear };
})();
