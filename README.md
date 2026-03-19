# Lion's Roar: Missile Defense

A browser-based missile defense game built with [Phaser 3](https://phaser.io/). Intercept incoming enemy missiles before they destroy your base — and unleash the Iron Beam when things get overwhelming.

---

## Gameplay

Enemy missiles rain down from the top of the screen in escalating waves. You control a turret and must destroy them before they reach your base. Survive as long as possible and maximize your score.

### Controls

| Input | Action |
|-------|--------|
| **Click** | Fire an interceptor toward the cursor |
| **Space** | Fire Iron Beam (when fully charged) |

### Mechanics

- **Interceptors** — Click anywhere on screen to launch an interceptor. It travels to the target point and explodes, destroying any missiles caught in the blast radius.
- **Iron Beam** — A superweapon that charges automatically over time. When the charge bar fills, press Space to fire a laser sweep that destroys every missile currently on screen. Use it wisely — it takes time to recharge.
- **Lives** — You have 3 lives. Each missile that reaches the base costs one life. The game ends when all lives are lost.

### Enemy Missile Types

| Type | Behaviour |
|------|-----------|
| **Basic** | Flies straight toward the base |
| **Fast** | Same as Basic but significantly faster |
| **Zigzag** | Oscillates side-to-side as it descends |
| **Splitter** | Splits into two child missiles at mid-screen |
| **Stealth** | Semi-transparent — harder to track visually |

Difficulty scales continuously: spawn rate increases and missiles speed up every 30 seconds.

---

## Getting Started

No build step required. The game runs entirely in the browser.

### Prerequisites

- A modern web browser (Chrome, Firefox, Edge, Safari)
- A local web server (required because assets are loaded via JavaScript — opening `index.html` directly as a `file://` URL may be blocked by browser security policies)

### Running Locally

**Option 1 — Python**
```bash
cd lions-roar-missile-defense
python3 -m http.server 8000
# Open http://localhost:8000
```

**Option 2 — Node.js**
```bash
npx serve .
```

**Option 3 — VS Code**
Install the [Live Server](https://marketplace.visualstudio.com/items?itemName=ritwickdey.LiveServer) extension and click **Go Live**.

---

## Project Structure

```
.
├── index.html          # Entry point — loads Phaser and game.js
├── game.js             # All game logic and embedded assets
├── lions_roar.png      # Title screen artwork
├── city_bg.png         # City skyline background
├── city.png            # City foreground graphic
├── interceptor_sprite/ # Source frames for the interceptor sprite
├── missile_sprite/     # Source frames for the basic/zigzag missile sprite
├── missile2_sprite/    # Source frames for the fast/splitter missile sprite
├── stealth_sprite/     # Source frames for the stealth missile sprite
└── turret_sprite/      # Source frames for the turret spritesheet
```

All sprite sheets are embedded directly in `game.js` as base64-encoded PNG data, so the game works without any additional asset requests after the initial page load.

---

## Scoring

| Event | Points |
|-------|--------|
| Interceptor kill | +10 per missile destroyed |
| Iron Beam kill | +10 per missile destroyed |

Your high score is saved automatically in `localStorage` and persists between sessions.

---

## Tech Stack

- **[Phaser 3.60](https://phaser.io/)** — game framework (loaded from CDN)
- **Vanilla JavaScript** — no bundler, no framework
- **HTML5 Canvas** — rendering via Phaser's WebGL/Canvas renderer

---

## License

Assets and code are for personal and educational use. Phaser 3 is licensed under the [MIT License](https://github.com/photonstorm/phaser/blob/master/license.txt).
