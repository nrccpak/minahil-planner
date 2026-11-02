/**
 * Minahil's Planner — weekly report and alerts (Google Apps Script).
 * Reads the family's planner data from Supabase and emails the father:
 *   - every Sunday evening: the weekly summary
 *   - every night: an alert, only when a real problem shows up (sent once per problem)
 *
 * One-time setup (Project Settings → Script properties):
 *   SUPABASE_KEY = the project's secret key (Supabase → Project Settings → API Keys → Secret keys)
 *   REPORT_TO    = the email address that receives the reports
 * Then run setup() once and allow the permissions.
 *
 * Needs the file planner.gs (the app's planner.js, unchanged) in the same project.
 */
var SUPABASE_URL = 'https://ejiatkzbqbxclpsigoaf.supabase.co';
var APP_URL = 'https://nrccpak.github.io/minahil-planner/';

function cfg_() {
  var p = PropertiesService.getScriptProperties();
  var key = p.getProperty('SUPABASE_KEY');
  var to = p.getProperty('REPORT_TO');
  if (!key || !to) throw new Error('Add SUPABASE_KEY and REPORT_TO in Project Settings → Script properties.');
  return { key: key, to: to };
}

function rest_(path) {
  var c = cfg_();
  var res = UrlFetchApp.fetch(SUPABASE_URL + '/rest/v1/' + path, {
    headers: { apikey: c.key }, // new Supabase secret keys go only in the apikey header
    muteHttpExceptions: true
  });
  if (res.getResponseCode() >= 300) throw new Error('Supabase ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 200));
  return JSON.parse(res.getContentText());
}

function today_() { return Utilities.formatDate(new Date(), 'Asia/Karachi', 'yyyy-MM-dd'); }

function loadSettings_() {
  var rows = rest_('app_kv?select=value&key=eq.settings&limit=1');
  return rows.length ? rows[0].value : {};
}
function loadDays_(from, to) {
  var rows = rest_('days?select=date,doc&date=gte.' + from + '&date=lte.' + to + '&order=date.asc');
  return rows.map(function (r) { return r.doc; });
}

// ---------- formatting ----------
function t12_(min) { return min == null ? '–' : Planner.to12h(min); }
function esc_(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
function dayName_(date) { var p = date.split('-'); return Utilities.formatDate(new Date(+p[0], +p[1] - 1, +p[2], 12), 'Asia/Karachi', 'EEE d MMM'); }
function hrs_(min) { var h = Math.floor(min / 60), m = Math.round(min % 60); return h + ' h' + (m ? ' ' + m + ' min' : ''); }

function section_(title, body) {
  return '<h3 style="font:600 15px/1.3 Arial,sans-serif;margin:18px 0 6px;color:#172036">' + title + '</h3>' + body;
}
function table_(rows) {
  return '<table style="border-collapse:collapse;font:14px/1.4 Arial,sans-serif">' + rows.map(function (r) {
    return '<tr><td style="padding:4px 12px 4px 0;color:#4A5572">' + r[0] + '</td><td style="padding:4px 0;font-weight:bold">' + r[1] + '</td></tr>';
  }).join('') + '</table>';
}

/** Build the weekly report (numbers come from the same code the app uses). */
function buildWeekly_(endDate) {
  var start = Planner.addDays(endDate, -6);
  var settings = Object.assign({}, Planner.DEFAULT_SETTINGS, loadSettings_());
  var days = loadDays_(start, endDate);
  var sum = Planner.summarize(days, settings);
  var reasonLabel = {}; Planner.LATE_REASONS.forEach(function (r) { reasonLabel[r.id] = r.label; });
  var school = days.filter(function (d) { return !d.pause && d.feedback && d.feedback.saved; });
  var paused = days.filter(function (d) { return d.pause; }).length;
  var orderChanged = days.filter(function (d) { return d.orderChanged; }).length;

  var wake = Planner.toMin(settings.schoolWake) + 1440;
  var sleepHours = sum.avgSleep != null ? hrs_(wake - sum.avgSleep) : '–';

  function topList(obj, labels) {
    var arr = Object.keys(obj).map(function (k) { return [k, obj[k]]; }).sort(function (a, b) { return b[1] - a[1]; });
    return arr.length ? arr.map(function (x) { return esc_(labels ? (labels[x[0]] || x[0]) : x[0]) + ' (' + x[1] + ')'; }).join(', ') : 'None';
  }
  var focus = { good: 0, average: 0, poor: 0 };
  school.forEach(function (d) { Object.keys(d.feedback.tasks || {}).forEach(function (k) { var f = d.feedback.tasks[k].focus; if (focus[f] != null) focus[f]++; }); });

  var tvRows = school.map(function (d) { return [dayName_(d.date), ((d.feedback.tvBoxes || 0) * 15) + ' min']; });

  var headline = sum.days
    ? (sum.noMorning + ' of ' + sum.days + ' school days with no morning catch-up · finished by the line on ' + sum.beforeLine + ' of ' + sum.days)
    : 'No evening ticks were saved this week.';

  var html = '<div style="max-width:560px;font:14px/1.5 Arial,sans-serif;color:#172036">' +
    '<p style="font:700 20px/1.2 Arial,sans-serif;margin:0 0 4px">Minahil’s week</p>' +
    '<p style="color:#4A5572;margin:0 0 12px">' + dayName_(start) + ' – ' + dayName_(endDate) + '</p>' +
    '<p style="background:#E3E9FA;padding:10px 12px;border-radius:8px;margin:0">' + headline + '</p>' +
    section_('Times', table_([
      ['Average start', t12_(sum.avgStart)],
      ['Average finish', t12_(sum.avgFinish) + ' (line ' + Planner.to12h(Planner.toMin(settings.finishLine)) + ')'],
      ['Average sleep time', t12_(sum.avgSleep)],
      ['Average sleep', sleepHours + ' (to ' + Planner.to12h(Planner.toMin(settings.schoolWake)) + ' wake-up)'],
      ['Paused days', String(paused)]
    ])) +
    section_('Patterns', table_([
      ['Subjects running over', topList(sum.overrun)],
      ['Delay reasons', topList(sum.reasons, reasonLabel)],
      ['Focus ticks', 'Good ' + focus.good + ' · Average ' + focus.average + ' · Poor ' + focus.poor],
      ['Changed the suggested order', orderChanged + ' day' + (orderChanged === 1 ? '' : 's')]
    ])) +
    section_('Need help', sum.help.length ? '<ul>' + sum.help.map(function (h) { return '<li>' + esc_(h.subject) + (h.note ? ' — ' + esc_(h.note) : '') + ' (' + dayName_(h.date) + ')</li>'; }).join('') + '</ul>' : '<p>None this week.</p>') +
    section_('What was hard', sum.hard.length ? '<ul>' + sum.hard.map(function (h) { return '<li>' + dayName_(h.date) + ': ' + esc_(h.text) + '</li>'; }).join('') + '</ul>' : '<p>Nothing written.</p>') +
    section_('TV', '<p>' + hrs_(sum.tvMin) + ' this week</p>' + (tvRows.length ? table_(tvRows) : '')) +
    '<p style="margin-top:20px;color:#4A5572;font-size:12px">From Minahil’s Planner · <a href="' + APP_URL + '">open the app</a></p></div>';
  return { subject: 'Minahil’s week: ' + (sum.days ? sum.beforeLine + '/' + sum.days + ' by 7:30' : 'no ticks saved'), html: html };
}

/** Sunday evening: send the weekly summary. */
function sendWeeklyReport() {
  var r = buildWeekly_(today_());
  MailApp.sendEmail({ to: cfg_().to, subject: r.subject, htmlBody: r.html, name: 'Minahil’s Planner' });
}

/** Every night: email only new real problems (each problem is sent once). */
function checkAlerts() {
  var end = today_();
  var settings = Object.assign({}, Planner.DEFAULT_SETTINGS, loadSettings_());
  var days = loadDays_(Planner.addDays(end, -20), end);
  var list = Planner.alerts(days, settings);
  var props = PropertiesService.getScriptProperties();
  var sent = JSON.parse(props.getProperty('SENT_ALERTS') || '[]');
  var fresh = list.filter(function (a) { return sent.indexOf(a.key) < 0; });
  if (!fresh.length) return;
  var html = '<div style="font:14px/1.5 Arial,sans-serif;color:#172036"><p><b>Minahil’s Planner needs your attention:</b></p><ul>' +
    fresh.map(function (a) { return '<li>' + esc_(a.text) + '</li>'; }).join('') + '</ul>' +
    '<p style="color:#4A5572;font-size:12px"><a href="' + APP_URL + '">Open the app</a> → Parent tab for details.</p></div>';
  MailApp.sendEmail({ to: cfg_().to, subject: 'Planner alert: ' + fresh[0].text.slice(0, 60), htmlBody: html, name: 'Minahil’s Planner' });
  props.setProperty('SENT_ALERTS', JSON.stringify(sent.concat(fresh.map(function (a) { return a.key; })).slice(-100)));
}

/** Run once: checks the connection, sends a test report, and sets the schedule. */
function setup() {
  cfg_();
  rest_('app_kv?select=key&limit=1'); // fails clearly if the key is wrong
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('sendWeeklyReport').timeBased().onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(20).nearMinute(0).inTimezone('Asia/Karachi').create();
  ScriptApp.newTrigger('checkAlerts').timeBased().everyDays(1).atHour(21).nearMinute(30).inTimezone('Asia/Karachi').create();
  var r = buildWeekly_(today_());
  MailApp.sendEmail({ to: cfg_().to, subject: '[Test] ' + r.subject, htmlBody: r.html, name: 'Minahil’s Planner' });
  Logger.log('Done: weekly report Sundays ~8 pm, alert check daily ~9:30 pm (Pakistan time). Test email sent.');
}
