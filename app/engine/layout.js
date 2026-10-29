// Physical key -> [row, col] map for the Razer Ornata Chroma (PID 0x021E)
// on its 6 x 22 lighting matrix.
//
// These coordinates are taken from the ripple animation's KEY_MAPPING table
// shipped inside the razer-macos app (which drives the exact same custom-frame
// path we use here), so they match what the hardware actually expects. The ISO
// keys (# and <), Fn and Menu were checked cell by cell on a German Ornata
// Chroma; its L-shaped ISO Enter is the same cell as the US Enter (3,14).

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
  SEMICOLON: [3, 11], QUOTE: [3, 12], ISO_HASH: [3, 13], ENTER: [3, 14],
  KP4: [3, 18], KP5: [3, 19], KP6: [3, 20],

  // Row 4 — shift row + up arrow
  LSHIFT: [4, 1], ISO_LESS: [4, 2],
  Z: [4, 3], X: [4, 4], C: [4, 5], V: [4, 6], B: [4, 7],
  N: [4, 8], M: [4, 9], COMMA: [4, 10], PERIOD: [4, 11], SLASH: [4, 12],
  RSHIFT: [4, 14], UP: [4, 16],
  KP1: [4, 18], KP2: [4, 19], KP3: [4, 20], KP_ENTER: [4, 21],

  // Row 5 — bottom modifier row + arrows + numpad bottom
  LCTRL: [5, 1], LWIN: [5, 2], LALT: [5, 3], SPACE: [5, 7],
  RALT: [5, 11], FN: [5, 12], MENU: [5, 13], RCTRL: [5, 14],
  LEFT: [5, 15], DOWN: [5, 16], RIGHT: [5, 17],
  KP0: [5, 19], KP_DEL: [5, 20],
};

// Convenient aliases so users can type the obvious thing.
const ALIASES = {
  '`': 'BACKTICK', '-': 'MINUS', '=': 'EQUALS',
  '[': 'LBRACKET', ']': 'RBRACKET', '\\': 'BACKSLASH',
  ';': 'SEMICOLON', "'": 'QUOTE', ',': 'COMMA', '.': 'PERIOD', '/': 'SLASH',
  '#': 'ISO_HASH', '<': 'ISO_LESS',
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
  throw new Error(`unknown key "${token}" (use a key name, "row,col", or a group)`);
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
  MODIFIERS: ['LSHIFT', 'RSHIFT', 'LCTRL', 'RCTRL', 'LALT', 'RALT', 'LWIN', 'FN', 'MENU', 'CAPS'],
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

// Keys added to the map in v1.5 (Menu, and the ISO keys # and <). A profile
// saved before doesn't mention them; such a key takes the color of the keys on
// both sides when those match, so profiles that color the whole board stay
// fully lit. The app writes these keys into every profile it saves.
const FILL_BETWEEN = {
  MENU: ['FN', 'RCTRL'],
  ISO_HASH: ['QUOTE', 'ENTER'],
  ISO_LESS: ['LSHIFT', 'Z'],
};

// Key caps of the US layout, for keys whose printed cap differs from the
// internal name, so the app's visual keyboard reads naturally.
const LABELS = {
  BACKTICK: '`', MINUS: '-', EQUALS: '=', LBRACKET: '[', RBRACKET: ']', BACKSLASH: '\\',
  SEMICOLON: ';', QUOTE: "'", COMMA: ',', PERIOD: '.', SLASH: '/',
  N0: '0', N1: '1', N2: '2', N3: '3', N4: '4', N5: '5', N6: '6', N7: '7', N8: '8', N9: '9',
  ESC: 'Esc', BACKSPACE: '⌫', TAB: 'Tab', CAPS: 'Caps', ENTER: 'Enter',
  LSHIFT: 'Shift', RSHIFT: 'Shift', LCTRL: 'Ctrl', RCTRL: 'Ctrl',
  LALT: 'Alt', RALT: 'Alt', LWIN: 'Cmd', FN: 'Fn', MENU: '☰', SPACE: '',
  UP: '↑', DOWN: '↓', LEFT: '←', RIGHT: '→',
  PRTSC: 'PrtSc', SCRLK: 'ScrLk', PAUSE: 'Pause',
  INS: 'Ins', HOME: 'Home', PGUP: 'PgUp', DEL: 'Del', END: 'End', PGDN: 'PgDn',
  NUMLOCK: 'Num', KP_DIV: '/', KP_MUL: '*', KP_MINUS: '-', KP_PLUS: '+',
  KP_ENTER: 'Ent', KP_DEL: '.', KP0: '0', KP1: '1', KP2: '2', KP3: '3',
  KP4: '4', KP5: '5', KP6: '6', KP7: '7', KP8: '8', KP9: '9',
  ISO_HASH: '#', ISO_LESS: '<',
};

// What a German (QWERTZ) Ornata prints where it differs from the US caps.
const LABELS_DE = {
  BACKTICK: '^', MINUS: 'ß', EQUALS: '´', TAB: '↹', CAPS: '⇪', ENTER: '↵',
  LSHIFT: '⇧', RSHIFT: '⇧', Y: 'Z', Z: 'Y',
  LBRACKET: 'Ü', RBRACKET: '+', SEMICOLON: 'Ö', QUOTE: 'Ä', SLASH: '-',
  LCTRL: 'Strg', RCTRL: 'Strg', RALT: 'Alt Gr',
  PRTSC: 'Druck', SCRLK: 'Rollen', INS: 'Einfg', HOME: 'Pos1', PGUP: 'Bild↑',
  DEL: 'Entf', END: 'Ende', PGDN: 'Bild↓', KP_ENTER: 'Enter', KP_DEL: ',',
};

// --- physical layout of the visual keyboard ---------------------------------
// Positions and sizes are in key units (1 = an ordinary key, gaps included).
// The main block is 15 units wide; the navigation keys and the numpad follow
// with a quarter-unit gap. The lighting doesn't depend on any of this — a
// key's [row, col] above stays its LED cell.
const BOARD_WIDTH = 22.5;
const BOARD_HEIGHT = 6.25;
const ROW_Y = [0, 1.25, 2.25, 3.25, 4.25, 5.25]; // the function row stands apart
const NAV_X = 15.25;
const PAD_X = 18.5;

// Keys outside the main block, the same in every layout: [x, row, w, h].
const FIXED = {
  ESC: [0, 0], F1: [2, 0], F2: [3, 0], F3: [4, 0], F4: [5, 0],
  F5: [6.5, 0], F6: [7.5, 0], F7: [8.5, 0], F8: [9.5, 0],
  F9: [11, 0], F10: [12, 0], F11: [13, 0], F12: [14, 0],
  PRTSC: [NAV_X, 0], SCRLK: [NAV_X + 1, 0], PAUSE: [NAV_X + 2, 0],
  M1: [PAD_X + 1, 0], M2: [PAD_X + 3, 0],
  INS: [NAV_X, 1], HOME: [NAV_X + 1, 1], PGUP: [NAV_X + 2, 1],
  DEL: [NAV_X, 2], END: [NAV_X + 1, 2], PGDN: [NAV_X + 2, 2],
  UP: [NAV_X + 1, 4], LEFT: [NAV_X, 5], DOWN: [NAV_X + 1, 5], RIGHT: [NAV_X + 2, 5],
  NUMLOCK: [PAD_X, 1], KP_DIV: [PAD_X + 1, 1], KP_MUL: [PAD_X + 2, 1], KP_MINUS: [PAD_X + 3, 1],
  KP7: [PAD_X, 2], KP8: [PAD_X + 1, 2], KP9: [PAD_X + 2, 2], KP_PLUS: [PAD_X + 3, 2, 1, 2],
  KP4: [PAD_X, 3], KP5: [PAD_X + 1, 3], KP6: [PAD_X + 2, 3],
  KP1: [PAD_X, 4], KP2: [PAD_X + 1, 4], KP3: [PAD_X + 2, 4], KP_ENTER: [PAD_X + 3, 4, 1, 2],
  KP0: [PAD_X, 5, 2], KP_DEL: [PAD_X + 2, 5],
};

// The main block row by row (rows 1-5), left to right from x = 0. An entry is
// a key name or [name, width, height, shape].
const NUMBER_ROW = ['BACKTICK', 'N1', 'N2', 'N3', 'N4', 'N5', 'N6', 'N7', 'N8', 'N9', 'N0',
  'MINUS', 'EQUALS', ['BACKSPACE', 2]];
const TOP_LETTERS = ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P', 'LBRACKET', 'RBRACKET'];
const HOME_LETTERS = ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', 'SEMICOLON', 'QUOTE'];
const BOTTOM_LETTERS = ['Z', 'X', 'C', 'V', 'B', 'N', 'M', 'COMMA', 'PERIOD', 'SLASH'];
const SPACE_ROW = [['LCTRL', 1.25], ['LWIN', 1.25], ['LALT', 1.25], ['SPACE', 6.25],
  ['RALT', 1.25], ['FN', 1.25], ['MENU', 1.25], ['RCTRL', 1.25]];

const LAYOUTS = {
  de: {
    name: 'German (QWERTZ, ISO)',
    labels: { ...LABELS, ...LABELS_DE },
    main: [
      NUMBER_ROW,
      [['TAB', 1.5], ...TOP_LETTERS, ['ENTER', 1.5, 2, 'iso-enter']],
      [['CAPS', 1.75], ...HOME_LETTERS, 'ISO_HASH'],
      [['LSHIFT', 1.25], 'ISO_LESS', ...BOTTOM_LETTERS, ['RSHIFT', 2.75]],
      SPACE_ROW,
    ],
  },
  us: {
    name: 'English US (QWERTY, ANSI)',
    labels: LABELS,
    main: [
      NUMBER_ROW,
      [['TAB', 1.5], ...TOP_LETTERS, ['BACKSLASH', 1.5]],
      [['CAPS', 1.75], ...HOME_LETTERS, ['ENTER', 2.25]],
      [['LSHIFT', 2.25], ...BOTTOM_LETTERS, ['RSHIFT', 2.75]],
      SPACE_ROW,
    ],
  },
};
const DEFAULT_LAYOUT = 'us';

// name -> { x, y, w, h, shape } for one layout.
function geometry(main) {
  const geo = {};
  for (const [name, [x, row, w = 1, h = 1]] of Object.entries(FIXED)) {
    geo[name] = { x, y: ROW_Y[row], w, h };
  }
  main.forEach((entries, i) => {
    let x = 0;
    for (const entry of entries) {
      const [name, w = 1, h = 1, shape] = Array.isArray(entry) ? entry : [entry];
      geo[name] = { x, y: ROW_Y[i + 1], w, h, ...(shape ? { shape } : {}) };
      x += w;
    }
  });
  return geo;
}

// The layouts the settings offer: [{ id, name }].
function layoutChoices() {
  return Object.entries(LAYOUTS).map(([id, l]) => ({ id, name: l.name }));
}

// Everything a visual keyboard needs: matrix size, the board size in key
// units, every key of the layout with its [row, col], cap and place, plus the
// groups and aliases for client-side expansion. Keys a layout doesn't have
// (the ISO keys on US boards, the US backslash on ISO boards) are left out.
function layoutPayload(id) {
  const layout = LAYOUTS[id] ? id : DEFAULT_LAYOUT;
  const { labels, main } = LAYOUTS[layout];
  const keys = Object.entries(geometry(main)).map(([name, place]) => {
    const [row, col] = KEYS[name];
    return { name, row, col, label: labels[name] ?? name, ...place };
  });
  return {
    layout, rows: ROWS, cols: COLS, width: BOARD_WIDTH, height: BOARD_HEIGHT,
    keys, groups: GROUPS, aliases: ALIASES, fillBetween: FILL_BETWEEN,
  };
}

module.exports = { ROWS, COLS, FILL_BETWEEN, expand, layoutPayload, layoutChoices };
