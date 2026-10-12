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
  icon: string;
}

export interface Address {
  id: string;
  label: string; // 예: 우리 집
  line1: string; // 가상 주소
  detail?: string; // 동·호수 — 본인 주소에서만 표시
  kind: 'apartment' | 'house';
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

export interface TaskItem {
  id: string;
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
  addressId: string;
  addressDetail: string; // 동·호수 등 상세 주소 — 본인과 요청받은 업체만 확인
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

export interface CustomerProfile {
  id: string;
  name: string;
  phoneMasked: string;
  addresses: Address[];
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
