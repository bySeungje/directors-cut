import type { Door, PatternId, ReportInput, SessionInput, Strategy } from '../contracts/directive';
import { Ensemble, doorOf, idxOf, type TrapDecision, type TrapMode } from './predictor';

// ── 라운드·판돈 상태기 (스펙 §3.1~3.2) — 씬과 분리된 순수 로직, 유닛 테스트 대상 ──

export const OBS_ROUNDS = 1;
export const MAIN_ROUNDS = 11;
export const TOTAL_ROUNDS = OBS_ROUNDS + MAIN_ROUNDS;
export const BASE_STAKE = 100;
/** 목표액 — 게이트 2차 확정(2026-08-08, tests/heist_gate.test.ts 스캔): T=1000에서 4밴드 전부
 *  성립(무전략 9.9%·역읽기 49.9%·랜덤 20.2%·심기 0.0%). 900은 역읽기 71%로 과잉, 1100+는 45% 미달 */
export const DEFAULT_TARGET = 1000;
/** 읽기 세션 시점: 본게임 N라운드 종료 직후. 게이트 2차에서 2회→3회로 확정 —
 *  심기(plant)의 '한 번 뒤집기'가 다음 세션의 갱신된 선언에 즉시 노출되게 한다 */
export const SESSION_AFTER_MAIN = [3, 6, 9] as const;

export interface RoundResult {
  roundNo: number; // 1..TOTAL_ROUNDS
  observing: boolean;
  choice: Door;
  trap: Door | null; // 관찰 라운드는 null — 그 외엔 항상 공개 (스펙 §3.5)
  caught: boolean;
  mode: TrapMode;
  /** 잡힘 근거 (로컬 귀속) — 통과 시엔 니어미스 문구 없이 trap만 공개 */
  reason: string | null;
  patternId: PatternId | null;
  earned: number; // 이번 라운드 미정산 증가분 (잡히면 0)
  forfeited: number; // 몰수액 (잡힌 경우 직전 미정산 전액)
  windowRound: boolean;
}

export type EndCause = 'ROUNDS_DONE' | 'WIN_CONFIRMED' | 'DEAD_END';

export interface HeistStatus {
  roundNo: number; // 다음에 플레이할 라운드 (1-base). TOTAL+1이면 종료
  observing: boolean;
  bank: number;
  unsettled: number;
  streak: number;
  target: number;
  over: boolean;
  result: 'WIN' | 'LOSE' | null;
  endCause: EndCause | null;
  sessionDue: 1 | 2 | 3 | null;
}

export class Heist {
  readonly ensemble: Ensemble;
  private round = 1;
  private bank = 0;
  private unsettled = 0;
  private streak = 0;
  private over = false;
  private endCause: EndCause | null = null;

  private choices: Door[] = [];
  private caughtHistory: boolean[] = [];
  private results: RoundResult[] = [];
  private settleCount = 0;
  private greedRounds = 0;
  private bestStreak = 0;
  private caughtByPattern: Partial<Record<PatternId, number>> = {};
  private windowRounds = 0;
  private windowPasses = 0;
  private sessionsDone = 0;
  private currentStrategy: Strategy = 'BALANCED';
  readonly runCount: number;
  readonly target: number;

  constructor(ensemble: Ensemble, runCount = 1, opts?: { target?: number }) {
    this.ensemble = ensemble;
    this.runCount = runCount;
    this.target = opts?.target ?? DEFAULT_TARGET;
  }

  status(): HeistStatus {
    const mainDone = this.round - 1 - OBS_ROUNDS; // 완료된 본게임 라운드 수
    const dueIdx = !this.over && this.sessionsDone < SESSION_AFTER_MAIN.length && mainDone === SESSION_AFTER_MAIN[this.sessionsDone]
      ? ((this.sessionsDone + 1) as 1 | 2 | 3)
      : null;
    return {
      roundNo: this.round,
      observing: this.round <= OBS_ROUNDS,
      bank: this.bank,
      unsettled: this.unsettled,
      streak: this.streak,
      target: this.target,
      over: this.over,
      result: this.over ? (this.bank >= this.target ? 'WIN' : 'LOSE') : null,
      endCause: this.endCause,
      sessionDue: dueIdx,
    };
  }

  /** 읽기 세션 소비 표시 — 디렉티브 적용과 별개로 호출 (폴백이어도 세션은 소비된다) */
  markSessionDone(): void {
    this.sessionsDone++;
  }

  applyDirective(patternId: PatternId, strategy: Strategy, baitDoor: 'L' | 'R' | 'NONE'): void {
    this.currentStrategy = strategy;
    this.ensemble.applySession(patternId, strategy, baitDoor);
  }

  playRound(choice: Door): RoundResult {
    if (this.over) throw new Error('run is over');
    const observing = this.round <= OBS_ROUNDS;
    const windowRound = !observing && this.ensemble.windowActive();
    if (this.streak >= 3) this.greedRounds++;

    let decision: TrapDecision | null = null;
    if (!observing) decision = this.ensemble.decideTrap();

    const ci = idxOf(choice);
    const caught = decision?.trap != null && decision.trap === ci;

    let earned = 0;
    let forfeited = 0;
    if (caught) {
      forfeited = this.unsettled;
      this.unsettled = 0;
      this.streak = 0;
      if (decision?.attribution) {
        const id = decision.attribution.patternId;
        this.caughtByPattern[id] = (this.caughtByPattern[id] ?? 0) + 1;
      }
    } else {
      earned = BASE_STAKE * (this.streak + 1);
      this.unsettled += earned;
      this.streak++;
      this.bestStreak = Math.max(this.bestStreak, this.streak);
    }

    if (windowRound) {
      this.windowRounds++;
      if (!caught) this.windowPasses++;
    }

    this.ensemble.observe(ci, caught, windowRound);
    this.choices.push(choice);
    this.caughtHistory.push(caught);

    const result: RoundResult = {
      roundNo: this.round,
      observing,
      choice,
      trap: decision?.trap != null ? doorOf(decision.trap) : null,
      caught,
      mode: decision?.mode ?? 'normal',
      reason: caught ? decision?.attribution?.reason ?? null : null,
      patternId: decision?.attribution?.patternId ?? null,
      earned,
      forfeited,
      windowRound,
    };
    this.results.push(result);
    this.round++;

    if (this.round > TOTAL_ROUNDS) {
      this.finish('ROUNDS_DONE'); // 종료 확정 후 자동 정산 — settle()의 조기 승리 판정이 원인을 덮어쓰지 않게
      this.settle();
    } else if (this.deadEnd()) {
      this.finish('DEAD_END');
      this.settle();
    }
    return result;
  }

  /** 정산 — 라운드 사이 무료 행동. 승리 확정 시 조기 종료 (스펙 §3.1) */
  settle(): number {
    const amount = this.unsettled;
    this.bank += amount;
    this.unsettled = 0;
    this.streak = 0;
    if (amount > 0) this.settleCount++;
    if (!this.over && this.bank >= this.target) this.finish('WIN_CONFIRMED');
    return amount;
  }

  /** 수학적 사망: 남은 전 라운드를 통과+막판 정산해도 목표 도달 불가 (스펙 §3.1 조기 종료) */
  private deadEnd(): boolean {
    const left = TOTAL_ROUNDS - this.round + 1;
    let maxFuture = 0;
    for (let i = 1; i <= left; i++) maxFuture += BASE_STAKE * (this.streak + i);
    return this.bank + this.unsettled + maxFuture < this.target;
  }

  private finish(cause: EndCause): void {
    if (this.over) return;
    this.over = true;
    this.endCause = cause;
  }

  caughtCount(): number {
    return this.caughtHistory.filter(Boolean).length;
  }

  lastResults(): readonly RoundResult[] {
    return this.results;
  }

  sessionInput(sessionNo: 1 | 2 | 3): SessionInput {
    return {
      sessionNo,
      roundNo: this.round - 1,
      choices: [...this.choices],
      caughtHistory: [...this.caughtHistory],
      bank: this.bank,
      unsettled: this.unsettled,
      streak: this.streak,
      target: this.target,
      settleCount: this.settleCount,
      greedRounds: this.greedRounds,
      candidates: this.ensemble.candidates(),
      prevStrategy: this.currentStrategy,
      runCount: this.runCount,
    };
  }

  reportInput(): ReportInput {
    const st = this.status();
    return {
      result: st.result ?? 'LOSE',
      earlyEnd: this.endCause === 'ROUNDS_DONE' ? null : this.endCause,
      roundsPlayed: this.results.length,
      bank: this.bank,
      target: this.target,
      caughtCount: this.caughtCount(),
      bestStreak: this.bestStreak,
      settleCount: this.settleCount,
      greedRounds: this.greedRounds,
      caughtByPattern: { ...this.caughtByPattern },
      windowRounds: this.windowRounds,
      windowPasses: this.windowPasses,
      runCount: this.runCount,
    };
  }
}
