import { HABIT_IDS, type HabitId, type Mutation } from '../contracts/directive';

export { HABIT_IDS };
export type { HabitId };

/**
 * 습관 어휘 — 디렉터가 "너는 이걸 못 버린다"고 거는 명제와 그 채점 규칙.
 *
 * **순수 함수만 둔다.** 모듈 전역 상태를 두면 R키 리스타트에서 살아남아 다음 런을 오염시킨다
 * (이 코드베이스에 이미 그런 싱글턴이 셋 있다). 스코어·현재 예측은 ArenaScene 필드가 소유한다.
 *
 * 어휘가 5종에서 3종으로 줄어든 경위와 폐기 사유: `docs/_hub/nodes/D-habits-five-to-three.md`
 */
/** 판정 입력. corner·anchor는 롤링 창 기준(`collector.peek()`).
 *
 *  `dashUptime`은 초당 횟수가 아니라 **자기 쿨다운 대비 가동률**(0~1)이다 — 절대 횟수·절대 비율은
 *  `DASH_CD_DOWN`으로 쿨다운이 줄면 최대치가 올라가(2000ms → 3회 강화 시 1024ms) 같은 습관인데
 *  수치가 커진다. 웨이브 길이로 나눈 값이 길이를 재던 것과 같은 함정이다. */
export interface HabitReading {
  corner: number;
  anchor: number;
  dashUptime: number;
}

export type Verdict = 'HIT' | 'BROKEN' | 'VOID';

export interface HabitDef {
  /** 플레이어에게 보여줄 명제. 항상 "못 버린다" 형태 — 깨는 것이 플레이어의 수다. */
  claim: string;
  /** 미터 옆 라벨 */
  label: string;
  threshold: number;
  read(r: HabitReading): number;
  /** 이 변주가 걸린 웨이브에서는 판정을 무효로 한다 — 지표를 디렉터가 강제하기 때문. */
  voidedBy: readonly Mutation[];
  /** 근거 수치 표시. 왜 그렇게 판정됐는지 눈으로 따라갈 수 있어야 정산이 된다. */
  evidence(r: HabitReading): string;
}

/**
 * ⚠ 임계값은 **잠정**이다. 계측 훅으로 실제 런의 분포를 본 뒤 확정한다.
 * 초안의 임계는 스펙 예시에 적힌 숫자에서 가져왔는데 그게 실측이 아니었다 —
 * 같은 실수를 반복하지 않기 위해 여기에 근거를 남긴다.
 *
 * 실측 참고(`docs/verification/2026-08-08-telemetry-traps.md`, 웨이브 전체 기준):
 *   원 궤도 키팅 corner 0.25 / anchor 0.10 · 구석 캠핑 corner 1.00 / anchor 0.49
 *   외곽 순찰 corner 0.29 / anchor 0.06 · 우측 절반만 corner 0.51 / anchor 0.15
 * 창 기준(12초)은 이보다 높게 나온다 — 짧은 구간일수록 편중이 커지므로 상향이 필요할 수 있다.
 */
export const HABITS: Record<HabitId, HabitDef> = {
  // 우선순위 1. hotspotConcentration ≤ max(quadrantTime)가 항상 성립하므로(격자가 사분면에 내포)
  // 초과율로 비교하면 ANCHOR가 원리적으로 못 이긴다 — 우선순위를 고정한다.
  ANCHOR: {
    claim: '너는 한자리에 뿌리내렸다',
    label: '한자리',
    // 실측 분리: 구석 캠핑 0.37~0.42 · 정지 1.00 vs 원 궤도 0.13 · 외곽 순찰 0.06.
    // 0.30이면 느슨한 캠퍼도 잡으면서 이동형과 2배 이상 여유가 남는다.
    threshold: 0.30,
    read: (r) => r.anchor,
    voidedBy: ['LAVA_HOTSPOT'],
    evidence: (r) => `한 지점 체류 ${Math.round(r.anchor * 100)}%`,
  },
  CORNER: {
    claim: '너는 그 구석을 떠나지 않는다',
    label: '한 구석',
    // 균등 분포가 0.25다. 0.40은 잘 움직이는 궤적(전면 이동 0.33~0.42)과 겹쳐 선택이 튀었다 —
    // 습관이 아니라 이동 자체를 잡는 셈이라 WALL과 같은 실패였다. 0.48이면 진짜 반쪽 캠핑
    // (우측 절반만 0.51~0.57)만 걸리고 전면 이동은 안 걸린다.
    threshold: 0.48,
    read: (r) => r.corner,
    // LAVA_LEFT/RIGHT의 경계가 사분면 경계와 같은 선이라, 용암을 피하면 비둘기집 원리로
    // max(quadrantTime) ≥ 0.50이 확정된다. 플레이어의 행동과 무관한 적중이 된다.
    voidedBy: ['LAVA_LEFT', 'LAVA_RIGHT'],
    evidence: (r) => `한 사분면 체류 ${Math.round(r.corner * 100)}%`,
  },
  DASH: {
    claim: '너는 대시에 의존한다',
    label: '대시',
    // 쿨다운 가동률이다 — 카운트는 웨이브 길이를, 절대 비율은 업그레이드 상태를 재게 된다.
    // 0.65 = 쓸 수 있을 때의 2/3 이상을 쓴다 = "의존한다". 쿨다운이 줄어도 정의가 안 흔들린다.
    threshold: 0.65,
    read: (r) => r.dashUptime,
    voidedBy: [],
    evidence: (r) => `대시 가동률 ${Math.round(r.dashUptime * 100)}%`,
  },
};

/** 히스테리시스 계수 — 지표가 소수 2자리로 반올림돼 임계에 걸친 값이 행동 없이 뒤집힌다. */
export const BROKEN_RATIO = 0.85;

/**
 * 지배적 습관 1개를 고른다. 초과율 비교가 아니라 **우선순위 고정**이다(위 ANCHOR 주석 참조).
 * 아무것도 임계를 못 넘으면 null — 잘 움직이는 플레이어에게는 이게 정상이고 "읽을 게 없다"는 칭찬이다.
 *
 * 직전 라운드와 같은 습관은 피한다(변주·강화·봉인이 전부 2연속 금지인 것과 같은 규칙).
 * 단 그것 말고 넘긴 게 없으면 그대로 쓴다 — 억지로 다른 걸 고르면 임계 미달을 예측하게 된다.
 */
export function detectHabit(r: HabitReading, prevHabit: HabitId | null = null): HabitId | null {
  const over = HABIT_IDS.filter((id) => HABITS[id].read(r) >= HABITS[id].threshold);
  if (over.length === 0) return null;
  const fresh = over.filter((id) => id !== prevHabit);
  return (fresh.length > 0 ? fresh : over)[0];
}

/**
 * 예측을 채점한다.
 * - 여전히 임계 이상 → HIT (디렉터가 읽었다)
 * - 임계 × 0.85 아래 → BROKEN (플레이어가 적응했다)
 * - 그 사이 → VOID (반올림 잡음 구간)
 * - 디렉터의 변주가 지표를 강제한 웨이브 → VOID (디렉터가 자기 손으로 판정을 정하는 것을 막는다)
 */
export function judge(habit: HabitId, r: HabitReading, mutation: Mutation): Verdict {
  const def = HABITS[habit];
  if (def.voidedBy.includes(mutation)) return 'VOID';
  const v = def.read(r);
  if (v >= def.threshold) return 'HIT';
  if (v < def.threshold * BROKEN_RATIO) return 'BROKEN';
  return 'VOID';
}

/** 미터 채움 비율 (0~1.2로 클램프 — 임계를 크게 넘겨도 막대가 터지지 않게). */
export function meterFill(habit: HabitId, r: HabitReading): number {
  const def = HABITS[habit];
  return Math.max(0, Math.min(1.2, def.read(r) / def.threshold));
}

export const VOID_REASON = '구역이 재설계됐다';
