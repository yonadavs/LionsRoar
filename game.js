// ─── Constants ───────────────────────────────────────────────────────────────
const GAME_WIDTH = 800;
const GAME_HEIGHT = 600;
const STATION_X = Math.round(GAME_WIDTH / 3);
const STATION_Y = GAME_HEIGHT - 40;
const INTERCEPTOR_SPEED = 350;
const EXPLOSION_MAX_RADIUS = 60;
const EXPLOSION_DURATION = 1000;
const HP_MAX = 100;
const HP_DAMAGE        = { easy: 5, normal: 10, hard: 15 };
const HP_DAMAGE_DEBRIS = { easy: 1, normal:  2, hard:  3 };
const SCORE_PER_KILL   = { easy: 5, normal: 10, hard: 15 };
const HI_SCORE_KEY = 'missileDefenseHi';

const MISSILE_BASE_SPEED = { basic: 90, fast: 160, zigzag: 80, splitter: 85, stealth: 95, splitter_child: 90 };
const MISSILE_WEIGHTS    = { basic: 3,  fast: 2,   zigzag: 1,  splitter: 1,  stealth: 1  };
const MISSILE_COLORS     = { basic: 0xff4444, fast: 0xff8800, zigzag: 0x44ffff, splitter: 0xff44ff, stealth: 0x888888, splitter_child: 0xff44ff };

const DIFFICULTY_STAGES = [
  { time: 0,   spawnInterval: 3.0, types: ['basic'],                                              speedMult: 1.0 },
  { time: 30,  spawnInterval: 2.5, types: ['basic', 'fast'],                                      speedMult: 1.1 },
  { time: 60,  spawnInterval: 2.0, types: ['basic', 'fast', 'zigzag'],                            speedMult: 1.2 },
  { time: 90,  spawnInterval: 1.5, types: ['basic', 'fast', 'zigzag', 'splitter'],                speedMult: 1.3 },
  { time: 120, spawnInterval: 1.2, types: ['basic', 'fast', 'zigzag', 'splitter', 'stealth'],     speedMult: 1.5 },
  { time: 180, spawnInterval: 0.8, types: ['basic', 'fast', 'zigzag', 'splitter', 'stealth'],     speedMult: 1.8 },
];

const DIFFICULTY_SPEED = { easy: 0.75, normal: 1.0, hard: 1.35 };

const HP_PERK_AMOUNT        = { easy: 25, normal: 20, hard: 15 };
const POWERUP_SPAWN_INTERVAL = { easy: 20, normal: 30, hard: 45 }; // seconds

// ─── Settings (persisted via localStorage) ───────────────────────────────────
function getSettings() {
  return {
    musicVol:   parseFloat(localStorage.getItem('lr_musicVol')   ?? '0.7'),
    sfxVol:     parseFloat(localStorage.getItem('lr_sfxVol')     ?? '1.0'),
    difficulty: localStorage.getItem('lr_difficulty') ?? 'normal',
  };
}
function saveSettings(s) {
  localStorage.setItem('lr_musicVol',   String(s.musicVol));
  localStorage.setItem('lr_sfxVol',     String(s.sfxVol));
  localStorage.setItem('lr_difficulty', s.difficulty);
}
function applyVolumes(soundMgr) {
  const { musicVol } = getSettings();
  const menu = soundMgr.get('menuMusic');
  const game = soundMgr.get('gameMusic');
  if (menu) menu.setVolume(musicVol);
  if (game) game.setVolume(musicVol);
}

const TURRET_SCALE = 0.17;  // 361×414 cells → ~61×70 px on screen
// Logical left-to-right frame sequence → spritesheet frame index
const TURRET_FRAME_MAP = [5, 4, 3, 2, 1, 0, 11, 10, 9, 8, 7, 6];

// Map atan2 angle (station→cursor) to a spritesheet frame index.
// angle range [-PI, 0] covers left-horizontal through up to right-horizontal.
function angleToTurretFrame(angle) {
  const clamped = Math.max(-Math.PI + 0.001, Math.min(-0.001, angle));
  const t = (clamped + Math.PI) / Math.PI;           // 0=far-left, 1=far-right
  const logical = Math.min(11, Math.floor(t * 12));  // 0–11
  return TURRET_FRAME_MAP[logical];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function weightedRandom(types) {
  const total = types.reduce((s, t) => s + MISSILE_WEIGHTS[t], 0);
  let r = Math.random() * total;
  for (const t of types) {
    r -= MISSILE_WEIGHTS[t];
    if (r <= 0) return t;
  }
  return types[types.length - 1];
}

function distSq(ax, ay, bx, by) {
  const dx = ax - bx, dy = ay - by;
  return dx * dx + dy * dy;
}

function pruneArray(arr) {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (!arr[i].alive) arr.splice(i, 1);
  }
}

// ─── EnemyMissile ────────────────────────────────────────────────────────────
class EnemyMissile {
  constructor(scene, x, y, targetX, targetY, type, speedMult) {
    this.scene = scene;
    this.x = x;
    this.y = y;
    this.type = type;
    this.alive = true;
    this.splitDone = false;
    this.splitChildren = [];
    this.trail = [];
    this.phase = Math.random() * Math.PI * 2;

    const baseSpeed = MISSILE_BASE_SPEED[type] * speedMult;
    const dx = targetX - x;
    const dy = targetY - y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    this.vx = (dx / dist) * baseSpeed;
    this.vy = (dy / dist) * baseSpeed;

    this.baseVx = this.vx;  // used by zigzag to oscillate around travel direction

    const SPRITE_TYPES = { basic: 'missile', fast: 'missile2', zigzag: 'missile',
                            splitter: 'missile2', splitter_child: 'missile2', stealth: 'stealth' };
    const SPRITE_SCALES = { zigzag: 0.142, splitter: 0.142, splitter_child: 0.075,
                             basic: 0.142, fast: 0.142, stealth: 0.055 };
    if (SPRITE_TYPES[type]) {
      // Sprite-based: 2-frame animation, rotated to face travel direction
      this.frameTimer = 0;
      this.frameIndex = 0;
      this.sprite = scene.add.sprite(x, y, SPRITE_TYPES[type], 0)
        .setOrigin(0.5, 0.5)
        .setScale(SPRITE_SCALES[type] || 0.142)
        .setRotation(Math.atan2(dy, dx) + Math.PI / 2);
      if (type === 'zigzag') {
        this.sprite.setTint(0x88bbff);
        this.glowGraphics = scene.add.graphics();
      } else if (type === 'splitter' || type === 'splitter_child') {
        this.sprite.setTint(0xff88cc);   // pinkish tint
        this.glowGraphics = scene.add.graphics();
      } else if (type === 'stealth') {
        this.sprite.setAlpha(0.35);      // semi-transparent
        this.glowGraphics = null;
      } else {
        this.glowGraphics = null;
      }
      this.graphics = null;
    } else {
      this.sprite = null;
      this.glowGraphics = null;
      this.graphics = scene.add.graphics();
    }
  }

  update(delta) {
    if (!this.alive) return;
    const dt = delta / 1000;

    if (this.type === 'zigzag') {
      this.phase += dt * 2.5;
      this.vx = this.baseVx + Math.sin(this.phase) * 80;  // oscillate around initial heading
    }

    this.x += this.vx * dt;
    this.y += this.vy * dt;

    // Splitter splits at mid-screen
    if (this.type === 'splitter' && !this.splitDone && this.y > GAME_HEIGHT / 2) {
      this.splitDone = true;
      this.alive = false;
      const speedMult = this.scene.getCurrentStage().speedMult * DIFFICULTY_SPEED[getSettings().difficulty];
      for (const angle of [-0.4, 0.4]) {
        const speed = MISSILE_BASE_SPEED.basic * speedMult;
        const child = new EnemyMissile(this.scene, this.x, this.y, STATION_X, STATION_Y, 'splitter_child', speedMult);
        const cos = Math.cos(angle), sin = Math.sin(angle);
        const nvx = (child.vx * cos - child.vy * sin);
        const nvy = (child.vx * sin + child.vy * cos);
        child.vx = (nvx / Math.sqrt(nvx * nvx + nvy * nvy)) * speed;
        child.vy = (nvy / Math.sqrt(nvx * nvx + nvy * nvy)) * speed;
        this.splitChildren.push(child);
      }
      this._cleanupVisuals();
      return;
    }

    this.trail.push({ x: this.x, y: this.y });
    if (this.trail.length > 10) this.trail.shift();

    const isSpriteType = ['basic','fast','zigzag','splitter','splitter_child','stealth'].includes(this.type);
    if (isSpriteType) {
      // Animate 2 frames at ~6 fps
      this.frameTimer += delta;
      if (this.frameTimer >= 160) {
        this.frameTimer = 0;
        this.frameIndex = (this.frameIndex + 1) % 2;
        this.sprite.setFrame(this.frameIndex);
      }
      this.sprite.setPosition(this.x, this.y);
      if (this.type === 'zigzag') {
        this.sprite.setRotation(Math.atan2(this.vy, this.vx) + Math.PI / 2);
        const g = this.glowGraphics;
        g.clear();
        g.fillStyle(0x4488ff, 0.18);
        g.fillCircle(this.x, this.y, 18);
        g.fillStyle(0x2255ff, 0.10);
        g.fillCircle(this.x, this.y, 28);
      } else if (this.type === 'splitter' || this.type === 'splitter_child') {
        const r = this.type === 'splitter' ? 20 : 12;
        const g = this.glowGraphics;
        g.clear();
        g.fillStyle(0xff44aa, 0.18);
        g.fillCircle(this.x, this.y, r);
        g.fillStyle(0xff2288, 0.10);
        g.fillCircle(this.x, this.y, r * 1.5);
      }
    } else {
      this._drawGraphics();
    }
  }

  _drawGraphics() {
    const g = this.graphics;
    g.clear();
    const color = MISSILE_COLORS[this.type];
    const alpha = this.type === 'stealth' ? 0.35 : 1.0;
    for (let i = 0; i < this.trail.length; i++) {
      const t = i / this.trail.length;
      g.fillStyle(color, t * 0.5 * alpha);
      g.fillCircle(this.trail[i].x, this.trail[i].y, 2);
    }
    g.fillStyle(color, alpha);
    g.fillCircle(this.x, this.y, 5);
    g.fillStyle(0xffffff, alpha * 0.8);
    g.fillCircle(this.x, this.y, 2);
  }

  _cleanupVisuals() {
    if (this.sprite)        { this.sprite.destroy();        this.sprite = null; }
    if (this.glowGraphics)  { this.glowGraphics.destroy();  this.glowGraphics = null; }
    if (this.graphics)      { this.graphics.destroy();      this.graphics = null; }
  }

  destroy() {
    this.alive = false;
    this._cleanupVisuals();
  }
}
// ─── Interceptor ─────────────────────────────────────────────────────────────
class Interceptor {
  constructor(scene, targetX, targetY) {
    this.scene = scene;
    this.x = STATION_X;
    this.y = STATION_Y - 15;
    this.targetX = targetX;
    this.targetY = targetY;
    this.alive = true;
    this.frameTimer = 0;
    this.frameIndex = 0;
    this.trail = [];
    this.trailGraphics = scene.add.graphics();

    const dx = targetX - this.x;
    const dy = targetY - this.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    this.vx = (dx / dist) * INTERCEPTOR_SPEED;
    this.vy = (dy / dist) * INTERCEPTOR_SPEED;
    this.distLeft = dist;

    // Sprite: origin center, rotated to face travel direction
    // Sprite default orientation points right (0 rad); travel angle adjusts it
    this.angle = Math.atan2(dy, dx);
    this.sprite = scene.add.sprite(this.x, this.y, 'interceptor', 0)
      .setOrigin(0.5, 0.5)
      .setScale(0.076)
      .setRotation(this.angle + Math.PI / 2);  // sprite points up → add 90°
  }

  update(delta) {
    if (!this.alive) return;
    const dt = delta / 1000;
    const step = INTERCEPTOR_SPEED * dt;

    // Animate through 4 frames (~8 fps)
    this.frameTimer += delta;
    if (this.frameTimer >= 125) {
      this.frameTimer = 0;
      this.frameIndex = (this.frameIndex + 1) % 4;
      this.sprite.setFrame(this.frameIndex);
    }

    // Trail
    this.trail.push({ x: this.x, y: this.y });
    if (this.trail.length > 8) this.trail.shift();

    if (step >= this.distLeft) {
      this.x = this.targetX;
      this.y = this.targetY;
      this.scene.explosions.push(new Explosion(this.scene, this.targetX, this.targetY));
      this.scene.sound.play('pop', { volume: getSettings().sfxVol });
      const debrisCount = 3 + Math.floor(Math.random() * 4);
      for (let i = 0; i < debrisCount; i++) {
        this.scene.debris.push(new DebrisParticle(this.scene, this.targetX, this.targetY));
      }
      this.alive = false;
      this.sprite.destroy();
      this.trailGraphics.destroy();
      return;
    }

    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.distLeft -= step;

    this.sprite.setPosition(this.x, this.y);
    this.drawTrail();
  }

  drawTrail() {
    const g = this.trailGraphics;
    g.clear();
    for (let i = 0; i < this.trail.length; i++) {
      const t = i / this.trail.length;
      g.fillStyle(0x00ff88, t * 0.5);
      g.fillCircle(this.trail[i].x, this.trail[i].y, 1.5);
    }
  }

  destroy() {
    this.alive = false;
    this.sprite.destroy();
    this.trailGraphics.destroy();
  }
}

// ─── Explosion ───────────────────────────────────────────────────────────────
class Explosion {
  constructor(scene, x, y) {
    this.scene = scene;
    this.x = x;
    this.y = y;
    this.age = 0;
    const powerMult = scene.missilePowerActive ? 1.2 : 1;
    this.maxAge    = EXPLOSION_DURATION    * powerMult;
    this.maxRadius = EXPLOSION_MAX_RADIUS  * powerMult;
    this.radius = 0;
    this.alive = true;
    this.graphics = scene.add.graphics();
  }

  update(delta) {
    if (!this.alive) return;
    this.age += delta;
    if (this.age >= this.maxAge) {
      this.alive = false;
      this.graphics.destroy();
      return;
    }

    const t = this.age / this.maxAge;
    this.radius = this.maxRadius * Math.sin(t * Math.PI);

    this.draw(t);
  }

  draw(t) {
    const g = this.graphics;
    g.clear();

    const alpha = Math.sin(t * Math.PI);

    // Inner fill
    g.fillStyle(0xffaa00, alpha * 0.4);
    g.fillCircle(this.x, this.y, this.radius * 0.6);

    // Outer ring
    g.lineStyle(2, 0xff6600, alpha);
    g.strokeCircle(this.x, this.y, this.radius);

    // Shockwave ring at t > 0.4
    if (t > 0.4) {
      const shockT = (t - 0.4) / 0.6;
      g.lineStyle(1, 0xffffff, (1 - shockT) * 0.5);
      g.strokeCircle(this.x, this.y, this.radius * (1 + shockT * 0.5));
    }
  }

  destroy() {
    this.alive = false;
    this.graphics.destroy();
  }
}

// ─── DebrisParticle ──────────────────────────────────────────────────────────
const DEBRIS_COLORS = [0xff8800, 0xff4400, 0xffaa44, 0xffcc00];
const DEBRIS_TRAVEL_LIMIT = GAME_HEIGHT * 0.3;

class DebrisParticle {
  constructor(scene, x, y) {
    this.scene = scene;
    this.x = x;
    this.y = y;
    this.startY = y;
    this.alive = true;
    this.graphics = scene.add.graphics();
    this.trail = [];

    const angle = Math.random() * Math.PI * 2;
    const speed = 80 + Math.random() * 140;
    this.vx = Math.cos(angle) * speed;
    this.vy = Math.abs(Math.sin(angle)) * speed + 60; // bias downward
    this.gravity = 220; // px/s²
    this.size = 3 + Math.random() * 3;
    this.color = DEBRIS_COLORS[Math.floor(Math.random() * DEBRIS_COLORS.length)];
  }

  update(delta) {
    if (!this.alive) return;
    const dt = delta / 1000;

    this.trail.push({ x: this.x, y: this.y });
    if (this.trail.length > 4) this.trail.shift();

    this.vy += this.gravity * dt;
    this.x  += this.vx * dt;
    this.y  += this.vy * dt;

    const traveled = this.y - this.startY;
    const traveledFraction = traveled / DEBRIS_TRAVEL_LIMIT;

    if (traveled >= DEBRIS_TRAVEL_LIMIT) {
      this.alive = false;
      this.graphics.destroy();
      return;
    }

    if (this.y >= STATION_Y) {
      const damage = HP_DAMAGE_DEBRIS[getSettings().difficulty] * (1 - traveledFraction);
      this.scene.hp = Math.max(0, this.scene.hp - damage);
      if (this.scene.hp <= 0) this.scene.endGame();
      this.alive = false;
      this.graphics.destroy();
      return;
    }

    const alpha = 1 - traveledFraction;
    const g = this.graphics;
    g.clear();

    // Trail
    for (let i = 0; i < this.trail.length; i++) {
      const t = (i + 1) / (this.trail.length + 1);
      g.fillStyle(this.color, alpha * t * 0.5);
      g.fillCircle(this.trail[i].x, this.trail[i].y, this.size * t * 0.7);
    }

    // Core glow
    g.fillStyle(0xffffff, alpha * 0.6);
    g.fillCircle(this.x, this.y, this.size * 0.45);

    // Main body
    g.fillStyle(this.color, alpha);
    g.fillCircle(this.x, this.y, this.size);
  }

  destroy() {
    this.alive = false;
    this.graphics.destroy();
  }
}

// ─── PowerUp ─────────────────────────────────────────────────────────────────
class PowerUp {
  constructor(scene, type) {
    this.scene = scene;
    this.type  = type; // 'hp'
    this.alive = true;
    this.age   = 0;

    this.x = Phaser.Math.Between(60, GAME_WIDTH - 60);
    this.y = -56;

    // Gentle fall with slight pendulum sway
    this.fallSpeed = 45 + Math.random() * 20;
    this.swayAmp   = 18 + Math.random() * 12;
    this.swayFreq  = 0.8 + Math.random() * 0.4;
    this.originX   = this.x;

    const key = type === 'missile' ? 'power_perk' : 'hp_perk';
    this.sprite = scene.add.image(this.x, this.y, key)
      .setDisplaySize(56, 56)
      .setOrigin(0.5);
  }

  update(delta) {
    if (!this.alive) return;
    this.age += delta / 1000;

    this.y += this.fallSpeed * delta / 1000;
    this.x  = this.originX + Math.sin(this.age * this.swayFreq * Math.PI * 2) * this.swayAmp;

    this.sprite.setPosition(this.x, this.y);

    // Hit the ground — disappear silently
    if (this.y >= STATION_Y) this.destroy();
  }

  destroy() {
    this.alive = false;
    this.sprite.destroy();
  }
}

// ─── Flash ───────────────────────────────────────────────────────────────────
class Flash {
  constructor(scene, x, y) {
    this.scene = scene;
    this.x = x;
    this.y = y;
    this.age = 0;
    this.maxAge = 120;
    this.alive = true;
    this.graphics = scene.add.graphics();
  }

  update(delta) {
    if (!this.alive) return;
    this.age += delta;
    if (this.age >= this.maxAge) {
      this.alive = false;
      this.graphics.destroy();
      return;
    }

    const t = this.age / this.maxAge;
    const r = 15 * (1 - t);
    const alpha = 1 - t;

    const g = this.graphics;
    g.clear();
    g.fillStyle(0xffffff, alpha);
    g.fillCircle(this.x, this.y, r);
  }

  destroy() {
    this.alive = false;
    this.graphics.destroy();
  }
}

// ─── LaunchFlash ─────────────────────────────────────────────────────────────
class LaunchFlash {
  constructor(scene, x, y, angle) {
    this.scene = scene;
    this.x = x;
    this.y = y;
    this.angle = angle;
    this.age = 0;
    this.maxAge = 80;
    this.alive = true;
    this.graphics = scene.add.graphics();
  }

  update(delta) {
    if (!this.alive) return;
    this.age += delta;
    if (this.age >= this.maxAge) {
      this.alive = false;
      this.graphics.destroy();
      return;
    }

    const t = this.age / this.maxAge;
    const alpha = 1 - t;
    const len = 12 * (1 - t * 0.5);

    const g = this.graphics;
    g.clear();
    g.lineStyle(2, 0xffff88, alpha);

    for (let i = 0; i < 4; i++) {
      const a = this.angle + (i * Math.PI / 2);
      g.beginPath();
      g.moveTo(this.x, this.y);
      g.lineTo(this.x + Math.cos(a) * len, this.y + Math.sin(a) * len);
      g.strokePath();
    }
  }

  destroy() {
    this.alive = false;
    this.graphics.destroy();
  }
}

// ─── BootScene ───────────────────────────────────────────────────────────────
class BootScene extends Phaser.Scene {
  constructor() { super('Boot'); }

  preload() {
    this.load.spritesheet('turret',
      'resources/turret_sprite/spritesheet/spritesheet.png',
      { frameWidth: 361, frameHeight: 414 });
    this.load.spritesheet('interceptor',
      'resources/interceptor_sprite/spritesheet/spritesheet.png',
      { frameWidth: 624, frameHeight: 617 });
    this.load.spritesheet('missile',
      'resources/missile_sprite/sprite_sheet/spritesheet.png',
      { frameWidth: 320, frameHeight: 494 });
    this.load.spritesheet('missile2',
      'resources/missile2_sprite/sprite_sheet/spritesheet.png',
      { frameWidth: 320, frameHeight: 494 });
    this.load.spritesheet('stealth',
      'resources/stealth_sprite/sprite_sheet/spritesheet.png',
      { frameWidth: 320, frameHeight: 494 });
    this.load.image('ironbeam', 'resources/iron_beam (1).png');
    this.load.image('lionsroar', 'resources/lions_roar.png');
    this.load.image('citybg', 'resources/city_bg.png');
    this.load.atlas('male',           'resources/male/spritesheet/spritesheet.png',           'resources/male/spritesheet/spritesheet.json');
    this.load.atlas('female',         'resources/female/spritesheet/spritesheet.png',         'resources/female/spritesheet/spritesheet.json');
    this.load.atlas('frantic_female', 'resources/frantic_female/spritesheet/spritesheet.png', 'resources/frantic_female/spritesheet/spritesheet.json');
    this.load.atlas('frantic_male',   'resources/frantic_male/spritesheet/spritesheet.png',   'resources/frantic_male/spritesheet/spritesheet.json');
    this.load.image('alert',              'resources/alert.png');
    this.load.image('hp_perk',            'resources/hp_perk.png');
    this.load.image('power_perk',         'resources/power_perk.png');
    this.load.image('missile_power_icon', 'resources/missile_power_icon.png');
    this.load.audio('alert_2', 'resources/sounds/effects/alert_2.mp3');
    this.load.image('teheranbg',  'resources/Teheran_bg.png');
    this.load.image('f35',        'resources/F35.png');
    this.load.image('truck_loaded', 'resources/truck/truck_loaded.png');
    this.load.image('truck_empty',  'resources/truck/truck_empty.png');
    this.load.audio('bad', 'resources/sounds/effects/bad.mp3');
    this.load.audio('pop', 'resources/sounds/effects/pop.mp3');
    this.load.audio('laser',  'resources/sounds/effects/laser.mp3');
    this.load.audio('launch',     'resources/sounds/effects/launch.mp3');
    this.load.audio('health_up',  'resources/sounds/effects/health_up.mp3');
    this.load.audio('missile_up', 'resources/sounds/effects/missile_up.mp3');
    this.load.audio('menuMusic',   'resources/sounds/music/menu.mp3');
    this.load.audio('gameMusic',   'resources/sounds/music/game.mp3');
    this.load.audio('bonusMusic',  'resources/sounds/music/teheran.mp3');
  }

  create() {
    if (localStorage.getItem(HI_SCORE_KEY) === null) {
      localStorage.setItem(HI_SCORE_KEY, '0');
    }
    this.sound.add('menuMusic',  { loop: true });
    this.sound.add('gameMusic',  { loop: true });
    this.sound.add('bonusMusic', { loop: true });
    this.scene.start('Splash', { gameOver: false, score: 0 });
  }
}

// ─── SplashScene ─────────────────────────────────────────────────────────────
class SplashScene extends Phaser.Scene {
  constructor() { super('Splash'); }

  init(data) {
    this.isGameOver = data && data.gameOver;
    this.lastScore  = (data && data.score) ? data.score : 0;
  }

  create() {
    const hiScore = parseInt(localStorage.getItem(HI_SCORE_KEY) || '0');

    if (!this.sound.get('menuMusic').isPlaying) {
      this.sound.get('gameMusic').stop();
      this.sound.get('menuMusic').play();
    }
    applyVolumes(this.sound);

    // Dark background
    this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x000814);

    // Lion's Roar logo — centered, scaled to fill most of the screen height
    const logoScale = Math.min(GAME_WIDTH / 832, (GAME_HEIGHT * 0.88) / 1284);
    this.add.image(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 18, 'lionsroar')
      .setScale(logoScale)
      .setOrigin(0.5, 0.5);

    if (this.isGameOver) {
      // Semi-transparent overlay for game-over info
      const ov = this.add.graphics();
      ov.fillStyle(0x000000, 0.62);
      ov.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

      this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 60, 'GAME OVER', {
        fontSize: '56px', fontFamily: 'monospace', color: '#ff4444',
        stroke: '#000', strokeThickness: 5
      }).setOrigin(0.5);

      this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 10, `SCORE: ${this.lastScore}`, {
        fontSize: '30px', fontFamily: 'monospace', color: '#ffffff',
        stroke: '#000', strokeThickness: 3
      }).setOrigin(0.5);

      if (this.lastScore >= hiScore) {
        this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 48, 'NEW HIGH SCORE!', {
          fontSize: '20px', fontFamily: 'monospace', color: '#ffdd00',
          stroke: '#000', strokeThickness: 3
        }).setOrigin(0.5);
      }

      this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 100, `HI-SCORE: ${hiScore}`, {
        fontSize: '18px', fontFamily: 'monospace', color: '#aaaaaa'
      }).setOrigin(0.5);
    }

    // "CLICK TO START" blinking at bottom
    const clickText = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT - 28, 'CLICK TO START', {
      fontSize: '22px', fontFamily: 'monospace', color: '#00ff88',
      stroke: '#002211', strokeThickness: 3
    }).setOrigin(0.5);

    this.tweens.add({
      targets: clickText, alpha: 0,
      duration: 550, yoyo: true, repeat: -1
    });

    // Settings button — bottom-right corner
    const settingsBtn = this.add.text(GAME_WIDTH - 20, GAME_HEIGHT - 52, '⚙ SETTINGS', {
      fontSize: '14px', fontFamily: 'monospace', color: '#00aacc',
      stroke: '#001a2a', strokeThickness: 3
    }).setOrigin(1, 1).setInteractive({ useHandCursor: true });
    settingsBtn.on('pointerover', () => settingsBtn.setColor('#00eeff'));
    settingsBtn.on('pointerout',  () => settingsBtn.setColor('#00aacc'));
    settingsBtn.on('pointerdown', () => this.scene.start('Settings'));

    // Click anywhere else to start (but not on the settings button)
    this.input.on('pointerdown', (pointer, currentlyOver) => {
      if (currentlyOver.length === 0) this.scene.start('Instructions');
    });
  }
}

// ─── InstructionsScene ────────────────────────────────────────────────────────
class InstructionsScene extends Phaser.Scene {
  constructor() { super('Instructions'); }

  create() {
    // Background
    this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x000814);

    // Subtle grid lines
    const gridG = this.add.graphics();
    gridG.lineStyle(1, 0x112233, 0.4);
    for (let x = 0; x <= GAME_WIDTH; x += 40) { gridG.beginPath(); gridG.moveTo(x, 0); gridG.lineTo(x, GAME_HEIGHT); gridG.strokePath(); }
    for (let y = 0; y <= GAME_HEIGHT; y += 40) { gridG.beginPath(); gridG.moveTo(0, y); gridG.lineTo(GAME_WIDTH, y); gridG.strokePath(); }

    // Title bar
    const titleBg = this.add.graphics();
    titleBg.fillStyle(0x001a33, 1);
    titleBg.fillRect(0, 0, GAME_WIDTH, 54);
    titleBg.lineStyle(2, 0x0088ff, 0.8);
    titleBg.beginPath(); titleBg.moveTo(0, 54); titleBg.lineTo(GAME_WIDTH, 54); titleBg.strokePath();

    this.add.text(GAME_WIDTH / 2, 27, 'HOW TO PLAY', {
      fontSize: '26px', fontFamily: 'monospace', color: '#00ccff',
      stroke: '#000033', strokeThickness: 3
    }).setOrigin(0.5);

    // ── Left panel: Interceptors ─────────────────────────────────────────────
    const lx = GAME_WIDTH / 4;   // center of left panel
    const panelY = 74;
    const panelH = GAME_HEIGHT - 100;

    const lpBg = this.add.graphics();
    lpBg.fillStyle(0x001122, 0.85);
    lpBg.fillRoundedRect(10, panelY, GAME_WIDTH / 2 - 16, panelH, 8);
    lpBg.lineStyle(1, 0x0066aa, 0.7);
    lpBg.strokeRoundedRect(10, panelY, GAME_WIDTH / 2 - 16, panelH, 8);

    this.add.text(lx, panelY + 18, 'INTERCEPTORS', {
      fontSize: '15px', fontFamily: 'monospace', color: '#00eeff',
      stroke: '#000', strokeThickness: 2
    }).setOrigin(0.5);

    // Interceptor sprite (4-frame, show frame 0)
    this.add.sprite(lx, panelY + 100, 'interceptor', 0)
      .setDisplaySize(90, 90)
      .setOrigin(0.5);

    // Animated turret aiming
    const turretY = panelY + 210;
    const turretSprite = this.add.sprite(lx, turretY, 'turret', 0)
      .setScale(TURRET_SCALE * 1.4)
      .setOrigin(0.5, 1);

    // Animated click cursor dot
    const cursorDot = this.add.graphics();
    let animT = 0;
    const animPath = { x: lx + 60, y: panelY + 145 };

    // Draw static click hint
    const clickHint = this.add.graphics();
    clickHint.lineStyle(1, 0x00ff88, 0.5);
    clickHint.beginPath();
    clickHint.moveTo(lx, turretY - 10);
    clickHint.lineTo(animPath.x, animPath.y);
    clickHint.strokePath();
    clickHint.fillStyle(0x00ff88, 0.9);
    clickHint.fillCircle(animPath.x, animPath.y, 6);
    // cursor label
    this.add.text(animPath.x + 10, animPath.y - 6, 'CLICK', {
      fontSize: '10px', fontFamily: 'monospace', color: '#00ff88'
    });

    // Turret frame animation toward click point
    const angle = Math.atan2(animPath.y - turretY, animPath.x - lx);
    turretSprite.setFrame(angleToTurretFrame(angle - Math.PI / 2));

    const instrLines1 = [
      'Click anywhere on screen',
      'to fire an interceptor.',
      '',
      'Interceptors explode on',
      'contact, destroying all',
      'missiles in the blast radius.',
    ];
    instrLines1.forEach((line, i) => {
      this.add.text(lx, panelY + 250 + i * 19, line, {
        fontSize: '12px', fontFamily: 'monospace',
        color: line === '' ? '#ffffff' : '#aaccdd',
        align: 'center'
      }).setOrigin(0.5);
    });

    // ── Right panel: Iron Beam ───────────────────────────────────────────────
    const rx = GAME_WIDTH * 3 / 4;
    const rpBg = this.add.graphics();
    rpBg.fillStyle(0x001122, 0.85);
    rpBg.fillRoundedRect(GAME_WIDTH / 2 + 6, panelY, GAME_WIDTH / 2 - 16, panelH, 8);
    rpBg.lineStyle(1, 0x00aaff, 0.7);
    rpBg.strokeRoundedRect(GAME_WIDTH / 2 + 6, panelY, GAME_WIDTH / 2 - 16, panelH, 8);

    this.add.text(rx, panelY + 18, 'IRON BEAM', {
      fontSize: '15px', fontFamily: 'monospace', color: '#00eeff',
      stroke: '#000', strokeThickness: 2
    }).setOrigin(0.5);

    // Iron beam icon
    this.add.image(rx, panelY + 100, 'ironbeam')
      .setDisplaySize(100, 100)
      .setOrigin(0.5);

    // Charge bar mock-up
    const barX = rx - 70, barY = panelY + 160;
    const barW = 140, barH = 16;
    const barBg = this.add.graphics();
    barBg.fillStyle(0x001a2a, 1);
    barBg.fillRect(barX, barY, barW, barH);
    barBg.lineStyle(1, 0x004466, 1);
    barBg.strokeRect(barX, barY, barW, barH);

    this.add.text(rx, barY - 12, 'CHARGE', {
      fontSize: '10px', fontFamily: 'monospace', color: '#4499bb'
    }).setOrigin(0.5);

    // Animated fill bar
    const barFg = this.add.graphics();
    let barPct = 0;
    let barDir = 1;

    // SPACE key label box
    const spaceBox = this.add.graphics();
    spaceBox.fillStyle(0x003344, 1);
    spaceBox.fillRoundedRect(rx - 45, panelY + 184, 90, 22, 4);
    spaceBox.lineStyle(1, 0x00eeff, 0.8);
    spaceBox.strokeRoundedRect(rx - 45, panelY + 184, 90, 22, 4);
    this.add.text(rx, panelY + 195, '[ SPACE ] or click icon', {
      fontSize: '11px', fontFamily: 'monospace', color: '#00eeff'
    }).setOrigin(0.5);

    const instrLines2 = [
      'Iron Beam charges over time.',
      '',
      'When fully charged, press',
      'SPACE or click the icon to',
      'unleash a laser that destroys',
      'every missile on screen.',
    ];
    instrLines2.forEach((line, i) => {
      this.add.text(rx, panelY + 250 + i * 19, line, {
        fontSize: '12px', fontFamily: 'monospace',
        color: line === '' ? '#ffffff' : '#aaccdd',
        align: 'center'
      }).setOrigin(0.5);
    });

    // ── Bottom "CLICK TO BEGIN" ──────────────────────────────────────────────
    const bottomBg = this.add.graphics();
    bottomBg.fillStyle(0x001a33, 1);
    bottomBg.fillRect(0, GAME_HEIGHT - 44, GAME_WIDTH, 44);
    bottomBg.lineStyle(2, 0x0088ff, 0.8);
    bottomBg.beginPath(); bottomBg.moveTo(0, GAME_HEIGHT - 44); bottomBg.lineTo(GAME_WIDTH, GAME_HEIGHT - 44); bottomBg.strokePath();

    const startText = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT - 22, 'CLICK TO BEGIN', {
      fontSize: '20px', fontFamily: 'monospace', color: '#00ff88',
      stroke: '#002211', strokeThickness: 3
    }).setOrigin(0.5);

    this.tweens.add({
      targets: startText, alpha: 0,
      duration: 550, yoyo: true, repeat: -1
    });

    // Animate bar fill
    this.time.addEvent({
      delay: 16,
      loop: true,
      callback: () => {
        barPct += barDir * 0.008;
        if (barPct >= 1) { barPct = 1; barDir = -1; }
        if (barPct <= 0) { barPct = 0; barDir =  1; }
        const ready = barPct >= 0.99;
        barFg.clear();
        barFg.fillStyle(ready ? 0x00eeff : 0x0077aa, 1);
        barFg.fillRect(barX + 1, barY + 1, Math.floor((barW - 2) * barPct), barH - 2);
      }
    });

    // Settings button — bottom-right, above the bottom bar
    const settingsBtn = this.add.text(GAME_WIDTH - 20, GAME_HEIGHT - 52, '⚙ SETTINGS', {
      fontSize: '14px', fontFamily: 'monospace', color: '#00aacc',
      stroke: '#001a2a', strokeThickness: 3
    }).setOrigin(1, 1).setInteractive({ useHandCursor: true });
    settingsBtn.on('pointerover', () => settingsBtn.setColor('#00eeff'));
    settingsBtn.on('pointerout',  () => settingsBtn.setColor('#00aacc'));
    settingsBtn.on('pointerdown', () => this.scene.start('Settings'));

    this.input.on('pointerdown', (pointer, currentlyOver) => {
      if (currentlyOver.length === 0) this.scene.start('Intro');
    });
  }
}

// ─── Shared Draw Functions ────────────────────────────────────────────────────
function drawStars(g, count) {
  const rng = new Phaser.Math.RandomDataGenerator(['missile-defense-stars']);
  g.fillStyle(0x000011, 1);
  g.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

  for (let i = 0; i < count; i++) {
    const x = rng.between(0, GAME_WIDTH);
    const y = rng.between(0, GAME_HEIGHT - 30);
    const r = rng.frac() < 0.2 ? 1.5 : 0.8;
    const brightness = rng.between(150, 255);
    const hex = (brightness << 16) | (brightness << 8) | brightness;
    g.fillStyle(hex, rng.frac() * 0.5 + 0.5);
    g.fillCircle(x, y, r);
  }
}

function drawStation(g, x, y, barrelAngle) {
  // Base trapezoid
  g.fillStyle(0x445533, 1);
  g.fillTriangle(x - 25, y, x + 25, y, x, y - 15);

  // Wider base
  g.fillStyle(0x556644, 1);
  g.fillRect(x - 28, y - 5, 56, 10);

  // Dome
  g.fillStyle(0x66aa44, 1);
  g.fillCircle(x, y - 10, 12);

  // Dome highlight
  g.fillStyle(0x88cc66, 0.6);
  g.fillCircle(x - 3, y - 13, 5);

  // Barrel
  const bx = Math.cos(barrelAngle) * 20;
  const by = Math.sin(barrelAngle) * 20;
  g.lineStyle(4, 0x88cc44, 1);
  g.beginPath();
  g.moveTo(x, y - 10);
  g.lineTo(x + bx, y - 10 + by);
  g.strokePath();

  // Barrel tip
  g.fillStyle(0xaaddaa, 1);
  g.fillCircle(x + bx, y - 10 + by, 3);
}

// ─── GameScene ───────────────────────────────────────────────────────────────
class GameScene extends Phaser.Scene {
  constructor() { super('Game'); }

  create() {
    this.sound.stopByKey('alert_2');
    this.sound.get('menuMusic').stop();
    this.sound.get('gameMusic').play();
    applyVolumes(this.sound);

    this.gameTime = 0;
    this.spawnTimer = 0;
    this.score = 0;
    this.hp = HP_MAX;
    this.isOver = false;

    this.enemyMissiles = [];
    this.interceptors = [];
    this.explosions = [];
    this.flashes = [];
    this.launchFlashes = [];
    this.debris = [];

    this.combo = 0;
    this.comboTimer = 0;

    this.powerUps = [];
    this.powerUpTimer = POWERUP_SPAWN_INTERVAL[getSettings().difficulty];

    this.missilePowerActive = false;
    this.missilePowerTimer  = 0; // ms remaining

    this.lastBonusWave = 0;
    this.bonusActive = false;
    this.events.on('resume', (sys, data) => {
      this.bonusActive = false;
      if (data && data.bonusScore) this.score += data.bonusScore;
    });

    // Background: city image stretched to fill game area
    this.add.image(GAME_WIDTH / 2, GAME_HEIGHT / 2, 'citybg')
      .setDisplaySize(GAME_WIDTH, GAME_HEIGHT);

    this.groundGraphics = this.add.graphics();
    this.drawGround();

    // Turret sprite — frame driven by cursor angle each update
    this.turretSprite = this.add.sprite(STATION_X, GAME_HEIGHT - 30, 'turret', 0)
      .setOrigin(0.5, 1)
      .setScale(TURRET_SCALE);

    // HUD text — start invisible, fade in after intro
    this.scoreText = this.add.text(10, 10, 'SCORE: 0', {
      fontSize: '20px', fontFamily: 'monospace', color: '#ffffff'
    }).setAlpha(0);
    this.timeText = this.add.text(10, 35, 'TIME: 0', {
      fontSize: '16px', fontFamily: 'monospace', color: '#aaaaaa'
    }).setAlpha(0);
    this.stageText = this.add.text(GAME_WIDTH - 10, 10, 'WAVE 1', {
      fontSize: '16px', fontFamily: 'monospace', color: '#ffaa44'
    }).setOrigin(1, 0).setAlpha(0);
    this.hiText = this.add.text(GAME_WIDTH / 2, 10, `HI: ${localStorage.getItem(HI_SCORE_KEY)}`, {
      fontSize: '16px', fontFamily: 'monospace', color: '#ffdd00'
    }).setOrigin(0.5, 0).setAlpha(0);

    // Health bar
    this.hpGraphics = this.add.graphics().setAlpha(0);
    this.hpLabel = this.add.text(GAME_WIDTH - 140, GAME_HEIGHT - 20, 'HP', {
      fontSize: '11px', fontFamily: 'monospace', color: '#88aa88'
    }).setOrigin(1, 0.5).setAlpha(0);

    // Crosshair graphics
    this.crosshairGraphics = this.add.graphics().setAlpha(0);

    // Cursor
    this.input.setDefaultCursor('none');

    this.input.on('pointerdown', (pointer) => {
      if (!this.isOver) this.fireInterceptor(pointer.x, pointer.y);
    });

    // ── Iron Beam superweapon ─────────────────────────────────────────────
    this.ironBeamCharge   = 0;      // 0–1
    this.ironBeamReady    = false;
    this.ironBeamCooldown = 0;      // ms remaining after firing
    this.ironBeamFiring   = false;
    this.ironBeamBeams    = [];     // active laser segments { x1,y1,x2,y2,age,maxAge }
    this.ironBeamGraphics = this.add.graphics();

    // Icon image (circle-bordered) + charge bar — bottom-left area
    const iconX = 36, iconY = GAME_HEIGHT - 36;
    this.ironBeamIcon = this.add.image(iconX, iconY, 'ironbeam')
      .setDisplaySize(44, 44)
      .setOrigin(0.5, 0.5)
      .setAlpha(0)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => { if (this.ironBeamReady) this.fireIronBeam(); });
    this.ironBeamIconRing = this.add.graphics().setAlpha(0);
    this.ironBeamBarBg    = this.add.graphics().setAlpha(0);
    this.ironBeamBarFg    = this.add.graphics().setAlpha(0);
    this.ironBeamLabel    = this.add.text(iconX, iconY - 30, 'IRON BEAM', {
      fontSize: '9px', fontFamily: 'monospace', color: '#88ddff'
    }).setOrigin(0.5, 1).setAlpha(0);

    // Missile power HUD (hidden until active)
    const mpX = 100, mpY = GAME_HEIGHT - 36;
    this.mpHudGfx  = this.add.graphics().setAlpha(0);
    this.mpHudIcon = this.add.image(mpX, mpY, 'missile_power_icon')
      .setDisplaySize(38, 38).setOrigin(0.5).setAlpha(0);

    // Keyboard
    this.spaceKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    this.isPaused = false;
    this.pauseOverlay = null;
    this.pauseText = null;
    this._oneCount = 0;
    this._oneTimer = 0;
    this.input.keyboard.on('keydown-ONE', () => {
      if (this.isOver || this.isPaused) return;
      this._oneCount++;
      this._oneTimer = 1500;
      if (this._oneCount >= 3) {
        this._oneCount = 0;
        this.powerUps.push(new PowerUp(this, 'hp'));
      }
    });

    this._twoCount = 0;
    this._twoTimer = 0;
    this.input.keyboard.on('keydown-TWO', () => {
      if (this.isOver || this.isPaused) return;
      this._twoCount++;
      this._twoTimer = 1500;
      if (this._twoCount >= 3) {
        this._twoCount = 0;
        this.powerUps.push(new PowerUp(this, 'missile'));
      }
    });

    this._zeroCount = 0;
    this._zeroTimer = 0;
    this.input.keyboard.on('keydown-ZERO', () => {
      if (this.isOver || this.bonusActive) return;
      this._zeroCount++;
      this._zeroTimer = 1500; // ms window to hit 3 presses
      if (this._zeroCount >= 3) {
        this._zeroCount = 0;
        this.bonusActive = true;
        for (const m of this.enemyMissiles) m.destroy();
        this.enemyMissiles = [];
        this.scene.pause();
        this.scene.launch('Bonus');
      }
    });
    this.input.keyboard.on('keydown-P', () => {
      if (this.isOver) return;
      this.isPaused = !this.isPaused;
      if (this.isPaused) {
        this.pauseOverlay = this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.5).setDepth(100);
        this.pauseText = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2, 'PAUSED\nPress P to resume', {
          fontSize: '32px', fontFamily: 'monospace', color: '#ffffff',
          stroke: '#000', strokeThickness: 4, align: 'center'
        }).setOrigin(0.5).setDepth(101);
      } else {
        this.pauseOverlay.destroy(); this.pauseOverlay = null;
        this.pauseText.destroy();   this.pauseText = null;
      }
    });
    this.launchSound = this.sound.add('launch');

    // Fade in all HUD elements
    const hudElements = [
      this.scoreText, this.timeText, this.stageText, this.hiText,
      this.hpGraphics, this.hpLabel,
      this.ironBeamIcon, this.ironBeamIconRing, this.ironBeamBarBg,
      this.ironBeamBarFg, this.ironBeamLabel, this.crosshairGraphics,
    ];
    this.tweens.add({ targets: hudElements, alpha: 1, duration: 800, delay: 200 });
  }

  drawGround() {
    const g = this.groundGraphics;
    g.clear();
    g.fillStyle(0x334422, 1);
    g.fillRect(0, GAME_HEIGHT - 30, GAME_WIDTH, 30);
    g.lineStyle(2, 0x88aa44, 1);
    g.beginPath();
    g.moveTo(0, GAME_HEIGHT - 30);
    g.lineTo(GAME_WIDTH, GAME_HEIGHT - 30);
    g.strokePath();
  }

  getCurrentStage() {
    let stage = DIFFICULTY_STAGES[0];
    for (const s of DIFFICULTY_STAGES) {
      if (this.gameTime >= s.time) stage = s;
    }
    return stage;
  }

  getStageIndex() {
    let idx = 0;
    for (let i = 0; i < DIFFICULTY_STAGES.length; i++) {
      if (this.gameTime >= DIFFICULTY_STAGES[i].time) idx = i;
    }
    return idx;
  }

  spawnEnemy() {
    const stage = this.getCurrentStage();
    const type = weightedRandom(stage.types);
    const x = Phaser.Math.Between(30, GAME_WIDTH - 30);
    const spread = type === 'zigzag' ? 140 : 60;
    const targetX = Phaser.Math.Between(STATION_X - spread, STATION_X + spread);
    const missile = new EnemyMissile(this, x, -10, targetX, STATION_Y, type, stage.speedMult * DIFFICULTY_SPEED[getSettings().difficulty]);
    this.enemyMissiles.push(missile);
  }

  fireInterceptor(tx, ty) {
    if (this.launchSound.isPlaying) this.launchSound.stop();
    this.launchSound.play({ volume: getSettings().sfxVol });

    const interceptor = new Interceptor(this, tx, ty);
    this.interceptors.push(interceptor);

    // Launch flash
    const angle = Math.atan2(ty - (STATION_Y - 10), tx - STATION_X);
    this.launchFlashes.push(new LaunchFlash(this, STATION_X, STATION_Y - 10, angle));
  }

  checkCollisions() {
    let kills = 0;
    let killX = 0, killY = 0;

    for (const exp of this.explosions) {
      if (!exp.alive) continue;
      const r2 = exp.radius * exp.radius;

      for (const missile of this.enemyMissiles) {
        if (!missile.alive) continue;
        const d2 = distSq(exp.x, exp.y, missile.x, missile.y);
        if (d2 < r2) {
          missile.destroy();
          this.flashes.push(new Flash(this, missile.x, missile.y));
          kills++;
          killX = missile.x;
          killY = missile.y;
        }
      }
    }

    // Power-up collection — explosion radius catches a power-up
    for (const exp of this.explosions) {
      if (!exp.alive) continue;
      const r2 = exp.radius * exp.radius;
      for (const p of this.powerUps) {
        if (!p.alive) continue;
        if (distSq(exp.x, exp.y, p.x, p.y) < r2) {
          p.destroy();
          this.collectPowerUp(p.type);
        }
      }
    }

    if (kills > 0) {
      const base = SCORE_PER_KILL[getSettings().difficulty];
      let pts;
      if (kills === 1) {
        pts = base;
        this.combo = 0;
      } else {
        pts = kills * base + (kills - 1) * Math.floor(base / 2);
        this.combo += kills;
      }

      // Combo bonus if many kills recently
      if (this.combo >= 3) {
        pts += this.combo * 5;
        this.showPopText(killX, killY - 20, `COMBO x${this.combo}! +${pts}`);
      } else {
        this.showPopText(killX, killY - 10, `+${pts}`);
      }

      this.comboTimer = 2000;
      this.score += pts;
      this.scoreText.setText(`SCORE: ${this.score}`);

      // Update hi score
      const hi = parseInt(localStorage.getItem(HI_SCORE_KEY) || '0');
      if (this.score > hi) {
        localStorage.setItem(HI_SCORE_KEY, String(this.score));
        this.hiText.setText(`HI: ${this.score}`);
      }
    }
  }

  checkGroundHits() {
    for (const missile of this.enemyMissiles) {
      if (!missile.alive) continue;
      if (missile.y >= STATION_Y) {
        missile.destroy();
        this.sound.play('bad', { volume: getSettings().sfxVol });
        this.hp = Math.max(0, this.hp - HP_DAMAGE[getSettings().difficulty]);
        this.cameras.main.shake(200, 0.01);

        if (this.hp <= 0) {
          this.endGame();
        }
      }
    }
  }

  collectPowerUp(type) {
    if (type === 'hp') {
      const gain = HP_PERK_AMOUNT[getSettings().difficulty];
      this.hp = Math.min(HP_MAX, this.hp + gain);
      this.showPopText(STATION_X, STATION_Y - 80, `+${gain} HP`);
      this.sound.play('health_up', { volume: getSettings().sfxVol });
      this._doHpPerkEffect();
    } else if (type === 'missile') {
      this.missilePowerActive = true;
      this.missilePowerTimer  = 7000;
      this.showPopText(STATION_X, STATION_Y - 80, 'MISSILE POWER!');
      this.sound.play('missile_up', { volume: getSettings().sfxVol });
    }
  }

  _doHpPerkEffect() {
    const turret = this.turretSprite;
    const tx = STATION_X, ty = STATION_Y - 20;

    // Flash turret green
    turret.setTint(0x44ff44);
    this.tweens.add({
      targets: turret, alpha: 0.4, yoyo: true, repeat: 3,
      duration: 100,
      onComplete: () => { turret.clearTint(); turret.setAlpha(1); }
    });

    // Rising glowing "+" signs
    for (let i = 0; i < 5; i++) {
      const ox = (Math.random() - 0.5) * 50;
      const plus = this.add.text(tx + ox, ty, '+', {
        fontSize: `${14 + Math.random() * 10 | 0}px`,
        fontFamily: 'monospace',
        color: '#44ff88',
        stroke: '#004422',
        strokeThickness: 3,
      }).setOrigin(0.5).setAlpha(0.9);

      this.tweens.add({
        targets: plus,
        y: ty - 55 - Math.random() * 20,
        alpha: 0,
        duration: 900 + Math.random() * 300,
        delay: i * 80,
        ease: 'Quad.easeOut',
        onComplete: () => plus.destroy(),
      });
    }
  }

  drawMissilePowerHUD() {
    const mpX = 100, mpY = GAME_HEIGHT - 36, r = 24;
    const g = this.mpHudGfx;
    g.clear();

    if (!this.missilePowerActive) {
      this.mpHudGfx.setAlpha(0);
      this.mpHudIcon.setAlpha(0);
      return;
    }

    // Tick down timer
    this.missilePowerTimer -= this.game.loop.delta;
    if (this.missilePowerTimer <= 0) {
      this.missilePowerActive = false;
      this.missilePowerTimer  = 0;
      this.mpHudGfx.setAlpha(0);
      this.mpHudIcon.setAlpha(0);
      return;
    }

    this.mpHudGfx.setAlpha(1);

    // Slowly flash the icon (0.55–1.0 alpha cycle ~1.4 s)
    const flash = 0.75 + 0.25 * Math.sin(Date.now() * 0.0045);
    this.mpHudIcon.setAlpha(flash);

    // Dark circle background
    g.fillStyle(0x001122, 0.8);
    g.fillCircle(mpX, mpY, r);

    // Rim ring
    g.lineStyle(3, 0xffaa00, 0.6);
    g.strokeCircle(mpX, mpY, r);

    // Radial countdown arc (orange, drains clockwise from top)
    const frac = this.missilePowerTimer / 7000;
    const startAngle = -Math.PI / 2;
    const endAngle   = startAngle + frac * Math.PI * 2;
    g.lineStyle(4, 0xffdd00, 1);
    g.beginPath();
    g.arc(mpX, mpY, r, startAngle, endAngle, false);
    g.strokePath();
  }

  showPopText(x, y, msg) {
    const txt = this.add.text(x, y, msg, {
      fontSize: '16px', fontFamily: 'monospace', color: '#ffdd00',
      stroke: '#000000', strokeThickness: 3
    }).setOrigin(0.5);

    this.tweens.add({
      targets: txt,
      y: y - 30,
      alpha: 0,
      duration: 800,
      onComplete: () => txt.destroy()
    });
  }

  drawHealthBar() {
    const g = this.hpGraphics;
    g.clear();

    const barW = 120, barH = 10;
    const bx = GAME_WIDTH - barW - 10;
    const by = GAME_HEIGHT - 20;
    const pct = this.hp / HP_MAX;

    // Track
    g.fillStyle(0x222222, 0.8);
    g.fillRect(bx, by, barW, barH);

    // Fill — green → yellow → red
    const color = pct > 0.5
      ? Phaser.Display.Color.GetColor(Math.round((1 - pct) * 2 * 255), 210, 50)
      : Phaser.Display.Color.GetColor(220, Math.round(pct * 2 * 200), 30);
    g.fillStyle(color, 1);
    g.fillRect(bx, by, barW * pct, barH);

    // Border
    g.lineStyle(1, 0x668866, 0.8);
    g.strokeRect(bx, by, barW, barH);

    // Label
    g.fillStyle(0xaaaaaa, 1);
  }

  drawHUD() {
    const stageIdx = this.getStageIndex();
    this.stageText.setText(`WAVE ${stageIdx + 1}`);
    this.timeText.setText(`TIME: ${Math.floor(this.gameTime)}`);
  }

  drawCrosshair() {
    const g = this.crosshairGraphics;
    g.clear();

    const ptr = this.input.activePointer;
    const cx = ptr.x;
    const cy = ptr.y;

    // Dashed line from station to cursor
    const dx = cx - STATION_X;
    const dy = cy - (STATION_Y - 10);
    const dist = Math.sqrt(dx * dx + dy * dy);
    const steps = Math.floor(dist / 12);
    for (let i = 0; i < steps; i++) {
      if (i % 2 === 0) {
        const t0 = i / steps;
        const t1 = (i + 0.5) / steps;
        g.lineStyle(1, 0x00ff88, 0.3);
        g.beginPath();
        g.moveTo(STATION_X + dx * t0, STATION_Y - 10 + dy * t0);
        g.lineTo(STATION_X + dx * t1, STATION_Y - 10 + dy * t1);
        g.strokePath();
      }
    }

    // Crosshair
    const r = 12;
    const gap = 4;
    g.lineStyle(2, 0x00ff88, 0.9);
    g.beginPath();
    g.moveTo(cx - r, cy); g.lineTo(cx - gap, cy);
    g.moveTo(cx + gap, cy); g.lineTo(cx + r, cy);
    g.moveTo(cx, cy - r); g.lineTo(cx, cy - gap);
    g.moveTo(cx, cy + gap); g.lineTo(cx, cy + r);
    g.strokePath();

    g.lineStyle(1, 0x00ff88, 0.5);
    g.strokeCircle(cx, cy, r * 0.8);
  }

  updateTurretFrame() {
    const ptr = this.input.activePointer;
    const angle = Math.atan2(ptr.y - STATION_Y, ptr.x - STATION_X);
    this.turretSprite.setFrame(angleToTurretFrame(angle));
  }

  fireIronBeam() {
    if (!this.ironBeamReady || this.ironBeamFiring) return;
    this.ironBeamReady  = false;
    this.ironBeamCharge = 0;
    this.ironBeamFiring = true;
    this.sound.play('laser', { volume: getSettings().sfxVol });

    // Fire one laser per live enemy missile
    const targets = this.enemyMissiles.filter(m => m.alive);
    for (const missile of targets) {
      this.ironBeamBeams.push({
        x1: STATION_X, y1: STATION_Y - 15,
        x2: missile.x, y2: missile.y,
        age: 0, maxAge: 400,
        targetMissile: missile
      });
    }

    // Kill all missiles after brief flash delay
    this.time.delayedCall(80, () => {
      for (const m of targets) {
        if (m.alive) {
          this.flashes.push(new Flash(this, m.x, m.y));
          this.score += SCORE_PER_KILL[getSettings().difficulty];
          m.destroy();
        }
      }
      this.scoreText.setText('SCORE: ' + this.score);
      const hi = parseInt(localStorage.getItem(HI_SCORE_KEY) || '0');
      if (this.score > hi) {
        localStorage.setItem(HI_SCORE_KEY, String(this.score));
        this.hiText.setText('HI: ' + this.score);
      }
      if (targets.length > 0) {
        this.showPopText(STATION_X, STATION_Y - 80,
          'IRON BEAM! +' + (targets.length * 10));
      }
    });

    this.time.delayedCall(500, () => { this.ironBeamFiring = false; });
  }

  drawIronBeamHUD() {
    const iconX = 36, iconY = GAME_HEIGHT - 36;

    // Icon ring: grey when charging, cyan when ready
    const ringColor = this.ironBeamReady ? 0x00eeff : 0x446677;
    const g = this.ironBeamIconRing;
    g.clear();
    g.lineStyle(5, ringColor, 1);
    g.strokeCircle(iconX, iconY, 26);

    // Charge bar background
    const barX = 68, barY = GAME_HEIGHT - 48, barW = 80, barH = 12;
    const bg = this.ironBeamBarBg;
    bg.clear();
    bg.fillStyle(0x112233, 1);
    bg.fillRect(barX, barY, barW, barH);
    bg.lineStyle(1, 0x446677, 1);
    bg.strokeRect(barX, barY, barW, barH);

    // Charge fill
    const fg = this.ironBeamBarFg;
    fg.clear();
    if (this.ironBeamReady) {
      // Pulsing cyan when full
      const pulse = 0.6 + 0.4 * Math.sin(Date.now() * 0.008);
      fg.fillStyle(0x00eeff, pulse);
      fg.fillRect(barX + 1, barY + 1, barW - 2, barH - 2);
      // READY label
      fg.fillStyle(0x00eeff, 1);
    } else {
      fg.fillStyle(0x00aacc, 1);
      fg.fillRect(barX + 1, barY + 1,
        Math.floor((barW - 2) * this.ironBeamCharge), barH - 2);
    }

    // Draw active laser beams
    const gb = this.ironBeamGraphics;
    gb.clear();
    for (const beam of this.ironBeamBeams) {
      const t = beam.age / beam.maxAge;
      const alpha = 1 - t;
      const width = 3 * (1 - t * 0.7);
      // Outer glow
      gb.lineStyle(width + 4, 0x0088ff, alpha * 0.3);
      gb.beginPath(); gb.moveTo(beam.x1, beam.y1); gb.lineTo(beam.x2, beam.y2); gb.strokePath();
      // Core beam
      gb.lineStyle(width, 0xaaeeff, alpha);
      gb.beginPath(); gb.moveTo(beam.x1, beam.y1); gb.lineTo(beam.x2, beam.y2); gb.strokePath();
    }

    // Update beam ages, prune dead ones
    for (let i = this.ironBeamBeams.length - 1; i >= 0; i--) {
      this.ironBeamBeams[i].age += 16;
      if (this.ironBeamBeams[i].age >= this.ironBeamBeams[i].maxAge)
        this.ironBeamBeams.splice(i, 1);
    }

    // Label
    this.ironBeamLabel.setText(this.ironBeamReady ? '[ SPACE ]' : 'IRON BEAM');
    this.ironBeamLabel.setColor(this.ironBeamReady ? '#00eeff' : '#88ddff');
  }

  endGame() {
    if (this.isOver) return;
    this.isOver = true;

    // Final hi score save
    const hi = parseInt(localStorage.getItem(HI_SCORE_KEY) || '0');
    if (this.score > hi) {
      localStorage.setItem(HI_SCORE_KEY, String(this.score));
    }

    // Stop spawning and clean up
    this.time.delayedCall(1500, () => {
      this.scene.start('Splash', { gameOver: true, score: this.score });
    });

    this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 20, 'BASE DESTROYED!', {
      fontSize: '40px', fontFamily: 'monospace', color: '#ff4444',
      stroke: '#000', strokeThickness: 4
    }).setOrigin(0.5);
  }

  update(time, delta) {
    if (this.isOver) return;

    if (this.isPaused) return;

    if (this._oneTimer > 0) {
      this._oneTimer -= delta;
      if (this._oneTimer <= 0) this._oneCount = 0;
    }
    if (this._twoTimer > 0) {
      this._twoTimer -= delta;
      if (this._twoTimer <= 0) this._twoCount = 0;
    }
    if (this._zeroTimer > 0) {
      this._zeroTimer -= delta;
      if (this._zeroTimer <= 0) this._zeroCount = 0;
    }

    this.gameTime += delta / 1000;
    this.spawnTimer -= delta / 1000;
    if (this.comboTimer > 0) {
      this.comboTimer -= delta;
      if (this.comboTimer <= 0) this.combo = 0;
    }

    // Spawn
    const stage = this.getCurrentStage();
    if (this.spawnTimer <= 0) {
      this.spawnEnemy();
      this.spawnTimer = stage.spawnInterval;
    }

    // Update enemies
    const newChildren = [];
    for (const m of this.enemyMissiles) {
      m.update(delta);
      if (m.splitChildren && m.splitChildren.length > 0) {
        for (const c of m.splitChildren) newChildren.push(c);
        m.splitChildren = [];
      }
    }
    for (const c of newChildren) this.enemyMissiles.push(c);

    // Update interceptors
    for (const i of this.interceptors) i.update(delta);

    // Update explosions
    for (const e of this.explosions) e.update(delta);

    // Update flashes
    for (const f of this.flashes) f.update(delta);

    // Update launch flashes
    for (const lf of this.launchFlashes) lf.update(delta);

    // Update debris
    for (const d of this.debris) d.update(delta);

    // Spawn & update power-ups
    this.powerUpTimer -= delta / 1000;
    if (this.powerUpTimer <= 0) {
      const puType = Math.random() < 0.5 ? 'hp' : 'missile';
      this.powerUps.push(new PowerUp(this, puType));
      this.powerUpTimer = POWERUP_SPAWN_INTERVAL[getSettings().difficulty];
    }
    for (const p of this.powerUps) p.update(delta);

    // Collisions & ground hits
    this.checkCollisions();
    this.checkGroundHits();

    // Prune
    pruneArray(this.enemyMissiles);
    pruneArray(this.interceptors);
    pruneArray(this.explosions);
    pruneArray(this.flashes);
    pruneArray(this.launchFlashes);
    pruneArray(this.debris);
    pruneArray(this.powerUps);

    // Iron Beam charge + fire
    const CHARGE_TIME = 7000;
    if (!this.ironBeamReady && !this.ironBeamFiring) {
      this.ironBeamCharge = Math.min(1, this.ironBeamCharge + delta / CHARGE_TIME);
      if (this.ironBeamCharge >= 1) this.ironBeamReady = true;
    }
    if (Phaser.Input.Keyboard.JustDown(this.spaceKey) && this.ironBeamReady) {
      this.fireIronBeam();
    }

    // Bonus wave trigger: every 5th wave (wave 5, 10, …)
    const curWave = this.getStageIndex() + 1;
    if (!this.bonusActive && curWave % 5 === 0 && curWave > this.lastBonusWave) {
      this.lastBonusWave = curWave;
      this.bonusActive = true;
      // Clear airborne missiles so the player isn't hit while scene is paused
      for (const m of this.enemyMissiles) m.destroy();
      this.enemyMissiles = [];
      this.scene.pause();
      this.scene.launch('Bonus');
    }

    // HUD
    this.drawHUD();
    this.drawHealthBar();
    this.drawIronBeamHUD();
    this.drawMissilePowerHUD();
    this.drawCrosshair();
    this.updateTurretFrame();
  }
}

// ─── Walker ──────────────────────────────────────────────────────────────────
const FRANTIC_FRAME_COUNT = { frantic_female: 2, frantic_male: 4 };

class Walker {
  // franticType: null = peaceful walker, 'frantic_female' | 'frantic_male' = phase 2
  constructor(scene, franticType = null) {
    this.scene      = scene;
    this.frameIndex = 0;
    this.frameTimer = 0;
    this.runoff     = false;

    if (franticType) {
      this.type          = franticType;
      this.frameCount    = FRANTIC_FRAME_COUNT[franticType];
      this.frameDuration = 80 + Math.random() * 60;
      this.startX        = 0;
      this.endX          = GAME_WIDTH;
      this.speed         = 90 + Math.random() * 80;
    } else {
      this.type          = Math.random() < 0.5 ? 'male' : 'female';
      this.frameCount    = this.type === 'male' ? 3 : 4;
      this.frameDuration = 180 + Math.random() * 80;
      const pathWidth    = 100 + Math.random() * 220;
      const margin       = 40;
      this.startX        = margin + Math.random() * (GAME_WIDTH - margin * 2 - pathWidth);
      this.endX          = this.startX + pathWidth;
      this.speed         = 35 + Math.random() * 45;
    }

    this.x         = this.startX + Math.random() * (this.endX - this.startX);
    this.y         = GAME_HEIGHT - 30;
    this.direction = Math.random() < 0.5 ? 1 : -1;
    this.scale     = 0.13 + Math.random() * 0.04;

    this.sprite = scene.add.sprite(this.x, this.y, this.type, 'frame_000')
      .setOrigin(0.5, 1)
      .setScale(this.scale)
      .setFlipX(this.direction < 0);
  }

  startRunoff() {
    this.runoff = true;
    this.speed  = 220 + Math.random() * 100;
  }

  get offScreen() {
    return this.x < -80 || this.x > GAME_WIDTH + 80;
  }

  update(delta) {
    this.x += this.direction * this.speed * (delta / 1000);

    if (!this.runoff) {
      if (this.x >= this.endX) {
        this.x = this.endX;
        this.direction = -1;
        this.sprite.setFlipX(true);
      } else if (this.x <= this.startX) {
        this.x = this.startX;
        this.direction = 1;
        this.sprite.setFlipX(false);
      }
    }

    this.frameTimer += delta;
    if (this.frameTimer >= this.frameDuration) {
      this.frameTimer = 0;
      this.frameIndex = (this.frameIndex + 1) % this.frameCount;
    }

    this.sprite.setFrame(`frame_00${this.frameIndex}`);
    this.sprite.setPosition(this.x, this.y);
  }
}

// ─── IntroScene ───────────────────────────────────────────────────────────────
class IntroScene extends Phaser.Scene {
  constructor() { super('Intro'); }

  create() {
    this.phase = 1;

    // Background
    this.add.image(GAME_WIDTH / 2, GAME_HEIGHT / 2, 'citybg')
      .setDisplaySize(GAME_WIDTH, GAME_HEIGHT);

    // Ground
    const g = this.add.graphics();
    g.fillStyle(0x334422, 1);
    g.fillRect(0, GAME_HEIGHT - 30, GAME_WIDTH, 30);
    g.lineStyle(2, 0x88aa44, 1);
    g.beginPath(); g.moveTo(0, GAME_HEIGHT - 30); g.lineTo(GAME_WIDTH, GAME_HEIGHT - 30); g.strokePath();

    // Turret — motionless, pointing straight up (frame 11)
    this.add.sprite(STATION_X, GAME_HEIGHT - 30, 'turret', 11)
      .setOrigin(0.5, 1).setScale(TURRET_SCALE);

    // Phase 1 walkers
    this.walkers = [];
    const count = 4 + Math.floor(Math.random() * 5);
    for (let i = 0; i < count; i++) this.walkers.push(new Walker(this, false));

    // Alert image — hidden, depth 5 (above walkers)
    this.alertImg = this.add.image(GAME_WIDTH / 2, GAME_HEIGHT / 2, 'alert')
      .setDisplaySize(GAME_WIDTH * 0.3, GAME_HEIGHT * 0.3)
      .setDepth(5).setVisible(false);

    // Red border around the alert image — drawn once, toggled via alpha tween in phase 2
    const alertW = GAME_WIDTH * 0.3, alertH = GAME_HEIGHT * 0.3;
    const alertX = (GAME_WIDTH - alertW) / 2, alertY = (GAME_HEIGHT - alertH) / 2;
    this.borderGfx = this.add.graphics().setDepth(6).setAlpha(0);
    const bp = 10; // padding beyond alert image
    this.borderGfx.lineStyle(10, 0xff0000, 1);
    this.borderGfx.strokeRect(alertX - bp, alertY - bp, alertW + bp * 2, alertH + bp * 2);

    // Alert sound — added now, played when phase 2 starts
    this.alertSound = this.sound.add('alert_2', { loop: true, volume: getSettings().sfxVol });

    // Bottom bar — depth 10, always on top of walkers; kept slim and dim
    const bar = this.add.graphics().setDepth(10);
    bar.fillStyle(0x001a33, 0.4);
    bar.fillRect(0, GAME_HEIGHT - 26, GAME_WIDTH, 26);
    bar.lineStyle(1, 0x003355, 0.5);
    bar.beginPath(); bar.moveTo(0, GAME_HEIGHT - 26); bar.lineTo(GAME_WIDTH, GAME_HEIGHT - 26); bar.strokePath();

    this.startText = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT - 13, 'CLICK TO SKIP', {
      fontSize: '12px', fontFamily: 'monospace', color: '#336644',
      stroke: '#001108', strokeThickness: 2
    }).setOrigin(0.5).setDepth(11);
    this.tweens.add({ targets: this.startText, alpha: 0.2, duration: 1000, yoyo: true, repeat: -1 });

    this.runoffTriggered = false;
    this.gameStarting    = false;

    // Auto-transition to phase 2 after 2 seconds
    this.time.delayedCall(2000, () => this.startPhase2());

    this.input.on('pointerdown', () => {
      this.alertSound.stop();
      this.scene.start('Game');
    });
  }

  startPhase2() {
    this.phase = 2;

    // Swap walkers: 50% frantic_female, 50% frantic_male
    for (const w of this.walkers) w.sprite.destroy();
    this.walkers = [];
    const count = 5 + Math.floor(Math.random() * 4); // 5–8
    for (let i = 0; i < count; i++) {
      const ft = Math.random() < 0.5 ? 'frantic_female' : 'frantic_male';
      this.walkers.push(new Walker(this, ft));
    }

    // Show alert overlay
    this.alertImg.setVisible(true);

    // Flash red border
    this.tweens.add({
      targets: this.borderGfx,
      alpha: { from: 0.85, to: 0.15 },
      duration: 280,
      yoyo: true,
      repeat: -1,
    });

    // Play alert sound
    this.alertSound.play();

    // Make prompt text urgent
    this.startText.setColor('#ff4444').setStroke('#220000', 3);

    // After 1.5s everyone runs off-screen, then game starts automatically
    this.time.delayedCall(1500, () => this.triggerRunoff());
  }

  triggerRunoff() {
    this.runoffTriggered = true;
    for (const w of this.walkers) w.startRunoff();
    this.tweens.killTweensOf(this.borderGfx);
    this.tweens.add({ targets: [this.alertImg, this.borderGfx], alpha: 0, duration: 500 });
  }

  update(_, delta) {
    for (const w of this.walkers) w.update(delta);

    if (this.runoffTriggered && !this.gameStarting && this.walkers.every(w => w.offScreen)) {
      this.gameStarting = true;
      this.alertSound.stop();
      this.scene.start('Game');
    }
  }
}

// ─── BonusTruckMissile ───────────────────────────────────────────────────────
class BonusTruckMissile {
  constructor(scene, x, y, tx, ty) {
    this.scene = scene;
    this.x = x;
    this.y = y;
    this.alive = true;
    const dx = tx - x, dy = ty - y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const speed = 180;
    this.vx = (dx / dist) * speed;
    this.vy = (dy / dist) * speed;
    this.frame = 0;
    this.frameTimer = 0;
    const angle = Math.atan2(dy, dx);
    this.sprite = scene.add.sprite(x, y, 'missile', 0)
      .setScale(0.142)
      .setOrigin(0.5)
      .setRotation(angle + Math.PI / 2);
  }

  update(delta) {
    if (!this.alive) return;
    this.x += this.vx * delta / 1000;
    this.y += this.vy * delta / 1000;
    this.sprite.setPosition(this.x, this.y);
    this.frameTimer += delta;
    if (this.frameTimer > 150) {
      this.frame = 1 - this.frame;
      this.sprite.setFrame(this.frame);
      this.frameTimer = 0;
    }
    if (this.x < -60 || this.x > GAME_WIDTH + 60 || this.y < -60) this.destroy();
  }

  destroy() {
    this.alive = false;
    if (this.sprite) { this.sprite.destroy(); this.sprite = null; }
  }
}

// ─── BonusBomb ────────────────────────────────────────────────────────────────
class BonusBomb {
  constructor(scene, x, y) {
    this.scene = scene;
    this.x = x;
    this.y = y;
    this.alive = true;
    this.speed = 320;
    this.graphics = scene.add.graphics();
    this._draw();
  }

  _draw() {
    const g = this.graphics;
    g.clear();
    g.fillStyle(0x222222, 1);
    g.fillEllipse(this.x, this.y, 12, 20);
    g.fillStyle(0xffaa00, 1);
    g.fillCircle(this.x, this.y - 10, 5);
  }

  update(delta) {
    if (!this.alive) return;
    this.y += this.speed * delta / 1000;
    this._draw();
    if (this.y > GAME_HEIGHT + 20) { this.alive = false; this.graphics.destroy(); }
  }
}

// ─── BonusTruck ───────────────────────────────────────────────────────────────
class BonusTruck {
  constructor(scene) {
    this.scene = scene;
    this.alive = true;
    this.state = 'entering';
    this.waitTimer = 0;

    const fromLeft = Math.random() < 0.5;
    this.dir = fromLeft ? 1 : -1;
    this.x = fromLeft ? -70 : GAME_WIDTH + 70;
    this.y = GAME_HEIGHT - 30;
    this.targetX = 160 + Math.random() * (GAME_WIDTH - 320);
    this.speed = 80 + Math.random() * 40;

    this.sprite = scene.add.image(this.x, this.y, 'truck_loaded')
      .setDisplaySize(120, 55)
      .setOrigin(0.5, 1)
      .setFlipX(fromLeft); // flip so truck faces direction of travel
  }

  update(delta) {
    if (!this.alive) return;

    if (this.state === 'entering') {
      this.x += this.dir * this.speed * delta / 1000;
      this.sprite.setX(this.x);
      const arrived = this.dir > 0 ? this.x >= this.targetX : this.x <= this.targetX;
      if (arrived) {
        this.x = this.targetX;
        this.state = 'waiting';
        this.waitTimer = 500;
      }
    } else if (this.state === 'waiting') {
      this.waitTimer -= delta;
      if (this.waitTimer <= 0) {
        this.fireMissile();
        this.sprite.setTexture('truck_empty').setDisplaySize(120, 55);
        this.state = 'leaving';
      }
    } else if (this.state === 'leaving') {
      this.x += this.dir * this.speed * delta / 1000;
      this.sprite.setX(this.x);
      if (this.x < -120 || this.x > GAME_WIDTH + 120) this.destroy();
    }
  }

  fireMissile() {
    const tx = 50 + Math.random() * (GAME_WIDTH - 100);
    const ty = Math.random() * (GAME_HEIGHT / 3);
    this.scene.missiles.push(new BonusTruckMissile(this.scene, this.x, this.y - 55, tx, ty));
  }

  destroy() {
    this.alive = false;
    if (this.sprite) { this.sprite.destroy(); this.sprite = null; }
  }
}

// ─── BonusScene ───────────────────────────────────────────────────────────────
class BonusScene extends Phaser.Scene {
  constructor() { super('Bonus'); }

  create() {
    this.bonusScore = 0;
    this.trucks = [];
    this.missiles = [];
    this.bombs = [];
    this.done = false;
    this.trucksSpawned = 0;
    this.trucksTotal = 5;
    this.spawnTimer = 600;

    // Background
    this.add.image(GAME_WIDTH / 2, GAME_HEIGHT / 2, 'teheranbg')
      .setDisplaySize(GAME_WIDTH, GAME_HEIGHT);

    // Ground strip
    const gnd = this.add.graphics();
    gnd.fillStyle(0x445533, 1);
    gnd.fillRect(0, GAME_HEIGHT - 30, GAME_WIDTH, 30);
    gnd.lineStyle(2, 0x88aa44, 1);
    gnd.beginPath(); gnd.moveTo(0, GAME_HEIGHT - 30);
    gnd.lineTo(GAME_WIDTH, GAME_HEIGHT - 30); gnd.strokePath();

    // Header bar
    this.add.rectangle(GAME_WIDTH / 2, 20, GAME_WIDTH, 40, 0x000000, 0.65);
    this.add.text(GAME_WIDTH / 2, 20, 'BONUS STAGE — DESTROY THE LAUNCHERS!', {
      fontSize: '14px', fontFamily: 'monospace', color: '#ffdd00'
    }).setOrigin(0.5);
    this.bonusText = this.add.text(10, 20, 'BONUS: 0', {
      fontSize: '13px', fontFamily: 'monospace', color: '#ffffff'
    }).setOrigin(0, 0.5);

    // F-35
    this.f35X = -60;
    this.f35Y = GAME_HEIGHT * 0.3;
    this.f35Dir = 1;
    this.f35Angle = 0; // radians, smoothed flight direction
    this.f35Speed = 130;
    this.f35Sprite = this.add.image(this.f35X, this.f35Y, 'f35')
      .setDisplaySize(117, 47)
      .setOrigin(0.5);

    // Bomb drop hint
    this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT - 12, GAME_WIDTH, 24, 0x000000, 0.45);
    this.add.text(GAME_WIDTH / 2, GAME_HEIGHT - 12, 'CLICK TO DROP BOMB', {
      fontSize: '11px', fontFamily: 'monospace', color: '#999999'
    }).setOrigin(0.5);

    this.input.on('pointerdown', () => { if (!this.done) this._dropBomb(); });

    // Music
    this.sound.get('gameMusic').stop();
    const bonus = this.sound.get('bonusMusic');
    bonus.setVolume(getSettings().musicVol);
    if (!bonus.isPlaying) bonus.play();

    // Custom arrow cursor
    this.input.setDefaultCursor('none');
    this.cursorGfx = this.add.graphics().setDepth(200);
    this.cursorAngle = -Math.PI / 2; // default: pointing up
    this._lastPtrX = null;
    this._lastPtrY = null;

    // Auto-end after 25 s
    this.time.delayedCall(25000, () => this._endBonus());
  }

  _drawCursorArrow(x, y, angle) {
    const g = this.cursorGfx;
    g.clear();
    // Arrow: tip at (x,y), pointing in `angle` direction
    const len = 18, hw = 7, tail = 10;
    const cos = Math.cos(angle), sin = Math.sin(angle);
    // Points relative to tip
    const tip  = { x: x + cos * len,        y: y + sin * len };
    const base = { x: x - cos * tail,       y: y - sin * tail };
    const lw   = { x: base.x - sin * hw,    y: base.y + cos * hw };
    const rw   = { x: base.x + sin * hw,    y: base.y - cos * hw };
    g.fillStyle(0xffffff, 0.9);
    g.fillTriangle(tip.x, tip.y, lw.x, lw.y, rw.x, rw.y);
    g.lineStyle(1.5, 0x000000, 0.7);
    g.strokeTriangle(tip.x, tip.y, lw.x, lw.y, rw.x, rw.y);
  }

  _dropBomb() {
    this.bombs.push(new BonusBomb(this, this.f35X, this.f35Y + 18));
  }

  _showExplosion(x, y) {
    const g = this.add.graphics();
    const t = { r: 5, alpha: 1 };
    this.tweens.add({
      targets: t, r: 45, alpha: 0, duration: 600,
      onUpdate: () => {
        g.clear();
        g.fillStyle(0xff8800, t.alpha * 0.8);
        g.fillCircle(x, y, t.r);
        g.fillStyle(0xffff00, t.alpha * 0.5);
        g.fillCircle(x, y, t.r * 0.5);
      },
      onComplete: () => g.destroy(),
    });
  }

  _endBonus() {
    if (this.done) return;
    this.done = true;

    this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, 380, 60, 0x000000, 0.75);
    this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2, `BONUS +${this.bonusScore} — RETURNING TO BATTLE…`, {
      fontSize: '16px', fontFamily: 'monospace', color: '#ffffff'
    }).setOrigin(0.5);

    this.time.delayedCall(1800, () => {
      const gameScene = this.scene.get('Game');
      gameScene.score += this.bonusScore;
      gameScene.bonusActive = false;
      this.input.setDefaultCursor('default');
      this.sound.get('bonusMusic').stop();
      this.sound.get('gameMusic').setVolume(getSettings().musicVol);
      this.sound.get('gameMusic').play();
      this.scene.stop();
      this.scene.resume('Game');
    });
  }

  update(_, delta) {
    if (this.done) return;

    // Fly F-35 — steer by mouse velocity, always move at full speed
    const ptr = this.input.activePointer;
    const px = ptr.x, py = ptr.y;
    if (this._lastPtrX !== null) {
      const mdx = px - this._lastPtrX, mdy = py - this._lastPtrY;
      if (mdx * mdx + mdy * mdy > 4) {
        const targetAngle = Math.atan2(mdy, mdx);
        let diff = targetAngle - this.f35Angle;
        while (diff >  Math.PI) diff -= 2 * Math.PI;
        while (diff < -Math.PI) diff += 2 * Math.PI;
        this.f35Angle += diff * Math.min(1, delta / 80);
        this.f35Dir = mdx >= 0 ? 1 : -1;
      }
    }
    // Always advance at full speed along current angle
    this.f35X += Math.cos(this.f35Angle) * this.f35Speed * delta / 1000;
    this.f35Y += Math.sin(this.f35Angle) * this.f35Speed * delta / 1000;
    // Wrap/clamp so it stays on screen
    this.f35X = Phaser.Math.Clamp(this.f35X, -60, GAME_WIDTH + 60);
    // F-35 sprite points right by default; flipX when going left, mirror rotation
    this.f35Sprite.setPosition(this.f35X, this.f35Y)
      .setFlipX(this.f35Dir < 0)
      .setFlipY(false)
      .setRotation(this.f35Dir < 0 ? Math.PI - this.f35Angle : this.f35Angle);

    // Spawn trucks
    if (this.trucksSpawned < this.trucksTotal) {
      this.spawnTimer -= delta;
      if (this.spawnTimer <= 0) {
        this.trucks.push(new BonusTruck(this));
        this.trucksSpawned++;
        this.spawnTimer = 2000 + Math.random() * 2500;
      }
    }

    // Update entities
    for (const t of this.trucks) t.update(delta);
    for (const m of this.missiles) m.update(delta);
    for (const b of this.bombs) b.update(delta);

    // Bomb → truck collisions
    for (const b of this.bombs) {
      if (!b.alive) continue;
      for (const t of this.trucks) {
        if (!t.alive) continue;
        const dx = b.x - t.x, dy = b.y - (t.y - 28);
        if (dx * dx + dy * dy < 55 * 55) {
          b.alive = false;
          b.graphics.destroy();
          this._showExplosion(t.x, t.y - 28);
          t.destroy();
          this.bonusScore += 50;
          this.bonusText.setText(`BONUS: ${this.bonusScore}`);
        }
      }
    }

    // F-35 hit by missile or ground → end bonus
    const F35_RADIUS = 22;
    for (const m of this.missiles) {
      if (!m.alive) continue;
      const dx = this.f35X - m.x, dy = this.f35Y - m.y;
      if (dx * dx + dy * dy < F35_RADIUS * F35_RADIUS) {
        this._showExplosion(this.f35X, this.f35Y);
        this.f35Sprite.destroy();
        this._endBonus();
        return;
      }
    }
    if (this.f35Y >= GAME_HEIGHT - 30) {
      this._showExplosion(this.f35X, this.f35Y);
      this.f35Sprite.destroy();
      this._endBonus();
      return;
    }

    pruneArray(this.trucks);
    pruneArray(this.missiles);
    pruneArray(this.bombs);

    // Arrow cursor — angle tracks movement direction
    if (this._lastPtrX !== null) {
      const mdx = px - this._lastPtrX, mdy = py - this._lastPtrY;
      if (mdx * mdx + mdy * mdy > 4) { // only update when moved enough to be meaningful
        const targetAngle = Math.atan2(mdy, mdx);
        // Shortest-path angular lerp
        let diff = targetAngle - this.cursorAngle;
        while (diff >  Math.PI) diff -= 2 * Math.PI;
        while (diff < -Math.PI) diff += 2 * Math.PI;
        this.cursorAngle += diff * Math.min(1, delta / 80);
      }
    }
    this._lastPtrX = px; this._lastPtrY = py;
    this._drawCursorArrow(px, py, this.cursorAngle);

    // End when all trucks accounted for and gone
    if (this.trucksSpawned >= this.trucksTotal &&
        this.trucks.length === 0 && this.missiles.length === 0) {
      this._endBonus();
    }
  }
}

// ─── SettingsScene ───────────────────────────────────────────────────────────
class SettingsScene extends Phaser.Scene {
  constructor() { super('Settings'); }

  create() {
    this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x000814);

    const gridG = this.add.graphics();
    gridG.lineStyle(1, 0x112233, 0.4);
    for (let x = 0; x <= GAME_WIDTH; x += 40) { gridG.beginPath(); gridG.moveTo(x, 0); gridG.lineTo(x, GAME_HEIGHT); gridG.strokePath(); }
    for (let y = 0; y <= GAME_HEIGHT; y += 40) { gridG.beginPath(); gridG.moveTo(0, y); gridG.lineTo(GAME_WIDTH, y); gridG.strokePath(); }

    const titleBg = this.add.graphics();
    titleBg.fillStyle(0x001a33, 1);
    titleBg.fillRect(0, 0, GAME_WIDTH, 54);
    titleBg.lineStyle(2, 0x0088ff, 0.8);
    titleBg.beginPath(); titleBg.moveTo(0, 54); titleBg.lineTo(GAME_WIDTH, 54); titleBg.strokePath();
    this.add.text(GAME_WIDTH / 2, 27, 'SETTINGS', {
      fontSize: '26px', fontFamily: 'monospace', color: '#00ccff',
      stroke: '#000033', strokeThickness: 3
    }).setOrigin(0.5);

    const panelBg = this.add.graphics();
    panelBg.fillStyle(0x001122, 0.85);
    panelBg.fillRoundedRect(150, 70, 500, 440, 8);
    panelBg.lineStyle(1, 0x0066aa, 0.7);
    panelBg.strokeRoundedRect(150, 70, 500, 440, 8);

    const cx = GAME_WIDTH / 2;
    this._makeSlider(cx, 175, 340, 'MUSIC VOLUME',
      () => getSettings().musicVol,
      (v) => { const s = getSettings(); s.musicVol = v; saveSettings(s); applyVolumes(this.sound); }
    );
    this._makeSlider(cx, 295, 340, 'SFX VOLUME',
      () => getSettings().sfxVol,
      (v) => { const s = getSettings(); s.sfxVol = v; saveSettings(s); }
    );
    this._makeDiffButtons(cx, 415);

    const bottomBg = this.add.graphics();
    bottomBg.fillStyle(0x001a33, 1);
    bottomBg.fillRect(0, GAME_HEIGHT - 44, GAME_WIDTH, 44);
    bottomBg.lineStyle(2, 0x0088ff, 0.8);
    bottomBg.beginPath(); bottomBg.moveTo(0, GAME_HEIGHT - 44); bottomBg.lineTo(GAME_WIDTH, GAME_HEIGHT - 44); bottomBg.strokePath();

    const backText = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT - 22, '← BACK', {
      fontSize: '20px', fontFamily: 'monospace', color: '#00ff88',
      stroke: '#002211', strokeThickness: 3
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    backText.on('pointerdown', () => this.scene.start('Splash', { gameOver: false, score: 0 }));
  }

  _makeSlider(cx, y, width, label, getValue, setValue) {
    const trackH = 8, thumbR = 10, tx = cx - width / 2;
    this.add.text(cx, y - 30, label, {
      fontSize: '13px', fontFamily: 'monospace', color: '#aaccff'
    }).setOrigin(0.5);

    const gfx = this.add.graphics();
    const pctText = this.add.text(tx + width + 20, y, '', {
      fontSize: '13px', fontFamily: 'monospace', color: '#00eeff'
    }).setOrigin(0, 0.5);

    const draw = () => {
      const v = getValue();
      gfx.clear();
      gfx.fillStyle(0x002233);
      gfx.fillRect(tx, y - trackH / 2, width, trackH);
      gfx.fillStyle(0x0088ff);
      gfx.fillRect(tx, y - trackH / 2, width * v, trackH);
      gfx.fillStyle(0x00eeff);
      gfx.fillCircle(tx + width * v, y, thumbR);
      pctText.setText(Math.round(v * 100) + '%');
    };
    draw();

    const zone = this.add.zone(cx, y, width + thumbR * 2, thumbR * 2 + 12).setInteractive();
    let dragging = false;
    const applyPtr = (ptr) => { setValue(Phaser.Math.Clamp((ptr.x - tx) / width, 0, 1)); draw(); };
    zone.on('pointerdown', (ptr) => { dragging = true; applyPtr(ptr); });
    this.input.on('pointermove', (ptr) => { if (dragging) applyPtr(ptr); });
    this.input.on('pointerup', () => { dragging = false; });
  }

  _makeDiffButtons(cx, y) {
    this.add.text(cx, y - 34, 'DIFFICULTY', {
      fontSize: '13px', fontFamily: 'monospace', color: '#aaccff'
    }).setOrigin(0.5);

    const opts = [
      { key: 'easy',   label: 'EASY',   color: 0x00bb44 },
      { key: 'normal', label: 'NORMAL', color: 0x0077ff },
      { key: 'hard',   label: 'HARD',   color: 0xff4400 },
    ];
    const redraws = [];
    opts.forEach((opt, i) => {
      const bx = cx + (i - 1) * 140;
      const bg = this.add.graphics();
      const txt = this.add.text(bx, y, opt.label, {
        fontSize: '15px', fontFamily: 'monospace', color: '#ffffff'
      }).setOrigin(0.5).setInteractive({ useHandCursor: true });

      const draw = () => {
        const selected = getSettings().difficulty === opt.key;
        bg.clear();
        bg.fillStyle(selected ? opt.color : 0x112233, selected ? 0.9 : 0.8);
        bg.fillRoundedRect(bx - 52, y - 17, 104, 34, 6);
        bg.lineStyle(1.5, selected ? opt.color : 0x334455);
        bg.strokeRoundedRect(bx - 52, y - 17, 104, 34, 6);
        txt.setColor(selected ? '#ffffff' : '#556677');
      };
      draw();
      redraws.push(draw);

      txt.on('pointerdown', () => {
        const s = getSettings(); s.difficulty = opt.key; saveSettings(s);
        redraws.forEach(d => d());
      });
    });
  }
}

// ─── Phaser Config & Boot ────────────────────────────────────────────────────
// Render at native screen resolution: compute zoom so canvas ≈ screen pixels
const ZOOM = Math.max(1, Math.ceil(Math.min(
  window.screen.width  / GAME_WIDTH,
  window.screen.height / GAME_HEIGHT
)));

const config = {
  type: Phaser.AUTO,
  backgroundColor: '#000011',
  parent: 'game-container',
  antialias: true,
  antialiasGL: true,
  roundPixels: false,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: GAME_WIDTH,
    height: GAME_HEIGHT,
    zoom: ZOOM,
  },
  render: {
    antialias: true,
    antialiasGL: true,
    roundPixels: false,
    mipmapFilter: 'LINEAR_MIPMAP_LINEAR',
  },
  scene: [BootScene, SplashScene, InstructionsScene, IntroScene, GameScene, BonusScene, SettingsScene],
};
new Phaser.Game(config);
