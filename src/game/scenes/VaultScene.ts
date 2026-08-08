import Phaser from 'phaser';
import type { Door, SessionDirective } from '../../contracts/directive';
import { requestSessionDirective } from '../../director/client';
import { assembleSessionFallback } from '../../director/fallbackBank';
import { Heist, TOTAL_ROUNDS } from '../heist';
import { killBurst, redFlash, shakeOnHit } from '../juice';
import { beginRun } from '../runtime';
import { playHit, playKill, playShoot, playWaveClear, toggleMute } from '../sound';

// ── 수읽기 본게임 씬 (스펙 §3.1·§3.5) ───────────────────────────────────────
// 게임 로직은 전부 Heist/Ensemble(순수 모듈)에 있다 — 이 씬은 입력과 연출만 담당한다.

const INK = '#e8e8ec';
const DIM = '#7a7a88';
const FAINT = '#3a3a46';
const RED = '#ff2d2d';
const RED_NUM = 0xff2d2d;
const GOLD_NUM = 0xffc94d;
const GOLD = '#ffc94d';
const BOARD_NUM = 0x0e0e15;
const LINE_NUM = 0x23232e;
const BG_NUM = 0x0a0a0f;

const DOOR_Y = 350;
const DOOR_X: Record<Door, number> = { L: 300, R: 660 };
const DOOR_W = 220;
const DOOR_H = 240;

const EYE_X = 480;
const EYE_Y = 92;
const DIALOGUE_Y = 172;
const VERDICT_Y = 330; // 스탬프 — 영상 가독을 위해 화면 중심부·대형 (스펙 §3.5·완료 기준 9)
const REASON_Y = 512;

const HUD_Y = 600;
const SETTLE_X = 810;
const SETTLE_Y = 552;

const RESOLVE_PASS_MS = 850;
const RESOLVE_CAUGHT_MS = 1500; // 근거를 읽을 시간 — 영상 가독 기준

type Phase = 'choosing' | 'resolving' | 'session' | 'over';

export class VaultScene extends Phaser.Scene {
  private heist!: Heist;
  private phase: Phase = 'choosing';

  private doors!: Record<Door, Phaser.GameObjects.Container>;
  private doorRects!: Record<Door, Phaser.GameObjects.Rectangle>;
  private dialogue!: Phaser.GameObjects.Text;
  private reasonText!: Phaser.GameObjects.Text;
  private hudBank!: Phaser.GameObjects.Text;
  private hudUnsettled!: Phaser.GameObjects.Text;
  private hudRound!: Phaser.GameObjects.Text;
  private settleBtn!: Phaser.GameObjects.Rectangle;
  private settleLabel!: Phaser.GameObjects.Text;
  private pupil!: Phaser.GameObjects.Arc;
  private currentTaunt = '';

  constructor() {
    super('VaultScene');
  }

  create() {
    const { ensemble, runCount } = beginRun();
    this.heist = new Heist(ensemble, runCount);
    this.phase = 'choosing';

    this.renderChrome(runCount);
    this.renderEye();
    this.renderDoors();
    this.renderHud();

    this.input.keyboard!.on('keydown-LEFT', () => this.chooseDoor('L'));
    this.input.keyboard!.on('keydown-RIGHT', () => this.chooseDoor('R'));
    this.input.keyboard!.on('keydown-S', () => this.trySettle());
    this.input.keyboard!.on('keydown-M', () => toggleMute());

    this.setDialogue(
      runCount > 1 ? `다시 왔군. 네 버릇 장부는 그대로다. (${runCount}번째)` : '지금부터 당신을 관찰한다.',
    );
    this.refreshHud();
  }

  update() {
    // AI 눈동자가 커서를 따라간다 — "관찰당하는" 체감 (스펙 §3.5)
    const p = this.input.activePointer;
    const dx = p.worldX - EYE_X;
    const dy = p.worldY - EYE_Y;
    const d = Math.min(9, Math.hypot(dx, dy) / 40);
    const a = Math.atan2(dy, dx);
    this.pupil.setPosition(EYE_X + Math.cos(a) * d, EYE_Y + Math.sin(a) * d);
  }

  // ── 렌더 ──────────────────────────────────────────────────────────────

  private renderChrome(runCount: number) {
    this.add.rectangle(33, 33, 26, 26, RED_NUM);
    this.add.text(33, 33, 'D', { fontFamily: 'monospace', fontSize: '15px', color: '#0a0a0f', fontStyle: 'bold' }).setOrigin(0.5);
    this.add.text(56, 33, `수읽기 · NAN 2026${runCount > 1 ? ` · RUN ${runCount}` : ''}`, {
      fontFamily: 'monospace', fontSize: '12px', color: DIM,
    }).setOrigin(0, 0.5);
    this.reasonText = this.add
      .text(480, REASON_Y, '', { fontFamily: 'monospace', fontSize: '19px', color: INK, backgroundColor: '#16161f', padding: { x: 12, y: 8 } })
      .setOrigin(0.5)
      .setDepth(50);
  }

  private renderEye() {
    this.add.circle(EYE_X, EYE_Y, 34, 0x16161f).setStrokeStyle(2, LINE_NUM);
    this.add.circle(EYE_X, EYE_Y, 20, BG_NUM).setStrokeStyle(2, RED_NUM);
    this.pupil = this.add.circle(EYE_X, EYE_Y, 7, RED_NUM);
    this.dialogue = this.add
      .text(EYE_X, DIALOGUE_Y, '', { fontFamily: 'monospace', fontSize: '17px', color: RED, align: 'center', wordWrap: { width: 700 } })
      .setOrigin(0.5);
  }

  private renderDoors() {
    this.doors = {} as Record<Door, Phaser.GameObjects.Container>;
    this.doorRects = {} as Record<Door, Phaser.GameObjects.Rectangle>;
    (['L', 'R'] as Door[]).forEach((door) => {
      const x = DOOR_X[door];
      const body = this.add.rectangle(0, 0, DOOR_W, DOOR_H, BOARD_NUM).setStrokeStyle(2, LINE_NUM);
      const dial = this.add.circle(0, -18, 34, 0x16161f).setStrokeStyle(3, 0x3a3a46);
      const handle = this.add.rectangle(0, 52, 66, 10, 0x3a3a46);
      const label = this.add.text(0, 92, door === 'L' ? '← 왼쪽' : '오른쪽 →', {
        fontFamily: 'monospace', fontSize: '15px', color: DIM,
      }).setOrigin(0.5);
      const c = this.add.container(x, DOOR_Y, [body, dial, handle, label]);
      body.setInteractive({ useHandCursor: true });
      body.on('pointerdown', () => this.chooseDoor(door));
      body.on('pointerover', () => this.phase === 'choosing' && body.setStrokeStyle(2, 0x9a9aa8));
      body.on('pointerout', () => body.setStrokeStyle(2, LINE_NUM));
      this.doors[door] = c;
      this.doorRects[door] = body;
    });
  }

  private renderHud() {
    this.add.rectangle(480, HUD_Y, 960, 80, 0x0c0c12).setDepth(40);
    this.hudBank = this.add.text(40, HUD_Y, '', { fontFamily: 'monospace', fontSize: '20px', color: INK }).setOrigin(0, 0.5).setDepth(41);
    this.hudUnsettled = this.add.text(300, HUD_Y, '', { fontFamily: 'monospace', fontSize: '20px', color: GOLD }).setOrigin(0, 0.5).setDepth(41);
    this.hudRound = this.add.text(620, HUD_Y, '', { fontFamily: 'monospace', fontSize: '16px', color: DIM }).setOrigin(0, 0.5).setDepth(41);

    this.settleBtn = this.add
      .rectangle(SETTLE_X, SETTLE_Y, 220, 52, 0x16161f)
      .setStrokeStyle(2, GOLD_NUM)
      .setDepth(41)
      .setInteractive({ useHandCursor: true });
    this.settleLabel = this.add
      .text(SETTLE_X, SETTLE_Y, '정산 [S]', { fontFamily: 'monospace', fontSize: '18px', color: GOLD, fontStyle: 'bold' })
      .setOrigin(0.5)
      .setDepth(42);
    this.settleBtn.on('pointerdown', () => this.trySettle());
    this.add.text(480, 632, 'M 음소거', { fontFamily: 'monospace', fontSize: '11px', color: FAINT }).setOrigin(0.5).setDepth(41);
  }

  private refreshHud() {
    const s = this.heist.status();
    this.hudBank.setText(`은행 ${s.bank} / 목표 ${s.target}`);
    this.hudUnsettled.setText(s.unsettled > 0 ? `미정산 ${s.unsettled}  (다음 +${(s.streak + 1) * 100})` : `미정산 0  (다음 +${(s.streak + 1) * 100})`);
    this.hudRound.setText(`라운드 ${Math.min(s.roundNo, TOTAL_ROUNDS)}/${TOTAL_ROUNDS}${s.observing ? ' · 관찰' : ''}`);
    const active = s.unsettled > 0 && this.phase === 'choosing';
    this.settleBtn.setAlpha(active ? 1 : 0.35);
    this.settleLabel.setAlpha(active ? 1 : 0.35);
  }

  private setDialogue(text: string) {
    this.dialogue.setText(text);
  }

  // ── 진행 ──────────────────────────────────────────────────────────────

  private chooseDoor(door: Door) {
    if (this.phase !== 'choosing') return;
    this.phase = 'resolving';
    playShoot();
    this.reasonText.setText('');

    const r = this.heist.playRound(door);
    const chosen = this.doors[door];
    this.tweens.add({ targets: chosen, scaleX: 0.96, scaleY: 0.96, duration: 90, yoyo: true });

    if (r.trap) this.revealTrap(r.trap as Door, r.caught);

    if (r.caught) {
      playHit();
      shakeOnHit(this);
      redFlash(this);
      this.stampCaught(r.reason, r.forfeited);
    } else {
      playKill();
      const dx = DOOR_X[door];
      killBurst(this, dx, DOOR_Y - 20, r.observing ? 0x9a9aa8 : GOLD_NUM);
      this.floatText(dx, DOOR_Y - 90, `+${r.earned}`, GOLD);
      if (r.trap) this.floatText(DOOR_X[r.trap as Door], DOOR_Y - 90, '덫이었다', RED, 13);
      if (r.observing) this.setDialogue('관찰 완료. 다음 금고부터 덫을 건다.');
    }

    this.refreshHud();
    this.time.delayedCall(r.caught ? RESOLVE_CAUGHT_MS : RESOLVE_PASS_MS, () => this.afterResolve());
  }

  /** 덫 위치는 결과와 무관하게 항상 공개 (스펙 §3.5 — 정직성 증명 + 니어미스) */
  private revealTrap(trap: Door, caught: boolean) {
    const rect = this.doorRects[trap];
    rect.setStrokeStyle(3, RED_NUM);
    const mark = this.add
      .text(DOOR_X[trap], DOOR_Y - 18, '✕', { fontFamily: 'monospace', fontSize: caught ? '54px' : '40px', color: RED, fontStyle: 'bold' })
      .setOrigin(0.5)
      .setDepth(45);
    this.tweens.add({
      targets: mark, alpha: 0, delay: caught ? 1100 : 550, duration: 250,
      onComplete: () => {
        mark.destroy();
        rect.setStrokeStyle(2, LINE_NUM);
      },
    });
  }

  private stampCaught(reason: string | null, forfeited: number) {
    const stamp = this.add
      .text(480, VERDICT_Y, '예 측 됨', { fontFamily: 'monospace', fontSize: '64px', color: RED, fontStyle: 'bold' })
      .setOrigin(0.5)
      .setAngle(-7)
      .setDepth(60)
      .setScale(1.6)
      .setAlpha(0);
    this.tweens.add({ targets: stamp, alpha: 1, scale: 1, duration: 140, ease: 'Back.easeOut' });
    this.tweens.add({ targets: stamp, alpha: 0, delay: 1150, duration: 220, onComplete: () => stamp.destroy() });
    if (reason) this.reasonText.setText(reason);
    if (forfeited > 0) this.floatText(480, VERDICT_Y + 62, `-${forfeited} 몰수`, RED, 22);
  }

  private floatText(x: number, y: number, text: string, color: string, size = 20) {
    const t = this.add.text(x, y, text, { fontFamily: 'monospace', fontSize: `${size}px`, color, fontStyle: 'bold' }).setOrigin(0.5).setDepth(55);
    this.tweens.add({ targets: t, y: y - 42, alpha: 0, duration: 900, ease: 'Cubic.easeOut', onComplete: () => t.destroy() });
  }

  private trySettle() {
    if (this.phase !== 'choosing') return;
    const before = this.heist.status().unsettled;
    if (before <= 0) return;
    const amount = this.heist.settle();
    playWaveClear();
    this.floatText(SETTLE_X, SETTLE_Y - 44, `+${amount} 확보`, GOLD, 22);
    this.refreshHud();
    const s = this.heist.status();
    if (s.over) {
      this.phase = 'over';
      this.setDialogue('…금고에 손도 못 대게 하는군.');
      this.time.delayedCall(900, () => this.gotoEnd());
    }
  }

  private afterResolve() {
    const s = this.heist.status();
    if (s.over) {
      this.phase = 'over';
      this.time.delayedCall(s.endCause === 'DEAD_END' ? 500 : 200, () => this.gotoEnd());
      return;
    }
    if (s.sessionDue) {
      void this.runSession(s.sessionDue);
      return;
    }
    this.phase = 'choosing';
    this.refreshHud();
  }

  /** 읽기 세션 (스펙 §3.4): LLM 4초 → 실패 시 조립형 폴백. 어느 쪽이든 약속 창이 열린다 */
  private async runSession(no: 1 | 2) {
    this.phase = 'session';
    const input = this.heist.sessionInput(no);

    const panel = this.add.container(480, 330).setDepth(70);
    const box = this.add.rectangle(0, 0, 640, 190, BOARD_NUM, 0.97).setStrokeStyle(2, RED_NUM);
    const header = this.add.text(-300, -72, `READING SESSION ${no}`, { fontFamily: 'monospace', fontSize: '12px', color: RED, letterSpacing: 2 });
    const body = this.add.text(-300, -40, '읽는 중…', { fontFamily: 'monospace', fontSize: '18px', color: INK, wordWrap: { width: 600 }, lineSpacing: 8 });
    panel.add([box, header, body]);
    this.tweens.add({ targets: body, alpha: 0.4, duration: 450, yoyo: true, repeat: -1 });

    const directive: SessionDirective =
      (await requestSessionDirective(input)) ?? assembleSessionFallback(input.candidates, no, input.roundNo);

    this.heist.applyDirective(directive.readPatternId, directive.strategy, directive.baitDoor);
    this.heist.markSessionDone();
    this.currentTaunt = directive.taunt;

    this.tweens.killTweensOf(body);
    body.setAlpha(1);
    const full = `“${directive.read}”\n\n— 다음 두 판, 이 읽기대로 걸겠다.`;
    let shown = 0;
    const timer = this.time.addEvent({
      delay: 24,
      repeat: full.length - 1,
      callback: () => {
        shown++;
        body.setText(full.slice(0, shown) + (shown < full.length ? '▍' : ''));
      },
    });

    const dismiss = () => {
      this.time.removeEvent(timer);
      body.setText(full);
      this.time.delayedCall(650, () => {
        panel.destroy();
        this.phase = 'choosing';
        this.setDialogue(this.currentTaunt);
        this.refreshHud();
      });
      this.input.off('pointerdown', onClick);
    };
    const onClick = () => {
      if (shown < full.length) {
        this.time.removeEvent(timer);
        shown = full.length;
        body.setText(full);
      } else dismiss();
    };
    this.input.on('pointerdown', onClick);
    this.time.delayedCall(24 * full.length + 2600, () => {
      this.input.off('pointerdown', onClick);
      if (this.phase === 'session') dismiss();
    });
  }

  private gotoEnd() {
    this.scene.start('EndScene', { report: this.heist.reportInput() });
  }
}
