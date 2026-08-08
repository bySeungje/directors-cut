import Phaser from 'phaser';
import {
  assessRound,
  CUTROOM_CLIPS,
  CUTROOM_ROUNDS,
  finalInvestigation,
  formatMinute,
  TIMELINE_SIZE,
  type Clip,
  type EvidenceTag,
  type RoundAssessment,
} from '../cutroom';
import { resumeAudio } from '../sound';

const INK = '#e8e8ec';
const DIM = '#8b8b98';
const FAINT = '#454552';
const RED = '#ff2d2d';
const GOLD = '#ffc94d';
const BG_NUM = 0x0a0a0f;
const BOARD_NUM = 0x0e0e15;
const PANEL_NUM = 0x15151d;
const LINE_NUM = 0x2a2a35;
const RED_NUM = 0xff2d2d;
const GOLD_NUM = 0xffc94d;

interface ClipCard {
  clip: Clip;
  container: Phaser.GameObjects.Container;
  rect: Phaser.GameObjects.Rectangle;
  used: boolean;
}

export class CutroomScene extends Phaser.Scene {
  private round = 1;
  private totalSuspicion = 0;
  private pressureTags: EvidenceTag[] = [];
  private assessments: RoundAssessment[] = [];
  private timeline: Clip[] = [];
  private cards: ClipCard[] = [];
  private slots: Phaser.GameObjects.Container[] = [];
  private brief!: Phaser.GameObjects.Text;
  private suspicionText!: Phaser.GameObjects.Text;
  private roundText!: Phaser.GameObjects.Text;
  private submitRect!: Phaser.GameObjects.Rectangle;
  private submitLabel!: Phaser.GameObjects.Text;
  private timelineLabel!: Phaser.GameObjects.Text;
  private modal?: Phaser.GameObjects.Container;

  constructor() {
    super('CutroomScene');
  }

  create() {
    resumeAudio();
    this.cameras.main.setBackgroundColor(BG_NUM);
    this.renderHeader();
    this.renderBrief();
    this.renderCards();
    this.renderTimeline();
    this.renderControls();
    this.refresh();
    this.showIntro();
  }

  private renderHeader() {
    this.add.rectangle(33, 33, 26, 26, RED_NUM);
    this.add.text(33, 33, 'D', { fontFamily: 'monospace', fontSize: '15px', color: '#0a0a0f', fontStyle: 'bold' }).setOrigin(0.5);
    this.add.text(56, 33, 'DIRECTOR’S CUT: 증거편집실', {
      fontFamily: 'monospace',
      fontSize: '13px',
      color: DIM,
      letterSpacing: 1,
    }).setOrigin(0, 0.5);

    this.add.text(480, 70, 'AI 수사관을 속여라', {
      fontFamily: 'monospace',
      fontSize: '38px',
      color: INK,
      fontStyle: 'bold',
    }).setOrigin(0.5);
    this.add.graphics().lineStyle(4, RED_NUM, 1).lineBetween(330, 88, 632, 102);

    this.roundText = this.add.text(768, 34, '', {
      fontFamily: 'monospace',
      fontSize: '13px',
      color: DIM,
    }).setOrigin(0, 0.5);
  }

  private renderBrief() {
    this.add.rectangle(480, 136, 850, 72, BOARD_NUM).setStrokeStyle(1, LINE_NUM);
    this.brief = this.add.text(78, 116, '', {
      fontFamily: 'monospace',
      fontSize: '15px',
      color: RED,
      wordWrap: { width: 805 },
      lineSpacing: 5,
    });
  }

  private renderCards() {
    this.add.text(58, 190, '원본 CCTV 컷', { fontFamily: 'monospace', fontSize: '15px', color: INK, fontStyle: 'bold' });
    this.add.text(58, 214, '의심을 낮추려면 말이 되는 거짓말을 만들어야 한다.', {
      fontFamily: 'monospace',
      fontSize: '12px',
      color: DIM,
    });

    CUTROOM_CLIPS.forEach((clip, index) => {
      const col = index % 3;
      const row = Math.floor(index / 3);
      const x = 58 + col * 185;
      const y = 248 + row * 78;
      const rect = this.add.rectangle(0, 0, 168, 62, PANEL_NUM).setOrigin(0).setStrokeStyle(1, LINE_NUM);
      const title = this.add.text(10, 8, clip.title, { fontFamily: 'monospace', fontSize: '13px', color: INK, fontStyle: 'bold' });
      const cap = this.add.text(10, 27, clip.caption, {
        fontFamily: 'monospace',
        fontSize: '10px',
        color: DIM,
        wordWrap: { width: 146 },
        lineSpacing: 2,
      });
      const risk = this.add.text(154, 8, `${clip.risk}`, { fontFamily: 'monospace', fontSize: '12px', color: GOLD }).setOrigin(1, 0);
      const c = this.add.container(x, y, [rect, title, cap, risk]);
      rect.setInteractive({ useHandCursor: true });
      rect.on('pointerdown', () => this.addClip(clip));
      rect.on('pointerover', () => !this.cardFor(clip).used && rect.setStrokeStyle(1, 0x9a9aa8));
      rect.on('pointerout', () => !this.cardFor(clip).used && rect.setStrokeStyle(1, LINE_NUM));
      this.cards.push({ clip, container: c, rect, used: false });
    });
  }

  private renderTimeline() {
    this.timelineLabel = this.add.text(620, 190, '', { fontFamily: 'monospace', fontSize: '15px', color: INK, fontStyle: 'bold' });
    this.add.text(620, 214, '선택한 순서가 곧 알리바이다. 다시 누르면 제거.', {
      fontFamily: 'monospace',
      fontSize: '12px',
      color: DIM,
    });

    for (let i = 0; i < TIMELINE_SIZE; i++) {
      const y = 248 + i * 64;
      const slot = this.add.container(620, y);
      const rect = this.add.rectangle(0, 0, 282, 50, BOARD_NUM).setOrigin(0).setStrokeStyle(1, LINE_NUM);
      const idx = this.add.text(12, 15, `${i + 1}`, { fontFamily: 'monospace', fontSize: '15px', color: FAINT, fontStyle: 'bold' });
      const body = this.add.text(42, 8, '빈 컷', { fontFamily: 'monospace', fontSize: '13px', color: FAINT, wordWrap: { width: 220 } });
      slot.add([rect, idx, body]);
      rect.setInteractive({ useHandCursor: true });
      rect.on('pointerdown', () => this.removeAt(i));
      this.slots.push(slot);
    }
  }

  private renderControls() {
    this.suspicionText = this.add.text(58, 586, '', { fontFamily: 'monospace', fontSize: '18px', color: INK });
    this.submitRect = this.add.rectangle(780, 586, 250, 50, RED_NUM).setInteractive({ useHandCursor: true });
    this.submitLabel = this.add.text(780, 586, '편집본 제출', {
      fontFamily: 'monospace',
      fontSize: '18px',
      color: '#0a0a0f',
      fontStyle: 'bold',
    }).setOrigin(0.5);
    this.submitRect.on('pointerdown', () => this.submit());

    const clear = this.add.text(622, 586, '초기화 [C]', { fontFamily: 'monospace', fontSize: '14px', color: DIM }).setOrigin(0, 0.5);
    clear.setInteractive({ useHandCursor: true });
    clear.on('pointerdown', () => this.clearTimeline());
    this.input.keyboard!.on('keydown-C', () => this.clearTimeline());
  }

  private showIntro() {
    this.showModal(
      '사건 21:07',
      [
        '금고는 열렸고, 원본 CCTV는 아직 제출되지 않았다.',
        '너는 범인이 아니다. 더 나쁜 쪽이다.',
        '너는 범인이 무사히 빠져나가도록 사건의 순서를 편집하는 사람이다.',
        '',
        'AI 수사관 DIRECTOR가 컷 사이의 모순을 읽기 전에, 그럴듯한 거짓말을 만들어라.',
      ].join('\n'),
      '편집 시작',
      () => this.closeModal(),
    );
  }

  private addClip(clip: Clip) {
    if (this.modal || this.timeline.length >= TIMELINE_SIZE) return;
    const card = this.cardFor(clip);
    if (card.used) return;
    card.used = true;
    card.container.setAlpha(0.33);
    card.rect.setStrokeStyle(1, LINE_NUM);
    this.timeline.push(clip);
    this.refresh();
  }

  private removeAt(index: number) {
    if (this.modal || index >= this.timeline.length) return;
    const [clip] = this.timeline.splice(index, 1);
    const card = this.cardFor(clip);
    card.used = false;
    card.container.setAlpha(1);
    this.refresh();
  }

  private clearTimeline() {
    if (this.modal) return;
    this.timeline = [];
    this.cards.forEach((card) => {
      card.used = false;
      card.container.setAlpha(1);
      card.rect.setStrokeStyle(1, LINE_NUM);
    });
    this.refresh();
  }

  private submit() {
    if (this.modal || this.timeline.length !== TIMELINE_SIZE) return;
    const assessment = assessRound(this.round, this.timeline, this.pressureTags);
    this.assessments.push(assessment);
    this.totalSuspicion += assessment.score;
    this.pressureTags = [assessment.directive.targetTag];

    const detail = assessment.contradictions.length
      ? assessment.contradictions.slice(0, 2).map((c) => `- ${c.evidence}`).join('\n')
      : '- 직접 모순 없음. 하지만 너무 매끄럽다.';
    const body = [
      `의심 +${assessment.score} / 누적 ${this.totalSuspicion}`,
      '',
      assessment.directive.accusation,
      '',
      detail,
      '',
      `다음 압박: ${assessment.directive.targetTag}`,
      `“${assessment.directive.taunt}”`,
    ].join('\n');

    if (this.round >= CUTROOM_ROUNDS) {
      const final = finalInvestigation(this.totalSuspicion, this.assessments);
      this.showModal(
        final.title,
        `${body}\n\n--- FINAL REPORT ---\n${final.body}`,
        final.verdict === 'INDICTED' ? '재편집' : '다시 편집',
        () => this.scene.restart(),
      );
      return;
    }

    this.showModal(`심문 ${this.round}`, body, '다음 편집', () => {
      this.round++;
      this.closeModal();
      this.clearTimeline();
      this.refresh();
    });
  }

  private refresh() {
    this.roundText.setText(`심문 ${this.round}/${CUTROOM_ROUNDS}`);
    this.timelineLabel.setText(`편집 타임라인 ${this.timeline.length}/${TIMELINE_SIZE}`);
    this.suspicionText.setText(`누적 의심 ${this.totalSuspicion}  ·  압박 단서 ${this.pressureTags.join(', ') || '없음'}`);
    this.submitRect.setAlpha(this.timeline.length === TIMELINE_SIZE ? 1 : 0.35);
    this.submitLabel.setAlpha(this.timeline.length === TIMELINE_SIZE ? 1 : 0.35);
    this.brief.setText(this.briefText());
    this.slots.forEach((slot, index) => {
      const text = slot.list[2] as Phaser.GameObjects.Text;
      const clip = this.timeline[index];
      if (!clip) {
        text.setText('빈 컷');
        text.setColor(FAINT);
        return;
      }
      text.setText(`${clip.title}  ·  ${formatMinute(clip.time)} ${clip.camera}\n${clip.tags.slice(0, 3).join(' / ')}`);
      text.setColor(INK);
    });
  }

  private briefText(): string {
    if (this.round === 1) {
      return 'DIRECTOR: 원본 12개 중 5개만 법정에 제출된다. 네가 고른 순서가 진실이 된다.';
    }
    return `DIRECTOR: 직전 편집에서 ${this.pressureTags[0]} 단서가 떠올랐다. 같은 방식으로 숨기면 이번엔 기록하겠다.`;
  }

  private cardFor(clip: Clip): ClipCard {
    const card = this.cards.find((c) => c.clip.id === clip.id);
    if (!card) throw new Error(`missing card ${clip.id}`);
    return card;
  }

  private showModal(title: string, body: string, action: string, onAction: () => void) {
    this.closeModal();
    const shade = this.add.rectangle(480, 320, 960, 640, 0x000000, 0.62).setInteractive();
    const panel = this.add.rectangle(480, 326, 690, 390, BOARD_NUM, 0.98).setStrokeStyle(2, RED_NUM);
    const h = this.add.text(168, 158, title, { fontFamily: 'monospace', fontSize: '25px', color: INK, fontStyle: 'bold' });
    const b = this.add.text(168, 202, body, {
      fontFamily: 'monospace',
      fontSize: '14px',
      color: '#c9c9d2',
      wordWrap: { width: 625 },
      lineSpacing: 7,
    });
    const btn = this.add.rectangle(480, 480, 220, 46, RED_NUM).setInteractive({ useHandCursor: true });
    const label = this.add.text(480, 480, action, { fontFamily: 'monospace', fontSize: '16px', color: '#0a0a0f', fontStyle: 'bold' }).setOrigin(0.5);
    btn.on('pointerdown', onAction);
    this.modal = this.add.container(0, 0, [shade, panel, h, b, btn, label]).setDepth(90);
  }

  private closeModal() {
    if (!this.modal) return;
    this.modal.destroy();
    this.modal = undefined;
  }
}
