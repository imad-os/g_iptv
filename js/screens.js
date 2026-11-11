/* The screens: Home, Movies / Series (categories + posters), Live TV (categories + channels + picture), a film, a series.
 * Every screen = { root, show(first), hide(), destroy(), input(action, repeat) -> true when it used Back }. */
'use strict';

function screenEl(cls, html) {
  const s = el('section', 'screen ' + cls);
  s.innerHTML = html;
  $('screens').appendChild(s);
  return s;
}
function topHtml(crumb) { return '<div class="top"><div class="brand"><img src="icon.png" alt=""><span class="bn"></span></div><div class="crumb"></div><div class="grow"></div><div class="clock"></div></div>'; }
function fillTop(root, crumb) {
  const bn = root.querySelector('.bn');
  if (bn) bn.textContent = T('appName');
  const c = root.querySelector('.crumb');
  if (c) c.textContent = crumb || '';
  const k = root.querySelector('.clock');
  if (k) k.textContent = fmtClock();
}
function errText(e) {
  const c = e && e.code;
  return c === 'auth' ? T('authFail') : c === 'bad-data' ? T('badData') : c === 'offline' ? T('offline') : T('netFail');
}
// My PC's on-screen keyboard (API 17), else the browser's prompt
function askText(o) {
  try { if (MyPC.text && MyPC.text.keyboard) return MyPC.text.keyboard(o); } catch (e) {}
  return Promise.resolve(window.prompt(o.label || '', o.value || ''));
}
// a poster cell (built once per pooled node, filled again for each item)
function posterInit(n) {
  if (n.__p) return;
  n.__p = el('div', 'post'); n.__pic = el('div', 'pic'); n.__ph = el('div', 'ph'); n.__pic.appendChild(n.__ph);
  n.__nm = el('div', 'nm'); n.__nt = el('span'); n.__nm.appendChild(n.__nt); n.__rt = el('div', 'rt'); n.__bar = el('div', 'bar'); n.__bi = el('i'); n.__bar.appendChild(n.__bi);
  n.__fv = document.createElement('span'); n.__fv.innerHTML = svg('heart'); n.__fv.firstChild.setAttribute('class', 'fav');
  n.__p.append(n.__pic, n.__nm, n.__rt, n.__bar, n.__fv); n.appendChild(n.__p);
}
function rtlOn() { return document.documentElement.dir === 'rtl'; }
function sideways(a) { return (a === 'right') !== rtlOn() ? 1 : -1; }

/* open a list (from the TV's copy at once, else the server), with a loading box; resolves true when ready */
async function openKind(kind) {
  if (Catalog.loaded(kind)) return true;
  let cancelled = false;
  const names = { live: T('live'), vod: T('movies'), series: T('series') };
  const b = UI.busy(T('loading'), () => { cancelled = true; });
  try {
    await Catalog.open(kind, (ph, bytes) => {
      if (ph === 'download') b.text(T('loadingList', { x: names[kind], mb: '…' }));
      if (ph === 'parse') b.text(T('parsing') + (bytes ? ' (' + fmtSize(bytes) + ')' : ''));
    });
    if (cancelled) return false;
    b.close();
    return true;
  } catch (e) {
    if (cancelled) return false;
    b.close();
    report(e, { where: 'open ' + kind });
    return new Promise((res) => UI.dialog(T('errTitle'), errText(e), [{ label: T('close'), action: () => res(false) }, { label: T('retry'), primary: true, focus: true, action: () => openKind(kind).then(res) }], { onBack: () => res(false) }));
  }
}

/* ---------------- what the player gets ---------------- */
function liveSpec(it, idx, list, listName) {
  const pv = Catalog.provider();
  return { kind: 'live', live: true, item: it, id: it.i, title: (it.no ? it.no + ' · ' : '') + it.n, sub: Catalog.catName('live', it.c), icon: it.l || '', url: pv.url('live', it),
           key: 'l' + it.i, list, index: idx, listName, fav: { kind: 'live', id: it.i }, makeSpec: (x, i) => liveSpec(x, i, list, listName) };
}
function vodSpec(it, info, start) {
  const pv = Catalog.provider();
  const x = Object.assign({}, it, { x: (info && info.ext) || it.x || 'mp4' });
  return { kind: 'vod', id: it.i, title: it.n, sub: [it.y || (info && info.date ? String(info.date).slice(0, 4) : ''), info && info.genre].filter(Boolean).join(' · '), icon: it.l || '',
           url: pv.url('vod', x), key: 'v' + it.i, start: start || 0, fav: { kind: 'vod', id: it.i },
           meta: { name: (info && info.o_name) || it.n, tmdb_id: (info && info.tmdb) || '', year: it.y || (info && info.date ? String(info.date).slice(0, 4) : '') }, metaKind: 'movie' };
}
function startOf(key) { const p = Store.progress(key); return p && Store.prefs().remember && p.d > 0 && p.t >= 5 && p.t / p.d < 0.95 ? p.t : 0; }

/* ======================================================================= HOME */
class HomeScreen {
  constructor() {
    this.root = screenEl('home', topHtml() + '<div class="welcome hidden"></div><div class="home-tiles"></div><div class="home-row-title"></div><div class="acct"></div><div class="home-row"></div><div class="home-actions"></div><div class="hints"></div>');
    this.zone = 0; this.ti = 0; this.ai = 0;
    this.row = new VList(this.root.querySelector('.home-row'), { horizontal: true, itemW: 400, render: (i, n, full) => this.drawCw(i, n, full), onFocus: (i) => { const r = this.rec[i]; if (r) announce(r.name); } });
    this.rec = [];
    UI.hints(this.root.querySelector('.hints'), [['b', T('hintOk')], ['x', T('hintFav')], ['plus', T('hintMenu')], ['a', T('hintBack')]]);
  }
  build() {
    fillTop(this.root, Store.current() ? Store.current().name || Provider.baseOf(Store.current().host || '') || T('m3u') : '');
    const pl = Store.current();
    this.hasPl = !!pl;
    const w = this.root.querySelector('.welcome');
    w.classList.toggle('hidden', this.hasPl);
    this.root.classList.toggle('nopl', !this.hasPl);
    if (!this.hasPl) { clear(w); w.appendChild(el('h1', '', T('noPlaylist'))); w.appendChild(el('p', 'note', T('welcome'))); }
    // tiles
    this.tiles = [];
    if (this.hasPl) this.tiles.push({ id: 'live', icon: 'tv', t: T('live'), c: () => Catalog.count('live') >= 0 ? T('channels', { n: Catalog.count('live') }) : '' },
                                    { id: 'vod', icon: 'film', t: T('movies'), c: () => Catalog.count('vod') >= 0 ? T('titles', { n: Catalog.count('vod') }) : '' },
                                    { id: 'series', icon: 'series', t: T('series'), c: () => Catalog.count('series') >= 0 ? T('shows', { n: Catalog.count('series') }) : '' });
    if (Usb.available()) this.tiles.push({ id: 'usb', icon: 'usb', t: T('usb'), c: () => T('usbLong') });
    const tb = this.root.querySelector('.home-tiles');
    clear(tb);
    tb.style.gridTemplateColumns = 'repeat(' + Math.max(1, this.tiles.length) + ', 1fr)';
    tb.classList.toggle('hidden', !this.tiles.length);
    this.tiles.forEach((t) => {
      const b = el('div', 'tile');
      b.innerHTML = svg(t.icon);
      b.firstChild.setAttribute('class', 'ic');
      b.appendChild(el('div', 'tt', t.t)); t.ct = el('div', 'ct', t.c()); b.appendChild(t.ct);
      t.node = b; tb.appendChild(b);
    });
    // continue watching
    this.rec = this.hasPl ? Store.recent(null, ['vod', 'series', 'usb']).filter((r) => r.key[0] !== 'e' && !(r.d > 0 && r.t / r.d > 0.95)).slice(0, 30) : [];
    if (Usb.available() || !this.hasPl) { /* USB entries are shared across playlists */ }
    this.root.querySelector('.home-row-title').textContent = this.hasPl ? T('continue') : '';
    this.root.querySelector('.home-row').classList.toggle('hidden', !this.rec.length);
    this.row.setCount(this.rec.length, 0);
    const emp = this.root.querySelector('.home-row-empty');
    if (emp) emp.remove();
    if (this.hasPl && !this.rec.length) { const e = el('div', 'empty home-row-empty', T('nothingYet')); e.style.top = '700px'; this.root.appendChild(e); }
    // actions
    this.acts = [];
    if (!this.hasPl) this.acts.push({ id: 'add', icon: 'plus', t: T('addPlaylist'), primary: true }, { id: 'demo', icon: 'play', t: T('demo') });
    else this.acts.push({ id: 'pls', icon: 'list', t: T('playlists') });
    this.acts.push({ id: 'set', icon: 'gear', t: T('settings') }, { id: 'speed', icon: 'speed', t: T('speedtest') });
    if (this.hasPl) this.acts.push({ id: 'refresh', icon: 'refresh', t: T('refresh') });
    this.acts.push({ id: 'about', icon: 'info', t: T('about') });
    const ab = this.root.querySelector('.home-actions');
    clear(ab);
    this.acts.forEach((a) => { const b = el('button', 'btn' + (a.primary ? ' primary' : '')); b.innerHTML = svg(a.icon); b.appendChild(el('span', '', a.t)); a.node = b; ab.appendChild(b); });
    this.zones = [];
    if (this.tiles.length) this.zones.push('tiles');
    if (this.rec.length) this.zones.push('row');
    this.zones.push('acts');
    // first build, or the playlist just came / went: no playlist = Add a playlist first (the USB tile is only beside it)
    if (this.plWas !== this.hasPl) { this.zone = this.hasPl ? 0 : this.zones.indexOf('acts'); this.ai = 0; this.plWas = this.hasPl; }
    if (this.zone >= this.zones.length) this.zone = 0;
    this.ti = Math.min(this.ti, Math.max(0, this.tiles.length - 1)); this.ai = Math.min(this.ai, this.acts.length - 1);
    this.account();
    this.paint();
  }
  async account() {
    const a = this.root.querySelector('.acct');
    clear(a);
    const pl = Store.current();
    if (!pl || pl.kind !== 'xtream' || !Catalog.provider()) return;
    try {
      const i = await Catalog.provider().info();
      clear(a);
      const l1 = el('div'); l1.appendChild(document.createTextNode(T('status') + ': ')); l1.appendChild(el('b', i.status === 'Active' ? 'ok' : 'bad', i.status === 'Active' ? T('active') : i.status || T('expired')));
      if (i.trial) l1.appendChild(document.createTextNode(' · ' + T('trial')));
      const l2 = el('div', '', T('expires') + ': ' + (i.exp ? fmtDate(i.exp) : T('never')) + (i.max ? ' · ' + T('connections') + ': ' + i.active + '/' + i.max : ''));
      a.appendChild(l1); a.appendChild(l2);
    } catch (e) { clear(a); a.appendChild(el('div', 'bad', errText(e))); }
  }
  drawCw(i, n, full) {
    const r = this.rec[i];
    if (!n.__c) { n.__c = el('div', 'cw'); n.__p = el('div', 'pic'); n.__b = el('div', 'bar'); n.__bi = el('i'); n.__b.appendChild(n.__bi); n.__p.appendChild(n.__b); n.__n = el('div', 'nm'); n.__s = el('div', 'sub'); n.__c.append(n.__p, n.__n, n.__s); n.appendChild(n.__c); }
    n.__n.textContent = r.name;
    n.__s.textContent = (r.kind === 'usb' ? 'USB · ' : r.kind === 'series' ? T('series') + ' · ' : '') + (r.d ? fmtTime(r.t) + ' / ' + fmtTime(r.d) : '');
    n.__bi.style.width = (r.d ? Math.min(100, r.t / r.d * 100) : 0) + '%';
    n.__p.style.backgroundImage = '';
    if (full && r.icon) { const k = r.key; Net.image(r.icon, (u) => { if (u && this.rec[i] && this.rec[i].key === k && n.__i === i) n.__p.style.backgroundImage = 'url("' + u + '")'; }); }
  }
  paint() {
    const z = this.zones[this.zone];
    this.tiles.forEach((t, i) => t.node.classList.toggle('f', z === 'tiles' && i === this.ti));
    this.acts.forEach((a, i) => a.node.classList.toggle('f', z === 'acts' && i === this.ai));
    this.row.active(z === 'row');
  }
  say() {
    const z = this.zones[this.zone];
    if (z === 'tiles') { const t = this.tiles[this.ti]; announce(t.t + '. ' + t.c()); }
    else if (z === 'acts') announce(this.acts[this.ai].t);
    else { const r = this.rec[this.row.index]; if (r) announce(T('continue') + ': ' + r.name); }
  }
  show(first) {
    this.build();
    if (first) this.say();
    UI.syncBack();
  }
  hide() { this.row.active(false); }
  destroy() { this.row.destroy(); this.root.remove(); }
  input(a, repeat) {
    const z = this.zones[this.zone];
    if (a === 'up' || a === 'down') {
      const n = this.zone + (a === 'down' ? 1 : -1);
      if (n >= 0 && n < this.zones.length) { this.zone = n; this.paint(); this.say(); }
      return;
    }
    if (a === 'left' || a === 'right') {
      const d = sideways(a);
      if (z === 'tiles') { const n = this.ti + d; if (n >= 0 && n < this.tiles.length) { this.ti = n; this.paint(); this.say(); } }
      else if (z === 'acts') { const n = this.ai + d; if (n >= 0 && n < this.acts.length) { this.ai = n; this.paint(); this.say(); } }
      else this.row.move(a);
      return;
    }
    if (a === 'ok') {
      if (z === 'tiles') this.openTile(this.tiles[this.ti].id);
      else if (z === 'acts') this.action(this.acts[this.ai].id);
      else this.resume(this.rec[this.row.index]);
      return;
    }
    if ((a === 'menu' || a === 'hold') && z === 'row') {
      const r = this.rec[this.row.index];
      if (!r) return;
      UI.menu(r.name, [{ label: T('play'), action: () => this.resume(r) }, { label: T('remove'), action: () => { Store.setProgress(r.key, null); this.build(); } }]);
      return;
    }
    if (a === 'search' && this.hasPl) { this.openTile('vod', true); return; }
    if (a === 'back') return false;
  }
  async openTile(id, search) {
    if (id === 'usb') { UI.push(new UsbScreen()); return; }
    if (!(await openKind(id))) return;
    if (id === 'live') UI.push(new LiveScreen());
    else { const s = new BrowseScreen(id); UI.push(s); if (search) s.search(); }
  }
  async resume(r) {
    if (!r) return;
    if (r.kind === 'usb') {
      if (!Usb.available()) { UI.toast(T('usbOnlyTv')); return; }
      // a film ("u<path>") or a show ("u#<show>", its last episode in x): the episodes after it in its folder come next
      const path = r.key[1] === '#' ? String(r.x || '') : r.key.slice(1), name = path.replace(/^.*\//, ''), dir = path.replace(/\/[^/]+$/, '');
      if (!path) return;
      const parts = dir.split('/'), ep = Usb.episodeOf(name, parts.slice(-2));
      const f = Object.assign({ name, path, dir }, ep || Usb.cleanName(name));
      let rest = null;
      if (ep) {
        try {
          rest = (await Usb.list(dir)).filter((x) => !x.dir).map((x) => Object.assign({ name: x.name, path: x.path, size: x.size, dir }, Usb.episodeOf(x.name, parts.slice(-2)) || {}))
            .filter((x) => x.show && fold(x.show) === fold(ep.show) && (x.season > ep.season || (x.season === ep.season && x.ep > ep.ep)))
            .sort((a, b) => a.season - b.season || a.ep - b.ep);
        } catch (e) { rest = null; }
      }
      const p = Store.progress('u' + path);
      playUsb(f, rest, p && p.d && p.t / p.d < 0.95 ? p.t : r.t);
      return;
    }
    const kind = r.kind === 'series' ? 'series' : 'vod';
    if (!(await openKind(kind))) return;
    const it = Catalog.byId(kind, r.key.slice(1));
    if (!it) { UI.toast(T('notFound')); return; }
    if (kind === 'vod') { let info = null; try { info = await Catalog.provider().vodInfo(it); } catch (e) {} Player.play(vodSpec(it, info, startOf('v' + it.i))); }
    else UI.push(new SeriesScreen(it, r.x));
  }
  action(id) {
    if (id === 'add') UI.push(new PlaylistForm(null));
    else if (id === 'demo') { const p = Store.putPlaylist({ kind: 'demo', name: 'Demo' }); usePlaylist(p.id); }
    else if (id === 'pls') UI.push(playlistsScreen());
    else if (id === 'set') UI.push(settingsScreen());
    else if (id === 'speed') UI.push(new SpeedScreen());
    else if (id === 'about') UI.alert(T('about'), T('aboutText', { v: APP_VERSION }) + '\n\n' + T('privacy'));
    else if (id === 'refresh') refreshAll();
  }
}
function usePlaylist(id) {
  Player.stopAll();
  Store.setCurrent(id);
  Catalog.reset(Store.current());
  UI.popTo(UI.stack()[0]);
  const h = UI.top();
  if (h && h.build) { h.zone = 0; h.build(); h.say(); }
}
async function refreshAll() {
  const b = UI.busy(T('checking'));
  let bad = null;
  for (const k of ['live', 'vod', 'series']) {
    if (!Catalog.loaded(k)) continue;
    try { await Catalog.refresh(k, false); } catch (e) { bad = e; }
  }
  b.close();
  if (bad) UI.alert(T('errTitle'), errText(bad)); else UI.toast(T('newer'));
  const h = UI.top(); if (h && h.build) h.build();
}

/* ======================================================================= MOVIES / SERIES */
class BrowseScreen {
  constructor(kind) {
    this.kind = kind;
    this.root = screenEl('browse', '<div class="side"><h2></h2><div class="cats"></div></div><div class="main"><div class="head"><h1></h1><span class="n"></span><div class="grow"></div><div class="chips"></div></div><div class="grid"></div><div class="empty hidden" style="top:480px;left:470px"></div><div class="hints"></div></div>');
    this.root.querySelector('.side h2').textContent = kind === 'vod' ? T('movies') : T('series');
    this.cats = Catalog.cats(kind);
    this.items = [];
    this.zone = 'cats'; this.ci = 0; this.q = '';
    const last = BrowseScreen.last[kind];
    if (last) { const i = this.cats.findIndex((c) => c.id === last); if (i >= 0) this.ci = i; }
    else { const i = this.cats.findIndex((c) => !c.special); this.ci = 0; if (i < 0) this.ci = 0; }
    this.cv = new VList(this.root.querySelector('.side .cats'), { itemH: 84, render: (i, n) => this.drawCat(i, n), onFocus: (i) => { announce(this.cats[i].name + (this.cats[i].n >= 0 ? ', ' + this.cats[i].n : '')); this.pickSoon(); } });
    const cols = Math.max(4, Math.min(9, Store.prefs().cols || 6)), cw = (1920 - 470 - 60) / cols;
    this.gv = new VList(this.root.querySelector('.main .grid'), { cols, itemH: Math.round(cw * 1.38) + 64, render: (i, n, full) => this.drawPost(i, n, full), onFocus: (i) => this.sayItem(i) });
    this.chips = [{ id: 'search', icon: 'search', t: T('search') }, { id: 'sort', icon: 'sort', t: '' }];
    const cb = this.root.querySelector('.chips');
    this.chips.forEach((c) => { const b = el('div', 'chip'); b.innerHTML = svg(c.icon); c.lab = el('span', '', c.t); b.appendChild(c.lab); c.node = b; cb.appendChild(b); });
    this.chi = 0;
    this.pickSoon = debounce(() => this.pick(), 260);
    UI.hints(this.root.querySelector('.hints'), [['b', T('hintOk')], ['x', T('hintFav')], ['y', T('hintSearch')], ['ch', T('hintPage')], ['plus', T('hintMenu')], ['a', T('hintBack')]]);
  }
  drawCat(i, n) {
    const c = this.cats[i];
    if (!n.__c) { n.__c = el('div', 'cat'); n.__ic = el('span', 'ico'); n.__nm = el('div', 'nm'); n.__n = el('div', 'n'); n.__c.append(n.__ic, n.__nm, n.__n); n.appendChild(n.__c); }
    n.__ic.innerHTML = c.special ? svg({ all: 'grid', fav: 'heart', recent: 'clock', foryou: 'star' }[c.special]) : c.pinned ? svg('pin') : '';
    n.__nm.textContent = c.name;
    n.__n.textContent = c.n >= 0 ? c.n : '';
    n.__c.classList.toggle('sel', i === this.ci && this.zone !== 'cats');
  }
  drawPost(i, n, full) {
    const it = this.items[i];
    if (!it) return;
    posterInit(n);
    n.__nt.textContent = it.n;
    n.__ph.textContent = initials(it.n);
    n.__rt.textContent = it.r ? (+it.r).toFixed(1) : '';
    n.__rt.style.display = it.r ? '' : 'none';
    n.__fv.style.display = Store.isFav(this.kind, it.i) ? '' : 'none';
    const p = this.kind === 'vod' ? Store.progress('v' + it.i) : Store.progress('s' + it.i);
    n.__bar.style.display = p && p.d ? '' : 'none';
    if (p && p.d) n.__bi.style.width = Math.min(100, p.t / p.d * 100) + '%';
    if (n.__img !== it.l) { n.__pic.style.backgroundImage = ''; n.__ph.style.display = ''; n.__img = ''; }
    if (full && it.l && n.__img !== it.l) {
      const want = it.l;
      if (n.__tk) n.__tk.cancel();
      n.__tk = Net.image(want, (u) => { if (u && n.__i === i && this.items[i] === it) { n.__pic.style.backgroundImage = 'url("' + u + '")'; n.__ph.style.display = 'none'; n.__img = want; } });
    }
  }
  sayItem(i) { const it = this.items[i]; if (it) announce(it.n + (it.r ? ', ' + (+it.r).toFixed(1) : '') + (Store.isFav(this.kind, it.i) ? ', ' + T('favorites') : '')); }
  async pick(force) {
    const c = this.cats[this.cv.index];
    if (!c) return;
    if (!force && this.q === '' && this.shown === c.id) return;
    this.q = '';
    this.ci = this.cv.index;
    BrowseScreen.last[this.kind] = c.id;
    if (Catalog.partial(this.kind) && !c.special && c.n < 0) {
      this.root.querySelector('.main h1').textContent = c.name;
      this.setItems([], T('loading'));
      try { await Catalog.loadCat(this.kind, c.id); } catch (e) { this.setItems([], errText(e)); return; }
      this.cats = Catalog.cats(this.kind); this.cv.refresh();
      if (this.cats[this.cv.index] !== c && this.cats[this.cv.index].id !== c.id) return;
    }
    this.shown = c.id;
    this.root.querySelector('.main h1').textContent = c.name;
    this.setItems(Catalog.list(this.kind, c.id, Store.prefs().sort[this.kind]), c.special === 'fav' ? T('favEmpty') : c.special === 'recent' ? T('recentEmpty') : T('empty'));
    this.cv.refresh();
  }
  setItems(l, emptyText) {
    this.items = l;
    this.root.querySelector('.main .head .n').textContent = l.length ? T('titles', { n: l.length }) : '';
    const e = this.root.querySelector('.main .empty');
    e.textContent = emptyText || '';
    e.classList.toggle('hidden', !!l.length);
    this.gv.setCount(l.length, 0);
    if (!l.length && this.zone === 'grid') this.setZone('cats');
  }
  paintChips() {
    const so = Store.prefs().sort[this.kind];
    this.chips[1].lab.textContent = T({ default: 'sortDefault', name: 'sortName', added: 'sortAdded', rating: 'sortRating' }[so] || 'sort');
    this.chips.forEach((c, i) => c.node.classList.toggle('f', this.zone === 'chips' && i === this.chi));
  }
  setZone(z) {
    this.zone = z;
    this.cv.active(z === 'cats');
    this.gv.active(z === 'grid');
    this.cv.refresh();
    this.paintChips();
    if (z === 'chips') announce(this.chips[this.chi].node.textContent);
    else if (z === 'grid') this.sayItem(this.gv.index);
  }
  show(first) {
    fillTop(this.root);
    if (first) { this.cv.setCount(this.cats.length, this.ci); this.setZone('cats'); this.pick(true); announce(this.root.querySelector('.side h2').textContent + '. ' + (this.cats[this.ci] ? this.cats[this.ci].name : '')); }
    else { this.cats = Catalog.cats(this.kind); this.cv.setCount(this.cats.length, this.cv.index); this.setZone(this.zone); this.gv.refresh(); }
  }
  hide() { this.cv.active(false); this.gv.active(false); }
  destroy() { this.cv.destroy(); this.gv.destroy(); this.root.remove(); }
  async search() {
    const q = await askText({ value: this.q, kind: 'search', label: T('searchIn', { x: this.kind === 'vod' ? T('movies') : T('series') }), ok: T('search') });
    if (q === null || q === undefined || !String(q).trim()) return;
    this.q = String(q).trim();
    this.shown = '';
    this.root.querySelector('.main h1').textContent = T('results', { q: this.q });
    this.setItems(Catalog.search(this.kind, this.q), T('noResults'));
    if (this.items.length) this.setZone('grid');
    announce(T('results', { q: this.q }) + ', ' + this.items.length);
  }
  sortMenu() {
    const cur = Store.prefs().sort[this.kind];
    UI.menu(T('sort'), ['default', 'name', 'added', 'rating'].map((k) => ({ label: T({ default: 'sortDefault', name: 'sortName', added: 'sortAdded', rating: 'sortRating' }[k]), checked: cur === k,
      action: () => { const s = Store.prefs().sort; s[this.kind] = k; Store.setPref('sort', s); this.paintChips(); if (this.q) { this.setItems(Catalog.search(this.kind, this.q)); } else this.pick(true); } })));
  }
  open(it) { if (this.kind === 'vod') UI.push(new MovieScreen(it)); else UI.push(new SeriesScreen(it)); }
  fav(it) {
    const on = Store.toggleFav(this.kind, it.i);
    Catalog.invalidate(this.kind);
    UI.toast(on ? T('favAdded') : T('favRemoved'));
    this.gv.refreshIndex(this.gv.index);
    const fc = this.cats.find((c) => c.special === 'fav'); if (fc) fc.n = Store.pl().fav[this.kind].length;
    this.cv.refresh();
    if (this.shown === '*fav' && !on) { const i = this.gv.index; this.setItems(Catalog.list(this.kind, '*fav'), T('favEmpty')); this.gv.focus(Math.min(i, this.items.length - 1)); }
  }
  input(a, repeat) {
    if (a === 'back') {
      if (this.q) { this.q = ''; this.pick(true); this.setZone('cats'); return true; }
      if (this.zone !== 'cats') { this.setZone('cats'); return true; }
      return false;
    }
    if (a === 'search') { this.search(); return; }
    if (this.zone === 'cats') {
      if (a === 'up' || a === 'down') { this.cv.move(a); return; }
      if (a === 'pageUp' || a === 'pageDown') { this.cv.page(a === 'pageUp' ? -1 : 1); return; }
      if (a === 'ok' || (a === 'right' && !rtlOn()) || (a === 'left' && rtlOn())) { this.pickSoon.cancel(); this.pick(); if (this.items.length) this.setZone('grid'); return; }
      if (a === 'menu' || a === 'hold') { this.catMenu(this.cats[this.cv.index]); return; }
      return;
    }
    if (this.zone === 'chips') {
      if (a === 'left' || a === 'right') { const n = this.chi + sideways(a); if (n >= 0 && n < this.chips.length) { this.chi = n; this.paintChips(); announce(this.chips[n].node.textContent); } else if (n < 0) this.setZone('cats'); return; }
      if (a === 'down') { if (this.items.length) this.setZone('grid'); return; }
      if (a === 'ok') { if (this.chips[this.chi].id === 'search') this.search(); else this.sortMenu(); return; }
      return;
    }
    // grid
    const it = this.items[this.gv.index];
    if (a === 'up') { if (!this.gv.move('up')) this.setZone('chips'); return; }
    if (a === 'down') { this.gv.move('down'); return; }
    if (a === 'left' || a === 'right') { if (!this.gv.move(a) && sideways(a) < 0) this.setZone('cats'); return; }
    if (a === 'pageUp' || a === 'pageDown') { this.gv.page(a === 'pageUp' ? -1 : 1); return; }
    if (!it) return;
    if (a === 'ok') { this.open(it); return; }
    if (a === 'fav') { this.fav(it); return; }
    if (a === 'menu' || a === 'hold') {
      const fav = Store.isFav(this.kind, it.i);
      const items = [{ label: this.kind === 'vod' ? T('play') : T('episodes'), action: () => this.kind === 'vod' ? playMovie(it) : this.open(it) }, { label: T('info'), action: () => this.open(it) },
                     { label: fav ? T('delFav') : T('addFav'), action: () => this.fav(it) }];
      if (Store.progress((this.kind === 'vod' ? 'v' : 's') + it.i)) items.push({ label: T('remove') + ': ' + T('recent'), action: () => { Store.setProgress((this.kind === 'vod' ? 'v' : 's') + it.i, null); this.gv.refreshIndex(this.gv.index); } });
      UI.menu(it.n, items);
    }
  }
  catMenu(c) {
    if (!c || c.special) return;
    const st = Store.catState(this.kind, c.id);
    UI.menu(c.name, [{ label: st.pinned ? T('unpin') : T('pin'), action: () => { Store.setCat(this.kind, c.id, 'pin', !st.pinned); this.reCats(c.id); } },
                     { label: T('hide'), action: () => { Store.setCat(this.kind, c.id, 'hide', true); Catalog.invalidate(this.kind); this.reCats(); } }]);
  }
  reCats(keepId) {
    this.cats = Catalog.cats(this.kind);
    let i = keepId ? this.cats.findIndex((x) => x.id === keepId) : this.cv.index;
    this.cv.setCount(this.cats.length, Math.max(0, Math.min(this.cats.length - 1, i)));
    this.pick(true);
  }
}
BrowseScreen.last = {};

async function playMovie(it) {
  let info = null;
  try { info = await Catalog.provider().vodInfo(it); } catch (e) {}
  Player.play(vodSpec(it, info, startOf('v' + it.i)));
}

/* ======================================================================= A FILM */
class MovieScreen {
  constructor(it) {
    this.it = it;
    this.root = screenEl('details', '<div class="det-bg"></div><div class="det-shade"></div>' + topHtml() + '<div class="det"><div class="poster"></div><div class="info"><h1></h1><div class="meta"></div><div class="plot"></div><div class="more"></div><div class="acts"></div></div></div><div class="hints"></div>');
    this.root.querySelector('h1').textContent = it.n;
    this.bi = 0; this.info = null;
    UI.hints(this.root.querySelector('.hints'), [['b', T('hintOk')], ['x', T('hintFav')], ['a', T('hintBack')]]);
    if (it.l) Net.image(it.l, (u) => { if (u) this.root.querySelector('.poster').style.backgroundImage = 'url("' + u + '")'; });
    this.meta();
    this.load();
  }
  async load() {
    try { this.info = await Catalog.provider().vodInfo(this.it); } catch (e) { this.info = null; }
    if (!this.root.isConnected) return;
    const i = this.info || {};
    this.root.querySelector('.plot').textContent = i.plot || '';
    const more = this.root.querySelector('.more');
    clear(more);
    [[T('genre'), i.genre], [T('director'), i.director], [T('cast'), i.cast]].forEach((r) => { if (!r[1]) return; const d = el('div'); d.appendChild(el('b', '', r[0] + ': ')); d.appendChild(document.createTextNode(String(r[1]).slice(0, 220))); more.appendChild(d); });
    if (i.back) Net.image(i.back, (u) => { if (u) this.root.querySelector('.det-bg').style.backgroundImage = 'url("' + u + '")'; });
    if (i.poster && i.poster !== this.it.l) Net.image(i.poster, (u) => { if (u) this.root.querySelector('.poster').style.backgroundImage = 'url("' + u + '")'; });
    this.meta();
  }
  meta() {
    const i = this.info || {}, m = this.root.querySelector('.meta');
    clear(m);
    const y = this.it.y || (i.date ? String(i.date).slice(0, 4) : '');
    if (y) m.appendChild(el('span', '', y));
    const r = i.rating || this.it.r;
    if (r) m.appendChild(el('span', 'rt', '★ ' + (+r).toFixed(1)));
    if (i.dur) m.appendChild(el('span', '', T('min', { n: Math.round(i.dur / 60) })));
    if (i.h >= 2000) m.appendChild(el('span', 'badge', '4K')); else if (i.h >= 1000) m.appendChild(el('span', 'badge', 'FHD')); else if (i.h >= 700) m.appendChild(el('span', 'badge', 'HD'));
    if (this.it.a) m.appendChild(el('span', '', T('addedOn', { d: fmtDate(this.it.a * 1000) })));
    this.buttons();
  }
  buttons() {
    const p = Store.progress('v' + this.it.i), st = startOf('v' + this.it.i), fav = Store.isFav('vod', this.it.i);
    this.btns = [];
    if (st) this.btns.push({ id: 'resume', icon: 'play', t: T('resume', { t: fmtTime(st) }), primary: true }, { id: 'start', icon: 'restart', t: T('fromStart') });
    else this.btns.push({ id: 'play', icon: 'play', t: T('play'), primary: true });
    this.btns.push({ id: 'fav', icon: 'heart', t: fav ? T('delFav') : T('addFav') });
    const b = this.root.querySelector('.acts');
    clear(b);
    this.btns.forEach((x) => { const n = el('button', 'btn' + (x.primary ? ' primary' : '')); n.innerHTML = svg(x.icon); n.appendChild(el('span', '', x.t)); x.node = n; b.appendChild(n); });
    this.bi = Math.min(this.bi, this.btns.length - 1);
    this.paint();
    if (p && p.d) { /* progress shown in the Resume button */ }
  }
  paint() { this.btns.forEach((x, i) => x.node.classList.toggle('f', i === this.bi)); }
  show(first) { fillTop(this.root, T('movies')); if (!first) this.buttons(); announce(this.it.n + '. ' + this.btns[this.bi].t); }
  hide() {}
  destroy() { this.root.remove(); }
  input(a) {
    if (a === 'left' || a === 'right') { const n = this.bi + sideways(a); if (n >= 0 && n < this.btns.length) { this.bi = n; this.paint(); announce(this.btns[n].t); } return; }
    if (a === 'fav') { this.toggleFav(); return; }
    if (a === 'ok') {
      const id = this.btns[this.bi].id;
      if (id === 'fav') this.toggleFav();
      else Player.play(vodSpec(this.it, this.info, id === 'resume' ? startOf('v' + this.it.i) : 0));
      return;
    }
    if (a === 'back') return false;
  }
  toggleFav() { const on = Store.toggleFav('vod', this.it.i); Catalog.invalidate('vod'); UI.toast(on ? T('favAdded') : T('favRemoved')); this.buttons(); }
}

/* ======================================================================= A SERIES (also a TV show of a USB drive) */
class SeriesScreen {
  // it = a series of the playlist; lastEp = the episode id to focus (Continue watching); src = a USB show instead
  constructor(it, lastEp, src) {
    this.it = it; this.src = src || null; this.lastEp = lastEp || '';
    this.root = screenEl('details series', '<div class="det-bg"></div><div class="det-shade"></div>' + topHtml() + '<div class="det"><div class="poster"></div><div class="info"><h1></h1><div class="meta"></div><div class="plot short"></div><div class="acts"></div><div class="seasons"></div><div class="eps"></div></div></div><div class="hints"></div>');
    this.root.querySelector('h1').textContent = it.n;
    this.seasons = []; this.si = 0; this.eps = []; this.zone = 'eps'; this.bi = 0; this.info = null;
    this.ev = new VList(this.root.querySelector('.eps'), { itemH: 92, render: (i, n, full) => this.drawEp(i, n, full), onFocus: (i) => this.sayEp(i) });
    UI.hints(this.root.querySelector('.hints'), [['b', T('hintOk')], ['lr', T('season', { n: '' }).trim()], ['x', T('hintFav')], ['plus', T('hintMenu')], ['a', T('hintBack')]]);
    if (it.l) Net.image(it.l, (u) => { if (u) this.root.querySelector('.poster').style.backgroundImage = 'url("' + u + '")'; });
    if (this.src && this.src.picture) this.src.picture((u) => { if (u) this.root.querySelector('.poster').style.backgroundImage = 'url("' + u + '")'; });
    this.load();
  }
  async load() {
    const box = this.root.querySelector('.plot');
    if (this.src) this.info = { seasons: this.src.seasons, plot: '' };
    else {
      box.textContent = T('loading');
      try { this.info = await Catalog.provider().seriesInfo(this.it); } catch (e) { box.textContent = errText(e); this.info = null; return; }
    }
    if (!this.root.isConnected) return;
    const i = this.info;
    box.textContent = i.plot || '';
    const m = this.root.querySelector('.meta');
    clear(m);
    if (i.date) m.appendChild(el('span', '', String(i.date).slice(0, 4)));
    if (i.rating || this.it.r) m.appendChild(el('span', 'rt', '★ ' + (+(i.rating || this.it.r)).toFixed(1)));
    if (i.genre) m.appendChild(el('span', '', i.genre));
    if (i.back) Net.image(i.back, (u) => { if (u) this.root.querySelector('.det-bg').style.backgroundImage = 'url("' + u + '")'; });
    this.seasons = Object.keys(i.seasons || {}).filter((k) => i.seasons[k] && i.seasons[k].length).sort((a, b) => +a - +b);
    this.flat = [];
    this.seasons.forEach((s) => i.seasons[s].forEach((e) => this.flat.push(e)));
    // the episode to start on: the one to resume, else the first
    let want = this.lastEp;
    if (!want) { const p = Store.progress(this.parentKey()); if (p && p.x) want = String(p.x); }
    let si = 0, ei = 0;
    if (want) this.seasons.forEach((s, k) => { const j = i.seasons[s].findIndex((e) => String(e.id) === String(want)); if (j >= 0) { si = k; ei = j; } });
    const sb = this.root.querySelector('.seasons');
    clear(sb);
    this.chips = this.seasons.map((s) => { const c = el('div', 'chip', T('season', { n: s })); sb.appendChild(c); return c; });
    this.setSeason(si, ei);
    this.buttons();
    this.setZone('eps');
  }
  parentKey() { return this.src ? 'u#' + this.src.key : 's' + this.it.i; }
  epKey(e) { return this.src ? 'u' + e.path : 'e' + e.id; }
  setSeason(k, focus) {
    this.si = Math.max(0, Math.min(this.seasons.length - 1, k));
    this.eps = this.seasons.length ? this.info.seasons[this.seasons[this.si]] : [];
    (this.chips || []).forEach((c, i) => { c.classList.toggle('sel', i === this.si); });
    this.ev.setCount(this.eps.length, focus || 0);
    const c = this.chips && this.chips[this.si];
    if (c) { const sb = this.root.querySelector('.seasons'); const x = c.offsetLeft - sb.clientWidth / 2 + c.offsetWidth / 2; sb.scrollLeft = Math.max(0, x); }
  }
  buttons() {
    const fav = !this.src && Store.isFav('series', this.it.i);
    this.btns = [];
    const p = Store.progress(this.parentKey());
    if (p && p.x && !this.src) {
      const e = this.flat.find((x) => String(x.id) === String(p.x));
      if (e) this.btns.push({ id: 'resume', icon: 'play', t: T('resume', { t: 'S' + pad2(e.season) + 'E' + pad2(e.num) }), primary: true, e });
    }
    if (!this.src) this.btns.push({ id: 'fav', icon: 'heart', t: fav ? T('delFav') : T('addFav') });
    const b = this.root.querySelector('.acts');
    clear(b);
    this.btns.forEach((x) => { const n = el('button', 'btn' + (x.primary ? ' primary' : '')); n.innerHTML = svg(x.icon); n.appendChild(el('span', '', x.t)); x.node = n; b.appendChild(n); });
    this.bi = Math.min(this.bi, Math.max(0, this.btns.length - 1));
    this.paint();
  }
  drawEp(i, n) {
    const e = this.eps[i];
    if (!n.__r) { n.__r = el('div', 'row ep'); n.__no = el('div', 'no'); n.__nm = el('div', 'nm'); n.__sm = el('div', 'sm'); n.__pg = el('div', 'epbar'); n.__pi = el('i'); n.__pg.appendChild(n.__pi); n.__r.append(n.__no, n.__nm, n.__sm, n.__pg); n.appendChild(n.__r); }
    n.__no.textContent = 'E' + pad2(e.num || e.ep || i + 1);
    n.__nm.textContent = e.title || (this.src ? e.name : T('episode', { n: e.num }));
    const p = Store.progress(this.epKey(e));
    n.__sm.textContent = p && p.d ? fmtTime(p.t) + ' / ' + fmtTime(p.d) : e.dur ? T('min', { n: Math.round(e.dur / 60) }) : this.src && e.size ? fmtSize(e.size) : '';
    n.__pg.style.display = p && p.d ? '' : 'none';
    if (p && p.d) n.__pi.style.width = Math.min(100, p.t / p.d * 100) + '%';
    n.__r.classList.toggle('playing', !!(p && p.d && p.t / p.d > 0.9));
  }
  sayEp(i) { const e = this.eps[i]; if (e) announce(T('season', { n: this.seasons[this.si] }) + ', ' + T('episode', { n: e.num || e.ep || i + 1 }) + (e.title ? ', ' + e.title : '')); }
  paint() {
    this.btns.forEach((x, i) => x.node.classList.toggle('f', this.zone === 'acts' && i === this.bi));
    (this.chips || []).forEach((c, i) => c.classList.toggle('f', this.zone === 'seasons' && i === this.si));
    this.ev.active(this.zone === 'eps');
  }
  setZone(z) {
    if (z === 'acts' && !this.btns.length) z = 'seasons';
    if (z === 'seasons' && this.seasons.length < 2) z = this.btns.length ? 'acts' : 'eps';
    this.zone = z; this.paint();
    if (z === 'acts') announce(this.btns[this.bi].t); else if (z === 'seasons') announce(T('season', { n: this.seasons[this.si] })); else this.sayEp(this.ev.index);
  }
  specFor(e, start) {
    const pv = Catalog.provider(), it = this.it;
    const k = this.flat.indexOf(e), nx = k >= 0 ? this.flat[k + 1] : null;
    const label = 'S' + pad2(e.season) + 'E' + pad2(e.num) + (e.title && !/^episode \d+$/i.test(e.title) ? ' · ' + e.title : '');
    return { kind: 'series', id: e.id, title: it.n, sub: label, icon: it.l || e.pic || '', url: pv.url('series', it, e), key: 'e' + e.id, parentKey: 's' + it.i, parentTitle: it.n,
             start: start || 0, fav: { kind: 'series', id: it.i }, next: nx ? () => this.specFor(nx, startOf('e' + nx.id)) : null,
             meta: { name: it.n, tmdb_id: (this.info && this.info.tmdb) || '', season: e.season, episode_num: e.num, year: it.y || '' }, metaKind: 'series' };
  }
  play(e, start) {
    if (!e) return;
    if (this.src) { const k = this.flat.indexOf(e); playUsb(e, this.flat.slice(k + 1), start === undefined ? startOf('u' + e.path) : start, this.src); return; }
    Player.play(this.specFor(e, start === undefined ? startOf('e' + e.id) : start));
  }
  show(first) { fillTop(this.root, this.src ? T('usbShows') : T('series')); if (!first && this.info) { this.ev.refresh(); this.buttons(); } if (first) announce(this.it.n); }
  hide() { this.ev.active(false); }
  destroy() { this.ev.destroy(); this.root.remove(); }
  input(a) {
    if (a === 'back') { if (this.zone !== 'eps' && this.eps.length) { this.setZone('eps'); return true; } return false; }
    if (!this.info) return;
    if (a === 'fav' && !this.src) { this.toggleFav(); return; }
    if (a === 'pageUp' || a === 'pageDown') { if (this.zone === 'eps' && this.eps.length > 8) this.ev.page(a === 'pageUp' ? -1 : 1); else this.setSeason(this.si + (a === 'pageUp' ? -1 : 1)); return; }
    if (this.zone === 'eps') {
      if (a === 'up') { if (!this.ev.move('up')) this.setZone('seasons'); return; }
      if (a === 'down') { this.ev.move('down'); return; }
      if (a === 'left' || a === 'right') { const n = this.si + sideways(a); if (n >= 0 && n < this.seasons.length) { this.setSeason(n); this.sayEp(0); } return; }
      if (a === 'ok') { this.play(this.eps[this.ev.index]); return; }
      if (a === 'menu' || a === 'hold') {
        const e = this.eps[this.ev.index], s = startOf(this.epKey(e));
        const items = [];
        if (s) items.push({ label: T('resume', { t: fmtTime(s) }), action: () => this.play(e, s) });
        items.push({ label: T('fromStart'), action: () => this.play(e, 0) });
        if (Store.progress(this.epKey(e))) items.push({ label: T('remove') + ': ' + T('recent'), action: () => { Store.setProgress(this.epKey(e), null); this.ev.refreshIndex(this.ev.index); } });
        UI.menu(this.root.querySelector('h1').textContent + ' · E' + pad2(e.num || e.ep || this.ev.index + 1), items);
      }
      return;
    }
    if (this.zone === 'seasons') {
      if (a === 'left' || a === 'right') { const n = this.si + sideways(a); if (n >= 0 && n < this.seasons.length) { this.setSeason(n); this.paint(); announce(T('season', { n: this.seasons[n] })); } return; }
      if (a === 'down' || a === 'ok') { this.setZone('eps'); return; }
      if (a === 'up') { this.setZone('acts'); return; }
      return;
    }
    if (a === 'left' || a === 'right') { const n = this.bi + sideways(a); if (n >= 0 && n < this.btns.length) { this.bi = n; this.paint(); announce(this.btns[n].t); } return; }
    if (a === 'down') { this.setZone(this.seasons.length > 1 ? 'seasons' : 'eps'); return; }
    if (a === 'ok') { const b = this.btns[this.bi]; if (b.id === 'fav') this.toggleFav(); else if (b.id === 'resume') this.play(b.e); }
  }
  toggleFav() { const on = Store.toggleFav('series', this.it.i); Catalog.invalidate('series'); UI.toast(on ? T('favAdded') : T('favRemoved')); this.buttons(); }
}

/* ======================================================================= LIVE TV */
class LiveScreen {
  constructor() {
    this.root = screenEl('live', '<div class="side"><h2></h2><div class="cats"></div></div><div class="live-ch"><h2></h2><div class="chs"></div><div class="empty hidden" style="top:420px"></div></div>' +
      '<div class="live-pv"><div class="pv-top"></div><div class="pv-l"></div><div class="pv-r"></div><div class="pv-box"><div class="pv-msg"></div></div><div class="pv-info"><div class="ch"></div><div class="epg"></div><div class="note pvh"></div></div></div><div class="hints"></div>');
    this.root.querySelector('.side h2').textContent = T('live');
    this.cats = Catalog.cats('live');
    this.zone = 'cats'; this.items = []; this.q = '';
    let ci = this.cats.findIndex((c) => c.id === LiveScreen.lastCat);
    if (ci < 0) ci = this.cats.findIndex((c) => !c.special && c.n !== 0);
    this.ci = Math.max(0, ci);
    this.cv = new VList(this.root.querySelector('.side .cats'), { itemH: 84, render: (i, n) => BrowseScreen.prototype.drawCat.call(this, i, n), onFocus: (i) => { announce(this.cats[i].name + (this.cats[i].n >= 0 ? ', ' + this.cats[i].n : '')); this.pickSoon(); } });
    this.lv = new VList(this.root.querySelector('.chs'), { itemH: 88, render: (i, n, full) => this.drawCh(i, n, full), onFocus: (i) => { this.sayCh(i); this.infoSoon(); } });
    this.box = this.root.querySelector('.pv-box');
    this.pickSoon = debounce(() => this.pick(), 260);
    this.infoSoon = debounce(() => this.drawInfo(this.items[this.lv.index]), 500);
    this.root.querySelector('.pvh').textContent = T('pvHint');
    this.root.querySelector('.pv-msg').textContent = T('pvPick');
    UI.hints(this.root.querySelector('.hints'), [['b', T('hintOk')], ['x', T('hintFav')], ['y', T('hintSearch')], ['ch', T('hintPage')], ['plus', T('hintMenu')], ['a', T('hintBack')]]);
    this.epg = new Map();
    Player.onZap((s) => this.zapped(s));
  }
  drawCh(i, n, full) {
    const it = this.items[i];
    if (!n.__r) { n.__r = el('div', 'row'); n.__no = el('div', 'no'); n.__lg = el('div', 'lg'); n.__nm = el('div', 'nm'); n.__fv = document.createElement('span'); n.__fv.innerHTML = svg('heart'); n.__fv.firstChild.setAttribute('class', 'favi'); n.__r.append(n.__no, n.__lg, n.__nm, n.__fv); n.appendChild(n.__r); }
    n.__no.textContent = it.no || i + 1;
    n.__nm.textContent = it.n;
    n.__fv.style.display = Store.isFav('live', it.i) ? '' : 'none';
    const cur = Player.current();
    n.__r.classList.toggle('playing', !!(cur && cur.live && cur.item && cur.item.i === it.i));
    if (n.__img !== it.l) { n.__lg.style.backgroundImage = ''; n.__img = ''; }
    if (full && it.l && n.__img !== it.l) { const want = it.l; Net.image(want, (u) => { if (u && n.__i === i && this.items[i] === it) { n.__lg.style.backgroundImage = 'url("' + u + '")'; n.__img = want; } }); }
  }
  sayCh(i) { const it = this.items[i]; if (it) announce((it.no ? it.no + ' ' : '') + it.n + (Store.isFav('live', it.i) ? ', ' + T('favorites') : '')); }
  async drawInfo(it) {
    const box = this.root.querySelector('.pv-info');
    box.querySelector('.ch').textContent = it ? (it.no ? it.no + ' · ' : '') + it.n : '';
    const eb = box.querySelector('.epg');
    clear(eb);
    if (!it) return;
    let l = this.epg.get(it.i);
    if (!l || Date.now() - l.at > 300000) {
      try { l = { at: Date.now(), v: await Catalog.provider().epg(it) }; } catch (e) { l = { at: Date.now(), v: [] }; }
      this.epg.set(it.i, l);
      if (this.epg.size > 300) this.epg.delete(this.epg.keys().next().value);
    }
    if (this.items[this.lv.index] !== it && !(Player.current() && Player.current().item === it)) return;
    clear(eb);
    if (!l.v.length) { eb.appendChild(el('div', 'ds', T('noEpg'))); return; }
    l.v.slice(0, 3).forEach((p, k) => {
      const b = el('div', 'it');
      b.appendChild(el('div', 'tm', (k === 0 ? T('nowOn') : T('next')) + ' · ' + fmtClock(new Date(p.start)) + ' – ' + fmtClock(new Date(p.end))));
      b.appendChild(el('div', 'tl', p.title));
      if (k === 0) { if (p.desc) b.appendChild(el('div', 'ds', p.desc)); const g = el('div', 'pg'), x = el('i'); x.style.width = Math.max(0, Math.min(100, (Date.now() - p.start) / (p.end - p.start) * 100)) + '%'; g.appendChild(x); b.appendChild(g); }
      eb.appendChild(b);
    });
  }
  async pick(force) {
    const c = this.cats[this.cv.index];
    if (!c) return;
    if (!force && !this.q && this.shown === c.id) return;
    this.q = '';
    LiveScreen.lastCat = c.id;
    if (Catalog.partial('live') && !c.special && c.n < 0) {
      this.setItems([], T('loading'), c.name);
      try { await Catalog.loadCat('live', c.id); } catch (e) { this.setItems([], errText(e), c.name); return; }
      this.cats = Catalog.cats('live'); this.cv.refresh();
    }
    this.shown = c.id;
    this.setItems(Catalog.list('live', c.id, Store.prefs().sort.live), c.special === 'fav' ? T('favEmpty') : c.special === 'recent' ? T('recentEmpty') : T('empty'), c.name);
    this.cv.refresh();
  }
  setItems(l, emptyText, title) {
    this.items = l;
    this.listName = title;
    this.root.querySelector('.live-ch h2').textContent = title + (l.length ? ' · ' + l.length : '');
    const e = this.root.querySelector('.live-ch .empty');
    e.textContent = emptyText || ''; e.classList.toggle('hidden', !!l.length);
    const cur = Player.current();
    let f = 0;
    if (cur && cur.live && cur.item) { const k = l.findIndex((x) => x.i === cur.item.i); if (k >= 0) f = k; }
    this.lv.setCount(l.length, f);
    if (!l.length && this.zone === 'ch') this.setZone('cats');
  }
  setZone(z) { this.zone = z; this.cv.active(z === 'cats'); this.lv.active(z === 'ch'); this.cv.refresh(); if (z === 'ch') { this.sayCh(this.lv.index); this.infoSoon(); } }
  zapped(s) {
    if (!this.root.isConnected) return;
    this.lv.refresh();
    if (!s) { this.root.querySelector('.pv-msg').textContent = T('pvPick'); return; }
    if (s.list === this.items) { this.lv.focus(s.index); }
    this.drawInfo(s.item);
  }
  show(first) {
    fillTop(this.root);
    if (first) { this.cv.setCount(this.cats.length, this.ci); this.setZone('cats'); this.pick(true); announce(T('live') + '. ' + (this.cats[this.ci] ? this.cats[this.ci].name : '')); }
    else { this.lv.refresh(); this.setZone(this.zone); Player.placeBox(this.box); }
  }
  hide() { this.cv.active(false); this.lv.active(false); }
  destroy() { Player.onZap(null); Player.stopPreview(); this.cv.destroy(); this.lv.destroy(); this.root.remove(); }
  async search() {
    const q = await askText({ value: this.q, kind: 'search', label: T('searchIn', { x: T('live') }), ok: T('search') });
    if (q === null || q === undefined || !String(q).trim()) return;
    this.q = String(q).trim(); this.shown = '';
    this.setItems(Catalog.search('live', this.q), T('noResults'), T('results', { q: this.q }));
    if (this.items.length) this.setZone('ch');
  }
  watch(i) {
    const it = this.items[i];
    if (!it) return;
    const cur = Player.current();
    if (cur && cur.live && cur.item && cur.item.i === it.i && Player.mode() === 'preview') { Player.full(); return; }
    Player.preview(liveSpec(it, i, this.items, this.listName), this.box);
    this.lv.refresh();
    this.drawInfo(it);
  }
  fav(it) {
    const on = Store.toggleFav('live', it.i);
    Catalog.invalidate('live');
    UI.toast(on ? T('favAdded') : T('favRemoved'));
    const fc = this.cats.find((c) => c.special === 'fav'); if (fc) fc.n = Store.pl().fav.live.length;
    this.cv.refresh(); this.lv.refreshIndex(this.lv.index);
    if (this.shown === '*fav' && !on) { const i = this.lv.index; this.setItems(Catalog.list('live', '*fav'), T('favEmpty'), this.listName); this.lv.focus(Math.min(i, this.items.length - 1)); }
  }
  input(a, repeat) {
    if (a === 'back') {
      if (this.q) { this.q = ''; this.pick(true); return true; }
      if (this.zone === 'ch') { this.setZone('cats'); return true; }
      return false;
    }
    if (a === 'search') { this.search(); return; }
    if (this.zone === 'cats') {
      if (a === 'up' || a === 'down') { this.cv.move(a); return; }
      if (a === 'pageUp' || a === 'pageDown') { this.cv.page(a === 'pageUp' ? -1 : 1); return; }
      if (a === 'ok' || sideways(a) > 0 && (a === 'left' || a === 'right')) { this.pickSoon.cancel(); this.pick(); if (this.items.length) this.setZone('ch'); return; }
      if (a === 'menu' || a === 'hold') { BrowseScreen.prototype.catMenu.call(Object.assign(Object.create(BrowseScreen.prototype), { kind: 'live', cats: this.cats, cv: this.cv, reCats: (k) => { this.cats = Catalog.cats('live'); this.cv.setCount(this.cats.length, Math.max(0, k ? this.cats.findIndex((x) => x.id === k) : Math.min(this.cv.index, this.cats.length - 1))); this.pick(true); } }), this.cats[this.cv.index]); return; }
      return;
    }
    const it = this.items[this.lv.index];
    if (a === 'up' || a === 'down') { this.lv.move(a); return; }
    if (a === 'pageUp' || a === 'pageDown') { this.lv.page(a === 'pageUp' ? -1 : 1); return; }
    if (a === 'left' || a === 'right') { if (sideways(a) < 0) this.setZone('cats'); else if (Player.mode() === 'preview') Player.full(); return; }
    if (!it) return;
    if (a === 'ok') { this.watch(this.lv.index); return; }
    if (a === 'fav') { this.fav(it); return; }
    if (a === 'playPause') { this.watch(this.lv.index); return; }
    if (a === 'menu' || a === 'hold') {
      UI.menu(it.n, [{ label: T('play'), action: () => { this.watch(this.lv.index); if (Player.mode() === 'preview') Player.full(); } },
                     { label: Store.isFav('live', it.i) ? T('delFav') : T('addFav'), action: () => this.fav(it) }]);
    }
  }
}
LiveScreen.lastCat = '';

/* ======================================================================= USB */
async function playUsb(f, rest, start, show) {
  const b = UI.busy(T('loading'));
  let side = { files: [] };
  try { side = await Usb.spec(f); } catch (e) {}
  b.close();
  const spec = { kind: 'usb', id: f.path, title: f.show || f.title || f.name, sub: f.show ? 'S' + pad2(f.season) + 'E' + pad2(f.ep) : (f.year || '') + (f.size ? (f.year ? ' · ' : '') + fmtSize(f.size) : ''),
                 icon: '', url: f.path, key: 'u' + f.path, start: start || 0, files: side.files,
                 meta: f.show ? { name: f.show, season: f.season, episode_num: f.ep } : { name: f.title || stripExt(f.name), year: f.year || '' }, metaKind: f.show ? 'series' : 'movie' };
  usbEpisode(spec, f);
  if (rest && rest.length) spec.next = () => { const n = rest[0]; return n ? usbNextSpec(n, rest.slice(1), side) : null; };
  Player.play(spec);
}
// an episode of a USB show: Continue watching keeps the show once (key "u#<show>", the episode in x), never each episode
function usbEpisode(spec, f) {
  if (!f.show) return;
  spec.kind = 'usbep'; spec.parentKey = 'u#' + fold(f.show); spec.parentTitle = f.show; spec.parentKind = 'usb';
}
function usbNextSpec(f, rest) {
  // the next episode of a USB show: its subtitles are looked up when it starts
  const s = { kind: 'usb', id: f.path, title: f.show || f.title || f.name, sub: f.show ? 'S' + pad2(f.season) + 'E' + pad2(f.ep) : '', icon: '', url: f.path, key: 'u' + f.path, start: 0, files: [],
              meta: f.show ? { name: f.show, season: f.season, episode_num: f.ep } : { name: f.title }, metaKind: f.show ? 'series' : 'movie' };
  usbEpisode(s, f);
  Usb.spec(f).then((x) => { s.files.push.apply(s.files, x.files); }).catch(() => {});
  if (rest.length) s.next = () => usbNextSpec(rest[0], rest.slice(1));
  return s;
}

class UsbScreen {
  constructor() {
    this.root = screenEl('browse usb', '<div class="side"><h2></h2><div class="cats"></div></div><div class="main"><div class="head"><h1></h1><span class="n"></span><div class="grow"></div></div><div class="grid"></div><div class="empty hidden" style="top:440px;left:0;right:0"></div><div class="hints"></div></div>');
    this.root.querySelector('.side h2').textContent = T('usb');
    this.drivesL = []; this.tabs = []; this.zone = 'cats'; this.items = []; this.view = ''; this.path = ''; this.lib = null;
    this.cv = new VList(this.root.querySelector('.side .cats'), { itemH: 84, render: (i, n) => this.drawTab(i, n), onFocus: (i) => { announce(this.tabs[i].name); this.pickSoon(); } });
    this.makeGrid('grid');
    this.pickSoon = debounce(() => this.pick(), 260);
    UI.hints(this.root.querySelector('.hints'), [['b', T('hintOk')], ['plus', T('hintMenu')], ['a', T('hintBack')]]);
  }
  makeGrid(kind) {
    if (this.gv) this.gv.destroy();
    this.gkind = kind;
    const box = this.root.querySelector('.main .grid');
    if (kind === 'grid') { const cols = 6, cw = (1920 - 470 - 60) / cols; this.gv = new VList(box, { cols, itemH: Math.round(cw * 1.38) + 64, render: (i, n, full) => this.drawPost(i, n, full), onFocus: (i) => this.sayItem(i) }); }
    else this.gv = new VList(box, { itemH: 92, render: (i, n) => this.drawRow(i, n), onFocus: (i) => this.sayItem(i) });
  }
  drawTab(i, n) {
    const t = this.tabs[i];
    if (!n.__c) { n.__c = el('div', 'cat'); n.__ic = el('span', 'ico'); n.__nm = el('div', 'nm'); n.__n = el('div', 'n'); n.__c.append(n.__ic, n.__nm, n.__n); n.appendChild(n.__c); }
    n.__ic.innerHTML = svg(t.icon); n.__nm.textContent = t.name; n.__n.textContent = t.n >= 0 ? t.n : '';
    n.__c.classList.toggle('sel', i === this.cv.index && this.zone !== 'cats');
  }
  drawPost(i, n, full) {
    const f = this.items[i];
    if (!f) return;
    posterInit(n);
    const name = f.eps ? f.name : f.title || f.name;
    n.__nt.textContent = name; n.__ph.textContent = initials(name);
    if (n.__img !== f) { n.__pic.style.backgroundImage = ''; n.__ph.style.display = ''; n.__img = null; }
    const p = Store.progress('u' + (f.path || f.key));
    n.__bar.style.display = p && p.d ? '' : 'none';
    if (p && p.d) n.__bi.style.width = Math.min(100, p.t / p.d * 100) + '%';
    n.__fv.style.display = 'none';
    n.__rt.style.display = f.year ? '' : 'none'; n.__rt.textContent = f.year || '';
    if (f.eps) { n.__rt.style.display = ''; n.__rt.textContent = T('episodes') + ' ' + f.eps.length; }
    if (full) Usb.picture(f.eps ? Object.assign({}, f.eps[0], { name: '', dir: f.dir }) : f, (u) => { if (u && n.__i === i && this.items[i] === f) { n.__pic.style.backgroundImage = 'url("' + u + '")'; n.__ph.style.display = 'none'; n.__img = f; } });
  }
  drawRow(i, n) {
    const f = this.items[i];
    if (!n.__r) { n.__r = el('div', 'row'); n.__ic = el('span', 'ico'); n.__nm = el('div', 'nm'); n.__sm = el('div', 'sm'); n.__r.append(n.__ic, n.__nm, n.__sm); n.appendChild(n.__r); }
    n.__ic.innerHTML = svg(f.dir === true ? 'folder' : f.up ? 'back' : 'film');
    n.__nm.textContent = f.name;
    const p = f.dir === true ? null : Store.progress('u' + f.path);
    n.__sm.textContent = f.dir === true || f.up ? '' : (p && p.d ? fmtTime(p.t) + ' / ' + fmtTime(p.d) + ' · ' : '') + fmtSize(f.size);
  }
  sayItem(i) { const f = this.items[i]; if (f) announce(f.show && f.eps ? f.name : f.title || f.name); }
  async show(first) {
    fillTop(this.root);
    if (!first) { this.gv.refresh(); return; }
    this.setItems([], T('loading'), T('usb'));
    try { this.drivesL = await Usb.drives(); } catch (e) { this.denied(e); return; }
    if (!this.drivesL.length) { this.setItems([], T('usbNone'), T('usb')); this.tabs = [{ id: 'again', name: T('usbRescan'), icon: 'refresh', n: -1 }]; this.cv.setCount(1, 0); this.setZone('cats'); return; }
    this.drive = this.drivesL[0];
    this.makeTabs();
    this.setZone('cats');
    announce(T('usbLong'));
    this.scan();
  }
  denied(e) {
    this.setItems([], e && e.code === 'denied' ? T('usbDenied') : e && e.code === 'unsupported' ? T('usbOnlyTv') : errText(e), T('usb'));
    this.tabs = [{ id: 'again', name: T('usbRescan'), icon: 'refresh', n: -1 }]; this.cv.setCount(1, 0); this.setZone('cats');
  }
  makeTabs() {
    const L = this.lib;
    this.tabs = [{ id: 'movies', name: T('usbMovies'), icon: 'film', n: L ? L.movies.length : -1 }, { id: 'shows', name: T('usbShows'), icon: 'series', n: L ? L.shows.length : -1 },
                 { id: 'folders', name: T('usbFolders'), icon: 'folder', n: -1 }];
    this.drivesL.forEach((d) => this.tabs.push({ id: 'drive', d, name: d.name + (d === this.drive ? ' ✓' : ''), icon: 'usb', n: -1 }));
    this.tabs.push({ id: 'again', name: T('usbRescan'), icon: 'refresh', n: -1 });
    this.cv.setCount(this.tabs.length, this.cv.index || 0);
  }
  async scan(again) {
    const d = this.drive;
    this.lib = null;
    this.setItems([], T('usbScan', { n: 0 }), d.name);
    try { this.lib = await Usb.library(d, (n) => { if (this.drive === d && !this.items.length) this.root.querySelector('.main .empty').textContent = T('usbScan', { n }); }, again); }
    catch (e) { this.denied(e); return; }
    if (this.drive !== d || !this.root.isConnected) return;
    this.makeTabs();
    this.view = '';
    this.pick(true);
  }
  pick(force) {
    const t = this.tabs[this.cv.index];
    if (!t || (!force && this.view === t.id + (t.d ? t.d.path : ''))) return;
    if (t.id === 'again' || t.id === 'drive') return;
    this.view = t.id;
    if (t.id === 'movies') { this.makeGrid('grid'); this.setItems(this.lib ? this.lib.movies : [], this.lib ? T('usbNoVideos') : T('usbScan', { n: '…' }), T('usbMovies')); }
    else if (t.id === 'shows') { this.makeGrid('grid'); this.setItems(this.lib ? this.lib.shows : [], this.lib ? T('usbNoVideos') : T('usbScan', { n: '…' }), T('usbShows')); }
    else this.openFolder(this.drive.path);
  }
  async openFolder(path) {
    this.makeGrid('rows');
    this.path = path;
    let l = [];
    try { l = await Usb.list(path); } catch (e) { this.setItems([], errText(e), path); return; }
    if (this.view !== 'folders') return;
    l = l.map((x) => Object.assign({}, x, x.dir ? {} : Object.assign({ dir: path }, Usb.episodeOf(x.name, []) || Usb.cleanName(x.name)), { dir: x.dir ? true : path }));
    if (path !== this.drive.path) l.unshift({ name: '..', up: true, path: path.replace(/\/[^/]+$/, '') });
    this.setItems(l, T('usbNoVideos'), path.replace(this.drive.path, this.drive.name));
  }
  setItems(l, emptyText, title) {
    this.items = l;
    this.root.querySelector('.main h1').textContent = title || '';
    this.root.querySelector('.main .head .n').textContent = l.length && this.view !== 'folders' ? T('usbVideos', { n: l.length }) : '';
    const e = this.root.querySelector('.main .empty');
    e.textContent = emptyText || ''; e.classList.toggle('hidden', !!l.length);
    this.gv.setCount(l.length, 0);
    this.gv.active(this.zone === 'grid');
    if (!l.length && this.zone === 'grid') this.setZone('cats');
  }
  setZone(z) { this.zone = z; this.cv.active(z === 'cats'); this.gv.active(z === 'grid'); this.cv.refresh(); if (z === 'grid') this.sayItem(this.gv.index); }
  hide() { this.cv.active(false); this.gv.active(false); }
  destroy() { this.cv.destroy(); this.gv.destroy(); this.root.remove(); }
  openItem(f) {
    if (!f) return;
    if (f.up) { this.openFolder(f.path); return; }
    if (f.dir === true) { this.openFolder(f.path); return; }
    if (f.eps) {
      const seasons = {};
      f.eps.forEach((e) => { (seasons[e.season] = seasons[e.season] || []).push(Object.assign({}, e, { num: e.ep, id: e.path, title: e.name })); });
      UI.push(new SeriesScreen({ n: f.name, i: f.key, l: '' }, '', { key: f.key, seasons, picture: (cb) => Usb.picture(Object.assign({}, f.eps[0], { name: '' , dir: f.dir }), cb) }));
      return;
    }
    playUsb(f, null, startOf('u' + f.path));
  }
  input(a) {
    if (a === 'back') {
      if (this.zone === 'grid' && this.view === 'folders' && this.drive && this.path !== this.drive.path) { this.openFolder(this.path.replace(/\/[^/]+$/, '')); return true; }
      if (this.zone === 'grid') { this.setZone('cats'); return true; }
      return false;
    }
    if (this.zone === 'cats') {
      if (a === 'up' || a === 'down') { this.cv.move(a); return; }
      if (a === 'ok' || ((a === 'left' || a === 'right') && sideways(a) > 0)) {
        this.pickSoon.cancel();
        const t = this.tabs[this.cv.index];
        if (t.id === 'again') { if (this.drive) this.scan(true); else this.show(true); return; }
        if (t.id === 'drive') { this.drive = t.d; this.makeTabs(); this.scan(); return; }
        this.pick();
        if (this.items.length) this.setZone('grid');
      }
      return;
    }
    if (a === 'up' && this.gkind === 'grid') { this.gv.move('up'); return; }
    if (a === 'up' || a === 'down') { this.gv.move(a); return; }
    if (a === 'left' || a === 'right') { if (!this.gv.move(a) && sideways(a) < 0) this.setZone('cats'); else if (this.gkind === 'rows' && sideways(a) < 0) this.setZone('cats'); return; }
    if (a === 'pageUp' || a === 'pageDown') { this.gv.page(a === 'pageUp' ? -1 : 1); return; }
    const f = this.items[this.gv.index];
    if (a === 'ok') { this.openItem(f); return; }
    if ((a === 'menu' || a === 'hold') && f && !f.eps && f.dir !== true && !f.up) {
      const s = startOf('u' + f.path), items = [];
      if (s) items.push({ label: T('resume', { t: fmtTime(s) }), action: () => playUsb(f, null, s) });
      items.push({ label: T('fromStart'), action: () => playUsb(f, null, 0) });
      items.push({ label: T('info'), action: () => UI.alert(f.title || f.name, f.name + '\n' + T('usbInfo', { size: fmtSize(f.size), ext: ext(f.name).toUpperCase() }) + '\n' + f.path) });
      UI.menu(f.title || f.name, items);
    }
  }
}
