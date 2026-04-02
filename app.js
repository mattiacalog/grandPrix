// ─── CONFIG ──────────────────────────────────────────────────────────────────
const DATA_URL = window.DATA_FILE ? `./data/${window.DATA_FILE}` : './data/data.json';
const BAR_H    = 58;
const BAR_GAP  = 12;
// F1 car SVG (top-down view, front faces right)
function f1Car(color) {
    var c = color || '#E8002D';
    return `<svg viewBox="0 0 56 22" width="42" height="15" xmlns="http://www.w3.org/2000/svg" style="display:block;overflow:visible;pointer-events:none;">
        <rect x="0.5" y="1.5" width="4" height="19" rx="1.5" fill="${c}"/>
        <rect x="4"   y="7.5" width="8" height="7"  rx="1"   fill="${c}"/>
        <rect x="10"  y="3.5" width="15" height="5" rx="1.5" fill="${c}" opacity="0.82"/>
        <rect x="10"  y="13.5" width="15" height="5" rx="1.5" fill="${c}" opacity="0.82"/>
        <rect x="11"  y="7.5" width="27" height="7" rx="2.5" fill="${c}"/>
        <ellipse cx="20" cy="11" rx="5" ry="2.5" fill="rgba(0,0,0,0.55)"/>
        <path d="M38 9 L50 10.3 L50 11.7 L38 13 Z" fill="${c}"/>
        <rect x="50"  y="3.5" width="5"  height="15" rx="1.5" fill="${c}"/>
    </svg>`;
}
const OUR_ID   = 'achivieneaprenderlo';

// ─── STATE ───────────────────────────────────────────────────────────────────
let groups = [], snapshots = [];
let current = 0, playing = false, playTimer = null, chart = null;
let modalPeriod = 7;
let prevRanks = {};
let gapMode = 'interval'; // 'interval' | 'leader'
let initialRender = true;

// ─── UTILS ───────────────────────────────────────────────────────────────────
const fmt     = n  => Math.round(n).toLocaleString('it-IT');
const fmtSign = n  => n === null || n === undefined ? '--' : (n >= 0 ? `+${fmt(n)}` : fmt(n));
const fmtPct  = n  => n === null ? '--' : `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;
const fmtAvg  = n  => n === null ? '--' : `${fmtSign(Math.round(n))}/g`;

function parseDate(str) {
    const [y, m, d] = str.split('-').map(Number);
    return new Date(y, m - 1, d);
}
function fmtDate(str) {
    return parseDate(str).toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' });
}
function hexToRgb(hex) {
    const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
    return `${r},${g},${b}`;
}

function animateCount(el, to, duration) {
    duration = duration || 1400;
    var start = performance.now();
    function step(now) {
        var t = Math.min((now - start) / duration, 1);
        var eased = 1 - Math.pow(1 - t, 3);
        el.textContent = fmt(Math.round(to * eased));
        if (t < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
}

// ─── STAT HELPERS ────────────────────────────────────────────────────────────

function latestSnap() { return snapshots[snapshots.length - 1]; }

/** Returns the closest snapshot at least daysAgo before the latest, or null */
function getSnapshotBefore(daysAgo) {
    if (snapshots.length < 2) return null;
    const latest = parseDate(snapshots[snapshots.length - 1].date);
    const target = new Date(latest);
    target.setDate(target.getDate() - daysAgo);
    let best = null;
    for (let i = 0; i < snapshots.length - 1; i++) {
        if (parseDate(snapshots[i].date) <= target) best = snapshots[i];
    }
    // If no snapshot old enough, return the oldest available (so we always show something)
    return best ?? (snapshots.length > 1 ? snapshots[0] : null);
}

function absGrowth(groupId, from, to) {
    if (!from || !to) return null;
    return (to.data[groupId] || 0) - (from.data[groupId] || 0);
}

function pctGrowth(groupId, from, to) {
    if (!from || !to) return null;
    const f = from.data[groupId] || 0;
    const t = to.data[groupId] || 0;
    if (f === 0) return null;
    return ((t - f) / f) * 100;
}

function daysBetween(s1, s2) {
    return (parseDate(s2.date) - parseDate(s1.date)) / 86400000;
}

function avgDailyGrowth(groupId, from, to) {
    const g = absGrowth(groupId, from, to);
    if (g === null) return null;
    const days = daysBetween(from, to);
    if (days === 0) return null;
    return g / days;
}

/** Best single day: max daily delta across all snapshots (ignores from/to, uses full history) */
function bestDayGrowth(groupId) {
    let best = null, bestDate = null;
    for (let i = 1; i < snapshots.length; i++) {
        const d = (snapshots[i].data[groupId] || 0) - (snapshots[i-1].data[groupId] || 0);
        if (d > 0 && (best === null || d > best)) { best = d; bestDate = snapshots[i].date; }
    }
    return { val: best, date: bestDate };
}

/** Standard deviation of daily growth across snapshots in range */
function growthStdDev(groupId, from, to) {
    const inRange = snapshots.filter(s => {
        const d = parseDate(s.date);
        return d >= parseDate(from.date) && d <= parseDate(to.date);
    });
    if (inRange.length < 3) return null;
    const dailyGrowths = [];
    for (let i = 1; i < inRange.length; i++) {
        const g = absGrowth(groupId, inRange[i-1], inRange[i]);
        if (g !== null) dailyGrowths.push(g);
    }
    if (dailyGrowths.length < 2) return null;
    const mean = dailyGrowths.reduce((a, b) => a + b, 0) / dailyGrowths.length;
    const variance = dailyGrowths.reduce((a, b) => a + (b - mean) ** 2, 0) / dailyGrowths.length;
    return Math.sqrt(variance);
}

/** Returns { groupId: rank (1-based) } — lower is better */
function getRankAt(snap) {
    const sorted = [...groups].sort((a, b) => (snap.data[b.id]||0) - (snap.data[a.id]||0));
    const ranks = {};
    sorted.forEach((g, i) => ranks[g.id] = i + 1);
    return ranks;
}

/** How many groups did we overtake from fromSnap to toSnap? */
function countOvertakes(groupId, from, to) {
    if (!from || !to) return 0;
    const fromRanks = getRankAt(from);
    const toRanks   = getRankAt(to);
    const ourFrom = fromRanks[groupId];
    const ourTo   = toRanks[groupId];
    return groups.filter(g => g.id !== groupId
        && fromRanks[g.id] < ourFrom   // they were ahead
        && toRanks[g.id]   > ourTo     // now we are ahead
    ).length;
}

// ─── HERO STRIP ──────────────────────────────────────────────────────────────

// ─── BATTLE FORECAST ─────────────────────────────────────────────────────────

function renderBattleForecast() {
    const to      = latestSnap();
    const from30  = getSnapshotBefore(30);
    const ranks   = getRankAt(to);
    const sorted  = [...groups].sort((a, b) => (to.data[b.id]||0) - (to.data[a.id]||0));
    const ourRank = ranks[OUR_ID]; // 1-based
    const ourIdx  = ourRank - 1;

    // Populate target selector with groups above us
    const sel = document.getElementById('bf-target-sel');
    if (sel && sel.options.length === 0) {
        const above = sorted.slice(0, ourIdx);
        above.forEach((g, i) => {
            const opt = document.createElement('option');
            opt.value = g.id;
            opt.textContent = g.name;
            if (i === above.length - 1) opt.selected = true; // default: immediately ahead
            sel.appendChild(opt);
        });
        sel.addEventListener('change', renderBattleForecast);
    }

    const targetId = sel ? sel.value : null;
    if (!targetId) return;

    const targetGroup = groups.find(g => g.id === targetId);
    const ourVal      = to.data[OUR_ID]    || 0;
    const themVal     = to.data[targetId]  || 0;
    const gap         = themVal - ourVal;

    // Avg daily growth over 30d
    const ourAvg  = from30 ? (absGrowth(OUR_ID,   from30, to) / Math.max(1, daysBetween(from30, to))) : 0;
    const themAvg = from30 ? (absGrowth(targetId,  from30, to) / Math.max(1, daysBetween(from30, to))) : 0;
    const netGain = ourAvg - themAvg;

    // Days to catch up
    let days = null, verdict = 'NEVER', unit = '', diffPct = 100;
    if (netGain > 0) {
        days = Math.ceil(gap / netGain);
        if (days <= 7)       { verdict = 'STRIKING DISTANCE'; unit = 'GIORNI'; diffPct = 15; }
        else if (days <= 30) { verdict = 'IN AVVICINAMENTO';  unit = 'GIORNI'; diffPct = 40; }
        else if (days <= 90) { verdict = 'DISTANZA MEDIA';    unit = 'GIORNI'; diffPct = 65; }
        else                 { verdict = 'DISTANZA ELEVATA';  unit = 'GIORNI'; diffPct = 85; }
    } else {
        verdict = 'SI ALLONTANA'; unit = ''; diffPct = 100;
    }

    // Update UI
    document.getElementById('bf-name-us').textContent  = 'A chi viene a prenderlo';
    document.getElementById('bf-pos-us').textContent   = `#${ourRank}`;
    document.getElementById('bf-gap-them').textContent = `+${fmt(gap)}`;
    document.getElementById('bf-verdict-lbl').textContent = verdict;
    document.getElementById('bf-days').textContent     = days !== null ? days : '∞';
    document.getElementById('bf-unit').textContent     = unit;
    document.getElementById('bf-diff-fill').style.width = `${diffPct}%`;
    document.getElementById('bf-diff-fill').className  = `bf-diff-fill ${diffPct < 40 ? 'diff-easy' : diffPct < 70 ? 'diff-med' : 'diff-hard'}`;

    // Cars
    document.getElementById('bf-car-us').innerHTML   = f1Car('#E8002D');
    const themColor = (groups.find(g => g.id === targetId) || {}).color || '#888';
    document.getElementById('bf-car-them').innerHTML = f1Car(themColor);
    const iconThem = document.getElementById('bf-icon-them');
    if (iconThem) iconThem.src = `icons/${targetId}.jpg`;
}

function renderHeroStats() {
    const to      = latestSnap();
    const from1   = getSnapshotBefore(1);
    const from7   = getSnapshotBefore(7);
    const from30  = getSnapshotBefore(30);
    const from365 = getSnapshotBefore(365);
    const ranks   = getRankAt(to);
    const ourRank = ranks[OUR_ID];

    // Trend rank
    const trendDays = +document.getElementById('hero-trend-period').value;
    const fromTrend = getSnapshotBefore(trendDays);
    const trendSorted = [...groups].sort((a, b) =>
        (absGrowth(b.id, fromTrend, to) || 0) - (absGrowth(a.id, fromTrend, to) || 0)
    );
    const trendRank = trendSorted.findIndex(g => g.id === OUR_ID) + 1;

    // Overtakes
    const overtakeDays = +document.getElementById('hero-overtakes-period').value;
    const fromOT = getSnapshotBefore(overtakeDays);
    const overtakes = countOvertakes(OUR_ID, fromOT, to);

    // Media giornaliera
    const avgDays = +document.getElementById('hero-avg-period').value;
    const fromAvg = getSnapshotBefore(avgDays);
    const avgGrowth = fromAvg ? (absGrowth(OUR_ID, fromAvg, to) / daysBetween(fromAvg, to)).toFixed(1) : null;

    const delta1   = absGrowth(OUR_ID, from1, to);
    const delta7   = absGrowth(OUR_ID, from7, to);
    const delta30  = absGrowth(OUR_ID, from30, to);
    const delta365 = absGrowth(OUR_ID, from365, to);

    document.getElementById('hero-rank').textContent        = `#${ourRank}`;
    document.getElementById('hero-total').textContent       = fmt(to.data[OUR_ID] || 0);
    document.getElementById('hero-trend-rank').textContent  = `#${trendRank}`;
    document.getElementById('hero-overtakes').textContent   = overtakes;
    document.getElementById('hero-avg').textContent         = avgGrowth !== null ? `+${Math.round(avgGrowth)}/g` : '—';

    function setGrowth(id, val) {
        const el = document.getElementById(id);
        if (!el) return;
        el.textContent = fmtSign(val);
        el.style.color = val === null ? '#fff' : val >= 0 ? '#34d399' : '#ef4444';
    }
    setGrowth('hero-24h',   delta1);
    setGrowth('hero-7d',    delta7);
    setGrowth('hero-30d',   delta30);
    setGrowth('hero-365d',  delta365);
}

// ─── MODAL ───────────────────────────────────────────────────────────────────

function openModal()  { const el = document.getElementById('modal-overlay'); el.classList.add('open'); renderModal(modalPeriod); }
function closeModal() { document.getElementById('modal-overlay').classList.remove('open'); }

function renderModal(days) {
    modalPeriod = days;
    document.querySelectorAll('.period-tab').forEach(b => {
        const isActive = +b.dataset.days === days;
        b.classList.toggle('active', isActive);
        b.style.background    = isActive ? '#e63946' : '#161625';
        b.style.borderColor   = isActive ? '#e63946' : 'rgba(255,255,255,.07)';
        b.style.color         = isActive ? '#fff'    : '#7070a0';
    });

    const to   = latestSnap();
    const from = getSnapshotBefore(days);
    const body = document.getElementById('modal-body');

    if (!from) {
        body.innerHTML = `<div style="text-align:center;padding:40px 20px;color:#7070a0;font-family:'Inter',sans-serif;font-size:.88rem;line-height:1.6;">
            <div style="font-size:2rem;margin-bottom:12px;">⏳</div>
            Dati storici non ancora disponibili per questo periodo.<br>
            Le statistiche si popoleranno man mano che lo scraper raccoglierà dati giornalieri.
        </div>`;
        return;
    }

    body.innerHTML = [
        buildSection('Crescita assoluta', 'Quanti iscritti ha guadagnato ogni gruppo nel periodo', from, to, 'abs'),
        buildSection('Crescita %', 'Di quanto è cresciuto ogni gruppo rispetto alla sua dimensione', from, to, 'pct'),
        buildSection('Media giornaliera', 'Quanti iscritti guadagna ogni gruppo in media al giorno', from, to, 'avg'),
        buildSection('Crescita minore', 'I gruppi che hanno guadagnato meno iscritti nel periodo', from, to, 'worst'),
        buildSection('Record giornaliero', 'Il miglior singolo giorno di sempre per ogni gruppo', from, to, 'bestday'),
    ].join('');

    // Attach toggle handlers
    body.querySelectorAll('.lb-toggle').forEach(btn => {
        btn.addEventListener('click', () => {
            const section = btn.closest('.stat-section');
            const list = section.querySelector('.lb-list');
            const full = section.querySelector('.lb-full');
            const expanded = full.classList.contains('visible');
            full.classList.toggle('visible', !expanded);
            list.style.display = expanded ? '' : 'none';
            btn.textContent = expanded ? `▼ Mostra tutti ${groups.length}` : '▲ Mostra meno';
        });
    });
}

function buildSection(title, subtitle, from, to, type) {
    let sorted, valueFn, fmtFn;

    if (type === 'abs') {
        sorted  = [...groups].sort((a, b) => (absGrowth(b.id, from, to)||0) - (absGrowth(a.id, from, to)||0));
        valueFn = g => absGrowth(g.id, from, to);
        fmtFn   = v => fmtSign(v);
    } else if (type === 'pct') {
        sorted  = [...groups].sort((a, b) => (pctGrowth(b.id, from, to)||0) - (pctGrowth(a.id, from, to)||0));
        valueFn = g => pctGrowth(g.id, from, to);
        fmtFn   = v => fmtPct(v);
    } else if (type === 'avg') {
        sorted  = [...groups].sort((a, b) => (avgDailyGrowth(b.id, from, to)||0) - (avgDailyGrowth(a.id, from, to)||0));
        valueFn = g => avgDailyGrowth(g.id, from, to);
        fmtFn   = v => v === null ? '--' : `+${Math.round(v)}/g`;
    } else if (type === 'worst') {
        sorted  = [...groups].sort((a, b) => (absGrowth(a.id, from, to)||0) - (absGrowth(b.id, from, to)||0));
        valueFn = g => absGrowth(g.id, from, to);
        fmtFn   = v => fmtSign(v);
    } else if (type === 'bestday') {
        sorted  = [...groups].sort((a, b) => (bestDayGrowth(b.id).val||0) - (bestDayGrowth(a.id).val||0));
        valueFn = g => bestDayGrowth(g.id);
        fmtFn   = v => {
            if (!v || v.val === null) return '--';
            const d = parseDate(v.date).toLocaleDateString('it-IT', { day: '2-digit', month: 'short' });
            return `+${fmt(v.val)} <span class="lb-val-sub">${d}</span>`;
        };
    }

    const ourIdx = sorted.findIndex(g => g.id === OUR_ID);
    const medals = ['🥇','🥈','🥉'];

    const row = (g, rank) => {
        const isOurs = g.id === OUR_ID;
        const val    = valueFn(g);
        const rankLabel = rank <= 3 ? medals[rank-1] : `#${rank}`;
        return `<div class="lb-row${isOurs ? ' lb-ours' : ''}">
            <div class="lb-rank">${rankLabel}</div>
            <div class="lb-icon" style="background-image:url('icons/${g.id}.jpg');background-size:cover;background-position:center;background-repeat:no-repeat;"></div>
            <div class="lb-name">${isOurs ? `👑 ${g.name}` : g.name}</div>
            <div class="lb-val lb-val-html">${fmtFn(val)}</div>
        </div>`;
    };

    // Sempre top 3 + nostro gruppo se fuori podio
    let listHtml = '';
    for (let i = 0; i < Math.min(3, sorted.length); i++) {
        listHtml += row(sorted[i], i + 1);
    }
    if (ourIdx >= 3) {
        listHtml += `<div class="lb-sep">· · ·</div>`;
        listHtml += row(sorted[ourIdx], ourIdx + 1);
    }

    // Full list
    const fullHtml = sorted.map((g, i) => row(g, i+1)).join('');

    return `<div class="stat-section">
        <div class="stat-section-title">${title}</div>
        <div class="stat-section-sub">${subtitle}</div>
        <div class="lb-list">${listHtml}</div>
        <div class="lb-full">${fullHtml}</div>
        <button class="lb-toggle">▼ Mostra tutti ${groups.length}</button>
    </div>`;
}

// ─── BUILD BARS ──────────────────────────────────────────────────────────────

function buildBars() {
    const container = document.getElementById('race-container');
    container.innerHTML = '';
    container.style.height = `${groups.length * (BAR_H + BAR_GAP) - BAR_GAP}px`;

    groups.forEach((g, i) => {
        const isOurs = g.id === OUR_ID;
        const row    = document.createElement('div');
        row.className = `bar-row${isOurs ? ' our-group' : ''}`;
        row.id = `row-${g.id}`;
        row.style.top = `${i * (BAR_H + BAR_GAP)}px`;

        row.innerHTML = `
            <div class="bar-rank-wrap">
                <div class="bar-rank" id="rank-${g.id}">1</div>
                <div class="pos-delta" id="posdelta-${g.id}"></div>
            </div>
            <div class="bar-icon" style="background-image:url('icons/${g.id}.jpg');background-size:cover;background-position:center;background-repeat:no-repeat;"></div>
            <div class="bar-name-wrap">
                <div class="bar-name" title="${g.name}">${g.name}</div>
                <div class="bar-badges" id="badges-${g.id}"></div>
            </div>
            <div class="bar-track">
                <div class="bar-fill" id="fill-${g.id}" style="background:${g.color || '#e63946'}; width:0%;">
                    <span class="bar-car">${f1Car(g.color || '#E8002D')}</span>
                </div>
            </div>
            <div class="bar-count-wrap">
                <div class="bar-count" id="count-${g.id}">0</div>
                <div class="bar-gap-lbl" id="gap-${g.id}"></div>
            </div>
            <div class="bar-day-delta" id="daydelta-${g.id}"></div>
        `;
        container.appendChild(row);
    });
}

// ─── RENDER SNAPSHOT ─────────────────────────────────────────────────────────

// ─── OVERTAKE PANEL ──────────────────────────────────────────────────────────
const OV_KEY = 'gp_overtakes';

function todayStr() {
    return new Date().toISOString().slice(0, 10);
}

function loadOvertakes() {
    try {
        const raw = localStorage.getItem(OV_KEY);
        if (!raw) return [];
        const obj = JSON.parse(raw);
        if (obj.date !== todayStr()) return [];
        return obj.list || [];
    } catch(e) { return []; }
}

function saveOvertake(gUp, gDown, newPos) {
    const list = loadOvertakes();
    // Avoid duplicates
    const exists = list.some(o => o.upId === gUp.id && o.downId === gDown.id);
    if (!exists) list.push({ upId: gUp.id, upName: gUp.name, downId: gDown.id, downName: gDown.name, pos: newPos });
    localStorage.setItem(OV_KEY, JSON.stringify({ date: todayStr(), list }));
}

function renderOvertakePanel() {
    const list = loadOvertakes();
    const panel = document.getElementById('overtake-panel');
    const listEl = document.getElementById('overtake-list');
    if (!panel || !listEl) return;
    if (list.length === 0) { panel.style.display = 'none'; return; }

    panel.style.display = 'block';
    listEl.innerHTML = list.map(o => {
        const colorUp   = (groups.find(g => g.id === o.upId)   || {}).color || '#E8002D';
        const colorDown = (groups.find(g => g.id === o.downId) || {}).color || '#888';
        return `
        <div class="ov-row ov-row-new">
            <div class="ov-side">
                <img class="ov-icon" src="icons/${o.upId}.jpg" alt="">
                <span class="ov-car-inline">${f1Car(colorUp)}</span>
                <span class="ov-name-full ov-name-up">${o.upName}</span>
            </div>
            <div class="ov-middle">
                <span class="ov-badge-pos">P${o.pos + 1}→P${o.pos}</span>
                <svg class="ov-chev" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
            </div>
            <div class="ov-side ov-side-down">
                <span class="ov-name-full ov-name-down">${o.downName}</span>
                <span class="ov-car-inline">${f1Car(colorDown)}</span>
                <img class="ov-icon" src="icons/${o.downId}.jpg" alt="">
            </div>
        </div>`;
    }).join('');

    // Animate new rows
    setTimeout(() => {
        listEl.querySelectorAll('.ov-row-new').forEach(r => r.classList.remove('ov-row-new'));
    }, 50);
}

function recordOvertake(gUp, gDown, newPos) {
    saveOvertake(gUp, gDown, newPos);
    renderOvertakePanel();
}

function render(index) {
    const snap      = snapshots[index];
    const counts    = snap.data;
    const maxVal    = Math.max(...groups.map(g => counts[g.id] || 0));
    const sorted    = [...groups].sort((a, b) => (counts[b.id]||0) - (counts[a.id]||0));
    const leaderVal = counts[sorted[0].id] || 0;
    const isLast    = index === snapshots.length - 1;

    // Fastest lap: group with highest positive daily delta
    // DNF: group with lowest daily delta (most negative or least growth)
    let fastestId = null, fastestDelta = 0;
    let dnfId = null, dnfDelta = Infinity;
    if (index > 0) {
        groups.forEach(g => {
            const d = (counts[g.id] || 0) - (snapshots[index - 1].data[g.id] || 0);
            if (d > fastestDelta) { fastestDelta = d; fastestId = g.id; }
            if (d < dnfDelta) { dnfDelta = d; dnfId = g.id; }
        });
    }

    sorted.forEach((g, rank) => {
        const val = counts[g.id] || 0;
        const pct = maxVal > 0 ? (val / maxVal) * 100 : 0;

        let delta = null;
        if (index > 0) delta = val - (snapshots[index - 1].data[g.id] || 0);

        const row = document.getElementById(`row-${g.id}`);

        // Overtake flash + alert
        if (prevRanks[g.id] !== undefined && rank < prevRanks[g.id]) {
            row.classList.remove('overtake-flash');
            void row.offsetWidth;
            row.classList.add('overtake-flash');
            // Find who was overtaken (group now at rank+1 that was previously at rank)
            const overtaken = sorted[rank + 1];
            if (overtaken) recordOvertake(g, overtaken, rank + 1);
        }
        prevRanks[g.id] = rank;

        // Podio glow at last frame
        row.classList.remove('podio-1', 'podio-2', 'podio-3');
        if (isLast) {
            if (rank === 0) row.classList.add('podio-1');
            else if (rank === 1) row.classList.add('podio-2');
            else if (rank === 2) row.classList.add('podio-3');
        }

        row.style.top = `${rank * (BAR_H + BAR_GAP)}px`;

        const fillEl = document.getElementById(`fill-${g.id}`);
        fillEl.style.width = `${Math.max(pct, 0.3)}%`;
        if (rank === 0) {
            const glowColor = g.color || '#E8002D';
            fillEl.style.boxShadow = `0 0 14px ${glowColor}99, 0 0 30px ${glowColor}44`;
        } else {
            fillEl.style.boxShadow = '';
        }
        const countEl = document.getElementById(`count-${g.id}`);
        if (initialRender) {
            animateCount(countEl, val, 1400 + rank * 40);
        } else {
            countEl.textContent = fmt(val);
        }

        // Gap display
        const gapEl = document.getElementById(`gap-${g.id}`);
        if (gapEl) {
            if (rank === 0) {
                gapEl.textContent = gapMode === 'interval' ? 'INTERVAL' : 'LEADER';
                gapEl.className = 'bar-gap-lbl leader';
            } else if (gapMode === 'leader') {
                gapEl.textContent = `-${fmt(leaderVal - val)}`;
                gapEl.className = 'bar-gap-lbl';
            } else {
                // interval: gap from car immediately ahead
                const prevVal = counts[sorted[rank - 1].id] || 0;
                gapEl.textContent = `-${fmt(prevVal - val)}`;
                gapEl.className = 'bar-gap-lbl';
            }
        }

        const rankEl = document.getElementById(`rank-${g.id}`);
        rankEl.textContent = rank + 1;
        const podioClass = rank === 0 ? ' p1' : rank === 1 ? ' p2' : rank === 2 ? ' p3' : '';
        rankEl.className = `bar-rank${podioClass}${g.id === OUR_ID ? ' our' : ''}`;
        if (initialRender && rank <= 2) {
            rankEl.classList.remove('rank-pop');
            setTimeout(() => rankEl.classList.add('rank-pop'), 700 + rank * 180);
        }

        // Pos delta: mostra solo se il gruppo ha fatto un sorpasso oggi
        const posDeltaEl = document.getElementById(`posdelta-${g.id}`);
        if (posDeltaEl) {
            const todayOvs = loadOvertakes();
            const gainedPos = todayOvs.some(o => o.upId === g.id);
            const lostPos   = todayOvs.some(o => o.downId === g.id);
            if (gainedPos) {
                posDeltaEl.textContent = '▲';
                posDeltaEl.className = 'pos-delta up';
                rankEl.classList.add('rank-gained');
            } else if (lostPos) {
                posDeltaEl.textContent = '▼';
                posDeltaEl.className = 'pos-delta down';
                rankEl.classList.add('rank-lost');
            } else {
                posDeltaEl.textContent = '';
                posDeltaEl.className = 'pos-delta';
                rankEl.classList.remove('rank-gained', 'rank-lost');
            }
        }

        const deltaEl = document.getElementById(`daydelta-${g.id}`);
        if (delta !== null) {
            deltaEl.textContent = delta >= 0 ? `+${fmt(delta)}` : fmt(delta);
            deltaEl.className   = `bar-day-delta ${delta >= 0 ? 'up' : 'down'}`;
        } else {
            deltaEl.textContent = '';
            deltaEl.className   = 'bar-day-delta';
        }

        // Badges: fastest lap + DNF
        const badgesEl = document.getElementById(`badges-${g.id}`);
        if (badgesEl) {
            const badges = [];
            if (g.id === fastestId) badges.push(`<span class="badge fastest-lap">FASTEST</span>`);
            if (dnfId && g.id === dnfId) badges.push(`<span class="badge dnf-badge">DNF</span>`);
            badgesEl.innerHTML = badges.join('');
        }
    });

    initialRender = false;
    document.getElementById('current-date').textContent = new Date().toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' });
    document.getElementById('timeline').value = index;
    updateChartLine(index);
    updateTicker(snap, sorted, counts, index);
}

// ─── TICKER ──────────────────────────────────────────────────────────────────

function updateTicker(snap, sorted, counts, index) {
    const el = document.getElementById('ticker-content');
    if (!el) return;

    const leaderG    = sorted[0];
    const ourRank    = sorted.findIndex(g => g.id === OUR_ID) + 1;
    const ourVal     = counts[OUR_ID] || 0;
    const leaderVal2 = counts[leaderG?.id] || 0;
    const gap        = leaderVal2 - ourVal;

    let fastestName = '—', fastestVal = 0;
    if (index > 0) {
        let maxD = 0;
        groups.forEach(g => {
            const d = (counts[g.id] || 0) - (snapshots[index - 1].data[g.id] || 0);
            if (d > maxD) { maxD = d; fastestName = g.name.split(',')[0].trim(); fastestVal = d; }
        });
    }

    const sep  = `<span class="tk-sep">◆</span>`;
    const lbl  = t => `<span class="tk-label">${t}</span>`;
    const val  = t => `<span class="tk-val">${t}</span>`;

    const items = [
        sep,
        lbl('LEADER') + ' ' + val(leaderG ? leaderG.name.split(',')[0].trim() : '—'),
        sep,
        lbl('ISCRITTI') + ' ' + val(fmt(leaderVal2)),
        sep,
        lbl('IL NOSTRO RANK') + ' ' + val('#' + ourRank),
        sep,
        lbl('GAP DAL LEADER') + ' ' + val(ourRank === 1 ? '—' : '-' + fmt(gap)),
        sep,
        lbl('⚡ FASTEST LAP') + ' ' + val(fastestName + (fastestVal > 0 ? ' +' + fmt(fastestVal) : '')),
        sep,
        lbl('GRUPPI IN GARA') + ' ' + val(groups.length),
        sep,
        lbl('DATA') + ' ' + val(fmtDate(snap.date)),
    ].join(' ');

    // Duplicate for seamless infinite scroll
    el.innerHTML = items + ' &nbsp;&nbsp;&nbsp; ' + items;
}

// ─── CHART ───────────────────────────────────────────────────────────────────

/** Crea un canvas circolare con l'icona del gruppo */
function makeIconCanvas(g) {
    const isOurs = g.id === OUR_ID;
    const size   = isOurs ? 32 : 22;
    return new Promise(resolve => {
        const c   = document.createElement('canvas');
        c.width   = size; c.height = size;
        const ctx = c.getContext('2d');
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
            ctx.save();
            ctx.beginPath();
            ctx.arc(size/2, size/2, size/2 - 2, 0, Math.PI*2);
            ctx.clip();
            ctx.drawImage(img, 0, 0, size, size);
            ctx.restore();
            ctx.beginPath();
            ctx.arc(size/2, size/2, size/2 - 2, 0, Math.PI*2);
            ctx.strokeStyle = isOurs ? '#FFD700' : (g.color || '#e63946');
            ctx.lineWidth   = isOurs ? 3 : 2;
            ctx.stroke();
            resolve(c);
        };
        img.onerror = () => {
            ctx.beginPath();
            ctx.arc(size/2, size/2, size/2, 0, Math.PI*2);
            ctx.fillStyle = g.color || '#e63946';
            ctx.fill();
            resolve(c);
        };
        img.src = `icons/${g.id}.jpg`;
    });
}

// Plugin per l'animazione glow pulsante sul nostro gruppo
let glowPhase = 0;
const glowPlugin = {
    id: 'ourGroupGlow',
    afterDatasetsDraw(chart) {
        const ourIdx = groups.findIndex(g => g.id === OUR_ID);
        if (ourIdx < 0) return;
        const ds   = chart.data.datasets[ourIdx];
        const meta = chart.getDatasetMeta(ourIdx);
        if (!meta.visible) return;

        glowPhase = (glowPhase + 0.04) % (Math.PI * 2);
        const pulse = 0.4 + 0.6 * Math.abs(Math.sin(glowPhase));

        meta.data.forEach(pt => {
            const ctx = chart.ctx;
            ctx.save();
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, 22 * pulse + 6, 0, Math.PI * 2);
            const grad = ctx.createRadialGradient(pt.x, pt.y, 4, pt.x, pt.y, 28);
            grad.addColorStop(0, `rgba(255,215,0,${0.35 * pulse})`);
            grad.addColorStop(1, 'rgba(255,215,0,0)');
            ctx.fillStyle = grad;
            ctx.fill();
            ctx.restore();
        });

        // Richiedi prossimo frame per animare
        requestAnimationFrame(() => chart.draw());
    }
};

async function buildChart() {
    const ctx    = document.getElementById('trend-chart').getContext('2d');
    const labels = snapshots.map(s => fmtDate(s.date));

    // Preload all icon canvases (saved globally for reuse)
    window._iconCanvases = await Promise.all(groups.map(g => makeIconCanvas(g)));
    const iconCanvases = window._iconCanvases;

    const lastIdx = snapshots.length - 1;

    const datasets = groups.map((g, i) => {
        const isOurs = g.id === OUR_ID;
        // Icona solo all'ultimo punto, piccolo cerchio sugli altri
        const pointStyles = snapshots.map((_, si) => si === lastIdx ? iconCanvases[i] : 'circle');
        const pointRadii  = snapshots.map((_, si) => si === lastIdx ? (isOurs ? 16 : 11) : (isOurs ? 3 : 2));
        const pointHover  = snapshots.map((_, si) => si === lastIdx ? (isOurs ? 20 : 14) : 4);
        const absVals = snapshots.map(s => s.data[g.id] || 0);
        const base    = absVals[0] || 0;
        const relVals = absVals.map(v => v - base);
        return {
            label:            g.name,
            _absData:         absVals,
            data:             absVals,
            borderColor:      isOurs ? '#FFD700' : g.color,
            backgroundColor:  isOurs ? 'rgba(255,215,0,.12)' : `rgba(${hexToRgb(g.color || '#e63946')},.04)`,
            borderWidth:      isOurs ? 4 : 1.5,
            pointStyle:       pointStyles,
            pointRadius:      pointRadii,
            pointHoverRadius: pointHover,
            tension:          0.35,
            fill:             isOurs ? 'origin' : false,
            order:            isOurs ? 0 : 1,
        };
    });

    chart = new Chart(ctx, {
        type: 'line',
        plugins: [glowPlugin],
        data: { labels, datasets },
        options: {
            responsive: true, maintainAspectRatio: false,
            animation:  { duration: 0 },
            interaction: { mode: 'nearest', intersect: true },
            plugins: {
                legend: { display: false },
                tooltip: {
                    mode: 'nearest',
                    intersect: true,
                    backgroundColor: '#161625',
                    borderColor: 'rgba(255,255,255,.1)',
                    borderWidth: 1,
                    titleColor: '#f0f0ff',
                    bodyColor: '#a0a0c0',
                    callbacks: {
                        title: items => items[0].dataset.label,
                        label: ctx => {
                            const abs = ctx.dataset._absData ? ctx.dataset._absData[ctx.dataIndex] : null;
                            const rel = ctx.parsed.y;
                            const absStr = abs !== null ? ` ${fmt(abs)} iscritti totali` : '';
                            const relStr = rel >= 0 ? ` +${fmt(rel)} nel periodo` : ` ${fmt(rel)} nel periodo`;
                            return abs !== null ? [absStr, relStr] : [relStr];
                        }
                    }
                }
            },
            scales: {
                x: { grid: { color: 'rgba(255,255,255,.04)' }, ticks: { color: '#7070a0', font: { size: 10 }, maxRotation: 0 } },
                y: {
                    grid:  { color: 'rgba(255,255,255,.04)' },
                    ticks: { color: '#7070a0', font: { size: 10 }, callback: v => fmt(v) }
                }
            }
        }
    });
}

function updateChartLine(index) {
    if (!chart) return;
    chart.data.datasets.forEach(ds => {
        ds.pointRadius = ds.data.map((_, i) => i === index ? 6 : 2);
        ds.pointBackgroundColor = ds.data.map((_, i) => i === index ? ds.borderColor : 'transparent');
    });
    chart.update('none');
}

// ─── PLAY / PAUSE ────────────────────────────────────────────────────────────

function setPlayIcon(isPlaying) {
    var icon = document.getElementById('play-icon');
    if (!icon) return;
    icon.innerHTML = isPlaying
        ? '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>'
        : '<polygon points="5 3 19 12 5 21 5 3"/>';
}

function togglePlay() {
    playing = !playing;
    setPlayIcon(playing);
    document.body.classList.toggle('is-playing', playing);
    if (playing) {
        if (current >= snapshots.length - 1) { current = 0; render(0); }
        step();
    } else {
        clearTimeout(playTimer);
    }
}

function step() {
    if (!playing) return;
    current++;
    if (current >= snapshots.length) {
        current = snapshots.length - 1;
        playing = false;
        setPlayIcon(false);
        document.body.classList.remove('is-playing');
        return;
    }
    render(current);
    playTimer = setTimeout(step, +document.getElementById('speed').value);
}

// ─── INIT ────────────────────────────────────────────────────────────────────

async function init() {
    document.getElementById('race-container').innerHTML = '<div class="loading">Caricamento in corso…</div>';

    const res  = await fetch(DATA_URL);
    const data = await res.json();
    groups    = data.groups;
    snapshots = data.snapshots;

    // car SVGs are generated per group in buildBars() using f1Car(g.color)

    buildBars();
    await buildChart();

    const RANGE  = 50000;
    let yFocused = false;

    function setYRange(focused) {
        yFocused = focused;
        document.getElementById('chart-focus').classList.toggle('active', focused);
        if (focused) {
            // Usa l'ultimo valore visibile di ogni dataset nel grafico corrente
            const lastIdx = chart.data.labels.length - 1;
            const ourDsIdx = groups.findIndex(g => g.id === OUR_ID);
            const ourVal = chart.data.datasets[ourDsIdx]?.data[lastIdx] ?? 0;

            // Range visibile dei dati (per calcolare padding proporzionale)
            const allLastVals = chart.data.datasets.map(ds => ds.data[lastIdx] ?? 0);
            const dataRange = Math.max(...allLastVals) - Math.min(...allLastVals) || 1;
            const pad = dataRange * 0.06; // 6% del range visibile

            // Trova il gruppo immediatamente sopra al nostro
            const valuesAbove = allLastVals.filter(v => v > ourVal);
            const nearestAbove = valuesAbove.length > 0 ? Math.min(...valuesAbove) : null;

            // Min: mostra tutti i gruppi dal basso
            const allFirst = chart.data.datasets.map(ds => ds.data[0] ?? 0);
            const yMin = Math.max(0, Math.min(...allFirst) - pad);

            // Max: se siamo i massimi piccolo respiro; altrimenti arriva al gruppo sopra + pad
            const yMax = nearestAbove !== null
                ? Math.min(nearestAbove + pad, ourVal + dataRange * 0.5)
                : ourVal + pad;
            chart.options.scales.y.min = yMin;
            chart.options.scales.y.max = yMax;
        } else {
            chart.options.scales.y.min = undefined;
            chart.options.scales.y.max = undefined;
        }
        chart.update();
    }

    document.getElementById('chart-focus').addEventListener('click', () => setYRange(!yFocused));

    let chartRelative = false;
    function setChartMode(relative) {
        chartRelative = relative;
        document.getElementById('chart-mode-rel').style.background   = relative ? '#e63946' : '#161625';
        document.getElementById('chart-mode-rel').style.borderColor  = relative ? '#e63946' : 'rgba(255,255,255,.07)';
        document.getElementById('chart-mode-rel').style.color        = relative ? '#fff' : '#7070a0';
        document.getElementById('chart-mode-abs').style.background   = relative ? '#161625' : '#e63946';
        document.getElementById('chart-mode-abs').style.borderColor  = relative ? 'rgba(255,255,255,.07)' : '#e63946';
        document.getElementById('chart-mode-abs').style.color        = relative ? '#7070a0' : '#fff';
        chart.data.datasets.forEach(ds => {
            ds.data = relative
                ? ds._absData.map(v => v - ds._absData[0])
                : ds._absData;
        });
        chart.options.scales.y.min = undefined;
        chart.options.scales.y.max = undefined;
        chart.update();
    }
    document.getElementById('chart-mode-rel').addEventListener('click', () => setChartMode(true));
    document.getElementById('chart-mode-abs').addEventListener('click', () => setChartMode(false));

    function filterChartByDays(days) {
        const latest = parseDate(snapshots[snapshots.length - 1].date);
        const cutoff = days === 0 ? null : new Date(latest.getTime() - days * 86400000);
        const filtered = cutoff ? snapshots.filter(s => parseDate(s.date) >= cutoff) : snapshots;
        const lastIdx2 = filtered.length - 1;

        chart.data.labels = filtered.map(s => fmtDate(s.date));

        chart.data.datasets.forEach((ds, i) => {
            const g = groups[i];
            const isOurs = g.id === OUR_ID;

            // Valori assoluti
            const absVals = filtered.map(s => s.data[g.id] || 0);
            // Valori relativi: delta dal primo snapshot del periodo
            const base = absVals[0] || 0;
            const relVals = absVals.map(v => v - base);

            ds._absData = absVals;
            ds.data     = chartRelative ? relVals : absVals;

            ds.pointStyle       = filtered.map((_, si) => si === lastIdx2 ? iconCanvasCache[i] : 'circle');
            ds.pointRadius      = filtered.map((_, si) => si === lastIdx2 ? (isOurs ? 16 : 11) : (isOurs ? 3 : 2));
            ds.pointHoverRadius = filtered.map((_, si) => si === lastIdx2 ? (isOurs ? 20 : 14) : 4);
        });

        // Linee rette con pochi punti, smooth con tanti
        const tension = filtered.length <= 7 ? 0 : 0.35;
        chart.data.datasets.forEach(ds => ds.tension = tension);

        // Mantieni stile bottoni Crescita/Totale
        chart.options.scales.y.min = undefined;
        chart.options.scales.y.max = undefined;
        yFocused = false;
        setChartMode(chartRelative);
    }

    const iconCanvasCache = window._iconCanvases;

    document.getElementById('chart-period-tabs').addEventListener('click', e => {
        if (!e.target.classList.contains('chart-tab')) return;
        document.querySelectorAll('.chart-tab').forEach(b => {
            b.classList.remove('active');
            b.style.background  = '#161625';
            b.style.borderColor = 'rgba(255,255,255,.07)';
            b.style.color       = '#7070a0';
        });
        e.target.classList.add('active');
        e.target.style.background  = '#e63946';
        e.target.style.borderColor = '#e63946';
        e.target.style.color       = '#fff';
        const wrapper = document.querySelector('.chart-wrapper');
        wrapper.classList.remove('slide-anim');
        void wrapper.offsetWidth;
        wrapper.classList.add('slide-anim');
        filterChartByDays(+e.target.dataset.days);
    });

    const slider = document.getElementById('timeline');
    slider.max   = snapshots.length - 1;

    document.getElementById('date-start').textContent = fmtDate(snapshots[0].date);
    document.getElementById('date-end').textContent   = new Date().toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' });

    slider.addEventListener('input', () => { current = +slider.value; render(current); });
    document.getElementById('play-btn').addEventListener('click', togglePlay);
    document.getElementById('open-stats').addEventListener('click', openModal);
    document.getElementById('close-stats').addEventListener('click', closeModal);
    document.getElementById('modal-overlay').addEventListener('click', e => {
        if (e.target === e.currentTarget) closeModal();
    });

    document.getElementById('period-tabs').addEventListener('click', e => {
        if (e.target.classList.contains('period-tab')) renderModal(+e.target.dataset.days);
    });

    document.getElementById('hero-trend-period').addEventListener('change', renderHeroStats);
    document.getElementById('hero-overtakes-period').addEventListener('change', renderHeroStats);
    document.getElementById('hero-avg-period').addEventListener('change', renderHeroStats);

    document.getElementById('gap-toggle').addEventListener('click', function() {
        gapMode = gapMode === 'interval' ? 'leader' : 'interval';
        document.getElementById('gap-toggle-label').textContent = gapMode === 'interval' ? 'INTERVAL' : 'LEADER';
        render(current);
    });

    // Start at latest snapshot
    current = snapshots.length - 1;
    render(current);
    renderHeroStats();
    renderOvertakePanel();
    renderBattleForecast();
    setChartMode(false);
    setYRange(true);

}

init().catch(err => {
    document.getElementById('race-container').innerHTML =
        `<div class="loading">Errore: ${err.message}</div>`;
    console.error(err);
});
