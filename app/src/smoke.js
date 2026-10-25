'use strict';

// ornata-macos — Electron app device-layer smoke check.
// Copyright (C) 2025 André Lindner. GNU General Public License v2.0 or later.
//
// Proves the device engine reaches the native addon and the real hardware,
// WITHOUT launching a GUI. Run with:  npm run smoke
// Quit the "Razer macOS" app first (it holds the devices open exclusively).

const path = require('path');

// Mirror main.js's dev resolution (this script runs under plain node, i.e. the
// dev tree). engine.js finds app/addon.node via its own relative path.
const enginePath = path.join(__dirname, '..', 'engine', 'engine.js');
const engine = require(enginePath);

const kbd = engine.probe();
const mouse = engine.probeMouse();

console.log('engine:', enginePath);
console.log('keyboard:', JSON.stringify(kbd));
console.log('mouse:   ', JSON.stringify(mouse));

const kbdOk = kbd.ok === true;
const mouseOk = mouse.ok === true;

if (kbdOk && mouseOk) {
  console.log('\nOK — both devices reachable through the app device layer.');
  process.exit(0);
}
if (kbd.code === 'DEVICE_BUSY' || mouse.code === 'DEVICE_BUSY') {
  console.error('\nDEVICE_BUSY — quit the "Razer macOS" menu-bar app first, then retry.');
  process.exit(2);
}
console.error('\nNot all devices reachable (see above).');
process.exit(1);
