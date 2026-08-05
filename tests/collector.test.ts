import { describe, it, expect } from 'vitest';
import { WaveTelemetry } from '../src/telemetry/collector';

describe('WaveTelemetry', () => {
  it('사분면 체류·명중률·킬·피격이 로그로 집계된다', () => {
    const t = new WaveTelemetry();
    // 왼쪽 벽(x=10)에서 2초, 중앙에서 1초 체류
    for (let i = 0; i < 20; i++) t.tick(10, 100, 960, 640, 0.1);
    for (let i = 0; i < 10; i++) t.tick(480, 320, 960, 640, 0.1);
    t.recordShot(true); t.recordShot(true); t.recordShot(false);
    t.recordKill('chaser'); t.recordDamage('shooter'); t.recordDash();
    const log = t.finish(2, 30, ['DAMAGE_UP'], ['NONE']);
    expect(log.wave).toBe(2);
    expect(log.combat.accuracy).toBeCloseTo(2 / 3);
    expect(log.combat.kills.chaser).toBe(1);
    expect(log.damageSources.shooter).toBe(1);
    expect(log.hpLost).toBe(1);
    expect(log.movement.dashCount).toBe(1);
    expect(log.movement.quadrantTime.NW).toBeGreaterThan(0.5); // 왼쪽 위 체류 우세
    expect(log.movement.wallHugRatio).toBeGreaterThan(0.5);    // 벽면 체류 우세
  });
});
