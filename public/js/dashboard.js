const Dashboard = (() => {
  const COLORS = ['#00d4ff','#00e5a0','#ff6a00','#7c4dff','#00aaff','#facc15','#ff3a5c','#f472b6','#a3e635','#fb923c'];

  let _hudClockTimer = null;
  function startHudClock() {
    if (_hudClockTimer) clearInterval(_hudClockTimer);
    function tick() {
      const clockEl = document.getElementById('hud-clock');
      const dateEl  = document.getElementById('hud-date');
      if (!clockEl || !dateEl) { clearInterval(_hudClockTimer); _hudClockTimer = null; return; }
      const n  = new Date();
      const hh = String(n.getHours()).padStart(2, '0');
      const mm = String(n.getMinutes()).padStart(2, '0');
      const ss = String(n.getSeconds()).padStart(2, '0');
      clockEl.textContent = `${hh}:${mm}:${ss}`;
      const dd = String(n.getDate()).padStart(2, '0');
      const mo = String(n.getMonth() + 1).padStart(2, '0');
      dateEl.textContent = `${dd}.${mo}.${n.getFullYear()}`;
    }
    tick();
    _hudClockTimer = setInterval(tick, 1000);
  }

  // ── Date helpers ──────────────────────────────────
  function parseMixedDate(s) {
    if (!s) return null;
    const md = String(s).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (md) return new Date(+md[3], +md[1]-1, +md[2]);
    const yd = String(s).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (yd) return new Date(+yd[1], +yd[2]-1, +yd[3]);
    return null;
  }

  function daysFromNow(dateStr) {
    const d = parseMixedDate(dateStr);
    if (!d) return null;
    const now = new Date(); now.setHours(0,0,0,0);
    return Math.round((d - now) / 86400000);
  }

  // ── SVG Charts ────────────────────────────────────
  function barChart(data) {
    const W = 400, H = 130, padL = 8, padR = 8, padT = 24, padB = 26;
    const chartW = W - padL - padR;
    const chartH = H - padT - padB;
    const n = data.length;
    const max = Math.max(...data.map(d => d.value), 1);
    const barW = chartW / n;
    const gap = 5;

    const bars = data.map((d, i) => {
      const bh = Math.max(d.value > 0 ? 4 : 0, (d.value / max) * chartH);
      const x = padL + i * barW + gap / 2;
      const bw = barW - gap;
      const y = padT + chartH - bh;
      const label = d.value >= 1000 ? '$' + (d.value / 1000).toFixed(1) + 'k' : d.value > 0 ? '$' + Math.round(d.value) : '';
      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" fill="var(--accent)" rx="2" opacity="${d.value > 0 ? '0.85' : '0.15'}"/>
        <text x="${(x + bw/2).toFixed(1)}" y="${(H-2).toFixed(1)}" text-anchor="middle" fill="var(--text-muted)" font-size="9">${d.label}</text>
        ${label ? `<text x="${(x + bw/2).toFixed(1)}" y="${(y-4).toFixed(1)}" text-anchor="middle" fill="var(--accent)" font-size="8" font-weight="600">${label}</text>` : ''}`;
    });

    const baseY = padT + chartH;
    return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;display:block">
      <line x1="${padL}" y1="${baseY}" x2="${W-padR}" y2="${baseY}" stroke="var(--border-light)" stroke-width="1"/>
      ${bars.join('')}
    </svg>`;
  }

  function donutChart(segments, centerLabel) {
    const r = 60, cx = 100, cy = 100, sw = 22;
    const circ = 2 * Math.PI * r;
    const total = segments.reduce((s, x) => s + x.value, 0);
    if (total === 0) {
      return `<svg viewBox="0 0 200 200" style="width:100%;max-width:180px;display:block;margin:auto">
        <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--elevated)" stroke-width="${sw}"/>
        <text x="${cx}" y="${cy+5}" text-anchor="middle" fill="var(--text-muted)" font-size="11">No data</text>
      </svg>`;
    }
    let offset = 0;
    const circles = segments.map(seg => {
      const len = (seg.value / total) * circ;
      const da = `${len.toFixed(2)} ${(circ - len).toFixed(2)}`;
      const rot = (offset / circ) * 360 - 90;
      offset += len;
      return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${seg.color}" stroke-width="${sw}" stroke-dasharray="${da}" transform="rotate(${rot.toFixed(2)} ${cx} ${cy})" stroke-linecap="butt"/>`;
    });
    return `<svg viewBox="0 0 200 200" style="width:100%;max-width:180px;display:block;margin:auto">
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--elevated)" stroke-width="${sw}"/>
      ${circles.join('')}
      <text x="${cx}" y="${cy-3}" text-anchor="middle" fill="var(--text-muted)" font-size="9">Total</text>
      <text x="${cx}" y="${cy+13}" text-anchor="middle" fill="var(--accent)" font-size="14" font-weight="700">${centerLabel}</text>
    </svg>`;
  }

  // ── Widget: HUD Header + Stat Cards ──────────────
  function hudWidget(cars, maint, parts, tools, cleaning, costs, events, watchlist, valuationMap = {}) {
    const yr         = new Date().getFullYear();
    const ownedCars  = cars.filter(c => c.category !== 'Lease');
    const totalValue = ownedCars.reduce((s, c) => s + (c.value || 0), 0);
    const totalPaid   = ownedCars.reduce((s, c) => s + (c.purchase_price || 0), 0);
    const totalMarket = ownedCars.reduce((s, c) => s + (valuationMap[c.id]?.avg || 0), 0);
    const portfolioDelta = totalPaid > 0 && totalMarket > 0 ? totalMarket - totalPaid : null;
    const active     = cars.filter(c => c.status === 'Active').length;
    const restoration = cars.filter(c => c.status === 'Restoration').length;
    const topCar     = [...cars].sort((a, b) => (b.value || 0) - (a.value || 0))[0];
    const ytdCosts   = costs.filter(c => c.date && c.date.startsWith(String(yr)));
    const ytdTotal   = ytdCosts.reduce((s, c) => s + (c.amount || 0), 0);
    const pendingCount = maint.filter(m => !m.completed).length;
    const expiringCount = cars.reduce((n, c) => {
      let cnt = 0;
      const rd = daysFromNow(c.registration); if (rd !== null && rd >= 0 && rd <= 60) cnt++;
      const id = daysFromNow(c.insurance);    if (id !== null && id >= 0 && id <= 60) cnt++;
      return n + cnt;
    }, 0);
    const makes = [...new Set(cars.map(c => c.make).filter(Boolean))];
    const byBrand = {};
    for (const c of cars) { if (c.make) byBrand[c.make] = (byBrand[c.make] || 0) + (c.value || 0); }
    const topBrand = Object.entries(byBrand).sort((a, b) => b[1] - a[1])[0];

    function card(color, label, value, sub, meta) {
      return `<div class="hud-card" style="--hud-color:${color}">
        <div class="hud-card-corner">┐</div>
        <div class="hud-card-label">${label}</div>
        <div class="hud-card-value" style="color:${color}">${value}</div>
        <div class="hud-card-sub">${sub}</div>
        <div class="hud-card-meta">${meta}</div>
      </div>`;
    }

    return `
      <div class="hud-header">
        <div class="hud-header-left">
          <div class="hud-title">SFEF MOTORS</div>
          <div class="hud-subtitle">FLEET COMMAND CENTER &middot; OPERATIONS DASHBOARD</div>
        </div>
        <div class="hud-status-group">
          <span class="hud-dot"></span>
          <span class="hud-online">SYSTEM ONLINE</span>
          <span id="hud-clock" class="hud-clock">--:--:--</span>
          <span id="hud-date" class="hud-date">--.--.----</span>
        </div>
      </div>
      <div class="hud-cards">
        ${card('#facc15', 'FLEET VALUE',
          totalMarket > 0 ? fmt$(totalMarket) : fmt$(totalValue),
          totalPaid > 0 ? `Paid ${fmt$(totalPaid)}` : `${cars.length} vehicle${cars.length !== 1?'s':''}`,
          portfolioDelta !== null
            ? (portfolioDelta >= 0 ? `▲ +${fmt$(portfolioDelta)} gain` : `▼ ${fmt$(portfolioDelta)} loss`)
            : 'Est. Market ' + yr
        )}
        ${card('#00e5a0', 'ACTIVE FLEET',   String(active),    `${restoration} in restoration`, 'Operational')}
        ${card('#00d4ff', 'TOP ASSET',      topCar ? escHtml(topCar.make + ' ' + topCar.model) : '—', topCar ? escHtml(String(topCar.year || '')) : 'No cars', topCar && topCar.value ? fmt$(topCar.value) : '—')}
        ${card('#ff6a00', 'YTD SPENDING',   fmt$(ytdTotal),    `${ytdCosts.length} expense${ytdCosts.length !== 1 ? 's' : ''} in ${yr}`, ytdCosts.length === 0 ? 'Add expenses →' : 'This calendar year')}
        ${card('#ff3a5c', 'PENDING TASKS',  String(pendingCount), `${expiringCount} expiring within 60d`, 'Maintenance queue')}
        ${card('#7c4dff', 'BRANDS',         String(makes.length), topBrand ? `Led by ${escHtml(topBrand[0])}` : 'No data yet', `${cars.length} total vehicles`)}
      </div>`;
  }

  // ── Chart interaction state ───────────────────────
  let _mktChart = null;

  function _mktFmtK(n) {
    if (!n) return '—';
    if (n >= 1000000) return '$' + (n / 1000000).toFixed(2) + 'M';
    return '$' + Math.round(n / 1000) + 'K';
  }

  function _initMktChart() {
    const svg = document.getElementById('mkt-svg');
    if (!svg || !_mktChart) return;
    const overlay  = document.getElementById('mkt-overlay');
    const xhair    = document.getElementById('mkt-xhair');
    const tooltip  = document.getElementById('mkt-tooltip');
    const { carData, W, PAD, chartW, chartH, xMin, xMax, baseY } = _mktChart;

    function handlePointer(clientX, clientY) {
      const rect  = svg.getBoundingClientRect();
      const svgX  = (clientX - rect.left) * (W / rect.width);
      const t     = xMin + ((svgX - PAD.left) / chartW) * (xMax - xMin);

      // Find the month all cars share closest to cursor
      let snapT = null, snapDist = Infinity;
      for (const c of carData) {
        for (const p of c.pts) {
          const d = Math.abs(p.t - t);
          if (d < snapDist) { snapDist = d; snapT = p.t; }
        }
      }
      if (snapT === null) return;

      // Crosshair at snapped X
      const snapX = PAD.left + ((snapT - xMin) / (xMax - xMin)) * chartW;
      xhair.setAttribute('x1', snapX.toFixed(1));
      xhair.setAttribute('x2', snapX.toFixed(1));
      xhair.style.display = '';

      // Tooltip rows for each visible car
      const rows = [];
      for (const c of carData) {
        const g = document.getElementById(`mkt-g-${c.id}`);
        if (g && g.dataset.hidden === '1') continue;
        const p = c.pts.reduce((best, pt) =>
          Math.abs(pt.t - snapT) < Math.abs(best.t - snapT) ? pt : best, c.pts[0]);
        if (!p) continue;
        const dot = document.getElementById(`mkt-dot-${c.id}`);
        if (dot) { dot.setAttribute('cx', p.x.toFixed(1)); dot.setAttribute('cy', p.y.toFixed(1)); dot.style.display = ''; }
        rows.push(`<div style="display:flex;align-items:center;gap:7px;padding:2px 0">
          <span style="width:7px;height:7px;border-radius:50%;background:${c.color};flex-shrink:0"></span>
          <span style="color:#8a9bb5;flex:1;font-size:10px;white-space:nowrap">${escHtml(c.shortLabel)}</span>
          <span style="color:${c.color};font-weight:700;font-size:11px">${_mktFmtK(p.avg)}</span>
        </div>`);
      }

      tooltip.innerHTML = `<div style="color:#4a5a7a;font-size:9px;font-weight:600;letter-spacing:.05em;margin-bottom:5px">${new Date(snapT).toLocaleDateString('en-US',{month:'short',year:'numeric'})}</div>${rows.join('')}`;
      tooltip.style.display = 'block';
      const tx = Math.min(clientX + 16, window.innerWidth - 190);
      const ty = Math.max(clientY - 30, 8);
      tooltip.style.left = tx + 'px';
      tooltip.style.top  = ty + 'px';
    }

    overlay.addEventListener('mousemove', e => handlePointer(e.clientX, e.clientY));

    overlay.addEventListener('touchstart', e => { e.preventDefault(); }, { passive: false });
    overlay.addEventListener('touchmove', e => {
      e.preventDefault();
      const t = e.touches[0];
      handlePointer(t.clientX, t.clientY);
    }, { passive: false });

    function handlePointerEnd() {
      xhair.style.display = 'none';
      tooltip.style.display = 'none';
      carData.forEach(c => {
        const dot = document.getElementById(`mkt-dot-${c.id}`);
        if (dot) dot.style.display = 'none';
      });
    }

    overlay.addEventListener('mouseleave', handlePointerEnd);
    overlay.addEventListener('touchend', handlePointerEnd);
  }

  function _mktToggle(carId) {
    if (!_mktChart) return;
    const g   = document.getElementById(`mkt-g-${carId}`);
    const btn = document.getElementById(`mkt-leg-${carId}`);
    if (!g) return;
    const hidden = g.dataset.hidden === '1';
    g.dataset.hidden  = hidden ? '0' : '1';
    g.style.opacity   = hidden ? '1' : '0.12';
    if (btn) btn.style.opacity = hidden ? '1' : '0.3';
  }

  function _noteToggle(carId) {
    const note = document.getElementById(`mkt-note-${carId}`);
    const btn  = document.getElementById(`mkt-note-btn-${carId}`);
    if (!note || !btn) return;
    const collapsed = note.classList.toggle('note-clamp');
    btn.textContent = collapsed ? 'Show more' : 'Show less';
  }

  // ── Widget: Collectibles Market Intelligence ──────
  function collectiblesMarketWidget(cars, valuationMap, history) {
    const CAR_COLORS = ['#00e5a0','#00d4ff','#facc15','#ff6a00','#7c4dff','#ff3a5c','#f472b6','#a3e635'];
    const TREND_COLOR = { Appreciating: '#00e5a0', Stable: '#00d4ff', Depreciating: '#ff3a5c' };

    const collectibles = cars
      .filter(c => c.category === 'Collectable')
      .map((c, i) => ({ ...c, val: valuationMap[c.id], color: CAR_COLORS[i % CAR_COLORS.length] }))
      .filter(c => c.val && c.val.avg > 0);

    if (collectibles.length === 0) {
      return `<div class="dash-full"><div class="dash-panel">
        <div class="dash-panel-header"><span class="dash-panel-title">Collectibles Market Intelligence</span></div>
        <div class="dash-panel-body"><div style="color:var(--text-muted);font-size:12px;padding:8px 0">No valuations yet — go to Market Analytics and run a valuation.</div></div>
      </div></div>`;
    }

    // Deduplicate history: one entry per car per calendar month (latest wins)
    const byCarId = {};
    for (const v of (history || [])) {
      const mo = v.fetched_at.slice(0, 7);
      if (!byCarId[v.car_id]) byCarId[v.car_id] = {};
      const ex = byCarId[v.car_id][mo];
      if (!ex || v.fetched_at > ex.fetched_at) byCarId[v.car_id][mo] = v;
    }

    // Chart constants
    const W = 700, H = 220;
    const PAD = { top: 16, right: 20, bottom: 28, left: 62 };
    const chartW = W - PAD.left - PAD.right;
    const chartH = H - PAD.top - PAD.bottom;

    // Pass 1: collect raw timestamps + avgs to determine axis ranges
    const rawByCarId = collectibles.map(c => {
      const monthMap = byCarId[c.id] || {};
      const sorted = Object.values(monthMap).sort((a, b) => a.fetched_at.localeCompare(b.fetched_at));
      const latestMo = Object.keys(monthMap).sort().pop() || '';
      if (!latestMo.startsWith(c.val.fetched_at.slice(0,7))) sorted.push(c.val);
      else sorted[sorted.length - 1] = monthMap[latestMo];
      return sorted;
    });

    const allTs   = rawByCarId.flat().map(p => new Date(p.fetched_at).getTime());
    const allAvgs = rawByCarId.flat().map(p => p.avg).filter(Boolean);

    // Dynamic range: earliest point (with small left pad) → latest point + ~5 weeks right pad
    const DAY = 24 * 3600 * 1000;
    const xMin = allTs.length ? Math.min(...allTs) - 8 * DAY : Date.now() - 365 * DAY;
    const xMax = allTs.length ? Math.max(...allTs) + 8 * DAY : Date.now();

    const yMin = allAvgs.length ? Math.floor(Math.min(...allAvgs) * 0.85 / 50000) * 50000 : 0;
    const yMax = collectibles.reduce((m, c) => Math.max(m, c.val.high || c.val.avg || 0), 0) * 1.05;
    const baseY = PAD.top + chartH;

    function xOf(t) { return PAD.left + ((t - xMin) / (xMax - xMin)) * chartW; }
    function yOf(v) { return PAD.top + chartH - ((v - yMin) / (yMax - yMin)) * chartH; }

    function smoothPath(pts) {
      if (pts.length === 1) return `M ${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`;
      let d = `M ${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`;
      for (let i = 1; i < pts.length; i++) {
        const prev = pts[i-1], curr = pts[i];
        const cpx = (prev.x + curr.x) / 2;
        d += ` C ${cpx.toFixed(1)},${prev.y.toFixed(1)} ${cpx.toFixed(1)},${curr.y.toFixed(1)} ${curr.x.toFixed(1)},${curr.y.toFixed(1)}`;
      }
      return d;
    }

    // Pass 2: build per-car data with screen coords (now that xOf/yOf are defined)
    const carData = collectibles.map((c, i) => {
      const pts = rawByCarId[i].map(p => ({
        t:   new Date(p.fetched_at).getTime(),
        avg: p.avg,
        x:   xOf(new Date(p.fetched_at).getTime()),
        y:   yOf(p.avg || 0),
      }));

      return {
        id:         c.id,
        color:      c.color,
        shortLabel: `${c.year} ${c.make.split(' ')[0]} ${c.model.split(' ')[0]}`,
        val:        c.val,
        pts,
      };
    });

    // Store for mouse handler
    _mktChart = { carData, W, H, PAD, chartW, chartH, xMin, xMax, yMin, yMax, baseY };

    // Grid
    const gridLines = [0.25, 0.5, 0.75, 1].map(f => {
      const v = yMin + f * (yMax - yMin);
      const y = yOf(v).toFixed(1);
      const label = v >= 1000000 ? '$' + (v/1000000).toFixed(1)+'M' : '$' + Math.round(v/1000)+'K';
      return `<line x1="${PAD.left}" y1="${y}" x2="${W-PAD.right}" y2="${y}" stroke="#151e2e" stroke-width="1"/>
        <text x="${PAD.left-5}" y="${(+y+3.5).toFixed(1)}" text-anchor="end" fill="#3d4f6a" font-size="9">${label}</text>`;
    }).join('');

    // Dynamic X axis labels: one label every other month across the data range
    const axisLabels = (() => {
      const labels = [];
      const start = new Date(xMin);
      start.setDate(1);
      const end   = new Date(xMax);
      let cur = new Date(start.getFullYear(), start.getMonth(), 15);
      let idx = 0;
      while (cur.getTime() < end.getTime()) {
        if (idx % 2 === 0) {
          const x = xOf(cur.getTime()).toFixed(1);
          const mo  = cur.toLocaleDateString('en-US', { month: 'short' });
          const yr  = String(cur.getFullYear()).slice(2);
          const isJan = cur.getMonth() === 0;
          labels.push(`<text x="${x}" y="${(baseY+14).toFixed(1)}" text-anchor="middle" fill="#3d4f6a" font-size="9">${isJan ? mo + " '" + yr : mo}</text>`);
        }
        cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 15);
        idx++;
      }
      return labels.join('');
    })();

    // SVG car groups
    const carPaths = carData.map(c => {
      if (!c.pts.length) return '';
      const lineD = smoothPath(c.pts);
      const areaD = `M ${c.pts[0].x.toFixed(1)},${baseY} ` + lineD.slice(1) + ` L ${c.pts[c.pts.length-1].x.toFixed(1)},${baseY} Z`;
      const last  = c.pts[c.pts.length - 1];
      return `<g id="mkt-g-${c.id}" data-hidden="0" style="transition:opacity .2s">
        <path d="${areaD}" fill="${c.color}" opacity="0.09"/>
        <path d="${lineD}" fill="none" stroke="${c.color}" stroke-width="2" opacity="0.9" stroke-linecap="round" stroke-linejoin="round"/>
        <circle cx="${last.x.toFixed(1)}" cy="${last.y.toFixed(1)}" r="3.5" fill="${c.color}"/>
      </g>`;
    }).join('');

    // Hover dots (one per car, repositioned on mousemove)
    const hoverDots = carData.map(c =>
      `<circle id="mkt-dot-${c.id}" r="4" fill="${c.color}" stroke="#0d1421" stroke-width="1.5" style="display:none"/>`
    ).join('');

    // Last updated = most recent real (non-estimated) valuation across all collectibles
    const lastRealTs = collectibles.reduce((max, c) => {
      const t = new Date(c.val.fetched_at).getTime();
      return t > max ? t : max;
    }, 0);
    const lastUpdatedStr = lastRealTs
      ? new Date(lastRealTs).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
      : '—';

    const svgChart = `<svg id="mkt-svg" viewBox="0 0 ${W} ${H}" style="width:100%;display:block;cursor:crosshair">
      <line x1="${PAD.left}" y1="${baseY}" x2="${W-PAD.right}" y2="${baseY}" stroke="#2a3347" stroke-width="1"/>
      ${gridLines}
      ${carPaths}
      ${hoverDots}
      ${axisLabels}
      <line id="mkt-xhair" x1="0" y1="${PAD.top}" x2="0" y2="${baseY}" stroke="rgba(255,255,255,0.18)" stroke-width="1" stroke-dasharray="3,3" style="display:none"/>
      <rect id="mkt-overlay" x="${PAD.left}" y="${PAD.top}" width="${chartW}" height="${chartH}" fill="transparent"/>
    </svg>
    <div style="display:flex;align-items:center;justify-content:flex-end;gap:6px;margin-top:4px;padding-right:2px">
      <span style="width:6px;height:6px;border-radius:50%;background:var(--green);display:inline-block;flex-shrink:0"></span>
      <span style="font-size:9px;color:var(--text-muted);letter-spacing:.04em">LAST UPDATED</span>
      <span style="font-size:9px;color:var(--accent);font-weight:600">${escHtml(lastUpdatedStr)}</span>
    </div>
    <div id="mkt-tooltip" style="display:none;position:fixed;background:#111827;border:1px solid #1e2d45;border-radius:5px;padding:8px 12px;pointer-events:none;z-index:9999;min-width:170px;box-shadow:0 6px 24px rgba(0,0,0,.6)"></div>`;

    // Clickable legend
    const legend = collectibles.map((c, i) => {
      const cd = carData[i];
      return `<button id="mkt-leg-${c.id}" onclick="Dashboard._mktToggle(${c.id})"
        style="display:inline-flex;align-items:center;gap:6px;margin:0 8px 6px 0;font-size:10px;color:${c.color};background:rgba(0,0,0,.2);border:1px solid rgba(255,255,255,.08);border-radius:3px;padding:4px 9px;cursor:pointer;transition:opacity .2s;font-family:inherit">
        <span style="width:14px;height:2px;background:${c.color};display:inline-block;border-radius:1px;flex-shrink:0"></span>
        ${escHtml(c.year)} ${escHtml(c.make)} ${escHtml(c.model)}
        <span style="opacity:.55;margin-left:2px">${_mktFmtK(c.val.avg)}</span>
      </button>`;
    }).join('');

    // Research notes
    const notes = collectibles.map((c, i) => {
      const tColor    = TREND_COLOR[c.val.trend] || '#00d4ff';
      const trendIcon = { Appreciating: '▲', Stable: '●', Depreciating: '▼' }[c.val.trend] || '●';
      return `<div style="padding:10px 0;border-bottom:1px solid var(--border)">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:5px;flex-wrap:wrap">
          <span style="width:8px;height:8px;border-radius:50%;background:${c.color};flex-shrink:0"></span>
          <span style="font-size:11px;font-weight:600;color:var(--text)">${escHtml(c.year)} ${escHtml(c.make)} ${escHtml(c.model)}</span>
          <span style="font-size:9px;padding:1px 7px;border-radius:2px;background:rgba(0,0,0,.35);border:1px solid ${tColor};color:${tColor}">${trendIcon} ${escHtml(c.val.trend||'')}</span>
          <span style="font-size:11px;font-weight:700;color:${c.color};margin-left:auto">${fmt$(c.val.avg)}</span>
          <span style="font-size:10px;color:var(--text-muted)">${fmt$(c.val.low)} – ${fmt$(c.val.high)}</span>
        </div>
        <div id="mkt-note-${c.id}" class="note-clamp" style="font-size:10px;color:var(--text-muted);line-height:1.6">${escHtml(c.val.market_note||'No research note available.')}</div>
        <button class="note-toggle-btn" id="mkt-note-btn-${c.id}" onclick="Dashboard._noteToggle(${c.id})">Show more</button>
        <div style="font-size:9px;color:var(--text-muted);margin-top:5px">Updated ${_fmtValDate(c.val.fetched_at)}</div>
      </div>`;
    }).join('');

    return `<div class="dash-full"><div class="dash-panel">
      <div class="dash-panel-header">
        <span class="dash-panel-title">Collectibles Market Intelligence</span>
        <span style="font-size:10px;color:var(--text-muted)">Live auction comps · AI valuation research · ${collectibles.length} vehicles</span>
      </div>
      <div class="dash-panel-body" style="padding:8px 0 0">
        <div style="margin-bottom:10px;display:flex;flex-wrap:wrap">${legend}</div>
        <div style="margin-bottom:12px;position:relative">${svgChart}</div>
        <div style="padding-top:8px;border-top:1px solid var(--border)">
          <div style="font-size:9px;color:var(--text-muted);font-weight:600;letter-spacing:.08em;margin-bottom:2px">RESEARCH NOTES</div>
          ${notes}
        </div>
      </div>
    </div></div>`;
  }

  // ── Widget: Monthly Spending Chart ────────────────
  function monthlySpendWidget(costs) {
    const now = new Date();
    const months = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
      const label = d.toLocaleDateString('en-US', { month: 'short' });
      months.push({ key, label, value: 0 });
    }
    for (const c of costs) {
      if (!c.date) continue;
      const key = c.date.substring(0, 7);
      const m = months.find(m => m.key === key);
      if (m) m.value += c.amount || 0;
    }
    const totalMonth = months[months.length - 1].value;
    const prev = months[months.length - 2].value;
    const delta = prev > 0 ? ((totalMonth - prev) / prev * 100).toFixed(0) : null;
    const deltaHtml = delta !== null
      ? `<span style="font-size:10px;color:${+delta > 0 ? 'var(--red)' : 'var(--green)'};margin-left:6px">${+delta > 0 ? '▲' : '▼'} ${Math.abs(delta)}% vs last mo</span>`
      : '';

    return `<div class="dash-panel">
      <div class="dash-panel-header">
        <span class="dash-panel-title">Monthly Spending (Trailing 12 Mo)</span>
        <span style="font-size:11px;color:var(--accent)">${fmt$(totalMonth)} this mo ${deltaHtml}</span>
      </div>
      <div class="dash-panel-body" style="padding:8px 0 0">
        ${barChart(months)}
      </div>
    </div>`;
  }

  // ── Widget: Spending by Category ──────────────────
  function spendByCatWidget(costs) {
    const catMap = {};
    for (const c of costs) {
      const cat = c.category || 'Uncategorized';
      catMap[cat] = (catMap[cat] || 0) + (c.amount || 0);
    }
    const sorted = Object.entries(catMap).sort((a,b) => b[1]-a[1]).slice(0, 8);
    const segments = sorted.map(([cat, value], i) => ({ cat, value, color: COLORS[i % COLORS.length] }));
    const total = segments.reduce((s, x) => s + x.value, 0);
    const centerLabel = total >= 1000 ? '$' + (total/1000).toFixed(1) + 'k' : '$' + Math.round(total);

    const legend = segments.map(s => `
      <div style="display:flex;align-items:center;gap:6px;padding:3px 0">
        <span style="width:8px;height:8px;border-radius:2px;background:${s.color};flex-shrink:0"></span>
        <span style="font-size:10px;color:var(--text);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(s.cat)}</span>
        <span style="font-size:10px;color:var(--text-muted)">${fmt$(s.value)}</span>
      </div>`).join('');

    return `<div class="dash-panel">
      <div class="dash-panel-header"><span class="dash-panel-title">By Category</span></div>
      <div class="dash-panel-body" style="display:flex;flex-direction:column;align-items:center;gap:10px;padding:8px 0 0">
        ${donutChart(segments, centerLabel)}
        <div style="width:100%">${legend || '<div style="color:var(--text-muted);font-size:11px">No cost data yet.</div>'}</div>
      </div>
    </div>`;
  }

  // ── Widget: Mileage Tracker ───────────────────────
  function mileageTrackerWidget(cars) {
    const STATUS_COLOR = { Active: 'var(--green)', Restoration: 'var(--orange)', Storage: 'var(--blue)', 'For Sale': 'var(--purple)' };
    const sorted = [...cars].sort((a,b) => parseInt(String(b.mileage).replace(/\D/g,''),10)||0 - (parseInt(String(a.mileage).replace(/\D/g,''),10)||0));
    const maxMi = Math.max(...cars.map(c => parseInt(String(c.mileage).replace(/\D/g,''),10)||0), 1);

    const rows = sorted.map(c => {
      const mi = parseInt(String(c.mileage).replace(/\D/g,''),10) || 0;
      const pct = Math.min(100, (mi / maxMi) * 100).toFixed(1);
      const color = STATUS_COLOR[c.status] || 'var(--accent)';
      return `<div style="display:flex;align-items:center;gap:10px;padding:5px 0;border-bottom:1px solid var(--border)">
        <div style="min-width:130px;max-width:140px">
          <div style="font-size:11px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(c.year)} ${escHtml(c.make)} ${escHtml(c.model)}</div>
        </div>
        <div class="mile-bar-track">
          <div class="mile-bar-fill" style="width:${pct}%;background:${color}"></div>
        </div>
        <div style="min-width:68px;text-align:right;font-size:11px;color:var(--text-muted)">${mi.toLocaleString()} mi</div>
      </div>`;
    }).join('');

    return `<div class="dash-full"><div class="dash-panel">
      <div class="dash-panel-header"><span class="dash-panel-title">Mileage Tracker</span></div>
      <div class="dash-panel-body" style="padding:4px 0 0">
        ${rows || '<div style="color:var(--text-muted);font-size:12px;padding:8px 0">No cars in fleet.</div>'}
      </div>
    </div></div>`;
  }

  // ── Widget: Fleet Health Scores ───────────────────
  function fleetHealthWidget(cars, maint) {
    function score(car) {
      let s = 0;
      if (car.vin && car.vin.trim()) s += 20;
      const regD = parseMixedDate(car.registration);
      if (regD && regD >= new Date()) s += 20;
      const insD = parseMixedDate(car.insurance);
      if (insD && insD >= new Date()) s += 20;
      const carMaint = maint.filter(m => m.car_id === car.id && !m.completed);
      const overdue = carMaint.some(m => { const d = daysUntil(m.due_date); return d !== null && d < 0; });
      if (!overdue) s += 20;
      if (car.status === 'Active') s += 20;
      else if (car.status === 'Storage' || car.status === 'Restoration') s += 10;
      return Math.min(100, s);
    }
    function scoreColor(s) {
      if (s >= 80) return 'var(--green)';
      if (s >= 60) return 'var(--accent)';
      if (s >= 40) return 'var(--orange)';
      return 'var(--red)';
    }

    const rows = cars.map(c => {
      const s = score(c);
      const color = scoreColor(s);
      return `<div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid var(--border)">
        <div style="min-width:110px;max-width:120px">
          <div style="font-size:11px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(c.year)} ${escHtml(c.make)}</div>
          <div style="font-size:10px;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(c.model)}</div>
        </div>
        <div class="health-bar-track">
          <div class="health-bar-fill" style="width:${s}%;background:${color}"></div>
        </div>
        <div style="min-width:38px;text-align:right;font-size:12px;font-weight:700;color:${color}">${s}</div>
      </div>`;
    }).join('');

    return `<div class="dash-panel">
      <div class="dash-panel-header">
        <span class="dash-panel-title">Fleet Health</span>
        <span style="font-size:9px;color:var(--text-muted)">VIN · Reg · Ins · Maint · Status</span>
      </div>
      <div class="dash-panel-body" style="padding:4px 0 0">
        ${rows || '<div style="color:var(--text-muted);font-size:12px;padding:8px 0">No cars in fleet.</div>'}
      </div>
    </div>`;
  }

  // ── Widget: Expiry Alerts ─────────────────────────
  function expiryAlertsWidget(cars) {
    const alerts = [];
    for (const c of cars) {
      const name = `${c.year} ${c.make} ${c.model}`;
      if (c.registration) {
        const d = daysFromNow(c.registration);
        alerts.push({ name, label: 'Registration', date: c.registration, days: d });
      }
      if (c.insurance) {
        const d = daysFromNow(c.insurance);
        alerts.push({ name, label: 'Insurance', date: c.insurance, days: d });
      }
    }
    alerts.sort((a,b) => (a.days ?? 9999) - (b.days ?? 9999));

    function alertColor(d) {
      if (d === null) return 'var(--text-muted)';
      if (d < 0)  return 'var(--red)';
      if (d <= 30) return 'var(--orange)';
      return 'var(--green)';
    }
    function alertLabel(d) {
      if (d === null) return '—';
      if (d < 0)  return `Expired ${Math.abs(d)}d ago`;
      if (d === 0) return 'Expires today';
      if (d === 1) return 'Expires tomorrow';
      return `${d}d left`;
    }

    const rows = alerts.map(a => {
      const color = alertColor(a.days);
      return `<div class="dash-row">
        <div>
          <div class="dash-row-label">${escHtml(a.name)}</div>
          <div class="dash-row-meta">${escHtml(a.label)} · ${escHtml(a.date)}</div>
        </div>
        <div style="font-size:10px;font-weight:600;color:${color};text-align:right;white-space:nowrap">${alertLabel(a.days)}</div>
      </div>`;
    }).join('');

    return `<div class="dash-panel">
      <div class="dash-panel-header"><span class="dash-panel-title">Expiry Alerts</span></div>
      <div class="dash-panel-body">
        ${rows || '<div style="color:var(--text-muted);font-size:12px;padding:8px 0">No registration or insurance dates on file.</div>'}
      </div>
    </div>`;
  }

  // ── Widget: Acquisition Watchlist ─────────────────
  function watchlistWidget(items) {
    function priorityBadge(p) {
      const cls = { High: 'badge-priority-high', Medium: 'badge-priority-medium', Low: 'badge-priority-low' };
      return `<span class="badge ${cls[p] || 'badge-neutral'}">${escHtml(p)}</span>`;
    }

    const rows = items.map(w => `
      <div class="dash-row" style="align-items:flex-start">
        <div style="flex:1;min-width:0">
          <div class="dash-row-label">${escHtml(w.year ? w.year+' ' : '')}${escHtml(w.make)} ${escHtml(w.model)}</div>
          <div class="dash-row-meta">${w.source ? escHtml(w.source)+' · ' : ''}${w.asking_price ? fmt$(w.asking_price) : 'Price TBD'}</div>
        </div>
        <div style="display:flex;gap:4px;align-items:center;flex-shrink:0">
          ${priorityBadge(w.priority)}
          <button class="btn btn-secondary btn-sm" onclick="Dashboard.watchlistEdit(${w.id})" style="padding:2px 6px;font-size:10px">Edit</button>
          <button class="btn btn-danger btn-sm" onclick="Dashboard.watchlistDel(${w.id})" style="padding:2px 6px;font-size:10px">✕</button>
        </div>
      </div>`).join('');

    return `<div class="dash-panel">
      <div class="dash-panel-header">
        <span class="dash-panel-title">Acquisition Watchlist</span>
        <button class="btn btn-primary btn-sm" onclick="Dashboard.watchlistAdd()" style="font-size:10px;padding:3px 8px">+ Add</button>
      </div>
      <div class="dash-panel-body">
        ${rows || '<div style="color:var(--text-muted);font-size:12px;padding:8px 0">No vehicles on watchlist.</div>'}
      </div>
    </div>`;
  }

  // ── Widget: Activity Feed ─────────────────────────
  function activityFeedWidget(cars, maint, parts, tools, cleaning, costs, events) {
    const items = [];
    const push = (arr, fn) => [...arr].slice(-4).reverse().forEach(r => items.push({ id: r.id, ...fn(r) }));

    push(cars,     c => ({ icon: '◉', label: `${c.year||''} ${c.make} ${c.model}`.trim(), sub: c.status, color: 'var(--green)' }));
    push(maint,    m => ({ icon: '⚙', label: m.title, sub: m.car_name || 'General', color: 'var(--orange)' }));
    push(parts,    p => ({ icon: '⊞', label: p.name, sub: p.car_name || 'Spare part', color: 'var(--accent)' }));
    push(tools,    t => ({ icon: '⊕', label: t.name, sub: t.category || 'Tool', color: 'var(--accent)' }));
    push(cleaning, c => ({ icon: '◎', label: c.product, sub: c.brand || 'Supply', color: 'var(--blue)' }));
    push(costs,    c => ({ icon: '$', label: c.description, sub: fmt$(c.amount), color: 'var(--purple)' }));
    push(events,   e => ({ icon: '◷', label: e.title, sub: e.type || 'Event', color: 'var(--accent)' }));

    items.sort((a, b) => b.id - a.id);
    const feed = items.slice(0, 10).map(it => `
      <div class="activity-item">
        <div class="activity-icon" style="color:${it.color}">${it.icon}</div>
        <div>
          <div class="activity-label">${escHtml(it.label)}</div>
          <div class="activity-sub">${escHtml(it.sub)}</div>
        </div>
      </div>`).join('');

    return `<div class="dash-panel">
      <div class="dash-panel-header"><span class="dash-panel-title">Activity Feed</span></div>
      <div class="dash-panel-body" style="padding:4px 0 0">
        ${feed || '<div style="color:var(--text-muted);font-size:12px;padding:8px 0">No activity yet.</div>'}
      </div>
    </div>`;
  }

  function _fmtValDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  // ── Widget helpers: per-category value panel ─────
  function _fleetValuePanel(title, accentVar, sectionCars, maxVal, valuationMap = {}) {
    const valued   = sectionCars.filter(c => c.value > 0 || c.purchase_price > 0 || valuationMap[c.id]).sort((a, b) => {
      const aM = valuationMap[a.id]?.avg || a.value || 0;
      const bM = valuationMap[b.id]?.avg || b.value || 0;
      return bM - aM;
    });
    const totalMarket = valued.reduce((s, c) => s + (valuationMap[c.id]?.avg || c.value || 0), 0);
    const totalPaid   = valued.reduce((s, c) => s + (c.purchase_price || 0), 0);
    const unvalued = sectionCars.length - valued.length;

    const rows = valued.map(c => {
      const market = valuationMap[c.id]?.avg || c.value || 0;
      const paid   = c.purchase_price || 0;
      const pct    = Math.min(100, (market / maxVal) * 100).toFixed(1);
      const delta  = paid > 0 && market > 0 ? market - paid : null;
      const deltaColor = delta === null ? '' : delta >= 0 ? 'var(--green)' : 'var(--red)';
      const deltaSign  = delta !== null && delta >= 0 ? '+' : '';

      return `<div style="padding:6px 0;border-bottom:1px solid var(--border)">
        <div style="display:flex;justify-content:space-between;margin-bottom:4px;gap:8px">
          <span style="font-size:11px;color:var(--text);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(c.year)} ${escHtml(c.make)} ${escHtml(c.model)}</span>
          <div style="text-align:right;flex-shrink:0">
            <span style="font-size:12px;color:${accentVar};font-weight:600">${market ? fmt$(market) : '—'}</span>
            ${paid ? `<span style="font-size:10px;color:var(--text-muted);margin-left:6px">pd ${fmt$(paid)}</span>` : ''}
            ${delta !== null ? `<span style="font-size:10px;font-weight:600;color:${deltaColor};margin-left:4px">${deltaSign}${fmt$(delta)}</span>` : ''}
          </div>
        </div>
        <div class="value-bar-track">
          <div class="value-bar-fill" style="width:${pct}%;background:${accentVar}"></div>
        </div>
        ${valuationMap[c.id]?.fetched_at ? `<div style="font-size:9px;color:var(--text-muted);margin-top:2px">Updated ${_fmtValDate(valuationMap[c.id].fetched_at)}</div>` : ''}
      </div>`;
    }).join('');

    const note = unvalued > 0
      ? `<div style="font-size:10px;color:var(--text-muted);margin-top:8px">${unvalued} car${unvalued>1?'s':''} without value set</div>`
      : '';

    const headerSub = totalPaid > 0
      ? `<span style="font-size:10px;color:var(--text-muted);margin-left:8px">pd ${fmt$(totalPaid)}</span>`
      : '';

    const empty = sectionCars.length === 0
      ? `<div style="color:var(--text-muted);font-size:12px;padding:8px 0">No cars in this category.</div>`
      : (!rows ? `<div style="color:var(--text-muted);font-size:12px;padding:8px 0">No values set — edit a car to add one.</div>` : '');

    return `<div class="dash-panel">
      <div class="dash-panel-header">
        <span class="dash-panel-title" style="color:${accentVar}">${title}</span>
        <span style="font-size:13px;font-weight:700;color:${accentVar}">${fmt$(totalMarket)}${headerSub}</span>
      </div>
      <div class="dash-panel-body" style="padding:4px 0 0">
        ${rows}${empty}${note}
      </div>
    </div>`;
  }

  // ── Widget: Collection Value ──────────────────────
  function collectionValueWidget(cars, valuationMap = {}) {
    const ownedCars  = cars.filter(c => c.category !== 'Lease');
    const maxVal     = Math.max(...ownedCars.map(c => valuationMap[c.id]?.avg || c.value || 0), 1);
    const collectables = ownedCars.filter(c => c.category === 'Collectable');
    return _fleetValuePanel('⭐ Collection', 'var(--accent)', collectables, maxVal, valuationMap);
  }

  // ── Widget: Daily Fleet Value ─────────────────────
  function dailyFleetValueWidget(cars, valuationMap = {}) {
    const ownedCars = cars.filter(c => c.category !== 'Lease');
    const maxVal    = Math.max(...ownedCars.map(c => valuationMap[c.id]?.avg || c.value || 0), 1);
    const dailies   = ownedCars.filter(c => c.category === 'Daily');
    return _fleetValuePanel('Daily Drivers', 'var(--blue)', dailies, maxVal, valuationMap);
  }

  // ── Widget: Upcoming Events ───────────────────────
  function upcomingEventsWidget(events) {
    const TYPE_COLOR = { 'Car Show': 'var(--orange)', 'Track Day': 'var(--red)', 'Service': 'var(--accent)', 'Rally': 'var(--green)', 'Other': 'var(--text-muted)' };
    const upcoming = events
      .filter(e => { const d = daysUntil(e.date); return d !== null && d >= 0; })
      .sort((a,b) => (a.date||'').localeCompare(b.date||''));

    function badge(type) {
      const color = TYPE_COLOR[type] || 'var(--text-muted)';
      return `<span style="font-size:9px;padding:1px 5px;border-radius:2px;background:rgba(0,0,0,.3);border:1px solid ${color};color:${color}">${escHtml(type||'Event')}</span>`;
    }

    const rows = upcoming.slice(0, 8).map(e => {
      const d = daysUntil(e.date);
      const countdown = d === 0 ? '<span style="color:var(--orange);font-size:10px;font-weight:700">Today</span>'
        : d === 1 ? '<span style="color:var(--orange);font-size:10px">Tomorrow</span>'
        : `<span style="font-size:10px;color:${d<=7?'var(--orange)':'var(--text-muted)'}">in ${d}d</span>`;
      return `<div class="dash-row">
        <div>
          <div class="dash-row-label" style="display:flex;align-items:center;gap:6px">
            ${escHtml(e.title)} ${badge(e.type)}
          </div>
          <div class="dash-row-meta">${e.location ? escHtml(e.location)+' · ' : ''}${fmtDate(e.date)}</div>
        </div>
        <div>${countdown}</div>
      </div>`;
    }).join('');

    return `<div class="dash-panel">
      <div class="dash-panel-header">
        <span class="dash-panel-title">Upcoming Events</span>
        <span style="font-size:11px;color:var(--text-muted)">${upcoming.length} total</span>
      </div>
      <div class="dash-panel-body">
        ${rows || '<div style="color:var(--text-muted);font-size:12px;padding:8px 0">No upcoming events.</div>'}
      </div>
    </div>`;
  }

  // ── Widget: Pending Maintenance ───────────────────
  function pendingMaintWidget(maint) {
    function badge(status) {
      const map = { overdue: 'badge-overdue', 'due-soon': 'badge-due-soon', upcoming: 'badge-upcoming' };
      const labels = { overdue: 'Overdue', 'due-soon': 'Due Soon', upcoming: 'Upcoming' };
      return `<span class="badge ${map[status]||'badge-neutral'}">${labels[status]||status}</span>`;
    }
    const pending = maint.filter(m => !m.completed);
    const rows = pending.slice(0, 6).map(m => {
      const d = daysUntil(m.due_date);
      const status = d === null ? 'upcoming' : d < 0 ? 'overdue' : d <= 14 ? 'due-soon' : 'upcoming';
      return `<div class="dash-row">
        <div>
          <div class="dash-row-label">${escHtml(m.title)}</div>
          <div class="dash-row-meta">${escHtml(m.car_name||'General')} · ${fmtDate(m.due_date)}</div>
        </div>
        <div>${badge(status)}</div>
      </div>`;
    }).join('');
    return `<div class="dash-panel">
      <div class="dash-panel-header">
        <span class="dash-panel-title">Pending Maintenance</span>
        <span style="font-size:11px;color:var(--text-muted)">${pending.length} tasks</span>
      </div>
      <div class="dash-panel-body">
        ${rows || '<div style="color:var(--text-muted);font-size:12px;padding:8px 0">All clear — no pending tasks.</div>'}
      </div>
    </div>`;
  }

  // ── Widget: Fleet Status ──────────────────────────
  function fleetStatusWidget(cars) {
    const STATUS_BADGE = {
      Active:      'badge-active',
      Restoration: 'badge-restoration',
      Storage:     'badge-storage',
      'For Sale':  'badge-for-sale',
    };

    const sorted = [...cars].sort((a, b) => (b.value || 0) - (a.value || 0));
    const top    = sorted.slice(0, 5);
    const rest   = sorted.slice(5);

    function row(c) {
      return `<div class="dash-row">
        <div>
          <div class="dash-row-label">${escHtml(c.year)} ${escHtml(c.make)} ${escHtml(c.model)}</div>
          <div class="dash-row-meta">${escHtml(c.color||'—')} · ${escHtml(c.mileage||'0')} mi${c.value ? ' · ' + fmt$(c.value) : ''}</div>
        </div>
        <span class="badge ${STATUS_BADGE[c.status]||'badge-neutral'}">${escHtml(c.status)}</span>
      </div>`;
    }

    const restHtml = rest.length ? `
      <div id="fleet-extra" style="display:none">${rest.map(row).join('')}</div>
      <div style="padding:8px 0 2px;text-align:center">
        <button onclick="
          const el=document.getElementById('fleet-extra');
          const btn=this;
          if(el.style.display==='none'){el.style.display='';btn.textContent='Show less ▲';}
          else{el.style.display='none';btn.textContent='Show ${rest.length} more ▼';}
        " style="background:none;border:1px solid var(--border-light);color:var(--accent);font-size:11px;padding:4px 14px;border-radius:3px;cursor:pointer">
          Show ${rest.length} more ▼
        </button>
      </div>` : '';

    return `<div class="dash-panel">
      <div class="dash-panel-header">
        <span class="dash-panel-title">Fleet Status</span>
        <span style="font-size:11px;color:var(--text-muted)">${cars.length} vehicles</span>
      </div>
      <div class="dash-panel-body">
        ${sorted.length === 0
          ? '<div style="color:var(--text-muted);font-size:12px;padding:8px 0">No cars added yet.</div>'
          : top.map(row).join('') + restHtml}
      </div>
    </div>`;
  }

  // ── Watchlist CRUD helpers ────────────────────────
  function watchlistFormHtml(w = {}) {
    const PRI = ['High','Medium','Low'];
    const priOpts = PRI.map(p => `<option value="${p}" ${w.priority===p?'selected':''}>${p}</option>`).join('');
    return `
      <div class="form-row-2">
        <div class="form-row"><label>Year</label><input type="text" id="wl-year" value="${escHtml(w.year||'')}" placeholder="2024" maxlength="4"></div>
        <div class="form-row"><label>Priority</label><select id="wl-priority">${priOpts}</select></div>
      </div>
      <div class="form-row-2">
        <div class="form-row"><label>Make</label><input type="text" id="wl-make" value="${escHtml(w.make||'')}" placeholder="Porsche"></div>
        <div class="form-row"><label>Model</label><input type="text" id="wl-model" value="${escHtml(w.model||'')}" placeholder="911"></div>
      </div>
      <div class="form-row-2">
        <div class="form-row"><label>Asking Price ($)</label><input type="number" id="wl-price" value="${w.asking_price||''}" placeholder="0" min="0" step="100"></div>
        <div class="form-row"><label>Source</label><input type="text" id="wl-source" value="${escHtml(w.source||'')}" placeholder="BaT, dealer, private…"></div>
      </div>
      <div class="form-row"><label>Notes</label><textarea id="wl-notes">${escHtml(w.notes||'')}</textarea></div>`;
  }

  function collectWatchlist() {
    return {
      year:         document.getElementById('wl-year').value.trim(),
      make:         document.getElementById('wl-make').value.trim(),
      model:        document.getElementById('wl-model').value.trim(),
      asking_price: parseFloat(document.getElementById('wl-price').value) || 0,
      source:       document.getElementById('wl-source').value.trim(),
      priority:     document.getElementById('wl-priority').value,
      notes:        document.getElementById('wl-notes').value.trim(),
    };
  }

  // ── Main load ─────────────────────────────────────
  async function load() {
    const el = document.getElementById('dashboard-content');
    try {
      const [cars, maint, parts, tools, cleaning, costs, events, watchlist, marketVals, marketHistory] = await Promise.all([
        API.get('/api/cars'),
        API.get('/api/maintenance'),
        API.get('/api/parts'),
        API.get('/api/tools'),
        API.get('/api/cleaning'),
        API.get('/api/expenses'),
        API.get('/api/events'),
        API.get('/api/watchlist'),
        API.get('/api/market').catch(() => []),
        API.get('/api/market/history').catch(() => []),
      ]);
      const valuationMap = {};
      marketVals.forEach(v => { valuationMap[v.car_id] = v; });

      el.innerHTML =
        hudWidget(cars, maint, parts, tools, cleaning, costs, events, watchlist, valuationMap) +
        collectiblesMarketWidget(cars, valuationMap, marketHistory) +
        '<div class="dash-grid-2-wide" style="margin-top:12px">' +
          monthlySpendWidget(costs) +
          spendByCatWidget(costs) +
        '</div>' +
        '<div class="dash-full">' + fleetStatusWidget(cars) + '</div>' +
        mileageTrackerWidget(cars) +
        '<div class="dash-full">' + watchlistWidget(watchlist) + '</div>' +
        '<div class="dash-grid-2">' +
          collectionValueWidget(cars, valuationMap) +
          dailyFleetValueWidget(cars, valuationMap) +
        '</div>' +
        '<div class="dash-full">' + upcomingEventsWidget(events) + '</div>' +
        '<div class="dash-full">' + pendingMaintWidget(maint) + '</div>';
      startHudClock();
      _initMktChart();
    } catch (err) {
      if (err.message === 'Session expired') return;
      el.innerHTML = `<div style="color:var(--red);padding:20px">Failed to load dashboard: ${escHtml(err.message)}<br>
        <button class="btn btn-secondary" style="margin-top:12px" onclick="Dashboard.load()">Retry</button></div>`;
    }
  }

  // ── Watchlist public actions ──────────────────────
  function watchlistAdd() {
    Modal.show('Add to Watchlist', watchlistFormHtml(), async () => {
      const data = collectWatchlist();
      if (!data.make || !data.model) { Toast.show('Make and model are required', 'error'); return; }
      try {
        await API.post('/api/watchlist', data);
        Modal.hide();
        Toast.show('Added to watchlist');
        load();
        App.refreshBadges();
      } catch (e) { Toast.show('Failed to save', 'error'); }
    });
  }

  async function watchlistEdit(id) {
    let item;
    try { item = await API.get(`/api/watchlist`); item = item.find(w => w.id === id); } catch(e) { return; }
    if (!item) return;
    Modal.show('Edit Watchlist Item', watchlistFormHtml(item), async () => {
      const data = collectWatchlist();
      if (!data.make || !data.model) { Toast.show('Make and model are required', 'error'); return; }
      try {
        await API.put(`/api/watchlist/${id}`, data);
        Modal.hide();
        Toast.show('Watchlist updated');
        load();
      } catch (e) { Toast.show('Failed to update', 'error'); }
    });
  }

  async function watchlistDel(id) {
    if (!confirm('Remove from watchlist?')) return;
    try {
      await API.del(`/api/watchlist/${id}`);
      Toast.show('Removed from watchlist');
      load();
      App.refreshBadges();
    } catch (e) { Toast.show('Failed to delete', 'error'); }
  }

  return { load, watchlistAdd, watchlistEdit, watchlistDel, _mktToggle, _noteToggle };
})();
