/**
 * 가상 업체 소개·작업 사례용 데모 사진 목록(경로·대체 텍스트). 사진은 AI로 생성한 데모 이미지이며 실제 업체·실제 실적이 아니다.
 * 파일: public/demo/work/<장면>-<before|after>.webp(확대 보기, 1440×1080) + 같은 이름의 -thumb.webp(카드, 640×480).
 *       public/demo/intro/<분야>.webp + -thumb.webp. 원본을 바꾸면 `node scripts/build-demo-photos.mjs <원본 폴더>`로 다시 만든다.
 * 대체 텍스트는 사진에 실제로 보이는 내용만 적는다.
 */
export const DEMO_PHOTO_SIZE = { width: 1440, height: 1080 } as const;

/** 작업 장면별 전·후 대체 텍스트. 전·후는 같은 대상·같은 구도에서 상태만 다르다 */
export const WORK_SCENES = {
  screen: { before: '가운데가 찢어져 구멍이 난 거실 창 방충망', after: '구멍 없이 팽팽한 거실 창 방충망' },
  screenFrame: { before: '아래 모서리가 휘어 창틀과 틈이 벌어진 방충망 틀', after: '모서리가 곧게 맞춰진 방충망 틀' },
  screenRoller: { before: '롤러가 닳아 레일에서 들뜬 방충망 문짝 아랫부분', after: '새 롤러가 레일 위에 놓인 방충망 문짝 아랫부분' },
  winRoller: { before: '롤러가 닳아 레일에 먼지와 부스러기가 쌓인 미닫이 창문 아랫부분', after: '새 롤러가 레일 위에 놓인 미닫이 창문 아랫부분' },
  winLock: { before: '손잡이가 부러져 밑동만 남은 창문 잠금장치', after: '손잡이가 달려 잠긴 새 창문 잠금장치' },
  weatherstrip: { before: '창틀과 창문 사이에 세로로 틈이 벌어진 창', after: '틈새막이를 붙여 틈이 메워진 창' },
  faucet: { before: '도금이 벗겨지고 물이 떨어지는 낡은 세면대 수전', after: '물이 떨어지지 않는 새 세면대 수전' },
  shower: { before: '호스 연결부에서 물이 옆으로 새는 낡은 샤워기', after: '물줄기가 고르게 나오는 새 샤워기' },
  trap: { before: '녹슬고 물이 새어 대야를 받쳐 둔 세면대 아래 배수 트랩', after: '새는 곳 없이 깨끗한 새 배수 트랩' },
  drain: { before: '탁한 물이 빠지지 않고 고여 있는 세면대', after: '물이 빠지고 배수구가 드러난 세면대' },
  handle: { before: '아래로 처지고 받침이 들뜬 낡은 문손잡이', after: '수평으로 반듯하게 달린 새 문손잡이' },
  hinge: { before: '한쪽으로 기울어 문틀과 틈이 어긋난 방문', after: '문틀과 틈이 고르게 맞춰진 방문' },
  closer: { before: '팔이 문틀에서 빠져 아래로 늘어진 현관문 도어클로저', after: '팔이 문틀에 연결된 도어클로저' },
  drawer: { before: '가운데 서랍이 비뚤게 빠져나온 서랍장', after: '서랍 세 칸이 나란히 닫힌 서랍장' },
  cabinetDoor: { before: '경첩이 풀려 한쪽 문이 처지고 벌어진 주방 벽 수납장', after: '두 문이 나란히 맞춰진 주방 벽 수납장' },
  light: { before: '누렇게 바래고 얼룩이 낀 낡은 거실 천장등', after: '하얗고 밝게 켜진 새 거실 천장등' },
  sensor: { before: '전구 하나만 달려 꺼져 있는 현관 천장', after: '센서등이 켜진 현관 천장' },
  switch: { before: '누렇게 바래고 모서리에 금이 간 벽 스위치', after: '하얗고 반듯한 새 벽 스위치' },
  outlet: { before: '누렇게 바래고 덮개에 금이 간 벽 콘센트', after: '하얗고 깨끗한 새 벽 콘센트' },
  curtain: { before: '커튼 없이 비어 있는 방 창문', after: '레일에 커튼이 걸린 방 창문' },
  blind: { before: '살이 꺾이고 한쪽이 처진 낡은 블라인드', after: '반듯하게 내려온 새 롤 블라인드' },
  shelf: { before: '선반 없이 비어 있고 화분이 바닥에 놓인 벽', after: '선반이 달리고 화분이 올라간 벽' },
  towel: { before: '한쪽 고정이 벽에서 빠져 기울어진 욕실 수건걸이', after: '양쪽이 벽에 고정된 욕실 수건걸이' },
  paper: { before: '예전 걸이를 뗀 자국과 나사 구멍이 남은 욕실 벽', after: '휴지걸이가 달리고 휴지가 걸린 욕실 벽' },
  mirror: { before: '벽에 걸지 못해 바닥에 기대어 둔 거울', after: '콘솔 위 벽에 걸린 거울' },
  silicone: { before: '곰팡이가 피고 갈라진 욕조 둘레 실리콘', after: '하얗게 다시 채운 욕조 둘레 실리콘' },
  kitchenSilicone: { before: '누렇게 들뜨고 갈라진 싱크대 상판과 벽 사이 실리콘', after: '틈 없이 다시 채운 싱크대 상판과 벽 사이 실리콘' },
  grout: { before: '줄눈이 검게 변색된 욕실 바닥 타일', after: '줄눈을 하얗게 다시 채운 욕실 바닥 타일' },
  stopper: { before: '문손잡이에 긁힌 자국이 난 벽과 도어스토퍼 없는 방문', after: '바닥에 도어스토퍼가 달려 문이 벽에 닿지 않는 모습' },
  dryRack: { before: '한쪽이 내려앉아 기울어진 베란다 천장 빨래건조대', after: '수평으로 걸리고 옷이 널린 베란다 천장 빨래건조대' },
} as const;
export type WorkScene = keyof typeof WORK_SCENES;

/** 업체 소개 사진(분야별 작업 도구·현장 — 사람 없음). 같은 분야 업체가 함께 쓴다 */
export const INTRO_PHOTOS = {
  c1: '거실 창가 바닥에 놓인 방충망 롤과 교체 도구',
  c2: '세면대 아래 배관 앞에 놓인 스패너와 수전 부품',
  c3: '방문 앞에 놓인 경첩과 드라이버',
  c4: '서랍장 앞에 놓인 서랍 레일과 전동 드릴',
  c5: '창가에 놓인 틈새막이 롤과 창문 롤러·잠금장치 부품',
  c6: '거실 벽 앞에 놓인 스위치와 절연 드라이버',
  c7: '창가에 놓인 선반 받침대와 전동 드릴, 앵커',
  c8: '수건걸이와 휴지걸이가 달린 욕실 벽 앞에 놓인 설치 도구',
  c9: '욕조 앞에 놓인 실리콘 건과 헤라, 마스킹 테이프',
  c10: '현관 바닥에 놓인 공구함과 수공구',
} as const;
export type IntroPhoto = keyof typeof INTRO_PHOTOS;
