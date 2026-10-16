# Ultra Tetris 3D

Jetpack through a neon arena, tag house-sized tetrominoes with plasma beacons and slam them into place.

Play it at https://aaronschooley85.github.io/UltraTetris/

## How to play

1. **Tag**: look up and left-click the falling piece. An amber beacon sticks to that cube.
2. **Anchor**: left-click a floor cell or the top of a block. The plasma tether drags the piece until the tagged cube sits above it.
3. **Rotate**: `R` / right-click / mouse wheel yaws, `Q` pitches, `E` rolls.
4. **Slam**: `F` drives it down. Fill a complete row along X or Z to clear it.

Clear lines to level up and warp through seven sector themes. Big clears, back-to-backs, combos and cascade chains multiply your score.

### Modes

| Mode | What it is |
| --- | --- |
| Marathon | Endless climb, speed rises every 6 lines |
| Sector 04 | Starts at level 4 on the original reference formation |
| Blitz | Three minutes, power-ups rain down |
| Zen | No speed-up and no game over |

### Power-ups

Fly into floating orbs, clear glowing power cores inside pieces or land big clears to earn them, then use them with `1` `2` `3`.

| Power-up | Effect |
| --- | --- |
| Chrono Field | Slows the falling piece to a crawl |
| Nova Bomb | Next shot detonates a 3×3×3 blast |
| Laser Lance | Next shot vaporizes a whole row |
| Nano Cube | Shrinks the falling piece to one cube |
| Overdrive | 2× score, infinite fuel, turbo flight |
| Seismic Quake | Collapses every gap in the stack |
| Oracle AI | Auto-pilots the piece to the best spot |

### Controls

| Key | Action |
| --- | --- |
| Mouse | Look |
| `W A S D` | Move |
| `Space` (hold) | Jetpack |
| `Shift` | Dash |
| Left click | Fire beacon / armed weapon |
| `R` · right click · wheel | Yaw the piece |
| `Q` / `E` | Pitch / roll the piece |
| `F` | Slam |
| `C` | Hold / swap piece |
| `X` | Release beacons |
| `1` `2` `3` | Use power-up |
| `V` | First / third person |
| `M` | Mute |
| `Esc` · `P` | Pause |

## Development

No build step. Everything is plain ES modules loaded by `index.html`, with three.js r160 from jsDelivr. Serve the folder with any static server, for example `npx serve .`, and open it in a browser. Add `?debug=1` to expose a test API on `window.__ULTRA__`.

```
src/
  main.js          boot, input, pointer lock, screen flow, main loop
  config.js        pieces, themes, power-ups, modes, scoring
  game/            board, falling piece, beacons + tether, power-ups, player, game flow
  gfx/             renderer + post-processing, block materials, sky, arena, particles, beams
  audio/           procedural sound effects and the synthwave soundtrack
  ui/              HUD and menus
```
