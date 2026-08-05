import Anthropic from 'npm:@anthropic-ai/sdk';

// DIRECTIVE_JSON_SCHEMA — src/contracts/directive.ts에서 복사한 사본.
// Edge Function은 별도 번들이라 소스 파일을 import할 수 없다 — 계약(directive.ts) 변경 시 이 블록도 수동 동기화할 것 (CLAUDE.md 명시).
const DIRECTIVE_JSON_SCHEMA = {
  type: 'object',
  properties: {
    composition: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['chaser', 'shooter', 'splitter'] },
          count: { type: 'integer' },
          spawn: { type: 'string', enum: ['N', 'S', 'E', 'W', 'RING', 'PINCER', 'BEHIND'] },
          elite: { type: 'boolean' },
        },
        required: ['type', 'count', 'spawn', 'elite'],
        additionalProperties: false,
      },
    },
    mutation: { type: 'string', enum: ['NONE', 'LAVA_LEFT', 'LAVA_RIGHT', 'FOG', 'SPEED_SURGE', 'SHRINK_ARENA', 'SPAWN_STORM'] },
    taunt: { type: 'string' },
    intent: { type: 'string' },
  },
  required: ['composition', 'mutation', 'taunt', 'intent'],
  additionalProperties: false,
} as const;

const client = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY')! });
const ALLOWED_ORIGIN = 'https://byseungje.github.io';
const MAX_CALLS_PER_SESSION = 20;
const MAX_CALLS_PER_DAY = 500; // 일일 캡 확정값(스펙 4절 위임): Haiku 기준 최악 수천 원. 인스턴스 근사 — 하드캡은 Anthropic 콘솔 워크스페이스 spend limit(승제 설정)
const sessionCounts = new Map<string, number>(); // 인스턴스 수명 내 근사 캡(콜드스타트 리셋 허용)
let dailyCount = { date: '', n: 0 };
function overDailyCap(): boolean {
  const today = new Date().toISOString().slice(0, 10);
  if (dailyCount.date !== today) dailyCount = { date: today, n: 0 };
  return ++dailyCount.n > MAX_CALLS_PER_DAY;
}

const SYSTEM = `너는 아케이드 게임의 'AI 디렉터'다. 플레이어의 웨이브 로그를 읽고 다음 웨이브를 설계한다.
규칙:
- composition 총 비용(chaser 1, shooter 2, splitter 2, elite는 ×3)은 예산 이하로. 예산은 사용자 메시지에 준다.
- taunt는 한국어 60자 이내. 반드시 로그에서 실제로 관찰되는 습관 하나를 콕 집어 지목하라(예: 벽 붙기 wallHugRatio, 특정 사분면 체류, 낮은 명중률, 대시 남용, 특정 적에게 반복 피격, 업그레이드 성향). 그리고 설계가 그 습관을 실제로 공략해야 한다.
- 해석 규칙: hpLost가 damageSources 합보다 크면 그 차이는 지형 피해(용암 존·축소 경계)다 — 지형에 자주 타는 플레이어에게는 그 습관을 지목할 수 있다.
- 직전 mutation과 같은 것은 고르지 마라.
- 어렵지만 이길 수 있게: 플레이어가 고전한 요소는 유지하되 물량으로 압살하지 마라.
- intent는 설계 의도 100자 이내.`;

Deno.serve(async (req) => {
  const cors = {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Headers': 'content-type',
    'Content-Type': 'application/json',
  };
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  try {
    const { mode, log, wave, budget, prevMutation, sessionId, runSummary } = await req.json();
    const used = sessionCounts.get(sessionId) ?? 0;
    if (used >= MAX_CALLS_PER_SESSION || overDailyCap()) return new Response(JSON.stringify({ error: 'cap' }), { status: 429, headers: cors });
    sessionCounts.set(sessionId, used + 1);

    if (mode === 'report') {
      const msg = await client.messages.create({
        model: 'claude-haiku-4-5',
        max_tokens: 700,
        system: '너는 게임의 AI 디렉터다. 방금 끝난 판의 전체 로그를 보고, 플레이어의 스타일을 분석하는 리포트를 한국어 400자 내외로 써라. 마지막 줄에 "칭호: <4~8자 칭호>" 형식으로 칭호를 붙여라. 관찰된 사실만 근거로, 디렉터의 시점(1인칭)으로, 패배시켰다면 여유롭게, 패배했다면 인정하며.',
        messages: [{ role: 'user', content: JSON.stringify(runSummary) }],
      });
      const text = msg.content.find((b) => b.type === 'text')?.text ?? '';
      return new Response(JSON.stringify({ report: text }), { headers: cors });
    }

    const msg = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 500,
      system: SYSTEM,
      output_config: { format: { type: 'json_schema', schema: DIRECTIVE_JSON_SCHEMA } },
      messages: [{ role: 'user', content: `웨이브 ${wave} 설계. 예산: ${budget}. 직전 mutation: ${prevMutation}.\n플레이 로그:\n${JSON.stringify(log)}` }],
    });
    const text = msg.content.find((b) => b.type === 'text')?.text ?? '{}';
    return new Response(JSON.stringify({ directive: JSON.parse(text) }), { headers: cors });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: cors });
  }
});
