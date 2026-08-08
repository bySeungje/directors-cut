import { WaveLog } from '../contracts/directive';
import { sessionId } from './client';

// client.ts와 동일 패턴(요청·타임아웃·무음 폴백) — 타임아웃만 리포트용으로 8초(브리프 명시).
const TIMEOUT_MS = 8000;
const DIRECTOR_URL: string | undefined = import.meta.env?.VITE_DIRECTOR_URL;

export interface RunSummary {
  result: 'WIN' | 'LOSE';
  wavesReached: number;
  waves: WaveLog[];
  upgrades: string[];
  totalKills: number;
  avgAccuracy: number;
  totalDashCount: number;
  /** 예측 판정 누계(디렉터 : 당신). 승패와 별개 축이다 — 지면서 이길 수 있다.
   *  선택 필드로 둔다: 기존 호출부 8곳이 3인자로 부르고 있어 필수로 만들면 타입체크가 깨진다. */
  verdicts?: { director: number; player: number };
  /** 런에서 디렉터가 지목한 습관 순서. 리포트가 "무엇을 읽혔는지"를 말할 재료. */
  habitsRead?: string[];
}

/** ArenaScene이 넘긴 원재료(result·waveLogs·upgrades)로 리포트 입력을 조립한다.
 *  EndScene의 통계 한 줄 표시와 requestReport 호출이 이 결과를 함께 쓴다(집계 로직 중복 방지). */
export function buildRunSummary(
  result: 'WIN' | 'LOSE',
  waves: WaveLog[],
  upgrades: string[],
  verdicts?: { director: number; player: number },
): RunSummary {
  const totalKills = waves.reduce(
    (sum, w) => sum + Object.values(w.combat.kills).reduce((s, n) => s + (n ?? 0), 0),
    0,
  );
  const avgAccuracy = waves.length ? waves.reduce((s, w) => s + w.combat.accuracy, 0) / waves.length : 0;
  const totalDashCount = waves.reduce((s, w) => s + w.movement.dashCount, 0);
  const wavesReached = waves.length ? waves[waves.length - 1].wave : 0;
  const habitsRead = waves.map((w) => w.dominantHabit).filter((h): h is NonNullable<typeof h> => !!h);
  return { result, wavesReached, waves, upgrades, totalKills, avgAccuracy, totalDashCount, verdicts, habitsRead };
}

/** 엔드게임 리포트 요청 — 8초 내 반드시 resolve(실패 시 정적 폴백 템플릿). */
export async function requestReport(summary: RunSummary): Promise<string> {
  if (!DIRECTOR_URL) return staticReport(summary);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(DIRECTOR_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'report', runSummary: summary, sessionId }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const body = await res.json();
    if (typeof body.report !== 'string' || !body.report.trim()) throw new Error('empty report');
    return body.report;
  } catch {
    return staticReport(summary);
  } finally {
    clearTimeout(timer);
  }
}

/** 리포트 원문(LLM·폴백 공통)의 마지막 줄 "칭호: X" 형식에서 본문/칭호를 분리한다.
 *  마커가 없으면(LLM이 형식을 어겼을 때) 전체를 본문으로 두고 통계 기반 규칙으로 칭호를 보강한다 —
 *  EndScene이 항상 칭호 박스를 채울 수 있게 하는 안전망(디렉터 계약과 동일한 "LLM은 절대 게임을 막지 않는다" 원칙). */
export function splitReportTitle(raw: string, summary: RunSummary): { body: string; title: string } {
  const trimmed = raw.trim();
  const lines = trimmed.split(/\r?\n/);
  const last = lines[lines.length - 1] ?? '';
  const m = last.match(/^\s*칭호\s*[:：]\s*(.+?)\s*$/);
  if (!m) return { body: trimmed, title: pickFallbackTitle(summary) };
  const title = m[1].replace(/^[「『['"]+/, '').replace(/[」』\]'"]+$/, '').trim();
  return { body: lines.slice(0, -1).join('\n').trim(), title: title || pickFallbackTitle(summary) };
}

// 폴백 칭호 — 통계 기반 룰(위에서부터 첫 매치). 특정 습관을 "지목"하지 않는다(무음 폴백 원칙, fallbackBank.ts와 동일 톤).
export function pickFallbackTitle(summary: RunSummary): string {
  const wallHugAvg = summary.waves.length
    ? summary.waves.reduce((s, w) => s + w.movement.wallHugRatio, 0) / summary.waves.length
    : 0;
  if (wallHugAvg >= 0.5) return '벽면 곡예사';
  if (summary.totalDashCount >= 40) return '회피 기동 전문';
  if (summary.avgAccuracy >= 0.7) return '정밀 사수';
  return '생존자';
}

function staticReport(s: RunSummary): string {
  const accuracyPct = Math.round(s.avgAccuracy * 100);
  const title = pickFallbackTitle(s);
  const body =
    s.result === 'WIN'
      ? `인정한다. ${s.wavesReached}개 보안 구역을 전부 돌파했다. 이번 탈출에서 ${s.totalKills}기를 처리했고 명중률은 ${accuracyPct}%였다. 대시 ${s.totalDashCount}회, 판단은 나쁘지 않았다. 다음 시설은 이렇게 열어두지 않겠다.`
      : `봉쇄 완료. ${s.wavesReached}번째 보안 구역에서 탈출이 중단됐다. ${s.totalKills}기를 처리하고 명중률 ${accuracyPct}%를 기록했지만, 중앙 통제실에는 닿지 못했다. 대시 ${s.totalDashCount}회 — 다음 시도에서는 그 습관부터 봉쇄하겠다.`;
  // 읽기 대결 결과는 승패와 별개 축이라 한 문장을 따로 붙인다. 판정이 한 번도 없었으면 생략한다
  // (잘 움직여서 읽을 습관이 없었던 런 — 그것 자체가 디렉터에게 할 말이 된다).
  const v = s.verdicts;
  const read = !v || v.director + v.player === 0
    ? ' 읽을 탈출 습관이 없었다. 그건 인정하겠다.'
    : v.player > v.director
      ? ` 패턴 읽기는 ${v.player} 대 ${v.director}으로 내가 졌다. 습관을 버릴 줄 아는 탈옥자로군.`
      : v.player === v.director
        ? ` 패턴 읽기는 ${v.director} 대 ${v.player}, 비겼다.`
        : ` 패턴 읽기는 ${v.director} 대 ${v.player}. 나는 당신을 ${v.director}번 맞췄다.`;
  return `${body}${read}\n칭호: ${title}`;
}
