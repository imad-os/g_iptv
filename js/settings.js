/* Settings, playlists (add / edit / remove), categories, speed test. */
'use strict';
const THEMES = [['ocean', '#1a9cf0', '#020a2a'], ['ruby', '#ef4444', '#120808'], ['emerald', '#22c55e', '#06120a'], ['cinema', '#e50914', '#000'], ['quantum', '#38bdf8', '#05070d'], ['neon', '#ffd60a', '#07060f']];
function themeName(id) { return T('theme' + id[0].toUpperCase() + id.slice(1)); }
function applyTheme(id) { document.documentElement.setAttribute('data-theme', THEMES.some((t) => t[0] === id) ? id : 'ocean'); }

function onOff(v) { return v ? T('on') : T('off'); }
function settingsScreen() {
  const p = () => Store.prefs();
  const toggle = (k, label, after) => ({ label, value: () => onOff(p()[k]), action: () => { Store.setPref(k, !p()[k]); if (after) after(); }, side: () => { Store.setPref(k, !p()[k]); if (after) after(); } });
  const rows = [
    { label: T('theme'), sub: T('themeNote'), value: () => themeName(p().theme), icon: 'palette', action: () => themeMenu(), side: (a) => { const i = THEMES.findIndex((t) => t[0] === p().theme), n = THEMES[(i + (a === 'right' ? 1 : -1) + THEMES.length) % THEMES.length][0]; Store.setPref('theme', n); applyTheme(n); } },
    { label: T('subsStyle'), icon: 'subs', action: () => UI.push(subsStyleScreen()) },
    { label: T('gridSize'), value: () => String(p().cols), icon: 'grid', action: () => UI.menu(T('gridSize'), [5, 6, 7, 8].map((n) => ({ label: String(n), checked: p().cols === n, action: () => { Store.setPref('cols', n); UI.top().v.refresh(); } }))),
      side: (a) => { Store.setPref('cols', Math.max(5, Math.min(8, p().cols + (a === 'right' ? 1 : -1)))); } },
    toggle('autoNext', T('autoNext')),
    toggle('remember', T('remember')),
    toggle('adult', T('adult'), () => { ['live', 'vod', 'series'].forEach((k) => Catalog.invalidate(k)); }),
    Object.assign(toggle('cache', T('cacheLists'), () => { if (!p().cache) Store.cacheClear(); }), { sub: T('cacheNote', { h: 12 }) }),
    { label: T('manageCats'), icon: 'list', action: () => UI.menu(T('manageCats'), [['live', 'manageLive'], ['vod', 'manageMovies'], ['series', 'manageSeries']].map((k) => ({ label: T(k[1]), action: async () => { if (await openKind(k[0])) UI.push(catScreen(k[0])); } }))) },
    { label: T('userAgent'), value: () => p().ua ? p().ua.slice(0, 26) + (p().ua.length > 26 ? '…' : '') : T('auto'), icon: 'tv', action: async (r, scr) => { const v = await askText({ value: p().ua, kind: 'text', label: T('userAgent'), max: 300 }); if (v !== null && v !== undefined) { Store.setPref('ua', String(v).trim()); scr.v.refresh(); } } },
    { label: T('clearFavs'), icon: 'heart', action: () => UI.confirm(T('sure'), T('clearFavsQ'), T('remove'), () => { Store.clearFavs(); ['live', 'vod', 'series'].forEach((k) => Catalog.invalidate(k)); UI.toast(T('cleared')); }) },
    { label: T('clearHistory'), icon: 'clock', action: () => UI.confirm(T('sure'), T('clearHistQ'), T('remove'), () => { Store.clearHist(); UI.toast(T('cleared')); }) },
    { label: T('clearCache'), icon: 'trash', action: () => { Store.cacheClear().then(() => UI.toast(T('cleared'))); } },
    { label: T('playlists'), icon: 'list', action: () => UI.push(playlistsScreen()) },
    { label: T('speedtest'), icon: 'speed', action: () => UI.push(new SpeedScreen()) },
    { label: T('about'), icon: 'info', value: 'v' + APP_VERSION, action: () => UI.alert(T('about'), T('aboutText', { v: APP_VERSION }) + '\n\n' + T('privacy')) }
  ];
  return new ListScreen(T('settings'), rows, { hints: [['b', T('hintOk')], ['lr', '◀ ▶'], ['a', T('hintBack')]] });
}
// the theme menu shows each theme as it is focused (the whole app and the player change together)
function themeMenu() {
  const before = Store.prefs().theme;
  let chosen = false;
  const m = UI.menu(T('theme'), THEMES.map((t) => ({ label: themeName(t[0]), checked: before === t[0], id: t[0], action: () => { chosen = true; Store.setPref('theme', t[0]); applyTheme(t[0]); const s = UI.top(); if (s && s.v) s.v.refresh(); } })),
    { onFocus(i, it) { applyTheme(it.id); }, onClose() { if (!chosen) applyTheme(before); } });
  // a swatch on each row
  const paint = () => { m.items.forEach((it, i) => { const n = m.v.node(i); if (n && n.__v && !n.__v.querySelector('.swatch')) { const t = THEMES[i], s = el('div', 'swatch'); s.style.background = 'linear-gradient(135deg,' + t[1] + ' 0 50%,' + t[2] + ' 50% 100%)'; n.__v.insertBefore(s, n.__v.firstChild); } }); };
  const orig = m.v.o.render;
  m.v.o.render = (i, n, f) => { orig(i, n, f); const t = THEMES[i], s = el('div', 'swatch'); s.style.background = 'linear-gradient(135deg,' + t[1] + ' 0 50%,' + t[2] + ' 50% 100%)'; n.__v.insertBefore(s, n.__v.firstChild); };
  m.v.refresh();
  paint();
}
function subsStyleScreen() {
  const s = () => Store.prefs().subs;
  const opts = { size: ['small', 'medium', 'large', 'xlarge'], color: ['white', 'yellow', 'cyan', 'green'], bg: ['shadow', 'half', 'black', 'none'], font: ['sans', 'serif', 'mono'], pos: ['bottom', 'raised'] };
  const lbl = { size: 'size', color: 'color', bg: 'background', font: 'font', pos: 'position' };
  const name = (k, v) => T(k === 'font' ? 'font' + v[0].toUpperCase() + v.slice(1) : v);
  const step = (k, d) => { const l = opts[k], i = l.indexOf(s()[k]), o = s(); o[k] = l[(i + d + l.length) % l.length]; Store.setPref('subs', o); Player.applySubStyle(); preview(); };
  let pv = null;
  function preview() {
    if (!pv) return;
    const o = s(), size = { small: 34, medium: 44, large: 56, xlarge: 70 }[o.size], color = { white: '#fff', yellow: '#ffe14d', cyan: '#5ef0ff', green: '#7dff8a' }[o.color];
    const sp = pv.firstChild;
    sp.style.fontSize = size + 'px'; sp.style.color = color; sp.style.fontFamily = { sans: '"Segoe UI", Roboto, Arial, "Kufi Arabic", sans-serif', serif: 'Georgia, serif', mono: '"Courier New", monospace' }[o.font];
    sp.style.background = o.bg === 'half' ? 'rgba(0,0,0,.55)' : o.bg === 'black' ? '#000' : 'transparent';
    sp.style.textShadow = o.bg === 'none' ? 'none' : '0 0 4px #000, 2px 2px 3px #000';
    pv.style.bottom = o.pos === 'raised' ? '200px' : '110px';
  }
  const rows = Object.keys(opts).map((k) => ({ label: T(lbl[k]), value: () => name(k, s()[k]), action: () => step(k, 1), side: (a) => step(k, a === 'right' ? 1 : -1) }));
  const scr = new ListScreen(T('subsStyle'), rows, { hints: [['b', T('hintOk')], ['lr', '◀ ▶'], ['a', T('hintBack')]], onShow: (x) => {
    if (pv) return;
    pv = el('div', 'subs-pv'); const sp = el('span', '', T('subtitles') + ' · Speedy\n' + 'مرحبا · Bonjour'); pv.appendChild(sp); x.root.appendChild(pv); preview();
  } });
  return scr;
}
function catScreen(kind) {
  const d = Catalog.cats(kind), all = [];
  // every category, hidden ones too (Catalog.cats leaves them out)
  const hid = Store.pl().hide[kind];
  const names = {};
  d.forEach((c) => { if (!c.special) { all.push(c); names[c.id] = 1; } });
  hid.forEach((id) => { if (!names[id]) all.push({ id, name: Catalog.catName(kind, id) || id, n: -1 }); });
  const rows = all.map((c) => ({ label: c.name, value: () => { const st = Store.catState(kind, c.id); return st.hidden ? T('hidden') : st.pinned ? T('pinned') : ''; },
    action: () => { const st = Store.catState(kind, c.id); Store.setCat(kind, c.id, 'hide', !st.hidden); Catalog.invalidate(kind); },
    hold: (r, scr) => { const st = Store.catState(kind, c.id); UI.menu(c.name, [{ label: st.hidden ? T('show') : T('hide'), action: () => { Store.setCat(kind, c.id, 'hide', !st.hidden); Catalog.invalidate(kind); scr.v.refresh(); } },
      { label: st.pinned ? T('unpin') : T('pin'), action: () => { Store.setCat(kind, c.id, 'pin', !st.pinned); scr.v.refresh(); } }]); } }));
  return new ListScreen(T({ live: 'manageLive', vod: 'manageMovies', series: 'manageSeries' }[kind]), rows, { hints: [['b', T('hide') + ' / ' + T('show')], ['plus', T('pin')], ['a', T('hintBack')]] });
}

/* ---------------- playlists ---------------- */
function plLabel(p) { return p.name || (p.kind === 'demo' ? T('demo') : p.kind === 'm3u' ? p.url.replace(/^https?:\/\//, '').slice(0, 40) : Provider.baseOf(p.host).replace(/^https?:\/\//, '') + ' · ' + p.user); }
function playlistsScreen() {
  const make = () => {
    const rows = Store.playlists().map((p) => ({ label: plLabel(p), sub: p.kind === 'xtream' ? T('xtream') : p.kind === 'm3u' ? T('m3u') : T('demo'), cur: Store.current() && Store.current().id === p.id, icon: 'list',
      value: () => Store.current() && Store.current().id === p.id ? '✓' : '',
      action: () => usePlaylist(p.id),
      hold: (r, scr) => UI.menu(plLabel(p), [{ label: T('usePlaylist'), action: () => usePlaylist(p.id) },
        { label: T('editPlaylist'), disabled: p.kind === 'demo', action: () => UI.push(new PlaylistForm(p)) },
        { label: T('removePlaylist'), action: () => UI.confirm(T('removePlaylist'), T('removePlQ', { x: plLabel(p) }), T('remove'), () => {
          const wasCur = Store.current() && Store.current().id === p.id;
          Store.removePlaylist(p.id);
          Store.cacheClear(Provider.make(p).key + ':');
          if (wasCur) { Player.stopAll(); Catalog.reset(Store.current()); }
          scr.setRows(make()); } ) }]) }));
    rows.push({ label: T('addPlaylist'), icon: 'plus', action: () => UI.push(new PlaylistForm(null)) });
    if (!Store.playlists().some((p) => p.kind === 'demo')) rows.push({ label: T('demo'), icon: 'play', action: () => { const p = Store.putPlaylist({ kind: 'demo', name: 'Demo' }); usePlaylist(p.id); } });
    return rows;
  };
  const scr = new ListScreen(T('playlists'), make(), { hints: [['b', T('usePlaylist')], ['plus', T('hintMenu')], ['a', T('hintBack')]], onShow: (s) => { s.setRows(make(), s.v.index); } });
  return scr;
}

/* a form: Xtream (server, user, password) or M3U (address); typed with My PC's keyboard, a phone in Text mode or a keyboard */
class PlaylistForm {
  constructor(p) {
    this.p = p ? Object.assign({}, p) : { kind: 'xtream', name: '', host: '', user: '', pass: '', url: '' };
    if (this.p.kind === 'demo') this.p.kind = 'xtream';
    this.root = screenEl('form', topHtml() + '<div class="page"><h1></h1><div class="seg"></div><div class="fields"></div><div class="err"></div><div class="acts"></div></div><div class="hints"></div>');
    this.root.querySelector('h1').textContent = p ? T('editPlaylist') : T('addPlaylist');
    UI.hints(this.root.querySelector('.hints'), [['b', T('hintOk')], ['a', T('hintBack')]]);
    this.fi = 0;
    this.build();
  }
  build() {
    const seg = this.root.querySelector('.seg'), fl = this.root.querySelector('.fields'), acts = this.root.querySelector('.acts');
    clear(seg); clear(fl); clear(acts);
    this.items = [];
    [['xtream', T('xtream')], ['m3u', T('m3u')]].forEach((k) => { const b = el('button', 'chip' + (this.p.kind === k[0] ? ' sel' : ''), k[1]); seg.appendChild(b); this.items.push({ type: 'seg', v: k[0], node: b, label: k[1] }); });
    const F = this.p.kind === 'm3u' ? [['url', T('plM3u'), 'url'], ['name', T('plName'), 'text']] : [['host', T('plServer'), 'url'], ['user', T('plUser'), 'user'], ['pass', T('plPass'), 'password'], ['name', T('plName'), 'text']];
    F.forEach((f) => {
      const w = el('div', 'field'), lab = el('label', '', f[1]), inp = document.createElement('input');
      inp.type = f[2] === 'password' ? 'password' : f[2] === 'url' ? 'url' : 'text';
      inp.value = this.p[f[0]] || ''; inp.setAttribute('aria-label', f[1]); inp.spellcheck = false; inp.autocomplete = 'off';
      inp.addEventListener('input', () => { this.p[f[0]] = inp.value; });
      inp.addEventListener('keydown', (e) => { if (e.keyCode === 13) { e.preventDefault(); inp.blur(); this.move(1); } });
      w.append(lab, inp); fl.appendChild(w);
      this.items.push({ type: 'field', k: f[0], kind: f[2], node: inp, label: f[1] });
    });
    [['save', T('save'), true], ['cancel', T('cancel')]].forEach((b) => { const n = el('button', 'btn' + (b[2] ? ' primary' : ''), b[1]); acts.appendChild(n); this.items.push({ type: 'btn', id: b[0], node: n, label: b[1] }); });
    this.fi = Math.min(this.fi, this.items.length - 1);
    if (this.fi < 2) this.fi = this.items.findIndex((x) => x.type === 'field');
    this.paint();
  }
  paint() {
    this.items.forEach((x, i) => x.node.classList.toggle('f', i === this.fi));
    const it = this.items[this.fi];
    // a phone in Text mode types into the focused field (MyPC.text, API 13); the field never takes the page's focus, so the
    // remote's arrows keep moving between fields
    try {
      if (it && it.type === 'field' && MyPC.text && MyPC.text.open && MyPC.isHosted()) {
        MyPC.text.open({ value: it.node.value, kind: it.kind === 'user' ? 'text' : it.kind, label: it.label, max: 500,
          onInput: (v) => { it.node.value = v; this.p[it.k] = v; }, onSend: () => this.move(1) });
      } else if (MyPC.text && MyPC.text.close) MyPC.text.close();
    } catch (e) {}
  }
  say() { const it = this.items[this.fi]; if (it) announce(it.label + (it.type === 'field' && it.kind !== 'password' && it.node.value ? ', ' + it.node.value : '')); }
  move(d) {
    let n = this.fi + d;
    // the two kind buttons sit on one row: up / down jump past the other one
    if (n >= 0 && n < this.items.length) { this.fi = n; this.paint(); this.say(); }
  }
  show(first) { fillTop(this.root, T('playlists')); if (first) this.say(); }
  hide() { try { if (MyPC.text && MyPC.text.close) MyPC.text.close(); } catch (e) {} }
  destroy() { this.hide(); this.root.remove(); }
  input(a) {
    const it = this.items[this.fi];
    if (a === 'back') return false;
    if (a === 'up') { if (it.type === 'seg') return; if (it.type === 'btn') { this.fi = this.items.findLastIndex ? this.items.findLastIndex((x) => x.type === 'field') : this.items.length - 3; this.paint(); this.say(); return; } const n = this.fi - 1; this.fi = this.items[n] && this.items[n].type === 'seg' ? this.items.findIndex((x) => x.type === 'seg' && x.v === this.p.kind) : n; this.paint(); this.say(); return; }
    if (a === 'down') { if (it.type === 'seg') { this.fi = this.items.findIndex((x) => x.type === 'field'); } else if (it.type === 'field') this.fi++; else return; this.paint(); this.say(); return; }
    if (a === 'left' || a === 'right') { if (it.type === 'field') return; const n = this.fi + sideways(a); if (this.items[n] && this.items[n].type === it.type) { this.fi = n; this.paint(); this.say(); } return; }
    if (a !== 'ok') return;
    if (it.type === 'seg') { if (this.p.kind !== it.v) { this.p.kind = it.v; this.build(); this.fi = this.items.findIndex((x) => x.type === 'seg' && x.v === it.v); this.paint(); } return; }
    if (it.type === 'field') { this.type(it); return; }
    if (it.id === 'cancel') { UI.pop(); return; }
    this.save();
  }
  async type(it) {
    const v = await askText({ value: it.node.value, kind: it.kind, label: it.label, ok: T('ok'), max: 500 });
    if (v === null || v === undefined) return;
    it.node.value = String(v).trim(); this.p[it.k] = it.node.value;
    this.move(1);
  }
  async save() {
    const p = this.p, er = this.root.querySelector('.err');
    er.textContent = '';
    ['name', 'host', 'user', 'pass', 'url'].forEach((k) => { if (typeof p[k] === 'string') p[k] = p[k].trim(); });
    if (p.kind === 'xtream' && (!p.host || !p.user || !p.pass)) { er.textContent = T('needFields'); announce(er.textContent); return; }
    if (p.kind === 'm3u' && !/^https?:\/\/\S+/i.test(p.url)) { er.textContent = T('needM3u'); announce(er.textContent); return; }
    if (p.kind === 'xtream') {
      // "host:port/" or a full player link pasted: keep the server only
      const m = /^(https?:\/\/)?([^/?#\s]+)(.*)$/i.exec(p.host);
      if (m) { p.host = (m[1] || 'http://') + m[2]; const um = /username=([^&]+)/.exec(m[3] || ''), pm = /password=([^&]+)/.exec(m[3] || ''); if (um && !p.user) p.user = decodeURIComponent(um[1]); if (pm && !p.pass) p.pass = decodeURIComponent(pm[1]); }
      const b = UI.busy(T('connecting'));
      try { await Provider.make(p).info(); b.close(); } catch (e) { b.close(); er.textContent = errText(e); announce(er.textContent); return; }
    }
    const saved = Store.putPlaylist({ id: p.id, kind: p.kind, name: p.name, host: p.host, user: p.user, pass: p.pass, url: p.url });
    Store.cacheClear(Provider.make(saved).key + ':');
    UI.toast(T('connected'));
    usePlaylist(saved.id);
  }
}

/* ---------------- speed test: downloads for 10 s (through My PC when inside it), shows the average ---------------- */
class SpeedScreen {
  constructor() {
    this.root = screenEl('speed', topHtml() + '<div class="page"><h1></h1><p class="note"></p><div class="gauge"><svg viewBox="0 0 200 110"><path d="M15 100 A85 85 0 0 1 185 100" fill="none" stroke="var(--card2)" stroke-width="16" stroke-linecap="round"/><path class="arc" d="M15 100 A85 85 0 0 1 185 100" fill="none" stroke="var(--accent)" stroke-width="16" stroke-linecap="round" stroke-dasharray="267" stroke-dashoffset="267"/></svg><div class="val">0 <small>Mbps</small></div></div><p class="verdict" style="text-align:center;font-size:34px"></p><div class="acts" style="display:flex;justify-content:center;gap:20px"></div></div><div class="hints"></div>');
    this.root.querySelector('h1').textContent = T('speedtest');
    this.root.querySelector('.note').textContent = T('stHint', { s: 10 });
    const b = el('button', 'btn primary f', T('stStart'));
    this.root.querySelector('.acts').appendChild(b);
    this.btn = b; this.running = false;
    UI.hints(this.root.querySelector('.hints'), [['b', T('hintOk')], ['a', T('hintBack')]]);
  }
  show() { fillTop(this.root); announce(T('speedtest') + '. ' + T('stHint', { s: 10 })); }
  hide() {} destroy() { this.dead = true; if (this.req && this.req.abort) this.req.abort(); this.root.remove(); }
  draw(mbps) {
    this.root.querySelector('.val').firstChild.nodeValue = (mbps >= 100 ? Math.round(mbps) : mbps.toFixed(1)) + ' ';
    this.root.querySelector('.arc').style.strokeDashoffset = 267 - 267 * Math.min(1, Math.log10(1 + mbps) / Math.log10(201));
  }
  async run() {
    if (this.running) return;
    this.running = true; this.btn.textContent = T('stTesting');
    const v = this.root.querySelector('.verdict'); v.textContent = '';
    const t0 = performance.now(), dur = 10000;
    let bytes = 0, n = 0, fails = 0;
    // the playlist's own server first (that is what plays), else a public test file
    const urls = ['https://speed.cloudflare.com/__down?bytes=8000000', 'https://proof.ovh.net/files/10Mb.dat'];
    while (performance.now() - t0 < dur && !this.dead && fails < 4) {
      const u = urls[n++ % urls.length] + (urls[0].indexOf('?') >= 0 && n % urls.length === 1 ? '&r=' + n : '');
      try { this.req = Net.get(u, { type: 'arraybuffer', timeout: dur }); const r = await this.req; if (r.body && r.body.byteLength) bytes += r.body.byteLength; else fails++; }
      catch (e) { fails++; }
      const s = (performance.now() - t0) / 1000;
      if (bytes) this.draw(bytes * 8 / s / 1e6);
    }
    if (this.dead) return;
    const mbps = bytes * 8 / ((performance.now() - t0) / 1000) / 1e6;
    this.running = false; this.btn.textContent = T('stStart');
    if (!bytes) { v.textContent = T('stFail'); announce(v.textContent); return; }
    this.draw(mbps);
    v.textContent = T('stDone') + ': ' + mbps.toFixed(1) + ' Mbps · ' + (mbps >= 25 ? T('st4k') : mbps >= 10 ? T('stFhd') : mbps >= 5 ? T('stHd') : T('stSlow'));
    announce(v.textContent);
  }
  input(a) { if (a === 'ok') this.run(); if (a === 'back') return false; }
}
