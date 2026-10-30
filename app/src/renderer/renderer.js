"use strict";

// ornata-macos — Electron desktop app, renderer logic.
// Copyright (C) 2025 André Lindner. GNU General Public License v2.0 or later.
//
// Runs in an isolated renderer (no Node). All device I/O and file access go
// through window.ornata.* (preload.js -> IPC -> the device engine in engine/).

const $ = (s) => document.querySelector(s);
const api = window.ornata;

const state = {
  layout: null,          // from api.layout()
  keyByName: {},         // NAME -> key of the layout ({ row, col, label, x, y, w, h })
  nameByCoord: {},       // "r,c" -> NAME
  colors: {},            // NAME -> "#hex" (only keys differing from bg)
  background: "#000000",
  brightness: 100,
  paint: "#44d07b",
  tab: "keyboard",       // "keyboard" | "mouse" | "macro"
  keyboardInfo: null,    // last api.status() result
  mouseInfo: null,       // last api.mouseStatus() result
  profiles: [],          // [{ name: "x.json", colors: ["#hex", …] }] in the profiles folder
  profile: null,         // the profile file the editor shows, null for an unsaved one
  draftName: "",         // title of an unsaved editor (e.g. a .json opened from a file)
  onKeyboard: null,      // the profile file applied last, null if unnamed or off
  dirty: false,          // edited since the profile was opened or saved
  applied: false,        // the keyboard shows what the editor shows
};

const PALETTE = ["#ff0000","#ff7a00","#ffd500","#00ff33","#00e5ff","#3a7afe","#a24bff","#ff2e97","#ffffff","#000000"];
const DPI_PRESETS = [800, 1600, 3200, 6400];
// How often to look for the mouse while the window is visible, so its entry
// appears/disappears when it is plugged in or out.
const MOUSE_POLL_MS = 15000;
// Size of one key unit in px, fitted to the window width within these limits.
const MIN_UNIT = 26, MAX_UNIT = 46, BOARD_PAD = 14, KEY_GAP = 4;
// Caps drawn as a symbol get a larger font.
const SYMBOL_CAP = /^[↹⇪⇧↵⌫☰↑↓←→]$/;
const PROFILE_NAME = /^[\w.-]+$/;

function toast(msg, isErr) {
  const t = $("#toast");
  t.textContent = msg;
  t.className = "show" + (isErr ? " err" : "");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.className = ""; }, 3200);
}

function contrast(hex) {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0,2),16), g = parseInt(h.slice(2,4),16), b = parseInt(h.slice(4,6),16);
  return (r*299 + g*587 + b*114) / 1000 > 140 ? "#000" : "#fff";
}
function normHex(v) {
  let h = String(v).trim().replace(/^#/, "");
  if (h.length === 3) h = h.split("").map(c=>c+c).join("");
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  return "#" + h.toLowerCase();
}
const baseName = (file) => String(file).replace(/\.json$/i, "");

// --- client-side token expansion (mirrors engine/layout.js) ---------------
// Only keys of the current layout resolve; the rest have no key to show.
function resolveName(token) {
  const raw = String(token).trim();
  const coord = raw.match(/^(\d+)\s*,\s*(\d+)$/);
  if (coord) { return state.nameByCoord[`${+coord[1]},${+coord[2]}`] || null; }
  const upper = raw.toUpperCase();
  const al = state.layout.aliases;
  const resolved = al[upper] ? al[upper] : (al[raw] || upper);
  return state.keyByName[resolved] ? resolved : null;
}
function expandNames(token, extraGroups) {
  const raw = String(token).trim();
  const upper = raw.toUpperCase();
  const groups = Object.assign({}, state.layout.groups, extraGroups || {});
  const gk = Object.keys(groups).find(g => g.toUpperCase() === upper);
  const isCoord = /^\d+\s*,\s*\d+$/.test(raw);
  if (gk && !isCoord) return groups[gk].flatMap(m => expandNames(m, extraGroups));
  if (raw.includes(",") && !isCoord) return raw.split(",").flatMap(p => expandNames(p, extraGroups));
  const n = resolveName(raw);
  return n ? [n] : [];
}

// NAME -> "#hex" for every key a scene colors (later entries win). Keys an
// older profile doesn't know take their neighbors' color, as on the keyboard
// (see FILL_BETWEEN in engine/layout.js).
function sceneKeyColors(scene) {
  const colors = {};
  const extra = scene.groups || {};
  for (const [token, color] of Object.entries(scene.keys || {})) {
    const hex = normHex(color); if (!hex) continue;
    for (const name of expandNames(token, extra)) colors[name] = hex;
  }
  for (const [name, [a, b]] of Object.entries(state.layout.fillBetween)) {
    if (state.keyByName[name] && !(name in colors) && colors[a] && colors[a] === colors[b]) colors[name] = colors[a];
  }
  return colors;
}

// Up to three colors that cover the most keys of a scene, for the sidebar.
function profileColors(scene) {
  const bg = normHex(scene.background || "#000000") || "#000000";
  const colors = sceneKeyColors(scene);
  const counts = new Map();
  for (const k of state.layout.keys) {
    const c = colors[k.name] || bg;
    counts.set(c, (counts.get(c) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([c]) => c);
}

// --- keyboard layout + board ------------------------------------------------
async function loadLayout() {
  state.layout = await api.layout();
  state.keyByName = {};
  state.nameByCoord = {};
  for (const k of state.layout.keys) {
    state.keyByName[k.name] = k;
    state.nameByCoord[`${k.row},${k.col}`] = k.name;
  }
}

function renderBoard() {
  const board = $("#board");
  board.style.setProperty("--bw", state.layout.width);
  board.style.setProperty("--bh", state.layout.height);
  board.replaceChildren(...state.layout.keys.map((k) => {
    const el = document.createElement("div");
    el.className = "key" + (k.shape ? " " + k.shape : "") + (SYMBOL_CAP.test(k.label) ? " sym" : "");
    el.dataset.name = k.name;
    el.style.cssText = `--x:${k.x};--y:${k.y};--w:${k.w};--h:${k.h}`;
    el.title = `${k.name}  (row ${k.row}, col ${k.col})`;
    const span = document.createElement("span");
    span.className = "name";
    span.textContent = k.label;
    el.appendChild(span);
    return el;
  }));
  fitBoard();
  paintPreview();
}

// Scale the keys to the space the window gives the board.
function fitBoard() {
  const wrap = $("#boardWrap");
  const cs = getComputedStyle(wrap);
  const avail = wrap.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  if (avail <= 0 || !state.layout) return;
  const unit = Math.floor((avail - 2 * BOARD_PAD + KEY_GAP) / state.layout.width);
  $("#board").style.setProperty("--u", Math.max(MIN_UNIT, Math.min(MAX_UNIT, unit)) + "px");
}

function paintKey(el) {
  const c = state.colors[el.dataset.name] || state.background;
  el.style.setProperty("--c", c);
  el.style.color = contrast(c);
}
function paintPreview() {
  for (const el of document.querySelectorAll(".key")) paintKey(el);
}
function setKey(name, color) {
  if (color === null) delete state.colors[name];
  else state.colors[name] = color;
}

// --- drag painting ----------------------------------------------------------
let painting = false, paintMode = "set";
function applyPaintTo(el) {
  if (!el || !el.classList.contains("key")) return;
  setKey(el.dataset.name, paintMode === "clear" ? null : state.paint);
  paintKey(el);
  markEdited();
}
function wireBoard() {
  const board = $("#board");
  board.addEventListener("mousedown", (e) => {
    const el = e.target.closest(".key");
    if (!el) return;
    e.preventDefault();
    painting = true;
    paintMode = (e.button === 2 || e.shiftKey) ? "clear" : "set";
    applyPaintTo(el);
  });
  board.addEventListener("mouseover", (e) => {
    if (!painting) return;
    applyPaintTo(e.target.closest(".key"));
  });
  board.addEventListener("contextmenu", (e) => { e.preventDefault(); });
  window.addEventListener("mouseup", () => { painting = false; });
  new ResizeObserver(fitBoard).observe($("#boardWrap"));
}

// --- editor state -----------------------------------------------------------
// The keys in FILL_BETWEEN are always written, so a key left at the
// background stays that way instead of taking its neighbors' color.
function currentSpec() {
  const keys = Object.assign({}, state.colors);
  for (const name of Object.keys(state.layout.fillBetween)) {
    if (state.keyByName[name] && !(name in keys)) keys[name] = state.background;
  }
  return { brightness: state.brightness, background: state.background, keys };
}

// Toolbar title and state line, plus the marks in the profile list.
function renderEditorState() {
  $("#profileTitle").textContent = state.profile ? baseName(state.profile) : (state.draftName || "Untitled");
  const parts = [];
  if (state.dirty) parts.push("Unsaved changes");
  parts.push(state.applied ? "On the keyboard" : "Not applied yet");
  const line = $("#profileState");
  line.textContent = parts.join(" · ");
  line.classList.toggle("live", state.applied);
  renderProfiles();
}
function markEdited() {
  if (state.dirty && !state.applied) return;
  state.dirty = true;
  state.applied = false;
  renderEditorState();
}

function loadSceneObject(scene) {
  state.background = normHex(scene.background || "#000000") || "#000000";
  state.brightness = (scene.brightness !== undefined) ? Number(scene.brightness) : state.brightness;
  state.colors = sceneKeyColors(scene);
  $("#bgPicker").value = state.background; $("#bgHex").value = state.background;
  $("#bright").value = state.brightness; $("#brightVal").textContent = state.brightness + "%";
  paintPreview();
}

// Show a scene in the editor. profile: its file in the profiles folder, or
// null with a draft title (a file opened from elsewhere).
function showScene(scene, profile, draftName) {
  loadSceneObject(scene);
  state.profile = profile;
  state.draftName = profile ? "" : (draftName || "");
  state.dirty = false;
  state.applied = !!profile && profile === state.onKeyboard;
  renderEditorState();
}

// --- profiles ---------------------------------------------------------------
async function refreshProfiles() {
  const names = (await api.listScenes()).scenes;
  state.profiles = await Promise.all(names.map(async (name) => {
    const d = await api.loadScene(name);
    return { name, colors: d.ok ? profileColors(d.scene) : [] };
  }));
  renderProfiles();
}

function renderProfiles() {
  $("#profileList").replaceChildren(...state.profiles.map((p) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "item";
    b.dataset.name = p.name;
    b.setAttribute("aria-current", String(p.name === state.profile));
    const dots = document.createElement("span");
    dots.className = "dots";
    dots.setAttribute("aria-hidden", "true");
    for (const c of p.colors) {
      const i = document.createElement("i");
      i.style.background = c;
      dots.appendChild(i);
    }
    const name = document.createElement("span");
    name.className = "item-name";
    name.textContent = baseName(p.name);
    b.append(dots, name);
    if (p.name === state.onKeyboard) {
      const badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = "On keyboard";
      b.appendChild(badge);
    }
    return b;
  }));
}

async function openProfile(name) {
  const d = await api.loadScene(name);
  if (!d.ok) { toast(d.error || "Load failed", true); return false; }
  showScene(d.scene, d.name);
  return true;
}

async function saveEditor() {
  if (!state.profile) { startNewProfile(state.draftName); return; }
  const r = await api.saveScene(state.profile, currentSpec());
  if (!r.ok) { toast(r.error || "Save failed", true); return; }
  state.dirty = false;
  renderEditorState();
  toast(`Saved ${baseName(r.name)}`);
  refreshProfiles();
}

// The + button: name the current colors as a new profile, right in the list.
function startNewProfile(prefill) {
  const form = $("#newProfileForm");
  const input = $("#newProfileName");
  form.hidden = false;
  input.value = prefill || "";
  input.focus();
  input.select();
}
function endNewProfile() {
  $("#newProfileForm").hidden = true;
}
async function saveNewProfile() {
  const name = $("#newProfileName").value.trim().replace(/\.json$/i, "");
  if (!name) { endNewProfile(); return; }
  if (!PROFILE_NAME.test(name)) { toast("Use letters, digits, “-”, “_” and “.” for the name.", true); return; }
  if (state.profiles.some((p) => baseName(p.name).toLowerCase() === name.toLowerCase())) {
    toast(`A profile named “${name}” already exists.`, true);
    return;
  }
  const r = await api.saveScene(name, currentSpec());
  if (!r.ok) { toast(r.error || "Save failed", true); return; }
  endNewProfile();
  state.profile = r.name;
  state.draftName = "";
  state.dirty = false;
  renderEditorState();
  toast(`Saved profile ${baseName(r.name)}`);
  refreshProfiles();
}

// The default profile is the fallback for the tray and launch; it can only be
// overwritten, not deleted.
async function deleteProfile(name) {
  const r = await api.deleteScene(name);
  if (r.canceled) return;
  if (!r.ok) { toast(r.error || "Delete failed", true); return; }
  if (state.profile === r.name) {
    // The colors stay in the editor as an unsaved profile.
    state.profile = null;
    state.draftName = baseName(r.name);
    state.dirty = true;
  }
  if (state.onKeyboard === r.name) state.onKeyboard = null;
  renderEditorState();
  await refreshProfiles();
  const shown = baseName(r.name);
  if (r.warning) toast(`Deleted ${shown}. The backup failed: ${r.warning}`, true);
  else toast(`Deleted ${shown}`);
}

async function profileMenu(name) {
  const choice = await api.popupMenu([
    { id: "open", label: "Open" },
    { id: "apply", label: "Apply to Keyboard" },
    { type: "separator" },
    { id: "delete", label: `Delete “${baseName(name)}”…`, enabled: name !== "default.json" },
  ]);
  if (choice === "open") openProfile(name);
  else if (choice === "apply") { if (await openProfile(name)) applyEditor(); }
  else if (choice === "delete") deleteProfile(name);
}

async function moreMenu() {
  const cur = state.profile;
  const choice = await api.popupMenu([
    { id: "default", label: "Apply Default Profile" },
    { type: "separator" },
    { id: "openFile", label: "Open .json…" },
    { id: "saveFile", label: "Save to File…" },
    { type: "separator" },
    { id: "delete", label: cur ? `Delete “${baseName(cur)}”…` : "Delete…", enabled: !!cur && cur !== "default.json" },
    { id: "folder", label: "Show Profiles Folder" },
  ]);
  if (choice === "default") applyDefault();
  else if (choice === "openFile") openFile();
  else if (choice === "saveFile") saveFile();
  else if (choice === "delete") deleteProfile(cur);
  else if (choice === "folder") api.settings.showProfiles();
}

async function openFile() {
  const d = await api.loadSceneFile();
  if (d.canceled) return;
  if (!d.ok) { toast(d.error || "Could not read that file", true); return; }
  showScene(d.scene, null, baseName(d.name));
  toast(`Opened ${d.name}`);
}
async function saveFile() {
  const suggested = state.profile ? baseName(state.profile) : (state.draftName || "profile");
  const r = await api.saveSceneFile(currentSpec(), suggested);
  if (r.canceled) return;
  if (r.ok) toast(`Saved ${r.name}`);
  else toast(r.error || "Save failed", true);
}

// --- keyboard actions -------------------------------------------------------
function handleDeviceResult(r, okMsg) {
  if (r.ok) { toast(okMsg); refreshStatus(); }
  else if (r.code === "DEVICE_BUSY") { toast("Quit the “Razer macOS” menu-bar app first, then try again.", true); refreshStatus(); }
  else { toast(r.error || "Failed", true); }
}

async function applyEditor() {
  const r = await api.applyKeyboard(currentSpec(), state.profile);
  if (r.ok) {
    state.onKeyboard = state.profile;
    state.applied = true;
    renderEditorState();
  }
  handleDeviceResult(r, r.ok ? `Applied ${r.litCells} cell(s) to ${r.device}.` : "");
}
async function applyDefault() {
  if (!(await openProfile("default"))) return;
  await applyEditor();
}
async function turnOff() {
  const r = await api.keyboardOff();
  if (r.ok) {
    state.onKeyboard = null;
    state.applied = false;
    renderEditorState();
  }
  handleDeviceResult(r, "Keyboard turned off.");
}

// --- devices ----------------------------------------------------------------
function deviceStatus(info, isMouse) {
  if (!info) return { text: "Checking…", dot: "" };
  if (info.ok) {
    return { text: isMouse && info.dpi != null ? `Connected · ${info.dpi} DPI` : "Connected", dot: "ok" };
  }
  const text = {
    DEVICE_BUSY: "Quit “Razer macOS” first",
    NO_ADDON: "addon.node missing",
    APP_ERROR: "App error",
  }[info.code] || "Not found";
  return { text, dot: "err" };
}

function renderDevices() {
  const k = deviceStatus(state.keyboardInfo, false);
  $("#kbdName").textContent = state.keyboardInfo && state.keyboardInfo.ok ? state.keyboardInfo.name : "Keyboard";
  $("#kbdSub").textContent = k.text;
  $("#kbdDot").className = "dot " + k.dot;

  const m = deviceStatus(state.mouseInfo, true);
  const mouse = state.mouseInfo && state.mouseInfo.ok ? state.mouseInfo : null;
  $("#devMouse").hidden = !mouse;
  $("#mouseName").textContent = mouse ? mouse.name : "Mouse";
  $("#mouseSub").textContent = m.text;
  $("#mouseDot").className = "dot " + m.dot;
  $("#mouseTitle").textContent = mouse ? mouse.name : "Mouse";
  $("#mouseState").textContent = m.text;
}

async function refreshStatus() {
  try {
    state.keyboardInfo = await api.status();
  } catch (e) {
    state.keyboardInfo = { ok: false, code: "APP_ERROR" };
  }
  renderDevices();
}

// The mouse only shows while a supported mouse (Basilisk V3) is found.
async function refreshMouseStatus() {
  let info;
  try { info = await api.mouseStatus(); } catch (e) { info = { ok: false, code: "APP_ERROR" }; }
  state.mouseInfo = info;
  if (info.ok) {
    if (info.dpi != null && !$("#mDpi").value) $("#mDpi").value = info.dpi;
  } else if (state.tab === "mouse") {
    showTab("keyboard");
    toast(info.code === "DEVICE_BUSY" ? "Mouse busy — quit the “Razer macOS” app first." : "Mouse disconnected.", true);
  }
  renderDevices();
}

function showTab(tab) {
  state.tab = tab;
  $("#devKeyboard").setAttribute("aria-current", String(tab === "keyboard"));
  $("#devMouse").setAttribute("aria-current", String(tab === "mouse"));
  $("#panelKeyboard").hidden = tab !== "keyboard";
  $("#panelMouse").hidden = tab !== "mouse";
  $("#panelMacro").hidden = tab !== "macro";
  macrosTabChanged(tab);
}

// --- mouse ------------------------------------------------------------------
async function mouseApply(opts, okMsg) {
  const r = await api.mouse(opts);
  if (r.ok) { toast(okMsg); refreshMouseStatus(); }
  else if (r.code === "DEVICE_BUSY") { toast("Quit the “Razer macOS” menu-bar app first, then try again.", true); refreshMouseStatus(); }
  else { toast(r.error || "Failed", true); }
}

let mPaint = "#3a7afe";
function setMPaint(v) {
  const h = normHex(v); if (!h) return;
  mPaint = h; $("#mColor").value = h; $("#mColorHex").value = h;
}

function setPaint(hex) {
  const h = normHex(hex); if (!h) return;
  state.paint = h; $("#picker").value = h; $("#hex").value = h;
}

function swatchButton(color, onPick) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "swatch";
  b.style.background = color;
  b.title = color;
  b.setAttribute("aria-label", color);
  b.onclick = () => onPick(color);
  return b;
}

// The window opens at the height of the keyboard view (see main.js).
function contentHeight() {
  const cs = getComputedStyle($("#content"));
  return $("#contentInner").offsetHeight + parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
}

// --- init -------------------------------------------------------------------
async function init() {
  await loadLayout();
  renderBoard();
  wireBoard();

  $("#swatches").append(...PALETTE.map((c) => swatchButton(c, setPaint)));
  $("#groupBtns").append(...Object.keys(state.layout.groups).map((g) => {
    const b = document.createElement("button");
    b.textContent = g; b.type = "button";
    b.onclick = () => {
      for (const name of expandNames(g)) setKey(name, state.paint);
      paintPreview();
      markEdited();
      toast(`Painted group ${g}`);
    };
    return b;
  }));
  $("#mSwatches").append(...PALETTE.map((c) => swatchButton(c, setMPaint)));
  $("#mDpiPresets").append(...DPI_PRESETS.map((v) => {
    const b = document.createElement("button");
    b.type = "button"; b.textContent = v;
    b.onclick = () => { $("#mDpi").value = v; mouseApply({ dpi: v }, `Mouse DPI ${v}`); };
    return b;
  }));

  wireControls();
  initMacros();

  const info = await api.appInfo();
  $("#version").textContent = `v${info.version}`;
  document.title = `${info.name} ${info.version}`;

  // Show the profile that is currently on the keyboard (applied at launch or
  // from the tray) instead of starting from an empty board.
  const cur = await api.currentScene();
  if (cur && cur.scene) {
    state.onKeyboard = cur.name;
    showScene(cur.scene, cur.name);
    state.applied = true;
  }
  renderEditorState();
  await refreshProfiles();

  api.reportContentHeight(contentHeight());

  refreshStatus();
  refreshMouseStatus();
  window.addEventListener("focus", refreshMouseStatus);
  setInterval(() => { if (!document.hidden) refreshMouseStatus(); }, MOUSE_POLL_MS);

  // A restore from a backup changed the profiles folder.
  api.onProfilesChanged(() => refreshProfiles());

  // Another layout was picked in the settings: same colors, other key caps.
  api.onLayoutChanged(async () => {
    const spec = currentSpec();
    await loadLayout();
    renderBoard();
    loadSceneObject(spec);
    refreshProfiles();
  });

  // The tray applied the default profile or turned the keyboard off.
  api.onSceneLoaded((applied) => {
    if (applied && applied.name && applied.scene) {
      state.onKeyboard = applied.name;
      showScene(applied.scene, applied.name);
      toast(`${baseName(applied.name)} applied`);
    } else {
      state.onKeyboard = null;
      state.applied = false;
      renderEditorState();
      toast("Keyboard turned off");
    }
    refreshStatus();
  });
}

function wireControls() {
  for (const b of [$("#devKeyboard"), $("#devMouse")]) {
    b.title = "Click again to check the connection";
    b.onclick = () => {
      if (state.tab !== b.dataset.tab) showTab(b.dataset.tab);
      else if (b.dataset.tab === "mouse") refreshMouseStatus();
      else refreshStatus();
    };
  }
  $("#openSettings").onclick = () => api.openSettings();

  const list = $("#profileList");
  list.onclick = (e) => {
    const b = e.target.closest("button[data-name]");
    if (b) openProfile(b.dataset.name);
  };
  list.oncontextmenu = (e) => {
    const b = e.target.closest("button[data-name]");
    if (!b) return;
    e.preventDefault();
    profileMenu(b.dataset.name);
  };
  $("#newProfile").onclick = () => ($("#newProfileForm").hidden ? startNewProfile("") : endNewProfile());
  $("#newProfileForm").onsubmit = (e) => { e.preventDefault(); saveNewProfile(); };
  $("#newProfileName").onkeydown = (e) => { if (e.key === "Escape") endNewProfile(); };

  $("#moreActions").onclick = () => moreMenu();
  $("#save").onclick = () => saveEditor();
  $("#apply").onclick = () => applyEditor();
  $("#off").onclick = () => turnOff();
  $("#reset").onclick = () => {
    state.colors = {}; state.background = "#000000"; state.brightness = 100;
    $("#bgPicker").value = "#000000"; $("#bgHex").value = "#000000";
    $("#bright").value = 100; $("#brightVal").textContent = "100%";
    paintPreview();
    state.profile = null; state.draftName = ""; state.dirty = false; state.applied = false;
    renderEditorState();
    toast("Editor reset (the keyboard keeps its colors)");
  };

  $("#picker").oninput = (e) => setPaint(e.target.value);
  $("#hex").onchange = (e) => { const h = normHex(e.target.value); if (h) setPaint(h); else e.target.value = state.paint; };

  $("#bgPicker").oninput = (e) => { state.background = e.target.value; $("#bgHex").value = e.target.value; paintPreview(); markEdited(); };
  $("#bgHex").onchange = (e) => {
    const h = normHex(e.target.value);
    if (!h) { e.target.value = state.background; return; }
    state.background = h; $("#bgPicker").value = h; $("#bgHex").value = h; paintPreview(); markEdited();
  };
  $("#applyBg").onclick = () => { state.colors = {}; paintPreview(); markEdited(); toast("Cleared all keys to the background"); };

  $("#bright").oninput = (e) => { state.brightness = Number(e.target.value); $("#brightVal").textContent = state.brightness + "%"; markEdited(); };

  // mouse controls
  $("#mColor").oninput = (e) => setMPaint(e.target.value);
  $("#mColorHex").onchange = (e) => { const h = normHex(e.target.value); if (h) setMPaint(h); else e.target.value = mPaint; };
  $("#mApplyColor").onclick = () => mouseApply({ mode: "static", color: mPaint }, `Mouse set to ${mPaint}`);
  $("#mSpectrum").onclick = () => mouseApply({ mode: "spectrum" }, "Mouse set to spectrum");
  $("#mWave").onclick = () => mouseApply({ mode: "wave" }, "Mouse set to wave");
  $("#mOff").onclick = () => mouseApply({ mode: "off" }, "Mouse lighting off");
  $("#mBright").oninput = (e) => { $("#mBrightVal").textContent = e.target.value + "%"; };
  $("#mApplyBright").onclick = () => mouseApply({ brightness: Number($("#mBright").value) }, `Mouse brightness ${$("#mBright").value}%`);
  $("#mApplyDpi").onclick = () => {
    const v = parseInt($("#mDpi").value, 10);
    if (!Number.isFinite(v)) { toast("Enter a DPI number", true); return; }
    mouseApply({ dpi: v }, `Mouse DPI ${v}`);
  };
}

init().catch(e => toast("Init failed: " + e.message, true));
