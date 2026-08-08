import Phaser from 'phaser';
import { resumeAudio } from '../sound';
import { warmUpDirector } from '../../director/client';

// 타이틀 — 전작 씬 승계(레드 D 뱃지·컷마크 문법·워밍업 호출), 카피만 수읽기로 교체.

const RED_NUM = 0xff2d2d;
const BADGE_X = 20;
const BADGE_Y = 20;
const BADGE_SIZE = 26;

export class TitleScene extends Phaser.Scene {
  constructor() {
    super('TitleScene');
  }

  create() {
    const { width, height } = this.scale;

    warmUpDirector(); // 프록시·모델 콜드스타트를 미리 데운다(전작 amendment 승계) — 게임 시작을 막지 않음

    const title = this.add
      .text(width / 2, height / 2 - 80, '수읽기', { fontFamily: 'monospace', fontSize: '76px', color: '#e8e8ec', fontStyle: 'bold' })
      .setOrigin(0.5);
    // 타이틀을 비스듬히 긋는 레드 마크 — 전작 컷마크 문법 승계 (디렉터의 개입 표시)
    const x1 = title.x - title.width / 2 - 8;
    const x2 = title.x + title.width / 2 + 8;
    const y = title.y + title.height * 0.18;
    this.add.graphics().lineStyle(5, RED_NUM, 1).lineBetween(x1, y, x2, y + (x2 - x1) * 0.05);

    this.add
      .text(width / 2, height / 2 + 4, '나 vs 나를 읽는 AI', { fontFamily: 'monospace', fontSize: '18px', color: '#ff2d2d' })
      .setOrigin(0.5);

    this.add
      .text(width / 2, height / 2 + 64, '클릭해서 시작', { fontFamily: 'monospace', fontSize: '20px', color: '#e8e8ec' })
      .setOrigin(0.5);

    this.add
      .text(width / 2, height / 2 + 104, 'AI 경비가 지키는 이중 금고 — 놈은 네 선택 패턴을 읽는다\n12라운드 안에 1,000을 털어서 걸어 나가라', {
        fontFamily: 'monospace', fontSize: '14px', color: '#9a9aa8', align: 'center', lineSpacing: 6,
      })
      .setOrigin(0.5);

    this.renderDirectorBadge();

    this.input.once('pointerdown', () => {
      resumeAudio(); // 브라우저 오토플레이 정책 — 최초 사용자 제스처에서 AudioContext를 깨운다
      this.scene.start('VaultScene');
    });
  }

  private renderDirectorBadge() {
    const cx = BADGE_X + BADGE_SIZE / 2;
    const cy = BADGE_Y + BADGE_SIZE / 2;
    this.add.rectangle(cx, cy, BADGE_SIZE, BADGE_SIZE, RED_NUM);
    this.add
      .text(cx, cy, 'D', { fontFamily: 'monospace', fontSize: '15px', color: '#0a0a0f', fontStyle: 'bold' })
      .setOrigin(0.5);
    this.add
      .text(BADGE_X + BADGE_SIZE + 10, cy, 'NAN 2026', { fontFamily: 'monospace', fontSize: '12px', color: '#7a7a88' })
      .setOrigin(0, 0.5);
  }
}
