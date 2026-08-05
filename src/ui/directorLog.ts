import type { ArenaScene } from '../game/scenes/ArenaScene';

// ── 레이아웃 (시안 v1 SCREEN 02 "디렉터 로그 패널" 좌표 그대로 — 우상단, 288px 폭) ──
const PANEL_W = 288;
const PANEL_X_MARGIN = 16;
const PANEL_Y = 16;
const PAD = 14;

// ── 색상 (시안 v1 CSS 변수: --board·--line, LLM 배지만 --red) ────────────
const BOARD_NUM = 0x0e0e15;
const LINE_NUM = 0x23232e;
const INK_HEX = '#e8e8ec';
const DIM_HEX = '#7a7a88';
const FAINT_HEX = '#3a3a46';
const LLM_ON_HEX = '#ff2d2d';
const LLM_OFF_HEX = '#7a7a88';

const DEPTH = 3000; // 인터벌 UI(1500~1600대)보다 위 — 인터벌 중에도 L로 토글해 시연 가능해야 한다

// 모듈 싱글턴 — ArenaScene은 게임 전체에서 단일 인스턴스로 재사용된다(R 리스타트도 같은 인스턴스의 create()
// 재실행). scene.events(커스텀 이벤트)는 Phaser가 씬 shutdown 시 자동으로 비우지 않으므로(destroy()에서만
// 전체 클리어— InputPlugin 계열과 다르다), 이전 런이 등록한 update 리스너를 직접 추적해뒀다가
// attachDirectorLog가 다시 호출될 때(리스타트) 정확히 그 리스너만 제거한다. 그러지 않으면 리스타트할
// 때마다 render()가 프레임당 중복 호출되며 누적된다.
let currentUpdateHandler: (() => void) | null = null;

/**
 * L키로 토글되는 디렉터 로그 패널(브리프 Step 3, 컷 후보) — 우상단에 최근 디렉티브 JSON + fromLLM 배지.
 * ArenaScene 생성 시 1회만 연결한다(create()에서 호출). 웨이브 전환 로직은 건드리지 않고,
 * 씬의 'update' 이벤트를 구독해 패널이 열려 있는 동안만 scene.lastDirective/lastDirectiveFromLLM을 반영한다.
 */
export function attachDirectorLog(scene: ArenaScene): void {
  if (currentUpdateHandler) scene.events.off('update', currentUpdateHandler);

  const x = scene.scale.width - PANEL_X_MARGIN - PANEL_W;

  const bg = scene.add.graphics().setDepth(DEPTH);
  const badge = scene.add
    .text(x + PAD, PANEL_Y + PAD, '', { fontFamily: 'monospace', fontSize: '12px', color: INK_HEX })
    .setDepth(DEPTH + 1);
  const body = scene.add
    .text(x + PAD, 0, '', {
      fontFamily: 'monospace', fontSize: '11px', color: DIM_HEX, wordWrap: { width: PANEL_W - PAD * 2 },
    })
    .setDepth(DEPTH + 1);
  const hint = scene.add
    .text(x + PAD, 0, '[L] 토글 — 시연·심사용', { fontFamily: 'monospace', fontSize: '10px', color: FAINT_HEX })
    .setDepth(DEPTH + 1);

  let visible = false;
  const setVisible = (v: boolean) => {
    visible = v;
    bg.setVisible(v);
    badge.setVisible(v);
    body.setVisible(v);
    hint.setVisible(v);
  };

  const render = () => {
    badge.setText(`DIRECTIVE · ${scene.lastDirectiveFromLLM ? 'LLM ●' : 'BANK ○'}`);
    badge.setColor(scene.lastDirectiveFromLLM ? LLM_ON_HEX : LLM_OFF_HEX);
    body.setText(JSON.stringify(scene.lastDirective, null, 2));
    body.setPosition(x + PAD, PANEL_Y + PAD * 2 + badge.height);
    hint.setPosition(x + PAD, body.y + body.height + PAD / 2);

    const panelHeight = hint.y + hint.height + PAD - PANEL_Y;
    bg.clear();
    bg.fillStyle(BOARD_NUM, 0.92).fillRect(x, PANEL_Y, PANEL_W, panelHeight);
    bg.lineStyle(1, LINE_NUM, 1).strokeRect(x, PANEL_Y, PANEL_W, panelHeight);
  };

  setVisible(false);

  scene.input.keyboard!.on('keydown-L', () => {
    setVisible(!visible);
    if (visible) render();
  });

  currentUpdateHandler = () => {
    if (visible) render();
  };
  scene.events.on('update', currentUpdateHandler);
}
