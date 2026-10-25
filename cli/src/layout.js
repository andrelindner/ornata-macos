// Physical key -> [row, col] map for the Razer Ornata Chroma (PID 0x021E)
// on its 6 x 22 lighting matrix.
//
// These coordinates are taken from the ripple animation's KEY_MAPPING table
// shipped inside the razer-macos app (which drives the exact same custom-frame
// path we use here), so they match what the hardware actually expects.

const ROWS = 6;
const COLS = 22;

const KEYS = {
  // Row 0 — Esc + function row + top-right cluster
  ESC: [0, 1],
  F1: [0, 3], F2: [0, 4], F3: [0, 5], F4: [0, 6],
  F5: [0, 7], F6: [0, 8], F7: [0, 9], F8: [0, 10],
  F9: [0, 11], F10: [0, 12], F11: [0, 13], F12: [0, 14],
  PRTSC: [0, 15], SCRLK: [0, 16], PAUSE: [0, 17],
  M1: [0, 19], M2: [0, 21], // media / extra keys

  // Row 1 — number row + nav cluster + numpad top
  BACKTICK: [1, 1],
  N1: [1, 2], N2: [1, 3], N3: [1, 4], N4: [1, 5], N5: [1, 6],
  N6: [1, 7], N7: [1, 8], N8: [1, 9], N9: [1, 10], N0: [1, 11],
  MINUS: [1, 12], EQUALS: [1, 13], BACKSPACE: [1, 14],
  INS: [1, 15], HOME: [1, 16], PGUP: [1, 17],
  NUMLOCK: [1, 18], KP_DIV: [1, 19], KP_MUL: [1, 20], KP_MINUS: [1, 21],

  // Row 2 — QWERTY row
  TAB: [2, 1],
  Q: [2, 2], W: [2, 3], E: [2, 4], R: [2, 5], T: [2, 6],
  Y: [2, 7], U: [2, 8], I: [2, 9], O: [2, 10], P: [2, 11],
  LBRACKET: [2, 12], RBRACKET: [2, 13], BACKSLASH: [2, 14],
  DEL: [2, 15], END: [2, 16], PGDN: [2, 17],
  KP7: [2, 18], KP8: [2, 19], KP9: [2, 20], KP_PLUS: [2, 21],

  // Row 3 — home row
  CAPS: [3, 1],
  A: [3, 2], S: [3, 3], D: [3, 4], F: [3, 5], G: [3, 6],
  H: [3, 7], J: [3, 8], K: [3, 9], L: [3, 10],
  SEMICOLON: [3, 11], QUOTE: [3, 12], ENTER: [3, 14],
  KP4: [3, 18], KP5: [3, 19], KP6: [3, 20],

  // Row 4 — shift row + up arrow
  LSHIFT: [4, 1],
  Z: [4, 3], X: [4, 4], C: [4, 5], V: [4, 6], B: [4, 7],
  N: [4, 8], M: [4, 9], COMMA: [4, 10], PERIOD: [4, 11], SLASH: [4, 12],
  RSHIFT: [4, 14], UP: [4, 16],
  KP1: [4, 18], KP2: [4, 19], KP3: [4, 20], KP_ENTER: [4, 21],

  // Row 5 — bottom modifier row + arrows + numpad bottom
  LCTRL: [5, 1], LWIN: [5, 2], LALT: [5, 3], SPACE: [5, 7],
  RALT: [5, 11], FN: [5, 13], RCTRL: [5, 14],
  LEFT: [5, 15], DOWN: [5, 16], RIGHT: [5, 17],
  KP0: [5, 19], KP_DEL: [5, 20],
};

// Convenient aliases so users can type the obvious thing.
const ALIASES = {
  '`': 'BACKTICK', '-': 'MINUS', '=': 'EQUALS',
  '[': 'LBRACKET', ']': 'RBRACKET', '\\': 'BACKSLASH',
  ';': 'SEMICOLON', "'": 'QUOTE', ',': 'COMMA', '.': 'PERIOD', '/': 'SLASH',
  SPACEBAR: 'SPACE', RETURN: 'ENTER', ESCAPE: 'ESC',
  CTRL: 'LCTRL', SHIFT: 'LSHIFT', ALT: 'LALT', WIN: 'LWIN', CMD: 'LWIN', SUPER: 'LWIN',
  ARROWUP: 'UP', ARROWDOWN: 'DOWN', ARROWLEFT: 'LEFT', ARROWRIGHT: 'RIGHT',
  '0': 'N0', '1': 'N1', '2': 'N2', '3': 'N3', '4': 'N4',
  '5': 'N5', '6': 'N6', '7': 'N7', '8': 'N8', '9': 'N9',
};

// A single "row,col" token -> [row, col], with bounds checking.
function coordOf(raw) {
  const coord = raw.match(/^(\d+)\s*,\s*(\d+)$/);
  if (!coord) return null;
  const r = Number(coord[1]);
  const c = Number(coord[2]);
  if (r < 0 || r >= ROWS || c < 0 || c >= COLS) {
    throw new Error(`coordinate ${raw} is outside the ${ROWS}x${COLS} matrix`);
  }
  return [r, c];
}

// Resolve a single key token to [row, col].
// Accepts a named key, an alias, or explicit "row,col" coordinates.
function resolve(token) {
  const raw = String(token).trim();
  const coord = coordOf(raw);
  if (coord) return coord;
  const name = raw.toUpperCase();
  const resolved = ALIASES[name] ? ALIASES[name] : (ALIASES[raw] || name);
  if (KEYS[resolved]) return KEYS[resolved];
  throw new Error(`unknown key "${token}" (use a name, "row,col", or a group; see: ornata list)`);
}

// Named groups of keys — assign a color to many keys at once.
const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const GROUPS = {
  ALL: Object.keys(KEYS),
  WASD: ['W', 'A', 'S', 'D'],
  ARROWS: ['UP', 'DOWN', 'LEFT', 'RIGHT'],
  LETTERS: letters,
  FKEYS: ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12'],
  NUMROW: ['N1', 'N2', 'N3', 'N4', 'N5', 'N6', 'N7', 'N8', 'N9', 'N0'],
  NUMPAD: ['NUMLOCK', 'KP_DIV', 'KP_MUL', 'KP_MINUS', 'KP7', 'KP8', 'KP9', 'KP_PLUS',
    'KP4', 'KP5', 'KP6', 'KP1', 'KP2', 'KP3', 'KP_ENTER', 'KP0', 'KP_DEL'],
  MODIFIERS: ['LSHIFT', 'RSHIFT', 'LCTRL', 'RCTRL', 'LALT', 'RALT', 'LWIN', 'FN', 'CAPS'],
  NAV: ['INS', 'HOME', 'PGUP', 'DEL', 'END', 'PGDN'],
};

// Expand a token into one or more [row, col] cells. A token may be:
//   - a group name (WASD, ARROWS, LETTERS, ...) — case-insensitive
//   - a comma-separated list (W,A,S,D  or  ESC,1,2,3)
//   - a single key name / alias / "row,col"
// `extraGroups` lets a scene define its own named groups.
function expand(token, extraGroups) {
  const raw = String(token).trim();

  // group name (built-in or scene-defined)
  const upper = raw.toUpperCase();
  const groups = Object.assign({}, GROUPS, extraGroups || {});
  const groupKey = Object.keys(groups).find((g) => g.toUpperCase() === upper);
  if (groupKey && !coordOf(raw)) {
    return groups[groupKey].flatMap((member) => expand(member, extraGroups));
  }

  // comma-separated list (but not a bare "row,col" coordinate)
  if (raw.includes(',') && !coordOf(raw)) {
    return raw.split(',').flatMap((part) => expand(part, extraGroups));
  }

  return [resolve(raw)];
}

// Short display labels for keys whose printed cap differs from the internal
// name, so the visual keyboards (web GUI and desktop app) read naturally.
const LABELS = {
  BACKTICK: '`', MINUS: '-', EQUALS: '=', LBRACKET: '[', RBRACKET: ']', BACKSLASH: '\\',
  SEMICOLON: ';', QUOTE: "'", COMMA: ',', PERIOD: '.', SLASH: '/',
  N0: '0', N1: '1', N2: '2', N3: '3', N4: '4', N5: '5', N6: '6', N7: '7', N8: '8', N9: '9',
  ESC: 'Esc', BACKSPACE: '⌫', TAB: 'Tab', CAPS: 'Caps', ENTER: 'Enter',
  LSHIFT: 'Shift', RSHIFT: 'Shift', LCTRL: 'Ctrl', RCTRL: 'Ctrl',
  LALT: 'Alt', RALT: 'Alt', LWIN: 'Cmd', FN: 'Fn', SPACE: 'Space',
  UP: '↑', DOWN: '↓', LEFT: '←', RIGHT: '→',
  PRTSC: 'PrtSc', SCRLK: 'ScrLk', PAUSE: 'Pause',
  INS: 'Ins', HOME: 'Home', PGUP: 'PgUp', DEL: 'Del', END: 'End', PGDN: 'PgDn',
  NUMLOCK: 'Num', KP_DIV: '/', KP_MUL: '*', KP_MINUS: '-', KP_PLUS: '+',
  KP_ENTER: 'Ent', KP_DEL: '.', KP0: '0', KP1: '1', KP2: '2', KP3: '3',
  KP4: '4', KP5: '5', KP6: '6', KP7: '7', KP8: '8', KP9: '9',
};

// Everything a visual keyboard needs: matrix size, every key with its
// [row, col] and label, plus the groups and aliases for client-side expansion.
function layoutPayload() {
  const keys = Object.entries(KEYS).map(([name, [row, col]]) => ({
    name, row, col, label: LABELS[name] || name,
  }));
  return { rows: ROWS, cols: COLS, keys, groups: GROUPS, aliases: ALIASES };
}

module.exports = { ROWS, COLS, KEYS, GROUPS, expand, layoutPayload };
