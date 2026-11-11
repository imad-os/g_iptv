# Speedy IPTV for My PC

Moved here from imad-os/speedy (folder `mypc/`) on 2026-11-11.

The IPTV app as an app installed on **My PC** (github.com/imad-os/g), Samsung TVs 2024+.

- Xtream Codes and M3U playlists; lists of tens of thousands of channels / films / shows in a virtual list
  (a fixed pool of nodes, pictures only once the list rests, parsing in a worker, a copy kept on the TV).
- Plays on the TV's own player (Samsung AVPlay) through My PC (`MyPC.video`, API 17): the picture sits on the
  video plane behind the page; in a browser it falls back to `<video>` + hls.js.
- USB films and TV shows (`MyPC.usb`): films / shows / folders, clean names, next episode, subtitle files next
  to the video (`.srt .vtt .ass .ssa .sub`, `Movie.ar.srt`, a `Subs/` folder), Continue watching.
- Subtitles found online (through the Cloudflare Worker iptv-lists.mypc-app.workers.dev), Arabic Windows-1256 files, style, delay.
- One theme for the app and the player (Settings > Theme).
- Remote: OK, Back, arrows, CH + / CH −, Play / Pause and the media keys; controllers: B OK, A back, X favorite,
  Y search, + options, L / R page.

## Install
Turn on GitHub Pages for this repo (Settings > Pages: branch `main`, folder `/`), then in My PC's App Store Manager add the app
with the address `https://imad-os.github.io/g_iptv/`; `mypc-app.json` describes it.

## Tests
- `node tests/run.mjs` (Playwright, Chromium; needs ffmpeg for the test videos): the app in a browser.
  `SPEEDY_SHOTS=<folder>` saves screenshots, `SPEEDY_ONLY=main|ar|m3u` runs one part.
- Inside My PC (TV player, USB drive, the remote's keys, My PC's keyboard): with this repo cloned next to My PC's (`../g_iptv`, or `SPEEDY_DIR`), in My PC's checkout
  `MYPC_ONLY=speedy node tests/run-tests.mjs`.
