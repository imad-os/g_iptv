/* The player: one look for everything (live channels, films, episodes, USB files), in the app's theme.
 *
 * Two engines behind one small interface:
 *   - TV: the TV's own player through My PC (MyPC.video = Samsung AVPlay: 4K HEVC, AC3 / EAC3, MKV, TS, http streams). The
 *     picture is drawn BEHIND the page, so the page is transparent where it shows (html.video).
 *   - Web (phone, computer, standalone): a <video> (+ hls.js, loaded only when an .m3u8 needs it) placed over the screens.
 *
 *   Player.play(spec)              full screen (pushed on the screen stack; Back closes it)
 *   Player.preview(spec, boxEl)    small, in a box of the Live TV screen; Player.full() makes it full screen, Back brings it back
 *   Player.stopPreview()           Player.current()   Player.onZap(fn)
 *
 * spec = { kind: 'live' | 'vod' | 'series' | 'usb' | 'usbep' (an episode of a USB show), id, title, sub, icon, url, key (progress key), start (s), live,
 *          list + index (live: channels to zap through), next() -> spec | null (episodes), meta + metaKind (online subtitles),
 *          files: [{ label, lang, load() -> cues }] (subtitle files next to a USB video), fav: { kind, id } }
 * Progress is saved every 15 s, on pause and on close (Store.setProgress). */
'use strict';
const Player = (() => {
  const SAVE_EVERY = 15000, HIDE_AFTER = 5000, ZAP_WAIT = 450, SEEK_WAIT = 750;
  let root = null, vid = null, hls = null, hlsLoading = null;
  let spec = null, mode = 'off', box = null, eng = null, openSeq = 0, scr = null;
  const st = { t: 0, d: 0, at: 0, playing: false, buffering: false, ended: false, rate: 1, opened: false };
  let ui = {}, uiOn = false, hideT = 0, saveT = 0, lastSave = 0, focusRow = 1, focusBtn = 0, btns = [];
  let seekTo = -1, seekT = 0, seekReps = 0, zapIdx = -1, zapT = 0, bannerT = 0, retry = 0, retryT = 0;
  let cues = null, cueIdx = -1, subDelay = 0, subT = 0, embSubT = 0, embOn = false, nextShown = false, nextCancel = false;
  let list = null, epgCache = new Map(), onZapFn = null;

  /* ---------------- engines ---------------- */
  function tvOk() { try { return MyPC.video && MyPC.video.supported(); } catch (e) { return false; } }
  const TV = {
    name: 'tv',
    async open(url, o) {
      document.documentElement.classList.add('video');
      const r = await MyPC.video.open(url, { start: o.start || 0, live: !!o.live, rect: o.rect || null, fit: o.fit || 'fit', ua: Store.prefs().ua || '' });
      return { d: (r && r.duration) || 0 };
    },
    play() { return MyPC.video.play(); },
    pause() { return MyPC.video.pause(); },
    stop() { document.documentElement.classList.remove('video'); return MyPC.video.stop(); },
    seek(t) { return MyPC.video.seek(t); },
    rect(el) { return MyPC.video.rect(el || null); },
    fit(m) { return MyPC.video.fit(m); },
    async tracks() {
      const t = await MyPC.video.tracks();
      return { audio: (t.audio || []).map((a, i) => ({ index: a.index, label: Subs.langName(a.lang) + (a.channels > 2 ? ' ' + (a.channels === 6 ? '5.1' : a.channels === 8 ? '7.1' : a.channels + 'ch') : '') + (a.codec ? ' · ' + String(a.codec).replace(/^.*\//, '').toUpperCase() : ''), n: i + 1 })),
               text: (t.text || []).map((x, i) => ({ index: x.index, label: Subs.langName(x.lang), n: i + 1 })), cur: t.cur || {}, w: t.video && t.video.w, h: t.video && t.video.h };
    },
    track(kind, i) { return MyPC.video.track(kind, i); },
    subtitles(on) { return MyPC.video.subtitles(on); },
    speed(r) { return MyPC.video.speed(r); },
    rates: [1, 2, 4]
  };
  const WEB = {
    name: 'web',
    async open(url, o, my) {
      const v = video();
      v.style.display = '';
      place();
      killHls();
      v.removeAttribute('src');
      const m3u8 = /\.m3u8(\?|$)/i.test(url) || /\/live\/[^/]+\/[^/]+\/[^/]+$/.test(url);
      if (m3u8 && !v.canPlayType('application/vnd.apple.mpegurl')) {
        await loadHls();
        if (my !== openSeq) return { d: 0 };
        // eslint-disable-next-line no-undef
        if (!window.Hls || !Hls.isSupported()) throw Net.err('format', 'no hls');
        // eslint-disable-next-line no-undef
        hls = new Hls({ maxBufferLength: 30, maxMaxBufferLength: 60, backBufferLength: 30, enableWorker: true, lowLatencyMode: false });
        hls.on('hlsError', (ev, data) => {
          if (!data || !data.fatal || my !== openSeq) return;
          if (data.type === 'mediaError' && !hls.__rec) { hls.__rec = 1; hls.recoverMediaError(); return; }
          onError(data.type === 'networkError' ? 'network' : 'format');
        });
        hls.on('hlsAudioTracksUpdated', () => {});
        hls.loadSource(url);
        hls.attachMedia(v);
      } else v.src = url;
      await new Promise((res, rej) => {
        const t = setTimeout(() => { done(); rej(Net.err('timeout', 'no metadata')); }, 30000);
        function ok() { done(); res(); }
        function bad() { done(); rej(Net.err(mediaCode(v.error), 'media error')); }
        function done() { clearTimeout(t); v.removeEventListener('loadedmetadata', ok); v.removeEventListener('error', bad); }
        v.addEventListener('loadedmetadata', ok);
        v.addEventListener('error', bad);
      });
      if (my !== openSeq) return { d: 0 };
      if (o.start > 1 && isFinite(v.duration)) v.currentTime = o.start;
      fitWeb(o.fit);
      v.playbackRate = 1;
      try { await v.play(); } catch (e) { if (e && e.name === 'NotAllowedError') { v.muted = true; try { await v.play(); } catch (e2) {} } }
      return { d: isFinite(v.duration) ? v.duration : 0 };
    },
    play() { if (vid) return vid.play().catch(() => {}); },
    pause() { if (vid) vid.pause(); },
    stop() { killHls(); if (vid) { vid.pause(); vid.removeAttribute('src'); try { vid.load(); } catch (e) {} vid.style.display = 'none'; } },
    seek(t) { if (vid) vid.currentTime = Math.max(0, t); },
    rect() { place(); },
    fit(m) { fitWeb(m); },
    async tracks() {
      const out = { audio: [], text: [], cur: {} };
      if (hls && hls.audioTracks) { hls.audioTracks.forEach((a, i) => out.audio.push({ index: i, label: Subs.langName(a.lang) + (a.name && a.name !== a.lang ? ' · ' + a.name : ''), n: i + 1 })); out.cur.audio = hls.audioTrack; }
      else if (vid && vid.audioTracks) { for (let i = 0; i < vid.audioTracks.length; i++) { const a = vid.audioTracks[i]; out.audio.push({ index: i, label: Subs.langName(a.language) + (a.label ? ' · ' + a.label : ''), n: i + 1 }); if (a.enabled) out.cur.audio = i; } }
      if (vid) { out.w = vid.videoWidth; out.h = vid.videoHeight; }
      return out;
    },
    track(kind, i) {
      if (kind !== 'audio') return;
      if (hls) hls.audioTrack = i;
      else if (vid && vid.audioTracks) for (let k = 0; k < vid.audioTracks.length; k++) vid.audioTracks[k].enabled = k === i;
    },
    subtitles() {},
    speed(r) { if (vid) vid.playbackRate = r; },
    rates: [0.75, 1, 1.25, 1.5, 2]
  };
  function mediaCode(e) { const c = e && e.code; return c === 2 ? 'network' : c === 3 || c === 4 ? 'format' : 'network'; }
  function fitWeb(m) { if (vid) vid.style.objectFit = m === 'fill' ? 'cover' : m === 'auto' ? 'none' : 'contain'; }
  function killHls() { if (hls) { try { hls.destroy(); } catch (e) {} hls = null; } }
  function loadHls() {
    if (window.Hls) return Promise.resolve();
    if (hlsLoading) return hlsLoading;
    hlsLoading = new Promise((res) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/hls.js@1.5.13/dist/hls.min.js';
      s.onload = () => res(); s.onerror = () => { hlsLoading = null; res(); };
      document.head.appendChild(s);
    });
    return hlsLoading;
  }
  function video() {
    if (vid) return vid;
    vid = document.createElement('video');
    vid.id = 'vid';
    vid.setAttribute('playsinline', '');
    vid.preload = 'auto';
    vid.style.display = 'none';
    $('root').insertBefore(vid, $('player'));
    let lastT = 0;
    vid.addEventListener('timeupdate', () => { const n = performance.now(); if (n - lastT < 400) return; lastT = n; onTime(vid.currentTime, isFinite(vid.duration) ? vid.duration : 0); });
    vid.addEventListener('waiting', () => onState('buffering'));
    vid.addEventListener('playing', () => onState('playing'));
    vid.addEventListener('pause', () => { if (!vid.ended) onState('paused'); });
    vid.addEventListener('ended', () => onState('ended'));
    vid.addEventListener('error', () => { if (st.opened) onError(mediaCode(vid.error)); });
    vid.addEventListener('ratechange', () => { st.rate = vid.playbackRate; });
    return vid;
  }
  // the web video sits over the screens at the box (design pixels of #root) or over the whole screen
  function place() {
    if (!vid || eng !== WEB) return;
    let x = 0, y = 0, w = 1920, h = 1080;
    if (mode === 'preview' && box) {
      const r = box.getBoundingClientRect(), R = $('root').getBoundingClientRect(), s = R.width / 1920 || 1;
      x = (r.left - R.left) / s; y = (r.top - R.top) / s; w = r.width / s; h = r.height / s;
    }
    vid.style.cssText = 'position:absolute;z-index:29;background:#000;left:' + x + 'px;top:' + y + 'px;width:' + w + 'px;height:' + h + 'px;display:' + (mode === 'off' ? 'none' : '') + ';object-fit:' + (vid.style.objectFit || 'contain');
  }

  /* ---------------- events from either engine ---------------- */
  function onTime(t, d) {
    st.t = +t || 0; if (d > 0) st.d = d; st.at = performance.now();
    if (retry && st.playing) { retry = 0; }
    if (mode === 'full') { drawProgress(); maybeNext(); }
    if (Date.now() - lastSave > SAVE_EVERY) saveProgress();
  }
  function onState(s) {
    if (s === 'buffering') { st.buffering = true; }
    else if (s === 'playing') { st.buffering = false; st.playing = true; st.ended = false; retry = 0; clearTimeout(retryT); center(''); }
    else if (s === 'paused') { st.buffering = false; st.playing = false; saveProgress(); }
    else if (s === 'ended') { st.playing = false; st.ended = true; ended(); }
    else if (s === 'idle') { st.playing = false; }
    st.at = performance.now();
    if (st.buffering && st.opened) center('spin'); else if (!retry) center('');
    paintPlay();
    subsTimer();
  }
  function onError(code) {
    if (!spec) return;
    st.playing = false; paintPlay();
    // a dropped connection: try again by itself (2 4 8 16 30 s), from where it was; a file the TV cannot play: say so
    if ((code === 'network' || code === 'restore' || code === 'timeout') && retry < 6) {
      retry++;
      center('spin', T('reconnecting', { n: retry }));
      clearTimeout(retryT);
      retryT = setTimeout(() => reopen(), Math.min(30000, 1000 * Math.pow(2, retry)));
      return;
    }
    failed(code);
  }
  function failed(code) {
    clearTimeout(retryT); retry = 0;
    center('msg', code === 'format' ? T('formatFail') : code === 'not-found' ? T('notFound') : code === 'network' || code === 'timeout' ? T('lostNet') : T('streamFail'));
    if (mode !== 'full') return;
    UI.dialog(T('errTitle'), code === 'format' ? T('formatFail') : code === 'not-found' ? T('notFound') : code === 'network' || code === 'timeout' ? T('lostNet') : T('streamFail'),
      [{ label: T('close'), action: () => closeFull() }, { label: T('retry'), primary: true, focus: true, action: () => reopen() }], { onBack: () => closeFull() });
  }
  function reopen() { if (!spec) return; start(spec, spec.live ? 0 : (st.t > 2 ? st.t : spec.start || 0), true); }
  window.addEventListener('online', () => { if (spec && retry) { clearTimeout(retryT); reopen(); } });

  /* ---------------- open / close ---------------- */
  async function start(s, at, again) {
    const my = ++openSeq;
    if (!again) {
      spec = s; st.t = at || 0; st.d = 0; st.ended = false; cues = null; cueIdx = -1; subDelay = 0; embOn = false; nextShown = false; nextCancel = false;
      drawSub(''); hideNext(); retry = 0; clearTimeout(retryT);
    }
    st.opened = false; st.playing = false; st.buffering = true; st.rate = 1;
    eng = tvOk() ? TV : WEB;
    center('spin');
    drawInfo();
    try {
      const r = await eng.open(s.url, { start: at || 0, live: !!s.live, rect: mode === 'preview' ? box : null, fit: Store.prefs().fit || 'fit' }, my);
      if (my !== openSeq) return;
      st.opened = true; st.d = r.d || 0; st.at = performance.now();
      if (mode === 'preview' && eng === TV) eng.rect(box).catch(() => {});
      st.buffering = false; st.playing = true;
      center(''); paintPlay(); drawProgress();
      if (!again) autoSubs(s);
      if (!s.live && !again) saveProgress(true);
      if (s.live) saveProgress(true);
    } catch (e) {
      if (my !== openSeq) return;
      const code = (e && e.code) || 'player';
      onError(code === 'bad-request' ? 'format' : code);
    }
  }
  function stopEngine() {
    openSeq++;
    clearTimeout(retryT); retry = 0;
    if (eng) { try { const p = eng.stop(); if (p && p.catch) p.catch(() => {}); } catch (e) {} }
    document.documentElement.classList.remove('video');
    st.playing = false; st.opened = false;
    drawSub(''); subsTimer();
  }
  function saveProgress(force) {
    if (!spec || !spec.key) return;
    lastSave = Date.now();
    if (spec.live) { Store.setProgress(spec.key, { t: 0, d: 0, name: spec.title, icon: spec.icon, kind: 'live' }); return; }
    const t = st.t, d = st.d;
    if (!force && !(t > 5)) return;
    if (!Store.prefs().remember && !(d > 0 && t / d > 0.9)) { Store.setProgress(spec.key, { t: 0, d, name: spec.title, icon: spec.icon, kind: spec.kind, x: spec.x || 0 }); return; }
    Store.setProgress(spec.key, { t, d, name: spec.title, icon: spec.icon, kind: spec.kind, x: spec.x || 0 });
    if (spec.parentKey) Store.setProgress(spec.parentKey, { t, d, name: spec.parentTitle || spec.title, icon: spec.icon, kind: spec.parentKind || 'series', x: spec.id });
  }

  /* ---------------- full screen: a screen on the stack ---------------- */
  function play(s, opts) {
    init();
    if (mode === 'preview' && spec && s.url === spec.url) return full();
    if (mode === 'preview') stopPreview();
    mode = 'full';
    scr = screen(false);
    UI.push(scr);
    start(s, s.start || 0);
  }
  function full() {
    if (!spec) return;
    mode = 'full';
    scr = screen(true);
    UI.push(scr);
    if (eng === TV) TV.rect(null).catch(() => {}); else place();
    drawInfo(); drawProgress();
  }
  function preview(s, el) {
    init();
    box = el;
    if (mode === 'full') return;
    const same = spec && mode === 'preview' && spec.url === s.url;
    mode = 'preview';
    if (same) { spec = s; return; }
    start(s, 0);
  }
  function stopPreview() { if (mode !== 'preview') return; saveProgress(); stopEngine(); spec = null; mode = 'off'; place(); }
  function closeFull() { if (mode === 'full' && UI.top() === scr) UI.pop(); }

  function screen(fromPreview) {
    const sObj = {
      root,
      show() { root.classList.add('on'); showUi(true); },
      hide() {},
      destroy() {
        clearTimeout(hideT); clearTimeout(seekT); clearTimeout(zapT); clearTimeout(bannerT); seekTo = -1;
        root.classList.remove('on'); hideList(); hideNext(); showUi(false); banner(false);
        saveProgress();
        if (fromPreview && spec && spec.live && box && box.isConnected) {
          mode = 'preview';
          if (eng === TV) TV.rect(box).catch(() => {}); else place();
          drawSub('');
          if (onZapFn) onZapFn(spec);
        } else { stopEngine(); spec = null; mode = 'off'; place(); if (onZapFn) onZapFn(null); }
        scr = null;
        UI.syncBack();
      },
      input
    };
    return sObj;
  }

  /* ---------------- the overlay ---------------- */
  function init() {
    if (root) return;
    root = $('player');
    root.innerHTML =
      '<div class="pl-top"><div class="ttl"></div><div class="pl-tags"></div><div class="clock"></div></div>' +
      '<div class="pl-center"></div><div class="pl-seek hidden"></div>' +
      '<div class="pl-banner hidden"><div class="no"></div><div class="lg"></div><div class="bd"><div class="ch"></div><div class="epg"></div></div></div>' +
      '<div class="pl-bot"><div class="pl-prog"><span class="t0"></span><div class="pl-bar"><i class="bf"></i><i class="th"></i></div><span class="t1"></span></div>' +
      '<div class="pl-live"><div class="epg"></div></div><div class="pl-btns"></div><div class="hints pl-hints"></div></div>' +
      '<div class="pl-next hidden"><div class="t1"></div><div class="t2"></div><div class="acts"><button class="btn primary f"></button><button class="btn"></button></div></div>' +
      '<div class="pl-list hidden"><h2></h2><div class="vl"></div></div>';
    ui = {
      top: root.querySelector('.pl-top'), ttl: root.querySelector('.pl-top .ttl'), tags: root.querySelector('.pl-tags'), clock: root.querySelector('.pl-top .clock'),
      center: root.querySelector('.pl-center'), seek: root.querySelector('.pl-seek'), banner: root.querySelector('.pl-banner'),
      bot: root.querySelector('.pl-bot'), prog: root.querySelector('.pl-prog'), t0: root.querySelector('.t0'), t1: root.querySelector('.pl-prog .t1'),
      bar: root.querySelector('.pl-bar'), bf: root.querySelector('.pl-bar .bf'), th: root.querySelector('.pl-bar .th'), live: root.querySelector('.pl-live'),
      btns: root.querySelector('.pl-btns'), hints: root.querySelector('.pl-hints'), next: root.querySelector('.pl-next'), list: root.querySelector('.pl-list')
    };
    if (tvOk()) {
      MyPC.video.on('time', (e) => { if (eng === TV) onTime(e.t, e.d); });
      MyPC.video.on('state', (e) => { if (eng === TV && st.opened) onState(e.state); });
      MyPC.video.on('error', (e) => { if (eng === TV && spec) onError(e.code); });
      MyPC.video.on('sub', (e) => { if (eng === TV && embOn) { drawSub(e.text); clearTimeout(embSubT); embSubT = setTimeout(() => drawSub(''), Math.max(800, +e.dur || 3500)); } });
    }
    setInterval(() => { if (uiOn) ui.clock.textContent = fmtClock(); }, 15000);
    applySubStyle();
  }
  function showUi(on, keepFocus) {
    uiOn = !!on;
    root.classList.toggle('ui', uiOn);
    ui.top.classList.toggle('hidden', !uiOn);
    ui.bot.classList.toggle('hidden', !uiOn);
    $('subs').classList.toggle('up', uiOn || Store.prefs().subs.pos === 'raised');
    if (uiOn) {
      ui.clock.textContent = fmtClock();
      if (!keepFocus) { focusRow = 1; focusBtn = 0; }
      buildBtns(); paintFocus(); drawProgress(); drawInfo();
      if (spec && spec.live) liveEpg(spec, ui.live.querySelector('.epg'));
      banner(false);
    }
    armHide();
  }
  function armHide() { clearTimeout(hideT); if (uiOn && st.playing) hideT = setTimeout(() => { if (!UI.modalOpen() && list === null) showUi(false); }, HIDE_AFTER); }
  function center(kind, text) {
    if (!ui.center) return;
    clear(ui.center);
    if (kind === 'spin') { ui.center.appendChild(el('div', 'spin')); if (text) ui.center.appendChild(el('div', '', text)); }
    else if (kind === 'msg') ui.center.appendChild(el('div', 'pl-msg', text));
    // in the Live TV box the same message shows in the box
    if (mode === 'preview' && box) { const m = box.querySelector('.pv-msg'); if (m) m.textContent = kind === 'msg' ? text : kind === 'spin' ? T('loading') : ''; }
  }
  function drawInfo() {
    if (!spec || !ui.ttl) return;
    ui.ttl.textContent = spec.title || '';
    if (spec.sub) ui.ttl.appendChild(el('small', '', spec.sub));
    clear(ui.tags);
    if (spec.live) ui.tags.appendChild(el('span', 'badge', T('live2')));
    if (spec.fav && Store.isFav(spec.fav.kind, spec.fav.id)) { const s = document.createElement('span'); s.innerHTML = svg('heart'); s.className = 'favtag'; ui.tags.appendChild(s); }
    ui.prog.classList.toggle('hidden', !!spec.live);
    ui.live.classList.toggle('hidden', !spec.live);
    UI.hints(ui.hints, spec.live ? [['b', T('hintOk')], ['ch', T('hintZap')], ['y', T('list')], ['x', T('hintFav')], ['plus', T('hintMenu')], ['a', T('hintBack')]]
                                 : [['b', T('hintOk')], ['x', T('hintFav')], ['plus', T('hintTracks')], ['a', T('hintBack')]]);
  }
  function drawProgress() {
    if (!uiOn || !spec || spec.live || !ui.bar) return;
    const d = st.d, t = seekTo >= 0 ? seekTo : now();
    ui.t0.textContent = fmtTime(t);
    ui.t1.textContent = d > 0 ? '-' + fmtTime(Math.max(0, d - t)) : '';
    const p = d > 0 ? Math.max(0, Math.min(1, t / d)) : 0;
    ui.bf.style.transform = 'scaleX(' + p + ')';
    ui.th.style.left = (p * 100) + '%';
  }
  function now() { return st.playing && st.at ? st.t + (performance.now() - st.at) / 1000 * (st.rate || 1) : st.t; }

  function buildBtns() {
    const s = spec || {};
    btns = [];
    if (s.live) {
      btns.push({ id: 'list', icon: 'list', label: T('list'), run: openList });
      btns.push({ id: 'prev', icon: 'prev', label: '', run: () => zap(-1) });
      btns.push({ id: 'next', icon: 'next', label: '', run: () => zap(1) });
    } else {
      btns.push({ id: 'pp', icon: st.playing ? 'pause' : 'play', label: '', run: togglePlay });
      btns.push({ id: 'rew', icon: 'rew', label: '', run: () => seekBy(-30, true) });
      btns.push({ id: 'ff', icon: 'ff', label: '', run: () => seekBy(30, true) });
      if (s.next) btns.push({ id: 'nx', icon: 'next', label: T('nextEp'), run: playNext });
    }
    btns.push({ id: 'grow' });
    btns.push({ id: 'audio', icon: 'audio', label: T('audio'), run: audioMenu });
    btns.push({ id: 'subs', icon: 'subs', label: T('subtitles'), run: subsMenu });
    if (s.fav) btns.push({ id: 'fav', icon: 'heart', label: '', run: toggleFav });
    btns.push({ id: 'more', icon: 'more', label: '', run: optionsMenu });
    clear(ui.btns);
    btns.forEach((b) => {
      if (b.id === 'grow') { ui.btns.appendChild(el('div', 'grow')); return; }
      const x = el('button', 'pbtn');
      x.innerHTML = svg(b.icon);
      if (b.label) x.appendChild(el('span', '', b.label));
      x.setAttribute('aria-label', b.label || b.id);
      b.node = x;
      ui.btns.appendChild(x);
    });
    btns = btns.filter((b) => b.id !== 'grow');
    if (focusBtn >= btns.length) focusBtn = 0;
  }
  function paintPlay() { const b = btns.find((x) => x.id === 'pp'); if (b && b.node) b.node.innerHTML = svg(st.playing ? 'pause' : 'play'); }
  function paintFocus() {
    btns.forEach((b, i) => b.node && b.node.classList.toggle('f', focusRow === 1 && i === focusBtn));
    ui.bar.classList.toggle('f', focusRow === 0 && !(spec && spec.live));
  }
  function sayBtn() { const b = btns[focusBtn]; if (!b) return; announce(b.label || T({ pp: st.playing ? 'paused' : 'play', rew: 'seekBy', ff: 'seekBy', prev: 'list', next: 'next', fav: spec && spec.fav && Store.isFav(spec.fav.kind, spec.fav.id) ? 'delFav' : 'addFav', more: 'options' }[b.id] || 'ok', { s: 30 })); }

  /* ---------------- input (the router of app.js sends simple actions) ---------------- */
  function input(a, repeat) {
    if (!spec) return a === 'back' ? false : undefined;
    if (list) return listInput(a, repeat);
    if (nextShown && (a === 'ok' || a === 'back')) { if (a === 'ok') playNext(); else { nextCancel = true; hideNext(); } return true; }
    const live = !!spec.live;
    if (a === 'back') {
      if (seekTo >= 0) { seekTo = -1; clearTimeout(seekT); ui.seek.classList.add('hidden'); drawProgress(); return true; }
      if (uiOn) { showUi(false); return true; }
      return false;
    }
    if (a === 'playPause') { togglePlay(); return; }
    if (a === 'mediaStop') { closeFull(); return; }
    if (a === 'mediaFf') { if (live) zap(1); else seekBy(stepFor(repeat), false); return; }
    if (a === 'mediaRew') { if (live) zap(-1); else seekBy(-stepFor(repeat), false); return; }
    if (a === 'mediaNext') { if (live) zap(1); else if (spec.next) playNext(); return; }
    if (a === 'mediaPrev') { if (live) zap(-1); else seekBy(-st.t, true); return; }
    if (a === 'pageUp' || a === 'pageDown') { if (live) zap(a === 'pageUp' ? 1 : -1); else seekBy(a === 'pageUp' ? 300 : -300, false); return; }
    if (a === 'fav') { toggleFav(); return; }
    if (a === 'search') { if (live) openList(); else audioMenu(); return; }
    if (a === 'menu' || a === 'hold') { optionsMenu(); return; }
    if (!uiOn) {
      if (a === 'ok') { if (live) { showUi(true); } else showUi(true); return; }
      if (live && (a === 'up' || a === 'down')) { zap(a === 'up' ? 1 : -1); return; }
      if (live && (a === 'left' || a === 'right')) { openList(); return; }
      if (!live && (a === 'left' || a === 'right')) { seekBy(((a === 'right') !== rtl() ? 1 : -1) * stepFor(repeat), false); return; }
      if (!live && (a === 'up' || a === 'down')) { showUi(true); return; }
      return;
    }
    armHide();
    if (a === 'up') { if (!live && focusRow === 1) { focusRow = 0; paintFocus(); announce(fmtTime(now())); } return; }
    if (a === 'down') { if (focusRow === 0) { focusRow = 1; paintFocus(); sayBtn(); } else showUi(false); return; }
    if (a === 'left' || a === 'right') {
      const d = (a === 'right') !== rtl() ? 1 : -1;
      if (focusRow === 0) { seekBy(d * stepFor(repeat), false); return; }
      const n = Math.max(0, Math.min(btns.length - 1, focusBtn + d));
      if (n !== focusBtn) { focusBtn = n; paintFocus(); sayBtn(); }
      return;
    }
    if (a === 'ok') {
      if (focusRow === 0) { if (seekTo >= 0) commitSeek(); else togglePlay(); return; }
      const b = btns[focusBtn];
      if (b && b.run) b.run();
    }
  }
  function rtl() { return document.documentElement.dir === 'rtl'; }
  function stepFor(repeat) { seekReps = repeat ? seekReps + 1 : 0; return seekReps > 24 ? 120 : seekReps > 10 ? 60 : seekReps > 4 ? 30 : 10; }

  function togglePlay() {
    if (!spec || !eng) return;
    if (st.ended) { start(spec, 0); return; }
    if (st.playing) { eng.pause(); st.playing = false; saveProgress(); announce(T('paused')); }
    else { const p = eng.play(); if (p && p.catch) p.catch(() => {}); st.playing = true; st.at = performance.now(); announce(T('play')); }
    paintPlay(); armHide(); subsTimer();
    if (!uiOn && mode === 'full') showUi(true, true);
  }
  // left / right add up while held; the jump happens once the key rests (one seek, not twenty)
  function seekBy(delta, now_) {
    if (!spec || spec.live || !st.opened) return;
    const base = seekTo >= 0 ? seekTo : now();
    seekTo = Math.max(0, Math.min(st.d > 0 ? st.d - 2 : base + Math.abs(delta) + 3600, base + delta));
    ui.seek.textContent = fmtTime(seekTo) + (st.d > 0 ? ' / ' + fmtTime(st.d) : '');
    ui.seek.classList.remove('hidden');
    drawProgress();
    clearTimeout(seekT);
    if (now_) commitSeek(); else seekT = setTimeout(commitSeek, SEEK_WAIT);
    if (!uiOn) { /* the time bubble alone is enough */ }
  }
  function commitSeek() {
    clearTimeout(seekT);
    if (seekTo < 0) return;
    const t = seekTo;
    seekTo = -1;
    ui.seek.classList.add('hidden');
    st.t = t; st.at = performance.now(); st.ended = false; cueIdx = -1;
    const p = eng.seek(t);
    if (p && p.catch) p.catch(() => {});
    if (nextShown && st.d - t > 25) { hideNext(); nextCancel = false; }
    drawProgress(); drawSub('');
    announce(T('jumpTo', { t: fmtTime(t) }));
  }

  /* ---------------- live: zapping, banner, channel list ---------------- */
  function zap(d) {
    if (!spec || !spec.live || !spec.list || !spec.list.length) return;
    const L = spec.list;
    if (zapIdx < 0) zapIdx = spec.index || 0;
    zapIdx = (zapIdx + d + L.length) % L.length;
    const it = L[zapIdx];
    showUi(false);
    banner(true, it);
    clearTimeout(zapT);
    zapT = setTimeout(() => { const i = zapIdx; zapIdx = -1; if (spec.makeSpec) { const s = spec.makeSpec(L[i], i); start(s, 0); if (onZapFn) onZapFn(s); drawInfo(); } }, ZAP_WAIT);
  }
  function banner(on, it) {
    clearTimeout(bannerT);
    ui.banner.classList.toggle('hidden', !on);
    if (!on || !it) return;
    ui.banner.querySelector('.no').textContent = it.no || '';
    const lg = ui.banner.querySelector('.lg');
    lg.style.backgroundImage = '';
    if (it.l) Net.image(it.l, (u) => { if (u) lg.style.backgroundImage = 'url("' + u + '")'; });
    ui.banner.querySelector('.ch').textContent = it.n;
    announce((it.no ? it.no + ' ' : '') + it.n);
    liveEpg({ item: it }, ui.banner.querySelector('.epg'));
    bannerT = setTimeout(() => banner(false), 4500);
  }
  async function liveEpg(s, box_) {
    const it = s.item || (s.list && s.list[s.index]);
    clear(box_);
    if (!it || !Catalog.provider() || !Catalog.provider().epg) return;
    let l = epgCache.get(it.i);
    if (!l || Date.now() - l.at > 300000) {
      try { l = { at: Date.now(), v: await Catalog.provider().epg(it) }; epgCache.set(it.i, l); if (epgCache.size > 200) epgCache.delete(epgCache.keys().next().value); } catch (e) { l = { at: Date.now(), v: [] }; }
    }
    drawEpg(box_, l.v);
  }
  function drawEpg(box_, l) {
    clear(box_);
    if (!l || !l.length) { box_.appendChild(el('div', 'ds', T('noEpg'))); return; }
    l.slice(0, 2).forEach((p, i) => {
      const b = el('div', 'it');
      b.appendChild(el('div', 'tm', (i === 0 ? T('nowOn') : T('next')) + ' · ' + fmtClock(new Date(p.start)) + ' – ' + fmtClock(new Date(p.end))));
      b.appendChild(el('div', 'tl', p.title));
      if (i === 0) { const g = el('div', 'pg'), x = el('i'); x.style.width = Math.max(0, Math.min(100, (Date.now() - p.start) / (p.end - p.start) * 100)) + '%'; g.appendChild(x); b.appendChild(g); }
      box_.appendChild(b);
    });
  }
  function openList() {
    if (!spec || !spec.live || !spec.list) return;
    showUi(false);
    banner(false);
    ui.list.classList.remove('hidden');
    ui.list.querySelector('h2').textContent = spec.listName || T('list');
    const L = spec.list;
    list = new VList(ui.list.querySelector('.vl'), { itemH: 84, render(i, n, fullR) {
      const it = L[i];
      if (!n.__r) { n.__r = el('div', 'row'); n.__no = el('div', 'no'); n.__lg = el('div', 'lg'); n.__nm = el('div', 'nm'); n.__r.append(n.__no, n.__lg, n.__nm); n.appendChild(n.__r); }
      n.__no.textContent = it.no || i + 1; n.__nm.textContent = it.n;
      n.__r.classList.toggle('playing', spec && spec.item && spec.item.i === it.i);
      n.__lg.style.backgroundImage = '';
      if (fullR && it.l) { const want = it.i; Net.image(it.l, (u) => { if (u && n.__i === i && L[i].i === want) n.__lg.style.backgroundImage = 'url("' + u + '")'; }); }
    }, onFocus(i) { announce((L[i].no ? L[i].no + ' ' : '') + L[i].n); } });
    list.setCount(L.length, spec.index || 0);
    list.active(true);
    UI.syncBack();
  }
  function hideList() { if (!list) return; list.destroy(); list = null; ui.list.classList.add('hidden'); }
  function listInput(a, repeat) {
    if (a === 'up' || a === 'down') { list.move(a); return true; }
    if (a === 'pageUp' || a === 'pageDown') { list.page(a === 'pageUp' ? -1 : 1); return true; }
    if (a === 'back' || a === 'left' || a === 'right' || a === 'search') { hideList(); return true; }
    if (a === 'ok') {
      const i = list.index, L = spec.list;
      hideList();
      if (spec.makeSpec && L[i] && (!spec.item || L[i].i !== spec.item.i)) { const s = spec.makeSpec(L[i], i); start(s, 0); if (onZapFn) onZapFn(s); drawInfo(); banner(true, L[i]); }
      return true;
    }
    return true;
  }

  /* ---------------- next episode ---------------- */
  function maybeNext() {
    if (!spec || !spec.next || spec.live || nextShown || nextCancel || !(st.d > 30)) return;
    const left = st.d - st.t;
    if (left > 0 && left <= 20 && Store.prefs().autoNext) showNext();
  }
  function showNext() {
    const n = spec.next && spec.next();
    if (!n) return;
    nextShown = true;
    ui.next.classList.remove('hidden');
    ui.next.querySelector('.t2').textContent = n.title + (n.sub ? ' · ' + n.sub : '');
    const bs = ui.next.querySelectorAll('button');
    bs[0].textContent = T('playNow'); bs[1].textContent = T('cancel');
    const tick = () => { if (!nextShown) return; ui.next.querySelector('.t1').textContent = T('nextIn', { n: Math.max(0, Math.ceil(st.d - now())) }); setTimeout(tick, 500); };
    tick();
    announce(T('nextEp') + ': ' + n.title);
  }
  function hideNext() { nextShown = false; if (ui.next) ui.next.classList.add('hidden'); }
  function playNext() {
    const n = spec && spec.next && spec.next();
    hideNext();
    if (!n) return;
    saveProgress();
    start(n, n.start || 0);
    drawInfo();
    if (uiOn) { buildBtns(); paintFocus(); }
  }
  function ended() {
    saveProgress();
    if (spec && spec.next && Store.prefs().autoNext && !nextCancel && spec.next()) { playNext(); return; }
    center('msg', T('ended'));
    if (mode === 'full') showUi(true);
  }

  /* ---------------- subtitles ---------------- */
  function applySubStyle() {
    const s = Store.prefs().subs, b = $('subs');
    if (!b) return;
    const size = { small: 34, medium: 44, large: 56, xlarge: 70 }[s.size] || 44;
    const color = { white: '#fff', yellow: '#ffe14d', cyan: '#5ef0ff', green: '#7dff8a' }[s.color] || '#fff';
    const font = { sans: '"Segoe UI", Roboto, Arial, "Kufi Arabic", sans-serif', serif: 'Georgia, "Times New Roman", serif', mono: '"Courier New", monospace' }[s.font] || '';
    b.style.fontSize = size + 'px'; b.style.color = color; b.style.fontFamily = font; b.style.fontWeight = '600';
    b.dataset.bg = s.bg;
    b.classList.toggle('up', uiOn || s.pos === 'raised');
    const sp = b.firstChild;
    if (sp) { sp.style.background = s.bg === 'half' ? 'rgba(0,0,0,.55)' : s.bg === 'black' ? '#000' : 'transparent'; sp.style.textShadow = s.bg === 'none' ? 'none' : ''; }
  }
  function drawSub(text) {
    const b = $('subs');
    if (!b) return;
    if (!text || mode !== 'full') { if (b.firstChild) clear(b); return; }
    if (b.__t === text && b.firstChild) return;
    b.__t = text;
    clear(b);
    const bg = b.dataset.bg, sp = el('span', '', text);
    sp.style.background = bg === 'half' ? 'rgba(0,0,0,.55)' : bg === 'black' ? '#000' : 'transparent';
    sp.style.textShadow = bg === 'none' ? 'none' : '';
    b.appendChild(sp);
  }
  // cues of a file: shown from the engine's time, guessed between its reports (the TV says the time twice a second)
  function subsTimer() {
    clearInterval(subT); subT = 0;
    if (!cues || !st.playing || mode !== 'full') return;
    subT = setInterval(() => {
      const t = now() - subDelay, i = Subs.at(cues, t, cueIdx);
      if (i !== cueIdx) { cueIdx = i; drawSub(i >= 0 ? cues[i].t : ''); }
    }, 120);
  }
  function setCues(c, label) {
    cues = c && c.length ? c : null; cueIdx = -1; drawSub('');
    if (embOn) { embOn = false; if (eng === TV) TV.subtitles(false).catch(() => {}); }
    subsTimer();
    if (label) UI.toast(T('subtitles') + ': ' + label);
  }
  async function autoSubs(s) {
    if (!s.files || !s.files.length) return;
    // the language of My PC, else the file with no language in its name ("Movie.srt": players load it by themselves), else the only one
    const want = (window.LANG_PREF || LANG), f = s.files.find((x) => x.lang && x.lang.slice(0, 2) === want) || s.files.find((x) => !x.lang) || (s.files.length === 1 ? s.files[0] : null);
    if (!f) return;
    try { const c = await f.load(); if (spec === s) setCues(c, ''); } catch (e) {}
  }

  /* ---------------- menus ---------------- */
  async function audioMenu() {
    let t = { audio: [] };
    try { t = await eng.tracks(); } catch (e) {}
    if (!t.audio.length) { UI.toast(T('audio') + ': ' + T('track', { n: 1 })); return; }
    UI.menu(T('audio'), t.audio.map((a) => ({ label: a.label || T('track', { n: a.n }), sub: a.label ? T('track', { n: a.n }) : '', checked: t.cur.audio === a.index,
      action: () => { const p = eng.track('audio', a.index); if (p && p.catch) p.catch(() => {}); UI.toast(T('audio') + ': ' + (a.label || T('track', { n: a.n }))); } })));
  }
  async function subsMenu() {
    let t = { text: [] };
    try { t = await eng.tracks(); } catch (e) {}
    const items = [{ label: T('subsOff'), checked: !cues && !embOn, action: () => { setCues(null); if (eng === TV) TV.subtitles(false).catch(() => {}); embOn = false; drawSub(''); } }];
    (t.text || []).forEach((x) => items.push({ label: x.label || T('track', { n: x.n }), sub: T('track', { n: x.n }), checked: embOn && t.cur.text === x.index,
      action: async () => { setCues(null); try { await TV.track('text', x.index); await TV.subtitles(true); embOn = true; } catch (e) { UI.toast(T('streamFail')); } } }));
    (spec.files || []).forEach((f) => items.push({ label: f.label, sub: T('fileSubs'), action: async () => {
      const b = UI.busy(T('loading'));
      try { const c = await f.load(); b.close(); setCues(c, f.label); } catch (e) { b.close(); UI.toast(T('subsNone')); }
    } }));
    if (spec.meta) items.push({ label: T('subsOnline'), action: onlineSubs });
    items.push({ label: T('subsStyle'), action: styleMenu });
    if (cues) items.push({ label: T('subsDelay'), value: (subDelay > 0 ? '+' : '') + subDelay.toFixed(1) + ' s', action: delayMenu });
    UI.menu(T('subtitles'), items);
  }
  async function onlineSubs() {
    let cancelled = false;
    const b = UI.busy(T('subsSearching'), () => { cancelled = true; });
    let res = [];
    try { res = await Subs.search(spec.meta, spec.metaKind || 'movie'); } catch (e) { res = []; }
    if (cancelled) return;
    b.close();
    if (!res.length) { UI.toast(T('subsNone')); return; }
    const want = LANG;
    res.sort((x, y) => (y.lang.slice(0, 2) === want) - (x.lang.slice(0, 2) === want));
    UI.menu(T('subsOnline'), res.map((r) => ({ label: Subs.langName(r.lang), sub: r.name, action: async () => {
      const bb = UI.busy(T('loading'));
      try { const c = await Subs.download(r); bb.close(); setCues(c, Subs.langName(r.lang)); } catch (e) { bb.close(); UI.toast(T('subsNone')); }
    } })), { rows: 8 });
  }
  function styleMenu() {
    const s = Store.prefs().subs;
    const opts = { size: ['small', 'medium', 'large', 'xlarge'], color: ['white', 'yellow', 'cyan', 'green'], bg: ['shadow', 'half', 'black', 'none'], font: ['sans', 'serif', 'mono'], pos: ['bottom', 'raised'] };
    const lbl = { size: 'size', color: 'color', bg: 'background', font: 'font', pos: 'position' };
    const name = (k, v) => T(k === 'font' ? 'font' + v[0].toUpperCase() + v.slice(1) : v);
    const items = () => Object.keys(opts).map((k) => ({ label: T(lbl[k]), value: name(k, s[k]), stay: true, k }));
    const m = UI.menu(T('subsStyle'), items(), { onKey(a, it) {
      if (!it || (a !== 'left' && a !== 'right' && a !== 'ok')) return;
      const l = opts[it.k], i = l.indexOf(s[it.k]), d = a === 'left' ? -1 : 1;
      s[it.k] = l[(i + d + l.length) % l.length];
      Store.setPref('subs', s); applySubStyle();
      const keep = $('subs').__t; $('subs').__t = ''; drawSub(keep || (cues ? '' : T('subtitles') + ' · Speedy'));
      m.refresh(items());
      announce(T(lbl[it.k]) + ', ' + name(it.k, s[it.k]));
    } });
  }
  function delayMenu() {
    const val = () => (subDelay > 0 ? '+' : '') + subDelay.toFixed(1) + ' s';
    const steps = [-0.5, 0.5, -5, 5, 0];
    const items = () => steps.map((d) => ({ label: d === 0 ? T('subsDelay') + ' = 0' : (d > 0 ? '+' : '−') + Math.abs(d) + ' s', value: d === 0 ? val() : undefined, stay: true, d,
      action: () => { subDelay = d === 0 ? 0 : Math.round((subDelay + d) * 10) / 10; cueIdx = -1; m.refresh(items()); UI.toast(T('subsDelay') + ': ' + val()); } }));
    const m = UI.menu(T('subsDelay') + ' (' + val() + ')', items());
  }
  function fitMenu() {
    const cur = Store.prefs().fit || 'fit';
    UI.menu(T('aspect'), ['fit', 'fill', 'auto'].map((k) => ({ label: T(k), checked: cur === k, action: () => { Store.setPref('fit', k); const p = eng && eng.fit(k); if (p && p.catch) p.catch(() => {}); UI.toast(T('aspect') + ': ' + T(k)); } })));
  }
  function speedMenu() {
    const rates = eng.rates;
    UI.menu('×', rates.map((r) => ({ label: r + '×', checked: (st.rate || 1) === r, action: () => { const p = eng.speed(r); if (p && p.catch) p.catch(() => {}); st.t = now(); st.at = performance.now(); st.rate = r; } })));
  }
  function toggleFav() {
    if (!spec || !spec.fav) return;
    const on = Store.toggleFav(spec.fav.kind, spec.fav.id);
    Catalog.invalidate(spec.fav.kind);
    UI.toast(on ? T('favAdded') : T('favRemoved'));
    drawInfo();
  }
  async function optionsMenu() {
    if (!spec) return;
    const items = [{ label: T('audio'), action: audioMenu }, { label: T('subtitles'), action: subsMenu }, { label: T('subsStyle'), action: styleMenu }];
    if (cues) items.push({ label: T('subsDelay'), action: delayMenu });
    items.push({ label: T('aspect'), value: T(Store.prefs().fit || 'fit'), action: fitMenu });
    if (!spec.live) items.push({ label: '×  ' + (st.rate || 1), action: speedMenu });
    if (spec.live) items.push({ label: T('list'), action: openList });
    if (spec.next) items.push({ label: T('nextEp'), action: playNext });
    if (!spec.live) items.push({ label: T('fromStart'), action: () => { seekTo = 0; commitSeek(); } });
    if (spec.fav) items.push({ label: Store.isFav(spec.fav.kind, spec.fav.id) ? T('delFav') : T('addFav'), action: toggleFav });
    items.push({ label: T('info'), action: infoBox });
    items.push({ label: T('close'), action: () => closeFull() });
    UI.menu(spec.title, items, { focus: 0 });
  }
  async function infoBox() {
    let t = {};
    try { t = await eng.tracks(); } catch (e) {}
    const lines = [];
    if (t.w) lines.push(t.w + '×' + t.h + (t.h >= 2000 ? ' · 4K' : t.h >= 1000 ? ' · Full HD' : t.h >= 700 ? ' · HD' : ''));
    if (st.d) lines.push(fmtTime(now()) + ' / ' + fmtTime(st.d));
    if (t.audio && t.audio.length) lines.push(T('audio') + ': ' + t.audio.map((a) => a.label).join(', '));
    lines.push(eng === TV ? 'TV player (AVPlay)' : 'Web player' + (hls ? ' (HLS)' : ''));
    UI.alert(spec.title, lines.join('\n'));
  }

  return {
    play, preview, stopPreview, full,
    current: () => spec, mode: () => mode, state: () => ({ t: now(), d: st.d, playing: st.playing, buffering: st.buffering, ended: st.ended, engine: eng ? eng.name : '', cues: cues ? cues.length : 0, sub: $('subs') ? $('subs').textContent : '', ui: uiOn }),
    onZap(fn) { onZapFn = fn; },
    placeBox(el) { box = el; if (mode === 'preview') { if (eng === TV) TV.rect(el).catch(() => {}); else place(); } },
    applySubStyle, save() { saveProgress(); }, pause() { if (eng && st.playing) { eng.pause(); st.playing = false; saveProgress(); } },
    resume() { if (eng && st.opened && !st.playing && mode !== 'off' && !st.ended) { const p = eng.play(); if (p && p.catch) p.catch(() => {}); st.playing = true; st.at = performance.now(); } },
    stopAll() { if (mode === 'full') closeFull(); stopPreview(); },
    _setCues: setCues
  };
})();
