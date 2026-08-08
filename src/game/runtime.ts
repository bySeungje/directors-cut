import { Ensemble } from './predictor';

// 리스타트 승계 (스펙 §3.1·§3.3): 같은 페이지 세션의 재도전은 앙상블·이력을 이어받는다.
// Phaser 씬 생명주기 밖의 모듈 싱글턴 — scene.restart로도 리셋되지 않는 것이 사양이다.

interface Runtime {
  ensemble: Ensemble | null;
  runCount: number;
}

export const runtime: Runtime = {
  ensemble: null,
  runCount: 0,
};

export function beginRun(): { ensemble: Ensemble; runCount: number } {
  if (!runtime.ensemble) runtime.ensemble = new Ensemble();
  runtime.runCount++;
  return { ensemble: runtime.ensemble, runCount: runtime.runCount };
}
