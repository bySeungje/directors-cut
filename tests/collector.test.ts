import { describe, it, expect } from 'vitest';
import { WaveTelemetry } from '../src/telemetry/collector';

describe('WaveTelemetry', () => {
  it('사분면 체류·명중률·킬·피격이 로그로 집계된다', () => {
    const t = new WaveTelemetry();
    // 왼쪽 벽 NW(x=10)에서 2초, 비벽면(480,320 — 정중앙은 strict < 버킷팅으로 SE)에서 1초,
    // 오른쪽 벽 SE(900,500)에서 0.5초 — 벽면·사분면 지표가 서로 다른 값이 되도록 설계
    for (let i = 0; i < 20; i++) t.tick(10, 100, 960, 640, 0.1);
    for (let i = 0; i < 10; i++) t.tick(480, 320, 960, 640, 0.1);
    for (let i = 0; i < 5; i++) t.tick(900, 500, 960, 640, 0.1);
    t.recordShot(true); t.recordShot(true); t.recordShot(false);
    t.recordKill('chaser'); t.recordDamage('shooter'); t.recordDash();
    const log = t.finish(2, 30, ['DAMAGE_UP'], ['NONE']);
    expect(log.wave).toBe(2);
    expect(log.combat.accuracy).toBeCloseTo(2 / 3);
    expect(log.combat.kills.chaser).toBe(1);
    expect(log.damageSources.shooter).toBe(1);
    expect(log.hpLost).toBe(1);
    expect(log.movement.dashCount).toBe(1);
    expect(log.movement.quadrantTime.NW).toBeGreaterThan(0.5); // 2.0/3.5 ≈ 0.57
    expect(log.movement.wallHugRatio).toBeGreaterThan(log.movement.quadrantTime.NW); // 2.5/3.5 ≈ 0.71 — 두 지표 독립 검증(바꿔치기 시 실패)
  });
});

describe('밀집도·핫스팟 지표', () => {
  const W = 960, H = 640;

  it('적이 한 점에 뭉치면 clusterRatio가 0에 가깝다', () => {
    const t = new WaveTelemetry();
    const packed = [{ x: 500, y: 300 }, { x: 502, y: 301 }, { x: 498, y: 299 }];
    for (let i = 0; i < 10; i++) t.tick(100, 100, W, H, 0.1, packed);
    const log = t.finish(2, 10, [], []);
    expect(log.combat.clusterRatio).toBeLessThan(0.05);
  });

  it('적이 사방에 흩어지면 clusterRatio가 뚜렷이 크다', () => {
    const t = new WaveTelemetry();
    const spread = [{ x: 50, y: 50 }, { x: 910, y: 50 }, { x: 50, y: 590 }, { x: 910, y: 590 }];
    for (let i = 0; i < 10; i++) t.tick(100, 100, W, H, 0.1, spread);
    const log = t.finish(2, 10, [], []);
    expect(log.combat.clusterRatio).toBeGreaterThan(0.5);
  });

  it('적이 0~1기면 밀집도를 판단할 수 없어 0을 낸다', () => {
    const t = new WaveTelemetry();
    for (let i = 0; i < 5; i++) t.tick(100, 100, W, H, 0.1, [{ x: 10, y: 10 }]);
    expect(t.finish(2, 5, [], []).combat.clusterRatio).toBe(0);
  });

  it('한 자리에 계속 있으면 hotspotConcentration이 1에 가깝다', () => {
    const t = new WaveTelemetry();
    for (let i = 0; i < 20; i++) t.tick(800, 550, W, H, 0.1, []);
    expect(t.finish(2, 20, [], []).movement.hotspotConcentration).toBeGreaterThan(0.9);
  });

  it('골고루 돌아다니면 hotspotConcentration이 낮다', () => {
    const t = new WaveTelemetry();
    const pts = [[100,100],[500,100],[900,100],[100,320],[500,320],[900,320],[100,550],[500,550],[900,550]];
    for (const [x, y] of pts) for (let i = 0; i < 3; i++) t.tick(x, y, W, H, 0.1, []);
    expect(t.finish(2, 27, [], []).movement.hotspotConcentration).toBeLessThan(0.25);
  });

  it('getHotspot이 가장 오래 머문 셀의 중심을 돌려준다', () => {
    const t = new WaveTelemetry();
    for (let i = 0; i < 3; i++) t.tick(100, 100, W, H, 0.1, []);
    for (let i = 0; i < 30; i++) t.tick(850, 580, W, H, 0.1, []);   // 우하단에 압도적으로 오래
    const h = t.getHotspot();
    expect(h.x).toBeGreaterThan(W / 2);
    expect(h.y).toBeGreaterThan(H / 2);
  });
});
