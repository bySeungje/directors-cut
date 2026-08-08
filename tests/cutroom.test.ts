import { describe, expect, it } from 'vitest';
import {
  assessRound,
  CUTROOM_CLIPS,
  finalInvestigation,
  scoreTimeline,
  TIMELINE_SIZE,
} from '../src/game/cutroom';

const byId = (id: string) => {
  const clip = CUTROOM_CLIPS.find((c) => c.id === id);
  if (!clip) throw new Error(`missing clip ${id}`);
  return clip;
};

describe('cutroom model', () => {
  it('MVP timeline size is five clips', () => {
    expect(TIMELINE_SIZE).toBe(5);
  });

  it('detects time gaps and clean-cut overuse', () => {
    const result = scoreTimeline([
      byId('lobby-2101'),
      byId('hall-2104'),
      byId('vault-2107'),
      byId('server-2108'),
      byId('lobby-2112'),
    ]);
    expect(result.contradictions.map((c) => c.type)).toContain('TIME_GAP');
    expect(result.contradictions.map((c) => c.type)).toContain('CLEAN_CUT_OVERUSE');
    expect(result.score).toBeGreaterThan(10);
  });

  it('detects backward edits', () => {
    const result = scoreTimeline([
      byId('vault-2107'),
      byId('hall-2104'),
      byId('server-2108'),
      byId('exit-2111'),
      byId('lobby-2112'),
    ]);
    expect(result.contradictions.some((c) => c.type === 'TIME_BACKTRACK')).toBe(true);
  });

  it('pressures repeated tags from prior detective accusations', () => {
    const round = assessRound(2, [
      byId('hall-2102'),
      byId('vault-2103'),
      byId('hall-2104'),
      byId('exit-2105'),
      byId('lobby-2106'),
    ], ['VAULT_ACCESS']);
    expect(round.contradictions.some((c) => c.type === 'PRESSURE_REPEAT')).toBe(true);
    expect(round.directive.targetTag).toBeTruthy();
  });

  it('returns final verdict bands', () => {
    expect(finalInvestigation(20, []).verdict).toBe('PERFECT_CUT');
    expect(finalInvestigation(30, []).verdict).toBe('REASONABLE_DOUBT');
    expect(finalInvestigation(44, []).verdict).toBe('INDICTED');
  });
});
