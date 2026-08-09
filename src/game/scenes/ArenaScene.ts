import Phaser from 'phaser';
import { Directive, EnemyType, Mutation, BuffCard, DenyTarget, WaveLog, HabitId } from '../../contracts/directive';
import { OPENING_WAVE } from '../../director/fallbackBank';
import { WaveTelemetry, type HabitSample } from '../../telemetry/collector';
import {
  HABITS, detectHabit, judge, meterFill, VOID_REASON,
  type HabitReading, type Verdict,
} from '../habits';
import {
  Player, Enemy, Bullet, ENEMY_DEF, ENEMY_BULLET_SPEED, HUD_HEART_TEX, generateTextures, preloadEntityTextures,
  PLAYER_COLOR, ENEMY_COLOR, ELITE_COLOR,
  type EnemyBehaviorContext,
} from '../entities';
import { runDirective } from '../waveRunner';
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
const RULE_BANNER_MS = 1250;
const SPOTLIGHT_HOLD_SEC = 8;
const STAGE_DAMAGE_DPS = 0.85;
const DETECTION_BUILD_PER_SEC = 0.56;
const DETECTION_DECAY_PER_SEC = 0.38;
const CAMERA_FRAME_MARGIN_X = 120;
const CAMERA_FRAME_MARGIN_Y = 82;
const PRIORITY_TARGET_COUNT = 3;
const EXIT_ZONE_RADIUS = 26;
const WALL_HEIGHT = 14;

type StageRule = 'NONE' | 'SEARCHLIGHT' | 'SURVEILLANCE_FRAME' | 'PRIORITY_TARGETS' | 'HOTSPOT_LOCKDOWN' | 'FINAL_CORE';

interface SectorStory {
  title: string;
  objective: string;
  directorLine: string;
  rule: StageRule;
}

interface WallSpec { x: number; y: number; w: number; h: number }
interface SectorLayout {
  start: { x: number; y: number };
  exit: { x: number; y: number };
  walls: WallSpec[];
  patrols: { x: number; y: number }[][];
}

type PropKind = 'cell' | 'searchlight' | 'camera' | 'relay' | 'scorch' | 'compressor' | 'server' | 'vent' | 'pipe' | 'doorPanel';
interface PropSpec { kind: PropKind; x: number; y: number; w?: number; h?: number; r?: number }

const SECTOR_LAYOUTS: Record<number, SectorLayout> = {
  1: {
    start: { x: 92, y: 548 },
    exit: { x: 858, y: 92 },
    walls: [
      { x: 270, y: 420, w: 260, h: 28 },
      { x: 565, y: 250, w: 28, h: 260 },
      { x: 720, y: 390, w: 240, h: 28 },
    ],
    patrols: [
      [{ x: 150, y: 505 }, { x: 380, y: 505 }, { x: 380, y: 350 }],
      [{ x: 625, y: 112 }, { x: 835, y: 112 }, { x: 835, y: 325 }],
      [{ x: 130, y: 145 }, { x: 445, y: 145 }, { x: 445, y: 310 }],
    ],
  },
  2: {
    start: { x: 92, y: 92 },
    exit: { x: 866, y: 540 },
    walls: [
      { x: 260, y: 220, w: 28, h: 250 },
      { x: 454, y: 398, w: 260, h: 28 },
      { x: 688, y: 212, w: 28, h: 250 },
    ],
    patrols: [
      [{ x: 126, y: 126 }, { x: 212, y: 480 }],
      [{ x: 344, y: 120 }, { x: 610, y: 120 }, { x: 610, y: 330 }],
      [{ x: 760, y: 180 }, { x: 842, y: 502 }],
    ],
  },
  3: {
    start: { x: 92, y: 548 },
    exit: { x: 864, y: 544 },
    walls: [
      { x: 248, y: 324, w: 28, h: 360 },
      { x: 456, y: 154, w: 310, h: 28 },
      { x: 672, y: 386, w: 28, h: 300 },
      { x: 730, y: 270, w: 240, h: 28 },
    ],
    patrols: [
      [{ x: 120, y: 520 }, { x: 188, y: 146 }],
      [{ x: 338, y: 238 }, { x: 602, y: 238 }],
      [{ x: 760, y: 390 }, { x: 860, y: 530 }],
    ],
  },
  4: {
    start: { x: 480, y: 548 },
    exit: { x: 480, y: 76 },
    walls: [
      { x: 206, y: 250, w: 280, h: 28 },
      { x: 754, y: 250, w: 280, h: 28 },
      { x: 320, y: 420, w: 28, h: 190 },
      { x: 640, y: 420, w: 28, h: 190 },
    ],
    patrols: [
      [{ x: 480, y: 506 }, { x: 480, y: 332 }, { x: 222, y: 332 }],
      [{ x: 480, y: 506 }, { x: 480, y: 332 }, { x: 738, y: 332 }],
      [{ x: 212, y: 110 }, { x: 748, y: 110 }],
    ],
  },
  5: {
    start: { x: 92, y: 322 },
    exit: { x: 868, y: 320 },
    walls: [
      { x: 284, y: 142, w: 28, h: 230 },
      { x: 284, y: 506, w: 28, h: 190 },
      { x: 508, y: 322, w: 300, h: 28 },
      { x: 718, y: 142, w: 28, h: 230 },
      { x: 718, y: 506, w: 28, h: 190 },
    ],
    patrols: [
      [{ x: 122, y: 322 }, { x: 238, y: 322 }],
      [{ x: 376, y: 154 }, { x: 640, y: 154 }],
      [{ x: 376, y: 502 }, { x: 640, y: 502 }],
      [{ x: 774, y: 322 }, { x: 868, y: 322 }],
    ],
  },
  6: {
    start: { x: 92, y: 548 },
    exit: { x: 862, y: 88 },
    walls: [
      { x: 202, y: 320, w: 28, h: 430 },
      { x: 394, y: 112, w: 300, h: 28 },
      { x: 422, y: 438, w: 28, h: 260 },
      { x: 632, y: 292, w: 300, h: 28 },
      { x: 776, y: 458, w: 28, h: 210 },
    ],
    patrols: [
      [{ x: 102, y: 548 }, { x: 154, y: 112 }],
      [{ x: 280, y: 214 }, { x: 552, y: 214 }],
      [{ x: 504, y: 514 }, { x: 704, y: 514 }],
      [{ x: 838, y: 120 }, { x: 838, y: 398 }],
    ],
  },
  7: {
    start: { x: 480, y: 560 },
    exit: { x: 480, y: 76 },
    walls: [
      { x: 204, y: 232, w: 260, h: 28 },
      { x: 756, y: 232, w: 260, h: 28 },
      { x: 204, y: 426, w: 260, h: 28 },
      { x: 756, y: 426, w: 260, h: 28 },
      { x: 480, y: 322, w: 30, h: 290 },
    ],
    patrols: [
      [{ x: 480, y: 552 }, { x: 306, y: 516 }, { x: 306, y: 326 }],
      [{ x: 480, y: 552 }, { x: 654, y: 516 }, { x: 654, y: 326 }],
      [{ x: 306, y: 136 }, { x: 654, y: 136 }],
      [{ x: 142, y: 326 }, { x: 818, y: 326 }],
    ],
  },
};

const SECTOR_STORIES: Record<number, SectorStory> = {
  1: {
    title: 'BLOCK 01 · 수감동 이탈',
    objective: '경비 시야를 피해 첫 보안문까지 이동',
    directorLine: '수감자 734, 탈출 시도 확인. 시선 회피 패턴 기록을 시작한다.',
    rule: 'NONE',
  },
  2: {
    title: 'BLOCK 02 · 탐조등 구역',
    objective: `탐조등 안에서 ${SPOTLIGHT_HOLD_SEC}초 신원 교란 후 출구로 이동`,
    directorLine: '어둠 속 루트는 닫았다. 빛 안에서만 보안문이 열린다.',
    rule: 'SEARCHLIGHT',
  },
  3: {
    title: 'BLOCK 03 · 감시 프레임',
    objective: '감시 프레임 안에서 드론 시야를 피해 출구로 이동',
    directorLine: '시야 밖 탈출 루트는 폐쇄한다.',
    rule: 'SURVEILLANCE_FRAME',
  },
  4: {
    title: 'BLOCK 04 · 락다운 릴레이',
    objective: '락다운 릴레이의 붉은 감시망을 피해 보안문까지 이동',
    directorLine: '문은 열어두겠다. 대신 모든 릴레이가 너를 본다.',
    rule: 'PRIORITY_TARGETS',
  },
  5: {
    title: 'BLOCK 05 · 루트 소각',
    objective: 'DIRECTOR가 읽은 반복 동선을 버리고 다른 길로 탈출',
    directorLine: '네가 반복한 경로를 전기 바닥으로 바꿨다.',
    rule: 'HOTSPOT_LOCKDOWN',
  },
  6: {
    title: 'BLOCK 06 · 압축 수용동',
    objective: '좁아진 보안 구역에서 시야 틈을 찾아 출구로 이동',
    directorLine: '이동 가능 면적을 축소한다. 탈출 확률을 다시 계산한다.',
    rule: 'SURVEILLANCE_FRAME',
  },
  7: {
    title: 'CORE 07 · 중앙 통제실',
    objective: '중앙 감시망을 뚫고 마지막 출구로 이동',
    directorLine: '최종 봉쇄다. 네 탈출 기록은 여기서 끝난다.',
    rule: 'FINAL_CORE',
  },
};

const SECTOR_PROPS: Record<number, PropSpec[]> = {
  1: [
    { kind: 'cell', x: 128, y: 144 }, { kind: 'cell', x: 128, y: 228 },
    { kind: 'vent', x: 412, y: 500, w: 78, h: 18 },
    { kind: 'pipe', x: 650, y: 118, w: 170 },
    { kind: 'doorPanel', x: 828, y: 126 },
  ],
  2: [
    { kind: 'searchlight', x: 480, y: 320, r: 118 },
    { kind: 'pipe', x: 236, y: 548, w: 190 },
    { kind: 'camera', x: 706, y: 116, r: Math.PI / 2 },
    { kind: 'vent', x: 824, y: 486, w: 62, h: 18 },
  ],
  3: [
    { kind: 'camera', x: 322, y: 218, r: 0.35 },
    { kind: 'camera', x: 780, y: 384, r: -2.4 },
    { kind: 'doorPanel', x: 842, y: 508 },
    { kind: 'pipe', x: 120, y: 116, w: 160 },
    { kind: 'vent', x: 518, y: 516, w: 88, h: 18 },
  ],
  4: [
    { kind: 'relay', x: 222, y: 332 }, { kind: 'relay', x: 738, y: 332 },
    { kind: 'relay', x: 480, y: 112 },
    { kind: 'camera', x: 480, y: 424, r: -Math.PI / 2 },
    { kind: 'pipe', x: 360, y: 560, w: 240 },
  ],
  5: [
    { kind: 'scorch', x: 200, y: 320, w: 150, h: 50 },
    { kind: 'scorch', x: 790, y: 320, w: 130, h: 48 },
    { kind: 'doorPanel', x: 846, y: 296 },
    { kind: 'vent', x: 510, y: 454, w: 112, h: 18 },
    { kind: 'camera', x: 514, y: 190, r: Math.PI / 2 },
  ],
  6: [
    { kind: 'compressor', x: 306, y: 318, w: 78, h: 74 },
    { kind: 'compressor', x: 684, y: 318, w: 78, h: 74 },
    { kind: 'camera', x: 838, y: 118, r: Math.PI },
    { kind: 'pipe', x: 470, y: 584, w: 280 },
    { kind: 'vent', x: 118, y: 118, w: 84, h: 18 },
  ],
  7: [
    { kind: 'server', x: 306, y: 326, w: 72, h: 96 },
    { kind: 'server', x: 654, y: 326, w: 72, h: 96 },
    { kind: 'relay', x: 480, y: 138 },
    { kind: 'camera', x: 480, y: 488, r: -Math.PI / 2 },
    { kind: 'doorPanel', x: 480, y: 104 },
  ],
};

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
  /** Task 7이 채움 — 가장 최근 디렉티브가 LLM에서 왔는지(false면 폴백) (Task 8 로그 패널 소비) */
  lastDirectiveFromLLM = false;
  /** Task 8 로그 패널이 소비 — 가장 최근에 알려진 디렉티브(오프닝 포함). 인터벌 중엔 이미 다음 웨이브 몫으로 갱신된다. */
  lastDirective: Directive = OPENING_WAVE;
  /** Task 8 인터벌에서 선택한 업그레이드 누적(런 전체) — WaveLog.upgrades로 다음 디렉티브 요청에 실린다 */
  chosenUpgrades: UpgradeId[] = [];

  private playerBullets!: Phaser.Physics.Arcade.Group;
  private enemyBullets!: Phaser.Physics.Arcade.Group;
  private walls!: Phaser.Physics.Arcade.StaticGroup;

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

  // ── 예측·판정 (amendment #5) — 모듈 전역이 아니라 씬 필드다. 리스타트에서 create()가 전부 초기화한다.
  /** 이번 웨이브에 걸린 예측. 웨이브 1은 관찰 라운드라 null. */
  private prediction: HabitId | null = null;
  /** 직전 라운드에 건 습관 — 같은 것을 연속으로 지목하지 않기 위해. */
  private prevHabit: HabitId | null = null;
  /** 디렉터 : 당신 */
  private score = { director: 0, player: 0 };
  /** 직전 판정이 BROKEN이면 그 라운드 디렉터의 봉인이 무효가 된다(인터벌이 읽는다). */
  brokePrediction = false;
  private predictionText!: Phaser.GameObjects.Text;
  private predictionMeter!: Phaser.GameObjects.Graphics;
  /** 정산 표시 오브젝트 — 인터벌이 덮기 전에 걷어야 해서 참조를 들고 있는다. */
  private stampObjects: Phaser.GameObjects.GameObject[] = [];
  private stageRule: StageRule = 'NONE';
  private stageObjects: Phaser.GameObjects.GameObject[] = [];
  private wallObjects: Phaser.GameObjects.GameObject[] = [];
  private patrolAssignSeq = 0;
  private stageRuleDamageAcc = 0;
  private spotlightHoldSec = 0;
  private spotlight!: Phaser.GameObjects.Graphics;
  private spotlightCenter = new Phaser.Math.Vector2();
  private cameraFrame: Phaser.Geom.Rectangle | null = null;
  private priorityTargets = new Set<Enemy>();
  private priorityRings!: Phaser.GameObjects.Graphics;
  private visionGraphics!: Phaser.GameObjects.Graphics;
  private detectionLevel = 0;
  private exitZone: Phaser.Geom.Circle | null = null;
  private exitReached = false;
  private exitGraphics!: Phaser.GameObjects.Graphics;

  private waveText!: Phaser.GameObjects.Text;
  private storyText!: Phaser.GameObjects.Text;
  private objectiveText!: Phaser.GameObjects.Text;
  private hearts: Phaser.GameObjects.Image[] = [];
  private dashGauge!: Phaser.GameObjects.Graphics;
  private attackGauge!: Phaser.GameObjects.Graphics;
  private muteText!: Phaser.GameObjects.Text;

  constructor() {
    super('ArenaScene');
  }

  preload() {
    preloadEntityTextures(this);
  }

  create() {
    generateTextures(this);
    this.physics.world.setBounds(0, 0, this.scale.width, this.scale.height);
    this.drawArenaFrame();

    this.enemies = this.physics.add.group({ classType: Enemy, runChildUpdate: false });
    this.playerBullets = this.physics.add.group({ classType: Bullet, runChildUpdate: true });
    this.enemyBullets = this.physics.add.group({ classType: Bullet, runChildUpdate: true });
    this.walls = this.physics.add.staticGroup();
    this.visionGraphics = this.add.graphics().setDepth(-8);

    this.player = new Player(this, this.scale.width / 2, this.scale.height / 2);
    this.player.onDash = () => {
      this.telemetry.recordDash();
      dashAfterimage(this, this.player, PLAYER_COLOR);
    };

    this.physics.add.overlap(this.playerBullets, this.enemies, this.handlePlayerBulletHitEnemy, undefined, this);
    this.physics.add.overlap(this.player, this.enemies, this.handleEnemyTouchPlayer, undefined, this);
    this.physics.add.overlap(this.player, this.enemyBullets, this.handleEnemyBulletHitPlayer, undefined, this);
    this.physics.add.collider(this.player, this.walls);
    this.physics.add.collider(this.enemies, this.walls);
    this.physics.add.collider(this.playerBullets, this.walls, this.handleBulletHitWall, undefined, this);
    this.physics.add.collider(this.enemyBullets, this.walls, this.handleBulletHitWall, undefined, this);

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
    this.brokePrediction = false;
    this.stageRule = 'NONE';
    this.stageObjects = [];
    this.wallObjects = [];
    this.patrolAssignSeq = 0;
    this.stageRuleDamageAcc = 0;
    this.spotlightHoldSec = 0;
    this.detectionLevel = 0;
    this.exitZone = null;
    this.exitReached = false;
    this.cameraFrame = null;
    this.priorityTargets.clear();

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
    this.showOpeningSlate(() => this.beginWave(OPENING_WAVE));

    if (import.meta.env.DEV) {
      this.exposeStressSpawnHook();
      this.exposeDevQaHooks();
      this.exposeBuffDevHook();
      console.log('[ArenaScene] 무적 검증: devtools 콘솔에서 window.__god = true 실행');
    }
  }

  update(time: number, delta: number) {
    if (this.playerDead) return;

    const dt = delta / 1000;
    this.telemetry.tick(
      this.player.x, this.player.y, this.scale.width, this.scale.height, dt,
      this.enemies.getChildren().filter((e) => e.active) as unknown as { x: number; y: number }[],
    );

    const fireAngles = this.player.update(time, delta, this.enemies);
    if (fireAngles.length > 0) {
      playShoot(); // 멀티샷이어도 발사 이벤트당 1회만(탄마다 겹쳐 시끄러워지지 않게)
      this.telemetry.recordManualAttack();
      this.detectionLevel = Math.min(1.15, this.detectionLevel + 0.18);
      this.flashStageNote('NOISE SIGNATURE LOGGED', '#f59e0b');
    }
    for (const angle of fireAngles) this.spawnPlayerBullet(angle);

    const enemyList = this.enemies.getChildren() as Enemy[];
    const behaviorContext: EnemyBehaviorContext = {
      canSeePlayer: (enemy, range, fov) => this.enemyHasPlayerLineOfSight(enemy, range, fov),
    };
    for (const enemy of enemyList) {
      if (!enemy.active) continue;
      enemy.updateBehavior(time, delta, this.player, this.fireEnemyBullet, behaviorContext);
    }

    this.updateStealthSystems(dt);
    this.updateStageRule(dt);
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
    if (applied) {
      this.hpLostThisWave++;
      shakeOnHit(this);
      playHit();
    }
    return applied;
  }

  /** Task 6·8이 소비하는 공개 스폰 API — 시그니처 고정 */
  spawnEnemy(type: EnemyType, x: number, y: number, elite: boolean): Enemy | null {
    const e = this.enemies.get() as Enemy | null;
    if (!e) return null;
    e.setPosition(x, y);
    e.spawn(type, elite);
    e.setPatrolRoute(this.patrolRouteFor(type, x, y));
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

  private handleBulletHitWall = (bulletObj: unknown) => {
    const bullet = bulletObj as Bullet;
    if (!bullet.active) return;
    bullet.hideAfterHit();
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
    if (this.priorityTargets.delete(enemy)) this.flashStageNote('RELAY JAMMED', '#6ee7ff');

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
    const canEscape = this.exitReached;
    if (canEscape && this.stageObjectiveComplete()) {
      this.waveClearedEmitted = true;
      console.log('[ArenaScene] wave-cleared', { wave: this.currentWave });
      this.events.emit('wave-cleared', this.currentWave);
    }
  }

  /** 새 웨이브 시작: 디렉티브 실행(스폰+mutation). create()가 오프닝에 한해 직접 호출한다.
   *  텔레메트리 교체는 여기서 하지 않는다 — onWaveCleared가 웨이브 종료 "즉시"(인터벌 시작 전) 교체해야
   *  인터벌 창의 잔여 피해·킬이 다음 웨이브 몫으로 자연 귀속된다. */
  private beginWave(d: Directive) {
    this.waveClearedEmitted = false;
    this.enemiesSpawned = false;
    this.activeMutation = d.mutation;
    this.waveStartAt = this.time.now;
    runDirective(this, d);
    this.setupStageRule();
    this.showRuleBanner(d);
  }

  private sectorStory(): SectorStory {
    return SECTOR_STORIES[this.currentWave] ?? SECTOR_STORIES[FINAL_WAVE];
  }

  private setupStageRule() {
    this.clearStageRule();
    const story = this.sectorStory();
    this.stageRule = story.rule;
    this.stageRuleDamageAcc = 0;
    this.spotlightHoldSec = 0;
    this.storyText.setText(story.title);
    this.objectiveText.setText(story.objective);
    this.showSceneCard(story);
    this.setupSectorMap();
    this.setupExitZone();

    switch (this.stageRule) {
      case 'SEARCHLIGHT':
        this.setupSpotlight();
        break;
      case 'SURVEILLANCE_FRAME':
        this.setupCameraFrame(this.currentWave >= 6 ? 0.18 : 0);
        break;
      case 'PRIORITY_TARGETS':
        this.setupPriorityTargets();
        break;
      case 'HOTSPOT_LOCKDOWN':
        this.flashStageNote('DIRECTOR LOCKS YOUR ROUTE', '#ff2d2d');
        break;
      case 'FINAL_CORE':
        this.setupCameraFrame(0.16);
        this.setupPriorityTargets(true);
        break;
      case 'NONE':
        break;
    }
  }

  private clearStageRule() {
    for (const o of this.stageObjects) o.destroy();
    this.stageObjects = [];
    this.clearSectorMap();
    this.priorityTargets.clear();
    this.cameraFrame = null;
    this.stageRule = 'NONE';
    this.stageRuleDamageAcc = 0;
    this.spotlightHoldSec = 0;
    this.exitZone = null;
    this.exitReached = false;
    this.visionGraphics?.clear();
  }

  private clearSectorMap() {
    this.walls?.clear(true, true);
    for (const o of this.wallObjects) o.destroy();
    this.wallObjects = [];
  }

  private sectorLayout(): SectorLayout {
    return SECTOR_LAYOUTS[this.currentWave] ?? SECTOR_LAYOUTS[FINAL_WAVE];
  }

  private patrolRouteFor(type: EnemyType, x: number, y: number): { x: number; y: number }[] {
    const layout = this.sectorLayout();
    if (layout.patrols.length === 0) return [layout.exit];

    const preferred = type === 'shooter' ? 1 : type === 'splitter' ? 2 : 0;
    const route = layout.patrols[(this.patrolAssignSeq + preferred) % layout.patrols.length];
    this.patrolAssignSeq++;
    const start = this.nearestPassablePoint(x, y, route[0] ?? layout.start);
    return this.adaptPatrolRouteToLastRun(type, [start, ...route]);
  }

  private nearestPassablePoint(x: number, y: number, fallback: { x: number; y: number }): { x: number; y: number } {
    const clamped = {
      x: Phaser.Math.Clamp(x, 48, this.scale.width - 48),
      y: Phaser.Math.Clamp(y, 48, this.scale.height - 48),
    };
    return this.pointInsideWall(clamped.x, clamped.y) ? this.passableNear(clamped, fallback) : clamped;
  }

  private adaptPatrolRouteToLastRun(type: EnemyType, baseRoute: { x: number; y: number }[]): { x: number; y: number }[] {
    const previous = this.waveLogs[this.waveLogs.length - 1];
    if (!previous || !this.lastHotspot) return baseRoute;

    const hot = this.passableNear(this.lastHotspot, baseRoute[1] ?? baseRoute[0]);
    const quadrant = this.dominantQuadrant(previous);
    const clamp = (p: { x: number; y: number }) => this.nearestPassablePoint(p.x, p.y, hot);
    const horizontal = quadrant.endsWith('W') ? -1 : 1;
    const vertical = quadrant.startsWith('N') ? -1 : 1;
    const flankA = clamp({ x: hot.x + horizontal * 118, y: hot.y });
    const flankB = clamp({ x: hot.x, y: hot.y + vertical * 92 });

    if (type === 'shooter') {
      return [baseRoute[0], flankA, hot, flankB];
    }
    if (type === 'splitter') {
      return [baseRoute[0], hot, flankB];
    }
    if (previous.movement.wallHugRatio >= 0.42 || previous.movement.hotspotConcentration >= 0.22) {
      return [baseRoute[0], hot, flankA, ...(baseRoute.slice(1, 3))];
    }
    return [baseRoute[0], flankA, ...baseRoute.slice(1)];
  }

  private dominantQuadrant(log: WaveLog): 'NW' | 'NE' | 'SW' | 'SE' {
    const entries = Object.entries(log.movement.quadrantTime) as ['NW' | 'NE' | 'SW' | 'SE', number][];
    return entries.reduce((best, cur) => (cur[1] > best[1] ? cur : best))[0];
  }

  private passableNear(point: { x: number; y: number }, fallback: { x: number; y: number }): { x: number; y: number } {
    const offsets = [
      { x: 0, y: 0 }, { x: 42, y: 0 }, { x: -42, y: 0 }, { x: 0, y: 42 }, { x: 0, y: -42 },
      { x: 84, y: 0 }, { x: -84, y: 0 }, { x: 0, y: 84 }, { x: 0, y: -84 },
      { x: 58, y: 58 }, { x: -58, y: 58 }, { x: 58, y: -58 }, { x: -58, y: -58 },
    ];
    for (const o of offsets) {
      const p = {
        x: Phaser.Math.Clamp(point.x + o.x, 48, this.scale.width - 48),
        y: Phaser.Math.Clamp(point.y + o.y, 48, this.scale.height - 48),
      };
      if (!this.pointInsideWall(p.x, p.y)) return p;
    }
    return fallback;
  }

  private enemyHasPlayerLineOfSight(enemy: Enemy, range: number, fov: number): boolean {
    const dx = this.player.x - enemy.x;
    const dy = this.player.y - enemy.y;
    const dist = Math.hypot(dx, dy);
    if (dist > range) return false;
    const angle = Math.atan2(dy, dx);
    if (Math.abs(Phaser.Math.Angle.Wrap(angle - enemy.rotation)) > fov / 2) return false;
    return !this.segmentHitsWall(enemy.x, enemy.y, this.player.x, this.player.y);
  }

  private pointInsideWall(x: number, y: number): boolean {
    return this.sectorLayout().walls.some((wall) => this.wallRect(wall).contains(x, y));
  }

  private segmentHitsWall(x1: number, y1: number, x2: number, y2: number): boolean {
    const line = new Phaser.Geom.Line(x1, y1, x2, y2);
    return this.sectorLayout().walls.some((wall) => Phaser.Geom.Intersects.LineToRectangle(line, this.wallRect(wall)));
  }

  private rayEndBeforeWall(x: number, y: number, angle: number, range: number): { x: number; y: number } {
    const step = 12;
    let last = { x, y };
    for (let d = step; d <= range; d += step) {
      const p = { x: x + Math.cos(angle) * d, y: y + Math.sin(angle) * d };
      if (this.pointInsideWall(p.x, p.y)) return last;
      last = p;
    }
    return { x: x + Math.cos(angle) * range, y: y + Math.sin(angle) * range };
  }

  private wallRect(wall: WallSpec): Phaser.Geom.Rectangle {
    return new Phaser.Geom.Rectangle(wall.x - wall.w / 2, wall.y - wall.h / 2, wall.w, wall.h);
  }

  private setupSectorMap() {
    const layout = this.sectorLayout();
    this.player.setPosition(layout.start.x, layout.start.y);
    this.player.body.setVelocity(0, 0);
    this.drawSectorAtmosphere();
    this.drawStartPad(layout.start.x, layout.start.y);
    for (const wall of layout.walls) this.addSectorWall(wall);
    this.drawAdaptiveRouteMemory();
  }

  private drawSectorAtmosphere() {
    const props = SECTOR_PROPS[this.currentWave] ?? [];
    if (props.length === 0) return;
    const g = this.trackWallObject(this.add.graphics().setDepth(-44));
    for (const p of props) this.drawSectorProp(g, p);
  }

  private drawSectorProp(g: Phaser.GameObjects.Graphics, p: PropSpec) {
    switch (p.kind) {
      case 'cell':
        this.drawCellProp(g, p.x, p.y);
        break;
      case 'searchlight':
        this.drawSearchlightProp(g, p.x, p.y, p.r ?? 110);
        break;
      case 'camera':
        this.drawCameraProp(g, p.x, p.y, p.r ?? 0);
        break;
      case 'relay':
        this.drawRelayProp(g, p.x, p.y);
        break;
      case 'scorch':
        this.drawScorchProp(g, p.x, p.y, p.w ?? 140, p.h ?? 48);
        break;
      case 'compressor':
        this.drawCompressorProp(g, p.x, p.y, p.w ?? 80, p.h ?? 70);
        break;
      case 'server':
        this.drawServerProp(g, p.x, p.y, p.w ?? 72, p.h ?? 96);
        break;
      case 'vent':
        this.drawVentProp(g, p.x, p.y, p.w ?? 80, p.h ?? 18);
        break;
      case 'pipe':
        this.drawPipeProp(g, p.x, p.y, p.w ?? 160);
        break;
      case 'doorPanel':
        this.drawDoorPanelProp(g, p.x, p.y);
        break;
    }
  }

  private drawCellProp(g: Phaser.GameObjects.Graphics, x: number, y: number) {
    g.fillStyle(0x0a0f16, 0.78).fillRoundedRect(x - 42, y - 28, 84, 56, 3);
    g.lineStyle(1, 0x344155, 0.58).strokeRoundedRect(x - 42, y - 28, 84, 56, 3);
    g.fillStyle(0x161c27, 0.9).fillRect(x - 34, y + 8, 52, 10);
    g.lineStyle(1, 0x6ee7ff, 0.16);
    for (let i = 0; i < 5; i++) g.lineBetween(x - 28 + i * 12, y - 22, x - 28 + i * 12, y + 20);
  }

  private drawSearchlightProp(g: Phaser.GameObjects.Graphics, x: number, y: number, r: number) {
    g.fillStyle(0xe8e8ec, 0.035).fillCircle(x, y, r);
    g.lineStyle(1, 0xe8e8ec, 0.18).strokeCircle(x, y, r);
    g.fillStyle(0x111722, 0.92).fillCircle(x, y, 20);
    g.lineStyle(2, 0x6ee7ff, 0.34).strokeCircle(x, y, 24);
    g.lineStyle(1, 0xe8e8ec, 0.22).lineBetween(x - 34, y, x + 34, y).lineBetween(x, y - 34, x, y + 34);
  }

  private drawCameraProp(g: Phaser.GameObjects.Graphics, x: number, y: number, r: number) {
    const dx = Math.cos(r), dy = Math.sin(r);
    const px = -dy, py = dx;
    g.lineStyle(2, 0x344155, 0.78).lineBetween(x - dx * 22, y - dy * 22, x, y);
    g.fillStyle(0x141b26, 0.96).fillTriangle(
      x + dx * 22, y + dy * 22,
      x - dx * 10 + px * 12, y - dy * 10 + py * 12,
      x - dx * 10 - px * 12, y - dy * 10 - py * 12,
    );
    g.fillStyle(0x6ee7ff, 0.72).fillCircle(x + dx * 18, y + dy * 18, 4);
    g.lineStyle(1, 0x6ee7ff, 0.12)
      .lineBetween(x + dx * 24, y + dy * 24, x + dx * 74 + px * 24, y + dy * 74 + py * 24)
      .lineBetween(x + dx * 24, y + dy * 24, x + dx * 74 - px * 24, y + dy * 74 - py * 24);
  }

  private drawRelayProp(g: Phaser.GameObjects.Graphics, x: number, y: number) {
    g.fillStyle(0x0b0f18, 0.92).fillCircle(x, y, 22);
    g.lineStyle(2, 0xff2d2d, 0.45).strokeCircle(x, y, 26);
    g.fillStyle(0xff2d2d, 0.35).fillCircle(x, y, 7);
    g.lineStyle(1, 0xe8e8ec, 0.18)
      .lineBetween(x - 32, y, x - 10, y)
      .lineBetween(x + 10, y, x + 32, y)
      .lineBetween(x, y - 32, x, y - 10)
      .lineBetween(x, y + 10, x, y + 32);
  }

  private drawScorchProp(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number) {
    g.fillStyle(0xff2d2d, 0.08).fillEllipse(x, y, w, h);
    g.lineStyle(1, 0xff2d2d, 0.28);
    for (let i = -2; i <= 2; i++) g.lineBetween(x - w * 0.34, y + i * 8, x + w * 0.34, y + i * 8 - 18);
    g.fillStyle(0x05070b, 0.38).fillEllipse(x + 12, y + 6, w * 0.45, h * 0.48);
  }

  private drawCompressorProp(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number) {
    g.fillStyle(0x101722, 0.95).fillRoundedRect(x - w / 2, y - h / 2, w, h, 4);
    g.lineStyle(1, 0x344155, 0.7).strokeRoundedRect(x - w / 2, y - h / 2, w, h, 4);
    g.fillStyle(0x6ee7ff, 0.16).fillTriangle(x - 18, y, x - 2, y - 12, x - 2, y + 12);
    g.fillTriangle(x + 18, y, x + 2, y - 12, x + 2, y + 12);
    g.lineStyle(2, 0xe8e8ec, 0.16).lineBetween(x - w / 2 + 8, y, x + w / 2 - 8, y);
  }

  private drawServerProp(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number) {
    g.fillStyle(0x0b1018, 0.96).fillRoundedRect(x - w / 2, y - h / 2, w, h, 4);
    g.lineStyle(1, 0x344155, 0.72).strokeRoundedRect(x - w / 2, y - h / 2, w, h, 4);
    for (let i = 0; i < 5; i++) {
      const yy = y - h / 2 + 12 + i * 16;
      g.lineStyle(1, 0x6ee7ff, 0.18).lineBetween(x - w / 2 + 8, yy, x + w / 2 - 8, yy);
      g.fillStyle(i % 2 === 0 ? 0x6ee7ff : 0xff2d2d, 0.42).fillCircle(x + w / 2 - 14, yy + 5, 2);
    }
  }

  private drawVentProp(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number) {
    g.fillStyle(0x0a0f16, 0.9).fillRoundedRect(x - w / 2, y - h / 2, w, h, 3);
    g.lineStyle(1, 0x344155, 0.7).strokeRoundedRect(x - w / 2, y - h / 2, w, h, 3);
    g.lineStyle(1, 0xe8e8ec, 0.18);
    for (let i = 0; i < 6; i++) {
      const xx = x - w / 2 + 10 + i * ((w - 20) / 5);
      g.lineBetween(xx, y - h / 2 + 4, xx, y + h / 2 - 4);
    }
  }

  private drawPipeProp(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number) {
    g.lineStyle(5, 0x202938, 0.7).lineBetween(x - w / 2, y, x + w / 2, y);
    g.lineStyle(1, 0x6ee7ff, 0.13).lineBetween(x - w / 2, y - 4, x + w / 2, y - 4);
    for (let i = 0; i < 4; i++) {
      const xx = x - w / 2 + 24 + i * ((w - 48) / 3);
      g.fillStyle(0x111722, 0.95).fillRect(xx - 4, y - 9, 8, 18);
    }
  }

  private drawDoorPanelProp(g: Phaser.GameObjects.Graphics, x: number, y: number) {
    g.fillStyle(0x0b1018, 0.94).fillRoundedRect(x - 22, y - 30, 44, 60, 4);
    g.lineStyle(1, 0x6ee7ff, 0.42).strokeRoundedRect(x - 22, y - 30, 44, 60, 4);
    g.fillStyle(0x6ee7ff, 0.38).fillRect(x - 13, y - 18, 26, 5);
    g.fillStyle(0xe8e8ec, 0.28).fillCircle(x, y + 12, 5);
  }

  private drawStartPad(x: number, y: number) {
    const g = this.trackWallObject(this.add.graphics().setDepth(-42));
    g.fillStyle(0xe8e8ec, 0.045).fillCircle(x, y, 28);
    g.lineStyle(1, 0xe8e8ec, 0.28).strokeCircle(x, y, 28);
    g.lineStyle(1, 0x6ee7ff, 0.36).lineBetween(x - 16, y, x + 16, y).lineBetween(x, y - 16, x, y + 16);
  }

  private addSectorWall(wall: WallSpec) {
    const bodyRect = this.add.rectangle(wall.x, wall.y, wall.w, wall.h, 0x111722, 0.01);
    this.walls.add(bodyRect);
    const body = bodyRect.body as Phaser.Physics.Arcade.StaticBody;
    body.setSize(wall.w, wall.h);
    body.updateFromGameObject();

    const x = wall.x - wall.w / 2;
    const y = wall.y - wall.h / 2;
    const g = this.trackWallObject(this.add.graphics().setDepth(-38));
    g.fillStyle(0x05070b, 0.42).fillRect(x + 10, y + 10, wall.w, wall.h + WALL_HEIGHT);
    g.fillStyle(0x111722, 1).fillRect(x, y, wall.w, wall.h);
    g.fillStyle(0x202938, 1).fillRect(x, y - WALL_HEIGHT, wall.w, WALL_HEIGHT);
    g.fillStyle(0x0b0f18, 1).fillRect(x, y + wall.h, wall.w, WALL_HEIGHT);
    g.lineStyle(1, 0x344155, 0.72).strokeRect(x, y - WALL_HEIGHT, wall.w, wall.h + WALL_HEIGHT);
    g.lineStyle(1, 0x6ee7ff, 0.12).lineBetween(x + 8, y - WALL_HEIGHT + 4, x + wall.w - 8, y - WALL_HEIGHT + 4);
  }

  private trackWallObject<T extends Phaser.GameObjects.GameObject>(obj: T): T {
    this.wallObjects.push(obj);
    return obj;
  }

  private trackStageObject<T extends Phaser.GameObjects.GameObject>(obj: T): T {
    this.stageObjects.push(obj);
    return obj;
  }

  private drawAdaptiveRouteMemory() {
    if (!this.lastHotspot || this.waveLogs.length === 0) return;
    const p = this.passableNear(this.lastHotspot, this.sectorLayout().exit);
    const g = this.trackWallObject(this.add.graphics().setDepth(-37));
    const pulse = 0.18 + Math.sin(this.time.now / 220) * 0.05;
    g.lineStyle(1, 0xff2d2d, 0.24).strokeCircle(p.x, p.y, 52);
    g.fillStyle(0xff2d2d, pulse).fillCircle(p.x, p.y, 34);
    g.lineStyle(1, 0xe8e8ec, 0.18)
      .lineBetween(p.x - 22, p.y, p.x + 22, p.y)
      .lineBetween(p.x, p.y - 22, p.x, p.y + 22);
  }

  private setupExitZone() {
    const p = this.sectorLayout().exit;
    this.exitZone = new Phaser.Geom.Circle(p.x, p.y, EXIT_ZONE_RADIUS);
    this.exitGraphics = this.trackStageObject(this.add.graphics().setDepth(-6));
    this.drawExitZone();
  }

  private drawExitZone() {
    if (!this.exitZone || !this.exitGraphics) return;
    const pulse = 0.55 + Math.sin(this.time.now / 180) * 0.22;
    this.exitGraphics.clear();
    this.exitGraphics.fillStyle(0x6ee7ff, this.exitReached ? 0.18 : 0.09)
      .fillCircle(this.exitZone.x, this.exitZone.y, EXIT_ZONE_RADIUS);
    this.exitGraphics.lineStyle(2, this.exitReached ? 0xe8e8ec : 0x6ee7ff, this.exitReached ? 0.9 : pulse)
      .strokeCircle(this.exitZone.x, this.exitZone.y, EXIT_ZONE_RADIUS);
    this.exitGraphics.lineStyle(2, 0xe8e8ec, this.exitReached ? 0.8 : 0.42);
    this.exitGraphics.lineBetween(this.exitZone.x - 12, this.exitZone.y, this.exitZone.x + 12, this.exitZone.y);
    this.exitGraphics.lineBetween(this.exitZone.x + 6, this.exitZone.y - 7, this.exitZone.x + 14, this.exitZone.y);
    this.exitGraphics.lineBetween(this.exitZone.x + 6, this.exitZone.y + 7, this.exitZone.x + 14, this.exitZone.y);
    this.exitGraphics.fillStyle(0x0a0a0f, 0.78).fillRect(this.exitZone.x - 20, this.exitZone.y - 32, 40, 10);
    this.exitGraphics.fillStyle(0x6ee7ff, this.exitReached ? 0.95 : 0.55).fillRect(this.exitZone.x - 16, this.exitZone.y - 30, 32, 4);
  }

  private showSceneCard(story: SectorStory) {
    const x = this.scale.width / 2;
    const card = this.add.rectangle(x, 92, 700, 78, 0x0e0e15, 0.94)
      .setStrokeStyle(1, 0x343440)
      .setDepth(HUD_DEPTH + 35);
    const title = this.add.text(x, 72, story.title, {
      fontFamily: 'monospace', fontSize: '15px', color: '#e8e8ec', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(HUD_DEPTH + 36);
    const line = this.add.text(x, 98, `"${story.directorLine}"`, {
      fontFamily: 'monospace', fontSize: '12px', color: '#9a9aa8',
    }).setOrigin(0.5).setDepth(HUD_DEPTH + 36);
    this.tweens.add({
      targets: [card, title, line],
      alpha: 0,
      delay: 1850,
      duration: 280,
      onComplete: () => {
        card.destroy();
        title.destroy();
        line.destroy();
      },
    });
  }

  private setupSpotlight() {
    this.spotlightCenter.set(this.scale.width / 2, this.scale.height / 2);
    this.spotlight = this.trackStageObject(this.add.graphics().setDepth(-20));
  }

  private setupCameraFrame(shrinkRatio: number) {
    const marginX = CAMERA_FRAME_MARGIN_X + this.scale.width * shrinkRatio;
    const marginY = CAMERA_FRAME_MARGIN_Y + this.scale.height * shrinkRatio;
    this.cameraFrame = new Phaser.Geom.Rectangle(
      marginX, marginY,
      this.scale.width - marginX * 2,
      this.scale.height - marginY * 2,
    );
    const g = this.trackStageObject(this.add.graphics().setDepth(-15));
    g.fillStyle(0x000000, 0.24);
    g.fillRect(0, 0, this.scale.width, marginY);
    g.fillRect(0, this.scale.height - marginY, this.scale.width, marginY);
    g.fillRect(0, marginY, marginX, this.scale.height - marginY * 2);
    g.fillRect(this.scale.width - marginX, marginY, marginX, this.scale.height - marginY * 2);
    g.lineStyle(2, 0xe8e8ec, 0.42).strokeRect(
      this.cameraFrame.x, this.cameraFrame.y, this.cameraFrame.width, this.cameraFrame.height,
    );
    g.lineStyle(2, 0xff2d2d, 0.75);
    g.lineBetween(this.cameraFrame.x, this.cameraFrame.y, this.cameraFrame.x + 46, this.cameraFrame.y);
    g.lineBetween(this.cameraFrame.right, this.cameraFrame.bottom, this.cameraFrame.right - 46, this.cameraFrame.bottom);
  }

  private setupPriorityTargets(forceElite = false) {
    const enemies = (this.enemies.getChildren() as Enemy[]).filter((e) => e.active);
    const sorted = enemies.sort((a, b) => {
      const aScore = (a.elite ? 10 : 0) + (a.enemyType === 'shooter' ? 4 : a.enemyType === 'splitter' ? 2 : 0);
      const bScore = (b.elite ? 10 : 0) + (b.enemyType === 'shooter' ? 4 : b.enemyType === 'splitter' ? 2 : 0);
      return bScore - aScore;
    });
    const targets = sorted.slice(0, forceElite ? PRIORITY_TARGET_COUNT + 1 : PRIORITY_TARGET_COUNT);
    for (const enemy of targets) {
      this.priorityTargets.add(enemy);
      enemy.setTint(ELITE_COLOR);
    }
    this.priorityRings = this.trackStageObject(this.add.graphics().setDepth(HUD_DEPTH - 3));
  }

  private updateStageRule(dt: number) {
    switch (this.stageRule) {
      case 'SEARCHLIGHT':
        this.updateSpotlight(dt);
        break;
      case 'SURVEILLANCE_FRAME':
      case 'FINAL_CORE':
        this.tickCameraFrame(dt);
        this.drawPriorityTargetRings();
        break;
      case 'PRIORITY_TARGETS':
        this.drawPriorityTargetRings();
        break;
      case 'HOTSPOT_LOCKDOWN':
      case 'NONE':
        break;
    }
  }

  private updateStealthSystems(dt: number) {
    this.drawExitZone();
    if (this.exitZone && !this.exitReached && this.exitZone.contains(this.player.x, this.player.y)) {
      this.exitReached = true;
      this.telemetry.recordExitReached();
      this.detectionLevel = 0;
      this.flashStageNote('EXIT ROUTE OPEN', '#6ee7ff');
      this.checkWaveClear();
    }

    const seenBy = this.drawVisionCones();
    if (seenBy) {
      this.telemetry.recordVisionExposure(dt);
      this.detectionLevel = Math.min(1.35, this.detectionLevel + DETECTION_BUILD_PER_SEC * dt);
      if (this.detectionLevel >= 1) {
        this.detectionLevel = 0.62;
        const applied = this.applyDamageToPlayer();
        if (applied) this.telemetry.recordDamage(seenBy.enemyType);
      }
    } else {
      this.detectionLevel = Math.max(0, this.detectionLevel - DETECTION_DECAY_PER_SEC * dt);
    }
  }

  private drawVisionCones(): Enemy | null {
    this.visionGraphics.clear();
    let spottedBy: Enemy | null = null;
    const enemies = this.enemies.getChildren() as Enemy[];
    for (const enemy of enemies) {
      if (!enemy.active) continue;
      const spec = this.visionSpec(enemy.enemyType);
      const a = enemy.rotation;
      const left = a - spec.fov / 2;
      const right = a + spec.fov / 2;
      const seen = this.playerInVision(enemy, spec.range, spec.fov);
      if (seen) spottedBy = spottedBy ?? enemy;
      const color = seen ? 0xff2d2d : spec.color;
      const alpha = seen ? 0.23 : spec.alpha;
      const p1 = this.rayEndBeforeWall(enemy.x, enemy.y, left, spec.range);
      const p2 = this.rayEndBeforeWall(enemy.x, enemy.y, right, spec.range);
      this.visionGraphics.fillStyle(color, alpha);
      this.visionGraphics.fillTriangle(enemy.x, enemy.y, p1.x, p1.y, p2.x, p2.y);
      this.visionGraphics.lineStyle(1, color, seen ? 0.72 : 0.28);
      this.visionGraphics.lineBetween(enemy.x, enemy.y, p1.x, p1.y);
      this.visionGraphics.lineBetween(enemy.x, enemy.y, p2.x, p2.y);
    }
    return spottedBy;
  }

  private visionSpec(type: EnemyType): { range: number; fov: number; color: number; alpha: number } {
    switch (type) {
      case 'shooter':
        return { range: 250, fov: Phaser.Math.DegToRad(58), color: 0x6ee7ff, alpha: 0.11 };
      case 'splitter':
        return { range: 170, fov: Phaser.Math.DegToRad(86), color: 0xf59e0b, alpha: 0.09 };
      case 'chaser':
      default:
        return { range: 160, fov: Phaser.Math.DegToRad(74), color: 0xe8e8ec, alpha: 0.075 };
    }
  }

  private playerInVision(enemy: Enemy, range: number, fov: number): boolean {
    const dx = this.player.x - enemy.x;
    const dy = this.player.y - enemy.y;
    const dist = Math.hypot(dx, dy);
    if (dist > range) return false;
    const angle = Math.atan2(dy, dx);
    if (Math.abs(Phaser.Math.Angle.Wrap(angle - enemy.rotation)) > fov / 2) return false;
    return !this.segmentHitsWall(enemy.x, enemy.y, this.player.x, this.player.y);
  }

  private updateSpotlight(dt: number) {
    const t = this.time.now / 1000;
    const radius = 142;
    const tx = this.scale.width / 2 + Math.cos(t * 0.58) * 190;
    const ty = this.scale.height / 2 + Math.sin(t * 0.43) * 128;
    this.spotlightCenter.lerp(new Phaser.Math.Vector2(tx, ty), 0.025);

    const inside = Phaser.Math.Distance.Between(this.player.x, this.player.y, this.spotlightCenter.x, this.spotlightCenter.y) <= radius;
    if (inside) this.spotlightHoldSec = Math.min(SPOTLIGHT_HOLD_SEC, this.spotlightHoldSec + dt);
    else this.tickStageDamage(dt);
    if (this.spotlightHoldSec >= SPOTLIGHT_HOLD_SEC) this.checkWaveClear();

    this.spotlight.clear();
    this.spotlight.fillStyle(0xe8e8ec, 0.075).fillCircle(this.spotlightCenter.x, this.spotlightCenter.y, radius);
    this.spotlight.lineStyle(2, inside ? 0xe8e8ec : 0xff2d2d, inside ? 0.55 : 0.9)
      .strokeCircle(this.spotlightCenter.x, this.spotlightCenter.y, radius);
    this.spotlight.lineStyle(1, 0xe8e8ec, 0.25)
      .lineBetween(this.spotlightCenter.x - 18, this.spotlightCenter.y, this.spotlightCenter.x + 18, this.spotlightCenter.y)
      .lineBetween(this.spotlightCenter.x, this.spotlightCenter.y - 18, this.spotlightCenter.x, this.spotlightCenter.y + 18);
  }

  private tickCameraFrame(dt: number) {
    if (!this.cameraFrame) return;
    const inside = this.cameraFrame.contains(this.player.x, this.player.y);
    if (!inside) this.tickStageDamage(dt);
    else this.stageRuleDamageAcc = 0;
  }

  private tickStageDamage(dt: number) {
    this.stageRuleDamageAcc += STAGE_DAMAGE_DPS * dt;
    while (this.stageRuleDamageAcc >= 1) {
      this.stageRuleDamageAcc -= 1;
      this.applyDamageToPlayer();
    }
  }

  private drawPriorityTargetRings() {
    if (!this.priorityRings) return;
    this.priorityRings.clear();
    this.priorityTargets.forEach((enemy) => {
      if (!enemy.active) this.priorityTargets.delete(enemy);
      else {
        const pulse = 0.65 + Math.sin(this.time.now / 130) * 0.25;
        this.priorityRings.lineStyle(2, 0xff2d2d, pulse)
          .strokeCircle(enemy.x, enemy.y, Math.max(enemy.displayWidth, enemy.displayHeight) * 0.55 + 8);
        this.priorityRings.lineStyle(1, 0xe8e8ec, 0.32)
          .lineBetween(enemy.x - 18, enemy.y, enemy.x + 18, enemy.y)
          .lineBetween(enemy.x, enemy.y - 18, enemy.x, enemy.y + 18);
      }
    });
  }

  private stageObjectiveComplete(): boolean {
    if (this.stageRule === 'SEARCHLIGHT') return this.spotlightHoldSec >= SPOTLIGHT_HOLD_SEC;
    return true;
  }

  private flashStageNote(text: string, color: string) {
    const note = this.add.text(this.scale.width / 2, this.scale.height / 2 + 116, text, {
      fontFamily: 'monospace', fontSize: '16px', color, fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(HUD_DEPTH + 50);
    this.tweens.add({
      targets: note,
      alpha: 0,
      y: note.y - 18,
      delay: 420,
      duration: 500,
      onComplete: () => note.destroy(),
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
    this.brokePrediction = verdict === 'BROKEN';
    this.prediction = null;
    return { habit, verdict };
  }

  private onWaveCleared = (wave: number) => {
    const log = this.snapshotCurrentWaveLog(wave);
    this.waveLogs.push(log);

    // 판정은 텔레메트리 교체 **전에** 한다(아래에서 교체된다). 웨이브 7도 여기를 지나므로
    // 마지막 예측이 미판정으로 남지 않는다 — 아래 FINAL_WAVE 조기 반환보다 앞이다.
    const reading = this.currentReading();
    const resolved = this.resolvePrediction(reading);
    if (resolved) this.stampVerdict(resolved.habit, resolved.verdict, reading);
    // 다음 웨이브에 걸 예측 = 이번 웨이브의 지배 습관
    this.prediction = log.dominantHabit ?? null;
    if (this.prediction) this.prevHabit = this.prediction;

    this.prevMutation = this.activeMutation;
    this.clearStageRule();
    clearMutation(this);
    waveClearSlowmo(this);
    playWaveClear();

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
    ]).then(([{ directive, fromLLM }]) => {
      if (this.playerDead) return; // 인터벌 대기 중 잔여 적탄에 맞아 사망하는 경우 다음 웨이브를 시작하지 않는다
      this.clearStamp(); // 인터벌 오버레이와 겹치지 않게 걷는다
      this.lastDirectiveFromLLM = fromLLM;
      this.lastDirective = directive;
      // directive.buff는 검증을 거친 최종값이라 다음 웨이브가 실제로 실행할 buff와 동일하다 — 그 웨이브가
      // 끝나 다음 requestDirective를 부를 때 "직전 buff"로 정확히 이 값을 참조하도록 미리 갱신해둔다.
      this.prevBuff = directive.buff;
      // deny도 동일 패턴 — 다음 인터벌의 pick3()가 참조할 "직전 봉인"을 여기서 미리 갱신해둔다.
      this.prevDeny = directive.deny;
      runInterval(this, directive, (picked) => {
        if (this.playerDead) return; // 대사·카드 선택 중에도 잔여 피해로 사망할 수 있어 onDone에도 동일 가드
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
    this.clearStageRule();
    console.log('[ArenaScene] LOSE');
    this.time.delayedCall(LOSE_TRANSITION_DELAY_MS, () => this.endRun('LOSE'));
  };

  /** 런 종료 — EndScene으로 전환하며 리포트 조립에 필요한 원재료(웨이브 로그·업그레이드 이력)를 넘긴다.
   *  배열은 복사본을 넘긴다 — EndScene이 들고 있는 동안 이 씬의 필드가 다음 런을 위해 리셋돼도 안전하게. */
  private endRun(result: 'WIN' | 'LOSE') {
    this.scene.start('EndScene', {
      result,
      waveLogs: [...this.waveLogs],
      upgrades: [...this.chosenUpgrades],
      verdictScore: { ...this.score },
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
    add(this.add.text(cx, cy + 70, `DIRECTOR ${this.score.director}  :  탈옥자 ${this.score.player}`, {
      fontFamily: 'monospace', fontSize: '16px', color: '#7a7a88',
    }).setOrigin(0.5).setDepth(HUD_DEPTH + 60));

    this.stampObjects = objs;
  }

  /** 정산 표시를 걷는다 — 인터벌이 시작되기 직전, 그리고 다음 스탬프를 찍기 전. */
  private clearStamp() {
    for (const o of this.stampObjects) o.destroy();
    this.stampObjects = [];
  }

  /** 아레나 경계 — 실플레이로 보니 벽이 어디인지 화면에 없어서 "허공에 뜬 도형"으로 읽혔다.
   *  감옥 구역의 테두리이자 DIRECTOR가 재편집하는 보안 경계다.
   *  변주(용암·축소)가 이 위에 그려지도록 깊이는 바닥(-100)에 둔다. */
  private drawArenaFrame() {
    const { width: w, height: h } = this.scale;
    const g = this.add.graphics().setDepth(-100);

    // 사선 보안 시설 바닥 격자 — 2.5D 공간감을 주는 참조선.
    g.fillGradientStyle(0x0b1018, 0x0b1018, 0x080910, 0x080910, 1, 1, 1, 1);
    g.fillRect(0, 0, w, h);
    g.lineStyle(1, 0x14141c, 1);
    for (let x = 120; x < w; x += 120) g.lineBetween(x, 0, x, h);
    for (let y = 120; y < h; y += 120) g.lineBetween(0, y, w, y);
    g.lineStyle(1, 0x1b2d3a, 0.45);
    for (let x = 60; x < w; x += 240) g.lineBetween(x, 0, x, h);
    for (let y = 60; y < h; y += 240) g.lineBetween(0, y, w, y);
    g.lineStyle(1, 0x223144, 0.32);
    for (let x = -h; x < w; x += 120) g.lineBetween(x, h, x + h, 0);
    g.lineStyle(1, 0x0f2631, 0.28);
    for (let x = 0; x < w + h; x += 180) g.lineBetween(x, 0, x - h, h);

    // 경계선
    g.lineStyle(2, 0x23232e, 1).strokeRect(1, 1, w - 2, h - 2);

    // 네 모서리의 레드 마크 — 이 구역이 DIRECTOR의 봉쇄 영역임을 상시 상기시킨다.
    const L = 28;
    g.lineStyle(2, 0xff2d2d, 0.85);
    for (const [cx, cy, dx, dy] of [[1, 1, 1, 1], [w - 1, 1, -1, 1], [1, h - 1, 1, -1], [w - 1, h - 1, -1, -1]]) {
      g.lineBetween(cx, cy, cx + dx * L, cy);
      g.lineBetween(cx, cy, cx, cy + dy * L);
    }

    this.add.text(w - 22, 14, 'LOCKDOWN', {
      fontFamily: 'monospace', fontSize: '13px', color: '#ff2d2d', fontStyle: 'bold',
    }).setOrigin(1, 0).setDepth(HUD_DEPTH);
    this.add.text(w - 22, 34, 'DIRECTOR WARDEN / BLOCK MAP', {
      fontFamily: 'monospace', fontSize: '10px', color: '#7a7a88',
    }).setOrigin(1, 0).setDepth(HUD_DEPTH);
  }

  private createHud() {
    this.waveText = this.add
      .text(16, 10, `SECTOR ${this.currentWave}`, { fontFamily: 'monospace', fontSize: '18px', color: '#e8e8ec', fontStyle: 'bold' })
      .setDepth(HUD_DEPTH);
    this.storyText = this.add
      .text(16, 138, '', { fontFamily: 'monospace', fontSize: '12px', color: '#e8e8ec', fontStyle: 'bold' })
      .setDepth(HUD_DEPTH);
    this.objectiveText = this.add
      .text(16, 156, '', { fontFamily: 'monospace', fontSize: '11px', color: '#7a7a88' })
      .setDepth(HUD_DEPTH);

    this.dashGauge = this.add.graphics().setDepth(HUD_DEPTH);
    this.attackGauge = this.add.graphics().setDepth(HUD_DEPTH);
    this.muteText = this.add
      .text(16, 80, '', { fontFamily: 'monospace', fontSize: '11px', color: '#3a3a46' })
      .setDepth(HUD_DEPTH);

    // 읽기 미터 — 전투 40초에 처음으로 '세어지는 수치'가 생기는 자리다.
    // 예측을 아직 반증할 수 있는 동안 보여야 의미가 있으므로 상시 표시한다.
    this.predictionText = this.add
      .text(16, 104, '', { fontFamily: 'monospace', fontSize: '12px', color: '#7a7a88' })
      .setDepth(HUD_DEPTH);
    this.predictionMeter = this.add.graphics().setDepth(HUD_DEPTH);
    this.syncHearts();
    this.updateHud();
  }

  private updateHud() {
    this.waveText.setText(`SECTOR ${this.currentWave}/${FINAL_WAVE}`);
    this.syncHearts();
    for (let i = 0; i < this.hearts.length; i++) {
      this.hearts[i].setAlpha(i < this.player.hp ? 1 : 0.25);
    }

    const x = 16, y = 62, w = 100, h = 6;
    this.dashGauge.clear();
    this.dashGauge.fillStyle(0x2a2a33, 1).fillRect(x, y, w, h);
    const frac = this.player.dashReadyFraction(this.time.now);
    this.dashGauge.fillStyle(0xe8e8ec, 1).fillRect(x, y, w * frac, h);

    this.attackGauge.clear();
    this.attackGauge.fillStyle(0x2a2a33, 1).fillRect(x, y + 10, w, h);
    const disruptFrac = this.player.disruptReadyFraction(this.time.now);
    this.attackGauge.fillStyle(0xf59e0b, 0.92).fillRect(x, y + 10, w * disruptFrac, h);

    this.muteText.setText(isMuted() ? '[M] 음소거 중 · [E/J] 교란' : '[M] 소리 켜짐 · [E/J] 교란');
    this.updateObjectiveText();
    this.updatePredictionMeter();
  }

  private updateObjectiveText() {
    const story = this.sectorStory();
    const exit = this.exitReached ? '출구 확보' : '출구로 이동';
    const detection = this.detectionLevel > 0.02 ? ` · 발각 ${(this.detectionLevel * 100).toFixed(0)}%` : '';
    if (this.stageRule === 'SEARCHLIGHT') {
      this.objectiveText.setText(`${story.objective}  ·  탐조등 ${this.spotlightHoldSec.toFixed(1)}/${SPOTLIGHT_HOLD_SEC}s  ·  ${exit}${detection}`);
      this.objectiveText.setColor(this.spotlightHoldSec >= SPOTLIGHT_HOLD_SEC ? '#e8e8ec' : '#9a9aa8');
      return;
    }
    if (this.stageRule === 'PRIORITY_TARGETS' || this.stageRule === 'FINAL_CORE') {
      const alive = [...this.priorityTargets].filter((e) => e.active).length;
      this.objectiveText.setText(`${story.objective}  ·  감시 릴레이 ${alive}  ·  ${exit}${detection}`);
      this.objectiveText.setColor(alive === 0 ? '#e8e8ec' : '#ff2d2d');
      return;
    }
    this.objectiveText.setText(`${story.objective}  ·  ${exit}${detection}`);
    this.objectiveText.setColor('#7a7a88');
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
        .setText(this.currentWave <= 1 ? 'DIRECTOR가 탈출 루트를 관찰하는 중' : '이번 구역에서 읽을 습관이 없다')
        .setColor('#3a3a46');
      return;
    }
    const def = HABITS[this.prediction];
    const r = this.currentReading();
    const over = def.read(r) >= def.threshold;

    this.predictionText
      .setText(`DIRECTOR 지시: "${def.claim}"  ${def.evidence(r)}`)
      .setColor(over ? '#ff2d2d' : '#7a7a88');

    const x = 16, y = 124, w = 160, h = 6;
    this.predictionMeter.fillStyle(0x2a2a33, 1).fillRect(x, y, w, h);
    this.predictionMeter
      .fillStyle(over ? 0xff2d2d : 0xe8e8ec, 1)
      .fillRect(x, y, Math.min(w, w * (meterFill(this.prediction, r) / 1.2)), h);
    // 임계선 — 이 눈금을 넘기면 디렉터가 맞는 것이다
    this.predictionMeter.fillStyle(0xe8e8ec, 1).fillRect(x + w / 1.2 - 1, y - 2, 2, h + 4);
  }

  private showOpeningSlate(onDone: () => void) {
    const { width, height } = this.scale;
    const objects: Phaser.GameObjects.GameObject[] = [];
    const track = <T extends Phaser.GameObjects.GameObject>(o: T): T => {
      objects.push(o);
      return o;
    };

    track(this.add.rectangle(width / 2, height / 2, width, height, 0x0a0a0f, 0.82).setDepth(HUD_DEPTH + 100));
    track(this.add.rectangle(width / 2, height / 2, 650, 250, 0x0e0e15, 0.98).setStrokeStyle(2, 0xff2d2d).setDepth(HUD_DEPTH + 101));
    track(this.add.text(width / 2, height / 2 - 82, 'PRISON BREAK / SECTOR 01', {
      fontFamily: 'monospace', fontSize: '14px', color: '#ff2d2d', letterSpacing: 2,
    }).setOrigin(0.5).setDepth(HUD_DEPTH + 102));
    track(this.add.text(width / 2, height / 2 - 32, 'AI 감옥의 보안 구역을 돌파하라', {
      fontFamily: 'monospace', fontSize: '30px', color: '#e8e8ec', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(HUD_DEPTH + 102));
    track(this.add.text(width / 2, height / 2 + 30, 'DIRECTOR는 네 탈출 습관을 기록한다. 숨는지, 싸우는지, 대시로 뚫는지, 같은 길을 반복하는지\n다음 보안 구역이 그 선택을 겨냥해 재설계된다.', {
      fontFamily: 'monospace', fontSize: '14px', color: '#9a9aa8', align: 'center', lineSpacing: 7,
    }).setOrigin(0.5).setDepth(HUD_DEPTH + 102));
    const start = track(this.add.text(width / 2, height / 2 + 90, '클릭해서 구역 침투', {
      fontFamily: 'monospace', fontSize: '16px', color: '#e8e8ec', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(HUD_DEPTH + 102));
    this.tweens.add({ targets: start, alpha: 0.35, duration: 520, yoyo: true, repeat: -1 });

    const finish = () => {
      this.input.off('pointerdown', finish);
      this.tweens.killTweensOf(objects);
      for (const o of objects) o.destroy();
      onDone();
    };
    this.input.once('pointerdown', finish);
  }

  private showRuleBanner(d: Directive) {
    const summary = [
      d.mutation !== 'NONE' ? d.mutation : null,
      d.buff !== 'NONE' ? d.buff : null,
      d.deny !== 'NONE' ? `DENY ${d.deny}` : null,
    ].filter(Boolean).join('  /  ') || 'BASELINE';
    const y = 132;
    const bar = this.add.rectangle(this.scale.width / 2, y, 560, 44, 0x0e0e15, 0.94)
      .setStrokeStyle(1, 0xff2d2d)
      .setDepth(HUD_DEPTH + 30);
    const text = this.add.text(this.scale.width / 2, y, `SECURITY OVERRIDE · ${summary}`, {
      fontFamily: 'monospace', fontSize: '14px', color: '#ff2d2d', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(HUD_DEPTH + 31);
    this.tweens.add({
      targets: [bar, text],
      alpha: 0,
      delay: RULE_BANNER_MS,
      duration: 260,
      onComplete: () => {
        bar.destroy();
        text.destroy();
      },
    });
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
