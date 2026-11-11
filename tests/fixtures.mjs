// Test fixtures for Speedy IPTV: a fake Xtream Codes server (thousands of channels, films and series), an M3U list,
// the subtitle service, pictures, a real MP4 film and a real HLS live stream (made once with ffmpeg), all answered by
// Playwright routes: nothing reaches the internet.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const APP_DIR = path.resolve(HERE, '..');
export const XT = 'http://iptv.test:8080';
export const M3U = 'http://lists.test/big.m3u';

// ---------------- media (ffmpeg, once) ----------------
export function media() {
  const dir = path.join(os.tmpdir(), 'speedy-test-media');
  const film = path.join(dir, 'film.mp4'), hls = path.join(dir, 'hls', 'live.m3u8');
  if (!fs.existsSync(film) || !fs.existsSync(hls)) {
    fs.mkdirSync(path.join(dir, 'hls'), { recursive: true });
    execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=25', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100', '-t', '60',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-g', '25', '-c:a', 'aac', '-b:a', '64k', '-movflags', '+faststart', film]);
    execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=1280x720:rate=25', '-f', 'lavfi', '-i', 'sine=frequency=660:sample_rate=44100', '-t', '40',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-g', '50', '-c:a', 'aac', '-b:a', '64k', '-f', 'hls', '-hls_time', '4', '-hls_list_size', '0',
      '-hls_segment_filename', path.join(dir, 'hls', 'seg%03d.ts'), hls]);
  }
  return { dir, film, hls: path.dirname(hls) };
}
export const SRT_EN = '1\r\n00:00:01,000 --> 00:00:40,000\r\nHello from the subtitle file\r\n\r\n2\r\n00:00:40,500 --> 00:00:59,000\r\n<i>Second line</i> of the film\r\n';
// an Arabic file in Windows-1256 (what many Arabic subtitle sites give)
export function srtArabic1256() {
  const head = Buffer.from('1\r\n00:00:01,000 --> 00:00:59,000\r\n', 'latin1');
  const map = { 'م': 0xE3, 'ر': 0xD1, 'ح': 0xCD, 'ب': 0xC8, 'ا': 0xC7, ' ': 0x20, 'ك': 0xDF, 'ف': 0xDD, 'ي': 0xED };
  const body = Buffer.from([...'مرحبا بكم في'].map((c) => map[c]));
  return Buffer.concat([head, body, Buffer.from(' Speedy\r\n', 'latin1')]);
}

// ---------------- the Xtream server ----------------
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
export function xtreamData(o) {
  o = Object.assign({ live: 6000, vod: 20000, series: 3000 }, o || {});
  const liveCats = ['News', 'Sports', 'Movies', 'Kids', 'Arabic', 'France', 'Adult XXX', 'Big list'].map((n, i) => ({ category_id: String(i + 1), category_name: n, parent_id: 0 }));
  const live = [];
  for (let i = 1; i <= o.live; i++) {
    const c = i <= 4000 ? '8' : String(1 + (i % 7));
    live.push({ num: i, name: (c === '5' ? 'قناة ' : 'Channel ') + i, stream_type: 'live', stream_id: i, stream_icon: 'http://img.test/logo/' + (i % 50) + '.png', epg_channel_id: 'ch' + i, added: String(1700000000 + i), category_id: c, tv_archive: 0 });
  }
  const vodCats = ['Action', 'Comedy', 'Drama', 'Animation', 'Arabic films', 'Huge list'].map((n, i) => ({ category_id: String(100 + i), category_name: n, parent_id: 0 }));
  const vod = [];
  for (let i = 1; i <= o.vod; i++) {
    const c = i <= 15000 ? '105' : String(100 + (i % 5));
    vod.push({ num: i, name: 'Film ' + i + (i % 3 === 0 ? ' (2019)' : ''), stream_type: 'movie', stream_id: i, stream_icon: 'http://img.test/poster/' + (i % 40) + '.png', rating: String((i % 50) / 5), rating_5based: (i % 50) / 10, added: String(1700000000 + i * 60), category_id: c, container_extension: 'mp4' });
  }
  const serCats = ['Drama series', 'Comedy series', 'Kids series'].map((n, i) => ({ category_id: String(200 + i), category_name: n, parent_id: 0 }));
  const series = [];
  for (let i = 1; i <= o.series; i++) series.push({ num: i, name: 'Show ' + i, series_id: i, cover: 'http://img.test/poster/' + (i % 40) + '.png', plot: 'A show.', genre: i % 2 ? 'Drama, Crime' : 'Comedy', rating: String(5 + (i % 5)), last_modified: String(1700000000 + i), category_id: String(200 + (i % 3)) });
  return { liveCats, live, vodCats, vod, serCats, series };
}
export function xtreamAnswer(d, url, opts) {
  const u = new URL(url), q = u.searchParams, a = q.get('action') || '';
  if (q.get('username') !== 'demo' || q.get('password') !== 'pass') return { status: 200, json: { user_info: { auth: 0 } } };
  if (!a) return { status: 200, json: { user_info: { auth: 1, status: 'Active', exp_date: String(Math.floor(Date.UTC(2027, 5, 30) / 1000)), max_connections: '2', active_cons: '0', is_trial: '0', allowed_output_formats: ['m3u8', 'ts'] }, server_info: { url: 'iptv.test', port: '8080' } } };
  const cat = q.get('category_id');
  const by = (l) => cat ? l.filter((x) => x.category_id === cat) : l;
  switch (a) {
    case 'get_live_categories': return { json: d.liveCats };
    case 'get_live_streams': return { json: by(d.live) };
    case 'get_vod_categories': return { json: d.vodCats };
    case 'get_vod_streams': return { json: by(d.vod) };
    case 'get_series_categories': return { json: d.serCats };
    case 'get_series': return { json: by(d.series) };
    case 'get_vod_info': {
      const id = +q.get('vod_id');
      return { json: { info: { plot: 'Film ' + id + ' is a test film made with ffmpeg, sixty seconds long.', director: 'Test Director', cast: 'Actor One, Actor Two', genre: 'Action', releasedate: '2019-05-01', duration_secs: 60, rating: '7.4', tmdb_id: '550', backdrop_path: ['http://img.test/back/1.png'], movie_image: 'http://img.test/poster/1.png', video: { width: 1280, height: 720 } }, movie_data: { stream_id: id, name: 'Film ' + id, container_extension: 'mp4' } } };
    }
    case 'get_series_info': {
      const id = +q.get('series_id'), eps = {};
      for (let s = 1; s <= 3; s++) { eps[s] = []; for (let e = 1; e <= (s === 3 ? 120 : 8); e++) eps[s].push({ id: String(id * 1000 + s * 200 + e), episode_num: e, title: 'Show ' + id + ' S' + s + 'E' + e, container_extension: 'mp4', season: s, info: { duration_secs: 60, plot: 'Episode plot', movie_image: '' } }); }
      return { json: { info: { name: 'Show ' + id, plot: 'Show ' + id + ' has three seasons; the third has 120 episodes.', cast: 'Cast A', director: 'Dir B', genre: 'Drama', releaseDate: '2021-01-01', rating: '8.1', backdrop_path: [], cover: 'http://img.test/poster/2.png', tmdb: '1399' }, episodes: eps } };
    }
    case 'get_short_epg': {
      const h = 3600, t0 = Math.floor(Date.now() / 1000 / h) * h, sid = q.get('stream_id');
      return { json: { epg_listings: [0, 1, 2].map((k) => ({ title: b64(k === 0 ? 'Evening news ' + sid : k === 1 ? 'Football night' : 'Late film'), description: b64('Programme ' + (k + 1) + ' on channel ' + sid), start_timestamp: String(t0 + k * h), stop_timestamp: String(t0 + (k + 1) * h) })) } };
    }
  }
  return { status: 200, json: [] };
}
export function m3uText(n) {
  const out = ['#EXTM3U'];
  for (let i = 1; i <= n; i++) {
    const g = i % 3 === 0 ? 'Sports' : i % 3 === 1 ? 'News' : 'Music';
    out.push('#EXTINF:-1 tvg-id="m' + i + '" tvg-name="M3U channel ' + i + '" tvg-logo="http://img.test/logo/' + (i % 50) + '.png" group-title="' + g + '",M3U channel ' + i, 'http://iptv.test:8080/live/demo/pass/' + i + '.m3u8');
  }
  for (let i = 1; i <= 300; i++) out.push('#EXTINF:-1 tvg-logo="http://img.test/poster/3.png" group-title="Films VOD",M3U film ' + i, 'http://iptv.test:8080/movie/demo/pass/' + i + '.mp4');
  for (let e = 1; e <= 12; e++) out.push('#EXTINF:-1 group-title="Series",My Show S01E' + String(e).padStart(2, '0'), 'http://iptv.test:8080/series/demo/pass/' + (9000 + e) + '.mp4');
  return out.join('\n');
}

// a PNG picture (a coloured square), the same for every poster / logo
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAIAAAA2iEnWAAAAFklEQVR4nGNgYGBgYGAQZmBgYGD4DwAEBwEBd2PYmQAAAABJRU5ErkJggg==', 'base64');
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };

function ranged(route, file, type) {
  const buf = fs.readFileSync(file), rg = route.request().headers()['range'];
  if (rg) {
    const m = /bytes=(\d+)-(\d*)/.exec(rg), s = +m[1], e = m[2] ? Math.min(+m[2], buf.length - 1) : buf.length - 1;
    return route.fulfill({ status: 206, headers: Object.assign({ 'Content-Type': type, 'Content-Range': 'bytes ' + s + '-' + e + '/' + buf.length, 'Accept-Ranges': 'bytes' }, CORS), body: buf.subarray(s, e + 1) });
  }
  return route.fulfill({ status: 200, headers: Object.assign({ 'Content-Type': type, 'Accept-Ranges': 'bytes' }, CORS), body: buf });
}

// everything the app reaches. stats counts the requests (to prove pictures are asked only when the list rests)
export async function routeAll(ctx, o) {
  o = o || {};
  const m = media(), d = o.data || xtreamData(o.sizes), stats = { img: 0, api: {}, subs: 0, film: 0, live: 0 };
  const sdk = o.sdk || path.resolve(APP_DIR, '..', 'g', 'sdk', 'mypc-sdk.js');
  const hlsJs = o.hlsJs || path.join(os.tmpdir(), 'speedy-hls', 'package', 'dist', 'hls.min.js');
  await ctx.route('https://imad-os.github.io/g/sdk/mypc-sdk.js', (r) => r.fulfill({ status: 200, headers: Object.assign({ 'Content-Type': 'application/javascript' }, CORS), body: fs.readFileSync(sdk) }));
  await ctx.route('https://cdn.jsdelivr.net/npm/hls.js@1.5.13/dist/hls.min.js', (r) => fs.existsSync(hlsJs) ? r.fulfill({ status: 200, headers: Object.assign({ 'Content-Type': 'application/javascript' }, CORS), body: fs.readFileSync(hlsJs) }) : r.abort());
  if (o.appBase) await ctx.route(o.appBase + '**', (r) => {
    const p = decodeURIComponent(new URL(r.request().url()).pathname).replace(/^\/+/, '') || 'index.html';
    const f = path.join(APP_DIR, p);
    if (!f.startsWith(APP_DIR) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return r.fulfill({ status: 404, body: 'not found' });
    const type = { html: 'text/html', js: 'application/javascript', css: 'text/css', png: 'image/png', json: 'application/json', woff2: 'font/woff2' }[path.extname(f).slice(1)] || 'application/octet-stream';
    return r.fulfill({ status: 200, headers: Object.assign({ 'Content-Type': type }, CORS), body: fs.readFileSync(f) });
  });
  await ctx.route(XT + '/**', (r) => {
    const url = r.request().url(), p = new URL(url).pathname;
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
    if (p === '/player_api.php') {
      const a = new URL(url).searchParams.get('action') || 'info';
      stats.api[a] = (stats.api[a] || 0) + 1;
      if (o.slowApi) return new Promise((res) => setTimeout(res, o.slowApi)).then(() => { const x = xtreamAnswer(d, url); return r.fulfill({ status: x.status || 200, headers: Object.assign({ 'Content-Type': 'application/json' }, CORS), body: JSON.stringify(x.json) }); });
      const x = xtreamAnswer(d, url);
      return r.fulfill({ status: x.status || 200, headers: Object.assign({ 'Content-Type': 'application/json' }, CORS), body: JSON.stringify(x.json) });
    }
    if (/^\/live\/[^/]+\/[^/]+\/\d+\.(m3u8|ts)$/.test(p)) { stats.live++; return r.fulfill({ status: 200, headers: Object.assign({ 'Content-Type': 'application/vnd.apple.mpegurl' }, CORS), body: fs.readFileSync(path.join(m.hls, 'live.m3u8')) }); }
    if (/\/seg\d+\.ts$/.test(p)) return r.fulfill({ status: 200, headers: Object.assign({ 'Content-Type': 'video/mp2t' }, CORS), body: fs.readFileSync(path.join(m.hls, path.basename(p))) });
    if (/^\/(movie|series)\//.test(p)) { stats.film++; return ranged(r, m.film, 'video/mp4'); }
    return r.fulfill({ status: 404, headers: CORS, body: '' });
  });
  await ctx.route('http://lists.test/**', (r) => r.fulfill({ status: 200, headers: Object.assign({ 'Content-Type': 'audio/x-mpegurl' }, CORS), body: m3uText(o.m3uCount || 3000) }));
  await ctx.route('http://img.test/**', (r) => { stats.img++; return r.fulfill({ status: 200, headers: Object.assign({ 'Content-Type': 'image/png' }, CORS), body: PNG }); });
  await ctx.route('https://iptv-lists.mypc-app.workers.dev/**', (r) => {
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
    const u = new URL(r.request().url());
    stats.subs++;
    if (u.pathname.indexOf('/fetchSubtitles') === 0) return r.fulfill({ status: 200, headers: Object.assign({ 'Content-Type': 'application/json' }, CORS), body: JSON.stringify({ status: 'success', subtitles: [{ label: 'English · Film.2019.1080p', lang: 'en', file: 'http://subs.test/en.srt' }, { label: 'Arabic · Film.2019', lang: 'ar', file: 'http://subs.test/ar.srt' }] }) });
    if (u.pathname.indexOf('/downloadSubtitle') === 0) { const f = u.searchParams.get('url') || ''; return r.fulfill({ status: 200, headers: Object.assign({ 'Content-Type': 'application/octet-stream' }, CORS), body: /ar\.srt/.test(f) ? srtArabic1256() : Buffer.from(SRT_EN) }); }
    return r.fulfill({ status: 404, headers: CORS, body: '' });
  });
  await ctx.route(/speed\.cloudflare\.com|proof\.ovh\.net/, (r) => r.fulfill({ status: 200, headers: Object.assign({ 'Content-Type': 'application/octet-stream' }, CORS), body: Buffer.alloc(2 * 1024 * 1024, 7) }));
  return stats;
}
