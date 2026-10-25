# razer-ornata-macos

Per-key RGB lighting for the **Razer Ornata Chroma** (PID `0x021E`) on macOS —
including Apple Silicon and macOS 26 (Tahoe), where it was developed and tested.

Comes with both a **command-line tool** and a **local web GUI** (a visual
keyboard you paint with your mouse). It can also control the lighting and DPI of
a connected Razer mouse (developed against the **Basilisk V3**) — see [Mouse](#mouse).

## Why this exists

Razer **Synapse 4 for Mac does not support the Ornata Chroma** — Synapse loads a
per-device UI module from Razer's servers for each supported product, and no
module was ever published for the classic Ornata. The device works as a plain
keyboard, but you get no lighting control.

The community app [**razer-macos**](https://github.com/stickoking/razer-macos)
*does* drive the Ornata, but only with whole-keyboard effects (static, wave,
spectrum, breathe, reactive, ripple). It has **no way to light individual keys
with your own colors**.

This tool fills that gap. The Ornata's hardware accepts a full custom lighting
frame over a **6×22 matrix**, and razer-macos already sends such frames for its
ripple effect — it just never exposes static per-key control. We reuse that same
path to let you paint any key any color.

## Requirements

- A Mac with the **Razer Ornata Chroma** connected.
- **razer-macos installed** (we borrow its native addon):
  download the DMG from
  [stickoking/razer-macos releases](https://github.com/stickoking/razer-macos/releases)
  and drag `Razer macOS.app` into `/Applications`.
- **Node.js 18+** (`node --version`).

> Nothing here needs Input Monitoring or Accessibility permission — those are only
> for reading keystrokes. Writing lighting frames does not.

## Setup

```bash
git clone https://github.com/andrelindner/razer-ornata-macos.git
cd razer-ornata-macos/cli     # the command-line tool lives in cli/
./setup.sh                    # extracts addon.node from /Applications/Razer macOS.app
```

> This repo has two parts: this **`cli/`** tool (command line + local web GUI) and
> a standalone desktop **`app/`** (Electron). They are independent — see the
> [root README](../README.md).

`addon.node` is the native module from razer-macos (GPL). It is **not** committed
to this repo; `setup.sh` copies it out of the app you installed.

The last step of `setup.sh` applies the **default profile** (below), so the
keyboard is lit right after installation.

## Important: quit the Razer app first

The razer-macos menu-bar app opens the keyboard **exclusively**. While it runs,
this tool cannot talk to the device (you'll see empty device lists / errors, and
the GUI shows *"Quit 'Razer macOS' app first"*). Quit it before using either the
CLI or the GUI (menu-bar icon → Quit, or `osascript -e 'quit app "Razer macOS"'`).

Launching razer-macos again later may overwrite your custom frame with its own
saved effect, so use one or the other.

## The GUI

A small, self-contained web app — a visual Ornata keyboard you paint with your
mouse and push to the hardware. No frameworks, no external CDNs; a tiny Node
server (built-ins only) does the device I/O and serves one HTML page.

### Launch

```bash
npm run gui          # or: node src/server.js  (or the `ornata-gui` bin)
```

It starts a server bound to `127.0.0.1` only, prints the URL, and opens your
browser at **http://127.0.0.1:8787/**. (Set `ORNATA_GUI_PORT` to change the port,
`ORNATA_GUI_NO_OPEN=1` to skip auto-opening the browser.) Press `Ctrl+C` to stop.

Remember to **quit "Razer macOS" first** — the status pill in the top-right shows
whether the keyboard is reachable and tells you if the app is still holding it.

### What you can do

- **Visual keyboard** laid out like the Ornata, using the real matrix
  coordinates from `src/layout.js`, with every key labelled. Cells that have no
  physical key on the Ornata are simply not shown.
- **Click a key** to paint it with the current color; **click-and-drag** across
  keys to paint many at once; **right-click** (or Shift-click) a key to clear it
  back to the background.
- A native **color picker** plus a **hex** field and quick-pick swatches.
- **Group buttons** (WASD, ARROWS, LETTERS, FKEYS, NUMROW, NUMPAD, MODIFIERS,
  NAV, ALL) apply the current color to a whole group in one click.
- A **background** color and a **brightness** slider (0–100%).
- **Apply to keyboard** pushes the current layout to the hardware; **Turn off**
  blacks everything out; **Load default profile** loads and applies the bundled
  default; **Reset** clears the editor (without touching the keyboard).
- **Profiles** — save everything you've set (all key colors, the background and
  the brightness) as a profile: **Save to scenes/** writes a `.json` into the
  project's `scenes/` folder, or **Download .json** saves it anywhere you like.
  Load one back with **Load from file** (pick any `.json` from your disk) or
  **Load bundled** (the scenes that ship with the project) to keep editing it.
- The on-screen keyboard is a **live WYSIWYG preview** — it always reflects your
  assigned colors, background and group edits, even before you apply.
- A **Mouse** panel for a connected Razer mouse (e.g. Basilisk V3): set a static
  color, Spectrum or Wave, turn its lighting off, adjust brightness, and set the
  DPI. It lights the mouse as a single zone (see [Mouse](#mouse) below).

## The CLI

```bash
# Light specific keys / groups on a background color
node src/ornata.js key WASD ff2020 ARROWS 0000ff SPACE 00ff00 --bg 0a0a2a

# Assign one color to a comma-separated list of keys
node src/ornata.js key J,K,L,SEMICOLON 00ffcc

# Re-apply the built-in default profile
node src/ornata.js default

# Apply a saved scene (background, keys, groups, brightness)
node src/ornata.js apply scenes/gaming.json

# Whole keyboard one color, at 60% brightness
node src/ornata.js all 6600ff --bright 60

# Brightness only (0..100 %)
node src/ornata.js brightness 80

# Everything off
node src/ornata.js off

# Store a power-on color in the keyboard's own memory, then re-apply a scene
node src/ornata.js startup-color 0dbd00 scenes/default.json

# Control a connected Razer mouse (Basilisk V3)
node src/ornata.js mouse color 3a7afe      # static color
node src/ornata.js mouse spectrum          # cycling spectrum
node src/ornata.js mouse dpi 1600          # set DPI
node src/ornata.js mouse info              # show name + current DPI

# List built-in groups / all key names / detected devices
node src/ornata.js groups
node src/ornata.js list
node src/ornata.js devices

# Light each matrix cell in turn — helps you map physical keys to coordinates
node src/ornata.js walk 400
```

Colors are hex: `ff0000`, `#ff0000`, or short `#f00`.
Brightness is a percentage `0..100`.

Optional convenience: install as commands with `npm link`, then run
`ornata key W ff0000 …` and `ornata-gui` directly.

### Targeting keys

A target can be any of:
- **key name** — `W`, `ESC`, `SPACE`, `ENTER`, `LSHIFT`, `UP`, `F1`, `KP0` …
- **symbol** — `` ` ``, `-`, `=`, `[`, `]`, `;`, `'`, `,`, `.`, `/`, `\`
- **digit** — `1`…`0` (top number row)
- **coordinate** — `"row,col"`, e.g. `"2,3"` is the W key
- **comma list** — `W,A,S,D` (one color to many keys)
- **group** — a named set of keys (below)

### Built-in groups

Assign one color to a whole group at once (in the CLI or the GUI):

| Group | Keys |
|-------|------|
| `WASD` | W A S D |
| `ARROWS` | ↑ ↓ ← → |
| `LETTERS` | A–Z |
| `FKEYS` | F1–F12 |
| `NUMROW` | 1–0 |
| `NUMPAD` | the number pad |
| `MODIFIERS` | Shift/Ctrl/Alt/Win/Fn/Caps |
| `NAV` | Ins Home PgUp Del End PgDn |
| `ALL` | every key |

```bash
node src/ornata.js key FKEYS ff0000 WASD 00ff00 MODIFIERS 0000ff
```

Scenes can also define **their own groups** (see below).

Run `node src/ornata.js list` for the full key map. Not every matrix cell has a
physical key (the Ornata has gaps in the top-right/media area); unused cells stay
whatever the background sets.

## Default profile

Straight after setup — and until you change it — the keyboard uses this profile
([`scenes/default.json`](scenes/default.json)):

| Keys | Colour |
|------|--------|
| Main block: number row, letters, punctuation, Tab, Caps, Shift, Enter, Backspace, modifiers, Space | green `#0dbd00` |
| Function row (F1–F12) | orange `#ff7a00` |
| Esc, Print Screen, Scroll Lock, Pause and the Insert/Home/Page Up/Delete/End/Page Down cluster | purple `#a24bff` |
| Arrow keys | blue `#3a7afe` |
| Number pad and the M1/M2 keys | red `#ff0000` |

Brightness is set to 100 % on a black background. The profile lives in the
keyboard's volatile memory: it stays until you apply something else or the
keyboard loses power (see [Notes & limitations](#notes--limitations)).

Re-apply it any time with `node src/ornata.js default` (CLI) or **Load default
profile** (GUI). Edit `scenes/default.json` to change what "default" means for
you — it's a normal scene file (see [Scene files](#scene-files)).

## Mouse

If a Razer mouse is connected (developed against the **Basilisk V3**, PID
`0x0099`), the tool can drive its lighting too — from the GUI's **Mouse** panel or
the CLI:

```bash
node src/ornata.js mouse color <hex>       # static color
node src/ornata.js mouse spectrum          # cycling spectrum
node src/ornata.js mouse wave [1|2]        # wave (optional direction)
node src/ornata.js mouse off               # lighting off
node src/ornata.js mouse brightness 0..100 # brightness
node src/ornata.js mouse dpi <100..30000>  # sensor DPI
node src/ornata.js mouse info              # name + current DPI
```

The mouse is lit as **one zone** (the driver's whole-mouse lighting mode) — the
same set of effects razer-macos offers for it. Per-zone underglow / individual
LEDs are **not** exposed by this driver, so unlike the keyboard there is no
per-LED custom frame for the mouse. Static color, Spectrum, Wave, brightness and
DPI all work. As with the keyboard, quit the “Razer macOS” app first.

## Scene files

A scene is JSON: an optional `brightness` (0..100), a `background`, optional
custom `groups`, and the `keys` you want colored. A key entry may target a single
key, a comma list, a built-in group, or one of your own groups:

```json
{
  "brightness": 80,
  "background": "#050510",
  "groups": {
    "movement": ["W", "A", "S", "D"],
    "abilities": ["Q", "E", "R", "F"]
  },
  "keys": {
    "movement": "#ff2020",
    "abilities": "#00c8ff",
    "SPACE": "#20ff20",
    "LSHIFT,LCTRL": "#ffaa00",
    "NUMROW": "#ff00ff",
    "ESC": "#ffffff"
  }
}
```

Apply a scene from the CLI with `node src/ornata.js apply scenes/<name>.json`,
or load and edit it in the GUI. See [`scenes/`](scenes) and its
[README](scenes/README.md) for more examples (`default.json`, `wasd.json`,
`arrows.json`, `gaming.json`).

## Notes & limitations

- The custom frame is shown at the keyboard's current **brightness**. If the
  board looks dark, raise it with `ornata brightness 100` (or the `--bright`
  flag / a scene's `"brightness"` field / the GUI slider).
- The frame lives in the keyboard's volatile memory until you change it, set
  another effect, or power-cycle the board. Per-key colors **cannot** be stored
  on the Ornata Chroma (the driver sends them without the "store" flag, and the
  board has no on-board profile memory) — on Windows, Synapse simply re-sends
  them at login and after sleep. What *can* be stored is a single color, which
  the board shows at power-on before any software runs:

  ```bash
  node src/ornata.js startup-color 0dbd00 scenes/default.json
  ```

  stores green as the startup color, then re-applies the default profile so
  the current lighting stays. This writes the keyboard's flash memory, so do it
  once, not on every apply.

## Architecture

The device logic lives in one shared module, [`src/engine.js`](src/engine.js)
(find the keyboard, build a frame from a `{ background, keys, groups, brightness }`
spec, apply it, set brightness, probe status). Both the CLI
([`src/ornata.js`](src/ornata.js)) and the GUI server
([`src/server.js`](src/server.js)) use it, so they behave identically. The
key→coordinate table is in [`src/layout.js`](src/layout.js) and is reused
everywhere — it is never duplicated.

## How it works

```
getAllDevices()                              find the Ornata (PID 542 / 0x021E)
kbdSetCustomFrame(id, [row,0,21, r,g,b …])   write one matrix row (×6)
kbdSetModeCustom(id)                         display the custom frame
```

The row payload format is `ROW_ID, START_COL, STOP_COL, N×RGB` — the OpenRazer
`matrix_custom_frame` protocol. The key→coordinate table in
[`src/layout.js`](src/layout.js) is taken from razer-macos's own ripple mapping,
so it matches the hardware.

## Credits & license

Built on the shoulders of:
- [OpenRazer](https://github.com/openrazer/openrazer) — the reverse-engineered protocol
- [librazermacos](https://github.com/stickoking/librazermacos) — the macOS port
- [razer-macos](https://github.com/stickoking/razer-macos) — the app whose native
  addon and matrix mapping this tool reuses

Because it derives from and links against that GPL code, this project is licensed
under the **GNU General Public License v2.0 or later**. See [LICENSE](LICENSE).

Not affiliated with or endorsed by Razer Inc. "Razer", "Ornata", and "Chroma"
are trademarks of Razer Inc.
