import Phaser from 'phaser';
import { Directive, EnemyType, Mutation, BuffCard, DenyTarget, WaveLog, HabitId } from '../../contracts/directive';
import { OPENING_WAVE } from '../../director/fallbackBank';
import { WaveTelemetry, type HabitSample } from '../../telemetry/collector';
import {
  HABITS, detectHabit, judge, meterFill, VOID_REASON,
  type HabitReading, type Verdict,
} from '../habits';
import {
  Player, Enemy, Bullet, Enforcer, ENEMY_DEF, ENEMY_BULLET_SPEED, HUD_HEART_TEX, generateTextures,
  PLAYER_COLOR, ENEMY_COLOR, ELITE_COLOR,
} from '../entities';
import { canDamageEnforcer, enforcerPosition, CLOSE_RANGE_PX } from '../enforcerRule';
import { runDirective } from '../waveRunner';
import { nextMultiplier, killGain, chooseDeprivation, DEPRIVATION_WORD, MULT_START } from '../settlement';
import { browserStore, saveRun, loadRuns, recallLine, type RunRecord } from '../memory';
import {
  directionFromHotspot, directionAheadOfOrbit, warnKindFor, warnLine,
  sanitizeDirectiveForWarning, type WarnDirection, type WarnKind,
} from '../warning';
import { clearMutation, updateMutation } from '../mutations';
import { buffedSplitCount, buffedBulletSpeed, setActiveBuff } from '../buffs';
import { requestDirective } from '../../director/client';
import { runInterval } from '../../ui/interval';
import { attachDirectorLog } from '../../ui/directorLog';
import type { UpgradeId } from '../upgrades';
import { shakeOnHit, killBurst, waveClearSlowmo, dashAfterimage } from '../juice';
import { playShoot, playHit, playKill, playWaveClear, toggleMute, isMuted } from '../sound';

const STRESS_TYPES: EnemyType[] = ['chaser', 'shooter', 'splitter'];

// splitter 분열 산물 — 브리프 명시 수치(소형 hp1·크기 0.6배)
const SPLITTER_MINI_HP = 1;
const SPLITTER_MINI_SCALE = 0.6;

const HUD_DEPTH = 1000;

const FINAL_WAVE = 7;

// EndScene 전환 전 짧은 대기 — 주스(슬로모·아르페지오/흔들림·타격음)가 화면 전환에 잘려 체감되지 않는 걸 막는다
// (재량 결정, Task 9 브리프에 정확한 값 명시 없음). WIN은 waveClearSlowmo(0.5s)+아르페지오가 끝날 시간을,
// LOSE는 마지막 피격의 흔들림·사운드가 등록될 시간을 준다.
const WIN_TRANSITION_DELAY_MS = 600;
const LOSE_TRANSITION_DELAY_MS = 500;
/** 정산 표시를 읽을 시간. 기존 waveClearSlowmo(500ms)보다 길게 잡아 슬로모가 끝난 뒤에도 잠시 남는다. */
const STAMP_HOLD_MS = 1300;
/** 기억용 격자 — 텔레메트리 히트맵과 같은 8×6이라 "바로 여기"의 해상도가 사람 감각과 맞는다. */
const MEM_COLS = 8, MEM_ROWS = 6;

/** 관찰(원인)이 뜨고 예고(결과)가 붙기까지. */
const OBSERVATION_TO_WARN_MS = 1200;
/** 예고가 화면에 뜬 뒤 스폰 마커가 그려지기까지 — **아직 아무 일도 일어나지 않는 시간.** 소름의 자리다. */
const WARN_TO_MARKER_MS = 1200;
/** 마커가 먼저 그려지고 적이 나오기까지 — 말이 먼저, 그림이 나중. */
const MARKER_TO_SPAWN_MS = 600;
/** 웨이브 1에서 첫 관찰이 뜨는 시각. 습관 측정 창이 12초 단위라 이 시점에 수치가 준비돼 있다. */
const FIRST_OBSERVATION_AT_MS = 12_000;
/** 첫 관찰이 화면을 잡는 시간(전투 정지). */
const FIRST_OBSERVATION_HOLD_MS = 800;

/** Step 4 검증용 무적 치트 — devtools 콘솔에서 window.__god = true (DEV 빌드에서만 활성 — 프로덕션은 상수 false로 DCE 대상) */
function isGodMode(): boolean {
  return import.meta.env.DEV && (window as unknown as { __god?: boolean }).__god === true;
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
  /** Task 7이 소비 — 가장 최근에 완료된 웨이브의 mutation(다음 requestDirective 호출에 씀) */
  prevMutation: Mutation = 'NONE';
  /** 가장 최근에 완료된 웨이브의 buff(다음 requestDirective 호출에 씀) — 다음 디렉티브가 resolve되는 즉시(.then())
   *  그 directive.buff로 갱신된다. 웨이브 종료 시 clearMutation→clearBuff로 활성 버프 자체는 별도로 리셋된다(waveRunner.ts). */
  prevBuff: BuffCard = 'NONE';
  /** 가장 최근에 완료된 웨이브의 deny(다음 requestDirective 호출에 씀) — 다음 디렉티브가 resolve되는 즉시(.then())
   *  그 directive.deny로 갱신된다. prevBuff와 정확히 같은 패턴 — 예산에는 영향을 주지 않는다(validator.ts). */
  prevDeny: DenyTarget = 'NONE';
  /** 가장 최근에 완료된 웨이브의 핫스팟(플레이어가 가장 오래 머문 지점) — LAVA_HOTSPOT이 실제 좌표로 소비한다.
   *  텔레메트리가 다음 웨이브용으로 교체되기 직전, snapshotCurrentWaveLog에서 뽑아둔다(교체 후면 빈 그리드라 중앙이 나온다). */
  lastHotspot: { x: number; y: number } | null = null;
  /** 다음 웨이브에 걸린 예고 방향. null이면 예고 없는 웨이브(변주·카드 다양성이 살아난다). */
  private warnDir: WarnDirection | null = null;
  private warnObjects: Phaser.GameObjects.GameObject[] = [];
  /** 예고 직전에 보여줄 관찰 문장(실측 수치). 원인 없이 결과만 보면 소름이 아니라 난이도가 된다. */
  private warnObservation: string | null = null;
  /** 이 예고를 무엇으로 갚는가 — CLOSE(방면을 닫음) / CUT(도는 앞을 끊음) / BURN(선 자리를 태움). */
  private warnKind: WarnKind | null = null;
  private markerObjects: Phaser.GameObjects.GameObject[] = [];
  private firstObservationDone = false;
  /** 이번 웨이브에서 실시간 지목을 이미 띄웠는가 — 웨이브당 1회로 제한한다(도배 금지). */
  private calloutDone = false;
  /** 예고한 자리에 선 집행자. 일반 적 그룹 밖이라 웨이브 클리어 조건에 끼지 않는다. */
  private enforcer: Enforcer | null = null;
  private enforcerRing!: Phaser.GameObjects.Graphics;
  /** Task 7이 채움 — 가장 최근 디렉티브가 LLM에서 왔는지(false면 폴백) (Task 8 로그 패널 소비) */
  lastDirectiveFromLLM = false;
  /** Task 8 로그 패널이 소비 — 가장 최근에 알려진 디렉티브(오프닝 포함). 인터벌 중엔 이미 다음 웨이브 몫으로 갱신된다. */
  lastDirective: Directive = OPENING_WAVE;
  /** Task 8 인터벌에서 선택한 업그레이드 누적(런 전체) — WaveLog.upgrades로 다음 디렉티브 요청에 실린다 */
  chosenUpgrades: UpgradeId[] = [];

  private playerBullets!: Phaser.Physics.Arcade.Group;
  private enemyBullets!: Phaser.Physics.Arcade.Group;

  private playerDead = false;
  private waveClearedEmitted = false;
  private enemiesSpawned = false;
  private runEnded = false;
  private intermissionPaused = false;

  /** 현재 진행 중인 웨이브의 mutation — 웨이브 종료 시 prevMutation/mutationHistory로 이관 */
  private activeMutation: Mutation = 'NONE';
  private mutationHistory: Mutation[] = [];
  private waveStartAt = 0;
  /** telemetry.finish()의 hpLost는 damageSources(적 타입별) 합산이라 LAVA/SHRINK 같은 mutation 피해를 못 잡는다 —
   *  실제 피격 발생 횟수를 별도로 세어 WaveLog.hpLost를 보정한다. */
  private hpLostThisWave = 0;

  // ── 예측·판정 (amendment #5) — 모듈 전역이 아니라 씬 필드다. 리스타트에서 create()가 전부 초기화한다.
  /** 이번 웨이브에 걸린 예측. 웨이브 1은 관찰 라운드라 null. */
  private prediction: HabitId | null = null;
  /** 직전 라운드에 건 습관 — 같은 것을 연속으로 지목하지 않기 위해. */
  private prevHabit: HabitId | null = null;
  /** 디렉터 : 당신 */
  private score = { director: 0, player: 0 };
  /** 현재 배수. 예고를 깨면 오르고 적중당하면 내린다. */
  private multiplier = MULT_START;
  /** 런 누적 점수 — 처치마다 배수가 곱해져 즉시 오른다. */
  private runScore = 0;
  /** 직전 웨이브 명중률 — 박탈 선택의 입력(난사로 커버하는가). */
  private lastAccuracy = 0;
  /** 이 런에서 디렉터가 지목한 습관들 — 종료 시 로컬 기억에 남는다. */
  private habitsThisRun: HabitId[] = [];
  /** 이전 런들(이번 런 저장 전). 예고 비트에서 "3판째"를 말하는 데 쓴다. */
  private priorRuns: RunRecord[] = [];
  /** 직전 판정이 BROKEN이면 그 라운드 디렉터의 봉인이 무효가 된다(인터벌이 읽는다). */
  brokePrediction = false;
  private predictionText!: Phaser.GameObjects.Text;
  private predictionMeter!: Phaser.GameObjects.Graphics;
  /** 정산 표시 오브젝트 — 인터벌이 덮기 전에 걷어야 해서 참조를 들고 있는다. */
  private stampObjects: Phaser.GameObjects.GameObject[] = [];

  private waveText!: Phaser.GameObjects.Text;
  private scoreText!: Phaser.GameObjects.Text;
  private deprivationText!: Phaser.GameObjects.Text;
  private hearts: Phaser.GameObjects.Image[] = [];
  private dashGauge!: Phaser.GameObjects.Graphics;
  private muteText!: Phaser.GameObjects.Text;

  constructor() {
    super('ArenaScene');
  }

  create() {
    generateTextures(this);
    this.physics.world.setBounds(0, 0, this.scale.width, this.scale.height);
    this.drawArenaFrame();

    this.enemies = this.physics.add.group({ classType: Enemy, runChildUpdate: false });
    this.playerBullets = this.physics.add.group({ classType: Bullet, runChildUpdate: true });
    this.enemyBullets = this.physics.add.group({ classType: Bullet, runChildUpdate: true });

    this.player = new Player(this, this.scale.width / 2, this.scale.height / 2);
    this.player.onDash = () => {
      this.telemetry.recordDash();
      dashAfterimage(this, this.player, PLAYER_COLOR);
    };

    this.physics.add.overlap(this.playerBullets, this.enemies, this.handlePlayerBulletHitEnemy, undefined, this);
    this.physics.add.overlap(this.player, this.enemies, this.handleEnemyTouchPlayer, undefined, this);
    this.physics.add.overlap(this.player, this.enemyBullets, this.handleEnemyBulletHitPlayer, undefined, this);

    this.playerDead = false;
    this.runEnded = false;
    this.waveLogs = [];
    this.mutationHistory = [];
    this.prevMutation = 'NONE';
    this.prevBuff = 'NONE';
    this.prevDeny = 'NONE';
    this.lastHotspot = null;
    this.currentWave = 1;
    this.lastDirectiveFromLLM = false;
    this.lastDirective = OPENING_WAVE;
    this.chosenUpgrades = [];
    this.hearts = []; // syncHearts가 개수를 맞춰 재생성한다 — 재시작 시 이전 씬의 하트 참조를 들고 있지 않게 비워둔다
    // telemetry/hpLostThisWave는 여기서 최초 1회 생성 — 이후로는 onWaveCleared가 웨이브 종료 즉시 교체한다
    // (beginWave에서 교체하면 인터벌 창의 잔여 피해가 이미 push된 이전 로그를 오염시킨다. F1 fix 참고)
    this.telemetry = new WaveTelemetry();
    this.hpLostThisWave = 0;
    this.stampObjects = [];
    this.prediction = null;
    this.prevHabit = null;
    this.score = { director: 0, player: 0 };
    this.multiplier = MULT_START;
    this.runScore = 0;
    this.lastAccuracy = 0;
    this.habitsThisRun = [];
    this.priorRuns = loadRuns(browserStore());
    this.brokePrediction = false;
    this.warnDir = null;
    this.warnObservation = null;
    this.warnKind = null;
    this.warnObjects = [];
    this.markerObjects = [];
    this.firstObservationDone = false;
    this.calloutDone = false;
    this.enforcer = null;

    this.createHud();
    attachDirectorLog(this);

    // 리스타트 안전성: Phaser는 씬 shutdown 시 scene.events(커스텀 이벤트)를 자동으로 비우지 않는다
    // (destroy()에서만 전체 클리어됨 — InputPlugin·DisplayList 등 내장 시스템과 다르다). off 후 on으로
    // 재등록하지 않으면 R 리스타트 후 2회차부터 wave-cleared/player-died가 런당 N배로 중복 발화한다.
    this.events.off('wave-cleared', this.onWaveCleared, this);
    this.events.off('player-died', this.onPlayerDied, this);
    this.events.on('wave-cleared', this.onWaveCleared, this);
    this.events.on('player-died', this.onPlayerDied, this);

    // M 음소거 토글
    this.input.keyboard!.on('keydown-M', () => toggleMute());

    // 웨이브 루프 시작 — 웨이브 1은 항상 고정 오프닝(로그가 아직 없음). 이후는 onWaveCleared가 이어간다.
    this.beginWave(OPENING_WAVE);

    if (import.meta.env.DEV) {
      this.exposeStressSpawnHook();
      this.exposeDevQaHooks();
      this.exposeBuffDevHook();
      console.log('[ArenaScene] 무적 검증: devtools 콘솔에서 window.__god = true 실행');
    }
  }

  update(time: number, delta: number) {
    if (this.playerDead) return;
    if (this.intermissionPaused) {
      this.updateHud();
      return;
    }

    const dt = delta / 1000;
    this.telemetry.tick(
      this.player.x, this.player.y, this.scale.width, this.scale.height, dt,
      this.enemies.getChildren().filter((e) => e.active) as unknown as { x: number; y: number }[],
    );

    const fireAngles = this.player.update(time, delta, this.enemies);
    if (fireAngles.length > 0) {
      playShoot(); // 멀티샷이어도 발사 이벤트당 1회만(탄마다 겹쳐 시끄러워지지 않게)
      this.telemetry.recordManualAttack(); // 수동 발사 횟수 — 디렉터가 "쏘는 쪽인가 피하는 쪽인가"를 읽는 입력
    }
    for (const angle of fireAngles) this.spawnPlayerBullet(angle);

    this.updateEnforcer(time);
    this.maybeCallout();
    this.maybeFirstObservation();

    const enemyList = this.enemies.getChildren() as Enemy[];
    for (const enemy of enemyList) {
      if (!enemy.active) continue;
      enemy.updateBehavior(time, delta, this.player, this.fireEnemyBullet);
    }

    updateMutation(this, dt);
    if (!this.playerDead && this.player.hp <= 0) this.handlePlayerDeath();

    this.updateHud();
  }

  /** **실시간 지목** — 예고한 습관이 임계를 넘는 그 순간, 플레이어 옆에서 짚는다.
   *
   *  이것이 없으면 AI는 웨이브 사이에만 말한다. 전투 40초 동안 증거가 좌상단 작은 미터뿐이라
   *  플레이어는 싸우느라 그것을 보지 않고, 결과적으로 **감시가 아니라 사후 리포트**로 읽힌다.
   *  지목이 행동과 같은 순간·같은 자리에 뜨면 시차와 거리가 0이 되어 "지금 나를 보고 있다"가 된다.
   *
   *  웨이브당 1회로 제한한다 — 반복되면 잔소리가 되고, 한 번이라 소름이 된다. */
  private maybeCallout() {
    if (this.calloutDone || !this.prediction || this.playerDead) return;
    const def = HABITS[this.prediction];
    const r = this.currentReading();
    if (def.read(r) < def.threshold) return;
    this.calloutDone = true;

    const t = this.add.text(this.player.x, this.player.y - 44, '또 여기다', {
      fontFamily: 'monospace', fontSize: '17px', color: '#ff2d2d', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(HUD_DEPTH + 50);
    const ring = this.add.graphics().setDepth(HUD_DEPTH + 45);
    ring.lineStyle(2, 0xff2d2d, 0.9);
    ring.strokeCircle(this.player.x, this.player.y, 34);
    this.tweens.add({
      targets: [t, ring], alpha: 0, duration: 1100, delay: 500,
      onComplete: () => { t.destroy(); ring.destroy(); },
    });
  }

  /** 집행자 봉쇄 반경을 바닥에 그린다 — 안으로 들어와야 탄이 통한다는 것을 형태로 보여준다. */
  private updateEnforcer(time: number) {
    this.enforcerRing.clear();
    const e = this.enforcer;
    if (!e || !e.active) return;
    e.pulse(time);
    const inside = Phaser.Math.Distance.Between(this.player.x, this.player.y, e.x, e.y) <= CLOSE_RANGE_PX;
    this.enforcerRing.lineStyle(2, 0xff2d2d, inside ? 0.75 : 0.3);
    this.enforcerRing.strokeCircle(e.x, e.y, CLOSE_RANGE_PX);
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
    if (this.intermissionPaused) return false;
    if (isGodMode()) return false;
    const applied = this.player.takeHit(this.time.now);
    if (applied) {
      this.hpLostThisWave++;
      shakeOnHit(this);
      playHit();
    }
    return applied;
  }

  enterIntermissionPause(): void {
    if (this.intermissionPaused) return;
    this.intermissionPaused = true;
    this.physics.pause();
  }

  exitIntermissionPause(): void {
    if (!this.intermissionPaused) return;
    this.intermissionPaused = false;
    if (!this.playerDead && !this.runEnded) this.physics.resume();
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
    b.fire(x, y, angle, buffedBulletSpeed(ENEMY_BULLET_SPEED), 1, 0, false, sourceType);
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
    playKill();
    // 정산은 여기서 일어난다 — 처치 즉시, 현재 배수로. 시차 0이라야 원인과 결과가 붙는다.
    this.runScore += killGain(this.multiplier);

    const wasSplit = enemy.canSplit;
    const x = enemy.x, y = enemy.y;
    const color = enemy.elite ? ELITE_COLOR : ENEMY_COLOR;
    enemy.setActive(false).setVisible(false);
    enemy.body.enable = false;
    enemy.body.setVelocity(0, 0);
    killBurst(this, x, y, color);

    if (wasSplit) {
      // 분열 위치: 임의 축 위 균등 분배 오프셋(VOLATILE이면 3기)
      const base = Phaser.Math.FloatBetween(0, Math.PI * 2);
      const offset = ENEMY_DEF.splitter.size;
      const n = buffedSplitCount();
      for (let i = 0; i < n; i++) {
        const a = base + (Math.PI * 2 * i) / n;
        this.spawnMiniSplitter(x + Math.cos(a) * offset, y + Math.sin(a) * offset);
      }
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

  /** 새 웨이브 시작: 디렉티브 실행(스폰+mutation). create()가 오프닝에 한해 직접 호출한다.
   *  텔레메트리 교체는 여기서 하지 않는다 — onWaveCleared가 웨이브 종료 "즉시"(인터벌 시작 전) 교체해야
   *  인터벌 창의 잔여 피해·킬이 다음 웨이브 몫으로 자연 귀속된다. */
  /** 소름 5비트의 3·4번째 — 예고가 먼저, 마커가 그다음, 적이 마지막.
   *
   *  `runDirective`를 즉시 부르지 않는다. 예고가 뜬 뒤 WARN_TO_MARKER_MS 동안 **아무 일도 일어나지 않고**,
   *  그 뒤 예고한 방향에 마커가 그려지고, 다시 MARKER_TO_SPAWN_MS 뒤에야 적이 나온다. 순서가 뒤집히면
   *  (적이 먼저 나오고 설명이 붙으면) 같은 코드로도 소름이 나지 않는다.
   *
   *  `enemiesSpawned`는 이 지연 동안 false로 남아 wave-clear 판정이 보류된다(markSpawningComplete가
   *  runDirective 안에서만 호출된다) — 적 0기 상태로 웨이브가 즉시 클리어되지 않는다. */
  private beginWave(d: Directive) {
    this.waveClearedEmitted = false;
    this.calloutDone = false;
    this.enemiesSpawned = false;
    this.activeMutation = d.mutation;

    if (!this.warnDir) {
      this.waveStartAt = this.time.now;
      runDirective(this, d);
      return;
    }

    const dir = this.warnDir;
    // 2번째 비트 — 관찰(원인)이 먼저. 빠른 플레이어는 12초 중간 관찰을 못 보고 지나가므로,
    // 웨이브 사이에서 원인을 반드시 한 번 보여준다. 원인 없는 예고는 소름이 아니라 난이도다.
    this.showObservationLine(this.warnObservation);
    this.time.delayedCall(OBSERVATION_TO_WARN_MS, () => {
      if (this.playerDead || this.runEnded) return;
      this.showWarning(dir);
    });
    this.time.delayedCall(OBSERVATION_TO_WARN_MS + WARN_TO_MARKER_MS, () => {
      if (this.playerDead || this.runEnded) return;
      this.drawSpawnMarkers(dir);
      this.time.delayedCall(MARKER_TO_SPAWN_MS, () => {
        if (this.playerDead || this.runEnded) return;
        this.clearWarning();
        this.clearMarkers();
        // 웨이브 시계는 적이 실제로 나오는 순간부터 — 예고 대기 1.8초가 습관 지표를 희석하면 안 된다.
        this.waveStartAt = this.time.now;
        this.spawnEnforcer(dir);
        runDirective(this, d);
      });
    });
  }

  /** 집행자를 **내가 가장 오래 머문 바로 그 지점**에 세운다.
   *
   *  방면 계산 위치(enforcerPosition)는 폴백이다. 핫스팟이 있으면 그쪽이 훨씬 개인적이다 —
   *  "왼쪽에 세웠다"가 아니라 "네가 서 있던 자리에 세웠다"가 된다. 다만 벽에 너무 붙으면
   *  접근이 불가능해지므로 안쪽으로 클램프한다(붙어서 깨는 것이 이 적의 존재 이유다). */
  private spawnEnforcer(dir: WarnDirection) {
    this.clearEnforcer();
    const fallback = enforcerPosition(dir, this.scale.width, this.scale.height);
    const h = this.lastHotspot;
    const PAD = 90;
    const x = h ? Phaser.Math.Clamp(h.x, PAD, this.scale.width - PAD) : fallback.x;
    const y = h ? Phaser.Math.Clamp(h.y, PAD, this.scale.height - PAD) : fallback.y;
    const e = new Enforcer(this, x, y);
    this.enforcer = e;
    // 왜 하필 여기인지 한 줄로 말한다 — 좌표가 개인적일수록 "맞춤 공격"이 성립한다.
    const label = this.add.text(x, y - 46, h ? '네가 서 있던 자리다' : '여기를 막는다', {
      fontFamily: 'monospace', fontSize: '13px', color: '#ff2d2d',
    }).setOrigin(0.5).setDepth(HUD_DEPTH + 40);
    this.tweens.add({ targets: label, alpha: 0, delay: 2200, duration: 700, onComplete: () => label.destroy() });
    this.physics.add.overlap(this.playerBullets, e, this.handleBulletHitEnforcer, undefined, this);
  }

  private clearEnforcer() {
    this.enforcerRing.clear();
    this.enforcer?.destroy();
    this.enforcer = null;
  }

  /** 원거리 탄은 튕긴다 — 이 게임에서 유일하게 "다가가야 하는" 규칙. */
  private handleBulletHitEnforcer = (a: unknown, b: unknown) => {
    // ⚠ Phaser는 **스프라이트 vs 그룹** 충돌에서 콜백 인자를 (스프라이트, 그룹아이템) 순서로 넘긴다
    //   (`collideSpriteVsGroup`). 그룹을 첫 인자로 등록해도 순서가 뒤집히므로 위치로 가정하면 안 된다 —
    //   실제로 이 가정 때문에 물리 단계에서 예외가 터져 update()가 통째로 죽고 게임이 멈췄다(2026-08-10).
    const bullet = (a instanceof Bullet ? a : b) as Bullet | undefined;
    const enf = (a instanceof Enforcer ? a : b) as Enforcer | undefined;
    if (!bullet || !enf || !bullet.active || !enf.active || bullet.hit) return;
    const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, enf.x, enf.y);
    bullet.hit = true;
    bullet.hideAfterHit();
    if (!canDamageEnforcer(dist)) {
      // 튕김 — 왜 안 통하는지 형태로 알려준다(수치나 텍스트가 아니라 그림으로).
      killBurst(this, bullet.x, bullet.y, 0x5a1a1a);
      return;
    }
    if (enf.takeHit(bullet.damage)) this.onEnforcerBroken(enf);
  };

  /** 깼다 — 뺏긴 능력을 즉시 되찾고 배수가 오른다. 아레나에 끌어당기는 힘을 만드는 유일한 보상이다. */
  private onEnforcerBroken(enf: Enforcer) {
    const x = enf.x, y = enf.y;
    const recovered = this.player.deprivation;
    this.clearEnforcer();
    killBurst(this, x, y, ELITE_COLOR);
    playKill();
    this.player.deprivation = null;
    this.multiplier = Math.min(5, this.multiplier + 0.5);

    const t = this.add.text(x, y - 40, recovered ? '되찾았다' : '집행자 파괴  배수 ▲', {
      fontFamily: 'monospace', fontSize: '20px', color: '#e8e8ec', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(HUD_DEPTH + 60);
    this.tweens.add({ targets: t, y: y - 80, alpha: 0, duration: 900, onComplete: () => t.destroy() });
  }

  /** 예고 — "그래서 왼쪽을 닫는다". 이 시점에 아직 아무 일도 일어나지 않는다.
   *  HUD를 낮춰 화면을 조용하게 만든다 — 다른 요소가 계속 움직이면 이 1.2초가 정적으로 읽히지 않는다. */
  private showWarning(dir: WarnDirection) {
    const cx = this.scale.width / 2;
    const cy = this.scale.height / 2 + 16; // 관찰 줄 아래 — 원인 위에 결과가 쌓이는 배치
    const t = this.add.text(cx, cy, warnLine(this.warnKind ?? 'CLOSE', dir), {
      fontFamily: 'monospace', fontSize: '28px', color: '#ff2d2d', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(HUD_DEPTH + 60).setAlpha(0);
    this.tweens.add({ targets: t, alpha: 1, duration: 220 });
    this.warnObjects.push(t); // 관찰 줄을 지우지 않는다 — 원인과 결과가 함께 보여야 한다
  }

  /** 예고 직전의 관찰 — "한 지점 체류 82%". 수치는 habits.ts의 evidence()가 만든 실측값 그대로다. */
  private showObservationLine(line: string | null) {
    this.clearWarning();
    const cx = this.scale.width / 2;
    const cy = this.scale.height / 2 - 34;
    const objs: Phaser.GameObjects.GameObject[] = [];
    objs.push(this.add.text(cx, cy - 30, '관 찰', {
      fontFamily: 'monospace', fontSize: '14px', color: '#7a7a88', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(HUD_DEPTH + 60));
    objs.push(this.add.text(cx, cy, line ?? '너의 움직임을 기록했다', {
      fontFamily: 'monospace', fontSize: '24px', color: '#e8e8ec', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(HUD_DEPTH + 60));
    this.warnObjects = objs;
    this.setHudDimmed(true);
  }

  private clearWarning() {
    for (const o of this.warnObjects) o.destroy();
    this.warnObjects = [];
    this.setHudDimmed(false);
  }

  /** 예고한 변에 스폰 마커를 **적보다 먼저** 그린다. 말이 먼저, 그림이 나중. */
  private drawSpawnMarkers(dir: WarnDirection) {
    this.clearMarkers();
    const { width: w, height: h } = this.scale;
    const g = this.add.graphics().setDepth(HUD_DEPTH + 40);
    g.fillStyle(0xff2d2d, 0.85);
    const TICK = 26, THICK = 5, N = 7;
    for (let i = 1; i <= N; i++) {
      const f = i / (N + 1);
      if (dir === 'N') g.fillRect(w * f - TICK / 2, 0, TICK, THICK);
      else if (dir === 'S') g.fillRect(w * f - TICK / 2, h - THICK, TICK, THICK);
      else if (dir === 'W') g.fillRect(0, h * f - TICK / 2, THICK, TICK);
      else g.fillRect(w - THICK, h * f - TICK / 2, THICK, TICK);
    }
    this.tweens.add({ targets: g, alpha: { from: 0.25, to: 1 }, duration: 300, yoyo: true, repeat: 1 });
    this.markerObjects = [g];
  }

  private clearMarkers() {
    for (const o of this.markerObjects) o.destroy();
    this.markerObjects = [];
  }

  /** 예고 1.2초 동안 HUD를 낮춘다 — 정적이 소름을 만든다. */
  private setHudDimmed(on: boolean) {
    const a = on ? 0.25 : 1;
    this.waveText.setAlpha(a);
    this.predictionText.setAlpha(a);
    this.predictionMeter.setAlpha(a);
    this.dashGauge.setAlpha(a);
    this.scoreText.setAlpha(a);
    this.deprivationText.setAlpha(a);
    for (const heart of this.hearts) heart.setAlpha(a);
  }

  /** 소름 5비트의 2번째를 **웨이브 1 안으로 당긴다.**
   *
   *  관찰을 웨이브 종료에 매달면, 수동 사격 전환으로 웨이브 1이 길어진 만큼 첫 관찰이 밀린다 —
   *  못 하는 사람일수록 이 게임의 핵심을 못 보게 된다. 그래서 12초 지점에서 전투를 0.8초 멈추고
   *  화면 중앙에 첫 관찰을 띄운다(스펙 sc-first-observation: 30초 이내 보장).
   *
   *  **습관이 하나도 임계를 못 넘으면 판정 모듈은 null을 반환한다** — 잘 움직이는 플레이어에게는
   *  정상 동작이다(`habits.ts` 주석). 그런데 그대로 침묵하면 **잘 움직이는 심사자에게만 첫 비트가
   *  안 뜬다.** `docs/_hub/nodes/C-zero-is-absence.md`의 사고 그대로 — 0은 낮음이 아니라 데이터 없음이다.
   *  그래서 데이터 없음 자체를 관찰로 말한다.
   *
   *  완화 임계를 따로 두지 않는다 — 연출을 위해 임계를 낮추면 지표가 플레이어가 아니라 연출 요구를
   *  재게 된다(`C-metric-owner-check`). 판정은 기존 임계 그대로 간다. */
  private maybeFirstObservation() {
    if (this.firstObservationDone || this.currentWave !== 1) return;
    if (this.time.now - this.waveStartAt < FIRST_OBSERVATION_AT_MS) return;
    this.firstObservationDone = true;

    const reading = this.currentReading();
    const habit = detectHabit(reading, null);
    const line = habit
      ? HABITS[habit].evidence(reading)   // 실측 수치가 박힌 근거 문자열 — 새로 만들지 않고 그대로 쓴다
      : '아직 패턴을 안 만들었다';
    const tail = habit ? `"${HABITS[habit].claim}"` : '계속 보겠다';

    this.enterIntermissionPause();
    const cx = this.scale.width / 2;
    const cy = this.scale.height / 2 - 20;
    const objs: Phaser.GameObjects.GameObject[] = [];
    objs.push(this.add.text(cx, cy - 46, '관 찰', {
      fontFamily: 'monospace', fontSize: '15px', color: '#ff2d2d', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(HUD_DEPTH + 60));
    objs.push(this.add.text(cx, cy, line, {
      fontFamily: 'monospace', fontSize: '26px', color: '#e8e8ec', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(HUD_DEPTH + 60));
    objs.push(this.add.text(cx, cy + 38, tail, {
      fontFamily: 'monospace', fontSize: '15px', color: '#7a7a88',
    }).setOrigin(0.5).setDepth(HUD_DEPTH + 60));
    if (this.lastHotspot || habit) {
      const h = this.telemetry.getHotspot();
      const ring = this.add.graphics().setDepth(HUD_DEPTH + 55);
      ring.lineStyle(2, 0xff2d2d, 0.7);
      ring.strokeCircle(h.x, h.y, 46);
      objs.push(ring);
    }

    this.time.delayedCall(FIRST_OBSERVATION_HOLD_MS, () => {
      for (const o of objs) o.destroy();
      if (!this.playerDead && !this.runEnded) this.exitIntermissionPause();
    });
  }

  /** onWaveCleared·onPlayerDied가 공유하는 웨이브 로그 스냅샷. finish()가 반환하는 damageSources/combat.kills는
   *  WaveTelemetry 내부 객체의 라이브 참조라 얕은 복사로 분리해둔다(값이 전부 원시 number라 얕은 복사=완전한
   *  분리) — 그렇지 않으면 인터벌 중 recordDamage/recordKill이 이미 push된 이 로그를 사후 변조한다. */
  /** 현재 습관 지표 — 전투 중 미터와 웨이브 종료 판정이 **이 하나**를 공유한다.
   *  화면에 보이는 값과 채점되는 값이 다르면 플레이어가 예측을 반증할 방법이 없다. */
  private currentReading(): HabitReading {
    const s: HabitSample = this.telemetry.peek();
    const elapsed = Math.max((this.time.now - this.waveStartAt) / 1000, 0.001);
    // 가동률 = 실제 대시 빈도 ÷ 자기 쿨다운이 허용하는 최대 빈도. 쿨다운이 업그레이드로 줄어도
    // 같은 습관이 같은 수치로 나온다(DASH_CD_DOWN 3회면 최대치가 0.5→0.98/s로 두 배가 된다).
    const maxRate = 1000 / this.player.stats.dashCooldownMs;
    return {
      corner: s.corner,
      anchor: s.anchor,
      dashUptime: Math.min(1, this.telemetry.dashCount() / elapsed / maxRate),
      orbit: s.orbit,
      orbitSign: s.orbitSign,
      micro: s.micro,
    };
  }

  private snapshotCurrentWaveLog(wave: number): WaveLog {
    const clearTimeSec = (this.time.now - this.waveStartAt) / 1000;
    this.mutationHistory.push(this.activeMutation);
    const log = this.telemetry.finish(wave, clearTimeSec, [...this.chosenUpgrades], [...this.mutationHistory]);
    // 텔레메트리가 교체되기 전(이 함수는 동기 실행되고, onWaveCleared의 `new WaveTelemetry()` 교체는
    // 이 함수가 반환한 뒤에 일어난다) 핫스팟을 뽑아둔다 — 순서를 바꾸면 빈 그리드에서 중앙 좌표가 나온다.
    this.lastHotspot = this.telemetry.getHotspot();
    log.damageSources = { ...log.damageSources };
    log.combat = { ...log.combat, kills: { ...log.combat.kills } };
    log.hpLost = this.hpLostThisWave; // damageSources 합산 대신 실제 피격 횟수(mutation 피해 포함)로 보정

    // dominantHabit은 여기서 채운다 — collector.finish() 안이 아니다. 위 hpLost 보정이 finish() 반환
    // 뒤에 일어나므로 수집기는 최종 로그를 보지 못한다. 프롬프트가 도발에서 같은 습관을 지목하게 하는 용도.
    const reading = this.currentReading();
    log.dominantHabit = detectHabit(reading, this.prevHabit);
    this.logHabitMetrics(wave, reading, log.dominantHabit);
    return log;
  }

  /** 계측 훅 — 임계값을 눈으로 튜닝할 수 없어서 만든다. 실제 런의 분포를 보고 임계를 정한다.
   *  본문 전체를 DEV 가드로 감싼다(호출부만 가드하면 esbuild가 메서드 본문을 지우지 않는다 — 기존 F1 패턴). */
  private logHabitMetrics(wave: number, r: HabitReading, picked: HabitId | null) {
    if (!import.meta.env.DEV) return;
    const rows = (Object.keys(HABITS) as HabitId[]).map((id) => ({
      습관: id,
      값: HABITS[id].read(r).toFixed(3),
      임계: HABITS[id].threshold,
      초과율: (HABITS[id].read(r) / HABITS[id].threshold).toFixed(2),
      넘김: HABITS[id].read(r) >= HABITS[id].threshold ? 'O' : '',
    }));
    console.log(`[habits] 웨이브 ${wave} · 선택=${picked ?? '없음'} · 변주=${this.activeMutation}`);
    console.table(rows);
  }

  /** 걸려 있던 예측을 채점하고 스코어를 갱신한다. 판정된 습관을 반환(없으면 null). */
  private resolvePrediction(reading: HabitReading): { habit: HabitId; verdict: Verdict } | null {
    const habit = this.prediction;
    if (habit === null) return null;
    const verdict = judge(habit, reading, this.activeMutation);
    if (verdict === 'HIT') this.score.director++;
    else if (verdict === 'BROKEN') this.score.player++;
    // 배수는 실력이 아니라 **읽기**에 붙는다. 잘 쏴서 오르지 않는다.
    this.multiplier = nextMultiplier(this.multiplier, verdict);
    // 박탈 — 읽혔으면 **기대던 것**을 잃는다. 무엇을 뺏을지는 실측에서 고른다(항상 같은 것을 뺏으면
    // 두 판이면 예측 가능해지고, 그러면 공략이 아니라 규칙이 하나 더 있는 것이 된다).
    this.player.deprivation = chooseDeprivation(verdict, {
      dashUptime: reading.dashUptime,
      multishot: this.player.stats.multishot,
      accuracy: this.lastAccuracy,
    });
    this.brokePrediction = verdict === 'BROKEN';
    this.prediction = null;
    return { habit, verdict };
  }

  private onWaveCleared = (wave: number) => {
    const log = this.snapshotCurrentWaveLog(wave);
    this.waveLogs.push(log);
    this.lastAccuracy = log.combat.accuracy;

    // 판정은 텔레메트리 교체 **전에** 한다(아래에서 교체된다). 웨이브 7도 여기를 지나므로
    // 마지막 예측이 미판정으로 남지 않는다 — 아래 FINAL_WAVE 조기 반환보다 앞이다.
    const reading = this.currentReading();
    const resolved = this.resolvePrediction(reading);
    if (resolved) this.stampVerdict(resolved.habit, resolved.verdict, reading);
    // 다음 웨이브에 걸 예측 = 이번 웨이브의 지배 습관
    this.prediction = log.dominantHabit ?? null;
    if (this.prediction) { this.prevHabit = this.prediction; this.habitsThisRun.push(this.prediction); }

    // 예고 방향은 **엔진이 결정론으로** 정한다 — LLM이 죽어도 예고와 스폰의 인과가 유지된다(req-llm-fallback).
    // 위치 습관(한자리·한 구석)만 방향을 갖는다. 대시 습관은 방향이 없으므로 예고 없는 웨이브가 된다.
    // 습관마다 **갚는 방식이 다르다.** 물량을 늘리는 것은 습관을 읽은 결과가 아니라 시간의 결과다.
    //   위치 습관 → 머문 방면을 닫는다 · 선회 습관 → 도는 앞을 끊는다 · 미세회피 → 선 자리를 태운다
    this.warnKind = warnKindFor(this.prediction);
    const h = this.lastHotspot;
    const { width: aw, height: ah } = this.scale;
    this.warnDir = this.warnKind && h
      ? (this.warnKind === 'CUT'
          ? directionAheadOfOrbit(this.player.x, this.player.y, aw, ah, reading.orbitSign)
          : directionFromHotspot(h.x, h.y, aw, ah))
      : null;
    // 예고와 함께 보여줄 **원인**. habits.ts가 이미 만드는 근거 문자열을 그대로 쓴다(새로 만들지 않는다).
    this.warnObservation = this.warnDir && this.prediction ? HABITS[this.prediction].evidence(reading) : null;

    this.prevMutation = this.activeMutation;
    this.clearEnforcer(); // 웨이브가 끝나면 사라진다 — 무시하고 클리어하는 것이 정당한 선택이다
    clearMutation(this);
    waveClearSlowmo(this);
    playWaveClear();
    this.enterIntermissionPause();

    // 웨이브 종료 "즉시" 텔레메트리를 교체한다(다음 beginWave까지 기다리지 않음) — 인터벌 중(잔여 적탄 등)
    // 발생하는 피해·킬·이동은 방금 push한(이미 스냅샷 분리된) 로그를 건드리지 않고 다음 웨이브 로그로 쌓인다.
    this.telemetry = new WaveTelemetry();
    this.hpLostThisWave = 0;

    if (wave >= FINAL_WAVE) {
      this.runEnded = true;
      console.log('[ArenaScene] WIN');
      this.time.delayedCall(WIN_TRANSITION_DELAY_MS, () => this.endRun('WIN'));
      return;
    }

    // requestDirective는 웨이브 종료 즉시 시작(최대 4초 내 반드시 resolve). 오프라인·실패·검증 실패 시의
    // 폴백은 내부에서 처리되므로 여기서 pickFallback을 직접 호출하지 않는다.
    // 기존의 고정 2초 최소 대기(placeholder)는 인터벌 연출로 대체됐다 — 대사 타이핑 자체가 시간을 만들고
    // (디렉티브가 이미 도착한 상태에서 연출을 시작하므로), 카드 선택은 플레이어 페이스라 별도 대기가 불필요하다.
    // currentWave는 카드 선택 완료(onDone) 시점까지 갱신하지 않는다 — 그래야 인터벌 내내 좌상단 HUD와
    // 인터벌 패널의 "웨이브 N 클리어" 헤더가 같은(방금 끝난) 웨이브 번호를 가리켜 서로 어긋나지 않는다.
    const nextWave = wave + 1;
    // 정산이 읽힐 시간을 확보한다. 폴백 경로에서는 requestDirective가 즉시 resolve돼 인터벌 오버레이가
    // 스탬프를 바로 덮는데, 하필 폴백은 심사자가 가장 자주 만나는 경로다. 판정이 이 개정의 핵심이므로
    // 디렉티브와 이 유예를 함께 기다린다(LLM 경로에서는 응답 대기가 이미 이 시간을 넘겨 추가 지연이 0).
    const stampHold = new Promise<void>((res) => this.time.delayedCall(STAMP_HOLD_MS, res));
    Promise.all([
      requestDirective(log, nextWave, this.prevMutation, this.prevBuff, this.prevDeny),
      stampHold,
    ]).then(([{ directive: rawDirective, fromLLM }]) => {
      if (this.playerDead) return; // 인터벌 대기 중 잔여 적탄에 맞아 사망하는 경우 다음 웨이브를 시작하지 않는다
      this.clearStamp(); // 인터벌 오버레이와 겹치지 않게 걷는다
      this.lastDirectiveFromLLM = fromLLM;
      // 예고한 방향과 실제로 벌어지는 일을 일치시킨다 — 스폰 방향 강제 + 인과를 지우는 변주·카드 차단.
      // (FOG는 depth 500으로 예고한 쪽을 덮고, ENCIRCLE은 5.6초 만에 방향 읽기를 지운다.)
      // LLM이 무엇을 골랐든 화면의 인과가 우선이다 — 좌표·방향은 언제나 엔진 소유다.
      const directive = sanitizeDirectiveForWarning(rawDirective, this.warnDir, this.warnKind);
      this.lastDirective = directive;
      // directive.buff는 검증을 거친 최종값이라 다음 웨이브가 실제로 실행할 buff와 동일하다 — 그 웨이브가
      // 끝나 다음 requestDirective를 부를 때 "직전 buff"로 정확히 이 값을 참조하도록 미리 갱신해둔다.
      this.prevBuff = directive.buff;
      // deny도 동일 패턴 — 다음 인터벌의 pick3()가 참조할 "직전 봉인"을 여기서 미리 갱신해둔다.
      this.prevDeny = directive.deny;
      runInterval(this, directive, (picked) => {
        this.exitIntermissionPause();
        if (this.playerDead) return; // 방어적 가드: 인터벌 종료 직전 씬 상태가 바뀌면 다음 웨이브를 시작하지 않는다
        this.chosenUpgrades.push(picked);
        this.currentWave = nextWave;
        this.beginWave(directive);
      });
    });
  };

  private onPlayerDied = () => {
    if (this.runEnded) return;
    this.runEnded = true;
    // 이월 포인터(Task 9 브리프 "사망 웨이브 로그"): 사망 시점까지 진행된 웨이브는 원래 finish()가 호출되지
    // 않아 waveLogs에서 유실됐다 — partial 스냅샷을 push해 런 요약(엔드게임 리포트 입력)에 포함시킨다.
    // 단, waveClearedEmitted가 true면(인터벌 대기 중 잔여 적탄 등에 의한 사망) 그 웨이브의 로그는
    // onWaveCleared가 이미 push했으므로 여기서 또 push하면 같은 웨이브 번호가 중복된다 — beginWave가
    // 다음 웨이브 시작 시에만 이 플래그를 false로 되돌리므로, "이미 클리어된 웨이브"를 정확히 구분해준다.
    if (!this.waveClearedEmitted) {
      const log = this.snapshotCurrentWaveLog(this.currentWave);
      this.waveLogs.push(log);
      // 사망 경로에도 인터벌이 없어 걸려 있던 예측이 미판정으로 남는다 — 여기서 채점한다.
      this.resolvePrediction(this.currentReading());
      this.prevMutation = this.activeMutation;
    }
    // onWaveCleared와 대칭: 사망 시점에도 활성 mutation의 시각 리소스(그래픽스·RenderTexture)를 정리한다.
    // waveClearedEmitted가 true인 경로(인터벌 대기 중 사망)에서는 onWaveCleared가 이미 호출했으므로
    // 여기서는 no-op(state가 이미 null) — 방어적 호출이라 중복 호출도 안전하다.
    clearMutation(this);
    console.log('[ArenaScene] LOSE');
    this.time.delayedCall(LOSE_TRANSITION_DELAY_MS, () => this.endRun('LOSE'));
  };

  /** 런 종료 — EndScene으로 전환하며 리포트 조립에 필요한 원재료(웨이브 로그·업그레이드 이력)를 넘긴다.
   *  배열은 복사본을 넘긴다 — EndScene이 들고 있는 동안 이 씬의 필드가 다음 런을 위해 리셋돼도 안전하게. */
  /** 사망 지점의 격자 셀. 좌표가 아니라 셀이라 "바로 여기"가 사람 감각과 맞는다. 클리어면 null. */
  private deathCellOf(result: 'WIN' | 'LOSE'): number | null {
    if (result === 'WIN') return null;
    const cx = Math.min(MEM_COLS - 1, Math.max(0, Math.floor((this.player.x / this.scale.width) * MEM_COLS)));
    const cy = Math.min(MEM_ROWS - 1, Math.max(0, Math.floor((this.player.y / this.scale.height) * MEM_ROWS)));
    return cy * MEM_COLS + cx;
  }

  private endRun(result: 'WIN' | 'LOSE') {
    // 로컬 기억 — 개인식별정보 0. 도달 웨이브·사망 셀·지목된 습관만 남긴다.
    const cell = this.deathCellOf(result);
    const runs = saveRun(browserStore(), {
      wave: this.currentWave, deathCell: cell, habits: [...this.habitsThisRun], result,
    });
    const memory = recallLine(runs.slice(0, -1), cell, this.prevHabit); // 이번 런을 빼고 회수한다

    this.scene.start('EndScene', {
      result,
      waveLogs: [...this.waveLogs],
      upgrades: [...this.chosenUpgrades],
      verdictScore: { ...this.score },
      runScore: this.runScore,
      multiplier: this.multiplier,
      memoryLine: memory,
      runCount: runs.length,
    });
  }

  /** 수동 검증(브리프 Step 3)용 — devtools 콘솔에서 window.spawnStress(50) 실행. 본문 전체를 DEV 가드로
   *  감싼다 — 호출부만 가드하면 esbuild가 클래스 메서드 본문(문자열 포함)은 지우지 않는다(F1 fix). */
  private exposeStressSpawnHook() {
    if (import.meta.env.DEV) {
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
  }

  /** 정산 순간 — 마지막 적이 죽는 그 자리에서 찍는다. 인터벌 성적표가 아닌 이유는
   *  원인과의 시차다: 인터벌은 40초 뒤라 성적표가 되고, 여기는 0초라 정산이 된다.
   *  기존 waveClearSlowmo(0.5초) 위에 얹혀 슬로모가 그대로 연출이 된다. */
  private stampVerdict(habit: HabitId, verdict: Verdict, r: HabitReading) {
    const def = HABITS[habit];
    const cx = this.scale.width / 2;
    const cy = this.scale.height / 2 - 30;
    const hit = verdict === 'HIT';
    const word = hit ? '적중' : verdict === 'BROKEN' ? '빗나감' : '무효';
    const color = hit ? '#ff2d2d' : verdict === 'BROKEN' ? '#e8e8ec' : '#7a7a88';
    const detail = verdict === 'VOID' ? VOID_REASON : def.evidence(r);

    this.clearStamp();
    const objs: Phaser.GameObjects.GameObject[] = [];
    const add = <T extends Phaser.GameObjects.GameObject>(o: T): T => { objs.push(o); return o; };

    add(this.add.text(cx, cy - 34, `"${def.claim}"`, {
      fontFamily: 'monospace', fontSize: '15px', color: '#7a7a88',
    }).setOrigin(0.5).setDepth(HUD_DEPTH + 60));
    add(this.add.text(cx, cy + 2, word, {
      fontFamily: 'monospace', fontSize: '40px', color, fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(HUD_DEPTH + 60));
    add(this.add.text(cx, cy + 40, detail, {
      fontFamily: 'monospace', fontSize: '14px', color: '#e8e8ec',
    }).setOrigin(0.5).setDepth(HUD_DEPTH + 60));
    add(this.add.text(cx, cy + 70, `디렉터 ${this.score.director}  :  당신 ${this.score.player}`, {
      fontFamily: 'monospace', fontSize: '16px', color: '#7a7a88',
    }).setOrigin(0.5).setDepth(HUD_DEPTH + 60));
    // 정산 — 이 판정이 배수를 어디로 옮겼는지. 원인(판정)과 결과(배수)가 같은 화면에 있어야 정산이다.
    const moved = verdict === 'BROKEN' ? `배수 ×${this.multiplier.toFixed(1)}  ▲`
      : verdict === 'HIT' ? `배수 ×${this.multiplier.toFixed(1)}  ▼`
      : `배수 ×${this.multiplier.toFixed(1)}`;
    add(this.add.text(cx, cy + 98, moved, {
      fontFamily: 'monospace', fontSize: '18px',
      color: verdict === 'BROKEN' ? '#ff2d2d' : '#7a7a88', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(HUD_DEPTH + 60));
    // 박탈/보전 — 이 판정이 무엇을 가져갔는가. 강화가 아니라 박탈이라 다음 판의 선택이 실제로 달라진다.
    if (verdict !== 'VOID') {
      const taken = this.player.deprivation;
      add(this.add.text(cx, cy + 126, taken ? `${DEPRIVATION_WORD[taken]}를 가져간다` : '아무것도 빼앗기지 않았다', {
        fontFamily: 'monospace', fontSize: '16px',
        color: hit ? '#ff2d2d' : '#e8e8ec', fontStyle: 'bold',
      }).setOrigin(0.5).setDepth(HUD_DEPTH + 60));
      // 디렉터의 육성 — 내가 이겼다는 것을 **AI 입으로** 들어야 "내가 AI를 읽었다"가 닫힌다.
      // 적중 시에도 한 줄 붙여 대칭을 맞춘다(이겼을 때만 말하면 연출로 읽힌다).
      add(this.add.text(cx, cy + 154, hit ? '읽었다. 계속 본다.' : '못 읽었다. 다시 본다.', {
        fontFamily: 'monospace', fontSize: '15px', color: '#7a7a88',
      }).setOrigin(0.5).setDepth(HUD_DEPTH + 60));
    }

    this.stampObjects = objs;
  }

  /** 정산 표시를 걷는다 — 인터벌이 시작되기 직전, 그리고 다음 스탬프를 찍기 전. */
  private clearStamp() {
    for (const o of this.stampObjects) o.destroy();
    this.stampObjects = [];
  }

  /** 아레나 경계 — 실플레이로 보니 벽이 어디인지 화면에 없어서 "허공에 뜬 도형"으로 읽혔다.
   *  무대의 테두리이자 디렉터의 것이라는 표시라, 무채색 격자 위에 레드 코너 마크를 얹는다.
   *  변주(용암·축소)가 이 위에 그려지도록 깊이는 바닥(-100)에 둔다. */
  private drawArenaFrame() {
    const { width: w, height: h } = this.scale;
    const g = this.add.graphics().setDepth(-100);

    // 바닥 격자 — 이동이 눈에 잡히게 하는 참조선. 아주 어둡게 깔아 도형과 경쟁하지 않는다.
    g.lineStyle(1, 0x14141c, 1);
    for (let x = 120; x < w; x += 120) g.lineBetween(x, 0, x, h);
    for (let y = 120; y < h; y += 120) g.lineBetween(0, y, w, y);

    // 경계선
    g.lineStyle(2, 0x23232e, 1).strokeRect(1, 1, w - 2, h - 2);

    // 네 모서리의 레드 마크 — 무대가 디렉터의 것임을 상시 상기시킨다(전투 화면에 레드가 하나도 없었다)
    const L = 28;
    g.lineStyle(2, 0xff2d2d, 0.85);
    for (const [cx, cy, dx, dy] of [[1, 1, 1, 1], [w - 1, 1, -1, 1], [1, h - 1, 1, -1], [w - 1, h - 1, -1, -1]]) {
      g.lineBetween(cx, cy, cx + dx * L, cy);
      g.lineBetween(cx, cy, cx, cy + dy * L);
    }
  }

  private createHud() {
    this.waveText = this.add
      .text(16, 10, `웨이브 ${this.currentWave}`, { fontFamily: 'monospace', fontSize: '18px', color: '#e8e8ec' })
      .setDepth(HUD_DEPTH);

    this.dashGauge = this.add.graphics().setDepth(HUD_DEPTH);
    this.muteText = this.add
      .text(16, 80, '', { fontFamily: 'monospace', fontSize: '11px', color: '#3a3a46' })
      .setDepth(HUD_DEPTH);

    // 읽기 미터 — 전투 40초에 처음으로 '세어지는 수치'가 생기는 자리다.
    // 예측을 아직 반증할 수 있는 동안 보여야 의미가 있으므로 상시 표시한다.
    this.predictionText = this.add
      .text(16, 104, '', { fontFamily: 'monospace', fontSize: '12px', color: '#7a7a88' })
      .setDepth(HUD_DEPTH);
    this.predictionMeter = this.add.graphics().setDepth(HUD_DEPTH);
    // 점수·배수 — 우상단. 전투 중 계속 세어지는 유일한 수치이고, 배수는 예고를 깼는지에만 반응한다.
    this.scoreText = this.add
      .text(this.scale.width - 16, 20, '', {
        fontFamily: 'monospace', fontSize: '18px', color: '#e8e8ec', fontStyle: 'bold', align: 'right',
      })
      .setOrigin(1, 0).setDepth(HUD_DEPTH);
    // 박탈 표시 — 대시 게이지 옆. 디렉터가 가져간 것이 상시 보여야 "읽히면 잃는다"가 성립한다.
    this.enforcerRing = this.add.graphics().setDepth(-50); // 바닥 — 엔티티를 가리지 않는다
    this.deprivationText = this.add
      .text(124, 60, '', { fontFamily: 'monospace', fontSize: '12px', color: '#ff2d2d', fontStyle: 'bold' })
      .setDepth(HUD_DEPTH);
    this.syncHearts();
    this.updateHud();
  }

  private updateHud() {
    this.waveText.setText(`웨이브 ${this.currentWave}`);
    const multTxt = `×${this.multiplier.toFixed(1)}`;
    this.scoreText
      .setText(`${this.runScore.toLocaleString()}   ${multTxt}`)
      .setColor(this.multiplier > MULT_START ? '#ff2d2d' : '#e8e8ec');
    this.syncHearts();
    for (let i = 0; i < this.hearts.length; i++) {
      this.hearts[i].setAlpha(i < this.player.hp ? 1 : 0.25);
    }

    const x = 16, y = 62, w = 100, h = 6;
    this.dashGauge.clear();
    this.dashGauge.fillStyle(0x2a2a33, 1).fillRect(x, y, w, h);
    if (this.player.dashLocked) {
      // 봉인 — 게이지를 레드로 채우고 사선을 그어 "쓸 수 없다"를 형태로 보여준다.
      this.dashGauge.fillStyle(0x5a1a1a, 1).fillRect(x, y, w, h);
      this.dashGauge.lineStyle(2, 0xff2d2d, 1);
      this.dashGauge.lineBetween(x, y + h, x + w, y);
    } else {
      const frac = this.player.dashReadyFraction(this.time.now);
      this.dashGauge.fillStyle(0xe8e8ec, 1).fillRect(x, y, w * frac, h);
    }
    // 무엇을 빼앗겼는지 — 게이지만으로는 대시 외의 박탈이 화면에 안 보인다.
    const taken = this.player.deprivation;
    this.deprivationText.setText(taken ? `${DEPRIVATION_WORD[taken]} 봉인` : '').setVisible(!!taken);

    this.muteText.setText(isMuted() ? '[M] 음소거 중' : '[M] 소리 켜짐');
    this.updatePredictionMeter();
  }

  /** 걸린 예측과 그 지표를 실시간으로 그린다. 임계선을 넘으면 빨강(디렉터가 맞는 중), 아래면 흰색.
   *  플레이어가 **자기가 그 선을 밀어 넘기는 것**을 보게 하는 게 목적이다. */
  private updatePredictionMeter() {
    this.predictionMeter.clear();
    if (this.prediction === null) {
      // 웨이브 1은 관찰 라운드, 그 뒤로는 "임계를 넘긴 습관이 없다"는 뜻이다. 빈 화면으로 두지 않는다 —
      // 잘 움직이는 플레이어에게는 이것 자체가 디렉터의 진술이고(읽을 게 없다), 그렇게 둬야
      // 깨끗한 런에서도 이 메커닉이 화면에 존재한다.
      this.predictionText
        .setText(this.currentWave <= 1 ? '디렉터가 당신을 관찰하는 중' : '읽을 습관이 없다')
        .setColor('#3a3a46');
      return;
    }
    const def = HABITS[this.prediction];
    const r = this.currentReading();
    const over = def.read(r) >= def.threshold;

    this.predictionText
      .setText(`"${def.claim}"  ${def.evidence(r)}`)
      .setColor(over ? '#ff2d2d' : '#7a7a88');

    const x = 16, y = 124, w = 160, h = 6;
    this.predictionMeter.fillStyle(0x2a2a33, 1).fillRect(x, y, w, h);
    this.predictionMeter
      .fillStyle(over ? 0xff2d2d : 0xe8e8ec, 1)
      .fillRect(x, y, Math.min(w, w * (meterFill(this.prediction, r) / 1.2)), h);
    // 임계선 — 이 눈금을 넘기면 디렉터가 맞는 것이다
    this.predictionMeter.fillStyle(0xe8e8ec, 1).fillRect(x + w / 1.2 - 1, y - 2, 2, h + 4);
  }

  /** 하트 개수를 player.stats.maxHp에 맞춘다(Task 8: HP_PLUS로 최대 체력이 늘면 칸도 늘어난다).
   *  원래 5칸 고정이던 것을 동적 생성으로 교체했다(브리프 재량 사항) — 매 프레임 호출되지만
   *  길이 비교뿐이라 변화가 없을 때는 사실상 비용이 없다. */
  private syncHearts() {
    const heartY = 42;
    const max = this.player.stats.maxHp;
    while (this.hearts.length < max) {
      const i = this.hearts.length;
      this.hearts.push(this.add.image(18 + i * 22, heartY, HUD_HEART_TEX).setDepth(HUD_DEPTH));
    }
    while (this.hearts.length > max) {
      this.hearts.pop()!.destroy();
    }
  }

  /** dev QA 훅(브리프 Task 8 Step 3.5) — 원격 플레이 중 백그라운드 탭은 requestAnimationFrame이 멈춰
   *  수동 진행이 불가능하다는 게 확인돼 추가됐다. 메서드 이름은 클래스 멤버라 프로덕션 빌드에도 남지만,
   *  본문을 DEV 가드로 감싸 프로덕션에서는 빈 함수로 축소된다 — 호출부만 가드하면 esbuild가 이 안의
   *  문자열까지는 지우지 않아 본문도 함께 가드했다(F1 fix). */
  private exposeDevQaHooks() {
    if (import.meta.env.DEV) {
      const win = window as unknown as { __skipWave?: () => void };
      win.__skipWave = () => this.skipWave();
      console.log('[ArenaScene] dev QA: devtools 콘솔에서 window.__skipWave() 실행 (현재 웨이브 즉시 클리어)');
    }
  }

  /** dev 훅(강화 카드 밸런싱용, 영구 노출 — 플랜 개정 2026-08-05·브리프 Step 6) — devtools 콘솔에서
   *  window.__setBuff('TOUGH') 등으로 카드를 강제 적용한다. 디렉터가 그 카드를 실제로 고를 때까지 기다리지
   *  않고도 7종을 각각 체감할 수 있어야 하므로 "확인 후 제거"가 아니라 영구 훅으로 유지한다. 본문 전체를
   *  DEV 가드로 감싼다 — 호출부만 가드하면 esbuild가 클래스 프라이빗 메서드 본문(문자열 포함)은 지우지
   *  않아 프로덕션 번들에 남는다(exposeDevQaHooks와 동일한 F1 fix 패턴). */
  private exposeBuffDevHook() {
    if (import.meta.env.DEV) {
      const win = window as unknown as { __setBuff?: (card: BuffCard) => void };
      win.__setBuff = (card: BuffCard) => {
        // 활성 시각을 함께 넘겨야 ENCIRCLE 포위 반경이 200px에서 시작한다. 생략하면 activatedAt이 0이라
        // encircleRadius가 즉시 하한(60px)을 반환해 포위가 보이지 않는다(waveRunner와 동일한 계약).
        setActiveBuff(card, this.time.now);
        console.log('[dev] buff =', card);
      };
      console.log("[ArenaScene] 강화 카드 검증: devtools 콘솔에서 window.__setBuff('TOUGH') 실행");
    }
  }

  /** 현재 웨이브의 활성 적을 전멸 처리해 일반 킬과 동일한 경로(checkWaveClear 게이트 포함)로 wave-cleared를
   *  유도한다. SPAWN_STORM처럼 아직 스폰 중인 웨이브는 markSpawningComplete 이전이라 이 호출만으로 즉시
   *  클리어되지 않을 수 있다 — enemiesSpawned 게이트를 우회하지 않는다(재량 결정: 기존 wave-clear
   *  불변식을 QA 편의보다 우선). */
  skipWave() {
    const list = this.enemies.getChildren() as Enemy[];
    for (const e of list) {
      if (!e.active) continue;
      e.canSplit = false; // 스킵 중 분열 연쇄를 방지(QA 편의 — 재량 결정)
      this.onEnemyDeath(e);
    }
  }
}
