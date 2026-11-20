/* Films, TV shows and playlists on Google Drive, through My PC only (MyPC.drive, API 14; sdk/GUIDE.md section 19).
 * My PC signs in (one Google account per My PC profile) and sends every Drive request: Speedy never has a token, a Google
 * client or any Google code of its own.
 *   Gd.available()             My PC 14+ with the Drive bridge
 *   Gd.status()                { configured, signedIn, needsSignIn, allowed, account, full, picker }
 *   Gd.signIn()                My PC's sign-in screen over Speedy
 *   Gd.get(id)                 one file (cached for the session)
 *   Gd.folder(id)              a folder: [{ id, name, dir, size, mime, ... }] folders, videos and playlists ('root' = My Drive, 'shared' = Shared with me)
 *   Gd.library(onN, again)     every video of the Drive: { movies: [file], shows: [{ name, key, eps }], all } (kept for the session)
 *   Gd.playlists()             the .m3u / .m3u8 files of the Drive
 *   Gd.spec(f)                 the subtitle files next to a video (same folder, read when chosen)
 *   Gd.picture(f, cb)          Google's own picture of a video (thumbnailLink), 320 px wide, one at a time; a blob: URL or ''
 *   Gd.stream(f, onProgress)   { url, mode, close() } for the web player: Range pieces through My PC (sw.js), else a download
 *   Gd.tv()                    true on a TV with My PC 24+: the TV's own player plays 'drive:<id>' (every format, seeking).
 *                              The TV's <video> does not go through sw.js (imad 2026-11-20: "Drive videos don't play"), so on
 *                              a TV only this way works.
 * file = { id, name, size, mime, parent, title, year, show, season, ep, thumb, dur } */
'use strict';
const Gd = (() => {
  const FOLDER = 'application/vnd.google-apps.folder';
  const VIDEO = /^(mp4|m4v|mkv|avi|mov|wmv|asf|ts|m2ts|mts|mpg|mpeg|vob|flv|webm|3gp|ogv)$/;
  const SUB = /^(srt|vtt|ass|ssa|sub)$/, LIST = /^(m3u|m3u8)$/;
  const FIELDS = 'id,name,mimeType,size,parents,thumbnailLink,hasThumbnail,videoMediaMetadata(durationMillis),modifiedTime';
  const BLOB_MAX = 200 * 1024 * 1024;               // without the worker a film must be downloaded whole first: small ones only
  const dirs = new Map(), pics = new Map(), DIR_KEEP = 60, PIC_KEEP = 120, PIC_W = 320;
  let lib = null, lists = null;

  function available() { try { return MyPC.apiLevel >= 14 && !!(MyPC.info() && MyPC.info().bridges && MyPC.info().bridges.drive); } catch (e) { return false; } }
  function status() { return MyPC.drive.status(); }
  function signIn() { return MyPC.drive.signIn(); }
  function isVideo(f) { return (/^video\//.test(f.mimeType || '') && f.mimeType !== 'video/vnd.dlna.mpeg-tts') || VIDEO.test(ext(f.name)); }
  function isList(f) { return LIST.test(ext(f.name)) || /mpegurl/i.test(f.mimeType || ''); }
  function isSub(f) { return SUB.test(ext(f.name)); }
  // a Drive file object -> what the screens use (names cleaned like the USB films: "The.Film.2019.1080p.mkv" -> The Film, 2019)
  function file(x) {
    const f = { id: x.id, name: x.name, size: +x.size || 0, mime: x.mimeType || '', parent: (x.parents && x.parents[0]) || '', thumb: x.hasThumbnail === false ? '' : x.thumbnailLink || '',
                dur: x.videoMediaMetadata && +x.videoMediaMetadata.durationMillis ? Math.round(x.videoMediaMetadata.durationMillis / 1000) : 0 };
    if (x.mimeType === FOLDER) { f.dir = true; return f; }
    if (isList(x)) { f.list = true; return f; }
    const e = Usb.episodeOf(x.name, []);
    if (e) Object.assign(f, e, { title: e.show + ' · S' + pad2(e.season) + 'E' + pad2(e.ep) });
    else Object.assign(f, Usb.cleanName(x.name));
    return f;
  }

  // a folder, read once per session (Look again reads it anew): folders, then videos and playlists; subtitle files kept aside
  function raw(id) {
    const k = String(id);
    if (dirs.has(k)) return dirs.get(k);
    const o = id === 'shared' ? { q: 'sharedWithMe = true' } : { folder: id };
    o.fields = FIELDS;
    const p = Promise.resolve(MyPC.drive.listAll(o, 2000));
    dirs.set(k, p);
    p.catch(() => dirs.delete(k));
    if (dirs.size > DIR_KEEP) dirs.delete(dirs.keys().next().value);
    return p;
  }
  async function folder(id) {
    const l = await raw(id);
    const out = l.filter((x) => x.mimeType === FOLDER || isVideo(x) || isList(x)).map(file);
    out.sort((a, b) => (b.dir ? 1 : 0) - (a.dir ? 1 : 0) || natCmp(a.name, b.name));
    return out;
  }
  // every video of the Drive, grouped like the USB drive: films, and TV shows by their SxxEyy / 1x02 names
  async function library(onN, again) {
    if (lib && !again) return lib;
    if (again) { dirs.clear(); lists = null; }
    const all = await MyPC.drive.listAll({ place: 'videos', fields: FIELDS, orderBy: 'name_natural' }, 3000);
    if (onN) onN(all.length);
    const movies = [], showMap = new Map();
    for (const x of all) {
      if (!isVideo(x) || /(^|[\s._-])sample$/i.test(stripExt(x.name))) continue;
      const f = file(x);
      if (f.show) {
        const k = fold(f.show);
        let s = showMap.get(k);
        if (!s) { s = { name: f.show, key: k, eps: [] }; showMap.set(k, s); }
        s.eps.push(f);
      } else movies.push(f);
    }
    movies.sort((a, b) => natCmp(a.title, b.title));
    const shows = Array.from(showMap.values()).sort((a, b) => natCmp(a.name, b.name));
    shows.forEach((s) => s.eps.sort((a, b) => a.season - b.season || a.ep - b.ep || natCmp(a.name, b.name)));
    lib = { movies, shows, all: movies.length + shows.reduce((n, s) => n + s.eps.length, 0) };
    return lib;
  }
  async function playlists(again) {
    if (lists && !again) return lists;
    const l = await MyPC.drive.listAll({ q: "name contains '.m3u'", fields: FIELDS }, 500);
    lists = l.filter(isList).map(file).sort((a, b) => natCmp(a.name, b.name));
    return lists;
  }

  // the subtitle files beside a video: "film.srt", "film.ar.srt", any subtitle file when the folder holds one video
  async function spec(f) {
    if (!f.parent) return { files: [] };
    let here = [];
    try { here = await raw(f.parent); } catch (e) { here = []; }
    const base = fold(stripExt(f.name)), vids = here.filter(isVideo).length;
    const subs = here.filter((x) => isSub(x) && (vids <= 1 || fold(stripExt(x.name)).indexOf(base) === 0)).slice(0, 30);
    return { files: subs.map((x) => {
      const lang = Subs.langOfFile(x.name, f.name) || (/(arabic|arab|ara)\b/i.test(x.name) ? 'ar' : /(english|eng)\b/i.test(x.name) ? 'en' : /(french|fran|fre)\b/i.test(x.name) ? 'fr' : /(spanish|espa|spa)\b/i.test(x.name) ? 'es' : '');
      return { label: (lang ? Subs.langName(lang) + ' · ' : '') + x.name, lang,
               load: async () => { const n = Math.min(+x.size || 4194304, 4194304); const r = await MyPC.drive.read(x.id, 0, n - 1); const c = Subs.parse(Subs.decode(r.buf, lang), x.name); if (!c.length) throw Net.err('bad-data', 'no cues'); return c; } };
    }) };
  }
  // the next videos of the same folder (episodes after this one, else the files after it): what "Next" plays
  async function after(f) {
    if (!f.parent) return [];
    let l;
    try { l = (await raw(f.parent)).filter(isVideo).map(file); } catch (e) { return []; }
    if (f.show) return l.filter((x) => x.show && fold(x.show) === fold(f.show) && (x.season > f.season || (x.season === f.season && x.ep > f.ep))).sort((a, b) => a.season - b.season || a.ep - b.ep);
    return [];
  }

  /* ---- Google's picture of a video, through My PC (thumbnailLink needs the sign-in): one at a time, the newest asked first,
   * made PIC_W wide, the last PIC_KEEP kept while Speedy is open; never while a film plays full screen */
  const wait = [];
  let busy = false;
  function picture(f, cb) {
    if (!f || !f.thumb) { cb(''); return; }
    const k = f.id;
    if (pics.has(k)) { const v = pics.get(k); pics.delete(k); pics.set(k, v); cb(v); return; }
    for (const j of wait) if (j.k === k) { j.cbs.push(cb); return; }
    wait.push({ k, f, cbs: [cb] });
    if (wait.length > 40) wait.splice(0, wait.length - 40).forEach((j) => j.cbs.forEach((c) => c('')));
    pump();
  }
  function playing() { try { return typeof Player !== 'undefined' && Player.mode() === 'full'; } catch (e) { return false; } }
  async function pump() {
    if (busy) return;
    busy = true;
    try {
      while (wait.length) {
        while (playing()) await new Promise((r) => setTimeout(r, 1000));
        const j = wait.pop();
        if (pics.has(j.k)) { j.cbs.forEach((c) => c(pics.get(j.k))); continue; }
        let u = '';
        try { const r = await MyPC.drive.thumbnail(j.f.thumb, PIC_W); u = await small(new Blob([r.buf], { type: r.type || 'image/jpeg' })); } catch (e) { u = ''; }
        pics.set(j.k, u);
        if (pics.size > PIC_KEEP) { const old = pics.keys().next().value, ou = pics.get(old); pics.delete(old); if (ou) { try { URL.revokeObjectURL(ou); } catch (e) {} } }
        j.cbs.forEach((c) => c(u));
      }
    } finally { busy = false; }
  }
  async function small(blob) {
    try {
      const bm = await createImageBitmap(blob);
      if (bm.width <= PIC_W) { bm.close(); return URL.createObjectURL(blob); }
      const c = document.createElement('canvas');
      c.width = PIC_W; c.height = Math.max(1, Math.round(PIC_W * bm.height / bm.width));
      c.getContext('2d').drawImage(bm, 0, 0, c.width, c.height);
      bm.close();
      const out = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.85));
      c.width = c.height = 0;
      if (out) return URL.createObjectURL(out);
    } catch (e) { /* not a picture this browser reads */ }
    return '';
  }

  /* ---- playing: the TV's own player cannot send Google's sign-in, so a Drive film plays in the web player: its Range requests go
   * to Speedy's own worker (sw.js = My PC's drive-sw.js), which reads 2 MB pieces through My PC. Seeking works, nothing is stored. */
  let swP = null;
  function worker() {
    if (swP) return swP;
    swP = (async () => {
      if (!('serviceWorker' in navigator)) return false;
      try {
        await navigator.serviceWorker.register('sw.js');
        await navigator.serviceWorker.ready;
        if (navigator.serviceWorker.controller) return true;
        return await new Promise((res) => { const t = setTimeout(() => res(!!navigator.serviceWorker.controller), 3000); navigator.serviceWorker.addEventListener('controllerchange', () => { clearTimeout(t); res(true); }, { once: true }); });
      } catch (e) { return false; }
    })();
    return swP;
  }
  async function stream(f, onProgress) {
    const ok = await worker();
    if (!ok && f.size > BLOB_MAX) throw Net.err('too-big', 'no worker');
    const meta = { id: f.id, name: f.name, size: String(f.size || ''), mimeType: f.mime };
    return MyPC.drive.stream(meta, { worker: ok ? 'sw.js' : '', onProgress, max: BLOB_MAX });
  }
  function tv() { try { return !!(MyPC.video && MyPC.video.drive && MyPC.video.drive()); } catch (e) { return false; } }
  // a playlist file on Drive, for Provider (M3U): the whole file through My PC
  async function readList(id) { return (await MyPC.drive.download(id, { max: 100 * 1024 * 1024 })).buf; }

  // one file by id (Continue watching keeps only the id), asked once per session
  const metas = new Map();
  function get(id) {
    if (!metas.has(id)) { const p = Promise.resolve(MyPC.drive.get(id)).then(file); p.catch(() => metas.delete(id)); metas.set(id, p); if (metas.size > 100) metas.delete(metas.keys().next().value); }
    return metas.get(id);
  }

  function forget() { dirs.clear(); metas.clear(); lib = null; lists = null; }
  return { available, status, signIn, get, folder, library, playlists, spec, after, picture, stream, tv, readList, forget, isVideo, FOLDER };
})();
