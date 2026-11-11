/* Off the main thread: turns a downloaded list (Xtream JSON or an M3U file, possibly tens of MB) into small items, so the
 * screen never freezes while a big list is read. Items keep only what the screens use:
 *   { i: id, n: name, k: name for search, c: category id, l: picture, r: rating 0-10, a: added (s), x: file extension,
 *     e: guide id, no: channel number, y: year, u: stream address (M3U only), g: genre }
 * Message in: { id, buf: ArrayBuffer, fmt: 'json' | 'm3u', kind: 'live' | 'vod' | 'series' }
 * Message out: { id, items } or { id, error } ; for M3U: { id, m3u: { live, vod, series, cats: { live, vod, series } } } */
'use strict';
function fold(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim(); }
function num(v) { const n = parseFloat(v); return isFinite(n) ? n : 0; }
function yearOf(s) { const m = /\b(19[0-9]{2}|20[0-9]{2})\b/.exec(String(s || '')); return m ? +m[1] : 0; }
function compact(x, kind) {
  const id = kind === 'series' ? x.series_id : x.stream_id;
  if (id === undefined || id === null) return null;
  const n = String(x.name || x.title || '').trim();
  const o = { i: String(id), n, k: fold(n), c: String(x.category_id === undefined || x.category_id === null ? '0' : x.category_id) };
  const l = kind === 'series' ? x.cover : x.stream_icon;
  if (l) o.l = String(l);
  const r = num(x.rating_5based) ? num(x.rating_5based) * 2 : num(x.rating);
  if (r > 0) o.r = Math.round(Math.min(10, r) * 10) / 10;
  const a = num(kind === 'series' ? x.last_modified : x.added);
  if (a > 0) o.a = a;
  if (kind === 'live') { if (x.epg_channel_id) o.e = String(x.epg_channel_id); if (x.num) o.no = num(x.num); if (num(x.tv_archive)) o.ar = 1; }
  if (kind === 'vod' && x.container_extension) o.x = String(x.container_extension);
  if (kind !== 'live') { const y = num(x.year) || yearOf(x.releaseDate || x.releasedate || n); if (y) o.y = y; if (x.genre) o.g = String(x.genre).slice(0, 80); }
  if (Array.isArray(x.category_ids) && x.category_ids.length > 1) o.cs = x.category_ids.map(String);
  return o;
}
function attr(line, name) { const m = new RegExp(name + '="([^"]*)"', 'i').exec(line); return m ? m[1] : ''; }
const EP = /^(.*?)[\s._-]*\bS(\d{1,2})\s*E(\d{1,3})\b/i;
function parseM3u(text) {
  const out = { live: [], vod: [], series: [], cats: { live: [], vod: [], series: [] } }, seenCat = { live: {}, vod: {}, series: {} }, shows = {};
  const lines = text.split(/\r?\n/);
  let info = null, n = 0;
  function cat(kind, name) {
    name = name || 'Other';
    let c = seenCat[kind][name];
    if (!c) { c = seenCat[kind][name] = { id: kind[0] + (out.cats[kind].length + 1), name }; out.cats[kind].push(c); }
    return c.id;
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    if (line.indexOf('#EXTINF') === 0) { info = line; continue; }
    if (line[0] === '#') continue;
    if (!info) continue;
    const comma = info.lastIndexOf('",') >= 0 ? info.indexOf(',', info.lastIndexOf('"')) : info.indexOf(',');
    const name = (comma >= 0 ? info.slice(comma + 1) : '').trim() || attr(info, 'tvg-name') || 'Channel ' + (n + 1);
    const group = attr(info, 'group-title'), logo = attr(info, 'tvg-logo'), url = line;
    const epm = EP.exec(name);
    const isMovie = /\/movie\//i.test(url) || (/\.(mp4|mkv|avi|mov)(\?|$)/i.test(url) && !epm);
    const isSeries = /\/series\//i.test(url) || !!epm;
    n++;
    if (isSeries) {
      const show = epm ? epm[1].trim() || name : name;
      const key = fold(show);
      let s = shows[key];
      if (!s) {
        s = shows[key] = { i: 'm' + Object.keys(shows).length, n: show, k: key, c: cat('series', group), eps: {} };
        if (logo) s.l = logo;
        out.series.push(s);
      }
      const se = epm ? +epm[2] : 1, ep = epm ? +epm[3] : Object.keys(s.eps).length + 1;
      (s.eps[se] = s.eps[se] || []).push({ id: 'e' + n, title: name, episode_num: ep, season: se, u: url, l: logo });
    } else if (isMovie) {
      const o = { i: 'v' + n, n: name, k: fold(name), c: cat('vod', group), u: url, x: (/\.([a-z0-9]{2,4})(\?|$)/i.exec(url) || [])[1] || 'mp4' };
      if (logo) o.l = logo;
      const y = yearOf(name); if (y) o.y = y;
      out.vod.push(o);
    } else {
      const o = { i: 'l' + n, n: name, k: fold(name), c: cat('live', group), u: url, no: out.live.length + 1 };
      if (logo) o.l = logo;
      const e = attr(info, 'tvg-id'); if (e) o.e = e;
      out.live.push(o);
    }
    info = null;
  }
  return out;
}
self.onmessage = (ev) => {
  const d = ev.data || {};
  try {
    let text = new TextDecoder('utf-8').decode(d.buf);
    if (d.fmt === 'm3u') {
      if (!/^\s*#EXTM3U/.test(text) && text.indexOf('#EXTINF') < 0) throw new Error('bad-data');
      return self.postMessage({ id: d.id, m3u: parseM3u(text) });
    }
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    const raw = JSON.parse(text);
    text = null;
    const arr = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? Object.values(raw) : null;
    if (!arr) throw new Error('bad-data');
    const items = [];
    for (let i = 0; i < arr.length; i++) { const o = arr[i] && compact(arr[i], d.kind); if (o) items.push(o); }
    self.postMessage({ id: d.id, items });
  } catch (e) {
    self.postMessage({ id: d.id, error: String(e && e.message || e) === 'bad-data' || e instanceof SyntaxError ? 'bad-data' : String(e && e.message || e) });
  }
};
