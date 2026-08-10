import type { HabitId } from '../contracts/directive';

/**
 * 로컬 기억 — **"너는 아까도 바로 여기서 죽었다".**
 *
 * 이 게임의 차별점은 AI가 *이 사람*을 읽는다는 것인데, 한 판 안의 읽기는 12초 창이 전부라 판이 끝나면
 * 사라진다. 심사자는 대개 1~2판만 한다 — 그 두 판을 잇는 것이 가장 싸고 가장 개인적인 기억이다.
 * 교차 플레이어 누적(Supabase)보다 확실하게 발동하고, 콘솔 작업이 필요 없다.
 *
 * **개인식별정보를 저장하지 않는다.** 남기는 것은 도달 웨이브·사망 격자셀(좌표 아님)·지목된 습관뿐이고,
 * IP·핑거프린트·시각은 남기지 않는다. 저장소는 주입식이라 프라이빗 모드나 저장소 차단 환경에서도
 * 게임이 그대로 성립한다(읽기·쓰기 실패는 조용히 무시하고 기억 없이 진행).
 *
 * Phaser를 import하지 않는다(habits·fireRule·warning·settlement와 같은 이유).
 */

export const MEMORY_KEY = 'dc.runs.v1';
/** 보관 상한 — 이보다 오래된 런은 버린다. 무한히 쌓을 이유가 없고 저장소 한도를 넘기면 안 된다. */
export const MAX_RUNS = 20;

export interface RunRecord {
  /** 도달한 웨이브(1-indexed) */
  wave: number;
  /** 사망 지점의 히트맵 격자 셀 인덱스. 좌표가 아니라 셀이라 "바로 여기"의 해상도가 사람 감각과 맞는다.
   *  클리어로 끝났으면 null. */
  deathCell: number | null;
  /** 이 런에서 디렉터가 지목한 습관들(중복 포함, 순서 유지) */
  habits: HabitId[];
  result: 'WIN' | 'LOSE';
}

/** 최소한의 저장소 인터페이스 — 테스트에서 가짜를 넣고, 브라우저에서는 localStorage를 넣는다. */
export interface MemoryStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** 저장된 런들. 파싱 실패·저장소 부재는 빈 배열로 — 기억이 없는 것은 오류가 아니다. */
export function loadRuns(store: MemoryStore | null | undefined): RunRecord[] {
  if (!store) return [];
  try {
    const raw = store.getItem(MEMORY_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // 형태가 어긋난 항목은 버린다 — 옛 버전 데이터가 화면에 거짓을 만들지 않게.
    return parsed.filter((r): r is RunRecord =>
      !!r && typeof r === 'object'
      && typeof (r as RunRecord).wave === 'number'
      && Array.isArray((r as RunRecord).habits));
  } catch {
    return [];
  }
}

/** 이번 런을 덧붙여 저장하고, 저장 후의 전체 목록을 돌려준다. 실패해도 던지지 않는다. */
export function saveRun(store: MemoryStore | null | undefined, rec: RunRecord): RunRecord[] {
  const runs = [...loadRuns(store), rec].slice(-MAX_RUNS);
  try {
    store?.setItem(MEMORY_KEY, JSON.stringify(runs));
  } catch {
    /* 저장 실패는 무시 — 기억이 없어도 게임은 성립한다 */
  }
  return runs;
}

/** 같은 셀에서 죽은 횟수(이번 런 포함). 이전 기록이 없으면 1. */
export function deathsAtCell(runs: readonly RunRecord[], cell: number | null): number {
  if (cell === null) return 0;
  return runs.filter((r) => r.deathCell === cell).length;
}

/** 이 습관이 **연속 몇 판째** 지목됐는가(이번 런 포함). 끊기면 1부터 다시 센다 —
 *  "3판째 같은 쪽으로 돈다"는 연속일 때만 참이다. */
export function habitStreak(runs: readonly RunRecord[], habit: HabitId | null): number {
  if (!habit) return 0;
  let n = 0;
  for (let i = runs.length - 1; i >= 0; i--) {
    if (runs[i].habits.includes(habit)) n++;
    else break;
  }
  return n;
}

/**
 * 사망 화면에 띄울 기억 한 줄. 없으면 null — **없는 기억을 지어내지 않는다.**
 *
 * 우선순위는 "더 개인적인 것" 순이다: 같은 자리 반복 > 같은 습관 반복 > 도전 횟수.
 */
export function recallLine(runs: readonly RunRecord[], cell: number | null, habit: HabitId | null): string | null {
  const sameSpot = deathsAtCell(runs, cell);
  if (sameSpot >= 2) return `너는 아까도 바로 여기서 죽었다  (${sameSpot}번째)`;

  const streak = habitStreak(runs, habit);
  if (streak >= 2 && habit) return `${streak}판째 같은 습관이다  (${HABIT_WORD[habit]})`;

  // 두 번째 판부터 말한다 — 심사자가 딱 두 판만 해도 이 기능이 화면에 존재해야 한다
  // (2026-08-10 Playwright 실측: 문턱이 한 칸 높아 2판째에 아무것도 안 떴다).
  if (runs.length >= 1) return `${runs.length + 1}번째 도전이다. 나는 전부 기억한다`;
  return null;
}

/** 기억 문장에 쓰는 습관의 짧은 이름. 화면 문장이 길어지지 않게 라벨만 쓴다. */
const HABIT_WORD: Record<HabitId, string> = {
  ANCHOR: '한자리',
  CORNER: '한 구석',
  ORBIT: '같은 쪽 선회',
  MICRO: '제자리 흔들기',
  DASH: '대시 의존',
};

/** 브라우저 저장소를 안전하게 얻는다. 차단·부재 시 null — 호출부는 기억 없이 진행하면 된다. */
export function browserStore(): MemoryStore | null {
  try {
    const ls = globalThis.localStorage;
    if (!ls) return null;
    ls.getItem(MEMORY_KEY); // 접근 자체가 던지는 환경(프라이빗 모드 등)을 여기서 걸러낸다
    return ls;
  } catch {
    return null;
  }
}
