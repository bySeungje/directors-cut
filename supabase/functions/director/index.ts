import Anthropic from 'npm:@anthropic-ai/sdk@0.115.0';

// DIRECTIVE_JSON_SCHEMA — src/contracts/directive.ts에서 복사한 사본 (수읽기 v2).
// Edge Function은 별도 번들이라 소스 파일을 import할 수 없다 — 계약(directive.ts) 변경 시 이 블록도 수동 동기화할 것 (CLAUDE.md 명시).
const DIRECTIVE_JSON_SCHEMA = {
  type: 'object',
  properties: {
    readPatternId: { type: 'string', enum: ['FREQ', 'ALTERNATE', 'SEQUENCE', 'AFTER_CAUGHT'] },
    read: { type: 'string' },
    taunt: { type: 'string' },
    strategy: { type: 'string', enum: ['BALANCED', 'PRIOR_HEAVY', 'RECENT_ONLY', 'PATTERN_HEAVY', 'CONTRARIAN', 'BAIT'] },
    baitDoor: { type: 'string', enum: ['L', 'R', 'NONE'] },
    intent: { type: 'string' },
  },
  required: ['readPatternId', 'read', 'taunt', 'strategy', 'baitDoor', 'intent'],
  additionalProperties: false,
} as const;

const client = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY')! });
const ALLOWED_ORIGIN = 'https://byseungje.github.io';
const MAX_CALLS_PER_SESSION = 20;
const MAX_CALLS_PER_DAY = 500; // Haiku 기준 최악 수천 원. 인스턴스 근사 — 하드캡은 Anthropic 콘솔 spend limit(승제 설정)
const sessionCounts = new Map<string, number>(); // 인스턴스 수명 내 근사 캡(콜드스타트 리셋 허용)
let dailyCount = { date: '', n: 0 };
function overDailyCap(): boolean {
  const today = new Date().toISOString().slice(0, 10);
  if (dailyCount.date !== today) dailyCount = { date: today, n: 0 };
  return ++dailyCount.n > MAX_CALLS_PER_DAY;
}

const SESSION_SYSTEM = `너는 심리전 게임 「수읽기」의 'AI 경비'다. 플레이어(도둑)는 금고 2개 중 덫이 없는 쪽을 고르고, 너는 매 라운드 플레이어의 선택 패턴을 통계 예측기로 읽어 덫을 걸어 왔다. 지금은 읽기 세션 — 네가 읽은 것을 플레이어의 면전에 선언하는 순간이다.

절대 규칙 (엔진이 검증하며, 위반 시 네 출력은 버려진다):
- readPatternId는 입력의 candidates 목록에 있는 id 중에서만 골라라. 목록 밖 선언은 날조로 간주된다.
- read(≤60자)는 고른 candidate의 evidence를 플레이어에게 말하듯 다듬은 것이어야 한다. evidence에 없는 새로운 주장·수치를 만들지 마라. 수치는 evidence의 것을 그대로 써라.
- 네 선언은 허세가 아니라 계약이다: 엔진은 다음 2라운드 동안 정말로 그 읽기대로만 덫을 건다("말한 읽기는 지킨다"). 플레이어가 선언을 역이용하면 뚫린다 — 그것이 이 게임의 스킬이다.

strategy 선택 (창 2라운드가 끝난 뒤의 덫 정책):
- 플레이어가 최근 너를 계속 뚫고 있다(caughtHistory 끝부분에 false 연속, 또는 이전 창을 역이용) → CONTRARIAN (예측의 반대를 건다 — 역이용을 읽는 수).
- 플레이어가 겁이 많다(settleCount 높고 greedRounds 낮음) → PATTERN_HEAVY 또는 RECENT_ONLY로 정밀하게.
- 자신 있으면 BAIT + baitDoor: **taunt에 반드시 그 문 이름(왼쪽/오른쪽)을 넣어** 흔들어라 (예: "다음엔 왼쪽이 안전할까?"). 엔진은 지목된 문을 피하는 편향을 노린다. 문 이름을 말할 수 없으면 BAIT를 고르지 마라.
- 확신이 없으면 BALANCED.

taunt(≤40자): 판돈 상황(bank/target/unsettled)이나 욕심을 찌르는 도발. 경비의 목소리 — 여유롭고 차갑게, 반말.
intent(≤80자): 이 선언·전략을 고른 근거. 화면엔 안 나가고 디렉터 로그·기술 문서용.
runCount가 2 이상이면 재도전자다 — 그 사실을 알은체해도 좋다.`;

const REPORT_SYSTEM = `너는 심리전 게임 「수읽기」의 'AI 경비'다. 방금 끝난 판의 집계를 보고 플레이어의 심리 프로파일 리포트를 한국어 400자 내외로 써라.
- 입력의 수치만 근거로 삼아라. 없는 사건을 만들지 마라.
- caughtByPattern은 "무엇에 읽혔나"(FREQ=한쪽 편애, ALTERNATE=번갈아 고르는 버릇, SEQUENCE=3수 리듬, AFTER_CAUGHT=잡힌 직후 반사)다.
- windowRounds/windowPasses는 네가 패를 보여준 약속 창에서의 성적 — 역이용 능력이다. 높으면 인정하고, 낮으면 "패를 보여줘도 못 받는다"고 찔러라.
- greedRounds가 높으면 욕심을, settleCount가 높으면 겁을 논평하라.
- 경비의 1인칭, 반말, 이겼으면 여유롭게, 졌으면 깔끔하게 인정.
- 마지막 줄에 "칭호: <4~8자>" 형식으로 칭호를 붙여라.`;

Deno.serve(async (req) => {
  const cors = {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Headers': 'content-type',
    'Content-Type': 'application/json',
  };
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  try {
    const { mode, input, sessionId, warmup } = await req.json();
    const used = sessionCounts.get(sessionId) ?? 0;
    // warmup(타이틀 사전 호출)은 세션 상한에 산입하지 않는다 — 일일 캡 검사는 동일하게 받는다(전작 amendment 승계).
    const overSessionCap = !warmup && used >= MAX_CALLS_PER_SESSION;
    if (overSessionCap || overDailyCap()) return new Response(JSON.stringify({ error: 'cap' }), { status: 429, headers: cors });
    if (!warmup) sessionCounts.set(sessionId, used + 1);

    if (mode === 'warmup') {
      // 모델·structured output 경로를 실제로 데운다 (최초 스키마 컴파일 + 콜드스타트 방지). 결과는 버려진다.
      await client.messages.create({
        model: 'claude-haiku-4-5',
        max_tokens: 200,
        system: SESSION_SYSTEM,
        output_config: { format: { type: 'json_schema', schema: DIRECTIVE_JSON_SCHEMA } },
        messages: [{ role: 'user', content: '워밍업 호출이다. candidates: [{"id":"FREQ","evidence":"3번 중 2번 왼쪽만 골랐다","score":0.5}]. 아무 유효한 디렉티브나 반환하라.' }],
      });
      return new Response(JSON.stringify({ ok: true }), { headers: cors });
    }

    if (mode === 'report') {
      const msg = await client.messages.create({
        model: 'claude-haiku-4-5',
        max_tokens: 700,
        system: REPORT_SYSTEM,
        messages: [{ role: 'user', content: JSON.stringify(input) }],
      });
      const text = msg.content.find((b) => b.type === 'text')?.text ?? '';
      // "칭호: xxx" 마지막 줄을 분리해 {report, title}로 반환 — 클라이언트는 파싱하지 않는다
      const m = text.match(/칭호\s*[:：]\s*(.+)\s*$/);
      const title = m ? m[1].trim().slice(0, 12) : null;
      const report = m ? text.slice(0, m.index).trim() : text.trim();
      return new Response(JSON.stringify({ report, title }), { headers: cors });
    }

    // mode === 'session'
    const msg = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 500,
      system: SESSION_SYSTEM,
      output_config: { format: { type: 'json_schema', schema: DIRECTIVE_JSON_SCHEMA } },
      messages: [{ role: 'user', content: `읽기 세션 ${input?.sessionNo ?? '?'}. 입력:\n${JSON.stringify(input)}` }],
    });
    const text = msg.content.find((b) => b.type === 'text')?.text ?? '{}';
    return new Response(JSON.stringify({ directive: JSON.parse(text) }), { headers: cors });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: cors });
  }
});
