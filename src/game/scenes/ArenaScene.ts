import Phaser from 'phaser';
import { EnemyType } from '../../contracts/directive';
import { OPENING_WAVE } from '../../director/fallbackBank';
import { WaveTelemetry } from '../../telemetry/collector';
import { Player, Enemy, Bullet, ENEMY_DEF, ENEMY_BULLET_SPEED, HUD_HEART_TEX, generateTextures } from '../entities';

const STRESS_TYPES: EnemyType[] = ['chaser', 'shooter', 'splitter'];

// splitter 분열 산물 — 브리프 명시 수치(소형 hp1·크기 0.6배)
const SPLITTER_MINI_HP = 1;
const SPLITTER_MINI_SCALE = 0.6;

const HUD_DEPTH = 1000;

export class ArenaScene extends Phaser.Scene {
  player!: Player;
  enemies!: Phaser.Physics.Arcade.Group;

  /** Task 6이 wave-cleared 이후 finish()를 호출할 수 있도록 공개 */
  telemetry!: WaveTelemetry;

  private playerBullets!: Phaser.Physics.Arcade.Group;
  private enemyBullets!: Phaser.Physics.Arcade.Group;

  private waveNumber = 1;
  private playerDead = false;
  private waveClearedEmitted = false;
  private enemiesSpawned = false;

  private waveText!: Phaser.GameObjects.Text;
  private hearts: Phaser.GameObjects.Image[] = [];
  private dashGauge!: Phaser.GameObjects.Graphics;

  constructor() {
    super('ArenaScene');
  }

  create() {
    generateTextures(this);
    this.physics.world.setBounds(0, 0, this.scale.width, this.scale.height);

    this.enemies = this.physics.add.group({ classType: Enemy, runChildUpdate: false });
    this.playerBullets = this.physics.add.group({ classType: Bullet, runChildUpdate: true });
    this.enemyBullets = this.physics.add.group({ classType: Bullet, runChildUpdate: true });

    this.player = new Player(this, this.scale.width / 2, this.scale.height / 2);
    this.telemetry = new WaveTelemetry();
    this.player.onDash = () => this.telemetry.recordDash();

    this.physics.add.overlap(this.playerBullets, this.enemies, this.handlePlayerBulletHitEnemy, undefined, this);
    this.physics.add.overlap(this.player, this.enemies, this.handleEnemyTouchPlayer, undefined, this);
    this.physics.add.overlap(this.player, this.enemyBullets, this.handleEnemyBulletHitPlayer, undefined, this);

    this.playerDead = false;
    this.waveClearedEmitted = false;
    this.enemiesSpawned = false;

    this.createHud();

    // Task 5 임시 스폰 — 실제 웨이브 실행기(스폰 패턴 해석)는 Task 6.
    this.spawnOpeningWaveTemp();
    this.exposeStressSpawnHook();
  }

  update(time: number, delta: number) {
    if (this.playerDead) return;

    const dt = delta / 1000;
    this.telemetry.tick(this.player.x, this.player.y, this.scale.width, this.scale.height, dt);

    const fireAngles = this.player.update(time, delta, this.enemies);
    for (const angle of fireAngles) this.spawnPlayerBullet(angle);

    const enemyList = this.enemies.getChildren() as Enemy[];
    for (const enemy of enemyList) {
      if (!enemy.active) continue;
      enemy.updateBehavior(time, delta, this.player, this.fireEnemyBullet);
    }

    this.updateHud();
  }

  /** Task 6·8이 소비하는 공개 스폰 API — 시그니처 고정 */
  spawnEnemy(type: EnemyType, x: number, y: number, elite: boolean): Enemy | null {
    const e = this.enemies.get() as Enemy | null;
    if (!e) return null;
    e.setPosition(x, y);
    e.spawn(type, elite);
    return e;
  }

  private spawnMiniSplitter(x: number, y: number) {
    const e = this.enemies.get() as Enemy | null;
    if (!e) return;
    e.setPosition(x, y);
    e.spawn('splitter', false, { canSplit: false, hpOverride: SPLITTER_MINI_HP, scaleOverride: SPLITTER_MINI_SCALE });
  }

  private spawnPlayerBullet(angle: number) {
    const b = this.playerBullets.get() as Bullet | null;
    if (!b) return;
    const spawnDist = 18;
    const x = this.player.x + Math.cos(angle) * spawnDist;
    const y = this.player.y + Math.sin(angle) * spawnDist;
    b.fire(x, y, angle, this.player.stats.bulletSpeed, this.player.stats.damage, this.player.stats.pierce, true);
    b.onExpire = (hit) => { if (!hit) this.telemetry.recordShot(false); };
  }

  private fireEnemyBullet = (x: number, y: number, angle: number, sourceType: EnemyType) => {
    const b = this.enemyBullets.get() as Bullet | null;
    if (!b) return;
    b.fire(x, y, angle, ENEMY_BULLET_SPEED, 1, 0, false, sourceType);
  };

  private handlePlayerBulletHitEnemy = (bulletObj: unknown, enemyObj: unknown) => {
    const bullet = bulletObj as Bullet;
    const enemy = enemyObj as Enemy;
    if (!bullet.active || !enemy.active) return;

    if (!bullet.hit) {
      bullet.hit = true;
      this.telemetry.recordShot(true);
    }

    const dead = enemy.takeDamage(bullet.damage);
    if (bullet.pierceRemaining > 0) bullet.pierceRemaining -= 1;
    else bullet.hideAfterHit();

    if (dead) this.onEnemyDeath(enemy);
  };

  private handleEnemyTouchPlayer = (_playerObj: unknown, enemyObj: unknown) => {
    const enemy = enemyObj as Enemy;
    if (!enemy.active) return;
    const applied = this.player.takeHit(this.time.now);
    if (applied) {
      this.telemetry.recordDamage(enemy.enemyType);
      if (this.player.hp <= 0) this.handlePlayerDeath();
    }
  };

  private handleEnemyBulletHitPlayer = (_playerObj: unknown, bulletObj: unknown) => {
    const bullet = bulletObj as Bullet;
    if (!bullet.active) return;
    const applied = this.player.takeHit(this.time.now);
    const sourceType = bullet.sourceType;
    bullet.hideAfterHit();
    if (applied && sourceType) {
      this.telemetry.recordDamage(sourceType);
      if (this.player.hp <= 0) this.handlePlayerDeath();
    }
  };

  private onEnemyDeath(enemy: Enemy) {
    this.telemetry.recordKill(enemy.enemyType);

    const wasSplit = enemy.canSplit;
    const x = enemy.x, y = enemy.y;
    enemy.setActive(false).setVisible(false);
    enemy.body.enable = false;
    enemy.body.setVelocity(0, 0);

    if (wasSplit) {
      // 분열 위치: 임의 축 위 대칭 오프셋(재량 결정 — 브리프에 위치 명시 없음)
      const angle = Phaser.Math.FloatBetween(0, Math.PI * 2);
      const offset = ENEMY_DEF.splitter.size;
      this.spawnMiniSplitter(x + Math.cos(angle) * offset, y + Math.sin(angle) * offset);
      this.spawnMiniSplitter(x - Math.cos(angle) * offset, y - Math.sin(angle) * offset);
    }

    this.checkWaveClear();
  }

  private handlePlayerDeath() {
    if (this.playerDead) return;
    this.playerDead = true;
    this.physics.pause();
    console.log('[ArenaScene] player-died');
    this.events.emit('player-died');
  }

  private checkWaveClear() {
    if (this.waveClearedEmitted || !this.enemiesSpawned || this.playerDead) return;
    if (this.enemies.countActive(true) === 0) {
      this.waveClearedEmitted = true;
      console.log('[ArenaScene] wave-cleared', { wave: this.waveNumber });
      this.events.emit('wave-cleared', this.waveNumber);
    }
  }

  /** Task 5 임시 구현 — RING 스폰 패턴의 근사치. 실제 스폰 패턴 해석기는 Task 6(waveRunner)이 대체한다. */
  private spawnOpeningWaveTemp() {
    const comp = OPENING_WAVE.composition[0];
    const cx = this.scale.width / 2, cy = this.scale.height / 2;
    const radius = 260;
    for (let i = 0; i < comp.count; i++) {
      const angle = (Math.PI * 2 * i) / comp.count;
      this.spawnEnemy(comp.type, cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius, comp.elite);
    }
    this.enemiesSpawned = true;
  }

  /** 수동 검증(브리프 Step 3)용 — devtools 콘솔에서 window.spawnStress(50) 실행 */
  private exposeStressSpawnHook() {
    const win = window as unknown as { spawnStress?: (n?: number) => void };
    win.spawnStress = (n = 50) => {
      for (let i = 0; i < n; i++) {
        const type = STRESS_TYPES[i % STRESS_TYPES.length];
        const x = Phaser.Math.Between(40, this.scale.width - 40);
        const y = Phaser.Math.Between(40, this.scale.height - 40);
        this.spawnEnemy(type, x, y, false);
      }
      console.log(`[ArenaScene] stress spawn +${n} (활성 적: ${this.enemies.countActive(true)})`);
    };
    console.log('[ArenaScene] perf 검증: devtools 콘솔에서 window.spawnStress(50) 실행');
  }

  private createHud() {
    this.waveText = this.add
      .text(16, 10, `웨이브 ${this.waveNumber}`, { fontFamily: 'monospace', fontSize: '18px', color: '#e8e8ec' })
      .setDepth(HUD_DEPTH);

    const heartY = 42;
    for (let i = 0; i < this.player.maxHp; i++) {
      const heart = this.add.image(18 + i * 22, heartY, HUD_HEART_TEX).setDepth(HUD_DEPTH);
      this.hearts.push(heart);
    }

    this.dashGauge = this.add.graphics().setDepth(HUD_DEPTH);
    this.updateHud();
  }

  private updateHud() {
    this.waveText.setText(`웨이브 ${this.waveNumber}`);
    for (let i = 0; i < this.hearts.length; i++) {
      this.hearts[i].setAlpha(i < this.player.hp ? 1 : 0.25);
    }

    const x = 16, y = 62, w = 100, h = 6;
    this.dashGauge.clear();
    this.dashGauge.fillStyle(0x2a2a33, 1).fillRect(x, y, w, h);
    const frac = this.player.dashReadyFraction(this.time.now);
    this.dashGauge.fillStyle(0xe8e8ec, 1).fillRect(x, y, w * frac, h);
  }
}
