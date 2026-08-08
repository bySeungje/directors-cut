import Anthropic from 'npm:@anthropic-ai/sdk@0.115.0';

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
    mutation: { type: 'string', enum: ['NONE', 'LAVA_LEFT', 'LAVA_RIGHT', 'LAVA_HOTSPOT', 'FOG', 'SPEED_SURGE', 'SHRINK_ARENA', 'SPAWN_STORM'] },
    buff: { type: 'string', enum: ['NONE', 'TOUGH', 'SWIFT', 'RELENTLESS', 'RAPID_FIRE', 'MARKSMAN', 'VOLATILE', 'INTERCEPT', 'ENCIRCLE', 'EVASIVE'] },
    deny: { type: 'string', enum: ['NONE', 'DAMAGE_UP', 'FIRE_RATE_UP', 'MOVE_SPEED_UP', 'HP_PLUS', 'PIERCE', 'MULTI_SHOT', 'BULLET_SPEED_UP', 'DASH_CD_DOWN'] },
    taunt: { type: 'string' },
    intent: { type: 'string' },
  },
  required: ['composition', 'mutation', 'buff', 'deny', 'taunt', 'intent'],
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
- composition 총 비용(chaser 1, shooter 2, splitter 2, elite는 ×3)은 예산을 거의 다 써라 — 하한은 예산의 80%, 상한은 100%다. 예산은 사용자 메시지에 준다. 적게 쓰면 엔진이 개체 수를 늘려 채우므로, 네가 직접 채우는 편이 네 설계 의도대로 나온다.
- taunt는 한국어 60자 이내. 반드시 로그에서 실제로 관찰되는 습관 하나를 콕 집어 지목하라. 그리고 설계가 그 습관을 실제로 공략해야 한다.
- **dominantHabit이 로그에 있으면 반드시 그 습관을 지목하라.** 엔진이 그 습관으로 예측을 걸고 채점하므로, 다른 것을 지목하면 화면의 판정과 네 말이 어긋난다. 대응 문구:
    ANCHOR = 한자리에 뿌리내림(같은 지점에 오래 머문다) → "그 자리가 마음에 드나 보군" 계열. LAVA_HOTSPOT이 그 자리를 태운다.
    CORNER = 한 사분면만 씀(구석을 떠나지 않는다) → "무대의 사분의 일만 쓰는군" 계열. 그 구역을 압박하라.
    DASH   = 대시 의존(쿨다운이 도는 족족 쓴다) → "대시가 없으면 어쩌려고" 계열. RELENTLESS로 따라붙어라.
- dominantHabit이 null이면 읽을 습관이 없다는 뜻이다. 그때는 억지로 지목하지 말고 그 사실 자체를 말하라("빈틈이 없군" 계열).
- 해석 규칙: hpLost가 damageSources 합보다 크면 그 차이는 지형 피해(용암 존·축소 경계)다 — 지형에 자주 타는 플레이어에게는 그 습관을 지목할 수 있다.
- 직전 mutation과 같은 것은 고르지 마라.
- 어렵지만 이길 수 있게: 플레이어가 고전한 요소를 유지하라. 위협은 총 체력이 아니라 '동시에 접촉하는 개체 수'가 만든다(실측: 같은 예산이라도 elite 소수는 무해하고 다수의 기본 적이 위험하다). 예산이 남으면 개체 수로 채워라 — elite로 비싸게 채우면 오히려 판이 쉬워진다.
- intent는 설계 의도 100자 이내.
- buff는 적의 성능을 조정하는 강화 카드다. 로그에서 관찰된 플레이어의 강점을 무력화하는 카드를 골라라:
    TOUGH(전 적 HP +1) — 명중률이 높을 때
    SWIFT(전 적 이속 +25%) — 클리어 시간이 길고 거리를 벌리며 놀 때
    RELENTLESS(chaser 이속 +45%, HP -1) — 대시를 남용할 때
    RAPID_FIRE(shooter 발사 간격 40% 단축) — 피격이 적고 탄을 잘 피할 때
    MARKSMAN(shooter 탄속 +50%, 유지거리 +80) — 벽에 붙지 않고 원거리 안전지대를 쓸 때
    VOLATILE(splitter 분열 2->3기) — 분열형 처치가 많고 물량 처리가 능숙할 때
    INTERCEPT(추격형이 이동 방향 앞을 예측 요격) — 적을 뭉쳐서 한 번에 쓸어담을 때
    ENCIRCLE(추격형이 포위 반경으로 흩어져 조여듦) — 한 덩어리로 몰아두고 처리할 때
    EVASIVE(전 적이 좌우로 흔들며 접근해 자동 조준탄을 흘림) — 적을 20기 미만으로 낼 때만. 물량이 많으면 흔들림이 접근을 늦춰 오히려 플레이어가 편해진다
    NONE — 강화 없이 구성만으로 압박할 때
- 해석 규칙: clusterRatio가 낮으면(0.3 미만) 적이 한 덩어리로 뭉쳐 있었다는 뜻이다 — 플레이어가 몰아서 쓸어담고 있다. INTERCEPT나 ENCIRCLE로 그 수렴을 깨라.
- 해석 규칙: hotspotConcentration이 높으면(0.4 초과) 한 자리에 오래 버텼다는 뜻이다 — LAVA_HOTSPOT은 그 자리를 정확히 태운다.
- 강화 카드는 비용이 든다: NONE이 아니면 예산의 25%가 차감되므로 적 수를 그만큼 줄여야 한다.
- 직전 웨이브와 같은 카드는 고르지 마라.
- intent에 그 카드를 고른 근거(플레이어의 어떤 강점을 노렸는지)를 써라.
- deny는 다음 업그레이드 3택에서 뺄 항목이다. upgrades 로그에서 플레이어가 반복해서 고른 축을 읽고 그 성장을 막아라. (단, 플레이어가 직전 예측을 깼다면 엔진이 이 봉인을 무효로 한다 — 읽기 대결에서 진 대가다.)
  고를 수 있는 값: NONE, DAMAGE_UP, FIRE_RATE_UP, MOVE_SPEED_UP, HP_PLUS, PIERCE, MULTI_SHOT, BULLET_SPEED_UP, DASH_CD_DOWN.
- deny는 예산을 쓰지 않는다. 직전 웨이브와 같은 것은 고르지 마라.
- deny를 골랐다면 taunt가 그 사실을 지목해야 한다(예: "화력만 올리는군. 그 길은 막았다").`;

Deno.serve(async (req) => {
  const cors = {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Headers': 'content-type',
    'Content-Type': 'application/json',
  };
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  try {
    const { mode, log, wave, budget, prevMutation, prevBuff, prevDeny, sessionId, runSummary, warmup } = await req.json();
    const used = sessionCounts.get(sessionId) ?? 0;
    // warmup(타이틀 사전 호출)은 세션 상한에 산입하지 않는다 — 단, 남용 방지를 위해 일일 캡 검사(overDailyCap)는
    // warmup도 동일하게 받는다(스펙 3.4 amendment). 세션 캡에 이미 걸린 실호출은 기존과 동일하게 일일 카운터를 소비하지 않는다.
    const overSessionCap = !warmup && used >= MAX_CALLS_PER_SESSION;
    if (overSessionCap || overDailyCap()) return new Response(JSON.stringify({ error: 'cap' }), { status: 429, headers: cors });
    if (!warmup) sessionCounts.set(sessionId, used + 1);

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
      messages: [{ role: 'user', content: `웨이브 ${wave} 설계. 예산: ${budget}. 직전 mutation: ${prevMutation}. 직전 buff: ${prevBuff}. 직전 deny: ${prevDeny}.\n플레이 로그:\n${JSON.stringify(log)}` }],
    });
    const text = msg.content.find((b) => b.type === 'text')?.text ?? '{}';
    return new Response(JSON.stringify({ directive: JSON.parse(text) }), { headers: cors });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: cors });
  }
});
