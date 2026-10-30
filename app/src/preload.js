'use strict';

// ornata-macos — Electron desktop app, preload bridge.
//
// Copyright (C) 2025 André Lindner
//
// This program is free software: you can redistribute it and/or modify it
// under the terms of the GNU General Public License as published by the Free
// Software Foundation, either version 2 of the License, or (at your option)
// any later version. Distributed WITHOUT ANY WARRANTY; see the GNU General
// Public License for more details.
//
// Exposes a small, typed API to the renderer. contextIsolation stays on and
// nodeIntegration off — the renderer never touches Node or the engine directly.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ornata', {
  // { name, version } of the app
  appInfo: () => ipcRenderer.invoke('appInfo'),
  // The height the window content needs, so the window opens without a scrollbar.
  reportContentHeight: (height) => ipcRenderer.send('content-height', height),

  // Layout + status
  layout: () => ipcRenderer.invoke('layout'),
  status: () => ipcRenderer.invoke('status'),
  mouseStatus: () => ipcRenderer.invoke('mouseStatus'),

  // The scene currently applied to the keyboard ({ name, scene } or null) —
  // used to restore the editor state when the window opens.
  currentScene: () => ipcRenderer.invoke('currentScene'),

  // Keyboard. name: the profile shown in the editor, if any.
  applyKeyboard: (spec, name) => ipcRenderer.invoke('applyKeyboard', spec, name),
  keyboardOff: () => ipcRenderer.invoke('keyboardOff'),

  // Mouse: { mode:'static'|'spectrum'|'wave'|'off', color?, direction?, brightness?, dpi? }
  mouse: (opts) => ipcRenderer.invoke('mouse', opts),

  // Profiles (stored in the app's profiles folder) and arbitrary .json files
  listScenes: () => ipcRenderer.invoke('listScenes'),
  loadScene: (name) => ipcRenderer.invoke('loadScene', name),
  saveScene: (name, scene) => ipcRenderer.invoke('saveScene', name, scene),
  // Asks for confirmation, moves the file to the Trash and backs up.
  deleteScene: (name) => ipcRenderer.invoke('deleteScene', name),
  loadSceneFile: () => ipcRenderer.invoke('loadSceneFile'),
  saveSceneFile: (scene, suggested) => ipcRenderer.invoke('saveSceneFile', scene, suggested),

  // Main -> renderer notifications (e.g. tray applied the default profile).
  // The payload is the applied { name, scene } so the editor can mirror it.
  onSceneLoaded: (cb) => ipcRenderer.on('scene-loaded', (_e, cur) => cb(cur)),
  // The profiles folder changed outside the editor (restore from a backup).
  onProfilesChanged: (cb) => ipcRenderer.on('profiles-changed', () => cb()),
  // Another keyboard layout was picked in the settings.
  onLayoutChanged: (cb) => ipcRenderer.on('layout-changed', () => cb()),

  // A native menu at the mouse: [{ id, label, enabled, checked } | { type: 'separator' }]
  // -> the chosen id, or null.
  popupMenu: (items) => ipcRenderer.invoke('popupMenu', items),

  // Macros (see src/macros.js). get/save/delete/setEnabled resolve to
  // { macros, enabled, status, keyNames } (save/delete also { ok, error }).
  macros: {
    get: () => ipcRenderer.invoke('macros:get'),
    save: (macro) => ipcRenderer.invoke('macros:save', macro),
    // Asks for confirmation first.
    delete: (id) => ipcRenderer.invoke('macros:delete', id),
    setEnabled: (on) => ipcRenderer.invoke('macros:setEnabled', on),
    // While on, every key arrives at onKey, every click outside this app's
    // windows at onMouse, and no shortcut fires.
    capture: (on) => ipcRenderer.invoke('macros:capture', on),
    // Plays a macro (also an unsaved one) after delayMs.
    play: (macro, delayMs) => ipcRenderer.invoke('macros:play', macro, delayMs),
    stop: () => ipcRenderer.invoke('macros:stop'),
    requestAccess: () => ipcRenderer.invoke('macros:requestAccess'),
    restartHelper: () => ipcRenderer.invoke('macros:restartHelper'),
    // which: 'input' (Input Monitoring) or 'accessibility'
    openPrivacy: (which) => ipcRenderer.invoke('macros:openPrivacy', which),
    // { helper, tap, inputMonitoring, accessibility, playing, error }
    onStatus: (cb) => ipcRenderer.on('macros-status', (_e, s) => cb(s)),
    // { key, down, t (ms), mods }
    onKey: (cb) => ipcRenderer.on('macros-key', (_e, k) => cb(k)),
    // { button, down, t (ms), x, y }
    onMouse: (cb) => ipcRenderer.on('macros-mouse', (_e, c) => cb(c)),
    // { keyCode: name } for the current keyboard layout
    onKeyNames: (cb) => ipcRenderer.on('macros-keynames', (_e, n) => cb(n)),
    // Switched on/off from the tray, or restored from a backup.
    onChanged: (cb) => ipcRenderer.on('macros-changed', (_e, s) => cb(s)),
  },

  // Settings window. Every call that changes something resolves to the new
  // settings state (or { ok, message|error, state }).
  openSettings: (tab) => ipcRenderer.invoke('openSettings', tab),
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (key, value) => ipcRenderer.invoke('settings:set', key, value),
    setLoginItem: (enabled) => ipcRenderer.invoke('settings:setLoginItem', enabled),
    openLoginItems: () => ipcRenderer.invoke('settings:openLoginItems'),
    storeStartupColor: (color) => ipcRenderer.invoke('settings:storeStartupColor', color),
    showProfiles: () => ipcRenderer.invoke('settings:showProfiles'),
    chooseBackupDir: () => ipcRenderer.invoke('backup:chooseDir'),
    useICloud: () => ipcRenderer.invoke('backup:useICloud'),
    removeBackupDir: () => ipcRenderer.invoke('backup:remove'),
    revealBackupDir: () => ipcRenderer.invoke('backup:reveal'),
    backupNow: () => ipcRenderer.invoke('backup:now'),
    // Pick a backup folder and describe it: { ok, dir, preview } (see engine/backup.js inspect()).
    chooseRestore: () => ipcRenderer.invoke('backup:chooseRestore'),
    // Restore the folder chosen last: { overwrite, restoreSettings, revive: [names] }.
    restore: (opts) => ipcRenderer.invoke('backup:restore', opts),
    onChanged: (cb) => ipcRenderer.on('settings-changed', () => cb()),
    onTab: (cb) => ipcRenderer.on('settings-tab', (_e, tab) => cb(tab)),
  },
});
