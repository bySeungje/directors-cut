export const CUTROOM_ROUNDS = 3;
export const TIMELINE_SIZE = 5;

export const EVIDENCE_TAGS = [
  'PLAYER',
  'GUARD',
  'UNKNOWN',
  'LINE_OF_SIGHT',
  'VAULT_ACCESS',
  'AUDIO_GAP',
  'SHADOW_MISMATCH',
  'CLEAN_CUT',
  'EXIT_TRAIL',
  'BLOOD_TRACE',
] as const;

export type EvidenceTag = (typeof EVIDENCE_TAGS)[number];
export type LocationId = 'LOBBY' | 'HALL' | 'VAULT' | 'SERVER' | 'EXIT';
export type ContradictionType =
  | 'TIME_BACKTRACK'
  | 'TIME_GAP'
  | 'LOCATION_JUMP'
  | 'CLEAN_CUT_OVERUSE'
  | 'MISSING_VAULT'
  | 'PRESSURE_REPEAT';

export interface Clip {
  id: string;
  time: number;
  camera: LocationId;
  title: string;
  caption: string;
  tags: EvidenceTag[];
  risk: number;
}

export interface Contradiction {
  type: ContradictionType;
  severity: number;
  evidence: string;
  tag: EvidenceTag;
}

export interface DetectiveDirective {
  accusation: string;
  pressure: 'LOCK_TAG' | 'REQUEST_AUDIO' | 'REVEAL_HIDDEN_CUT' | 'MARK_SUSPECT_TAG';
  targetTag: EvidenceTag;
  taunt: string;
  intent: string;
}

export interface RoundAssessment {
  round: number;
  clips: Clip[];
  contradictions: Contradiction[];
  score: number;
  directive: DetectiveDirective;
}

export interface FinalInvestigation {
  verdict: 'PERFECT_CUT' | 'REASONABLE_DOUBT' | 'INDICTED';
  title: string;
  body: string;
}

export const CUTROOM_CLIPS: readonly Clip[] = [
  {
    id: 'lobby-2101',
    time: 1261,
    camera: 'LOBBY',
    title: '21:01 로비',
    caption: '흰 모자를 쓴 인물이 정문을 지나간다.',
    tags: ['UNKNOWN', 'CLEAN_CUT'],
    risk: 1,
  },
  {
    id: 'hall-2102',
    time: 1262,
    camera: 'HALL',
    title: '21:02 복도',
    caption: '경비가 금고 쪽 복도 끝을 바라본다.',
    tags: ['GUARD', 'LINE_OF_SIGHT'],
    risk: 2,
  },
  {
    id: 'server-2102',
    time: 1262,
    camera: 'SERVER',
    title: '21:02 서버실',
    caption: '플레이어가 서버 랙 뒤로 사라진다.',
    tags: ['PLAYER', 'SHADOW_MISMATCH'],
    risk: 3,
  },
  {
    id: 'vault-2103',
    time: 1263,
    camera: 'VAULT',
    title: '21:03 금고 앞',
    caption: '금고 키패드가 한 번 켜진다.',
    tags: ['VAULT_ACCESS', 'AUDIO_GAP'],
    risk: 4,
  },
  {
    id: 'hall-2104',
    time: 1264,
    camera: 'HALL',
    title: '21:04 복도',
    caption: '복도 조명이 반 박자 늦게 깜박인다.',
    tags: ['CLEAN_CUT', 'SHADOW_MISMATCH'],
    risk: 2,
  },
  {
    id: 'exit-2105',
    time: 1265,
    camera: 'EXIT',
    title: '21:05 비상구',
    caption: '비상구 문틈에 붉은 흔적이 남아 있다.',
    tags: ['EXIT_TRAIL', 'BLOOD_TRACE'],
    risk: 5,
  },
  {
    id: 'lobby-2106',
    time: 1266,
    camera: 'LOBBY',
    title: '21:06 로비',
    caption: '경비가 무전기를 꺼내 들지만 소리가 비어 있다.',
    tags: ['GUARD', 'AUDIO_GAP'],
    risk: 3,
  },
  {
    id: 'vault-2107',
    time: 1267,
    camera: 'VAULT',
    title: '21:07 금고 내부',
    caption: '금고 내부 카메라에 딱 2초의 검은 프레임이 있다.',
    tags: ['VAULT_ACCESS', 'CLEAN_CUT'],
    risk: 5,
  },
  {
    id: 'server-2108',
    time: 1268,
    camera: 'SERVER',
    title: '21:08 서버실',
    caption: '플레이어가 빈손으로 서버실을 나온다.',
    tags: ['PLAYER', 'CLEAN_CUT'],
    risk: 2,
  },
  {
    id: 'hall-2110',
    time: 1270,
    camera: 'HALL',
    title: '21:10 복도',
    caption: '경비의 그림자가 카메라 밖 누군가와 겹친다.',
    tags: ['GUARD', 'UNKNOWN', 'SHADOW_MISMATCH'],
    risk: 4,
  },
  {
    id: 'exit-2111',
    time: 1271,
    camera: 'EXIT',
    title: '21:11 비상구',
    caption: '흰 모자가 비상구 밖으로 사라진다.',
    tags: ['UNKNOWN', 'EXIT_TRAIL'],
    risk: 3,
  },
  {
    id: 'lobby-2112',
    time: 1272,
    camera: 'LOBBY',
    title: '21:12 로비',
    caption: '로비 화면은 너무 깨끗하다. 아무도 없다.',
    tags: ['CLEAN_CUT'],
    risk: 1,
  },
];

const LOCATION_ORDER: Record<LocationId, number> = {
  LOBBY: 0,
  HALL: 1,
  SERVER: 2,
  VAULT: 3,
  EXIT: 4,
};

export function scoreTimeline(
  clips: readonly Clip[],
  opts: { round: number; pressureTags?: readonly EvidenceTag[] } = { round: 1 },
): { score: number; contradictions: Contradiction[] } {
  const contradictions: Contradiction[] = [];
  const pressureTags = new Set(opts.pressureTags ?? []);

  for (let i = 1; i < clips.length; i++) {
    const prev = clips[i - 1];
    const cur = clips[i];
    if (cur.time < prev.time) {
      contradictions.push({
        type: 'TIME_BACKTRACK',
        severity: 5,
        evidence: `${prev.title} 뒤에 더 이른 ${cur.title}을 붙였다.`,
        tag: 'CLEAN_CUT',
      });
    }
    const gap = cur.time - prev.time;
    if (gap > 2) {
      contradictions.push({
        type: 'TIME_GAP',
        severity: Math.min(5, gap),
        evidence: `${formatMinute(prev.time)}에서 ${formatMinute(cur.time)}까지 ${gap}분이 비어 있다.`,
        tag: 'AUDIO_GAP',
      });
    }
  }

  const playerClips = clips.filter((clip) => clip.tags.includes('PLAYER'));
  for (let i = 1; i < playerClips.length; i++) {
    const prev = playerClips[i - 1];
    const cur = playerClips[i];
    const dt = Math.max(1, cur.time - prev.time);
    const distance = Math.abs(LOCATION_ORDER[cur.camera] - LOCATION_ORDER[prev.camera]);
    if (distance >= 3 && dt <= 1) {
      contradictions.push({
        type: 'LOCATION_JUMP',
        severity: 4,
        evidence: `플레이어가 ${formatMinute(prev.time)} ${prev.camera}에서 ${formatMinute(cur.time)} ${cur.camera}로 순간 이동했다.`,
        tag: 'PLAYER',
      });
    }
  }

  const cleanCuts = clips.filter((clip) => clip.tags.includes('CLEAN_CUT')).length;
  if (cleanCuts >= 3) {
    contradictions.push({
      type: 'CLEAN_CUT_OVERUSE',
      severity: cleanCuts,
      evidence: `너무 깨끗한 컷이 ${cleanCuts}개다. 지운 흔적이 없는 게 오히려 흔적이다.`,
      tag: 'CLEAN_CUT',
    });
  }

  if (!clips.some((clip) => clip.tags.includes('VAULT_ACCESS'))) {
    contradictions.push({
      type: 'MISSING_VAULT',
      severity: 4,
      evidence: '금고 사건인데 금고 접근 컷이 없다.',
      tag: 'VAULT_ACCESS',
    });
  }

  for (const tag of pressureTags) {
    const repeats = clips.filter((clip) => clip.tags.includes(tag)).length;
    if (repeats > 0) {
      contradictions.push({
        type: 'PRESSURE_REPEAT',
        severity: opts.round + repeats,
        evidence: `직전 심문에서 지목한 ${tag} 단서를 다시 썼다.`,
        tag,
      });
    }
  }

  const risk = clips.reduce((sum, clip) => sum + clip.risk, 0);
  const contradictionScore = contradictions.reduce((sum, c) => sum + c.severity, 0);
  return { score: risk + contradictionScore, contradictions };
}

export function assembleDetectiveDirective(assessment: Pick<RoundAssessment, 'round' | 'score' | 'contradictions'>): DetectiveDirective {
  const strongest = [...assessment.contradictions].sort((a, b) => b.severity - a.severity)[0];
  if (!strongest) {
    return {
      accusation: '편집은 매끄럽다. 그래서 더 불편하지. 범인은 늘 빈칸을 예쁘게 닦아낸다.',
      pressure: 'REVEAL_HIDDEN_CUT',
      targetTag: 'CLEAN_CUT',
      taunt: '완벽한 알리바이는 보통 사람이 만들지 않는다.',
      intent: '모순이 적은 플레이어에게 다음 라운드 은폐 비용을 올린다.',
    };
  }

  const pressure: DetectiveDirective['pressure'] =
    strongest.tag === 'AUDIO_GAP'
      ? 'REQUEST_AUDIO'
      : strongest.tag === 'CLEAN_CUT'
        ? 'REVEAL_HIDDEN_CUT'
        : strongest.tag === 'VAULT_ACCESS'
          ? 'LOCK_TAG'
          : 'MARK_SUSPECT_TAG';

  return {
    accusation: strongest.evidence,
    pressure,
    targetTag: strongest.tag,
    taunt: tauntFor(strongest.tag, assessment.score),
    intent: `${strongest.tag} 계열 모순을 다음 라운드 압박 대상으로 삼는다.`,
  };
}

export function assessRound(round: number, clips: readonly Clip[], pressureTags: readonly EvidenceTag[] = []): RoundAssessment {
  const scored = scoreTimeline(clips, { round, pressureTags });
  const base = {
    round,
    clips: [...clips],
    contradictions: scored.contradictions,
    score: scored.score,
  };
  return { ...base, directive: assembleDetectiveDirective(base) };
}

export function finalInvestigation(totalSuspicion: number, assessments: readonly RoundAssessment[]): FinalInvestigation {
  const top = assessments
    .flatMap((a) => a.contradictions)
    .sort((a, b) => b.severity - a.severity)[0];

  if (totalSuspicion <= 24) {
    return {
      verdict: 'PERFECT_CUT',
      title: '완전한 컷',
      body: `총 의심 ${totalSuspicion}. 수사관은 컷 사이의 빈칸을 봤지만, 법정에 올릴 모순은 만들지 못했다. 너는 사건을 숨긴 게 아니라 사건이 없었던 것처럼 편집했다.`,
    };
  }
  if (totalSuspicion <= 39) {
    return {
      verdict: 'REASONABLE_DOUBT',
      title: '합리적 의심',
      body: `총 의심 ${totalSuspicion}. ${top ? `가장 큰 균열은 "${top.evidence}"였다. ` : ''}하지만 균열은 증거가 아니다. AI는 널 의심하지만, 아직 널 붙잡지는 못한다.`,
    };
  }
  return {
    verdict: 'INDICTED',
    title: '기소 의견',
    body: `총 의심 ${totalSuspicion}. ${top ? `결정적 균열은 "${top.evidence}"였다. ` : ''}편집본은 알리바이가 아니라 자백의 순서를 바꾼 문서가 됐다.`,
  };
}

export function formatMinute(minute: number): string {
  const h = Math.floor(minute / 60);
  const m = minute % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function tauntFor(tag: EvidenceTag, score: number): string {
  if (tag === 'AUDIO_GAP') return '소리가 비면 사람은 시간을 상상한다. 나는 그 상상을 증거로 쓴다.';
  if (tag === 'CLEAN_CUT') return '깨끗한 컷은 결백이 아니라 세탁이다.';
  if (tag === 'PLAYER') return '몸은 숨겼어도 동선은 남는다.';
  if (tag === 'VAULT_ACCESS') return '금고 없는 금고 사건은 없다.';
  if (tag === 'SHADOW_MISMATCH') return '그림자는 편집자를 배신한다.';
  return score >= 20 ? '이 편집본은 너무 많은 것을 설명하려 한다.' : '아직은 말이 된다. 그래서 다음 컷을 보겠다.';
}
