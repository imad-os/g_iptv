/* The remote's buttons, mapped by the player (Settings > Remote buttons). Inside My PC (API 19, MyPC.buttons) every remote button
 * comes here by name; OK, the arrows and Play / Pause always keep their own job, Back stays Back (My PC sends it apart).
 *   Buttons.actionFor(name, inPlayer)  the action a button runs now ('' = its own job)
 *   Buttons.screen()                   Settings > Remote buttons
 *   Buttons.listen(name, pressed)      true while "Press the button" waits for one (it takes that press) */
'use strict';
const Buttons = (() => {
  // [action, label key, group]; list = lists and pages (also in the player when the player has nothing on that button)
  const ACTS = [['ok', 'btnOk', 'list'], ['back', 'btnBack', 'list'], ['fav', 'btnFav', 'list'], ['menu', 'btnMenu', 'list'], ['search', 'btnSearch', 'list'],
                ['pageUp', 'btnPageUp', 'list'], ['pageDown', 'btnPageDown', 'list'],
                ['subs', 'btnSubs', 'player'], ['audio', 'btnAudio', 'player'], ['plMenu', 'btnPlMenu', 'player']];
  const DEF = { ok: '', back: '', fav: 'red', menu: 'blue', search: 'green', pageUp: 'chUp', pageDown: 'chDown', subs: 'yellow', audio: 'green', plMenu: 'blue' };
  // the buttons that can be given an action (never the arrows, OK, Back or Play / Pause)
  const CHOICES = ['red', 'green', 'yellow', 'blue', 'chUp', 'chDown', 'guide', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0', 'info', 'chList', 'tools', 'prevCh',
                   'caption', 'mts', 'teletext', 'pictureSize', 'extra', 'minus', 'ff', 'rew', 'next', 'prev', 'stop', 'record'];
  const NAME = { red: 'bRed', green: 'bGreen', yellow: 'bYellow', blue: 'bBlue', chUp: 'bChUp', chDown: 'bChDown', info: 'bInfo', chList: 'bChList', tools: 'bTools',
                 prevCh: 'bPrevCh', guide: 'bGuide', caption: 'bCaption', mts: 'bMts', teletext: 'bTeletext', pictureSize: 'bPictureSize', extra: 'bExtra', minus: 'bMinus',
                 ff: 'bFf', rew: 'bRew', next: 'bNext', prev: 'bPrev', stop: 'bStop', record: 'bRecord', pageUp: 'bChUp', pageDown: 'bChDown' };

  function supported() { try { return MyPC.isHosted() && MyPC.apiLevel >= 19 && !!MyPC.buttons; } catch (e) { return false; } }
  function map() { return Object.assign({}, DEF, Store.prefs().btns || {}); }
  // a key My PC has no name for comes as 'k<code>' with the TV's own name for it (kept so the setting can show it)
  function label(b) {
    if (!b) return T('btnNone');
    if (/^\d$/.test(b)) return T('bNumber', { n: b });
    if (/^k\d+$/.test(b)) { const l = (Store.prefs().btnNames || {})[b]; return l ? l.replace(/([a-z])([A-Z])/g, '$1 $2') : T('bKey', { n: b.slice(1) }); }
    return T(NAME[b] || b);
  }
  function groupOf(a) { const x = ACTS.find((y) => y[0] === a); return x ? x[2] : 'list'; }
  function actionFor(name, inPlayer) {
    const m = map();
    // a keyboard's PageUp / PageDown count as CH + / CH −
    if (name === 'pageUp') name = 'chUp'; else if (name === 'pageDown') name = 'chDown';
    if (inPlayer) { const p = ACTS.find((x) => x[2] === 'player' && m[x[0]] === name); if (p) return p[0]; }
    const l = ACTS.find((x) => x[2] === 'list' && m[x[0]] === name);
    return l ? l[0] : '';
  }
  // one button does one thing per group: giving it to an action takes it from the other one
  function set(a, b) {
    const o = Object.assign({}, Store.prefs().btns || {}), m = map(), g = groupOf(a);
    if (b) for (const x of ACTS) if (x[0] !== a && x[2] === g && m[x[0]] === b) o[x[0]] = '';
    o[a] = b;
    Store.setPref('btns', o);
  }

  // "Press the button": the next remote button (5 s); Back cancels (it comes as Back, not here)
  let wait = null;
  const FIXED = /^(up|down|left|right|ok|space|play|pause|playPause)$/;
  function listen(name, pressed, lbl) {
    if (!wait) return false;
    if (!pressed) return true;
    if (FIXED.test(name)) { UI.toast(T('btnCant')); return true; }
    if (/^k\d+$/.test(name) && lbl) { const o = Object.assign({}, Store.prefs().btnNames || {}); o[name] = String(lbl).slice(0, 40); Store.setPref('btnNames', o); }
    const w = wait; wait = null;
    w.done(name === 'pageUp' ? 'chUp' : name === 'pageDown' ? 'chDown' : name);
    return true;
  }
  function press(onDone) {
    const b = UI.busy(T('btnPress'), () => { if (wait) { clearTimeout(wait.t); wait = null; } });
    wait = { done: (n) => { clearTimeout(wait && wait.t); b.close(); onDone(n); }, t: setTimeout(() => { if (wait) { wait = null; b.close(); UI.toast(T('btnNoPress')); } }, 5000) };
  }

  function screen() {
    const rows = ACTS.map(([a, k, g]) => ({
      label: T(k), sub: T(g === 'player' ? 'btnInPlayer' : (a === 'ok' || a === 'back') ? 'btnAlso' : 'btnInLists'),
      value: () => label(map()[a]),
      action: (r, scr) => {
        const redraw = () => { if (scr && scr.v) scr.v.refresh(); };
        const pick = (b) => { set(a, b); redraw(); announce(T(k) + ': ' + label(b)); };
        UI.menu(T(k), [{ label: T('btnPressIt'), action: () => press(pick) }, { label: T('btnNone'), checked: !map()[a], action: () => pick('') }]
          .concat(CHOICES.concat(Object.keys(Store.prefs().btnNames || {}).filter((b) => CHOICES.indexOf(b) < 0)).map((b) => ({ label: label(b), checked: map()[a] === b, action: () => pick(b) }))), { focus: 0 });
      }
    }));
    rows.push({ label: T('btnReset'), icon: 'refresh', action: (r, scr) => { Store.setPref('btns', {}); if (scr && scr.v) scr.v.refresh(); UI.toast(T('btnResetDone')); } });
    return new ListScreen(T('btnTitle'), rows, { hints: [['a', T('hintOk')], ['b', T('hintBack')]] });
  }
  return { supported, actionFor, screen, listen, map, label, DEF };
})();
