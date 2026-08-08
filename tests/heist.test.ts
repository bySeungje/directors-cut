import { describe, expect, it } from 'vitest';
import { BASE_STAKE, Heist, OBS_ROUNDS, TARGET, TOTAL_ROUNDS } from '../src/game/heist';
import { Ensemble, type DoorIdx, type TrapDecision } from '../src/game/predictor';

// 판돈·라운드 상태기 검증 (스펙 §3.1~3.2, 완료 기준 4의 유닛 절반 — 밴드는 heist_gate가 본다)

/** 덫을 외부에서 지정하는 결정론 앙상블 — 판돈 수학을 예측기와 분리해 검증한다 */
class FakeEnsemble extends Ensemble {
  nextTrap: DoorIdx | null = null;
  override decideTrap(): TrapDecision {
    return {
      trap: this.nextTrap,
      mode: 'normal',
      attribution: this.nextTrap == null ? null : { patternId: 'FREQ', reason: '테스트 근거' },
      confidence: 0.6,
    };
  }
  override observe(): void {}
  override windowActive(): boolean {
    return false;
  }
}

const makeHeist = () => {
  const fake = new FakeEnsemble(() => 0.5);
  return { heist: new Heist(fake, 1), fake };
};

describe('수익 수식 (스펙 §3.2 — 100·200·300…)', () => {
  it('관찰 라운드는 덫 없이 수익·스트릭이 본게임과 동일하게 동작한다', () => {
    const { heist } = makeHeist();
    const r = heist.playRound('L');
    expect(r.observing).toBe(true);
    expect(r.trap).toBeNull();
    expect(r.caught).toBe(false);
    expect(r.earned).toBe(BASE_STAKE);
    expect(heist.status().unsettled).toBe(BASE_STAKE);
    expect(heist.status().streak).toBe(1);
  });

  it('통과 시 미정산 += 100×(스트릭+1), 그 후 스트릭+1', () => {
    const { heist, fake } = makeHeist();
    heist.playRound('L'); // 관찰 +100
    fake.nextTrap = 1; // R에 덫 — L 선택은 통과
    const r2 = heist.playRound('L');
    expect(r2.earned).toBe(200);
    const r3 = heist.playRound('L');
    expect(r3.earned).toBe(300);
    expect(heist.status().unsettled).toBe(600);
  });

  it('잡히면 미정산 전액 몰수 + 스트릭 0, 덫 위치는 공개된다', () => {
    const { heist, fake } = makeHeist();
    heist.playRound('L'); // +100
    fake.nextTrap = 0; // L에 덫 — L 선택은 잡힘
    const r = heist.playRound('L');
    expect(r.caught).toBe(true);
    expect(r.trap).toBe('L');
    expect(r.reason).toBe('테스트 근거');
    expect(r.forfeited).toBe(100);
    expect(heist.status().unsettled).toBe(0);
    expect(heist.status().streak).toBe(0);
  });

  it('통과 시에도 덫 위치가 공개된다 (니어미스 — 스펙 §3.5)', () => {
    const { heist, fake } = makeHeist();
    heist.playRound('L');
    fake.nextTrap = 1;
    const r = heist.playRound('L');
    expect(r.caught).toBe(false);
    expect(r.trap).toBe('R');
  });
});

describe('정산·조기 종료 (스펙 §3.1)', () => {
  it('정산은 미정산을 은행으로 옮기고 스트릭을 리셋한다', () => {
    const { heist, fake } = makeHeist();
    heist.playRound('L');
    fake.nextTrap = 1;
    heist.playRound('L'); // 미정산 300
    const amount = heist.settle();
    expect(amount).toBe(300);
    expect(heist.status().bank).toBe(300);
    expect(heist.status().unsettled).toBe(0);
    expect(heist.status().streak).toBe(0);
  });

  it('정산으로 목표 도달 시 조기 승리(WIN_CONFIRMED)', () => {
    const { heist, fake } = makeHeist();
    fake.nextTrap = 1;
    // 관찰 100 + 200+300+400+500 = 1500 ≥ TARGET
    for (let i = 0; i < 5; i++) heist.playRound('L');
    expect(heist.status().unsettled).toBe(1500);
    heist.settle();
    const s = heist.status();
    expect(s.over).toBe(true);
    expect(s.result).toBe('WIN');
    expect(s.endCause).toBe('WIN_CONFIRMED');
  });

  it('남은 최대 수익으로도 도달 불가면 수학적 사망(DEAD_END) 조기 종료', () => {
    const { heist, fake } = makeHeist();
    heist.playRound('L'); // 관찰 +100
    fake.nextTrap = 0; // 이후 전부 잡힘 (L만 고름)
    let s = heist.status();
    while (!s.over) {
      heist.playRound('L');
      s = heist.status();
    }
    expect(s.result).toBe('LOSE');
    expect(s.endCause).toBe('DEAD_END');
    // 전 라운드를 소진하기 전에 끝났어야 한다 (죽은 라운드 제거 — 리뷰 should-fix)
    expect(heist.lastResults().length).toBeLessThan(TOTAL_ROUNDS);
  });

  it('전 라운드 소진 시 미정산 자동 정산 + ROUNDS_DONE (조기 승리로 오기록되지 않는다)', () => {
    const { heist, fake } = makeHeist();
    fake.nextTrap = 1;
    for (let i = 0; i < TOTAL_ROUNDS; i++) heist.playRound('L');
    const s = heist.status();
    expect(s.over).toBe(true);
    expect(s.endCause).toBe('ROUNDS_DONE');
    // 100+200+…+1200 = 7800 전액 자동 정산
    expect(s.bank).toBe((BASE_STAKE * TOTAL_ROUNDS * (TOTAL_ROUNDS + 1)) / 2);
    expect(s.result).toBe('WIN');
  });
});

describe('읽기 세션 스케줄 (스펙 §3.1 — 본게임 4R·8R 후)', () => {
  it('본게임 4라운드 종료 직후 세션 1, 8라운드 종료 직후 세션 2', () => {
    const { heist, fake } = makeHeist();
    fake.nextTrap = 1;
    heist.playRound('L'); // 관찰
    for (let i = 0; i < 4; i++) {
      expect(heist.status().sessionDue).toBeNull();
      heist.playRound('L');
    }
    expect(heist.status().sessionDue).toBe(1);
    heist.markSessionDone();
    expect(heist.status().sessionDue).toBeNull();
    for (let i = 0; i < 4; i++) heist.playRound('L');
    expect(heist.status().sessionDue).toBe(2);
    heist.markSessionDone();
    expect(heist.status().sessionDue).toBeNull();
  });
});

describe('리포트 입력 집계', () => {
  it('잡힘 횟수·최고 스트릭·정산 횟수·귀속 분포를 집계한다', () => {
    const { heist, fake } = makeHeist();
    heist.playRound('L'); // 관찰 +100 (스트릭1)
    fake.nextTrap = 1;
    heist.playRound('L'); // +200 (2)
    heist.playRound('L'); // +300 (3)
    heist.settle(); // 600
    fake.nextTrap = 0;
    heist.playRound('L'); // 잡힘 (FREQ 귀속)
    const r = heist.reportInput();
    expect(r.caughtCount).toBe(1);
    expect(r.bestStreak).toBe(3);
    expect(r.settleCount).toBe(1);
    expect(r.caughtByPattern.FREQ).toBe(1);
    expect(r.target).toBe(TARGET);
    expect(OBS_ROUNDS + 0).toBe(1);
  });
});
