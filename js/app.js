/* Start-up and input. Everything comes from My PC's SDK (MyPC.init): no key listeners of our own inside My PC.
 *   OK (B on a controller) = ok · hold OK 0.6 s = hold (options) · Back / A / Esc = back · X = favorite · Y = search
 *   + (Start) = menu · CH + / CH − and L / R = pageUp / pageDown · the remote's media keys = playPause, mediaFf ... */
'use strict';
const APP_VERSION = '1.0.0';
(() => {
  const HOLD = window.__speedyHold || 600;     // tests make it longer: a slow test browser can hold a key's release back
  let okAt = 0, holdT = 0, held = false, started = false;

  function fit() {
    const r = $('root'), s = Math.min(window.innerWidth / 1920, window.innerHeight / 1080) || 1;
    r.style.transform = 'scale(' + s + ')';
    r.style.left = Math.round((window.innerWidth - 1920 * s) / 2) + 'px';
    r.style.top = Math.round((window.innerHeight - 1080 * s) / 2) + 'px';
  }
  const log = window.__acts = [];
  function act(a, repeat) { log.push(a); if (log.length > 60) log.shift(); try { UI.input(a, !!repeat); } catch (e) { report(e, { where: 'input ' + a }); } }

  function onInput(a, pressed, repeat, dev) {
    if (!started) return;
    if (a === 'jump' || a === 'run') return;                 // OK also sends jump; run is ambiguous (B / X / Y)
    if (a === 'confirm') {
      if (pressed && !repeat) { okAt = performance.now(); held = false; clearTimeout(holdT); holdT = setTimeout(() => { held = true; act('hold'); }, HOLD); }
      else if (!pressed) { clearTimeout(holdT); if (!held && okAt) act('ok'); okAt = 0; held = false; }
      return;
    }
    if (!pressed) return;
    if (a === 'cancel') { if (!repeat) act('back'); return; }
    if (a === 'pause') { if (!repeat) act('playPause'); return; }
    if (a === 'menu') { if (!repeat) act('menu'); return; }
    if (/^(up|down|left|right|pageUp|pageDown|mediaFf|mediaRew)$/.test(a)) { act(a, repeat); return; }
    if (/^(playPause|mediaNext|mediaPrev|mediaStop)$/.test(a)) { if (!repeat) act(a); return; }
  }

  function clock() { const t = fmtClock(); document.querySelectorAll('.screen.on .clock, #player.on .clock').forEach((c) => { if (c.textContent !== t) c.textContent = t; }); }

  MyPC.init({
    ownMenu: true,
    keys: ['channel', 'media'],
    onInit(info) {
      setLang(info && info.lang);
      Store.init();
      applyTheme(Store.prefs().theme);
      Catalog.reset(Store.current());
      Catalog.onUpdate((kind, quiet) => { const t = UI.top(); if (t && t.build) t.build(); if (quiet) UI.toast(T('newer')); });
      fit();
      window.addEventListener('resize', fit);
      // X (top) = favorite, Y (left) = search on every controller; L / R page when outside My PC (My PC sends them as CH + / CH −)
      try {
        MyPC.gamepad.on('button', (i, pressed) => {
          if (!pressed || !started || UI.modalOpen() && i !== 3) return;
          if (i === 3) act('fav'); else if (i === 2) act('search');
          else if (!MyPC.isHosted() && (i === 4 || i === 5)) act(i === 4 ? 'pageUp' : 'pageDown');
        });
      } catch (e) {}
      if (!MyPC.isHosted()) {
        // outside My PC (a browser): a few keys of a keyboard
        document.addEventListener('keydown', (e) => {
          const tag = e.target && e.target.tagName;
          if (tag === 'INPUT' || tag === 'TEXTAREA') return;
          const k = { 70: 'fav', 83: 'search', 77: 'menu', 33: 'pageUp', 34: 'pageDown', 179: 'playPause', 228: 'mediaFf', 227: 'mediaRew', 176: 'mediaNext', 177: 'mediaPrev', 178: 'mediaStop' }[e.keyCode];
          if (k) { e.preventDefault(); act(k, e.repeat); }
        });
      }
      UI.push(new HomeScreen());
      started = true;
      setInterval(clock, 10000);
      MyPC.ready();
    },
    onPause() { clearTimeout(holdT); okAt = 0; Player.save(); },
    onResume() {},
    onDestroy() { Player.stopAll(); Provider.stopWorker(); },
    onInput
  });
})();
