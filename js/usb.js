/* Films and TV shows on the TV's USB drives (through My PC: MyPC.usb, then MyPC.video plays the file itself).
 *   Usb.available()           only on a TV with My PC 16+ (bridges.usb)
 *   Usb.drives()              [{ path, name }]
 *   Usb.library(drive, onN)   { movies: [file], shows: [{ name, key, pic, eps: [file] }], all: n } (one walk, kept for the session)
 *   Usb.list(path)            a folder: [{ name, path, dir, size }] (videos and folders only)
 *   Usb.spec(file)            what the player needs: the file + the subtitle files next to it (read when chosen)
 *   Usb.picture(file, cb)     the poster next to a film (movie.jpg, poster.jpg, folder.jpg), else (Settings > Pictures from USB films)
 *                             a picture taken from the film's first megabytes, kept on the device; as a blob: URL
 * file = { name, path, size, dir (folder path), title, year, show, season, ep } */
'use strict';
const Usb = (() => {
  const VIDEO = /^(mp4|m4v|mkv|avi|mov|wmv|asf|ts|m2ts|mts|mpg|mpeg|vob|flv|webm|3gp|divx|xvid|ogv|rmvb|tp|trp)$/;
  const SUB = /^(srt|vtt|ass|ssa|sub)$/;
  const PIC = /^(jpg|jpeg|png|webp)$/;
  const SAMPLE = /(^|[\s._-])sample$/i;
  const MAX_DIRS = 600, MAX_FILES = 5000, MAX_DEPTH = 7;
  const libs = new Map(), pics = new Map(), dirs_ = new Map();
  const DIR_KEEP = 300, PIC_KEEP = 120, PIC_W = 320;

  function available() { try { return MyPC.apiLevel >= 16 && !!(MyPC.info() && MyPC.info().bridges && MyPC.info().bridges.usb); } catch (e) { return false; } }
  async function drives() { return (await MyPC.usb.drives()) || []; }
  // a folder read once per session (the walk, the posters, the subtitles and the next episode all ask for the same folders: each
  // read is real work on the TV's drive, and the drive also feeds the film that plays)
  function rawList(path) {
    const k = String(path);
    if (dirs_.has(k)) { const v = dirs_.get(k); dirs_.delete(k); dirs_.set(k, v); return v; }
    const p = Promise.resolve(MyPC.usb.list(path)).then((l) => l || []);
    dirs_.set(k, p);
    p.catch(() => dirs_.delete(k));
    if (dirs_.size > DIR_KEEP) dirs_.delete(dirs_.keys().next().value);
    return p;
  }
  // while a film plays full screen nothing else reads the drive (it would make the picture stop and the TV freeze)
  function playing() { try { return typeof Player !== 'undefined' && Player.mode() === 'full'; } catch (e) { return false; } }
  async function quiet() { while (playing()) await new Promise((r) => setTimeout(r, 1000)); }

  function isVideo(n) { return VIDEO.test(ext(n)); }
  // "The.Movie.Name.2019.1080p.BluRay.x264.mkv" -> { title: 'The Movie Name', year: 2019 }
  function cleanName(n) {
    let s = stripExt(n).replace(/[._]+/g, ' ').replace(/\s+/g, ' ').trim();
    let year = 0;
    const y = /(?:^|[\s([])((?:19|20)\d{2})(?:[\s)\]]|$)/.exec(s);
    if (y && y.index > 0) { year = +y[1]; s = s.slice(0, y.index); }
    s = s.replace(/[\s([-]+(2160p|1080p|720p|480p|4k|uhd|hdr|x264|x265|h264|h265|hevc|bluray|brrip|bdrip|web[ -]?dl|webrip|hdrip|dvdrip|hdtv|xvid|aac|ac3|dts|multi|french|vostfr|truefrench|arabic)\b.*$/i, '');
    s = s.replace(/[\s\-[(]+$/, '').trim();
    return { title: s || stripExt(n), year };
  }
  // "Show.Name.S01E02", "Show 1x02", ".../Show/Season 1/Episode 2.mkv"
  function episodeOf(name, dirParts) {
    const b = stripExt(name).replace(/[._]+/g, ' ');
    let m = /^(.*?)[\s-]*\bS(\d{1,2})\s*[-.]?\s*E(\d{1,3})\b/i.exec(b) || /^(.*?)[\s-]*\b(\d{1,2})x(\d{2,3})\b/i.exec(b);
    let show = '', season = 0, ep = 0;
    if (m) { show = m[1]; season = +m[2]; ep = +m[3]; }
    else {
      const sd = dirParts.length ? /^(?:season|saison|temporada|الموسم)\s*(\d{1,2})$/i.exec(dirParts[dirParts.length - 1]) : null;
      const em = /\b(?:e|ep|episode|épisode|episodio|الحلقة)\s*(\d{1,3})\b/i.exec(b) || (sd ? /^(\d{1,3})\b/.exec(b) : null);
      if (sd && em) { season = +sd[1]; ep = +em[1]; show = dirParts[dirParts.length - 2] || ''; }
      else return null;
    }
    show = show.replace(/[\s\-[(]+$/, '').trim();
    if (!show) {
      // the show is the folder (or the folder above "Season 1")
      const last = dirParts[dirParts.length - 1] || '';
      show = /^(?:season|saison|temporada|الموسم)\s*\d+$/i.test(last) ? dirParts[dirParts.length - 2] || last : last;
    }
    show = cleanName(show + '.x').title;
    return { show, season, ep };
  }

  // one walk of the drive (folders first, a few folders at a time so the TV stays smooth)
  async function library(drive, onN, again) {
    if (!again && libs.has(drive.path)) return libs.get(drive.path);
    if (again) dirs_.clear();                   // Scan again: read every folder anew
    const movies = [], showMap = new Map();
    let dirs = 0, files = 0;
    const queue = [{ path: drive.path, parts: [], depth: 0 }];
    while (queue.length && dirs < MAX_DIRS && files < MAX_FILES) {
      const d = queue.shift();
      dirs++;
      await quiet();
      let l;
      try { l = await rawList(d.path); } catch (e) { if (e && (e.code === 'denied' || e.code === 'gone')) throw e; continue; }
      for (const x of l) {
        if (x.dir) { if (d.depth < MAX_DEPTH && !/^(\$|\.|system volume information|lost\+found|found\.\d+)/i.test(x.name)) queue.push({ path: x.path, parts: d.parts.concat(x.name), depth: d.depth + 1 }); continue; }
        if (!isVideo(x.name) || SAMPLE.test(stripExt(x.name))) continue;      // "Movie-sample.mkv": the release's short sample
        files++;
        const f = { name: x.name, path: x.path, size: x.size || 0, dir: d.path };
        const e = episodeOf(x.name, d.parts);
        if (e) {
          Object.assign(f, e, { title: e.show + ' · S' + pad2(e.season) + 'E' + pad2(e.ep) });
          const k = fold(e.show);
          let s = showMap.get(k);
          if (!s) { s = { name: e.show, key: k, eps: [], dir: d.parts.length && /^(?:season|saison|temporada)/i.test(d.parts[d.parts.length - 1]) ? d.path.replace(/\/[^/]+$/, '') : d.path }; showMap.set(k, s); }
          s.eps.push(f);
        } else Object.assign(f, cleanName(x.name));
        if (!e) movies.push(f);
      }
      if (onN) onN(files);
    }
    movies.sort((a, b) => natCmp(a.title, b.title));
    const shows = Array.from(showMap.values()).sort((a, b) => natCmp(a.name, b.name));
    shows.forEach((s) => s.eps.sort((a, b) => a.season - b.season || a.ep - b.ep || natCmp(a.name, b.name)));
    const lib = { movies, shows, all: files, at: Date.now(), cut: dirs >= MAX_DIRS || files >= MAX_FILES };
    libs.set(drive.path, lib);
    return lib;
  }

  async function list(path) {
    const l = await rawList(path);
    return l.filter((x) => x.dir ? !/^(\$|\.|system volume information|lost\+found)/i.test(x.name) : isVideo(x.name));
  }

  // the subtitle files next to a video: "movie.srt", "movie.ar.srt", "movie.en.forced.srt", any .srt when the folder has one video,
  // and the ones in a "Subs" / "Subtitles" folder beside it
  async function spec(f) {
    let here = [];
    try { here = await rawList(f.dir || f.path.replace(/\/[^/]+$/, '')); } catch (e) { here = []; }
    const base = fold(stripExt(f.name)), vids = here.filter((x) => !x.dir && isVideo(x.name)).length;
    let subs = here.filter((x) => !x.dir && SUB.test(ext(x.name)) && (vids <= 1 || fold(stripExt(x.name)).indexOf(base) === 0));
    const sd = here.find((x) => x.dir && /^(subs?|subtitles?|sous[- ]?titres?|subtitulos)$/i.test(x.name));
    if (sd) {
      try {
        const l = await rawList(sd.path);
        // "Subs/2_English.srt" (one film) or "Subs/<video name>/..." (a season)
        const own = l.find((x) => x.dir && fold(x.name) === base);
        const inner = own ? await rawList(own.path) : l;
        subs = subs.concat(inner.filter((x) => !x.dir && SUB.test(ext(x.name))));
      } catch (e) {}
    }
    const files = subs.slice(0, 30).map((x) => {
      const lang = Subs.langOfFile(x.name, f.name) || (/(arabic|arab|ara)\b/i.test(x.name) ? 'ar' : /(english|eng)\b/i.test(x.name) ? 'en' : /(french|fran|fre)\b/i.test(x.name) ? 'fr' : /(spanish|espa|spa)\b/i.test(x.name) ? 'es' : '');
      return { label: (lang ? Subs.langName(lang) + ' · ' : '') + x.name, lang, path: x.path, size: x.size,
               load: async () => { const r = await MyPC.usb.read(x.path, 0, Math.min(x.size || 4194304, 4194304) - 1); const c = Subs.parse(Subs.decode(r.buf, lang), x.name); if (!c.length) throw Net.err('bad-data', 'no cues'); return c; } };
    });
    return { files, picture: here.find((x) => !x.dir && PIC.test(ext(x.name)) && (fold(stripExt(x.name)) === base || /^(poster|folder|cover)$/i.test(stripExt(x.name)))) || null };
  }

  // a poster: read from the drive (small files only, one at a time, never while a film plays), made small (PIC_W wide) so a
  // screen of posters does not keep big pictures in the TV's memory; the last PIC_KEEP are kept while the app is open
  const picWait = [];
  let picBusy = false;
  function picture(f, cb) {
    const k = (f.dir || f.path) + '|' + fold(stripExt(f.name || ''));
    if (pics.has(k)) { const v = pics.get(k); pics.delete(k); pics.set(k, v); cb(v); return; }
    for (const j of picWait) if (j.k === k) { j.cbs.push(cb); return; }
    picWait.push({ k, f, cbs: [cb] });
    if (picWait.length > 40) picWait.splice(0, picWait.length - 40).forEach((j) => j.cbs.forEach((c) => c('')));
    pump();
  }
  async function pump() {
    if (picBusy) return;
    picBusy = true;
    try {
      while (picWait.length) {
        await quiet();
        const j = picWait.pop();                         // the newest first: what is on screen now
        if (pics.has(j.k)) { j.cbs.forEach((c) => c(pics.get(j.k))); continue; }
        let u = '';
        try { u = await loadPic(j.f); } catch (e) { u = ''; }
        pics.set(j.k, u);
        if (pics.size > PIC_KEEP) { const old = pics.keys().next().value, ou = pics.get(old); pics.delete(old); if (ou) { try { URL.revokeObjectURL(ou); } catch (e) {} } }
        j.cbs.forEach((c) => c(u));
      }
    } finally { picBusy = false; }
  }
  async function loadPic(f) {
    let here;
    try { here = await rawList(f.dir || f.path); } catch (e) { return ''; }
    const base = fold(stripExt(f.name || ''));
    const pic = (base && here.find((x) => !x.dir && PIC.test(ext(x.name)) && fold(stripExt(x.name)) === base)) || here.find((x) => !x.dir && /^(poster|folder|cover)\.(jpe?g|png|webp)$/i.test(x.name));
    if (!pic || !(pic.size > 0) || pic.size > 3 * 1024 * 1024) return f.name ? frame(f) : f.ep ? frame(f.ep) : '';
    const r = await MyPC.usb.read(pic.path, 0, pic.size - 1);
    const blob = new Blob([r.buf], { type: /png$/i.test(pic.name) ? 'image/png' : /webp$/i.test(pic.name) ? 'image/webp' : 'image/jpeg' });
    return small(blob);
  }
  async function small(blob) {
    try {
      const bm = await createImageBitmap(blob, { resizeWidth: PIC_W, resizeQuality: 'medium' });
      const c = document.createElement('canvas');
      c.width = bm.width; c.height = bm.height;
      c.getContext('2d').drawImage(bm, 0, 0);
      bm.close();
      const out = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.85));
      c.width = c.height = 0;
      if (out) return URL.createObjectURL(out);
    } catch (e) { /* not a picture this browser can read */ }
    return '';
  }

  /* ---- a picture from the film itself (like other players), when no poster file is next to it ----
   * The first FRAME_BYTES of the file go into a hidden muted <video> (a blob: copy, the drive is read once), a moment a few seconds
   * in is drawn PIC_W wide. One at a time, never while a film is open, 8 s at most. Kept in IndexedDB (path + size) so the drive is read
   * once per film. A file that was being read when the app stopped (the TV closed it) is never tried again (FRAME_TRY). */
  const FRAME_BYTES = 4 * 1024 * 1024, FRAME_TRY = 'speedy_frame_try', FRAME_BAD = 'speedy_frame_bad';
  const ls = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} return null; };
  let bad = null;
  function badSet() {
    if (bad) return bad;
    try { bad = new Set(JSON.parse(ls(FRAME_BAD) || '[]')); } catch (e) { bad = new Set(); }
    const left = ls(FRAME_TRY);
    if (left) { bad.add(left); ls(FRAME_TRY, null); saveBad(); }
    return bad;
  }
  function saveBad() { ls(FRAME_BAD, JSON.stringify([...bad].slice(-200))); }
  let dbP = null;
  function db() {
    if (!dbP) dbP = new Promise((res) => {
      try { const r = indexedDB.open('speedy-frames', 1); r.onupgradeneeded = () => r.result.createObjectStore('f'); r.onsuccess = () => res(r.result); r.onerror = () => res(null); } catch (e) { res(null); }
    });
    return dbP;
  }
  async function dbDo(mode, fn) {
    const d = await db();
    if (!d) return null;
    return new Promise((res) => { try { const t = d.transaction('f', mode), q = fn(t.objectStore('f')); t.oncomplete = () => res(q && q.result); t.onerror = t.onabort = () => res(null); } catch (e) { res(null); } });
  }
  function busyPlayer() { try { return typeof Player !== 'undefined' && Player.mode() !== 'off'; } catch (e) { return false; } }
  async function frame(f) {
    if (!Store.prefs().usbFrames || !f.path || !isVideo(f.name) || badSet().has(f.path)) return '';
    const key = f.path + '|' + (f.size || 0);
    const saved = await dbDo('readonly', (st) => st.get(key));
    if (saved instanceof Blob) return saved.size ? URL.createObjectURL(saved) : '';
    while (busyPlayer()) await new Promise((r) => setTimeout(r, 1000));
    ls(FRAME_TRY, f.path);
    let out = null;
    try { out = await grab(f); } catch (e) { out = null; }
    ls(FRAME_TRY, null);
    if (out === 'later') return '';
    // nothing usable (an MP4 with its index at the end, a codec the browser lacks): remembered as empty, never read again
    await dbDo('readwrite', (st) => { st.put(out || new Blob([]), key); return null; });
    return out ? URL.createObjectURL(out) : '';
  }
  async function grab(f) {
    const n = f.size > 0 ? Math.min(f.size, FRAME_BYTES) : FRAME_BYTES;
    const r = await MyPC.usb.read(f.path, 0, n - 1);
    if (busyPlayer()) return 'later';
    const src = URL.createObjectURL(new Blob([r.buf], { type: /^(mp4|m4v|mov)$/.test(ext(f.name)) ? 'video/mp4' : ext(f.name) === 'webm' ? 'video/webm' : '' }));
    const v = document.createElement('video');
    v.muted = true; v.preload = 'auto'; v.playsInline = true;
    const ev = (name, ms) => new Promise((res) => { const t = setTimeout(() => res(false), ms); v.addEventListener(name, () => { clearTimeout(t); res(true); }, { once: true }); v.addEventListener('error', () => { clearTimeout(t); res(false); }, { once: true }); });
    try {
      v.src = src;
      if (!await ev('loadeddata', 8000) || !v.videoWidth) return null;
      // a moment a few seconds in (the very start is often black): the middle of what the first megabytes hold, 10 s at most
      const end = v.buffered.length ? v.buffered.end(v.buffered.length - 1) : 0;
      const at = Math.min(10, end * 0.6, (v.duration || end) * 0.6);
      if (at > 0.5) { v.currentTime = at; if (!await ev('seeked', 5000)) return null; }
      const w = PIC_W, h = Math.max(1, Math.round(PIC_W * v.videoHeight / v.videoWidth));
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const g = c.getContext('2d');
      g.drawImage(v, 0, 0, w, h);
      // all black (a fade-in): no picture
      const px = g.getImageData(0, 0, w, h).data;
      let sum = 0;
      for (let i = 0; i < px.length; i += 64) sum += px[i] + px[i + 1] + px[i + 2];
      const out = sum / (px.length / 64) / 3 > 10 ? await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.8)) : null;
      c.width = c.height = 0;
      return out;
    } finally {
      v.removeAttribute('src'); try { v.load(); } catch (e) {}
      URL.revokeObjectURL(src);
    }
  }

  function forget() { libs.clear(); dirs_.clear(); }
  return { available, drives, library, list, spec, picture, cleanName, episodeOf, isVideo, forget };
})();
