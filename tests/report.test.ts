import { describe, it, expect, vi, afterEach } from 'vitest';
import { requestReport, buildRunSummary, splitReportTitle, pickFallbackTitle, type RunSummary } from '../src/director/report';
import type { WaveLog } from '../src/contracts/directive';

const fakeWave = (over: Partial<WaveLog> = {}): WaveLog => ({
  wave: 1,
  clearTimeSec: 30,
  hpLost: 0,
  damageSources: {},
  movement: { quadrantTime: { NW: 0.25, NE: 0.25, SW: 0.25, SE: 0.25 }, wallHugRatio: 0.2, dashCount: 3, hotspotConcentration: 0 },
  combat: { kills: { chaser: 5 }, accuracy: 0.6, clusterRatio: 0 },
  upgrades: [],
  prevMutations: [],
  ...over,
});

afterEach(() => vi.unstubAllGlobals());

describe('buildRunSummary', () => {
  it('킬·명중률·대시·도달 웨이브를 웨이브 로그에서 집계한다', () => {
    const waves = [
      fakeWave({ wave: 1, combat: { kills: { chaser: 5 }, accuracy: 0.5, clusterRatio: 0 }, movement: { quadrantTime: { NW: 1, NE: 0, SW: 0, SE: 0 }, wallHugRatio: 0.2, dashCount: 2, hotspotConcentration: 0 } }),
      fakeWave({ wave: 2, combat: { kills: { shooter: 3, splitter: 2 }, accuracy: 0.9, clusterRatio: 0 }, movement: { quadrantTime: { NW: 1, NE: 0, SW: 0, SE: 0 }, wallHugRatio: 0.4, dashCount: 4, hotspotConcentration: 0 } }),
    ];
    const s = buildRunSummary('WIN', waves, ['DAMAGE_UP']);
    expect(s.totalKills).toBe(10);
    expect(s.avgAccuracy).toBeCloseTo(0.7);
    expect(s.totalDashCount).toBe(6);
    expect(s.wavesReached).toBe(2);
    expect(s.upgrades).toEqual(['DAMAGE_UP']);
  });

  it('웨이브 로그가 비어도(이론상 도달 불가지만 방어적으로) 0으로 집계한다', () => {
    const s = buildRunSummary('LOSE', [], []);
    expect(s.totalKills).toBe(0);
    expect(s.avgAccuracy).toBe(0);
    expect(s.totalDashCount).toBe(0);
    expect(s.wavesReached).toBe(0);
  });
});

describe('requestReport', () => {
  const summary: RunSummary = buildRunSummary('WIN', [fakeWave()], []);

  it('정상 응답이면 LLM 리포트 텍스트를 그대로 반환', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ report: '테스트 리포트\n칭호: 테스트' }))));
    const r = await requestReport(summary);
    expect(r).toContain('칭호: 테스트');
  });

  it('네트워크 오류면 정적 폴백 텍스트 반환("칭호:" 줄 포함)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down'); }));
    const r = await requestReport(summary);
    expect(r).toContain('칭호:');
  });

  it('report 필드가 비어 있으면 폴백', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ report: '' }))));
    const r = await requestReport(summary);
    expect(r).toContain('칭호:');
  });

  it('8초 초과면 폴백', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((_u, opts: any) => new Promise((_res, rej) => {
      opts.signal.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')));
    })));
    const p = requestReport(summary);
    await vi.advanceTimersByTimeAsync(8100);
    const r = await p;
    expect(r).toContain('칭호:');
    vi.useRealTimers();
  });
});

describe('splitReportTitle', () => {
  const summary: RunSummary = buildRunSummary('WIN', [fakeWave()], []);

  it('"칭호: X" 마지막 줄을 본문과 분리한다', () => {
    const { body, title } = splitReportTitle('첫 줄\n둘째 줄\n칭호: 벽면 곡예사', summary);
    expect(title).toBe('벽면 곡예사');
    expect(body).toBe('첫 줄\n둘째 줄');
  });

  it('전각 콜론(：)도 인식한다', () => {
    const { title } = splitReportTitle('본문\n칭호：전각 테스트', summary);
    expect(title).toBe('전각 테스트');
  });

  it('「 」로 이미 감싸져 있으면 벗겨서 저장한다(EndScene이 자체적으로 다시 감싸므로)', () => {
    const { title } = splitReportTitle('본문\n칭호: 「 감싼 칭호 」', summary);
    expect(title).toBe('감싼 칭호');
  });

  it('마커가 없으면 통계 기반 폴백 칭호로 보강한다', () => {
    const { body, title } = splitReportTitle('마커 없는 텍스트', summary);
    expect(body).toBe('마커 없는 텍스트');
    expect(title).toBe(pickFallbackTitle(summary));
  });
});

describe('pickFallbackTitle', () => {
  it('wallHug 평균 0.5 이상이면 "벽면 곡예사"', () => {
    const s = buildRunSummary('WIN', [fakeWave({ movement: { quadrantTime: { NW: 1, NE: 0, SW: 0, SE: 0 }, wallHugRatio: 0.6, dashCount: 0, hotspotConcentration: 0 } })], []);
    expect(pickFallbackTitle(s)).toBe('벽면 곡예사');
  });
  it('대시 합 40 이상이면 "회피 기동 전문"', () => {
    const s = buildRunSummary('WIN', [fakeWave({ movement: { quadrantTime: { NW: 1, NE: 0, SW: 0, SE: 0 }, wallHugRatio: 0.1, dashCount: 45, hotspotConcentration: 0 } })], []);
    expect(pickFallbackTitle(s)).toBe('회피 기동 전문');
  });
  it('명중률 0.7 이상이면 "정밀 사수"', () => {
    const s = buildRunSummary('WIN', [fakeWave({ combat: { kills: {}, accuracy: 0.8, clusterRatio: 0 }, movement: { quadrantTime: { NW: 1, NE: 0, SW: 0, SE: 0 }, wallHugRatio: 0.1, dashCount: 0, hotspotConcentration: 0 } })], []);
    expect(pickFallbackTitle(s)).toBe('정밀 사수');
  });
  it('아무 규칙도 안 맞으면 "생존자"', () => {
    const s = buildRunSummary('WIN', [fakeWave({ combat: { kills: {}, accuracy: 0.3, clusterRatio: 0 }, movement: { quadrantTime: { NW: 1, NE: 0, SW: 0, SE: 0 }, wallHugRatio: 0.1, dashCount: 0, hotspotConcentration: 0 } })], []);
    expect(pickFallbackTitle(s)).toBe('생존자');
  });
});
