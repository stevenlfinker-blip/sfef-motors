const Expenses = (() => {
  let _items = [];
  let _cars = [];
  let _sortCol = 'date';
  let _sortDir = 'desc';

  // Dark-surface categorical slots (fixed order, never cycled). Garage always
  // takes slot 1; cars take the next slots in id order. Categories beyond the
  // palette (9th+ car, or an old archived car not in the current list) fall
  // back to a muted neutral rather than repeating a hue.
  const CATEGORY_COLORS = ['#3987e5', '#199e70', '#c98500', '#008300', '#9085e9', '#e66767', '#d55181', '#d95926'];

  function _categoryOrder() {
    // carLabelRaw (not carLabel) — e.category from the server is unescaped
    // text, so comparisons/dedup here must use the same raw form or a car
    // name with &, <, >, or " would show up as two separate categories.
    const order = ['Garage', ..._cars.slice().sort((a, b) => a.id - b.id).map(carLabelRaw)];
    const seen = new Set(order);
    for (const e of _items) {
      const cat = e.category || 'Garage';
      if (!seen.has(cat)) { order.push(cat); seen.add(cat); }
    }
    return order;
  }

  // Maps a category string (as shown in the filter/summary) back to the
  // car_id it represents, so a clicked category card can be carried into
  // the Add/Scan forms as the default. Returns null for Garage, undefined
  // if the category doesn't resolve to a currently-active car (no filter
  // selected, or an archived car's label with no matching live car).
  function _categoryToCarId(cat) {
    if (!cat) return undefined;
    if (cat === 'Garage') return null;
    const car = _cars.find(c => carLabelRaw(c) === cat);
    return car ? car.id : undefined;
  }

  // _categoryOrder() walks every item, so this is built once per render —
  // calling it per row would make render() O(rows × items) on a list of
  // hundreds of expenses.
  function _categoryColorMap() {
    const map = {};
    _categoryOrder().forEach((cat, idx) => {
      map[cat] = idx < CATEGORY_COLORS.length ? CATEGORY_COLORS[idx] : 'var(--text-muted)';
    });
    return map;
  }

  async function load() {
    try {
      [_items, _cars] = await Promise.all([API.get('/api/expenses'), API.get('/api/cars')]);
      _populateFilters();
      renderSummary();
      render();
    } catch (e) { Toast.show('Failed to load expenses', 'error'); }
  }

  function _populateFilters() {
    const catSel = document.getElementById('expenses-filter-cat');
    const cur = catSel.value;
    catSel.innerHTML = '<option value="">All Categories</option>' +
      _categoryOrder().map(c => `<option value="${escHtml(c)}" ${cur === c ? 'selected' : ''}>${escHtml(c)}</option>`).join('');
  }

  function renderSummary() {
    const total = _items.reduce((s, e) => s + (e.amount || 0), 0);
    const byCat = {};
    for (const e of _items) {
      const c = e.category || 'Garage';
      byCat[c] = (byCat[c] || 0) + (e.amount || 0);
    }
    const activeCat = document.getElementById('expenses-filter-cat').value;
    const colorMap = _categoryColorMap();

    const cards = _categoryOrder().map(cat => {
      const amt = byCat[cat] || 0;
      const pct = total > 0 ? Math.round((amt / total) * 100) : 0;
      const color = colorMap[cat];
      return `
        <div class="expense-cat-card${activeCat === cat ? ' active' : ''}" data-cat="${escHtml(cat)}" style="border-left:2px solid ${color}">
          <div class="expense-cat-label">${escHtml(cat)}</div>
          <div class="expense-cat-value" style="color:${color}">${fmt$(amt)}</div>
          <div style="font-size:10px;color:var(--text-muted);margin-top:2px">${pct}% of total</div>
        </div>`;
    }).join('');

    document.getElementById('expense-summary-row').innerHTML = `
      <div class="expense-summary">
        <div class="expense-cat-card${activeCat === '' ? ' active' : ''}" data-cat="" style="border-left:2px solid var(--accent)">
          <div class="expense-cat-label">Total Spend</div>
          <div class="expense-cat-value" style="color:var(--accent)">${fmt$(total)}</div>
          <div style="font-size:10px;color:var(--text-muted);margin-top:2px">${_items.length} entries</div>
        </div>
        ${cards}
      </div>`;

    document.querySelectorAll('#expense-summary-row .expense-cat-card').forEach(el => {
      el.addEventListener('click', () => {
        document.getElementById('expenses-filter-cat').value = el.dataset.cat;
        render();
        renderSummary();
      });
    });
  }

  function _setSort(col) {
    if (_sortCol === col) {
      _sortDir = _sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      _sortCol = col;
      _sortDir = col === 'amount' ? 'desc' : 'asc';
    }
    ['date', 'vendor', 'category', 'amount'].forEach(c => {
      const el = document.getElementById('sort-' + c);
      if (!el) return;
      const base = { date: 'Date', vendor: 'Vendor', category: 'Category', amount: 'Amount' }[c];
      el.textContent = c === _sortCol ? base + (_sortDir === 'asc' ? ' ▲' : ' ▼') : base;
    });
    render();
  }

  function clearFilters() {
    document.getElementById('expenses-search').value = '';
    document.getElementById('expenses-filter-cat').value = '';
    document.getElementById('expenses-filter-from').value = '';
    document.getElementById('expenses-filter-to').value = '';
    render();
  }

  function render() {
    const search    = (document.getElementById('expenses-search').value || '').toLowerCase().trim();
    const catFilter  = document.getElementById('expenses-filter-cat').value;
    const dateFrom   = document.getElementById('expenses-filter-from').value;
    const dateTo     = document.getElementById('expenses-filter-to').value;

    let items = _items;
    if (search)    items = items.filter(e => (e.vendor||'').toLowerCase().includes(search) || (e.description||'').toLowerCase().includes(search));
    if (catFilter) items = items.filter(e => (e.category || 'Garage') === catFilter);
    if (dateFrom)  items = items.filter(e => e.date && e.date >= dateFrom);
    if (dateTo)    items = items.filter(e => e.date && e.date <= dateTo);

    // Sort
    items = [...items].sort((a, b) => {
      if (_sortCol === 'amount') {
        return _sortDir === 'asc' ? (a.amount||0) - (b.amount||0) : (b.amount||0) - (a.amount||0);
      }
      const av = (a[_sortCol] || '').toLowerCase();
      const bv = (b[_sortCol] || '').toLowerCase();
      return _sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
    });

    // Result count
    const filtered = items.length < _items.length;
    const total = items.reduce((s, e) => s + (e.amount || 0), 0);
    document.getElementById('expenses-result-count').textContent =
      filtered ? `${items.length} of ${_items.length} entries · ${fmt$(total)}` : `${items.length} entries · ${fmt$(total)}`;

    const tbody = document.getElementById('expenses-tbody');
    if (items.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state">
        <div class="empty-state-icon">$</div>
        <div class="empty-state-title">No expenses match</div>
        <div class="empty-state-sub">Try adjusting your filters</div>
      </div></td></tr>`;
      return;
    }
    const colorMap = _categoryColorMap();
    tbody.innerHTML = items.map(e => {
      const cat = e.category || 'Garage';
      return `<tr>
        <td style="white-space:nowrap">${fmtDate(e.date)}</td>
        <td>${escHtml(e.vendor || '—')}</td>
        <td><strong>${escHtml(e.description)}</strong>${e.notes ? `<br><span style="color:var(--text-muted);font-size:11px">${escHtml(e.notes)}</span>` : ''}</td>
        <td><span style="color:${colorMap[cat] || 'var(--text-muted)'};font-weight:600;font-size:11px">${escHtml(cat)}</span>${e.archived ? ' <span style="color:var(--text-muted);font-size:10px">(sold)</span>' : ''}</td>
        <td style="font-weight:700;color:var(--accent)">${fmt$(e.amount)}</td>
        <td>${e.receipt_path ? `<a href="${escHtml(e.receipt_path)}" target="_blank" class="receipt-link">View ↗</a>` : '—'}</td>
        <td><div class="td-actions">
          <button class="btn btn-ghost btn-sm" onclick="Expenses.openEdit(${e.id})">Edit</button>
          <button class="btn btn-ghost btn-sm" style="color:var(--red)" onclick="Expenses.del(${e.id})">✕</button>
        </div></td>
      </tr>`;
    }).join('');
  }

  // archivedLabel is only set when editing an expense whose car was deleted.
  // It renders as its own selected option so that saving the form WITHOUT
  // touching this dropdown keeps the expense under its archived category —
  // otherwise every unrelated edit (fixing a typo, say) would silently reset
  // it to Garage, since Garage is what a plain car_id of null means anywhere
  // else in this form.
  function _categoryOptsHtml(selectedCarId, archivedLabel) {
    const carsSorted = _cars.slice().sort((a, b) => a.id - b.id);
    const opts = carsSorted.map(c => `<option value="${c.id}" ${selectedCarId == c.id ? 'selected' : ''}>${carLabel(c)}</option>`).join('');
    const archivedOpt = archivedLabel
      ? `<option value="__archived__" selected>${escHtml(archivedLabel)} (sold)</option>`
      : '';
    const garageSelected = !selectedCarId && !archivedLabel;
    return `${archivedOpt}<option value="" ${garageSelected ? 'selected' : ''}>Garage</option>${opts}`;
  }

  function _receiptPreviewHtml(receiptPath) {
    if (!receiptPath) return '';
    const isImage = /\.(jpg|jpeg|png|gif|webp|heic)$/i.test(receiptPath);
    const preview = isImage
      ? `<img src="${escHtml(receiptPath)}" style="max-width:100%;max-height:200px;border-radius:6px;display:block;margin-bottom:8px;border:1px solid var(--border)">`
      : `<div style="padding:12px;background:var(--elevated);border:1px solid var(--border);border-radius:6px;margin-bottom:8px;font-size:13px">📄 PDF Receipt</div>`;
    return `
      <div id="current-receipt">
        ${preview}
        <div style="display:flex;gap:10px;align-items:center">
          <a href="${escHtml(receiptPath)}" target="_blank" class="receipt-link" style="font-size:12px">View full ↗</a>
          <button type="button" class="btn btn-ghost btn-sm" style="color:var(--red);font-size:12px" onclick="Expenses._removeReceipt()">✕ Remove</button>
        </div>
        <input type="hidden" id="f-remove-receipt" value="0">
      </div>
      <div style="font-size:11px;color:var(--text-muted);margin-top:8px">Upload a new file to replace</div>`;
  }

  function formHtml(e = {}) {
    return `
      <div class="form-row-2">
        <div class="form-row">
          <label>Description *</label>
          <input type="text" id="f-desc" value="${escHtml(e.description || '')}" placeholder="Oil change, Brake service…">
        </div>
        <div class="form-row">
          <label>Vendor</label>
          <input type="text" id="f-vendor" value="${escHtml(e.vendor || '')}" placeholder="Jiffy Lube, Amazon…">
        </div>
      </div>
      <div class="form-row-2">
        <div class="form-row">
          <label>Amount ($) *</label>
          <input type="number" id="f-amount" value="${e.amount || ''}" placeholder="0.00" step="0.01" min="0">
        </div>
        <div class="form-row">
          <label>Date</label>
          <input type="date" id="f-date" value="${e.date || today()}">
        </div>
      </div>
      <div class="form-row">
        <label>Category</label>
        <select id="f-car">${_categoryOptsHtml(e.car_id, e.archived ? e.category : null)}</select>
      </div>
      <div class="form-row">
        <label>Receipt / Invoice</label>
        ${_receiptPreviewHtml(e.receipt_path)}
        <input type="file" id="f-receipt" accept="image/*,.pdf" style="margin-top:${e.receipt_path ? '6px' : '0'}">
      </div>
      <div class="form-row">
        <label>Notes</label>
        <textarea id="f-notes">${escHtml(e.notes || '')}</textarea>
      </div>`;
  }

  let _scanItems = []; // [{ id, file, status: 'scanning'|'scanned'|'error', fields }]
  let _scanSeq = 0;
  let _scanDefaultCarId; // category (car_id, null for Garage, or undefined) active when Scan Receipts was opened

  function _scanItemHtml(item) {
    const f = item.fields || {};
    const id = item.id;
    return `
      <div class="card" id="scan-item-${id}" style="padding:12px;margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;gap:8px">
          <strong style="font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(item.file.name)}</strong>
          <button type="button" class="btn btn-ghost btn-sm" style="color:var(--red);flex-shrink:0" onclick="Expenses._removeScanItem(${id})">✕ Remove</button>
        </div>
        ${item.status === 'scanning' ? `<div style="font-size:12px;color:var(--text-muted)">Scanning…</div>` : ''}
        ${item.status === 'error' ? `<div style="font-size:12px;color:var(--red);margin-bottom:6px">Could not auto-read this receipt — enter details manually.</div>` : ''}
        ${item.status !== 'scanning' ? `
          <div class="form-row">
            <label>Description *</label>
            <input type="text" id="sf-desc-${id}" value="${escHtml(f.description || '')}" placeholder="Oil change, Brake service…">
          </div>
          <div class="form-row-2">
            <div class="form-row">
              <label>Vendor</label>
              <input type="text" id="sf-vendor-${id}" value="${escHtml(f.vendor || '')}">
            </div>
            <div class="form-row">
              <label>Amount ($) *</label>
              <input type="number" id="sf-amount-${id}" value="${f.amount ?? ''}" step="0.01" min="0">
            </div>
          </div>
          <div class="form-row-2">
            <div class="form-row">
              <label>Date</label>
              <input type="date" id="sf-date-${id}" value="${f.date || today()}">
            </div>
            <div class="form-row">
              <label>Category</label>
              <select id="sf-car-${id}">${_categoryOptsHtml(_scanDefaultCarId)}</select>
            </div>
          </div>
          <div class="form-row">
            <label>Notes</label>
            <textarea id="sf-notes-${id}"></textarea>
          </div>
        ` : ''}
      </div>`;
  }

  // Each item's card is added/updated in place by id, never a full-list
  // re-render — otherwise finishing one receipt would blow away edits the
  // user already made to another card still on screen.
  function _appendScanItemCard(item) {
    const el = document.getElementById('scan-fields');
    if (el) el.insertAdjacentHTML('beforeend', _scanItemHtml(item));
  }

  function _updateScanItemCard(item) {
    const el = document.getElementById(`scan-item-${item.id}`);
    if (el) el.outerHTML = _scanItemHtml(item);
  }

  function _removeScanItem(id) {
    _scanItems = _scanItems.filter(i => i.id !== id);
    const el = document.getElementById(`scan-item-${id}`);
    if (el) el.remove();
  }

  function openScanReceipt() {
    _scanItems = [];
    _scanDefaultCarId = _categoryToCarId(document.getElementById('expenses-filter-cat').value);
    Modal.show('Scan Receipts', `
      <div class="form-row">
        <label>Receipt Photos / PDFs</label>
        <input type="file" id="scan-file-input" accept="image/jpeg,image/png,image/gif,image/webp,.pdf" multiple onchange="Expenses._handleScanFiles(this)">
        <div id="scan-status" style="font-size:12px;color:var(--text-muted);margin-top:6px">Choose one or more receipts — the fields below will fill in automatically for each.</div>
      </div>
      <div id="scan-fields"></div>
    `, _saveScanItems, { submitLabel: 'Save All' });
  }

  async function _handleScanFiles(input) {
    const files = Array.from(input.files || []);
    if (!files.length) return;
    input.value = ''; // allow re-selecting the same file(s) again later

    const status = document.getElementById('scan-status');
    const newItems = files.map(file => ({ id: _scanSeq++, file, status: 'scanning', fields: {} }));
    newItems.forEach(item => { _scanItems.push(item); _appendScanItemCard(item); });

    for (let i = 0; i < newItems.length; i++) {
      const item = newItems[i];
      status.style.color = 'var(--text-muted)';
      status.textContent = `Scanning ${i + 1} of ${newItems.length}…`;
      try {
        const fd = new FormData();
        fd.append('receipt', item.file);
        const parsed = await API.post('/api/expenses/parse-receipt', fd);
        item.fields = parsed;
        item.status = 'scanned';
      } catch (e) {
        item.status = 'error';
      }
      _updateScanItemCard(item);
    }

    status.style.color = 'var(--accent)';
    status.textContent = `✓ Scanned ${files.length} receipt${files.length > 1 ? 's' : ''} — review the fields below before saving`;
  }

  async function _saveScanItems() {
    if (_scanItems.length === 0) { Toast.show('Add at least one receipt', 'error'); return; }
    for (const item of _scanItems) {
      const desc   = document.getElementById(`sf-desc-${item.id}`)?.value.trim();
      const amount = document.getElementById(`sf-amount-${item.id}`)?.value;
      if (!desc || !amount) {
        Toast.show(`Fill in description and amount for "${item.file.name}"`, 'error');
        return;
      }
    }

    let saved = 0, failed = 0;
    // Iterate a snapshot — _removeScanItem() mutates _scanItems as each one
    // succeeds, so a retry after a partial failure only resubmits the
    // receipts that actually failed, instead of double-saving the rest.
    for (const item of [..._scanItems]) {
      const fd = new FormData();
      fd.append('description', document.getElementById(`sf-desc-${item.id}`).value.trim());
      fd.append('vendor', document.getElementById(`sf-vendor-${item.id}`).value.trim());
      fd.append('amount', document.getElementById(`sf-amount-${item.id}`).value);
      fd.append('date', document.getElementById(`sf-date-${item.id}`).value);
      fd.append('car_id', document.getElementById(`sf-car-${item.id}`).value || '');
      fd.append('notes', document.getElementById(`sf-notes-${item.id}`).value.trim());
      fd.append('receipt', item.file);
      try {
        const result = await API.post('/api/expenses', fd);
        _items.unshift(result);
        saved++;
        _removeScanItem(item.id);
      } catch (e) {
        failed++;
      }
    }

    if (saved > 0) { renderSummary(); render(); }
    if (failed === 0) {
      Modal.hide();
      Toast.show(`${saved} expense${saved > 1 ? 's' : ''} added`);
    } else {
      Toast.show(`${saved} saved, ${failed} failed — fix and try again`, 'error');
    }
  }

  function _removeReceipt() {
    const el = document.getElementById('current-receipt');
    if (el) el.style.display = 'none';
    const flag = document.getElementById('f-remove-receipt');
    if (flag) flag.value = '1';
  }

  function collectFormData() {
    const fd = new FormData();
    fd.append('description', document.getElementById('f-desc').value.trim());
    fd.append('vendor', document.getElementById('f-vendor').value.trim());
    fd.append('amount', document.getElementById('f-amount').value);
    fd.append('date', document.getElementById('f-date').value);
    const carVal = document.getElementById('f-car').value;
    if (carVal === '__archived__') {
      fd.append('car_id', '');
      fd.append('keep_category', '1');
    } else {
      fd.append('car_id', carVal || '');
    }
    fd.append('notes', document.getElementById('f-notes').value.trim());
    const removeFlag = document.getElementById('f-remove-receipt');
    if (removeFlag) fd.append('remove_receipt', removeFlag.value);
    const file = document.getElementById('f-receipt').files[0];
    if (file) fd.append('receipt', file);
    return fd;
  }

  function openAdd() {
    const activeCat = document.getElementById('expenses-filter-cat').value;
    Modal.show('Add Expense', formHtml({ car_id: _categoryToCarId(activeCat) }), async () => {
      const desc   = document.getElementById('f-desc').value.trim();
      const amount = document.getElementById('f-amount').value;
      if (!desc || !amount) { Toast.show('Description and amount are required', 'error'); return; }
      try {
        const item = await API.post('/api/expenses', collectFormData());
        _items.unshift(item);
        renderSummary();
        render();
        Modal.hide();
        Toast.show('Expense added');
      } catch (e) { Toast.show('Failed to save', 'error'); }
    });
  }

  function openEdit(id) {
    const e = _items.find(i => i.id === id);
    if (!e) return;
    Modal.show('Edit Expense', formHtml(e), async () => {
      const desc   = document.getElementById('f-desc').value.trim();
      const amount = document.getElementById('f-amount').value;
      if (!desc || !amount) { Toast.show('Description and amount are required', 'error'); return; }
      try {
        const updated = await API.put(`/api/expenses/${id}`, collectFormData());
        const idx = _items.findIndex(i => i.id === id);
        _items[idx] = updated;
        renderSummary();
        render();
        Modal.hide();
        Toast.show('Expense updated');
      } catch (e) { Toast.show('Failed to update', 'error'); }
    });
  }

  async function del(id) {
    if (!confirm('Delete this expense?')) return;
    try {
      await API.del(`/api/expenses/${id}`);
      _items = _items.filter(i => i.id !== id);
      renderSummary();
      render();
      Toast.show('Expense deleted');
    } catch (e) { Toast.show('Failed to delete', 'error'); }
  }

  function exportQB() {
    if (_items.length === 0) { Toast.show('No expenses to export', 'error'); return; }

    const headers = ['Date', 'Vendor', 'Description', 'Category', 'Amount', 'Notes'];
    const rows = _items.map(e => [
      e.date ? fmtDate(e.date) : '',
      e.vendor || '',
      e.description || '',
      e.category || 'Garage',
      (e.amount || 0).toFixed(2),
      e.notes || '',
    ]);

    const csv = [headers, ...rows]
      .map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
      .join('\r\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `expenses-quickbooks-${today()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    Toast.show('QuickBooks CSV downloaded');
  }

  return { load, render, openAdd, openEdit, del, exportQB, clearFilters, _setSort, _removeReceipt, openScanReceipt, _handleScanFiles, _removeScanItem };
})();
