/* Small helpers shared by every part of Speedy. */
'use strict';
const $ = (id) => document.getElementById(id);
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined && text !== null) e.textContent = text; return e; }
function clear(e) { while (e.firstChild) e.removeChild(e.firstChild); return e; }
function pad2(n) { return n < 10 ? '0' + n : '' + n; }
function fmtTime(s) {
  s = Math.max(0, Math.floor(+s || 0));
  const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = s % 60;
  return h ? h + ':' + pad2(m) + ':' + pad2(x) : m + ':' + pad2(x);
}
function fmtClock(d) { d = d || new Date(); return pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }
function fmtDate(ms) { try { return new Date(ms).toLocaleDateString(LANG === 'ar' ? 'ar-MA' : LANG, { year: 'numeric', month: 'short', day: 'numeric' }); } catch (e) { return new Date(ms).toDateString(); } }
function fmtSize(b) { if (!(b > 0)) return ''; const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; while (b >= 1024 && i < 4) { b /= 1024; i++; } return (b >= 100 || i === 0 ? Math.round(b) : b.toFixed(1)) + ' ' + u[i]; }
function debounce(fn, ms) { let t = 0; const d = function () { const a = arguments; clearTimeout(t); t = setTimeout(() => fn.apply(null, a), ms); }; d.cancel = () => clearTimeout(t); return d; }
function initials(name) {
  const w = String(name || '').replace(/[^\p{L}\p{N} ]+/gu, ' ').trim().split(/\s+/);
  return ((w[0] || '?')[0] + (w[1] ? w[1][0] : '')).toUpperCase();
}
// a key for comparing names: lower case, no accents, no punctuation (search, A to Z)
function fold(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}
const collator = (typeof Intl !== 'undefined' && Intl.Collator) ? new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }) : null;
function natCmp(a, b) { return collator ? collator.compare(a, b) : (a < b ? -1 : a > b ? 1 : 0); }
function hash(s) { let h = 2166136261; s = String(s); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }
function svg(name) { return '<svg viewBox="0 0 24 24" aria-hidden="true"><use href="#i-' + name + '"/></svg>'; }
function idle(fn) { return (window.requestIdleCallback || ((f) => setTimeout(f, 16)))(fn); }
function ext(name) { const m = /\.([a-z0-9]{1,5})$/i.exec(name || ''); return m ? m[1].toLowerCase() : ''; }
function stripExt(name) { return String(name || '').replace(/\.[a-z0-9]{1,5}$/i, ''); }
function announce(t) { try { if (window.MyPC && MyPC.announce) MyPC.announce(t); } catch (e) {} }
function report(e, data) { try { if (window.MyPC && MyPC.report) MyPC.report(e, data); } catch (x) {} }
