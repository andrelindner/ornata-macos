'use strict';

// ornata-macos — scene (lighting profile) files.
//
// Copyright (C) 2025 André Lindner
//
// This program is free software: you can redistribute it and/or modify it
// under the terms of the GNU General Public License as published by the Free
// Software Foundation, either version 2 of the License, or (at your option)
// any later version. Distributed WITHOUT ANY WARRANTY; see the GNU General
// Public License for more details.
//
// A scene is a small JSON file { brightness?, background?, groups?, keys }.
// The app's bundled scenes and the user's profiles folder both use it.

const fs = require('fs');
const path = require('path');

// The scenes shipped with the app (app/scenes, packaged: <resources>/scenes).
const BUNDLED_DIR = path.join(__dirname, '..', 'scenes');

// Safe scene name -> absolute path of "<name>.json" inside `dir`.
function scenePath(dir, name) {
  const base = path.basename(String(name || ''));
  if (!/^[\w.-]+$/.test(base)) throw new Error('bad scene name');
  return path.join(dir, base.endsWith('.json') ? base : base + '.json');
}

// File names of all scenes in `dir`, sorted.
function listScenes(dir) {
  try {
    return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  } catch (_) { return []; }
}

function readScene(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// Write only the known scene fields, in a stable order.
function writeScene(file, scene) {
  const s = scene || {};
  const out = {};
  if (s.brightness !== undefined) out.brightness = s.brightness;
  out.background = s.background || '#000000';
  if (s.groups && Object.keys(s.groups).length) out.groups = s.groups;
  out.keys = s.keys || {};
  fs.writeFileSync(file, JSON.stringify(out, null, 2) + '\n', 'utf8');
}

module.exports = { BUNDLED_DIR, scenePath, listScenes, readScene, writeScene };
