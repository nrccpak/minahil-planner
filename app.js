/* Minahil Homework Planner — Phase 1 app (no AI, no cost). */
(function () {
  'use strict';
  const P = window.Planner;
  const Store = window.Store;
  const $app = document.getElementById('app');
  const $print = document.getElementById('print');

  const APP_DEFAULTS = Object.assign({}, P.DEFAULT_SETTINGS, { weekendStart: '14:00', weekendEnd: '19:00', lockMinutes: 15 });
  const LOCK_MS = function () { return (Number(S.settings.lockMinutes) || 15) * 60 * 1000; };

  // ---------- state ----------
  const S = {
    ready: false,
    role: null,             // 'kid' | 'parent'
    view: 'today',
    settings: Object.assign({}, APP_DEFAULTS),
    pins: null,             // {salt, kid, parent}
    meta: {},               // {ratesSet}
    rates: {},
    samples: {},
    subjectScore: {},
    carry: [],              // tasks moved to the weekend / later
    date: todayStr(),
    day: null,
    days: [],
    modal: null,
    pin: { who: null, entered: '', error: '' },
    setup: { step: 'pins', parentPin: '', kidPin: '', error: '' },
    fbDate: null,
    lastActive: Date.now(),
    installEvt: null,
    sheetPhoto: null,
    diaryPhoto: null
  };

  // ---------- small helpers ----------
  function todayStr(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function parseDate(s) { const p = s.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); }
  function niceDate(s, long) {
    const d = parseDate(s);
    return d.toLocaleDateString('en-GB', long ? { weekday: 'long', day: 'numeric', month: 'long' } : { weekday: 'short', day: 'numeric', month: 'short' });
  }
  function dateCode(s) { return 'MH-' + s.slice(2).replace(/-/g, ''); }
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function isUrdu(s) { return /[؀-ۿ]/.test(s || ''); }
  function noteHtml(note) {
    if (!note) return '';
    return isUrdu(note) ? '<span class="urdu" lang="ur" dir="rtl">' + esc(note) + '</span>' : '<span dir="auto">' + esc(note) + '</span>';
  }
  function uid() { return Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3); }
  function t12(min) { return P.to12h(min); }
  function hm(hhmm) { return P.to12h(P.toMin(hhmm)); }
  function minsLabel(m) { m = Math.round(m); if (m < 60) return m + ' min'; const h = Math.floor(m / 60), r = m % 60; return h + ' h' + (r ? ' ' + r + ' min' : ''); }
  function weekday(s) { return parseDate(s).getDay(); } // 0 Sun … 6 Sat
  function isWeekend(s) { const w = weekday(s); return w === 0 || w === 6; }
  function typeLabel(t) {
    const tt = P.TASK_TYPES[t.type] || P.TASK_TYPES.pages;
    if (t.type === 'minutes') return (t.units || 15) + ' min';
    if (t.type === 'test') return 'Test prep';
    const u = Number(t.units) || 0;
    return u + ' ' + (u === 1 ? tt.unit : tt.plural);
  }

  const ICON = {
    today: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M8 2v4M16 2v4M3 10h18"/></svg>',
    sheet: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M7 14h10v7H7z"/></svg>',
    evening: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3 8-8"/><path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9"/></svg>',
    me: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l3 6.5 7 .8-5.2 4.8 1.4 7L12 17.6 5.8 21l1.4-7L2 9.3l7-.8z"/></svg>',
    parent: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 5-6"/></svg>',
    grip: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>',
    up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 15l6-6 6 6"/></svg>',
    down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>',
    edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
    camera: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>',
    print: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M7 14h10v7H7z"/></svg>'
  };

  // ---------- persistence ----------
  function saveKv(key) { return Store.kvSet(key, S[key]); }
  function saveDay(day) {
    day = day || S.day;
    day.updatedAt = new Date().toISOString();
    const i = S.days.findIndex(function (d) { return d.date === day.date; });
    if (i >= 0) S.days[i] = day; else { S.days.push(day); S.days.sort(function (a, b) { return a.date < b.date ? -1 : 1; }); }
    return Store.daySet(day.date, day);
  }
  function newDay(date) {
    return { date: date, createdAt: new Date().toISOString(), tasks: [], manual: false, pause: false, different: null,
      revision: null, revisionDeclined: false, morning: { taskIds: [] }, moved: [], locked: false, plan: null,
      hasPhoto: false, feedback: null, learned: false };
  }
  function getDay(date) { return S.days.find(function (d) { return d.date === date; }) || null; }

  async function boot() {
    try { await Store.open(); } catch (e) { /* memory fallback */ }
    const keys = ['settings', 'pins', 'meta', 'rates', 'samples', 'subjectScore', 'carry'];
    const vals = await Promise.all(keys.map(function (k) { return Store.kvGet(k); }));
    keys.forEach(function (k, i) { if (vals[i] !== undefined && vals[i] !== null) S[k] = vals[i]; });
    S.settings = Object.assign({}, APP_DEFAULTS, S.settings || {});
    S.days = await Store.daysAll();
    S.day = getDay(S.date) || newDay(S.date);
    S.ready = true;
    Store.persist();
    render();
  }

  // ---------- PIN ----------
  async function hashPin(pin, salt) {
    const text = salt + ':' + pin;
    try {
      if (window.crypto && crypto.subtle) {
        const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
        return Array.from(new Uint8Array(buf)).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
      }
    } catch (e) { /* fall through */ }
    let h = 5381; for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) >>> 0;
    return 'f' + h.toString(16);
  }

  // ---------- plan for a day ----------
  function excludedIds(day) {
    const ids = {};
    (day.morning && day.morning.taskIds || []).forEach(function (id) { ids[id] = 'morning'; });
    (day.moved || []).forEach(function (m) { ids[m.taskId] = m.to; });
    return ids;
  }
  function daySettings(day) {
    const s = Object.assign({}, S.settings);
    if (day.different) {
      if (day.different.studyStart) s.studyStart = day.different.studyStart;
      if (day.different.finishLine) s.finishLine = day.different.finishLine;
    }
    return s;
  }
  function withMinutes(tasks) {
    return tasks.map(function (t) { return Object.assign({}, t, { minutes: P.estimate(t, S.rates) }); });
  }
  function computePlan(day) {
    const ex = excludedIds(day);
    const afternoon = withMinutes(day.tasks.filter(function (t) { return !ex[t.id]; }));
    const s = daySettings(day);
    const plan = P.buildPlan(afternoon, s, { revision: day.revision });
    const morningTasks = withMinutes(day.tasks.filter(function (t) { return ex[t.id] === 'morning'; }));
    const mMin = morningTasks.reduce(function (a, t) { return a + t.minutes; }, 0);
    plan.morning = mMin ? P.morningPlan(mMin, s) : null;
    plan.afternoon = afternoon;
    plan.settings = s;
    return plan;
  }
  function suggestedIds(day) { return P.suggestOrder(day.tasks, S.subjectScore, S.rates).map(function (t) { return t.id; }); }
  function applySuggested(day) {
    const ids = suggestedIds(day);
    day.tasks.sort(function (a, b) { return ids.indexOf(a.id) - ids.indexOf(b.id); });
  }

  // ---------- render root ----------
  function render() {
    if (!S.ready) { $app.innerHTML = '<main><p class="muted">Loading…</p></main>'; return; }
    if (!S.pins) { $app.innerHTML = renderSetup(); return; }
    if (!S.role) { $app.innerHTML = renderLock(); return; }
    let body = '';
    switch (S.view) {
      case 'rates-intro': body = renderRatesIntro(); break;
      case 'rates': body = renderRates(); break;
      case 'sheet': body = renderSheetView(); break;
      case 'evening': body = renderEvening(); break;
      case 'me': body = renderMe(); break;
      case 'parent': body = S.role === 'parent' ? renderParent() : renderMe(); break;
      default: body = renderToday();
    }
    $app.innerHTML = renderTopbar() + '<main id="main">' + body + '</main>' + renderTabs() + (S.modal ? renderModal() : '');
    afterRender();
  }

  function renderTopbar() {
    const who = S.role === 'parent' ? 'Parent' : 'Minahil';
    return '<header class="topbar"><div class="topbar-in">' +
      '<div class="brand"><b>Minahil’s Planner</b><span>' + esc(niceDate(S.date, true)) + ' · ' + who + '</span></div>' +
      '<button class="lock-btn" data-act="lock" type="button">Lock</button></div></header>';
  }
  function renderTabs() {
    if (S.view === 'rates-intro') return '';
    const tabs = [
      ['today', 'Today', ICON.today], ['sheet', 'Sheet', ICON.sheet], ['evening', 'Evening', ICON.evening],
      S.role === 'parent' ? ['parent', 'Parent', ICON.parent] : ['me', 'My day', ICON.me]
    ];
    return '<nav class="tabbar" aria-label="Main"><div class="tabbar-in">' + tabs.map(function (t) {
      const cur = S.view === t[0] || (t[0] === 'me' && S.view === 'rates') || (t[0] === 'parent' && S.view === 'rates');
      return '<button class="tab" type="button" data-act="go" data-view="' + t[0] + '"' + (cur ? ' aria-current="page"' : '') + '>' + t[2] + '<span>' + t[1] + '</span></button>';
    }).join('') + '</div></nav>';
  }

  // ---------- first-run setup ----------
  function renderSetup() {
    const st = S.setup;
    return '<div class="lock"><form class="card" id="setup-form" autocomplete="off">' +
      '<span class="step-label">First-time setup</span>' +
      '<h1>Set two PINs</h1>' +
      '<p class="muted">One PIN for Minahil and a separate one for the parent area. Use 4 digits. This phone shares the app, so the PINs keep each view separate.</p>' +
      '<label class="field">Parent PIN<input id="setup-parent" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="4" required></label>' +
      '<label class="field">Minahil’s PIN<input id="setup-kid" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="4" required></label>' +
      (st.error ? '<div class="notice warn"><b>' + esc(st.error) + '</b></div>' : '') +
      '<button class="btn primary block" type="submit">Save PINs</button>' +
      '<p class="small muted">Everything stays on this phone in Phase 1. Make a backup now and then from the Parent tab.</p>' +
      '</form></div>';
  }
  async function submitSetup(e) {
    e.preventDefault();
    const p = document.getElementById('setup-parent').value.trim();
    const k = document.getElementById('setup-kid').value.trim();
    if (!/^\d{4}$/.test(p) || !/^\d{4}$/.test(k)) { S.setup.error = 'Each PIN needs exactly 4 digits.'; return render(); }
    if (p === k) { S.setup.error = 'Use two different PINs.'; return render(); }
    const salt = uid();
    S.pins = { salt: salt, parent: await hashPin(p, salt), kid: await hashPin(k, salt) };
    await saveKv('pins');
    toast('PINs saved');
    render();
  }

  // ---------- lock screen ----------
  function renderLock() {
    const pin = S.pin;
    if (!pin.who) {
      return '<div class="lock"><div class="card">' +
        '<span class="step-label">' + esc(niceDate(S.date, true)) + '</span>' +
        '<h1>Who is using the planner?</h1>' +
        '<div class="who">' +
        '<button class="btn primary" type="button" data-act="pin-who" data-who="kid">Minahil</button>' +
        '<button class="btn" type="button" data-act="pin-who" data-who="parent">Parent</button>' +
        '</div></div></div>';
    }
    const dots = [0, 1, 2, 3].map(function (i) { return '<i class="' + (i < pin.entered.length ? 'on' : '') + '"></i>'; }).join('');
    const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'back', '0', 'clear'].map(function (k) {
      const label = k === 'back' ? '⌫' : k === 'clear' ? 'C' : k;
      const aria = k === 'back' ? ' aria-label="Delete last digit"' : k === 'clear' ? ' aria-label="Clear"' : '';
      return '<button type="button" data-act="pin-key" data-k="' + k + '"' + aria + '>' + label + '</button>';
    }).join('');
    return '<div class="lock"><div class="card">' +
      '<button class="btn ghost small" type="button" data-act="pin-who" data-who="" style="align-self:flex-start">← Back</button>' +
      '<h1>' + (pin.who === 'kid' ? 'Hi Minahil' : 'Parent') + '</h1>' +
      '<p class="muted">Enter your 4-digit PIN.</p>' +
      '<div class="pin-dots" aria-label="' + pin.entered.length + ' of 4 digits entered">' + dots + '</div>' +
      (pin.error ? '<div class="notice warn"><b>' + esc(pin.error) + '</b></div>' : '') +
      '<div class="keypad">' + keys + '</div></div></div>';
  }
  async function pinKey(k) {
    const pin = S.pin;
    pin.error = '';
    if (k === 'back') pin.entered = pin.entered.slice(0, -1);
    else if (k === 'clear') pin.entered = '';
    else if (pin.entered.length < 4) pin.entered += k;
    if (pin.entered.length === 4) {
      const h = await hashPin(pin.entered, S.pins.salt);
      if (h === S.pins[pin.who]) {
        S.role = pin.who; S.view = 'today'; S.lastActive = Date.now();
        S.pin = { who: null, entered: '', error: '' };
        refreshDate();
      } else { pin.entered = ''; pin.error = 'That PIN is not right. Try again.'; }
    }
    render();
  }
  function lock() { S.role = null; S.modal = null; S.pin = { who: null, entered: '', error: '' }; render(); }
  function refreshDate() {
    const now = todayStr();
    if (now !== S.date) { S.date = now; S.day = getDay(now) || newDay(now); }
  }

  // ---------- starting times (week one) ----------
  function renderRatesIntro() {
    return '<div class="today-hero"><div class="date">Welcome, Minahil</div>' +
      '<p class="line">Before the first plan, tell the app how long things usually take you. You set this once; after that the app learns from your ticks.</p></div>' +
      '<div class="card"><h2>Your starting times</h2>' +
      '<p class="muted">For each subject: minutes for one page, one question, or a test. Guesses are fine.</p>' +
      '<button class="btn primary block" type="button" data-act="go" data-view="rates">Set my starting times</button>' +
      '<button class="btn ghost block" type="button" data-act="rates-skip">Use the app’s guesses for now</button></div>';
  }
  function rateCell(subject, type) {
    const v = S.rates[subject] && S.rates[subject][type];
    const show = v ? Math.round(v * 10) / 10 : '';
    return '<td class="n"><input class="rate-input" type="number" inputmode="decimal" min="0.5" max="120" step="0.5" ' +
      'id="rate-' + subject.replace(/[^a-z0-9]/gi, '') + '-' + type + '" data-rate-subject="' + esc(subject) + '" data-rate-type="' + type + '" ' +
      'value="' + show + '" placeholder="' + P.rateFor({}, subject, type) + '" aria-label="' + esc(subject) + ' minutes per ' + P.TASK_TYPES[type].unit + '"></td>';
  }
  function renderRates() {
    const rows = P.SUBJECTS.map(function (s) {
      return '<tr><th scope="row">' + esc(s) + '</th>' + P.RATE_TYPES.map(function (t) { return rateCell(s, t); }).join('') + '</tr>';
    }).join('');
    return '<div class="card"><div class="section-head"><h2>Starting times</h2><span class="small muted">minutes each</span></div>' +
      '<p class="small muted">Grey numbers are already set for you; type only where you know better. After each evening’s ticks the app adjusts these by itself (never more than about 10 minutes a day).</p>' +
      '<div class="table-wrap"><table class="data"><thead><tr><th>Subject</th><th class="n">Page</th><th class="n">Question</th><th class="n">Verse</th><th class="n">Test</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div>' +
      '<button class="btn primary block" type="button" data-act="rates-save">Save starting times</button></div>';
  }
  async function saveRates() {
    document.querySelectorAll('[data-rate-subject]').forEach(function (inp) {
      const s = inp.getAttribute('data-rate-subject'), t = inp.getAttribute('data-rate-type');
      const v = parseFloat(inp.value);
      if (!S.rates[s]) S.rates[s] = {};
      if (v > 0) S.rates[s][t] = Math.min(120, v); else delete S.rates[s][t];
    });
    S.meta.ratesSet = true;
    await Promise.all([saveKv('rates'), saveKv('meta')]);
    toast('Starting times saved');
    S.view = 'today'; render();
  }

  // ---------- TODAY ----------
  function renderToday() {
    refreshDate();
    const day = S.day;
    const s = daySettings(day);
    let html = '<section class="today-hero"><div class="date">' + esc(niceDate(day.date, true)) + '</div>' +
      '<p class="line">Finish line <span class="hl num">' + hm(s.finishLine) + '</span> · study from ' + hm(s.studyStart) +
      (day.different ? ' · <b>today is different</b>' : '') + '</p></section>';

    if (day.pause) {
      return html + '<div class="card"><h2>Paused today</h2><p class="muted">Holiday, sick or absent. Nothing is planned, and today does not change learned times or weekly numbers.</p>' +
        '<button class="btn block" type="button" data-act="pause" data-on="0">Plan today after all</button></div>';
    }
    if (day.locked) {
      const plan = day.plan;
      html += '<div class="card"><span class="step-label">Plan ready</span><h2>Today’s sheet is made</h2>' +
        '<p>Planned finish <b class="num">' + t12(plan.end) + '</b> · line ' + hm(s.finishLine) + '. Study from the paper with your desk timer.</p>' +
        (day.morning && day.morning.taskIds.length ? '<p class="small">Morning catch-up: wake at <b>' + t12(plan.morning.wake) + '</b>.</p>' : '') +
        '<div class="row"><button class="btn primary grow" type="button" data-act="go" data-view="sheet">' + ICON.print + 'Open sheet</button>' +
        '<button class="btn grow" type="button" data-act="unlock-plan">Change plan</button></div>' +
        '<p class="small muted">In the evening, open <b>Evening</b> and tick what happened.</p></div>';
      html += renderTimelineCard(computePlan(day), day);
      return html;
    }

    // Day options
    html += '<div class="card flat"><div class="row">' +
      '<button class="btn small grow" type="button" data-act="different">' + (day.different ? 'Change today’s times' : 'Today is different') + '</button>' +
      '<button class="btn small grow" type="button" data-act="pause" data-on="1">Pause today</button></div>';
    if (isWeekend(day.date) && !day.different) {
      html += '<div class="notice info"><b>Weekend</b><span class="body">Use the weekend window ' + hm(S.settings.weekendStart) + '–' + hm(S.settings.weekendEnd) + ' today?</span>' +
        '<button class="btn small" type="button" data-act="weekend-times">Use weekend times</button></div>';
    }
    if (weekday(day.date) === 5) {
      html += '<div class="notice info"><b>Friday diary</b><span class="body">Teachers give more on Fridays. If it doesn’t fit, move some tasks to the weekend; they wait for you under “Carried over”.</span></div>';
    }
    html += '</div>';

    // Step 1: photo
    html += '<div class="card"><span class="step-label">Step 1 · Diary photo</span>' +
      '<div class="section-head"><h2>Photo of today’s diary</h2>' + (day.hasPhoto ? '<span class="tag morning">Saved</span>' : '') + '</div>' +
      (day.hasPhoto && S.diaryPhoto ? '<img class="photo-thumb" src="' + S.diaryPhoto + '" alt="Today’s diary photo">' : '') +
      '<label class="btn block" for="diary-photo">' + ICON.camera + (day.hasPhoto ? 'Retake photo' : 'Take photo') + '</label>' +
      '<input id="diary-photo" type="file" accept="image/*" capture="environment" hidden>' +
      '<p class="small muted">Saved with today’s plan. In Phase 2 the app will read the tasks from this photo.</p></div>';

    // Step 2: add tasks
    html += '<div class="card"><span class="step-label">Step 2 · Tasks</span><h2>Add each diary task</h2>' +
      '<p class="small muted">Tap the subject. Blank rows in the diary mean no work, so skip them.</p>' +
      '<div class="subject-grid">' + P.SUBJECTS.map(function (sub) {
        return '<button class="subject-btn" type="button" data-act="add-task" data-subject="' + esc(sub) + '">' + esc(sub) + '</button>';
      }).join('') + '</div>';
    if (S.carry.length) {
      html += '<hr class="divider"><h3>Carried over</h3><div class="stack">' + S.carry.map(function (c, i) {
        return '<div class="row"><div class="grow"><b>' + esc(c.task.subject) + '</b> · ' + esc(typeLabel(c.task)) + (c.task.note ? ' · ' + noteHtml(c.task.note) : '') +
          '<div class="small muted">from ' + esc(niceDate(c.from)) + '</div></div>' +
          '<button class="btn small" type="button" data-act="carry-add" data-i="' + i + '">Add</button>' +
          '<button class="btn small ghost" type="button" data-act="carry-del" data-i="' + i + '">Remove</button></div>';
      }).join('') + '</div>';
    }
    html += '</div>';

    // Step 3: order
    const ex = excludedIds(day);
    if (day.tasks.length) {
      html += '<div class="card"><span class="step-label">Step 3 · Order</span><div class="section-head"><h2>Your order</h2>' +
        (day.manual ? '<button class="btn small ghost" type="button" data-act="use-suggested">Use suggested order</button>' : '<span class="small muted">suggested</span>') + '</div>' +
        '<p class="small muted">Drag the dots, or use the arrows, to put tasks in the order you want. Leaving it as it is means you agree.</p>' +
        '<ul class="task-list" id="task-list">' + day.tasks.map(function (t, i) { return renderTaskItem(t, i, day.tasks.length, ex[t.id]); }).join('') + '</ul></div>';
      html += renderPlanCard(day);
    } else {
      html += '<div class="card flat"><p class="muted">No tasks yet. Add them from the diary above, or tap <b>Pause today</b> on a holiday.</p></div>';
    }
    return html;
  }

  function renderTaskItem(t, i, n, where) {
    const mins = P.estimate(t, S.rates);
    const tags = (t.test ? '<span class="tag test">Test</span>' : '') + (t.dueTomorrow ? '<span class="tag due">Due tomorrow</span>' : '') +
      (where === 'morning' ? '<span class="tag morning">Morning</span>' : '') +
      (where === 'weekend' ? '<span class="tag morning">Weekend</span>' : '') + (where === 'dropped' ? '<span class="tag test">Dropped</span>' : '');
    return '<li class="task" data-id="' + t.id + '">' +
      '<button class="drag-handle" type="button" aria-label="Drag to reorder ' + esc(t.subject) + '">' + ICON.grip + '</button>' +
      '<div class="task-main"><div class="task-title">' + esc(t.subject) + tags + '</div>' +
      '<div class="task-note">' + esc(typeLabel(t)) + (t.note ? ' · ' + noteHtml(t.note) : '') + '</div></div>' +
      '<div class="task-side"><span class="mins">' + mins + ' min</span><div class="row" style="gap:2px">' +
      '<button class="icon-btn" type="button" data-act="move" data-dir="-1" data-id="' + t.id + '" aria-label="Move up"' + (i === 0 ? ' disabled' : '') + '>' + ICON.up + '</button>' +
      '<button class="icon-btn" type="button" data-act="move" data-dir="1" data-id="' + t.id + '" aria-label="Move down"' + (i === n - 1 ? ' disabled' : '') + '>' + ICON.down + '</button>' +
      '<button class="icon-btn" type="button" data-act="edit-task" data-id="' + t.id + '" aria-label="Edit">' + ICON.edit + '</button></div></div></li>';
  }

  function renderMeter(plan) {
    const start = plan.start;
    const lineAt = plan.finishLine;
    const endScale = Math.max(lineAt, plan.end) + 10;
    const span = endScale - start;
    function pct(m) { return ((m - start) / span * 100).toFixed(2) + '%'; }
    let segs = '';
    plan.items.forEach(function (it) {
      const cls = it.kind === 'task' ? 'work' : it.kind;
      segs += '<div class="seg ' + cls + '" style="left:' + pct(it.start) + ';width:' + ((it.end - it.start) / span * 100).toFixed(2) + '%"></div>';
    });
    if (plan.end > lineAt) segs += '<div class="seg over" style="left:' + pct(lineAt) + ';width:' + ((plan.end - lineAt) / span * 100).toFixed(2) + '%;opacity:.55"></div>';
    segs += '<div class="finish" style="left:' + pct(lineAt) + '" title="Finish line"></div>';
    return '<div class="meter" role="img" aria-label="Plan from ' + t12(start) + ' to ' + t12(plan.end) + ', finish line ' + t12(lineAt) + '">' + segs + '</div>' +
      '<div class="meter-scale"><span>' + t12(start) + '</span><span>line ' + t12(lineAt) + '</span><span>' + t12(endScale) + '</span></div>';
  }

  function renderPlanCard(day) {
    const plan = computePlan(day);
    const s = plan.settings;
    const ex = excludedIds(day);
    let html = '<div class="card"><span class="step-label">Step 4 · Plan</span><div class="section-head"><h2>Finish at <span class="num">' + t12(plan.end) + '</span></h2>' +
      '<span class="small muted num">' + minsLabel(plan.workMin) + ' work · ' + minsLabel(plan.breakMin) + ' breaks · ' + plan.bufferMin + ' min spare</span></div>' +
      renderMeter(plan);

    if (plan.fits) {
      html += '<div class="notice ok"><b>Fits before the line</b><span class="body">' +
        (plan.spareMin ? plan.spareMin + ' min to spare. Free time starts as soon as you finish.' : 'Right on the line.') + '</span></div>';
      const rev = P.revisionSuggestion(plan, s);
      if (!day.revision && !day.revisionDeclined && rev) {
        const topics = P.revisionTopics(S.days.filter(function (d) { return d.date < day.date; }), 4);
        html += '<div class="notice info"><b>Light day: add ' + rev + ' min of revision?</b><span class="body">You still finish before the line.</span>' +
          (topics.length ? '<div class="chips">' + topics.map(function (tp, i) {
            return '<button class="chip" type="button" data-act="revision" data-min="' + rev + '" data-topic="' + esc(tp.label) + '">' + esc(tp.subject) + ' <span class="small">(' + esc(tp.why) + ')</span></button>';
          }).join('') + '</div>' : '') +
          '<div class="row"><button class="btn small primary" type="button" data-act="revision" data-min="' + rev + '" data-topic="">Add revision</button>' +
          '<button class="btn small ghost" type="button" data-act="revision-no">No thanks</button></div></div>';
      }
    } else {
      html += '<div class="notice warn"><b>' + plan.overMin + ' min past the ' + hm(s.finishLine) + ' line</b>' +
        '<span class="body">Choose what moves to the morning (wake no earlier than ' + hm(s.earliestWake) + '). Tests and tomorrow’s work are best kept for today.</span>' +
        '<div class="chips">' + day.tasks.filter(function (t) { return !ex[t.id] || ex[t.id] === 'morning'; }).map(function (t) {
          return '<button class="chip" type="button" data-act="toggle-morning" data-id="' + t.id + '" aria-pressed="' + (ex[t.id] === 'morning') + '">' +
            esc(t.subject) + ' · ' + P.estimate(t, S.rates) + 'm</button>';
        }).join('') + '</div></div>';
    }
    if (plan.morning) {
      const m = plan.morning;
      html += '<div class="notice ' + (m.fits ? 'info' : 'warn') + '"><b>Morning catch-up: ' + m.minutes + ' min · wake at ' + t12(m.wake) + '</b>' +
        (m.fits ? '' : '<span class="body">That is earlier than ' + hm(s.earliestWake) + '. Move something to the weekend or drop it.</span>') + '</div>';
    }
    // Still doesn't fit: offer to move the lowest-priority task
    const morningOk = !plan.morning || plan.morning.fits;
    if (!plan.fits || !morningOk) {
      const pool = day.tasks.filter(function (t) { return !ex[t.id] || (!morningOk && ex[t.id] === 'morning'); });
      const low = P.lowestPriority(pool);
      if (low) {
        html += '<div class="notice warn"><b>Still too much?</b><span class="body">Lowest priority: <b>' + esc(low.subject) + '</b> (' + esc(typeLabel(low)) + ').</span>' +
          '<div class="row"><button class="btn small" type="button" data-act="move-to" data-to="weekend" data-id="' + low.id + '">Move to weekend</button>' +
          '<button class="btn small" type="button" data-act="move-to" data-to="dropped" data-id="' + low.id + '">Drop it</button></div></div>';
      }
    }
    if (day.moved.length) {
      html += '<div class="stack small">' + day.moved.map(function (m) {
        const t = day.tasks.find(function (x) { return x.id === m.taskId; });
        return t ? '<div class="row"><span class="grow">' + esc(t.subject) + ' → ' + (m.to === 'weekend' ? 'weekend' : 'dropped') + '</span>' +
          '<button class="btn small ghost" type="button" data-act="unmove" data-id="' + t.id + '">Undo</button></div>' : '';
      }).join('') + '</div>';
    }
    if (day.revision) {
      html += '<div class="row small"><span class="grow">Revision ' + day.revision.minutes + ' min' + (day.revision.topic ? ': ' + esc(day.revision.topic) : '') + '</span>' +
        '<button class="btn small ghost" type="button" data-act="revision-remove">Remove</button></div>';
    }
    html += '<details><summary class="small"><b>See the timetable</b></summary>' + renderTimeline(plan, day) + '</details>';
    const canMake = plan.afternoon.length > 0 && morningOk;
    html += '<button class="btn primary block" type="button" data-act="make-sheet"' + (canMake ? '' : ' disabled') + '>' + ICON.print + 'Make today’s sheet</button>';
    if (!plan.fits) html += '<p class="small muted">You can still make the sheet; the app will show it ends after the line.</p>';
    html += '</div>';
    return html;
  }

  function taskById(day, id) { return day.tasks.find(function (t) { return t.id === id; }); }
  function renderTimeline(plan, day) {
    let html = '<ul class="timeline">';
    plan.items.forEach(function (it) {
      if (it.kind === 'task') {
        const t = taskById(day, it.taskId);
        html += '<li><span class="t">' + t12(it.start) + '</span><span>' + esc(t ? t.subject : '') + (it.parts > 1 ? ' <span class="small muted">(part ' + it.part + '/' + it.parts + ')</span>' : '') +
          (t && t.note ? '<br><span class="small muted">' + noteHtml(t.note) + '</span>' : '') + '</span><span class="num small">' + it.minutes + 'm</span></li>';
      } else if (it.kind === 'break') {
        html += '<li class="brk"><span class="t">' + t12(it.start) + '</span><span>' + (it.long ? 'Long break' : 'Break') + ' (water, stretch)</span><span class="num">' + it.minutes + 'm</span></li>';
      } else if (it.kind === 'revision') {
        html += '<li><span class="t">' + t12(it.start) + '</span><span>Revision' + (it.topic ? ': ' + esc(it.topic) : '') + '</span><span class="num small">' + it.minutes + 'm</span></li>';
      } else if (it.kind === 'buffer') {
        html += '<li class="brk"><span class="t">' + t12(it.start) + '</span><span>Spare time (if something runs long)</span><span class="num">' + it.minutes + 'm</span></li>';
      }
    });
    html += '<li class="fin"><span class="t">' + t12(plan.end) + '</span><span>Done · free time</span><span></span></li></ul>';
    return html;
  }
  function renderTimelineCard(plan, day) {
    return '<div class="card"><h2>Timetable</h2>' + renderMeter(plan) + renderTimeline(plan, day) + '</div>';
  }

  // ---------- task editor modal ----------
  function openTaskEditor(task, isNew) {
    S.modal = { kind: 'task', isNew: isNew, task: JSON.parse(JSON.stringify(task)) };
    render();
    setTimeout(function () { const n = document.getElementById('task-note'); if (n && isNew) n.focus(); }, 30);
  }
  function renderModal() {
    if (S.modal.kind === 'task') return renderTaskModal();
    if (S.modal.kind === 'different') return renderDifferentModal();
    if (S.modal.kind === 'confirm') return renderConfirmModal();
    if (S.modal.kind === 'day') return renderDayModal();
    return '';
  }
  function renderTaskModal() {
    const t = S.modal.task;
    const est = P.estimate(t, S.rates);
    const unitWord = t.type === 'minutes' ? 'Minutes' : t.type === 'test' ? 'Tests' : (P.TASK_TYPES[t.type].label);
    return '<div class="overlay" data-act="modal-bg"><form class="sheet-modal" id="task-form" role="dialog" aria-modal="true" aria-labelledby="task-h">' +
      '<div class="section-head"><h2 id="task-h">' + esc(t.subject) + '</h2><button class="btn small ghost" type="button" data-act="modal-close">Cancel</button></div>' +
      '<label class="field">What the diary says<span class="hint">Type it as written, English or Urdu. e.g. “Ex 3.2 Q1–3”</span>' +
      '<textarea id="task-note" dir="auto" class="' + (isUrdu(t.note) ? 'urdu' : '') + '" maxlength="140">' + esc(t.note || '') + '</textarea></label>' +
      '<div class="fb-row"><b>Kind of work</b><div class="chips">' + Object.keys(P.TASK_TYPES).map(function (k) {
        return '<button class="chip" type="button" data-act="task-type" data-type="' + k + '" aria-pressed="' + (t.type === k) + '">' + P.TASK_TYPES[k].label + '</button>';
      }).join('') + '</div></div>' +
      (t.type === 'test' ? '' :
        '<div class="row"><b class="grow">' + unitWord + '</b><div class="stepper"><button type="button" data-act="units" data-d="' + (t.type === 'minutes' ? -5 : -1) + '" aria-label="Less">−</button>' +
        '<input id="task-units" type="number" inputmode="numeric" min="0" max="300" value="' + esc(t.units) + '" aria-label="' + unitWord + '">' +
        '<button type="button" data-act="units" data-d="' + (t.type === 'minutes' ? 5 : 1) + '" aria-label="More">+</button></div></div>') +
      '<div class="chips"><button class="chip flag" type="button" data-act="task-flag" data-flag="test" aria-pressed="' + !!t.test + '">Test</button>' +
      '<button class="chip flag" type="button" data-act="task-flag" data-flag="dueTomorrow" aria-pressed="' + !!t.dueTomorrow + '">Due tomorrow</button></div>' +
      '<div class="notice info"><div class="row"><b class="grow">Planned time</b>' +
      '<div class="stepper"><button type="button" data-act="override" data-d="-5" aria-label="5 minutes less">−</button><output id="task-est" class="num">' + est + '</output>' +
      '<button type="button" data-act="override" data-d="5" aria-label="5 minutes more">+</button></div></div>' +
      '<span class="body small" id="task-est-why">' + (t.override ? 'You set this time.' + ' <button class="btn small ghost" type="button" data-act="override-clear">Use the app’s time</button>' : estWhy(t)) + '</span></div>' +
      '<div class="row"><button class="btn primary grow" type="submit">' + (S.modal.isNew ? 'Add task' : 'Save') + '</button>' +
      (S.modal.isNew ? '' : '<button class="btn warn" type="button" data-act="task-delete">Delete</button>') + '</div></form></div>';
  }
  function estWhy(t) {
    if (t.type === 'minutes') return 'You entered the minutes.';
    const r = P.rateFor(S.rates, t.subject, t.type);
    const u = t.type === 'test' ? 1 : (Number(t.units) || 0);
    return (Math.round(r * 10) / 10) + ' min per ' + P.TASK_TYPES[t.type].unit + (u > 1 ? ' × ' + u : '') + ', rounded to 5.';
  }
  function updateEstimateOnly() {
    const t = S.modal.task;
    const out = document.getElementById('task-est');
    if (out) out.textContent = P.estimate(t, S.rates);
    const why = document.getElementById('task-est-why');
    if (why && !t.override) why.textContent = estWhy(t);
  }
  async function saveTaskModal(e) {
    if (e) e.preventDefault();
    const t = S.modal.task;
    const noteEl = document.getElementById('task-note');
    if (noteEl) t.note = noteEl.value.trim();
    const uEl = document.getElementById('task-units');
    if (uEl) t.units = Math.max(0, Number(uEl.value) || 0);
    if (t.type === 'test') { t.units = 1; t.test = true; }
    if (t.type !== 'minutes' && t.type !== 'test' && !(t.units > 0)) { toast('Add how many ' + P.TASK_TYPES[t.type].plural); return; }
    if (t.type === 'minutes' && !(t.units > 0)) t.units = 15;
    const day = S.day;
    if (S.modal.isNew) {
      day.tasks.push(t);
      if (!day.manual) applySuggested(day);
      else {
        // Put the new task where the suggestion would, relative to the others.
        const ids = suggestedIds(day);
        const pos = ids.indexOf(t.id);
        day.tasks.pop();
        const after = ids.slice(0, pos).reverse().find(function (id) { return day.tasks.some(function (x) { return x.id === id; }); });
        const at = after ? day.tasks.findIndex(function (x) { return x.id === after; }) + 1 : 0;
        day.tasks.splice(at, 0, t);
      }
    } else {
      const i = day.tasks.findIndex(function (x) { return x.id === t.id; });
      if (i >= 0) day.tasks[i] = t;
      if (!day.manual) applySuggested(day);
    }
    const wasNew = S.modal.isNew;
    S.modal = null;
    await saveDay();
    toast(wasNew ? 'Task added' : 'Task saved');
    render();
  }

  function renderDifferentModal() {
    const d = S.day.different || {};
    return '<div class="overlay" data-act="modal-bg"><form class="sheet-modal" id="different-form" role="dialog" aria-modal="true" aria-labelledby="diff-h">' +
      '<h2 id="diff-h">Today is different</h2><p class="small muted">Only today changes. Your usual times stay the same.</p>' +
      '<div class="grid-2"><label class="field">Study start<input id="diff-start" type="time" value="' + esc(d.studyStart || S.settings.studyStart) + '"></label>' +
      '<label class="field">Finish line<input id="diff-finish" type="time" value="' + esc(d.finishLine || S.settings.finishLine) + '"></label></div>' +
      '<div class="row"><button class="btn primary grow" type="submit">Use these times</button>' +
      (S.day.different ? '<button class="btn" type="button" data-act="different-clear">Back to usual</button>' : '') +
      '<button class="btn ghost" type="button" data-act="modal-close">Cancel</button></div></form></div>';
  }
  function renderConfirmModal() {
    const m = S.modal;
    return '<div class="overlay" data-act="modal-bg"><div class="sheet-modal" role="dialog" aria-modal="true" aria-labelledby="cf-h">' +
      '<h2 id="cf-h">' + esc(m.title) + '</h2><p>' + esc(m.text) + '</p>' +
      '<div class="row"><button class="btn ' + (m.danger ? 'warn' : 'primary') + ' grow" type="button" data-act="confirm-yes">' + esc(m.yes) + '</button>' +
      '<button class="btn grow" type="button" data-act="modal-close">Cancel</button></div></div></div>';
  }
  function confirmBox(title, text, yes, danger, fn) { S.modal = { kind: 'confirm', title: title, text: text, yes: yes, danger: danger, fn: fn }; render(); }

  // ---------- making the sheet ----------
  async function makeSheet() {
    const day = S.day;
    const plan = computePlan(day);
    const sug = suggestedIds(day);
    const fin = day.tasks.map(function (t) { return t.id; });
    day.suggestedOrder = sug;
    day.orderChanged = !P.sameOrder(sug, fin);
    day.plan = {
      items: plan.items, start: plan.start, end: plan.end, finishLine: plan.finishLine, fits: plan.fits, overMin: plan.overMin,
      workMin: plan.workMin, breakMin: plan.breakMin, bufferMin: plan.bufferMin, morning: plan.morning,
      minutes: plan.afternoon.reduce(function (o, t) { o[t.id] = t.minutes; return o; }, {})
    };
    // Record planned minutes on tasks (used for learning).
    const est = {};
    withMinutes(day.tasks).forEach(function (t) { est[t.id] = t.minutes; });
    day.tasks.forEach(function (t) { t.minutes = est[t.id]; });
    day.morning.wake = plan.morning ? plan.morning.wake : null;
    day.locked = true;
    day.lockedAt = new Date().toISOString();
    if (!day.orderLearned) {
      S.subjectScore = P.learnOrder(sug, fin, day.tasks, null, S.subjectScore);
      day.orderLearned = true;
      await saveKv('subjectScore');
    }
    // Tasks moved to the weekend wait in the carry list.
    day.moved.filter(function (m) { return m.to === 'weekend' && !m.carried; }).forEach(function (m) {
      const t = taskById(day, m.taskId);
      if (t) { S.carry.push({ task: Object.assign({}, t, { id: uid(), override: null }), from: day.date }); m.carried = true; }
    });
    await saveKv('carry');
    await saveDay();
    S.view = 'sheet';
    render();
  }

  // ---------- SHEET ----------
  function sheetHtml(day) {
    const plan = day.plan;
    const s = daySettings(day);
    const ex = excludedIds(day);
    const box = '<span class="box"></span>';
    let rows = '';
    plan.items.forEach(function (it) {
      if (it.kind === 'task') {
        const t = taskById(day, it.taskId);
        if (!t) return;
        rows += '<tr><td class="t">' + t12(it.start) + '–' + t12(it.end) + '</td><td><b>' + esc(t.subject) + '</b>' + (it.parts > 1 ? ' (part ' + it.part + '/' + it.parts + ')' : '') +
          (t.test ? ' · TEST' : '') + ' · ' + esc(typeLabel(t)) + (t.note ? ' · ' + noteHtml(t.note) : '') + '</td><td class="t">' + it.minutes + 'm</td><td class="t">' + box + '</td></tr>';
      } else if (it.kind === 'break') {
        rows += '<tr class="brk"><td class="t">' + t12(it.start) + '</td><td>' + (it.long ? 'Long break' : 'Break') + ': water, stretch, away from the desk</td><td class="t">' + it.minutes + 'm</td><td></td></tr>';
      } else if (it.kind === 'revision') {
        rows += '<tr><td class="t">' + t12(it.start) + '–' + t12(it.end) + '</td><td><b>Revision</b>' + (it.topic ? ': ' + esc(it.topic) : '') + '</td><td class="t">' + it.minutes + 'm</td><td class="t">' + box + '</td></tr>';
      } else if (it.kind === 'buffer') {
        rows += '<tr class="brk"><td class="t">' + t12(it.start) + '</td><td>Spare time, only if something ran long</td><td class="t">' + it.minutes + 'm</td><td></td></tr>';
      }
    });
    rows += '<tr><td class="t"><b>' + t12(plan.end) + '</b></td><td><b>Done → free time</b> (finish line ' + hm(s.finishLine) + ')</td><td></td><td></td></tr>';

    const morningTasks = day.tasks.filter(function (t) { return ex[t.id] === 'morning'; });
    const morning = morningTasks.length ? '<div class="ps-h">Morning catch-up · wake ' + t12(day.plan.morning.wake) + '</div><table class="ps"><tbody>' +
      morningTasks.map(function (t) { return '<tr><td><b>' + esc(t.subject) + '</b> · ' + esc(typeLabel(t)) + (t.note ? ' · ' + noteHtml(t.note) : '') + '</td><td class="t">' + t.minutes + 'm</td><td class="t">' + box + '</td></tr>'; }).join('') +
      '</tbody></table>' : '';

    const SHORT = { early10: 'Early 10+', early5: 'Early 5', ontime: 'On time', plus10: '+10', plus20: '+20', plus30: '+30 or more',
      understand: "Didn't understand", breaklong: 'Break long', notdone: 'Not done' };
    function opts(list) { return list.map(function (o) { return '<span class="opt">' + box + esc(SHORT[o.id] || o.label) + '</span>'; }).join(''); }
    const fbTasks = day.tasks.filter(function (t) { return !ex[t.id] || ex[t.id] === 'morning'; });
    const fbRows = fbTasks.map(function (t) {
      return '<tr><td class="fb-subj"><b>' + esc(t.subject) + '</b><br><span class="ps-sub">' + esc(typeLabel(t)) + '</span></td><td class="fb-grid">' +
        '<div><b>Status</b> ' + opts(P.STATUS) + '<b>Difficulty</b> ' + opts(P.DIFFICULTY) + '<b>Focus</b> ' + opts(P.FOCUS) + '</div>' +
        '<div><b>Time</b> ' + opts(P.TIME_BUCKETS) + '</div>' +
        '<div><b>If late</b> ' + opts(P.LATE_REASONS) + '<span class="opt help">' + box + 'Need help</span></div></td></tr>';
    }).join('');

    const tv = Array.from({ length: 8 }, function () { return '<span class="box"></span>'; }).join('');
    return '<div class="paper-sheet">' +
      '<div class="ps-head"><div><h1>Minahil’s homework plan</h1><div class="ps-sub">' + esc(niceDate(day.date, true)) + ' · start ' + t12(plan.start) +
      ' · finish line ' + hm(s.finishLine) + ' · plan ends ' + t12(plan.end) + '</div></div><div class="ps-code">' + dateCode(day.date) + '</div></div>' +
      '<div class="ps-h">Plan</div><table class="ps"><thead><tr><th>Time</th><th>Task</th><th>Min</th><th>✓</th></tr></thead><tbody>' + rows + '</tbody></table>' +
      morning +
      '<div class="ps-h">Feedback · tick one in each row</div><table class="ps"><tbody>' + fbRows + '</tbody></table>' +
      '<div class="ps-h">Once today</div><div class="ps-daily">' +
      '<div>Start time <span class="ps-blank"></span></div><div>Finish time <span class="ps-blank"></span></div>' +
      '<div>Sleep time <span class="ps-blank"></span></div>' +
      '<div class="ps-tv" style="grid-column:1/3">TV time (each box = 15 min) ' + tv + '</div><div>' + box + 'Free time taken</div>' +
      '<div style="grid-column:1/-1">What was hard today? <span class="ps-blank" style="min-width:120mm"></span></div></div>' +
      '<div class="ps-foot"><span>' + dateCode(day.date) + '</span><span>Evening: open the app → Evening → tick the same boxes</span></div></div>';
  }
  function findSheetDay() {
    if (S.day.locked) return S.day;
    const prev = S.days.slice().reverse().find(function (d) { return d.locked && !(d.feedback && d.feedback.saved); });
    return prev || null;
  }
  function renderSheetView() {
    const day = findSheetDay();
    if (!day) {
      return '<div class="card"><h2>No sheet yet</h2><p class="muted">Make today’s plan first, then the printable sheet appears here.</p>' +
        '<button class="btn primary block" type="button" data-act="go" data-view="today">Go to today’s plan</button></div>';
    }
    return '<div class="card"><div class="section-head"><h2>' + (day.date === S.date ? 'Today’s sheet' : 'Sheet for ' + esc(niceDate(day.date))) + '</h2>' +
      '<span class="small muted">' + dateCode(day.date) + '</span></div>' +
      '<button class="btn primary block" type="button" data-act="print">' + ICON.print + 'Print sheet</button>' +
      '<p class="small muted">In the print screen, pick the Wi-Fi printer and A4 paper. Then study from the paper; you don’t need the phone until the evening.</p></div>' +
      '<div class="sheet-preview" id="sheet-preview"><div id="sheet-scale">' + sheetHtml(day) + '</div></div>';
  }
  function fitSheetPreview() {
    const wrap = document.getElementById('sheet-preview');
    const inner = document.getElementById('sheet-scale');
    if (!wrap || !inner) return;
    const sheet = inner.firstElementChild;
    inner.style.transform = ''; wrap.style.height = '';
    const w = wrap.clientWidth, sw = sheet.offsetWidth;
    if (sw > w) {
      const k = w / sw;
      inner.style.transformOrigin = 'top left';
      inner.style.transform = 'scale(' + k + ')';
      inner.style.width = sw + 'px';
      wrap.style.height = Math.ceil(sheet.offsetHeight * k) + 'px';
      wrap.style.overflow = 'hidden';
    }
  }
  function printSheet() {
    const day = findSheetDay();
    if (!day) return;
    $print.innerHTML = sheetHtml(day);
    setTimeout(function () { window.print(); }, 50);
  }

  // ---------- EVENING ----------
  function feedbackDays() {
    return S.days.filter(function (d) { return d.locked && !d.pause; }).slice(-10).reverse();
  }
  function fbDay() {
    const list = feedbackDays();
    if (S.fbDate) { const d = list.find(function (x) { return x.date === S.fbDate; }); if (d) return d; }
    const today = list.find(function (d) { return d.date === S.date; });
    if (today) return today;
    return list.find(function (d) { return !(d.feedback && d.feedback.saved); }) || list[0] || null;
  }
  function ensureFeedback(day) {
    if (!day.feedback) {
      day.feedback = { saved: false, tasks: {}, start: P.toHHMM(day.plan.start), finish: '', sleep: '', freeTaken: false, hardNote: '', tvBoxes: 0 };
    }
    return day.feedback;
  }
  function chipGroup(taskId, field, list, value, multi) {
    return '<div class="chips">' + list.map(function (o) {
      const on = multi ? (value || []).indexOf(o.id) >= 0 : value === o.id;
      return '<button class="chip" type="button" data-act="fb" data-task="' + taskId + '" data-field="' + field + '" data-val="' + o.id + '"' + (multi ? ' data-multi="1"' : '') + ' aria-pressed="' + on + '">' + esc(o.label) + '</button>';
    }).join('') + '</div>';
  }
  function renderEvening() {
    const day = fbDay();
    if (!day) {
      return '<div class="card"><h2>Nothing to tick yet</h2><p class="muted">After you make and use today’s sheet, come back here in the evening.</p></div>';
    }
    const f = ensureFeedback(day);
    const ex = excludedIds(day);
    const list = feedbackDays();
    let html = '<div class="today-hero"><div class="date">Evening ticks</div><p class="line">' + esc(niceDate(day.date, true)) + ' · copy the ticks from your sheet. About 2 minutes.</p></div>';
    if (list.length > 1) {
      html += '<label class="field">Day<select id="fb-date">' + list.map(function (d) {
        return '<option value="' + d.date + '"' + (d.date === day.date ? ' selected' : '') + '>' + esc(niceDate(d.date)) + (d.feedback && d.feedback.saved ? ' ✓' : '') + '</option>';
      }).join('') + '</select></label>';
    }
    if (f.saved) html += '<div class="notice ok"><b>Saved</b><span class="body">You can still fix a tick and save again.</span></div>';

    day.tasks.filter(function (t) { return !ex[t.id] || ex[t.id] === 'morning'; }).forEach(function (t) {
      const tf = f.tasks[t.id] || {};
      html += '<div class="card fb-task"><div class="section-head"><h3>' + esc(t.subject) + (ex[t.id] === 'morning' ? ' <span class="tag morning">Morning</span>' : '') + '</h3>' +
        '<span class="small muted">' + esc(typeLabel(t)) + ' · ' + (t.minutes || P.estimate(t, S.rates)) + ' min planned</span></div>' +
        (t.note ? '<div class="task-note">' + noteHtml(t.note) + '</div>' : '') +
        '<div class="fb-row"><b>Status</b>' + chipGroup(t.id, 'status', P.STATUS, tf.status) + '</div>' +
        '<div class="fb-row"><b>Time</b>' + chipGroup(t.id, 'time', P.TIME_BUCKETS, tf.time) + '</div>' +
        '<div class="fb-row"><b>Difficulty</b>' + chipGroup(t.id, 'difficulty', P.DIFFICULTY, tf.difficulty) + '</div>' +
        '<div class="fb-row"><b>Focus</b>' + chipGroup(t.id, 'focus', P.FOCUS, tf.focus) + '</div>' +
        '<div class="fb-row"><b>If late, why</b>' + chipGroup(t.id, 'reasons', P.LATE_REASONS, tf.reasons, true) + '</div>' +
        '<div class="chips"><button class="chip flag" type="button" data-act="fb" data-task="' + t.id + '" data-field="help" data-val="1" aria-pressed="' + !!tf.help + '">Need help with this</button></div></div>';
    });

    const tv = Array.from({ length: 8 }, function (_, i) {
      return '<button class="tv-box" type="button" data-act="tv" data-n="' + (i + 1) + '" aria-pressed="' + (i < (f.tvBoxes || 0)) + '" aria-label="' + ((i + 1) * 15) + ' minutes">' + (i + 1) + '</button>';
    }).join('');
    html += '<div class="card"><h2>Once today</h2><div class="grid-2">' +
      '<label class="field">Start time<input id="fb-start" type="time" value="' + esc(f.start) + '"></label>' +
      '<label class="field">Finish time<input id="fb-finish" type="time" value="' + esc(f.finish) + '"></label>' +
      '<label class="field">Sleep time<input id="fb-sleep" type="time" value="' + esc(f.sleep) + '"><span class="hint">Can fill tomorrow</span></label>' +
      '<div class="field"><span>Free time</span><button class="chip" type="button" data-act="fb-free" aria-pressed="' + !!f.freeTaken + '">Free time taken</button></div></div>' +
      '<div class="fb-row"><b>TV time · each box 15 min · ' + ((f.tvBoxes || 0) * 15) + ' min</b><div class="tv-boxes">' + tv + '</div></div>' +
      '<label class="field">What was hard today? <span class="hint">Optional, one line</span><input id="fb-hard" type="text" dir="auto" maxlength="120" value="' + esc(f.hardNote) + '"></label>' +
      '<label class="btn block" for="sheet-photo">' + ICON.camera + (day.hasSheetPhoto ? 'Retake photo of ticked sheet' : 'Photo of ticked sheet (optional)') + '</label>' +
      '<input id="sheet-photo" type="file" accept="image/*" capture="environment" hidden>' +
      '<p class="small muted">The photo is kept so Phase 2 can learn to read your sheets.</p>' +
      '<button class="btn primary block" type="button" data-act="fb-save" data-date="' + day.date + '">Save evening ticks</button></div>';
    return html;
  }
  function readDailyInputs(f) {
    ['start', 'finish', 'sleep'].forEach(function (k) { const el = document.getElementById('fb-' + k); if (el) f[k] = el.value; });
    const h = document.getElementById('fb-hard'); if (h) f.hardNote = h.value.trim();
  }
  async function saveFeedback(date) {
    const day = getDay(date);
    if (!day) return;
    const f = ensureFeedback(day);
    readDailyInputs(f);
    const ex = excludedIds(day);
    const missing = day.tasks.filter(function (t) { return (!ex[t.id] || ex[t.id] === 'morning') && !(f.tasks[t.id] && f.tasks[t.id].status); });
    if (missing.length) { toast('Tick a status for ' + missing.map(function (t) { return t.subject; }).join(', ')); return; }
    if (!f.finish) { toast('Add your finish time'); return; }
    f.saved = true; f.savedAt = new Date().toISOString();
    let changes = [];
    if (!day.learned) {
      const out = P.learnFromDay(day, S.rates, S.samples);
      S.rates = out.rates; S.samples = out.samples; changes = out.changes;
      const ids = day.tasks.map(function (t) { return t.id; });
      S.subjectScore = P.learnOrder(ids, ids, day.tasks, f, S.subjectScore);
      day.learned = true; day.learnChanges = changes;
      await Promise.all([saveKv('rates'), saveKv('samples'), saveKv('subjectScore')]);
    }
    await saveDay(day);
    toast('Saved. Well done!');
    S.view = S.role === 'parent' ? 'parent' : 'me';
    S.fbDate = null;
    render();
  }

  // ---------- MY DAY (Minahil) ----------
  function dayResult(d) {
    if (!d || !d.feedback || !d.feedback.saved) return null;
    const f = d.feedback;
    const line = P.toMin(daySettings(d).finishLine);
    const fin = P.toMin(f.finish);
    let saved = 0, done = 0, total = 0;
    (d.tasks || []).forEach(function (t) {
      const tf = f.tasks[t.id]; if (!tf) return;
      total += 1; if (tf.status === 'done') done += 1;
      const dl = P.bucketDelta(tf.time); if (dl && dl < 0) saved += -dl;
    });
    return { before: !isNaN(fin) && fin <= line, freeMin: isNaN(fin) ? 0 : Math.max(0, line - fin), saved: saved, done: done, total: total, tv: (f.tvBoxes || 0) * 15, finish: fin, line: line };
  }
  function streakInfo() {
    const school = S.days.filter(function (d) { return !d.pause && d.feedback && d.feedback.saved; });
    const last = school.slice(-7);
    let streak = 0;
    for (let i = school.length - 1; i >= 0; i--) { const r = dayResult(school[i]); if (r && r.before) streak += 1; else break; }
    return { streak: streak, last: last };
  }
  function renderMe() {
    const r = dayResult(getDay(S.date)) || dayResult(S.days.slice().reverse().find(function (d) { return d.feedback && d.feedback.saved; }));
    const st = streakInfo();
    let html = '<div class="today-hero"><div class="date">My day</div><p class="line">' +
      (st.streak ? '<span class="hl">' + st.streak + ' day' + (st.streak > 1 ? 's' : '') + ' finished before the line</span>' : 'Finish before the line to start a streak.') + '</p></div>';
    if (r) {
      html += '<div class="stats">' +
        '<div class="stat"><div class="v">' + r.done + '/' + r.total + '</div><div class="k">tasks done</div></div>' +
        '<div class="stat"><div class="v">' + r.freeMin + '<span class="small"> min</span></div><div class="k">free time earned before the line</div></div>' +
        '<div class="stat"><div class="v">' + r.saved + '<span class="small"> min</span></div><div class="k">saved by finishing early</div></div>' +
        '<div class="stat"><div class="v">' + r.tv + '<span class="small"> min</span></div><div class="k">TV today</div></div></div>';
    } else {
      html += '<div class="card flat"><p class="muted">Your numbers appear here after the first evening ticks.</p></div>';
    }
    if (st.last.length) {
      html += '<div class="card"><h2>Last days</h2><div class="streak">' + st.last.map(function (d) {
        const rr = dayResult(d);
        return '<span class="' + (rr && rr.before ? 'y' : 'n') + '" title="' + esc(niceDate(d.date)) + '">' + parseDate(d.date).toLocaleDateString('en-GB', { weekday: 'narrow' }) + '</span>';
      }).join('') + '</div><p class="small muted">Green = finished before the line.</p></div>';
    }
    html += '<div class="card flat"><div class="row"><div class="grow"><h3>My starting times</h3><p class="small muted">How long a page, question or test takes you. The app also learns these.</p></div>' +
      '<button class="btn small" type="button" data-act="go" data-view="rates">Open</button></div></div>';
    return html;
  }

  // ---------- PARENT ----------
  function renderParent() {
    const recent = S.days.filter(function (d) { return d.date <= S.date; }).slice(-7);
    const sum = P.summarize(recent, S.settings);
    const orderChanges = recent.filter(function (d) { return d.orderChanged; }).length;
    function top(obj, labels) {
      const arr = Object.keys(obj).map(function (k) { return [k, obj[k]]; }).sort(function (a, b) { return b[1] - a[1]; }).slice(0, 4);
      if (!arr.length) return '<span class="muted">None</span>';
      return arr.map(function (x) { return esc(labels ? (labels[x[0]] || x[0]) : x[0]) + ' (' + x[1] + ')'; }).join(', ');
    }
    const reasonLabels = {}; P.LATE_REASONS.forEach(function (r) { reasonLabels[r.id] = r.label; });
    let html = '<div class="today-hero"><div class="date">Last 7 days</div><p class="line">' + sum.days + ' school day' + (sum.days === 1 ? '' : 's') + ' with evening ticks</p></div>';
    html += '<div class="stats">' +
      '<div class="stat"><div class="v">' + sum.noMorning + '/' + sum.days + '</div><div class="k">days with no morning catch-up (key result)</div></div>' +
      '<div class="stat"><div class="v">' + sum.beforeLine + '/' + sum.days + '</div><div class="k">finished by the line</div></div>' +
      '<div class="stat"><div class="v">' + (sum.avgFinish != null ? t12(sum.avgFinish) : '–') + '</div><div class="k">average finish</div></div>' +
      '<div class="stat"><div class="v">' + (sum.avgSleep != null ? t12(sum.avgSleep) : '–') + '</div><div class="k">average sleep time</div></div>' +
      '<div class="stat"><div class="v">' + minsLabel(sum.tvMin) + '</div><div class="k">TV this week</div></div>' +
      '<div class="stat"><div class="v">' + orderChanges + '</div><div class="k">days she changed the suggested order</div></div></div>';
    html += '<div class="card"><h2>Patterns</h2>' +
      '<p><b>Subjects running over:</b> ' + top(sum.overrun) + '</p>' +
      '<p><b>Delay reasons:</b> ' + top(sum.reasons, reasonLabels) + '</p>' +
      '<p><b>Average start:</b> ' + (sum.avgStart != null ? t12(sum.avgStart) : '–') + '</p>' +
      (sum.help.length ? '<p><b>Need help:</b> ' + sum.help.map(function (h) { return esc(h.subject) + (h.note ? ' (' + esc(h.note) + ')' : '') + ' · ' + esc(niceDate(h.date)); }).join('; ') + '</p>' : '') +
      (sum.hard.length ? '<p><b>What was hard:</b></p><ul>' + sum.hard.map(function (h) { return '<li>' + esc(niceDate(h.date)) + ': <span dir="auto">' + esc(h.text) + '</span></li>'; }).join('') + '</ul>' : '') +
      '</div>';

    // History
    const hist = S.days.slice().reverse().slice(0, 21);
    html += '<div class="card"><h2>History</h2>' + (hist.length ? '<div class="table-wrap"><table class="data"><thead><tr><th>Day</th><th class="n">Tasks</th><th class="n">Plan ends</th><th class="n">Finished</th><th></th></tr></thead><tbody>' +
      hist.map(function (d) {
        const r = dayResult(d);
        return '<tr><td>' + esc(niceDate(d.date)) + (d.pause ? ' <span class="small muted">paused</span>' : '') + '</td><td class="n">' + d.tasks.length + '</td>' +
          '<td class="n">' + (d.plan ? t12(d.plan.end) : '–') + '</td><td class="n">' + (r ? t12(r.finish) + (r.before ? ' ✓' : '') : '–') + '</td>' +
          '<td><button class="btn small ghost" type="button" data-act="open-day" data-date="' + d.date + '">Open</button></td></tr>';
      }).join('') + '</tbody></table></div>' : '<p class="muted">No days yet.</p>') + '</div>';

    // Learned times
    const learned = Object.keys(S.rates).map(function (sub) {
      return Object.keys(S.rates[sub]).map(function (t) { return '<tr><td>' + esc(sub) + '</td><td>' + esc(P.TASK_TYPES[t] ? P.TASK_TYPES[t].unit : t) + '</td><td class="n">' + (Math.round(S.rates[sub][t] * 10) / 10) + '</td><td class="n">' + ((S.samples[sub + '|' + t] || []).length) + '</td></tr>'; }).join('');
    }).join('');
    html += '<div class="card"><div class="section-head"><h2>Times per unit</h2><button class="btn small" type="button" data-act="go" data-view="rates">Edit</button></div>' +
      (learned ? '<div class="table-wrap"><table class="data"><thead><tr><th>Subject</th><th>Per</th><th class="n">Min</th><th class="n">Days learned</th></tr></thead><tbody>' + learned + '</tbody></table></div>' : '<p class="muted">Using the default guesses.</p>') + '</div>';

    // Settings
    const s = S.settings;
    function tf(id, label, hint) { return '<label class="field">' + label + '<input id="set-' + id + '" type="time" value="' + esc(s[id]) + '">' + (hint ? '<span class="hint">' + hint + '</span>' : '') + '</label>'; }
    function nf(id, label, min, max, hint) { return '<label class="field">' + label + '<input id="set-' + id + '" type="number" inputmode="numeric" min="' + min + '" max="' + max + '" value="' + esc(s[id]) + '">' + (hint ? '<span class="hint">' + hint + '</span>' : '') + '</label>'; }
    html += '<form class="card" id="settings-form"><h2>Usual times</h2><div class="grid-2">' +
      tf('prepTime', 'Plan time (alarm)') + tf('studyStart', 'Study start') + tf('finishLine', 'Finish line') + tf('feedbackTime', 'Feedback time (alarm)') +
      tf('bedtime', 'Bedtime') + tf('schoolWake', 'School wake-up') + tf('earliestWake', 'Earliest wake for catch-up') +
      tf('weekendStart', 'Weekend window start') + tf('weekendEnd', 'Weekend window end') + '</div>' +
      '<h2>Study blocks</h2><div class="grid-2">' +
      nf('blockMin', 'Study block (min)', 15, 60) + nf('breakMin', 'Short break (min)', 0, 20) + nf('longBreakMin', 'Long break (min)', 0, 40) +
      nf('blocksBeforeLong', 'Blocks before long break', 1, 6) + nf('bufferPct', 'Spare time (%)', 0, 30, '10–15% is the plan') + nf('revisionMin', 'Revision block (min)', 15, 60) +
      nf('lockMinutes', 'Auto-lock after (min)', 1, 120) + '</div>' +
      '<button class="btn primary block" type="submit">Save settings</button></form>';

    // Reminders
    html += '<div class="card"><h2>Reminders on the phone</h2><p>Set two repeating alarms in the phone’s Clock app, Monday to Friday:</p>' +
      '<ul><li><b>' + hm(s.prepTime) + '</b> “Plan time”</li><li><b>' + hm(s.feedbackTime) + '</b> “Feedback time”</li></ul>' +
      '<p class="small muted">App notifications that follow weekends and holidays come in Phase 4.</p></div>';

    // Backup + PIN + install
    html += '<div class="card"><h2>Backup</h2><p class="small muted">Phase 1 keeps data only on this phone. Download a backup each week (Google Drive or WhatsApp to yourself works). Supabase sync is the next step.</p>' +
      '<div class="row"><button class="btn grow" type="button" data-act="export">Download backup</button>' +
      '<label class="btn grow" for="import-file">Restore backup</label><input id="import-file" type="file" accept="application/json,.json" hidden></div>' +
      (Store.isMemoryOnly() ? '<div class="notice warn"><b>This browser is not saving data.</b><span class="body">Open the app in Chrome (not a private tab).</span></div>' : '') + '</div>';
    html += '<form class="card" id="pin-form" autocomplete="off"><h2>Change PINs</h2><div class="grid-2">' +
      '<label class="field">New parent PIN<input id="pin-parent" type="password" inputmode="numeric" maxlength="4" placeholder="leave empty to keep"></label>' +
      '<label class="field">New Minahil PIN<input id="pin-kid" type="password" inputmode="numeric" maxlength="4" placeholder="leave empty to keep"></label></div>' +
      '<button class="btn block" type="submit">Save PINs</button></form>';
    if (S.installEvt) html += '<button class="btn primary block" type="button" data-act="install">Install on home screen</button>';
    html += '<div class="card flat"><h3>Start over</h3><p class="small muted">Deletes all days, photos, learned times and PINs on this phone.</p>' +
      '<button class="btn warn" type="button" data-act="reset">Delete everything</button></div>';
    return html;
  }
  async function saveSettings(e) {
    e.preventDefault();
    const s = S.settings;
    ['prepTime', 'studyStart', 'finishLine', 'feedbackTime', 'bedtime', 'schoolWake', 'earliestWake', 'weekendStart', 'weekendEnd'].forEach(function (k) {
      const v = document.getElementById('set-' + k).value; if (/^\d{2}:\d{2}$/.test(v)) s[k] = v;
    });
    ['blockMin', 'breakMin', 'longBreakMin', 'blocksBeforeLong', 'bufferPct', 'revisionMin', 'lockMinutes'].forEach(function (k) {
      const el = document.getElementById('set-' + k); const v = Number(el.value);
      if (!isNaN(v) && el.value !== '') s[k] = Math.min(Number(el.max), Math.max(Number(el.min), v));
    });
    if (P.toMin(s.studyStart) >= P.toMin(s.finishLine)) { toast('Finish line must be after study start'); return; }
    await saveKv('settings');
    toast('Settings saved');
    render();
  }
  async function savePins(e) {
    e.preventDefault();
    const p = document.getElementById('pin-parent').value.trim();
    const k = document.getElementById('pin-kid').value.trim();
    if ((p && !/^\d{4}$/.test(p)) || (k && !/^\d{4}$/.test(k))) { toast('PINs need 4 digits'); return; }
    if (p && k && p === k) { toast('Use two different PINs'); return; }
    if (p) S.pins.parent = await hashPin(p, S.pins.salt);
    if (k) S.pins.kid = await hashPin(k, S.pins.salt);
    if (!p && !k) { toast('Nothing to change'); return; }
    await saveKv('pins');
    toast('PINs changed');
    render();
  }

  function renderDayModal() {
    const d = getDay(S.modal.date);
    if (!d) return '';
    const f = d.feedback;
    let html = '<div class="overlay" data-act="modal-bg"><div class="sheet-modal" role="dialog" aria-modal="true" aria-labelledby="day-h">' +
      '<div class="section-head"><h2 id="day-h">' + esc(niceDate(d.date, true)) + '</h2><button class="btn small ghost" type="button" data-act="modal-close">Close</button></div>';
    if (S.modal.photo) html += '<img class="photo-thumb" src="' + S.modal.photo + '" alt="Diary photo">';
    if (S.modal.sheetPhoto) html += '<img class="photo-thumb" src="' + S.modal.sheetPhoto + '" alt="Ticked sheet photo">';
    if (d.pause) html += '<p class="muted">Paused day.</p>';
    if (d.plan) html += '<p>Plan ' + t12(d.plan.start) + '–' + t12(d.plan.end) + ' · ' + minsLabel(d.plan.workMin) + ' work' + (d.orderChanged ? ' · she changed the order' : '') + '</p>';
    html += '<div class="table-wrap"><table class="data"><thead><tr><th>Task</th><th class="n">Plan</th><th>Status</th><th>Time</th><th>Focus</th><th>Why late</th></tr></thead><tbody>' +
      d.tasks.map(function (t) {
        const tf = f && f.tasks[t.id] || {};
        function lab(list, id) { const o = list.find(function (x) { return x.id === id; }); return o ? o.label : ''; }
        return '<tr><td><b>' + esc(t.subject) + '</b><br><span class="small muted">' + esc(typeLabel(t)) + (t.note ? ' · ' + noteHtml(t.note) : '') + '</span></td><td class="n">' + (t.minutes || '') + '</td>' +
          '<td>' + lab(P.STATUS, tf.status) + (tf.help ? '<br><span class="tag due">help</span>' : '') + '</td><td>' + lab(P.TIME_BUCKETS, tf.time) + '</td><td>' + lab(P.FOCUS, tf.focus) + '</td>' +
          '<td>' + (tf.reasons || []).map(function (r) { return lab(P.LATE_REASONS, r); }).join(', ') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
    if (f && f.saved) {
      html += '<p>Start ' + esc(f.start ? hm(f.start) : '–') + ' · finish ' + esc(f.finish ? hm(f.finish) : '–') + ' · sleep ' + esc(f.sleep ? hm(f.sleep) : '–') + ' · TV ' + (f.tvBoxes || 0) * 15 + ' min</p>';
      if (f.hardNote) html += '<p><b>Hard:</b> <span dir="auto">' + esc(f.hardNote) + '</span></p>';
      if (d.learnChanges && d.learnChanges.length) html += '<p class="small muted">Learned: ' + d.learnChanges.map(function (c) { return esc(c.subject) + ' ' + Math.round(c.from * 10) / 10 + '→' + Math.round(c.to * 10) / 10 + ' min/' + P.TASK_TYPES[c.type].unit; }).join(', ') + '</p>';
    }
    html += '</div></div>';
    return html;
  }

  // ---------- backup ----------
  async function exportBackup() {
    const kv = {};
    ['settings', 'meta', 'rates', 'samples', 'subjectScore', 'carry'].forEach(function (k) { kv[k] = S[k]; });
    const photos = {};
    (await Store.photosAll()).forEach(function (p) { photos[p.key] = p.value; });
    const data = { app: 'minahil-planner', version: 1, exportedAt: new Date().toISOString(), kv: kv, days: S.days, photos: photos };
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'minahil-planner-backup-' + S.date + '.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
    toast('Backup downloaded');
  }
  function importBackup(file) {
    const reader = new FileReader();
    reader.onload = function () {
      let data;
      try { data = JSON.parse(reader.result); } catch (e) { toast('That file is not a planner backup'); return; }
      if (!data || data.app !== 'minahil-planner') { toast('That file is not a planner backup'); return; }
      confirmBox('Restore this backup?', 'Days and learned times from ' + (data.exportedAt || '').slice(0, 10) + ' will replace what is on this phone. PINs stay the same.', 'Restore', true, async function () {
        const pins = S.pins;
        await Store.clearAll();
        S.pins = pins; await saveKv('pins');
        const kv = data.kv || {};
        for (const k of Object.keys(kv)) { S[k] = kv[k]; await saveKv(k); }
        S.settings = Object.assign({}, APP_DEFAULTS, S.settings || {});
        for (const d of (data.days || [])) await Store.daySet(d.date, d);
        for (const k of Object.keys(data.photos || {})) await Store.photoSet(k, data.photos[k]);
        S.days = await Store.daysAll();
        S.day = getDay(S.date) || newDay(S.date);
        toast('Backup restored');
        render();
      });
    };
    reader.readAsText(file);
  }

  // ---------- photos ----------
  function compressImage(file, maxSide) {
    return new Promise(function (resolve, reject) {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = function () {
        const k = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL('image/jpeg', 0.78));
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('Could not read the photo')); };
      img.src = url;
    });
  }
  async function onDiaryPhoto(file) {
    try {
      const data = await compressImage(file, 1600);
      await Store.photoSet(S.day.date + ':diary', data);
      S.day.hasPhoto = true; S.diaryPhoto = data;
      await saveDay();
      toast('Diary photo saved');
      render();
    } catch (e) { toast(e.message); }
  }
  async function onSheetPhoto(file) {
    const day = fbDay(); if (!day) return;
    try {
      const f = ensureFeedback(day); readDailyInputs(f);
      const data = await compressImage(file, 1600);
      await Store.photoSet(day.date + ':sheet', data);
      day.hasSheetPhoto = true;
      await saveDay(day);
      toast('Sheet photo saved');
      render();
    } catch (e) { toast(e.message); }
  }

  // ---------- toast ----------
  let toastTimer = null;
  function toast(msg) {
    let el = document.querySelector('.toast');
    if (!el) { el = document.createElement('div'); el.className = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
    el.textContent = msg;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.remove(); }, 2600);
  }

  // ---------- after render ----------
  function afterRender() {
    if (S.view === 'sheet') { fitSheetPreview(); }
    if (S.view === 'today' && S.day.hasPhoto && !S.diaryPhoto) {
      Store.photoGet(S.day.date + ':diary').then(function (p) { if (p) { S.diaryPhoto = p; if (S.view === 'today' && !S.day.locked) render(); } });
    }
  }

  // ---------- drag to reorder ----------
  let drag = null;
  function startDrag(e, handle) {
    const li = handle.closest('.task');
    const list = document.getElementById('task-list');
    if (!li || !list) return;
    e.preventDefault();
    handle.setPointerCapture && handle.setPointerCapture(e.pointerId);
    drag = { li: li, list: list, startY: e.clientY, id: li.getAttribute('data-id'), handle: handle, moved: false };
    li.classList.add('dragging');
  }
  function moveDrag(e) {
    if (!drag) return;
    const dy = e.clientY - drag.startY;
    drag.li.style.transform = 'translateY(' + dy + 'px)';
    if (Math.abs(dy) > 4) drag.moved = true;
    const items = Array.from(drag.list.children).filter(function (x) { return x !== drag.li; });
    const r = drag.li.getBoundingClientRect();
    const mid = r.top + r.height / 2;
    let before = null;
    for (const it of items) { const b = it.getBoundingClientRect(); if (mid < b.top + b.height / 2) { before = it; break; } }
    const curNext = drag.li.nextElementSibling;
    if (before !== curNext) {
      const oldTop = drag.li.getBoundingClientRect().top;
      drag.list.insertBefore(drag.li, before);
      const newTop = drag.li.getBoundingClientRect().top;
      drag.startY += (newTop - oldTop) - 0;
      drag.li.style.transform = 'translateY(' + (e.clientY - drag.startY) + 'px)';
    }
  }
  async function endDrag() {
    if (!drag) return;
    const d = drag; drag = null;
    d.li.classList.remove('dragging'); d.li.style.transform = '';
    const ids = Array.from(d.list.children).map(function (x) { return x.getAttribute('data-id'); });
    const day = S.day;
    const before = day.tasks.map(function (t) { return t.id; });
    if (!P.sameOrder(before, ids)) {
      day.tasks.sort(function (a, b) { return ids.indexOf(a.id) - ids.indexOf(b.id); });
      day.manual = true;
      await saveDay();
    }
    render();
  }

  // ---------- events ----------
  document.addEventListener('pointerdown', function (e) {
    const h = e.target.closest('.drag-handle');
    if (h && S.day && !S.day.locked) startDrag(e, h);
  });
  document.addEventListener('pointermove', function (e) { if (drag) moveDrag(e); });
  document.addEventListener('pointerup', function () { if (drag) endDrag(); });
  document.addEventListener('pointercancel', function () { if (drag) endDrag(); });

  document.addEventListener('submit', function (e) {
    const id = e.target.id;
    if (id === 'setup-form') submitSetup(e);
    else if (id === 'task-form') saveTaskModal(e);
    else if (id === 'settings-form') saveSettings(e);
    else if (id === 'pin-form') savePins(e);
    else if (id === 'different-form') {
      e.preventDefault();
      const st = document.getElementById('diff-start').value, fl = document.getElementById('diff-finish').value;
      if (P.toMin(st) >= P.toMin(fl)) { toast('Finish line must be after the start'); return; }
      S.day.different = { studyStart: st, finishLine: fl };
      S.modal = null; saveDay().then(render);
    }
  });

  document.addEventListener('change', function (e) {
    const t = e.target;
    if (t.id === 'diary-photo' && t.files && t.files[0]) onDiaryPhoto(t.files[0]);
    else if (t.id === 'sheet-photo' && t.files && t.files[0]) onSheetPhoto(t.files[0]);
    else if (t.id === 'import-file' && t.files && t.files[0]) importBackup(t.files[0]);
    else if (t.id === 'fb-date') { const d = fbDay(); if (d && d.feedback) readDailyInputs(d.feedback); S.fbDate = t.value; render(); }
  });

  document.addEventListener('input', function (e) {
    if (/^fb-(start|finish|sleep|hard)$/.test(e.target.id) && S.view === 'evening') {
      const d = fbDay(); if (d) readDailyInputs(ensureFeedback(d));
      return;
    }
    if (!S.modal || S.modal.kind !== 'task') return;
    const t = S.modal.task;
    if (e.target.id === 'task-units') { t.units = Math.max(0, Number(e.target.value) || 0); updateEstimateOnly(); }
    if (e.target.id === 'task-note') {
      t.note = e.target.value;
      e.target.classList.toggle('urdu', isUrdu(t.note));
      const g = P.guessUnits(t.note);
      if (g && !S.modal.typeTouched) {
        const changed = g.type !== t.type || g.units !== t.units;
        t.type = g.type; if (g.units) t.units = g.units; if (g.test) t.test = true;
        if (changed) { const pos = e.target.selectionStart; render(); const n = document.getElementById('task-note'); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (x) { /* ignore */ } } }
      }
    }
  });

  document.addEventListener('click', async function (e) {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const act = el.getAttribute('data-act');
    S.lastActive = Date.now();
    if (act === 'modal-bg') { if (e.target === el) { S.modal = null; render(); } return; }
    const day = S.day;
    switch (act) {
      case 'pin-who': S.pin = { who: el.getAttribute('data-who') || null, entered: '', error: '' }; render(); break;
      case 'pin-key': pinKey(el.getAttribute('data-k')); break;
      case 'lock': lock(); break;
      case 'go': S.view = el.getAttribute('data-view'); S.modal = null; render(); window.scrollTo(0, 0); break;
      case 'rates-skip': S.meta.ratesSet = true; await saveKv('meta'); S.view = 'today'; render(); break;
      case 'rates-save': saveRates(); break;
      case 'add-task': {
        const sub = el.getAttribute('data-subject');
        const type = sub === 'Nazra' ? 'verses' : sub === 'Art' ? 'minutes' : (/-R$/.test(sub) || sub === 'Islamic Studies') ? 'pages' : 'questions';
        openTaskEditor({ id: uid(), subject: sub, type: type, units: type === 'minutes' ? 20 : 1, note: '', test: false, dueTomorrow: false, override: null }, true);
        break;
      }
      case 'edit-task': { const t = taskById(day, el.getAttribute('data-id')); if (t) { openTaskEditor(t, false); S.modal.typeTouched = true; } break; }
      case 'task-type': {
        const t = S.modal.task; t.type = el.getAttribute('data-type'); S.modal.typeTouched = true;
        const n = document.getElementById('task-note'); if (n) t.note = n.value;
        if (t.type === 'test') { t.test = true; t.units = 1; }
        if (t.type === 'minutes' && (t.units || 0) < 5) t.units = 20;
        render(); break;
      }
      case 'units': {
        const t = S.modal.task; const inp = document.getElementById('task-units');
        t.units = Math.max(0, (Number(inp && inp.value) || 0) + Number(el.getAttribute('data-d')));
        if (inp) inp.value = t.units; updateEstimateOnly(); break;
      }
      case 'task-flag': {
        const t = S.modal.task; const f = el.getAttribute('data-flag'); t[f] = !t[f];
        el.setAttribute('aria-pressed', String(!!t[f])); break;
      }
      case 'override': {
        const t = S.modal.task; const n = document.getElementById('task-note'); if (n) t.note = n.value;
        const u = document.getElementById('task-units'); if (u) t.units = Number(u.value) || 0;
        t.override = Math.max(5, P.estimate(t, S.rates) + Number(el.getAttribute('data-d')));
        render(); break;
      }
      case 'override-clear': { const t = S.modal.task; const n = document.getElementById('task-note'); if (n) t.note = n.value; t.override = null; render(); break; }
      case 'task-delete': {
        const id = S.modal.task.id;
        day.tasks = day.tasks.filter(function (x) { return x.id !== id; });
        day.morning.taskIds = day.morning.taskIds.filter(function (x) { return x !== id; });
        day.moved = day.moved.filter(function (m) { return m.taskId !== id; });
        S.modal = null; await saveDay(); toast('Task deleted'); render(); break;
      }
      case 'modal-close': S.modal = null; render(); break;
      case 'confirm-yes': { const fn = S.modal.fn; S.modal = null; await fn(); render(); break; }
      case 'move': {
        const id = el.getAttribute('data-id'); const dir = Number(el.getAttribute('data-dir'));
        const i = day.tasks.findIndex(function (t) { return t.id === id; }); const j = i + dir;
        if (i < 0 || j < 0 || j >= day.tasks.length) break;
        const tmp = day.tasks[i]; day.tasks[i] = day.tasks[j]; day.tasks[j] = tmp;
        day.manual = true; await saveDay(); render(); break;
      }
      case 'use-suggested': applySuggested(day); day.manual = false; await saveDay(); render(); break;
      case 'toggle-morning': {
        const id = el.getAttribute('data-id'); const ids = day.morning.taskIds;
        const k = ids.indexOf(id); if (k >= 0) ids.splice(k, 1); else ids.push(id);
        await saveDay(); render(); break;
      }
      case 'move-to': {
        const id = el.getAttribute('data-id');
        day.morning.taskIds = day.morning.taskIds.filter(function (x) { return x !== id; });
        day.moved.push({ taskId: id, to: el.getAttribute('data-to') });
        await saveDay(); render(); break;
      }
      case 'unmove': day.moved = day.moved.filter(function (m) { return m.taskId !== el.getAttribute('data-id'); }); await saveDay(); render(); break;
      case 'revision': day.revision = { minutes: Number(el.getAttribute('data-min')), topic: el.getAttribute('data-topic') || '' }; await saveDay(); render(); break;
      case 'revision-no': day.revisionDeclined = true; await saveDay(); render(); break;
      case 'revision-remove': day.revision = null; day.revisionDeclined = true; await saveDay(); render(); break;
      case 'different': S.modal = { kind: 'different' }; render(); break;
      case 'different-clear': day.different = null; S.modal = null; await saveDay(); render(); break;
      case 'weekend-times': day.different = { studyStart: S.settings.weekendStart, finishLine: S.settings.weekendEnd }; await saveDay(); render(); break;
      case 'pause': day.pause = el.getAttribute('data-on') === '1'; await saveDay(); render(); break;
      case 'carry-add': {
        const i = Number(el.getAttribute('data-i')); const c = S.carry[i]; if (!c) break;
        day.tasks.push(Object.assign({}, c.task, { id: uid() })); S.carry.splice(i, 1);
        if (!day.manual) applySuggested(day);
        await Promise.all([saveDay(), saveKv('carry')]); render(); break;
      }
      case 'carry-del': S.carry.splice(Number(el.getAttribute('data-i')), 1); await saveKv('carry'); render(); break;
      case 'make-sheet': makeSheet(); break;
      case 'unlock-plan':
        confirmBox('Change today’s plan?', 'The printed sheet will no longer match. Make and print a new sheet after changing.', 'Change plan', false, async function () {
          day.locked = false; await saveDay();
        });
        break;
      case 'print': printSheet(); break;
      case 'fb': {
        const d = fbDay(); if (!d) break;
        const f = ensureFeedback(d); readDailyInputs(f);
        const tid = el.getAttribute('data-task'), field = el.getAttribute('data-field'), val = el.getAttribute('data-val');
        const tf = f.tasks[tid] || (f.tasks[tid] = {});
        if (field === 'help') tf.help = !tf.help;
        else if (el.getAttribute('data-multi')) { tf[field] = tf[field] || []; const k = tf[field].indexOf(val); if (k >= 0) tf[field].splice(k, 1); else tf[field].push(val); }
        else tf[field] = tf[field] === val ? null : val;
        const y = window.scrollY; render(); window.scrollTo(0, y);
        await saveDay(d); break;
      }
      case 'fb-free': { const d = fbDay(); const f = ensureFeedback(d); readDailyInputs(f); f.freeTaken = !f.freeTaken; const y = window.scrollY; render(); window.scrollTo(0, y); await saveDay(d); break; }
      case 'tv': {
        const d = fbDay(); const f = ensureFeedback(d); readDailyInputs(f);
        const n = Number(el.getAttribute('data-n')); f.tvBoxes = f.tvBoxes === n ? n - 1 : n;
        const y = window.scrollY; render(); window.scrollTo(0, y); await saveDay(d); break;
      }
      case 'fb-save': saveFeedback(el.getAttribute('data-date')); break;
      case 'open-day': {
        const date = el.getAttribute('data-date');
        S.modal = { kind: 'day', date: date, photo: await Store.photoGet(date + ':diary'), sheetPhoto: await Store.photoGet(date + ':sheet') };
        render(); break;
      }
      case 'export': exportBackup(); break;
      case 'install': if (S.installEvt) { S.installEvt.prompt(); S.installEvt = null; render(); } break;
      case 'reset':
        confirmBox('Delete everything?', 'All days, photos, learned times and PINs on this phone will be removed. Download a backup first if you may need it.', 'Delete everything', true, async function () {
          await Store.clearAll();
          location.reload();
        });
        break;
    }
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && S.modal) { S.modal = null; render(); }
    if (!S.role && S.pin.who && /^[0-9]$/.test(e.key)) pinKey(e.key);
    if (!S.role && S.pin.who && e.key === 'Backspace') pinKey('back');
  });

  // Auto-lock when the phone is put down for a while.
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') S.hiddenAt = Date.now();
    else {
      if (S.role && S.hiddenAt && Date.now() - S.hiddenAt > LOCK_MS()) lock();
      else if (S.role) { const before = S.date; refreshDate(); if (before !== S.date) render(); }
    }
  });
  setInterval(function () { if (S.role && !drag && Date.now() - S.lastActive > LOCK_MS()) lock(); }, 30000);
  ['pointerdown', 'keydown', 'scroll'].forEach(function (ev) { document.addEventListener(ev, function () { S.lastActive = Date.now(); }, { passive: true }); });
  window.addEventListener('resize', function () { if (S.view === 'sheet') fitSheetPreview(); });
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); S.installEvt = e; });

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () { /* offline cache is optional */ }); });
  }

  // Test hook (used only by the automated tests)
  window.__planner = { S: S, render: render };

  boot();
})();
