import type { ProviderReview, TimeSlot } from '../../domain/types';
import type { ProviderRecord } from './db';

/**
 * 카테고리마다 업체 10곳이 보이도록 더한 가상 업체(p9~p35). 기존 업체(p1~p8, seed.ts)는 그대로 둔다.
 * 모두 지어낸 데모 데이터다 — 실제 업체명·로고·사진·실적이 아니고, 평점·리뷰 수·리뷰도 가상 값이다.
 * 범위는 생활 수리·부분 설치·교체(전체 리모델링·철거·구조 변경 없음). 값은 고정이라 새로고침해도 바뀌지 않는다.
 * 등록 작업은 providerServices.ts, 새 요청 접수 기준은 providerRequestDays.ts, 소개·작업 사례는 providerShowcase.ts에 둔다.
 */
const review = (id: string, author: string, rating: number, body: string, md: string, workLabel: string): ProviderReview => ({
  id, author, rating, body, createdAt: `2026-${md}T12:00:00+09:00`, workLabel,
});

export const EXTRA_PROVIDERS: ProviderRecord[] = [
  {
    id: 'p9', name: '창가손길', categoryIds: ['c1', 'c5', 'c7'], rating: 4.6, reviewCount: 41, soloTripFee: 40000, area: '가상구 일대',
    scope: ['방충망 교체', '창문 잠금장치·틈새 보수', '블라인드 설치'],
    intro: '창가 주변 수리와 설치를 맡는 가상 업체입니다.', phone: '010-0000-0109',
    afterServiceTerms: ['설치 후 이상이 있으면 업체에 전화로 알려 주세요. 재방문 일정은 협의합니다.'],
    reviews: [review('rv-p9-1', '김*연', 5, '방충망을 바꾸고 블라인드까지 한 번에 달았어요.', '10-02', '방충망 교체')],
  },
  {
    id: 'p10', name: '바람길창호', categoryIds: ['c1', 'c5', 'c3'], rating: 4.4, reviewCount: 27, soloTripFee: 45000, area: '가상구·가상동구',
    scope: ['방충망 교체·틀 수리', '창문 롤러 교체·틈새막이', '문손잡이·경첩'],
    intro: '창문과 방문이 잘 여닫히도록 손보는 가상 업체입니다.', phone: '010-0000-0110',
    afterServiceTerms: ['교체한 부품의 불량은 제조사 기준을 따릅니다.', '재방문 일정은 고객과 협의합니다.'],
    reviews: [review('rv-p10-1', '이*호', 4, '뻑뻑하던 창문이 부드럽게 열려요.', '09-29', '창문 롤러 교체')],
  },
  {
    id: 'p11', name: '촘촘방충망', categoryIds: ['c1', 'c5'], rating: 4.7, reviewCount: 58, soloTripFee: 30000, area: '가상구 일대',
    scope: ['방충망 교체', '방충망 틀·롤러 수리', '창문 잠금장치 교체'],
    intro: '방충망과 창문 부속을 주로 다루는 가상 업체입니다.', phone: '010-0000-0111',
    afterServiceTerms: ['재방문 일정은 협의합니다.'],
    reviews: [review('rv-p11-1', '박*은', 5, '방충망 문짝이 레일에서 자꾸 빠졌는데 이제 괜찮아요.', '10-04', '방충망 롤러 교체')],
  },
  {
    id: 'p12', name: '틈새지기', categoryIds: ['c5', 'c9', 'c1'], rating: 4.5, reviewCount: 33, soloTripFee: 45000, area: '가상구·푸른숲',
    scope: ['창문 틈새막이', '욕실 실리콘·줄눈 보수', '방충망 교체'],
    intro: '틈과 이음새를 메우는 보수를 주로 하는 가상 업체입니다.', phone: '010-0000-0112',
    afterServiceTerms: ['실리콘과 줄눈은 안내한 건조 시간이 지난 뒤 사용해 주세요.'],
    reviews: [review('rv-p12-1', '정*미', 4, '창가 바람이 줄었어요.', '09-26', '창문 틈새막이 시공')],
  },
  {
    id: 'p13', name: '열고닫고', categoryIds: ['c5', 'c3', 'c1'], rating: 4.3, reviewCount: 19, soloTripFee: 50000, area: '가상구 일대',
    scope: ['창문 잠금장치·롤러 교체', '문손잡이 교체·도어클로저 조정', '방충망 롤러 교체'],
    intro: '여닫는 곳의 잠금장치와 롤러를 손보는 가상 업체입니다.', phone: '010-0000-0113',
    afterServiceTerms: ['조정 후에도 문이 잘 닫히지 않으면 업체에 전화해 주세요. 방문 일정은 협의합니다.'],
    reviews: [review('rv-p13-1', '최*준', 4, '현관문이 쾅 닫히지 않게 맞춰 주셨어요.', '09-30', '도어클로저 조정')],
  },
  {
    id: 'p14', name: '산들창', categoryIds: ['c1', 'c5', 'c8'], rating: 4.8, reviewCount: 74, soloTripFee: 35000, area: '가상구 일대',
    scope: ['방충망 교체·틀 수리', '창문 틈새막이·잠금장치', '빨래건조대 설치·수리'],
    intro: '방충망과 베란다 주변 수리를 맡는 가상 업체입니다.', phone: '010-0000-0114',
    afterServiceTerms: ['부품 불량은 제조사 기준에 따라 교환합니다.'],
    reviews: [review('rv-p14-1', '한*솔', 5, '건조대 줄이 끊어졌는데 금방 고쳐 주셨어요.', '10-05', '빨래건조대 설치·수리')],
  },
  {
    id: 'p15', name: '또르르창문', categoryIds: ['c5', 'c1', 'c8'], rating: 4.2, reviewCount: 12, soloTripFee: 40000, area: '가상구·가상동구',
    scope: ['창문·방충망 롤러 교체', '창문 잠금장치 교체', '수건걸이·휴지걸이 설치'],
    intro: '창문 롤러 교체와 작은 부속품 설치를 하는 가상 업체입니다.', phone: '010-0000-0115',
    afterServiceTerms: ['설치 후 이상은 업체에 직접 문의해 주세요.'], reviews: [],
  },
  {
    id: 'p16', name: '햇살창틀', categoryIds: ['c5', 'c1', 'c9'], rating: 4.6, reviewCount: 36, soloTripFee: 45000, area: '가상구 일대',
    scope: ['창문 틈새막이·잠금장치', '방충망 교체', '주방 실리콘·줄눈 보수'],
    intro: '창틀 주변 보수와 실리콘 마감을 하는 가상 업체입니다.', phone: '010-0000-0116',
    afterServiceTerms: ['실리콘은 안내한 건조 시간이 지난 뒤 물을 사용해 주세요.', '재방문 일정은 협의합니다.'],
    reviews: [review('rv-p16-1', '오*진', 5, '창문이 잘 잠겨서 마음이 놓여요.', '09-24', '창문 잠금장치 교체')],
  },
  {
    id: 'p17', name: '물길수리', categoryIds: ['c2', 'c9', 'c8'], rating: 4.7, reviewCount: 92, soloTripFee: 55000, area: '가상구 일대',
    scope: ['수전·샤워기 교체', '배수 트랩 교체', '욕실 실리콘 보수', '수건걸이·휴지걸이 설치'],
    intro: '욕실 수전과 배수 부품, 욕실 부속품을 함께 다루는 가상 업체입니다.', phone: '010-0000-0117',
    afterServiceTerms: ['교체한 부품의 제조사 보증은 제품 기준을 따릅니다.', '누수가 다시 보이면 업체에 전화해 주세요.'],
    reviews: [
      review('rv-p17-1', '윤*희', 5, '샤워기와 수건걸이를 같은 날 해결했어요.', '10-01', '샤워기 교체'),
      review('rv-p17-2', '서*우', 4, '작업 전에 바꿀 부품을 보여 주셔서 좋았어요.', '09-22', '배수 트랩 교체'),
    ],
  },
  {
    id: 'p18', name: '똑똑수전', categoryIds: ['c2', 'c9'], rating: 4.9, reviewCount: 141, soloTripFee: 40000, area: '가상구·가상동구',
    scope: ['세면대·주방 수전 교체', '샤워기 교체', '배수구 막힘 수리', '욕실 실리콘 보수'],
    intro: '수전 교체를 주로 하는 가상 업체입니다.', phone: '010-0000-0118',
    afterServiceTerms: ['시공 후 물이 새면 먼저 업체에 연락해 주세요. 방문 일정은 협의합니다.'],
    reviews: [
      review('rv-p18-1', '강*민', 5, '물이 똑똑 떨어지던 수전을 바꿨어요.', '10-03', '세면대 수전 교체'),
      review('rv-p18-2', '조*라', 5, '세면대 물이 시원하게 내려가요.', '09-27', '세면대 배수구 막힘 수리'),
    ],
  },
  {
    id: 'p19', name: '맑은물설비', categoryIds: ['c2', 'c9'], rating: 4.5, reviewCount: 48, soloTripFee: 50000, area: '가상구 일대',
    scope: ['배수 트랩 교체·막힘 수리', '수전 교체', '주방 실리콘 보수', '세탁기 급수 호스 교체'],
    intro: '배수와 급수 부품을 주로 손보는 가상 업체입니다.', phone: '010-0000-0119',
    afterServiceTerms: ['시공 부위에서 다시 물이 새면 업체와 직접 협의합니다.'],
    reviews: [review('rv-p19-1', '임*수', 4, '세면대 아래 물 새는 곳을 찾아 주셨어요.', '09-28', '배수 트랩 교체')],
  },
  {
    id: 'p20', name: '욕실단짝', categoryIds: ['c2', 'c9', 'c8'], rating: 4.6, reviewCount: 63, soloTripFee: 45000, area: '가상구·푸른숲',
    scope: ['샤워기·세면대 수전 교체', '욕실 실리콘·줄눈 보수', '수건걸이·거울 설치'],
    intro: '욕실 한 곳의 수리와 설치를 묶어서 맡는 가상 업체입니다.', phone: '010-0000-0120',
    afterServiceTerms: ['실리콘과 줄눈은 안내한 건조 시간이 지난 뒤 사용해 주세요.', '재방문 일정은 협의합니다.'],
    reviews: [review('rv-p20-1', '신*아', 5, '욕실 바닥 줄눈이 깔끔해졌어요.', '10-02', '욕실 줄눈 보수')],
  },
  {
    id: 'p21', name: '물샐틈없이', categoryIds: ['c2', 'c9', 'c5'], rating: 4.4, reviewCount: 25, soloTripFee: 50000, area: '가상구 일대',
    scope: ['수전·배수 트랩 교체', '욕실·주방 실리콘 보수', '창문 틈새막이'],
    intro: '물이 새는 이음새와 틈을 손보는 가상 업체입니다.', phone: '010-0000-0121',
    afterServiceTerms: ['실리콘은 안내한 건조 시간이 지난 뒤 물을 사용해 주세요.'],
    reviews: [review('rv-p21-1', '권*영', 4, '싱크대 뒤 틈을 깔끔하게 메워 주셨어요.', '09-25', '주방 실리콘 보수')],
  },
  {
    id: 'p22', name: '주방손질', categoryIds: ['c2', 'c9', 'c4'], rating: 4.7, reviewCount: 55, soloTripFee: 50000, area: '가상구·가상동구',
    scope: ['주방 수전·싱크대 배수 트랩 교체', '주방 실리콘 보수', '수납장 문·서랍 수리'],
    intro: '주방의 수전·실리콘·수납장을 함께 손보는 가상 업체입니다.', phone: '010-0000-0122',
    afterServiceTerms: ['맞춤 자재는 사전 안내한 취소 조건을 따릅니다.', '재방문 일정은 고객과 협의합니다.'],
    reviews: [review('rv-p22-1', '황*정', 5, '처진 수납장 문을 다시 맞춰 주셨어요.', '10-04', '수납장 문 경첩 교체')],
  },
  {
    id: 'p23', name: '욕실살림', categoryIds: ['c2', 'c4', 'c8'], rating: 4.3, reviewCount: 17, soloTripFee: 45000, area: '가상구 일대',
    scope: ['세면대 수전·샤워기 교체', '욕실 수납장 문 수리', '수건걸이·휴지걸이 설치'],
    intro: '욕실 수전과 수납장, 걸이류를 다루는 가상 업체입니다.', phone: '010-0000-0123',
    afterServiceTerms: ['설치 후 이상은 업체에 직접 문의해 주세요.'], reviews: [],
  },
  {
    id: 'p24', name: '우리집수리', categoryIds: ['c2', 'c6', 'c3'], rating: 4.5, reviewCount: 82, soloTripFee: 60000, area: '가상구·가상동구',
    scope: ['수전 교체', '조명·스위치 교체', '도어스토퍼 설치', '거울·액자 걸기'],
    intro: '집 안 여러 곳의 작은 수리를 한 번에 맡는 가상 업체입니다.', phone: '010-0000-0124',
    afterServiceTerms: ['시공 후 이상이 있으면 먼저 업체에 연락해 주세요. 방문 일정은 협의합니다.'],
    reviews: [
      review('rv-p24-1', '문*혁', 5, '거실 등과 문 스토퍼를 같은 날 해결했어요.', '09-30', '조명 교체'),
      review('rv-p24-2', '배*나', 4, '여러 가지를 한 번에 맡길 수 있어 편했어요.', '09-21', '거울·액자 걸기'),
    ],
  },
  {
    id: 'p25', name: '단단철물', categoryIds: ['c3', 'c4', 'c5'], rating: 4.8, reviewCount: 67, soloTripFee: 45000, area: '가상구 일대',
    scope: ['경첩 교체·조정', '문손잡이 교체', '서랍 레일·수납장 경첩', '창문 잠금장치·롤러 교체'],
    intro: '경첩·레일·잠금장치 같은 철물 부속을 다루는 가상 업체입니다.', phone: '010-0000-0125',
    afterServiceTerms: ['부품 불량은 제조사 기준에 따라 교환합니다.', '재방문 일정은 협의합니다.'],
    reviews: [review('rv-p25-1', '노*경', 5, '문이 바닥에 끌리지 않아요.', '10-05', '경첩 교체·조정')],
  },
  {
    id: 'p26', name: '고쳐쓰는집', categoryIds: ['c3', 'c4'], rating: 4.4, reviewCount: 31, soloTripFee: 55000, area: '가상구·푸른숲',
    scope: ['문손잡이 교체·경첩 조정', '서랍·수납장 수리', '도어스토퍼 설치', '거울·액자 걸기'],
    intro: '쓰던 문과 가구를 고쳐 쓰도록 돕는 가상 업체입니다.', phone: '010-0000-0126',
    afterServiceTerms: ['재방문 일정은 고객과 협의합니다.'],
    reviews: [review('rv-p26-1', '유*빈', 4, '헐거운 손잡이를 새것으로 바꿨어요.', '09-23', '문손잡이 교체')],
  },
  {
    id: 'p27', name: '나무결손질', categoryIds: ['c3', 'c4', 'c7'], rating: 4.6, reviewCount: 44, soloTripFee: 50000, area: '가상구 일대',
    scope: ['방문 경첩 조정·문손잡이 교체', '수납장 문·서랍 수리', '선반 설치'],
    intro: '문·수납장 수리와 선반 설치를 하는 가상 업체입니다.', phone: '010-0000-0127',
    afterServiceTerms: ['맞춤 자재는 사전 안내한 취소 조건을 따릅니다.'],
    reviews: [review('rv-p27-1', '안*서', 5, '선반 위치를 같이 정하고 달아 주셨어요.', '10-01', '선반 설치')],
  },
  {
    id: 'p28', name: '달아드림', categoryIds: ['c6', 'c7', 'c8'], rating: 4.7, reviewCount: 96, soloTripFee: 40000, area: '가상구 일대',
    scope: ['조명 교체·센서등 설치', '커튼 레일·블라인드 설치', '수건걸이·휴지걸이 설치'],
    intro: '벽과 천장에 다는 설치 작업을 주로 하는 가상 업체입니다.', phone: '010-0000-0128',
    afterServiceTerms: ['설치 후 흔들리거나 처지면 업체에 전화해 주세요. 방문 일정은 협의합니다.'],
    reviews: [
      review('rv-p28-1', '송*윤', 5, '현관 센서등이 생겨 편해졌어요.', '10-03', '센서등 설치'),
      review('rv-p28-2', '장*훈', 4, '커튼 레일을 반듯하게 달아 주셨어요.', '09-26', '커튼 레일 설치'),
    ],
  },
  {
    id: 'p29', name: '반짝설치', categoryIds: ['c6', 'c7', 'c8'], rating: 4.5, reviewCount: 38, soloTripFee: 45000, area: '가상구·가상동구',
    scope: ['조명·스위치 교체', '블라인드·선반 설치', '거울 설치'],
    intro: '조명 교체와 벽 설치를 함께 하는 가상 업체입니다.', phone: '010-0000-0129',
    afterServiceTerms: ['설치 후 이상은 업체에 직접 문의해 주세요.'],
    reviews: [review('rv-p29-1', '전*지', 4, '거실이 밝아졌어요.', '09-29', '조명 교체')],
  },
  {
    id: 'p30', name: '온집부속', categoryIds: ['c6', 'c8', 'c3'], rating: 4.3, reviewCount: 21, soloTripFee: 35000, area: '가상구 일대',
    scope: ['콘센트·스위치 교체', '수건걸이·휴지걸이 설치', '빨래건조대·도어스토퍼 설치'],
    intro: '집 안의 작은 부속품 교체와 설치를 하는 가상 업체입니다.', phone: '010-0000-0130',
    afterServiceTerms: ['부품 불량은 제조사 기준에 따라 교환합니다.'],
    reviews: [review('rv-p30-1', '홍*재', 4, '그을린 콘센트를 바꾸니 안심돼요.', '09-27', '콘센트 교체')],
  },
  {
    id: 'p31', name: '아늑한손', categoryIds: ['c6', 'c3', 'c4'], rating: 4.6, reviewCount: 29, soloTripFee: 50000, area: '가상구·푸른숲',
    scope: ['조명·스위치 교체', '문손잡이 교체', '수납장 경첩·서랍 레일'],
    intro: '방 안의 조명·문·수납장을 함께 손보는 가상 업체입니다.', phone: '010-0000-0131',
    afterServiceTerms: ['시공 후 이상이 있으면 먼저 업체에 연락해 주세요.', '재방문 일정은 협의합니다.'],
    reviews: [review('rv-p31-1', '고*란', 5, '스위치가 새것처럼 깔끔해요.', '10-02', '스위치 교체')],
  },
  {
    id: 'p32', name: '방방손질', categoryIds: ['c6', 'c3', 'c7'], rating: 4.4, reviewCount: 16, soloTripFee: 45000, area: '가상구 일대',
    scope: ['스위치·콘센트 교체', '문손잡이 교체·경첩 조정', '커튼 레일 설치'],
    intro: '방마다 필요한 작은 수리를 하는 가상 업체입니다.', phone: '010-0000-0132',
    afterServiceTerms: ['재방문 일정은 협의합니다.'], reviews: [],
  },
  {
    id: 'p33', name: '차곡차곡', categoryIds: ['c6', 'c4', 'c7'], rating: 4.5, reviewCount: 23, soloTripFee: 55000, area: '가상구·가상동구',
    scope: ['서랍 레일·수납장 문 수리', '선반 설치', '센서등 설치'],
    intro: '수납장 수리와 선반·센서등 설치를 하는 가상 업체입니다.', phone: '010-0000-0133',
    afterServiceTerms: ['맞춤 자재는 사전 안내한 취소 조건을 따릅니다.', '재방문 일정은 고객과 협의합니다.'],
    reviews: [review('rv-p33-1', '양*원', 4, '서랍이 부드럽게 닫혀요.', '09-28', '서랍 레일 수리')],
  },
  {
    id: 'p34', name: '현관지기', categoryIds: ['c6', 'c3'], rating: 4.8, reviewCount: 52, soloTripFee: 40000, area: '가상구 일대',
    scope: ['현관 센서등 설치·스위치 교체', '현관문 손잡이 교체·도어클로저 조정', '도어스토퍼 설치'],
    intro: '현관 주변 수리와 설치를 맡는 가상 업체입니다.', phone: '010-0000-0134',
    afterServiceTerms: ['조정 후에도 문이 잘 닫히지 않으면 업체에 전화해 주세요. 방문 일정은 협의합니다.'],
    reviews: [review('rv-p34-1', '백*현', 5, '현관이 환해지고 문도 조용히 닫혀요.', '10-04', '현관 센서등 설치')],
  },
  {
    id: 'p35', name: '부엌손길', categoryIds: ['c6', 'c4', 'c7'], rating: 4.6, reviewCount: 34, soloTripFee: 50000, area: '가상구·푸른숲',
    scope: ['주방 조명·콘센트 교체', '수납장 문 경첩·서랍 레일', '주방 선반 설치'],
    intro: '주방의 조명·수납장·선반을 손보는 가상 업체입니다.', phone: '010-0000-0135',
    afterServiceTerms: ['시공 후 이상이 있으면 먼저 업체에 연락해 주세요. 방문 일정은 협의합니다.'],
    reviews: [review('rv-p35-1', '남*주', 5, '주방 선반이 튼튼하게 달렸어요.', '09-30', '주방 선반 설치')],
  },
];

const AM: TimeSlot[] = ['09:00–12:00'];
const PM: TimeSlot[] = ['13:00–16:00'];
const DAY: TimeSlot[] = ['09:00–12:00', '13:00–16:00'];

export interface ExtraJointDay {
  /** 방문 날짜의 일(2026년 10월) */ day: number;
  capacity: number;
  confirmedHouseholds: number;
  slots: TimeSlot[];
  /** 그 그룹의 총 출장비. 없으면 업체 기본 출장비 */ totalTripFee?: number;
  pendingSeats?: number;
}
const j = (day: number, capacity: number, confirmedHouseholds: number, slots: TimeSlot[], extra: Partial<ExtraJointDay> = {}): ExtraJointDay => ({ day, capacity, confirmedHouseholds, slots, ...extra });

/**
 * 공동 예약 후보가 없는 추가 업체(2026-10-14, spec 5.49). 카테고리마다 업체의 절반쯤(10곳 중 5~6곳)만 공동 예약 후보가 보이도록 골랐다.
 * 이 업체들은 열린 공동 예약 그룹을 만들지 않고(아래 EXTRA_JOINT_DAYS 값은 남겨 둠) 새 요청 날짜만 받는다(providerRequestDays.ts).
 * 기존 8곳(p1~p8)은 요청·예약 기록이 그 그룹을 참조하므로 그대로 둔다.
 */
export const NO_JOINT_EXTRA = new Set(['p9', 'p12', 'p15', 'p16', 'p18', 'p19', 'p20', 'p23', 'p24', 'p25', 'p26', 'p27', 'p28', 'p29', 'p31', 'p32']);

/**
 * 추가 업체의 공동 예약 데모 일정: 업체마다 2026-10-19~25 중 서로 다른 날짜 3개, 날짜당 그룹 하나(기본 데모 주소 햇살마을 3단지).
 * 날짜 조합은 업체마다 다르게 고정했다(기존 8곳과도 겹치지 않음). 그룹 ID는 gx-<업체>-<순번>, 접수 마감은 방문 전날 18:00(seed.ts에서 붙임).
 */
export const EXTRA_JOINT_DAYS: Record<string, [ExtraJointDay, ExtraJointDay, ExtraJointDay]> = {
  p9: [j(19, 5, 2, DAY), j(20, 4, 1, PM), j(22, 4, 0, AM)],
  p10: [j(21, 4, 1, AM), j(23, 5, 3, DAY, { pendingSeats: 1 }), j(25, 4, 0, PM)],
  p11: [j(19, 6, 4, DAY), j(24, 4, 2, AM), j(25, 4, 1, DAY)],
  p12: [j(20, 4, 1, DAY), j(21, 5, 2, PM), j(23, 4, 0, DAY)],
  p13: [j(22, 4, 2, AM), j(23, 4, 1, PM), j(24, 5, 0, DAY)],
  p14: [j(19, 5, 3, AM), j(21, 5, 2, DAY), j(24, 4, 1, PM)],
  p15: [j(20, 4, 0, DAY), j(22, 4, 1, PM), j(25, 4, 1, AM)],
  p16: [j(21, 5, 2, DAY), j(22, 4, 1, AM), j(23, 4, 2, PM, { totalTripFee: 40000 })],
  p17: [j(19, 6, 3, DAY, { pendingSeats: 1 }), j(20, 5, 2, AM), j(24, 5, 1, DAY)],
  p18: [j(22, 6, 4, DAY), j(24, 5, 3, PM), j(25, 5, 2, AM)],
  p19: [j(20, 4, 2, PM), j(21, 4, 1, DAY), j(22, 5, 1, AM, { totalTripFee: 45000 })],
  p20: [j(19, 5, 2, PM), j(23, 5, 3, DAY), j(25, 4, 1, DAY)],
  p21: [j(21, 4, 1, DAY), j(23, 4, 0, AM), j(24, 4, 2, PM)],
  p22: [j(19, 5, 1, DAY), j(20, 5, 3, AM), j(21, 4, 2, PM)],
  p23: [j(20, 4, 1, AM), j(24, 4, 0, DAY), j(25, 4, 1, PM)],
  p24: [j(19, 6, 3, DAY), j(22, 5, 2, PM, { totalTripFee: 55000 }), j(23, 5, 1, AM)],
  p25: [j(21, 5, 3, AM), j(22, 5, 2, DAY), j(25, 4, 1, DAY)],
  p26: [j(20, 4, 1, DAY), j(21, 4, 2, PM), j(24, 5, 1, AM)],
  p27: [j(19, 4, 2, AM), j(23, 5, 1, DAY), j(24, 4, 2, DAY)],
  p28: [j(22, 6, 3, DAY), j(23, 5, 2, AM), j(25, 5, 3, PM, { pendingSeats: 1 })],
  p29: [j(19, 4, 1, DAY), j(20, 5, 2, PM), j(25, 4, 0, AM)],
  p30: [j(20, 4, 2, AM), j(22, 4, 0, DAY), j(23, 4, 1, PM)],
  p31: [j(19, 5, 1, PM), j(21, 4, 2, DAY), j(22, 4, 1, AM)],
  p32: [j(23, 4, 1, DAY), j(24, 4, 0, AM), j(25, 4, 1, PM)],
  p33: [j(20, 5, 1, DAY), j(21, 4, 1, AM), j(25, 4, 2, DAY)],
  p34: [j(19, 5, 3, DAY), j(22, 5, 2, AM), j(24, 4, 1, PM)],
  p35: [j(19, 4, 1, AM), j(21, 5, 2, PM), j(25, 5, 1, DAY)],
};
