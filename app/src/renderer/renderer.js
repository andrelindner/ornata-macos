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
  keyByName: {},         // NAME -> {row,col,label}
  nameByCoord: {},       // "r,c" -> NAME
  colors: {},            // NAME -> "#hex" (only keys differing from bg)
  background: "#000000",
  brightness: 100,
  paint: "#44d07b",
  tab: "keyboard",       // "keyboard" | "mouse"
  keyboardInfo: null,    // last api.status() result
  mouseInfo: null,       // last api.mouseStatus() result
};

const PALETTE = ["#ff0000","#ff7a00","#ffd500","#00ff33","#00e5ff","#3a7afe","#a24bff","#ff2e97","#ffffff","#000000"];
const DPI_PRESETS = [800, 1600, 3200, 6400];
// How often to look for the mouse while the window is visible, so its tab
// appears/disappears when it is plugged in or out.
const MOUSE_POLL_MS = 15000;

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

// --- client-side token expansion (mirrors engine/layout.js) ---------------
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

// --- rendering --------------------------------------------------------------
function renderBoard() {
  const board = $("#board");
  board.innerHTML = "";
  for (const k of state.layout.keys) {
    const el = document.createElement("div");
    el.className = "key";
    el.dataset.name = k.name;
    el.style.gridColumn = (k.col + 1);
    el.style.gridRow = (k.row + 1);
    el.title = `${k.name}  (row ${k.row}, col ${k.col})`;
    const span = document.createElement("span");
    span.className = "name";
    span.textContent = k.label;
    el.appendChild(span);
    board.appendChild(el);
  }
  paintPreview();
}
function paintPreview() {
  for (const el of document.querySelectorAll(".key")) {
    const c = state.colors[el.dataset.name] || state.background;
    el.style.background = c;
    el.style.color = contrast(c);
  }
}
function setKey(name, color) {
  if (color === null) delete state.colors[name];
  else state.colors[name] = color;
}

// --- drag painting ----------------------------------------------------------
let painting = false, paintMode = "set";
function applyPaintTo(el) {
  if (!el || !el.classList.contains("key")) return;
  const name = el.dataset.name;
  if (paintMode === "clear") setKey(name, null);
  else setKey(name, state.paint);
  const c = state.colors[name] || state.background;
  el.style.background = c; el.style.color = contrast(c);
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
}

// --- spec / status ----------------------------------------------------------
function currentSpec() {
  return { brightness: state.brightness, background: state.background, keys: Object.assign({}, state.colors) };
}
async function refreshStatus() {
  const s = $("#status");
  s.className = ""; s.querySelector(".txt").textContent = "Checking…";
  try {
    state.keyboardInfo = await api.status();
  } catch (e) {
    state.keyboardInfo = { ok: false, code: "APP_ERROR" };
  }
  $("#tabKeyboard").textContent = state.keyboardInfo.ok ? state.keyboardInfo.name : "Keyboard";
  renderStatus();
}

// The status pill describes the device of the active tab.
function renderStatus() {
  const s = $("#status");
  const txt = s.querySelector(".txt");
  const info = state.tab === "mouse" ? state.mouseInfo : state.keyboardInfo;
  if (!info) { s.className = ""; txt.textContent = "Checking…"; return; }
  if (info.ok) {
    s.className = "ok";
    txt.textContent = `${info.name} connected` + (state.tab === "mouse" && info.dpi != null ? ` · ${info.dpi} DPI` : "");
  } else if (info.code === "DEVICE_BUSY") {
    s.className = "busy"; txt.textContent = "Quit “Razer macOS” app first";
  } else if (info.code === "NO_ADDON") {
    s.className = "err"; txt.textContent = "addon.node missing";
  } else if (info.code === "APP_ERROR") {
    s.className = "err"; txt.textContent = "App error";
  } else {
    s.className = "err"; txt.textContent = state.tab === "mouse" ? "No mouse found" : "No keyboard found";
  }
}

// --- tabs -------------------------------------------------------------------
function showTab(tab) {
  state.tab = tab;
  for (const b of document.querySelectorAll(".tabs button")) {
    const on = b.dataset.tab === tab;
    b.classList.toggle("active", on);
    b.setAttribute("aria-selected", String(on));
  }
  $("#panelKeyboard").hidden = tab !== "keyboard";
  $("#panelMouse").hidden = tab !== "mouse";
  renderStatus();
}

function handleDeviceResult(r, okMsg) {
  if (r.ok) { toast(okMsg); refreshStatus(); }
  else if (r.code === "DEVICE_BUSY") { toast("Quit the “Razer macOS” menu-bar app first, then try again.", true); refreshStatus(); }
  else { toast(r.error || "Failed", true); }
}

// --- mouse ------------------------------------------------------------------
// The mouse tab only exists while a supported mouse (Basilisk V3) is found.
async function refreshMouseStatus() {
  let info;
  try { info = await api.mouseStatus(); } catch (e) { info = { ok: false, code: "APP_ERROR" }; }
  state.mouseInfo = info;
  const tabBtn = $("#tabMouse");
  tabBtn.hidden = !info.ok;
  if (info.ok) {
    tabBtn.textContent = info.name;
    $("#mouseStatus").textContent = `${info.name} connected` + (info.dpi != null ? `, currently ${info.dpi} DPI.` : ".");
    if (info.dpi != null && !$("#mDpi").value) $("#mDpi").value = info.dpi;
  } else if (state.tab === "mouse") {
    showTab("keyboard");
    toast(info.code === "DEVICE_BUSY" ? "Mouse busy — quit the “Razer macOS” app first." : "Mouse disconnected.", true);
  }
  renderStatus();
}
async function mouseApply(opts, okMsg) {
  const r = await api.mouse(opts);
  if (r.ok) { toast(okMsg); refreshMouseStatus(); }
  else if (r.code === "DEVICE_BUSY") { toast("Quit the “Razer macOS” menu-bar app first, then try again.", true); refreshMouseStatus(); }
  else { toast(r.error || "Failed", true); }
}

// --- loading a scene into the editor ---------------------------------------
function loadSceneObject(scene) {
  state.background = normHex(scene.background || "#000000") || "#000000";
  state.brightness = (scene.brightness !== undefined) ? Number(scene.brightness) : state.brightness;
  state.colors = {};
  const extra = scene.groups || {};
  for (const [token, color] of Object.entries(scene.keys || {})) {
    const hex = normHex(color); if (!hex) continue;
    for (const name of expandNames(token, extra)) state.colors[name] = hex;
  }
  $("#bgPicker").value = state.background; $("#bgHex").value = state.background;
  $("#bright").value = state.brightness; $("#brightVal").textContent = state.brightness + "%";
  paintPreview();
}

// --- init -------------------------------------------------------------------
async function init() {
  state.layout = await api.layout();
  for (const k of state.layout.keys) {
    state.keyByName[k.name] = k;
    state.nameByCoord[`${k.row},${k.col}`] = k.name;
  }
  renderBoard();
  wireBoard();

  const sw = $("#swatches");
  for (const c of PALETTE) {
    const d = document.createElement("div");
    d.className = "swatch"; d.style.background = c; d.title = c;
    d.onclick = () => setPaint(c);
    sw.appendChild(d);
  }
  const gb = $("#groupBtns");
  for (const g of Object.keys(state.layout.groups)) {
    const b = document.createElement("button");
    b.textContent = g; b.type = "button";
    b.onclick = () => {
      for (const name of expandNames(g)) setKey(name, state.paint);
      paintPreview();
      toast(`Painted group ${g}`);
    };
    gb.appendChild(b);
  }
  await fillSceneSelect();

  const msw = $("#mSwatches");
  for (const c of PALETTE) {
    const d = document.createElement("div");
    d.className = "swatch"; d.style.background = c; d.title = c;
    d.onclick = () => setMPaint(c);
    msw.appendChild(d);
  }
  const dp = $("#mDpiPresets");
  for (const v of DPI_PRESETS) {
    const b = document.createElement("button");
    b.type = "button"; b.textContent = v;
    b.onclick = () => { $("#mDpi").value = v; mouseApply({ dpi: v }, `Mouse DPI ${v}`); };
    dp.appendChild(b);
  }

  wireControls();

  const info = await api.appInfo();
  $("#version").textContent = `v${info.version}`;
  document.title = `${info.name} ${info.version}`;

  // The keyboard tab is the tallest view; the window opens at its height.
  api.reportContentHeight(document.documentElement.scrollHeight);

  // Show the profile that is currently on the keyboard (applied at launch or
  // from the tray) instead of starting from an empty board.
  const cur = await api.currentScene();
  if (cur && cur.scene) loadSceneObject(cur.scene);

  refreshStatus();
  refreshMouseStatus();
  window.addEventListener("focus", refreshMouseStatus);
  setInterval(() => { if (!document.hidden) refreshMouseStatus(); }, MOUSE_POLL_MS);

  // A restore from a backup changed the profiles folder.
  api.onProfilesChanged(() => fillSceneSelect());

  // The tray "Apply Default Profile" reflects into the editor.
  api.onSceneLoaded(async (applied) => {
    if (applied && applied.scene) {
      loadSceneObject(applied.scene);
    } else {
      const d = await api.loadScene("default");
      if (d.ok) loadSceneObject(d.scene);
    }
    toast("Default profile applied");
    refreshStatus();
  });
}

async function fillSceneSelect() {
  const sel = $("#sceneSelect");
  const keep = sel.value;
  sel.length = 1; // keep the "choose a profile" placeholder
  for (const f of (await api.listScenes()).scenes) {
    const o = document.createElement("option"); o.value = f; o.textContent = f; sel.appendChild(o);
  }
  sel.value = [...sel.options].some(o => o.value === keep) ? keep : "";
  updateDeleteButton();
}

// The default profile is the fallback for the tray and launch; it can only be
// overwritten, not deleted.
function updateDeleteButton() {
  const name = $("#sceneSelect").value;
  const btn = $("#deleteScene");
  btn.disabled = !name || name === "default.json";
  btn.title = name === "default.json" ? "The default profile can’t be deleted" : "";
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

function wireControls() {
  $("#status").onclick = () => (state.tab === "mouse" ? refreshMouseStatus() : refreshStatus());
  $("#openSettings").onclick = () => api.openSettings();
  for (const b of document.querySelectorAll(".tabs button")) b.onclick = () => showTab(b.dataset.tab);
  $("#picker").oninput = (e) => setPaint(e.target.value);
  $("#hex").onchange = (e) => { const h = normHex(e.target.value); if (h) setPaint(h); else e.target.value = state.paint; };

  $("#bgPicker").oninput = (e) => { state.background = e.target.value; $("#bgHex").value = e.target.value; paintPreview(); };
  $("#bgHex").onchange = (e) => { const h = normHex(e.target.value); if (h) { state.background = h; $("#bgPicker").value = h; $("#bgHex").value = h; paintPreview(); } else e.target.value = state.background; };
  $("#applyBg").onclick = () => { state.colors = {}; paintPreview(); toast("Cleared all keys to background"); };

  $("#bright").oninput = (e) => { state.brightness = Number(e.target.value); $("#brightVal").textContent = state.brightness + "%"; };

  $("#apply").onclick = async () => {
    const r = await api.applyKeyboard(currentSpec());
    handleDeviceResult(r, r.ok ? `Applied ${r.litCells} cell(s) to ${r.device}.` : "");
  };
  $("#off").onclick = async () => {
    const r = await api.keyboardOff();
    handleDeviceResult(r, "Keyboard turned off.");
  };
  $("#loadDefault").onclick = async () => {
    const d = await api.loadScene("default");
    if (!d.ok) { toast(d.error || "No default profile", true); return; }
    loadSceneObject(d.scene);
    const r = await api.applyKeyboard(currentSpec());
    handleDeviceResult(r, r.ok ? `Loaded & applied default profile (${r.litCells} cells).` : "");
  };
  $("#reset").onclick = () => {
    state.colors = {}; state.background = "#000000"; state.brightness = 100;
    $("#bgPicker").value = "#000000"; $("#bgHex").value = "#000000";
    $("#bright").value = 100; $("#brightVal").textContent = "100%";
    paintPreview(); toast("Editor reset (not sent to keyboard)");
  };

  $("#loadScene").onclick = async () => {
    const name = $("#sceneSelect").value;
    if (!name) { toast("Choose a profile first", true); return; }
    const d = await api.loadScene(name);
    if (!d.ok) { toast(d.error || "Load failed", true); return; }
    loadSceneObject(d.scene);
    toast(`Loaded ${name} into editor`);
  };
  $("#sceneSelect").onchange = updateDeleteButton;
  $("#deleteScene").onclick = async () => {
    const name = $("#sceneSelect").value;
    if (!name) return;
    const r = await api.deleteScene(name);
    if (r.canceled) return;
    if (!r.ok) { toast(r.error || "Delete failed", true); return; }
    await fillSceneSelect();
    if (r.warning) toast(`Deleted ${r.name} — backup failed: ${r.warning}`, true);
    else toast(r.retired ? `Deleted ${r.name} — the backup keeps it ${r.kept}` : `Deleted ${r.name} — moved to the Trash`);
  };
  $("#loadFile").onclick = async () => {
    const d = await api.loadSceneFile();
    if (d.canceled) return;
    if (!d.ok) { toast(d.error || "Could not read that file", true); return; }
    loadSceneObject(d.scene);
    toast(`Loaded ${d.name} into editor`);
  };
  $("#saveScene").onclick = async () => {
    const name = $("#saveName").value.trim();
    if (!name) { toast("Enter a name to save", true); return; }
    const r = await api.saveScene(name, currentSpec());
    if (r.ok) {
      toast(`Saved profile ${r.name}`);
      const sel = $("#sceneSelect");
      if (![...sel.options].some(o => o.value === r.name)) {
        const o = document.createElement("option"); o.value = r.name; o.textContent = r.name; sel.appendChild(o);
      }
    } else toast(r.error || "Save failed", true);
  };
  $("#saveFile").onclick = async () => {
    const suggested = ($("#saveName").value.trim() || "profile").replace(/\.json$/,"");
    const r = await api.saveSceneFile(currentSpec(), suggested);
    if (r.canceled) return;
    if (r.ok) toast(`Saved ${r.name}`);
    else toast(r.error || "Save failed", true);
  };

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
