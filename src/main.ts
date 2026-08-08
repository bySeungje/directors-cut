import Phaser from 'phaser';
import { TitleScene } from './game/scenes/TitleScene';
import { VaultScene } from './game/scenes/VaultScene';
import { EndScene } from './game/scenes/EndScene';
import { CutroomScene } from './game/scenes/CutroomScene';

const game = new Phaser.Game({
  type: Phaser.AUTO,
  width: 960,
  height: 640,
  backgroundColor: '#0a0a0f',
  scene: [TitleScene, CutroomScene, VaultScene, EndScene],
});

// dev QA 훅 — 원격 플레이 중 백그라운드 탭 RAF 정지로 수동 진행이 막히는 문제 대응.
// import.meta.env.DEV는 빌드 타임 상수로 치환되므로 프로덕션 빌드에서는 이 블록이 통째로 제거된다.
if (import.meta.env.DEV) {
  (window as unknown as { __game?: Phaser.Game }).__game = game;
}
