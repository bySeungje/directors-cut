import Phaser from 'phaser';
import { Directive, EnemyType, Mutation, WaveLog } from '../../contracts/directive';
import { OPENING_WAVE, pickFallback } from '../../director/fallbackBank';
import { WaveTelemetry } from '../../telemetry/collector';
import { Player, Enemy, Bullet, ENEMY_DEF, ENEMY_BULLET_SPEED, HUD_HEART_TEX, generateTextures } from '../entities';
import { runDirective } from '../waveRunner';
import { clearMutation, updateMutation } from '../mutations';

const STRESS_TYPES: EnemyType[] = ['chaser', 'shooter', 'splitter'];

// splitter 분열 산물 — 브리프 명시 수치(소형 hp1·크기 0.6배)
const SPLITTER_MINI_HP = 1;
const SPLITTER_MINI_SCALE = 0.6;

const HUD_DEPTH = 1000;

// Step 3: "지금은 2초 대기 placeholder" — Task 8이 대사·업그레이드 연출로 교체 예정
const INTERVAL_MS = 2000;
const FINAL_WAVE = 7;

/** Step 4 검증용 무적 치트 — devtools 콘솔에서 window.__god = true */
function isGodMode(): boolean {
  return (window as unknown as { __god?: boolean }).__god === true;
}

export class ArenaScene extends Phaser.Scene {
  player!: Player;
  enemies!: Phaser.Physics.Arcade.Group;

  /** Task 6이 wave-cleared 이후 finish()를 호출할 수 있도록 공개 */
  telemetry!: WaveTelemetry;

  /** Task 7이 디렉터 호출에 쓴다(런 전체 웨이브 로그 누적) */
  waveLogs: WaveLog[] = [];
  /** Task 7·8이 소비 — 현재 진행 중인 웨이브 번호(1-indexed) */
  currentWave = 1;
  /** Task 7이 소비 — 가장 최근에 완료된 웨이브의 mutation(다음 pickFallback 호출에 씀) */
  prevMutation: Mutation = 'NONE';

  private playerBullets!: Phaser.Physics.Arcade.Group;
  private enemyBullets!: Phaser.Physics.Arcade.Group;

  private playerDead = false;
  private waveClearedEmitted = false;
  private enemiesSpawned = false;
  private runEnded = false;

  /** 현재 진행 중인 웨이브의 mutation — 웨이브 종료 시 prevMutation/mutationHistory로 이관 */
  private activeMutation: Mutation = 'NONE';
  private mutationHistory: Mutation[] = [];
  private waveStartAt = 0;
  /** telemetry.finish()의 hpLost는 damageSources(적 타입별) 합산이라 LAVA/SHRINK 같은 mutation 피해를 못 잡는다 —
   *  실제 피격 발생 횟수를 별도로 세어 WaveLog.hpLost를 보정한다. */
  private hpLostThisWave = 0;

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
    this.player.onDash = () => this.telemetry.recordDash();

    this.physics.add.overlap(this.playerBullets, this.enemies, this.handlePlayerBulletHitEnemy, undefined, this);
    this.physics.add.overlap(this.player, this.enemies, this.handleEnemyTouchPlayer, undefined, this);
    this.physics.add.overlap(this.player, this.enemyBullets, this.handleEnemyBulletHitPlayer, undefined, this);

    this.playerDead = false;
    this.runEnded = false;
    this.waveLogs = [];
    this.mutationHistory = [];
    this.prevMutation = 'NONE';
    this.currentWave = 1;

    this.createHud();

    this.events.on('wave-cleared', this.onWaveCleared, this);
    this.events.on('player-died', this.onPlayerDied, this);

    // 웨이브 루프 시작 — 웨이브 1은 항상 고정 오프닝(로그가 아직 없음). 이후는 onWaveCleared가 이어간다.
    this.beginWave(OPENING_WAVE);

    this.exposeStressSpawnHook();
    console.log('[ArenaScene] 무적 검증: devtools 콘솔에서 window.__god = true 실행');
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

    updateMutation(this, dt);
    if (!this.playerDead && this.player.hp <= 0) this.handlePlayerDeath();

    this.updateHud();
  }

  /** waveRunner가 웨이브의 마지막 스폰 배치를 디스패치한 직후 호출 — 그 전까지는 wave-clear 판정을 보류한다. */
  markSpawningComplete() {
    this.enemiesSpawned = true;
    this.checkWaveClear();
  }

  isPlayerDead(): boolean {
    return this.playerDead;
  }

  /** 피격 적용 — window.__god=true면 무시(검증용 치트, 브리프 Step 4). 성공하면 true. */
  applyDamageToPlayer(): boolean {
    if (isGodMode()) return false;
    const applied = this.player.takeHit(this.time.now);
    if (applied) this.hpLostThisWave++;
    return applied;
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
    const applied = this.applyDamageToPlayer();
    if (applied) {
      this.telemetry.recordDamage(enemy.enemyType);
      if (this.player.hp <= 0) this.handlePlayerDeath();
    }
  };

  private handleEnemyBulletHitPlayer = (_playerObj: unknown, bulletObj: unknown) => {
    const bullet = bulletObj as Bullet;
    if (!bullet.active) return;
    const applied = this.applyDamageToPlayer();
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
      console.log('[ArenaScene] wave-cleared', { wave: this.currentWave });
      this.events.emit('wave-cleared', this.currentWave);
    }
  }

  /** 새 웨이브 시작: 텔레메트리 리셋 + 디렉티브 실행(스폰+mutation). create()가 오프닝에 한해 직접 호출한다. */
  private beginWave(d: Directive) {
    this.waveClearedEmitted = false;
    this.enemiesSpawned = false;
    this.telemetry = new WaveTelemetry();
    this.activeMutation = d.mutation;
    this.waveStartAt = this.time.now;
    this.hpLostThisWave = 0;
    runDirective(this, d);
  }

  private onWaveCleared = (wave: number) => {
    const clearTimeSec = (this.time.now - this.waveStartAt) / 1000;
    this.mutationHistory.push(this.activeMutation);
    const log = this.telemetry.finish(wave, clearTimeSec, [], [...this.mutationHistory]);
    log.hpLost = this.hpLostThisWave; // damageSources 합산 대신 실제 피격 횟수(mutation 피해 포함)로 보정
    this.waveLogs.push(log);
    this.prevMutation = this.activeMutation;
    clearMutation(this);

    if (wave >= FINAL_WAVE) {
      this.runEnded = true;
      console.log('[ArenaScene] WIN');
      return;
    }

    this.time.delayedCall(INTERVAL_MS, () => {
      if (this.playerDead) return; // 인터벌 중 잔여 적탄에 맞아 사망하는 경우 다음 웨이브를 시작하지 않는다
      this.currentWave = wave + 1;
      this.beginWave(pickFallback(this.currentWave, this.prevMutation));
    });
  };

  private onPlayerDied = () => {
    if (this.runEnded) return;
    this.runEnded = true;
    console.log('[ArenaScene] LOSE');
  };

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
      .text(16, 10, `웨이브 ${this.currentWave}`, { fontFamily: 'monospace', fontSize: '18px', color: '#e8e8ec' })
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
    this.waveText.setText(`웨이브 ${this.currentWave}`);
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
