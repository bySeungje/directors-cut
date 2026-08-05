import { Directive, Mutation, WaveLog } from '../contracts/directive';
import { validateDirective, budgetFor } from './validator';
import { pickFallback } from './fallbackBank';

const TIMEOUT_MS = 4000;
const DIRECTOR_URL: string | undefined = import.meta.env?.VITE_DIRECTOR_URL;
export const sessionId = crypto.randomUUID();

// 워밍업 전용 더미 로그 — 실플레이 로그가 없는 타이틀 화면에서 보내는 최소 유효 형태(스펙 3.4 amendment).
const WARMUP_LOG: WaveLog = {
  wave: 1, clearTimeSec: 0, hpLost: 0, damageSources: {},
  movement: { quadrantTime: { NW: 0, NE: 0, SW: 0, SE: 0 }, wallHugRatio: 0, dashCount: 0 },
  combat: { kills: {}, accuracy: 0 }, upgrades: [], prevMutations: [],
};

export async function requestDirective(
  log: WaveLog, wave: number, prevMutation: Mutation,
): Promise<{ directive: Directive; fromLLM: boolean }> {
  if (!DIRECTOR_URL) return { directive: pickFallback(wave, prevMutation), fromLLM: false };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(DIRECTOR_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'directive', log, wave, budget: budgetFor(wave), prevMutation, sessionId }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const body = await res.json();
    const valid = validateDirective(body.directive, wave, prevMutation);
    if (!valid) throw new Error('invalid directive');
    return { directive: valid, fromLLM: true };
  } catch {
    return { directive: pickFallback(wave, prevMutation), fromLLM: false };
  } finally {
    clearTimeout(timer);
  }
}

/** 타이틀 화면 진입 시 1회 비동기 발사하는 워밍업 호출(스펙 3.4 amendment) — 응답은 버린다.
 *  하루 첫 실호출이 API 최초 스키마 컴파일+Edge Function 콜드스타트와 겹쳐 4초 타임아웃을 넘기는 사고를
 *  막기 위해, 플레이어가 실제로 웨이브 1→2 인터벌에 도달하기 전에 프록시·모델 경로를 미리 데운다.
 *  결과를 기다리지 않고 실패해도 무시한다 — 게임 흐름에 어떤 영향도 주지 않는다.
 *  세션 캡에는 산입하지 않도록 warmup 플래그를 함께 보낸다(일일 캡에는 산입 — 프록시 측 처리). */
export function warmUpDirector(): void {
  if (!DIRECTOR_URL) return;
  try {
    fetch(DIRECTOR_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        mode: 'directive', log: WARMUP_LOG, wave: 1, budget: budgetFor(1), prevMutation: 'NONE',
        sessionId, warmup: true,
      }),
    }).catch(() => {});
  } catch {
    // fetch 동기 예외 방어 — 워밍업 실패는 절대 게임을 막지 않는다
  }
}
