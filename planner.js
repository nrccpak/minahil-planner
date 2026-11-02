/* Minahil Homework Planner — planning engine (plain code, no AI).
 * Works in the browser (window.Planner) and in Node (module.exports) for tests.
 */
(function (root) {
  'use strict';

  // Subjects exactly as printed in her diary, plus one extra row.
  const SUBJECTS = [
    'English-R', 'English-W', 'Urdu-R', 'Urdu-W', 'Maths', 'Gen. Science',
    'Soc. Studies', 'Islamic Studies', 'Art', 'Nazra', 'Arabic', 'Other'
  ];

  // How a task is measured. "minutes" = she just types a time.
  const TASK_TYPES = {
    pages:     { label: 'Pages',     unit: 'page',     plural: 'pages',     defaultRate: 10 },
    questions: { label: 'Questions', unit: 'question', plural: 'questions', defaultRate: 5 },
    verses:    { label: 'Verses',    unit: 'verse',    plural: 'verses',    defaultRate: 2 },
    test:      { label: 'Test prep', unit: 'test',     plural: 'tests',     defaultRate: 30 },
    minutes:   { label: 'Just time', unit: 'min',      plural: 'min',       defaultRate: 1 }
  };
  const RATE_TYPES = ['pages', 'questions', 'verses', 'test'];

  const DEFAULT_SETTINGS = {
    prepTime: '15:20',
    studyStart: '15:30',
    finishLine: '19:30',
    feedbackTime: '19:30',
    bedtime: '22:30',
    schoolWake: '05:30',
    earliestWake: '05:00',
    blockMin: 30,
    breakMin: 5,
    longBreakMin: 15,
    blocksBeforeLong: 3,
    bufferPct: 12,
    revisionMin: 30
  };

  // Starting minutes for a 9th-class student (per page / question / verse / test).
  // Used until her own ticks teach better numbers; anything she sets herself wins.
  const DEFAULT_RATES = {
    'English-R':       { pages: 8,  questions: 5, test: 30 },
    'English-W':       { pages: 15, questions: 6, test: 30 },
    'Urdu-R':          { pages: 8,  questions: 5, test: 30 },
    'Urdu-W':          { pages: 15, questions: 6, test: 30 },
    'Maths':           { pages: 15, questions: 6, test: 40 },
    'Gen. Science':    { pages: 12, questions: 6, test: 40 },
    'Soc. Studies':    { pages: 10, questions: 5, test: 35 },
    'Islamic Studies': { pages: 10, questions: 5, verses: 2, test: 30 },
    'Art':             { pages: 20, questions: 10, test: 30 },
    'Nazra':           { pages: 10, verses: 1, test: 20 },
    'Arabic':          { pages: 12, questions: 5, verses: 2, test: 30 },
    'Other':           { pages: 10, questions: 5, test: 30 }
  };

  // Ticks on the sheet → minutes compared with the plan.
  const TIME_BUCKETS = [
    { id: 'early10', label: 'Early 10+ min', delta: -10 },
    { id: 'early5',  label: 'Early 5 min',   delta: -5 },
    { id: 'ontime',  label: 'On time',       delta: 0 },
    { id: 'plus10',  label: '+10 min',       delta: 10 },
    { id: 'plus20',  label: '+20 min',       delta: 20 },
    { id: 'plus30',  label: '+30 min or more', delta: 30 }
  ];
  const STATUS = [
    { id: 'done', label: 'Done' }, { id: 'partly', label: 'Partly' }, { id: 'notdone', label: 'Not done' }
  ];
  const DIFFICULTY = [
    { id: 'easy', label: 'Easy' }, { id: 'ok', label: 'OK' }, { id: 'hard', label: 'Hard' }
  ];
  const FOCUS = [
    { id: 'good', label: 'Good' }, { id: 'average', label: 'Average' }, { id: 'poor', label: 'Poor' }
  ];
  const LATE_REASONS = [
    { id: 'understand', label: "Didn't understand" },
    { id: 'toolong', label: 'Too long' },
    { id: 'distracted', label: 'Distracted' },
    { id: 'breaklong', label: 'Break ran long' },
    { id: 'tired', label: 'Tired' },
    { id: 'interrupted', label: 'Interrupted' }
  ];

  // ---------- time helpers ----------
  function toMin(hhmm) {
    if (typeof hhmm === 'number') return hhmm;
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim());
    if (!m) return NaN;
    return Number(m[1]) * 60 + Number(m[2]);
  }
  function toHHMM(min) {
    min = Math.round(min);
    const h = Math.floor(((min % 1440) + 1440) % 1440 / 60);
    const m = ((min % 60) + 60) % 60;
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
  }
  function to12h(min) {
    const t = toHHMM(min).split(':').map(Number);
    const h = t[0] % 12 === 0 ? 12 : t[0] % 12;
    return h + ':' + String(t[1]).padStart(2, '0');
  }
  function round5(n) { return Math.max(0, Math.round(n / 5) * 5); }

  // ---------- estimates ----------
  function rateFor(rates, subject, type) {
    const r = rates && rates[subject] && rates[subject][type];
    if (typeof r === 'number' && r > 0) return r;
    const d = DEFAULT_RATES[subject] && DEFAULT_RATES[subject][type];
    if (typeof d === 'number') return d;
    return TASK_TYPES[type] ? TASK_TYPES[type].defaultRate : 10;
  }

  /** Planned minutes for one task (rounded to 5, at least 5). */
  function estimate(task, rates) {
    if (task.override && task.override > 0) return round5(task.override) || 5;
    const units = Math.max(0, Number(task.units) || 0);
    if (task.type === 'minutes') return Math.max(5, round5(units || 15));
    if (!units) return Math.max(5, round5(rateFor(rates, task.subject, task.type)));
    return Math.max(5, round5(rateFor(rates, task.subject, task.type) * units));
  }

  // ---------- suggested order ----------
  /** Test first, then due tomorrow, then subjects she tends to move up, then bigger tasks first. */
  function suggestOrder(tasks, subjectScore, rates) {
    const score = subjectScore || {};
    return tasks.slice().sort(function (a, b) {
      if (!!b.test - !!a.test) return !!b.test - !!a.test;
      if (!!b.dueTomorrow - !!a.dueTomorrow) return !!b.dueTomorrow - !!a.dueTomorrow;
      const sa = score[a.subject] || 0, sb = score[b.subject] || 0;
      if (Math.abs(sb - sa) > 0.01) return sb - sa;
      return estimate(b, rates) - estimate(a, rates);
    });
  }

  // ---------- the schedule ----------
  /**
   * Lay tasks out from the start time into study blocks with breaks, then a buffer.
   * tasks: ordered list, each with .minutes (planned).
   * Returns timeline items and the summary numbers.
   */
  function buildPlan(tasks, settings, opts) {
    const s = Object.assign({}, DEFAULT_SETTINGS, settings || {});
    opts = opts || {};
    const start = toMin(opts.start || s.studyStart);
    const finish = toMin(s.finishLine);
    const blockMin = Math.max(10, Number(s.blockMin) || 30);
    const items = [];
    let cursor = start;
    let inBlock = 0;
    let blocks = 0;
    let workMin = 0;
    let breakTotal = 0;

    const list = tasks.filter(function (t) { return (t.minutes || 0) > 0; });
    list.forEach(function (t, idx) {
      let remaining = t.minutes;
      let part = 1;
      while (remaining > 0) {
        let take = Math.min(blockMin - inBlock, remaining);
        // Don't cut a task for a break when only a little (≤10 min) would be left over; finish it first.
        if (remaining - take > 0 && remaining - take <= 10) take = remaining;
        // Don't start a task with under 10 min of block left — take the break first.
        if (take < 10 && take < remaining && inBlock > 0 && idx > 0 && part === 1) {
          blocks += 1;
          const isLong0 = blocks % (Number(s.blocksBeforeLong) || 3) === 0;
          const len0 = isLong0 ? Number(s.longBreakMin) : Number(s.breakMin);
          items.push({ kind: 'break', long: isLong0, start: cursor, end: cursor + len0, minutes: len0 });
          cursor += len0; breakTotal += len0; inBlock = 0;
          take = Math.min(blockMin, remaining);
          if (remaining - take > 0 && remaining - take <= 10) take = remaining;
        }
        items.push({
          kind: 'task', taskId: t.id, part: part, start: cursor, end: cursor + take, minutes: take
        });
        cursor += take; remaining -= take; inBlock += take; workMin += take;
        const moreWork = remaining > 0 || idx < list.length - 1;
        if (inBlock >= blockMin && moreWork) {
          blocks += 1;
          const isLong = blocks % (Number(s.blocksBeforeLong) || 3) === 0;
          const len = isLong ? Number(s.longBreakMin) : Number(s.breakMin);
          items.push({ kind: 'break', long: isLong, start: cursor, end: cursor + len, minutes: len });
          cursor += len; breakTotal += len; inBlock = 0;
        }
        if (remaining > 0) part += 1;
      }
    });

    // Mark tasks that were split across a break so the sheet can say "part 1/2".
    const parts = {};
    items.forEach(function (it) { if (it.kind === 'task') parts[it.taskId] = Math.max(parts[it.taskId] || 0, it.part); });
    items.forEach(function (it) { if (it.kind === 'task') it.parts = parts[it.taskId]; });

    let revision = null;
    if (opts.revision && opts.revision.minutes > 0) {
      if (inBlock > 0 && workMin > 0) {
        items.push({ kind: 'break', long: false, start: cursor, end: cursor + Number(s.breakMin), minutes: Number(s.breakMin) });
        cursor += Number(s.breakMin); breakTotal += Number(s.breakMin);
      }
      revision = { kind: 'revision', start: cursor, end: cursor + opts.revision.minutes, minutes: opts.revision.minutes, topic: opts.revision.topic || '' };
      items.push(revision);
      cursor += opts.revision.minutes;
    }

    const bufferMin = workMin > 0 ? Math.max(5, round5(workMin * (Number(s.bufferPct) || 0) / 100)) : 0;
    if (bufferMin) {
      items.push({ kind: 'buffer', start: cursor, end: cursor + bufferMin, minutes: bufferMin });
      cursor += bufferMin;
    }
    const end = cursor;
    return {
      items: items,
      start: start,
      end: end,
      finishLine: finish,
      workMin: workMin,
      breakMin: breakTotal,
      bufferMin: bufferMin,
      fits: end <= finish,
      overMin: Math.max(0, end - finish),
      spareMin: Math.max(0, finish - end),
      blocks: blocks
    };
  }

  /** Light day: if lots of time is left, offer a revision block (30–45 min). */
  function revisionSuggestion(plan, settings) {
    const s = Object.assign({}, DEFAULT_SETTINGS, settings || {});
    const base = Number(s.revisionMin) || 30;
    if (!plan.fits) return 0;
    if (plan.spareMin >= 90) return Math.max(base, 45);
    if (plan.spareMin >= base + 30) return base;
    return 0;
  }

  /** Morning slot for overflow: ends at the normal school wake-up time. */
  function morningPlan(minutes, settings) {
    const s = Object.assign({}, DEFAULT_SETTINGS, settings || {});
    const wakeNormal = toMin(s.schoolWake);
    const earliest = toMin(s.earliestWake);
    const capacity = Math.max(0, wakeNormal - earliest);
    const total = round5(minutes);
    const wake = wakeNormal - total;
    return { minutes: total, wake: wake, capacity: capacity, fits: total <= capacity, overMin: Math.max(0, total - capacity) };
  }

  /** Lowest-priority task: not a test, not due tomorrow, last in her order. */
  function lowestPriority(tasks) {
    const pool = tasks.filter(function (t) { return !t.test && !t.dueTomorrow; });
    const from = pool.length ? pool : tasks;
    return from.length ? from[from.length - 1] : null;
  }

  // ---------- learning (plain code) ----------
  function bucketDelta(id) {
    const b = TIME_BUCKETS.find(function (x) { return x.id === id; });
    return b ? b.delta : null;
  }

  /** Should this task's result teach the time model? Returns reason string if skipped. */
  function skipReason(task, fb) {
    if (!fb || !fb.status) return 'no feedback';
    if (task.exam) return 'exam revision (kept separate)';
    if (fb.status !== 'done') return 'not fully done';
    if ((fb.reasons || []).indexOf('interrupted') >= 0) return 'interrupted';
    if (task.override) return 'time was set by hand';
    if (RATE_TYPES.indexOf(task.type) < 0) return 'no unit';
    if (!(Number(task.units) > 0) && task.type !== 'test') return 'no units';
    const d = bucketDelta(fb.time);
    if (d === null) return 'no time tick';
    if (d < 0 && fb.difficulty === 'hard') return 'possibly rushed';
    return '';
  }

  /**
   * Update per-unit rates from one day of feedback.
   * rates: {subject:{type:minPerUnit}}, samples: {"subject|type":[{date,perUnit}]}
   * Returns {rates, samples, changes:[...]} (new objects).
   */
  function learnFromDay(day, rates, samples) {
    rates = JSON.parse(JSON.stringify(rates || {}));
    samples = JSON.parse(JSON.stringify(samples || {}));
    const changes = [];
    if (!day || day.pause) return { rates: rates, samples: samples, changes: changes };
    (day.tasks || []).forEach(function (task) {
      const fb = (day.feedback && day.feedback.tasks && day.feedback.tasks[task.id]) || null;
      if (skipReason(task, fb)) return;
      const units = task.type === 'test' ? Math.max(1, Number(task.units) || 1) : Number(task.units);
      const planned = task.minutes || estimate(task, rates);
      const actual = Math.max(1, planned + bucketDelta(fb.time));
      const key = task.subject + '|' + task.type;
      const list = (samples[key] || []).concat([{ date: day.date, perUnit: actual / units }]).slice(-7);
      samples[key] = list;
      // Weighted average: most recent day counts most.
      let wSum = 0, vSum = 0;
      list.forEach(function (sm, i) { const w = i + 1; wSum += w; vSum += w * sm.perUnit; });
      const avg = vSum / wSum;
      const old = rateFor(rates, task.subject, task.type);
      // At most ~10 minutes change per day for a task of this size.
      const maxStep = 10 / units;
      let next = Math.min(old + maxStep, Math.max(old - maxStep, avg));
      next = Math.round(next * 100) / 100;
      if (!rates[task.subject]) rates[task.subject] = {};
      rates[task.subject][task.type] = next;
      if (Math.abs(next - old) >= 0.01) changes.push({ subject: task.subject, type: task.type, from: old, to: next });
    });
    return { rates: rates, samples: samples, changes: changes };
  }

  /** Learn subject order from her drag changes and from late/poor-focus subjects placed late. */
  function learnOrder(suggestedIds, finalIds, tasks, feedback, subjectScore) {
    const score = Object.assign({}, subjectScore || {});
    const byId = {};
    tasks.forEach(function (t) { byId[t.id] = t; });
    Object.keys(score).forEach(function (k) { score[k] = score[k] * 0.85; });
    finalIds.forEach(function (id, fi) {
      const si = suggestedIds.indexOf(id);
      const t = byId[id];
      if (!t || si < 0) return;
      score[t.subject] = (score[t.subject] || 0) + (si - fi) * 0.5;
    });
    if (feedback && feedback.tasks) {
      const n = finalIds.length;
      finalIds.forEach(function (id, fi) {
        const fb = feedback.tasks[id];
        const t = byId[id];
        if (!fb || !t) return;
        const late = (bucketDelta(fb.time) || 0) > 0;
        if (n >= 3 && fi >= Math.floor(n * 2 / 3) && (fb.focus === 'poor' || late)) {
          score[t.subject] = (score[t.subject] || 0) + 0.4;
        }
      });
    }
    Object.keys(score).forEach(function (k) { score[k] = Math.round(score[k] * 100) / 100; });
    return score;
  }

  function sameOrder(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  // ---------- weekly summary for the parent view ----------
  function summarize(days, settings) {
    const s = Object.assign({}, DEFAULT_SETTINGS, settings || {});
    const fin = toMin(s.finishLine);
    const real = days.filter(function (d) { return !d.pause && d.feedback && d.feedback.saved; });
    const out = {
      days: real.length,
      beforeLine: 0, noMorning: 0, tvMin: 0,
      avgStart: null, avgFinish: null, avgSleep: null,
      overrun: {}, reasons: {}, help: [], hard: []
    };
    const starts = [], finishes = [], sleeps = [];
    real.forEach(function (d) {
      const f = d.feedback;
      const fm = toMin(f.finish);
      if (!isNaN(fm)) { finishes.push(fm); if (fm <= fin) out.beforeLine += 1; }
      const st = toMin(f.start); if (!isNaN(st)) starts.push(st);
      let sl = toMin(f.sleep); if (!isNaN(sl)) { if (sl < 12 * 60) sl += 1440; sleeps.push(sl); }
      if (!(d.morning && d.morning.taskIds && d.morning.taskIds.length)) out.noMorning += 1;
      out.tvMin += (Number(f.tvBoxes) || 0) * 15;
      if (f.hardNote) out.hard.push({ date: d.date, text: f.hardNote });
      (d.tasks || []).forEach(function (t) {
        const tf = f.tasks && f.tasks[t.id];
        if (!tf) return;
        if ((bucketDelta(tf.time) || 0) > 0) out.overrun[t.subject] = (out.overrun[t.subject] || 0) + 1;
        (tf.reasons || []).forEach(function (r) { out.reasons[r] = (out.reasons[r] || 0) + 1; });
        if (tf.help) out.help.push({ date: d.date, subject: t.subject, note: t.note || '' });
      });
    });
    function avg(a) { return a.length ? Math.round(a.reduce(function (x, y) { return x + y; }, 0) / a.length) : null; }
    out.avgStart = avg(starts); out.avgFinish = avg(finishes); out.avgSleep = avg(sleeps);
    return out;
  }

  /** Topics to suggest for a revision block: recent Hard / Didn't understand / Need help. */
  function revisionTopics(days, limit) {
    const seen = {};
    const out = [];
    days.slice().reverse().forEach(function (d) {
      if (!d.feedback || !d.feedback.tasks) return;
      (d.tasks || []).forEach(function (t) {
        const fb = d.feedback.tasks[t.id];
        if (!fb) return;
        const why = fb.help ? 'Need help' : (fb.reasons || []).indexOf('understand') >= 0 ? "Didn't understand" : fb.difficulty === 'hard' ? 'Hard' : '';
        if (!why) return;
        const label = t.subject + (t.note ? ' — ' + t.note : '');
        if (seen[label]) return;
        seen[label] = 1;
        out.push({ subject: t.subject, note: t.note || '', why: why, date: d.date, label: label });
      });
    });
    return out.slice(0, limit || 5);
  }

  /** Read "Ex 3.2 Q1–3", "p 12-15", "Q 4,5,7" style notes into a unit count (Phase 1 helper). */
  function guessUnits(note) {
    if (!note) return null;
    const s = String(note).replace(/[–—]/g, '-');
    let m = /(?:\bq(?:uestions?)?|\bqs?)\s*\.?\s*(\d+)\s*-\s*(\d+)/i.exec(s);
    if (m) return { type: 'questions', units: Math.abs(Number(m[2]) - Number(m[1])) + 1 };
    m = /(?:\bp(?:ages?|g|p)?)\s*\.?\s*(\d+)\s*-\s*(\d+)/i.exec(s);
    if (m) return { type: 'pages', units: Math.abs(Number(m[2]) - Number(m[1])) + 1 };
    m = /(?:\bverses?|\bayat|\bayah)\s*\.?\s*(\d+)\s*-\s*(\d+)/i.exec(s);
    if (m) return { type: 'verses', units: Math.abs(Number(m[2]) - Number(m[1])) + 1 };
    m = /(?:\bq(?:uestions?)?|\bqs?)\s*\.?\s*((?:\d+\s*,\s*)+\d+)/i.exec(s);
    if (m) return { type: 'questions', units: m[1].split(',').length };
    if (/\btest\b/i.test(s)) return { type: 'test', units: 1, test: true };
    return null;
  }


  // ---------- Phase 4: weekend mode ----------
  function addDays(dateStr, n) {
    const p = dateStr.split('-').map(Number);
    const d = new Date(Date.UTC(p[0], p[1] - 1, p[2] + n));
    return d.toISOString().slice(0, 10);
  }
  function weekdayOf(dateStr) {
    const p = dateStr.split('-').map(Number);
    return new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay(); // 0 Sun … 6 Sat
  }
  /** Usable study minutes in a window, allowing for breaks and spare time (~80%). */
  function windowCapacity(start, end) { return Math.max(0, Math.round((toMin(end) - toMin(start)) * 0.8)); }

  /**
   * Spread Friday's diary over Friday evening, Saturday and Sunday.
   * tasks: in her order, each with .minutes. Tests (for Monday) go to Sunday as revision.
   * Uses only as much of the weekend as the work needs; Sunday is kept lighter.
   * Returns {fri:[ids], sat:[ids], sun:[ids], minutes:{fri,sat,sun}}.
   */
  function weekendSplit(tasks, settings) {
    const s = Object.assign({}, DEFAULT_SETTINGS, { weekendStart: '14:00', weekendEnd: '19:00' }, settings || {});
    const friCap = windowCapacity(s.studyStart, s.finishLine);
    const dayCap = windowCapacity(s.weekendStart, s.weekendEnd);
    const out = { fri: [], sat: [], sun: [], minutes: { fri: 0, sat: 0, sun: 0 } };
    function put(slot, t) { out[slot].push(t.id); out.minutes[slot] += t.minutes; }
    const tests = tasks.filter(function (t) { return t.test; });
    const rest = tasks.filter(function (t) { return !t.test; });
    tests.forEach(function (t) { put('sun', t); });
    const total = rest.reduce(function (a, t) { return a + t.minutes; }, 0);
    if (total <= 60) { rest.forEach(function (t) { put('fri', t); }); return out; }
    // Targets: Friday ~40%, Saturday the bulk, Sunday lighter (tests already count toward Sunday).
    const friTarget = Math.min(friCap, Math.round(total * 0.4));
    const sunTarget = Math.max(0, Math.round(total * 0.2) - out.minutes.sun);
    const satTarget = Math.min(dayCap, total - friTarget - sunTarget);
    rest.forEach(function (t) {
      if (out.minutes.fri === 0 || out.minutes.fri + t.minutes <= friTarget) put('fri', t);
      else if (out.minutes.sat === 0 || out.minutes.sat + t.minutes <= satTarget) put('sat', t);
      else if (out.minutes.sun + t.minutes <= dayCap) put('sun', t);
      else if (out.minutes.sat + t.minutes <= dayCap) put('sat', t);
      else put('fri', t);
    });
    return out;
  }

  // ---------- Phase 4: exam mode ----------
  const EXAM_LEVEL = { easy: 1, ok: 2, hard: 3 };
  function daysBetween(a, b) {
    const pa = a.split('-').map(Number), pb = b.split('-').map(Number);
    return Math.round((Date.UTC(pb[0], pb[1] - 1, pb[2]) - Date.UTC(pa[0], pa[1] - 1, pa[2])) / 86400000);
  }
  /** Is exam mode on for this date? On from the start date until the last paper. */
  function examActive(exam, dateStr) {
    if (!exam || !exam.papers || !exam.papers.length) return false;
    const last = exam.papers.map(function (p) { return p.date; }).sort().slice(-1)[0];
    const start = exam.start || exam.papers.map(function (p) { return p.date; }).sort()[0];
    return dateStr >= start && dateStr <= last;
  }
  /**
   * Revision plan for one day: share the free minutes among upcoming papers.
   * Harder papers and nearer papers get more time; at most 3 papers a day, at least 20 min each.
   */
  function examPlan(exam, dateStr, freeMinutes) {
    if (!exam || !exam.papers) return [];
    const upcoming = exam.papers.filter(function (p) { return p.date > dateStr; })
      .map(function (p) {
        const days = Math.max(1, daysBetween(dateStr, p.date));
        return Object.assign({}, p, { days: days, weight: (EXAM_LEVEL[p.level] || 2) / Math.sqrt(days) });
      })
      .sort(function (a, b) { return b.weight - a.weight; })
      .slice(0, 3);
    const budget = Math.max(0, freeMinutes);
    if (!upcoming.length || budget < 20) return [];
    const wSum = upcoming.reduce(function (a, p) { return a + p.weight; }, 0);
    let plan = upcoming.map(function (p) {
      return { paperId: p.id, subject: p.subject, date: p.date, level: p.level || 'ok', days: p.days, minutes: round5(budget * p.weight / wSum) };
    }).filter(function (x) { return x.minutes >= 20; });
    if (!plan.length) plan = [{ paperId: upcoming[0].id, subject: upcoming[0].subject, date: upcoming[0].date, level: upcoming[0].level || 'ok', days: upcoming[0].days, minutes: round5(budget) }];
    return plan.sort(function (a, b) { return a.date < b.date ? -1 : 1; });
  }

  // ---------- Phase 4: alerts (real problems only) ----------
  function alerts(days, settings) {
    const s = Object.assign({}, DEFAULT_SETTINGS, settings || {});
    const saved = days.filter(function (d) { return !d.pause && d.feedback && d.feedback.saved; })
      .sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    const out = [];
    function lineFor(d) { return toMin((d.different && d.different.finishLine) || s.finishLine); }
    const last3 = saved.slice(-3);
    if (last3.length === 3 && last3.every(function (d) { const f = toMin(d.feedback.finish); return !isNaN(f) && f > lineFor(d); })) {
      out.push({ kind: 'late', key: 'late-' + last3[2].date, text: '3 days in a row past the finish line (' + last3.map(function (d) { return d.date.slice(5); }).join(', ') + ').' });
    }
    const recent = saved.slice(-10);
    const count = {};
    recent.forEach(function (d) {
      (d.tasks || []).forEach(function (t) {
        const fb = d.feedback.tasks && d.feedback.tasks[t.id];
        if (fb && ((fb.reasons || []).indexOf('understand') >= 0 || fb.help)) count[t.subject] = (count[t.subject] || 0) + 1;
      });
    });
    Object.keys(count).forEach(function (sub) {
      if (count[sub] >= 3) out.push({ kind: 'understand', key: 'understand-' + sub + '-' + (recent.length ? recent[recent.length - 1].date : ''), text: sub + ': marked "Didn\'t understand" or "Need help" ' + count[sub] + ' times in the last ' + recent.length + ' school days.' });
    });
    const morning = recent.slice(-5).filter(function (d) { return d.morning && d.morning.taskIds && d.morning.taskIds.length; });
    if (morning.length >= 3) out.push({ kind: 'morning', key: 'morning-' + morning[morning.length - 1].date, text: 'Morning catch-up needed on ' + morning.length + ' of the last 5 school days.' });
    return out;
  }


  // ---------- Phase 3: adaptive study blocks ----------
  /**
   * Once a week at most: focus mostly "Good" → block +5 min (up to 45); often "Poor" → −5 min (down to 20).
   * Needs at least 5 school days with ticks in the last 7 days. Returns {blockMin, reason} or null.
   */
  function adaptBlock(days, settings, lastAdjust, today) {
    const s = Object.assign({}, DEFAULT_SETTINGS, settings || {});
    if (lastAdjust && daysBetween(lastAdjust, today) < 7) return null;
    const from = addDays(today, -6);
    const recent = days.filter(function (d) { return d.date >= from && d.date <= today && !d.pause && d.feedback && d.feedback.saved; });
    if (recent.length < 5) return null;
    const c = { good: 0, average: 0, poor: 0 };
    recent.forEach(function (d) {
      (d.tasks || []).forEach(function (t) {
        const fb = d.feedback.tasks && d.feedback.tasks[t.id];
        if (fb && c[fb.focus] != null) c[fb.focus] += 1;
      });
    });
    const n = c.good + c.average + c.poor;
    if (n < 5) return null;
    const cur = Number(s.blockMin) || 30;
    if (c.good / n >= 0.7 && cur < 45) return { blockMin: Math.min(45, cur + 5), reason: 'focus was mostly Good (' + c.good + ' of ' + n + ')' };
    if (c.poor / n >= 0.3 && cur > 20) return { blockMin: Math.max(20, cur - 5), reason: 'focus was often Poor (' + c.poor + ' of ' + n + ')' };
    return null;
  }

  // ---------- Phase 3: daily tip (plain-code fallback) ----------
  function tipFromDay(day, settings) {
    const s = Object.assign({}, DEFAULT_SETTINGS, settings || {});
    const f = day && day.feedback;
    if (!f || !f.saved) return '';
    const line = toMin((day.different && day.different.finishLine) || s.finishLine);
    const fin = toMin(f.finish);
    const reasons = {};
    let help = '', poorLast = '';
    (day.tasks || []).forEach(function (t, i) {
      const fb = f.tasks && f.tasks[t.id];
      if (!fb) return;
      (fb.reasons || []).forEach(function (r) { reasons[r] = (reasons[r] || 0) + 1; });
      if (fb.help && !help) help = t.subject;
      if (fb.focus === 'poor' && i >= (day.tasks.length - 2)) poorLast = t.subject;
    });
    const top = Object.keys(reasons).sort(function (a, b) { return reasons[b] - reasons[a]; })[0];
    if (help) return 'Ask for help with ' + help + ' before you start tomorrow, so it does not slow the rest down.';
    if (top === 'distracted') return 'Keep the phone and TV out of the room during study blocks tomorrow.';
    if (top === 'breaklong') return 'Use the desk timer for breaks too — start the next block when it rings.';
    if (top === 'tired') return 'Try your hardest subject first tomorrow, while you are fresh.';
    if (top === 'understand') return 'Mark the parts you did not understand and ask your teacher tomorrow.';
    if (poorLast) return 'Your focus dropped at the end. Try moving ' + poorLast + ' earlier tomorrow.';
    if (!isNaN(fin) && fin <= line) return 'You finished before the line — keep the same order tomorrow.';
    if (!isNaN(fin) && fin > line) return 'Start right at ' + to12h(toMin(s.studyStart)) + ' tomorrow; a 10-minute earlier start often means finishing on time.';
    return 'Same plan tomorrow: one task at a time, timer on.';
  }

  /** Handwritten time from the sheet ("3:35", "7.10", "10") → "HH:MM" (afternoon/evening for start and finish; night for sleep). */
  function handTime(str, kind) {
    const m = /(\d{1,2})\s*[:.\s]?\s*(\d{2})?/.exec(String(str || ''));
    if (!m) return '';
    let h = Number(m[1]); const mm = m[2] ? Number(m[2]) : 0;
    if (h > 23 || mm > 59) return '';
    if (kind === 'sleep') { if (h >= 6 && h <= 11) h += 12; else if (h === 12) h = 0; }
    else if (h >= 1 && h <= 11) h += 12;
    return String(h).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
  }

  const api = {
    SUBJECTS: SUBJECTS, TASK_TYPES: TASK_TYPES, DEFAULT_RATES: DEFAULT_RATES, RATE_TYPES: RATE_TYPES, DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    TIME_BUCKETS: TIME_BUCKETS, STATUS: STATUS, DIFFICULTY: DIFFICULTY, FOCUS: FOCUS, LATE_REASONS: LATE_REASONS,
    toMin: toMin, toHHMM: toHHMM, to12h: to12h, round5: round5,
    rateFor: rateFor, estimate: estimate, suggestOrder: suggestOrder, buildPlan: buildPlan,
    revisionSuggestion: revisionSuggestion, morningPlan: morningPlan, lowestPriority: lowestPriority,
    skipReason: skipReason, learnFromDay: learnFromDay, learnOrder: learnOrder, sameOrder: sameOrder,
    summarize: summarize, revisionTopics: revisionTopics, guessUnits: guessUnits, bucketDelta: bucketDelta,
    addDays: addDays, weekdayOf: weekdayOf, weekendSplit: weekendSplit, examActive: examActive, examPlan: examPlan, alerts: alerts, daysBetween: daysBetween,
    adaptBlock: adaptBlock, tipFromDay: tipFromDay, handTime: handTime
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Planner = api;
})(typeof window !== 'undefined' ? window : this);
