"use strict";

// ornata-macos — the macros in the main window: sidebar list and editor.
// Copyright (C) 2025 André Lindner. GNU General Public License v2.0 or later.
//
// Loaded before renderer.js and uses its helpers ($, api, toast, showTab,
// state) once init() calls initMacros(). Every change is saved right away;
// src/macros.js keeps the helper that runs them up to date.

const mac = {
  list: [],          // all macros, as saved
  enabled: true,     // "Run macros"
  status: {},        // { helper, tap, inputMonitoring, accessibility, playing, error }
  keyNames: {},      // keyCode -> cap
  current: null,     // id of the macro the editor shows
  capture: null,     // what the keys (and clicks) are for: { kind: "record"|"shortcut"|"key", … }
  countdown: null,   // timer of "Test in 3 s"
};

const TEST_DELAY_MS = 3000;
const NEW_PRESS_HOLD_MS = 100;
const SAVE_DELAY_MS = 400;
// Modifier key codes (macOS virtual key codes), as in src/macros.js.
const MODIFIER_KEYS = new Set([54, 55, 56, 57, 58, 59, 60, 61, 62, 63]);
const MOD_LABELS = { ctrl: "Ctrl", alt: "Alt", shift: "Shift", cmd: "Cmd" };
// The modifier key codes behind each modifier of a shortcut.
const MOD_KEYS = { ctrl: [59, 62], alt: [58, 61], shift: [56, 60], cmd: [55, 54] };
const BUTTON_NAMES = ["Left click", "Right click", "Middle click", "Button 4", "Button 5"];
const ESC = 53;

const keyName = (code) => mac.keyNames[code] || `Key ${code}`;
const isClick = (p) => "button" in p;
const pressName = (p) => (isClick(p) ? BUTTON_NAMES[p.button] || `Button ${p.button + 1}` : keyName(p.key));
const whereText = (p) => (p.fixed ? `at ${p.x}, ${p.y}` : "where the mouse is");
function countText(presses) {
  const clicks = presses.filter(isClick).length;
  const keys = presses.length - clicks;
  const parts = [];
  if (keys || !clicks) parts.push(keys === 1 ? "1 key" : `${keys} keys`);
  if (clicks) parts.push(clicks === 1 ? "1 click" : `${clicks} clicks`);
  return parts.join(", ");
}
const seconds = (ms) => (ms / 1000).toFixed(2);
const currentMacro = () => mac.list.find((m) => m.id === mac.current) || null;
const macroLength = (m) => m.presses.reduce((end, p) => Math.max(end, p.at + p.hold), 0);

function shortcutParts(s) {
  if (!s) return [];
  return [...s.mods.map((m) => MOD_LABELS[m]), ...s.keys.map(keyName)];
}
const shortcutText = (s) => shortcutParts(s).join("+");

// --- sidebar ----------------------------------------------------------------
function renderMacroList() {
  $("#macroList").replaceChildren(...mac.list.map((m) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "item";
    b.dataset.macro = m.id;
    b.setAttribute("aria-current", String(state.tab === "macro" && m.id === mac.current));
    const text = document.createElement("span");
    text.className = "item-text";
    const name = document.createElement("span");
    name.className = "item-name";
    name.textContent = m.name;
    const sub = document.createElement("span");
    sub.className = "item-sub";
    sub.textContent = m.shortcut ? shortcutText(m.shortcut) : "No shortcut";
    text.append(name, sub);
    b.appendChild(text);
    if (mac.status.playing === m.id) {
      const badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = "Playing";
      b.appendChild(badge);
    }
    return b;
  }));
}

// --- editor -------------------------------------------------------------------
function renderMacroEditor() {
  const m = currentMacro();
  if (!m) return;
  if (document.activeElement !== $("#macroName")) $("#macroName").value = m.name;
  $("#macrosOn").checked = mac.enabled;

  const playing = mac.status.playing === m.id;
  const parts = [m.shortcut ? shortcutText(m.shortcut) : "No shortcut"];
  parts.push(countText(m.presses));
  if (m.presses.length) parts.push(`${seconds(macroLength(m))} s`);
  if (playing) parts.push("Playing");
  const line = $("#macroState");
  line.textContent = parts.join(" · ");
  line.classList.toggle("live", playing);

  const test = $("#macroTest");
  test.textContent = playing ? "Stop" : (mac.countdown ? "Starting…" : "Test in 3 s");
  test.disabled = !m.presses.length && !playing;

  renderShortcut(m);
  for (const r of document.querySelectorAll('input[name="repeat"]')) r.checked = r.value === m.repeat.mode;
  if (document.activeElement !== $("#repeatTimes")) $("#repeatTimes").value = m.repeat.times;
  renderPresses(m);
  renderBanner();
}

function renderShortcut(m) {
  const view = $("#shortcutView");
  const cap = mac.capture;
  view.replaceChildren();
  view.className = "combo";
  if (cap && cap.kind === "shortcut") {
    view.classList.add("waiting");
    view.textContent = cap.peak.length ? shortcutText({ mods: cap.peakMods, keys: cap.peak }) + " …" : "Press the keys of the shortcut … (Esc cancels)";
  } else if (!m.shortcut) {
    view.classList.add("empty");
    view.textContent = "Not set — the macro only runs with Test.";
  } else {
    shortcutParts(m.shortcut).forEach((label, i) => {
      if (i) {
        const plus = document.createElement("span");
        plus.className = "plus";
        plus.textContent = "+";
        view.appendChild(plus);
      }
      const k = document.createElement("kbd");
      k.textContent = label;
      view.appendChild(k);
    });
  }
  $("#setShortcut").textContent = cap && cap.kind === "shortcut" ? "Cancel" : "Set shortcut…";
  $("#clearShortcut").disabled = !m.shortcut;
  $("#shortcutNote").textContent = m.shortcut && !m.shortcut.mods.length
    ? "Without Ctrl, Alt or Cmd these keys no longer reach any app on their own. The macro starts when you let go of the shortcut."
    : "Press it to start the macro, again to stop it. The macro starts when you let go of the shortcut. Keys you already hold, like W for walking, don’t get in the way.";
}

function renderPresses(m) {
  const list = $("#pressList");
  const recording = mac.capture && mac.capture.kind === "record";
  $("#pressEmpty").hidden = m.presses.length > 0 || recording;
  $("#recordHint").hidden = !recording;
  const rec = $("#recordBtn");
  rec.textContent = recording ? "Stop" : "Record";
  rec.classList.toggle("on", recording);
  $("#addPress").textContent = mac.capture && mac.capture.kind === "key" && mac.capture.index === -1 ? "Press a key… (Esc cancels)" : "Add key";
  $("#addClick").disabled = recording;
  $("#macroLength").textContent = recording
    ? `${mac.capture.presses.length} recorded`
    : (m.presses.length ? `${seconds(macroLength(m))} s in all` : "");

  const presses = recording ? mac.capture.presses : m.presses;
  list.hidden = !presses.length;
  if (!presses.length) { list.replaceChildren(); return; }
  const total = Math.max(1, macroLength({ presses }));
  const cells = ["Key or click", "Starts at (s)", "Held for (s)", "", ""].map((t) => {
    const h = document.createElement("span");
    h.className = "head";
    h.textContent = t;
    return h;
  });
  presses.forEach((p, i) => {
    const key = document.createElement("button");
    key.type = "button";
    key.className = "keybtn";
    key.dataset.index = i;
    const waiting = mac.capture && mac.capture.kind === "key" && mac.capture.index === i;
    key.classList.toggle("waiting", waiting);
    if (isClick(p)) {
      key.classList.add("click");
      const where = document.createElement("span");
      where.className = "where";
      where.textContent = whereText(p);
      key.append(pressName(p), where);
      key.title = "Choose the button and where it clicks";
    } else {
      key.textContent = waiting ? "Press a key…" : keyName(p.key);
      key.title = "Click, then press another key";
    }
    key.disabled = recording;

    const at = numberInput(p.at, i, "at", recording);
    const hold = numberInput(p.hold, i, "hold", recording);

    const track = document.createElement("span");
    track.className = "track";
    const bar = document.createElement("i");
    bar.style.left = `${(p.at / total) * 100}%`;
    bar.style.width = `${(p.hold / total) * 100}%`;
    if (isClick(p)) bar.className = "click";
    track.appendChild(bar);

    const del = document.createElement("button");
    del.type = "button";
    del.className = "icon-btn small del";
    del.dataset.index = i;
    del.title = isClick(p) ? "Remove this click" : "Remove this key";
    del.setAttribute("aria-label", `Remove ${pressName(p)}`);
    del.textContent = "×";
    del.disabled = recording;
    cells.push(key, at, hold, track, del);
  });
  list.replaceChildren(...cells);
}

function numberInput(ms, index, field, disabled) {
  const input = document.createElement("input");
  input.type = "number";
  input.min = field === "hold" ? "0.01" : "0";
  input.step = "0.01";
  input.value = seconds(ms);
  input.dataset.index = index;
  input.dataset.field = field;
  input.disabled = disabled;
  input.setAttribute("aria-label", field === "at" ? "Starts at, in seconds" : "Held for, in seconds");
  return input;
}

// What stands between the macros and the keyboard, with a way out.
function renderBanner() {
  const banner = $("#macroBanner");
  const s = mac.status;
  const parts = [];
  if (s.helper === "missing") {
    parts.push(text("The macro helper is missing from this build, so macros can’t run."));
  } else if (!mac.enabled) {
    parts.push(text("Macros are switched off. No shortcut starts a macro, and the app doesn’t watch the keyboard."));
    parts.push(buttons([["Turn On", () => setMacrosEnabled(true)]]));
  } else if (s.inputMonitoring === false || s.accessibility === false) {
    parts.push(text("macOS has to allow two things before macros can run:"));
    parts.push(permission(s.inputMonitoring, "Input Monitoring", "notices the shortcut and records keys and clicks."));
    parts.push(permission(s.accessibility, "Accessibility", "presses the keys and clicks of a macro."));
    parts.push(buttons([
      ["Ask macOS", () => api.macros.requestAccess()],
      ["Open Input Monitoring", () => api.macros.openPrivacy("input")],
      ["Open Accessibility", () => api.macros.openPrivacy("accessibility")],
      ["Check Again", () => api.macros.restartHelper()],
    ]));
    parts.push(text("Turn on “Ornata Lighting” in both lists. The app isn’t signed, so macOS may ask again after an update.", "note"));
  }
  banner.hidden = !parts.length;
  banner.replaceChildren(...parts);
}

function text(t, cls) {
  const p = document.createElement("div");
  if (cls) p.className = cls;
  p.textContent = t;
  return p;
}
function permission(ok, name, what) {
  const row = document.createElement("div");
  row.className = "perm";
  const mark = document.createElement("span");
  mark.className = "mark " + (ok ? "ok" : "no");
  mark.textContent = ok ? "✓" : "✗";
  const b = document.createElement("b");
  b.textContent = name;
  row.append(mark, b, document.createTextNode(" " + what));
  return row;
}
function buttons(list) {
  const row = document.createElement("div");
  row.className = "row";
  for (const [label, fn] of list) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.onclick = fn;
    row.appendChild(b);
  }
  return row;
}

function renderMacros() {
  renderMacroList();
  if (state.tab === "macro") renderMacroEditor();
}

// --- saving -------------------------------------------------------------------
let saveTimer = null;
// Edit the shown macro and save it (soon, for typing; now for clicks).
function updateMacro(fn, { soon = false } = {}) {
  const m = currentMacro();
  if (!m) return;
  fn(m);
  m.presses.sort((a, b) => a.at - b.at);
  renderMacros();
  clearTimeout(saveTimer);
  if (soon) saveTimer = setTimeout(() => saveMacro(m), SAVE_DELAY_MS);
  else saveMacro(m);
}

async function saveMacro(m) {
  const r = await api.macros.save(m);
  if (!r.ok) {
    toast(r.error || "Could not save the macro", true);
    if (r.macros) applyMacroState(r);
    return;
  }
  applyMacroState(r);
}

function applyMacroState(s) {
  mac.list = s.macros;
  mac.enabled = s.enabled;
  if (s.status) mac.status = s.status;
  if (s.keyNames && Object.keys(s.keyNames).length) mac.keyNames = s.keyNames;
  if (mac.current && !currentMacro()) {
    mac.current = null;
    if (state.tab === "macro") showTab("keyboard");
  }
  renderMacros();
}

async function newMacro() {
  const n = mac.list.length + 1;
  const r = await api.macros.save({ name: `Macro ${n}`, shortcut: null, presses: [], repeat: { mode: "once", times: 2 } });
  if (!r.ok) { toast(r.error || "Could not create the macro", true); return; }
  applyMacroState(r);
  openMacro(r.macro.id);
  $("#macroName").focus();
  $("#macroName").select();
}

function openMacro(id) {
  stopCapture();
  mac.current = id;
  showTab("macro");
}

async function deleteMacro(id) {
  stopCapture();
  const r = await api.macros.delete(id);
  if (r.canceled) return;
  if (!r.ok) { toast(r.error || "Delete failed", true); return; }
  applyMacroState(r);
  toast("Macro deleted");
}

async function duplicateMacro(id) {
  const m = mac.list.find((o) => o.id === id);
  if (!m) return;
  const r = await api.macros.save({ ...m, id: undefined, name: `${m.name} copy`.slice(0, 60), shortcut: null });
  if (!r.ok) { toast(r.error || "Could not copy the macro", true); return; }
  applyMacroState(r);
  openMacro(r.macro.id);
}

async function macroMenu(id) {
  const m = mac.list.find((o) => o.id === id);
  if (!m) return;
  const choice = await api.popupMenu([
    { id: "open", label: "Open" },
    { id: "duplicate", label: "Duplicate" },
    { type: "separator" },
    { id: "delete", label: `Delete “${m.name}”…` },
  ]);
  if (choice === "open") openMacro(id);
  else if (choice === "duplicate") duplicateMacro(id);
  else if (choice === "delete") deleteMacro(id);
}

async function setMacrosEnabled(on) {
  applyMacroState(await api.macros.setEnabled(on));
}

// --- keys from the helper: recording, shortcut entry, single keys --------------
async function startCapture(capture) {
  stopCapture();
  // A focused button would react to Space or Return.
  if (document.activeElement) document.activeElement.blur();
  mac.capture = capture;
  renderMacros();
  const s = await api.macros.capture(true);
  if (s && s.helper !== "running") {
    toast("The macro helper isn’t running.", true);
    stopCapture();
  }
}

function stopCapture() {
  if (!mac.capture) return;
  mac.capture = null;
  api.macros.capture(false);
  renderMacros();
}

function onMacroKey(k) {
  const cap = mac.capture;
  if (!cap) return;
  if (cap.kind === "record") recordKey(cap, k);
  else if (cap.kind === "shortcut") shortcutKey(cap, k);
  else if (cap.kind === "key") singleKey(cap, k);
}

// Clicks outside this app's windows; only a recording takes them.
function onMacroMouse(c) {
  const cap = mac.capture;
  if (!cap || cap.kind !== "record") return;
  recordEvent(cap, `b${c.button}`, c.down, c.t, { button: c.button, x: Math.round(c.x), y: Math.round(c.y), fixed: false });
  renderMacros();
}

// Times are relative to the first key or button going down. One let go that
// went down before the recording started is ignored; one still down at the end
// is held until the last event. `id` tells the keys and buttons apart.
function recordEvent(cap, id, down, t, press) {
  if (down) {
    if (cap.base === null) cap.base = t;
    if (!cap.downAt.has(id)) cap.downAt.set(id, { t, press });
  } else if (cap.downAt.has(id)) {
    const start = cap.downAt.get(id);
    cap.downAt.delete(id);
    cap.presses.push(recorded(cap, start, t));
    cap.presses.sort((a, b) => a.at - b.at);
  }
  cap.lastT = t;
}

const recorded = (cap, start, end) => ({
  ...start.press,
  at: Math.round(start.t - cap.base),
  hold: Math.max(10, Math.round(end - start.t)),
});

function recordKey(cap, k) {
  recordEvent(cap, `k${k.key}`, k.down, k.t, { key: k.key });
  if (endsRecording(cap, k)) { finishRecording(true); return; }
  renderMacros();
}

// The macro's own shortcut, pressed while recording, ends the recording.
function endsRecording(cap, k) {
  const s = cap.stopWith;
  if (!s || !k.down || !s.keys.includes(k.key)) return false;
  if (!s.keys.every((key) => cap.downAt.has(`k${key}`))) return false;
  return s.mods.length === k.mods.length && s.mods.every((m) => k.mods.includes(m));
}

// byShortcut: the keys of the shortcut aren't part of the macro, and it ends
// where the shortcut began.
function finishRecording(byShortcut = false) {
  const cap = mac.capture;
  if (!cap || cap.kind !== "record") return;
  if (byShortcut) {
    const ids = [...cap.stopWith.keys, ...cap.stopWith.mods.flatMap((m) => MOD_KEYS[m])].map((key) => `k${key}`);
    for (const id of ids) {
      const start = cap.downAt.get(id);
      if (!start) continue;
      cap.downAt.delete(id);
      cap.lastT = Math.min(cap.lastT, start.t);
    }
  }
  for (const start of cap.downAt.values()) cap.presses.push(recorded(cap, start, cap.lastT));
  const presses = cap.presses.sort((a, b) => a.at - b.at);
  // The first key or click starts the macro.
  const first = presses.length ? presses[0].at : 0;
  for (const p of presses) p.at -= first;
  stopCapture();
  if (!presses.length) { toast("Nothing recorded"); return; }
  updateMacro((m) => { m.presses = presses; });
  toast(`Recorded ${countText(presses)} · ${seconds(macroLength({ presses }))} s`);
}

// The shortcut is the largest set of keys held at once; it's done when all
// are up again. Modifiers count only together with another key.
function shortcutKey(cap, k) {
  if (MODIFIER_KEYS.has(k.key)) return;
  if (k.down) {
    if (k.key === ESC && !cap.down.size && !k.mods.length) { stopCapture(); return; }
    cap.down.add(k.key);
    if (cap.down.size > cap.peak.length) {
      cap.peak = [...cap.down];
      cap.peakMods = k.mods;
    }
  } else {
    cap.down.delete(k.key);
    if (!cap.down.size && cap.peak.length) {
      const shortcut = { mods: cap.peakMods, keys: cap.peak.slice(0, 3) };
      stopCapture();
      updateMacro((m) => { m.shortcut = shortcut; });
      return;
    }
  }
  renderMacros();
}

// index -1 adds a key after the last one.
function singleKey(cap, k) {
  if (!k.down) return;
  if (k.key === ESC && !k.mods.length) { stopCapture(); return; }
  stopCapture();
  updateMacro((m) => {
    if (cap.index >= 0 && m.presses[cap.index]) m.presses[cap.index].key = k.key;
    else m.presses.push({ key: k.key, at: macroLength(m), hold: NEW_PRESS_HOLD_MS });
  });
}

// The button of a click and where it clicks.
async function clickMenu(i) {
  const p = currentMacro() && currentMacro().presses[i];
  if (!p || !isClick(p)) return;
  const hasSpot = "x" in p;
  const choice = await api.popupMenu([
    ...BUTTON_NAMES.map((label, b) => ({ id: `button${b}`, label, checked: p.button === b })),
    { type: "separator" },
    { id: "mouse", label: "Where the mouse is", checked: !p.fixed },
    {
      id: "fixed",
      label: hasSpot ? `At ${p.x}, ${p.y}, where it was recorded` : "At the recorded spot (only for recorded clicks)",
      checked: !!p.fixed,
      enabled: hasSpot,
    },
  ]);
  if (!choice) return;
  updateMacro((m) => {
    const q = m.presses[i];
    if (!q || !isClick(q)) return;
    if (choice.startsWith("button")) q.button = Number(choice.slice(6));
    else q.fixed = choice === "fixed" && hasSpot;
  });
}

// --- test playback ----------------------------------------------------------------
function testMacro() {
  const m = currentMacro();
  if (!m) return;
  if (mac.status.playing === m.id || mac.countdown) {
    clearTimeout(mac.countdown);
    mac.countdown = null;
    api.macros.stop();
    renderMacros();
    return;
  }
  stopCapture();
  api.macros.play(m, TEST_DELAY_MS).then((r) => {
    if (!r.ok) { toast(r.error || "Could not play the macro", true); return; }
    toast("Starts in 3 s — switch to the app that should get the keys.");
    mac.countdown = setTimeout(() => { mac.countdown = null; renderMacros(); }, TEST_DELAY_MS);
    renderMacros();
  });
}

// --- wiring -------------------------------------------------------------------
// Called by showTab() in renderer.js.
function macrosTabChanged(tab) {
  if (tab !== "macro") stopCapture();
  renderMacros();
}

async function initMacros() {
  applyMacroState(await api.macros.get());

  api.macros.onStatus((s) => { mac.status = s; renderMacros(); });
  api.macros.onKeyNames((names) => { mac.keyNames = names; renderMacros(); });
  api.macros.onChanged((s) => applyMacroState(s));
  api.macros.onKey(onMacroKey);
  api.macros.onMouse(onMacroMouse);

  // While the keys go to a macro, they don't scroll or click in this window.
  window.addEventListener("keydown", (e) => { if (mac.capture) e.preventDefault(); }, true);

  $("#newMacro").onclick = () => newMacro();
  const list = $("#macroList");
  list.onclick = (e) => {
    const b = e.target.closest("button[data-macro]");
    if (b) openMacro(b.dataset.macro);
  };
  list.oncontextmenu = (e) => {
    const b = e.target.closest("button[data-macro]");
    if (!b) return;
    e.preventDefault();
    macroMenu(b.dataset.macro);
  };

  $("#macroName").onchange = (e) => updateMacro((m) => { m.name = e.target.value.trim() || m.name; });
  $("#macroName").onkeydown = (e) => { if (e.key === "Enter") e.target.blur(); };
  $("#macrosOn").onchange = (e) => setMacrosEnabled(e.target.checked);
  $("#macroMore").onclick = () => mac.current && macroMenu(mac.current);
  $("#macroTest").onclick = () => testMacro();

  $("#setShortcut").onclick = () => (mac.capture && mac.capture.kind === "shortcut"
    ? stopCapture()
    : startCapture({ kind: "shortcut", down: new Set(), peak: [], peakMods: [] }));
  $("#clearShortcut").onclick = () => updateMacro((m) => { m.shortcut = null; });

  for (const r of document.querySelectorAll('input[name="repeat"]')) {
    r.onchange = () => updateMacro((m) => { m.repeat.mode = r.value; });
  }
  $("#repeatTimes").onchange = (e) => updateMacro((m) => {
    m.repeat.times = Math.min(999, Math.max(1, parseInt(e.target.value, 10) || 1));
    m.repeat.mode = "times";
  });

  $("#recordBtn").onclick = () => (mac.capture && mac.capture.kind === "record"
    ? finishRecording()
    : startCapture({
      kind: "record", base: null, lastT: 0, downAt: new Map(), presses: [],
      stopWith: currentMacro() && currentMacro().shortcut,
    }));
  $("#addPress").onclick = () => (mac.capture && mac.capture.kind === "key"
    ? stopCapture()
    : startCapture({ kind: "key", index: -1 }));
  $("#addClick").onclick = () => {
    stopCapture();
    updateMacro((m) => { m.presses.push({ button: 0, at: macroLength(m), hold: NEW_PRESS_HOLD_MS, fixed: false }); });
  };

  const presses = $("#pressList");
  presses.onclick = (e) => {
    const key = e.target.closest(".keybtn");
    if (key && key.classList.contains("click")) { clickMenu(Number(key.dataset.index)); return; }
    if (key) { startCapture({ kind: "key", index: Number(key.dataset.index) }); return; }
    const del = e.target.closest(".del");
    if (del) updateMacro((m) => { m.presses.splice(Number(del.dataset.index), 1); });
  };
  presses.onchange = (e) => {
    const input = e.target.closest("input[type=number]");
    if (!input) return;
    const i = Number(input.dataset.index);
    const ms = Math.round(Math.max(0, parseFloat(input.value) || 0) * 1000);
    updateMacro((m) => {
      const p = m.presses[i];
      if (!p) return;
      if (input.dataset.field === "at") p.at = ms;
      else p.hold = Math.max(10, ms);
    });
  };
}
