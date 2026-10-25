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

  // Keyboard
  applyKeyboard: (spec) => ipcRenderer.invoke('applyKeyboard', spec),
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
