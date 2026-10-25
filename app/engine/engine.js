'use strict';

// ornata-macos — shared device engine.
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
// The device I/O in this file wraps the native addon (addon.node) borrowed from
// razer-macos / librazermacos (also GPL). It centralizes everything that talks
// to the keyboard and mouse. Plain Node (no Electron): the app's main process
// requires it, and so does the headless smoke check (src/smoke.js).

const path = require('path');
const fs = require('fs');
const { ROWS, COLS, expand } = require('./layout');

const ADDON_PATH = path.join(__dirname, '..', 'addon.node');

// Product IDs of Ornata keyboards that share this 6x22 layout.
const ORNATA_PIDS = { 542: 'Ornata Chroma', 543: 'Ornata', 605: 'Ornata Chroma V2' };

// Supported Razer mice. Only these count as "mouse connected"; the app shows
// its mouse tab only when one of them is found.
const MOUSE_PIDS = { 153: 'Basilisk V3' };

// A device-access error the caller can recognize: it means the Razer macOS app
// (or something else) is holding the device open exclusively.
class DeviceBusyError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DeviceBusyError';
    this.code = 'DEVICE_BUSY';
  }
}

function addonError(message) {
  const e = new Error(message);
  e.code = 'NO_ADDON';
  return e;
}

function loadAddon() {
  if (!fs.existsSync(ADDON_PATH)) {
    throw addonError(
      'addon.node not found.\n' +
      'Run ./setup.sh once to copy it out of the installed "Razer macOS.app".'
    );
  }
  try {
    return require(ADDON_PATH);
  } catch (e) {
    throw addonError('could not load addon.node: ' + e.message);
  }
}

function closeAll(addon) {
  try { addon.closeAllDevices(); } catch (_) { /* ignore */ }
}

// All Razer devices the addon could open. None at all almost always means the
// Razer macOS app holds them exclusively.
function openDevices(addon) {
  let devices;
  try {
    devices = addon.getAllDevices() || [];
  } catch (e) {
    throw new Error('getAllDevices failed: ' + e.message);
  }
  if (devices.length === 0) {
    throw new DeviceBusyError(
      'No Razer device could be opened.\n' +
      'Quit the "Razer macOS" menu-bar app first — it holds the device open\n' +
      '(exclusive access), which blocks this tool. Then try again.'
    );
  }
  return devices;
}

function findKeyboard(addon) {
  const devices = openDevices(addon);
  const kbd = devices.find((d) => ORNATA_PIDS[d.productId]);
  if (!kbd) throw new Error('Ornata not found. Devices seen: ' + JSON.stringify(devices));
  return kbd;
}

// Find a supported Razer mouse (see MOUSE_PIDS).
function findMouse(addon) {
  const devices = openDevices(addon);
  const dev = devices.find((d) => MOUSE_PIDS[d.productId]);
  if (!dev) throw new Error('No supported Razer mouse found. Devices seen: ' + JSON.stringify(devices));
  return dev;
}

function keyboardName(kbd) {
  return ORNATA_PIDS[kbd.productId];
}

function mouseName(dev) {
  return MOUSE_PIDS[dev.productId];
}

// Open the devices, locate one with find(addon), run fn(addon, dev) and always
// close afterwards. The return value of fn is passed through.
function withDevice(find, fn) {
  const addon = loadAddon();
  try {
    return fn(addon, find(addon));
  } finally {
    closeAll(addon);
  }
}

const withKeyboard = (fn) => withDevice(findKeyboard, fn);
const withMouse = (fn) => withDevice(findMouse, fn);

// Check that a device is reachable without changing anything. Returns
//   { ok: true, ...describe(addon, dev) }
//   { ok: false, code: 'DEVICE_BUSY'|'NO_ADDON'|'ERROR', message }
function probeDevice(find, describe) {
  try {
    return { ok: true, ...withDevice(find, describe) };
  } catch (e) {
    return { ok: false, code: e.code || 'ERROR', message: e.message };
  }
}

function probe() {
  return probeDevice(findKeyboard, (_addon, kbd) => ({
    productId: kbd.productId, name: keyboardName(kbd), internalDeviceId: kbd.internalDeviceId,
  }));
}

function probeMouse() {
  return probeDevice(findMouse, (addon, dev) => {
    let dpi;
    try { dpi = addon.mouseGetDpi(dev.internalDeviceId); } catch (_) { dpi = null; }
    return { productId: dev.productId, name: mouseName(dev), internalDeviceId: dev.internalDeviceId, dpi };
  });
}

// Apply a lighting effect / setting to the mouse. `opts`:
//   { mode: 'static'|'spectrum'|'wave'|'off', color?, direction?, brightness?, dpi? }
// The mouse is driven as a single lighting group (the addon's "logo" mode set),
// which is how razer-macos itself lights the Basilisk V3. Returns { name }.
function applyMouse(opts) {
  const o = opts || {};
  return withMouse((addon, dev) => {
    const id = dev.internalDeviceId;
    if (o.brightness !== undefined) addon.mouseSetBrightness(id, parseBrightness(o.brightness));
    if (o.dpi !== undefined) {
      const d = Math.round(Number(o.dpi));
      if (!Number.isFinite(d) || d < 100 || d > 30000) throw new Error(`dpi must be 100..30000, got "${o.dpi}"`);
      addon.mouseSetDpi(id, d);
    }
    switch (o.mode) {
      case 'static': {
        const [r, g, b] = parseColor(o.color || '#ffffff');
        addon.mouseSetLogoModeStatic(id, new Uint8Array([r, g, b]));
        break;
      }
      case 'spectrum': addon.mouseSetLogoModeSpectrum(id); break;
      case 'wave': addon.mouseSetLogoModeWave(id, Number(o.direction) === 2 ? 2 : 1); break;
      case 'off': addon.mouseSetLogoModeNone(id); break;
      case undefined: break; // brightness/dpi-only change
      default: throw new Error(`unknown mouse mode "${o.mode}"`);
    }
    return { name: mouseName(dev) };
  });
}

// hex ("#rrggbb" / "rrggbb" / "#rgb") -> [r,g,b]
function parseColor(hex) {
  let h = String(hex).trim().replace(/^#/, '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(h)) throw new Error(`bad color "${hex}"`);
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

// Build a ROWS x COLS x 3 frame filled with a background color.
function blankFrame(bg) {
  const frame = [];
  for (let r = 0; r < ROWS; r++) {
    const row = [];
    for (let c = 0; c < COLS; c++) row.push([bg[0], bg[1], bg[2]]);
    frame.push(row);
  }
  return frame;
}

// Build a full frame from a scene-style spec:
//   { background?, groups?, keys? }
// Returns { frame, litCells }. Does no device I/O.
function buildFrame(spec) {
  const bg = parseColor((spec && spec.background) || '#000000');
  const frame = blankFrame(bg);
  const extraGroups = (spec && spec.groups) || {};
  let litCells = 0;
  for (const [key, color] of Object.entries((spec && spec.keys) || {})) {
    const rgb = parseColor(color);
    for (const [r, c] of expand(key, extraGroups)) { frame[r][c] = rgb; litCells++; }
  }
  return { frame, litCells };
}

function applyFrame(addon, id, frame) {
  for (let r = 0; r < ROWS; r++) {
    const payload = [r, 0, COLS - 1];
    for (let c = 0; c < COLS; c++) payload.push(frame[r][c][0], frame[r][c][1], frame[r][c][2]);
    addon.kbdSetCustomFrame(id, new Uint8Array(payload));
  }
  addon.kbdSetModeCustom(id);
}

// Brightness is a percentage 0..100 — and that is exactly what the addon's
// KbdSetBrightness expects (the razer-macos app drives this same keyboard with a
// 0..100 slider). Do NOT rescale to 0..255: sending 255 overshoots the valid
// range and the firmware lands on a dim/garbage level, which looked like "100%
// is still dark". Pass the percentage straight through.
function parseBrightness(pct) {
  const n = Number(pct);
  if (!Number.isFinite(n) || n < 0 || n > 100) throw new Error(`brightness must be 0..100, got "${pct}"`);
  return Math.round(n);
}

function setBrightness(addon, id, pct) {
  addon.KbdSetBrightness(id, parseBrightness(pct));
}


// Apply a scene-style spec to the keyboard. Optionally set brightness first.
// Returns { litCells, name } (device product name).
function applySpec(spec) {
  const { frame, litCells } = buildFrame(spec);
  return withKeyboard((addon, kbd) => {
    if (spec && spec.brightness !== undefined) setBrightness(addon, kbd.internalDeviceId, spec.brightness);
    applyFrame(addon, kbd.internalDeviceId, frame);
    return { litCells, name: keyboardName(kbd) };
  });
}

// The per-key custom frame is volatile (librazermacos sends it with NOSTORE),
// so the Ornata forgets it on every power cycle. A single static color, on the
// other hand, is written with VARSTORE into the keyboard's on-board memory and
// is what the board shows at power-on — before any software runs. This stores
// that startup color. If `restoreSpec` is given, that scene is re-sent right
// afterwards so the visible per-key lighting doesn't change.
// Writes flash memory: call it on an explicit user action, not on every apply.
function storeStartupColor(color, restoreSpec) {
  const rgb = parseColor(color);
  const restore = restoreSpec ? buildFrame(restoreSpec).frame : null;
  return withKeyboard((addon, kbd) => {
    const id = kbd.internalDeviceId;
    addon.kbdSetModeStatic(id, new Uint8Array(rgb));
    if (restore) {
      if (restoreSpec.brightness !== undefined) setBrightness(addon, id, restoreSpec.brightness);
      applyFrame(addon, id, restore);
    }
    return { name: keyboardName(kbd) };
  });
}

// The color covering the most lit cells of a scene (black cells ignored), as
// "#rrggbb" — a sensible startup color for that scene. null if nothing is lit.
function dominantColor(spec) {
  const counts = new Map();
  for (const row of buildFrame(spec).frame) {
    for (const [r, g, b] of row) {
      if (!r && !g && !b) continue;
      const hex = '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
      counts.set(hex, (counts.get(hex) || 0) + 1);
    }
  }
  let best = null;
  for (const [hex, n] of counts) if (!best || n > best[1]) best = [hex, n];
  return best ? best[0] : null;
}

module.exports = {
  probe, applySpec, storeStartupColor, dominantColor,
  probeMouse, applyMouse,
};
