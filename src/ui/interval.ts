import Phaser from 'phaser';
import type { Directive } from '../contracts/directive';
import type { ArenaScene } from '../game/scenes/ArenaScene';
import { UPGRADES, pick3, type UpgradeId } from '../game/upgrades';

// ── 연출 파라미터 (브리프 명시 수치) ──────────────────────────────────────
const CHAR_MS = 30; // 대사 타이핑 — 글자당 30ms
const CURSOR_CHAR = '▍';
const CARD_APPEAR_DELAY_MS = 500; // 타이핑 종료 → 카드 등장까지 소폭 정지(재량 결정 — 리듬감)

// ── 레이아웃 (시안 v1 SCREEN 03 좌표를 그대로 사용 — 캔버스 960×640과 좌표계가 1:1이다) ──
const OVERLAY_ALPHA = 0.55;
const PANEL_X = 140, PANEL_Y = 130, PANEL_W = 680, PANEL_H = 120;
const BADGE_SIZE = 36, BADGE_MARGIN = 24;
const SUBHEAD_Y = 300;
const CARD_W = 200, CARD_H = 180, CARD_GAP = 30, CARD_TOP = 340;
const CARDS_LEFT = 150; // (960 - (3*CARD_W + 2*CARD_GAP)) / 2 — 시안과 동일하게 중앙 정렬
const CARD_HOVER_SCALE = 1.06;

// ── 색상 (시안 v1 CSS 변수 그대로: --board·--surface·--line·--red·--ink·--dim·--faint) ──
const BG_NUM = 0x0a0a0f;
const BOARD_NUM = 0x0e0e15;
const SURFACE_NUM = 0x12121a;
const LINE_NUM = 0x23232e;
const RED_NUM = 0xff2d2d;
const BG_HEX = '#0a0a0f';
const INK_HEX = '#e8e8ec';
const RED_HEX = '#ff2d2d';
const DIM_HEX = '#7a7a88';
const FAINT_HEX = '#3a3a46';

const DEPTH_OVERLAY = 1500; // 기존 HUD(1000) 위 — 인터벌 중에는 HUD도 함께 어둡게 덮는다
const DEPTH_UI = 1600;

const PICK_KEYS: { event: string; index: number }[] = [
  { event: 'keydown-ONE', index: 0 },
  { event: 'keydown-TWO', index: 1 },
  { event: 'keydown-THREE', index: 2 },
];

/**
 * 웨이브 클리어 인터벌 연출: 대사 타이핑(클릭 시 스킵) → 업그레이드 3택1 카드(호버 확대, 클릭 또는 1·2·3 키).
 * 선택 즉시 scene.player.stats에 반영하고, onDone(선택한 UpgradeId)으로 호출자(ArenaScene)에 통지한다.
 * ArenaScene의 웨이브 전환 로직(beginWave 등)은 건드리지 않는다 — 통지만 하고 진행은 onDone 콜백이 결정한다.
 */
export function runInterval(scene: ArenaScene, directive: Directive, onDone: (picked: UpgradeId) => void): void {
  const objects: Phaser.GameObjects.GameObject[] = [];
  const timers: Phaser.Time.TimerEvent[] = [];
  const track = <T extends Phaser.GameObjects.GameObject>(o: T): T => {
    objects.push(o);
    return o;
  };

  let typingSettled = false; // 자연 완료와 스킵 클릭이 겹쳐도 finishTyping이 한 번만 실행되게
  let picked = false; // 카드 클릭과 숫자키가 동시에 들어와도 onDone이 한 번만 불리게

  const cleanup = () => {
    scene.events.off('player-died', onPlayerDiedDuringInterval);
    scene.input.off('pointerdown', skipTyping);
    for (const { event } of PICK_KEYS) scene.input.keyboard!.off(event);
    for (const t of timers) scene.time.removeEvent(t);
    scene.tweens.killTweensOf(objects); // 카드 선택 시 호버 확대 트윈이 아직 진행 중일 수 있어 파괴 전에 멈춘다
    for (const o of objects) o.destroy();
  };

  // 인터벌 중(주로 대사 타이핑 단계)에도 잔여 적탄으로 사망할 수 있다 — ArenaScene은 그 경우 onDone을
  // 호출하지 않도록 자체 가드를 갖고 있지만, 그것만으로는 이미 그려진 대사·카드가 화면에 계속 남아
  // 클릭 가능한 상태로 방치된다(리뷰 지적: 죽은 플레이어 위에 유령 UI). 여기서도 즉시 정리한다.
  const onPlayerDiedDuringInterval = () => cleanup();
  scene.events.once('player-died', onPlayerDiedDuringInterval);

  // ── 오버레이(정지된 아레나를 덮어 인터벌 모드임을 표시) + 상단 라벨 ────
  track(
    scene.add
      .rectangle(scene.scale.width / 2, scene.scale.height / 2, scene.scale.width, scene.scale.height, BG_NUM, OVERLAY_ALPHA)
      .setDepth(DEPTH_OVERLAY),
  );
  track(
    scene.add
      .text(scene.scale.width / 2, 60, `TAKE ${scene.currentWave} CUT — 다음 장면 재작성`, {
        fontFamily: 'monospace', fontSize: '15px', color: DIM_HEX,
      })
      .setOrigin(0.5)
      .setDepth(DEPTH_UI),
  );

  // ── 디렉터 패널: 검정 박스 + 레드 보더 + 레드 D 뱃지 + DIRECTOR 라벨(시안 SCREEN 03) ──
  track(
    scene.add
      .rectangle(PANEL_X + PANEL_W / 2, PANEL_Y + PANEL_H / 2, PANEL_W, PANEL_H, BOARD_NUM)
      .setStrokeStyle(2, RED_NUM)
      .setDepth(DEPTH_UI),
  );
  const badgeCx = PANEL_X + BADGE_MARGIN + BADGE_SIZE / 2;
  const badgeCy = PANEL_Y + BADGE_MARGIN + BADGE_SIZE / 2;
  track(scene.add.rectangle(badgeCx, badgeCy, BADGE_SIZE, BADGE_SIZE, RED_NUM).setDepth(DEPTH_UI + 1));
  track(
    scene.add
      .text(badgeCx, badgeCy, 'D', { fontFamily: 'monospace', fontSize: '20px', color: BG_HEX, fontStyle: 'bold' })
      .setOrigin(0.5)
      .setDepth(DEPTH_UI + 1),
  );

  const textLeft = badgeCx + BADGE_SIZE / 2 + 18;
  const textWidth = PANEL_X + PANEL_W - textLeft - 24;
  track(
    scene.add
      .text(textLeft, PANEL_Y + 24, 'AI DIRECTOR', { fontFamily: 'monospace', fontSize: '12px', color: RED_HEX })
      .setDepth(DEPTH_UI + 1),
  );
  const tauntText = track(
    scene.add
      .text(textLeft, PANEL_Y + 46, '', {
        fontFamily: 'monospace', fontSize: '18px', color: INK_HEX, wordWrap: { width: textWidth },
      })
      .setDepth(DEPTH_UI + 1),
  );

  // ── 대사 타이핑(글자당 30ms) — 클릭하면 즉시 전체 텍스트로 스킵 ────────
  const taunt = directive.taunt;
  let shown = 0;
  const revealTick = () => {
    shown++;
    tauntText.setText(taunt.slice(0, shown) + (shown < taunt.length ? CURSOR_CHAR : ''));
    if (shown >= taunt.length) finishTyping();
  };
  const skipTyping = () => finishTyping();

  const typingTimer = scene.time.addEvent({ delay: CHAR_MS, callback: revealTick, repeat: Math.max(0, taunt.length - 1) });
  timers.push(typingTimer);

  function finishTyping() {
    if (typingSettled) return;
    typingSettled = true;
    // 스킵 클릭 시 typingTimer가 아직 남은 repeat을 갖고 있다 — 멈추지 않으면 뒤늦게 도착하는 tick이
    // 지금 막 확정한 전체 텍스트를 다시 부분 문자열로 덮어쓴다(자연 완료 경로는 이미 repeat이 소진된 뒤라 안전).
    scene.time.removeEvent(typingTimer);
    scene.input.off('pointerdown', skipTyping); // 스킵 리스너는 once였지만, 자연완료 경로에선 안 불렸으니 명시적으로 제거
    tauntText.setText(taunt); // 스킵된 경우에도 최종 텍스트로 확정(커서 제거)

    track(
      scene.add
        .text(textLeft, PANEL_Y + 84, `설계 의도 — ${directive.intent}`, {
          fontFamily: 'monospace', fontSize: '13px', color: DIM_HEX, wordWrap: { width: textWidth },
        })
        .setDepth(DEPTH_UI + 1),
    );

    timers.push(scene.time.delayedCall(CARD_APPEAR_DELAY_MS, showCards));
  }

  scene.input.once('pointerdown', skipTyping);

  // ── 업그레이드 3택1 카드(무채색, 선택 대상만 레드 보더 + 호버 확대) ────
  function showCards() {
    track(
      scene.add
        .text(scene.scale.width / 2, SUBHEAD_Y, '다음 TAKE의 생존 방식을 하나 고른다', {
          fontFamily: 'monospace', fontSize: '14px', color: DIM_HEX,
        })
        .setOrigin(0.5)
        .setDepth(DEPTH_UI),
    );

    // 예측을 깼으면 이 라운드 디렉터의 봉인이 걸리지 않는다 — "내 읽기를 깼으니 내 봉인도 안 걸린다".
    // 스코어에 이빨을 주는 유일한 지점이고, 승패 조건과 예산에는 손대지 않는다.
    const denyThisRound = scene.brokePrediction ? 'NONE' : directive.deny;
    if (scene.brokePrediction && directive.deny !== 'NONE') {
      track(
        scene.add
          .text(scene.scale.width / 2, SUBHEAD_Y + 22, '예측을 깼다 — 이번 봉인은 걸리지 않는다', {
            fontFamily: 'monospace', fontSize: '12px', color: RED_HEX,
          })
          .setOrigin(0.5)
          .setDepth(DEPTH_UI),
      );
    }
    pick3(denyThisRound).forEach((id, i) => buildCard(id, i));
  }

  function buildCard(id: UpgradeId, index: number) {
    const def = UPGRADES[id];
    const cx = CARDS_LEFT + index * (CARD_W + CARD_GAP) + CARD_W / 2;
    const cy = CARD_TOP + CARD_H / 2;

    const bg = scene.add.rectangle(0, 0, CARD_W, CARD_H, SURFACE_NUM).setStrokeStyle(1, LINE_NUM);
    const title = scene.add
      .text(0, -CARD_H / 2 + 40, def.name, { fontFamily: 'monospace', fontSize: '18px', color: INK_HEX, fontStyle: 'bold' })
      .setOrigin(0.5);
    const desc = scene.add
      .text(0, 0, def.desc, {
        fontFamily: 'monospace', fontSize: '13px', color: DIM_HEX, align: 'center', wordWrap: { width: CARD_W - 32 },
      })
      .setOrigin(0.5);
    const hint = scene.add
      .text(0, CARD_H / 2 - 22, `[${index + 1}]`, { fontFamily: 'monospace', fontSize: '12px', color: FAINT_HEX })
      .setOrigin(0.5);

    const container = track(scene.add.container(cx, cy, [bg, title, desc, hint]).setDepth(DEPTH_UI));

    // 히트테스트는 원래 크기의 별도 Zone이 맡는다 — 컨테이너 자체를 확대해도 클릭 판정 영역이 흔들리지 않게.
    const zone = track(scene.add.zone(cx, cy, CARD_W, CARD_H).setInteractive({ useHandCursor: true }).setDepth(DEPTH_UI + 1));
    zone.on('pointerover', () => {
      bg.setStrokeStyle(2, RED_NUM);
      scene.tweens.add({ targets: container, scale: CARD_HOVER_SCALE, duration: 120, ease: 'Sine.easeOut' });
    });
    zone.on('pointerout', () => {
      bg.setStrokeStyle(1, LINE_NUM);
      scene.tweens.add({ targets: container, scale: 1, duration: 120, ease: 'Sine.easeOut' });
    });
    zone.on('pointerdown', () => select(id));

    scene.input.keyboard!.on(PICK_KEYS[index].event, () => select(id));
  }

  function select(id: UpgradeId) {
    if (picked) return;
    picked = true;
    scene.player.applyStats(UPGRADES[id].apply(scene.player.stats));
    cleanup();
    onDone(id);
  }
}
