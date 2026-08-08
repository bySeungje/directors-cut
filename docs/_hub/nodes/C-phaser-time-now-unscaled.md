---
id: C-phaser-time-now-unscaled
type: contract
title: scene.time.now는 timeScale의 영향을 받지 않는다 — 배속을 걸면 밸런스가 깨진다
anchors:
  - node_modules/phaser/src/time/Clock.js#update
  - src/game/entities.ts#lastFireAt
---
전투 구간에 배속을 걸려면 시간축을 조작하지 말고 **상수 배율**로 한다(이동속도·탄속에 곱하고 모든 간격을 나눔). 시간축 조작은 이 코드베이스에서 성립하지 않는다.

`Clock.js:370`이 `this.now = time`(원시 시각)이고 `timeScale`은 `:377`에서 TimerEvent의 `delta`에만 곱해진다. 그런데 연사·대시 쿨다운·피격 무적·shooter 발사 간격이 전부 `scene.time.now`를 쓴다.

어기면: 적 이동만 빨라지고 사격·무적·쿨다운은 실시간 그대로 → 난이도가 통째로 바뀌고 그 상태로 잰 계측치가 전부 무효가 된다.
