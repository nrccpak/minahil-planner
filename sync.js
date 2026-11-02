/* Cloud sync with Supabase (family account).
 * The phone stays the main copy and works offline. When signed in, every save is copied up,
 * and changes made on another phone are copied down. Whole days and settings are synced; newest save wins.
 */
(function (root) {
  'use strict';
  const SUPABASE_URL = 'https://ejiatkzbqbxclpsigoaf.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_qu1pqpjwKZld-3UrtrvLgA_vrVupMkk'; // public key; data is protected by row-level security
  const KV_KEYS = ['settings', 'meta', 'rates', 'samples', 'subjectScore', 'carry', 'pins', 'exam'];
  const MARGIN_MS = 24 * 3600 * 1000; // re-check a day of overlap so small clock differences never lose a change

  let client = null;
  let A = null;           // adapter supplied by the app
  let state = null;       // {lastPullDays, lastPullKv, pushedKv:{}, pushedDays:{}, photoQueue:[]}
  let user = null;
  let timer = null;
  let running = null;
  const status = { phase: 'off', lastSync: null, error: '', pending: 0 };

  function nowIso() { return new Date().toISOString(); }
  function newer(a, b) { return (a || '') > (b || ''); }
  function minusMargin(iso) { return iso ? new Date(new Date(iso).getTime() - MARGIN_MS).toISOString() : '1970-01-01T00:00:00Z'; }

  async function loadState() {
    state = (await root.Store.kvGet('syncState')) || {};
    state.pushedKv = state.pushedKv || {};
    state.pushedDays = state.pushedDays || {};
    state.photoQueue = state.photoQueue || [];
  }
  function saveState() { return root.Store.kvSet('syncState', state); }

  function available() { return !!(root.supabase && root.supabase.createClient); }

  async function init(adapter) {
    A = adapter;
    await loadState();
    if (!available()) { status.phase = 'unavailable'; return; }
    client = root.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: 'mh-planner-auth' }
    });
    try {
      const { data } = await client.auth.getSession();
      user = data && data.session ? data.session.user : null;
    } catch (e) { user = null; }
    status.phase = user ? 'idle' : 'off';
    client.auth.onAuthStateChange(function (_evt, session) {
      user = session ? session.user : null;
      status.phase = user ? (status.phase === 'off' ? 'idle' : status.phase) : 'off';
      A.onStatus && A.onStatus();
    });
  }

  function pendingCount() {
    let n = 0;
    KV_KEYS.forEach(function (k) { if (newer(A.kvStamp(k), state.pushedKv[k])) n++; });
    A.days().forEach(function (d) { if (newer(d.updatedAt, state.pushedDays[d.date])) n++; });
    return n + state.photoQueue.length;
  }

  // ---------- pull ----------
  async function pull() {
    let changed = false;
    // settings & learned values
    const since = minusMargin(state.lastPullKv);
    const kv = await client.from('app_kv').select('key,value,updated_at').gt('updated_at', since);
    if (kv.error) throw kv.error;
    let maxKv = state.lastPullKv || '';
    for (const row of kv.data) {
      const stamp = new Date(row.updated_at).toISOString();
      if (stamp > maxKv) maxKv = stamp;
      if (newer(stamp, A.kvStamp(row.key))) {
        await A.applyKv(row.key, row.value, stamp);
        state.pushedKv[row.key] = stamp;
        changed = true;
      }
    }
    state.lastPullKv = maxKv || state.lastPullKv;
    // days
    const sinceD = minusMargin(state.lastPullDays);
    let from = 0; let maxD = state.lastPullDays || '';
    for (;;) {
      const res = await client.from('days').select('date,doc,updated_at').gt('updated_at', sinceD).order('updated_at').range(from, from + 199);
      if (res.error) throw res.error;
      for (const row of res.data) {
        const stamp = new Date(row.updated_at).toISOString();
        if (stamp > maxD) maxD = stamp;
        const local = A.days().find(function (d) { return d.date === row.date; });
        if (!local || newer(stamp, local.updatedAt)) {
          const doc = row.doc; doc.updatedAt = stamp;
          await A.applyDay(doc);
          state.pushedDays[row.date] = stamp;
          changed = true;
        }
      }
      if (res.data.length < 200) break;
      from += 200;
    }
    state.lastPullDays = maxD || state.lastPullDays;
    return changed;
  }

  // ---------- push ----------
  async function push() {
    const kvRows = [];
    KV_KEYS.forEach(function (k) {
      const st = A.kvStamp(k);
      if (st && newer(st, state.pushedKv[k]) && A.kvValue(k) != null) kvRows.push({ key: k, value: A.kvValue(k), updated_at: st });
    });
    if (kvRows.length) {
      const r = await client.from('app_kv').upsert(kvRows.map(function (x) { return Object.assign({ owner: user.id }, x); }), { onConflict: 'owner,key' });
      if (r.error) throw r.error;
      kvRows.forEach(function (x) { state.pushedKv[x.key] = x.updated_at; });
    }
    const dayRows = A.days().filter(function (d) { return d.updatedAt && newer(d.updatedAt, state.pushedDays[d.date]); })
      .map(function (d) { return { owner: user.id, date: d.date, doc: d, updated_at: d.updatedAt }; });
    for (let i = 0; i < dayRows.length; i += 50) {
      const chunk = dayRows.slice(i, i + 50);
      const r = await client.from('days').upsert(chunk, { onConflict: 'owner,date' });
      if (r.error) throw r.error;
      chunk.forEach(function (x) { state.pushedDays[x.date] = x.updated_at; });
    }
    // photos
    while (state.photoQueue.length) {
      const key = state.photoQueue[0];
      const data = await A.getPhoto(key);
      if (data) {
        const blob = await (await fetch(data)).blob();
        const r = await client.storage.from('photos').upload(photoPath(key), blob, { upsert: true, contentType: 'image/jpeg' });
        if (r.error) throw r.error;
      }
      state.photoQueue.shift();
      await saveState();
    }
  }

  function photoPath(key) { return user.id + '/' + key.replace(':', '-') + '.jpg'; }

  async function syncNow() {
    if (!client || !user) return { ok: false, reason: 'signed-out' };
    if (running) return running;
    running = (async function () {
      status.phase = 'syncing'; status.error = ''; A.onStatus && A.onStatus();
      try {
        const changed = await pull();
        await push();
        await saveState();
        status.phase = 'idle'; status.lastSync = nowIso();
        if (changed) A.onRemoteChange && A.onRemoteChange();
        return { ok: true, changed: changed };
      } catch (e) {
        status.phase = 'error';
        status.error = (e && (e.message || e.error_description)) || 'Could not reach the cloud';
        await saveState();
        return { ok: false, reason: status.error };
      } finally {
        running = null;
        status.pending = pendingCount();
        A.onStatus && A.onStatus();
      }
    })();
    return running;
  }

  function schedule(delay) {
    if (!client || !user) return;
    clearTimeout(timer);
    timer = setTimeout(syncNow, delay == null ? 3000 : delay);
  }

  async function queuePhoto(key) {
    if (state.photoQueue.indexOf(key) < 0) state.photoQueue.push(key);
    await saveState();
    schedule();
  }

  async function downloadPhoto(key) {
    if (!client || !user) return null;
    try {
      const r = await client.storage.from('photos').download(photoPath(key));
      if (r.error || !r.data) return null;
      return await new Promise(function (resolve) {
        const fr = new FileReader(); fr.onload = function () { resolve(fr.result); }; fr.onerror = function () { resolve(null); };
        fr.readAsDataURL(r.data);
      });
    } catch (e) { return null; }
  }


  /** Call a Supabase Edge Function as the signed-in family account. */
  async function callFunction(name, body) {
    if (!client || !user) throw new Error('Sign in to cloud sync first (Parent tab → Cloud sync).');
    if (!navigator.onLine) throw new Error('No internet connection. Add the tasks by hand, or try again when online.');
    const r = await client.functions.invoke(name, { body: body });
    if (r.error) {
      let msg = r.error.message || 'The photo could not be read.';
      try { const ctx = r.error.context; if (ctx && typeof ctx.json === 'function') { const j = await ctx.json(); if (j && j.error) msg = j.error; } } catch (e) { /* keep msg */ }
      if (/429|quota|rate/i.test(msg)) msg = 'The free reading limit is used up for now. Add the tasks by hand, or try again later.';
      throw new Error(msg);
    }
    return r.data;
  }

  async function signIn(email, password) {
    if (!client) throw new Error('Cloud sync is not available in this browser.');
    const r = await client.auth.signInWithPassword({ email: email, password: password });
    if (r.error) throw new Error(friendly(r.error));
    user = r.data.user;
    // A fresh sign-in on this phone: compare everything once.
    state.lastPullDays = null; state.lastPullKv = null;
    await saveState();
    return user;
  }
  async function signUp(email, password) {
    if (!client) throw new Error('Cloud sync is not available in this browser.');
    const r = await client.auth.signUp({ email: email, password: password, options: { emailRedirectTo: location.origin + location.pathname } });
    if (r.error) throw new Error(friendly(r.error));
    if (r.data.session) { user = r.data.user; return { user: user, confirm: false }; }
    return { user: null, confirm: true };
  }
  async function signOut() {
    if (!client) return;
    await client.auth.signOut();
    user = null;
    state.pushedKv = {}; state.pushedDays = {}; state.lastPullDays = null; state.lastPullKv = null;
    await saveState();
    status.phase = 'off';
  }
  function friendly(err) {
    const m = (err && err.message) || '';
    if (/invalid login/i.test(m)) return 'Email or password is not right.';
    if (/email not confirmed/i.test(m)) return 'Open the confirmation email from Supabase first, then sign in.';
    if (/signups? not allowed|signup.*disabled/i.test(m)) return 'New accounts are switched off. Use Sign in with the family account.';
    if (/already registered/i.test(m)) return 'This email already has an account. Use Sign in.';
    if (/password/i.test(m) && /6/.test(m)) return 'Password needs at least 6 characters.';
    if (/fetch|network/i.test(m)) return 'No internet connection. Try again when online.';
    return m || 'Something went wrong.';
  }

  root.Sync = {
    init: init, syncNow: syncNow, schedule: schedule, queuePhoto: queuePhoto, downloadPhoto: downloadPhoto,
    signIn: signIn, signUp: signUp, signOut: signOut, callFunction: callFunction,
    status: status,
    user: function () { return user; },
    available: available,
    pendingCount: function () { return A && state ? pendingCount() : 0; }
  };
})(window);
