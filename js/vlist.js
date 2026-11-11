/* The long-list view: thousands of channels or posters with only what is on screen in the page.
 *
 * A fixed pool of nodes (the visible rows + 2 spare rows) is laid out with transforms on one moving layer (the camera).
 * Index i always uses node pool[i % pool.length], so scrolling needs no lookup tables, no new nodes and no garbage. Only
 * the rows that came into view are filled again. While the list moves fast (a held arrow, CH + / CH -) items are filled
 * with their text only; pictures are asked for once it rests (150 ms), so a held key never waits for images.
 *
 *   const v = new VList(box, { cols, itemH, itemW (horizontal), horizontal, render(i, node, full), onFocus(i), onEdge(dir) })
 *   v.setCount(n, focusIndex)   v.move(dir) -> true when it moved   v.page(+1 | -1)   v.focus(i)   v.active(on)
 *   v.refresh()   v.refreshIndex(i)   v.layout()   v.destroy()   v.index   v.count */
'use strict';
class VList {
  constructor(box, o) {
    this.box = box;
    this.o = Object.assign({ cols: 1, itemH: 80, itemW: 0, horizontal: false, spare: 2, margin: 1 }, o || {});
    this.count = 0; this.index = 0; this.cam = 0; this.isActive = false;
    this.pool = []; this.raf = 0; this.restT = 0; this.moving = false; this.dead = false;
    box.classList.add('vl');
    clear(box);
    this.layer = el('div', 'cam');
    box.appendChild(this.layer);
    this.bar = el('div', 'sbar'); this.thumb = el('i'); this.bar.appendChild(this.thumb); box.appendChild(this.bar);
    this.layout();
  }
  layout() {
    const r = this.box.getBoundingClientRect(), s = this.scale();
    this.vw = r.width / s || this.box.clientWidth; this.vh = r.height / s || this.box.clientHeight;
    const o = this.o;
    if (o.horizontal) { this.cols = 1; this.cw = o.itemW; this.rh = this.vh; this.vis = Math.ceil(this.vw / o.itemW) + 1; }
    else { this.cols = Math.max(1, o.cols); this.cw = this.vw / this.cols; this.rh = o.itemH; this.vis = Math.ceil(this.vh / o.itemH) + 1; }
    const want = (this.vis + o.spare * 2) * this.cols;
    while (this.pool.length < want) {
      const n = el('div', 'vi');
      n.__i = -1;
      n.style.display = 'none';
      this.layer.appendChild(n);
      this.pool.push(n);
    }
    // a pool that changed size: every node shows its index again
    for (const n of this.pool) { n.__i = -1; n.style.width = (o.horizontal ? o.itemW : this.cw) + 'px'; n.style.height = this.rh + 'px'; }
    this.view = o.horizontal ? Math.max(1, Math.floor(this.vw / o.itemW)) : Math.max(1, Math.floor(this.vh / this.rh));
    this.clamp(); this.schedule(true);
  }
  // #root is scaled to the window: rectangles come scaled, sizes are in design pixels
  scale() { const r = document.getElementById('root'); const m = r && /scale\(([\d.]+)/.exec(r.style.transform || ''); return m ? +m[1] : 1; }
  rows() { return Math.ceil(this.count / this.cols); }
  setCount(n, focus) {
    this.count = Math.max(0, n | 0);
    this.index = Math.max(0, Math.min(this.count - 1, focus === undefined ? this.index : focus | 0));
    if (this.count === 0) this.index = 0;
    for (const p of this.pool) p.__i = -1;
    this.cam = 0;
    this.clamp(true);
    this.schedule(true);
  }
  active(on) { this.isActive = !!on; this.schedule(false); }
  // keep the focused row in view with one row of margin
  clamp(center) {
    const row = Math.floor(this.index / this.cols), size = this.rh, view = this.view, m = Math.min(this.o.margin, Math.floor((view - 1) / 2));
    const total = this.o.horizontal ? this.count : this.rows();
    let first = Math.round(this.cam / (this.o.horizontal ? this.o.itemW : size));
    if (center) first = row - Math.floor(view / 2);
    if (row < first + m) first = row - m;
    if (row > first + view - 1 - m) first = row - view + 1 + m;
    first = Math.max(0, Math.min(first, Math.max(0, total - view)));
    this.cam = first * (this.o.horizontal ? this.o.itemW : size);
  }
  move(dir) {
    if (!this.count) return false;
    const c = this.cols, h = this.o.horizontal, i = this.index;
    let n = i;
    if (h) { if (dir === 'left') n = i - 1; else if (dir === 'right') n = i + 1; else return false; if (document.documentElement.dir === 'rtl') n = dir === 'left' ? i + 1 : i - 1; }
    else if (dir === 'up') n = i - c;
    else if (dir === 'down') { n = i + c; if (n >= this.count && Math.floor(i / c) < this.rows() - 1) n = this.count - 1; }
    else if (c > 1 && (dir === 'left' || dir === 'right')) {
      const rtl = document.documentElement.dir === 'rtl', back = (dir === 'left') !== rtl;
      if (back) { if (i % c === 0) return false; n = i - 1; } else { if (i % c === c - 1 || i + 1 >= this.count) return false; n = i + 1; }
    } else return false;
    if (n < 0 || n >= this.count) return false;
    this.focus(n);
    return true;
  }
  page(d) {
    if (!this.count) return;
    const step = this.view * this.cols;
    this.focus(Math.max(0, Math.min(this.count - 1, this.index + d * step)));
  }
  focus(i) {
    if (!this.count) return;
    i = Math.max(0, Math.min(this.count - 1, i | 0));
    const changed = i !== this.index;
    this.index = i;
    this.clamp();
    this.moving = true;
    clearTimeout(this.restT);
    this.restT = setTimeout(() => { this.moving = false; this.schedule(true); }, 150);
    this.schedule(false);
    if (changed && this.o.onFocus) this.o.onFocus(i);
  }
  refresh() { for (const p of this.pool) p.__i = -1; this.schedule(true); }
  refreshIndex(i) { const p = this.pool[i % this.pool.length]; if (p && p.__i === i) { p.__i = -1; this.schedule(!this.moving); } }
  schedule(full) {
    if (full) this.wantFull = true;
    if (this.raf || this.dead) return;
    this.raf = requestAnimationFrame(() => { this.raf = 0; this.draw(); });
  }
  draw() {
    // built while its screen was hidden (no size yet): measure now that it shows
    if ((!this.vh || !this.vw) && this.box.clientHeight) { this.layout(); this.clamp(true); }
    const o = this.o, h = o.horizontal, size = h ? o.itemW : this.rh, full = this.wantFull && !this.moving;
    this.wantFull = false;
    const first = Math.max(0, Math.floor(this.cam / size) - o.spare);
    const last = Math.min((h ? this.count : this.rows()) - 1, Math.floor(this.cam / size) + this.vis + o.spare - 1);
    const rtl = document.documentElement.dir === 'rtl';
    this.layer.style.transform = h ? 'translate3d(' + (rtl ? this.cam : -this.cam) + 'px,0,0)' : 'translate3d(0,' + (-this.cam) + 'px,0)';
    const N = this.pool.length;
    for (let r = first; r <= last; r++) {
      for (let c = 0; c < this.cols; c++) {
        const i = r * this.cols + c;
        if (i >= this.count) break;
        const n = this.pool[i % N];
        if (n.__i !== i) {
          n.__i = i; n.__full = false;
          let x = h ? r * o.itemW : c * this.cw;
          if (rtl) x = (h ? this.vw - o.itemW - x : this.vw - this.cw - x);
          n.style.transform = 'translate3d(' + x + 'px,' + (h ? 0 : r * this.rh) + 'px,0)';
          n.style.display = '';
          o.render(i, n, full);
          n.__full = full;
        } else if (full && !n.__full) { o.render(i, n, true); n.__full = true; }
        const f = this.isActive && i === this.index;
        if (n.__f !== f) { n.__f = f; n.classList.toggle('f', f); }
      }
    }
    // nodes whose index is no longer in the window (end of the list)
    for (let k = 0; k < N; k++) {
      const n = this.pool[k];
      if (n.__i < 0) { if (n.style.display !== 'none') n.style.display = 'none'; continue; }
      const row = Math.floor(n.__i / this.cols);
      if (n.__i >= this.count || row < first || row > last) { n.style.display = 'none'; n.__i = -1; if (n.__f) { n.__f = false; n.classList.remove('f'); } }
    }
    // scroll bar
    const total = h ? this.count : this.rows();
    if (total > this.view && !h) {
      this.bar.style.display = '';
      const bh = Math.max(40, this.vh * this.view / total), max = this.vh - bh, top = max * (this.cam / size) / Math.max(1, total - this.view);
      this.thumb.style.height = bh + 'px';
      this.thumb.style.transform = 'translateY(' + top + 'px)';
    } else this.bar.style.display = 'none';
  }
  node(i) { const n = this.pool[i % this.pool.length]; return n && n.__i === i ? n : null; }
  destroy() { this.dead = true; cancelAnimationFrame(this.raf); clearTimeout(this.restT); clear(this.box); this.pool = []; }
}
