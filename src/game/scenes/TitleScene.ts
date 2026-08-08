import Phaser from 'phaser';
import { resumeAudio } from '../sound';
import { warmUpDirector } from '../../director/client';

// 시안 v1 SCREEN 01 좌표(1:1) — 레드 D 뱃지 + NAN 2026 라벨은 캔버스 절대좌표라 스케일 무관하게 그대로 재사용.
const BADGE_X = 20;
const BADGE_Y = 20;
const BADGE_SIZE = 26;
const BADGE_LABEL_GAP = 10;

// "CUT" 위를 긋는 레드 컷 마크 — 시안은 92px 타이틀 기준 절대좌표였지만, 이 씬의 실제 타이틀은 40px라
// 좌표를 그대로 복사할 수 없다("DIRECTOR'S "/"CUT"을 별도 Text로 나눠 실제 렌더 폭을 재서 위치를 잡는다).
const CUTMARK_COLOR = 0xff2d2d;
const CUTMARK_WIDTH = 5;
const CUTMARK_PAD = 4;
const CUTMARK_TILT_RATIO = 0.068; // 시안 SVG 실측(rise 16px / run 234px) 비율을 그대로 적용(재량 결정)

export class TitleScene extends Phaser.Scene {
  constructor() {
    super('TitleScene');
  }

  create() {
    const { width, height } = this.scale;

    warmUpDirector(); // 프록시·모델 콜드스타트를 미리 데운다(스펙 3.4 amendment) — 결과를 기다리지 않고 게임 시작을 막지 않음

    this.renderStageMarks(width, height);
    this.renderTitleWithCutmark(width, height / 2 - 82);
    this.renderDirectorBadge();

    this.add
      .text(width / 2, height / 2 - 10, 'AI 감옥장이 탈출 습관을 학습해 다음 구역을 재설계하는 액션', {
        fontFamily: 'monospace', fontSize: '18px', color: '#ff2d2d',
      })
      .setOrigin(0.5);

    this.add
      .text(width / 2, height / 2 + 48, '클릭해서 SECTOR 01 탈출', { fontFamily: 'monospace', fontSize: '20px', color: '#e8e8ec', fontStyle: 'bold' })
      .setOrigin(0.5);

    this.add
      .text(width / 2, height / 2 + 92, 'WASD 이동 · Space 대시 · 자동 사격\n벽을 믿지 마라. 같은 탈출 루트를 반복하면 DIRECTOR가 다음 구역을 네 약점으로 바꾼다.', {
        fontFamily: 'monospace', fontSize: '14px', color: '#9a9aa8', align: 'center', lineSpacing: 7,
      })
      .setOrigin(0.5);

    this.input.once('pointerdown', () => {
      resumeAudio(); // 브라우저 오토플레이 정책 — 최초 사용자 제스처에서 AudioContext를 깨운다
      this.scene.start('ArenaScene');
    });
  }

  /** "DIRECTOR'S CUT"을 "DIRECTOR'S "+"CUT" 두 Text로 나눠 붙여 그린다 — "CUT" 파트의 실제 렌더 폭을
   *  알아야 그 위를 정확히 긋는 레드 컷 마크(시안 SCREEN 01 문법)를 그릴 수 있기 때문. */
  private renderTitleWithCutmark(width: number, titleY: number) {
    const style = { fontFamily: 'monospace', fontSize: '46px', color: '#e8e8ec', fontStyle: 'bold' } as const;
    const prefix = this.add.text(0, titleY, "DIRECTOR'S ", style).setOrigin(0, 0.5);
    const cut = this.add.text(0, titleY, 'CUT', style).setOrigin(0, 0.5);

    const totalWidth = prefix.width + cut.width;
    const startX = width / 2 - totalWidth / 2;
    prefix.setX(startX);
    cut.setX(startX + prefix.width);

    const x1 = cut.x - CUTMARK_PAD;
    const x2 = cut.x + cut.width + CUTMARK_PAD;
    const y1 = titleY + cut.height * 0.04; // 시안 CSS(top:54%)의 텍스트 박스 기준 근사
    const y2 = y1 + (x2 - x1) * CUTMARK_TILT_RATIO;

    this.add.graphics().lineStyle(CUTMARK_WIDTH, CUTMARK_COLOR, 1).lineBetween(x1, y1, x2, y2);
  }

  private renderStageMarks(width: number, height: number) {
    const g = this.add.graphics();
    g.lineStyle(1, 0x23232e, 1).strokeRect(76, 82, width - 152, height - 164);
    g.lineStyle(2, CUTMARK_COLOR, 0.85);
    g.lineBetween(76, 82, 128, 82);
    g.lineBetween(76, 82, 76, 134);
    g.lineBetween(width - 76, 82, width - 128, 82);
    g.lineBetween(width - 76, 82, width - 76, 134);
    g.lineBetween(76, height - 82, 128, height - 82);
    g.lineBetween(76, height - 82, 76, height - 134);
    g.lineBetween(width - 76, height - 82, width - 128, height - 82);
    g.lineBetween(width - 76, height - 82, width - 76, height - 134);

    this.add
      .text(width / 2, 112, 'AI PRISON / BLOCK A / NO SAFE ROUTE', {
        fontFamily: 'monospace', fontSize: '12px', color: '#7a7a88', letterSpacing: 2,
      })
      .setOrigin(0.5);
  }

  /** 좌상단 레드 D 뱃지 + "NAN 2026" 라벨 — 시안 SCREEN 01, 인터벌/엔드 화면과 같은 디렉터 아이덴티티. */
  private renderDirectorBadge() {
    const cx = BADGE_X + BADGE_SIZE / 2;
    const cy = BADGE_Y + BADGE_SIZE / 2;
    this.add.rectangle(cx, cy, BADGE_SIZE, BADGE_SIZE, CUTMARK_COLOR);
    this.add
      .text(cx, cy, 'D', { fontFamily: 'monospace', fontSize: '15px', color: '#0a0a0f', fontStyle: 'bold' })
      .setOrigin(0.5);
    this.add
      .text(BADGE_X + BADGE_SIZE + BADGE_LABEL_GAP, cy, 'NAN 2026', { fontFamily: 'monospace', fontSize: '12px', color: '#7a7a88' })
      .setOrigin(0, 0.5);
  }
}
