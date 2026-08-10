/**
 * 소름 5비트 자동 판정 — Playwright.
 *
 * 왜 필요한가: 크롬 확장 자동화 탭에서는 rAF가 돌지 않아 적이 스폰만 되고 속도 0으로 멈춘다
 * (2026-08-10 실측, 렌더러 무응답까지 확인). Playwright는 실제 브라우저 컨텍스트라 게임 시간이
 * 정상으로 흐르므로, 사람 없이도 다음을 **타임스탬프로** 판정할 수 있다:
 *
 *   ② 웨이브 1의 12초 지점에 첫 관찰이 뜬다
 *   ③ 예고가 뜨고 그 시점엔 아직 적이 없다 (예고 → 스폰 간격 ≥ 1.2초)
 *   ④ 마커가 적보다 먼저 그려진다 (마커 → 스폰 간격 ≥ 0.6초)
 *   ⑤ 예고한 방향과 실제 스폰 방향이 일치한다
 *
 * 대상은 **로컬 dev**다 — 프로덕션에는 QA 훅(`window.__game`)이 없기 때문이고, 판정 대상인 5비트는
 * 전부 엔진 결정론이라 LLM 유무와 무관하다(예고 방향은 언제나 엔진이 정한다 — warning.ts).
 * 배포본 확인은 별도로 스크린샷으로 한다.
 *
 * 사용: node scripts/probe_beats.mjs [url]
 */
import { chromium } from 'playwright';

const URL = process.argv[2] ?? 'http://localhost:5202/directors-cut/';
const RUN_MS = 75_000;
const STYLE = process.env.PROBE_STYLE ?? 'anchor'; // anchor | orbit

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });

const events = [];
page.on('console', (m) => {
  const t = m.text();
  if (t.startsWith('[probe]')) {
    try { events.push(JSON.parse(t.slice(7))); } catch { /* ignore */ }
  }
});

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.__game, { timeout: 15_000 });

// 타이틀 → 아레나
await page.mouse.click(600, 400);
await page.waitForFunction(
  () => window.__game.scene.getScene('ArenaScene')?.scene.isActive() === true,
  { timeout: 10_000 },
);

// 게임 내부 상태를 매 프레임 관찰해 전이 시점만 콘솔로 흘린다.
// 씬 필드를 직접 읽지 않고 **화면에 실제로 그려진 것**을 본다 — 연출이 안 보이면 통과시키지 않기 위해서다.
await page.evaluate(() => {
  const g = window.__game;
  const s = g.scene.getScene('ArenaScene');
  const t0 = performance.now();
  const emit = (type, extra = {}) =>
    console.log('[probe]' + JSON.stringify({ type, t: Math.round(performance.now() - t0), ...extra }));

  let prevWarn = false, prevMarker = false, prevEnemies = 0, prevObs = false;
  // 오버레이(관찰·예고)는 HUD_DEPTH+60, 좌상단 실시간 미터는 HUD_DEPTH. 섞이면 미터 값을 관찰로 오독한다.
  const texts = () => s.children.list.filter((o) => o.type === 'Text' && o.visible && o.depth >= 1050);

  const tick = () => {
    const all = texts().map((o) => o.text);
    const warnNow = all.some((x) => /닫는다$/.test(x));
    const obsNow = all.includes('관 찰');
    // 마커는 정확히 HUD_DEPTH+40. 관찰 핫스팟 링(HUD_DEPTH+55)과 섞이지 않게 정확값으로 본다.
    const markerNow = s.children.list.some((o) => o.type === 'Graphics' && o.visible && o.depth === 1040);
    const enemies = s.enemies.getChildren().filter((e) => e.active).length;

    if (obsNow && !prevObs) {
      const line = all.find((x) => /%|아직 패턴/.test(x)) ?? '(수치 없음)';
      emit('observation', { line });
    }
    if (warnNow && !prevWarn) emit('warning', { text: all.find((x) => /닫는다$/.test(x)), enemiesOnScreen: enemies });
    if (markerNow && !prevMarker) emit('marker', { enemiesOnScreen: enemies });
    if (enemies > 0 && prevEnemies === 0) {
      const e = s.enemies.getChildren().find((x) => x.active);
      emit('spawn', { count: enemies, x: Math.round(e.x), y: Math.round(e.y) });
    }
    if (enemies === 0 && prevEnemies > 0) emit('cleared', {});

    prevWarn = warnNow; prevMarker = markerNow; prevEnemies = enemies; prevObs = obsNow;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});

// 자동 플레이: 가장 가까운 적을 조준해 실제로 웨이브를 깬다. 동시에 왼쪽에 치우쳐 머물러
// ANCHOR/CORNER 습관을 만든다 — 예고가 걸리려면 위치 습관이 잡혀야 한다.
const play = (async () => {
  const t0 = Date.now();
  // anchor: 왼쪽에 눌러붙어 위치 습관을 만든다 / orbit: 반시계로 계속 돌아 선회 습관을 만든다
  const ORBIT_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD']; // 반시계 순회
  let oi = 0, held = null;
  if (STYLE === 'anchor') await page.keyboard.down('KeyA');
  while (Date.now() - t0 < RUN_MS) {
    if (STYLE === 'orbit') {
      const want = ORBIT_KEYS[Math.floor((Date.now() - t0) / 900) % 4];
      if (want !== held) {
        if (held) await page.keyboard.up(held);
        await page.keyboard.down(want);
        held = want;
      }
    }
    const aim = await page.evaluate(() => {
      const s = window.__game.scene.getScene('ArenaScene');
      const cam = s.cameras.main;
      const list = s.enemies.getChildren().filter((e) => e.active);
      if (!list.length) return null;
      const p = s.player;
      let best = list[0], bd = Infinity;
      for (const e of list) { const d = (e.x - p.x) ** 2 + (e.y - p.y) ** 2; if (d < bd) { bd = d; best = e; } }
      const r = s.game.canvas.getBoundingClientRect();
      const sx = r.width / s.scale.width, sy = r.height / s.scale.height;
      return { x: r.left + (best.x - cam.scrollX) * sx, y: r.top + (best.y - cam.scrollY) * sy };
    }).catch(() => null);
    if (aim) {
      await page.mouse.move(aim.x, aim.y);
      await page.mouse.down();
      await page.waitForTimeout(50);
      await page.mouse.up();
    } else {
      // 적이 없다 = 인터벌(업그레이드 선택). 카드는 [1][2][3] 단축키로 고른다 —
      // 안 고르면 다음 웨이브가 시작되지 않아 예고까지 도달할 수 없다.
      await page.keyboard.press('Digit1');
      await page.waitForTimeout(300);
    }
    await page.waitForTimeout(40);
  }
  if (STYLE === 'anchor') await page.keyboard.up('KeyA');
  if (held) await page.keyboard.up(held);
})();

await Promise.race([play, page.waitForTimeout(RUN_MS + 2000)]);
await page.screenshot({ path: '/tmp/probe-final.png' });
await browser.close();

// ── 판정 ────────────────────────────────────────────────────────────────
const first = (type) => events.find((e) => e.type === type);
const obs = first('observation');
const warn = first('warning');
const marker = first('marker');
const spawnAfterWarn = warn ? events.find((e) => e.type === 'spawn' && e.t > warn.t) : null;

const R = [];
const check = (id, ok, detail) => R.push({ id, ok, detail });

check('② 관찰이 30초 이내 최소 1회 등장',
  !!obs && obs.t < 30_000,
  obs ? `t=${(obs.t / 1000).toFixed(1)}s · "${obs.line}"` : '관찰 이벤트 없음');

const obsBeforeWarn = warn ? [...events].reverse().find((e) => e.type === 'observation' && e.t <= warn.t) : null;
check('② 예고 앞에 원인(관찰)이 먼저 나온다',
  !!(obsBeforeWarn && warn) && warn.t - obsBeforeWarn.t >= 1100,
  obsBeforeWarn && warn ? `관찰 t=${(obsBeforeWarn.t/1000).toFixed(1)}s "${obsBeforeWarn.line}" → 예고까지 ${((warn.t-obsBeforeWarn.t)/1000).toFixed(2)}s` : '관찰이 예고 앞에 없음');

check('③ 예고가 뜬 시점에 적이 화면에 없다',
  !!warn && warn.enemiesOnScreen === 0,
  warn ? `t=${(warn.t / 1000).toFixed(1)}s · "${warn.text}" · 적 ${warn.enemiesOnScreen}기` : '예고 이벤트 없음');

check('③ 예고 → 스폰 간격 ≥ 1.2초',
  !!(warn && spawnAfterWarn) && spawnAfterWarn.t - warn.t >= 1150,
  warn && spawnAfterWarn ? `${((spawnAfterWarn.t - warn.t) / 1000).toFixed(2)}s` : '측정 불가');

check('④ 마커가 적보다 먼저 (마커 → 스폰 ≥ 0.6초)',
  !!(marker && spawnAfterWarn) && spawnAfterWarn.t - marker.t >= 550 && marker.enemiesOnScreen === 0,
  marker && spawnAfterWarn ? `${((spawnAfterWarn.t - marker.t) / 1000).toFixed(2)}s · 마커 시점 적 ${marker.enemiesOnScreen}기` : '측정 불가');

if (warn && spawnAfterWarn) {
  const dir = /왼쪽/.test(warn.text) ? 'W' : /오른쪽/.test(warn.text) ? 'E' : /위/.test(warn.text) ? 'N' : 'S';
  const { x, y } = spawnAfterWarn;
  const actual = x > 900 ? 'E' : x < 60 ? 'W' : y < 60 ? 'N' : y > 580 ? 'S' : `안쪽(${x},${y})`;
  check('⑤ 예고 방향 = 실제 스폰 방향', dir === actual, `예고 ${dir} · 스폰 ${actual}`);
} else {
  check('⑤ 예고 방향 = 실제 스폰 방향', false, '측정 불가');
}

console.log('\n=== 소름 5비트 판정 ===');
for (const r of R) console.log(`${r.ok ? '✅' : '❌'} ${r.id} — ${r.detail}`);
console.log('\n--- 관측 이벤트 ---');
for (const e of events.slice(0, 24)) console.log(`  ${(e.t / 1000).toFixed(1)}s  ${e.type}  ${JSON.stringify({ ...e, type: undefined, t: undefined })}`);
process.exit(R.every((r) => r.ok) ? 0 : 1);
