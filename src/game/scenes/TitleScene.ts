import Phaser from 'phaser';

export class TitleScene extends Phaser.Scene {
  constructor() {
    super('TitleScene');
  }

  create() {
    const { width, height } = this.scale;

    this.add
      .text(width / 2, height / 2 - 50, "DIRECTOR'S CUT", { fontFamily: 'monospace', fontSize: '40px', color: '#e8e8ec' })
      .setOrigin(0.5);

    this.add
      .text(width / 2, height / 2 + 16, '클릭해서 시작', { fontFamily: 'monospace', fontSize: '20px', color: '#e8e8ec' })
      .setOrigin(0.5);

    this.add
      .text(width / 2, height / 2 + 56, 'WASD 이동 · Space 대시 · 자동 사격', {
        fontFamily: 'monospace', fontSize: '14px', color: '#9a9aa8',
      })
      .setOrigin(0.5);

    this.input.once('pointerdown', () => this.scene.start('ArenaScene'));
  }
}
