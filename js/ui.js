/* Screens, menus, dialogs and the toast. Input arrives as simple actions from app.js:
 *   up down left right (with repeat) · ok (OK let go) · hold (OK held 0.6 s) · back · fav (X) · search (Y) · menu (+)
 *   pageUp pageDown (CH + / CH -, L / R) · playPause ff rew next prev stop (remote media keys)
 * The top screen (or the open menu / dialog) gets them. MyPC.back(true) is set whenever Back has something to close here, so
 * the remote's Back only opens My PC's menu on the home screen. */
'use strict';
const UI = (() => {
  const stack = [], modals = [];
  let toastT = 0;

  function syncBack() { try { MyPC.back(stack.length > 1 || modals.length > 0); } catch (e) {} }
  function top() { return stack[stack.length - 1] || null; }
  function push(s) {
    const t = top();
    if (t) { if (t.hide) t.hide(); t.root.classList.remove('on'); }
    stack.push(s);
    s.root.classList.add('on');
    if (s.show) s.show(true);
    syncBack();
  }
  // the screen below is shown again BEFORE the closed one is destroyed (the player puts its picture back into a box of it)
  function pop() {
    const s = stack.pop();
    if (!s) return;
    s.root.classList.remove('on');
    const t = top();
    if (t) t.root.classList.add('on');
    if (s.hide) s.hide();
    if (s.destroy) s.destroy();
    if (t && t.show) t.show(false);
    syncBack();
  }
  function popTo(s) { while (stack.length > 1 && top() !== s) pop(); }
  function replace(s) { const old = stack.pop(); if (old) { old.root.classList.remove('on'); if (old.hide) old.hide(); if (old.destroy) old.destroy(); } push(s); }
  function input(a, repeat) {
    const m = modals[modals.length - 1];
    if (m) return m.input(a, repeat);
    const t = top();
    if (!t) return;
    if (a === 'back' && t.input(a, repeat) !== true && stack.length > 1) { pop(); return; }
    if (a !== 'back') t.input(a, repeat);
  }

  /* ---------- a menu: a title and a list of choices (OK runs it; Back closes) ---------- */
  function menu(title, items, opts) {
    opts = opts || {};
    const ov = el('div', 'overlay'), box = el('div', 'menu');
    box.setAttribute('role', 'dialog');
    if (title) box.appendChild(el('h2', '', title));
    const lb = el('div', '');
    box.appendChild(lb);
    const H = 88, rows = Math.min(items.length, opts.rows || 8);
    lb.style.height = rows * H + 'px';
    $('root').appendChild(ov); $('root').appendChild(box);
    const v = new VList(lb, { itemH: H, render(i, n) {
      const it = items[i];
      if (!n.__v) { n.__v = el('div', 'li'); n.appendChild(n.__v); n.__v.style.margin = '0 0 10px'; }
      const r = n.__v;
      r.innerHTML = '';
      const nm = el('div', 'nm', it.label);
      if (it.sub) nm.appendChild(el('small', '', it.sub));
      r.appendChild(nm);
      if (it.value !== undefined) r.appendChild(el('div', 'val', it.value));
      if (it.checked) { const c = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); c.setAttribute('viewBox', '0 0 24 24'); c.setAttribute('class', 'ck'); c.innerHTML = '<use href="#i-check"/>'; r.appendChild(c); }
    }, onFocus(i) { announce(items[i].label + (items[i].value !== undefined ? ', ' + items[i].value : '') + (items[i].checked ? ', ' + T('on') : '')); if (opts.onFocus) opts.onFocus(i, items[i]); } });
    let start = Math.max(0, items.findIndex((x) => x.checked));
    if (opts.focus !== undefined) start = opts.focus;
    v.setCount(items.length, start);
    v.active(true);
    const m = {
      v, items,
      input(a, repeat) {
        if (a === 'up' || a === 'down') { v.move(a); return; }
        if (a === 'pageUp' || a === 'pageDown') { v.page(a === 'pageUp' ? -1 : 1); return; }
        if (a === 'back' || (a === 'menu' && !repeat) || (a === 'left' && opts.leftCloses)) { close(); if (opts.onClose) opts.onClose(); return; }
        if (a === 'ok') {
          const it = items[v.index];
          if (!it || it.disabled) return;
          if (!it.stay) close();
          if (it.action) it.action(it, m);
        }
        if (opts.onKey) opts.onKey(a, items[v.index], m);
      },
      refresh(newItems) { if (newItems) { items = newItems; m.items = newItems; v.setCount(newItems.length); } v.refresh(); },
      close
    };
    function close() { const i = modals.indexOf(m); if (i >= 0) modals.splice(i, 1); v.destroy(); ov.remove(); box.remove(); syncBack(); }
    modals.push(m);
    syncBack();
    announce((title ? title + '. ' : '') + (items[v.index] ? items[v.index].label : ''));
    return m;
  }

  /* ---------- a question with buttons ---------- */
  function dialog(title, text, buttons, opts) {
    opts = opts || {};
    const ov = el('div', 'overlay'), box = el('div', 'dialog'), acts = el('div', 'acts');
    box.setAttribute('role', 'alertdialog');
    box.appendChild(el('h2', '', title));
    if (text) box.appendChild(el('p', '', text));
    box.appendChild(acts);
    const bs = buttons.map((b, i) => { const x = el('button', 'btn' + (b.primary ? ' primary' : '') + (b.danger ? ' danger' : ''), b.label); acts.appendChild(x); return x; });
    $('root').appendChild(ov); $('root').appendChild(box);
    let f = Math.max(0, buttons.findIndex((b) => b.focus));
    const paint = () => bs.forEach((b, i) => b.classList.toggle('f', i === f));
    paint();
    const m = {
      input(a) {
        const rtl = document.documentElement.dir === 'rtl';
        if (a === 'left' || a === 'right') { f = Math.max(0, Math.min(bs.length - 1, f + ((a === 'right') !== rtl ? 1 : -1))); paint(); announce(buttons[f].label); }
        else if (a === 'ok') { close(); if (buttons[f].action) buttons[f].action(); }
        else if (a === 'back') { close(); if (opts.onBack) opts.onBack(); }
      },
      close
    };
    function close() { const i = modals.indexOf(m); if (i >= 0) modals.splice(i, 1); ov.remove(); box.remove(); syncBack(); }
    modals.push(m);
    syncBack();
    announce(title + '. ' + (text || '') + ' ' + buttons[f].label);
    return m;
  }
  function confirm(title, text, yes, onYes) {
    return dialog(title, text, [{ label: T('cancel') }, { label: yes || T('yes'), primary: true, focus: true, action: onYes }]);
  }
  function alert(title, text, then) { return dialog(title, text, [{ label: T('ok'), primary: true, focus: true, action: then }], { onBack: then }); }

  // a small box that waits on top (a download); Back runs onCancel
  function busy(text, onCancel) {
    const ov = el('div', 'overlay'), box = el('div', 'loading'), lab = el('div', '', text), pb = el('div', 'pb'), bar = el('i');
    box.appendChild(el('div', 'spin')); box.appendChild(lab); pb.appendChild(bar); box.appendChild(pb);
    pb.style.display = 'none';
    ov.style.background = 'rgba(0,0,0,.35)';
    $('root').appendChild(ov); $('root').appendChild(box);
    const m = {
      input(a) { if (a === 'back' && onCancel) { close(); onCancel(); } },
      text(t) { lab.textContent = t; },
      progress(p) { pb.style.display = p >= 0 ? '' : 'none'; bar.style.width = Math.round(p * 100) + '%'; },
      close
    };
    function close() { const i = modals.indexOf(m); if (i >= 0) modals.splice(i, 1); ov.remove(); box.remove(); syncBack(); }
    modals.push(m);
    syncBack();
    announce(text);
    return m;
  }

  function toast(text, ms) {
    const t = $('toast');
    t.textContent = text;
    t.classList.add('on');
    clearTimeout(toastT);
    toastT = setTimeout(() => t.classList.remove('on'), ms || 2600);
    announce(text);
  }

  // A B X Y + hints, drawn in the theme: [['b', 'OK'], ['a', 'Back'], ['x', 'Favorite']...]
  function hints(box, list) {
    clear(box);
    for (const h of list) {
      const s = el('span'), k = el('span', 'k ' + h[0] + (h[0] === 'ch' ? ' sq' : ''), h[0] === 'plus' ? '+' : h[0] === 'ch' ? 'CH' : h[0] === 'lr' ? 'L R' : h[0].toUpperCase());
      s.appendChild(k); s.appendChild(document.createTextNode(h[1]));
      box.appendChild(s);
    }
  }
  function modalOpen() { return modals.length > 0; }
  function closeModals() { while (modals.length) modals[modals.length - 1].close(); }

  return { push, pop, popTo, replace, top, input, menu, dialog, confirm, alert, busy, toast, hints, stack: () => stack, syncBack, modalOpen, closeModals };
})();

/* A screen made of rows (Settings, Playlists, category manager...): each row { label, sub, value() , icon, action(row), hold(row) } */
class ListScreen {
  constructor(title, rows, o) {
    this.o = o || {};
    this.root = el('section', 'screen');
    this.root.innerHTML = '<div class="top"><div class="crumb"></div><div class="grow"></div><div class="clock"></div></div><div class="page"><h1></h1><div class="lb" style="position:absolute;left:160px;right:160px;top:96px;bottom:0"></div></div><div class="hints"></div>';
    this.root.querySelector('.crumb').innerHTML = '<b></b>';
    this.root.querySelector('.crumb b').textContent = T('appName');
    this.root.querySelector('h1').textContent = title;
    $('screens').appendChild(this.root);
    this.rows = rows;
    this.v = new VList(this.root.querySelector('.lb'), { itemH: 100, render: (i, n) => this.draw(i, n), onFocus: (i) => announce(this.say(i)) });
    UI.hints(this.root.querySelector('.hints'), this.o.hints || [['b', T('hintOk')], ['a', T('hintBack')]]);
  }
  say(i) { const r = this.rows[i]; if (!r) return ''; const v = typeof r.value === 'function' ? r.value() : r.value; return r.label + (v ? ', ' + v : ''); }
  draw(i, n) {
    const r = this.rows[i];
    if (!n.__v) { n.__v = el('div', 'li'); n.appendChild(n.__v); }
    const b = n.__v;
    b.innerHTML = '';
    b.className = 'li' + (r.cur ? ' cur' : '');
    if (r.icon) b.insertAdjacentHTML('beforeend', svg(r.icon));
    if (r.swatch) { const s = el('div', 'swatch'); s.style.background = r.swatch; b.appendChild(s); }
    const nm = el('div', 'nm', r.label);
    if (r.sub) nm.appendChild(el('small', '', typeof r.sub === 'function' ? r.sub() : r.sub));
    b.appendChild(nm);
    const v = typeof r.value === 'function' ? r.value() : r.value;
    if (v !== undefined && v !== null && v !== '') b.appendChild(el('div', 'val', v));
  }
  setRows(rows, focus) { this.rows = rows; this.v.setCount(rows.length, focus); }
  show(first) { if (first) this.v.setCount(this.rows.length, 0); this.v.active(true); this.v.refresh(); if (this.o.onShow) this.o.onShow(this); }
  hide() { this.v.active(false); }
  destroy() { this.v.destroy(); this.root.remove(); }
  input(a, repeat) {
    if (a === 'up' || a === 'down') { this.v.move(a); return; }
    if (a === 'pageUp' || a === 'pageDown') { this.v.page(a === 'pageUp' ? -1 : 1); return; }
    const r = this.rows[this.v.index];
    if (a === 'ok' && r && r.action) { r.action(r, this); this.v.refreshIndex(this.v.index); announce(this.say(this.v.index)); return; }
    if ((a === 'hold' || a === 'menu') && r && r.hold) { r.hold(r, this); return; }
    if ((a === 'left' || a === 'right') && r && r.side) { r.side(a, r, this); this.v.refreshIndex(this.v.index); announce(this.say(this.v.index)); return; }
    if (a === 'back') return false;
  }
}
