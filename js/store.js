/* What Speedy keeps.
 *  - Settings, playlists, favorites, hidden / pinned categories and where you stopped: MyPC.save (per My PC profile, backed up
 *    by My PC; 64 KB for the whole app, so entries are small and the history is trimmed).
 *  - The downloaded lists (thousands of channels / films): IndexedDB of this TV (big, never backed up), per playlist. */
'use strict';
const Store = (() => {
  const LIMIT = 56 * 1024, HIST_MAX = 150, FAV_MAX = 400;
  const DEF = { theme: 'ocean', autoNext: true, remember: true, adult: false, cache: true, cols: 6, ua: '',
                sort: { live: 'default', vod: 'default', series: 'default' }, subs: { size: 'medium', color: 'white', bg: 'shadow', font: 'sans', pos: 'bottom' } };
  let prefs = null, pls = null, cur = '', per = {}, hist = null;

  function load(k, d) { try { const v = MyPC.load(k, d); return v === undefined ? d : v; } catch (e) { return d; } }
  function size() { let n = 0; try { n = JSON.stringify([prefs, pls, cur, per, hist]).length; } catch (e) {} return n; }
  function save(k, v) {
    try { MyPC.save(k, v); } catch (e) {}
  }
  function init() {
    const p = load('prefs', {}) || {};
    prefs = Object.assign({}, DEF, p);
    prefs.sort = Object.assign({}, DEF.sort, p.sort || {});
    prefs.subs = Object.assign({}, DEF.subs, p.subs || {});
    pls = load('pls', []) || [];
    cur = load('cur', '') || (pls[0] && pls[0].id) || '';
    hist = load('hist', {}) || {};
  }
  function setPref(k, v) { prefs[k] = v; save('prefs', prefs); }
  // per playlist: favorites (ids per kind), hidden and pinned categories
  function pl(id) {
    id = id || cur;
    if (!per[id]) {
      const d = load('p_' + id, null) || {};
      per[id] = { fav: Object.assign({ live: [], vod: [], series: [] }, d.fav || {}), hide: Object.assign({ live: [], vod: [], series: [] }, d.hide || {}),
                  pin: Object.assign({ live: [], vod: [], series: [] }, d.pin || {}) };
    }
    return per[id];
  }
  function savePl(id) { id = id || cur; trim(); save('p_' + id, per[id]); }
  function isFav(kind, id) { return pl().fav[kind].indexOf(String(id)) >= 0; }
  function toggleFav(kind, id) {
    const l = pl().fav[kind], s = String(id), i = l.indexOf(s);
    if (i >= 0) l.splice(i, 1); else { l.unshift(s); if (l.length > FAV_MAX) l.length = FAV_MAX; }
    savePl();
    return i < 0;
  }
  function catState(kind, cid) { const p = pl(); cid = String(cid); return { hidden: p.hide[kind].indexOf(cid) >= 0, pinned: p.pin[kind].indexOf(cid) >= 0 }; }
  function setCat(kind, cid, what, on) {
    const l = pl()[what][kind], s = String(cid), i = l.indexOf(s);
    if (on && i < 0) l.push(s); else if (!on && i >= 0) l.splice(i, 1);
    savePl();
  }
  /* where you stopped: hist[playlist][key] = [seconds, duration, at, name, icon, kind, extra]
   *   key: 'v<id>' film, 'e<id>' episode, 's<id>' series (its last episode), 'u<path>' USB file */
  function h(id) { id = id || cur; return hist[id] || (hist[id] = {}); }
  function progress(key, plId) { const e = h(plId)[key]; return e ? { t: e[0], d: e[1], at: e[2], name: e[3], icon: e[4], kind: e[5], x: e[6] } : null; }
  function setProgress(key, o, plId) {
    const H = h(plId);
    if (o === null) delete H[key];
    else H[key] = [Math.floor(o.t || 0), Math.floor(o.d || 0), Date.now(), String(o.name || '').slice(0, 80), String(o.icon || '').slice(0, 220), o.kind || '', o.x || 0];
    trim();
    save('hist', hist);
  }
  function recent(plId, kinds) {
    const H = h(plId), out = [];
    for (const k in H) { const e = H[k]; if (!kinds || kinds.indexOf(e[5]) >= 0) out.push({ key: k, t: e[0], d: e[1], at: e[2], name: e[3], icon: e[4], kind: e[5], x: e[6] }); }
    out.sort((a, b) => b.at - a.at);
    return out;
  }
  // keep the whole save under My PC's 64 KB: the oldest history goes first
  function trim() {
    for (const p in hist) {
      const ks = Object.keys(hist[p]);
      if (ks.length > HIST_MAX) { ks.sort((a, b) => hist[p][a][2] - hist[p][b][2]); for (let i = 0; i < ks.length - HIST_MAX; i++) delete hist[p][ks[i]]; }
    }
    let guard = 0;
    while (size() > LIMIT && guard++ < 400) {
      let oldK = null, oldP = null, oldAt = Infinity;
      for (const p in hist) for (const k in hist[p]) if (hist[p][k][2] < oldAt) { oldAt = hist[p][k][2]; oldK = k; oldP = p; }
      if (!oldK) break;
      delete hist[oldP][oldK];
    }
  }
  function clearHist() { hist[cur] = {}; save('hist', hist); }
  function clearFavs() { const p = pl(); p.fav = { live: [], vod: [], series: [] }; savePl(); }

  function playlists() { return pls; }
  function current() { return pls.find((p) => p.id === cur) || null; }
  function setCurrent(id) { cur = id; save('cur', id); }
  function putPlaylist(p) {
    if (!p.id) p.id = 'p' + Date.now().toString(36);
    const i = pls.findIndex((x) => x.id === p.id);
    if (i >= 0) pls[i] = p; else pls.push(p);
    save('pls', pls);
    return p;
  }
  function removePlaylist(id) {
    pls = pls.filter((p) => p.id !== id);
    delete per[id]; delete hist[id];
    save('pls', pls); save('p_' + id, null); save('hist', hist);
    if (cur === id) setCurrent(pls[0] ? pls[0].id : '');
  }

  /* ---------- the lists, on this TV (IndexedDB) ---------- */
  let dbp = null;
  function db() {
    if (dbp) return dbp;
    dbp = new Promise((res) => {
      let r;
      try { r = indexedDB.open('speedy', 1); } catch (e) { return res(null); }
      r.onupgradeneeded = () => { r.result.createObjectStore('lists'); };
      r.onsuccess = () => res(r.result);
      r.onerror = () => res(null);
      r.onblocked = () => res(null);
    });
    return dbp;
  }
  async function cacheGet(key) {
    const d = await db(); if (!d) return null;
    return new Promise((res) => { try { const q = d.transaction('lists').objectStore('lists').get(key); q.onsuccess = () => res(q.result || null); q.onerror = () => res(null); } catch (e) { res(null); } });
  }
  async function cachePut(key, v) {
    const d = await db(); if (!d) return false;
    return new Promise((res) => { try { const t = d.transaction('lists', 'readwrite'); t.objectStore('lists').put(v, key); t.oncomplete = () => res(true); t.onerror = () => res(false); t.onabort = () => res(false); } catch (e) { res(false); } });
  }
  async function cacheClear(prefix) {
    const d = await db(); if (!d) return;
    return new Promise((res) => {
      try {
        const t = d.transaction('lists', 'readwrite'), s = t.objectStore('lists');
        if (!prefix) s.clear();
        else { const q = s.getAllKeys(); q.onsuccess = () => { q.result.forEach((k) => { if (String(k).indexOf(prefix) === 0) s.delete(k); }); }; }
        t.oncomplete = () => res(); t.onerror = () => res();
      } catch (e) { res(); }
    });
  }

  return { init, prefs: () => prefs, setPref, pl, isFav, toggleFav, catState, setCat, progress, setProgress, recent, clearHist, clearFavs,
           playlists, current, setCurrent, putPlaylist, removePlaylist, cacheGet, cachePut, cacheClear, size };
})();
