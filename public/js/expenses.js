const Expenses = (() => {
  let _items = [];
  let _cars = [];
  let _sortCol = 'date';
  let _sortDir = 'desc';

  const TYPES = [
    { value: 'Operating',    label: 'Garage Operating',    color: '#00d4ff' },
    { value: 'Maintenance',  label: 'Vehicle Maintenance', color: '#f5a623' },
    { value: 'Restoration',  label: 'Restoration',         color: '#c084fc' },
  ];

  const CATEGORIES = {
    Operating:   ['Rent/Lease', 'Supplies', 'Other'],
    Maintenance: ['Fuel', 'Parts & Service', 'Detailing', 'Other'],
    Restoration: ['Body Work', 'Parts', 'Other'],
  };
  const ALL_CATEGORIES = [...new Set(Object.values(CATEGORIES).flat())];

  function _typeInfo(val) {
    return TYPES.find(t => t.value === val) || { label: val || '—', color: 'var(--text-muted)' };
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
    const carSel = document.getElementById('expenses-filter-car');
    const curCar = carSel.value;
    carSel.innerHTML = '<option value="">All Cars</option><option value="0">General (No Car)</option>' +
      _cars.map(c => `<option value="${c.id}" ${curCar == c.id ? 'selected':''}>${carLabel(c)}</option>`).join('');

    const catSel = document.getElementById('expenses-filter-cat');
    const curCat = catSel.value;
    catSel.innerHTML = '<option value="">All Categories</option>' +
      ALL_CATEGORIES.map(c => `<option value="${c}" ${curCat === c ? 'selected':''}>${c}</option>`).join('');
  }

  function renderSummary() {
    const total = _items.reduce((s, e) => s + (e.amount || 0), 0);
    const byType = {};
    for (const e of _items) {
      const t = e.expense_type || 'Uncategorized';
      byType[t] = (byType[t] || 0) + (e.amount || 0);
    }

    const typeCards = TYPES.map(t => {
      const amt = byType[t.value] || 0;
      const pct = total > 0 ? Math.round((amt / total) * 100) : 0;
      return `
        <div class="expense-cat-card" style="border-left:2px solid ${t.color}">
          <div class="expense-cat-label">${t.label}</div>
          <div class="expense-cat-value" style="color:${t.color}">${fmt$(amt)}</div>
          <div style="font-size:10px;color:var(--text-muted);margin-top:2px">${pct}% of total</div>
        </div>`;
    }).join('');

    document.getElementById('expense-summary-row').innerHTML = `
      <div class="expense-summary">
        <div class="expense-cat-card" style="border-left:2px solid var(--accent)">
          <div class="expense-cat-label">Total Spend</div>
          <div class="expense-cat-value" style="color:var(--accent)">${fmt$(total)}</div>
          <div style="font-size:10px;color:var(--text-muted);margin-top:2px">${_items.length} entries</div>
        </div>
        ${typeCards}
      </div>`;
  }

  function _setSort(col) {
    if (_sortCol === col) {
      _sortDir = _sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      _sortCol = col;
      _sortDir = col === 'amount' ? 'desc' : 'asc';
    }
    // Update header indicators
    ['date','expense_type','vendor','car_name','category','amount'].forEach(c => {
      const el = document.getElementById('sort-' + c);
      if (!el) return;
      const base = { date:'Date', expense_type:'Type', vendor:'Vendor', car_name:'Car', category:'Category', amount:'Amount' }[c];
      el.textContent = c === _sortCol ? base + (_sortDir === 'asc' ? ' ▲' : ' ▼') : base;
    });
    render();
  }

  function clearFilters() {
    document.getElementById('expenses-search').value = '';
    document.getElementById('expenses-filter-type').value = '';
    document.getElementById('expenses-filter-car').value = '';
    document.getElementById('expenses-filter-cat').value = '';
    document.getElementById('expenses-filter-from').value = '';
    document.getElementById('expenses-filter-to').value = '';
    render();
  }

  function render() {
    const search    = (document.getElementById('expenses-search').value || '').toLowerCase().trim();
    const typeFilter = document.getElementById('expenses-filter-type').value;
    const carFilter  = document.getElementById('expenses-filter-car').value;
    const catFilter  = document.getElementById('expenses-filter-cat').value;
    const dateFrom   = document.getElementById('expenses-filter-from').value;
    const dateTo     = document.getElementById('expenses-filter-to').value;

    let items = _items;
    if (search)    items = items.filter(e => (e.vendor||'').toLowerCase().includes(search) || (e.description||'').toLowerCase().includes(search));
    if (typeFilter) items = items.filter(e => e.expense_type === typeFilter);
    if (carFilter === '0') items = items.filter(e => !e.car_id);
    else if (carFilter) items = items.filter(e => String(e.car_id) === carFilter);
    if (catFilter) items = items.filter(e => e.category === catFilter);
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
      tbody.innerHTML = `<tr><td colspan="9"><div class="empty-state">
        <div class="empty-state-icon">$</div>
        <div class="empty-state-title">No expenses match</div>
        <div class="empty-state-sub">Try adjusting your filters</div>
      </div></td></tr>`;
      return;
    }
    tbody.innerHTML = items.map(e => {
      const ti = _typeInfo(e.expense_type);
      return `<tr>
        <td style="white-space:nowrap">${fmtDate(e.date)}</td>
        <td><span style="color:${ti.color};font-weight:600;font-size:11px">${escHtml(ti.label)}</span></td>
        <td>${escHtml(e.vendor || '—')}</td>
        <td><strong>${escHtml(e.description)}</strong>${e.notes ? `<br><span style="color:var(--text-muted);font-size:11px">${escHtml(e.notes)}</span>` : ''}</td>
        <td>${escHtml(e.car_name || '—')}</td>
        <td><span class="badge badge-neutral">${escHtml(e.category || '—')}</span></td>
        <td style="font-weight:700;color:var(--accent)">${fmt$(e.amount)}</td>
        <td>${e.receipt_path ? `<a href="${escHtml(e.receipt_path)}" target="_blank" class="receipt-link">View ↗</a>` : '—'}</td>
        <td><div class="td-actions">
          <button class="btn btn-ghost btn-sm" onclick="Expenses.openEdit(${e.id})">Edit</button>
          <button class="btn btn-ghost btn-sm" style="color:var(--red)" onclick="Expenses.del(${e.id})">✕</button>
        </div></td>
      </tr>`;
    }).join('');
  }

  function _carOpts(selectedId) {
    return _cars.map(c => `<option value="${c.id}" ${selectedId == c.id ? 'selected':''}>${carLabel(c)}</option>`).join('');
  }

  function _catOpts(selectedType, selectedCat) {
    const cats = CATEGORIES[selectedType] || ALL_CATEGORIES;
    return cats.map(k => `<option value="${k}" ${selectedCat === k ? 'selected':''}>${k}</option>`).join('');
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
    const typeOpts = TYPES.map(t => `<option value="${t.value}" ${e.expense_type === t.value ? 'selected':''}>${t.label}</option>`).join('');
    const catOpts  = _catOpts(e.expense_type, e.category);
    return `
      <div class="form-row">
        <label>Type *</label>
        <select id="f-type" onchange="Expenses._onTypeChange(this.value)">
          <option value="">— Select Type —</option>${typeOpts}
        </select>
      </div>
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
      <div class="form-row-2">
        <div class="form-row">
          <label>Category</label>
          <select id="f-category"><option value="">— Select —</option>${catOpts}</select>
        </div>
        <div class="form-row">
          <label>Car</label>
          <select id="f-car"><option value="">— General —</option>${_carOpts(e.car_id)}</select>
        </div>
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

  let _scanFile = null;

  function _scanFieldsHtml(fields = {}) {
    const typeOpts = TYPES.map(t => `<option value="${t.value}" ${fields.expense_type === t.value ? 'selected':''}>${t.label}</option>`).join('');
    const catOpts  = _catOpts(fields.expense_type, fields.category);
    return `
      <div class="form-row">
        <label>Description *</label>
        <input type="text" id="sf-desc" value="${escHtml(fields.description || '')}" placeholder="Oil change, Brake service…">
      </div>
      <div class="form-row-2">
        <div class="form-row">
          <label>Vendor</label>
          <input type="text" id="sf-vendor" value="${escHtml(fields.vendor || '')}">
        </div>
        <div class="form-row">
          <label>Amount ($) *</label>
          <input type="number" id="sf-amount" value="${fields.amount ?? ''}" step="0.01" min="0">
        </div>
      </div>
      <div class="form-row">
        <label>Date</label>
        <input type="date" id="sf-date" value="${fields.date || today()}">
      </div>
      <div class="form-row-2">
        <div class="form-row">
          <label>Expense Allocation (Type) *</label>
          <select id="sf-type" onchange="Expenses._onScanTypeChange(this.value)">
            <option value="">— Select Type —</option>${typeOpts}
          </select>
        </div>
        <div class="form-row">
          <label>Category</label>
          <select id="sf-category"><option value="">— Select —</option>${catOpts}</select>
        </div>
      </div>
      <div class="form-row">
        <label>Vehicle Allocation</label>
        <select id="sf-car"><option value="">— General (No Car) —</option>${_carOpts()}</select>
      </div>
      <div class="form-row">
        <label>Notes</label>
        <textarea id="sf-notes"></textarea>
      </div>`;
  }

  function _onScanTypeChange(typeVal) {
    const catSel = document.getElementById('sf-category');
    if (!catSel) return;
    const curCat = catSel.value;
    catSel.innerHTML = '<option value="">— Select —</option>' + _catOpts(typeVal, curCat);
  }

  function openScanReceipt() {
    _scanFile = null;
    Modal.show('Scan Receipt', `
      <div class="form-row">
        <label>Receipt Photo / PDF</label>
        <input type="file" id="scan-file-input" accept="image/jpeg,image/png,image/gif,image/webp,.pdf" onchange="Expenses._handleScanFile(this)">
        <div id="scan-status" style="font-size:12px;color:var(--text-muted);margin-top:6px">Choose a receipt — the fields below will fill in automatically.</div>
      </div>
      <div id="scan-fields"></div>
    `, async () => {
      const desc   = document.getElementById('sf-desc')?.value.trim();
      const amount = document.getElementById('sf-amount')?.value;
      const type   = document.getElementById('sf-type')?.value;
      if (!desc || !type || !amount) {
        Toast.show('Scan a receipt and fill in description, amount, and type', 'error');
        return;
      }
      try {
        const fd = new FormData();
        fd.append('expense_type', type);
        fd.append('description', desc);
        fd.append('vendor', document.getElementById('sf-vendor').value.trim());
        fd.append('amount', amount);
        fd.append('date', document.getElementById('sf-date').value);
        fd.append('category', document.getElementById('sf-category').value);
        fd.append('car_id', document.getElementById('sf-car').value || '');
        fd.append('notes', document.getElementById('sf-notes').value.trim());
        if (_scanFile) fd.append('receipt', _scanFile);
        const item = await API.post('/api/expenses', fd);
        _items.unshift(item);
        renderSummary();
        render();
        Modal.hide();
        Toast.show('Expense added from receipt');
      } catch (e) { Toast.show('Failed to save', 'error'); }
    }, { submitLabel: 'Save Expense' });
  }

  async function _handleScanFile(input) {
    const file = input.files[0];
    const status = document.getElementById('scan-status');
    const fieldsEl = document.getElementById('scan-fields');
    if (!file) { fieldsEl.innerHTML = ''; return; }
    _scanFile = file;

    status.style.color = 'var(--text-muted)';
    status.textContent = 'Scanning receipt…';
    fieldsEl.innerHTML = '';

    try {
      const fd = new FormData();
      fd.append('receipt', file);
      const parsed = await API.post('/api/expenses/parse-receipt', fd);
      status.style.color = 'var(--accent)';
      status.textContent = '✓ Scanned — review the fields below before saving';
      fieldsEl.innerHTML = _scanFieldsHtml(parsed);
    } catch (e) {
      status.style.color = 'var(--red)';
      status.textContent = 'Could not auto-read this receipt. Enter the details manually below.';
      fieldsEl.innerHTML = _scanFieldsHtml({});
    }
  }

  function _removeReceipt() {
    const el = document.getElementById('current-receipt');
    if (el) el.style.display = 'none';
    const flag = document.getElementById('f-remove-receipt');
    if (flag) flag.value = '1';
  }

  // Repopulate category dropdown when type changes
  function _onTypeChange(typeVal) {
    const catSel = document.getElementById('f-category');
    if (!catSel) return;
    const curCat = catSel.value;
    catSel.innerHTML = '<option value="">— Select —</option>' + _catOpts(typeVal, curCat);
  }

  function collectFormData() {
    const fd = new FormData();
    fd.append('expense_type', document.getElementById('f-type').value);
    fd.append('description', document.getElementById('f-desc').value.trim());
    fd.append('vendor', document.getElementById('f-vendor').value.trim());
    fd.append('amount', document.getElementById('f-amount').value);
    fd.append('date', document.getElementById('f-date').value);
    fd.append('category', document.getElementById('f-category').value);
    fd.append('car_id', document.getElementById('f-car').value || '');
    fd.append('notes', document.getElementById('f-notes').value.trim());
    const removeFlag = document.getElementById('f-remove-receipt');
    if (removeFlag) fd.append('remove_receipt', removeFlag.value);
    const file = document.getElementById('f-receipt').files[0];
    if (file) fd.append('receipt', file);
    return fd;
  }

  function openAdd() {
    Modal.show('Add Expense', formHtml(), async () => {
      const desc   = document.getElementById('f-desc').value.trim();
      const amount = document.getElementById('f-amount').value;
      const type   = document.getElementById('f-type').value;
      if (!type)   { Toast.show('Please select a type', 'error'); return; }
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
      const type   = document.getElementById('f-type').value;
      if (!type)   { Toast.show('Please select a type', 'error'); return; }
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

    const headers = ['Date', 'Type', 'Vendor', 'Description', 'Account', 'Amount', 'Class', 'Memo'];
    const rows = _items.map(e => {
      const ti = _typeInfo(e.expense_type);
      return [
        e.date ? fmtDate(e.date) : '',
        ti.label,
        e.vendor || '',
        e.description || '',
        e.category || '',
        (e.amount || 0).toFixed(2),
        e.car_name || '',
        e.notes || '',
      ];
    });

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

  return { load, render, openAdd, openEdit, del, exportQB, clearFilters, _setSort, _onTypeChange, _removeReceipt, openScanReceipt, _handleScanFile, _onScanTypeChange };
})();
