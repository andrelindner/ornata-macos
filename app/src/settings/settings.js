"use strict";

// ornata-macos — Electron desktop app, settings window logic.
// Copyright (C) 2025 André Lindner. GNU General Public License v2.0 or later.
//
// Runs in an isolated renderer (no Node). Every action goes through
// window.ornata.settings.* and returns the new settings state, which is then
// rendered as a whole — the main process stays the single source of truth.

const $ = (s) => document.querySelector(s);
const api = window.ornata.settings;

const TABS = { general: "General", backup: "Backup", icloud: "iCloud" };
let state = null;

// --- helpers ----------------------------------------------------------------
function el(tag, props, ...children) {
  const e = document.createElement(tag);
  Object.assign(e, props || {});
  for (const c of children) e.append(c);
  return e;
}

function formatDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d) ? "" : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

// Shorten a path for display: iCloud Drive and the home folder by name.
function prettyPath(p) {
  if (!p) return "";
  if (p === state.icloud.root || p.startsWith(state.icloud.root + "/")) {
    return "iCloud Drive" + p.slice(state.icloud.root.length);
  }
  return p.startsWith(state.home + "/") ? "~" + p.slice(state.home.length) : p;
}

function swatch(hex) {
  const s = el("span", { className: "swatch" });
  s.style.background = hex;
  return s;
}

function showStatus(ok, message) {
  $("#backupStatusWrap").hidden = false;
  const s = $("#backupStatus");
  s.className = "status " + (ok ? "ok" : "bad");
  s.querySelector(".icon").textContent = ok ? "✓" : "✕";
  s.querySelector(".msg").textContent = message;
  $("#backupStatusWrap").scrollIntoView({ block: "nearest", behavior: "smooth" });
}

// --- tabs -------------------------------------------------------------------
function showTab(tab) {
  if (!TABS[tab]) tab = "general";
  for (const b of document.querySelectorAll("#toolbar button")) b.classList.toggle("active", b.dataset.tab === tab);
  for (const t of Object.keys(TABS)) $(`#pane-${t}`).hidden = t !== tab;
  $("#title").textContent = TABS[tab];
  document.title = TABS[tab];
  $("main").scrollTop = 0;
}

// --- render -----------------------------------------------------------------
function render(next) {
  if (next) state = next;
  const c = state.config;

  // General
  const li = state.loginItem;
  $("#loginItem").checked = li.enabled;
  $("#loginItem").disabled = !li.available;
  $("#loginNote").textContent = li.note || "";
  $("#loginWarning").hidden = !li.warning;
  $("#loginWarning").textContent = li.warning || "";
  $("#openLoginItems").hidden = !li.needsApproval;

  for (const input of document.querySelectorAll("[data-setting]")) {
    const v = !!c[input.dataset.setting];
    input.checked = input.hasAttribute("data-invert") ? !v : v;
  }

  const stored = $("#startupStored");
  stored.replaceChildren(c.startupColor ? swatch(c.startupColor) : "", c.startupColor || "not set by this app");
  const sel = $("#startupChoice");
  const keep = sel.value;
  sel.replaceChildren();
  const main = state.startup.mainColor;
  sel.append(el("option", { value: main || "", disabled: !main, textContent: main ? `Main color of the current profile (${main})` : "Main color of the current profile" }));
  for (const [name, hex] of state.startup.presets) sel.append(el("option", { value: hex, textContent: `${name} (${hex})` }));
  sel.append(el("option", { value: "#000000", textContent: "Off — dark until the app starts" }));
  sel.value = [...sel.options].some((o) => o.value === keep && !o.disabled) ? keep : (main || state.startup.presets[0][1]);

  $("#profilesDir").textContent = prettyPath(state.profilesDir);
  $("#profilesDir").title = state.profilesDir;
  $("#version").textContent = state.version;

  // Backup
  const b = state.backup;
  $("#backupDir").textContent = b.dir ? prettyPath(b.dir) : "No folder chosen yet.";
  $("#backupDir").title = b.dir || "";
  $("#backupUnreachable").hidden = !b.dir || b.reachable;
  $("#revealDir").hidden = !b.dir;
  $("#removeDir").hidden = !b.dir;
  $("#autoBackup").disabled = !b.dir;
  $("#backupNow").disabled = !b.dir;
  $("#lastBackupRow").hidden = !c.lastBackupAt;
  $("#lastBackup").textContent = formatDate(c.lastBackupAt);
  $("#retention").value = String(c.backupRetentionDays);

  // iCloud
  const ic = state.icloud;
  const headline = $("#icloudHeadline");
  $("#icloudActionRow").hidden = true;
  if (b.inICloud) {
    headline.textContent = "✓ The backup goes to iCloud Drive";
    headline.className = "headline ok";
    $("#icloudDetail").textContent = "Profiles and settings reach your other Macs through iCloud. On another Mac: Settings → Backup → Restore from Backup…, then choose the same folder.";
  } else if (ic.available) {
    headline.textContent = "iCloud Drive is available";
    headline.className = "headline";
    $("#icloudDetail").textContent = b.dir
      ? "The backup currently goes to a folder outside iCloud Drive."
      : "No backup folder is set yet.";
    $("#icloudActionRow").hidden = false;
  } else {
    headline.textContent = "iCloud Drive is not turned on";
    headline.className = "headline off";
    $("#icloudDetail").textContent = "Turn it on in System Settings → Apple Account → iCloud → iCloud Drive, then come back here.";
  }
  $("#icloudFolderNote").textContent = b.inICloud
    ? `Folder: ${prettyPath(b.dir)}`
    : (ic.available ? `“Back Up to iCloud Drive” uses the folder ${prettyPath(ic.folder)}.` : "");
  const mark = $("#markDrive");
  mark.textContent = b.inICloud ? "●" : "○";
  mark.className = "mark" + (b.inICloud ? " done" : "");
}

// --- restore sheet ----------------------------------------------------------
let preview = null;

function openRestoreSheet(p) {
  preview = p;
  const meta = $("#restoreMeta");
  meta.replaceChildren();
  const row = (label, value) => meta.append(el("div", { className: "item" },
    el("span", { className: "label", textContent: label }), el("span", { className: "value", textContent: value })));
  if (p.createdAt) row("Created", formatDate(p.createdAt));
  if (p.createdOnHost) row("On Mac", p.createdOnHost);
  if (p.appVersion) row("App version", p.appVersion);
  row("Contains", `${p.profiles.length} profile${p.profiles.length === 1 ? "" : "s"}${p.hasSettings ? " and settings" : ""}`);
  $("#restoreLegacy").hidden = !p.legacy;

  renderRestoreProfiles();

  const removed = $("#restoreRemoved");
  removed.replaceChildren();
  $("#restoreRemovedWrap").hidden = !p.removedProfiles.length;
  for (const r of p.removedProfiles) {
    const box = el("input", { type: "checkbox", className: "switch" });
    box.dataset.name = r.name;
    removed.append(el("div", { className: "item" },
      el("div", { className: "label" }, r.name, el("div", { className: "caption", textContent: `deleted ${formatDate(r.removedAt)}` })),
      box));
  }

  $("#restoreSettings").checked = p.hasSettings;
  $("#restoreSettings").disabled = !p.hasSettings;
  $("#restoreOverwrite").checked = false;
  const collisions = p.profiles.filter((x) => x.existsLocally).length;
  $("#overwriteRow").hidden = !collisions;
  $("#overwriteInfo").hidden = !collisions;
  $("#overwriteNote").textContent = `${collisions} of these profiles already exist here. Without this option the local files stay untouched.`;
  $("#restoreVeil").hidden = false;
  $("#restoreConfirm").focus();
}

function renderRestoreProfiles() {
  const list = $("#restoreProfiles");
  const overwrite = $("#restoreOverwrite").checked;
  list.replaceChildren();
  if (!preview.profiles.length) {
    list.append(el("div", { className: "item caption", textContent: "No profiles in this backup." }));
  }
  for (const p of preview.profiles) {
    const tag = p.existsLocally
      ? el("span", { className: "tag" + (overwrite ? " replace" : ""), textContent: overwrite ? "will be replaced" : "stays as it is" })
      : el("span", { className: "tag", textContent: "new" });
    list.append(el("div", { className: "item" }, el("span", { className: "label", textContent: p.name }), tag));
  }
}

function closeRestoreSheet() {
  $("#restoreVeil").hidden = true;
  preview = null;
}

// --- wiring -----------------------------------------------------------------
function wire() {
  for (const b of document.querySelectorAll("#toolbar button")) b.onclick = () => showTab(b.dataset.tab);

  $("#loginItem").onchange = async (e) => render(await api.setLoginItem(e.target.checked));
  $("#openLoginItems").onclick = () => api.openLoginItems();

  for (const input of document.querySelectorAll("[data-setting]")) {
    input.onchange = async () => {
      const v = input.hasAttribute("data-invert") ? !input.checked : input.checked;
      render(await api.set(input.dataset.setting, v));
    };
  }
  $("#retention").onchange = async (e) => render(await api.set("backupRetentionDays", Number(e.target.value)));

  $("#storeStartup").onclick = async () => {
    const color = $("#startupChoice").value;
    if (!color) return;
    const btn = $("#storeStartup");
    btn.disabled = true;
    const r = await api.storeStartupColor(color);
    btn.disabled = false;
    render(r.state);
    $("#startupResultRow").hidden = false;
    const res = $("#startupResult");
    res.className = r.ok ? "caption" : "err";
    res.textContent = r.ok
      ? `Stored ${color} on the ${r.device}.`
      : (r.code === "DEVICE_BUSY" ? "The keyboard is busy — quit the “Razer macOS” app first." : (r.error || "Storing failed."));
  };
  $("#showProfiles").onclick = () => api.showProfiles();

  $("#chooseDir").onclick = async () => render(await api.chooseBackupDir());
  $("#revealDir").onclick = () => api.revealBackupDir();
  $("#removeDir").onclick = async () => render(await api.removeBackupDir());
  $("#useICloud").onclick = async () => {
    const r = await api.useICloud();
    render(r.state);
    if (!r.ok) showStatus(false, r.error);
  };
  $("#backupNow").onclick = async () => {
    const btn = $("#backupNow");
    btn.disabled = true;
    const r = await api.backupNow();
    render(r.state);
    showStatus(r.ok, r.ok ? r.message : r.error);
  };

  $("#chooseRestore").onclick = async () => {
    const r = await api.chooseRestore();
    if (r.canceled) return;
    if (!r.ok) { showStatus(false, r.error); return; }
    openRestoreSheet(r.preview);
  };
  $("#restoreOverwrite").onchange = renderRestoreProfiles;
  $("#restoreCancel").onclick = closeRestoreSheet;
  $("#restoreConfirm").onclick = async () => {
    const revive = [...document.querySelectorAll("#restoreRemoved input:checked")].map((i) => i.dataset.name);
    const opts = {
      overwrite: $("#restoreOverwrite").checked,
      restoreSettings: $("#restoreSettings").checked,
      revive,
    };
    closeRestoreSheet();
    const r = await api.restore(opts);
    if (r.state) render(r.state);
    showStatus(r.ok, r.ok ? r.message : (r.message || r.error));
  };
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("#restoreVeil").hidden) closeRestoreSheet();
  });

  api.onChanged(async () => render(await api.get()));
  api.onTab(showTab);
}

async function init() {
  wire();
  render(await api.get());
  showTab(new URLSearchParams(location.search).get("tab") || "general");
}

init();
