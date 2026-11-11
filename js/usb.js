/* Films and TV shows on the TV's USB drives (through My PC: MyPC.usb, then MyPC.video plays the file itself).
 *   Usb.available()           only on a TV with My PC 16+ (bridges.usb)
 *   Usb.drives()              [{ path, name }]
 *   Usb.library(drive, onN)   { movies: [file], shows: [{ name, key, pic, eps: [file] }], all: n } (one walk, kept for the session)
 *   Usb.list(path)            a folder: [{ name, path, dir, size }] (videos and folders only)
 *   Usb.spec(file)            what the player needs: the file + the subtitle files next to it (read when chosen)
 *   Usb.picture(file, cb)     the poster next to a film (movie.jpg, poster.jpg, folder.jpg), as a blob: URL
 * file = { name, path, size, dir (folder path), title, year, show, season, ep } */
'use strict';
const Usb = (() => {
  const VIDEO = /^(mp4|m4v|mkv|avi|mov|wmv|asf|ts|m2ts|mts|mpg|mpeg|vob|flv|webm|3gp|divx|xvid|ogv|rmvb|tp|trp)$/;
  const SUB = /^(srt|vtt|ass|ssa|sub)$/;
  const PIC = /^(jpg|jpeg|png|webp)$/;
  const SAMPLE = /(^|[\s._-])sample$/i;
  const MAX_DIRS = 600, MAX_FILES = 5000, MAX_DEPTH = 7;
  const libs = new Map(), pics = new Map();

  function available() { try { return MyPC.apiLevel >= 16 && !!(MyPC.info() && MyPC.info().bridges && MyPC.info().bridges.usb); } catch (e) { return false; } }
  async function drives() { return (await MyPC.usb.drives()) || []; }
  async function rawList(path) { return (await MyPC.usb.list(path)) || []; }

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
    const movies = [], showMap = new Map();
    let dirs = 0, files = 0;
    const queue = [{ path: drive.path, parts: [], depth: 0 }];
    while (queue.length && dirs < MAX_DIRS && files < MAX_FILES) {
      const d = queue.shift();
      dirs++;
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

  // a poster: read from the drive (small files only), kept while the app is open
  function picture(f, cb) {
    const k = f.dir || f.path;
    if (pics.has(k)) { const v = pics.get(k); if (v && v.then) v.then(cb); else cb(v); return; }
    const p = (async () => {
      let here;
      try { here = await rawList(k); } catch (e) { return ''; }
      const base = fold(stripExt(f.name || ''));
      const pic = here.find((x) => !x.dir && PIC.test(ext(x.name)) && fold(stripExt(x.name)) === base) || here.find((x) => !x.dir && /^(poster|folder|cover)\.(jpe?g|png|webp)$/i.test(x.name));
      if (!pic || !(pic.size > 0) || pic.size > 3 * 1024 * 1024) return '';
      try { const r = await MyPC.usb.read(pic.path, 0, pic.size - 1); return URL.createObjectURL(new Blob([r.buf], { type: /png$/i.test(pic.name) ? 'image/png' : 'image/jpeg' })); } catch (e) { return ''; }
    })();
    pics.set(k, p);
    p.then((u) => { pics.set(k, u); cb(u); });
  }
  function forget() { libs.clear(); }
  return { available, drives, library, list, spec, picture, cleanName, episodeOf, isVideo, forget };
})();
