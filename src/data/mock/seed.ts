/**
 * 목업 시드. 가상 고객·주소·업체·작업 데이터만 사용한다. (실제 개인정보·전화번호 없음)
 * 목업 시계는 2026-10-13 19:00 (Asia/Seoul)로 고정한다. 시간 경과를 기다리지 않고 개발 도구 이벤트로 상태를 바꾼다.
 */
import { paymentDeadline } from '../../domain/rules';
import type {
  Approval, Booking, Category, CustomerContact, Deduction, FinalStatement, GroupRecord, MaterialOffer, Refund, RepairRequest,
  StatementItem, TaskItem, Transaction, TxKind, Won, VisitAddress,
} from '../../domain/types';
import { DEFAULT_SETTINGS, type AddressRecord, type MockDb, type ProviderRecord } from './db';
import { PROVIDER_SERVICES } from './providerServices';
import { EXTRA_JOINT_DAYS, EXTRA_PROVIDERS } from './providersExtra';
import { DEMO_SCHEDULE_VERSION } from './scheduleMigration';

export const MOCK_NOW = '2026-10-13T19:00:00+09:00';
const k = (md: string, hm = '00:00') => `2026-${md}T${hm}:00+09:00`;
const ymd = (md: string) => `2026-${md}`;

export const CATEGORIES: Category[] = [
  { id: 'c1', name: '방충망 수리·교체' },
  { id: 'c2', name: '수전·샤워기·배수 부품' },
  { id: 'c3', name: '문손잡이·경첩·문' },
  { id: 'c4', name: '수납장·서랍 수리' },
  { id: 'c5', name: '창문 부속·틈새 보수' },
  { id: 'c6', name: '조명·스위치·콘센트' },
  { id: 'c7', name: '커튼·블라인드·선반 설치' },
  { id: 'c8', name: '생활 부속품 설치·교체' },
  { id: 'c9', name: '실리콘·줄눈 보수' },
];

const addressBook: AddressRecord[] = [
  { id: 'ad-apt', label: '햇살마을 3단지', line1: '서울 가상구 햇살로 100 (햇살마을 3단지)', kind: 'apartment', anchors: ['complex:haessal3'] },
  { id: 'ad-apt-b', label: '햇살마을 3단지 상가동', line1: '서울 가상구 햇살로 102 (햇살마을 3단지 상가동)', kind: 'apartment', anchors: ['complex:haessal3'] },
  { id: 'ad-house', label: '달빛길 단독주택', line1: '서울 가상구 달빛길 12 (단독주택)', kind: 'house', anchors: ['radius:dalbit-a'] },
  { id: 'ad-apt2', label: '푸른숲 2단지', line1: '서울 가상구 숲길 45 (푸른숲 2단지)', kind: 'apartment', anchors: ['complex:pureun2'] },
  { id: 'ad-far', label: '먼바다로 빌라', line1: '서울 가상구 먼바다로 77 (빌라)', kind: 'house', anchors: [] },
];

/** 데모 요청·예약의 제출 당시 상세 주소(건물별로 명시. 다른 건물의 동·호수를 붙이지 않는다) */
const DEMO_DETAIL: Record<string, string> = { 'ad-apt': '301동 1204호', 'ad-apt-b': '2층 201호', 'ad-house': '', 'ad-apt2': '105동 702호', 'ad-far': '' };
/** 제출 당시 방문 주소 스냅숏 */
function visitAddressOf(addressId: string): VisitAddress {
  const a = addressBook.find((x) => x.id === addressId)!;
  return { addressId: a.id, label: a.label, line1: a.line1, kind: a.kind, detail: DEMO_DETAIL[a.id] ?? '' };
}

const review = (id: string, author: string, rating: number, body: string, md: string, workLabel: string) => ({
  id, author, rating, body, createdAt: k(md, '12:00'), workLabel,
});

// 기존 업체 p1~p8. 카테고리마다 10곳이 보이도록 더한 업체(p9~p35)는 providersExtra.ts에 두고 아래에서 이어 붙인다(전체 35곳)
const providers: ProviderRecord[] = [
  {
    id: 'p1', name: '한빛설비', categoryIds: ['c2', 'c9'], rating: 4.8, reviewCount: 126, soloTripFee: 50000, area: '가상구 일대',
    scope: ['수전·샤워기 교체', '배수 트랩·부품 교체', '실리콘 재시공', '그 외 생활 배관 소규모 수리'],
    intro: '욕실·주방 생활 배관을 주로 다루는 가상 업체입니다. 같은 날 가까운 댁을 묶어 방문합니다.',
    phone: '010-0000-0101',
    afterServiceTerms: ['시공 부위 재발 시 업체와 직접 협의합니다.', '교체한 부품의 제조사 보증은 제품 기준을 따릅니다.'],
    reviews: [
      review('rv-p1-1', '이*다', 5, '약속한 시간대에 도착하셨고 설명이 친절했어요.', '09-28', '수전 교체'),
      review('rv-p1-2', '박*수', 4, '작업은 깔끔했습니다. 부품 선택 설명이 조금 더 있으면 좋겠어요.', '09-20', '배수 트랩 교체'),
    ],
  },
  {
    id: 'p2', name: '새봄수리', categoryIds: ['c2', 'c3', 'c4'], rating: 4.6, reviewCount: 88, soloTripFee: 60000, area: '가상구·가상동구',
    scope: ['수전 교체', '문손잡이·경첩 교체', '서랍·수납장 수리', '기타 생활 수리'],
    intro: '작은 생활 수리를 폭넓게 맡는 가상 업체입니다.', phone: '010-0000-0102',
    afterServiceTerms: ['재방문 일정은 고객과 협의합니다.'],
    reviews: [review('rv-p2-1', '최*영', 5, '서랍 레일을 금방 고쳐 주셨어요.', '09-30', '서랍 수리')],
  },
  {
    id: 'p3', name: '밝은전기', categoryIds: ['c6', 'c8'], rating: 4.9, reviewCount: 203, soloTripFee: 40000, area: '가상구 일대',
    scope: ['조명 교체', '스위치·콘센트 교체', '생활 부속품 설치'],
    intro: '조명과 스위치를 전문으로 하는 가상 업체입니다.', phone: '010-0000-0103',
    afterServiceTerms: ['시공 후 이상이 있으면 먼저 업체에 연락해 주세요. 방문 일정은 협의합니다.'],
    reviews: [
      review('rv-p3-1', '정*호', 5, '조명 교체가 빨랐어요.', '10-02', '조명 교체'),
      review('rv-p3-2', '한*진', 5, '콘센트 위치까지 꼼꼼하게 확인해 주셨습니다.', '09-25', '콘센트 교체'),
    ],
  },
  {
    id: 'p4', name: '든든문고리', categoryIds: ['c3', 'c1'], rating: 4.5, reviewCount: 64, soloTripFee: 45000, area: '가상구 일대',
    scope: ['문손잡이 교체', '경첩 조정', '방충망 교체'], intro: '문과 방충망을 주로 수리하는 가상 업체입니다.',
    phone: '010-0000-0104', afterServiceTerms: ['부품 불량은 제조사 기준에 따라 교환합니다.'],
    reviews: [review('rv-p4-1', '오*미', 4, '문이 잘 닫혀요.', '10-01', '경첩 조정')],
  },
  {
    id: 'p5', name: '깔끔마감', categoryIds: ['c9', 'c7'], rating: 4.7, reviewCount: 71, soloTripFee: 50000, area: '가상구·푸른숲',
    scope: ['욕실·주방 실리콘 보수', '줄눈 보수', '선반·커튼 설치'], intro: '마감 보수를 주로 하는 가상 업체입니다.',
    phone: '010-0000-0105', afterServiceTerms: ['실리콘 양생 기간 안내를 따라 주세요.'],
    reviews: [review('rv-p5-1', '송*아', 5, '마감이 깔끔해요.', '09-27', '실리콘 보수')],
  },
  {
    id: 'p6', name: '손맵시', categoryIds: ['c4', 'c7', 'c8'], rating: 4.4, reviewCount: 39, soloTripFee: 50000, area: '가상구 일대',
    scope: ['서랍·수납장 수리', '선반·블라인드 설치', '맞춤 도어 교체'], intro: '수납과 설치 작업을 맡는 가상 업체입니다.',
    phone: '010-0000-0106', afterServiceTerms: ['맞춤 자재는 사전 안내한 취소 조건을 따릅니다.'],
    reviews: [review('rv-p6-1', '윤*석', 4, '선반 설치가 튼튼해요.', '10-03', '선반 설치')],
  },
  {
    id: 'p7', name: '맑은창방충망', categoryIds: ['c1'], rating: 4.3, reviewCount: 22, soloTripFee: 35000, area: '가상구 일대',
    scope: ['방충망 교체', '방충망 틀 수리'], intro: '방충망 전문 가상 업체입니다.', phone: '010-0000-0107',
    afterServiceTerms: ['재방문 일정은 협의합니다.'], reviews: [],
  },
  {
    id: 'p8', name: '반듯설치', categoryIds: ['c7', 'c8'], rating: 4.2, reviewCount: 18, soloTripFee: 40000, area: '가상구 일대',
    scope: ['커튼·블라인드 설치', '생활 부속품 설치'], intro: '설치 작업 중심의 가상 업체입니다.', phone: '010-0000-0108',
    afterServiceTerms: ['설치 후 이상은 업체에 직접 문의해 주세요.'], reviews: [],
  },
  ...EXTRA_PROVIDERS,
];

function group(p: Partial<GroupRecord> & Pick<GroupRecord, 'id' | 'providerId' | 'date' | 'totalTripFee' | 'closeAt' | 'anchorKey'>): GroupRecord {
  return {
    slots: ['09:00–12:00', '13:00–16:00'], capacity: 5, confirmedHouseholds: 0, pendingSeats: 0,
    scopeType: p.anchorKey.startsWith('complex:') ? 'complex' : 'radius', closed: false, ended: false, finalPerHouseholdFee: null,
    ...p,
    // 마감된 시드 그룹은 마감 시 확정 세대 수를 함께 둔다(세대별 확정 출장비의 분담 기준)
    finalHouseholds: p.closed ? (p.finalHouseholds ?? p.confirmedHouseholds ?? 0) : null,
  };
}

const groups: GroupRecord[] = [
  // 열린 그룹(참여 대상) — 공동 예약 데모 일정. 모든 업체가 2026-10-19(월)~10-25(일) 중 서로 다른 날짜 3개에 날짜당 하나씩(고정 값, 새로고침해도 같음).
  // 접수 마감은 방문 전날 18:00(가장 늦은 마감, latestCloseAt) 이전. 같은 날 여러 그룹 구조는 그대로 지원하지만 데모에서는 한 주소에서 날짜당 하나만 보이게 둔다.
  // 다른 지역 데모 기록용 그룹(g6 = 달빛길 단독주택 반경, g7 = 푸른숲 2단지)은 같은 날짜에 햇살마을 그룹(g4c·g5b)을 함께 둔다 — 업체 날짜는 3개 그대로, 기본 데모 주소(햇살마을)에서는 모든 업체가 3개 날짜·날짜당 하나로 보인다.
  // p1 한빛설비 19·21·23 / p2 새봄수리 20·22·24 / p3 밝은전기 19·22·25 / p4 든든문고리 21·22·24 / p5 깔끔마감 19·20·23
  // p6 손맵시 20·23·24 / p7 맑은창방충망 20·23·25 / p8 반듯설치 21·24·25 / p9~p35는 providersExtra.ts(EXTRA_JOINT_DAYS)
  group({ id: 'g1', providerId: 'p1', date: ymd('10-19'), closeAt: k('10-18', '18:00'), totalTripFee: 50000, capacity: 6, confirmedHouseholds: 3, pendingSeats: 1, anchorKey: 'complex:haessal3' }),
  group({ id: 'g1b', providerId: 'p1', date: ymd('10-21'), closeAt: k('10-20', '12:00'), totalTripFee: 45000, capacity: 4, confirmedHouseholds: 1, slots: ['13:00–16:00'], anchorKey: 'complex:haessal3' }),
  group({ id: 'g1n', providerId: 'p1', date: ymd('10-23'), closeAt: k('10-22', '18:00'), totalTripFee: 50000, capacity: 5, confirmedHouseholds: 2, anchorKey: 'complex:haessal3' }),
  group({ id: 'g4', providerId: 'p2', date: ymd('10-20'), closeAt: k('10-19', '18:00'), totalTripFee: 60000, capacity: 5, confirmedHouseholds: 2, pendingSeats: 1, slots: ['13:00–16:00'], anchorKey: 'complex:haessal3' }),
  group({ id: 'g2a', providerId: 'p2', date: ymd('10-22'), closeAt: k('10-21', '18:00'), totalTripFee: 60000, capacity: 4, confirmedHouseholds: 1, anchorKey: 'complex:haessal3' }),
  group({ id: 'g2b', providerId: 'p2', date: ymd('10-24'), closeAt: k('10-23', '18:00'), totalTripFee: 55000, capacity: 5, confirmedHouseholds: 3, slots: ['09:00–12:00'], anchorKey: 'complex:haessal3' }),
  group({ id: 'g5', providerId: 'p3', date: ymd('10-19'), closeAt: k('10-18', '18:00'), totalTripFee: 40000, capacity: 4, confirmedHouseholds: 3, slots: ['13:00–16:00'], anchorKey: 'complex:haessal3' }),
  group({ id: 'g3a', providerId: 'p3', date: ymd('10-22'), closeAt: k('10-21', '18:00'), totalTripFee: 40000, capacity: 5, confirmedHouseholds: 2, anchorKey: 'complex:haessal3' }),
  group({ id: 'g3b', providerId: 'p3', date: ymd('10-25'), closeAt: k('10-24', '18:00'), totalTripFee: 40000, capacity: 4, confirmedHouseholds: 1, slots: ['09:00–12:00'], anchorKey: 'complex:haessal3' }),
  group({ id: 'g4a', providerId: 'p4', date: ymd('10-21'), closeAt: k('10-20', '18:00'), totalTripFee: 45000, capacity: 5, confirmedHouseholds: 2, anchorKey: 'complex:haessal3' }),
  group({ id: 'g6', providerId: 'p4', date: ymd('10-22'), closeAt: k('10-21', '18:00'), totalTripFee: 45000, capacity: 5, confirmedHouseholds: 1, anchorKey: 'radius:dalbit-a' }),
  group({ id: 'g4c', providerId: 'p4', date: ymd('10-22'), closeAt: k('10-21', '18:00'), totalTripFee: 45000, capacity: 4, confirmedHouseholds: 2, slots: ['09:00–12:00'], anchorKey: 'complex:haessal3' }),
  group({ id: 'g4b', providerId: 'p4', date: ymd('10-24'), closeAt: k('10-23', '18:00'), totalTripFee: 45000, capacity: 4, confirmedHouseholds: 1, slots: ['13:00–16:00'], anchorKey: 'complex:haessal3' }),
  group({ id: 'gn-p5', providerId: 'p5', date: ymd('10-19'), closeAt: k('10-18', '18:00'), totalTripFee: 50000, capacity: 5, confirmedHouseholds: 2, slots: ['09:00–12:00'], anchorKey: 'complex:haessal3' }),
  group({ id: 'g7', providerId: 'p5', date: ymd('10-20'), closeAt: k('10-19', '18:00'), totalTripFee: 30000, capacity: 4, confirmedHouseholds: 1, anchorKey: 'complex:pureun2' }),
  group({ id: 'g5b', providerId: 'p5', date: ymd('10-20'), closeAt: k('10-19', '18:00'), totalTripFee: 50000, capacity: 5, confirmedHouseholds: 1, anchorKey: 'complex:haessal3' }),
  group({ id: 'g5a', providerId: 'p5', date: ymd('10-23'), closeAt: k('10-22', '18:00'), totalTripFee: 50000, capacity: 4, confirmedHouseholds: 1, anchorKey: 'complex:haessal3' }),
  group({ id: 'g6a', providerId: 'p6', date: ymd('10-20'), closeAt: k('10-19', '18:00'), totalTripFee: 50000, capacity: 4, confirmedHouseholds: 1, anchorKey: 'complex:haessal3' }),
  group({ id: 'g6b', providerId: 'p6', date: ymd('10-23'), closeAt: k('10-22', '18:00'), totalTripFee: 50000, capacity: 5, confirmedHouseholds: 2, slots: ['13:00–16:00'], anchorKey: 'complex:haessal3' }),
  group({ id: 'g6c', providerId: 'p6', date: ymd('10-24'), closeAt: k('10-23', '18:00'), totalTripFee: 50000, capacity: 4, anchorKey: 'complex:haessal3' }),
  group({ id: 'g7a', providerId: 'p7', date: ymd('10-20'), closeAt: k('10-19', '18:00'), totalTripFee: 35000, capacity: 5, confirmedHouseholds: 2, anchorKey: 'complex:haessal3' }),
  group({ id: 'g7b', providerId: 'p7', date: ymd('10-23'), closeAt: k('10-22', '18:00'), totalTripFee: 35000, capacity: 4, confirmedHouseholds: 1, slots: ['13:00–16:00'], anchorKey: 'complex:haessal3' }),
  group({ id: 'g7c', providerId: 'p7', date: ymd('10-25'), closeAt: k('10-24', '18:00'), totalTripFee: 35000, capacity: 4, anchorKey: 'complex:haessal3' }),
  group({ id: 'g8a', providerId: 'p8', date: ymd('10-21'), closeAt: k('10-20', '18:00'), totalTripFee: 40000, capacity: 4, confirmedHouseholds: 1, anchorKey: 'complex:haessal3' }),
  group({ id: 'g8b', providerId: 'p8', date: ymd('10-24'), closeAt: k('10-23', '18:00'), totalTripFee: 40000, capacity: 5, confirmedHouseholds: 2, slots: ['09:00–12:00'], anchorKey: 'complex:haessal3' }),
  group({ id: 'g8c', providerId: 'p8', date: ymd('10-25'), closeAt: k('10-24', '18:00'), totalTripFee: 40000, capacity: 4, anchorKey: 'complex:haessal3' }),
  // 추가 업체(p9~p35): 업체마다 10/19~25 중 서로 다른 날짜 3개·날짜당 하나(providersExtra.ts의 고정 값). 접수 마감은 방문 전날 18:00, 총 출장비는 기본 출장비(따로 정한 그룹 제외)
  ...EXTRA_PROVIDERS.flatMap((p) => EXTRA_JOINT_DAYS[p.id].map((d, i) => group({
    id: `gx-${p.id}-${i + 1}`, providerId: p.id, date: ymd(`10-${d.day}`), closeAt: k(`10-${d.day - 1}`, '18:00'), totalTripFee: d.totalTripFee ?? p.soloTripFee,
    capacity: d.capacity, confirmedHouseholds: d.confirmedHouseholds, pendingSeats: d.pendingSeats ?? 0, slots: [...d.slots], anchorKey: 'complex:haessal3',
  }))),
  // 시나리오 그룹(캘린더에 보이지 않음): g8 = 업체 사정으로 종료된 그룹(rq-10 조건 재확인), g9 = 그 대신 만든 새 그룹(pending-new — 주소 범위 판단 전)
  group({ id: 'g8', providerId: 'p6', date: ymd('10-16'), closeAt: k('10-15', '18:00'), totalTripFee: 50000, capacity: 4, anchorKey: 'complex:haessal3', ended: true }),
  group({ id: 'g9', providerId: 'p6', date: ymd('10-19'), closeAt: k('10-18', '18:00'), totalTripFee: 60000, capacity: 4, anchorKey: 'pending-new', slots: ['09:00–12:00'] }),
  // 마감된 그룹(확정 출장비 고정)
  group({ id: 'gc-p1', providerId: 'p1', date: ymd('10-14'), closeAt: k('10-13', '18:00'), totalTripFee: 50000, confirmedHouseholds: 4, closed: true, finalPerHouseholdFee: 12500, slots: ['09:00–12:00'], anchorKey: 'complex:haessal3' }),
  group({ id: 'gc-p4', providerId: 'p4', date: ymd('10-13'), closeAt: k('10-12', '18:00'), totalTripFee: 45000, confirmedHouseholds: 3, closed: true, finalPerHouseholdFee: 15000, slots: ['13:00–16:00'], anchorKey: 'complex:haessal3' }),
  group({ id: 'gc-p5', providerId: 'p5', date: ymd('10-14'), closeAt: k('10-13', '18:00'), totalTripFee: 50000, confirmedHouseholds: 3, closed: true, finalPerHouseholdFee: 16666, slots: ['13:00–16:00'], anchorKey: 'complex:haessal3' }),
  group({ id: 'gc-p6', providerId: 'p6', date: ymd('10-14'), closeAt: k('10-13', '18:00'), totalTripFee: 50000, confirmedHouseholds: 4, closed: true, finalPerHouseholdFee: 12500, slots: ['09:00–12:00'], anchorKey: 'complex:haessal3' }),
  group({ id: 'gc-p3', providerId: 'p3', date: ymd('10-14'), closeAt: k('10-13', '18:00'), totalTripFee: 40000, confirmedHouseholds: 4, closed: true, finalPerHouseholdFee: 10000, slots: ['09:00–12:00'], anchorKey: 'complex:haessal3' }),
  group({ id: 'gp-p1', providerId: 'p1', date: ymd('10-09'), closeAt: k('10-08', '18:00'), totalTripFee: 50000, confirmedHouseholds: 4, closed: true, finalPerHouseholdFee: 12500, anchorKey: 'complex:haessal3' }),
  group({ id: 'gp-p2', providerId: 'p2', date: ymd('10-09'), closeAt: k('10-08', '18:00'), totalTripFee: 50000, confirmedHouseholds: 4, closed: true, finalPerHouseholdFee: 12500, anchorKey: 'complex:haessal3' }),
  group({ id: 'gp-p3', providerId: 'p3', date: ymd('10-09'), closeAt: k('10-08', '18:00'), totalTripFee: 40000, confirmedHouseholds: 4, closed: true, finalPerHouseholdFee: 10000, anchorKey: 'complex:haessal3' }),
];

// ───────── 빌더 ─────────
let tid = 0;
const tk = (title: string, description: string, photoNames: string[] = []): TaskItem => ({ id: `t${++tid}`, title, description, photoNames });

const T_FAUCET = () => [tk('욕실 세면대 수전 교체', '수전 손잡이가 헐거워 물이 샙니다.', ['faucet.jpg']), tk('배수 트랩 교체', '배수 속도가 느리고 냄새가 납니다.')];

/** 기본 가상 고객(저장된 내 정보가 없거나 잘못됐을 때 사용). 실제 개인정보가 아니다. */
export const DEFAULT_CUSTOMER: CustomerContact = { name: '김온다 (가상 고객)', phone: '01000000000' };

function request(r: Partial<RepairRequest> & Pick<RepairRequest, 'id' | 'providerId' | 'status' | 'tasks'>): RepairRequest {
  const addressId = r.addressId ?? 'ad-apt';
  return {
    bundleId: `b-${r.id}`, groupId: null, slots: ['09:00–12:00', '13:00–16:00'],
    createdAt: k('10-13', '09:00'), updatedAt: k('10-13', '09:00'), ...r,
    addressId, visitAddress: r.visitAddress ?? visitAddressOf(addressId), contact: r.contact ?? { ...DEFAULT_CUSTOMER },
  };
}

function approval(a: Partial<Approval> & Pick<Approval, 'requestId' | 'groupId' | 'approvedAt' | 'groupCloseAt' | 'visitDate' | 'totalTripFee' | 'tasks'>): Approval {
  return {
    id: `ap-${a.requestId}`, version: 1,
    paymentDeadline: paymentDeadline(a.approvedAt, a.groupCloseAt),
    depositAmount: a.totalTripFee, partsEstimate: 20000,
    cancellationTerms: [
      '결제 전에는 취소수수료 없이 요청을 철회할 수 있어요.',
      '마감 전 취소는 출장비 공제 없이 환불돼요.',
      '마감 후 취소는 본인의 확정 출장비가 공제돼요. 다른 세대의 확정 출장비는 오르지 않아요.',
    ],
    ...a,
  };
}

const requests: RepairRequest[] = [];
const approvals: Approval[] = [];
const bookings: Booking[] = [];
const transactions: Transaction[] = [];
const refunds: Refund[] = [];
const deductions: Deduction[] = [];
const statements: FinalStatement[] = [];
const materials: MaterialOffer[] = [];

// ───────── 요청 ─────────
requests.push(
  request({ id: 'rq-1', providerId: 'p3', status: 'reviewing', tasks: [tk('거실 조명 교체', '거실 등 두 개를 새 제품으로 바꾸고 싶어요.')], newDateWish: ymd('10-21'), createdAt: k('10-13', '09:30') }),
  request({ id: 'rq-2', providerId: 'p4', status: 'needs_info', tasks: [tk('현관문 손잡이 교체', '손잡이가 헐겁습니다.')],
    infoRequest: { message: '손잡이 브랜드나 모델명이 보이는 사진을 한 장 더 올려 주세요.', requestedAt: k('10-13', '14:00') }, groupId: 'g6', addressId: 'ad-house', createdAt: k('10-12', '20:00') }),
  request({ id: 'rq-3', bundleId: 'b-sink', providerId: 'p1', groupId: 'g1', status: 'approved_pending_payment', tasks: T_FAUCET(), createdAt: k('10-13', '10:00'), updatedAt: k('10-13', '15:00') }),
  request({ id: 'rq-4', bundleId: 'b-sink', providerId: 'p2', groupId: 'g4', slots: ['13:00–16:00'], status: 'approved_pending_payment', tasks: T_FAUCET(), createdAt: k('10-13', '10:10'), updatedAt: k('10-13', '17:00') }),
  request({ id: 'rq-5', providerId: 'p6', status: 'rejected', tasks: [tk('거실장 서랍 레일 수리', '서랍이 빠집니다.')],
    rejectionReason: '서랍 레일 규격 확인이 어려워 이번 일정에는 수행이 어려워요.', createdAt: k('10-11', '10:00'), updatedAt: k('10-12', '10:00') }),
  request({ id: 'rq-6', providerId: 'p7', status: 'withdrawn', tasks: [tk('안방 방충망 교체', '찢어졌어요.')], newDateWish: ymd('10-22'), createdAt: k('10-10', '10:00'), updatedAt: k('10-11', '10:00') }),
  request({ id: 'rq-7', providerId: 'p5', groupId: 'g7', addressId: 'ad-apt2', status: 'approval_expired', tasks: [tk('욕실 실리콘 보수', '곰팡이가 생겼어요.')], createdAt: k('10-10', '09:00'), updatedAt: k('10-12', '09:00') }),
  request({ id: 'rq-8', bundleId: 'b-lamp', providerId: 'p6', status: 'closed_other_booking', tasks: [tk('거실 조명 교체', '거실 등 교체')], createdAt: k('10-11', '09:00'), updatedAt: k('10-12', '16:00') }),
  request({ id: 'rq-10', providerId: 'p6', groupId: 'g8', status: 'approved_pending_payment', tasks: [tk('거실 선반 설치', '벽걸이 선반 두 개를 달고 싶어요.')], createdAt: k('10-12', '09:00'), updatedAt: k('10-13', '13:00') }),
);

approvals.push(
  approval({ requestId: 'rq-3', groupId: 'g1', approvedAt: k('10-13', '15:00'), groupCloseAt: k('10-18', '18:00'), visitDate: ymd('10-19'), visitTime: '10:00', totalTripFee: 50000,
    tasks: [{ title: '욕실 세면대 수전 교체', note: '수전 본체와 급수 호스 교체', estimate: 50000 }, { title: '배수 트랩 교체', note: '트랩과 연결 부품 교체', estimate: 30000 }],
    materialNote: '일반 기성 부품은 최종 정산 때 합산해요. 맞춤 자재가 필요하면 별도 안내 후 동의를 받아요.' }),
  approval({ requestId: 'rq-4', groupId: 'g4', approvedAt: k('10-13', '17:00'), groupCloseAt: k('10-19', '18:00'), visitDate: ymd('10-20'), visitTime: '14:00', totalTripFee: 60000, partsEstimate: 25000,
    tasks: [{ title: '욕실 세면대 수전 교체', note: '수전 본체 교체', estimate: 40000 }, { title: '배수 트랩 교체', note: '트랩 교체', estimate: 30000 }],
    discountNote: '두 작업을 함께 맡기면 작업비 5,000원 할인 (다른 할인과 중복 적용 불가)' }),
  approval({ requestId: 'rq-7', groupId: 'g7', approvedAt: k('10-11', '09:00'), groupCloseAt: k('10-19', '18:00'), visitDate: ymd('10-20'), visitTime: '10:00', totalTripFee: 30000, partsEstimate: 5000,
    tasks: [{ title: '욕실 실리콘 보수', note: '기존 실리콘 제거 후 재시공', estimate: 40000 }] }),
  approval({ requestId: 'rq-10', groupId: 'g8', approvedAt: k('10-13', '13:00'), groupCloseAt: k('10-15', '18:00'), visitDate: ymd('10-16'), visitTime: '10:30', totalTripFee: 50000, partsEstimate: 15000,
    tasks: [{ title: '거실 선반 설치', note: '벽걸이 선반 2개 설치', estimate: 45000 }],
    recheck: {
      endedGroupNote: '함께 예약했던 세대가 모두 취소해 기존 공동 예약이 종료됐어요.',
      newGroupId: 'g9', newVisitDate: ymd('10-19'), newVisitTime: '10:00', newCloseAt: k('10-18', '18:00'), newTotalTripFee: 60000, newDepositAmount: 60000,
    } }),
);

// ───────── 예약 ─────────
interface BookingSeed {
  id: string; req: string; provider: string; group: string; visit: string;
  /** 고객 가능 시간(요청서) */ window: string;
  /** 업체 제안 → 예약금 결제로 확정된 방문 시각. 가능 시간 안 */ time: string;
  tasks: TaskItem[];
  work?: Booking['workStatus']; status?: Booking['status']; address?: string; labor?: number; parts?: number; deposit: Won;
  cancelledAt?: string; cancelCause?: Booking['cancelCause']; followUp?: Booking['followUp']; created?: string;
}
function addBooking(b: BookingSeed) {
  requests.push(request({ id: b.req, providerId: b.provider, groupId: b.group, slots: [b.window], status: 'booked', tasks: b.tasks, bookingId: b.id, addressId: b.address ?? 'ad-apt', createdAt: k('10-08', '10:00'), updatedAt: k('10-09', '10:00') }));
  const grp = groups.find((g) => g.id === b.group)!;
  approvals.push(approval({
    requestId: b.req, groupId: b.group, approvedAt: k('10-09', '09:00'), groupCloseAt: grp.closeAt, visitDate: b.visit, visitTime: b.time,
    totalTripFee: grp.totalTripFee, partsEstimate: b.parts ?? 20000,
    tasks: b.tasks.map((t, i) => ({ title: t.title, note: '업체 승인 범위', estimate: i === 0 ? (b.labor ?? 50000) : 30000 })),
  }));
  bookings.push({
    id: b.id, requestId: b.req, providerId: b.provider, groupId: b.group, addressId: b.address ?? 'ad-apt',
    status: b.status ?? 'confirmed', workStatus: b.work ?? 'scheduled', visitDate: b.visit, visitTime: b.time, customerSlots: [b.window], tasks: b.tasks,
    visitAddress: visitAddressOf(b.address ?? 'ad-apt'), contact: { ...DEFAULT_CUSTOMER },
    createdAt: b.created ?? k('10-09', '11:00'), cancelledAt: b.cancelledAt, cancelCause: b.cancelCause, followUp: b.followUp,
  });
  addTx(b.id, 'deposit', b.deposit, 'success', b.req);
}

let txSeq = 0;
function addTx(bookingId: string | undefined, kind: TxKind, amount: Won, status: Transaction['status'], requestId?: string, materialOfferId?: string) {
  const id = `tx-s${++txSeq}`;
  transactions.push({ id, kind, bookingId, requestId, materialOfferId, amount, status, idempotencyKey: `seed-${id}`, createdAt: k('10-09', '11:00'), mock: true });
  return id;
}
function addRefund(bookingId: string, amount: Won, reason: string, status: Refund['status'], md = '10-12') {
  refunds.push({ id: `rf-s${refunds.length + 1}`, bookingId, amount, reason, purpose: bookingId === 'bk-k14' ? 'settlement' : 'cancel', status, requestedAt: k(md, '11:00'), completedAt: status === 'completed' ? k(md, '15:00') : undefined });
}
function addDeduction(bookingId: string, kind: Deduction['kind'], amount: Won, label: string, md = '10-12') {
  deductions.push({ id: `dd-s${deductions.length + 1}`, bookingId, kind, amount, label, createdAt: k(md, '11:00') });
}
function addStatement(bookingId: string, status: FinalStatement['status'], items: StatementItem[], extra: Partial<FinalStatement> = {}) {
  statements.push({
    id: `st-${bookingId}`, bookingId, version: 1, status, items,
    // 실제 작업 내역은 예약 작업별로 업체가 등록한 완료 여부(요청 작업 전체를 한 줄로 완료 처리하지 않는다)
    actualWork: bookings.find((b) => b.id === bookingId)!.tasks.map((t) => ({ title: t.title, done: true })), ...extra,
  });
}

// 진행 중
addBooking({ id: 'bk-k1', req: 'rq-k1', provider: 'p3', group: 'g5', visit: ymd('10-19'), window: '13:00–16:00', time: '14:00', tasks: [tk('거실 조명 교체', '거실 등 두 개')], deposit: 40000, labor: 45000, parts: 15000 });
addBooking({ id: 'bk-k2', req: 'rq-k2', provider: 'p1', group: 'gc-p1', visit: ymd('10-14'), window: '09:00–12:00', time: '10:00', tasks: T_FAUCET(), deposit: 50000, labor: 50000, parts: 20000 });
addBooking({ id: 'bk-k3', req: 'rq-k3', provider: 'p4', group: 'gc-p4', visit: ymd('10-13'), window: '13:00–16:00', time: '14:00', tasks: [tk('현관문 손잡이 교체', '손잡이가 헐겁습니다.')], deposit: 45000, labor: 35000, parts: 12000 });
addBooking({ id: 'bk-k4', req: 'rq-k4', provider: 'p5', group: 'gc-p5', visit: ymd('10-14'), window: '13:00–16:00', time: '14:00', tasks: [tk('욕실 실리콘 보수', '곰팡이 제거 후 재시공')], deposit: 50000, labor: 40000, parts: 5000 });
addBooking({ id: 'bk-k5', req: 'rq-k5', provider: 'p6', group: 'gc-p6', visit: ymd('10-14'), window: '09:00–12:00', time: '10:00', tasks: [tk('서랍장 도어 교체', '맞춤 크기 도어로 바꾸고 싶어요.')], deposit: 50000, labor: 60000, parts: 80000 });
addBooking({ id: 'bk-k6', req: 'rq-k6', provider: 'p3', group: 'gc-p3', visit: ymd('10-14'), window: '09:00–12:00', time: '10:00', tasks: [tk('스위치·콘센트 교체', '거실 스위치가 자주 나갑니다.')], work: 'in_progress', deposit: 40000, labor: 30000, parts: 8000 });
addBooking({ id: 'bk-k7', req: 'rq-k7', provider: 'p3', group: 'gc-p3', visit: ymd('10-14'), window: '09:00–12:00', time: '10:00', tasks: [tk('주방 조명 교체', '레일 조명 설치')], work: 'followup_waiting',
  followUp: { date: ymd('10-20'), window: '09:00–12:00', note: '배선 정리 후 조명을 달기로 업체와 합의했어요.' }, deposit: 40000, labor: 50000, parts: 10000 });
// 최종 정산
addBooking({ id: 'bk-k9', req: 'rq-k9', provider: 'p1', group: 'gp-p1', visit: ymd('10-09'), window: '09:00–12:00', time: '10:00', tasks: T_FAUCET(), work: 'final_confirm_waiting', deposit: 50000, created: k('10-04', '10:00') });
addBooking({ id: 'bk-k10', req: 'rq-k10', provider: 'p1', group: 'gp-p1', visit: ymd('10-09'), window: '13:00–16:00', time: '14:00', tasks: [tk('주방 수전 교체', '')], work: 'final_confirm_waiting', deposit: 50000, created: k('10-04', '10:00') });
addBooking({ id: 'bk-k11', req: 'rq-k11', provider: 'p2', group: 'gp-p2', visit: ymd('10-09'), window: '09:00–12:00', time: '10:00', tasks: [tk('문손잡이 교체', '')], work: 'final_confirm_waiting', deposit: 50000, created: k('10-04', '10:00') });
addBooking({ id: 'bk-k12', req: 'rq-k12', provider: 'p2', group: 'gp-p2', visit: ymd('10-09'), window: '13:00–16:00', time: '14:00', tasks: [tk('서랍 레일 수리', '')], work: 'stopped_settlement_waiting', deposit: 50000, created: k('10-04', '10:00') });
addBooking({ id: 'bk-k13', req: 'rq-k13', provider: 'p3', group: 'gp-p3', visit: ymd('10-09'), window: '09:00–12:00', time: '10:00', tasks: [tk('거실 조명 교체', '')], work: 'completed', deposit: 40000, created: k('10-04', '10:00') });
addBooking({ id: 'bk-k14', req: 'rq-k14', provider: 'p1', group: 'gp-p1', visit: ymd('10-09'), window: '09:00–12:00', time: '10:00', tasks: [tk('욕실 수전 교체', '')], work: 'completed', deposit: 50000, created: k('10-04', '10:00') });
// 취소
addBooking({ id: 'bk-k15', req: 'rq-k15', provider: 'p5', group: 'g7', visit: ymd('10-20'), window: '09:00–12:00', time: '10:00', tasks: [tk('욕실 실리콘 보수', '')], status: 'cancelled', cancelledAt: k('10-12', '11:00'), cancelCause: 'customer', deposit: 30000, address: 'ad-apt2' });
addBooking({ id: 'bk-k16', req: 'rq-k16', provider: 'p5', group: 'gc-p5', visit: ymd('10-14'), window: '13:00–16:00', time: '14:00', tasks: [tk('줄눈 보수', '')], status: 'cancelled', cancelledAt: k('10-13', '18:30'), cancelCause: 'customer', deposit: 50000 });
addBooking({ id: 'bk-k17', req: 'rq-k17', provider: 'p4', group: 'gc-p4', visit: ymd('10-13'), window: '13:00–16:00', time: '14:00', tasks: [tk('방충망 교체', '')], status: 'cancelled', cancelledAt: k('10-12', '19:00'), cancelCause: 'provider', deposit: 45000 });
addBooking({ id: 'bk-k18', req: 'rq-k18', provider: 'p6', group: 'gc-p6', visit: ymd('10-14'), window: '09:00–12:00', time: '10:00', tasks: [tk('맞춤 선반 도어 교체', '')], status: 'cancelled', cancelledAt: k('10-13', '18:45'), cancelCause: 'customer', deposit: 50000 });

requests.find((r) => r.id === 'rq-k1')!.bundleId = 'b-lamp';

// 선결제·공제·환불 이력
const matId = (id: string, bookingId: string, extra: Partial<MaterialOffer>): MaterialOffer => ({
  id, bookingId, name: '맞춤 서랍 도어', spec: '가로 420mm × 세로 600mm, 화이트 무광, 2장', quantity: 2, price: 80000, deliveryDate: ymd('10-14'),
  cancellationTerms: '주문·제작이 시작된 뒤 취소하면, 반품·환급이 불가능한 실제 비용만 공제될 수 있어요. 공제 금액과 근거는 취소 전에 안내돼요.',
  nonRefundableIfCancelled: 30000, paymentStatus: 'none', orderStatus: 'not_ordered', ...extra,
});
materials.push(matId('mt-1', 'bk-k5', {}));
{
  const t = addTx('bk-k17', 'material_prepay', 20000, 'success', undefined, 'mt-k17');
  materials.push(matId('mt-k17', 'bk-k17', { name: '방충망 맞춤 망', spec: '1200×900mm', quantity: 1, price: 20000, nonRefundableIfCancelled: 0, paymentStatus: 'success', paymentTxId: t, orderStatus: 'ordered' }));
  addRefund('bk-k17', 65000, '업체 사유 취소 · 예약금과 자재 선결제 전액', 'failed');
  const t2 = addTx('bk-k18', 'material_prepay', 80000, 'success', undefined, 'mt-k18');
  materials.push(matId('mt-k18', 'bk-k18', { paymentStatus: 'success', paymentTxId: t2, orderStatus: 'ordered', agreedAt: k('10-11', '10:00') }));
  addDeduction('bk-k18', 'trip_fee', 12500, '확정 출장비(마감 후 취소)', '10-13');
  addDeduction('bk-k18', 'material', 30000, '회수 불가능 자재 비용', '10-13');
  addRefund('bk-k18', 87500, '고객 사유 취소 · 선결제 130,000원 − 공제 42,500원', 'requested', '10-13');
}
addRefund('bk-k15', 30000, '고객 사유 취소(마감 전) · 출장비 공제 없음', 'completed');
addDeduction('bk-k16', 'trip_fee', 16666, '확정 출장비(마감 후 취소)', '10-13');
addRefund('bk-k16', 33334, '고객 사유 취소(마감 후) · 예약금 50,000원 − 확정 출장비 16,666원', 'requested', '10-13');

// 최종 내역
addStatement('bk-k9', 'awaiting_customer', [
  { kind: 'labor', label: '작업비', amount: 80000 }, { kind: 'material', label: '부품·자재비', amount: 20000 }, { kind: 'trip_fee', label: '확정 출장비', amount: 12500 }]);
addStatement('bk-k10', 'awaiting_customer', [
  { kind: 'labor', label: '작업비', amount: 30000 }, { kind: 'material', label: '부품·자재비', amount: 7500 }, { kind: 'trip_fee', label: '확정 출장비', amount: 12500 }]);
addStatement('bk-k11', 'awaiting_customer', [{ kind: 'labor', label: '작업비', amount: 30000 }, { kind: 'trip_fee', label: '확정 출장비', amount: 12500 }]);
addStatement('bk-k12', 'disputed', [{ kind: 'labor', label: '작업비', amount: 100000 }, { kind: 'trip_fee', label: '확정 출장비', amount: 12500 }],
  { actualWork: [{ title: '서랍 레일 수리', done: false }] });
addStatement('bk-k13', 'settled', [{ kind: 'labor', label: '작업비', amount: 60000 }, { kind: 'trip_fee', label: '확정 출장비', amount: 10000 }], { settledKind: 'pay', confirmedAt: k('10-09', '13:00') });
addTx('bk-k13', 'balance', 30000, 'success');
addStatement('bk-k14', 'settled', [{ kind: 'labor', label: '작업비', amount: 30000 }, { kind: 'trip_fee', label: '확정 출장비', amount: 12500 }], { settledKind: 'refund', confirmedAt: k('10-09', '13:00') });
addRefund('bk-k14', 7500, '최종 금액 정산 · 선결제 초과분', 'completed', '10-10');

const db: MockDb = {
  version: 1, scheduleVersion: DEMO_SCHEDULE_VERSION, now: MOCK_NOW, seq: 100, ownerAccountId: null,
  customer: { id: 'cu1', ...DEFAULT_CUSTOMER, phoneMasked: '010-****-0000' },
  // 사용자별 주소: 처음에는 탐색 주소·재사용 주소 모두 없음(첫 방문·첫 신청)
  exploreAddressId: null, savedVisitAddress: null,
  addressBook, categories: CATEGORIES,
  // 업체 등록 작업은 providerServices.ts에서 따로 관리하고 시드에서 업체에 붙인다
  providers: providers.map((p) => ({ ...p, services: PROVIDER_SERVICES[p.id] ?? [] })), groups, requests, approvals, bookings, transactions, refunds, deductions,
  proposals: [
    {
      id: 'pr-k4', bookingId: 'bk-k4', origin: 'provider', status: 'proposed', free: 'provider',
      // 이전 작업 지연으로 기존 일정(10/14 14:00)에는 방문할 수 없다고 업체가 지정(사유 문장으로 추측하지 않음)
      oldVisitAvailable: 'no',
      // 고객 가능 시간(13:00~16:00) 밖의 새 시각 — 기존 범위는 고치지 않고, 이 제안에 고객이 동의해야만 바뀐다
      oldVisit: { date: ymd('10-14'), time: '14:00' }, newVisit: { date: ymd('10-19'), time: '10:00', groupId: 'gn-p5' },
      reason: '이전 작업이 길어져 같은 날 방문이 어려워졌어요.',
      cost: { tripFeeCharged: 0, additionalDeposit: 0, note: '업체 사유 변경이라 변경 수수료가 없어요. 수락하면 확정 출장비 16,666원이 유지돼요.' },
      createdAt: k('10-13', '16:00'),
    },
  ],
  delays: [{ id: 'dl-k3', bookingId: 'bk-k3', originalDate: ymd('10-13'), originalVisitTime: '14:00', newEta: k('10-13', '14:20'), status: 'open' }],
  materials,
  additionalWorks: [
    { id: 'aw-1', bookingId: 'bk-k6', reason: '배선이 낡아 스위치 박스까지 교체해야 안전해요.', scope: '스위치 박스 1개 교체 및 배선 정리', amount: 25000, status: 'proposed' },
    { id: 'aw-2', bookingId: 'bk-k7', reason: '배선 정리가 먼저 필요해요.', scope: '주방 배선 정리 후 레일 조명 설치', amount: 40000,
      followUp: { date: ymd('10-20'), window: '09:00–12:00' }, status: 'agreed', respondedAt: k('10-14', '10:30') },
  ],
  statements,
  reviews: [{ id: 'rv-1', bookingId: 'bk-k14', providerId: 'p1', rating: 5, body: '약속한 시간에 오셔서 깔끔하게 마쳤어요.', photoNames: [], createdAt: k('10-10', '12:00') }],
  notices: [], keyed: {}, settings: { ...DEFAULT_SETTINGS },
};

/** 기본 시드(전체 상태 데모). 호출마다 새 복사본을 돌려준다. */
export function createSeed(preset: 'full' | 'lean' | 'empty' = 'full'): MockDb {
  const copy: MockDb = structuredClone(db);
  if (preset === 'full') return copy;
  const keepReq = preset === 'lean' ? new Set(['rq-3', 'rq-4', 'rq-1', 'rq-k2', 'rq-k9']) : new Set<string>();
  const keepBk = preset === 'lean' ? new Set(['bk-k2', 'bk-k9']) : new Set<string>();
  copy.requests = copy.requests.filter((r) => keepReq.has(r.id));
  copy.approvals = copy.approvals.filter((a) => keepReq.has(a.requestId));
  copy.bookings = copy.bookings.filter((b) => keepBk.has(b.id));
  copy.transactions = copy.transactions.filter((t) => !t.bookingId || keepBk.has(t.bookingId) || (t.requestId && keepReq.has(t.requestId)));
  copy.refunds = copy.refunds.filter((x) => keepBk.has(x.bookingId));
  copy.deductions = copy.deductions.filter((x) => keepBk.has(x.bookingId));
  copy.proposals = copy.proposals.filter((x) => keepBk.has(x.bookingId));
  copy.delays = copy.delays.filter((x) => keepBk.has(x.bookingId));
  copy.materials = copy.materials.filter((x) => keepBk.has(x.bookingId));
  copy.additionalWorks = copy.additionalWorks.filter((x) => keepBk.has(x.bookingId));
  copy.statements = copy.statements.filter((x) => keepBk.has(x.bookingId));
  copy.reviews = copy.reviews.filter((x) => keepBk.has(x.bookingId));
  return copy;
}
