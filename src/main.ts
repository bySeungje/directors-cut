import Phaser from 'phaser';
import { TitleScene } from './game/scenes/TitleScene';
import { ArenaScene } from './game/scenes/ArenaScene';

const game = new Phaser.Game({
  type: Phaser.AUTO,
  width: 960,
  height: 640,
  backgroundColor: '#0a0a0f',
  physics: { default: 'arcade' },
  scene: [TitleScene, ArenaScene],
});

// dev QA 훅(브리프 Task 8 Step 3.5) — 원격 플레이 중 백그라운드 탭 RAF 정지로 수동 진행이 막히는 문제 대응.
// import.meta.env.DEV는 빌드 타임 상수로 치환되므로 프로덕션 빌드에서는 이 블록이 통째로 제거된다.
if (import.meta.env.DEV) {
  (window as unknown as { __game?: Phaser.Game }).__game = game;
}
