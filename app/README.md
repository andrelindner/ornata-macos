# Razer Ornata Lighting — desktop app

A standalone **macOS desktop app** (Electron) for controlling the lighting of the
**Razer Ornata Chroma** keyboard (per-key RGB) and a **Razer Basilisk V3** mouse.
It is a proper double-clickable `.app` with a window *and* a menu-bar (tray)
presence.

It reuses the proven device engine from [`../cli`](../cli) (`cli/src/engine.js`)
and the same native addon (`addon.node`) — nothing about the USB protocol is
reimplemented here. Because Electron's main process is Node, it `require`s that
engine directly and drives the hardware from the main process; the window (the
renderer) talks to it only over IPC (`contextIsolation: true`,
`nodeIntegration: false`, a small typed `window.razer.*` API in `preload.js`).

## What it can do

- **Visual keyboard** laid out from the real hardware matrix, every key
  labelled. Click to paint, click-drag to paint many, right-click / Shift-click
  to clear a key back to the background. Live WYSIWYG preview.
- **Color picker + hex field + swatches**, one-click **group** painting (WASD,
  ARROWS, LETTERS, FKEYS, NUMROW, NUMPAD, MODIFIERS, NAV, ALL), a **background**
  color, and a **brightness** slider (0–100).
- **Apply to keyboard**, **Turn off**, **Load default profile**, **Reset**.
- **Profiles**: save the current colors + background + brightness to the bundled
  `scenes/` folder *or* anywhere via a native **Save** dialog; load from the
  bundled scenes *or* any local `.json` via a native **Open** dialog. Uses the
  same scene JSON format as the CLI: `{ brightness?, background?, groups?, keys{} }`.
- **Mouse panel** for the Basilisk V3: static **Color**, **Spectrum**, **Wave**,
  **Off**, **Brightness** (0–100) and **DPI**, plus a status line. (There is no
  wave-speed / colour-flow control — the hardware has no wave speed.)
- **Menu-bar (tray) icon** with: Show/Hide window, Apply Default Profile, Turn
  Keyboard Off, Settings, Quit. Closing the window keeps the app alive in the
  menu bar.
- **Keeps the lighting alive**: re-applies the profile after wake/unlock and can
  store a power-on color in the keyboard (see [Settings](#settings-menu-bar--settings)).
- A device **status indicator**; when the driver reports the device is busy it
  tells you to quit the Razer macOS app first.

## Requirements

- macOS (developed/tested on Apple Silicon, macOS 26 Tahoe).
- [Node.js](https://nodejs.org/) 18+ and npm.
- The native addon `addon.node`, extracted from an installed *Razer macOS.app*
  (see below). It is **GPL** and device-specific, so it is **not** committed.
- The community app [razer-macos](https://github.com/stickoking/razer-macos)
  installed (that is where `addon.node` comes from).

> The razer-macos menu-bar app opens the keyboard **exclusively**. **Quit it**
> before using this app, or the device can't be reached. From a terminal:
> `osascript -e 'quit app "Razer macOS"'`

## Get the addon

The app finds the addon via the sibling `cli/` folder, so just run the CLI's
setup once (it extracts `addon.node` out of the installed Razer app):

```bash
cd ../cli
./setup.sh            # or: ./setup.sh "/Applications/Razer macOS.app"
```

That produces `cli/addon.node`. Alternatively, from this folder:

```bash
./setup.sh            # thin wrapper that calls ../cli/setup.sh
```

`cli/src/engine.js` resolves its addon as `path.join(__dirname, '..', 'addon.node')`,
i.e. `cli/addon.node`, so once the file is there both the CLI and this app find it
automatically. Neither `addon.node` nor `node_modules/` is committed.

## Develop / run

```bash
cd app
npm install           # installs electron + electron-builder (dev only)
npm start             # launches the Electron app (electron .)
```

Verify the device layer without a GUI (headless smoke check):

```bash
npm run smoke         # requires cli/addon.node and the Razer app quit
```

Expect `ok:true` for the Ornata Chroma and the Basilisk V3.

## Build a `.app`, `.dmg` and `.pkg`

```bash
cd app
npm run pack          # electron-builder --dir       -> app/dist/mac-arm64/Razer Ornata Lighting.app
# or the distributable installers:
npm run dist          # electron-builder --mac dmg pkg -> app/dist/*.dmg  +  app/dist/*.pkg
```

`npm run dist` produces two installers side by side (build byproducts —
the unpacked `mac-arm64/` app, blockmaps, debug logs — are removed
automatically afterwards by the `postdist` script, so `dist/` only holds
the two installers):

- **`Razer Ornata Lighting-<version>-arm64.dmg`** — drag-to-Applications disk image.
- **`Razer Ornata Lighting-<version>-arm64.pkg`** — installer package that puts the
  app straight into `/Applications`.

Both are **unsigned** (built with `identity: null`, no Apple Developer ID). They run
locally, but macOS Gatekeeper will warn on first launch — right-click the app →
*Open*, or run `xattr -dr com.apple.quarantine "/Applications/Razer Ornata Lighting.app"`.
For real distribution the app would need to be signed and notarized.

The build copies the reused engine and the addon into the packaged app via
electron-builder `extraResources`:

- `../cli/src`        → `<App>/Contents/Resources/cli/src`
- `../cli/scenes`     → `<App>/Contents/Resources/cli/scenes`
- `../cli/addon.node` → `<App>/Contents/Resources/cli/addon.node`

So **`cli/setup.sh` must have been run first** (so `cli/addon.node` exists) or the
packaged app will start without a working device layer. At runtime the app loads
the engine from `process.resourcesPath/cli/src/engine.js`, and the engine's own
relative path resolves the addon to `process.resourcesPath/cli/addon.node` — the
same logic that works in dev (`../../cli/addon.node`).

Build output (`dist/`) is gitignored and never committed. Ready-made DMG/PKG
builds are published on the repository's GitHub Releases page.

## Settings (menu-bar → Settings)

**Settings** is available in the menu-bar (tray) menu and in the app's menu bar
(persisted in `~/Library/Application Support/razer-ornata-macos-app/settings.json`):

- **Start at Login** — registers the app as a macOS login item.
- **Start Minimized (Menu Bar Only)** — launch with no window and no Dock icon;
  the app lives in the menu bar. Combine with *Start at Login* so your lighting
  is active right after boot.
- **Apply Default Profile on Launch** (default: on) — re-applies
  `scenes/default.json` on every launch, so the keyboard lights up without a
  click (the keyboard forgets its per-key colors when it loses power). If the
  keyboard isn't ready yet at login, the app retries in the background.
- **Re-apply Profile After Wake / Unlock** (default: on) — re-sends the current
  profile a few seconds after the Mac wakes from sleep or the screen is
  unlocked. Per-key colors only live in the keyboard's volatile memory; across
  sleep — especially behind a monitor/KVM USB hub — single LEDs can come back
  without their color. This puts them back without a click.
- **Startup Color (Stored on Keyboard)** — stores one color in the keyboard's
  on-board memory; the board shows it at power-on, before macOS and this app
  run. Choose the main color of the current profile, a preset, or *Off*. The
  current per-key profile is restored right after, so nothing visibly changes.
  Per-key colors can't be stored on the Ornata Chroma — that's a hardware
  limit; on Windows, Synapse re-sends them in software just like this app.
  This writes the keyboard's flash memory, so it only happens when you pick a
  color.
- **Choose Backup Folder…** — pick a folder that receives a copy of every color
  profile. Setting it seeds the folder with the current profiles; afterwards
  every profile saved in the app is mirrored there automatically.
  **Back Up Profiles Now** copies all bundled profiles again on demand, and
  **Show Backup Folder** opens it in Finder.

## App icon

The icon (which doubles as the logo — no wordmark) is a 3x3 grid of keycaps on
an anthracite squircle with five keys lit in per-key RGB colors (green, blue,
red, orange and purple) — exactly what the app does. It is generated procedurally (no external
assets, pure Pillow) by [`assets/make_icon.py`](assets/make_icon.py):

```bash
python3 assets/make_icon.py         # writes the 1024px icon + tray templates
# then rebuild the iconset -> assets/icon.icns with sips + iconutil
```

`assets/icon.icns` is used by electron-builder (`mac.icon`); the menu-bar tray uses
a monochrome keycap-grid template baked into `src/main.js`.

## License

**GNU General Public License v2.0 or later** — this app links against the GPL
razer-macos / librazermacos / OpenRazer code via `addon.node`. See the repository
[LICENSE](../LICENSE).

Not affiliated with or endorsed by Razer Inc. "Razer", "Ornata", "Basilisk" and
"Chroma" are trademarks of Razer Inc.
