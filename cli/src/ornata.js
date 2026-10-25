#!/usr/bin/env node
'use strict';

// Per-key lighting for the Razer Ornata Chroma on macOS.
//
// Reuses the native addon (addon.node) from an installed razer-macos build,
// which wraps librazermacos / OpenRazer. We talk to the keyboard through the
// same custom-frame path the app uses for its ripple effect:
//
//   getAllDevices()                     -> find the Ornata (PID 542 / 0x021E)
//   kbdSetCustomFrame(id, rowBytes)     -> write one matrix row
//   kbdSetModeCustom(id)                -> display the written frame
//
// A row payload is [ROW_ID, START_COL, STOP_COL, r,g,b, r,g,b, ...].

const path = require('path');
const fs = require('fs');
const { ROWS, COLS, KEYS, GROUPS, expand } = require('./layout');
const {
  ORNATA_PIDS,
  parseColor, blankFrame, applyFrame,
  setBrightness, withKeyboard, loadAddon,
  applyMouse, probeMouse, storeStartupColor,
} = require('./engine');

// ---- commands ---------------------------------------------------------------

function cmdApply(sceneArg) {
  if (!sceneArg) fail('usage: ornata apply <scene.json>');
  const scene = JSON.parse(fs.readFileSync(sceneArg, 'utf8'));
  const bg = parseColor(scene.background || '#000000');
  const frame = blankFrame(bg);
  // scene.groups: optional custom named groups, e.g. { "movement": ["W","A","S","D"] }
  const extraGroups = scene.groups || {};
  let litCells = 0;
  for (const [key, color] of Object.entries(scene.keys || {})) {
    const rgb = parseColor(color);
    for (const [r, c] of expand(key, extraGroups)) { frame[r][c] = rgb; litCells++; }
  }
  withKeyboard((addon, kbd) => {
    if (scene.brightness !== undefined) setBrightness(addon, kbd.internalDeviceId, scene.brightness);
    applyFrame(addon, kbd.internalDeviceId, frame);
    const b = scene.brightness !== undefined ? `, brightness ${scene.brightness}%` : '';
    console.log(`Applied "${sceneArg}" (${litCells} cells${b}) to ${ORNATA_PIDS[kbd.productId]}.`);
  });
}

// The shipped default profile — applied by setup.sh on first install and
// re-applied any time with `ornata default`. Lives in the keyboard until changed.
function cmdDefault() {
  cmdApply(path.join(__dirname, '..', 'scenes', 'default.json'));
}

function cmdKeys(pairs) {
  // ornata key WASD ff0000 ARROWS 00ff00 J,K,L 0000ff  [--bg 101010] [--bright 80]
  let bg = [0, 0, 0];
  let brightness;
  const args = [];
  for (let i = 0; i < pairs.length; i++) {
    if (pairs[i] === '--bg') { bg = parseColor(pairs[++i]); continue; }
    if (pairs[i] === '--bright' || pairs[i] === '--brightness') { brightness = pairs[++i]; continue; }
    args.push(pairs[i]);
  }
  if (args.length === 0 || args.length % 2 !== 0) {
    fail('usage: ornata key <KEY|GROUP|k1,k2,..> <hex> [...] [--bg <hex>] [--bright 0..100]');
  }
  const frame = blankFrame(bg);
  let litCells = 0;
  for (let i = 0; i < args.length; i += 2) {
    const rgb = parseColor(args[i + 1]);
    for (const [r, c] of expand(args[i])) { frame[r][c] = rgb; litCells++; }
  }
  withKeyboard((addon, kbd) => {
    if (brightness !== undefined) setBrightness(addon, kbd.internalDeviceId, brightness);
    applyFrame(addon, kbd.internalDeviceId, frame);
    console.log(`Lit ${litCells} key(s) on ${ORNATA_PIDS[kbd.productId]}.`);
  });
}

function cmdBrightness(pct) {
  if (pct === undefined) fail('usage: ornata brightness <0..100>');
  withKeyboard((addon, kbd) => {
    setBrightness(addon, kbd.internalDeviceId, pct);
    console.log(`Brightness set to ${pct}% on ${ORNATA_PIDS[kbd.productId]}.`);
  });
}

function cmdGroups() {
  for (const [name, members] of Object.entries(GROUPS)) {
    const shown = name === 'ALL' ? `(all ${members.length} keys)` : members.join(' ');
    console.log(`${name}: ${shown}`);
  }
}

function cmdAll(args) {
  const hex = args[0];
  if (!hex) fail('usage: ornata all <hex> [--bright 0..100]');
  let brightness;
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--bright' || args[i] === '--brightness') brightness = args[++i];
  }
  const frame = blankFrame(parseColor(hex));
  withKeyboard((addon, kbd) => {
    if (brightness !== undefined) setBrightness(addon, kbd.internalDeviceId, brightness);
    applyFrame(addon, kbd.internalDeviceId, frame);
    console.log(`Set whole keyboard to #${hex.replace(/^#/, '')}.`);
  });
}

function cmdOff() {
  const frame = blankFrame([0, 0, 0]);
  withKeyboard((addon, kbd) => {
    applyFrame(addon, kbd.internalDeviceId, frame);
    console.log('All keys off (custom frame, everything black).');
  });
}

// Store a single color in the keyboard's on-board memory: it is what the board
// shows at power-on, before anything re-sends a per-key profile. Optionally
// re-apply a scene straight after so the current lighting stays as it was.
function cmdStartupColor(args) {
  const hex = args[0];
  if (!hex) fail('usage: ornata startup-color <hex> [scene.json]');
  const scene = args[1] ? JSON.parse(fs.readFileSync(args[1], 'utf8')) : null;
  const r = storeStartupColor(hex, scene);
  const then = scene ? `, then re-applied "${args[1]}"` : '';
  console.log(`Stored startup color #${hex.replace(/^#/, '')} on ${r.name}${then}.`);
}

// Light one cell at a time so you can map physical keys to coordinates.
function cmdWalk(delayArg) {
  const delay = Number(delayArg) || 400;
  const cells = [];
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) cells.push([r, c]);
  withKeyboard((addon, kbd) => {
    const id = kbd.internalDeviceId;
    let i = 0;
    console.log('Walking the matrix. Watch which key lights up; Ctrl+C to stop.');
    const step = () => {
      if (i >= cells.length) {
        applyFrame(addon, id, blankFrame([0, 0, 0]));
        try { addon.closeAllDevices(); } catch (_) {}
        console.log('Done.');
        process.exit(0);
      }
      const [r, c] = cells[i++];
      const frame = blankFrame([0, 0, 0]);
      frame[r][c] = [0, 255, 0];
      applyFrame(addon, id, frame);
      process.stdout.write(`  lit [${r},${c}]        \r`);
      setTimeout(step, delay);
    };
    step();
  });
}

function cmdList() {
  const byRow = Array.from({ length: ROWS }, () => []);
  for (const [name, [r, c]] of Object.entries(KEYS)) byRow[r].push([c, name]);
  byRow.forEach((row, r) => {
    row.sort((a, b) => a[0] - b[0]);
    console.log(`row ${r}: ` + row.map(([c, n]) => `${n}(${r},${c})`).join('  '));
  });
}

// Control a connected Razer mouse (e.g. Basilisk V3). The mouse is lit as a
// single group: static color, spectrum, wave, or off; plus brightness and DPI.
function cmdMouse(args) {
  const sub = args[0];
  const rest = args.slice(1);

  if (sub === undefined || sub === 'info') {
    const s = probeMouse();
    if (!s.ok) fail(s.message);
    console.log(`${s.name} — DPI ${s.dpi != null ? s.dpi : 'n/a'} (device id ${s.internalDeviceId})`);
    return;
  }

  let opts;
  let done;
  switch (sub) {
    case 'color':
      if (!rest[0]) fail('usage: ornata mouse color <hex>');
      opts = { mode: 'static', color: rest[0] };
      done = `Mouse set to #${rest[0].replace(/^#/, '')}`;
      break;
    case 'spectrum': opts = { mode: 'spectrum' }; done = 'Mouse set to spectrum'; break;
    case 'wave': opts = { mode: 'wave', direction: rest[0] }; done = 'Mouse set to wave'; break;
    case 'off': opts = { mode: 'off' }; done = 'Mouse lighting off'; break;
    case 'brightness':
    case 'bright':
      if (rest[0] === undefined) fail('usage: ornata mouse brightness <0..100>');
      opts = { brightness: rest[0] }; done = `Mouse brightness ${rest[0]}%`;
      break;
    case 'dpi':
      if (rest[0] === undefined) fail('usage: ornata mouse dpi <100..30000>');
      opts = { dpi: rest[0] }; done = `Mouse DPI ${rest[0]}`;
      break;
    default:
      fail(`unknown mouse subcommand "${sub}" (use: color, spectrum, wave, off, brightness, dpi, info)`);
  }
  const r = applyMouse(opts);
  console.log(`${done} on ${r.name}.`);
}

function cmdDevices() {
  const addon = loadAddon();
  console.log(JSON.stringify(addon.getAllDevices(), null, 2));
}

function fail(msg) {
  console.error('Error: ' + msg);
  process.exit(1);
}

function usage() {
  console.log(`razer-ornata-macos — per-key lighting for the Razer Ornata Chroma

Usage:
  ornata key <KEY|GROUP|k1,k2> <hex> [...] [--bg <hex>] [--bright 0..100]
                                         light keys/groups on a background
  ornata default                         apply the built-in default profile
  ornata apply <scene.json>              apply a scene (background, keys, groups, brightness)
  ornata all <hex> [--bright 0..100]     set the whole keyboard to one color
  ornata brightness <0..100>             set keyboard brightness only
  ornata off                             turn all keys off
  ornata startup-color <hex> [scene.json]
                                         store a color in the keyboard's own memory,
                                         shown at power-on (per-key colors can't be
                                         stored); optionally re-apply a scene after
  ornata mouse <color <hex>|spectrum|wave [1|2]|off|brightness <0..100>|dpi <n>|info>
                                         control a connected Razer mouse (Basilisk V3)
  ornata groups                          list built-in key groups
  ornata list                            list all key names and coordinates
  ornata walk [ms]                       light each matrix cell in turn (mapping aid)
  ornata devices                         list detected Razer devices

Targets can be a key name (W, ESC, SPACE, LEFT), a symbol (';', '/'),
a "row,col" coordinate, a group (WASD, ARROWS, LETTERS, FKEYS, NUMPAD,
MODIFIERS, NAV, ALL), or a comma list (W,A,S,D).
Colors are hex: ff0000, #ff0000 or #f00. Brightness is a percentage 0..100.

NOTE: quit the "Razer macOS" menu-bar app first — it holds the keyboard open.`);
}

function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  try {
    switch (cmd) {
      case 'apply': return cmdApply(rest[0]);
      case 'default': return cmdDefault();
      case 'key': return cmdKeys(rest);
      case 'all': return cmdAll(rest);
      case 'off': return cmdOff();
      case 'startup-color': return cmdStartupColor(rest);
      case 'brightness':
      case 'bright': return cmdBrightness(rest[0]);
      case 'groups': return cmdGroups();
      case 'mouse': return cmdMouse(rest);
      case 'walk': return cmdWalk(rest[0]);
      case 'list': return cmdList();
      case 'devices': return cmdDevices();
      case undefined:
      case '-h':
      case '--help':
      case 'help': return usage();
      default:
        console.error(`unknown command: ${cmd}\n`);
        return usage();
    }
  } catch (e) {
    fail(e.message);
  }
}

main();
