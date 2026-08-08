import type { ReportInput, SessionDirective, SessionInput } from '../contracts/directive';
import { validateSessionDirective } from './validator';

// ── 프록시 클라이언트 v2 (스펙 §3.4) ────────────────────────────────────────
// 호출 예산: 런당 4회 = 읽기 세션 2 + 최종 리포트 1 + 타이틀 워밍업 1.
// 실패·타임아웃·검증 실패 → null 반환, 호출측이 조립형 폴백 사용. 게임은 절대 멈추지 않는다.

const TIMEOUT_MS = 4000;
const REPORT_TIMEOUT_MS = 8000;
const DIRECTOR_URL: string | undefined = import.meta.env?.VITE_DIRECTOR_URL;
export const sessionId = crypto.randomUUID();

async function post(body: Record<string, unknown>, timeoutMs: number): Promise<unknown | null> {
  if (!DIRECTOR_URL) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(DIRECTOR_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...body, sessionId }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`status ${res.status}`);
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** 읽기 세션 — null이면 호출측이 assembleSessionFallback 사용 */
export async function requestSessionDirective(input: SessionInput): Promise<SessionDirective | null> {
  const body = await post({ mode: 'session', input }, TIMEOUT_MS);
  if (!body || typeof body !== 'object') return null;
  const raw = (body as { directive?: unknown }).directive;
  return validateSessionDirective(raw, input.candidates.map((c) => c.id));
}

/** 최종 리포트 — null이면 호출측이 assembleReport 사용 */
export async function requestReport(input: ReportInput): Promise<{ body: string; title: string } | null> {
  const body = await post({ mode: 'report', input }, REPORT_TIMEOUT_MS);
  if (!body || typeof body !== 'object') return null;
  const r = body as { report?: unknown; title?: unknown };
  if (typeof r.report !== 'string' || r.report.length === 0) return null;
  const title = typeof r.title === 'string' && r.title.length > 0 ? r.title.slice(0, 12) : null;
  return { body: r.report.slice(0, 460), title: title ?? '이름 없는 손' };
}

/** 타이틀 진입 시 1회 비동기 워밍업(전작 amendment 승계) — 프록시·모델 콜드스타트를 데운다.
 *  결과는 버리고 실패는 무시. 세션 캡 미산입(warmup 플래그), 일일 캡 산입. */
export function warmUpDirector(): void {
  if (!DIRECTOR_URL) return;
  try {
    fetch(DIRECTOR_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'warmup', sessionId, warmup: true }),
    }).catch(() => {});
  } catch {
    // fetch 동기 예외 방어 — 워밍업 실패는 절대 게임을 막지 않는다
  }
}
