import { Directive, Mutation, WaveLog } from '../contracts/directive';
import { validateDirective, budgetFor } from './validator';
import { pickFallback } from './fallbackBank';

const TIMEOUT_MS = 4000;
const DIRECTOR_URL: string | undefined = import.meta.env?.VITE_DIRECTOR_URL;
export const sessionId = crypto.randomUUID();

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
