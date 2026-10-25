#!/usr/bin/env node
'use strict';

// ornata-macos — command-line tool: per-key lighting for the Razer Ornata
// Chroma (and a Razer mouse) on macOS. All device I/O lives in engine.js.
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

const { ROWS, COLS, KEYS, GROUPS } = require('./layout');
const { BUNDLED_DIR, scenePath, readScene } = require('./scenes');
const {
  applySpec, applyBrightness, storeStartupColor,
  applyMouse, probeMouse, listDevices,
} = require('./engine');

// ---- commands ---------------------------------------------------------------

// Pull "--bright <n>" / "--brightness <n>" (and "--bg <hex>" if allowed) out of
// an argument list. Returns { args, brightness, background }.
function parseFlags(list, allowBg) {
  const out = { args: [], brightness: undefined, background: undefined };
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (a === '--bright' || a === '--brightness') out.brightness = list[++i];
    else if (allowBg && a === '--bg') out.background = list[++i];
    else out.args.push(a);
  }
  return out;
}

function brightnessNote(b) {
  return b !== undefined ? `, brightness ${b}%` : '';
}

function cmdApply(sceneArg) {
  if (!sceneArg) fail('usage: ornata apply <scene.json>');
  const scene = readScene(sceneArg);
  const r = applySpec(scene);
  console.log(`Applied "${sceneArg}" (${r.litCells} cells${brightnessNote(scene.brightness)}) to ${r.name}.`);
}

// The shipped default profile — applied by setup.sh on first install and
// re-applied any time with `ornata default`. Per-key colors are volatile: the
// keyboard forgets them on power loss, so re-run this after a power cycle.
function cmdDefault() {
  cmdApply(scenePath(BUNDLED_DIR, 'default'));
}

// ornata key WASD ff0000 ARROWS 00ff00 J,K,L 0000ff  [--bg 101010] [--bright 80]
function cmdKeys(list) {
  const { args, brightness, background } = parseFlags(list, true);
  if (args.length === 0 || args.length % 2 !== 0) {
    fail('usage: ornata key <KEY|GROUP|k1,k2,..> <hex> [...] [--bg <hex>] [--bright 0..100]');
  }
  const keys = {};
  for (let i = 0; i < args.length; i += 2) {
    delete keys[args[i]]; // a repeated target moves to the end, so the last one wins
    keys[args[i]] = args[i + 1];
  }
  const r = applySpec({ background, brightness, keys });
  console.log(`Lit ${r.litCells} key(s) on ${r.name}.`);
}

function cmdBrightness(pct) {
  if (pct === undefined) fail('usage: ornata brightness <0..100>');
  const r = applyBrightness(pct);
  console.log(`Brightness set to ${pct}% on ${r.name}.`);
}

function cmdGroups() {
  for (const [name, members] of Object.entries(GROUPS)) {
    const shown = name === 'ALL' ? `(all ${members.length} keys)` : members.join(' ');
    console.log(`${name}: ${shown}`);
  }
}

function cmdAll(list) {
  const { args, brightness } = parseFlags(list, false);
  const hex = args[0];
  if (!hex) fail('usage: ornata all <hex> [--bright 0..100]');
  const r = applySpec({ background: hex, brightness });
  console.log(`Set ${r.name} to #${hex.replace(/^#/, '')}${brightnessNote(brightness)}.`);
}

function cmdOff() {
  const r = applySpec({});
  console.log(`All keys off on ${r.name}.`);
}

// Store a single color in the keyboard's on-board memory: it is what the board
// shows at power-on, before anything re-sends a per-key profile. Optionally
// re-apply a scene straight after so the current lighting stays as it was.
function cmdStartupColor(args) {
  const hex = args[0];
  if (!hex) fail('usage: ornata startup-color <hex> [scene.json]');
  const scene = args[1] ? readScene(args[1]) : null;
  const r = storeStartupColor(hex, scene);
  const then = scene ? `, then re-applied "${args[1]}"` : '';
  console.log(`Stored startup color #${hex.replace(/^#/, '')} on ${r.name}${then}.`);
}

// Light one cell at a time so you can map physical keys to coordinates.
// Each step opens the keyboard, writes one frame and closes it again.
function cmdWalk(delayArg) {
  const delay = Number(delayArg) || 400;
  const cells = [];
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) cells.push(`${r},${c}`);
  console.log('Walking the matrix. Watch which key lights up; Ctrl+C to stop.');
  let i = 0;
  const step = () => {
    try {
      if (i >= cells.length) {
        applySpec({});
        console.log('\nDone.');
        return;
      }
      const cell = cells[i++];
      applySpec({ keys: { [cell]: '#00ff00' } });
      process.stdout.write(`  lit [${cell}]        \r`);
      setTimeout(step, delay);
    } catch (e) {
      fail(e.message);
    }
  };
  step();
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
  console.log(JSON.stringify(listDevices(), null, 2));
}

function fail(msg) {
  console.error('Error: ' + msg);
  process.exit(1);
}

function usage() {
  console.log(`ornata-macos — per-key lighting for the Razer Ornata Chroma

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
a "row,col" coordinate, a group (WASD, ARROWS, LETTERS, FKEYS, NUMROW,
NUMPAD, MODIFIERS, NAV, ALL), or a comma list (W,A,S,D).
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
