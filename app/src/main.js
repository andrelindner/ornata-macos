'use strict';

// ornata-macos — Electron desktop app, main process.
//
// Copyright (C) 2025 André Lindner
//
// This program is free software: you can redistribute it and/or modify it
// under the terms of the GNU General Public License as published by the Free
// Software Foundation, either version 2 of the License, or (at your option)
// any later version.
//
// This program is distributed in the hope that it will be useful, but WITHOUT
// ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS
// FOR A PARTICULAR PURPOSE. See the GNU General Public License for more details.
//
// The main process is Node, so it requires the device engine (engine/)
// directly and drives the keyboard/mouse from here. The renderer talks to it
// only over IPC (see preload.js).

const {
  app, BrowserWindow, Tray, Menu, ipcMain, dialog, nativeImage, nativeTheme, shell, powerMonitor, screen,
} = require('electron');
const path = require('path');
const fs = require('fs');

// --- locate the device engine -----------------------------------------------
// The engine, the bundled scenes and the native addon stay outside app.asar
// (a native .node module can't load from inside it):
// Dev:      app/{engine,scenes,addon.node}
// Packaged: extraResources copies them to <resources>/{engine,scenes,addon.node}.
// engine.js finds its addon relative to itself, so nothing else needs to know.
function corePath(...parts) {
  const root = app.isPackaged ? process.resourcesPath : path.join(__dirname, '..');
  return path.join(root, ...parts);
}

// A dev run gets its own name and settings folder so it can't be mistaken for
// the installed app (login items, single-instance lock, settings.json).
if (!app.isPackaged) {
  app.setName('Ornata Lighting Dev');
  app.setPath('userData', path.join(app.getPath('appData'), 'ornata-macos-app-dev'));
}

// Up to v1.2.1 the app was called "Razer Ornata Lighting". Carry its settings
// over once. Only settings.json is ours in that folder (the rest is Chromium
// cache), and Electron creates the new userData folder before this code runs,
// so copy the file rather than moving the folder.
function migrateLegacySettings() {
  if (!app.isPackaged) return;
  const legacy = path.join(app.getPath('appData'), 'Razer Ornata Lighting', 'settings.json');
  if (fs.existsSync(configPath()) || !fs.existsSync(legacy)) return;
  try {
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    fs.copyFileSync(legacy, configPath());
  } catch (_) { /* start with defaults instead */ }
}

const engine = require(corePath('engine', 'engine.js'));
const { createMacros, normalizeMacros } = require('./macros');
const { layoutPayload, layoutChoices } = require(corePath('engine', 'layout.js'));
const scenes = require(corePath('engine', 'scenes.js'));
const backupStore = require(corePath('engine', 'backup.js'));

const REPO_URL = 'https://github.com/andrelindner/ornata-macos';

// --- profiles ---------------------------------------------------------------
// User profiles live in userData/profiles, never inside the app bundle (which
// is replaced on every update). The folder is seeded once with the bundled
// scenes; the bundled default.json stays the fallback for "default".
function profilesDir() {
  return path.join(app.getPath('userData'), 'profiles');
}

function ensureProfilesDir() {
  const dir = profilesDir();
  if (fs.existsSync(dir)) return;
  fs.mkdirSync(dir, { recursive: true });
  for (const f of scenes.listScenes(scenes.BUNDLED_DIR)) {
    fs.copyFileSync(path.join(scenes.BUNDLED_DIR, f), path.join(dir, f));
  }
}

function readProfile(name) {
  const own = scenes.scenePath(profilesDir(), name);
  if (fs.existsSync(own)) return scenes.readScene(own);
  return scenes.readScene(scenes.scenePath(scenes.BUNDLED_DIR, name));
}

function readDefaultProfile() {
  try { return readProfile('default'); } catch (_) { return null; }
}

// --- app settings (persisted in userData/settings.json) ---------------------
// startMinimized:      launch with the window hidden (menu-bar only) — pair it
//                      with "Start at login" so profiles are active after boot.
// applyOnLaunch:       apply the default profile automatically on every launch.
// reapplyOnWake:       re-send the current profile after wake from sleep / unlock.
// startupColor:        the color last stored in the keyboard's on-board memory
//                      (display only — the keyboard can't be read back).
// backupDir:           folder that receives the backup (see engine/backup.js).
// autoBackup:          back up automatically after every change.
// backupRetentionDays: how long profiles deleted locally stay in the backup
//                      (0 = forever).
// lastBackupAt:        ISO time of the last successful backup.
// keyboardLayout:      'de' or 'us' for the visual keyboard (engine/layout.js);
//                      null follows the system language.
// macros:              the macros (see macros.js); macrosEnabled switches all off.
const DEFAULT_CONFIG = {
  startMinimized: false, applyOnLaunch: true, reapplyOnWake: true, startupColor: null,
  backupDir: null, autoBackup: true, backupRetentionDays: 30, lastBackupAt: null,
  keyboardLayout: null, macros: [], macrosEnabled: true,
};
let config = { ...DEFAULT_CONFIG };

// Settings the settings window may change, with their type. backupDir,
// startupColor and lastBackupAt have their own actions.
const EDITABLE = {
  startMinimized: 'boolean', applyOnLaunch: 'boolean', reapplyOnWake: 'boolean',
  autoBackup: 'boolean', backupRetentionDays: 'number', keyboardLayout: 'string',
};
function validSetting(key, value) {
  if (!EDITABLE[key] || typeof value !== EDITABLE[key]) return false;
  return key !== 'keyboardLayout' || layoutChoices().some((l) => l.id === value);
}
// Settings a backup carries. The backup folder is machine-specific, and the
// startup color describes the keyboard's memory rather than a preference.
// The macros have their own window and are restored through macros.js.
const BACKED_UP = Object.keys(EDITABLE);
const BACKED_UP_MACROS = ['macros', 'macrosEnabled'];

function configPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}
function loadConfig() {
  try {
    config = { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(configPath(), 'utf8')) };
  } catch (_) { config = { ...DEFAULT_CONFIG }; }
  config.macros = normalizeMacros(config.macros);
}
function saveConfig() {
  try {
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    fs.writeFileSync(configPath(), JSON.stringify(config, null, 2) + '\n', 'utf8');
  } catch (_) { /* non-fatal */ }
}

// German QWERTZ when macOS prefers German, US otherwise — until a layout is
// picked in the settings.
function keyboardLayoutId() {
  if (config.keyboardLayout) return config.keyboardLayout;
  const lang = (app.getPreferredSystemLanguages()[0] || app.getLocale() || '').toLowerCase();
  return lang.startsWith('de') ? 'de' : 'us';
}

function pick(obj, keys) {
  const out = {};
  for (const k of keys) if (obj[k] !== undefined) out[k] = obj[k];
  return out;
}

// --- backup -----------------------------------------------------------------
const ICLOUD_ROOT = path.join(app.getPath('home'), 'Library', 'Mobile Documents', 'com~apple~CloudDocs');

function runBackup() {
  const report = backupStore.backup(config.backupDir, {
    profilesDir: profilesDir(),
    settings: pick(config, [...BACKED_UP, ...BACKED_UP_MACROS]),
    appVersion: app.getVersion(),
    retentionDays: config.backupRetentionDays,
  });
  config.lastBackupAt = new Date().toISOString();
  saveConfig();
  notifySettingsChanged();
  return report;
}

function plural(n, one, many) {
  return n === 1 ? one : `${n} ${many}`;
}

function backupSummary(r) {
  const parts = [plural(r.saved.length, '1 profile backed up', 'profiles backed up'), 'settings'];
  if (r.retired.length) parts.push(`${r.retired.length} moved to the grace period`);
  if (r.purged.length) parts.push(`${r.purged.length} removed for good`);
  if (r.revived.length) parts.push(`${r.revived.length} came back`);
  return parts.join(' · ');
}

function restoreSummary(r) {
  const parts = [plural(r.restored.length, '1 profile restored', 'profiles restored')];
  if (r.revived.length) parts.push(`${r.revived.length} brought back from the grace period`);
  if (r.settings) parts.push('settings');
  if (r.kept.length) parts.push(`${r.kept.length} kept (already present)`);
  if (r.failed.length) parts.push(`${r.failed.length} failed: ${r.failed.map((f) => f.name).join(', ')}`);
  return parts.join(' · ');
}

// After a change, back up in the background — debounced, best-effort.
// Errors show up when the user presses "Back Up Now".
let autoBackupTimer = null;
function scheduleAutoBackup() {
  if (!config.backupDir || !config.autoBackup) return;
  clearTimeout(autoBackupTimer);
  autoBackupTimer = setTimeout(() => {
    try { runBackup(); } catch (_) { /* see above */ }
  }, 1500);
}

// The scene most recently applied to the keyboard (by launch auto-apply, the
// tray, or the renderer). The device can't be read back, so this is the source
// of truth the UI loads when the window opens.
let currentScene = null; // { name: string|null, scene: object }
function setCurrentScene(name, scene) {
  currentScene = { name: name || null, scene };
  notifySettingsChanged(); // the startup color offers the profile's main color
}

// Send a scene to the keyboard and remember it as the current one.
function applyScene(name, scene) {
  const r = engine.applySpec(scene);
  setCurrentScene(name, scene);
  return { litCells: r.litCells, device: r.name };
}

const offScene = () => ({ background: '#000000', keys: {} });

// Wrap an engine call so a DEVICE_BUSY / error becomes a structured result the
// renderer can display, instead of throwing across IPC.
function guard(fn) {
  try {
    return Object.assign({ ok: true }, fn());
  } catch (e) {
    return { ok: false, code: e.code || 'ERROR', error: e.message };
  }
}

// --- IPC --------------------------------------------------------------------
function registerIpc() {
  ipcMain.handle('appInfo', () => ({ name: app.name, version: app.getVersion() }));
  ipcMain.handle('layout', () => layoutPayload(keyboardLayoutId()));
  ipcMain.handle('status', () => engine.probe());
  ipcMain.handle('mouseStatus', () => engine.probeMouse());

  // name: the profile the editor shows, so the UI can mark it as the one on
  // the keyboard.
  ipcMain.handle('applyKeyboard', (_e, spec, name) =>
    guard(() => applyScene(typeof name === 'string' ? path.basename(name) : null, spec || {})));
  ipcMain.handle('keyboardOff', () => guard(() => applyScene(null, offScene())));

  // The scene currently on the keyboard — the UI restores it when it opens.
  ipcMain.handle('currentScene', () => currentScene);

  ipcMain.handle('mouse', (_e, opts) => guard(() => {
    const r = engine.applyMouse(opts || {});
    return { device: r.name };
  }));

  ipcMain.handle('listScenes', () => ({ scenes: scenes.listScenes(profilesDir()) }));

  ipcMain.handle('loadScene', (_e, name) => {
    try {
      return { ok: true, name: path.basename(scenes.scenePath(profilesDir(), name)), scene: readProfile(name) };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('saveScene', (_e, name, scene) => {
    try {
      const full = scenes.scenePath(profilesDir(), name);
      scenes.writeScene(full, scene);
      scheduleAutoBackup();
      return { ok: true, name: path.basename(full) };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // Delete a profile after a native confirmation. Like the SSH Key Manager, the
  // file goes to the Trash and the backup keeps it: a backup right before
  // captures its latest state, the one right after moves it into deleted/ with
  // the date, where Restore offers it for the grace period.
  ipcMain.handle('deleteScene', async (_e, name) => {
    let full;
    try { full = scenes.scenePath(profilesDir(), name); } catch (e) { return { ok: false, error: e.message }; }
    const file = path.basename(full);
    if (file === 'default.json') return { ok: false, error: 'The default profile can’t be deleted — overwrite it with Save profile instead.' };
    if (!fs.existsSync(full)) return { ok: false, error: `${file} doesn’t exist anymore.` };

    const days = config.backupRetentionDays;
    const backedUp = !!config.backupDir && fs.existsSync(config.backupDir);
    let detail = 'The profile moves to the Trash.';
    if (backedUp) {
      detail += days > 0
        ? ` You can restore it from the backup for ${plural(days, '1 day', 'days')}.`
        : ' You can restore it from the backup at any time.';
    }
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      message: `Delete “${file.replace(/\.json$/, '')}”?`,
      detail,
      buttons: ['Delete', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
    });
    if (response !== 0) return { ok: false, canceled: true };

    let warning = null;
    if (backedUp) {
      try { runBackup(); } catch (e) { warning = e.message; }
    }
    try {
      await shell.trashItem(full);
    } catch (e) {
      return { ok: false, error: `Could not move ${file} to the Trash: ${e.message}` };
    }
    if (backedUp && !warning) {
      try { runBackup(); } catch (e) { warning = e.message; }
    }
    return { ok: true, name: file, warning };
  });

  // Native open dialog -> return the parsed scene JSON.
  ipcMain.handle('loadSceneFile', async () => {
    const win = BrowserWindow.getFocusedWindow() || mainWindow;
    const res = await dialog.showOpenDialog(win, {
      title: 'Load lighting profile',
      filters: [{ name: 'Profiles', extensions: ['json'] }],
      properties: ['openFile'],
    });
    if (res.canceled || !res.filePaths.length) return { ok: false, canceled: true };
    try {
      const file = res.filePaths[0];
      return { ok: true, name: path.basename(file), scene: scenes.readScene(file) };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // Native save dialog -> write the scene JSON anywhere.
  ipcMain.handle('saveSceneFile', async (_e, scene, suggested) => {
    const win = BrowserWindow.getFocusedWindow() || mainWindow;
    const res = await dialog.showSaveDialog(win, {
      title: 'Save lighting profile',
      defaultPath: (suggested || 'profile') + '.json',
      filters: [{ name: 'Profiles', extensions: ['json'] }],
    });
    if (res.canceled || !res.filePath) return { ok: false, canceled: true };
    try {
      scenes.writeScene(res.filePath, scene);
      return { ok: true, name: path.basename(res.filePath) };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('openSettings', (_e, tab) => showSettings(tab));

  // A native menu at the mouse: items are { id, label, enabled } or
  // { type: 'separator' }. Resolves to the chosen id, or null when dismissed.
  ipcMain.handle('popupMenu', (e, items) => new Promise((resolve) => {
    const menu = Menu.buildFromTemplate((Array.isArray(items) ? items : []).map((it) => (
      it.type === 'separator'
        ? { type: 'separator' }
        : { label: String(it.label), enabled: it.enabled !== false, click: () => resolve(it.id) })));
    // The menu closes before the click handler runs; give the click a moment.
    menu.popup({ window: BrowserWindow.fromWebContents(e.sender), callback: () => setTimeout(() => resolve(null), 100) });
  }));

  registerSettingsIpc();
  macros.registerIpc(ipcMain, {
    confirmDelete: async (name) => (await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      message: `Delete the macro “${name}”?`,
      detail: 'Its keys and its shortcut are removed.',
      buttons: ['Delete', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
    })).response === 0,
    openExternal: (url) => shell.openExternal(url),
  });
}

// --- settings window IPC ----------------------------------------------------
function settingsState() {
  const dir = config.backupDir;
  return {
    name: app.name,
    version: app.getVersion(),
    home: app.getPath('home'),
    config: { ...config },
    loginItem: loginItemState(),
    profilesDir: profilesDir(),
    keyboard: { layout: keyboardLayoutId(), layouts: layoutChoices() },
    backup: {
      dir,
      reachable: !!dir && fs.existsSync(dir),
      inICloud: !!dir && dir.startsWith(ICLOUD_ROOT + path.sep),
    },
    startup: {
      stored: config.startupColor,
      mainColor: currentScene ? engine.dominantColor(currentScene.scene) : null,
      presets: STARTUP_PRESETS,
    },
    icloud: {
      available: fs.existsSync(ICLOUD_ROOT),
      root: ICLOUD_ROOT,
      folder: path.join(ICLOUD_ROOT, app.name),
    },
  };
}

// The backup folder that was last inspected for a restore. The restore runs
// on this folder, never on a path the renderer sends.
let restoreDir = null;

function registerSettingsIpc() {
  ipcMain.handle('settings:get', () => settingsState());

  ipcMain.handle('settings:set', (_e, key, value) => {
    if (!validSetting(key, value)) return settingsState();
    config[key] = value;
    saveConfig();
    scheduleAutoBackup();
    if (key === 'keyboardLayout') notifyLayoutChanged();
    return settingsState();
  });

  ipcMain.handle('settings:setLoginItem', (_e, enabled) => {
    if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: !!enabled });
    return settingsState();
  });
  ipcMain.handle('settings:openLoginItems', () =>
    shell.openExternal('x-apple.systempreferences:com.apple.LoginItems-Settings.extension'));

  ipcMain.handle('settings:storeStartupColor', (_e, color) => {
    const r = guard(() => {
      const res = engine.storeStartupColor(color, currentScene ? currentScene.scene : null);
      config.startupColor = color;
      saveConfig();
      scheduleAutoBackup();
      return { device: res.name };
    });
    return { ...r, state: settingsState() };
  });

  ipcMain.handle('settings:showProfiles', () => shell.openPath(profilesDir()));

  ipcMain.handle('backup:chooseDir', async () => {
    const res = await dialog.showOpenDialog(settingsWindow, {
      title: 'Choose backup folder',
      message: 'Choose a folder. It may be on a network drive or in iCloud Drive.',
      buttonLabel: 'Choose',
      defaultPath: config.backupDir || app.getPath('documents'),
      properties: ['openDirectory', 'createDirectory'],
    });
    if (!res.canceled && res.filePaths.length) setBackupDir(backupStore.backupRoot(res.filePaths[0]));
    return settingsState();
  });

  ipcMain.handle('backup:useICloud', () => {
    const folder = path.join(ICLOUD_ROOT, app.name);
    try {
      fs.mkdirSync(folder, { recursive: true });
      setBackupDir(folder);
      return { ok: true, state: settingsState() };
    } catch (e) {
      return { ok: false, error: e.message, state: settingsState() };
    }
  });

  ipcMain.handle('backup:remove', () => {
    config.backupDir = null;
    saveConfig();
    return settingsState();
  });

  ipcMain.handle('backup:reveal', () => config.backupDir && shell.openPath(config.backupDir));

  ipcMain.handle('backup:now', () => {
    try {
      return { ok: true, message: backupSummary(runBackup()), state: settingsState() };
    } catch (e) {
      return { ok: false, error: e.message, state: settingsState() };
    }
  });

  ipcMain.handle('backup:chooseRestore', async () => {
    const res = await dialog.showOpenDialog(settingsWindow, {
      title: 'Choose backup',
      message: 'Choose the folder that holds the backup.',
      buttonLabel: 'Open',
      defaultPath: config.backupDir || app.getPath('documents'),
      properties: ['openDirectory'],
    });
    if (res.canceled || !res.filePaths.length) return { ok: false, canceled: true };
    try {
      const dir = backupStore.backupRoot(res.filePaths[0]);
      const preview = backupStore.inspect(dir, profilesDir());
      restoreDir = dir;
      return { ok: true, dir: restoreDir, preview };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('backup:restore', (_e, opts) => {
    if (!restoreDir) return { ok: false, error: 'Choose a backup first.' };
    const o = opts || {};
    try {
      const r = backupStore.restore(restoreDir, {
        profilesDir: profilesDir(),
        overwrite: !!o.overwrite,
        restoreSettings: !!o.restoreSettings,
        revive: Array.isArray(o.revive) ? o.revive : [],
      });
      if (r.settings) {
        for (const [k, v] of Object.entries(pick(r.settings, BACKED_UP))) {
          if (validSetting(k, v)) config[k] = v;
        }
        if (typeof r.settings.macrosEnabled === 'boolean') config.macrosEnabled = r.settings.macrosEnabled;
        saveConfig();
        notifyLayoutChanged();
        if (Array.isArray(r.settings.macros)) macros.replaceAll(r.settings.macros);
      }
      restoreDir = null;
      if (mainWindow) mainWindow.webContents.send('profiles-changed');
      scheduleAutoBackup();
      return { ok: !r.failed.length, message: restoreSummary(r), state: settingsState() };
    } catch (e) {
      return { ok: false, error: e.message, state: settingsState() };
    }
  });
}

// The main window redraws its keyboard for the chosen layout.
function notifyLayoutChanged() {
  if (mainWindow) mainWindow.webContents.send('layout-changed');
}

function setBackupDir(dir) {
  config.backupDir = dir;
  saveConfig();
  scheduleAutoBackup(); // fill the new folder right away
}

// --- macros -----------------------------------------------------------------
// Created at startup (see macros.js). A dev run starts the helper with
// --dry-run, so macOS never asks the bare Electron for keyboard permissions.
let macros = null;

function setupMacros() {
  macros = createMacros({
    binPath: corePath('native', 'bin', 'ornata-keys'),
    args: app.isPackaged ? [] : ['--dry-run'],
    config: () => config,
    saveConfig: () => { saveConfig(); scheduleAutoBackup(); },
    onChange: () => tray && tray.setContextMenu(buildTrayMenu()),
    send: (channel, payload) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
    },
  });
}

// --- window + tray ----------------------------------------------------------
let mainWindow = null;
let tray = null;
let isQuitting = false;

// Keyboard-keys glyph as a macOS "template" image (black + alpha), 1x (22px) and
// 2x (44px). Generated by assets/make_icon.py; embedded so no external asset is
// needed. macOS auto-tints template images for light/dark menu bars.
const TRAY_ICON_22_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAABYAAAAWCAYAAADEtGw7AAAA60lEQVR4nO2VuwrCQBBFz5pgo/gBaVR8FLbp9M+t/QT/QFEQUohWviIbZsImRMguiI0XFoYTmJmdO2QNVXUAI3EOvAJ5ReYD8+WVwEjFCTAUdgK2EvtwzVVeZwqcBdpzB1Ig8eArKRJp0hwYAwPgAdyAWDpKPPhCJ2ATu8rFAD3aTVtemhfrPICjdN91ClmWefCdNlg3L62ZsZHYhxe5bMeu9s51skCuEyi3YgZcarNT968teeNWjIC+47Jx3O+15P+tKPTfCn67FXxrK5bAXNgBWEtsZ2c9aMPLH72q6akJ4Y0fo9rj+AzkvAFSjsYWyPjqzgAAAABJRU5ErkJggg==';
const TRAY_ICON_44_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAACwAAAAsCAYAAAAehFoBAAABGUlEQVR4nO2WXUrFMBCFv7RFF+XdgAvQFx90YYoLuI+CT+7L39tcCgmkIZl7EVNaOR8MhckZmElIc0CIGY46vbHugcPC+l8PUtK01ptJFybcAXfAZaKb8p/AC/Ca5VvpPQbTMU1chSPxRtwkA7bU91bDQ/g+hqJ34DuLD2AE3pK6p4b6vtRgaad9WM81LolI11DvyQprnHMxltSfbHiVdGyMoZIfQ/wUji7mxoX0zhog3sjrE7+cKe6Tupb6/tyH4xZ4AC6yG/sF7IHn5DaPDfXe2mFrkFU8zR0bw1Vy8hLIS8yRlyggL7FKhkpeXgJ5iTnyEn+FvATyEshLROQl/kXDQyUvL4G8xEa8hDMK4lH4Ss1hYb0QFDgCdgmStZz5074AAAAASUVORK5CYII=';

// The window opens at the height its content needs (no scrollbar), as far as
// the screen allows. The renderer reports that height once it has built the
// keyboard; until then the window stays hidden, so it doesn't visibly jump.
const WINDOW_WIDTH = 1260;
const SHOW_FALLBACK_MS = 2000;

function fitWindowToContent(contentHeight) {
  if (!mainWindow) return;
  const area = screen.getDisplayMatching(mainWindow.getBounds()).workArea;
  const frame = mainWindow.getSize()[1] - mainWindow.getContentSize()[1];
  const height = Math.min(Math.ceil(contentHeight), area.height - frame);
  mainWindow.setContentSize(Math.min(WINDOW_WIDTH, area.width), Math.max(height, 560));
  mainWindow.center();
}

function createWindow(startHidden) {
  mainWindow = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: 900,
    useContentSize: true,
    minWidth: 920, // the keyboard fits at its smallest scale (see fitBoard)
    minHeight: 560,
    title: app.name,
    backgroundColor: '#16171c',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  let fitted = false;
  const reveal = () => { if (!startHidden && mainWindow && !mainWindow.isVisible()) mainWindow.show(); };
  mainWindow.webContents.ipc.on('content-height', (_e, height) => {
    if (fitted || !Number.isFinite(height)) return;
    fitted = true;
    fitWindowToContent(height);
    reveal();
  });
  // Show anyway if the renderer never reports (e.g. it failed to start).
  mainWindow.once('ready-to-show', () => setTimeout(reveal, SHOW_FALLBACK_MS));

  // Open external links in the default browser, not inside the app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Closing the window hides it (app lives on in the menu bar) unless quitting.
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow.hide();
      if (process.platform === 'darwin') app.dock && app.dock.hide();
    }
  });
}

function showWindow() {
  if (!mainWindow) createWindow();
  if (process.platform === 'darwin' && app.dock) app.dock.show();
  mainWindow.show();
  mainWindow.focus();
}

// Fire a keyboard action from the tray and notify the user of the outcome.
function trayApply(fn, okMsg) {
  const r = guard(fn);
  if (r.ok) {
    setTrayTitleFlash(okMsg);
  } else if (r.code === 'DEVICE_BUSY') {
    dialog.showMessageBox({
      type: 'warning',
      message: 'Quit the "Razer macOS" app first',
      detail: 'The Razer macOS menu-bar app holds the device open exclusively, which blocks this app. Quit it and try again.',
    });
  } else {
    dialog.showMessageBox({ type: 'error', message: 'Action failed', detail: r.error || 'Unknown error' });
  }
}

let trayFlashTimer = null;
function setTrayTitleFlash(text) {
  if (!tray) return;
  tray.setTitle(' ' + text);
  clearTimeout(trayFlashTimer);
  trayFlashTimer = setTimeout(() => tray && tray.setTitle(''), 2500);
}

function turnKeyboardOff() {
  trayApply(() => applyScene(null, offScene()), 'Keyboard off');
  if (mainWindow) mainWindow.webContents.send('scene-loaded', currentScene);
}

// The per-key frame only lives in the keyboard's volatile memory. Across sleep
// (USB suspend) and especially behind a monitor/KVM hub, individual LEDs can
// come back without their color, so re-send the current profile after wake and
// unlock. Delayed because USB devices aren't always ready the instant the
// event fires; retried a few times, silently (no dialogs on the lock screen).
const REAPPLY_DELAYS_MS = [2000, 5000, 10000];
let reapplyTimer = null;
function onWakeOrUnlock() {
  if (config.reapplyOnWake) scheduleReapply();
}
function scheduleReapply(attempt = 0) {
  clearTimeout(reapplyTimer);
  if (!currentScene || attempt >= REAPPLY_DELAYS_MS.length) return;
  reapplyTimer = setTimeout(() => {
    try {
      engine.applySpec(currentScene.scene);
    } catch (_) {
      scheduleReapply(attempt + 1);
    }
  }, REAPPLY_DELAYS_MS[attempt]);
}

// Presets offered for the startup color stored in the keyboard's on-board
// memory (settings window, General tab).
const STARTUP_PRESETS = [
  ['White', '#ffffff'], ['Red', '#ff0000'], ['Orange', '#ff7a00'],
  ['Green', '#00ff33'], ['Blue', '#33ccff'], ['Purple', '#c060ff'],
];

function loadDefaultProfile() {
  trayApply(() => applyScene('default.json', readProfile('default')), 'Default applied');
  if (mainWindow) mainWindow.webContents.send('scene-loaded', currentScene);
}

// --- login item -------------------------------------------------------------
// Never touch login items from a dev run: macOS matches the login item by app
// name, and even querying it re-pointed the installed app's entry at the bare
// node_modules Electron.app, which then opened its default window at boot.
const LOGIN_STATUS = {
  'enabled': 'Registered as a login item.',
  'requires-approval': 'macOS needs your approval: System Settings → General → Login Items.',
  'not-found': 'The entry was not found. That happens when the app has been moved.',
  'not-registered': 'Not registered as a login item.',
};

function loginItemState() {
  if (!app.isPackaged) {
    return { available: false, enabled: false, note: 'Only available in the installed app — a development run never touches login items.' };
  }
  const s = app.getLoginItemSettings();
  return {
    available: true,
    enabled: !!s.openAtLogin,
    needsApproval: s.status === 'requires-approval',
    note: LOGIN_STATUS[s.status] || (s.openAtLogin ? LOGIN_STATUS.enabled : LOGIN_STATUS['not-registered']),
    warning: app.getPath('exe').startsWith('/Applications/')
      ? null
      : 'The app is not in /Applications. Move it there before you turn this on.',
  };
}

// --- settings window --------------------------------------------------------
let settingsWindow = null;

function showSettings(tab) {
  if (process.platform === 'darwin' && app.dock) app.dock.show();
  if (settingsWindow) {
    if (tab) settingsWindow.webContents.send('settings-tab', tab);
    settingsWindow.show();
    settingsWindow.focus();
    return;
  }
  settingsWindow = new BrowserWindow({
    width: 620,
    height: 640,
    minWidth: 620,
    minHeight: 420,
    maxWidth: 620,
    title: 'Settings',
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 14, y: 14 },
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1e1e1e' : '#ececec',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
  });
  settingsWindow.loadFile(path.join(__dirname, 'settings', 'index.html'), { query: tab ? { tab } : {} });
  settingsWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  settingsWindow.once('ready-to-show', () => {
    settingsWindow.show();
    app.focus({ steal: true }); // opened from the menu bar while in the background
  });
  settingsWindow.on('closed', () => {
    settingsWindow = null;
    if (process.platform === 'darwin' && app.dock && !(mainWindow && mainWindow.isVisible())) app.dock.hide();
  });
}

function notifySettingsChanged() {
  if (settingsWindow) settingsWindow.webContents.send('settings-changed');
}

function buildTrayMenu() {
  return Menu.buildFromTemplate([
    { label: `${app.name} ${app.getVersion()}`, enabled: false },
    { type: 'separator' },
    { label: 'Show / Hide Window', click: () => (mainWindow && mainWindow.isVisible() ? mainWindow.hide() : showWindow()) },
    { type: 'separator' },
    { label: 'Apply Default Profile', click: () => loadDefaultProfile() },
    { label: 'Turn Keyboard Off', click: () => turnKeyboardOff() },
    { type: 'separator' },
    ...(macros && macros.count() ? [
      { label: 'Run Macros', type: 'checkbox', checked: macros.enabled(), click: (item) => macros.setEnabled(item.checked) },
      { type: 'separator' },
    ] : []),
    { label: 'Settings…', click: () => showSettings() },
    { type: 'separator' },
    { label: 'Quit', click: () => { isQuitting = true; app.quit(); } },
  ]);
}

function createTray() {
  const img = nativeImage.createEmpty();
  img.addRepresentation({ scaleFactor: 1, width: 22, height: 22, buffer: Buffer.from(TRAY_ICON_22_B64, 'base64') });
  img.addRepresentation({ scaleFactor: 2, width: 44, height: 44, buffer: Buffer.from(TRAY_ICON_44_B64, 'base64') });
  img.setTemplateImage(true);
  tray = new Tray(img);
  tray.setToolTip(`${app.name} ${app.getVersion()}`);
  tray.setContextMenu(buildTrayMenu());
  // NOTE: no tray.on('click') handler — clicking must only open the menu.
  // A click handler that focuses the window steals focus from the just-opened
  // menu, which made it snap shut (worst with a fullscreen/maximized window).
  // "Show / Hide Window" in the menu covers opening the window.
}

function buildAppMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { label: 'Settings…', accelerator: 'Cmd+,', click: () => showSettings() },
        { type: 'separator' },
        { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' },
        { type: 'separator' },
        { label: 'Quit', accelerator: 'Cmd+Q', click: () => { isQuitting = true; app.quit(); } },
      ],
    }] : []),
    { role: 'editMenu' }, // copy/paste in text fields (hex colors, profile names)
    {
      label: 'Keyboard',
      submenu: [
        { label: 'Apply Default Profile', click: () => loadDefaultProfile() },
        { label: 'Turn Keyboard Off', click: () => turnKeyboardOff() },
        { type: 'separator' },
        { label: 'Show Profiles Folder', click: () => shell.openPath(profilesDir()) },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { label: 'Close', accelerator: 'Cmd+W', role: 'close' },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'toggleDevTools' },
      ],
    },
    {
      role: 'help',
      submenu: [
        { label: 'Project on GitHub', click: () => shell.openExternal(REPO_URL) },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// --- lifecycle --------------------------------------------------------------
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());

  app.whenReady().then(() => {
    migrateLegacySettings();
    loadConfig();
    try { ensureProfilesDir(); } catch (_) { /* falls back to the bundled scenes */ }
    setupMacros();
    // In dev the bundle icon isn't applied, so set the dock icon from assets.
    if (!app.isPackaged && process.platform === 'darwin' && app.dock) {
      const devIcon = path.join(__dirname, '..', 'assets', 'icon.png');
      if (fs.existsSync(devIcon)) app.dock.setIcon(devIcon);
    }
    registerIpc();
    buildAppMenu();
    app.setAboutPanelOptions({
      applicationName: app.name,
      applicationVersion: app.getVersion(),
      copyright: '© 2025 André Lindner · GNU GPL v2.0 or later',
      website: REPO_URL,
    });

    // Start minimized: no window, no dock — the app lives in the menu bar so
    // the lighting settings are active right after login.
    const startHidden = config.startMinimized;
    createWindow(startHidden);
    if (startHidden && process.platform === 'darwin' && app.dock) app.dock.hide();
    createTray();

    // Re-apply the default profile so the keyboard lights up without a click.
    // Silent on failure (e.g. device not ready yet at login) — no dialogs at
    // login; retried in the background instead.
    if (config.applyOnLaunch) {
      const scene = readDefaultProfile();
      if (scene) {
        setCurrentScene('default.json', scene);
        try {
          engine.applySpec(scene);
          setTrayTitleFlash('Default applied');
        } catch (_) {
          scheduleReapply();
        }
      }
    }

    macros.sync(); // starts the helper when a macro has a shortcut

    powerMonitor.on('resume', onWakeOrUnlock);
    powerMonitor.on('unlock-screen', onWakeOrUnlock);

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
      else showWindow();
    });
  });

  // Keep running in the menu bar when all windows are closed.
  app.on('window-all-closed', () => { /* stay alive for the tray */ });

  app.on('before-quit', () => {
    isQuitting = true;
    if (macros) macros.stop(); // the helper lets go of its keys
  });
}
