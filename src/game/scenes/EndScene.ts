import Phaser from 'phaser';
import type { WaveLog } from '../../contracts/directive';
import { buildRunSummary, requestReport, splitReportTitle } from '../../director/report';

export interface EndSceneData {
  result: 'WIN' | 'LOSE';
  waveLogs: WaveLog[];
  upgrades: string[];
  /** 예측 판정 누계(디렉터 : 당신). 승패와는 별개 축이다 — 지면서 이길 수 있다.
   *  선택 필드로 둔다: 이 씬을 직접 띄우는 개발 경로가 있고, 없으면 스코어 줄만 생략된다. */
  verdictScore?: { director: number; player: number };
}

// ── 색상 (시안 v1 CSS 변수 그대로: --board·--line·--red·--ink·--dim·--faint) ──
const INK_HEX = '#e8e8ec';
const DIM_HEX = '#7a7a88';
const FAINT_HEX = '#3a3a46';
const RED_HEX = '#ff2d2d';
const RED_NUM = 0xff2d2d;
const BOARD_NUM = 0x0e0e15;
const LINE_NUM = 0x23232e;
const BG_HEX = '#0a0a0f';
const REPORT_TEXT_HEX = '#c9c9d2';

// ── 레이아웃 (시안 v1 SCREEN 04 좌표 — 캔버스 960×640과 1:1) ──────────────
const HEADLINE_Y = 110;
const HEADLINE_FONT_SIZE = 54;
// 헤드라인을 비스듬히 긋는 레드 컷 마크 — 시안 좌표 그대로. 승/패 헤드라인 폭이 달라도 같은 위치를 재사용해
// 타이틀 화면의 "CUT" 컷 마크와 동일 문법을 엔드 화면에도 반복한다(시각적 통일감, 팀리드 지시).
const CUTMARK = { x1: 386, y1: 82, x2: 580, y2: 94, width: 4 };
const EYEBROW_Y = 55; // LOSE 전용 부제("DIRECTOR'S CUT") — WIN엔 표시하지 않는다(팀리드 지시)
const STAT_Y = 150;

const BOX_X = 180;
const BOX_W = 600;
const BOX_TOP = 190;
const BOX_MIN_HEIGHT = 480 - BOX_TOP; // 시안 원본 박스 하단(480)을 최소 높이로 — 짧은 폴백 문구에도 카드가 빈약해 보이지 않게
const PAD_X = 24;
const BADGE_X = BOX_X + 24;
const BADGE_Y = BOX_TOP + 24;
const BADGE_SIZE = 30;
const LABEL_X = BADGE_X + BADGE_SIZE + 14;
const LABEL_Y = BADGE_Y + 8;
const BODY_X = BOX_X + PAD_X;
const BODY_TOP = BOX_TOP + 66;
const BODY_WRAP_WIDTH = BOX_W - PAD_X * 2;
const TITLE_GAP = 40; // 본문 끝 → 칭호 사이 간격
const UNDERLINE_GAP = 14;
const UNDERLINE_PAD = 16; // 칭호 텍스트 폭보다 밑줄을 양쪽으로 더 길게(재량 결정 — 시안 비율 참고)
const BOX_BOTTOM_PAD = 30;
const RESTART_GAP = 46; // 박스 하단 → "다시 도전 [R]" 간격
const FLAVOR_GAP = 32;

const REPORT_CHAR_MS = 16; // taunt(interval.ts, 30ms)보다 훨씬 긴 본문이라 더 빠르게 타이핑(재량 결정)
const MAX_BODY_CHARS = 460; // LLM 장문 응답으로부터 박스 높이를 예측 가능한 범위로 방어(스펙 "400자 내외" + 여유)
const CURSOR_CHAR = '▍';
const LOADING_TEXT = '리포트 수신 중…';
const FLAVOR_TEXT = '디렉터는 이 판을 기억하지 않는다. 매 판이 새로운 연출이다.';

const DEPTH_UI = 100;

export class EndScene extends Phaser.Scene {
  private boxGraphics?: Phaser.GameObjects.Graphics;
  /** create()가 받은 데이터 — 통계 줄 렌더가 참조한다. 매 create()에서 덮어쓴다(리스타트 안전). */
  private sceneData?: EndSceneData;

  constructor() {
    super('EndScene');
  }

  create(data: EndSceneData) {
    const { width } = this.scale;
    const result = data.result;
    this.sceneData = data;
    // EndScene이 조립 — 통계 한 줄 표시와 requestReport 입력이 동일 집계(buildRunSummary)를 공유한다.
    const summary = buildRunSummary(result, data.waveLogs, data.upgrades, data.verdictScore);

    this.boxGraphics = undefined; // 리스타트로 create()가 재실행돼도 이전 런의 Graphics 참조를 들고 있지 않게

    let torndown = false;
    this.events.once('shutdown', () => {
      torndown = true;
    });

    this.renderHeader(result, summary);
    const { bodyText, badgeLabel } = this.renderReportChrome();
    badgeLabel.setText('FINAL REPORT');

    let reportArrived = false;
    let typingSettled = false;
    let restarting = false;
    let typingTimer: Phaser.Time.TimerEvent | null = null;
    let finalBody = '';
    let finalTitle = '';

    const doRestart = () => {
      if (restarting) return;
      restarting = true;
      this.scene.start('ArenaScene');
    };

    const revealFooter = (title: string) => {
      const titleY = bodyText.y + bodyText.height + TITLE_GAP;
      const titleText = this.add
        .text(width / 2, titleY, `「 ${title} 」`, { fontFamily: 'monospace', fontSize: '28px', color: INK_HEX, fontStyle: 'bold' })
        .setOrigin(0.5)
        .setDepth(DEPTH_UI + 1);

      const underlineY = titleY + titleText.height / 2 + UNDERLINE_GAP;
      const halfW = titleText.width / 2 + UNDERLINE_PAD;
      const underline = this.add.graphics().setDepth(DEPTH_UI + 1);
      underline.lineStyle(3, RED_NUM, 1).lineBetween(width / 2 - halfW, underlineY, width / 2 + halfW, underlineY);

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

    // 자연 완료(전체 타이핑)와 스킵 클릭이 겹쳐도 한 번만 실행되도록 settled 가드(interval.ts와 동일 패턴).
    const finishTyping = () => {
      if (typingSettled) return;
      typingSettled = true;
      if (typingTimer) {
        this.time.removeEvent(typingTimer);
        typingTimer = null;
      }
      bodyText.setText(finalBody); // 스킵된 경우에도 최종 텍스트로 확정(커서 제거)
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

    // ── 로딩 상태(리포트 최대 8초 대기) — 대기 중에도 R로 즉시 리스타트를 막지 않는다 ──
    this.tweens.add({ targets: bodyText, alpha: 0.35, duration: 550, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    bodyText.setText(LOADING_TEXT);

    requestReport(summary).then((raw) => {
      if (torndown) return; // 응답 도착 전에 이미 리스타트해 씬이 내려간 경우 — 죽은 GameObject를 건드리지 않는다
      this.tweens.killTweensOf(bodyText);
      bodyText.setAlpha(1);

      const { body: fullBody, title } = splitReportTitle(raw, summary);
      finalBody = fullBody.length > MAX_BODY_CHARS ? `${fullBody.slice(0, MAX_BODY_CHARS).trimEnd()}…` : fullBody;
      finalTitle = title;

      bodyText.setText('');
      reportArrived = true;
      startTyping();
    });

    // ── 입력: R은 언제나 즉시 리스타트. 클릭은 문맥별(로딩 중 무시 → 타이핑 중 스킵 → 완료 후 리스타트) ──
    this.input.keyboard!.on('keydown-R', doRestart);
    this.input.on('pointerdown', () => {
      if (restarting) return;
      if (typingSettled) {
        doRestart();
        return;
      }
      if (reportArrived) {
        finishTyping();
      }
      // 아직 리포트 로딩 중이면 클릭은 무시한다 — 스킵할 대상이 없다(R은 이 상태에서도 항상 동작).
    });
  }

  /** 헤드라인·컷마크·부제·통계 한 줄 — 리포트 로딩과 무관하게 즉시 렌더 */
  private renderHeader(result: 'WIN' | 'LOSE', summary: ReturnType<typeof buildRunSummary>) {
    const { width } = this.scale;

    if (result === 'LOSE') {
      this.add
        .text(width / 2, EYEBROW_Y, "DIRECTOR'S CUT", { fontFamily: 'monospace', fontSize: '13px', color: RED_HEX, letterSpacing: 3 })
        .setOrigin(0.5)
        .setDepth(DEPTH_UI);
    }

    const headline = result === 'WIN' ? '디렉터 격파' : '편집당했다';
    this.add
      .text(width / 2, HEADLINE_Y, headline, { fontFamily: 'monospace', fontSize: `${HEADLINE_FONT_SIZE}px`, color: INK_HEX, fontStyle: 'bold' })
      .setOrigin(0.5)
      .setDepth(DEPTH_UI);

    const cutmark = this.add.graphics().setDepth(DEPTH_UI + 1);
    cutmark.lineStyle(CUTMARK.width, RED_NUM, 1).lineBetween(CUTMARK.x1, CUTMARK.y1, CUTMARK.x2, CUTMARK.y2);

    const accuracyPct = Math.round(summary.avgAccuracy * 100);
    this.add
      .text(
        width / 2, STAT_Y,
        `${summary.wavesReached} WAVES · 처치 ${summary.totalKills} · 명중률 ${accuracyPct}% · 대시 ${summary.totalDashCount}회`,
        { fontFamily: 'monospace', fontSize: '15px', color: DIM_HEX },
      )
      .setOrigin(0.5)
      .setDepth(DEPTH_UI);

    // 읽기 대결 누계 — 승패와 별개 축이라 별도 줄로 둔다("지면서 이겼다"가 성립한다).
    const s = this.sceneData?.verdictScore;
    if (s && s.director + s.player > 0) {
      this.add
        .text(width / 2, STAT_Y + 24, `읽기 대결  디렉터 ${s.director}  :  당신 ${s.player}`, {
          fontFamily: 'monospace', fontSize: '15px',
          color: s.player > s.director ? INK_HEX : RED_HEX,
        })
        .setOrigin(0.5)
        .setDepth(DEPTH_UI);
    }
  }

  /** 리포트 박스 chrome(배경·D뱃지·라벨·본문 텍스트 오브젝트)을 만들고 참조를 돌려준다.
   *  박스 높이는 내용에 따라 달라져 redrawBox가 그때그때 다시 그린다(항상 아래로만 자란다). */
  private renderReportChrome(): { bodyText: Phaser.GameObjects.Text; badgeLabel: Phaser.GameObjects.Text } {
    this.redrawBox(BODY_TOP - BOX_TOP + BOX_BOTTOM_PAD);

    this.add.rectangle(BADGE_X + BADGE_SIZE / 2, BADGE_Y + BADGE_SIZE / 2, BADGE_SIZE, BADGE_SIZE, RED_NUM).setDepth(DEPTH_UI + 1);
    this.add
      .text(BADGE_X + BADGE_SIZE / 2, BADGE_Y + BADGE_SIZE / 2, 'D', { fontFamily: 'monospace', fontSize: '18px', color: BG_HEX, fontStyle: 'bold' })
      .setOrigin(0.5)
      .setDepth(DEPTH_UI + 2);

    const badgeLabel = this.add
      .text(LABEL_X, LABEL_Y, '', { fontFamily: 'monospace', fontSize: '12px', color: RED_HEX, letterSpacing: 2 })
      .setOrigin(0, 0.5)
      .setDepth(DEPTH_UI + 1);

    const bodyText = this.add
      .text(BODY_X, BODY_TOP, '', { fontFamily: 'monospace', fontSize: '15px', color: REPORT_TEXT_HEX, wordWrap: { width: BODY_WRAP_WIDTH }, lineSpacing: 8 })
      .setDepth(DEPTH_UI + 1);

    return { bodyText, badgeLabel };
  }

  /** 박스 Graphics를 (재)그린다. desiredHeight는 "박스 상단부터 내용 하단까지" 거리 — 최소값 아래로는 안 줄어든다. */
  private redrawBox(desiredHeight: number) {
    if (!this.boxGraphics) this.boxGraphics = this.add.graphics().setDepth(DEPTH_UI);
    const h = Math.max(BOX_MIN_HEIGHT, desiredHeight);
    this.boxGraphics.clear();
    this.boxGraphics.fillStyle(BOARD_NUM, 1).fillRect(BOX_X, BOX_TOP, BOX_W, h);
    this.boxGraphics.lineStyle(1, LINE_NUM, 1).strokeRect(BOX_X, BOX_TOP, BOX_W, h);
  }
}
