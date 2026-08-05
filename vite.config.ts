import { defineConfig } from 'vite';
export default defineConfig({
  base: '/directors-cut/',
  build: { target: 'es2020' },
  // test.env는 vitest 실행에만 적용되고 build/dev에는 영향 없다 — 실제 .env는 배포 후 승제가 넣는다(gitignore).
  // 더미 URL: 테스트는 fetch를 항상 vi.stubGlobal로 모킹하므로 실네트워크 호출은 발생하지 않는다.
  test: { env: { VITE_DIRECTOR_URL: 'https://test.invalid/director' } },
});
