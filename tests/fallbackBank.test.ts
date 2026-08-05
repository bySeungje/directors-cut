import { describe, it, expect } from 'vitest';
import { OPENING_WAVE, pickFallback } from '../src/director/fallbackBank';
import { validateDirective } from '../src/director/validator';

describe('fallbackBank', () => {
  it('오프닝 포함 모든 뱅크 항목이 해당 웨이브 검증을 통과한다', () => {
    expect(validateDirective(OPENING_WAVE, 1, 'NONE')).not.toBeNull();
    for (let w = 2; w <= 7; w++) {
      for (let i = 0; i < 10; i++) {
        const d = pickFallback(w, 'NONE');
        expect(validateDirective(d, w, 'NONE')).not.toBeNull();
      }
    }
  });
  it('직전 mutation과 겹치는 항목은 피해서 뽑는다', () => {
    for (let i = 0; i < 20; i++) expect(pickFallback(3, 'FOG').mutation).not.toBe('FOG');
  });
});
