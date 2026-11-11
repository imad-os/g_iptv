/* Subtitles: reading subtitle files (SRT, WebVTT, ASS / SSA, MicroDVD .sub), guessing their text encoding (many Arabic and
 * French files are Windows-1256 / 1252, not UTF-8), finding subtitles online (Speedy's subtitle service), and the cues
 * shown in time with the video. Cues: [{ s, e, t }] in seconds, sorted. */
'use strict';
const Subs = (() => {
  const SERVICE = 'https://f.geekspro.us';

  function decode(buf, langHint) {
    const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    if (u8[0] === 0xEF && u8[1] === 0xBB && u8[2] === 0xBF) return new TextDecoder('utf-8').decode(u8.subarray(3));
    if (u8[0] === 0xFF && u8[1] === 0xFE) return new TextDecoder('utf-16le').decode(u8.subarray(2));
    if (u8[0] === 0xFE && u8[1] === 0xFF) return new TextDecoder('utf-16be').decode(u8.subarray(2));
    try { return new TextDecoder('utf-8', { fatal: true }).decode(u8); } catch (e) { /* not UTF-8 */ }
    // Windows-1256 (Arabic) or Windows-1252 (French, Spanish...): the one that gives more letters of its own script
    const ar = new TextDecoder('windows-1256').decode(u8);
    const arabic = (ar.match(/[؀-ۿ]/g) || []).length, high = u8.reduce((n, b) => n + (b >= 0xC0 ? 1 : 0), 0);
    if (langHint === 'ar' || (high && arabic >= high * 0.6)) return ar;
    return new TextDecoder('windows-1252').decode(u8);
  }
  function ts(s) {
    const m = /(?:(\d+):)?(\d{1,2}):(\d{1,2})[,.](\d{1,3})/.exec(s);
    if (!m) return NaN;
    return (+(m[1] || 0)) * 3600 + (+m[2]) * 60 + (+m[3]) + (+(m[4] + '00').slice(0, 3)) / 1000;
  }
  function clean(t) {
    return t.replace(/\{\\[^}]*\}/g, '').replace(/<\/?(?:i|b|u|font|c|v|ruby|rt|lang)[^>]*>/gi, '').replace(/\\N/gi, '\n').replace(/\\h/g, ' ').replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
  }
  function srtVtt(text) {
    const out = [], blocks = text.replace(/\r/g, '').split(/\n{2,}/);
    for (const b of blocks) {
      const lines = b.split('\n');
      let k = 0;
      while (k < lines.length && lines[k].indexOf('-->') < 0) k++;
      if (k >= lines.length) continue;
      const parts = lines[k].split('-->'), s = ts(parts[0]), e = ts(parts[1]);
      if (!(e > s)) continue;
      const t = clean(lines.slice(k + 1).join('\n'));
      if (t) out.push({ s, e, t });
    }
    return out;
  }
  function ass(text) {
    const out = [];
    let fmt = null;
    for (const line of text.replace(/\r/g, '').split('\n')) {
      if (/^Format:/i.test(line) && !fmt) { const f = line.slice(7).split(',').map((x) => x.trim().toLowerCase()); if (f.indexOf('text') >= 0) fmt = f; continue; }
      if (!/^Dialogue:/i.test(line)) continue;
      const f = fmt || ['layer', 'start', 'end', 'style', 'name', 'marginl', 'marginr', 'marginv', 'effect', 'text'];
      const parts = line.slice(9).split(','), ti = f.indexOf('text');
      const row = parts.slice(0, ti).concat([parts.slice(ti).join(',')]);
      const s = ts(row[f.indexOf('start')] + '0'), e = ts(row[f.indexOf('end')] + '0'), t = clean(row[ti] || '');
      if (e > s && t) out.push({ s, e, t });
    }
    return out;
  }
  function microdvd(text, fps) {
    fps = fps || 23.976;
    const out = [];
    for (const line of text.replace(/\r/g, '').split('\n')) {
      const m = /^\{(\d+)\}\{(\d+)\}(.*)$/.exec(line.trim());
      if (m) { const t = clean(m[3].replace(/\|/g, '\n').replace(/\{[^}]*\}/g, '')); if (t) out.push({ s: +m[1] / fps, e: +m[2] / fps, t }); }
    }
    return out;
  }
  function parse(text, name) {
    let cues;
    const x = ext(name || '');
    if (x === 'ass' || x === 'ssa' || /^\s*\[Script Info\]/i.test(text)) cues = ass(text);
    else if (x === 'sub' && /^\s*\{\d+\}\{\d+\}/.test(text)) cues = microdvd(text);
    else cues = srtVtt(text);
    cues.sort((a, b) => a.s - b.s);
    return cues;
  }
  // the cue shown at time t (seconds): binary search, last hit first (time moves forward)
  function at(cues, t, hint) {
    if (!cues || !cues.length) return -1;
    if (hint >= 0 && hint < cues.length && cues[hint].s <= t && t < cues[hint].e) return hint;
    let lo = 0, hi = cues.length - 1, found = -1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (cues[m].s <= t) { found = m; lo = m + 1; } else hi = m - 1; }
    // overlapping cues: walk back a little
    for (let i = found; i >= 0 && i > found - 5; i--) if (cues[i].s <= t && t < cues[i].e) return i;
    return -1;
  }

  /* ---------- online (Speedy's own subtitle service, the same as the TV app) ---------- */
  async function search(meta, kind) {
    const r = await Net.get(SERVICE + '/fetchSubtitles/', { method: 'POST', type: 'json', timeout: 20000, json: { movieData: meta, movieType: kind } });
    const d = r.body || {};
    if (d.status !== 'success' || !Array.isArray(d.subtitles)) return [];
    return d.subtitles.slice(0, 40).map((s) => ({ name: String(s.label || s.name || s.fileName || s.release || s.lang || 'Subtitle'), lang: String(s.lang || s.language || ''), url: String(s.file || s.url || s.link || s.download || '') }))
      .filter((s) => s.url);
  }
  async function download(sub) {
    const r = await Net.get(SERVICE + '/downloadSubtitle/?url=' + encodeURIComponent(sub.url), { type: 'arraybuffer', timeout: 30000 });
    if (!r.ok || !r.body) throw Net.err('network', 'HTTP ' + r.status);
    const cues = parse(decode(r.body, (sub.lang || '').slice(0, 2).toLowerCase()), sub.name);
    if (!cues.length) throw Net.err('bad-data', 'no cues');
    return cues;
  }
  const LANGS = { ara: 'العربية', ar: 'العربية', eng: 'English', en: 'English', fre: 'Français', fra: 'Français', fr: 'Français', spa: 'Español', es: 'Español', ger: 'Deutsch', deu: 'Deutsch', de: 'Deutsch',
                  ita: 'Italiano', it: 'Italiano', por: 'Português', pt: 'Português', tur: 'Türkçe', tr: 'Türkçe', dut: 'Nederlands', nld: 'Nederlands', nl: 'Nederlands', rus: 'Русский', ru: 'Русский',
                  pol: 'Polski', pl: 'Polski', hin: 'हिन्दी', hi: 'हिन्दी', jpn: '日本語', ja: '日本語', kor: '한국어', ko: '한국어', chi: '中文', zho: '中文', zh: '中文', per: 'فارسی', fas: 'فارسی', fa: 'فارسی', heb: 'עברית', he: 'עברית', und: '' };
  function langName(code) { const c = String(code || '').toLowerCase().trim(); return LANGS[c] !== undefined ? LANGS[c] || T('unknownLang') : c ? c.toUpperCase() : T('unknownLang'); }
  // "movie.ar.srt" next to "movie.mkv" -> 'ar'
  function langOfFile(name, base) {
    const rest = stripExt(name).slice(stripExt(base).length).replace(/^[._\s-]+/, '');
    const m = /^([a-z]{2,3})\b/i.exec(rest);
    return m ? m[1].toLowerCase() : '';
  }
  return { decode, parse, at, search, download, langName, langOfFile };
})();
