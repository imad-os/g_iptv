/* The lists of the current playlist, per kind ('live' | 'vod' | 'series'), kept small and fast for thousands of entries.
 *   await Catalog.open(kind, onStatus)   loads from the TV's copy at once (and reads the server again in the background
 *                                        when the copy is older than 12 h), else from the server
 *   Catalog.cats(kind)   [{ id, name, n, pinned, special }] (hidden and adult categories left out, pinned first)
 *   Catalog.list(kind, catId, sort)   items of a category (also the special ones: all, fav, recent, foryou)
 *   Catalog.search(kind, q)   Catalog.byId(kind, id)   Catalog.count(kind) */
'use strict';
const Catalog = (() => {
  const MAX_AGE = 12 * 3600 * 1000;
  const ADULT = /adult|xxx|\+18|18\+|porn|for adults|sex/i;
  let pv = null, plId = '';
  const data = {};                // kind -> { cats, items, byId, byCat, at, partial, sorted }
  const busy = {};
  let onUpdate = null;

  function reset(playlist) {
    pv = Provider.make(playlist);
    plId = playlist ? playlist.id : '';
    for (const k in data) delete data[k];
    for (const k in busy) delete busy[k];
  }
  function provider() { return pv; }
  function key(kind) { return pv.key + ':' + kind; }

  function build(kind, cats, items, at, partial) {
    const byId = new Map(), byCat = new Map();
    for (const c of cats) byCat.set(c.id, []);
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      byId.set(it.i, it);
      const cs = it.cs || [it.c];
      for (let j = 0; j < cs.length; j++) {
        let l = byCat.get(cs[j]);
        if (!l) { l = []; byCat.set(cs[j], l); if (!cats.some((c) => c.id === cs[j])) cats.push({ id: cs[j], name: cs[j] === '0' ? '—' : cs[j] }); }
        l.push(it);
      }
    }
    data[kind] = { cats, items, byId, byCat, at, partial: !!partial, sorted: new Map() };
    return data[kind];
  }

  async function fetchAll(kind, onStatus) {
    const cats = await pv.cats(kind);
    let items, partial = false;
    try {
      items = await pv.items(kind, (ph, bytes) => { if (onStatus) onStatus(ph, bytes); });
    } catch (e) {
      if (e.code !== 'too-big') throw e;
      items = []; partial = true;       // a list bigger than My PC lets an app download at once: one category at a time
    }
    const at = Date.now();
    if (!partial && Store.prefs().cache) Store.cachePut(key(kind), { at, cats, items });
    return build(kind, cats, items, at, partial);
  }

  // onStatus(phase: 'cache' | 'download' | 'parse', bytes)
  async function open(kind, onStatus) {
    if (data[kind]) return data[kind];
    if (busy[kind]) return busy[kind];
    busy[kind] = (async () => {
      try {
        if (Store.prefs().cache) {
          const c = await Store.cacheGet(key(kind));
          if (c && c.items && c.cats) {
            if (onStatus) onStatus('cache');
            const d = build(kind, c.cats, c.items, c.at);
            if (Date.now() - c.at > MAX_AGE) setTimeout(() => refresh(kind, true), 4000);
            return d;
          }
        }
        return await fetchAll(kind, onStatus);
      } finally { delete busy[kind]; }
    })();
    return busy[kind];
  }
  // read the server again; quiet = in the background (the screen keeps the old copy until the new one is ready)
  async function refresh(kind, quiet) {
    if (!pv) return null;
    const mine = pv;
    try {
      const old = data[kind];
      const cats = await pv.cats(kind);
      let items;
      try { items = await pv.items(kind); } catch (e) { if (e.code === 'too-big') return null; throw e; }
      if (mine !== pv) return null;
      const at = Date.now();
      if (Store.prefs().cache) Store.cachePut(key(kind), { at, cats, items });
      if (old) {     // categories loaded one by one are kept
        for (const [cid, l] of old.byCat) if (old.partial && l.length) items = items.concat(l);
      }
      build(kind, cats, items, at);
      if (onUpdate) onUpdate(kind, quiet);
      return data[kind];
    } catch (e) { if (!quiet) throw e; return null; }
  }
  // a category of a list too big to download at once
  async function loadCat(kind, cid) {
    const d = data[kind];
    if (!d || !d.partial) return;
    const l = d.byCat.get(cid);
    if (l && l.loaded) return;
    const items = await pv.itemsOf(kind, cid);
    const arr = d.byCat.get(cid) || [];
    arr.length = 0;
    for (const it of items) { it.c = cid; arr.push(it); d.byId.set(it.i, it); }
    arr.loaded = true;
    d.byCat.set(cid, arr);
    d.items = d.items.concat(items);
    d.sorted.clear();
  }

  function visibleCat(kind, c) {
    const st = Store.catState(kind, c.id);
    if (st.hidden) return false;
    if (!Store.prefs().adult && ADULT.test(c.name)) return false;
    return true;
  }
  function cats(kind) {
    const d = data[kind];
    if (!d) return [];
    const out = [], pinned = [];
    for (const c of d.cats) {
      if (!visibleCat(kind, c)) continue;
      const l = d.byCat.get(c.id);
      const o = { id: c.id, name: c.name, n: d.partial && !(l && l.loaded) ? -1 : l ? l.length : 0 };
      if (Store.catState(kind, c.id).pinned) { o.pinned = true; pinned.push(o); } else out.push(o);
    }
    const all = [{ id: '*all', name: T('all'), n: allItems(kind).length, special: 'all' }, { id: '*fav', name: T('favorites'), n: Store.pl().fav[kind].length, special: 'fav' }];
    if (kind !== 'live') { all.push({ id: '*recent', name: T('recent'), n: -1, special: 'recent' }); all.push({ id: '*foryou', name: T('forYou'), n: -1, special: 'foryou' }); }
    else all.push({ id: '*recent', name: T('recent'), n: -1, special: 'recent' });
    return all.concat(pinned, out);
  }
  function catName(kind, cid) { const d = data[kind]; const c = d && d.cats.find((x) => x.id === cid); return c ? c.name : ''; }
  // every item of the visible categories (the hidden and adult ones are left out of All and of search)
  function allItems(kind) {
    const d = data[kind];
    if (!d) return [];
    if (d.sorted.has('*all')) return d.sorted.get('*all');
    const hide = new Set();
    for (const c of d.cats) if (!visibleCat(kind, c)) hide.add(c.id);
    const l = hide.size ? d.items.filter((it) => !hide.has(it.c)) : d.items;
    d.sorted.set('*all', l);
    return l;
  }
  function sortList(l, sort) {
    if (!sort || sort === 'default') return l;
    const c = l.slice();
    if (sort === 'name') c.sort((a, b) => natCmp(a.k, b.k));
    else if (sort === 'added') c.sort((a, b) => (b.a || 0) - (a.a || 0));
    else if (sort === 'rating') c.sort((a, b) => (b.r || 0) - (a.r || 0));
    return c;
  }
  function list(kind, cid, sort) {
    const d = data[kind];
    if (!d) return [];
    const sk = cid + '|' + (sort || 'default');
    if (cid !== '*fav' && cid !== '*recent' && cid !== '*foryou' && d.sorted.has(sk)) return d.sorted.get(sk);
    let l;
    if (cid === '*all') l = allItems(kind);
    else if (cid === '*fav') l = Store.pl().fav[kind].map((id) => d.byId.get(id)).filter(Boolean);
    else if (cid === '*recent') l = recentItems(kind);
    else if (cid === '*foryou') l = forYou(kind);
    else l = d.byCat.get(cid) || [];
    if (cid === '*recent' || cid === '*foryou') return l;
    l = sortList(l, sort);
    if (cid !== '*fav') d.sorted.set(sk, l);
    return l;
  }
  function recentItems(kind) {
    const d = data[kind], out = [], seen = new Set();
    const pre = kind === 'vod' ? 'v' : kind === 'series' ? 's' : 'l';
    for (const r of Store.recent(plId)) {
      if (r.key[0] !== pre) continue;
      const it = d.byId.get(r.key.slice(1));
      if (it && !seen.has(it.i)) { seen.add(it.i); out.push(it); }
    }
    return out;
  }
  /* "For you": what is close to what this profile watched and liked (same categories and genres, good rating, recent),
   * without what was already watched to the end. Light: scores at most 20 000 items, once per opening. */
  function forYou(kind) {
    const d = data[kind];
    const pre = kind === 'vod' ? 'v' : 's';
    const catW = new Map(), genW = new Map(), seen = new Set();
    const bump = (m, k, w) => { if (k) m.set(k, (m.get(k) || 0) + w); };
    for (const r of Store.recent(plId)) {
      if (r.key[0] !== pre) continue;
      const it = d.byId.get(r.key.slice(1));
      if (!it) continue;
      const done = r.d > 0 && r.t / r.d > 0.9;
      if (done) seen.add(it.i);
      bump(catW, it.c, 3);
      if (it.g) it.g.split(/[,/]/).forEach((g) => bump(genW, g.trim().toLowerCase(), 2));
    }
    for (const id of Store.pl().fav[kind]) {
      const it = d.byId.get(id);
      if (!it) continue;
      bump(catW, it.c, 4);
      if (it.g) it.g.split(/[,/]/).forEach((g) => bump(genW, g.trim().toLowerCase(), 3));
    }
    const pool = allItems(kind), now = Date.now() / 1000, out = [];
    const step = Math.max(1, Math.floor(pool.length / 20000));
    for (let i = 0; i < pool.length; i += step) {
      const it = pool[i];
      if (seen.has(it.i)) continue;
      let s = (catW.get(it.c) || 0) * 2 + (it.r || 0) * 0.6;
      if (it.g && genW.size) it.g.split(/[,/]/).forEach((g) => { s += (genW.get(g.trim().toLowerCase()) || 0); });
      if (it.a) s += Math.max(0, 2 - (now - it.a) / (86400 * 90));
      if (Store.isFav(kind, it.i)) s -= 1;
      out.push([s, it]);
    }
    out.sort((a, b) => b[0] - a[0]);
    return out.slice(0, 120).map((x) => x[1]);
  }
  function search(kind, q) {
    const f = fold(q);
    if (!f) return [];
    const words = f.split(' '), pool = allItems(kind), out = [];
    for (let i = 0; i < pool.length && out.length < 3000; i++) {
      const k = pool[i].k;
      let ok = true;
      for (let w = 0; w < words.length; w++) if (k.indexOf(words[w]) < 0) { ok = false; break; }
      if (ok) out.push(pool[i]);
    }
    // names that start with the search first
    out.sort((a, b) => (a.k.indexOf(f) === 0 ? 0 : 1) - (b.k.indexOf(f) === 0 ? 0 : 1));
    return out;
  }
  function byId(kind, id) { const d = data[kind]; return d ? d.byId.get(String(id)) || null : null; }
  function count(kind) { const d = data[kind]; return d ? allItems(kind).length : -1; }
  function loaded(kind) { return !!data[kind]; }
  function partial(kind) { return !!(data[kind] && data[kind].partial); }
  function invalidate(kind) { const d = data[kind]; if (d) d.sorted.clear(); }

  return { reset, provider, open, refresh, loadCat, cats, catName, list, search, byId, count, loaded, partial, invalidate, onUpdate: (fn) => { onUpdate = fn; } };
})();
