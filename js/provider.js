/* Where the lists come from: an Xtream Codes server, an M3U link, or the built-in demo.
 *   const pv = Provider.make(playlist)
 *   pv.info() -> { status, exp, max, active, trial, formats }        pv.cats(kind) -> [{ id, name }]
 *   pv.items(kind, onPhase) -> items (all of a kind; Xtream lists bigger than My PC's 32 MB limit throw 'too-big')
 *   pv.itemsOf(kind, catId) -> items of one category (fallback for huge lists)
 *   pv.vodInfo(item) / pv.seriesInfo(item) / pv.epg(item) / pv.url(kind, item, ep)
 * kind: 'live' | 'vod' | 'series'. Errors carry a code: auth, network, timeout, bad-data, too-big. */
'use strict';
const Provider = (() => {
  let worker = null, wseq = 0;
  const waiting = {};
  function parse(buf, fmt, kind) {
    if (!worker) {
      worker = new Worker('js/parse-worker.js?v=' + APP_VERSION);
      worker.onmessage = (e) => { const w = waiting[e.data.id]; if (!w) return; delete waiting[e.data.id]; if (e.data.error) w.rej(Net.err(e.data.error === 'bad-data' ? 'bad-data' : 'parse', e.data.error)); else w.res(e.data); };
      worker.onerror = (e) => { for (const k in waiting) { waiting[k].rej(Net.err('parse', e.message)); delete waiting[k]; } };
    }
    return new Promise((res, rej) => { const id = ++wseq; waiting[id] = { res, rej }; worker.postMessage({ id, buf, fmt, kind }, [buf]); });
  }
  function stopWorker() { if (worker) { worker.terminate(); worker = null; } }
  function b64(s) { try { return decodeURIComponent(escape(atob(s))); } catch (e) { return String(s || ''); } }
  function baseOf(host) {
    let h = String(host || '').trim();
    if (!/^https?:\/\//i.test(h)) h = 'http://' + h;
    h = h.replace(/\/(player_api|get|panel_api|xmltv)\.php.*$/i, '').replace(/\/+$/, '');
    return h;
  }

  /* ---------------- Xtream Codes ---------------- */
  function xtream(pl) {
    const base = baseOf(pl.host), u = encodeURIComponent(pl.user || ''), p = encodeURIComponent(pl.pass || '');
    const onTv = () => { try { return MyPC.video.supported(); } catch (e) { return false; } };
    function api(q) { return base + '/player_api.php?username=' + u + '&password=' + p + (q ? '&' + q : ''); }
    async function json(q, timeout) {
      let r;
      try { r = await Net.get(api(q), { type: 'text', timeout: timeout || 20000 }); } catch (e) { throw Net.err(e.code === 'timeout' ? 'timeout' : e.code === 'too-big' ? 'too-big' : 'network', e.message); }
      if (r.status === 401 || r.status === 403) throw Net.err('auth', 'HTTP ' + r.status);
      if (!r.ok) throw Net.err('network', 'HTTP ' + r.status);
      let d;
      try { d = JSON.parse(r.body); } catch (e) { throw Net.err('bad-data', 'Not JSON'); }
      if (d && d.user_info && (d.user_info.auth === 0 || d.user_info.auth === '0')) throw Net.err('auth', 'auth 0');
      return d;
    }
    const ACT = { live: 'get_live_streams', vod: 'get_vod_streams', series: 'get_series' };
    const CAT = { live: 'get_live_categories', vod: 'get_vod_categories', series: 'get_series_categories' };
    return {
      key: hash(base + '|' + pl.user),
      async info() {
        const d = await json('', 15000);
        if (!d || !d.user_info) throw Net.err('bad-data', 'no user_info');
        const ui = d.user_info;
        return { status: String(ui.status || ''), exp: +ui.exp_date ? +ui.exp_date * 1000 : 0, max: +ui.max_connections || 0, active: +ui.active_cons || 0,
                 trial: ui.is_trial === '1' || ui.is_trial === 1, formats: Array.isArray(ui.allowed_output_formats) ? ui.allowed_output_formats : [] };
      },
      async cats(kind) {
        const d = await json('action=' + CAT[kind]);
        if (!Array.isArray(d)) return [];
        return d.map((c) => ({ id: String(c.category_id), name: String(c.category_name || '').trim() || '—' }));
      },
      async items(kind, onPhase) {
        let r;
        if (onPhase) onPhase('download');
        try { r = await Net.get(api('action=' + ACT[kind]), { type: 'arraybuffer', timeout: 240000 }); }
        catch (e) { throw Net.err(e.code === 'too-big' ? 'too-big' : e.code === 'timeout' ? 'timeout' : 'network', e.message); }
        if (r.status === 401 || r.status === 403) throw Net.err('auth', 'HTTP ' + r.status);
        if (!r.ok) throw Net.err('network', 'HTTP ' + r.status);
        if (onPhase) onPhase('parse', r.body.byteLength);
        return (await parse(r.body, 'json', kind)).items;
      },
      async itemsOf(kind, catId) {
        let r;
        try { r = await Net.get(api('action=' + ACT[kind] + '&category_id=' + encodeURIComponent(catId)), { type: 'arraybuffer', timeout: 60000 }); }
        catch (e) { throw Net.err(e.code === 'timeout' ? 'timeout' : 'network', e.message); }
        if (!r.ok) throw Net.err('network', 'HTTP ' + r.status);
        return (await parse(r.body, 'json', kind)).items;
      },
      async vodInfo(item) {
        const d = await json('action=get_vod_info&vod_id=' + encodeURIComponent(item.i));
        const i = (d && d.info) || {}, m = (d && d.movie_data) || {};
        return { plot: i.plot || i.description || '', cast: i.cast || i.actors || '', director: i.director || '', genre: i.genre || '', date: i.releasedate || i.release_date || '',
                 dur: +i.duration_secs || 0, rating: +i.rating || item.r || 0, back: Array.isArray(i.backdrop_path) ? i.backdrop_path[0] : i.backdrop_path || '',
                 poster: i.movie_image || i.cover_big || item.l || '', tmdb: i.tmdb_id || '', ext: m.container_extension || item.x || 'mp4', name: m.name || item.n,
                 w: (i.video && +i.video.width) || 0, h: (i.video && +i.video.height) || 0, o_name: i.o_name || i.name || '' };
      },
      async seriesInfo(item) {
        const d = await json('action=get_series_info&series_id=' + encodeURIComponent(item.i), 30000);
        const i = (d && d.info) || {}, eps = (d && d.episodes) || {}, seasons = {};
        Object.keys(eps).forEach((s) => {
          const list = Array.isArray(eps[s]) ? eps[s] : Object.values(eps[s] || {});
          seasons[s] = list.map((e) => ({ id: String(e.id), num: +e.episode_num || 0, season: +e.season || +s || 0, title: String(e.title || ''), ext: e.container_extension || 'mp4',
            plot: (e.info && e.info.plot) || '', dur: (e.info && +e.info.duration_secs) || 0, pic: (e.info && e.info.movie_image) || '' })).sort((a, b) => a.num - b.num);
        });
        return { plot: i.plot || '', cast: i.cast || '', director: i.director || '', genre: i.genre || '', date: i.releaseDate || i.releasedate || '', rating: +i.rating || item.r || 0,
                 back: Array.isArray(i.backdrop_path) ? i.backdrop_path[0] : i.backdrop_path || '', poster: i.cover || item.l || '', seasons, tmdb: i.tmdb || i.tmdb_id || '' };
      },
      async epg(item) {
        const d = await json('action=get_short_epg&stream_id=' + encodeURIComponent(item.i) + '&limit=4', 10000);
        const l = (d && d.epg_listings) || [];
        return l.map((x) => ({ title: b64(x.title), desc: b64(x.description), start: (+x.start_timestamp || Date.parse(x.start) / 1000) * 1000, end: (+x.stop_timestamp || Date.parse(x.end) / 1000) * 1000 }))
          .filter((x) => x.end > Date.now()).slice(0, 3);
      },
      url(kind, item, ep) {
        if (kind === 'live') return base + '/live/' + u + '/' + p + '/' + item.i + (onTv() ? '.ts' : '.m3u8');
        if (kind === 'vod') return base + '/movie/' + u + '/' + p + '/' + item.i + '.' + (item.x || 'mp4');
        return base + '/series/' + u + '/' + p + '/' + ep.id + '.' + (ep.ext || 'mp4');
      }
    };
  }

  /* ---------------- M3U link: everything comes in one file ---------------- */
  function m3u(pl) {
    let got = null;
    async function all() {
      if (got) return got;
      let r;
      try { r = await Net.get(pl.url, { type: 'arraybuffer', timeout: 240000 }); } catch (e) { throw Net.err(e.code === 'too-big' ? 'too-big' : e.code === 'timeout' ? 'timeout' : 'network', e.message); }
      if (r.status === 401 || r.status === 403) throw Net.err('auth', 'HTTP ' + r.status);
      if (!r.ok) throw Net.err('network', 'HTTP ' + r.status);
      got = (await parse(r.body, 'm3u')).m3u;
      return got;
    }
    return {
      key: hash(pl.url),
      async info() { await all(); return { status: 'Active', exp: 0, max: 0, active: 0, trial: false, formats: [] }; },
      async cats(kind) { return (await all()).cats[kind].map((c) => ({ id: c.id, name: c.name })); },
      async items(kind) { const a = await all(); return a[kind]; },
      async itemsOf(kind, catId) { return (await this.items(kind)).filter((x) => x.c === catId); },
      async vodInfo(item) { return { plot: '', cast: '', director: '', genre: '', date: item.y ? String(item.y) : '', dur: 0, rating: item.r || 0, back: '', poster: item.l || '', ext: item.x, name: item.n }; },
      async seriesInfo(item) {
        const seasons = {};
        Object.keys(item.eps || {}).forEach((s) => { seasons[s] = item.eps[s].map((e) => ({ id: e.id, num: e.episode_num, season: e.season, title: e.title, ext: '', plot: '', dur: 0, pic: e.l || '', u: e.u })).sort((a, b) => a.num - b.num); });
        return { plot: '', cast: '', director: '', genre: '', date: '', rating: 0, back: '', poster: item.l || '', seasons };
      },
      async epg() { return []; },
      url(kind, item, ep) { return kind === 'series' ? ep.u : item.u; }
    };
  }

  /* ---------------- the demo: thousands of entries to try the app (free test streams) ---------------- */
  function demo() {
    const S = 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/';
    const FILMS = [['Big Buck Bunny', 'BigBuckBunny', 2008], ['Elephants Dream', 'ElephantsDream', 2006], ['Sintel', 'Sintel', 2010], ['Tears of Steel', 'TearsOfSteel', 2012]];
    const LIVE = ['https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8', 'https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_fmp4/master.m3u8'];
    const LCATS = ['News', 'Sports', 'Movies', 'Kids', 'Music', 'Documentary', 'Morocco', 'France', 'Spain', 'Arabic', 'All channels (5000)'];
    const VCATS = ['Animation', 'Science fiction', 'Short films', 'Classics', 'Family', 'Huge list (12000)'];
    const SCATS = ['Drama', 'Comedy', 'Animation'];
    function gen(kind) {
      const out = [];
      if (kind === 'live') {
        let no = 1;
        LCATS.forEach((c, ci) => { const n = ci === LCATS.length - 1 ? 5000 : 40; for (let i = 0; i < n; i++) { const nm = c.replace(/ \(.*/, '') + ' ' + (i + 1); out.push({ i: 'L' + no, n: nm, k: fold(nm), c: 'lc' + ci, no: no, u: LIVE[no % 2] }); no++; } });
      } else if (kind === 'vod') {
        let id = 1;
        VCATS.forEach((c, ci) => {
          const n = ci === VCATS.length - 1 ? 12000 : 24;
          for (let i = 0; i < n; i++) {
            const f = FILMS[(id - 1) % 4], nm = i < 4 && ci < 5 ? f[0] : f[0] + ' ' + (i + 1);
            out.push({ i: 'V' + id, n: nm, k: fold(nm), c: 'vc' + ci, l: S + 'images/' + f[1] + '.jpg', r: 5 + ((id * 37) % 50) / 10, a: 1700000000 + id * 3600, x: 'mp4', y: f[2], u: S + f[1] + '.mp4' });
            id++;
          }
        });
      } else {
        let id = 1;
        SCATS.forEach((c, ci) => { for (let i = 0; i < 300; i++) { const f = FILMS[id % 4], nm = 'Demo show ' + id; out.push({ i: 'S' + id, n: nm, k: fold(nm), c: 'sc' + ci, l: S + 'images/' + f[1] + '.jpg', r: 6 + (id % 40) / 10, a: 1700000000 + id * 7200 }); id++; } });
      }
      return out;
    }
    const names = { live: LCATS, vod: VCATS, series: SCATS }, pre = { live: 'lc', vod: 'vc', series: 'sc' };
    return {
      key: 'demo',
      async info() { return { status: 'Active', exp: 0, max: 1, active: 0, trial: true, formats: ['m3u8', 'ts'] }; },
      async cats(kind) { return names[kind].map((n, i) => ({ id: pre[kind] + i, name: n })); },
      async items(kind) { return gen(kind); },
      async itemsOf(kind, c) { return gen(kind).filter((x) => x.c === c); },
      async vodInfo(item) {
        const f = FILMS.find((x) => item.n.indexOf(x[0]) === 0) || FILMS[0];
        return { plot: 'A free open movie made with Blender (Creative Commons). Part of the Speedy demo playlist.', cast: 'Blender Foundation', director: 'Blender Institute', genre: 'Animation',
                 date: String(f[2]), dur: 600, rating: item.r || 7, back: '', poster: item.l, ext: 'mp4', name: item.n };
      },
      async seriesInfo(item) {
        const seasons = {};
        for (let s = 1; s <= 3; s++) seasons[s] = [];
        for (let s = 1; s <= 3; s++) for (let e = 1; e <= (s === 3 ? 240 : 10); e++) { const f = FILMS[(e + s) % 4]; seasons[s].push({ id: item.i + 's' + s + 'e' + e, num: e, season: s, title: 'Episode ' + e, ext: 'mp4', plot: '', dur: 600, pic: '', u: S + f[1] + '.mp4' }); }
        return { plot: 'A demo series with a very long third season (240 episodes) to try the episode list.', cast: '', director: '', genre: 'Demo', date: '2024', rating: item.r || 7, back: '', poster: item.l, seasons };
      },
      async epg(item) {
        const h = 3600000, t0 = Math.floor(Date.now() / h) * h;
        return [{ title: item.n + ' — live show', desc: 'Demo programme guide.', start: t0, end: t0 + h }, { title: 'Next on ' + item.n, desc: '', start: t0 + h, end: t0 + 2 * h }];
      },
      url(kind, item, ep) { return kind === 'series' ? ep.u : item.u; }
    };
  }

  function make(pl) { return !pl ? null : pl.kind === 'm3u' ? m3u(pl) : pl.kind === 'demo' ? demo() : xtream(pl); }
  return { make, baseOf, stopWorker, parse };
})();
