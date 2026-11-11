/* Web requests and pictures.
 * Inside My PC every request goes through MyPC.net: IPTV servers send no CORS headers and are mostly http, which an https
 * page cannot reach. Standalone (opened in a browser) it is the browser's fetch. */
'use strict';
const Net = (() => {
  function hosted() { try { return MyPC.isHosted() && MyPC.apiLevel >= 10; } catch (e) { return false; } }
  function err(code, msg, status) { const e = new Error(msg || code); e.code = code; if (status) e.status = status; return e; }

  // { type: 'text' | 'json' | 'arraybuffer', timeout, method, headers, json } -> { ok, status, body }; an abort() on the promise
  function get(url, o) {
    o = o || {};
    const type = o.type || 'text', timeout = o.timeout || 30000;
    if (hosted()) {
      const req = MyPC.net.fetch(url, { method: o.method || 'GET', headers: o.headers, json: o.json, responseType: type === 'json' ? 'text' : type, timeout });
      const p = req.then((r) => {
        let body = r.body;
        if (type === 'json') { try { body = JSON.parse(typeof body === 'string' ? body : new TextDecoder().decode(body)); } catch (e) { throw err('bad-data', 'Not JSON'); } }
        return { ok: r.ok, status: r.status, body, url: r.url };
      }, (e) => { throw err(e.code || 'network', e.message, e.status); });
      p.abort = () => { try { req.abort(); } catch (e) {} };
      return p;
    }
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    let timer = 0;
    const p = new Promise((res, rej) => {
      timer = setTimeout(() => { if (ctl) ctl.abort(); rej(err('timeout', 'No answer')); }, timeout);
      fetch(url, { method: o.method || 'GET', headers: o.json ? Object.assign({ 'Content-Type': 'application/json' }, o.headers || {}) : o.headers,
                   body: o.json ? JSON.stringify(o.json) : undefined, signal: ctl ? ctl.signal : undefined, cache: 'no-store' })
        .then(async (r) => {
          let body;
          if (type === 'arraybuffer') body = await r.arrayBuffer();
          else { body = await r.text(); if (type === 'json') { try { body = JSON.parse(body); } catch (e) { throw err('bad-data', 'Not JSON'); } } }
          clearTimeout(timer);
          res({ ok: r.ok, status: r.status, body, url: r.url });
        }, (e) => { clearTimeout(timer); rej(err(e && e.name === 'AbortError' ? 'cancelled' : 'network', String(e && e.message || e))); })
        .catch((e) => { clearTimeout(timer); rej(e.code ? e : err('network', String(e))); });
    });
    p.abort = () => { clearTimeout(timer); if (ctl) ctl.abort(); };
    return p;
  }

  /* Pictures (posters, logos): at most 6 at a time, the newest asked first (what is on screen now); http pictures inside My
   * PC are read through MyPC.net and shown from a blob (an https page cannot show http pictures). A small memory of the
   * last 260 keeps scrolling back free; older blobs are released. */
  const MAX = 6, KEEP = 260;
  const done = new Map();            // url -> objectURL | url | '' (failed)
  const wait = [];                    // [{ url, cb }]
  let running = 0;
  function needsProxy(url) { return hosted() && /^http:\/\//i.test(url); }
  function remember(url, v) {
    done.set(url, v);
    if (done.size > KEEP) {
      const k = done.keys().next().value, old = done.get(k);
      done.delete(k);
      if (old && old.indexOf('blob:') === 0) { try { URL.revokeObjectURL(old); } catch (e) {} }
    }
  }
  function pump() {
    while (running < MAX && wait.length) {
      const job = wait.pop();
      if (job.dead) continue;
      if (done.has(job.url)) { job.cb(done.get(job.url)); continue; }
      running++;
      const finish = (v) => { running--; remember(job.url, v); if (!job.dead) job.cb(v); pump(); };
      if (needsProxy(job.url)) {
        get(job.url, { type: 'arraybuffer', timeout: 15000 }).then((r) => {
          if (!r.ok || !r.body || !r.body.byteLength) return finish('');
          finish(URL.createObjectURL(new Blob([r.body])));
        }, () => finish(''));
      } else {
        const im = new Image();
        im.decoding = 'async';
        im.onload = () => finish(job.url);
        im.onerror = () => finish('');
        im.src = job.url;
      }
    }
  }
  // cb(url | '') once ready; returns a ticket with cancel()
  function image(url, cb) {
    url = String(url || '').trim();
    if (!/^https?:\/\//i.test(url) && !/^blob:|^data:/.test(url)) { cb(''); return { cancel() {} }; }
    if (done.has(url)) { const v = done.get(url); done.delete(url); done.set(url, v); cb(v); return { cancel() {} }; }
    const job = { url, cb, dead: false };
    wait.push(job);
    if (wait.length > 80) wait.splice(0, wait.length - 80).forEach((j) => { j.dead = true; });
    pump();
    return { cancel() { job.dead = true; } };
  }
  function imageNow(url) { const v = done.get(String(url || '').trim()); return v === undefined ? null : v; }

  return { get, image, imageNow, hosted, err };
})();
