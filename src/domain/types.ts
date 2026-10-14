/**
 * 도메인 타입. DB enum·테이블 확정이 아니라 화면 표시용 제안 상태다. (spec 4.3)
 * 금액은 모두 정수 원화(Won), 시각은 오프셋이 있는 ISO 문자열(+09:00), 날짜는 YYYY-MM-DD(Asia/Seoul).
 */
export type Won = number;
export type IsoDateTime = string;
export type IsoDate = string;

// ───────── 공통 ─────────
export interface Category {
  id: string;
  name: string;
}

/** 지역·건물(기본) 주소. 도로명·지번 + 건물명. 동·호수 같은 상세 주소는 포함하지 않는다. */
export interface Address {
  id: string; // 건물 식별자
  label: string; // 예: 햇살마을 3단지
  line1: string; // 도로명 또는 지번 주소 + 건물명(가상). 실제 주소 검색으로 고른 주소는 도로명주소(없으면 지번)만
  kind: 'apartment' | 'house';
  /**
   * 'postcode' = 실제 주소 검색(카카오 우편번호 서비스)으로 고른 주소. 업체·공동 예약은 데모 데이터에 연결될 뿐이며,
   * 실제 방문 가능 지역·동일 단지·반경 300m 조건은 검증하지 않았다(spec 5.32). 없으면 기존 가상 주소(시드 기록).
   */
  source?: 'postcode';
}

/** 요청·예약에 보존하는 방문 주소(제출 당시 스냅숏). 탐색 주소·재사용 주소를 참조하지 않는다. src/domain/address.ts */
export interface VisitAddress {
  addressId: string; // 건물 식별자 — 참여 자격(동일 단지·반경) 재확인용
  label: string;
  line1: string;
  kind: 'apartment' | 'house';
  /** 동·호수·층 등. 단독주택은 빈 문자열일 수 있다 */
  detail: string;
}

/** 고객이 ‘다음 신청에도 이 주소 사용’에 동의해 저장한 재사용 방문 주소(사용자당 최근 1개) */
export interface SavedVisitAddress {
  addressId: string;
  line1: string;
  detail: string;
  savedAt: IsoDateTime;
}

/** 고객 가능 시간 범위(요청서). 예: "09:00–12:00". 방문 시각이 아니다. */
export type TimeSlot = string;
/** 방문 시각(도착 예정, 한국 시간 HH:MM). 작업 소요 시간이 아니다. src/domain/visitTime.ts */
export type VisitTime = string;

// ───────── 업체·공동 날짜 ─────────
export interface ProviderSummary {
  id: string;
  name: string;
  categoryIds: string[];
  scope: string[]; // 작업 범위
  rating: number;
  reviewCount: number;
  soloTripFee: Won; // 새 날짜 요청 시 첫 예약 고객이 부담하는 그룹 총 출장비 기준(가정)
  area: string;
  /** 현재 선택 주소로 참여 가능한 열린 공동 날짜가 있는지. 주소 미확인이면 null(단정하지 않음) */
  jointAvailable: boolean | null;
  nextJoint?: { date: IsoDate; expectedFee: Won | null };
}

export interface ProviderReview {
  id: string;
  author: string; // 마스킹된 이름
  rating: number;
  body: string;
  createdAt: IsoDateTime;
  workLabel: string;
}

export interface ProviderDetail extends ProviderSummary {
  intro: string;
  phone: string; // 가상 번호
  afterServiceTerms: string[]; // 업체가 직접 제시하는 사후 조건(플랫폼 공통 보증 아님)
  reviews: ProviderReview[];
  groups: PublicGroup[]; // 현재 주소로 참여 가능한 열린 그룹만
  /** 현재 주소 기준 그룹 중 접수 마감 처리된 그룹의 날짜(오늘 이후). 새 요청 날짜 카드에서 ‘마감됐어요’ 안내용 */
  closedJointDates: IsoDate[];
  /** 새 요청 접수 기준. 없으면 새 요청 가능 날짜가 없다 */
  newRequest: NewRequestPolicy | null;
  /** 업체 등록 작업(표시 순서). 비어 있으면 요청서에서 작업을 고를 수 없다 */
  services: ProviderService[];
  /** 업체 소개(사진·소개글). 등록된 소개가 없으면 null */
  profile: ProviderProfile | null;
  /** 작업 사례(표시 순서). 없으면 빈 배열 */
  portfolio: PortfolioCase[];
}

/** 업체의 새 요청 접수 기준(공개 운영 정보). 판단은 domain/visitDays.ts. 없으면 새 요청을 받을 수 있는 날짜가 없다 */
export interface NewRequestPolicy {
  /** 새 요청을 받는 요일(0 = 일요일 ~ 6 = 토요일) */
  weekdays: number[];
  /** 운영 요일이어도 받지 않는 날(휴무일) */
  closedDates: IsoDate[];
  /** 희망 날짜로 고를 수 있는 마지막 날짜(포함) */
  lastDate: IsoDate;
}

/** 공개 가능한 집계 정보만 담는다. 타 고객 주소·기준 좌표·작업 내용·정확한 거리는 포함하지 않는다. */
export interface PublicGroup {
  id: string;
  providerId: string;
  date: IsoDate;
  slots: TimeSlot[];
  closeAt: IsoDateTime;
  totalTripFee: Won;
  capacity: number;
  confirmedHouseholds: number;
  pendingSeats: number; // 결제 대기 자리 — 수용 한도에는 포함, 분담 세대 수에는 불포함
  scopeType: 'complex' | 'radius';
}

// ───────── 요청 ─────────
export type RequestStatus =
  | 'reviewing'
  | 'needs_info'
  | 'approved_pending_payment'
  | 'rejected'
  | 'withdrawn'
  | 'approval_expired'
  | 'closed_other_booking'
  | 'booked';

/** 업체가 등록한 작업(요청서의 작업 선택 칩). 등록했다고 작업 가능 여부·가격이 확정되지 않는다(업체 검토·견적은 그대로). */
export interface ProviderService {
  id: string;
  name: string;
  /** 이 작업이 속한 카테고리(업체 소속 카테고리와 등록 작업이 맞는지 점검용). 이전 데이터에는 없을 수 있다 */
  categoryId?: string;
}

// ───────── 업체 소개·작업 사례(데모 콘텐츠) ─────────
/** 업체 소개·작업 사례 이미지. 목록·카드에는 src, 확대 보기에는 fullSrc(없으면 src — 벡터 이미지는 한 파일로 충분)를 쓴다 */
export interface ShowcaseImage {
  src: string;
  fullSrc?: string;
  /** 그림에 실제로 보이는 내용을 설명하는 대체 텍스트 */
  alt: string;
  /** 원본 크기(비율 유지·레이아웃 흔들림 방지용) */
  width: number;
  height: number;
}

/** 업체 소개: 소개 이미지 + 주로 하는 작업 설명 */
export interface ProviderProfile {
  photo: ShowcaseImage;
  /** 주로 제공하는 생활 수리를 설명하는 짧은 소개글 */
  about: string;
  /** true면 가상 업체의 데모 이미지(실제 업체·직원 사진 아님) — 화면에 ‘데모 이미지’로 표시한다 */
  demo: boolean;
}

/** 작업 사례 사진의 역할. 전·후는 같은 대상·같은 구도의 한 쌍으로만 쓰고, 쌍이 없으면 single 한 장으로 보여준다(가짜 전후 비교를 만들지 않음) */
export type PortfolioPhotoRole = 'before' | 'after' | 'single';
export interface PortfolioPhoto extends ShowcaseImage {
  role: PortfolioPhotoRole;
}

export interface PortfolioCase {
  id: string;
  /** 이 사례에 해당하는 업체 등록 작업 ID(업체가 등록하지 않은 작업의 사례는 두지 않는다) */
  serviceId: string;
  title: string;
  description: string;
  photos: PortfolioPhoto[];
  /** true면 실제 실적이 아닌 데모 사례 — 화면에 데모 안내를 함께 보여준다 */
  demo: boolean;
}

export interface TaskItem {
  id: string;
  /** 고른 업체 등록 작업 ID. 없으면 작업명을 직접 입력하던 이전 방식으로 만든 요청 */
  serviceId?: string;
  /** 작업명. 등록 작업을 고른 요청은 요청 당시 작업명을 그대로 보관한다(업체가 나중에 이름을 바꿔도 이 요청의 제목은 그대로) */
  title: string;
  description: string;
  photoNames: string[]; // 목업: 파일명만 보관
}

export interface InfoRequest {
  message: string;
  requestedAt: IsoDateTime;
  response?: { message: string; photoNames: string[]; respondedAt: IsoDateTime };
}

export interface RepairRequest {
  id: string;
  bundleId: string; // 같은 작업을 여러 업체에 요청한 비교 묶음(식별 방식 미정 — 목업 가정)
  providerId: string;
  groupId: string | null; // null = 새 날짜 요청
  newDateWish?: IsoDate;
  /** 고객 가능 시간(요청서에서 제출한 범위) */
  slots: TimeSlot[];
  tasks: TaskItem[];
  addressId: string; // 방문 건물 식별자(참여 자격 확인용)
  /** 제출 당시 방문 주소. 본인과 요청받은 업체만 확인. 없으면(이전 데이터) ‘방문 주소 확인 필요’ */
  visitAddress?: VisitAddress;
  /** 제출 당시 이름·연락처 스냅숏. 내 정보를 나중에 수정해도 바뀌지 않는다. 없으면(이전 데이터) 표시하지 않는다 */
  contact?: CustomerContact;
  status: RequestStatus;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  infoRequest?: InfoRequest;
  rejectionReason?: string;
  bookingId?: string;
}

export interface ApprovedTask {
  title: string;
  note: string;
  estimate: Won | null; // 업체 견적(작업비). 최종 금액이 아님
}

export interface Approval {
  id: string;
  requestId: string;
  version: number; // 조건 버전
  approvedAt: IsoDateTime;
  groupCloseAt: IsoDateTime;
  paymentDeadline: IsoDateTime; // min(승인+24h, 그룹 마감)
  visitDate: IsoDate;
  /**
   * 업체 제안 방문 시각. 고객 가능 시간(요청 slots) 안이어야 한다(proposedVisitTimeError).
   * 없으면 화면에 ‘방문 시각 확인 필요’로 표시하고 추정하지 않는다.
   */
  visitTime?: VisitTime;
  totalTripFee: Won;
  depositAmount: Won; // = 그룹 총 출장비
  tasks: ApprovedTask[];
  /** 부품·자재 예상 비용(최종 금액이 아님) */
  partsEstimate: Won;
  /** 업체 추가 할인 — 대상·금액/비율·중복 조건을 사전 표시 (POL-FEE-02). 없으면 undefined */
  discountNote?: string;
  materialNote?: string;
  cancellationTerms: string[];
  groupId: string;
  /** 기존 그룹이 종료되어 새 조건 재확인이 필요한 경우 */
  recheck?: Recheck;
}

export interface Recheck {
  endedGroupNote: string;
  newGroupId: string;
  newVisitDate: IsoDate;
  /** 새 조건의 업체 제안 방문 시각. 없으면 ‘방문 시각 확인 필요’ */
  newVisitTime?: VisitTime;
  newCloseAt: IsoDateTime;
  newTotalTripFee: Won;
  newDepositAmount: Won;
  consentedAt?: IsoDateTime;
}

// ───────── 예약·작업 ─────────
export type BookingStatus = 'confirmed' | 'cancelled' | 'terms_recheck';
export type WorkStatus =
  | 'scheduled'
  | 'in_progress'
  | 'followup_waiting'
  | 'final_confirm_waiting'
  | 'completed'
  | 'stopped_settlement_waiting';

export interface Booking {
  id: string;
  requestId: string;
  providerId: string;
  groupId: string;
  addressId: string;
  status: BookingStatus;
  workStatus: WorkStatus;
  visitDate: IsoDate;
  /** 예약 방문 시각(예약금 결제로 확정된 업체 제안 시각, 변경은 고객이 수락해야만 바뀐다). 없으면 ‘방문 시각 확인 필요’ */
  visitTime?: VisitTime;
  /** 참고용: 고객이 요청서에 제출한 가능 시간. 일정이 바뀌어도 수정하지 않는다 */
  customerSlots: TimeSlot[];
  /** 수락된 일정 변경 기록(기존 일정·새 일정·사유·고객 동의 시각) */
  scheduleChanges?: ScheduleChange[];
  /** 승인·확정된 방문 주소(요청에서 복사한 스냅숏). 없으면 ‘방문 주소 확인 필요’ */
  visitAddress?: VisitAddress;
  /** 확정된 예약의 이름·연락처(요청의 제출 당시 스냅숏을 복사). 내 정보 수정으로 바뀌지 않는다 */
  contact?: CustomerContact;
  tasks: TaskItem[];
  cancelledAt?: IsoDateTime;
  cancelCause?: CancelCause;
  /** 변경 수락 등으로 유지하기로 한 확정 출장비. 있으면 그룹 확정값보다 우선한다 (CHG-05) */
  lockedTripFee?: Won;
  /** 자재 도착 지연·오주문 등 무료 변경·취소가 적용되는 사유 (CHG-12) */
  freeCancelReason?: string;
  followUp?: { date: IsoDate; window: TimeSlot; note: string };
  createdAt: IsoDateTime;
}

export interface ScheduleChange {
  proposalId: string;
  from: { date: IsoDate; time?: VisitTime };
  to: { date: IsoDate; time?: VisitTime };
  reason: string;
  consentedAt: IsoDateTime;
}

export type CancelCause = 'customer' | 'provider' | 'policy_free';

/** 그룹 비공개 상세(목업 저장소 내부). 공개 화면으로 그대로 내보내지 않는다. */
export interface GroupRecord extends PublicGroup {
  closed: boolean;
  ended: boolean;
  finalPerHouseholdFee: Won | null; // 마감 시 확정된 세대별 출장비
  /** 마감 시 확정 세대 수(분담 기준). 마감 후 취소로 confirmedHouseholds(현재 참여 세대)가 줄어도 바뀌지 않는다 */
  finalHouseholds?: number | null;
  anchorKey: string; // 단지 ID 또는 최초 확정 예약지 기준 키 — 비공개
}

// ───────── 결제·환불 ─────────
export type PaymentStatus = 'pending' | 'processing' | 'success' | 'failed' | 'unknown';
export type TxKind = 'deposit' | 'material_prepay' | 'change_shortfall' | 'balance';

export interface Transaction {
  id: string;
  kind: TxKind;
  bookingId?: string;
  requestId?: string;
  materialOfferId?: string;
  proposalId?: string;
  amount: Won;
  status: PaymentStatus;
  idempotencyKey: string;
  createdAt: IsoDateTime;
  mock: true;
}

/**
 * 환불 처리 요청과 카드·계좌 실제 반영을 구분한다. (에러 정책 ERR-REF-01~04)
 * requested = 환불 처리 요청 접수, completed = 환불 처리 완료(실제 반영 시점은 결제수단에 따라 다름),
 * failed = 환불 처리 확인 중(취소는 유지), unknown = 환불 결과 확인 중. 실제 입금 완료로 표시하지 않는다.
 */
export type RefundStatus = 'requested' | 'completed' | 'failed' | 'unknown';
export interface Refund {
  id: string;
  bookingId: string;
  amount: Won;
  reason: string;
  /** cancel = 취소 환불, settlement = 최종 정산 차액 환불 */
  purpose: 'cancel' | 'settlement';
  status: RefundStatus;
  requestedAt: IsoDateTime;
  completedAt?: IsoDateTime;
}

export type DeductionKind = 'trip_fee' | 'material';
export interface Deduction {
  id: string;
  bookingId: string;
  kind: DeductionKind;
  amount: Won;
  label: string;
  createdAt: IsoDateTime;
}

// ───────── 변경·지연·자재·추가 작업 ─────────
export type ProposalStatus = 'requested' | 'proposed' | 'accepted' | 'rejected' | 'withdrawn';
export interface ChangeProposal {
  id: string;
  bookingId: string;
  origin: 'customer' | 'provider';
  status: ProposalStatus;
  /** 제안 시점의 예약 방문 일정 */
  oldVisit: { date: IsoDate; time?: VisitTime };
  /**
   * 새 방문 일정. time = 업체가 제안(동의)한 새 방문 시각. 고객 요청 단계(requested)에서는 비어 있고,
   * 고객이 원하는 가능 시간은 wishSlot에 둔다. 고객 가능 시간 밖이어도 되며, 고객이 수락해야만 예약에 반영된다.
   */
  newVisit: { date: IsoDate; time?: VisitTime; wishSlot?: TimeSlot; groupId?: string };
  reason: string;
  /** 지연·업체 사유 등 무료 변경이면 표시. 이 경우 변경 수수료 없이 기존 확정 출장비를 유지한다 */
  free?: 'delay' | 'provider';
  /** 비용 영향은 요청·제안 시점에 화면에 먼저 보여준다 */
  cost: { tripFeeCharged: Won; additionalDeposit: Won; note: string };
  createdAt: IsoDateTime;
  /**
   * 업체 제안: 업체가 기존 일정에도 방문할 수 있는지(업체가 제안할 때 지정). 없으면 ‘확인 필요’ — 사유 문장으로 추측하지 않는다.
   * 'no'면 기존 일정으로는 진행할 수 없어 고객은 새 일정 수락 또는 다른 일정 요청만 할 수 있다.
   */
  oldVisitAvailable?: 'yes' | 'no';
  /** 고객 응답 기록: 기존 방문이 불가능한 업체 제안에 ‘다른 일정 요청’으로 답했다(이 제안은 수락되지 않고 끝남) */
  customerReply?: 'other_requested';
  /** 고객의 다른 일정 요청이 어느 업체 제안에 대한 답인지(협의 이어짐) */
  replyTo?: string;
  /** 응답 시각(수락·거절·다른 일정 요청) */
  respondedAt?: IsoDateTime;
}

export type DelayChoice = 'wait' | 'free_change' | 'free_cancel';
export interface DelayNotice {
  id: string;
  bookingId: string;
  /** 지연 안내 시점의 예약 방문 일정. 지연 안내는 예약 방문 시각을 바꾸지 않는다 */
  originalDate: IsoDate;
  originalVisitTime?: VisitTime;
  /** 변경 도착 예상(당일). 예약 방문 시각과 별개 */
  newEta: IsoDateTime;
  status: 'open' | 'resolved';
  choice?: DelayChoice;
  respondedAt?: IsoDateTime;
}

export interface MaterialOffer {
  id: string;
  bookingId: string;
  name: string;
  spec: string;
  quantity: number;
  price: Won;
  deliveryDate: IsoDate;
  cancellationTerms: string;
  nonRefundableIfCancelled: Won; // 합의·증빙·적용 조건 충족 시 공제될 수 있는 회수 불가 비용
  agreedAt?: IsoDateTime;
  paymentTxId?: string;
  paymentStatus: 'none' | PaymentStatus;
  orderStatus: 'not_ordered' | 'ordered'; // 수납과 주문은 별개
}

export interface AdditionalWork {
  id: string;
  bookingId: string;
  reason: string;
  scope: string;
  amount: Won;
  followUp?: { date: IsoDate; window: TimeSlot };
  status: 'proposed' | 'agreed' | 'declined';
  respondedAt?: IsoDateTime;
}

// ───────── 정산 ─────────
export type StatementStatus = 'awaiting_customer' | 'disputed' | 'settled';
export type StatementItemKind = 'labor' | 'material' | 'additional' | 'trip_fee' | 'discount';
export interface StatementItem {
  kind: StatementItemKind;
  label: string;
  amount: Won; // 할인은 음수
}
export interface FinalStatement {
  id: string;
  bookingId: string;
  version: number;
  status: StatementStatus;
  actualWork: { title: string; done: boolean }[];
  items: StatementItem[];
  confirmedAt?: IsoDateTime;
  settledKind?: 'pay' | 'zero' | 'refund';
}

export interface Review {
  id: string;
  bookingId: string;
  providerId: string;
  rating: number;
  body: string;
  photoNames: string[];
  createdAt: IsoDateTime;
}

/** 고객 이름·연락처. 연락처는 숫자만(예: 01012345678). 인증된 정보가 아니다(데모는 가상 정보). src/domain/profile.ts */
export interface CustomerContact {
  name: string;
  phone: string;
}

/** 내 정보(현재 고객 정보). 새 수리 요청서의 이름·연락처 기본값이며, 이미 제출된 요청·예약의 연락처 스냅숏은 바꾸지 않는다. */
export interface CustomerProfile extends CustomerContact {
  id: string;
  /** 요약 표시용(가운데 4자리 가림) */
  phoneMasked: string;
}

/** 개발용 목업 알림. 알림함은 서비스 범위가 아니며, 알림 링크가 도착하는 화면(S-02)만 재현한다. */
export interface MockNotice {
  id: string;
  title: string;
  path: string;
  /** 알림 발송 시점의 대상 상태. 현재 상태와 다르면 최신 내용을 안내한다 (ERR-NOTI-02) */
  entity: { type: 'request' | 'booking' | 'delay' | 'proposal' | 'material' | 'additional' | 'statement'; id: string; state: string };
  createdAt: IsoDateTime;
}
