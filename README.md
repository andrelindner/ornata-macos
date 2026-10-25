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
- **Mouse tab** for the Basilisk V3: static **Color**, **Spectrum**, **Wave**,
  **Off**, **Brightness** (0–100) and **DPI** with presets. The tab only shows
  up while a supported mouse is connected; the app checks again when the window
  gets focus and every 15 seconds.
- **Settings window** (⌘, or the gear in the window) with the tabs *General*,
  *Backup* and *iCloud*, see [Settings](#settings).
- **Backup and restore** of profiles and settings to any folder, including a
  network share or iCloud Drive, see [Backup](#backup).
- The **version** is shown in the window header, the menu-bar menu, the About
  panel and the settings window.
- **Menu-bar (tray) icon** with these items:
  - the app name and version
  - Show/Hide Window
  - Apply Default Profile
  - Turn Keyboard Off
  - Settings…
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

Open **Settings…** from the menu-bar (tray) menu, the app menu (⌘,) or the gear
in the window header. The app saves them in
`~/Library/Application Support/Ornata Lighting/settings.json`.

**General**

- **Start at login** registers the app as a macOS login item. The line below
  the switch shows what macOS reports (registered, needs approval in System
  Settings → General → Login Items, or not found because the app was moved).
- **Open window at launch**. Off: the app starts in the menu bar only, with no
  window and no Dock icon. Combine it with *Start at login* so your lighting is
  active right after boot.
- **Apply default profile at launch** (on by default) re-applies the `default`
  profile on every launch. The keyboard forgets its per-key colors when it loses
  power. If the keyboard isn't ready yet at login, the app retries in the
  background.
- **Re-apply profile after wake and unlock** (on by default) re-sends the current
  profile a few seconds after the Mac wakes from sleep or the screen is unlocked.
  Single LEDs can come back without their color after sleep, especially behind a
  monitor or KVM USB hub.
- **Startup color** stores one color in the keyboard's on-board memory. The
  keyboard shows it at power-on, before macOS and this app run.
  - Choose the main color of the current profile, a preset, or *Off*, then press
    **Store on Keyboard**.
  - The current per-key profile is restored right after, so nothing visibly
    changes.
  - This writes the keyboard's flash memory, so it only happens when you press
    the button.
- **Profiles folder** with **Show in Finder**, and the app version.

**Backup**: see [Backup](#backup).

**iCloud**

- Shows whether the backup already goes to iCloud Drive. If not, **Back Up to
  iCloud Drive** sets the backup folder to `iCloud Drive/Ornata Lighting`.
- A roadmap for a later automatic sync: picking up newer backups from other Macs,
  and a native CloudKit sync, which needs an Apple Developer Program membership
  and a signed app.

## Backup

Settings → **Backup** works like a folder backup in other macOS apps:

- **Backup folder**: **Choose Folder…**, **Show in Finder** and **Remove**. Any
  folder works, also a network drive, an SMB share or iCloud Drive.
- **Back up automatically after changes** (on by default): every saved profile
  and every settings change is backed up a moment later.
- **Keep deleted profiles** (7, 30 or 90 days, or forever): a profile deleted
  locally is not dropped from the backup at once. It moves to `deleted/` and
  stays there for that time; if it shows up locally again, it comes back by
  itself.
- **Back Up Now** runs a backup and shows what it did.
- **Restore from Backup…** picks a backup folder and shows its contents first:
  when and on which Mac it was made, the profiles (new, kept, or replaced), the
  profiles in the grace period, and whether the settings come along. Existing
  profiles are only replaced if you switch on **Overwrite existing profiles**.

The backup is made of plain files, not an archive, so you can get at a profile
without the app:

```
<backup folder>/
  ornata-backup.json   manifest: date, Mac, app version, profile list, settings
  profiles/*.json      one file per profile
  deleted/*.json       profiles deleted locally, kept for the grace period
```

The settings in the backup are the switches of the settings window and the
retention time. The backup folder, the login item and the stored startup color
stay per Mac. Backups made by version 1.3 and earlier (a flat copy of the profile
files) can be restored as well.

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
- The only supported mouse is the **Basilisk V3** (PID `0x0099`). Other Razer
  mice are not offered in the mouse tab.
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
  src/main.js          main process: IPC, tray, menus, settings, profiles, backup
  src/preload.js       window.ornata.* bridge (contextIsolation on, no Node in the UI)
  src/renderer/        the main window: keyboard tab, mouse tab, profiles
  src/settings/        the settings window: General, Backup, iCloud
  src/smoke.js         headless device check
  engine/engine.js     device I/O through addon.node (plain Node, no Electron)
  engine/layout.js     key -> [row, col] map, groups, aliases, labels
  engine/scenes.js     reading, listing and writing scene/profile files
  engine/backup.js     backup to a folder, inspect and restore (plain Node)
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
