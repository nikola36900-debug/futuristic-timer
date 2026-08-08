# CHRONO://CORE — Futuristic Task Timer

## Files
- index.html   — page structure (open this in your browser)
- style.css    — all styling and themes
- script.js    — timer, stopwatch, history, alarm, backdrop logic
- ALARM.mp3    — YOUR alarm sound (add it yourself, same folder)

## Setup in VS Code
1. Put all files in one folder.
2. Add your ALARM.mp3 to the same folder (exact name, all caps).
3. Open index.html in a browser — or better, use the Live Server
   extension so desktop notifications and screen wake-lock also work.

## Keyboard shortcuts
SPACE run/hold · R reset · L lap · ESC dismiss alarm · M mute
F focus mode · 1–4 preset colors

## Notes
- History, settings, theme color, and backdrops are saved in the
  browser (localStorage + IndexedDB) per folder/origin.
- If ALARM.mp3 is missing, a built-in synth chime plays instead.
