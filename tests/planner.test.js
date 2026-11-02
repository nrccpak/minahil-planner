// Run: node tests/planner.test.js
const assert = require('assert');
const P = require('../planner.js');
let n = 0;
function t(name, fn) { fn(); n++; console.log('ok -', name); }

const S = P.DEFAULT_SETTINGS;
const rates = { Maths: { questions: 6, pages: 12 }, 'English-W': { pages: 15 }, Nazra: { verses: 1.5 } };

t('time helpers', () => {
  assert.equal(P.toMin('15:30'), 930);
  assert.equal(P.toHHMM(930), '15:30');
  assert.equal(P.to12h(P.toMin('19:30')), '7:30');
  assert.equal(P.to12h(P.toMin('12:05')), '12:05');
});

t('estimate uses per-unit rate, rounds to 5, min 5', () => {
  assert.equal(P.estimate({ subject: 'Maths', type: 'questions', units: 3 }, rates), 20); // 18 -> 20
  assert.equal(P.estimate({ subject: 'Nazra', type: 'verses', units: 2 }, rates), 5);
  assert.equal(P.estimate({ subject: 'Art', type: 'minutes', units: 25 }, rates), 25);
  assert.equal(P.estimate({ subject: 'Maths', type: 'questions', units: 3, override: 33 }, rates), 35);
  assert.equal(P.estimate({ subject: 'Urdu-R', type: 'pages', units: 6 }, {}), 60); // default 10/page
});

t('suggested order: test, due, then bigger', () => {
  const tasks = [
    { id: 'a', subject: 'Art', type: 'minutes', units: 20 },
    { id: 'b', subject: 'Maths', type: 'questions', units: 10 },
    { id: 'c', subject: 'Urdu-W', type: 'pages', units: 1, dueTomorrow: true },
    { id: 'd', subject: 'Gen. Science', type: 'test', units: 1, test: true }
  ];
  assert.deepEqual(P.suggestOrder(tasks, {}, rates).map(x => x.id), ['d', 'c', 'b', 'a']);
  // a subject she keeps moving up rises
  assert.deepEqual(P.suggestOrder(tasks, { Art: 3 }, rates).map(x => x.id), ['d', 'c', 'a', 'b']);
});

t('plan: blocks of 30 + 5 min breaks, 15 min after 3 blocks, buffer at end', () => {
  const tasks = [
    { id: 'a', minutes: 40 }, { id: 'b', minutes: 30 }, { id: 'c', minutes: 25 }, { id: 'd', minutes: 20 }
  ];
  const p = P.buildPlan(tasks, S);
  assert.equal(p.workMin, 115);
  const breaks = p.items.filter(i => i.kind === 'break');
  // work 115 → blocks end at 30, 60, 90 → 3 breaks: 5,5,15
  assert.deepEqual(breaks.map(b => b.minutes), [5, 5, 15]);
  assert.equal(p.bufferMin, 15); // 12% of 115 = 13.8 → 15
  assert.equal(p.end, P.toMin('15:30') + 115 + 25 + 15);
  assert.ok(p.fits);
  // a (40) is not cut for only 10 min left; d waits for the long break instead of starting with 5 min left
  assert.equal(p.items.filter(i => i.taskId === 'a').length, 1);
  assert.equal(p.items.filter(i => i.taskId === 'd').length, 1);
});

t('long task spans several blocks', () => {
  const p = P.buildPlan([{ id: 'a', minutes: 70 }], S);
  const a = p.items.filter(i => i.taskId === 'a');
  assert.equal(a.length, 2); assert.equal(a[0].parts, 2);
  assert.deepEqual(a.map(x => x.minutes), [30, 40]);
});

t('no break after the last piece of work', () => {
  const p = P.buildPlan([{ id: 'a', minutes: 30 }], S);
  assert.equal(p.items.filter(i => i.kind === 'break').length, 0);
  assert.equal(p.end, P.toMin('15:30') + 30 + 5);
});

t('overflow detected with minutes over the line', () => {
  const p = P.buildPlan([{ id: 'a', minutes: 240 }], S);
  assert.ok(!p.fits);
  assert.ok(p.overMin > 0);
});

t('revision suggested on light days only', () => {
  const light = P.buildPlan([{ id: 'a', minutes: 45 }], S);
  assert.equal(P.revisionSuggestion(light, S), 45); // lots of spare time
  const full = P.buildPlan([{ id: 'a', minutes: 180 }], S);
  assert.equal(P.revisionSuggestion(full, S), 0);
  const withRev = P.buildPlan([{ id: 'a', minutes: 45 }], S, { revision: { minutes: 30, topic: 'Maths' } });
  assert.equal(withRev.items.filter(i => i.kind === 'revision').length, 1);
  assert.ok(withRev.fits);
});

t('morning slot ends at school wake-up; capacity from earliest wake', () => {
  const m = P.morningPlan(40, S);
  assert.equal(P.toHHMM(m.wake), '05:50');
  assert.ok(m.fits);
  const big = P.morningPlan(120, S);
  assert.ok(!big.fits); assert.equal(big.overMin, 30);
});

t('lowest priority skips tests and due-tomorrow', () => {
  const tasks = [{ id: 'a' }, { id: 'b' }, { id: 'c', test: true }];
  assert.equal(P.lowestPriority(tasks).id, 'b');
});

t('learning: smart average moves toward actual, max ~10 min/day, skips bad days', () => {
  const day = {
    date: '2026-11-03',
    tasks: [
      { id: 'a', subject: 'Maths', type: 'questions', units: 3, minutes: 20 },
      { id: 'b', subject: 'English-W', type: 'pages', units: 2, minutes: 30 },
      { id: 'c', subject: 'Nazra', type: 'verses', units: 4, minutes: 5 },
      { id: 'd', subject: 'Urdu-R', type: 'pages', units: 2, minutes: 20 }
    ],
    feedback: { tasks: {
      a: { status: 'done', time: 'plus30', difficulty: 'ok' },      // 50 min for 3 q → 16.7/q, but max +10 min → +3.33/q
      b: { status: 'done', time: 'early10', difficulty: 'hard' },   // possibly rushed → skip
      c: { status: 'partly', time: 'ontime' },                      // partly → skip
      d: { status: 'done', time: 'plus10', reasons: ['interrupted'] } // interrupted → skip
    } }
  };
  const r = P.learnFromDay(day, rates, {});
  assert.equal(r.rates.Maths.questions, 9.33);
  assert.equal(r.rates['English-W'].pages, 15);
  assert.equal(r.rates.Nazra.verses, 1.5);
  assert.ok(!r.rates['Urdu-R']);
  assert.equal(r.changes.length, 1);
  // pause day learns nothing
  assert.equal(P.learnFromDay(Object.assign({}, day, { pause: true }), rates, {}).changes.length, 0);
});

t('learning: recent days weighted more, keeps last 7', () => {
  let rs = { Maths: { questions: 5 } }, sm = {};
  for (let i = 0; i < 9; i++) {
    const out = P.learnFromDay({ date: 'd' + i, tasks: [{ id: 'x', subject: 'Maths', type: 'questions', units: 4, minutes: 20 }],
      feedback: { tasks: { x: { status: 'done', time: 'plus10', difficulty: 'ok' } } } }, rs, sm);
    rs = out.rates; sm = out.samples;
  }
  assert.equal(sm['Maths|questions'].length, 7);
  assert.equal(rs.Maths.questions, 7.5); // 30 min / 4 q
});

t('order learning: moving a subject up raises its score; late+poor focus near end raises too', () => {
  const tasks = [{ id: 'a', subject: 'Maths' }, { id: 'b', subject: 'Art' }, { id: 'c', subject: 'Urdu-W' }];
  const sc = P.learnOrder(['a', 'b', 'c'], ['c', 'a', 'b'], tasks, null, {});
  assert.ok(sc['Urdu-W'] > 0 && sc.Maths < 0);
  const sc2 = P.learnOrder(['a', 'b', 'c'], ['a', 'b', 'c'], tasks, { tasks: { c: { focus: 'poor', time: 'ontime' } } }, {});
  assert.ok(sc2['Urdu-W'] > 0);
});

t('guessUnits reads common diary notes', () => {
  assert.deepEqual(P.guessUnits('Ex 3.2 Q1–3'), { type: 'questions', units: 3 });
  assert.deepEqual(P.guessUnits('p 12-15'), { type: 'pages', units: 4 });
  assert.deepEqual(P.guessUnits('Q 1, 4, 7'), { type: 'questions', units: 3 });
  assert.equal(P.guessUnits('Test of ch 2').test, true);
  assert.equal(P.guessUnits('اردو سبق'), null);
});

t('summary for parent view', () => {
  const days = [
    { date: '1', tasks: [{ id: 'a', subject: 'Maths' }], feedback: { saved: true, start: '15:35', finish: '19:10', sleep: '22:05', tvBoxes: 3,
      tasks: { a: { time: 'plus20', reasons: ['distracted'], help: true } } } },
    { date: '2', tasks: [], morning: { taskIds: ['x'] }, feedback: { saved: true, start: '15:40', finish: '19:50', sleep: '23:00', tvBoxes: 2, tasks: {} } },
    { date: '3', pause: true }
  ];
  const s = P.summarize(days, S);
  assert.equal(s.days, 2); assert.equal(s.beforeLine, 1); assert.equal(s.noMorning, 1);
  assert.equal(s.tvMin, 75); assert.equal(s.overrun.Maths, 1); assert.equal(s.help.length, 1);
  assert.equal(P.toHHMM(s.avgSleep), '22:33');
});

console.log(`\nAll ${n} tests passed.`);
