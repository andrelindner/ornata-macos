# Scenes

A **scene** is a small JSON file describing a complete lighting layout. Apply one
with:

```bash
node src/ornata.js apply scenes/<name>.json
```

Each scene may contain:

| Field | Meaning |
|-------|---------|
| `brightness` | keyboard brightness `0..100` (optional) |
| `background` | hex color for every key you don't name (optional, default black) |
| `groups` | your own named key groups, e.g. `{ "movement": ["W","A","S","D"] }` (optional) |
| `keys` | the colors: each entry maps a key, comma-list, built-in group, or your own group to a hex color |

Targets and colors work exactly like the `ornata key` command — see the main
[README](../README.md#targeting-keys) for the full list of key names and built-in
groups (`WASD`, `ARROWS`, `LETTERS`, `FKEYS`, `NUMROW`, `NUMPAD`, `MODIFIERS`,
`NAV`, `ALL`).

## Bundled scenes

### `default.json` — the default profile

The layout applied by `setup.sh` on first install, and any time you run
`node src/ornata.js default`. Per-key colors are volatile: the keyboard keeps
them until you apply something else or it loses power.

| Keys | Color |
|------|--------|
| Main block: number row, letters, punctuation, Tab, Caps, Shift, Enter, Backspace, modifiers, Space | green `#0dbd00` |
| Function row (F1–F12) | orange `#ff7a00` |
| Esc, Print Screen, Scroll Lock, Pause and the Insert/Home/Page Up/Delete/End/Page Down cluster | purple `#a24bff` |
| Arrow keys | blue `#3a7afe` |
| Number pad and the M1/M2 keys | red `#ff0000` |

Brightness 100 % on a black background. Edit this file to change what "default"
means for you.

### `wasd.json`, `arrows.json`

Minimal examples: light just the movement keys on a dark background.

### `gaming.json`

Shows the richer features — custom `groups` (`movement`, `abilities`), a
comma-list target, a built-in group, and an explicit `brightness`.

## Making your own

Copy any file here, edit the colors, and apply it. There's nothing special
about these filenames — `apply` takes any path:

```bash
cp scenes/default.json scenes/mine.json
# edit scenes/mine.json
node src/ornata.js apply scenes/mine.json
```
