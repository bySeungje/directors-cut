// zzfx(1.3.2)는 타입 정의를 제공하지 않는다(순수 JS, 21개 위치 인자의 신스 엔진) — 최소 앰비언트 선언.
// 실제 파라미터 이름·순서는 node_modules/zzfx/ZzFX.js의 ZZFX.buildSamples 시그니처 참고.
// 인자 타입이 (number|undefined)[]인 이유: zzfx는 JS 기본 매개변수로 각 자리를 채운다 —
// 호출부(game/sound.ts)가 옵션 객체의 미설정 필드를 그대로 넘겨 undefined가 자연스럽게 섞인다.
declare module 'zzfx' {
  export function zzfx(...parameters: (number | undefined)[]): AudioBufferSourceNode;

  export const ZZFX: {
    volume: number;
    sampleRate: number;
    audioContext: AudioContext;
    play(...parameters: (number | undefined)[]): AudioBufferSourceNode;
    playSamples(
      sampleChannels: number[][],
      volumeScale?: number,
      rate?: number,
      pan?: number,
      loop?: boolean,
    ): AudioBufferSourceNode;
    buildSamples(...parameters: (number | undefined)[]): number[];
    getNote(semitoneOffset?: number, rootNoteFrequency?: number): number;
  };
}
