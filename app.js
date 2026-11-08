(function () {
  'use strict';

  // ================= Programm (aus deiner Excel) =================
  // type: 'reps' = kg × Wdh. · 'bw' = Körpergewicht + Zusatz-kg (0 zählt als 1 kg) · 'time' = Sekunden
  const DEFAULT_EXERCISES = {
    leghold:   { name: 'Leg Hold', type: 'time' },
    plank:     { name: 'Plank', type: 'time' },
    revcrunch: { name: 'Reverse Crunches', type: 'bw' },
    sidebend:  { name: 'Roman Side Bends', type: 'bw' },
    romanext:  { name: 'Roman Extensions', type: 'bw' },
    pullups:   { name: 'Pull-Ups – Wide Overhand Grip', type: 'bw' },
    dips:      { name: 'Dips', type: 'bw' },
    squats:    { name: 'Squats', type: 'reps' },
    farmers:   { name: 'Farmers Walk', type: 'reps' },
    incline:   { name: 'Incline Bench', type: 'reps' },
    rowscable: { name: 'Rows Cable close grip', type: 'reps' },
    lateral:   { name: 'Lateral raises', type: 'reps' },
    rdl:       { name: 'RDL', type: 'reps' },
    tbar:      { name: 'Chest supported T bar row', type: 'reps' }
  };
  const DEFAULT_WORKOUTS = [
    { id: 't1', name: 'Tag 1', exercises: ['leghold', 'plank', 'revcrunch', 'sidebend', 'romanext', 'pullups', 'dips', 'squats', 'farmers', 'incline', 'rowscable', 'lateral'] },
    { id: 't2', name: 'Tag 2', exercises: ['leghold', 'plank', 'revcrunch', 'sidebend', 'romanext', 'pullups', 'dips', 'rdl', 'incline', 'tbar'] }
  ];
  const WORKOUT_COLORS = ['var(--t1)', 'var(--t2)', '#a78bfa', '#2dd4bf'];
  const STORE_KEY = 'gymlog.v1';

  // ================= Zustand =================
  let state = load();
  let tab = 'train';
  let metric = 'vol';
  let rest = null;        // { end, total, overAt }
  let stopwatch = null;   // { e, s, start }
  let audioCtx = null;
  let wakeLock = null;

  function freshState() {
    return {
      version: 1,
      settings: { bodyweight: 83, rest: 90, lastExport: null },
      exercises: JSON.parse(JSON.stringify(DEFAULT_EXERCISES)),
      workouts: JSON.parse(JSON.stringify(DEFAULT_WORKOUTS)),
      sessions: (window.GYM_SEED || []).map(s => JSON.parse(JSON.stringify(s))),
      active: null
    };
  }
  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* ignorieren */ }
    return freshState();
  }
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
    catch (e) { toast('Speichern fehlgeschlagen!'); }
  }
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

  // ================= Helfer =================
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = v => { if (v === '' || v === null || v === undefined) return NaN; return parseFloat(String(v).replace(',', '.')); };
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const pad = n => String(n).padStart(2, '0');
  const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const parseDate = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const dateStr = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
  const fmtDate = s => { const d = parseDate(s); return `${WD[d.getDay()]} ${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`; };
  const fmtDateShort = s => { const d = parseDate(s); return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.`; };
  function isoWeek(d) {
    const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const day = t.getUTCDay() || 7;
    t.setUTCDate(t.getUTCDate() + 4 - day);
    const y = t.getUTCFullYear();
    return { year: y, week: Math.ceil(((t - Date.UTC(y, 0, 1)) / 86400000 + 1) / 7) };
  }
  function mondayOfIsoWeek(year, week) {
    const jan4 = new Date(year, 0, 4);
    const day = jan4.getDay() || 7;
    const mon = new Date(year, 0, 4 - day + 1);
    mon.setDate(mon.getDate() + (week - 1) * 7);
    return mon;
  }
  const fmtSec = s => { s = Math.round(s); return `${Math.floor(s / 60)}:${pad(s % 60)}`; };
  const fmtNum = (v, dec = 1) => {
    if (!isFinite(v)) return '–';
    const r = Math.round(v * 10 ** dec) / 10 ** dec;
    return r.toLocaleString('de-DE', { maximumFractionDigits: dec });
  };
  const exName = id => (state.exercises[id] || { name: id }).name;
  const exType = id => (state.exercises[id] || { type: 'reps' }).type;
  const workoutById = id => state.workouts.find(w => w.id === id);
  const workoutColor = id => WORKOUT_COLORS[Math.max(0, state.workouts.findIndex(w => w.id === id)) % WORKOUT_COLORS.length];
  const sortedSessions = () => [...state.sessions].sort((a, b) => a.date.localeCompare(b.date) || (a.end || 0) - (b.end || 0));

  function toast(msg) {
    const t = document.createElement('div');
    t.className = 'toast'; t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2200);
  }

  function setText(set, type) {
    if (type === 'time') return fmtSec(set.sec);
    if (type === 'bw') return (set.kg > 0 ? `+${fmtNum(set.kg)}` : 'KG') + `×${set.reps}`;
    return `${fmtNum(set.kg)}×${set.reps}`;
  }

  // ================= Navigation =================
  $('#tabbar').addEventListener('click', e => {
    const b = e.target.closest('button[data-tab]');
    if (!b) return;
    tab = b.dataset.tab;
    document.querySelectorAll('#tabbar button').forEach(x => x.classList.toggle('active', x === b));
    render();
    window.scrollTo(0, 0);
  });

  function render() {
    if (tab === 'train') state.active ? renderActive() : renderStart();
    else if (tab === 'progress') renderProgress();
    else renderData();
  }

  // ================= Training: Start =================
  function lastSessionOf(wid) {
    const list = sortedSessions().filter(s => s.workout === wid);
    return list[list.length - 1] || null;
  }

  function renderStart() {
    $('#topbar').innerHTML = `<h1>Training</h1>`;
    const cards = state.workouts.map(w => {
      const last = lastSessionOf(w.id);
      let meta = `${w.exercises.length} Übungen`;
      if (last) {
        const days = Math.round((parseDate(todayStr()) - parseDate(last.date)) / 86400000);
        meta += ` · zuletzt ${fmtDate(last.date)}` + (days === 0 ? ' (heute)' : days === 1 ? ' (gestern)' : ` (vor ${days} Tagen)`);
      }
      return `<button class="start-card" data-act="start" data-w="${w.id}">
        <span class="dot" style="background:${workoutColor(w.id)}"></span>
        <span><h2>${esc(w.name)}</h2><div class="meta">${meta}</div></span>
        <span class="go">Start ›</span>
      </button>`;
    }).join('');
    const recent = sortedSessions().slice(-4).reverse();
    $('#view').innerHTML = `<div class="start-grid">${cards}</div>
      ${recent.length ? `<div class="section-title">Letzte Trainings</div>
      <div class="panel">${recent.map(historyItem).join('')}</div>` : ''}`;
  }

  // ================= Training: aktives Workout =================
  function startWorkout(wid) {
    const w = workoutById(wid);
    const last = lastSessionOf(wid);
    const entries = w.exercises.map(ex => {
      const type = exType(ex);
      const prev = last && last.entries.find(en => en.ex === ex);
      let sets;
      if (prev && prev.sets.length) {
        sets = prev.sets.map(s => type === 'time'
          ? { sec: String(s.sec), done: false }
          : { kg: s.kg ? String(s.kg).replace('.', ',') : (type === 'bw' ? '0' : ''), reps: String(s.reps), done: false });
      } else {
        sets = Array.from({ length: type === 'time' ? 2 : 3 }, () => type === 'time' ? { sec: '', done: false } : { kg: type === 'bw' ? '0' : '', reps: '', done: false });
      }
      return { ex, sets, prev: prev ? prev.sets : null, prevDate: prev ? last.date : null };
    });
    state.active = { workout: wid, start: Date.now(), entries };
    save();
    requestWakeLock();
    render();
    window.scrollTo(0, 0);
  }

  function activeCounts() {
    let done = 0, total = 0;
    for (const en of state.active.entries) for (const s of en.sets) { total++; if (s.done) done++; }
    return { done, total };
  }

  function updateActiveHeader() {
    if (!state.active || tab !== 'train') return;
    const sub = $('#topbar .sub');
    if (!sub) return;
    const { done, total } = activeCounts();
    sub.textContent = `${fmtSec((Date.now() - state.active.start) / 1000)} · ${done}/${total} Sätze`;
  }

  function renderActive() {
    const w = workoutById(state.active.workout);
    $('#topbar').innerHTML = `
      <button class="btn sm" data-act="cancel">Abbrechen</button>
      <div style="flex:1;text-align:center"><h1 style="font-size:17px">${esc(w ? w.name : 'Workout')}</h1><div class="sub"></div></div>
      <button class="btn sm ok" data-act="finish">Fertig</button>`;
    updateActiveHeader();
    $('#view').innerHTML = state.active.entries.map((_, i) => cardHTML(i)).join('') +
      `<p class="small muted" style="text-align:center;margin:16px 0 24px">Nur Sätze mit grünem Haken werden gespeichert.</p>`;
  }

  const ICON_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  const ICON_PLAY = '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>';
  const ICON_STOP = '<svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>';

  function cardHTML(i) {
    const en = state.active.entries[i];
    const type = exType(en.ex);
    const done = en.sets.filter(s => s.done).length;
    const complete = en.sets.length > 0 && done === en.sets.length;
    const last = en.prev ? `Letztes Mal (${fmtDateShort(en.prevDate)}): ${en.prev.map(s => setText(s, type)).join(' · ')}` : 'Noch keine Daten';
    const tag = type === 'time' ? '<span class="tag">Zeit</span>' : type === 'bw' ? '<span class="tag">Körpergewicht</span>' : '';
    const head = type === 'time'
      ? `<div class="set-head time"><span></span><span style="text-align:center">Sekunden</span><span></span><span></span></div>`
      : `<div class="set-head"><span></span><span style="text-align:center">${type === 'bw' ? '+ kg' : 'kg'}</span><span style="text-align:center">Wdh.</span><span></span></div>`;
    const rows = en.sets.map((s, j) => {
      const cls = `set${type === 'time' ? ' time' : ''}${s.done ? ' done' : ''}`;
      if (type === 'time') {
        const running = stopwatch && stopwatch.e === i && stopwatch.s === j;
        return `<div class="${cls}">
          <span class="n">${j + 1}</span>
          <input inputmode="numeric" pattern="[0-9]*" data-e="${i}" data-s="${j}" data-f="sec" value="${esc(s.sec)}" placeholder="0">
          <button class="sw${running ? ' running' : ''}" data-act="sw" data-e="${i}" data-s="${j}" aria-label="Stoppuhr">${running ? ICON_STOP : ICON_PLAY}</button>
          <button class="check" data-act="check" data-e="${i}" data-s="${j}" aria-label="Satz abhaken">${ICON_CHECK}</button>
        </div>`;
      }
      return `<div class="${cls}">
        <span class="n">${j + 1}</span>
        <input inputmode="decimal" data-e="${i}" data-s="${j}" data-f="kg" value="${esc(s.kg)}" placeholder="0">
        <input inputmode="numeric" pattern="[0-9]*" data-e="${i}" data-s="${j}" data-f="reps" value="${esc(s.reps)}" placeholder="0">
        <button class="check" data-act="check" data-e="${i}" data-s="${j}" aria-label="Satz abhaken">${ICON_CHECK}</button>
      </div>`;
    }).join('');
    return `<section class="ex${complete ? ' complete' : ''}" data-i="${i}">
      <div class="ex-head"><h3>${esc(exName(en.ex))}</h3>${tag}<span class="count">${done}/${en.sets.length}</span></div>
      <div class="last">${esc(last)}</div>
      ${head}${rows}
      <div class="ex-actions">
        <button class="btn sm" data-act="delset" data-e="${i}">− Satz</button>
        <button class="btn sm" data-act="addset" data-e="${i}">+ Satz</button>
      </div>
    </section>`;
  }

  function rerenderCard(i) {
    const el = document.querySelector(`.ex[data-i="${i}"]`);
    if (el) el.outerHTML = cardHTML(i);
    updateActiveHeader();
  }

  function toggleCheck(i, j) {
    const en = state.active.entries[i];
    const s = en.sets[j];
    const type = exType(en.ex);
    if (!s.done) {
      if (stopwatch && stopwatch.e === i && stopwatch.s === j) stopStopwatch();
      if (type === 'time') {
        if (!(num(s.sec) > 0)) { toast('Bitte Sekunden eintragen'); return; }
      } else {
        if (!(num(s.reps) > 0)) { toast('Bitte Wiederholungen eintragen'); return; }
        if (type === 'reps' && isNaN(num(s.kg))) { toast('Bitte Gewicht eintragen'); return; }
      }
      s.done = true;
      startRest();
    } else {
      s.done = false;
    }
    save();
    rerenderCard(i);
  }

  function addSet(i) {
    const en = state.active.entries[i];
    const type = exType(en.ex);
    const lastSet = en.sets[en.sets.length - 1];
    const s = type === 'time'
      ? { sec: lastSet ? lastSet.sec : '', done: false }
      : { kg: lastSet ? lastSet.kg : (type === 'bw' ? '0' : ''), reps: lastSet ? lastSet.reps : '', done: false };
    en.sets.push(s);
    save(); rerenderCard(i);
  }
  function delSet(i) {
    const en = state.active.entries[i];
    if (!en.sets.length) return;
    if (stopwatch && stopwatch.e === i && stopwatch.s === en.sets.length - 1) stopwatch = null;
    en.sets.pop();
    save(); rerenderCard(i);
  }

  // ---- Stoppuhr ----
  function toggleStopwatch(i, j) {
    if (stopwatch && stopwatch.e === i && stopwatch.s === j) { stopStopwatch(); return; }
    if (stopwatch) stopStopwatch();
    stopwatch = { e: i, s: j, start: Date.now() };
    unlockAudio();
    rerenderCard(i);
  }
  function stopStopwatch() {
    const { e, s, start } = stopwatch;
    stopwatch = null;
    const set = state.active && state.active.entries[e] && state.active.entries[e].sets[s];
    if (set) set.sec = String(Math.round((Date.now() - start) / 1000));
    save(); rerenderCard(e);
  }
  function tickStopwatch() {
    if (!stopwatch) return;
    const inp = document.querySelector(`input[data-e="${stopwatch.e}"][data-s="${stopwatch.s}"][data-f="sec"]`);
    if (inp) inp.value = Math.floor((Date.now() - stopwatch.start) / 1000);
  }

  // ---- Pausen-Timer ----
  function startRest() {
    unlockAudio();
    const total = Math.max(5, +state.settings.rest || 90);
    rest = { end: Date.now() + total * 1000, total, beeped: false };
    renderRest();
  }
  function renderRest() {
    const el = $('#rest');
    if (!rest || !state.active) { el.classList.add('hidden'); return; }
    const left = (rest.end - Date.now()) / 1000;
    if (left <= 0 && !rest.beeped) { rest.beeped = true; beep(); }
    if (left < -4) { rest = null; el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    el.classList.toggle('over', left <= 0);
    const pct = Math.max(0, Math.min(1, left / rest.total)) * 100;
    if (!el.firstChild) {
      el.innerHTML = `<div><div class="lbl">Pause</div><div class="time"></div></div><span class="sp"></span>
        <button class="btn sm" data-rest="-15">−15</button><button class="btn sm" data-rest="15">+15</button>
        <button class="btn sm" data-rest="skip">Weiter</button><div class="bar"></div>`;
    }
    el.querySelector('.time').textContent = left > 0 ? fmtSec(Math.ceil(left)) : 'Los!';
    el.querySelector('.bar').style.width = pct + '%';
  }
  $('#rest').addEventListener('click', e => {
    const b = e.target.closest('[data-rest]');
    if (!b || !rest) return;
    const v = b.dataset.rest;
    if (v === 'skip') { rest = null; }
    else { rest.end += (+v) * 1000; rest.total = Math.max(rest.total, (rest.end - Date.now()) / 1000); rest.beeped = false; }
    renderRest();
  });

  function unlockAudio() {
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
    } catch (e) { /* kein Audio */ }
  }
  function beep() {
    if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
    if (!audioCtx) return;
    const t0 = audioCtx.currentTime;
    [0, 0.25, 0.5].forEach((d, k) => {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.frequency.value = k === 2 ? 1320 : 880;
      g.gain.setValueAtTime(0.0001, t0 + d);
      g.gain.exponentialRampToValueAtTime(0.4, t0 + d + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + d + 0.18);
      o.connect(g).connect(audioCtx.destination);
      o.start(t0 + d); o.stop(t0 + d + 0.2);
    });
  }

  async function requestWakeLock() {
    try { if ('wakeLock' in navigator && state.active) wakeLock = await navigator.wakeLock.request('screen'); } catch (e) { /* egal */ }
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { requestWakeLock(); renderRest(); }
  });

  setInterval(() => { updateActiveHeader(); renderRest(); }, 500);
  setInterval(tickStopwatch, 200);

  // ---- Beenden ----
  function finishDialog() {
    const { done } = activeCounts();
    openModal(`<h2>Workout beenden?</h2>
      <p>${done} Sätze abgehakt. Sätze ohne grünen Haken werden verworfen.</p>
      <label class="small muted">Datum</label>
      <input type="date" id="fin-date" value="${todayStr()}">
      <div class="btns">
        <button class="btn ok block" data-m="save">Speichern</button>
        <button class="btn block" data-m="close">Weiter trainieren</button>
      </div>`, act => {
      if (act === 'save') {
        const date = $('#fin-date').value || todayStr();
        if (stopwatch) stopStopwatch();
        const entries = state.active.entries.map(en => {
          const type = exType(en.ex);
          const sets = en.sets.filter(s => s.done).map(s => type === 'time'
            ? { sec: Math.round(num(s.sec)) }
            : { kg: isNaN(num(s.kg)) ? 0 : num(s.kg), reps: Math.round(num(s.reps)) });
          return { ex: en.ex, sets };
        }).filter(en => en.sets.length);
        if (!entries.length) { toast('Kein Satz abgehakt – nichts gespeichert'); }
        else {
          state.sessions.push({ id: uid(), workout: state.active.workout, date, start: state.active.start, end: Date.now(), entries });
          toast('Workout gespeichert 💪');
        }
        state.active = null; rest = null; stopwatch = null;
        if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
        save(); closeModal(); render(); renderRest();
      } else closeModal();
    });
  }
  function cancelDialog() {
    openModal(`<h2>Workout abbrechen?</h2><p>Alle Eingaben dieses Workouts gehen verloren.</p>
      <div class="btns"><button class="btn block danger" data-m="yes">Ja, verwerfen</button>
      <button class="btn block" data-m="close">Zurück</button></div>`, act => {
      if (act === 'yes') { state.active = null; rest = null; stopwatch = null; save(); render(); renderRest(); }
      closeModal();
    });
  }

  // ================= Modal =================
  let modalCb = null;
  function openModal(html, cb) {
    modalCb = cb;
    $('#modal').innerHTML = `<div class="sheet">${html}</div>`;
    $('#modal').classList.remove('hidden');
  }
  function closeModal() { $('#modal').classList.add('hidden'); $('#modal').innerHTML = ''; modalCb = null; }
  $('#modal').addEventListener('click', e => {
    if (e.target.id === 'modal') { closeModal(); return; }
    const b = e.target.closest('[data-m]');
    if (b && modalCb) modalCb(b.dataset.m);
  });

  // ================= Events in der Ansicht =================
  function onAction(e) {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act, i = +b.dataset.e, j = +b.dataset.s;
    switch (act) {
      case 'start': startWorkout(b.dataset.w); break;
      case 'check': toggleCheck(i, j); break;
      case 'addset': addSet(i); break;
      case 'delset': delSet(i); break;
      case 'sw': toggleStopwatch(i, j); break;
      case 'finish': finishDialog(); break;
      case 'cancel': cancelDialog(); break;
      case 'metric': metric = b.dataset.v; renderProgress(); break;
      case 'export': exportExcel(); break;
      case 'import': $('#file').click(); break;
      case 'delsession': deleteSession(b.dataset.id); break;
      case 'reset': resetDialog(); break;
    }
  }
  $('#view').addEventListener('click', onAction);
  $('#topbar').addEventListener('click', onAction);

  $('#view').addEventListener('input', e => {
    const t = e.target;
    if (t.dataset.f && state.active) {
      const s = state.active.entries[+t.dataset.e].sets[+t.dataset.s];
      s[t.dataset.f] = t.value;
      save();
    } else if (t.dataset.setting) {
      const v = num(t.value);
      if (isFinite(v) && v > 0) { state.settings[t.dataset.setting] = v; save(); }
    }
  });
  // Feldinhalt beim Antippen markieren, damit man direkt überschreiben kann
  $('#view').addEventListener('focusin', e => {
    if (e.target.matches('.set input')) setTimeout(() => { try { e.target.select(); } catch (x) {} }, 0);
  });

  // ================= Fortschritt / Diagramme =================
  const METRICS = [
    { id: 'vol', label: 'Volumen' },
    { id: 'max', label: 'Max kg' },
    { id: 'e1rm', label: '1RM' },
    { id: 'reps', label: 'Wdh.' }
  ];

  function entryValue(entry, type, m) {
    const sets = entry.sets;
    if (!sets.length) return NaN;
    if (type === 'time') return sets.reduce((a, s) => a + (s.sec || 0), 0);
    const bw = +state.settings.bodyweight || 0;
    const eff = s => type === 'bw' ? Math.max(1, s.kg || 0) : (s.kg || 0);
    switch (m) {
      case 'vol': return sets.reduce((a, s) => a + eff(s) * s.reps, 0);
      case 'max': return Math.max(...sets.map(s => s.kg || 0));
      case 'e1rm': return Math.max(...sets.map(s => {
        const load = type === 'bw' ? bw + (s.kg || 0) : (s.kg || 0);
        return s.reps <= 1 ? load : load * (1 + s.reps / 30);
      }));
      case 'reps': return sets.reduce((a, s) => a + s.reps, 0);
    }
    return NaN;
  }
  function metricLabel(type, m) {
    if (type === 'time') return 'Gesamtzeit';
    if (m === 'vol') return type === 'bw' ? 'Volumen (Körpergewicht = 1 kg)' : 'Volumen (kg × Wdh.)';
    if (m === 'max') return type === 'bw' ? 'Max. Zusatzgewicht' : 'Schwerster Satz';
    if (m === 'e1rm') return type === 'bw' ? `Geschätztes 1RM inkl. ${fmtNum(state.settings.bodyweight)} kg Körpergewicht` : 'Geschätztes 1RM (Epley)';
    return 'Wiederholungen gesamt';
  }
  const fmtVal = (v, type, m) => type === 'time' ? fmtSec(v) : m === 'vol' || m === 'reps' ? fmtNum(v, 0) : fmtNum(v, 1);

  function renderProgress() {
    $('#topbar').innerHTML = `<h1>Fortschritt</h1>`;
    const sessions = sortedSessions();
    if (!sessions.length) { $('#view').innerHTML = `<div class="empty">Noch keine Trainings gespeichert.</div>`; return; }
    const order = [];
    state.workouts.forEach(w => w.exercises.forEach(ex => { if (!order.includes(ex)) order.push(ex); }));
    sessions.forEach(s => s.entries.forEach(en => { if (!order.includes(en.ex)) order.push(en.ex); }));

    const t0 = parseDate(sessions[0].date).getTime();
    const t1 = parseDate(sessions[sessions.length - 1].date).getTime();
    const domain = t0 === t1 ? [t0 - 3.5 * 864e5, t1 + 3.5 * 864e5] : [t0 - 864e5, t1 + 864e5];

    const cards = order.map(ex => {
      const type = exType(ex);
      const series = state.workouts.map(w => ({
        w, pts: sessions.filter(s => s.workout === w.id).map(s => {
          const en = s.entries.find(e => e.ex === ex);
          return en ? { t: parseDate(s.date).getTime(), v: entryValue(en, type, metric), date: s.date } : null;
        }).filter(p => p && isFinite(p.v))
      })).filter(s => s.pts.length);
      if (!series.length) return '';
      const stats = series.map(s => {
        const last = s.pts[s.pts.length - 1], prev = s.pts[s.pts.length - 2];
        let delta = '';
        if (prev) {
          const d = last.v - prev.v;
          const txt = type === 'time' ? `${d >= 0 ? '+' : '−'}${Math.abs(d) < 60 ? Math.abs(Math.round(d)) + ' s' : fmtSec(Math.abs(d))}` :`${d >= 0 ? '+' : '−'}${fmtVal(Math.abs(d), type, metric)}`;
          delta = ` <span class="${d > 0 ? 'up' : d < 0 ? 'down' : 'muted'}">${d === 0 ? '±0' : txt}</span>`;
        }
        return `<span class="s"><i style="background:${workoutColor(s.w.id)}"></i>${esc(s.w.name)}: <b>${fmtVal(last.v, type, metric)}</b>${delta}</span>`;
      }).join('');
      return `<div class="chart-card">
        <h3>${esc(exName(ex))}</h3>
        <div class="small muted" style="margin:0 4px">${esc(metricLabel(type, metric))}</div>
        <div class="chart-stats">${stats}</div>
        ${chartSVG(series, domain, type)}
      </div>`;
    }).join('');

    $('#view').innerHTML = `<div class="seg">${METRICS.map(m => `<button data-act="metric" data-v="${m.id}" class="${metric === m.id ? 'on' : ''}">${m.label}</button>`).join('')}</div>
      ${cards}
      <p class="small muted" style="text-align:center">Tippe auf einen Punkt für den genauen Wert.</p>`;
  }

  function niceStep(range, n) {
    const raw = range / n, mag = 10 ** Math.floor(Math.log10(raw)), f = raw / mag;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * mag;
  }

  function chartSVG(series, domain, type) {
    const W = 340, H = 170, L = 40, R = 12, T = 12, B = 24;
    const vals = series.flatMap(s => s.pts.map(p => p.v));
    let lo = Math.min(...vals), hi = Math.max(...vals);
    if (lo === hi) { const d = Math.abs(lo) * 0.2 || 1; lo -= d; hi += d; }
    const pad = (hi - lo) * 0.15; lo -= pad; hi += pad;
    if (Math.min(...vals) >= 0 && lo < 0) lo = 0;
    const step = type === 'time'
      ? ([5, 10, 15, 20, 30, 60, 120, 300, 600].find(s => (hi - lo) / s <= 5) || 900)
      : niceStep(hi - lo, 4);
    lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step;
    const x = t => L + (t - domain[0]) / (domain[1] - domain[0]) * (W - L - R);
    const y = v => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);

    let g = '';
    for (let v = lo; v <= hi + step / 2; v += step) {
      g += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/>`;
      g += `<text class="axis" x="${L - 6}" y="${y(v) + 3}" text-anchor="end">${type === 'time' ? fmtSec(v) : fmtNum(v, step < 1 ? 1 : 0)}</text>`;
    }
    // KW-Beschriftung
    const weeks = [];
    let d = new Date(domain[0]);
    const iw = isoWeek(d);
    let mon = mondayOfIsoWeek(iw.year, iw.week);
    while (mon.getTime() <= domain[1]) {
      const mid = mon.getTime() + 3 * 864e5;
      if (mid >= domain[0] && mid <= domain[1]) weeks.push({ t: mid, w: isoWeek(mon).week });
      mon = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + 7);
    }
    const every = Math.ceil(weeks.length / 6) || 1;
    weeks.forEach((wk, k) => {
      if (k % every) return;
      g += `<text class="axis" x="${x(wk.t)}" y="${H - 6}" text-anchor="middle">KW ${wk.w}</text>`;
    });

    let lines = '', hits = '';
    series.forEach(s => {
      const col = workoutColor(s.w.id);
      const path = s.pts.map((p, k) => `${k ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join('');
      lines += `<path d="${path}" fill="none" stroke="${col}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`;
      s.pts.forEach(p => {
        lines += `<circle cx="${x(p.t)}" cy="${y(p.v)}" r="3.5" fill="${col}" stroke="var(--surface)" stroke-width="1.5"/>`;
        const tip = `${s.w.name} · ${fmtDateShort(p.date)} · ${fmtVal(p.v, type, metric)}`;
        hits += `<circle class="hit" cx="${x(p.t)}" cy="${y(p.v)}" r="14" fill="transparent" data-tip="${esc(tip)}"/>`;
      });
    });
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img">${g}${lines}${hits}<g class="tipg"></g></svg>`;
  }

  $('#view').addEventListener('click', e => {
    const svg = e.target.closest('svg.chart');
    if (!svg) return;
    const tipg = svg.querySelector('.tipg');
    const hit = e.target.closest('.hit');
    if (!hit) { tipg.innerHTML = ''; return; }
    const cx = +hit.getAttribute('cx'), cy = +hit.getAttribute('cy');
    const text = hit.dataset.tip;
    const w = text.length * 5.8 + 14, h = 20;
    let tx = Math.min(Math.max(cx - w / 2, 2), 340 - w - 2);
    let ty = cy - h - 10; if (ty < 0) ty = cy + 10;
    tipg.innerHTML = `<rect class="tip-bg" x="${tx}" y="${ty}" width="${w}" height="${h}" rx="6"/>
      <text class="tip" x="${tx + w / 2}" y="${ty + 14}" text-anchor="middle">${esc(text)}</text>`;
  });

  // ================= Daten =================
  function historyItem(s) {
    const w = workoutById(s.workout);
    const nSets = s.entries.reduce((a, e) => a + e.sets.length, 0);
    return `<details class="hist">
      <summary><span class="dot" style="background:${workoutColor(s.workout)}"></span>
        <span class="d"><b>${esc(w ? w.name : s.workout)}</b> · ${fmtDate(s.date)}</span>
        <span class="small muted">${nSets} Sätze</span></summary>
      <ul>${s.entries.map(en => `<li><b>${esc(exName(en.ex))}</b>: ${en.sets.map(x => setText(x, exType(en.ex))).join(' · ')}</li>`).join('')}</ul>
      <button class="btn sm danger" data-act="delsession" data-id="${esc(s.id)}">Training löschen</button>
    </details>`;
  }

  function renderData() {
    $('#topbar').innerHTML = `<h1>Daten</h1>`;
    const le = state.settings.lastExport;
    const days = le ? Math.floor((Date.now() - le) / 864e5) : null;
    const exportInfo = le
      ? `Letzter Export: ${new Date(le).toLocaleDateString('de-DE')}${days >= 30 ? ' – <b style="color:var(--t2)">Zeit für ein Backup!</b>' : ''}`
      : 'Noch nie exportiert.';
    const all = sortedSessions().reverse();
    $('#view').innerHTML = `
      <div class="panel">
        <h3>Excel exportieren</h3>
        <p>Gleiches Layout wie deine bisherige Tabelle (Tag 1 / Tag 2, Spalten je KW) plus ein Blatt „Daten“ mit jedem einzelnen Satz. Dient auch als Backup. ${exportInfo}</p>
        <button class="btn primary block" data-act="export">Als Excel speichern</button>
      </div>
      <div class="panel">
        <h3>Excel importieren</h3>
        <p>Liest einen Export dieser App oder deine ursprüngliche Tabelle ein. Ersetzt alle Trainings in der App.</p>
        <button class="btn block" data-act="import">Datei auswählen …</button>
      </div>
      <div class="panel">
        <h3>Einstellungen</h3>
        <div class="row"><label>Körpergewicht (kg)<div class="small muted">für das 1RM bei Körpergewichtsübungen</div></label>
          <input inputmode="decimal" data-setting="bodyweight" value="${esc(String(state.settings.bodyweight).replace('.', ','))}"></div>
        <div class="row"><label>Pausenzeit (Sekunden)</label>
          <input inputmode="numeric" data-setting="rest" value="${esc(state.settings.rest)}"></div>
      </div>
      <div class="section-title">Alle Trainings (${all.length})</div>
      <div class="panel">${all.length ? all.map(historyItem).join('') : '<div class="muted">Keine Trainings.</div>'}</div>
      <div class="panel">
        <h3>Zurücksetzen</h3>
        <p>Löscht alle Trainings auf diesem Gerät und lädt wieder die Startdaten aus deiner Excel (KW 40–43).</p>
        <button class="btn block danger" data-act="reset">Alles zurücksetzen</button>
      </div>
      <p class="small muted" style="text-align:center">Deine Daten bleiben nur auf diesem Gerät.</p>`;
  }

  function deleteSession(id) {
    const s = state.sessions.find(x => x.id === id);
    if (!s) return;
    const w = workoutById(s.workout);
    openModal(`<h2>Training löschen?</h2><p>${esc(w ? w.name : '')} vom ${fmtDate(s.date)} wird entfernt.</p>
      <div class="btns"><button class="btn block danger" data-m="yes">Löschen</button><button class="btn block" data-m="close">Abbrechen</button></div>`, act => {
      if (act === 'yes') { state.sessions = state.sessions.filter(x => x.id !== id); save(); render(); }
      closeModal();
    });
  }
  function resetDialog() {
    openModal(`<h2>Alles zurücksetzen?</h2><p>Alle Trainings auf diesem Gerät werden gelöscht. Exportiere vorher, wenn du sie behalten willst.</p>
      <div class="btns"><button class="btn block danger" data-m="yes">Zurücksetzen</button><button class="btn block" data-m="close">Abbrechen</button></div>`, act => {
      if (act === 'yes') { state = freshState(); save(); render(); renderRest(); toast('Zurückgesetzt'); }
      closeModal();
    });
  }

  // ---------- Export ----------
  function buildExport() {
    const sessions = sortedSessions();
    const cell = (rows, r, c, v, extra) => {
      if (!rows.has(r)) rows.set(r, new Map());
      rows.get(r).set(c, Object.assign({ v }, extra || {}));
    };
    const C = XLSX_MINI.colName;

    // Spalten-Slots: pro Kalenderwoche, bei mehreren gleichen Workouts in einer Woche mehrere Slots
    const weekMap = new Map();
    for (const s of sessions) {
      const iw = isoWeek(parseDate(s.date));
      const key = `${iw.year}-${pad(iw.week)}`;
      if (!weekMap.has(key)) weekMap.set(key, { iw, byW: {} });
      const wk = weekMap.get(key);
      (wk.byW[s.workout] = wk.byW[s.workout] || []).push(s);
    }
    const slots = [];
    for (const key of [...weekMap.keys()].sort()) {
      const wk = weekMap.get(key);
      const n = Math.max(...Object.values(wk.byW).map(a => a.length));
      for (let k = 0; k < n; k++) {
        const bySlot = {};
        for (const wid in wk.byW) bySlot[wid] = wk.byW[wid][k] || null;
        slots.push({ label: `KW ${wk.iw.week}${n > 1 ? ` (${k + 1})` : ''}`, year: wk.iw.year, bySlot });
      }
    }
    let maxSets = 5;
    sessions.forEach(s => s.entries.forEach(en => { maxSets = Math.max(maxSets, en.sets.length); }));
    const width = maxSets * 2 + 1, stride = width + 1;

    const rows = new Map();
    cell(rows, 2, 1, 'Körpergewicht', { s: 4 });
    cell(rows, 2, 2, `${fmtNum(state.settings.bodyweight)}kg`);
    slots.forEach((sl, k) => {
      const c0 = 2 + k * stride;
      cell(rows, 1, c0, sl.label, { s: 1 });
      const ds = state.workouts.map(w => sl.bySlot[w.id] ? `${w.name}: ${fmtDateShort(sl.bySlot[w.id].date)}${sl.year}` : null).filter(Boolean);
      cell(rows, 3, c0, ds.join(' · '), { s: 4 });
    });

    let r = 4;
    for (const w of state.workouts) {
      const exList = [...w.exercises];
      sessions.filter(s => s.workout === w.id).forEach(s => s.entries.forEach(en => { if (!exList.includes(en.ex)) exList.push(en.ex); }));
      cell(rows, r, 1, w.name, { s: 1 });
      slots.forEach((_, k) => {
        const c0 = 2 + k * stride;
        for (let i = 0; i < maxSets; i++) { cell(rows, r, c0 + 2 * i, 'kg', { s: 4 }); cell(rows, r, c0 + 2 * i + 1, 'Reps', { s: 4 }); }
        cell(rows, r, c0 + width - 1, 'Volume', { s: 4 });
      });
      r++;
      for (const ex of exList) {
        const type = exType(ex);
        cell(rows, r, 1, exName(ex));
        slots.forEach((sl, k) => {
          const c0 = 2 + k * stride;
          const s = sl.bySlot[w.id];
          const en = s && s.entries.find(e => e.ex === ex);
          const volCol = c0 + width - 1;
          if (type === 'time') {
            const f = `SUM(${C(c0)}${r}:${C(c0 + width - 2)}${r})`;
            if (en) en.sets.forEach((st, i) => cell(rows, r, c0 + 2 * i, st.sec, { s: 2 }));
            if (s) cell(rows, r, volCol, en ? en.sets.reduce((a, x) => a + x.sec, 0) : 0, { f, s: 2 });
          } else {
            const f = Array.from({ length: maxSets }, (_, i) => `(${C(c0 + 2 * i)}${r}*${C(c0 + 2 * i + 1)}${r})`).join('+');
            let vol = 0;
            if (en) en.sets.forEach((st, i) => {
              const kg = type === 'bw' ? Math.max(1, st.kg || 0) : (st.kg || 0);
              cell(rows, r, c0 + 2 * i, kg); cell(rows, r, c0 + 2 * i + 1, st.reps);
              vol += kg * st.reps;
            });
            if (s) cell(rows, r, volCol, vol, { f });
          }
        });
        r++;
      }
      r++;
    }
    const sheet1 = {
      name: 'Tabelle1', rows, freeze: true,
      cols: [{ min: 1, max: 1, width: 30 }, { min: 2, max: 1 + slots.length * stride, width: 7 }]
    };

    // Blatt "Daten": eine Zeile pro Satz (verlustfrei, wird beim Import bevorzugt)
    const rows2 = new Map();
    const hdr = ['Datum', 'KW', 'Workout', 'Übung', 'Typ', 'Satz', 'kg (Zusatz)', 'Wdh', 'Sekunden', 'WorkoutID', 'ÜbungID'];
    hdr.forEach((h, i) => cell(rows2, 1, i + 1, h, { s: 1 }));
    let rr = 2;
    const typeName = { reps: 'Gewicht', bw: 'Körpergewicht', time: 'Zeit' };
    for (const s of sessions) {
      const d = parseDate(s.date);
      const serial = Math.round((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(1899, 11, 30)) / 864e5);
      const w = workoutById(s.workout);
      for (const en of s.entries) {
        en.sets.forEach((st, i) => {
          cell(rows2, rr, 1, serial, { s: 3 });
          cell(rows2, rr, 2, isoWeek(d).week);
          cell(rows2, rr, 3, w ? w.name : s.workout);
          cell(rows2, rr, 4, exName(en.ex));
          cell(rows2, rr, 5, typeName[exType(en.ex)]);
          cell(rows2, rr, 6, i + 1);
          if (exType(en.ex) === 'time') cell(rows2, rr, 9, st.sec);
          else { cell(rows2, rr, 7, st.kg || 0); cell(rows2, rr, 8, st.reps); }
          cell(rows2, rr, 10, s.workout);
          cell(rows2, rr, 11, en.ex);
          rr++;
        });
      }
    }
    const sheet2 = { name: 'Daten', rows: rows2, cols: [{ min: 1, max: 1, width: 12 }, { min: 2, max: 3, width: 9 }, { min: 4, max: 4, width: 30 }, { min: 5, max: 11, width: 12 }] };
    return XLSX_MINI.writeWorkbook([sheet1, sheet2]);
  }

  async function exportExcel() {
    try {
      const blob = buildExport();
      const name = `Gym-Export-${todayStr()}.xlsx`;
      const file = new File([blob], name, { type: blob.type });
      let shared = false;
      if (navigator.canShare && navigator.canShare({ files: [file] }) && /iPhone|iPad|Android/i.test(navigator.userAgent)) {
        try { await navigator.share({ files: [file], title: name }); shared = true; }
        catch (e) { if (e.name === 'AbortError') return; }
      }
      if (!shared) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = name;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      }
      state.settings.lastExport = Date.now();
      save();
      if (tab === 'data') renderData();
      toast('Export erstellt');
    } catch (e) {
      console.error(e);
      toast('Export fehlgeschlagen: ' + e.message);
    }
  }

  // ---------- Import ----------
  const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9äöüß]/g, '');
  function findExercise(name) {
    const n = norm(name);
    if (!n) return null;
    for (const id in state.exercises) if (norm(state.exercises[id].name) === n) return id;
    for (const id in state.exercises) { const m = norm(state.exercises[id].name); if (m.startsWith(n) || n.startsWith(m)) return id; }
    return null;
  }

  function parseDatenSheet(cells, wb) {
    const get = (r, c) => cells.get(r + ',' + c);
    const sessions = new Map();
    for (let r = 2; ; r++) {
      const dateV = get(r, 1);
      if (dateV === undefined) break;
      let date;
      if (typeof dateV === 'number') { const d = new Date(Date.UTC(1899, 11, 30) + dateV * 864e5); date = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; }
      else { const m = /(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(dateV); if (!m) continue; date = `${m[3]}-${pad(m[2])}-${pad(m[1])}`; }
      const wid = get(r, 10) || (wb.workouts.find(w => norm(w.name) === norm(get(r, 3))) || {}).id;
      if (!wid) continue;
      let ex = get(r, 11);
      if (!ex || !wb.exercises[ex]) ex = findExercise(get(r, 4)) || ensureExercise(wb, get(r, 4), get(r, 5) === 'Zeit' ? 'time' : get(r, 5) === 'Körpergewicht' ? 'bw' : 'reps');
      const key = date + '|' + wid;
      if (!sessions.has(key)) sessions.set(key, { id: uid(), workout: wid, date, entries: [] });
      const s = sessions.get(key);
      let en = s.entries.find(e => e.ex === ex);
      if (!en) { en = { ex, sets: [] }; s.entries.push(en); }
      if (exType(ex) === 'time' || (wb.exercises[ex] || {}).type === 'time') en.sets.push({ sec: +get(r, 9) || 0 });
      else en.sets.push({ kg: +get(r, 7) || 0, reps: +get(r, 8) || 0 });
    }
    return [...sessions.values()];
  }

  function ensureExercise(wb, name, type) {
    const existing = Object.keys(wb.exercises).find(id => norm(wb.exercises[id].name) === norm(name));
    if (existing) return existing;
    let id = norm(name).slice(0, 20) || 'ex';
    while (wb.exercises[id]) id += '_';
    wb.exercises[id] = { name: String(name), type };
    return id;
  }

  function parseBlockSheet(cells, wb) {
    const get = (r, c) => cells.get(r + ',' + c);
    let maxR = 0, maxC = 0;
    for (const k of cells.keys()) { const [r, c] = k.split(',').map(Number); maxR = Math.max(maxR, r); maxC = Math.max(maxC, c); }
    // Kalenderwochen in Zeile 1
    const blocks = [];
    for (let c = 2; c <= maxC; c++) {
      const v = get(1, c);
      const m = typeof v === 'string' && /KW\s*(\d+)(?:\s*\((\d+)\))?/i.exec(v);
      if (m) blocks.push({ c, week: +m[1], slot: m[2] ? +m[2] - 1 : 0 });
    }
    if (!blocks.length) throw new Error('Keine Spalten „KW …“ in Zeile 1 gefunden');
    // Jahr: aus Zeile 3 (App-Export) oder so wählen, dass das Datum nicht in der Zukunft liegt
    const today = parseDate(todayStr());
    const nowW = isoWeek(today);
    let year = nowW.year;
    const r3 = String(get(3, blocks[0].c) || '');
    const ym = /(\d{4})/.exec(r3);
    if (ym) year = +ym[1];
    else if (blocks[0].week > nowW.week) year--;
    let prevWeek = 0;
    blocks.forEach(b => { if (b.week < prevWeek) year++; b.year = year; prevWeek = b.week; });

    const bw = /([\d.,]+)/.exec(String(get(2, 2) || ''));
    if (bw) wb.bodyweight = num(bw[1]);

    const sessions = [];
    for (let r = 1; r <= maxR; r++) {
      const a = get(r, 1);
      const tm = typeof a === 'string' && /^(tag|workout)\s*(\d+)/i.exec(a.trim());
      if (!tm) continue;
      let w = wb.workouts.find(x => norm(x.name) === norm(a));
      if (!w) { w = { id: 't' + tm[2], name: a.trim(), exercises: [] }; if (!wb.workouts.find(x => x.id === w.id)) wb.workouts.push(w); else w = wb.workouts.find(x => x.id === w.id); }
      const exRows = [];
      for (let rr = r + 1; rr <= maxR && get(rr, 1) !== undefined && !/^(tag|workout)\s*\d/i.test(String(get(rr, 1))); rr++) exRows.push(rr);
      blocks.forEach((b, bi) => {
        const end = bi + 1 < blocks.length ? blocks[bi + 1].c : maxC + 1;
        // Datenblock beginnt beim ersten „kg“-Kopf ab der KW-Spalte (in der Original-Excel steht KW eine Spalte weiter links)
        let start = b.c;
        while (start < end && !/^kg$/i.test(String(get(r, start) || '').trim())) start++;
        if (start >= end) return;
        let volCol = end;
        for (let c = start; c < end; c++) if (/^vol/i.test(String(get(r, c) || ''))) { volCol = c; break; }
        const mon = mondayOfIsoWeek(b.year, b.week);
        const offs = (wb.workouts.indexOf(w)) * 3 + b.slot;
        const date = dateStr(new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + Math.min(offs, 6)));
        const entries = [];
        for (const rr of exRows) {
          const name = get(rr, 1);
          let ex = findExercise(name);
          const raw = [];
          for (let c = start; c < volCol; c += 2) raw.push([get(rr, c), get(rr, c + 1)]);
          let type = ex ? (wb.exercises[ex] || state.exercises[ex]).type : null;
          if (!type) {
            const looksTime = raw.some(([k, rp]) => typeof k === 'number' && k > 0 && k < 1 && rp === undefined);
            type = looksTime ? 'time' : 'reps';
            ex = ensureExercise(wb, name, type);
          }
          if (!w.exercises.includes(ex)) w.exercises.push(ex);
          const sets = [];
          for (const [k, rp] of raw) {
            if (type === 'time') {
              if (typeof k === 'number' && k > 0) sets.push({ sec: k < 1 ? Math.round(k * 1440) : Math.round(k) });
            } else if (type === 'bw') {
              if (typeof rp === 'number' && rp > 0) sets.push({ kg: typeof k === 'number' && k > 1 ? k : 0, reps: Math.round(rp) });
            } else if (typeof rp === 'number' && rp > 0 && typeof k === 'number') sets.push({ kg: k, reps: Math.round(rp) });
          }
          if (sets.length) entries.push({ ex, sets });
        }
        if (entries.length) sessions.push({ id: uid(), workout: w.id, date, entries });
      });
    }
    return sessions;
  }

  $('#file').addEventListener('change', async e => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      const sheets = await XLSX_MINI.readWorkbook(await f.arrayBuffer());
      const wb = {
        exercises: JSON.parse(JSON.stringify(state.exercises)),
        workouts: JSON.parse(JSON.stringify(state.workouts)),
        bodyweight: null
      };
      let sessions;
      const daten = sheets['Daten'];
      if (daten && daten.get('1,1') === 'Datum') {
        sessions = parseDatenSheet(daten, wb);
        const first = Object.values(sheets)[0];
        const bw = first && /([\d.,]+)/.exec(String(first.get('2,2') || ''));
        if (bw) wb.bodyweight = num(bw[1]);
      } else {
        sessions = parseBlockSheet(Object.values(sheets)[0], wb);
      }
      if (!sessions.length) { toast('Keine Trainings in der Datei gefunden'); return; }
      const nSets = sessions.reduce((a, s) => a + s.entries.reduce((b, en) => b + en.sets.length, 0), 0);
      openModal(`<h2>Import</h2><p>${sessions.length} Trainings mit ${nSets} Sätzen gefunden. Die ${state.sessions.length} Trainings in der App werden dadurch ersetzt.</p>
        <div class="btns"><button class="btn primary block" data-m="yes">Importieren</button><button class="btn block" data-m="close">Abbrechen</button></div>`, act => {
        if (act === 'yes') {
          state.exercises = wb.exercises;
          state.workouts = wb.workouts;
          state.sessions = sessions;
          if (wb.bodyweight && isFinite(wb.bodyweight)) state.settings.bodyweight = wb.bodyweight;
          save(); render(); toast('Import abgeschlossen');
        }
        closeModal();
      });
    } catch (err) {
      console.error(err);
      toast('Import fehlgeschlagen: ' + err.message);
    }
  });

  // ================= Start =================
  render();
  if (state.active) requestWakeLock();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  window.__gym = { get state() { return state; }, buildExport, parseBlockSheet, parseDatenSheet };
})();
