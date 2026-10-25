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
// The main process is Node, so it requires the proven cli/ engine directly and
// drives the keyboard/mouse from here. The renderer talks to it only over IPC
// (see preload.js). We never run the cli's HTTP server.

const {
  app, BrowserWindow, Tray, Menu, ipcMain, dialog, nativeImage, shell, powerMonitor,
} = require('electron');
const path = require('path');
const fs = require('fs');

// --- locate the reused cli/ modules ----------------------------------------
// Dev:      app/src -> ../../cli/...
// Packaged: extraResources copies cli/{src,scenes,addon.node} into
//           <resources>/cli. engine.js finds its addon relative to itself
//           (<resources>/cli/addon.node), so nothing else needs to know.
function cliPath(...parts) {
  const root = app.isPackaged
    ? path.join(process.resourcesPath, 'cli')
    : path.join(__dirname, '..', '..', 'cli');
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

const engine = require(cliPath('src', 'engine.js'));
const { layoutPayload } = require(cliPath('src', 'layout.js'));
const scenes = require(cliPath('src', 'scenes.js'));

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
// startMinimized: launch with the window hidden (menu-bar only) — pair it with
//                 "Start at Login" so profiles are active right after boot.
// applyOnLaunch:  apply the default profile automatically on every launch.
// backupDir:      folder that receives a copy of every saved color profile.
// reapplyOnWake:  re-send the current profile after wake from sleep / unlock.
// startupColor:   the color last stored in the keyboard's on-board memory
//                 (display only — the keyboard can't be read back).
const DEFAULT_CONFIG = {
  startMinimized: false, applyOnLaunch: true, backupDir: null,
  reapplyOnWake: true, startupColor: null,
};
let config = { ...DEFAULT_CONFIG };

function configPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}
function loadConfig() {
  try {
    config = { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(configPath(), 'utf8')) };
  } catch (_) { config = { ...DEFAULT_CONFIG }; }
}
function saveConfig() {
  try {
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    fs.writeFileSync(configPath(), JSON.stringify(config, null, 2) + '\n', 'utf8');
  } catch (_) { /* non-fatal */ }
}

// Copy one saved profile into the backup folder (if one is configured).
function backupProfile(fullPath) {
  if (!config.backupDir) return;
  try {
    fs.mkdirSync(config.backupDir, { recursive: true });
    fs.copyFileSync(fullPath, path.join(config.backupDir, path.basename(fullPath)));
  } catch (_) { /* backup is best-effort */ }
}

// Copy every saved profile into the backup folder. Returns the count.
function backupAllProfiles() {
  if (!config.backupDir) return 0;
  fs.mkdirSync(config.backupDir, { recursive: true });
  const files = scenes.listScenes(profilesDir());
  for (const f of files) {
    fs.copyFileSync(path.join(profilesDir(), f), path.join(config.backupDir, f));
  }
  return files.length;
}

// The scene most recently applied to the keyboard (by launch auto-apply, the
// tray, or the renderer). The device can't be read back, so this is the source
// of truth the UI loads when the window opens.
let currentScene = null; // { name: string|null, scene: object }
function setCurrentScene(name, scene) {
  currentScene = { name: name || null, scene };
  refreshMenus(); // the startup-color menu shows the profile's main color
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
  ipcMain.handle('layout', () => layoutPayload());
  ipcMain.handle('status', () => engine.probe());
  ipcMain.handle('mouseStatus', () => engine.probeMouse());

  ipcMain.handle('applyKeyboard', (_e, spec) => guard(() => applyScene(null, spec || {})));
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
      backupProfile(full); // mirror into the configured backup folder
      return { ok: true, name: path.basename(full) };
    } catch (e) {
      return { ok: false, error: e.message };
    }
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

function createWindow(startHidden) {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 900,
    minWidth: 760,
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
  if (!startHidden) mainWindow.once('ready-to-show', () => mainWindow.show());

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

// Store a startup color in the keyboard's on-board memory, then restore the
// current per-key profile so nothing visibly changes now.
function storeStartupColor(color) {
  trayApply(() => {
    const r = engine.storeStartupColor(color, currentScene ? currentScene.scene : null);
    config.startupColor = color;
    saveConfig();
    refreshMenus();
    return { device: r.name };
  }, 'Startup color stored');
}

const STARTUP_PRESETS = [
  ['White', '#ffffff'], ['Red', '#ff0000'], ['Orange', '#ff7a00'],
  ['Green', '#00ff33'], ['Blue', '#33ccff'], ['Purple', '#c060ff'],
];

function startupColorSubmenuTemplate() {
  const main = currentScene ? engine.dominantColor(currentScene.scene) : null;
  return [
    {
      label: main ? `Main Color of Current Profile (${main})` : 'Main Color of Current Profile',
      enabled: !!main,
      click: () => {
        const c = currentScene && engine.dominantColor(currentScene.scene);
        if (c) storeStartupColor(c);
      },
    },
    { type: 'separator' },
    ...STARTUP_PRESETS.map(([name, hex]) => ({ label: `${name} (${hex})`, click: () => storeStartupColor(hex) })),
    { label: 'Off (dark until the app starts)', click: () => storeStartupColor('#000000') },
    { type: 'separator' },
    { label: config.startupColor ? `Stored: ${config.startupColor}` : 'Stored: not set by this app', enabled: false },
    { label: 'Per-key colors can’t be stored on the keyboard', enabled: false },
  ];
}

function loadDefaultProfile() {
  trayApply(() => applyScene('default.json', readProfile('default')), 'Default applied');
  if (mainWindow) mainWindow.webContents.send('scene-loaded', currentScene);
}

// Choose the folder that receives copies of saved color profiles.
async function chooseBackupFolder() {
  const res = await dialog.showOpenDialog({
    title: 'Choose backup folder for color profiles',
    defaultPath: config.backupDir || app.getPath('documents'),
    properties: ['openDirectory', 'createDirectory'],
  });
  if (res.canceled || !res.filePaths.length) return;
  config.backupDir = res.filePaths[0];
  saveConfig();
  refreshMenus();
  try {
    const n = backupAllProfiles(); // seed the folder with the current profiles
    setTrayTitleFlash(`Backup folder set (${n} copied)`);
  } catch (e) {
    dialog.showMessageBox({ type: 'error', message: 'Backup failed', detail: e.message });
  }
}

// Shared Settings submenu — used by both the tray menu and the application
// menu bar, so the settings are reachable from either place.
function settingsSubmenuTemplate() {
  // Never touch login items from a dev run: macOS matches the login item by app
  // name, and even querying it re-pointed the installed app's entry at the
  // bare node_modules Electron.app, which then opened its default window at boot.
  const login = app.isPackaged ? app.getLoginItemSettings() : { openAtLogin: false };
  return [
    {
      label: app.isPackaged ? 'Start at Login' : 'Start at Login (installed app only)',
      type: 'checkbox',
      enabled: app.isPackaged,
      checked: login.openAtLogin,
      click: (item) => {
        app.setLoginItemSettings({ openAtLogin: item.checked, openAsHidden: true });
        refreshMenus();
      },
    },
    {
      label: 'Start Minimized (Menu Bar Only)',
      type: 'checkbox',
      checked: config.startMinimized,
      click: (item) => { config.startMinimized = item.checked; saveConfig(); refreshMenus(); },
    },
    {
      label: 'Apply Default Profile on Launch',
      type: 'checkbox',
      checked: config.applyOnLaunch,
      click: (item) => { config.applyOnLaunch = item.checked; saveConfig(); refreshMenus(); },
    },
    {
      label: 'Re-apply Profile After Wake / Unlock',
      type: 'checkbox',
      checked: config.reapplyOnWake,
      click: (item) => { config.reapplyOnWake = item.checked; saveConfig(); refreshMenus(); },
    },
    { label: 'Startup Color (Stored on Keyboard)', submenu: startupColorSubmenuTemplate() },
    { type: 'separator' },
    { label: 'Choose Backup Folder…', click: () => chooseBackupFolder() },
    {
      label: config.backupDir ? `Backups: ${config.backupDir}` : 'Backups: not configured',
      enabled: false,
    },
    {
      label: 'Back Up Profiles Now',
      enabled: !!config.backupDir,
      click: () => {
        try { setTrayTitleFlash(`${backupAllProfiles()} profiles backed up`); }
        catch (e) { dialog.showMessageBox({ type: 'error', message: 'Backup failed', detail: e.message }); }
      },
    },
    {
      label: 'Show Backup Folder',
      enabled: !!config.backupDir,
      click: () => shell.openPath(config.backupDir),
    },
    { type: 'separator' },
    { label: 'Show Profiles Folder', click: () => shell.openPath(profilesDir()) },
  ];
}

function buildTrayMenu() {
  return Menu.buildFromTemplate([
    { label: 'Show / Hide Window', click: () => (mainWindow && mainWindow.isVisible() ? mainWindow.hide() : showWindow()) },
    { type: 'separator' },
    { label: 'Apply Default Profile', click: () => loadDefaultProfile() },
    { label: 'Turn Keyboard Off', click: () => turnKeyboardOff() },
    { type: 'separator' },
    { label: 'Settings', submenu: settingsSubmenuTemplate() },
    { type: 'separator' },
    { label: 'Quit', click: () => { isQuitting = true; app.quit(); } },
  ]);
}

// Rebuild both menus so checkbox/backup state stays in sync everywhere.
function refreshMenus() {
  if (tray) tray.setContextMenu(buildTrayMenu());
  buildAppMenu();
}

function createTray() {
  const img = nativeImage.createEmpty();
  img.addRepresentation({ scaleFactor: 1, width: 22, height: 22, buffer: Buffer.from(TRAY_ICON_22_B64, 'base64') });
  img.addRepresentation({ scaleFactor: 2, width: 44, height: 44, buffer: Buffer.from(TRAY_ICON_44_B64, 'base64') });
  img.setTemplateImage(true);
  tray = new Tray(img);
  tray.setToolTip(app.name);
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
        { label: 'Settings', submenu: settingsSubmenuTemplate() },
        { type: 'separator' },
        { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' },
        { type: 'separator' },
        { label: 'Quit', accelerator: 'Cmd+Q', click: () => { isQuitting = true; app.quit(); } },
      ],
    }] : []),
    { label: 'Settings', submenu: settingsSubmenuTemplate() },
    {
      label: 'Keyboard',
      submenu: [
        { label: 'Apply Default Profile', click: () => loadDefaultProfile() },
        { label: 'Turn Keyboard Off', click: () => turnKeyboardOff() },
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
    // In dev the bundle icon isn't applied, so set the dock icon from assets.
    if (!app.isPackaged && process.platform === 'darwin' && app.dock) {
      const devIcon = path.join(__dirname, '..', 'assets', 'icon.png');
      if (fs.existsSync(devIcon)) app.dock.setIcon(devIcon);
    }
    registerIpc();
    buildAppMenu();

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

    powerMonitor.on('resume', onWakeOrUnlock);
    powerMonitor.on('unlock-screen', onWakeOrUnlock);

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
      else showWindow();
    });
  });

  // Keep running in the menu bar when all windows are closed.
  app.on('window-all-closed', () => { /* stay alive for the tray */ });

  app.on('before-quit', () => { isQuitting = true; });
}
