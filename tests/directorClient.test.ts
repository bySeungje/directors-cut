import { describe, it, expect, vi, afterEach } from 'vitest';
import { requestDirective, warmUpDirector } from '../src/director/client';

const okDirective = {
  composition: [{ type: 'chaser', count: 5, spawn: 'N', elite: false }],
  mutation: 'FOG', taunt: '벽을 좋아하는군.', intent: '벽 차단',
};
const fakeLog: any = { wave: 2, clearTimeSec: 30, hpLost: 0, damageSources: {}, movement: { quadrantTime: { NW: 1, NE: 0, SW: 0, SE: 0 }, wallHugRatio: 0.8, dashCount: 2 }, combat: { kills: {}, accuracy: 0.5 }, upgrades: [], prevMutations: [] };

afterEach(() => vi.unstubAllGlobals());

describe('requestDirective', () => {
  it('정상 응답이면 LLM 디렉티브 반환', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ directive: okDirective }))));
    const r = await requestDirective(fakeLog, 3, 'NONE');
    expect(r.fromLLM).toBe(true);
    expect(r.directive.taunt).toContain('벽');
  });
  it('네트워크 오류면 폴백', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down'); }));
    const r = await requestDirective(fakeLog, 3, 'NONE');
    expect(r.fromLLM).toBe(false);
  });
  it('스키마 위반 응답이면 폴백', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ directive: { mutation: 'EARTHQUAKE' } }))));
    const r = await requestDirective(fakeLog, 3, 'NONE');
    expect(r.fromLLM).toBe(false);
  });
  it('4초 초과면 폴백', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((_u, opts: any) => new Promise((_res, rej) => {
      opts.signal.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')));
    })));
    const p = requestDirective(fakeLog, 3, 'NONE');
    await vi.advanceTimersByTimeAsync(4100);
    const r = await p;
    expect(r.fromLLM).toBe(false);
    vi.useRealTimers();
  });
});

describe('warmUpDirector', () => {
  it('mode:directive + warmup:true로 발사하고 응답을 기다리지 않는다(동기 반환)', () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ directive: okDirective })));
    vi.stubGlobal('fetch', fetchMock);
    expect(() => warmUpDirector()).not.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
    expect(body.mode).toBe('directive');
    expect(body.warmup).toBe(true);
  });
  it('네트워크 오류가 나도 예외를 던지지 않는다(무음 실패)', () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down'); }));
    expect(() => warmUpDirector()).not.toThrow();
  });
});
