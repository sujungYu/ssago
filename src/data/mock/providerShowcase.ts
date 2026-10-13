import type { PortfolioCase, PortfolioPhoto, ProviderProfile, ShowcaseImage } from '../../domain/types';
import { DEMO_PHOTO_SIZE, INTRO_PHOTOS, WORK_SCENES, type IntroPhoto, type WorkScene } from './demoPhotos';

/**
 * 업체별 소개(소개 사진·소개글)와 작업 사례(가상 데이터). 업체 상세 조회(getProvider)가 profile·portfolio로 내려준다.
 * 실제 서비스에서는 업체(파트너)가 등록하는 데이터다 — 이번 데모에는 등록 화면·서버 연동이 없다.
 *
 * 데모 콘텐츠 기준
 * - 모든 사진은 AI로 생성한 데모 사진이다(public/demo, 목록은 demoPhotos.ts). 실제 업체·직원 사진이나 실제 시공 사진이 아니며 화면에 ‘데모 이미지’로 표시한다.
 * - 소개글은 그 업체의 등록 작업(providerServices.ts)만 설명한다. 경력·자격증·보험·보증·시공 건수·만족도 같은 확인되지 않은 실적은 적지 않는다.
 * - 작업 사례는 그 업체가 등록한 작업(serviceId)에만 둔다. 전·후는 같은 장면의 한 쌍(같은 대상·같은 구도)만 묶고, 쌍으로 두지 않을 때는 한 장(single)으로 보여준다.
 * - 사진은 장면당 한 벌, 소개 사진은 분야당 한 장이라 같은 분야 업체끼리 같은 사진을 함께 쓴다(업체별 사례 묶음은 서로 다르다).
 */
export interface ProviderShowcase {
  profile: ProviderProfile;
  portfolio: PortfolioCase[];
}

/** 카드에는 썸네일(src), 확대 보기에는 같은 사진의 큰 파일(fullSrc)을 쓴다 */
const image = (base: string, alt: string): ShowcaseImage => ({ src: `${base}-thumb.webp`, fullSrc: `${base}.webp`, alt, ...DEMO_PHOTO_SIZE });
const work = (scene: WorkScene, state: 'before' | 'after') => `/demo/work/${scene}-${state}`;
/** 작업 전·후 한 쌍(같은 장면) */
const pair = (scene: WorkScene): PortfolioPhoto[] => [
  { role: 'before', ...image(work(scene, 'before'), WORK_SCENES[scene].before) },
  { role: 'after', ...image(work(scene, 'after'), WORK_SCENES[scene].after) },
];
/** 작업 후 한 장만(전후 비교 없이 보여주는 사례) */
const single = (scene: WorkScene): PortfolioPhoto[] => [{ role: 'single', ...image(work(scene, 'after'), WORK_SCENES[scene].after) }];
const kase = (id: string, serviceId: string, title: string, description: string, photos: PortfolioPhoto[]): PortfolioCase => ({ id, serviceId, title, description, photos, demo: true });
/** intro: 그 업체가 주로 하는 분야의 소개 사진 */
const entry = (intro: IntroPhoto, about: string, portfolio: PortfolioCase[]): ProviderShowcase => ({
  profile: { photo: image(`/demo/intro/${intro}`, INTRO_PHOTOS[intro]), about, demo: true },
  portfolio,
});

export const PROVIDER_SHOWCASE: Record<string, ProviderShowcase> = {
  p1: entry('c2',
    '세면대·주방 수전과 샤워기 교체, 배수 트랩·배수구 수리처럼 물이 닿는 부속을 주로 손봐요. 수전 주변 실리콘 재시공도 함께 맡아요.',
    [
      kase('pf-p1-1', 'sv-p1-faucet', '욕실 세면대 수전 교체', '손잡이가 헐거워 물이 떨어지던 수전을 새 수전으로 바꾼 사례예요.', pair('faucet')),
      kase('pf-p1-2', 'sv-p1-trap', '세면대 배수 트랩 교체', '이음새에서 물이 새던 트랩을 새 부품으로 교체한 사례예요.', pair('trap')),
      kase('pf-p1-3', 'sv-p1-silicone', '욕조 둘레 실리콘 재시공', '곰팡이가 핀 실리콘을 걷어 내고 다시 채운 사례예요.', pair('silicone')),
    ]),
  p2: entry('c3',
    '수전 교체부터 문손잡이·경첩, 서랍 레일과 수납장 문까지 집 안의 작은 수리를 폭넓게 맡아요.',
    [
      kase('pf-p2-1', 'sv-p2-drawer', '서랍장 서랍 레일 수리', '비뚤게 빠지던 가운데 서랍의 레일을 손봐 다시 맞춘 사례예요.', pair('drawer')),
      kase('pf-p2-2', 'sv-p2-handle', '방문 손잡이 교체', '아래로 처진 손잡이를 새 레버형 손잡이로 바꾼 사례예요.', pair('handle')),
    ]),
  p3: entry('c6',
    '거실·주방 조명 교체, 스위치·콘센트 교체, 센서등 설치를 주로 해요.',
    [
      kase('pf-p3-1', 'sv-p3-light', '거실 천장등 교체', '누렇게 바랜 천장등을 새 등으로 바꾼 사례예요.', pair('light')),
      kase('pf-p3-2', 'sv-p3-switch', '벽 스위치 교체', '금이 간 스위치를 새 스위치로 교체한 사례예요.', pair('switch')),
      kase('pf-p3-3', 'sv-p3-outlet', '벽 콘센트 교체', '금이 가고 바랜 콘센트를 새 콘센트로 교체한 사례예요.', pair('outlet')),
    ]),
  p4: entry('c3',
    '문손잡이 교체, 경첩·도어클로저 조정, 방충망 교체처럼 문과 창의 여닫이 문제를 손봐요.',
    [
      kase('pf-p4-1', 'sv-p4-handle', '문손잡이 교체', '나사가 빠져 헐겁던 손잡이를 새 손잡이로 바꾼 사례예요.', pair('handle')),
      kase('pf-p4-2', 'sv-p4-hinge', '방문 경첩 조정', '손잡이 쪽이 내려앉은 문을 경첩을 조여 다시 맞춘 사례예요.', pair('hinge')),
      kase('pf-p4-3', 'sv-p4-screen', '방충망 교체', '찢어진 망을 걷어 내고 새 망으로 바꾼 사례예요.', pair('screen')),
    ]),
  p5: entry('c9',
    '욕실·주방 실리콘과 줄눈 보수를 주로 하고, 선반·커튼 레일 설치도 함께 해요.',
    [
      kase('pf-p5-1', 'sv-p5-bath-silicone', '욕조 둘레 실리콘 보수', '곰팡이가 피고 갈라진 실리콘을 다시 채운 사례예요.', pair('silicone')),
      kase('pf-p5-2', 'sv-p5-grout', '욕실 바닥 줄눈 보수', '검게 변색된 줄눈을 긁어내고 새로 채운 사례예요.', pair('grout')),
      kase('pf-p5-3', 'sv-p5-shelf', '벽 선반 설치', '바닥에 두던 화분을 올릴 선반을 벽에 단 사례예요.', pair('shelf')),
    ]),
  p6: entry('c4',
    '서랍 레일과 수납장 경첩 수리, 선반·블라인드 설치, 맞춤 도어 교체를 맡아요.',
    [
      kase('pf-p6-1', 'sv-p6-drawer', '서랍 레일 수리', '빠져나오던 서랍의 레일을 손봐 나란히 닫히게 한 사례예요.', pair('drawer')),
      kase('pf-p6-2', 'sv-p6-shelf', '벽 선반 설치', '위치를 표시한 벽에 받침대와 선반을 단 사례예요.', pair('shelf')),
      kase('pf-p6-3', 'sv-p6-blind', '블라인드 교체 설치', '살이 휜 블라인드를 떼고 롤 블라인드를 단 사례예요.', pair('blind')),
    ]),
  p7: entry('c1',
    '방충망 교체와 틀 수리, 롤러 교체처럼 방충망에 관한 작업만 다뤄요.',
    [
      kase('pf-p7-1', 'sv-p7-screen', '방충망 교체', '가운데가 찢어진 망을 새 망으로 바꾼 사례예요.', pair('screen')),
      kase('pf-p7-2', 'sv-p7-frame', '방충망 틀 수리', '모서리가 휘어 틈이 벌어진 틀을 곧게 맞춘 사례예요.', pair('screenFrame')),
      kase('pf-p7-3', 'sv-p7-roller', '방충망 롤러 교체', '닳은 롤러를 바꿔 문짝이 레일 위에 반듯하게 놓이게 한 사례예요.', pair('screenRoller')),
    ]),
  p8: entry('c7',
    '커튼 레일과 블라인드, 수건걸이 같은 생활 부속품을 벽과 천장에 설치해요.',
    [
      kase('pf-p8-1', 'sv-p8-curtain', '커튼 레일 설치', '비어 있던 창 위에 레일을 달고 커튼을 건 사례예요.', pair('curtain')),
      kase('pf-p8-2', 'sv-p8-blind', '블라인드 설치', '낡은 블라인드를 떼고 롤 블라인드를 단 사례예요.', pair('blind')),
      kase('pf-p8-3', 'sv-p8-towel', '수건걸이 설치', '한쪽이 빠져 기울던 수건걸이를 다시 고정한 사례예요.', pair('towel')),
    ]),
  p9: entry('c1',
    '방충망과 롤러 교체, 창문 잠금장치 교체와 틈새막이 시공, 블라인드 설치까지 창가에서 생기는 수리를 묶어 맡아요.',
    [
      kase('pf-p9-1', 'sv-p9-screen', '거실 창 방충망 교체', '찢어져 바깥이 보이던 망을 새 망으로 바꾼 사례예요.', pair('screen')),
      kase('pf-p9-2', 'sv-p9-strip', '창문 틈새막이 시공', '창틀과 창문 사이 벌어진 틈에 틈새막이를 붙인 사례예요.', pair('weatherstrip')),
      kase('pf-p9-3', 'sv-p9-blind', '롤 블라인드 설치', '휘어진 블라인드를 떼고 롤 블라인드를 단 사례예요.', pair('blind')),
    ]),
  p10: entry('c5',
    '방충망 교체와 틀 수리, 창문 롤러 교체와 틈새막이 시공을 주로 하고, 방문 손잡이 교체와 경첩 조정도 함께 봐요.',
    [
      kase('pf-p10-1', 'sv-p10-winroller', '창문 롤러 교체', '롤러가 닳아 뻑뻑하던 창문의 롤러를 바꾼 사례예요.', pair('winRoller')),
      kase('pf-p10-2', 'sv-p10-frame', '방충망 틀 수리', '아래 모서리가 휜 방충망 틀을 곧게 맞춘 사례예요.', pair('screenFrame')),
      kase('pf-p10-3', 'sv-p10-hinge', '방문 경첩 조정', '내려앉은 방문을 경첩을 조정해 문틀과 맞춘 사례예요.', pair('hinge')),
    ]),
  p11: entry('c1',
    '방충망 교체와 틀·롤러 수리를 주로 하고, 창문 잠금장치 교체도 해요.',
    [
      kase('pf-p11-1', 'sv-p11-roller', '방충망 롤러 교체', '레일에서 들뜨던 방충망 문짝의 롤러를 교체한 사례예요.', pair('screenRoller')),
      kase('pf-p11-2', 'sv-p11-frame', '방충망 틀 수리', '휘어서 틈이 생긴 틀을 바로잡은 사례예요.', pair('screenFrame')),
      kase('pf-p11-3', 'sv-p11-lock', '창문 잠금장치 교체', '새 잠금장치를 달아 걸쇠에 맞물리게 한 모습이에요.', single('winLock')),
    ]),
  p12: entry('c9',
    '창문 틈새막이 시공과 욕실 실리콘·줄눈 보수처럼 틈을 메우는 작업을 주로 하고, 방충망 교체도 맡아요.',
    [
      kase('pf-p12-1', 'sv-p12-strip', '창문 틈새막이 시공', '바람이 들어오던 창문 틈에 틈새막이를 붙인 사례예요.', pair('weatherstrip')),
      kase('pf-p12-2', 'sv-p12-bath-silicone', '욕조 둘레 실리콘 보수', '군데군데 떨어진 실리콘을 걷어 내고 다시 채운 사례예요.', pair('silicone')),
      kase('pf-p12-3', 'sv-p12-grout', '욕실 바닥 줄눈 보수', '변색된 줄눈을 새로 채운 사례예요.', pair('grout')),
    ]),
  p13: entry('c5',
    '창문 잠금장치와 롤러 교체, 문손잡이 교체, 도어클로저 조정, 방충망 롤러 교체를 해요.',
    [
      kase('pf-p13-1', 'sv-p13-lock', '창문 잠금장치 교체', '손잡이가 부러져 잠기지 않던 잠금장치를 새것으로 바꾼 사례예요.', pair('winLock')),
      kase('pf-p13-2', 'sv-p13-closer', '현관문 도어클로저 조정', '팔이 빠져 있던 도어클로저를 다시 연결한 사례예요.', pair('closer')),
      kase('pf-p13-3', 'sv-p13-roller', '방충망 롤러 교체', '닳은 롤러를 교체해 문짝을 레일에 맞춘 사례예요.', pair('screenRoller')),
    ]),
  p14: entry('c1',
    '방충망 교체와 틀 수리, 창문 틈새막이·잠금장치 교체를 주로 하고, 베란다 빨래건조대 설치·수리도 해요.',
    [
      kase('pf-p14-1', 'sv-p14-dryrack', '천장 빨래건조대 수리', '한쪽이 내려앉아 기울던 건조대를 손봐 수평을 맞춘 사례예요.', pair('dryRack')),
      kase('pf-p14-2', 'sv-p14-strip', '창문 틈새막이 시공', '틈이 벌어진 창문에 틈새막이를 붙인 사례예요.', pair('weatherstrip')),
      kase('pf-p14-3', 'sv-p14-screen', '방충망 교체', '새 망으로 바꾼 뒤의 모습이에요.', single('screen')),
    ]),
  p15: entry('c5',
    '창문과 방충망 롤러 교체, 창문 잠금장치 교체를 주로 하고, 수건걸이·휴지걸이 설치도 함께 해요.',
    [
      kase('pf-p15-1', 'sv-p15-winroller', '창문 롤러 교체', '롤러가 닳은 창문의 롤러를 새것으로 바꾼 사례예요.', pair('winRoller')),
      kase('pf-p15-2', 'sv-p15-lock', '창문 잠금장치 교체', '부러진 잠금장치를 떼고 새 잠금장치를 단 사례예요.', pair('winLock')),
      kase('pf-p15-3', 'sv-p15-paper', '휴지걸이 설치', '예전 걸이 자국만 남은 벽에 휴지걸이를 단 사례예요.', pair('paper')),
    ]),
  p16: entry('c5',
    '창문 틈새막이 시공과 잠금장치 교체, 방충망 교체를 하고, 주방 실리콘과 줄눈 보수도 맡아요.',
    [
      kase('pf-p16-1', 'sv-p16-lock', '창문 잠금장치 교체', '잠기지 않던 잠금장치를 새것으로 바꾼 사례예요.', pair('winLock')),
      kase('pf-p16-2', 'sv-p16-kitchen-silicone', '싱크대 상판 실리콘 보수', '들뜨고 틈이 벌어진 실리콘을 다시 채운 사례예요.', pair('kitchenSilicone')),
    ]),
  p17: entry('c2',
    '수전·샤워기 교체와 배수 트랩 교체, 욕실 실리콘 보수를 주로 하고, 수건걸이·휴지걸이 설치도 같은 방문에 함께 해요.',
    [
      kase('pf-p17-1', 'sv-p17-shower', '샤워기 교체', '호스에서 물이 새던 샤워기를 새 샤워기로 바꾼 사례예요.', pair('shower')),
      kase('pf-p17-2', 'sv-p17-trap', '세면대 배수 트랩 교체', '물이 새어 통을 받쳐 두던 트랩을 교체한 사례예요.', pair('trap')),
      kase('pf-p17-3', 'sv-p17-towel', '수건걸이 설치', '한쪽이 빠져 기울던 수건걸이를 다시 고정한 사례예요.', pair('towel')),
    ]),
  p18: entry('c2',
    '세면대·주방 수전과 샤워기 교체를 주로 하고, 세면대 배수구 막힘 수리와 욕실 실리콘 보수도 해요.',
    [
      kase('pf-p18-1', 'sv-p18-faucet', '세면대 수전 교체', '물방울이 계속 떨어지던 낡은 수전을 새 수전으로 바꾼 사례예요.', pair('faucet')),
      kase('pf-p18-2', 'sv-p18-drain', '세면대 배수구 막힘 수리', '물이 고여 빠지지 않던 세면대의 배수구를 뚫은 사례예요.', pair('drain')),
      kase('pf-p18-3', 'sv-p18-shower', '샤워기 교체', '새 샤워기를 달아 물줄기가 고르게 나오는 모습이에요.', single('shower')),
    ]),
  p19: entry('c2',
    '배수 트랩 교체와 배수구 막힘 수리, 수전 교체를 주로 하고, 주방 실리콘 보수와 세탁기 급수 호스 교체도 해요.',
    [
      kase('pf-p19-1', 'sv-p19-trap', '세면대 배수 트랩 교체', '녹슬어 물이 새던 트랩을 새 트랩으로 바꾼 사례예요.', pair('trap')),
      kase('pf-p19-2', 'sv-p19-drain', '세면대 배수구 막힘 수리', '막혀서 물이 고이던 배수구를 뚫은 사례예요.', pair('drain')),
      kase('pf-p19-3', 'sv-p19-kitchen-silicone', '싱크대 상판 실리콘 보수', '누렇게 들뜬 실리콘을 걷어 내고 다시 채운 사례예요.', pair('kitchenSilicone')),
    ]),
  p20: entry('c8',
    '샤워기·세면대 수전 교체, 욕실 실리콘·줄눈 보수, 수건걸이·거울 설치처럼 욕실 한 곳에서 필요한 작업을 묶어 해요.',
    [
      kase('pf-p20-1', 'sv-p20-shower', '샤워기 교체', '호스에서 물이 새던 낡은 샤워기를 새 샤워기로 교체한 사례예요.', pair('shower')),
      kase('pf-p20-2', 'sv-p20-grout', '욕실 바닥 줄눈 보수', '검게 변한 줄눈을 하얗게 다시 채운 사례예요.', pair('grout')),
      kase('pf-p20-3', 'sv-p20-towel', '수건걸이 설치', '한쪽 고정이 빠진 수건걸이를 다시 단 사례예요.', pair('towel')),
    ]),
  p21: entry('c9',
    '수전·배수 트랩 교체와 욕실·주방 실리콘 보수를 주로 하고, 창문 틈새막이 시공도 해요.',
    [
      kase('pf-p21-1', 'sv-p21-faucet', '세면대 수전 교체', '물이 새던 수전을 새 수전으로 바꾼 사례예요.', pair('faucet')),
      kase('pf-p21-2', 'sv-p21-kitchen-silicone', '싱크대 상판 실리콘 보수', '벽과 상판 사이 벌어진 틈을 실리콘으로 다시 메운 사례예요.', pair('kitchenSilicone')),
      kase('pf-p21-3', 'sv-p21-bath-silicone', '욕조 둘레 실리콘 보수', '실리콘을 다시 채운 뒤의 모습이에요.', single('silicone')),
    ]),
  p22: entry('c2',
    '주방 수전과 싱크대 배수 트랩 교체, 주방 실리콘 보수, 수납장 문 경첩 교체와 서랍 레일 수리를 해요.',
    [
      kase('pf-p22-1', 'sv-p22-hinge', '수납장 문 경첩 교체', '경첩이 풀려 처진 수납장 문을 경첩을 바꿔 다시 맞춘 사례예요.', pair('cabinetDoor')),
      kase('pf-p22-2', 'sv-p22-kitchen-silicone', '싱크대 상판 실리콘 보수', '틈이 벌어진 실리콘을 걷어 내고 다시 채운 사례예요.', pair('kitchenSilicone')),
      kase('pf-p22-3', 'sv-p22-drawer', '서랍 레일 수리', '비뚤게 빠지던 서랍의 레일을 교체한 사례예요.', pair('drawer')),
    ]),
  p23: entry('c8',
    '세면대 수전과 샤워기 교체, 욕실 수납장 문 수리, 수건걸이·휴지걸이 설치를 해요.',
    [
      kase('pf-p23-1', 'sv-p23-towel', '수건걸이 설치', '한쪽 고정이 빠져 기울던 수건걸이를 다시 고정한 사례예요.', pair('towel')),
      kase('pf-p23-2', 'sv-p23-paper', '휴지걸이 설치', '나사 구멍만 남은 벽에 새 휴지걸이를 단 사례예요.', pair('paper')),
      kase('pf-p23-3', 'sv-p23-shower', '샤워기 교체', '낡은 샤워기를 새 샤워기로 바꾼 사례예요.', pair('shower')),
    ]),
  p24: entry('c10',
    '수전 교체, 조명·스위치 교체, 도어스토퍼 설치, 거울·액자 걸기처럼 집 안 여러 곳의 작은 수리를 한 번의 방문에 묶어 해요.',
    [
      kase('pf-p24-1', 'sv-p24-light', '거실 천장등 교체', '어둡게 켜지던 낡은 천장등을 새 등으로 바꾼 사례예요.', pair('light')),
      kase('pf-p24-2', 'sv-p24-stopper', '도어스토퍼 설치', '손잡이가 벽에 부딪히지 않도록 바닥에 도어스토퍼를 단 사례예요.', pair('stopper')),
      kase('pf-p24-3', 'sv-p24-mirror', '벽 거울 걸기', '바닥에 기대어 두던 거울을 벽에 건 사례예요.', pair('mirror')),
    ]),
  p25: entry('c3',
    '경첩 교체·조정과 문손잡이 교체, 서랍 레일·수납장 경첩 교체, 창문 잠금장치·롤러 교체를 해요.',
    [
      kase('pf-p25-1', 'sv-p25-hinge', '방문 경첩 교체', '경첩을 바꿔 기울어진 문을 바로잡은 사례예요.', pair('hinge')),
      kase('pf-p25-2', 'sv-p25-cabinet', '수납장 경첩 교체', '처진 수납장 문의 경첩을 교체한 사례예요.', pair('cabinetDoor')),
      kase('pf-p25-3', 'sv-p25-winroller', '창문 롤러 교체', '닳은 롤러를 새 롤러로 바꾼 사례예요.', pair('winRoller')),
    ]),
  p26: entry('c10',
    '문손잡이 교체와 경첩 조정, 서랍 레일·수납장 문 수리를 주로 하고, 도어스토퍼 설치와 거울·액자 걸기도 해요.',
    [
      kase('pf-p26-1', 'sv-p26-handle', '문손잡이 교체', '처지고 헐겁던 손잡이를 새 손잡이로 바꾼 사례예요.', pair('handle')),
      kase('pf-p26-2', 'sv-p26-drawer', '서랍 레일 수리', '서랍이 비뚤게 빠지던 서랍장의 레일을 손본 사례예요.', pair('drawer')),
      kase('pf-p26-3', 'sv-p26-stopper', '도어스토퍼 설치', '벽에 찍힌 자국이 더 생기지 않도록 도어스토퍼를 단 사례예요.', pair('stopper')),
    ]),
  p27: entry('c4',
    '방문 경첩 조정과 문손잡이 교체, 수납장 문·서랍 레일 수리, 선반 설치를 해요.',
    [
      kase('pf-p27-1', 'sv-p27-shelf', '벽 선반 설치', '비어 있던 벽에 선반을 달아 화분을 올린 사례예요.', pair('shelf')),
      kase('pf-p27-2', 'sv-p27-hinge', '방문 경첩 조정', '문틀과 틈이 어긋난 방문을 다시 맞춘 사례예요.', pair('hinge')),
      kase('pf-p27-3', 'sv-p27-cabinet', '수납장 문 수리', '수납장 문 두 짝을 나란히 맞춘 뒤의 모습이에요.', single('cabinetDoor')),
    ]),
  p28: entry('c7',
    '조명 교체와 센서등 설치, 커튼 레일·블라인드 설치, 수건걸이·휴지걸이 설치처럼 벽과 천장에 다는 작업을 해요.',
    [
      kase('pf-p28-1', 'sv-p28-sensor', '현관 센서등 설치', '전구만 달려 어둡던 현관에 센서등을 단 사례예요.', pair('sensor')),
      kase('pf-p28-2', 'sv-p28-curtain', '커튼 레일 설치', '창 위에 레일을 달고 커튼을 건 사례예요.', pair('curtain')),
      kase('pf-p28-3', 'sv-p28-paper', '휴지걸이 설치', '욕실 벽에 휴지걸이를 단 사례예요.', pair('paper')),
    ]),
  p29: entry('c6',
    '조명·스위치 교체와 블라인드·선반·거울 설치를 해요.',
    [
      kase('pf-p29-1', 'sv-p29-light', '거실 천장등 교체', '바랜 천장등을 떼고 새 등을 단 사례예요.', pair('light')),
      kase('pf-p29-2', 'sv-p29-mirror', '벽 거울 설치', '바닥에 세워 두던 거울을 벽 가운데에 건 사례예요.', pair('mirror')),
      kase('pf-p29-3', 'sv-p29-shelf', '벽 선반 설치', '선반을 달고 화분을 올린 뒤의 모습이에요.', single('shelf')),
    ]),
  p30: entry('c8',
    '콘센트·스위치 교체, 수건걸이·휴지걸이 설치, 빨래건조대와 도어스토퍼 설치처럼 작은 부속품 작업을 해요.',
    [
      kase('pf-p30-1', 'sv-p30-outlet', '벽 콘센트 교체', '덮개에 금이 가고 바랜 콘센트를 새 콘센트로 바꾼 사례예요.', pair('outlet')),
      kase('pf-p30-2', 'sv-p30-dryrack', '천장 빨래건조대 수리', '한쪽이 내려앉아 기울던 건조대를 다시 수평으로 건 사례예요.', pair('dryRack')),
      kase('pf-p30-3', 'sv-p30-switch', '벽 스위치 교체', '누렇게 바랜 스위치를 새 스위치로 교체한 사례예요.', pair('switch')),
    ]),
  p31: entry('c6',
    '조명·스위치 교체와 문손잡이 교체, 수납장 경첩 교체, 서랍 레일 수리를 해요.',
    [
      kase('pf-p31-1', 'sv-p31-switch', '벽 스위치 교체', '금이 가고 헐거운 스위치를 새 스위치로 바꾼 사례예요.', pair('switch')),
      kase('pf-p31-2', 'sv-p31-cabinet', '수납장 경첩 교체', '한쪽 문이 처진 수납장의 경첩을 교체한 사례예요.', pair('cabinetDoor')),
      kase('pf-p31-3', 'sv-p31-handle', '문손잡이 교체', '새 손잡이를 수평으로 단 뒤의 모습이에요.', single('handle')),
    ]),
  p32: entry('c6',
    '스위치·콘센트 교체, 문손잡이 교체와 경첩 조정, 커튼 레일 설치를 해요.',
    [
      kase('pf-p32-1', 'sv-p32-outlet', '벽 콘센트 교체', '금이 가고 바랜 콘센트를 새 콘센트로 교체한 사례예요.', pair('outlet')),
      kase('pf-p32-2', 'sv-p32-curtain', '커튼 레일 설치', '커튼이 없던 창에 레일과 커튼을 단 사례예요.', pair('curtain')),
    ]),
  p33: entry('c4',
    '서랍 레일과 수납장 문 수리를 주로 하고, 선반과 센서등 설치도 해요.',
    [
      kase('pf-p33-1', 'sv-p33-drawer', '서랍 레일 수리', '가운데 서랍이 비뚤게 빠지던 서랍장의 레일을 바꾼 사례예요.', pair('drawer')),
      kase('pf-p33-2', 'sv-p33-shelf', '벽 선반 설치', '표시해 둔 위치에 선반을 단 사례예요.', pair('shelf')),
      kase('pf-p33-3', 'sv-p33-sensor', '현관 센서등 설치', '어둡던 현관 천장에 센서등을 단 사례예요.', pair('sensor')),
    ]),
  p34: entry('c6',
    '현관 센서등 설치와 스위치 교체, 현관문 손잡이 교체, 도어클로저 조정, 도어스토퍼 설치를 해요.',
    [
      kase('pf-p34-1', 'sv-p34-sensor', '현관 센서등 설치', '전구가 꺼져 있던 현관에 센서등을 단 사례예요.', pair('sensor')),
      kase('pf-p34-2', 'sv-p34-closer', '현관문 도어클로저 조정', '팔이 빠져 늘어진 도어클로저를 다시 연결한 사례예요.', pair('closer')),
      kase('pf-p34-3', 'sv-p34-stopper', '도어스토퍼 설치', '문이 벽에 닿지 않도록 도어스토퍼를 단 사례예요.', pair('stopper')),
    ]),
  p35: entry('c6',
    '주방 조명과 콘센트 교체, 수납장 문 경첩 교체, 서랍 레일 수리, 주방 선반 설치를 해요.',
    [
      kase('pf-p35-1', 'sv-p35-cabinet', '수납장 문 경첩 교체', '경첩이 풀려 처진 수납장 문을 다시 맞춘 사례예요.', pair('cabinetDoor')),
      kase('pf-p35-2', 'sv-p35-outlet', '벽 콘센트 교체', '깨진 콘센트를 새 콘센트로 바꾼 사례예요.', pair('outlet')),
      kase('pf-p35-3', 'sv-p35-drawer', '서랍 레일 수리', '비뚤게 빠지던 서랍의 레일을 손본 사례예요.', pair('drawer')),
    ]),
};
