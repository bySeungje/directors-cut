import Phaser from 'phaser';
import { Directive, EnemyType, Mutation, BuffCard, WaveLog } from '../../contracts/directive';
import { OPENING_WAVE } from '../../director/fallbackBank';
import { WaveTelemetry } from '../../telemetry/collector';
import {
  Player, Enemy, Bullet, ENEMY_DEF, ENEMY_BULLET_SPEED, HUD_HEART_TEX, generateTextures,
  PLAYER_COLOR, ENEMY_COLOR, ELITE_COLOR,
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
  private muteText!: Phaser.GameObjects.Text;

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

    const dt = delta / 1000;
    this.telemetry.tick(
      this.player.x, this.player.y, this.scale.width, this.scale.height, dt,
      this.enemies.getChildren().filter((e) => e.active) as unknown as { x: number; y: number }[],
    );

    const fireAngles = this.player.update(time, delta, this.enemies);
    if (fireAngles.length > 0) playShoot(); // 멀티샷이어도 발사 이벤트당 1회만(탄마다 겹쳐 시끄러워지지 않게)
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
  private beginWave(d: Directive) {
    this.waveClearedEmitted = false;
    this.enemiesSpawned = false;
    this.activeMutation = d.mutation;
    this.waveStartAt = this.time.now;
    runDirective(this, d);
  }

  /** onWaveCleared·onPlayerDied가 공유하는 웨이브 로그 스냅샷. finish()가 반환하는 damageSources/combat.kills는
   *  WaveTelemetry 내부 객체의 라이브 참조라 얕은 복사로 분리해둔다(값이 전부 원시 number라 얕은 복사=완전한
   *  분리) — 그렇지 않으면 인터벌 중 recordDamage/recordKill이 이미 push된 이 로그를 사후 변조한다. */
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
    return log;
  }

  private onWaveCleared = (wave: number) => {
    const log = this.snapshotCurrentWaveLog(wave);
    this.waveLogs.push(log);
    this.prevMutation = this.activeMutation;
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
    requestDirective(log, nextWave, this.prevMutation, this.prevBuff).then(({ directive, fromLLM }) => {
      if (this.playerDead) return; // 인터벌 대기 중 잔여 적탄에 맞아 사망하는 경우 다음 웨이브를 시작하지 않는다
      this.lastDirectiveFromLLM = fromLLM;
      this.lastDirective = directive;
      // directive.buff는 검증을 거친 최종값이라 다음 웨이브가 실제로 실행할 buff와 동일하다 — 그 웨이브가
      // 끝나 다음 requestDirective를 부를 때 "직전 buff"로 정확히 이 값을 참조하도록 미리 갱신해둔다.
      this.prevBuff = directive.buff;
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
  private endRun(result: 'WIN' | 'LOSE') {
    this.scene.start('EndScene', {
      result,
      waveLogs: [...this.waveLogs],
      upgrades: [...this.chosenUpgrades],
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

  private createHud() {
    this.waveText = this.add
      .text(16, 10, `웨이브 ${this.currentWave}`, { fontFamily: 'monospace', fontSize: '18px', color: '#e8e8ec' })
      .setDepth(HUD_DEPTH);

    this.dashGauge = this.add.graphics().setDepth(HUD_DEPTH);
    this.muteText = this.add
      .text(16, 80, '', { fontFamily: 'monospace', fontSize: '11px', color: '#3a3a46' })
      .setDepth(HUD_DEPTH);
    this.syncHearts();
    this.updateHud();
  }

  private updateHud() {
    this.waveText.setText(`웨이브 ${this.currentWave}`);
    this.syncHearts();
    for (let i = 0; i < this.hearts.length; i++) {
      this.hearts[i].setAlpha(i < this.player.hp ? 1 : 0.25);
    }

    const x = 16, y = 62, w = 100, h = 6;
    this.dashGauge.clear();
    this.dashGauge.fillStyle(0x2a2a33, 1).fillRect(x, y, w, h);
    const frac = this.player.dashReadyFraction(this.time.now);
    this.dashGauge.fillStyle(0xe8e8ec, 1).fillRect(x, y, w * frac, h);

    this.muteText.setText(isMuted() ? '[M] 음소거 중' : '[M] 소리 켜짐');
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
