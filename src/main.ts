import Phaser from 'phaser';
import { TitleScene } from './game/scenes/TitleScene';
import { ArenaScene } from './game/scenes/ArenaScene';

new Phaser.Game({
  type: Phaser.AUTO,
  width: 960,
  height: 640,
  backgroundColor: '#0a0a0f',
  physics: { default: 'arcade' },
  scene: [TitleScene, ArenaScene],
});
