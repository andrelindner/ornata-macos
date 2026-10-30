'use strict';

// ornata-macos — macros: shortcuts that play recorded key presses.
// Copyright (C) 2025 André Lindner. GNU General Public License v2.0 or later.
//
// The macros live in settings.json (config.macros), so a backup carries them
// with the settings. The native helper (native/ornata-keys.swift) watches the
// keyboard and presses the keys; this module keeps it running while it is
// needed and relays between it and the window.
//
// A macro: { id, name, shortcut: { mods: ['ctrl', …], keys: [keyCode, …] } | null,
//            presses: [{ key, at, hold }], repeat: { mode: 'once'|'times'|'loop', times } }
// Key codes are macOS virtual key codes, times are milliseconds.

const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const readline = require('readline');

const MOD_NAMES = ['ctrl', 'alt', 'shift', 'cmd'];
// Modifiers, Caps Lock and Fn can't be the main keys of a shortcut.
const MODIFIER_CODES = new Set([54, 55, 56, 57, 58, 59, 60, 61, 62, 63]);
const MAX_NAME = 60;
const MAX_PRESSES = 1000;
const MAX_MS = 60 * 60 * 1000;
const MAX_SHORTCUT_KEYS = 3;
const MAX_TIMES = 999;
const MIN_HOLD_MS = 10;
const RESTART_DELAY_MS = 3000;

const isKey = (v) => Number.isInteger(v) && v >= 0 && v < 128;
const clampMs = (v, min) => Math.min(MAX_MS, Math.max(min, Math.round(Number(v) || 0)));

function newId() {
  return crypto.randomBytes(4).toString('hex');
}

function normalizeShortcut(s) {
  if (!s || typeof s !== 'object') return null;
  const keys = [...new Set((Array.isArray(s.keys) ? s.keys : []).filter((k) => isKey(k) && !MODIFIER_CODES.has(k)))]
    .slice(0, MAX_SHORTCUT_KEYS).sort((a, b) => a - b);
  if (!keys.length) return null;
  const mods = MOD_NAMES.filter((m) => Array.isArray(s.mods) && s.mods.includes(m));
  return { mods, keys };
}

function normalizeMacro(m) {
  if (!m || typeof m !== 'object') return null;
  const presses = (Array.isArray(m.presses) ? m.presses : [])
    .filter((p) => p && isKey(p.key))
    .slice(0, MAX_PRESSES)
    .map((p) => ({ key: p.key, at: clampMs(p.at, 0), hold: clampMs(p.hold, MIN_HOLD_MS) }))
    .sort((a, b) => a.at - b.at);
  const r = m.repeat && typeof m.repeat === 'object' ? m.repeat : {};
  const mode = ['once', 'times', 'loop'].includes(r.mode) ? r.mode : 'once';
  return {
    id: typeof m.id === 'string' && /^[\w-]{1,32}$/.test(m.id) ? m.id : newId(),
    name: String(m.name || '').trim().slice(0, MAX_NAME) || 'Macro',
    shortcut: normalizeShortcut(m.shortcut),
    presses,
    repeat: { mode, times: Math.min(MAX_TIMES, Math.max(1, Math.round(Number(r.times) || 1))) },
  };
}

const shortcutKey = (s) => (s ? `${s.mods.join('+')}|${s.keys.join(',')}` : '');

// Drops broken entries, repeated ids and shortcuts a macro before already uses.
function normalizeMacros(list) {
  const out = [];
  const ids = new Set();
  const shortcuts = new Set();
  for (const raw of Array.isArray(list) ? list : []) {
    const m = normalizeMacro(raw);
    if (!m) continue;
    if (ids.has(m.id)) m.id = newId();
    ids.add(m.id);
    const sk = shortcutKey(m.shortcut);
    if (sk && shortcuts.has(sk)) m.shortcut = null;
    else if (sk) shortcuts.add(sk);
    out.push(m);
  }
  return out;
}

// What the helper needs to know about a macro.
function helperMacro(m) {
  return {
    id: m.id,
    mods: m.shortcut ? m.shortcut.mods : [],
    keys: m.shortcut ? m.shortcut.keys : [],
    presses: m.presses,
    repeat: m.repeat,
  };
}

// opts: { binPath, args, config, saveConfig, onChange, send(channel, payload) }
//   args        extra helper arguments (a dev run passes --dry-run)
//   config      the app's settings object (macros, macrosEnabled live there)
//   saveConfig  persists it (and schedules the backup)
//   onChange    the macros or the on/off state changed (tray menu)
//   send        message to the main window
function createMacros(opts) {
  const { binPath, saveConfig, onChange, send } = opts;
  const args = opts.args || [];
  const config = () => opts.config();
  let proc = null;
  let windowWantsHelper = false; // the window shows a macro (permissions, recording)
  let restartTimer = null;
  const status = {
    helper: fs.existsSync(binPath) ? 'stopped' : 'missing',
    tap: false,
    inputMonitoring: null,
    accessibility: null,
    playing: null,
    error: null,
  };
  let keyNames = {};

  const macros = () => config().macros;
  const enabled = () => config().macrosEnabled !== false;

  function pushStatus() { send('macros-status', { ...status }); }

  // Only macros with a shortcut and keys go to the helper, and none while
  // macros are switched off — then it doesn't even watch the keyboard.
  function activeList() {
    if (!enabled()) return [];
    return macros().filter((m) => m.shortcut && m.presses.length).map(helperMacro);
  }

  function needed() {
    return windowWantsHelper || activeList().length > 0;
  }

  function write(obj) {
    if (proc && proc.stdin.writable) proc.stdin.write(JSON.stringify(obj) + '\n');
  }

  function start() {
    if (proc || status.helper === 'missing') return;
    clearTimeout(restartTimer);
    let child;
    try {
      child = spawn(binPath, args, { stdio: ['pipe', 'pipe', 'ignore'] });
    } catch (e) {
      status.helper = 'error';
      status.error = e.message;
      pushStatus();
      return;
    }
    proc = child;
    status.helper = 'running';
    status.error = null;
    child.on('error', (e) => { status.error = e.message; });
    child.on('exit', () => {
      if (proc !== child) return;
      proc = null;
      status.helper = 'stopped';
      status.tap = false;
      status.playing = null;
      pushStatus();
      // It crashed or was killed from outside: try again while it's needed.
      if (needed()) restartTimer = setTimeout(sync, RESTART_DELAY_MS);
    });
    readline.createInterface({ input: child.stdout }).on('line', (line) => {
      let evt;
      try { evt = JSON.parse(line); } catch (_) { return; }
      handleEvent(evt);
    });
    write({ cmd: 'keyNames' });
    write({ cmd: 'permissions' });
    write({ cmd: 'macros', list: activeList() });
    pushStatus();
  }

  function stop() {
    clearTimeout(restartTimer);
    if (!proc) return;
    const child = proc;
    proc = null;
    child.stdin.end(); // the helper releases its keys and quits
    setTimeout(() => { if (child.exitCode === null) child.kill(); }, 1500);
    status.helper = 'stopped';
    status.tap = false;
    status.playing = null;
    pushStatus();
  }

  // Start, update or stop the helper to match the macros and the window.
  function sync() {
    if (needed()) {
      if (!proc) start();
      else write({ cmd: 'macros', list: activeList() });
    } else {
      stop();
    }
  }

  function handleEvent(evt) {
    switch (evt.event) {
      case 'permissions':
        status.inputMonitoring = !!evt.inputMonitoring;
        status.accessibility = !!evt.accessibility;
        pushStatus();
        break;
      case 'tap':
        status.tap = !!evt.active;
        pushStatus();
        break;
      case 'playing':
        status.playing = evt.id;
        pushStatus();
        break;
      case 'stopped':
        if (status.playing === evt.id) status.playing = null;
        pushStatus();
        break;
      case 'keyNames':
        keyNames = evt.names || {};
        send('macros-keynames', keyNames);
        break;
      case 'key':
        send('macros-key', { key: evt.key, down: !!evt.down, t: evt.t, mods: evt.mods || [] });
        break;
      case 'error':
        status.error = evt.message;
        pushStatus();
        break;
      default:
    }
  }

  function store(list) {
    config().macros = normalizeMacros(list);
    saveConfig();
    sync();
    onChange();
  }

  function state() {
    return { macros: macros(), enabled: enabled(), status: { ...status }, keyNames };
  }

  function registerIpc(ipcMain, { confirmDelete, openExternal }) {
    // The window opened the macros: the helper reports permissions and key names.
    ipcMain.handle('macros:get', () => {
      windowWantsHelper = true;
      sync();
      return state();
    });

    ipcMain.handle('macros:save', (_e, raw) => {
      const m = normalizeMacro(raw);
      if (!m) return { ok: false, error: 'Not a macro.' };
      const sk = shortcutKey(m.shortcut);
      const clash = sk && macros().find((o) => o.id !== m.id && shortcutKey(o.shortcut) === sk);
      if (clash) return { ok: false, error: `“${clash.name}” already uses this shortcut.`, ...state() };
      const list = macros().slice();
      const i = list.findIndex((o) => o.id === m.id);
      if (i >= 0) list[i] = m; else list.push(m);
      store(list);
      return { ok: true, macro: m, ...state() };
    });

    ipcMain.handle('macros:delete', async (_e, id) => {
      const m = macros().find((o) => o.id === id);
      if (!m) return { ok: false, error: 'That macro doesn’t exist anymore.' };
      if (!(await confirmDelete(m.name))) return { ok: false, canceled: true };
      if (status.playing === id) write({ cmd: 'stop' });
      store(macros().filter((o) => o.id !== id));
      return { ok: true, ...state() };
    });

    ipcMain.handle('macros:setEnabled', (_e, on) => {
      setEnabled(!!on);
      return state();
    });

    // Recording and shortcut entry: every key goes to the window.
    ipcMain.handle('macros:capture', (_e, on) => {
      windowWantsHelper = true;
      sync();
      write({ cmd: 'capture', on: !!on });
      return { ...status };
    });

    ipcMain.handle('macros:play', (_e, raw, delayMs) => {
      const m = normalizeMacro(raw);
      if (!m || !m.presses.length) return { ok: false, error: 'The macro has no keys yet.' };
      windowWantsHelper = true;
      sync();
      write({ cmd: 'play', id: m.id, macro: helperMacro(m), delay: clampMs(delayMs, 0) });
      return { ok: true };
    });

    ipcMain.handle('macros:stop', () => { write({ cmd: 'stop' }); return { ok: true }; });

    ipcMain.handle('macros:requestAccess', () => {
      windowWantsHelper = true;
      sync();
      write({ cmd: 'requestPermissions' });
      return { ok: true };
    });

    // After permissions changed in System Settings: start the helper afresh.
    ipcMain.handle('macros:restartHelper', () => {
      stop();
      sync();
      return { ok: true };
    });

    ipcMain.handle('macros:openPrivacy', (_e, which) => openExternal(
      which === 'accessibility'
        ? 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'
        : 'x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent'));
  }

  function setEnabled(on) {
    config().macrosEnabled = on;
    saveConfig();
    sync();
    onChange();
    send('macros-changed', state());
  }

  // A restore brought other macros.
  function replaceAll(list) {
    store(list);
    send('macros-changed', state());
  }

  return {
    registerIpc, sync, stop, setEnabled, replaceAll,
    enabled, count: () => macros().length,
  };
}

module.exports = { createMacros, normalizeMacros };
