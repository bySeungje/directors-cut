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
}

/** ArenaScene이 넘긴 원재료(result·waveLogs·upgrades)로 리포트 입력을 조립한다.
 *  EndScene의 통계 한 줄 표시와 requestReport 호출이 이 결과를 함께 쓴다(집계 로직 중복 방지). */
export function buildRunSummary(result: 'WIN' | 'LOSE', waves: WaveLog[], upgrades: string[]): RunSummary {
  const totalKills = waves.reduce(
    (sum, w) => sum + Object.values(w.combat.kills).reduce((s, n) => s + (n ?? 0), 0),
    0,
  );
  const avgAccuracy = waves.length ? waves.reduce((s, w) => s + w.combat.accuracy, 0) / waves.length : 0;
  const totalDashCount = waves.reduce((s, w) => s + w.movement.dashCount, 0);
  const wavesReached = waves.length ? waves[waves.length - 1].wave : 0;
  return { result, wavesReached, waves, upgrades, totalKills, avgAccuracy, totalDashCount };
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
      ? `인정한다. ${s.wavesReached}웨이브, 전부 넘었다. 이번 판에서 ${s.totalKills}기를 처리했고 명중률은 ${accuracyPct}%였다 — 낮은 수치가 아니다. 대시 ${s.totalDashCount}회, 판단은 나쁘지 않았다. 다음 설계는 이렇게 순순히 두지 않겠다. 다시 마주치길 기다리겠다.`
      : `여기까지다. ${s.wavesReached}웨이브에서 판이 끝났다. ${s.totalKills}기를 처리하고 명중률 ${accuracyPct}%를 기록했지만, 그걸로는 부족했다. 대시 ${s.totalDashCount}회 — 아꼈어야 했는지 더 썼어야 했는지는 다음 판에서 증명해라. 편집은 여기까지, 다시 앉아라.`;
  return `${body}\n칭호: ${title}`;
}
