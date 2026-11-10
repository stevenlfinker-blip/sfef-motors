// Push notifications for this device: enabling, keeping the server's copy of
// the subscription in sync, and explaining iPhone's Add-to-Home-Screen rule.
const Push = (() => {
  const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  // iPads report themselves as Macs, hence the touch check; rule out Android first.
  const isIOS = () => !/Android/i.test(navigator.userAgent) && (/iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
  const isInstalled = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const isMember = () => !!App.me?.id;

  function _keyBytes(base64) {
    const pad = '='.repeat((4 - base64.length % 4) % 4);
    const raw = atob((base64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(raw, c => c.charCodeAt(0));
  }

  // 'enabled' | 'off' | 'denied' | 'needs-install' (iPhone in a Safari tab) | 'unsupported'
  async function status() {
    if (isIOS() && !isInstalled()) return 'needs-install';
    if (!supported()) return 'unsupported';
    if (Notification.permission === 'denied') return 'denied';
    if (Notification.permission !== 'granted') return 'off';
    const reg = await navigator.serviceWorker.ready;
    return (await reg.pushManager.getSubscription()) ? 'enabled' : 'off';
  }

  async function _subscribe() {
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    const { publicKey } = await API.get('/api/push/key');
    const key = _keyBytes(publicKey);
    // If the server's key changed, the old subscription is useless — replace it.
    if (sub && sub.options?.applicationServerKey) {
      const cur = new Uint8Array(sub.options.applicationServerKey);
      if (cur.length !== key.length || cur.some((b, i) => b !== key[i])) { await sub.unsubscribe(); sub = null; }
    }
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    await API.post('/api/push/subscribe', { subscription: sub.toJSON() });
  }

  // Must be called from a tap (browsers only allow the permission prompt then).
  async function enable() {
    if (!isMember()) throw new Error('Sign in with your own account first');
    const s = await status();
    if (s === 'needs-install' || s === 'unsupported') return s;
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') return perm === 'denied' ? 'denied' : 'off';
    await _subscribe();
    if (!App.me.notify_push) { await API.put('/api/users/me', { notify_push: 1 }); App.me.notify_push = 1; }
    return 'enabled';
  }

  async function disable() {
    if (!supported()) return;
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      try { await API.post('/api/push/unsubscribe', { endpoint: sub.endpoint }); } catch (_) {}
      await sub.unsubscribe();
    }
  }

  // On every app start: if this device already allowed notifications, make
  // sure the server has its current subscription (they can rotate/expire).
  async function sync() {
    try {
      if (isMember() && supported() && Notification.permission === 'granted' && !(isIOS() && !isInstalled())) await _subscribe();
    } catch (_) {}
    renderBanner();
  }

  // Banner on the chat screen nudging people to turn notifications on.
  async function renderBanner() {
    const el = document.getElementById('push-banner');
    if (!el) return;
    const s = isMember() ? await status() : 'unsupported';
    const dismissed = localStorage.getItem('push-banner-dismissed') === s;
    const close = `<button type="button" class="btn-icon" onclick="Push.dismissBanner('${s}')" aria-label="Dismiss">✕</button>`;
    let html = '';
    if (s === 'off') {
      html = `<span>🔔 Get notified on this device when someone messages you.</span>
        <span class="push-banner-actions"><button type="button" class="btn btn-primary btn-sm" onclick="Push.enableFromBanner()">Turn on</button>${close}</span>`;
    } else if (s === 'needs-install') {
      html = `<span>🔔 To get notifications on iPhone: tap <strong>Share</strong> <svg class="push-share-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12"/><path d="M8 7l4-4 4 4"/><path d="M6 11H5a1 1 0 00-1 1v8a1 1 0 001 1h14a1 1 0 001-1v-8a1 1 0 00-1-1h-1"/></svg> → <strong>Add to Home Screen</strong>, then open SFEF Motors from the new icon.</span>
        <span class="push-banner-actions">${close}</span>`;
    }
    el.innerHTML = html;
    el.classList.toggle('hidden', !html || dismissed);
  }

  async function enableFromBanner() {
    try {
      const s = await enable();
      Toast.show(s === 'enabled' ? 'Notifications on for this device' : s === 'denied'
        ? 'Notifications are blocked — allow them in your phone/browser settings' : 'Notifications not turned on', s === 'enabled' ? 'success' : 'error');
    } catch (e) { Toast.show(e.message, 'error'); }
    renderBanner();
  }

  function dismissBanner(s) {
    localStorage.setItem('push-banner-dismissed', s);
    renderBanner();
  }

  return { status, enable, disable, sync, renderBanner, enableFromBanner, dismissBanner, isIOS, isInstalled };
})();
