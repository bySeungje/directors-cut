import Phaser from 'phaser';
import type { ReportInput } from '../../contracts/directive';
import { requestReport } from '../../director/client';
import { assembleReport } from '../../director/report';

export interface EndSceneData {
  report: ReportInput;
}

// ── 색·레이아웃 (전작 EndScene 승계 — 시안 v1 문법: 레드 컷마크·D 뱃지·리포트 박스) ──
const INK_HEX = '#e8e8ec';
const DIM_HEX = '#7a7a88';
const FAINT_HEX = '#3a3a46';
const RED_HEX = '#ff2d2d';
const RED_NUM = 0xff2d2d;
const BOARD_NUM = 0x0e0e15;
const LINE_NUM = 0x23232e;
const BG_HEX = '#0a0a0f';
const REPORT_TEXT_HEX = '#c9c9d2';

const HEADLINE_Y = 110;
const CUTMARK = { x1: 386, y1: 82, x2: 580, y2: 94, width: 4 };
const EYEBROW_Y = 55;
const STAT_Y = 152;

const BOX_X = 180;
const BOX_W = 600;
const BOX_TOP = 192;
const BOX_MIN_HEIGHT = 480 - BOX_TOP;
const PAD_X = 24;
const BADGE_X = BOX_X + 24;
const BADGE_Y = BOX_TOP + 24;
const BADGE_SIZE = 30;
const BODY_X = BOX_X + PAD_X;
const BODY_TOP = BOX_TOP + 66;
const BODY_WRAP_WIDTH = BOX_W - PAD_X * 2;
const TITLE_GAP = 40;
const UNDERLINE_GAP = 14;
const UNDERLINE_PAD = 16;
const BOX_BOTTOM_PAD = 30;
const RESTART_GAP = 46;
const FLAVOR_GAP = 32;

const REPORT_CHAR_MS = 16;
const MAX_BODY_CHARS = 460;
const CURSOR_CHAR = '▍';
const LOADING_TEXT = '심리 분석 작성 중…';
const FLAVOR_TEXT = '경비는 이 판을 기억한다. 다음 판, 같은 버릇은 더 빨리 잡힌다.';

const DEPTH_UI = 100;

export class EndScene extends Phaser.Scene {
  private boxGraphics?: Phaser.GameObjects.Graphics;

  constructor() {
    super('EndScene');
  }

  create(data: EndSceneData) {
    const { width } = this.scale;
    const r = data.report;
    this.boxGraphics = undefined;

    let torndown = false;
    this.events.once('shutdown', () => {
      torndown = true;
    });

    this.renderHeader(r);
    const { bodyText, badgeLabel } = this.renderReportChrome();
    badgeLabel.setText('PSYCH REPORT');

    let reportArrived = false;
    let typingSettled = false;
    let restarting = false;
    let typingTimer: Phaser.Time.TimerEvent | null = null;
    let finalBody = '';
    let finalTitle = '';

    const doRestart = () => {
      if (restarting) return;
      restarting = true;
      this.scene.start('VaultScene');
    };

    const revealFooter = (title: string) => {
      const titleY = bodyText.y + bodyText.height + TITLE_GAP;
      const titleText = this.add
        .text(width / 2, titleY, `「 ${title} 」`, { fontFamily: 'monospace', fontSize: '28px', color: INK_HEX, fontStyle: 'bold' })
        .setOrigin(0.5)
        .setDepth(DEPTH_UI + 1);

      const underlineY = titleY + titleText.height / 2 + UNDERLINE_GAP;
      const halfW = titleText.width / 2 + UNDERLINE_PAD;
      this.add.graphics().setDepth(DEPTH_UI + 1).lineStyle(3, RED_NUM, 1)
        .lineBetween(width / 2 - halfW, underlineY, width / 2 + halfW, underlineY);

      const boxBottom = underlineY + BOX_BOTTOM_PAD;
      this.redrawBox(boxBottom - BOX_TOP);

      const restartText = this.add
        .text(width / 2, boxBottom + RESTART_GAP, '다시 도전 [R]', { fontFamily: 'monospace', fontSize: '20px', color: INK_HEX, fontStyle: 'bold' })
        .setOrigin(0.5)
        .setDepth(DEPTH_UI);
      this.tweens.add({ targets: restartText, alpha: 0.25, duration: 550, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });

      this.add
        .text(width / 2, boxBottom + RESTART_GAP + FLAVOR_GAP, FLAVOR_TEXT, { fontFamily: 'monospace', fontSize: '13px', color: FAINT_HEX })
        .setOrigin(0.5)
        .setDepth(DEPTH_UI);
    };

    const finishTyping = () => {
      if (typingSettled) return;
      typingSettled = true;
      if (typingTimer) {
        this.time.removeEvent(typingTimer);
        typingTimer = null;
      }
      bodyText.setText(finalBody);
      revealFooter(finalTitle);
    };

    const startTyping = () => {
      let shown = 0;
      typingTimer = this.time.addEvent({
        delay: REPORT_CHAR_MS,
        repeat: Math.max(0, finalBody.length - 1),
        callback: () => {
          shown++;
          bodyText.setText(finalBody.slice(0, shown) + (shown < finalBody.length ? CURSOR_CHAR : ''));
          this.redrawBox(bodyText.y + bodyText.height + BOX_BOTTOM_PAD - BOX_TOP);
          if (shown >= finalBody.length) finishTyping();
        },
      });
    };

    this.tweens.add({ targets: bodyText, alpha: 0.35, duration: 550, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    bodyText.setText(LOADING_TEXT);

    // LLM 리포트 → 실패 시 통계 조립 폴백 (스펙 §3.4 — 정적 단일 템플릿 금지)
    requestReport(r).then((llm) => {
      if (torndown) return;
      this.tweens.killTweensOf(bodyText);
      bodyText.setAlpha(1);
      const final = llm ?? assembleReport(r);
      finalBody = final.body.length > MAX_BODY_CHARS ? `${final.body.slice(0, MAX_BODY_CHARS).trimEnd()}…` : final.body;
      finalTitle = final.title;
      bodyText.setText('');
      reportArrived = true;
      startTyping();
    });

    this.input.keyboard!.on('keydown-R', doRestart);
    this.input.on('pointerdown', () => {
      if (restarting) return;
      if (typingSettled) {
        doRestart();
        return;
      }
      if (reportArrived) finishTyping();
    });
  }

  private renderHeader(r: ReportInput) {
    const { width } = this.scale;
    const win = r.result === 'WIN';

    this.add
      .text(width / 2, EYEBROW_Y, '수읽기', { fontFamily: 'monospace', fontSize: '13px', color: RED_HEX, letterSpacing: 3 })
      .setOrigin(0.5)
      .setDepth(DEPTH_UI);

    const headline = win ? '금고를 털었다' : '읽혔다';
    this.add
      .text(width / 2, HEADLINE_Y, headline, { fontFamily: 'monospace', fontSize: '54px', color: INK_HEX, fontStyle: 'bold' })
      .setOrigin(0.5)
      .setDepth(DEPTH_UI);

    this.add.graphics().setDepth(DEPTH_UI + 1).lineStyle(CUTMARK.width, RED_NUM, 1)
      .lineBetween(CUTMARK.x1, CUTMARK.y1, CUTMARK.x2, CUTMARK.y2);

    const early =
      r.earlyEnd === 'WIN_CONFIRMED' ? ' · 조기 탈출' : r.earlyEnd === 'DEAD_END' ? ' · 수학적 사망' : '';
    this.add
      .text(
        width / 2, STAT_Y,
        `${r.roundsPlayed}라운드 · 예측됨 ${r.caughtCount}회 · 최고 스트릭 ${r.bestStreak} · ${r.bank}/${r.target}${early}`,
        { fontFamily: 'monospace', fontSize: '15px', color: DIM_HEX },
      )
      .setOrigin(0.5)
      .setDepth(DEPTH_UI);
  }

  private renderReportChrome(): { bodyText: Phaser.GameObjects.Text; badgeLabel: Phaser.GameObjects.Text } {
    this.redrawBox(BODY_TOP - BOX_TOP + BOX_BOTTOM_PAD);

    this.add.rectangle(BADGE_X + BADGE_SIZE / 2, BADGE_Y + BADGE_SIZE / 2, BADGE_SIZE, BADGE_SIZE, RED_NUM).setDepth(DEPTH_UI + 1);
    this.add
      .text(BADGE_X + BADGE_SIZE / 2, BADGE_Y + BADGE_SIZE / 2, 'D', { fontFamily: 'monospace', fontSize: '18px', color: BG_HEX, fontStyle: 'bold' })
      .setOrigin(0.5)
      .setDepth(DEPTH_UI + 2);

    const badgeLabel = this.add
      .text(BADGE_X + BADGE_SIZE + 14, BADGE_Y + 8, '', { fontFamily: 'monospace', fontSize: '12px', color: RED_HEX, letterSpacing: 2 })
      .setOrigin(0, 0.5)
      .setDepth(DEPTH_UI + 1);

    const bodyText = this.add
      .text(BODY_X, BODY_TOP, '', { fontFamily: 'monospace', fontSize: '15px', color: REPORT_TEXT_HEX, wordWrap: { width: BODY_WRAP_WIDTH }, lineSpacing: 8 })
      .setDepth(DEPTH_UI + 1);

    return { bodyText, badgeLabel };
  }

  private redrawBox(desiredHeight: number) {
    if (!this.boxGraphics) this.boxGraphics = this.add.graphics().setDepth(DEPTH_UI);
    const h = Math.max(BOX_MIN_HEIGHT, desiredHeight);
    this.boxGraphics.clear();
    this.boxGraphics.fillStyle(BOARD_NUM, 1).fillRect(BOX_X, BOX_TOP, BOX_W, h);
    this.boxGraphics.lineStyle(1, LINE_NUM, 1).strokeRect(BOX_X, BOX_TOP, BOX_W, h);
  }
}
