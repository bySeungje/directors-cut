---
id: C-arcade-timescale-inverse
type: contract
title: Arcade world.timeScale은 역수다 — 0.4는 느려지는 게 아니라 2.5배 빨라진다
anchors:
  - node_modules/phaser/src/physics/arcade/World.js#step
  - src/game/juice.ts#SLOWMO_FROM
---
Phaser 공식 정의로 **1=정상, 2=절반 속도, 0.5=2배 속도**. 구현상 `msPerFrame = _frameTimeMS × timeScale`이고 `while (_elapsed >= msPerFrame) step()`이라, 값이 작을수록 한 프레임에 스텝이 더 많이 돈다(`World.js:947`, `fixedStep` 기본 true).

브리프의 "웨이브 클리어 슬로모 timeScale 0.4"를 그대로 넣어 **2.5배 가속**이 걸려 있었다 — 웨이브를 깰 때마다 화면이 느려지는 대신 빨라졌고 영상에 그대로 찍힐 뻔했다. 0.4배속을 얻으려면 역수 `1/0.4 = 2.5`를 넣는다(`88e4b11`).

어기면: 연출 의도와 정반대가 되는데 코드만 보면 맞아 보인다.
