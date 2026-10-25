# ornata-macos

Lighting control for the **Razer Ornata Chroma** keyboard (and a connected Razer
mouse such as the **Basilisk V3**) on macOS — including Apple Silicon and macOS 26
(Tahoe), where it was developed and tested.

Razer **Synapse 4 for Mac doesn't support the Ornata Chroma**, and the community
app [razer-macos](https://github.com/stickoking/razer-macos) only offers
whole-keyboard effects. This project fills the gap with real **per-key** control.

This repository contains **two independent systems** that share the same idea but
are kept separate:

| Folder | What it is | For whom |
|--------|------------|----------|
| [`cli/`](cli/) | **Command-line tool + local web GUI.** Zero-install beyond Node; script it, or open a browser-based visual keyboard. The reference implementation of all the lighting logic. | Terminal users, tinkerers, automation |
| [`app/`](app/) | **Standalone desktop app** (Electron) — a proper double-clickable `.app` with a window and menu-bar presence. Reuses the `cli/` engine and the same native device addon. | Anyone who just wants an app |

Both talk to the keyboard through the native addon (`addon.node`) borrowed from
[razer-macos](https://github.com/stickoking/razer-macos) / librazermacos, which is
**not** committed here (it's GPL and device-specific) — each part extracts it from
your installed *Razer macOS.app*.

## Which one do I want?

- **Just want to control the lights with a UI you double-click?** → [`app/`](app/)
- **Want to script it, put it in a shortcut, or prefer the terminal / a quick web
  UI?** → [`cli/`](cli/)

See each folder's own README for setup and usage.

## Important (both)

The razer-macos menu-bar app opens the keyboard **exclusively**. Quit it before
using either part here, or the device can't be reached.

## License

**GNU General Public License v2.0 or later** — this project derives from and links
against the GPL razer-macos / librazermacos / OpenRazer code. See [LICENSE](LICENSE).

Not affiliated with or endorsed by Razer Inc. "Razer", "Ornata", "Basilisk" and
"Chroma" are trademarks of Razer Inc.
