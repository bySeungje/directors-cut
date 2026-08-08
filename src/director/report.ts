import type { PatternId, ReportInput } from '../contracts/directive';

// ── 최종 리포트 (스펙 §3.4) — LLM 경로는 client.ts, 이 파일은 조립형 폴백과 공용 유틸 ──
// 폴백도 통계 기반 조립이다(정적 단일 템플릿 금지, 리뷰 should-fix): 심사자의 마지막
// 화면이 리포트이므로, 프록시 장애·캡 도달에서도 "실제 플레이를 읽은 문장"이 나와야 한다.

const PATTERN_KO: Record<PatternId, string> = {
  FREQ: '한쪽 문 편애',
  ALTERNATE: '번갈아 고르는 손버릇',
  SEQUENCE: '자기도 모르는 3수 리듬',
  AFTER_CAUGHT: '잡힌 직후의 도망 반사',
};

export function assembleReport(r: ReportInput): { body: string; title: string } {
  const caughtRate = r.roundsPlayed > 0 ? r.caughtCount / r.roundsPlayed : 0;
  const topPattern = (Object.entries(r.caughtByPattern) as [PatternId, number][]).sort((a, b) => b[1] - a[1])[0];
  const windowSkill = r.windowRounds > 0 ? r.windowPasses / r.windowRounds : 0;

  const lines: string[] = [];
  if (r.result === 'WIN') {
    lines.push(`${r.bank}. 목표를 넘겼다. 인정한다 — 이번 판은 네가 나를 읽었다.`);
  } else if (r.earlyEnd === 'DEAD_END') {
    lines.push(`${r.roundsPlayed}라운드 만에 수학이 끝났다. 남은 금고를 다 열어도 ${r.target}에 못 닿는다.`);
  } else {
    lines.push(`최종 ${r.bank}. 목표 ${r.target}. 부족분만큼이 네 버릇의 가격이다.`);
  }
  lines.push(`나는 너를 ${r.caughtCount}번 예측했다(${Math.round(caughtRate * 100)}%).`);
  if (topPattern && topPattern[1] > 0) lines.push(`가장 많이 읽힌 건 ${PATTERN_KO[topPattern[0]]} — ${topPattern[1]}번.`);
  if (r.windowRounds > 0) {
    lines.push(
      windowSkill >= 0.5
        ? `내가 패를 보여준 ${r.windowRounds}번 중 ${r.windowPasses}번을 받아쳤다. 선언을 듣는 귀가 있군.`
        : `패를 보여줘도 ${r.windowRounds}번 중 ${r.windowRounds - r.windowPasses}번을 그대로 걸렸다. 내 말을 흘려듣는 타입.`,
    );
  }
  if (r.greedRounds >= 3) lines.push(`스트릭 3 이상으로 ${r.greedRounds}번을 더 밀었다. 욕심은 좋은 먹잇감이다.`);
  else if (r.settleCount >= 4) lines.push(`${r.settleCount}번을 잘게 정산했다. 겁이 많은 손이다.`);
  if (r.runCount > 1) lines.push(`${r.runCount}번째 도전. 네 버릇 장부는 그대로 갖고 있다.`);

  return { body: lines.join(' '), title: assembleTitle(r, caughtRate, windowSkill) };
}

function assembleTitle(r: ReportInput, caughtRate: number, windowSkill: number): string {
  if (r.result === 'WIN' && windowSkill >= 0.5) return '수읽기의 수읽기';
  if (r.result === 'WIN') return '간 큰 도둑';
  if (windowSkill >= 0.5) return '아까운 청개구리';
  if (r.greedRounds >= 3 && caughtRate >= 0.5) return '욕심 많은 단골';
  if (caughtRate >= 0.6) return '펼쳐진 책';
  if (r.earlyEnd === 'DEAD_END') return '수학 앞의 침묵';
  return '읽히는 중인 사람';
}
