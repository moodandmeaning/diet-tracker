'use strict';

/* ============ Storage ============ */
// All data lives only in this device's localStorage. Nothing personal is in the code.
const STORE_KEY = 'hamaslul-v1';
const APP_VERSION = 6;
const PROFILE_IDS = ['p1', 'p2'];

function defaultState() {
  return {
    version: 1,
    active: 'p1',
    profiles: {
      p1: { name: 'אביגיל', kind: 'f', setup: null, days: {}, weights: [], measures: [] },
      p2: { name: 'יוסף', kind: 'm', setup: null, days: {}, weights: [], measures: [] },
    },
    shopping: DEFAULT_SHOPPING.map((text, i) => ({ id: 'd' + i, text, done: false })),
    lastBackup: null,
  };
}

function normalize(s) {
  const d = defaultState();
  if (!s || typeof s !== 'object' || !s.profiles) s = d;
  for (const id of PROFILE_IDS) {
    const p = s.profiles[id] || d.profiles[id];
    p.name = p.name || d.profiles[id].name;
    p.kind = p.kind === 'm' ? 'm' : 'f';
    p.days = p.days && typeof p.days === 'object' ? p.days : {};
    p.weights = Array.isArray(p.weights) ? p.weights : [];
    p.measures = Array.isArray(p.measures) ? p.measures : [];
    // Older versions kept waist on the weight entry – move it to body measurements
    for (const w of p.weights) {
      if (w.waist) {
        const same = p.measures.find((m) => m.date === w.date);
        if (!same) p.measures.push({ date: w.date, waist: w.waist });
        else if (!same.waist) same.waist = w.waist;
        delete w.waist;
      }
    }
    p.setup = p.setup || null;
    if (p.water && typeof p.water !== 'object') delete p.water;
    // Fast type, health adjustments, blood tests, current menu document (all device-only)
    p.fastType = p.fastType === 'modified' ? 'modified' : 'full';
    const h = p.health && typeof p.health === 'object' ? p.health : {};
    p.health = {};
    for (const hid of HEALTH_IDS) if (h[hid]) p.health[hid] = true;
    p.blood = Array.isArray(p.blood) ? p.blood.filter((b) => b && typeof b.date === 'string') : [];
    p.bloodNext = typeof p.bloodNext === 'string' && p.bloodNext ? p.bloodNext : null;
    p.menuDoc = typeof p.menuDoc === 'string' && p.menuDoc ? p.menuDoc : null;
    s.profiles[id] = p;
  }
  if (!PROFILE_IDS.includes(s.active)) s.active = 'p1';
  if (!Array.isArray(s.shopping)) s.shopping = d.shopping;
  s.backupDocs = !!s.backupDocs;
  s.version = 1;
  return s;
}

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return normalize(raw ? JSON.parse(raw) : null);
  } catch (e) {
    return normalize(null);
  }
}

let state = load();

function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch (e) {
    toast('שגיאה בשמירה – כדאי לעשות גיבוי');
  }
}

/* ============ Helpers ============ */
const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n) => String(n).padStart(2, '0');
const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseKey = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const todayKey = () => keyOf(new Date());
const addDays = (k, n) => { const d = parseKey(k); d.setDate(d.getDate() + n); return keyOf(d); };
const daysBetween = (a, b) => Math.round((parseKey(b) - parseKey(a)) / 86400000);
const fmtDate = (k) => { const d = parseKey(k); return `${d.getDate()}/${d.getMonth() + 1}`; };
const fmtDateLong = (k) => { const d = parseKey(k); return `יום ${WEEKDAYS[d.getDay()]}, ${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`; };
const num = (v) => { const n = parseFloat(String(v).replace(',', '.')); return Number.isFinite(n) ? n : null; };
const r1 = (n) => Math.round(n * 10 + 1e-9) / 10;
const fmtKg = (n) => r1(n).toLocaleString('he-IL', { maximumFractionDigits: 1 });
const fmtInt = (n) => Math.round(n).toLocaleString('he-IL');

const profile = () => state.profiles[state.active];
const isFastDay = (p, k) => p.setup.fastDays.includes(parseKey(k).getDay());
const dayData = (p, k) => p.days[k] || {};

function setDay(k, patch) {
  const p = profile();
  const cur = { ...dayData(p, k), ...patch };
  for (const f of Object.keys(cur)) if (cur[f] === false || cur[f] === null || cur[f] === '' || cur[f] === 0 || (Array.isArray(cur[f]) && !cur[f].length)) delete cur[f];
  if (Object.keys(cur).length) p.days[k] = cur; else delete p.days[k];
  save();
}

// Daily water target in liters, per profile and day type (editable in settings)
const DEFAULT_WATER = {
  f: { fastMin: 2.5, fastMax: 3, eatMin: 2, eatMax: 2.5 },
  m: { fastMin: 3, fastMax: 3.5, eatMin: 2.5, eatMax: 3 },
};
// raw = what the user set; otherwise the effective target (high uric acid: at least 3–3.5 L on fast days)
function waterTargets(p, raw) {
  const t = { ...DEFAULT_WATER[p.kind], ...(p.water || {}) };
  if (!raw && p.health && p.health.uric) {
    t.fastMin = Math.max(t.fastMin, 3);
    t.fastMax = Math.max(t.fastMax, 3.5);
  }
  return t;
}
const hasHealth = (p) => HEALTH_IDS.some((h) => p.health && p.health[h]);
const isModified = (p) => p.fastType === 'modified';
function waterTarget(p, k) {
  const t = waterTargets(p);
  return isFastDay(p, k) ? { min: t.fastMin, max: t.fastMax } : { min: t.eatMin, max: t.eatMax };
}
const fmtL = (ml) => (Math.round(ml / 50) / 20).toLocaleString('he-IL', { maximumFractionDigits: 2 });

function addWater(ml) {
  const p = profile();
  const d = dayData(p, viewDate);
  const total = Math.max(0, (d.waterMl || 0) + ml);
  const log = [...(d.waterLog || []), ml];
  setDay(viewDate, { waterMl: total, waterLog: log, water: total >= waterTarget(p, viewDate).min * 1000 });
}
function undoWater() {
  const p = profile();
  const d = dayData(p, viewDate);
  const log = [...(d.waterLog || [])];
  if (!log.length) { toast('אין מה לבטל'); return; }
  const total = Math.max(0, (d.waterMl || 0) - log.pop());
  setDay(viewDate, { waterMl: total, waterLog: log, water: total >= waterTarget(p, viewDate).min * 1000 });
}

function waterCard(p, k, d, fast) {
  const ml = d.waterMl || 0;
  const t = waterTarget(p, k);
  const pct = Math.min(100, (ml / (t.max * 1000)) * 100);
  const minPct = (t.min / t.max) * 100;
  const reached = ml >= t.min * 1000;
  const counter = (field, label, note, target) => {
    const n = d[field] || 0;
    return `<div class="check-row">
      <span class="label">${label}<br><span class="muted small">${note}</span></span>
      <button class="cnt-btn" data-count="${field}" data-delta="-1" aria-label="הפחתה" ${n ? '' : 'disabled'}>−</button>
      <span class="cnt ${target && n >= target ? 'ok' : ''}">${n}</span>
      <button class="cnt-btn" data-count="${field}" data-delta="1" aria-label="הוספה">+</button>
    </div>`;
  };
  return `<div class="card water">
    <h2>💧 שתייה</h2>
    <div class="water-amount"><b>${fmtL(ml)}</b> ליטר <span class="muted">מתוך ${fmtL(t.min * 1000)}–${fmtL(t.max * 1000)} ל׳</span>${reached ? ' <span class="pill">✓ ביעד</span>' : ''}</div>
    <div class="bar water-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${t.max * 1000}" aria-valuenow="${ml}">
      <div style="width:${pct}%" class="${reached ? 'ok' : ''}"></div><i style="inset-inline-start:${minPct}%" title="מינימום"></i>
    </div>
    <div class="water-btns">
      <button class="btn" data-water="250"><span>+1 כוס</span><span class="small">250 מ״ל</span></button>
      <button class="btn" data-water="500"><span>+½ ליטר</span><span class="small">500 מ״ל</span></button>
      <button class="btn ghost" data-act="water-undo" aria-label="ביטול הוספה אחרונה" ${(d.waterLog || []).length ? '' : 'disabled'}>↶ ביטול</button>
    </div>
    ${fast ? `<div style="margin-top:10px">
      ${counter('salt', '🧂 מים עם קורט מלח', 'יעד: 2–3 פעמים ביום', 2)}
      ${counter('coffee', '☕ קפה', 'עד 2–3 כוסות ביום', 0)}
    </div>` : ''}
    ${fast && (d.coffee || 0) > 3 ? '<p class="note small" style="margin:8px 0 0">☕ יותר מ־3 כוסות קפה – כדאי לעבור למים או לתה צמחים.</p>' : ''}
    <details class="water-tips"><summary>טיפים לשתייה</summary><ul class="small">${WATER_TIPS.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></details>
  </div>`;
}

function sortedWeights(p) {
  return [...p.weights].sort((a, b) => a.date.localeCompare(b.date));
}

function currentWeight(p) {
  const w = sortedWeights(p);
  return w.length ? w[w.length - 1].kg : p.setup.startWeight;
}

function calorieText(p, k) {
  const s = p.setup;
  const shabbat = parseKey(k).getDay() === 6;
  if (shabbat && s.calShabbat) return `עד ${fmtInt(s.calShabbat)} קק״ל (שבת)`;
  return `${fmtInt(s.calMin)}–${fmtInt(s.calMax)} קק״ל`;
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

function safetyBox(open) {
  return `<details class="card safety"${open ? ' open' : ''}>
    <summary>⚠️ מתי לעצור</summary>
    <p class="small" style="margin:8px 0 4px">להפסיק את הצום, או להחליף את ימי הצום ל־500 קק״ל, אם מופיעים:</p>
    <ul class="small">${SAFETY.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>
    <p class="small" style="margin:6px 0 0">ובמקרה כזה – להתייעץ עם רופא/ה.</p>
  </details>`;
}

/* ============ Navigation ============ */
let tab = 'today';
let overlay = null;          // 'setup' | 'settings' | null
let setupFor = null;         // profile id being edited
let viewDate = todayKey();
let weekOffset = 0;
let menuSel = null;
let chart = null;
let measureChart = null;
let weightSub = 'body';      // 'body' | 'blood'
const WHR_TARGET = { f: 0.85, m: 0.9 };

function show(name) {
  document.querySelectorAll('.screen').forEach((s) => { s.hidden = s.dataset.screen !== name; });
}

function render() {
  renderSwitcher();
  const p = profile();
  document.body.classList.toggle('setup-mode', overlay === 'setup' || !p.setup);
  document.querySelectorAll('#tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab && !overlay));

  if (overlay === 'settings') { show('settings'); renderSettings(); return; }
  if (overlay === 'setup' || !p.setup) { show('setup'); renderSetup(overlay === 'setup' ? setupFor : state.active); return; }

  show(tab);
  ({ today: renderToday, week: renderWeek, weight: renderWeight, menus: renderMenus, swaps: renderSwaps, shop: renderShop, docs: renderDocs })[tab]();
}

function go(t) {
  tab = t;
  overlay = null;
  render();
  window.scrollTo(0, 0);
}

function renderSwitcher() {
  const el = $('#switcher');
  el.innerHTML = PROFILE_IDS.map((id) => `<button role="tab" data-pid="${id}" class="${id === state.active ? 'active' : ''}" aria-selected="${id === state.active}">${esc(state.profiles[id].name)}</button>`).join('');
  // First-run setup of the very first profile: hide the switcher until something is set up
  const anySetup = PROFILE_IDS.some((id) => state.profiles[id].setup);
  el.style.display = (overlay === 'settings' || (overlay === 'setup' && setupFor)) ? 'none' : (anySetup ? '' : 'none');
}

/* ============ Screen: Today ============ */
function renderToday() {
  const p = profile();
  const k = viewDate;
  const isToday = k === todayKey();
  const fast = isFastDay(p, k);
  const d = dayData(p, k);
  const wd = parseKey(k).getDay();
  const tomorrowFast = isFastDay(p, addDays(k, 1));
  const yesterdayFast = isFastDay(p, addDays(k, -1));

  let html = `
  <div class="date-nav">
    <button data-act="prev-day" aria-label="יום קודם">→</button>
    <div class="date-label">${isToday ? 'היום · ' : ''}${fmtDateLong(k)}
      ${isToday ? '' : '<br><button class="btn ghost today-link" data-act="goto-today" style="min-height:36px;margin-top:4px">חזרה להיום</button>'}
    </div>
    <button data-act="next-day" aria-label="יום הבא">←</button>
  </div>
  <div class="day-banner ${fast ? 'fast' : 'eat'}">
    <div class="big">${fast ? '💧 יום צום' : '🍽️ יום אכילה'}</div>
    <div class="sub">${fast ? (isModified(p) ? `צום מתון · כ־${MODIFIED_FAST_MENU.kcal} קק״ל, חלבון וירקות` : 'מים, תה וקפה שחור') : esc(calorieText(p, k))}</div>
  </div>`;

  const menuDoc = docById(p.menuDoc);
  if (menuDoc) {
    html += `<button class="btn ghost block" data-act="open-mymenu">📄 התפריט שלי <span class="muted small">· ${esc(menuDoc.title)}</span></button>`;
  }

  if (isToday && p.bloodNext && k >= p.bloodNext) {
    html += `<div class="banner">🩸 הגיע הזמן לבדיקת דם${k > p.bloodNext ? ` (תוכננה ל־${fmtDate(p.bloodNext)})` : ''}. <button class="btn" data-act="go-blood" style="min-height:40px;margin-inline-start:8px">לבדיקות דם</button></div>`;
  }

  if (isToday && wd === p.setup.weighDay && !p.weights.some((w) => w.date === k)) {
    html += `<div class="banner">⚖️ היום יום שקילה! <button class="btn" data-act="go-weight" style="min-height:40px;margin-inline-start:8px">לשקילה</button></div>`;
  }

  html += `<div class="card">
    <h2>צ׳קליסט יומי</h2>
    ${checkRow('adherence', fast ? 'עמדתי בצום' : 'עמדתי בתפריט', d.adherence)}
    ${checkRow('water', 'שתיתי מספיק', d.water)}
    <div class="check-row">
      <span class="label">👣 צעדים</span>
      <input class="steps-input" type="number" inputmode="numeric" min="0" step="100" placeholder="0" value="${d.steps ?? ''}" data-steps aria-label="מספר צעדים">
    </div>
    ${checkRow('strength', 'אימון כוח', d.strength)}
  </div>`;

  html += waterCard(p, k, d, fast);

  if (fast && isModified(p)) html += modifiedFastCard();
  if (hasHealth(p)) html += healthCard(p, fast);

  if (fast) {
    html += `<div class="card tips"><h2>טיפים ליום צום</h2><ul>${FAST_TIPS.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div>`;
  } else {
    const menuId = MENU_BY_WEEKDAY[wd];
    const menu = MENUS.find((m) => m.id === menuId);
    html += `<div class="card">
      <h2>התפריט להיום</h2>
      <p style="margin:0">${menu ? `<b>${esc(menu.title)}</b>${menu.note ? ` <span class="pill">${esc(menu.note)}</span>` : ''}` : 'תפריט א׳ או ב׳ – לבחירה'}</p>
      <p class="muted" style="margin:4px 0 0">יעד: ${esc(calorieText(p, k))}</p>
      <div class="btn-row"><button class="btn ghost" data-act="go-menu" data-menu="${menuId || 'A'}">לתפריט המלא</button></div>
    </div>`;
  }
  if (!fast && yesterdayFast) html += `<div class="note">🥚 אחרי יום צום: שוברים את הצום בחלבון + ירקות, לא בפחמימות.</div>`;
  if (!fast && tomorrowFast) html += `<div class="note">🌙 מחר צום: הארוחה האחרונה – עשירה בחלבון ובסיבים, בלי מתוקים.</div>`;

  html += safetyBox(false);

  const hasData = PROFILE_IDS.some((id) => Object.keys(state.profiles[id].days).length || state.profiles[id].weights.length);
  const backupAge = state.lastBackup ? daysBetween(state.lastBackup.slice(0, 10), todayKey()) : Infinity;
  if (isToday && hasData && backupAge >= 14) {
    html += `<div class="note">💾 ${state.lastBackup ? `הגיבוי האחרון לפני ${backupAge} ימים.` : 'עדיין לא נעשה גיבוי.'} <button class="btn ghost" data-act="backup" style="min-height:40px;margin-inline-start:6px">גיבוי עכשיו</button></div>`;
  }

  $('#screen-today').innerHTML = html;
}

function checkRow(field, label, on) {
  return `<div class="check-row">
    <span class="label">${esc(label)}</span>
    <button class="tick ${on ? 'on' : ''}" data-check="${field}" aria-pressed="${!!on}" aria-label="${esc(label)}">${on ? '✓' : ''}</button>
  </div>`;
}

function modifiedFastCard() {
  const m = MODIFIED_FAST_MENU;
  return `<div class="card">
    <h2>🥚 ${esc(m.title)} <span class="muted small">· כ־${m.kcal} קק״ל</span></h2>
    ${m.meals.map((x) => `<div class="meal"><div class="mn">${esc(x.name)} <span class="muted small">· ${x.kcal} קק״ל</span></div><div>${esc(x.text)}</div></div>`).join('')}
    <p class="small" style="margin:8px 0 0">🔁 ${esc(m.alt)}</p>
    <p class="note small" style="margin:8px 0 0">🥗 ${esc(m.note)}</p>
  </div>`;
}

function healthCard(p, fast) {
  const ids = HEALTH_IDS.filter((h) => p.health[h]);
  return `<div class="card health">
    <h2>🩺 התאמות בריאותיות</h2>
    ${p.health.uric && fast ? '<p class="note small" style="margin:0 0 8px">💧 יום צום + חומצה אורית גבוהה: לשתות לפחות 3–3.5 ליטר היום.</p>' : ''}
    ${ids.map((h) => `<details class="howto"${ids.length === 1 ? ' open' : ''}><summary>${HEALTH[h].icon} ${esc(HEALTH[h].label)}</summary>
      <ul class="small">${HEALTH[h].tips.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></details>`).join('')}
    ${p.health.uric ? `<p class="warn-line small">⚠️ ${esc(HEALTH.uric.warn)}</p>` : ''}
  </div>`;
}

// Menu text for a given portion size, adjusted to the health settings of the profile eating it
function menuText(meal, kind, prof) {
  let t = meal[kind] || meal.f;
  if (prof && prof.health && prof.health.chol) {
    const swaps = [...(kind === 'm' ? CHOL_SWAPS_M : []), ...CHOL_SWAPS_ALL];
    for (const [a, b] of swaps) t = t.split(a).join(b);
  }
  return t;
}

/* ============ Screen: Week ============ */
function weekStart(offset) {
  const d = new Date();
  d.setDate(d.getDate() - d.getDay() + offset * 7);
  return keyOf(d);
}

function renderWeek() {
  const p = profile();
  const start = weekStart(weekOffset);
  const today = todayKey();
  const keys = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const past = keys.filter((k) => k <= today);
  const done = past.filter((k) => dayData(p, k).adherence).length;
  const pct = past.length ? Math.round((done / past.length) * 100) : 0;
  const fastDone = past.filter((k) => isFastDay(p, k) && dayData(p, k).adherence).length;
  const fastAll = past.filter((k) => isFastDay(p, k)).length;
  const water = past.filter((k) => dayData(p, k).water).length;
  const waterDays = keys.map((k) => dayData(p, k).waterMl).filter((v) => v > 0);
  const waterAvg = waterDays.length ? waterDays.reduce((a, b) => a + b, 0) / waterDays.length : 0;
  const strength = keys.filter((k) => dayData(p, k).strength).length;
  const stepsDays = keys.map((k) => dayData(p, k).steps).filter((s) => s > 0);
  const stepsAvg = stepsDays.length ? stepsDays.reduce((a, b) => a + b, 0) / stepsDays.length : 0;

  const label = weekOffset === 0 ? 'השבוע' : weekOffset === -1 ? 'שבוע שעבר' : `${fmtDate(keys[0])}–${fmtDate(keys[6])}`;

  $('#screen-week').innerHTML = `
  <div class="date-nav">
    <button data-act="prev-week" aria-label="שבוע קודם">→</button>
    <div class="date-label">${label}<div class="muted small">${fmtDate(keys[0])} – ${fmtDate(keys[6])}</div></div>
    <button data-act="next-week" aria-label="שבוע הבא" ${weekOffset >= 0 ? 'disabled style="opacity:.35"' : ''}>←</button>
  </div>
  <div class="card">
    <div class="week-grid">
      ${keys.map((k) => {
        const fast = isFastDay(p, k);
        const dd = dayData(p, k);
        const future = k > today;
        const mark = dd.adherence ? '✅' : (future || k === today ? '' : '–');
        return `<button class="wday ${fast ? 'fast' : 'eat'} ${k === today ? 'today' : ''} ${future ? 'future' : ''}" data-day="${k}" aria-label="${fmtDateLong(k)}">
          <span class="wd">${WEEKDAYS_SHORT[parseKey(k).getDay()]}</span>
          <span class="dn">${fmtDate(k)}</span>
          <span class="kind">${fast ? 'צום' : 'אכילה'}</span>
          <span class="mark">${mark}</span>
          <span class="wl">${dd.waterMl ? '💧' + fmtL(dd.waterMl) : ''}</span>
        </button>`;
      }).join('')}
    </div>
    <div class="legend" style="margin-top:10px">
      <span><i style="background:var(--fast)"></i>צום</span>
      <span><i style="background:var(--eat)"></i>אכילה</span>
      <span>✅ עמדתי ביעד</span>
      <span class="muted">לחיצה על יום – למילוי</span>
    </div>
  </div>
  <div class="card">
    <h2>הצלחה שבועית</h2>
    <div class="pct">${pct}%</div>
    <div class="bar"><div style="width:${pct}%"></div></div>
    <p class="muted" style="margin:6px 0 0">${done} מתוך ${past.length} ימים עד כה${fastAll ? ` · צומות: ${fastDone}/${fastAll}` : ''}</p>
    <div class="stats" style="margin-top:12px">
      <div class="stat"><div class="v">${water}/${past.length}</div><div class="k">ימים עם מספיק שתייה</div></div>
      <div class="stat"><div class="v">${waterAvg ? fmtL(waterAvg) + ' ל׳' : '–'}</div><div class="k">ממוצע שתייה ליום</div></div>
      <div class="stat"><div class="v">${strength}</div><div class="k">אימוני כוח</div></div>
      <div class="stat"><div class="v">${stepsAvg ? fmtInt(stepsAvg) : '–'}</div><div class="k">ממוצע צעדים ליום</div></div>
    </div>
  </div>
  <div class="card">
    <h2>💧 שתייה השבוע</h2>
    <div class="water-week">
      ${keys.map((k) => {
        const t = waterTarget(p, k);
        const ml = dayData(p, k).waterMl || 0;
        const scale = 4000;
        const ok = ml >= t.min * 1000;
        return `<div class="ww-col">
          <div class="ww-val">${ml ? fmtL(ml) : ''}</div>
          <div class="ww-track">
            <i class="ww-target" style="bottom:${Math.min(100, (t.min * 1000 / scale) * 100)}%"></i>
            <div class="ww-fill ${ok ? 'ok' : ''}" style="height:${Math.min(100, (ml / scale) * 100)}%"></div>
          </div>
          <div class="ww-day">${WEEKDAYS_SHORT[parseKey(k).getDay()]}</div>
        </div>`;
      }).join('')}
    </div>
    <p class="muted small" style="margin:8px 0 0">בליטרים. הקו האפור = מינימום היעד היומי (שונה בימי צום ובימי אכילה).${waterDays.length ? ` סה״כ השבוע: ${fmtL(waterDays.reduce((a, b) => a + b, 0))} ל׳.` : ''}</p>
  </div>`;
}

/* ============ Screen: Weight ============ */
function weightSeg() {
  return `<div class="seg" role="tablist">
    <button data-wsub="body" class="${weightSub === 'body' ? 'active' : ''}">⚖️ משקל ומדידות</button>
    <button data-wsub="blood" class="${weightSub === 'blood' ? 'active' : ''}">🩸 בדיקות דם</button>
  </div>`;
}

// Weekly loss rate (kg/week) between the latest weight and one at least 6 days earlier
function weeklyLoss(p) {
  const ws = sortedWeights(p);
  if (ws.length < 2) return null;
  const last = ws[ws.length - 1];
  const ref = [...ws].reverse().find((w) => daysBetween(w.date, last.date) >= 6);
  if (!ref) return null;
  return ((ref.kg - last.kg) / daysBetween(ref.date, last.date)) * 7;
}

function renderWeight() {
  const p = profile();
  if (weightSub === 'blood') { if (chart) { chart.destroy(); chart = null; } if (measureChart) { measureChart.destroy(); measureChart = null; } renderBlood(p); return; }
  const s = p.setup;
  const today = todayKey();
  const ws = sortedWeights(p);
  const cur = currentWeight(p);
  const lost = r1(s.startWeight - cur);
  const lostPct = (lost / s.startWeight) * 100;
  const bmi = cur / Math.pow(s.height / 100, 2);
  const bmiCat = bmi < 18.5 ? 'תת־משקל' : bmi < 25 ? 'תקין' : bmi < 30 ? 'עודף משקל' : 'השמנה';
  const toGoal = cur - s.goalWeight;
  const ms = [...(p.measures || [])].filter((m) => m.waist || m.hips || (p.kind === 'f' && m.chest)).sort((a, b) => a.date.localeCompare(b.date));
  const lastM = ms[ms.length - 1];
  const measureDue = !lastM || daysBetween(lastM.date, today) >= 14;

  const milestones = [
    { label: 'ירידה של 5%', target: s.startWeight * 0.95 },
    { label: 'ירידה של 10%', target: s.startWeight * 0.9 },
    { label: '🎯 משקל היעד', target: s.goalWeight },
  ].filter((m, i, arr) => i === arr.length - 1 || m.target > s.goalWeight)
    .sort((a, b) => b.target - a.target);

  let html = weightSeg();
  const rate = p.health.liver ? weeklyLoss(p) : null;
  if (rate != null && rate > 1.5) {
    html += `<div class="banner">🫀 ירידה של כ־${fmtKg(rate)} ק״ג בשבוע – עם כבד שומני לא כדאי לרדת יותר מ־1.5 ק״ג בשבוע. כדאי להוסיף מעט בימי האכילה, או לעבור לצום מתון.</div>`;
  }
  if (measureDue) {
    html += `<div class="note">📏 ${lastM ? `עברו ${daysBetween(lastM.date, today)} ימים מהמדידה האחרונה –` : 'עוד לא נרשמו מדידות גוף –'} הגיע הזמן למדוד מותניים וירכיים. <button class="btn ghost" data-act="go-measure" style="min-height:40px;margin-inline-start:6px">למדידה</button></div>`;
  }
  if (parseKey(today).getDay() === s.weighDay && !p.weights.some((w) => w.date === today)) {
    html += `<div class="banner">⚖️ היום יום שקילה – בבוקר, אחרי שירותים ולפני אוכל.</div>`;
  }

  html += `<div class="card">
    <h2>רישום שקילה</h2>
    <form id="weightForm" autocomplete="off">
      <div class="row">
        <label class="field"><span>תאריך</span><input type="date" name="date" value="${today}" max="${today}" required></label>
        <label class="field"><span>משקל (ק״ג)</span><input type="number" name="kg" inputmode="decimal" step="0.1" min="30" max="300" required placeholder="0.0"></label>
      </div>
      <button class="btn block" type="submit" style="margin-top:14px">שמירה</button>
    </form>
  </div>

  <div class="card">
    <h2>התקדמות</h2>
    <div class="stats">
      <div class="stat"><div class="v">${fmtKg(cur)}</div><div class="k">משקל נוכחי (ק״ג)</div></div>
      <div class="stat"><div class="v">${lost >= 0 ? '' : '+'}${fmtKg(Math.abs(lost))}</div><div class="k">${lost >= 0 ? 'ירדו עד כה (ק״ג)' : 'עלייה מההתחלה (ק״ג)'}</div></div>
      <div class="stat"><div class="v">${fmtKg(lostPct)}%</div><div class="k">מהמשקל ההתחלתי</div></div>
      <div class="stat"><div class="v">${fmtKg(bmi)}</div><div class="k">BMI · ${bmiCat}</div></div>
    </div>
    <p class="muted" style="margin:10px 0 0">התחלה: ${fmtKg(s.startWeight)} ק״ג (${fmtDate(s.startDate)}) · יעד: ${fmtKg(s.goalWeight)} ק״ג${toGoal > 0 ? ` · נשארו ${fmtKg(toGoal)} ק״ג` : ''}</p>
  </div>

  <div class="card">
    <h2>גרף משקל</h2>
    <div class="chart-wrap"><canvas id="weightChart" aria-label="גרף משקל לאורך זמן" role="img"></canvas></div>
    <p class="muted small" style="margin:8px 0 0">הקו המקווקו: קצב צפוי של ק״ג לשבוע מהמשקל ההתחלתי.</p>
  </div>

  <div class="card">
    <h2>אבני דרך</h2>
    <ul class="milestones">
      ${milestones.map((m) => {
        const ok = cur <= m.target + 0.001;
        return `<li><span>${m.label} · ${fmtKg(m.target)} ק״ג</span><span class="${ok ? 'done' : 'muted'}">${ok ? '✓ הושג!' : `עוד ${fmtKg(cur - m.target)} ק״ג`}</span></li>`;
      }).join('')}
    </ul>
  </div>

  ${measureCard(p, ms, today, measureDue)}

  <div class="card">
    <h2>היסטוריית שקילות</h2>
    ${ws.length ? `<ul class="log-list">${[...ws].reverse().map((w) => `
      <li><span class="grow">${fmtDate(w.date)}/${parseKey(w.date).getFullYear() % 100}</span>
        <b>${fmtKg(w.kg)} ק״ג</b>
        <button class="del" data-delw="${w.date}" aria-label="מחיקת שקילה">🗑️</button></li>`).join('')}</ul>`
      : '<p class="muted" style="margin:0">עדיין אין שקילות.</p>'}
  </div>
  ${safetyBox(false)}`;

  $('#screen-weight').innerHTML = html;
  drawChart(p);
  drawMeasureChart(ms, p.kind === 'f');
}

/* ---- Blood tests ---- */
const bySex = (v, kind) => (typeof v === 'object' ? v[kind] : v);
const fmtLab = (n) => (Math.round(n * 10) / 10).toLocaleString('he-IL', { maximumFractionDigits: 1 });
const LAB_ST = { ok: 'תקין', border: 'גבולי', high: 'גבוה', low: 'נמוך' };

function labStatus(L, v, kind) {
  if (L.type === 'min') {
    if (v >= bySex(L.lim, kind)) return 'ok';
    return v >= bySex(L.low, kind) ? 'border' : 'low';
  }
  if (v < bySex(L.lim, kind)) return 'ok';
  return v < bySex(L.high, kind) ? 'border' : 'high';
}

function labRange(L, kind) {
  const unit = L.unit === '%' ? '%' : ` ${L.unit}`;
  return L.type === 'min' ? `תקין: מעל ${fmtLab(bySex(L.lim, kind))}${unit}` : `תקין: מתחת ל־${fmtLab(bySex(L.lim, kind))}${unit}`;
}

// "ירד מ־186 ל־150" – no arrows in Hebrew text
function labChange(L, prev, last) {
  if (prev === last) return { text: `ללא שינוי (${fmtLab(last)})`, cls: '' };
  const down = last < prev;
  const better = L.type === 'min' ? !down : down;
  return { text: `${down ? 'ירד' : 'עלה'} מ־${fmtLab(prev)} ל־${fmtLab(last)}`, cls: better ? 'down' : 'up' };
}

function sortedBlood(p) {
  return [...p.blood].sort((a, b) => a.date.localeCompare(b.date));
}

function renderBlood(p) {
  const today = todayKey();
  const tests = sortedBlood(p);
  const kind = p.kind;
  const rows = LABS.map((L) => {
    const withVal = tests.filter((t) => Number.isFinite(t[L.k]));
    if (!withVal.length) return '';
    const lastT = withVal[withVal.length - 1];
    const v = lastT[L.k];
    const st = labStatus(L, v, kind);
    const ch = withVal.length > 1 ? labChange(L, withVal[withVal.length - 2][L.k], v) : null;
    return `<div class="lab st-${st}">
      <div class="lab-name"><b>${esc(L.name)}</b>${L.he ? ` <span class="muted small">${esc(L.he)}</span>` : ''}
        <div class="muted small">${labRange(L, kind)}</div>
        ${ch ? `<div class="chg ${ch.cls}">${ch.text}</div>` : ''}
      </div>
      <div class="lab-val"><b>${fmtLab(v)}</b><span class="lab-st">${LAB_ST[st]}</span>${lastT !== tests[tests.length - 1] ? `<span class="muted small">${fmtDate(lastT.date)}</span>` : ''}</div>
    </div>`;
  }).join('');

  const next = p.bloodNext;
  const nextIn = next ? daysBetween(today, next) : null;
  let html = weightSeg();
  if (next && nextIn <= 0) html += `<div class="banner">🩸 הגיע הזמן לבדיקת דם${nextIn < 0 ? ` (תוכננה ל־${fmtDate(next)})` : ''}.</div>`;

  html += `<div class="card">
    <h2>🩸 תוצאות אחרונות – ${esc(p.name)}</h2>
    ${tests.length ? `<p class="muted small" style="margin:0 0 6px">בדיקה אחרונה: ${fmtDate(tests[tests.length - 1].date)}/${parseKey(tests[tests.length - 1].date).getFullYear()}${tests.length > 1 ? ' · השינוי מוצג לעומת הבדיקה הקודמת' : ''}</p>${rows}
      <div class="legend" style="margin-top:10px"><span><i style="background:var(--eat-ink)"></i>תקין</span><span><i style="background:#c98a1a"></i>גבולי</span><span><i style="background:var(--danger-ink)"></i>גבוה / נמוך</span></div>`
      : '<p class="muted" style="margin:0">עדיין אין בדיקות. אפשר להוסיף למטה – ממלאים רק את הערכים שיש.</p>'}
  </div>

  <div class="card">
    <h2>📅 בדיקה הבאה</h2>
    <label class="field" style="margin-top:0"><span class="muted small">תאריך מתוכנן (תזכורת תופיע במסך ״היום״)</span>
      <input type="date" id="bloodNext" value="${next || ''}"></label>
    ${next ? `<p class="small" style="margin:6px 0 0">${nextIn > 0 ? `בעוד ${nextIn} ימים` : nextIn === 0 ? '<b>היום</b>' : '<b style="color:var(--warn-ink)">הגיע הזמן</b>'} <button class="btn ghost" data-act="blood-next-clear" style="min-height:36px;margin-inline-start:6px">ניקוי</button></p>` : ''}
  </div>

  <form class="card" id="bloodForm" autocomplete="off">
    <h2>➕ הוספת בדיקה</h2>
    <label class="field" style="margin-top:0"><span>תאריך הבדיקה</span><input type="date" name="date" value="${today}" max="${today}" required></label>
    <div class="lab-grid">
      ${LABS.map((L) => `<label class="field"><span>${esc(L.name)} <span class="muted small">${L.unit}</span></span><input type="number" name="${L.k}" inputmode="decimal" step="any" min="0" placeholder="${L.he ? esc(L.he) : '–'}"></label>`).join('')}
    </div>
    <p class="muted small" style="margin:8px 0 0">כל השדות רשות. בדיקה באותו תאריך – מתעדכנת.</p>
    <button class="btn block" type="submit" style="margin-top:12px">שמירת בדיקה</button>
  </form>

  ${tests.length ? `<div class="card">
    <h2>היסטוריה</h2>
    <ul class="log-list">${[...tests].reverse().map((t) => `<li>
      <details class="grow"><summary><b>${fmtDate(t.date)}/${parseKey(t.date).getFullYear() % 100}</b> <span class="muted small">· ${LABS.filter((L) => Number.isFinite(t[L.k])).length} ערכים</span></summary>
        <div class="small">${LABS.filter((L) => Number.isFinite(t[L.k])).map((L) => `<span class="lab-chip st-${labStatus(L, t[L.k], kind)}">${esc(L.name)} ${fmtLab(t[L.k])}</span>`).join(' ')}</div>
      </details>
      <button class="del" data-delb="${t.date}" aria-label="מחיקת בדיקה">🗑️</button></li>`).join('')}</ul>
  </div>` : ''}
  <p class="muted small" style="text-align:center;margin-top:10px">טווחים כלליים למבוגרים – הפירוש וההחלטות עם הרופא/ה. הנתונים נשמרים רק במכשיר הזה (וכלולים בגיבוי).</p>`;

  $('#screen-weight').innerHTML = html;
}

const fmtCm = (n) => `${n < 0 ? '−' : n > 0 ? '+' : ''}${fmtKg(Math.abs(n))} ס״מ`;

function measureCard(p, ms, today, due) {
  const change = (f) => {
    const arr = ms.filter((m) => m[f]);
    if (!arr.length) return { last: null };
    const first = arr[0][f];
    const last = arr[arr.length - 1][f];
    return { last, diff: r1(last - first), single: arr.length === 1 };
  };
  const w = change('waist');
  const h = change('hips');
  const female = p.kind === 'f';
  const c = change('chest');
  const both = ms.filter((m) => m.waist && m.hips);
  const lastBoth = both[both.length - 1];
  const target = WHR_TARGET[p.kind];
  const ratio = lastBoth ? lastBoth.waist / lastBoth.hips : null;
  const changeText = (c) => (c.last == null ? '' : c.single ? 'מדידה ראשונה' : c.diff === 0 ? 'ללא שינוי' : `${fmtCm(c.diff)} מההתחלה`);
  const changeCls = (c) => (c.diff < 0 ? 'down' : c.diff > 0 ? 'up' : '');
  const lastDate = ms.length ? ms[ms.length - 1].date : null;

  return `<div class="card" id="measureCard">
    <h2>📏 מדידות גוף</h2>
    <p class="muted small" style="margin:0 0 4px">פעם בשבועיים${lastDate ? ` · אחרונה: ${fmtDate(lastDate)}` : ''}${due ? ' · <b style="color:var(--warn-ink)">הגיע הזמן למדוד</b>' : ''}</p>
    <form id="measureForm" autocomplete="off">
      <label class="field"><span>תאריך</span><input type="date" name="date" value="${today}" max="${today}" required></label>
      <div class="row">
        <label class="field"><span>מותניים (ס״מ)</span><input type="number" name="waist" inputmode="decimal" step="0.5" min="40" max="200" placeholder="בגובה הטבור"></label>
        <label class="field"><span>ירכיים/ישבן (ס״מ)</span><input type="number" name="hips" inputmode="decimal" step="0.5" min="50" max="220" placeholder="בנקודה הרחבה"></label>
      </div>
      ${female ? '<label class="field"><span>חזה (ס״מ)</span><input type="number" name="chest" inputmode="decimal" step="0.5" min="50" max="200" placeholder="בנקודה המלאה ביותר"></label>' : ''}
      <button class="btn block" type="submit" style="margin-top:14px">שמירת מדידה</button>
    </form>
    <details class="howto"><summary>איך מודדים?</summary>
      <ul class="small">
        <li>בבוקר, על בטן ריקה (אחרי שירותים, לפני אוכל ושתייה).</li>
        <li>באותה נקודה בכל פעם: מותניים – בגובה הטבור; ירכיים – בנקודה הרחבה ביותר של הישבן.</li>
        <li>סרט מדידה ישר ומקביל לרצפה, צמוד לעור בלי ללחוץ, בסוף נשיפה רגילה.</li>
        ${female ? '<li>חזה – בנקודה המלאה ביותר: בלי חזייה או עם אותה חזייה בכל פעם, בעמידה זקופה, הסרט ישר ולא הדוק. המידה יכולה להשתנות מעט במהלך המחזור – לכן כדאי למדוד באותו שלב במחזור, ולא להיבהל משינוי קטן.</li>' : ''}
      </ul>
    </details>
    ${ms.length ? `
    <div class="stats" style="margin-top:14px">
      <div class="stat"><div class="v">${w.last != null ? fmtKg(w.last) : '–'}</div><div class="k">מותניים (ס״מ)</div><div class="chg ${changeCls(w)}">${changeText(w)}</div></div>
      <div class="stat"><div class="v">${h.last != null ? fmtKg(h.last) : '–'}</div><div class="k">ירכיים (ס״מ)</div><div class="chg ${changeCls(h)}">${changeText(h)}</div></div>
      ${female ? `<div class="stat"><div class="v">${c.last != null ? fmtKg(c.last) : '–'}</div><div class="k">חזה (ס״מ)</div><div class="chg ${changeCls(c)}">${changeText(c)}</div></div>` : ''}
    </div>
    <div class="whr ${ratio == null ? '' : ratio < target ? 'ok' : 'over'}">
      <div><b>יחס מותניים־ירכיים</b><div class="muted small">יעד: מתחת ל־${target.toFixed(2)} (${p.kind === 'f' ? 'אישה' : 'גבר'})</div></div>
      <div class="whr-v">${ratio == null ? '<span class="muted small">צריך מדידה של שניהם</span>' : `${ratio.toFixed(2)}${ratio < target ? ' ✓' : ''}`}</div>
    </div>
    ${ratio != null && ratio >= target ? `<p class="muted small" style="margin:6px 0 0">כדי להגיע ליעד: מותניים של פחות מ־${fmtKg(target * lastBoth.hips)} ס״מ (לפי הירכיים הנוכחיות).</p>` : ''}
    ${ms.length > 1 ? '<div class="chart-wrap small-chart" style="margin-top:12px"><canvas id="measureChart" role="img" aria-label="גרף מדידות גוף"></canvas></div>' : ''}
    ${(() => {
      const names = [['waist', 'מותניים'], ['hips', 'ירכיים'], ...(female ? [['chest', 'חזה']] : [])];
      const lone = names.filter(([f]) => ms.filter((m) => m[f]).length === 1).map(([, n]) => n);
      if (!lone.length) return '';
      return `<p class="muted small" style="margin:6px 0 0">${ms.length > 1 ? 'נקודה בודדת בגרף' : 'הגרף יופיע'} – הקו של ${lone.join(', ')} יופיע אחרי המדידה השנייה.</p>`;
    })()}
    <ul class="log-list" style="margin-top:8px">${[...ms].reverse().filter((m) => m.waist || m.hips || (female && m.chest)).map((m) => `
      <li><span class="grow">${fmtDate(m.date)}/${parseKey(m.date).getFullYear() % 100}</span>
        <span class="small">${m.waist ? `מותניים <b>${fmtKg(m.waist)}</b>` : ''}${m.waist && m.hips ? ' · ' : ''}${m.hips ? `ירכיים <b>${fmtKg(m.hips)}</b>` : ''}${female && m.chest ? `${m.waist || m.hips ? ' · ' : ''}חזה <b>${fmtKg(m.chest)}</b>` : ''}</span>
        <button class="del" data-delm="${m.date}" aria-label="מחיקת מדידה">🗑️</button></li>`).join('')}</ul>` : ''}
  </div>`;
}

function drawMeasureChart(ms, female) {
  if (measureChart) { measureChart.destroy(); measureChart = null; }
  const canvas = $('#measureChart');
  if (!canvas) return;
  if (typeof Chart === 'undefined') { canvas.parentElement.innerHTML = '<p class="muted">הגרף ייטען כשיהיה חיבור לאינטרנט.</p>'; return; }
  const start = ms[0].date;
  const series = (f) => ms.filter((m) => m[f]).map((m) => ({ x: daysBetween(start, m.date), y: m[f] }));
  const lastX = Math.max(daysBetween(start, ms[ms.length - 1].date), 1);
  const ds = (label, f, color) => {
    const data = series(f);
    return { label, data, borderColor: color, backgroundColor: color, borderWidth: 2.5, pointRadius: data.length === 1 ? 6 : 3, tension: 0.2 };
  };
  measureChart = new Chart(canvas, {
    type: 'line',
    data: {
      datasets: [
        ds('מותניים', 'waist', '#2e6b5e'),
        ds('ירכיים', 'hips', '#c07a2c'),
        ...(female && ms.some((m) => m.chest) ? [ds('חזה', 'chest', '#8a5a9e')] : []),
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: { rtl: true, labels: { boxWidth: 12, font: { size: 12 } } },
        tooltip: {
          rtl: true,
          callbacks: {
            title: (items) => fmtDate(addDays(start, Math.round(items[0].parsed.x))),
            label: (it) => `${it.dataset.label}: ${fmtKg(it.parsed.y)} ס״מ`,
          },
        },
      },
      scales: {
        x: { type: 'linear', min: 0, max: lastX, ticks: { callback: (v) => fmtDate(addDays(start, Math.round(v))), maxTicksLimit: 5, font: { size: 11 } }, grid: { color: '#eef2f0' } },
        y: { ticks: { font: { size: 11 } }, grid: { color: '#eef2f0' } },
      },
    },
  });
}

function drawChart(p) {
  if (chart) { chart.destroy(); chart = null; }
  const canvas = $('#weightChart');
  if (!canvas) return;
  if (typeof Chart === 'undefined') {
    canvas.parentElement.innerHTML = '<p class="muted">הגרף ייטען כשיהיה חיבור לאינטרנט.</p>';
    return;
  }
  const s = p.setup;
  const ws = sortedWeights(p);
  const pts = [{ x: 0, y: s.startWeight }, ...ws.map((w) => ({ x: daysBetween(s.startDate, w.date), y: w.kg }))]
    .sort((a, b) => a.x - b.x);
  const lastX = Math.max(daysBetween(s.startDate, todayKey()), pts[pts.length - 1].x, 14);
  const goalX = Math.max(0, (s.startWeight - s.goalWeight) * 7);
  const pace = [{ x: 0, y: s.startWeight }];
  if (goalX < lastX) pace.push({ x: goalX, y: s.goalWeight }, { x: lastX, y: s.goalWeight });
  else pace.push({ x: lastX, y: s.startWeight - lastX / 7 });

  const allY = [...pts.map((q) => q.y), ...pace.map((q) => q.y), s.goalWeight];
  const minY = Math.floor(Math.min(...allY) - 1);
  const maxY = Math.ceil(Math.max(...allY) + 1);

  chart = new Chart(canvas, {
    type: 'line',
    data: {
      datasets: [
        { label: 'משקל', data: pts, borderColor: '#2e6b5e', backgroundColor: '#2e6b5e', borderWidth: 3, pointRadius: 4, tension: 0.2 },
        { label: 'קצב צפוי (1 ק״ג/שבוע)', data: pace, borderColor: '#9aa8a4', borderDash: [6, 6], borderWidth: 2, pointRadius: 0, tension: 0 },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: { rtl: true, labels: { boxWidth: 14, font: { size: 12 } } },
        tooltip: {
          rtl: true,
          callbacks: {
            title: (items) => fmtDate(addDays(s.startDate, Math.round(items[0].parsed.x))),
            label: (it) => `${it.dataset.label}: ${fmtKg(it.parsed.y)} ק״ג`,
          },
        },
      },
      scales: {
        x: {
          type: 'linear', min: Math.min(0, pts[0].x), max: lastX,
          ticks: { callback: (v) => fmtDate(addDays(s.startDate, Math.round(v))), maxTicksLimit: 6, font: { size: 11 } },
          grid: { color: '#eef2f0' },
        },
        y: { min: minY, max: maxY, ticks: { font: { size: 11 } }, grid: { color: '#eef2f0' } },
      },
    },
  });
}

/* ============ Screen: Menus ============ */
function renderMenus() {
  const p = profile();
  if (!menuSel) {
    const wd = new Date().getDay();
    menuSel = MENU_BY_WEEKDAY[wd] || 'A';
  }
  if (menuSel === 'FAST' && !isModified(p)) menuSel = 'A';
  const other = p.kind === 'f' ? 'm' : 'f';
  const otherLabel = other === 'm' ? 'לגבר' : 'לאישה';
  // The partner whose portions are shown as "other" – use their health adjustments too
  const otherProf = PROFILE_IDS.map((id) => state.profiles[id]).find((x) => x !== p && x.kind === other) || null;
  const segs = `<div class="seg" role="tablist">${MENUS.map((x) => `<button data-menu-sel="${x.id}" class="${x.id === menuSel ? 'active' : ''}">${esc(x.title)}</button>`).join('')}${isModified(p) ? `<button data-menu-sel="FAST" class="${menuSel === 'FAST' ? 'active' : ''}">יום צום</button>` : ''}</div>`;

  let body;
  if (menuSel === 'FAST') {
    body = modifiedFastCard();
  } else {
    const m = MENUS.find((x) => x.id === menuSel);
    const adjusted = p.health.chol;
    body = `<div class="card">
    <h2>${esc(m.title)}${m.day !== m.title ? ` <span class="muted small">· ${esc(m.day)}</span>` : ''}</h2>
    <p style="margin:0 0 6px"><span class="pill">מנות ל${esc(p.name)} · כ־${p.kind === 'f' ? '1,800' : '2,200–2,400'} קק״ל</span>${m.note ? ` <span class="pill">${esc(m.note)}</span>` : ''}${adjusted ? ' <span class="pill warn">מותאם לכולסטרול גבוה</span>' : ''}</p>
    ${m.meals.map((meal) => {
      const mine = menuText(meal, p.kind, p);
      const theirs = menuText(meal, other, otherProf);
      return `<div class="meal"><div class="mn">${esc(meal.name)}</div><div>${esc(mine)}</div>${theirs !== mine ? `<div class="other">${otherLabel}: ${esc(theirs)}</div>` : ''}</div>`;
    }).join('')}
  </div>`;
  }

  $('#screen-menus').innerHTML = `
  ${segs}
  ${body}
  <div class="card">
    <h2>כללים</h2>
    <ul>${MENU_RULES.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
  </div>`;
}

/* ============ Screen: Swaps & lists ============ */
function renderSwaps() {
  const tags = (arr, cls = '') => `<div class="tags ${cls}">${arr.map((t) => `<span>${esc(t)}</span>`).join('')}</div>`;
  $('#screen-swaps').innerHTML = `
  <div class="card">
    <h2>🔄 החלפות שוות ערך</h2>
    ${SWAPS.map((g) => `<h3>${esc(g.title)}</h3><div class="swap">${g.items.map((i) => `<span class="s">${esc(i)}</span>`).join('<span class="eq">=</span>')}</div>`).join('')}
  </div>
  <div class="card">
    <h2>🥦 ירקות</h2>
    <h3>בלי הגבלה (בלי שמן)</h3>
    ${tags(VEG_FREE)}
    <h3>נספרים כפחמימה</h3>
    ${tags(VEG_CARB, 'carb')}
    <h3>נספרים כשומן</h3>
    ${tags(VEG_FAT, 'fat')}
    <ul style="margin-top:12px">${VEG_NOTES.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>
  </div>
  <div class="card">
    <h2>🍎 פירות</h2>
    <p style="margin:0">${esc(FRUIT.intro)}</p>
    <h3>${esc(FRUIT.light.title)}</h3>${tags(FRUIT.light.items)}
    <h3>${esc(FRUIT.smaller.title)}</h3>${tags(FRUIT.smaller.items, 'carb')}
    <h3>${esc(FRUIT.little.title)}</h3>${tags(FRUIT.little.items, 'fat')}
  </div>`;
}

/* ============ Screen: Shopping ============ */
function renderShop() {
  const items = state.shopping;
  const left = items.filter((i) => !i.done).length;
  $('#screen-shop').innerHTML = `
  <div class="card">
    <h2>🛒 רשימת קניות שבועית <span class="muted small">· משותפת</span></h2>
    <p class="muted" style="margin:0 0 8px">${left ? `נשארו ${left} מתוך ${items.length}` : items.length ? 'הכול נקנה! 🎉' : 'הרשימה ריקה'}</p>
    <form class="add-row" id="shopAdd" autocomplete="off">
      <input type="text" name="text" placeholder="הוספת פריט…" aria-label="פריט חדש" maxlength="80">
      <button class="btn" type="submit">הוספה</button>
    </form>
    <div style="margin-top:8px">
      ${items.map((i) => `<div class="shop-item ${i.done ? 'checked' : ''}">
        <label><input type="checkbox" data-shop="${esc(i.id)}" ${i.done ? 'checked' : ''}><span class="t">${esc(i.text)}</span></label>
        <button class="del" data-shopdel="${esc(i.id)}" aria-label="הסרת ${esc(i.text)}">✕</button>
      </div>`).join('')}
    </div>
    <div class="btn-row">
      <button class="btn ghost" data-act="shop-reset">🔁 שבוע חדש (ניקוי סימונים)</button>
      <button class="btn ghost" data-act="shop-default">שחזור רשימה מקורית</button>
    </div>
  </div>`;
}

/* ============ Documents (IndexedDB, device only) ============ */
// Files are kept in IndexedDB on this device only – never uploaded anywhere.
const DOCS_DB = 'hamaslul-docs';
let dbPromise = null;
let docs = null;              // in-memory list (with data) once loaded; null while loading
let docsError = false;
let pendingFile = null;       // file chosen, waiting for title/date/owner
const docUrls = new Map();    // id -> object URL

function idb() {
  if (!dbPromise) {
    dbPromise = new Promise((res, rej) => {
      if (!('indexedDB' in window)) { rej(new Error('no idb')); return; }
      const r = indexedDB.open(DOCS_DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore('docs', { keyPath: 'id' });
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    dbPromise.catch(() => { dbPromise = null; });
  }
  return dbPromise;
}

function idbRun(mode, fn) {
  return idb().then((db) => new Promise((res, rej) => {
    const t = db.transaction('docs', mode);
    const req = fn(t.objectStore('docs'));
    t.oncomplete = () => res(req ? req.result : undefined);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error || new Error('abort'));
  }));
}

function loadDocs() {
  return idbRun('readonly', (s) => s.getAll()).then((all) => {
    docs = all || [];
    docsError = false;
  }).catch(() => { docs = []; docsError = true; });
}

const docById = (id) => (id && docs ? docs.find((d) => d.id === id) : null) || null;
const docBlob = (d) => new Blob([d.data], { type: d.type || 'application/octet-stream' });
function docUrl(d) {
  if (!docUrls.has(d.id)) docUrls.set(d.id, URL.createObjectURL(docBlob(d)));
  return docUrls.get(d.id);
}
function dropDocUrl(id) {
  const u = docUrls.get(id);
  if (u) { URL.revokeObjectURL(u); docUrls.delete(id); }
}
const docsBytes = () => (docs || []).reduce((a, d) => a + (d.size || 0), 0);
const fmtMB = (b) => (b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1048576).toLocaleString('he-IL', { maximumFractionDigits: 1 })} MB`);
const ownerName = (o) => (o === 'shared' ? 'משותף' : state.profiles[o] ? state.profiles[o].name : 'משותף');
const isPdf = (d) => /pdf/i.test(d.type) || /\.pdf$/i.test(d.name || '');
const docFileName = (d) => {
  const ext = (d.name && d.name.includes('.')) ? d.name.slice(d.name.lastIndexOf('.')) : (isPdf(d) ? '.pdf' : '');
  const base = String(d.title || 'מסמך').replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'מסמך';
  return base.toLowerCase().endsWith(ext.toLowerCase()) ? base : base + ext;
};

function docsClear() {
  for (const id of [...docUrls.keys()]) dropDocUrl(id);
  docs = [];
  return idbRun('readwrite', (s) => s.clear()).catch(() => {});
}

function openDoc(d) {
  if (!d) { toast('המסמך לא נמצא במכשיר הזה'); return; }
  const url = docUrl(d);
  // Must stay synchronous inside the tap so the browser doesn't block the new tab
  const w = window.open(url, '_blank');
  if (!w) {
    const a = document.createElement('a');
    a.href = url; a.target = '_blank'; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
  }
}

function downloadDoc(d) {
  const a = document.createElement('a');
  a.href = docUrl(d); a.download = docFileName(d);
  document.body.appendChild(a); a.click(); a.remove();
}

async function shareDoc(d) {
  try {
    const file = new File([d.data], docFileName(d), { type: d.type || 'application/octet-stream' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: d.title });
      return;
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return;
  }
  downloadDoc(d);
  toast('שיתוף לא נתמך כאן – הקובץ הורד');
}

function pickDoc() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/pdf,.pdf,image/*';
  input.onchange = () => {
    const file = input.files && input.files[0];
    if (!file) return;
    if (!/pdf|image\//i.test(file.type) && !/\.pdf$/i.test(file.name)) { toast('אפשר להעלות רק PDF או תמונה'); return; }
    pendingFile = file;
    renderDocs();
    const f = $('#docForm');
    if (f) f.scrollIntoView({ block: 'start' });
  };
  input.click();
}

async function saveDoc(form) {
  const f = new FormData(form);
  const file = pendingFile;
  if (!file) return;
  const btn = form.querySelector('[type=submit]');
  if (btn) btn.disabled = true;
  try {
    const rec = {
      id: 'doc' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      title: String(f.get('title') || '').trim().slice(0, 80) || file.name,
      date: f.get('date') || todayKey(),
      owner: ['shared', ...PROFILE_IDS].includes(f.get('owner')) ? f.get('owner') : 'shared',
      name: file.name,
      type: file.type || (/\.pdf$/i.test(file.name) ? 'application/pdf' : ''),
      size: file.size,
      added: Date.now(),
      data: await file.arrayBuffer(),
    };
    await idbRun('readwrite', (s) => s.put(rec));
    docs = [...(docs || []), rec];
    if (f.get('setMenu') && rec.owner !== 'shared') { state.profiles[rec.owner].menuDoc = rec.id; save(); }
    pendingFile = null;
    renderDocs();
    toast('המסמך נשמר במכשיר ✓');
  } catch (e) {
    if (btn) btn.disabled = false;
    toast(e && e.name === 'QuotaExceededError' ? 'אין מספיק מקום במכשיר' : 'שגיאה בשמירת הקובץ');
  }
}

async function updateDoc(d, patch) {
  const rec = { ...d, ...patch };
  await idbRun('readwrite', (s) => s.put(rec));
  docs = docs.map((x) => (x.id === d.id ? rec : x));
}

let storageEstimate = null;
function refreshEstimate() {
  if (!(navigator.storage && navigator.storage.estimate)) return;
  navigator.storage.estimate().then((e) => {
    const changed = !storageEstimate || storageEstimate.usage !== e.usage;
    storageEstimate = e;
    if (changed && tab === 'docs' && !overlay) renderDocs();
  }).catch(() => {});
}

function renderDocs() {
  const el = $('#screen-docs');
  if (docs === null) { el.innerHTML = '<div class="card"><p class="muted" style="margin:0">טוען מסמכים…</p></div>'; return; }
  const p = profile();
  const today = todayKey();
  const owners = ['shared', ...PROFILE_IDS];
  const currentOf = (id) => PROFILE_IDS.filter((pid) => state.profiles[pid].menuDoc === id);
  const sorted = [...docs].sort((a, b) => b.date.localeCompare(a.date) || b.added - a.added);

  const docItem = (d) => {
    const cur = currentOf(d.id);
    const target = d.owner === 'shared' ? state.active : d.owner;
    const isCur = state.profiles[target].menuDoc === d.id;
    return `<div class="doc">
      <div class="doc-head">
        <span class="doc-ic" aria-hidden="true">${isPdf(d) ? '📄' : '🖼️'}</span>
        <div class="grow">
          <b>${esc(d.title)}</b>
          <div class="muted small">${fmtDate(d.date)}/${parseKey(d.date).getFullYear()} · ${fmtMB(d.size)}</div>
          ${cur.length ? `<div>${cur.map((pid) => `<span class="pill">⭐ התפריט הנוכחי${PROFILE_IDS.length > 1 ? ` של ${esc(state.profiles[pid].name)}` : ''}</span>`).join(' ')}</div>` : ''}
        </div>
      </div>
      <div class="doc-acts">
        <button class="btn" data-doc="open" data-id="${d.id}">פתיחה</button>
        <button class="btn ghost" data-doc="share" data-id="${d.id}">שיתוף</button>
        <button class="btn ghost" data-doc="download" data-id="${d.id}">הורדה</button>
        <button class="btn ghost" data-doc="rename" data-id="${d.id}">שינוי שם</button>
        <button class="btn ghost" data-doc="menu" data-id="${d.id}">${isCur ? 'ביטול תפריט נוכחי' : 'קבע כתפריט נוכחי'}${d.owner === 'shared' ? ` ל${esc(state.profiles[target].name)}` : ''}</button>
        <button class="btn danger" data-doc="delete" data-id="${d.id}">מחיקה</button>
      </div>
    </div>`;
  };

  let html = `<div class="card">
    <h2>📁 מסמכים</h2>
    <p class="muted small" style="margin:0 0 10px">תפריטים מעודכנים ומסמכים אחרים (PDF או תמונה).</p>
    <button class="btn block" data-act="doc-pick">➕ העלאת קובץ</button>
    ${docsError ? '<p class="warn-line small">לא ניתן לשמור מסמכים בדפדפן הזה (ייתכן שזה מצב גלישה פרטית).</p>' : ''}
  </div>`;

  if (pendingFile) {
    const base = pendingFile.name.replace(/\.[^.]+$/, '');
    html += `<form class="card" id="docForm" autocomplete="off">
      <h2>פרטי המסמך</h2>
      <p class="muted small" style="margin:0">${esc(pendingFile.name)} · ${fmtMB(pendingFile.size)}</p>
      <label class="field"><span>כותרת</span><input type="text" name="title" value="${esc(base)}" maxlength="80" required></label>
      <label class="field"><span>תאריך</span><input type="date" name="date" value="${today}" required></label>
      <label class="field"><span>שייך ל־</span>
        <select name="owner">${owners.map((o) => `<option value="${o}" ${o === state.active ? 'selected' : ''}>${esc(ownerName(o))}</option>`).join('')}</select></label>
      <label class="chk"><input type="checkbox" name="setMenu"> לקבוע כתפריט הנוכחי (לא חל על ״משותף״)</label>
      <div class="btn-row">
        <button class="btn" type="submit">שמירה</button>
        <button class="btn ghost" type="button" data-act="doc-cancel">ביטול</button>
      </div>
    </form>`;
  }

  const groups = owners.map((o) => ({ o, list: sorted.filter((d) => (owners.includes(d.owner) ? d.owner : 'shared') === o) })).filter((g) => g.list.length);
  if (!groups.length && !pendingFile) {
    html += '<div class="card"><p class="muted" style="margin:0">עדיין אין מסמכים.</p></div>';
  }
  for (const g of groups) {
    html += `<div class="card"><h2>${g.o === 'shared' ? '👥 משותף' : `👤 ${esc(ownerName(g.o))}`} <span class="muted small">· ${g.list.length}</span></h2>${g.list.map(docItem).join('')}</div>`;
  }

  const est = storageEstimate;
  html += `<div class="card">
    <h2>💽 אחסון</h2>
    <p style="margin:0">המסמכים תופסים <b>${fmtMB(docsBytes())}</b>${docs.length ? ` (${docs.length} קבצים)` : ''}.</p>
    ${est && est.quota ? `<p class="muted small" style="margin:4px 0 0">שטח פנוי לאפליקציה במכשיר: כ־${fmtMB(Math.max(0, est.quota - est.usage))}</p>` : ''}
    <p class="note small" style="margin:10px 0 0">📱 המסמכים נשמרים רק במכשיר הזה. בטלפון אחר צריך להעלות אותם שוב או לשחזר מגיבוי.</p>
  </div>`;
  if (p && docs.length && !state.backupDocs) html += '<p class="muted small" style="text-align:center">כדי לגבות גם את המסמכים: ⚙️ הגדרות › גיבוי › ״לכלול מסמכים בגיבוי״.</p>';

  el.innerHTML = html;
  refreshEstimate();
}

async function docAction(act, id) {
  const d = docById(id);
  if (!d) { toast('המסמך לא נמצא'); return; }
  if (act === 'open') { openDoc(d); return; }
  if (act === 'download') { downloadDoc(d); return; }
  if (act === 'share') { shareDoc(d); return; }
  if (act === 'rename') {
    const t = prompt('שם חדש למסמך:', d.title);
    if (t == null) return;
    const title = t.trim().slice(0, 80);
    if (!title) return;
    try { await updateDoc(d, { title }); renderDocs(); toast('השם עודכן ✓'); } catch (e) { toast('שגיאה בשמירה'); }
    return;
  }
  if (act === 'menu') {
    const pid = d.owner === 'shared' ? state.active : d.owner;
    const prof = state.profiles[pid];
    prof.menuDoc = prof.menuDoc === d.id ? null : d.id;
    save(); renderDocs();
    toast(prof.menuDoc ? `נקבע כתפריט הנוכחי של ${prof.name} ✓` : 'בוטל');
    return;
  }
  if (act === 'delete') {
    if (!confirm(`למחוק את ״${d.title}״ מהמכשיר?`)) return;
    try {
      await idbRun('readwrite', (s) => s.delete(d.id));
      docs = docs.filter((x) => x.id !== d.id);
      dropDocUrl(d.id);
      let changed = false;
      for (const pid of PROFILE_IDS) if (state.profiles[pid].menuDoc === d.id) { state.profiles[pid].menuDoc = null; changed = true; }
      if (changed) save();
      renderDocs(); toast('המסמך נמחק');
    } catch (e) { toast('שגיאה במחיקה'); }
  }
}

// Backup helpers: ArrayBuffer <-> base64
function bufToB64(buf, type) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1] || '');
    r.onerror = () => rej(r.error);
    r.readAsDataURL(new Blob([buf], { type: type || 'application/octet-stream' }));
  });
}
function b64ToBuf(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

/* ============ Setup ============ */
let setupDraft = null;

function renderSetup(pid) {
  const p = state.profiles[pid];
  const editing = !!p.setup;
  if (!setupDraft || setupDraft.pid !== pid) {
    setupDraft = { pid, kind: p.kind, fastDays: p.setup ? [...p.setup.fastDays] : [0, 2, 4], weighDay: p.setup ? p.setup.weighDay : 1 };
  }
  const s = p.setup || {};
  const ph = setupDraft.kind === 'm' ? { min: 2200, max: 2400, shab: 2500 } : { min: 1800, max: 1900, shab: 2000 };
  const anySetup = PROFILE_IDS.some((id) => state.profiles[id].setup);
  const v = (x) => (x ?? '');

  $('#screen-setup').innerHTML = `
  ${!anySetup ? `<div class="card" style="background:var(--accent-soft)">
    <h2>ברוכים הבאים 🌿</h2>
    <p style="margin:0">מעקב צום לסירוגין ומשקל לשניים. הנתונים נשמרים רק במכשיר הזה.</p>
    <p class="small" style="margin:8px 0 0">כבר יש לכם קובץ גיבוי? <button class="btn ghost" data-act="restore" style="min-height:40px">שחזור מגיבוי</button></p>
  </div>` : ''}
  <form class="card" id="setupForm" autocomplete="off">
    <h2>${editing ? 'עריכת הגדרות' : 'הגדרה ראשונית'} – ${esc(p.name)}</h2>
    <label class="field"><span>שם</span><input type="text" name="name" value="${esc(p.name)}" maxlength="20" required></label>
    <div class="field"><span style="display:block;font-weight:600;margin:12px 0 4px">גודל מנות בתפריט</span>
      <div class="seg">
        <button type="button" data-kind="f" class="${setupDraft.kind === 'f' ? 'active' : ''}">אישה</button>
        <button type="button" data-kind="m" class="${setupDraft.kind === 'm' ? 'active' : ''}">גבר</button>
      </div>
    </div>
    <div class="row">
      <label class="field"><span>משקל התחלתי (ק״ג)</span><input type="number" name="startWeight" inputmode="decimal" step="0.1" min="30" max="300" required value="${v(s.startWeight)}"></label>
      <label class="field"><span>גובה (ס״מ)</span><input type="number" name="height" inputmode="numeric" step="1" min="120" max="230" required value="${v(s.height)}"></label>
    </div>
    <div class="row">
      <label class="field"><span>משקל יעד (ק״ג)</span><input type="number" name="goalWeight" inputmode="decimal" step="0.1" min="30" max="300" required value="${v(s.goalWeight)}"></label>
      <label class="field"><span>תאריך התחלה</span><input type="date" name="startDate" required value="${v(s.startDate) || todayKey()}"></label>
    </div>
    <h3>קלוריות בימי אכילה</h3>
    <div class="row">
      <label class="field"><span>מ־</span><input type="number" name="calMin" inputmode="numeric" step="50" min="800" max="5000" placeholder="${ph.min}" value="${v(s.calMin)}"></label>
      <label class="field"><span>עד</span><input type="number" name="calMax" inputmode="numeric" step="50" min="800" max="5000" placeholder="${ph.max}" value="${v(s.calMax)}"></label>
      <label class="field"><span>שבת עד</span><input type="number" name="calShabbat" inputmode="numeric" step="50" min="800" max="5000" placeholder="${ph.shab}" value="${v(s.calShabbat)}"></label>
    </div>
    <p class="muted small" style="margin:4px 0 0">שדה ריק = הערך המוצע שמופיע באפור.</p>
    <h3>ימי צום</h3>
    <div class="chips">${WEEKDAYS_SHORT.map((d, i) => `<button type="button" class="chip ${setupDraft.fastDays.includes(i) ? 'on' : ''}" data-fastday="${i}" aria-pressed="${setupDraft.fastDays.includes(i)}">${d}</button>`).join('')}</div>
    <p class="muted small" style="margin:4px 0 0">מסומן = צום. ברירת מחדל: א׳, ג׳, ה׳.</p>
    <h3>יום שקילה</h3>
    <div class="chips">${WEEKDAYS_SHORT.map((d, i) => `<button type="button" class="chip weigh ${setupDraft.weighDay === i ? 'on' : ''}" data-weighday="${i}" aria-pressed="${setupDraft.weighDay === i}">${d}</button>`).join('')}</div>
    <button class="btn block" type="submit" style="margin-top:18px">שמירה</button>
    ${overlay === 'setup' ? '<button class="btn ghost block" type="button" data-act="setup-cancel" style="margin-top:8px">ביטול</button>' : ''}
  </form>`;
}

function submitSetup(form) {
  const pid = setupDraft.pid;
  const p = state.profiles[pid];
  const f = new FormData(form);
  const ph = setupDraft.kind === 'm' ? { min: 2200, max: 2400, shab: 2500 } : { min: 1800, max: 1900, shab: 2000 };
  const sw = num(f.get('startWeight')), h = num(f.get('height')), g = num(f.get('goalWeight'));
  if (!sw || !h || !g) { toast('נא למלא משקל, גובה ויעד'); return; }
  if (g >= sw) { toast('משקל היעד צריך להיות נמוך מהמשקל ההתחלתי'); return; }
  if (!setupDraft.fastDays.length) { toast('נא לבחור לפחות יום צום אחד'); return; }
  let calMin = num(f.get('calMin')) || ph.min;
  let calMax = num(f.get('calMax')) || ph.max;
  if (calMin > calMax) [calMin, calMax] = [calMax, calMin];
  p.name = String(f.get('name') || '').trim().slice(0, 20) || p.name;
  p.kind = setupDraft.kind;
  p.setup = {
    startWeight: sw, height: h, goalWeight: g,
    startDate: f.get('startDate') || todayKey(),
    calMin, calMax, calShabbat: num(f.get('calShabbat')) || ph.shab,
    fastDays: [...setupDraft.fastDays].sort(), weighDay: setupDraft.weighDay,
  };
  save();
  setupDraft = null;
  const wasOverlay = overlay;
  overlay = null;
  setupFor = null;
  toast('נשמר ✓');
  if (!wasOverlay) {
    state.active = pid;
    const otherId = PROFILE_IDS.find((id) => !state.profiles[id].setup);
    if (otherId) toast(`נשמר ✓ אפשר להגדיר גם את ${state.profiles[otherId].name} מהבורר למעלה`);
  }
  tab = 'today';
  render();
  window.scrollTo(0, 0);
}

/* ============ Settings ============ */
function renderSettings() {
  $('#screen-settings').innerHTML = `
  <div class="card">
    <h2>⚙️ הגדרות</h2>
    <h3>שמות</h3>
    <form id="namesForm" autocomplete="off">
      <div class="row">
        ${PROFILE_IDS.map((id) => `<label class="field" style="margin-top:0"><span class="muted small">פרופיל ${id === 'p1' ? '1' : '2'}</span><input type="text" name="${id}" value="${esc(state.profiles[id].name)}" maxlength="20" required></label>`).join('')}
      </div>
      <button class="btn ghost block" type="submit" style="margin-top:10px">שמירת שמות</button>
    </form>
    <h3>הגדרות אישיות</h3>
    <div class="btn-row">${PROFILE_IDS.map((id) => `<button class="btn ghost" data-editsetup="${id}">${state.profiles[id].setup ? 'עריכה' : 'הגדרה'} – ${esc(state.profiles[id].name)}</button>`).join('')}</div>
  </div>
  <div class="card" id="healthSettings">
    <h2>🩺 סוג יום צום והתאמות בריאותיות</h2>
    ${PROFILE_IDS.map((id) => {
      const pr = state.profiles[id];
      return `<h3>${esc(pr.name)}</h3>
        <span class="muted small">סוג יום צום</span>
        <div class="seg wrap" role="radiogroup" aria-label="סוג יום צום – ${esc(pr.name)}">
          <button type="button" role="radio" aria-checked="${pr.fastType === 'full'}" data-fasttype="${id}:full" class="${pr.fastType === 'full' ? 'active' : ''}">צום מלא</button>
          <button type="button" role="radio" aria-checked="${pr.fastType === 'modified'}" data-fasttype="${id}:modified" class="${pr.fastType === 'modified' ? 'active' : ''}">צום מתון <span class="nw">(500–600 קלוריות)</span></button>
        </div>
        <span class="muted small" style="display:block;margin-top:10px">התאמות בריאותיות</span>
        ${HEALTH_IDS.map((h) => `<label class="chk"><input type="checkbox" data-health="${id}:${h}" ${pr.health[h] ? 'checked' : ''}> ${esc(HEALTH[h].label)}</label>`).join('')}`;
    }).join('')}
    <p class="muted small" style="margin:10px 0 0">הטיפים יופיעו במסך ״היום״. ״כולסטרול גבוה״ מתאים גם את המנות בתפריטים. בדיקות דם: בלשונית ⚖️ משקל.</p>
  </div>
  <form class="card" id="waterForm" autocomplete="off">
    <h2>💧 יעד שתייה יומי (ליטרים)</h2>
    ${PROFILE_IDS.map((id) => {
      const t = waterTargets(state.profiles[id], true);
      const inp = (f, label) => `<label class="field" style="margin-top:6px"><span class="muted small">${label}</span><input type="number" inputmode="decimal" step="0.25" min="0.5" max="8" name="${id}-${f}" value="${t[f]}" required></label>`;
      return `<h3>${esc(state.profiles[id].name)}</h3>
        <div class="row">${inp('fastMin', 'יום צום – מ־')}${inp('fastMax', 'עד')}</div>
        <div class="row">${inp('eatMin', 'יום אכילה – מ־')}${inp('eatMax', 'עד')}</div>
        ${state.profiles[id].health.uric ? '<p class="muted small" style="margin:6px 0 0">💧 בגלל חומצה אורית גבוהה, היעד בימי צום הוא לפחות 3–3.5 ל׳.</p>' : ''}`;
    }).join('')}
    <div class="btn-row">
      <button class="btn" type="submit">שמירת יעדים</button>
      <button class="btn ghost" type="button" data-act="water-defaults">ברירת מחדל</button>
    </div>
  </form>
  <div class="card">
    <h2>💾 גיבוי ושחזור</h2>
    <p class="muted" style="margin:0">הנתונים נשמרים רק בטלפון הזה, ועלולים להימחק (ניקוי דפדפן, החלפת מכשיר). כדאי לגבות פעם בשבועיים ולשמור את הקובץ בדרייב/וואטסאפ.</p>
    <p class="small" style="margin:8px 0 0">גיבוי אחרון: <b>${state.lastBackup ? fmtDate(state.lastBackup.slice(0, 10)) + '/' + state.lastBackup.slice(0, 4) : 'אף פעם'}</b></p>
    <label class="chk"><input type="checkbox" id="backupDocs" ${state.backupDocs ? 'checked' : ''}> לכלול מסמכים בגיבוי</label>
    ${state.backupDocs ? `<p class="warn-line small">קובץ הגיבוי יהיה גדול יותר${docs && docs.length ? ` – בערך ${fmtMB(docsBytes() * 1.37 + 20000)}` : ''}.</p>` : ''}
    <div class="btn-row">
      <button class="btn" data-act="backup">⬇️ גיבוי</button>
      <button class="btn ghost" data-act="restore">⬆️ שחזור</button>
    </div>
  </div>
  <div class="card">
    <h2>מחיקה</h2>
    <button class="btn danger block" data-act="wipe">מחיקת כל הנתונים מהמכשיר</button>
  </div>
  <button class="btn ghost block" data-act="close-settings">חזרה</button>
  <p class="muted small" style="text-align:center">המסלול שלנו · גרסה ${APP_VERSION} · הנתונים לא יוצאים מהמכשיר</p>`;
}

/* ============ Backup / restore ============ */
async function backup() {
  const stamp = new Date().toISOString();
  const out = { app: 'hamaslul', version: 1, exportedAt: stamp, data: { ...state, lastBackup: stamp } };
  if (state.backupDocs) {
    if (docs === null) await loadDocs();
    try {
      toast('מכין גיבוי עם מסמכים…');
      out.docs = [];
      for (const d of docs) {
        const { data, ...meta } = d;
        out.docs.push({ ...meta, b64: await bufToB64(data, d.type) });
      }
    } catch (e) {
      toast('שגיאה בהכנת המסמכים לגיבוי');
      return;
    }
  }
  const payload = JSON.stringify(out, null, out.docs && out.docs.length ? 0 : 2);
  const name = `hamaslul-backup-${todayKey()}.json`;
  const blob = new Blob([payload], { type: 'application/json' });
  let ok = false;
  try {
    const file = new File([blob], name, { type: 'application/json' });
    if (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent) && navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: 'גיבוי – המסלול שלנו' });
      ok = true;
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return;
  }
  if (!ok) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
  state.lastBackup = stamp;
  save();
  toast(out.docs ? `הגיבוי נשמר ✓ (כולל ${out.docs.length} מסמכים)` : 'הגיבוי נשמר ✓');
  render();
}

function restore() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json,.json';
  input.onchange = async () => {
    const file = input.files && input.files[0];
    if (!file) return;
    try {
      const obj = JSON.parse(await file.text());
      const data = obj && obj.app === 'hamaslul' ? obj.data : obj;
      if (!data || !data.profiles || !PROFILE_IDS.some((id) => data.profiles[id])) throw new Error('bad');
      const bdocs = obj && Array.isArray(obj.docs) ? obj.docs.filter((d) => d && d.id && typeof d.b64 === 'string') : [];
      const msg = bdocs.length
        ? `השחזור יחליף את כל הנתונים במכשיר הזה, ויוסיף ${bdocs.length} מסמכים מהגיבוי (מסמכים שכבר במכשיר יישארו). להמשיך?`
        : 'השחזור יחליף את כל הנתונים במכשיר הזה. להמשיך?';
      if (!confirm(msg)) return;
      state = normalize(data);
      save();
      let restoredDocs = 0;
      if (bdocs.length) {
        try {
          const recs = bdocs.map(({ b64, ...meta }) => ({
            ...meta,
            title: String(meta.title || meta.name || 'מסמך'),
            date: typeof meta.date === 'string' ? meta.date : todayKey(),
            owner: ['shared', ...PROFILE_IDS].includes(meta.owner) ? meta.owner : 'shared',
            added: meta.added || Date.now(),
            data: b64ToBuf(b64),
          }));
          await idbRun('readwrite', (s) => { recs.forEach((r) => s.put(r)); return null; });
          recs.forEach((r) => dropDocUrl(r.id));
          restoredDocs = recs.length;
        } catch (e) {
          toast('הנתונים שוחזרו, אבל המסמכים לא נשמרו (אין מקום?)');
        }
        await loadDocs();
      }
      overlay = null; setupDraft = null; pendingFile = null; tab = 'today'; viewDate = todayKey();
      render();
      if (!bdocs.length || restoredDocs) toast(restoredDocs ? `הנתונים ו־${restoredDocs} מסמכים שוחזרו ✓` : 'הנתונים שוחזרו ✓');
    } catch (e) {
      toast('הקובץ לא תקין');
    }
  };
  input.click();
}

/* ============ Events ============ */
document.addEventListener('click', (e) => {
  const t = e.target.closest('button, [data-day]');
  if (!t) return;

  if (t.dataset.tab) { go(t.dataset.tab); return; }
  if (t.dataset.pid) {
    if (t.dataset.pid !== state.active) {
      state.active = t.dataset.pid; save();
      if (overlay === 'setup' && !setupFor) setupDraft = null;
      render();
    }
    return;
  }
  if (t.dataset.check) {
    const cur = dayData(profile(), viewDate)[t.dataset.check];
    setDay(viewDate, { [t.dataset.check]: !cur });
    renderToday();
    return;
  }
  if (t.dataset.water) { addWater(+t.dataset.water); renderToday(); return; }
  if (t.dataset.count) {
    const cur = dayData(profile(), viewDate)[t.dataset.count] || 0;
    setDay(viewDate, { [t.dataset.count]: Math.max(0, cur + +t.dataset.delta) });
    renderToday();
    return;
  }
  if (t.dataset.day) { viewDate = t.dataset.day; go('today'); return; }
  if (t.dataset.menuSel) { menuSel = t.dataset.menuSel; renderMenus(); return; }
  if (t.dataset.kind) { setupDraft.kind = t.dataset.kind; rerenderSetupKeepingInputs(); return; }
  if (t.dataset.fastday !== undefined) {
    const d = +t.dataset.fastday;
    setupDraft.fastDays = setupDraft.fastDays.includes(d) ? setupDraft.fastDays.filter((x) => x !== d) : [...setupDraft.fastDays, d];
    rerenderSetupKeepingInputs();
    return;
  }
  if (t.dataset.weighday !== undefined) { setupDraft.weighDay = +t.dataset.weighday; rerenderSetupKeepingInputs(); return; }
  if (t.dataset.editsetup) { overlay = 'setup'; setupFor = t.dataset.editsetup; setupDraft = null; render(); window.scrollTo(0, 0); return; }
  if (t.dataset.delw) {
    if (!confirm('למחוק את השקילה?')) return;
    const p = profile();
    p.weights = p.weights.filter((w) => w.date !== t.dataset.delw);
    save(); renderWeight();
    return;
  }
  if (t.dataset.delm) {
    if (!confirm('למחוק את המדידה?')) return;
    const p = profile();
    p.measures = p.measures.filter((m) => m.date !== t.dataset.delm);
    save(); renderWeight();
    $('#measureCard').scrollIntoView({ block: 'start' });
    return;
  }
  if (t.dataset.wsub) { weightSub = t.dataset.wsub; renderWeight(); return; }
  if (t.dataset.delb) {
    if (!confirm('למחוק את בדיקת הדם?')) return;
    const p = profile();
    p.blood = p.blood.filter((b) => b.date !== t.dataset.delb);
    save(); renderWeight();
    return;
  }
  if (t.dataset.fasttype) {
    const [pid, ft] = t.dataset.fasttype.split(':');
    state.profiles[pid].fastType = ft === 'modified' ? 'modified' : 'full';
    save(); renderSettings(); toast('סוג יום הצום נשמר ✓');
    return;
  }
  if (t.dataset.doc) { docAction(t.dataset.doc, t.dataset.id); return; }
  if (t.dataset.shopdel) {
    state.shopping = state.shopping.filter((i) => i.id !== t.dataset.shopdel);
    save(); renderShop();
    return;
  }

  switch (t.dataset.act) {
    case 'prev-day': viewDate = addDays(viewDate, -1); renderToday(); break;
    case 'next-day': viewDate = addDays(viewDate, 1); renderToday(); break;
    case 'goto-today': viewDate = todayKey(); renderToday(); break;
    case 'go-weight': weightSub = 'body'; go('weight'); break;
    case 'go-blood': weightSub = 'blood'; go('weight'); break;
    case 'open-mymenu': openDoc(docById(profile().menuDoc)); break;
    case 'doc-pick': pickDoc(); break;
    case 'doc-cancel': pendingFile = null; renderDocs(); break;
    case 'blood-next-clear': profile().bloodNext = null; save(); renderWeight(); break;
    case 'go-measure': { const c = $('#measureCard'); if (c) c.scrollIntoView({ behavior: 'smooth', block: 'start' }); break; }
    case 'water-undo': undoWater(); renderToday(); break;
    case 'water-defaults':
      if (!confirm('להחזיר את יעדי השתייה לברירת המחדל?')) break;
      PROFILE_IDS.forEach((id) => { delete state.profiles[id].water; });
      save(); renderSettings(); toast('יעדי השתייה אופסו');
      break;
    case 'go-menu': menuSel = t.dataset.menu; go('menus'); break;
    case 'prev-week': weekOffset--; renderWeek(); break;
    case 'next-week': if (weekOffset < 0) { weekOffset++; renderWeek(); } break;
    case 'shop-reset':
      state.shopping.forEach((i) => { i.done = false; });
      save(); renderShop(); toast('הסימונים נוקו – שבוע חדש');
      break;
    case 'shop-default':
      if (!confirm('להחזיר את הרשימה המקורית? פריטים שהוספתם יימחקו.')) break;
      state.shopping = defaultState().shopping; save(); renderShop();
      break;
    case 'backup': backup(); break;
    case 'restore': restore(); break;
    case 'close-settings': overlay = null; render(); break;
    case 'setup-cancel': overlay = null; setupFor = null; setupDraft = null; overlay = 'settings'; render(); break;
    case 'wipe':
      if (!confirm('למחוק את כל הנתונים של שני הפרופילים, כולל בדיקות הדם והמסמכים? כדאי לגבות קודם.')) break;
      if (!confirm('בטוח? אי אפשר לבטל.')) break;
      state = normalize(null); save(); overlay = null; setupDraft = null; tab = 'today';
      docsClear().then(() => render(), () => render());
      break;
  }
});

$('#settingsBtn').addEventListener('click', () => {
  overlay = overlay === 'settings' ? null : 'settings';
  setupDraft = null;
  render();
  window.scrollTo(0, 0);
});

function rerenderSetupKeepingInputs() {
  const form = $('#setupForm');
  const vals = form ? Object.fromEntries(new FormData(form)) : {};
  renderSetup(setupDraft.pid);
  const nf = $('#setupForm');
  for (const [k, v] of Object.entries(vals)) if (nf.elements[k]) nf.elements[k].value = v;
}

document.addEventListener('input', (e) => {
  if (e.target.matches('[data-steps]')) {
    const n = parseInt(e.target.value, 10);
    setDay(viewDate, { steps: Number.isFinite(n) && n > 0 ? n : null });
  }
});

document.addEventListener('change', (e) => {
  if (e.target.matches('[data-shop]')) {
    const item = state.shopping.find((i) => i.id === e.target.dataset.shop);
    if (item) { item.done = e.target.checked; save(); renderShop(); }
  }
  if (e.target.matches('[data-health]')) {
    const [pid, h] = e.target.dataset.health.split(':');
    const pr = state.profiles[pid];
    if (e.target.checked) pr.health[h] = true; else delete pr.health[h];
    save(); renderSettings(); toast('נשמר ✓');
  }
  if (e.target.id === 'backupDocs') {
    state.backupDocs = e.target.checked;
    save(); renderSettings();
  }
  if (e.target.id === 'bloodNext') {
    profile().bloodNext = e.target.value || null;
    save(); renderWeight(); toast(e.target.value ? 'נשמר – תזכורת תופיע במועד ✓' : 'נוקה');
  }
});

document.addEventListener('submit', (e) => {
  e.preventDefault();
  const form = e.target;
  if (form.id === 'setupForm') { submitSetup(form); return; }
  if (form.id === 'weightForm') {
    const f = new FormData(form);
    const date = f.get('date');
    const kg = num(f.get('kg'));
    if (!date || !kg) { toast('נא למלא תאריך ומשקל'); return; }
    if (date > todayKey()) { toast('אי אפשר לשקול בעתיד 🙂'); return; }
    const p = profile();
    p.weights = p.weights.filter((w) => w.date !== date);
    const entry = { date, kg: r1(kg) };
    p.weights.push(entry);
    save();
    renderWeight();
    toast('השקילה נשמרה ✓');
    return;
  }
  if (form.id === 'measureForm') {
    const f = new FormData(form);
    const date = f.get('date');
    const waist = num(f.get('waist'));
    const hips = num(f.get('hips'));
    const chest = num(f.get('chest'));
    if (!date || (!waist && !hips && !chest)) { toast('נא למלא לפחות מדידה אחת'); return; }
    if (date > todayKey()) { toast('אי אפשר למדוד בעתיד 🙂'); return; }
    const p = profile();
    p.measures = p.measures || [];
    const prev = p.measures.find((m) => m.date === date) || {};
    const entry = { date };
    const wv = waist || prev.waist;
    const hv = hips || prev.hips;
    if (wv) entry.waist = r1(wv);
    if (hv) entry.hips = r1(hv);
    const cv = chest || prev.chest;
    if (cv) entry.chest = r1(cv);
    p.measures = p.measures.filter((m) => m.date !== date);
    p.measures.push(entry);
    save();
    renderWeight();
    $('#measureCard').scrollIntoView({ block: 'start' });
    toast('המדידה נשמרה ✓');
    return;
  }
  if (form.id === 'docForm') { saveDoc(form); return; }
  if (form.id === 'bloodForm') {
    const f = new FormData(form);
    const date = f.get('date');
    if (!date) { toast('נא לבחור תאריך'); return; }
    if (date > todayKey()) { toast('תאריך הבדיקה לא יכול להיות בעתיד'); return; }
    const vals = {};
    for (const L of LABS) {
      const v = num(f.get(L.k));
      if (v != null && v >= 0) vals[L.k] = Math.round(v * 100) / 100;
    }
    if (!Object.keys(vals).length) { toast('נא למלא לפחות ערך אחד'); return; }
    const p = profile();
    const prev = p.blood.find((b) => b.date === date) || {};
    p.blood = p.blood.filter((b) => b.date !== date);
    p.blood.push({ ...prev, date, ...vals });
    let cleared = false;
    if (p.bloodNext && date >= p.bloodNext) { p.bloodNext = null; cleared = true; }
    save(); renderWeight(); window.scrollTo(0, 0);
    toast(cleared ? 'הבדיקה נשמרה ✓ אפשר לקבוע בדיקה הבאה' : 'הבדיקה נשמרה ✓');
    return;
  }
  if (form.id === 'shopAdd') {
    const text = String(new FormData(form).get('text') || '').trim();
    if (!text) return;
    state.shopping.push({ id: 'u' + Date.now().toString(36), text: text.slice(0, 80), done: false });
    save(); renderShop();
    $('#shopAdd input').focus();
    return;
  }
  if (form.id === 'waterForm') {
    const f = new FormData(form);
    for (const id of PROFILE_IDS) {
      const w = {};
      for (const key of ['fastMin', 'fastMax', 'eatMin', 'eatMax']) w[key] = num(f.get(`${id}-${key}`));
      if (Object.values(w).some((v) => !v || v <= 0)) { toast('נא למלא את כל היעדים'); return; }
      if (w.fastMin > w.fastMax) [w.fastMin, w.fastMax] = [w.fastMax, w.fastMin];
      if (w.eatMin > w.eatMax) [w.eatMin, w.eatMax] = [w.eatMax, w.eatMin];
      state.profiles[id].water = w;
    }
    save(); renderSettings(); toast('יעדי השתייה נשמרו ✓');
    return;
  }
  if (form.id === 'namesForm') {
    const f = new FormData(form);
    for (const id of PROFILE_IDS) {
      const n = String(f.get(id) || '').trim().slice(0, 20);
      if (n) state.profiles[id].name = n;
    }
    save(); render(); toast('השמות עודכנו ✓');
  }
});

// Re-render when the day changes while the app stays open (e.g. resumed next morning)
let lastSeenDay = todayKey();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && todayKey() !== lastSeenDay) {
    if (viewDate === lastSeenDay) viewDate = todayKey();
    lastSeenDay = todayKey();
    render();
  }
});

/* ============ Boot ============ */
render();
loadDocs().then(() => {
  if (!overlay && (tab === 'today' || tab === 'docs')) render();
});

if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // A new version took over: reload once so the screen shows it (not on the very first install)
    if (!hadController || reloading) return;
    reloading = true;
    location.reload();
  });
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((reg) => {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update().catch(() => {});
      });
    }).catch(() => {});
  });
}
