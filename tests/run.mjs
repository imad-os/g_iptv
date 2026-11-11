// Speedy IPTV for My PC: tests in a real browser (Chromium + Playwright), standalone (outside My PC).
//   node tests/run.mjs            SPEEDY_SHOTS=<folder> saves screenshots    SPEEDY_ONLY=<part> runs one part
// The in-My-PC tests (TV player, USB drives, Back, keys) live in My PC's own suite: MYPC_ONLY=speedy node tests/run-tests.mjs (imad-os/g).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { routeAll, XT, M3U, APP_DIR } from './fixtures.mjs';
const { chromium } = createRequire(import.meta.url)('playwright');

const BASE = 'http://speedy.test/';
const SHOTS = process.env.SPEEDY_SHOTS || '';
const ONLY = process.env.SPEEDY_ONLY || '';
let failures = 0, checks = 0;
function check(ok, what) { checks++; if (!ok) failures++; console.log((ok ? '  ok   ' : '  FAIL ') + what); }
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function open(browser, o) {
  o = o || {};
  const ctx = await browser.newContext({ viewport: o.viewport || { width: 1280, height: 720 }, locale: o.locale || 'en-US', deviceScaleFactor: 1 });
  const stats = await routeAll(ctx, { appBase: BASE, sizes: o.sizes });
  const page = await ctx.newPage();
  const errors = [];
  global.__errs = errors;
  global.__page = page;
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|ERR_|404/.test(m.text())) errors.push(m.text()); });
  const answers = [];
  page.on('dialog', (d) => { const a = answers.shift(); if (d.type() === 'prompt') d.accept(a === undefined ? '' : a); else d.accept(); });
  if (o.storage) await page.addInitScript((s) => { if (!sessionStorage.getItem('__seeded')) { localStorage.setItem('mypc_/index.html', s); sessionStorage.setItem('__seeded', '1'); } }, JSON.stringify(o.storage));
  await page.addInitScript(() => { window.__speedyHold = 4000; window.__keys = []; const f = (e) => { __keys.push(e.type[3] + e.keyCode + '@' + Math.round(performance.now())); if (__keys.length > 40) __keys.shift(); }; document.addEventListener('keydown', f, true); document.addEventListener('keyup', f, true); });
  await page.goto(BASE + 'index.html');
  await page.waitForFunction(() => typeof UI !== 'undefined' && UI.top(), null, { timeout: 15000 });
  const key = async (k, n) => { for (let i = 0; i < (n || 1); i++) { await page.keyboard.press(k); await page.waitForTimeout(20); } };
  const shot = async (name) => { if (!SHOTS) return; await page.waitForTimeout(250); await page.screenshot({ path: path.join(SHOTS, name + '.png') }); };
  const top = () => page.evaluate(() => { const t = UI.top(); return t ? t.constructor.name : ''; });
  return { ctx, page, stats, errors, answers, key, shot, top };
}

// a playlist of the fake Xtream server, typed in the form (the browser's prompt stands for My PC's keyboard here)
async function addXtream(t) {
  const { page, key, answers } = t;
  await page.waitForSelector('.home .home-actions .btn');
  await key('Enter');                                  // Add a playlist
  await page.waitForSelector('.form .field input');
  answers.push(XT, 'demo', 'pass', 'My test server');
  await key('Enter'); await page.waitForTimeout(80);    // server
  await key('Enter'); await page.waitForTimeout(80);    // user
  await key('Enter'); await page.waitForTimeout(80);    // password
  await key('Enter'); await page.waitForTimeout(80);    // name
  await key('Enter');                                  // Save
  await page.waitForSelector('.home .home-tiles .tile', { timeout: 15000 });
}

async function partBasics(browser) {
  console.log('1. First start, a playlist, the home screen');
  const t = await open(browser);
  const { page, key, shot } = t;
  const w = await page.evaluate(() => ({ title: document.querySelector('.welcome h1').textContent, back: UI.stack().length, f: document.querySelector('.home-actions .btn.f').textContent }));
  check(w.title === 'No playlist yet' && /Add a playlist/.test(w.f), 'no playlist: a welcome with Add a playlist focused ' + JSON.stringify(w));
  await shot('01-welcome');
  // a wrong password is refused with a clear message
  await key('Enter');
  await page.waitForSelector('.form .field input');
  t.answers.push(XT, 'demo', 'wrong', 'My test server');
  for (let i = 0; i < 5; i++) { await key('Enter'); await page.waitForTimeout(80); }
  await page.waitForFunction(() => document.querySelector('.form .err').textContent.length > 0);
  const er = await page.evaluate(() => document.querySelector('.form .err').textContent);
  check(/refused/.test(er), 'a wrong password: the form says the server refused it ' + er);
  await shot('02-form-error');
  // fix the password: up to the password field, OK, type
  t.answers.push('pass');
  await key('ArrowUp', 2); await key('Enter'); await page.waitForTimeout(100);
  await key('ArrowDown', 1); await key('Enter');
  await page.waitForSelector('.home .home-tiles .tile', { timeout: 15000 });
  const h = await page.evaluate(() => ({ tiles: [...document.querySelectorAll('.home .tile .tt')].map((x) => x.textContent), crumb: document.querySelector('.home .crumb').textContent, pls: Store.playlists().length }));
  check(h.tiles.join(',') === 'Live TV,Movies,Series' && h.crumb === 'My test server' && h.pls === 1, 'saved: the home screen has Live TV, Movies, Series (USB only on a TV) ' + JSON.stringify(h));
  await page.waitForFunction(() => /Active/.test(document.querySelector('.acct').textContent));
  const acct = await page.evaluate(() => document.querySelector('.acct').textContent);
  check(/Active/.test(acct) && /2027/.test(acct) && /0\/2/.test(acct), 'the account: status, expiry date, connections ' + acct);
  await shot('03-home');
  return t;
}

async function partMovies(t) {
  console.log('2. Movies: 20 000 films, a category of 15 000, virtual list, pictures only at rest, search, favorites');
  const { page, key, shot, stats } = t;
  await key('ArrowRight'); await key('Enter');
  const t0 = Date.now();
  await page.waitForFunction(() => UI.top().constructor.name === 'BrowseScreen' && UI.top().items.length > 0, null, { timeout: 60000 });
  const loadMs = Date.now() - t0;
  const c = await page.evaluate(() => ({ n: Catalog.count('vod'), cats: Catalog.cats('vod').map((x) => x.name + ':' + x.n) }));
  check(c.n === 20000 && c.cats.some((x) => x === 'Huge list:15000'), '20 000 films parsed off the main thread in ' + loadMs + ' ms; categories ' + c.cats.slice(0, 9).join(', '));
  // to the big category
  const hi = await page.evaluate(() => UI.top().cats.findIndex((x) => x.name === 'Huge list'));
  await key('ArrowDown', hi);
  await page.waitForTimeout(400);
  await key('Enter');
  await page.waitForFunction(() => UI.top().items.length === 15000);
  const dom = await page.evaluate(() => document.querySelectorAll('.browse .grid .vi').length);
  check(dom > 0 && dom < 80, 'a category of 15 000 films keeps only ' + dom + ' poster nodes in the page');
  await page.waitForTimeout(600);
  await shot('04-movies-grid');
  // hold the down arrow: no new nodes, no pictures asked while it moves, every key handled fast
  const img0 = stats.img;
  const timing = await page.evaluate(async () => {
    const v = UI.top().gv, out = [];
    const before = document.querySelectorAll('.vi').length;
    for (let i = 0; i < 120; i++) { const a = performance.now(); UI.input('down', true); await new Promise((r) => requestAnimationFrame(r)); out.push(performance.now() - a); }
    return { idx: v.index, worst: Math.max(...out), avg: out.reduce((x, y) => x + y, 0) / out.length, nodes: document.querySelectorAll('.vi').length - before };
  });
  const imgMoving = stats.img - img0;
  await page.waitForTimeout(700);
  const imgRest = stats.img - img0 - imgMoving;
  check(timing.idx === 720 && timing.nodes === 0, 'holding down 120 rows: focus on film 721, no new nodes ' + JSON.stringify(timing));
  check(timing.avg < 30, 'each step of the held arrow takes ' + timing.avg.toFixed(1) + ' ms on average (worst ' + timing.worst.toFixed(1) + ' ms)');
  check(imgMoving <= 2 && imgRest > 0, 'pictures are asked once the list rests, not while it moves (' + imgMoving + ' while moving, ' + imgRest + ' after)');
  // CH- (PageDown) many times to the end, then the last row is right
  const pages = await page.evaluate(() => { let n = 0; while (UI.top().gv.index < 14999 && n < 5000) { UI.input('pageDown'); n++; } return n; });
  await page.waitForTimeout(500);
  const end = await page.evaluate(() => { const v = UI.top().gv, n = v.node(v.index); return { i: v.index, name: n && n.querySelector('.nm span').textContent, f: n && n.classList.contains('f') }; });
  check(end.i === 14999 && end.f && end.name === UI_NAME_LAST && pages < 1300, 'page down (' + pages + ' pages) to the end: the last film is focused and drawn ' + JSON.stringify(end));
  await shot('05-movies-end');
  // favorite with X (F on a keyboard), it shows a heart and lands in Favorites
  await key('f');
  const fav = await page.evaluate(() => ({ heart: getComputedStyle(UI.top().gv.node(UI.top().gv.index).querySelector('.fav').parentNode).display !== 'none', n: Store.pl().fav.vod.length, cat: UI.top().cats.find((c) => c.special === 'fav').n }));
  check(fav.heart && fav.n === 1 && fav.cat === 1, 'X adds the film to Favorites (heart on the poster, count 1) ' + JSON.stringify(fav));
  // search with Y (S)
  t.answers.push('film 1234');
  await key('s');
  await page.waitForFunction(() => /film 1234/.test(document.querySelector('.browse .main h1').textContent));
  const sr = await page.evaluate(() => ({ n: UI.top().items.length, first: UI.top().items[0].n, z: UI.top().zone }));
  check(sr.n >= 10 && /^Film 1234/.test(sr.first) && sr.z === 'grid', 'search “film 1234”: names starting with it come first ' + JSON.stringify(sr));
  await shot('06-movies-search');
  await key('Escape');
  const after = await page.evaluate(() => ({ q: UI.top().q, z: UI.top().zone }));
  check(after.q === '' && after.z === 'cats', 'Back leaves the search, then the grid');
  // sort A to Z
  return t;
}
const UI_NAME_LAST = 'Film 15000 (2019)';

async function partPlayer(t) {
  console.log('3. A film: details, the player, seeking, subtitles found online (Arabic Windows-1256), progress');
  const { page, key, shot, stats } = t;
  // Favorites category -> the film -> details
  await page.evaluate(() => { const s = UI.top(); s.cv.focus(s.cats.findIndex((c) => c.special === 'fav')); s.pick(true); });
  await page.waitForFunction(() => UI.top().items.length === 1);
  await key('ArrowRight');
  await key('Enter');
  await page.waitForSelector('.details .det h1');
  await page.waitForFunction(() => /test film/.test(document.querySelector('.details .plot').textContent));
  const d = await page.evaluate(() => ({ h: document.querySelector('.details h1').textContent, meta: document.querySelector('.details .meta').textContent, btn: document.querySelector('.details .btn.f').textContent }));
  check(/Film 15000/.test(d.h) && /2019/.test(d.meta) && /7\.4/.test(d.meta) && /HD/.test(d.meta) && /Play/.test(d.btn), 'details: year, rating, quality badge, Play focused ' + JSON.stringify(d));
  await shot('07-details');
  await key('Enter');
  await page.waitForFunction(() => Player.state().playing && Player.state().t > 1, null, { timeout: 20000 });
  const p1 = await page.evaluate(() => ({ eng: Player.state().engine, d: Player.state().d, ui: Player.state().ui, url: document.getElementById('vid').currentSrc }));
  check(p1.eng === 'web' && Math.round(p1.d) === 60 && /\/movie\/demo\/pass\/15000\.mp4$/.test(p1.url), 'it plays (web player outside a TV): 60 s film from the server ' + JSON.stringify(p1));
  await shot('08-player-overlay');
  // seek: right x3 adds up to +30 s, one jump
  await key('Escape');                    // hide the controls
  const t0 = await page.evaluate(() => Player.state().t);
  await key('ArrowRight', 3);
  const seekBubble = await page.evaluate(() => document.querySelector('.pl-seek').textContent);
  await page.waitForTimeout(1100);
  const t1 = await page.evaluate(() => Player.state().t);
  check(t1 - t0 > 25 && t1 - t0 < 36 && /\/ 1:00/.test(seekBubble), 'three presses of → jump 30 s at once (' + t0.toFixed(1) + ' -> ' + t1.toFixed(1) + ', bubble ' + seekBubble + ')');
  // subtitles: online search, the Arabic one (Windows-1256) is decoded
  await key('Enter');                     // controls
  await key('m');                         // + : audio & subtitles
  await page.waitForSelector('.menu', { timeout: 5000 });
  await key('ArrowDown'); await key('Enter');   // Subtitles
  await page.waitForFunction(() => [...document.querySelectorAll('.menu .li')].some((x) => /online/.test(x.textContent)));
  const idx = await page.evaluate(() => [...document.querySelectorAll('.menu .vi')].findIndex((x) => /online/.test(x.textContent)));
  await key('ArrowDown', idx); await key('Enter');
  await page.waitForFunction(() => document.querySelectorAll('.menu .li').length >= 2 && /العربية|English/.test(document.querySelector('.menu').textContent), null, { timeout: 10000 });
  const items = await page.evaluate(() => [...document.querySelectorAll('.menu .li .nm')].map((x) => x.firstChild.textContent));
  const ai = items.indexOf('العربية');
  await key('ArrowDown', ai); await key('Enter');
  await page.waitForFunction(() => Player.state().cues > 0, null, { timeout: 10000 });
  await page.evaluate(() => { const v = document.getElementById('vid'); v.currentTime = 10; });
  await page.waitForFunction(() => /مرحبا بكم في Speedy/.test(document.getElementById('subs').textContent), null, { timeout: 5000 }).catch(() => {});
  const sub = await page.evaluate(() => document.getElementById('subs').textContent);
  check(sub === 'مرحبا بكم في Speedy', 'Arabic subtitles found online, Windows-1256 decoded, shown in time: “' + sub + '” (' + stats.subs + ' requests)');
  await key('Escape');
  await page.waitForTimeout(300);
  await shot('09-player-subtitles-ar');
  // style: bigger, yellow
  await page.evaluate(() => { const s = Store.prefs().subs; s.size = 'large'; s.color = 'yellow'; s.bg = 'half'; Store.setPref('subs', s); Player.applySubStyle(); document.getElementById('subs').__t = ''; });
  await page.waitForTimeout(400);
  const style = await page.evaluate(() => { const s = getComputedStyle(document.getElementById('subs')); const sp = getComputedStyle(document.querySelector('#subs span')); return s.fontSize + ' ' + s.color + ' ' + sp.backgroundColor; });
  check(/56px rgb\(255, 225, 77\) rgba\(0, 0, 0, 0\.55\)/.test(style), 'subtitle style: size, colour, background ' + style);
  await shot('10-player-subtitles-style');
  // Back closes the player; where it stopped is kept and shown on the home screen
  const stopAt = await page.evaluate(() => Player.state().t);
  await key('Escape');
  await page.waitForFunction(() => UI.top().constructor.name === 'MovieScreen');
  const prog = await page.evaluate(() => ({ p: Store.progress('v15000'), btn: document.querySelector('.details .btn.f').textContent, vid: document.getElementById('vid').style.display }));
  check(prog.p && Math.abs(prog.p.t - stopAt) < 3 && /Resume from 0:/.test(prog.btn) && prog.vid === 'none', 'Back closes the player; the details now offer Resume ' + JSON.stringify(prog));
  await key('Escape'); await key('Escape'); await key('Escape');
  await page.waitForFunction(() => UI.top().constructor.name === 'HomeScreen');
  await page.waitForTimeout(500);
  const cw = await page.evaluate(() => ({ n: UI.top().rec.length, name: UI.top().rec[0] && UI.top().rec[0].name }));
  check(cw.n === 1 && /^Film 15000/.test(cw.name), 'Continue watching shows the film ' + JSON.stringify(cw));
  await key('ArrowDown');
  await shot('11-home-continue');
  // OK on it resumes where it stopped
  await key('Enter');
  await page.waitForFunction(() => Player.state().playing && Player.state().t > 1, null, { timeout: 20000 });
  const rs = await page.evaluate(() => Player.state().t);
  check(Math.abs(rs - stopAt) < 4, 'Continue watching resumes at ' + rs.toFixed(1) + ' s (stopped at ' + stopAt.toFixed(1) + ')');
  await key('Escape'); await page.waitForTimeout(100); await key('Escape');
  await page.waitForFunction(() => UI.top().constructor.name === 'HomeScreen');
  return t;
}

async function partSeries(t) {
  console.log('4. Series: seasons, a season of 120 episodes, the next episode by itself');
  const { page, key, shot } = t;
  await page.evaluate(() => { const h = UI.top(); h.zone = 0; h.ti = 2; h.paint(); });
  await key('Enter');
  await page.waitForFunction(() => UI.top().constructor.name === 'BrowseScreen' && UI.top().items.length > 0, null, { timeout: 30000 });
  await key('Enter');
  await page.waitForFunction(() => UI.top().zone === 'grid');
  await key('Enter');
  await page.waitForFunction(() => UI.top().constructor.name === 'SeriesScreen' && UI.top().seasons.length === 3, null, { timeout: 10000 });
  await key('ArrowRight', 2);
  const s3 = await page.evaluate(() => ({ eps: UI.top().eps.length, dom: document.querySelectorAll('.series .eps .vi').length, chip: document.querySelector('.seasons .chip.sel').textContent }));
  check(s3.eps === 120 && s3.dom < 30 && s3.chip === 'Season 3', 'season 3: 120 episodes, ' + s3.dom + ' rows in the page ' + JSON.stringify(s3));
  await key('ArrowLeft', 2);
  await shot('12-series');
  await key('Enter');
  await page.waitForFunction(() => Player.state().playing && Player.state().t > 0.5, null, { timeout: 20000 });
  const cur = await page.evaluate(() => Player.current().sub);
  // near the end the next episode is offered with a countdown, then it plays
  await page.evaluate(() => { document.getElementById('vid').currentTime = 45; });
  await page.waitForFunction(() => !document.querySelector('.pl-next').classList.contains('hidden'), null, { timeout: 10000 });
  const nx = await page.evaluate(() => ({ t1: document.querySelector('.pl-next .t1').textContent, t2: document.querySelector('.pl-next .t2').textContent }));
  check(/^S01E01/.test(cur) && /Next episode in \d+ s/.test(nx.t1) && /S01E02/.test(nx.t2), 'the end of S01E01 offers S01E02 with a countdown ' + JSON.stringify(nx));
  await shot('13-player-next-episode');
  await page.evaluate(() => { document.getElementById('vid').currentTime = 59.5; });
  await page.waitForFunction(() => /^S01E02/.test(Player.current().sub) && Player.state().playing, null, { timeout: 15000 });
  check(true, 'S01E02 plays by itself at the end');
  await key('Escape'); await page.waitForTimeout(100); await key('Escape');
  await page.waitForFunction(() => UI.top().constructor.name === 'SeriesScreen');
  const prog = await page.evaluate(() => ({ e: !!Store.progress(UI.top().epKey(UI.top().flat[0])), s: Store.progress('s' + UI.top().it.i), btn: [...document.querySelectorAll('.series .acts .btn')].map((b) => b.textContent).join('|') }));
  check(prog.e && prog.s && /Resume from S01E02/.test(prog.btn), 'the series remembers its last episode ' + JSON.stringify(prog));
  await key('Escape'); await key('Escape'); await key('Escape');
  await page.waitForFunction(() => UI.top().constructor.name === 'HomeScreen');
}

async function partLive(t) {
  console.log('5. Live TV: categories, 4 000 channels, the picture in the box, full screen, zapping, programme guide');
  const { page, key, shot } = t;
  await page.evaluate(() => { const h = UI.top(); h.zone = 0; h.ti = 0; h.paint(); });
  await key('Enter');
  await page.waitForFunction(() => UI.top().constructor.name === 'LiveScreen' && UI.top().items.length > 0, null, { timeout: 30000 });
  const cats = await page.evaluate(() => UI.top().cats.map((c) => c.name));
  check(!cats.some((c) => /Adult/.test(c)) && cats.indexOf('Big list') >= 0 && cats[0] === 'All', 'adult categories are hidden; All, Favorites, Recent first ' + cats.join(', '));
  const bi = cats.indexOf('Big list');
  await key('ArrowDown', bi); await page.waitForTimeout(350); await key('Enter');
  await page.waitForFunction(() => UI.top().items.length === 4000 && UI.top().zone === 'ch');
  await key('ArrowDown', 5);
  await key('Enter');
  await page.waitForFunction(() => Player.mode() === 'preview' && Player.state().playing, null, { timeout: 20000 });
  const pv = await page.evaluate(() => { const v = document.getElementById('vid').getBoundingClientRect(), b = document.querySelector('.pv-box').getBoundingClientRect(); return { v: [v.x, v.y, v.width, v.height].map(Math.round).join(','), b: [b.x, b.y, b.width, b.height].map(Math.round).join(','), url: Player.current().url }; });
  check(pv.v === pv.b && /\/live\/demo\/pass\/6\.m3u8$/.test(pv.url), 'OK plays the channel in the box (HLS) ' + JSON.stringify(pv));
  await page.waitForFunction(() => /Evening news 6/.test(document.querySelector('.pv-info').textContent), null, { timeout: 5000 });
  await page.waitForTimeout(1500);
  await shot('14-live-preview');
  // OK again: full screen; up = next channel (zap), the banner shows it
  await key('Enter');
  await page.waitForFunction(() => Player.mode() === 'full');
  await page.waitForTimeout(300);
  await key('Escape');
  await key('ArrowUp');
  await page.waitForFunction(() => !document.querySelector('.pl-banner').classList.contains('hidden'));
  await page.waitForTimeout(150);
  const ban = await page.evaluate(() => document.querySelector('.pl-banner').textContent);
  await shot('15-live-zap-banner');
  await page.waitForFunction(() => /\/7\.m3u8$/.test(Player.current().url), null, { timeout: 5000 });
  check(/7Channel 7/.test(ban), 'up zaps to the next channel with a banner (number, name, guide) ' + ban.slice(0, 80));
  // the channel list over the picture (Y)
  await key('s');
  await page.waitForSelector('.pl-list:not(.hidden) .vi.f');
  await page.waitForTimeout(500);
  await shot('16-live-channel-list');
  await key('ArrowDown', 3); await key('Enter');
  await page.waitForFunction(() => /\/10\.m3u8$/.test(Player.current().url), null, { timeout: 5000 });
  check(true, 'the channel list picks channel 10');
  // controls on screen with the programme guide
  await key('Enter');
  await page.waitForFunction(() => /Evening news 10/.test(document.querySelector('.pl-live').textContent), null, { timeout: 5000 });
  await shot('17-live-full-controls');
  await key('Escape'); await key('Escape');
  await page.waitForFunction(() => Player.mode() === 'preview');
  const back = await page.evaluate(() => ({ idx: UI.top().lv.index, mode: Player.mode(), playing: Player.state().playing }));
  check(back.mode === 'preview' && back.idx === 9, 'Back from full screen: the picture goes back into the box, the list follows the channel ' + JSON.stringify(back));
  await key('Escape'); await key('Escape');
  await page.waitForFunction(() => UI.top().constructor.name === 'HomeScreen');
  const off = await page.evaluate(() => ({ mode: Player.mode(), vid: document.getElementById('vid').style.display }));
  check(off.mode === 'off' && off.vid === 'none', 'leaving Live TV stops the picture ' + JSON.stringify(off));
}

async function partThemes(t) {
  console.log('6. Themes: one setting for the app and the player, each one checked');
  const { page, key, shot } = t;
  const themes = ['ocean', 'ruby', 'emerald', 'cinema', 'quantum', 'neon'];
  for (const th of themes) {
    await page.evaluate((x) => { Store.setPref('theme', x); applyTheme(x); }, th);
    await page.waitForTimeout(150);
    const c = await page.evaluate(() => {
      const css = (sel, p) => { const e = document.querySelector(sel); return e ? getComputedStyle(e)[p] : ''; };
      return { body: getComputedStyle(document.body).backgroundColor, tile: css('.tile.f', 'backgroundColor'), acc: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() };
    });
    await shot('18-theme-' + th + '-home');
    // the player overlay in the same theme
    await page.evaluate(() => { const h = UI.top(); h.zone = 0; h.ti = 1; h.paint(); });
    await key('Enter');
    await page.waitForFunction(() => UI.top().constructor.name === 'BrowseScreen' && UI.top().items.length > 0);
    await page.evaluate(() => { const s = UI.top(); s.cv.focus(s.cats.findIndex((c) => c.special === 'fav')); s.pick(true); });
    await page.waitForFunction(() => UI.top().items.length >= 1);
    await key('ArrowRight'); await page.evaluate(() => UI.input('menu')); await page.waitForSelector('.menu'); await key('Enter');
    await page.waitForFunction(() => Player.state().playing && Player.state().t > 0.3, null, { timeout: 20000 });
    await key('Enter');
    const pc = await page.evaluate(() => ({ btn: getComputedStyle(document.querySelector('.pbtn.f')).backgroundColor, bar: getComputedStyle(document.querySelector('.pl-bar .bf')).backgroundColor }));
    await shot('19-theme-' + th + '-player');
    const hex = c.acc.toLowerCase(), rgb = (h) => { const n = parseInt(h.slice(1), 16); return 'rgb(' + (n >> 16) + ', ' + ((n >> 8) & 255) + ', ' + (n & 255) + ')'; };
    check(c.tile === rgb(hex) && pc.btn === rgb(hex) && pc.bar === rgb(hex), th + ': the focused tile, the player button and its progress bar share the accent ' + hex);
    await key('Escape'); await key('Escape'); await page.waitForTimeout(100);
    await key('Escape'); await key('Escape');
    await page.waitForFunction(() => UI.top().constructor.name === 'HomeScreen');
  }
  await page.evaluate(() => { Store.setPref('theme', 'ocean'); applyTheme('ocean'); });
  // Settings: the theme row, then the menu previews each theme as it is focused
  await page.evaluate(() => { const h = UI.top(); h.zone = h.zones.indexOf('acts'); h.ai = h.acts.findIndex((a) => a.id === 'set'); h.paint(); });
  await key('Enter');
  await page.waitForSelector('.screen.on .li');
  await shot('20-settings');
  await key('Enter');
  await page.waitForSelector('.menu .swatch');
  await key('ArrowDown', 3);
  const live = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  await shot('21-settings-theme-menu');
  const fr = await page.evaluate(() => { const f = document.querySelector('.menu .vi.f > .li'), o = document.querySelector('.menu .vi:not(.f) > .li'); return { f: f && f.textContent, fb: f && getComputedStyle(f).backgroundColor, ob: o && getComputedStyle(o).backgroundColor }; });
  check(fr.f === 'Cinema' && fr.fb !== fr.ob, 'the focused row of a menu stands out ' + JSON.stringify(fr));
  await key('Escape');
  const back = await page.evaluate(() => [document.documentElement.getAttribute('data-theme'), Store.prefs().theme]);
  check(live === 'cinema' && back[0] === 'ocean' && back[1] === 'ocean', 'the theme menu shows each theme while focused; Back keeps the old one ' + live + ' ' + back);
  await key('Escape');
}

async function partArabic(browser) {
  console.log('7. Arabic (right to left), the demo playlist');
  const t = await open(browser, { locale: 'ar' });
  const { page, key, shot } = t;
  const d = await page.evaluate(() => ({ dir: document.documentElement.dir, h: document.querySelector('.welcome h1').textContent }));
  check(d.dir === 'rtl' && /قائمة/.test(d.h), 'Arabic: right to left ' + JSON.stringify(d));
  await key('ArrowLeft');                    // in RTL, left goes to the next button (Try the demo)
  await key('Enter');
  await page.waitForSelector('.home .home-tiles .tile');
  await shot('22-ar-home');
  await key('ArrowLeft'); await key('Enter');
  await page.waitForFunction(() => UI.top().constructor.name === 'BrowseScreen' && UI.top().items.length > 0, null, { timeout: 30000 });
  await key('Enter');
  await page.waitForTimeout(700);
  const g = await page.evaluate(() => { const v = UI.top().gv, a = v.node(0).getBoundingClientRect(), b = v.node(1).getBoundingClientRect(); return { first: Math.round(a.x), second: Math.round(b.x), z: UI.top().zone }; });
  check(g.first > g.second, 'posters run right to left ' + JSON.stringify(g));
  await key('ArrowLeft');
  const f = await page.evaluate(() => UI.top().gv.index);
  check(f === 1, 'in Arabic ← moves to the next poster');
  await shot('23-ar-movies');
  check(t.errors.length === 0, 'no page errors (Arabic) ' + t.errors.join(' | '));
  await t.ctx.close();
}

async function partM3u(browser) {
  console.log('8. An M3U link: channels, films and series found in one file');
  const t = await open(browser);
  const { page, key } = t;
  await key('Enter');
  await page.waitForSelector('.form .field input');
  await key('ArrowUp'); await key('ArrowRight'); await key('Enter');     // M3U link
  await page.waitForFunction(() => UI.top().p.kind === 'm3u');
  t.answers.push(M3U, 'Big M3U');
  await key('ArrowDown'); await key('Enter'); await page.waitForTimeout(80); await key('Enter'); await page.waitForTimeout(80); await key('Enter');
  await page.waitForSelector('.home .home-tiles .tile', { timeout: 15000 });
  await key('Enter');
  await page.waitForFunction(() => UI.top().constructor.name === 'LiveScreen' && UI.top().items.length > 0, null, { timeout: 30000 });
  const n = await page.evaluate(async () => { await Catalog.open('vod'); await Catalog.open('series'); return { live: Catalog.count('live'), vod: Catalog.count('vod'), series: Catalog.count('series'), cats: Catalog.cats('live').map((c) => c.name).join(',') }; });
  check(n.live === 3000 && n.vod === 300 && n.series === 1 && /News/.test(n.cats), 'M3U: 3 000 channels, 300 films, 1 series (S01E01..12 grouped) ' + JSON.stringify(n));
  await t.shot('24-m3u-live');
  check(t.errors.length === 0, 'no page errors (M3U) ' + t.errors.join(' | '));
  await t.ctx.close();
}

async function partSpeed(t) {
  console.log('9. Speed test, About, playlists');
  const { page, key, shot } = t;
  await page.evaluate(() => { const h = UI.top(); h.zone = h.zones.indexOf('acts'); h.ai = h.acts.findIndex((a) => a.id === 'speed'); h.paint(); });
  await key('Enter');
  await page.waitForSelector('.speed .btn.f');
  await page.evaluate(() => { const s = UI.top(); s.run = s.run.bind(s); });
  await key('Enter');
  await page.waitForFunction(() => /Mbps/.test(document.querySelector('.speed .verdict').textContent), null, { timeout: 20000 });
  const v = await page.evaluate(() => document.querySelector('.speed .verdict').textContent);
  check(/Average speed: [\d.]+ Mbps/.test(v), 'the speed test measures and says what it is good for: ' + v);
  await shot('25-speed-test');
  await key('Escape');
  await page.evaluate(() => { const h = UI.top(); h.zone = h.zones.indexOf('acts'); h.ai = h.acts.findIndex((a) => a.id === 'pls'); h.paint(); });
  await key('Enter');
  await page.waitForSelector('.screen.on .li');
  await shot('26-playlists');
  const rows = await page.evaluate(() => UI.top().rows.map((r) => r.label));
  check(rows[0] === 'My test server' && rows.indexOf('Add a playlist') >= 0, 'playlists: the saved one, Add, the demo ' + rows.join(' | '));
  await key('Escape');
}

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
try {
  if (!ONLY || ONLY === 'main') {
    const t = await partBasics(browser);
    await partMovies(t);
    await partPlayer(t);
    await partSeries(t);
    await partLive(t);
    await partThemes(t);
    await partSpeed(t);
    check(t.errors.length === 0, 'no page errors ' + t.errors.join(' | '));
    await t.ctx.close();
  }
  if (!ONLY || ONLY === 'ar') await partArabic(browser);
  if (!ONLY || ONLY === 'm3u') await partM3u(browser);
} catch (e) { failures++; console.log('  FAIL crashed: ' + (e && e.stack || e)); if (global.__errs) console.log('page errors: ' + global.__errs.join(' | ')); if (global.__page) console.log('last actions: ' + await global.__page.evaluate(() => window.__acts.join(' ') + ' | keys ' + window.__keys.join(' ') + ' | top ' + UI.top().constructor.name + ' modal ' + UI.modalOpen() + ' ' + [...document.querySelectorAll('.dialog,.menu,.loading')].map((x) => x.textContent.slice(0, 60)).join(';')).catch(() => '')); }
await browser.close();
console.log(failures ? `\n${failures} of ${checks} check(s) FAILED` : `\nall ${checks} checks passed`);
process.exit(failures ? 1 : 0);
