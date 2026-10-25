# Ornata Lighting (ornata-macos)

A macOS desktop app for per-key RGB lighting of the **Razer Ornata Chroma**
keyboard and a connected Razer mouse such as the **Basilisk V3**, including
Apple Silicon and macOS 26 (Tahoe), where it was developed and tested.

**Download:** ready-made DMG and PKG builds are on the
[Releases page](https://github.com/andrelindner/ornata-macos/releases/latest).

## Why this exists

Razer **Synapse 4 for Mac does not support the Ornata Chroma**. Synapse loads a
UI module for each device from Razer's servers, and Razer never published one for
the classic Ornata. The keyboard works as a plain keyboard, but you get no
lighting control.

The community app [**razer-macos**](https://github.com/stickoking/razer-macos)
*does* drive the Ornata, but it only offers whole-keyboard effects. The keyboard
itself accepts a full custom lighting frame over a **6×22 matrix**, and razer-macos
already sends such frames for its ripple effect. This app reuses that path, so you
can paint any key any color.

## What it can do

- **Visual keyboard** laid out from the real hardware matrix, with every key
  labeled.
  - Click a key to paint it; click and drag to paint many.
  - Right-click or Shift-click a key to clear it back to the background.
  - The board is a live preview.
- **Color picker** with hex field and swatches, plus one-click **group**
  painting: WASD, ARROWS, LETTERS, FKEYS, NUMROW, NUMPAD, MODIFIERS, NAV, ALL.
- A **background** color and a **brightness** slider (0–100).
- Buttons: **Apply to keyboard**, **Turn off**, **Load default profile**, **Reset**.
- **Profiles**
  - Save the current colors, background and brightness as a named profile, or
    anywhere through a native **Save** dialog.
  - Load a saved profile, or any local `.json` through a native **Open** dialog.
  - Profiles live in `~/Library/Application Support/Ornata Lighting/profiles/`,
    outside the app bundle, so updates keep them.
  - On first launch the folder is filled with the bundled scenes.
- **Mouse panel** for the Basilisk V3: static **Color**, **Spectrum**, **Wave**,
  **Off**, **Brightness** (0–100) and **DPI**, plus a status line.
- **Menu-bar (tray) icon** with these items:
  - Show/Hide Window
  - Apply Default Profile
  - Turn Keyboard Off
  - Settings
  - Quit

  Closing the window keeps the app running in the menu bar.
- **Keeps the lighting alive.** It re-applies the profile after wake or unlock,
  and it can store a power-on color in the keyboard (see [Settings](#settings)).
- A device **status indicator**. If the device is busy, it tells you to quit the
  Razer macOS app first.

## Install

1. Download the DMG or PKG from the
   [latest release](https://github.com/andrelindner/ornata-macos/releases/latest).
2. **DMG:** drag *Ornata Lighting* to Applications. **PKG:** it installs straight
   into `/Applications`.
3. The builds are unsigned (arm64 / Apple Silicon only). On first launch,
   right-click the app and choose *Open*. Alternatively, run:

   ```bash
   xattr -dr com.apple.quarantine "/Applications/Ornata Lighting.app"
   ```

> **Quit the razer-macos menu-bar app before you use this app.** It opens the
> keyboard **exclusively**, so this app can't reach the device while it runs.
> To quit it from a terminal:
>
> ```bash
> osascript -e 'quit app "Razer macOS"'
> ```

**Upgrading from 1.2.x** (when the app was called *Razer Ornata Lighting*):

1. Delete the old app.
2. Install the new one. Your settings are carried over on first launch.
3. Re-enable *Start at Login* if you used it.

## Settings

**Settings** is in the menu-bar (tray) menu and in the app's menu bar. The app
saves them in `~/Library/Application Support/Ornata Lighting/settings.json`.

- **Start at Login** registers the app as a macOS login item.
- **Start Minimized (Menu Bar Only)** launches the app with no window and no Dock
  icon; it lives in the menu bar. Combine it with *Start at Login* so your
  lighting is active right after boot.
- **Apply Default Profile on Launch** (on by default) re-applies the `default`
  profile on every launch. The keyboard forgets its per-key colors when it loses
  power. If the keyboard isn't ready yet at login, the app retries in the
  background.
- **Re-apply Profile After Wake / Unlock** (on by default) re-sends the current
  profile a few seconds after the Mac wakes from sleep or the screen is unlocked.
  - Single LEDs can come back without their color after sleep, especially
    behind a monitor or KVM USB hub.
  - This puts the colors back without a click.
- **Startup Color (Stored on Keyboard)** stores one color in the keyboard's
  on-board memory. The keyboard shows it at power-on, before macOS and this app
  run.
  - Choose the main color of the current profile, a preset, or *Off*.
  - The current per-key profile is restored right after, so nothing visibly
    changes.
  - This writes the keyboard's flash memory, so it only happens when you pick a
    color.
- **Choose Backup Folder…** picks a folder that receives a copy of every color
  profile.
  - Choosing the folder fills it with your current profiles.
  - After that, every profile you save in the app is copied there automatically.
  - **Back Up Profiles Now** copies all saved profiles again.
  - **Show Backup Folder** opens the folder in Finder.
- **Show Profiles Folder** opens the folder that holds your saved profiles.

## Profile format

A profile (scene) is a small JSON file:

```json
{
  "brightness": 100,
  "background": "#000000",
  "groups": { "movement": ["W", "A", "S", "D"] },
  "keys": { "movement": "#ff2020", "ARROWS": "#3a7afe", "F1,F2,F3": "#ff7a00" }
}
```

| Field | Meaning |
|-------|---------|
| `brightness` | keyboard brightness `0..100` (optional) |
| `background` | hex color for every key you don't name (optional, default black) |
| `groups` | your own named key groups (optional) |
| `keys` | maps a key name, a comma list, a built-in group or your own group to a hex color |

A key can be given in several forms:

- a name, such as `ESC`, `F1`, `W`, `SPACE`, `LEFT`, `KP5` or `NUMLOCK`
- a symbol alias, such as `;`, `/` or `1`
- a `"row,col"` matrix coordinate

Colors may be written as `ff0000`, `#ff0000` or `#f00`.

The bundled scenes are in [`app/scenes/`](app/scenes):

- `default.json` is the default profile.
- `wasd.json`, `arrows.json` and `gaming.json` are examples.

The **default profile** uses these colors:

| Keys | Color |
|------|-------|
| Main block: number row, letters, punctuation, Tab, Caps, Shift, Enter, Backspace, modifiers, Space | green `#0dbd00` |
| Function row (F1–F12) | orange `#ff7a00` |
| Esc, Print Screen, Scroll Lock, Pause and the Insert/Home/Page Up/Delete/End/Page Down cluster | purple `#a24bff` |
| Arrow keys | blue `#3a7afe` |
| Number pad and the M1/M2 keys | red `#ff0000` |

## Notes and limitations

- **Per-key colors are volatile.** The driver sends the custom frame without the
  "store" flag, and the Ornata Chroma has no on-board per-key profile memory. On
  Windows, Synapse also re-sends the colors in software. This is why the app
  re-applies them on launch, after wake and after unlock.
- Only a single **startup color** can be stored on the keyboard.
- The **mouse** is lit as one zone, the driver's whole-mouse mode, the same as in
  razer-macos. The driver doesn't expose individual underglow LEDs.
- The hardware **wave** effect has no speed setting, only a direction.
- Other Ornata models (Ornata `0x021F`, Ornata Chroma V2 `0x025D`) are recognized
  but not verified on real hardware. See issue #10.

## Build from source

Requirements:

- macOS on Apple Silicon.
- [Node.js](https://nodejs.org/) 18+ and npm.
- [razer-macos](https://github.com/stickoking/razer-macos/releases) installed as
  `/Applications/Razer macOS.app`.

The app needs that app's native addon `addon.node`. The addon is GPL and
device-specific, so it is **not** committed to this repository. `setup.sh`
extracts it from your installed copy.

```bash
git clone https://github.com/andrelindner/ornata-macos.git
cd ornata-macos/app
./setup.sh            # extracts addon.node from /Applications/Razer macOS.app
npm install           # electron + electron-builder (dev only)
npm start             # run the app in development
npm run smoke         # headless check: both devices reachable (quit Razer macOS first)
npm run dist          # build dist/Ornata Lighting-<version>-arm64.dmg and .pkg
```

A development run uses its own name (*Ornata Lighting Dev*) and its own settings
folder. It never touches the installed app's login item.

After `npm run dist`, the `postdist` script removes the build byproducts, so
`dist/` holds only the two installers.

### Layout

```
app/
  src/main.js          main process: IPC, tray, menus, settings, profiles
  src/preload.js       window.ornata.* bridge (contextIsolation on, no Node in the UI)
  src/renderer/        the window: visual keyboard, profiles, mouse panel
  src/smoke.js         headless device check
  engine/engine.js     device I/O through addon.node (plain Node, no Electron)
  engine/layout.js     key -> [row, col] map, groups, aliases, labels
  engine/scenes.js     reading, listing and writing scene/profile files
  scenes/              bundled scenes (default profile + examples)
  assets/              app icon (generated by make_icon.py)
  setup.sh             extracts addon.node from the installed Razer macOS app
```

The native module can't be loaded from inside `app.asar`. For that reason
`engine/`, `scenes/` and `addon.node` are copied next to it with electron-builder
`extraResources` (`Contents/Resources/{engine,scenes,addon.node}`).

### How it works

```
getAllDevices()                              find the Ornata (PID 542 / 0x021E)
kbdSetCustomFrame(id, [row,0,21, r,g,b …])   write one matrix row (×6)
kbdSetModeCustom(id)                         display the custom frame
```

The row payload is `ROW_ID, START_COL, STOP_COL, N×RGB`, which is the OpenRazer
`matrix_custom_frame` protocol. The key-to-coordinate table in `engine/layout.js`
is taken from razer-macos's own ripple mapping, so it matches the hardware.

### App icon

The icon is a 3×3 grid of keycaps with five lit keys. It is generated by
[`app/assets/make_icon.py`](app/assets/make_icon.py), which needs Pillow:

```bash
python3 app/assets/make_icon.py out   # writes the 1024px icon + menu-bar templates to out/
```

## Credits and license

Built on:

- [OpenRazer](https://github.com/openrazer/openrazer): the reverse-engineered protocol
- [librazermacos](https://github.com/stickoking/librazermacos): the macOS port
- [razer-macos](https://github.com/stickoking/razer-macos): the app whose native
  addon and key mapping this project reuses

Because this project derives from and links against that GPL code, it is licensed
under the **GNU General Public License v2.0 or later**. See [LICENSE](LICENSE).

Not affiliated with or endorsed by Razer Inc. "Razer", "Ornata", "Basilisk" and
"Chroma" are trademarks of Razer Inc.
