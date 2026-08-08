(() => {
  const $ = id => document.getElementById(id);
  const hud = $("hud"), timeEl = $("time"), coreTask = $("coreTask"), coreState = $("coreState");
  const startBtn = $("startBtn"), resetBtn = $("resetBtn"), lapBtn = $("lapBtn"), dismissBtn = $("dismissBtn");
  const setter = $("setter"), presets = $("presets"), lapsEl = $("laps");
  const tabTimer = $("tab-timer"), tabWatch = $("tab-watch");
  const arc = $("arc"), orbiter = $("orbiter");
  const taskName = $("taskName"), taskChips = $("taskChips");

  /* ---------- ring geometry ---------- */
  const R = 88, CIRC = 2 * Math.PI * R;
  arc.style.strokeDasharray = CIRC;
  arc.style.strokeDashoffset = CIRC;
  // tick marks (60)
  const ticks = $("ticks");
  const tickEls = [];
  for(let i=0;i<60;i++){
    const a = i * 6 * Math.PI/180;
    const long = i % 5 === 0;
    const r1 = long ? 93 : 95, r2 = 98;
    const l = document.createElementNS("http://www.w3.org/2000/svg","line");
    l.setAttribute("x1", 100 + r1*Math.sin(a)); l.setAttribute("y1", 100 - r1*Math.cos(a));
    l.setAttribute("x2", 100 + r2*Math.sin(a)); l.setAttribute("y2", 100 - r2*Math.cos(a));
    ticks.appendChild(l);
    tickEls.push(l);
  }
  let litCount = -1;
  function setRing(frac){ // 0..1 filled
    frac = Math.min(1, Math.max(0, frac));
    arc.style.strokeDashoffset = CIRC * (1 - frac);
    const a = frac * 2 * Math.PI; // ring is rotated -90°, so angle from +x axis
    orbiter.setAttribute("cx", 100 + R * Math.cos(a));
    orbiter.setAttribute("cy", 100 + R * Math.sin(a));
    const n = Math.round(frac * 60);
    if(n !== litCount){
      litCount = n;
      tickEls.forEach((t,i) => t.classList.toggle("lit", i < n));
    }
  }

  /* ---------- state ---------- */
  let mode = "timer", running = false, raf = null;
  let setMs = 5*60000, remainMs = setMs, timerEnd = 0, focusMs = setMs;
  let watchStart = 0, watchAcc = 0, laps = [];

  /* ---------- task naming ---------- */
  const baseTitle = () => { const v = taskName.value.trim(); return (v ? v + " — " : "") + "CHRONO://CORE"; };
  function syncTask(){
    const v = taskName.value.trim();
    coreTask.textContent = v || "UNNAMED SESSION";
    if(!running) document.title = baseTitle();
    [...taskChips.children].forEach(c =>
      c.classList.toggle("active", c.dataset.task.toUpperCase() === v.toUpperCase()));
  }
  taskName.addEventListener("input", syncTask);
  taskName.addEventListener("keydown", e => { if(e.key==="Enter") taskName.blur(); e.stopPropagation(); });
  taskChips.addEventListener("click", e => {
    const b = e.target.closest("[data-task]");
    if(!b) return;
    taskName.value = b.dataset.task;
    syncTask();
  });

  /* ---------- settings (persisted) ---------- */
  const SET_KEY = "chronocore.settings.v1";
  let settings = { vol: 80, muted: false, pomodoro: false, loop: false, notify: false, breakMin: 5 };
  try{ Object.assign(settings, JSON.parse(localStorage.getItem(SET_KEY)) || {}); }catch(e){}
  const saveSettings = () => { try{ localStorage.setItem(SET_KEY, JSON.stringify(settings)); }catch(e){} };

  /* ---------- audio / alarm ---------- */
  const alarmAudio = $("alarmAudio");
  let ac = null, synthTimer = null, ringing = false, usingSynth = false;

  function synthLoop(){
    if(!ac) ac = new (window.AudioContext||window.webkitAudioContext)();
    const play = () => {
      if(!ringing || !usingSynth) return;
      const t = ac.currentTime, vol = settings.muted ? 0 : (settings.vol/100)*0.14;
      [740, 1110, 1480].forEach((f,i) => {
        const o = ac.createOscillator(), g = ac.createGain();
        o.type = "sine"; o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t + i*0.03);
        g.gain.exponentialRampToValueAtTime(Math.max(0.0001,vol), t + i*0.03 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + i*0.03 + 0.25);
        o.connect(g).connect(ac.destination);
        o.start(t + i*0.03); o.stop(t + i*0.03 + 0.3);
      });
      synthTimer = setTimeout(play, 900);
    };
    play();
  }

  function startAlarm(){
    ringing = true; usingSynth = false;
    dismissBtn.classList.remove("hidden");
    alarmAudio.volume = settings.muted ? 0 : settings.vol/100;
    alarmAudio.currentTime = 0;
    const p = alarmAudio.play();
    if(p && p.catch){
      p.catch(() => { usingSynth = true; synthLoop(); }); // file missing / blocked → fallback chime
    }
    // if the file never loaded at all, also fall back
    if(alarmAudio.readyState === 0 && !alarmAudio.src.endsWith("ALARM.mp3")) { usingSynth = true; synthLoop(); }
  }

  function stopAlarm(){
    ringing = false; usingSynth = false;
    clearTimeout(synthTimer); synthTimer = null;
    try{ alarmAudio.pause(); alarmAudio.currentTime = 0; }catch(e){}
    hud.classList.remove("alarm");
    dismissBtn.classList.add("hidden");
  }
  alarmAudio.addEventListener("error", () => { if(ringing && !usingSynth){ usingSynth = true; synthLoop(); } });

  function previewAlarm(){ // one-shot test that stops itself
    stopAlarm();
    ringing = true; usingSynth = false;
    alarmAudio.loop = false;
    alarmAudio.volume = settings.muted ? 0 : settings.vol/100;
    alarmAudio.currentTime = 0;
    const p = alarmAudio.play();
    if(p && p.catch) p.catch(()=>{ usingSynth = true; synthLoop(); setTimeout(()=>{ringing=false;usingSynth=false;clearTimeout(synthTimer);}, 1200); });
    alarmAudio.onended = () => { ringing = false; alarmAudio.loop = true; };
    setTimeout(()=>{ if(usingSynth){ ringing=false; usingSynth=false; clearTimeout(synthTimer); } alarmAudio.loop = true; }, 3000);
  }

  /* ---------- desktop notification ---------- */
  function notifyDone(label){
    if(!settings.notify || !("Notification" in window) || Notification.permission !== "granted") return;
    try{ new Notification("⏱ " + label + " — complete", { body: "Your timer finished.", tag: "chronocore" }); }catch(e){}
  }

  /* ---------- wake lock (keep screen on while running) ---------- */
  let wakeLock = null;
  async function requestWake(){
    try{ if("wakeLock" in navigator) wakeLock = await navigator.wakeLock.request("screen"); }catch(e){}
  }
  function releaseWake(){ try{ wakeLock && wakeLock.release(); }catch(e){} wakeLock = null; }
  document.addEventListener("visibilitychange", () => { if(document.visibilityState==="visible" && running && mode==="timer") requestWake(); });

  /* ---------- formatting / render ---------- */
  const pad = n => String(n).padStart(2,"0");
  function renderTimer(ms){
    const t = Math.max(0, Math.ceil(ms/1000));
    const h = Math.floor(t/3600), m = Math.floor(t%3600/60), s = t%60;
    timeEl.innerHTML = (h>0 ? pad(h)+'<span class="sep">:</span>' : "") +
      pad(m) + '<span class="sep">:</span>' + pad(s);
  }
  function renderWatch(ms){
    const cs = Math.floor(ms/10)%100, s = Math.floor(ms/1000)%60, m = Math.floor(ms/60000);
    timeEl.innerHTML = pad(Math.min(m,99)) + '<span class="sep">:</span>' + pad(s) +
      '<span class="cs">.' + pad(cs) + '</span>';
  }
  const fmtWatch = ms => pad(Math.floor(ms/60000)) + ":" + pad(Math.floor(ms/1000)%60) + "." + pad(Math.floor(ms/10)%100);

  /* ---------- loop ---------- */
  function tick(){
    if(mode==="timer"){
      remainMs = timerEnd - performance.now();
      renderTimer(remainMs);
      setRing(1 - remainMs/setMs);
      document.title = "⏱ " + timeEl.textContent + " · " + (taskName.value.trim() || "TIMER");
      if(remainMs <= 0){ finishTimer(); return; }
    } else {
      const t = watchAcc + (performance.now() - watchStart);
      renderWatch(t);
      setRing((t % 60000) / 60000); // one orbit per minute
    }
    raf = requestAnimationFrame(tick);
  }

  /* Pomodoro cycle bookkeeping */
  let inBreak = false, roundCount = 0;

  function finishTimer(){
    running = false; document.body.classList.remove("running"); cancelAnimationFrame(raf); releaseWake();
    remainMs = 0; renderTimer(0); setRing(1);
    timeEl.classList.remove("blink-sep");
    const label = (inBreak ? "BREAK" : (taskName.value.trim() || "UNNAMED SESSION"));

    // log only real focus sessions, not breaks
    if(!inBreak){ recordRun(taskName.value.trim() || "UNNAMED SESSION", setMs); roundCount++; }

    notifyDone(label);

    // auto-continue modes
    if(settings.pomodoro){
      burst();
      hud.classList.add("alarm"); startAlarm();
      setTimeout(stopAlarm, 2500); // brief chime, then roll into next phase
      inBreak = !inBreak;
      const nextMs = inBreak ? settings.breakMin*60000 : focusMs;
      coreState.textContent = inBreak ? "BREAK · ROUND " + roundCount : "FOCUS · ROUND " + (roundCount+1);
      setTimeout(() => { setMs = nextMs; remainMs = nextMs; renderTimer(nextMs); autoStart(); }, 1500);
      return;
    }
    if(settings.loop){
      burst();
      hud.classList.add("alarm"); startAlarm();
      setTimeout(stopAlarm, 2500);
      setTimeout(() => { remainMs = setMs; renderTimer(setMs); autoStart(); }, 1500);
      return;
    }

    hud.classList.add("alarm");
    coreState.textContent = "MISSION COMPLETE";
    startBtn.textContent = "INITIATE";
    burst();
    startAlarm();
  }

  function autoStart(){
    if(mode!=="timer" || setMs<=0) return;
    timerEnd = performance.now() + remainMs;
    running = true; requestWake(); document.body.classList.add("running");
    timeEl.classList.add("blink-sep");
    startBtn.textContent = "HOLD";
    if(!settings.pomodoro) coreState.textContent = "COUNTDOWN ACTIVE";
    raf = requestAnimationFrame(tick);
  }

  /* ---------- controls ---------- */
  function startPause(){
    if(ringing){ stopAlarm(); }
    if(mode==="timer"){
      if(!running){
        if(remainMs <= 0) remainMs = setMs;
        if(setMs <= 0) return;
        if(!inBreak){ focusMs = setMs; }        // remember focus length for pomodoro
        maybeAskNotify();
        timerEnd = performance.now() + remainMs;
        running = true; requestWake(); document.body.classList.add("running");
        coreState.textContent = settings.pomodoro
          ? (inBreak ? "BREAK · ROUND " + roundCount : "FOCUS · ROUND " + (roundCount+1))
          : "COUNTDOWN ACTIVE";
        timeEl.classList.add("blink-sep");
        startBtn.textContent = "HOLD";
        raf = requestAnimationFrame(tick);
      } else {
        running = false; document.body.classList.remove("running"); cancelAnimationFrame(raf); releaseWake();
        coreState.textContent = "ON HOLD";
        timeEl.classList.remove("blink-sep");
        startBtn.textContent = "RESUME";
      }
    } else {
      if(!running){
        watchStart = performance.now(); running = true; document.body.classList.add("running");
        coreState.textContent = "ELAPSED TIME ACTIVE";
        startBtn.textContent = "HOLD";
        lapBtn.disabled = false;
        raf = requestAnimationFrame(tick);
      } else {
        running = false; document.body.classList.remove("running");
        watchAcc += performance.now() - watchStart;
        cancelAnimationFrame(raf);
        coreState.textContent = "ON HOLD";
        startBtn.textContent = "RESUME";
        lapBtn.disabled = true;
      }
    }
  }

  function reset(){
    stopAlarm(); running = false; document.body.classList.remove("running"); cancelAnimationFrame(raf); releaseWake();
    inBreak = false; roundCount = 0;
    timeEl.classList.remove("blink-sep");
    startBtn.textContent = "INITIATE";
    coreState.textContent = "STANDBY";
    document.title = baseTitle();
    if(mode==="timer"){ remainMs = setMs; renderTimer(remainMs); setRing(0); }
    else{ watchAcc = 0; laps = []; renderWatch(0); setRing(0); lapsEl.innerHTML=""; lapBtn.disabled = true; }
  }

  function addLap(){
    if(mode!=="watch" || !running) return;
    const total = watchAcc + (performance.now() - watchStart);
    const prev = laps.length ? laps[laps.length-1].total : 0;
    laps.push({ n: laps.length+1, split: total - prev, total });
    let best = 0, worst = 0;
    laps.forEach((l,i)=>{ if(l.split < laps[best].split) best=i; if(l.split > laps[worst].split) worst=i; });
    lapsEl.innerHTML = laps.map((l,i)=>{
      const cls = laps.length>1 ? (i===best?"best":i===worst?"worst":"") : "";
      return `<div class="lap ${cls}"><span class="n">LAP ${pad(l.n)}</span><span class="t">${fmtWatch(l.split)}</span><span>${fmtWatch(l.total)}</span></div>`;
    }).reverse().join("");
  }

  /* ---------- timer setting ---------- */
  function applySet(ms){
    setMs = Math.min(99*3600000+59*60000+59000, Math.max(0, ms));
    remainMs = setMs; renderTimer(remainMs); setRing(0);
    coreState.textContent = "STANDBY";
  }
  setter.addEventListener("click", e => {
    const b = e.target.closest("[data-adj]");
    if(!b || running || mode!=="timer") return;
    stopAlarm();
    const u = b.dataset.adj[0], d = parseInt(b.dataset.adj.slice(1),10);
    applySet(setMs + d * (u==="h"?3600000:u==="m"?60000:1000));
  });
  presets.addEventListener("click", e => {
    const b = e.target.closest("[data-min]");
    if(!b || running || mode!=="timer") return;
    stopAlarm();
    applySet(parseInt(b.dataset.min,10)*60000);
  });

  /* ---------- mode switch ---------- */
  function switchMode(m){
    if(m===mode) return;
    stopAlarm(); running = false; document.body.classList.remove("running"); cancelAnimationFrame(raf); releaseWake();
    inBreak = false; roundCount = 0;
    timeEl.classList.remove("blink-sep");
    document.title = baseTitle();
    mode = m;
    const isTimer = m==="timer";
    tabTimer.classList.toggle("active", isTimer);
    tabWatch.classList.toggle("active", !isTimer);
    tabTimer.setAttribute("aria-selected", isTimer);
    tabWatch.setAttribute("aria-selected", !isTimer);
    setter.classList.toggle("hidden", !isTimer);
    presets.classList.toggle("hidden", !isTimer);
    lapBtn.classList.toggle("hidden", isTimer);
    lapsEl.innerHTML = "";
    startBtn.textContent = "INITIATE";
    coreState.textContent = "STANDBY";
    if(isTimer){ remainMs = setMs; renderTimer(remainMs); setRing(0); }
    else{ watchAcc = 0; laps = []; renderWatch(0); setRing(0); lapBtn.disabled = true; }
  }
  tabTimer.addEventListener("click", () => switchMode("timer"));
  tabWatch.addEventListener("click", () => switchMode("watch"));

  /* ---------- theme color (presets + hue bar + exact picker) ---------- */
  const swatches = [...document.querySelectorAll(".swatch")];
  const hueBar = $("hueBar"), colorPick = $("colorPick");
  const hexRgb = h => [1,3,5].map(i=>parseInt(h.slice(i,i+2),16)).join(",");

  function hslToHex(h, s, l){
    s/=100; l/=100;
    const k = n => (n + h/30) % 12;
    const a = s * Math.min(l, 1-l);
    const f = n => l - a * Math.max(-1, Math.min(k(n)-3, Math.min(9-k(n), 1)));
    return "#" + [f(0),f(8),f(4)].map(x => Math.round(255*x).toString(16).padStart(2,"0")).join("");
  }
  function hexHue(hex){
    const [r,g,b] = [1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255);
    const mx = Math.max(r,g,b), mn = Math.min(r,g,b), d = mx-mn;
    if(!d) return 0;
    let h = mx===r ? ((g-b)/d)%6 : mx===g ? (b-r)/d+2 : (r-g)/d+4;
    return Math.round(((h*60)+360)%360);
  }

  function setLed(hex, btn){
    const rgb = hexRgb(hex), r = document.documentElement.style;
    r.setProperty("--neon", hex);
    r.setProperty("--neon-soft", `rgba(${rgb},.5)`);
    r.setProperty("--neon-faint", `rgba(${rgb},.12)`);
    r.setProperty("--neon-ghost", `rgba(${rgb},.05)`);
    swatches.forEach(s => s.classList.toggle("active", s===btn || (!btn && s.dataset.led.toLowerCase()===hex.toLowerCase())));
    colorPick.value = hex;
    hueBar.value = hexHue(hex);
    settings.accent = hex; saveSettings();
    try{ accentRGB = [1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)); }catch(e){}
  }
  swatches.forEach(s => s.addEventListener("click", () => setLed(s.dataset.led, s)));
  hueBar.addEventListener("input", () => setLed(hslToHex(+hueBar.value, 95, 58), null));
  colorPick.addEventListener("input", () => setLed(colorPick.value, null));

  /* ---------- keyboard ---------- */
  document.addEventListener("keydown", e => {
    if(e.repeat || e.target === taskName) return;
    if(e.code==="Space"){ e.preventDefault(); startPause(); }
    else if(e.key==="Escape"){ if(ringing){ stopAlarm(); coreState.textContent="STANDBY"; startBtn.textContent="INITIATE"; document.title=baseTitle(); } }
    else if(e.key==="r"||e.key==="R") reset();
    else if(e.key==="l"||e.key==="L") addLap();
    else if(e.key==="m"||e.key==="M"){ muteBtn.click(); }
    else if(e.key==="f"||e.key==="F"){ toggleFocus(); }
    else if(e.key>="1"&&e.key<="4"){ const s = swatches[e.key-1]; setLed(s.dataset.led, s); }
  });

  startBtn.addEventListener("click", startPause);
  resetBtn.addEventListener("click", reset);
  lapBtn.addEventListener("click", addLap);

  /* ---------- alarm settings + feature toggles ---------- */
  const muteBtn = $("muteBtn"), volEl = $("vol"), testBtn = $("testBtn");
  const tgPomodoro = $("tgPomodoro"), tgLoop = $("tgLoop"), tgNotify = $("tgNotify");

  function reflectSettings(){
    volEl.value = settings.vol;
    muteBtn.textContent = settings.muted ? "🔇" : "🔊";
    alarmAudio.muted = settings.muted;
    tgPomodoro.classList.toggle("on", settings.pomodoro);
    tgPomodoro.setAttribute("aria-checked", String(settings.pomodoro));
    tgLoop.classList.toggle("on", settings.loop);
    tgLoop.setAttribute("aria-checked", String(settings.loop));
    tgNotify.classList.toggle("on", settings.notify);
    tgNotify.setAttribute("aria-checked", String(settings.notify));
  }

  volEl.addEventListener("input", () => {
    settings.vol = +volEl.value; settings.muted = false;
    muteBtn.textContent = "🔊"; alarmAudio.muted = false; alarmAudio.volume = settings.vol/100;
    saveSettings();
  });
  muteBtn.addEventListener("click", () => {
    settings.muted = !settings.muted; alarmAudio.muted = settings.muted;
    muteBtn.textContent = settings.muted ? "🔇" : "🔊"; saveSettings();
  });
  testBtn.addEventListener("click", previewAlarm);
  dismissBtn.addEventListener("click", () => { stopAlarm(); coreState.textContent = "STANDBY"; startBtn.textContent = "INITIATE"; document.title = baseTitle(); });

  // Pomodoro and Loop are mutually exclusive
  tgPomodoro.addEventListener("click", () => {
    settings.pomodoro = !settings.pomodoro; if(settings.pomodoro) settings.loop = false;
    saveSettings(); reflectSettings();
  });
  tgLoop.addEventListener("click", () => {
    settings.loop = !settings.loop; if(settings.loop) settings.pomodoro = false;
    saveSettings(); reflectSettings();
  });
  tgNotify.addEventListener("click", () => {
    if(!settings.notify && "Notification" in window && Notification.permission !== "granted"){
      Notification.requestPermission().then(p => { settings.notify = (p==="granted"); saveSettings(); reflectSettings(); });
    } else { settings.notify = !settings.notify; saveSettings(); reflectSettings(); }
  });
  function maybeAskNotify(){
    if(settings.notify && "Notification" in window && Notification.permission === "default")
      Notification.requestPermission();
  }

  /* ---------- mission log (persistent history) ---------- */
  const LOG_KEY = "chronocore.log.v1";
  const logList = $("logList"), logCount = $("logCount");
  const statRuns = $("statRuns"), statTime = $("statTime"), statTop = $("statTop");
  const logBody = $("logBody"), toggleLog = $("toggleLog"), clearLog = $("clearLog");
  let history = [];

  function loadLog(){
    try{ history = JSON.parse(localStorage.getItem(LOG_KEY)) || []; }
    catch(e){ history = []; }   // storage blocked or corrupt → in-memory only
  }
  function saveLog(){
    try{ localStorage.setItem(LOG_KEY, JSON.stringify(history)); }catch(e){}
  }

  function durLabel(ms){
    const t = Math.round(ms/1000), h = Math.floor(t/3600), m = Math.floor(t%3600/60), s = t%60;
    if(h) return h + "h " + pad(m) + "m";
    if(m) return m + "m" + (s ? " " + pad(s) + "s" : "");
    return s + "s";
  }
  function whenLabel(ts){
    const d = new Date(ts), now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    const yest = new Date(now); yest.setDate(now.getDate()-1);
    const time = pad(d.getHours()) + ":" + pad(d.getMinutes());
    if(sameDay) return "TODAY · " + time;
    if(d.toDateString() === yest.toDateString()) return "YESTERDAY · " + time;
    return (d.getMonth()+1) + "/" + d.getDate() + " · " + time;
  }

  function recordRun(name, ms){
    history.unshift({ id: Date.now() + "-" + Math.random().toString(36).slice(2,6), name, ms, at: Date.now() });
    if(history.length > 100) history.length = 100;
    saveLog(); renderLog();
  }

  function renderLog(){
    const n = history.length;
    logCount.textContent = n + (n===1 ? " RUN" : " RUNS");
    // stats
    const totalMs = history.reduce((a,e)=>a+e.ms, 0);
    statRuns.textContent = n;
    statTime.textContent = n ? durLabel(totalMs) : "0m";
    if(n){
      const tally = {};
      history.forEach(e => tally[e.name] = (tally[e.name]||0) + e.ms);
      const top = Object.entries(tally).sort((a,b)=>b[1]-a[1])[0][0];
      statTop.textContent = top.length > 12 ? top.slice(0,11) + "…" : top;
    } else statTop.textContent = "—";
    // list
    if(!n){ logList.innerHTML = '<div class="log-empty">NO COMPLETED RUNS YET — FINISH A TIMER TO LOG IT</div>'; return; }
    logList.innerHTML = history.map(e => `
      <div class="entry" data-id="${e.id}">
        <div class="en" title="${e.name.replace(/"/g,'&quot;')}">${e.name.replace(/</g,'&lt;')}</div>
        <div class="ed">${durLabel(e.ms)}</div>
        <button class="ex" data-del="${e.id}" aria-label="Delete this entry" title="Delete">✕</button>
        <div class="et">${whenLabel(e.at)}</div>
      </div>`).join("");
  }

  logList.addEventListener("click", e => {
    const b = e.target.closest("[data-del]");
    if(!b) return;
    history = history.filter(x => x.id !== b.dataset.del);
    saveLog(); renderLog();
  });
  toggleLog.addEventListener("click", () => {
    const hidden = logBody.classList.toggle("hidden");
    toggleLog.textContent = hidden ? "SHOW" : "HIDE";
    toggleLog.setAttribute("aria-expanded", String(!hidden));
  });
  clearLog.addEventListener("click", () => {
    if(!history.length) return;
    if(confirm("Clear the entire mission log? This cannot be undone.")){
      history = []; saveLog(); renderLog();
    }
  });

  /* ---------- system clock ---------- */
  const clock = $("clock");
  function tickClock(){
    const d = new Date();
    clock.textContent = pad(d.getHours()) + ":" + pad(d.getMinutes());
  }
  tickClock(); setInterval(tickClock, 15000);

  /* ---------- backdrop: image/video background + ambient audio ---------- */
  const bgLayer = $("bgLayer"), bgMediaBtn = $("bgMediaBtn"), bgAudioBtn = $("bgAudioBtn");
  const bgAudioPlay = $("bgAudioPlay"), bgOpacity = $("bgOpacity"), bgClear = $("bgClear");
  const bgMediaFile = $("bgMediaFile"), bgAudioFile = $("bgAudioFile");
  const ambient = $("ambientAudio");
  let ambientWasPlaying = false, currentBgURL = null, currentAmbURL = null;

  // opacity slider (persisted in settings)
  if(typeof settings.bgOpacity !== "number") settings.bgOpacity = 50;
  function applyOpacity(){
    const v = settings.bgOpacity/100;                       // 0.05 … 1
    const r = document.documentElement.style;
    r.setProperty("--bg-opacity", v);                       // media brightness
    r.setProperty("--bg-tint", ((1 - v) * 0.6).toFixed(3)); // dark tint → 0 at max
    r.setProperty("--glass", (0.88 - 0.66*v).toFixed(3));   // panel glass → ~0.22 at max
    bgOpacity.value = settings.bgOpacity;
  }
  bgOpacity.addEventListener("input", () => {
    settings.bgOpacity = +bgOpacity.value; applyOpacity(); saveSettings();
  });

  // tiny IndexedDB wrapper (blobs are too big for localStorage)
  function mediaDB(){
    return new Promise((res, rej) => {
      const rq = indexedDB.open("chronocore-media", 1);
      rq.onupgradeneeded = () => rq.result.createObjectStore("files");
      rq.onsuccess = () => res(rq.result);
      rq.onerror = () => rej(rq.error);
    });
  }
  async function mediaPut(key, blob){
    try{
      const db = await mediaDB();
      await new Promise((res, rej) => {
        const tx = db.transaction("files","readwrite");
        tx.objectStore("files").put(blob, key);
        tx.oncomplete = res; tx.onerror = () => rej(tx.error);
      });
    }catch(e){ console.warn("backdrop not persisted:", e); }
  }
  async function mediaGet(key){
    try{
      const db = await mediaDB();
      return await new Promise((res, rej) => {
        const rq = db.transaction("files").objectStore("files").get(key);
        rq.onsuccess = () => res(rq.result || null);
        rq.onerror = () => rej(rq.error);
      });
    }catch(e){ return null; }
  }
  async function mediaDel(key){
    try{
      const db = await mediaDB();
      db.transaction("files","readwrite").objectStore("files").delete(key);
    }catch(e){}
  }

  function showBgBlob(blob){
    if(currentBgURL) URL.revokeObjectURL(currentBgURL);
    currentBgURL = URL.createObjectURL(blob);
    bgLayer.innerHTML = "";
    if(blob.type.startsWith("video/")){
      const v = document.createElement("video");
      v.src = currentBgURL; v.muted = true; v.loop = true; v.autoplay = true; v.playsInline = true;
      v.play().catch(()=>{});
      bgLayer.appendChild(v);
    } else {
      const im = document.createElement("img");
      im.src = currentBgURL; im.alt = "";
      bgLayer.appendChild(im);
    }
    bgLayer.classList.add("active");
    document.body.classList.add("has-bg");
    bgMediaBtn.classList.add("on");
    applyOpacity();
  }

  function setAmbientBlob(blob, autoplay){
    if(currentAmbURL) URL.revokeObjectURL(currentAmbURL);
    currentAmbURL = URL.createObjectURL(blob);
    ambient.src = currentAmbURL;
    ambient.volume = 0.6;
    bgAudioBtn.classList.add("on");
    bgAudioPlay.classList.remove("hidden");
    if(autoplay){ ambient.play().then(()=>{ bgAudioPlay.textContent = "❚❚"; }).catch(()=>{ bgAudioPlay.textContent = "▶"; }); }
  }

  bgMediaBtn.addEventListener("click", () => bgMediaFile.click());
  bgAudioBtn.addEventListener("click", () => bgAudioFile.click());

  bgMediaFile.addEventListener("change", () => {
    const f = bgMediaFile.files[0];
    if(!f) return;
    if(f.size > 120*1024*1024){ alert("File is quite large (>120 MB) — it may not persist between visits, but it will still display now."); }
    showBgBlob(f);
    mediaPut("bg", f);
    bgMediaFile.value = "";
  });
  bgAudioFile.addEventListener("change", () => {
    const f = bgAudioFile.files[0];
    if(!f) return;
    setAmbientBlob(f, true);
    mediaPut("ambient", f);
    bgAudioFile.value = "";
  });

  bgAudioPlay.addEventListener("click", () => {
    if(ambient.paused){ ambient.play().then(()=> bgAudioPlay.textContent = "❚❚").catch(()=>{}); }
    else { ambient.pause(); bgAudioPlay.textContent = "▶"; }
  });

  bgClear.addEventListener("click", () => {
    bgLayer.innerHTML = ""; bgLayer.classList.remove("active");
    document.body.classList.remove("has-bg");
    bgMediaBtn.classList.remove("on");
    ambient.pause(); ambient.removeAttribute("src"); ambient.load();
    bgAudioBtn.classList.remove("on");
    bgAudioPlay.classList.add("hidden"); bgAudioPlay.textContent = "▶";
    if(currentBgURL){ URL.revokeObjectURL(currentBgURL); currentBgURL = null; }
    if(currentAmbURL){ URL.revokeObjectURL(currentAmbURL); currentAmbURL = null; }
    mediaDel("bg"); mediaDel("ambient");
  });

  // duck ambient audio while alarm rings, restore after dismiss
  const _startAlarm = startAlarm, _stopAlarm = stopAlarm;
  startAlarm = function(){ ambientWasPlaying = !ambient.paused && ambient.src; if(ambientWasPlaying) ambient.pause(); _startAlarm(); };
  stopAlarm = function(){ _stopAlarm(); if(ambientWasPlaying){ ambient.play().catch(()=>{}); ambientWasPlaying = false; bgAudioPlay.textContent = "❚❚"; } };

  // restore saved backdrop on load (ambient loads paused — browsers require a click to start sound)
  (async () => {
    const bg = await mediaGet("bg");
    if(bg) showBgBlob(bg);
    const amb = await mediaGet("ambient");
    if(amb){ setAmbientBlob(amb, false); }
  })();

  /* ---------- ambient particles + completion burst ---------- */
  const starsCv = $("stars"), sctx = starsCv.getContext("2d");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let accentRGB = [34,216,255];     // updated by setLed
  let dots = [], sparks = [];

  function sizeStars(){
    starsCv.width = innerWidth * devicePixelRatio;
    starsCv.height = innerHeight * devicePixelRatio;
    sctx.setTransform(devicePixelRatio,0,0,devicePixelRatio,0,0);
  }
  function seedDots(){
    const n = Math.min(90, Math.floor(innerWidth * innerHeight / 22000));
    dots = Array.from({length:n}, () => ({
      x: Math.random()*innerWidth, y: Math.random()*innerHeight,
      r: .6 + Math.random()*1.6,
      vy: .08 + Math.random()*.25, vx: (Math.random()-.5)*.06,
      p: Math.random()*Math.PI*2, ps: .004 + Math.random()*.012
    }));
  }
  addEventListener("resize", () => { sizeStars(); seedDots(); });
  sizeStars(); seedDots();

  function burst(){
    if(reduceMotion) return;
    const rect = document.querySelector(".core").getBoundingClientRect();
    const cx = rect.left + rect.width/2, cy = rect.top + rect.height/2;
    for(let i=0;i<90;i++){
      const a = Math.random()*Math.PI*2, sp = 2 + Math.random()*6;
      sparks.push({ x:cx, y:cy, vx:Math.cos(a)*sp, vy:Math.sin(a)*sp, life:1, decay:.012+Math.random()*.02, r:1+Math.random()*2.2 });
    }
  }

  function drawStars(){
    sctx.clearRect(0,0,innerWidth,innerHeight);
    const [cr,cg,cb] = accentRGB;
    if(!reduceMotion){
      for(const d of dots){
        d.y -= d.vy; d.x += d.vx; d.p += d.ps;
        if(d.y < -4){ d.y = innerHeight + 4; d.x = Math.random()*innerWidth; }
        const tw = .25 + .55 * (0.5 + 0.5*Math.sin(d.p));
        sctx.fillStyle = `rgba(${cr},${cg},${cb},${(tw*.5).toFixed(3)})`;
        sctx.beginPath(); sctx.arc(d.x, d.y, d.r, 0, 7); sctx.fill();
      }
    }
    for(let i=sparks.length-1;i>=0;i--){
      const s = sparks[i];
      s.x += s.vx; s.y += s.vy; s.vx *= .97; s.vy = s.vy*.97 + .06; s.life -= s.decay;
      if(s.life <= 0){ sparks.splice(i,1); continue; }
      sctx.fillStyle = `rgba(${cr},${cg},${cb},${s.life.toFixed(3)})`;
      sctx.beginPath(); sctx.arc(s.x, s.y, s.r*s.life+0.4, 0, 7); sctx.fill();
    }
    requestAnimationFrame(drawStars);
  }
  if(!reduceMotion || true) requestAnimationFrame(drawStars); // sparks list stays empty w/ reduced motion

  /* ---------- focus mode + fullscreen ---------- */
  const focusBtn = $("focusBtn"), fsBtn = $("fsBtn");
  function toggleFocus(){
    const on = document.body.classList.toggle("focus-mode");
    focusBtn.classList.toggle("on", on);
  }
  focusBtn.addEventListener("click", toggleFocus);
  fsBtn.addEventListener("click", () => {
    if(document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen().catch(()=>{});
  });

  /* ---------- hide / show theme color options ---------- */
  const themeToggle = $("themeToggle"), themeControls = $("themeControls");
  function applyThemeHidden(){
    const hid = !!settings.themeHidden;
    themeControls.classList.toggle("collapsed", hid);
    themeToggle.classList.toggle("on", !hid);
    themeToggle.setAttribute("aria-expanded", String(!hid));
  }
  themeToggle.addEventListener("click", () => {
    settings.themeHidden = !settings.themeHidden;
    saveSettings(); applyThemeHidden();
  });

  /* ---------- init ---------- */
  renderTimer(setMs); setRing(0); syncTask(); lapBtn.disabled = true;
  loadLog(); renderLog(); reflectSettings(); applyOpacity();
  if(settings.accent) setLed(settings.accent, null);
  applyThemeHidden();
})();
