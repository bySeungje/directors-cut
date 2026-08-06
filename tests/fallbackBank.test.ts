import { describe, it, expect } from 'vitest';
import { OPENING_WAVE, pickFallback } from '../src/director/fallbackBank';
import { validateDirective } from '../src/director/validator';
import { BUFF_CARDS } from '../src/contracts/directive';

describe('fallbackBank', () => {
  it('오프닝 포함 모든 뱅크 항목이 해당 웨이브 검증을 통과한다', () => {
    expect(validateDirective(OPENING_WAVE, 1, 'NONE', 'NONE', 'NONE')).not.toBeNull();
    for (let w = 2; w <= 7; w++) {
      for (let i = 0; i < 10; i++) {
        const d = pickFallback(w, 'NONE');
        expect(validateDirective(d, w, 'NONE', 'NONE', 'NONE')).not.toBeNull();
      }
    }
  });
  it('직전 mutation과 겹치는 항목은 피해서 뽑는다', () => {
    for (let i = 0; i < 20; i++) expect(pickFallback(3, 'FOG').mutation).not.toBe('FOG');
  });
});

describe('폴백 뱅크의 강화 카드', () => {
  it('오프닝과 전 웨이브 뱅크 항목이 모두 NONE이다', () => {
    expect(OPENING_WAVE.buff).toBe('NONE');
    for (let w = 2; w <= 7; w++) {
      for (let i = 0; i < 30; i++) {
        expect(pickFallback(w, 'NONE').buff).toBe('NONE');
      }
    }
  });
  it('BUFF_CARDS의 첫 항목은 NONE이다(기본값 계약)', () => {
    expect(BUFF_CARDS[0]).toBe('NONE');
  });
});
