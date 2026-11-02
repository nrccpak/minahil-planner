/* Local storage on the phone (IndexedDB), with an in-memory fallback.
 * Phase 1 keeps everything on the device; the same shape maps to the Supabase tables in supabase/schema.sql.
 */
(function (root) {
  'use strict';
  const DB_NAME = 'minahil-planner';
  const DB_VER = 1;
  let dbPromise = null;
  const mem = { kv: {}, days: {}, photos: {} };
  let useMem = false;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve) {
      try {
        if (!root.indexedDB) { useMem = true; return resolve(null); }
        const req = root.indexedDB.open(DB_NAME, DB_VER);
        req.onupgradeneeded = function () {
          const db = req.result;
          if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
          if (!db.objectStoreNames.contains('days')) db.createObjectStore('days');
          if (!db.objectStoreNames.contains('photos')) db.createObjectStore('photos');
        };
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { useMem = true; resolve(null); };
        req.onblocked = function () { useMem = true; resolve(null); };
      } catch (e) { useMem = true; resolve(null); }
    });
    return dbPromise;
  }

  function tx(store, mode, fn) {
    return open().then(function (db) {
      if (!db || useMem) return fn(null);
      return new Promise(function (resolve, reject) {
        try {
          const t = db.transaction(store, mode);
          const s = t.objectStore(store);
          const out = fn(s);
          t.oncomplete = function () { resolve(out && out.result !== undefined ? out.result : out); };
          t.onerror = function () { reject(t.error); };
          t.onabort = function () { reject(t.error); };
        } catch (e) { reject(e); }
      });
    });
  }

  function get(store, key) {
    return open().then(function (db) {
      if (!db || useMem) return clone(mem[store][key]);
      return new Promise(function (resolve) {
        try {
          const r = db.transaction(store, 'readonly').objectStore(store).get(key);
          r.onsuccess = function () { resolve(r.result); };
          r.onerror = function () { resolve(undefined); };
        } catch (e) { resolve(undefined); }
      });
    });
  }
  function put(store, key, val) {
    if (useMem) { mem[store][key] = clone(val); return Promise.resolve(); }
    return tx(store, 'readwrite', function (s) {
      if (!s) { mem[store][key] = clone(val); return; }
      s.put(val, key);
    });
  }
  function del(store, key) {
    if (useMem) { delete mem[store][key]; return Promise.resolve(); }
    return tx(store, 'readwrite', function (s) { if (!s) { delete mem[store][key]; return; } s.delete(key); });
  }
  function all(store) {
    return open().then(function (db) {
      if (!db || useMem) return Object.keys(mem[store]).map(function (k) { return { key: k, value: clone(mem[store][k]) }; });
      return new Promise(function (resolve) {
        const out = [];
        try {
          const r = db.transaction(store, 'readonly').objectStore(store).openCursor();
          r.onsuccess = function () {
            const c = r.result;
            if (c) { out.push({ key: c.key, value: c.value }); c.continue(); } else resolve(out);
          };
          r.onerror = function () { resolve(out); };
        } catch (e) { resolve(out); }
      });
    });
  }
  function clearAll() {
    if (useMem) { mem.kv = {}; mem.days = {}; mem.photos = {}; return Promise.resolve(); }
    return Promise.all(['kv', 'days', 'photos'].map(function (st) {
      return tx(st, 'readwrite', function (s) { if (s) s.clear(); });
    }));
  }
  function clone(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }

  function persist() {
    try {
      if (root.navigator && navigator.storage && navigator.storage.persist) return navigator.storage.persist();
    } catch (e) { /* ignore */ }
    return Promise.resolve(false);
  }

  root.Store = {
    open: open,
    kvGet: function (k) { return get('kv', k); },
    kvSet: function (k, v) { return put('kv', k, v); },
    dayGet: function (d) { return get('days', d); },
    daySet: function (d, v) { return put('days', d, v); },
    dayDel: function (d) { return del('days', d); },
    daysAll: function () { return all('days').then(function (r) { return r.map(function (x) { return x.value; }).sort(function (a, b) { return a.date < b.date ? -1 : 1; }); }); },
    photoGet: function (k) { return get('photos', k); },
    photoSet: function (k, v) { return put('photos', k, v); },
    photosAll: function () { return all('photos'); },
    clearAll: clearAll,
    persist: persist,
    isMemoryOnly: function () { return useMem; }
  };
})(window);
