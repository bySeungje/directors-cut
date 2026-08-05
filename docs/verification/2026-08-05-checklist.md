# 완료 기준 검증 체크리스트 (2026-08-05)

> 스펙 `docs/specs/nan2026-submission.md` §5 완료 기준 1~9 대조.
> 이번 검증 런의 범위: **기준 2·3·4·5·6·7** (팀리드 지정). 1·8·9는 배포·산출물·제출 의존이라 대상 밖 — 표시만.
> 밸런싱 수치는 이번 런에서 **변경하지 않았다** — 현재 값을 스냅샷만 남긴다(§2, 승제 실플레이 세션 출발점 자료).

## 1. 기준별 대조

| # | 기준 | 상태 | 요약 |
|---|---|---|---|
| 1 | Pages URL 접속·3초 로드 | ✅ | **2026-08-05 배포 후 실측**: https://byseungje.github.io/directors-cut/ 정상 로드, `loadEventEnd` **650ms**(기준 3,000ms의 4.6배 여유), 전송 394KB. 클릭 1회로 웨이브 1 진입 확인. 콘솔 오류 0건(Phaser 배너 1줄만). dev 훅 4종(`__game`·`__god`·`__skipWave`·`spawnStress`) 전부 `undefined` — 프로덕션 제거를 실배포 환경에서 재확인. |
| 2 | 완주·사망 양 경로 리포트 + 리스타트 | ✅ | 컨트롤러 라이브 QA + 이번 런 재확인(아래 상세). |
| 3 | 정상 경로 로그 기반 대사·변주 적용 | ⏸ | 인터벌 메커니즘(타이핑·변주 적용·카드)은 ✅. "로그를 실제로 반영한 LLM 대사"는 배포+API 키+승제 수동 2런 필요(스펙 문구 그대로 "정상 경로") — 브리프 Step 1과 결합 가능, 이번 디스패치 범위 밖. |
| 4 | 장애 경로 폴백 8초 내 진행, 정지 없음 | ✅ | 유닛 4건(네트워크 오류·타임아웃·스키마 위반·정상) + 라이브 오프라인 7웨이브 완주. |
| 5 | 예산 규칙 — 상한 초과 스폰 불가 | ✅ | 유닛 8건 + 뱅크 전 19항목(오프닝+6웨이브×3) 전수 재확인. |
| 6 | 적 50기 동시 55fps+ | ✅ | 58기 동시 활성, 프레임당 평균 0.145ms(환산 ~6880fps) — 여유 100배 이상. |
| 7 | 세션 캡·일일 캡 동작 | ⏸ | 캡 로직 자체는 ✅(코드 검토 + 경계값 시뮬레이션). "프록시 로그 확인"은 배포 후. |
| 8 | 산출물(영상·PDF 3종) | ⏸ | 대상 밖(Task 11 범위). |
| 9 | 신청 폼 제출 | ⏸ | 대상 밖(승제 직접). |

기준 2·4·5·6은 이번 런으로 **완전 충족**. 3·7은 로직/메커니즘 수준까지 확인했고 잔여분은 배포에 묶여 있다(원인: 아직 미배포이므로 실 API·실 URL이 없음 — 조치: Pages+Edge Function 배포 후 ①승제 실플레이 2런(기준3) ②프록시 로그 확인(기준7)).

---

## 2. 기준별 상세

### 기준 2 — 완주·사망 양 경로 + 리스타트

컨트롤러가 이미 라이브 QA로 확인(WIN·LOSE 양 경로 리포트 표시 + R 리스타트 정상, 2회차 런 완전 초기화)한 것을 근거로 인용하고, 이번 런에서 다음을 **독립적으로 재확인**했다(dev 서버 + Chrome 자동화, `window.__game.loop.step(t)`로 프레임 수동 전진 — 자동화 탭은 rAF가 스로틀돼 실시간 대기로는 인터벌 타이머·SPAWN_STORM 스케줄이 진행되지 않는다는 걸 Task 8·9에서 이미 확인한 문제라 동일 기법으로 우회):

- 오프닝~웨이브7까지 `window.__skipWave()` + 매 인터벌 카드 선택(키 `1`)으로 완주 → 콘솔 `WIN`, `waveLogs.length === 7`, `runEnded === true` → 0.6초 후 `EndScene` 전환(`game.scene.isActive('EndScene') === true`) 확인.
- EndScene 렌더 확인(스크린샷): 헤드라인 "디렉터 격파", 통계 줄 "7 WAVES · 처치 72 · 명중률 0% · 대시 0회"(스킵 클리어라 명중률 0%는 예상된 값 — 실제 사격 없이 적을 즉시 처치했기 때문), FINAL REPORT 패널(오프라인이라 정적 폴백 문구, `report.ts`의 WIN 템플릿 톤과 일치).
- `R` 키 리스타트 → `ArenaScene` 재활성화, `currentWave:1, waveLogsLen:0, playerHp:5`, `player.stats`가 `BASE_STATS`와 완전히 동일(`pierce:0, multishot:1, dashCooldownMs:2000, maxHp:5` 등, 직전 런의 업그레이드 4종이 전부 리셋됨), `physics.world.timeScale:1`(새 World 인스턴스 — 근거는 §3 방어수정 A2 참고).
- 이어서 58기 스웜으로 자연사(LOSE) 경로도 발생(god모드 해제 상태에서 fps 측정 준비 중 우발적으로 재현) → `EndScene`(LOSE) 정상 전환 확인, 재차 `R`로 정상 리스타트.

### 기준 3 — 정상 경로 로그 기반 대사·변주 적용

이번 런은 dev 서버에 `VITE_DIRECTOR_URL`이 없는 기본 상태(리포 `.env`가 gitignore돼 있고 실제로 존재하지 않음 확인)라 **전 구간 폴백 경로**다. 따라서 "LLM이 실제 웨이브 로그를 읽고 그 습관을 대사로 지목한다"는 스펙 문구의 핵심(LLM 추론)은 이번 런으로 검증 불가 — 배포 후 승제 실플레이가 필요하다(브리프 Step 1, 이번 디스패치에서 명시적으로 제외됨).

다만 **인터벌 메커니즘 자체**는 폴백 경로로도 전부 동일 코드를 타므로 확인했다:
- 타이핑 연출(30ms/글자) → "설계 의도" 서브텍스트 → 카드 3장(무작위 3종, 실제 `UPGRADES` 정의 반영) 순서로 렌더.
- 카드 선택 시 `player.stats`에 즉시 반영됨을 매 웨이브 확인(예: HP_PLUS→maxHp 5→6, DASH_CD_DOWN→dashCooldownMs 2000→1600→1280, MULTI_SHOT→multishot 1→2, PIERCE→pierce 0→1).
- **변주(mutation) 적용**: 이번 런에서 실제로 다른 mutation이 연속 웨이브에 적용됨을 확인 — 웨이브5 `LAVA_RIGHT`, 웨이브6 `FOG`, 웨이브7 `SPAWN_STORM`(스태거 스폰까지 정상 진행, 아래 기준4 참고). 동일 mutation 연속 회피 규칙(`validator.ts`)과 별개로 실제 여러 종류가 관측됨.
- `fromLLM`은 전 웨이브 `false`로 일관 — 오프라인 상태에서 폴백이 항상 선택된다는 것의 재확인(기준4와 근거 공유).

### 기준 4 — 장애 경로 폴백

**유닛 테스트** (`npx vitest run tests/directorClient.test.ts tests/report.test.ts`, 전량 통과):
- `directorClient.test.ts` 4건: 정상 응답→LLM 디렉티브, 네트워크 오류→폴백, 스키마 위반 응답→폴백, 4초 초과(fake timer)→폴백.
- `report.test.ts` 중 `requestReport` 4건: 정상 응답, 네트워크 오류→정적 폴백, 빈 응답→폴백, 8초 초과→폴백.

**라이브 오프라인 실런타임 확인** (dev 서버, `VITE_DIRECTOR_URL` 부재 — 리포 기본 상태): 오프닝부터 웨이브7 WIN까지 **7웨이브 전 구간**을 폴백만으로 진행, 매 웨이브 전환에서 게임이 멈추지 않았다. `SPAWN_STORM`(웨이브7에 배정)의 3분할 스태거 스폰(4초 간격)도 정상 진행되어 `markSpawningComplete` → `wave-cleared` → WIN 전환까지 끊김 없이 도달했다. `lastFromLLM`은 전 구간 `false`.

### 기준 5 — 예산 규칙

**유닛 테스트**(`tests/validator.test.ts`, 8건 전량 통과): enum 밖 값 거부, taunt 60자 초과 거부, 예산 초과 거부(웨이브3 상한 초과 엘리트 물량), count 0/비정수 거부, 동일 mutation 2연속→NONE 강제 교체, 예산 단조 증가, 비용 공식(chaser1·shooter2·splitter2, elite×3) 검증.

**뱅크 전 항목 전수 재확인**(임시 검증 스크립트로 실행 후 삭제 — 커밋되지 않음): `OPENING_WAVE` + `BANK[2..7]`의 **19개 디렉티브 전부**가 각 웨이브의 `budgetFor(wave)` 이하이고 `validateDirective`를 통과함을 확인. 웨이브별 예산 실측값:

| 웨이브 | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
|---|---|---|---|---|---|---|---|
| `budgetFor(w)` | 12 | 16 | 20 | 24 | 28 | 44 | 60 |

(`budgetFor(w) = 8 + w*4 + max(0, w-5)*12` — 웨이브6~7 가속 곡선이 실측치에 반영됨.)

### 기준 6 — 적 50기 동시 55fps+

**측정 방법**: devtools rAF 기반 fps 카운터는 자동화 탭에서 스로틀되어 신뢰할 수 없다(기준2·4 근거와 동일 이슈). 대신 `window.__game.loop.step(t)`를 고정 16ms 간격으로 반복 호출하며 **각 호출 자체의 벽시계 소요 시간**을 측정했다 — 이 호출은 Phaser의 `Game.step()`(물리·씬 업데이트+렌더 전체 파이프라인, 실제 rAF 콜백과 동일 함수)을 그대로 실행하므로 "1프레임 처리 비용"의 직접 측정치다.

- 준비: 무적 치트(`window.__god=true`)로 측정 중 플레이어 사망→씬 전환에 의한 오염을 방지, `window.spawnStress(50)`으로 스트레스 스폰.
- 활성 적: 웨이브1 기본 8기 + 스트레스 50기 = **58기 동시**(측정 종료 시점 57기 — 오차 범위, 원인 미상이나 유의미하지 않음).
- 워밍업 10프레임(측정 제외) 후 **300프레임 측정**.

| 지표 | 값 |
|---|---|
| 총 소요 | 43.6ms |
| 프레임당 평균 | 0.145ms |
| p50 | 0.1ms |
| p95 | 0.4ms |
| 최대 | 1ms |
| 환산 fps(1000/평균) | ≈ 6880 |

60fps 예산(16.7ms/프레임) 대비 **약 115배 여유** — 기준(55fps, 18.2ms 예산) 대비로도 여유가 압도적이라 기기·브라우저 편차를 감안해도 통과로 판단.

**방법의 한계**: (1) 이 측정은 JS 실행+캔버스 드로우콜 비용만 잡는다 — 실제 브라우저의 GPU 컴포지팅·vsync 대기 시간은 포함하지 않는다(다만 여유가 100배 이상이라 실사용 환경 오버헤드를 감안해도 결론이 뒤집힐 가능성은 낮다고 판단). (2) 자동화된 단일 머신(개발 macOS)의 결과이며 승제의 실제 플레이 기기·브라우저와 다를 수 있다. (3) 사격·피격 이펙트(파티클·트윈) 없이 정지 상태의 적 이동/충돌만 측정했다 — 실제 전투 중 파티클이 동시다발하면 비용이 다소 늘 수 있으나, 여유 폭을 고려하면 위험은 낮다.

### 기준 7 — 세션 캡·일일 캡

`supabase/functions/director/index.ts`는 Deno 런타임(`npm:` 스펙 임포트, `Deno.serve`, `Deno.env`)이라 프로젝트의 Vitest(Node) 스위트에 포함되지 않고, 실행하려면 배포(또는 Deno CLI + `ANTHROPIC_API_KEY`)가 필요하다 — 브리프가 허용한 대로 코드 인용 + 로직 시뮬레이션으로 대체했다.

**코드**(`supabase/functions/director/index.ts:32-40, 60-62`):
```ts
const MAX_CALLS_PER_SESSION = 20;
const MAX_CALLS_PER_DAY = 500;
const sessionCounts = new Map<string, number>();
let dailyCount = { date: '', n: 0 };
function overDailyCap(): boolean {
  const today = new Date().toISOString().slice(0, 10);
  if (dailyCount.date !== today) dailyCount = { date: today, n: 0 };
  return ++dailyCount.n > MAX_CALLS_PER_DAY;
}
...
const used = sessionCounts.get(sessionId) ?? 0;
if (used >= MAX_CALLS_PER_SESSION || overDailyCap()) return new Response(JSON.stringify({ error: 'cap' }), { status: 429, headers: cors });
sessionCounts.set(sessionId, used + 1);
```

**로직 시뮬레이션**(위 코드를 그대로 옮겨 Node로 실행, 실 배포 함수 실행 아님 — 경계값만 확인):

| 확인 항목 | 결과 |
|---|---|
| 세션 25회 연속 호출 시 허용 횟수 | 20 (기대 20) — 1~20회 전부 허용, 21~25회 전부 거부 |
| 다른 세션(sessionB) 독립 카운트 | 세션A가 캡에 걸려도 첫 호출 허용됨 |
| 일일 505회 호출(세션 분산) 시 최초 거부 시점 | 501회째 (기대 501) |
| 날짜 롤오버(전날 500 도달 상태 → 다음날) | 리셋되어 첫 호출 허용됨 |

**클라이언트 측 캡**: `src/director/client.ts`에는 별도의 세션 호출 수 카운터가 없다 — 캡 집행은 전적으로 서버(Edge Function) 측이며, 클라이언트는 `sessionId`(모듈 로드 시 1회 `crypto.randomUUID()` — 페이지 새로고침 전까지 고정)만 요청에 실어 보낸다. 정상 런 1회는 6회(웨이브2~7 인터벌) + 리포트 1회 = **7회**로 세션 캡(20회)의 1/3 이하라, 정상 플레이로는 캡이 걸리지 않는다(의도된 설계 — 캡은 어뷰징/반복 테스트 방어용).

**남은 것**: "프록시 로그 확인"은 실 배포·실 API 키가 있어야 가능 — 배포 후 스모크 테스트로 진행.

---

## 3. 방어 수정 (코드)

브리프 지정 최소 침습 수정 2건 — 밸런싱 수치는 변경하지 않았다.

**A1. `ArenaScene.onPlayerDied`에 `clearMutation(this)` 추가** (`src/game/scenes/ArenaScene.ts`)

`onWaveCleared`는 웨이브 종료 시 `clearMutation(this)`를 호출해 활성 mutation의 시각 리소스(그래픽스·FOG RenderTexture 등)를 정리하지만, `onPlayerDied`(사망 경로)는 이 호출이 없었다 — 리뷰 Minor #1 지적. 실제로는 `mutations.ts`의 상태가 모듈 전역 싱글턴이고, 사망 후 리스타트 시 다음 `beginWave`→`runDirective`→`applyMutation`의 첫 줄이 무조건 `clearMutation`을 호출하므로 **전이적으로는 이미 안전**했다(다음 웨이브 시작 시점에 정리됨, 그 사이 화면은 `EndScene`으로 전환돼 있어 시각적 부작용도 없음). 이번 수정은 `onWaveCleared`와의 대칭성을 명시하는 방어적 조치다. `waveClearedEmitted`가 true인 경로(인터벌 대기 중 사망)에서는 `onWaveCleared`가 이미 호출한 뒤라 `clearMutation`이 no-op(내부에서 `state` null 체크로 중복 호출 안전)이다.

검증: 하네스 `--full` PASS. 라이브로는 웨이브1(mutation NONE)에서의 사망만 재현했다(58기 스웜 자연사) — mutation이 NONE이 아닌 상태에서의 사망 재현은 이번 런에서 별도로 하지 않았다(우선순위 낮음: 이미 전이적으로 안전했던 경로의 방어 강화이고, 코드 대칭성 검토로 로직은 확인됨).

**A2. `create()`의 `this.physics.world.timeScale = 1` 라인 + 주석 제거** (`src/game/scenes/ArenaScene.ts`)

Phaser 소스(`node_modules/phaser/src/physics/arcade/ArcadePhysics.js`)를 직접 확인한 결과:
- `boot()`(최초 1회)과 `start()`(씬 시작마다)가 각각 `this.world`가 없으면 `new World(...)`로 **새로 생성**한다.
- `shutdown()`(씬 정지마다, `SceneEvents.SHUTDOWN`에 `once` 바인딩)이 `this.world.destroy()` 후 `this.world = null`로 만든다.
- `World`(`node_modules/phaser/src/physics/arcade/World.js:227`)의 `timeScale` 기본값은 `GetValue(config, 'timeScale', 1)` — **1**.
- 이 프로젝트는 씬 전환에 `scene.start()`만 쓴다(`scene.pause`/`sleep`/`resume`/`wake` 미사용 — grep으로 확인). 즉 `ArenaScene`이 재시작될 때마다 물리 월드는 파괴 후 **처음부터 다시 생성**되며, 새 월드의 `timeScale`은 항상 기본값 1이다 — 이전 런의 슬로모 잔여값이 새 월드로 이월될 경로 자체가 없다. 주석이 서술하는 시나리오("이전 런이 슬로모 도중 잘렸다면 timeScale이 남아있을 수 있다")는 발생할 수 없어 라인+주석을 **제거**했다(주석을 고쳐 남기기보다, "왜 아무 일도 안 하는 줄"을 설명하는 주석 자체가 불필요하다고 판단).

검증: 라이브로 재확인 — WIN 완주 후 `R` 리스타트 시 `scene.physics.world.timeScale === 1`(새 월드가 기본값으로 시작함을 직접 관측, 제거된 라인 없이도 정상).

---

## 4. 밸런싱 수치 스냅샷 (변경 없음 — 승제 실플레이 세션 출발점 자료)

### 플레이어 기본 스탯 (`entities.ts BASE_STATS`)

| damage | fireRateMs | moveSpeed | bulletSpeed | pierce | multishot | dashCooldownMs | maxHp |
|---|---|---|---|---|---|---|---|
| 1 | 280 | 220 | 480 | 0 | 1 | 2000 | 5 |

관련 상수: 대시 지속 300ms·배속×3, 피격 무적 1000ms, 피격 점멸 간격 80ms, 멀티샷 부채꼴 12°, 탄 수명 1500ms.

### 적 정의 (`entities.ts ENEMY_DEF` + 엘리트)

| 타입 | hp | speed | size |
|---|---|---|---|
| chaser | 2 | 90 | 14 |
| shooter | 3 | 60 | 15 |
| splitter | 3 | 75 | 16 |

엘리트: 스케일×1.4, HP×3, 이속×1.15. splitter 분열 산물: hp1·스케일×0.6(재분열 없음). shooter: 거리유지 260(데드존 15), 발사 간격 1600ms. 적탄 속도 220.

### 예산 곡선 (`validator.ts`)

`budgetFor(wave) = 8 + wave*4 + max(0, wave-5)*12`

| 웨이브 | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
|---|---|---|---|---|---|---|---|
| 예산 | 12 | 16 | 20 | 24 | 28 | 44 | 60 |

비용: chaser 1 · shooter 2 · splitter 2, elite ×3.

### mutation 파라미터 (`mutations.ts`)

| mutation | 파라미터 |
|---|---|
| LAVA_LEFT/RIGHT | 체류 DPS 0.5/초(1 도달 시 피격 1회), 존 투명도 0.35 |
| FOG | 시야 반경 240px, 암전 알파 0.85 |
| SHRINK_ARENA | 상하좌우 12%씩 축소(위험지대 판정은 LAVA와 동일 DPS 공식 공유) |
| SPEED_SURGE | 적 이속 ×1.25 |
| SPAWN_STORM | 3분할 스태거, 배치 간격 4000ms |

### 인터벌 타이밍 (`interval.ts`)

대사 타이핑 30ms/글자, 카드 등장 지연 500ms(타이핑 종료 후), taunt 최대 60자·intent 최대 100자(스키마 제약과 동일).

### 업그레이드 8종 (`upgrades.ts`, 매 인터벌 무작위 3종 제시)

| ID | 이름 | 효과 |
|---|---|---|
| DAMAGE_UP | 데미지 강화 | 공격력 +1 |
| FIRE_RATE_UP | 연사 강화 | 발사 간격 ×0.85 |
| MOVE_SPEED_UP | 기동 강화 | 이동속도 ×1.12 |
| HP_PLUS | 체력 강화 | 최대 체력 +1(상한 8)·즉시 회복 |
| PIERCE | 관통 | 관통 +1 |
| MULTI_SHOT | 멀티샷 | 멀티샷 +1(부채꼴 12°) |
| BULLET_SPEED_UP | 탄속 강화 | 탄속 ×1.2 |
| DASH_CD_DOWN | 대시 냉각 단축 | 대시 쿨다운 ×0.8 |

### 디렉터 통신 (`client.ts`/`report.ts`/Edge Function)

디렉티브 요청 타임아웃 4000ms, 리포트 요청 타임아웃 8000ms. 모델 `claude-haiku-4-5`(max_tokens 500/디렉티브, 700/리포트). 세션 캡 20회, 일일 캡 500회.

### 웨이브 실행기 (`waveRunner.ts`)

스폰 여백 40px, RING 반경 320px, SPAWN_STORM 3분할·배치 간격 4000ms.

### 주스·전환 타이밍 (`juice.ts` / `ArenaScene.ts`)

피격 흔들림 80ms·0.008, 처치 파편 6개, 웨이브클리어 슬로모(timeScale 0.4→1.0, 0.5초), 대시 잔상 5개(55ms 간격). 웨이브7 클리어→EndScene 전환 600ms(WIN)/사망→전환 500ms(LOSE).
