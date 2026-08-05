import { zzfx, ZZFX } from 'zzfx';

// zzfx 생성음 4종 + M 음소거 토글 (브리프 Task 9 Step 4). 외부 에셋 0 — 전부 합성음.
// 이 모듈은 Phaser에 의존하지 않는다(씬 생명주기와 무관 — mute 상태는 모듈 싱글턴으로 리스타트 전체에 걸쳐 유지된다).

// zzfx는 import 시점에 `new AudioContext`를 즉시 생성한다(라이브러리 자체 설계 — 패치 불가).
// 이 모듈은 ArenaScene·TitleScene에서만 import되고 어떤 tests/*.test.ts도 이 경로를 타지 않는다
// (vitest 기본 환경은 Node라 AudioContext가 없음 — import되는 순간 전체 테스트가 깨진다. 회귀 시 주의.)

let muted = false;

export function isMuted(): boolean {
  return muted;
}

export function toggleMute(): boolean {
  muted = !muted;
  return muted;
}

/** 브라우저의 오토플레이 정책상 AudioContext는 사용자 제스처 전까지 suspended다 —
 *  타이틀 클릭(최초 제스처) 시점에 1회 호출해 재생을 보장한다. */
export function resumeAudio(): void {
  if (ZZFX.audioContext.state === 'suspended') ZZFX.audioContext.resume().catch(() => {});
}

interface ZzfxParams {
  volume?: number; randomness?: number; frequency?: number; attack?: number; sustain?: number;
  release?: number; shape?: number; shapeCurve?: number; slide?: number; deltaSlide?: number;
  pitchJump?: number; pitchJumpTime?: number; repeatTime?: number; noise?: number; modulation?: number;
  bitCrush?: number; delay?: number; sustainVolume?: number; decay?: number; tremolo?: number; filter?: number;
}

// zzfx(...)는 21개 위치 인자라 그대로 호출하면 오타·순서 실수에 취약하다 — 이름 있는 객체로 감싼다.
function play(p: ZzfxParams): void {
  if (muted) return;
  zzfx(
    p.volume, p.randomness, p.frequency, p.attack, p.sustain, p.release, p.shape, p.shapeCurve,
    p.slide, p.deltaSlide, p.pitchJump, p.pitchJumpTime, p.repeatTime, p.noise, p.modulation,
    p.bitCrush, p.delay, p.sustainVolume, p.decay, p.tremolo, p.filter,
  );
}

/** 사격 — 짧은 픽. 연사 중 반복돼도 시끄럽지 않게 낮은 볼륨 + 피치를 randomness로 미세 변조. */
export function playShoot(): void {
  play({ volume: 0.22, randomness: 0.3, frequency: 1300, sustain: 0.02, release: 0.04, shape: 1, slide: -12, sustainVolume: 1 });
}

/** 피격 — 로우 노이즈. shape 4(노이즈) + 저역 필터로 둔탁한 타격감. */
export function playHit(): void {
  play({ volume: 0.4, randomness: 0.05, frequency: 100, sustain: 0.04, release: 0.12, shape: 4, filter: -300, sustainVolume: 1 });
}

/** 처치 — 팝. 짧은 pitchJump로 "톡" 튀는 느낌. */
export function playKill(): void {
  play({ volume: 0.35, randomness: 0.1, frequency: 280, sustain: 0.015, release: 0.09, shape: 0, pitchJump: 500, pitchJumpTime: 0.02, sustainVolume: 1 });
}

// 웨이브 클리어 — 상승 아르페지오(장3화음+옥타브). zzfx 1콜=톤 1개라 setTimeout으로 음을 이어 쏜다.
const CLEAR_ARPEGGIO_SEMITONES = [0, 4, 7, 12];
const CLEAR_NOTE_GAP_MS = 80;
const CLEAR_ROOT_FREQ = 440;

export function playWaveClear(): void {
  if (muted) return;
  for (let i = 0; i < CLEAR_ARPEGGIO_SEMITONES.length; i++) {
    const semi = CLEAR_ARPEGGIO_SEMITONES[i];
    setTimeout(() => {
      play({
        volume: 0.3, randomness: 0.05, frequency: ZZFX.getNote(semi, CLEAR_ROOT_FREQ),
        sustain: 0.08, release: 0.12, shape: 0, shapeCurve: 1.4, sustainVolume: 1, decay: 0.02,
      });
    }, i * CLEAR_NOTE_GAP_MS);
  }
}
