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
  loadSceneFile: () => ipcRenderer.invoke('loadSceneFile'),
  saveSceneFile: (scene, suggested) => ipcRenderer.invoke('saveSceneFile', scene, suggested),

  // Main -> renderer notifications (e.g. tray applied the default profile).
  // The payload is the applied { name, scene } so the editor can mirror it.
  onSceneLoaded: (cb) => ipcRenderer.on('scene-loaded', (_e, cur) => cb(cur)),
});
