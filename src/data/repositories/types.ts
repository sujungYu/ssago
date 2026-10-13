/**
 * 데이터 접근 계약. 화면은 이 인터페이스만 사용하고 목업 데이터를 직접 참조하지 않는다.
 * 2차에서 Supabase 구현체가 같은 계약을 제공하면 UI 레이어를 다시 만들지 않고 공급자를 교체할 수 있다.
 * (실제 API 경로·DB 함수명이 아니다 — spec 7.1)
 *
 * 모든 상태 변경 메서드는 idempotencyKey를 받는다. 목업은 같은 키의 재호출에 기존 결과를 돌려주고,
 * 실제 구현은 서버에서 멱등성·권한·조건 버전·기한을 검증해야 한다. (에러 정책서 3, 5)
 */
import type { ScheduleState } from '../../domain/scheduleChange';
import type { SelectedTaskInput } from '../../domain/taskSelection';
import type { RequestListQuery } from '../../domain/requestFilter';
export type { RequestListQuery } from '../../domain/requestFilter';
import type { TripFeeBasis } from '../../domain/bookingCost';
import type { BookingListQuery, PendingAction } from '../../domain/bookingFilter';
export type { BookingListQuery, PendingAction } from '../../domain/bookingFilter';
import type {
  Address, AdditionalWork, SavedVisitAddress, VisitAddress, Approval, Booking, CancelCause, Category, ChangeProposal, CustomerContact, CustomerProfile, DelayChoice,
  DelayNotice, Deduction, FinalStatement, IsoDate, IsoDateTime, MaterialOffer, ProviderDetail, ProviderSummary,
  PublicGroup, Refund, RepairRequest, Review, TaskItem, TimeSlot, Transaction, Won,
} from '../../domain/types';
import type { CancelPreview, DateChangePreview, Settlement } from '../../domain/pricing';

export type Unsubscribe = () => void;

// ───────── 조회 조건 ─────────
export interface ProviderQuery {
  categoryId: string;
  /** 없으면 공동 예약 가능 여부를 단정하지 않는다(null) */
  addressId: string | null;
}

// ───────── 요청 ─────────
export interface NewRequestInput {
  providerId: string;
  groupId: string | null;
  newDateWish?: IsoDate;
  slots: TimeSlot[];
  /** 고른 업체 등록 작업(ID)과 작업별 설명·사진. 작업명은 저장소가 업체 등록 작업에서 요청 당시 이름으로 채운다 */
  tasks: SelectedTaskInput[];
  /** 방문 건물(기본 주소) — 정확한 주소 기준으로 공동 예약 참여 자격을 다시 확인한다 */
  addressId: string;
  /** 상세 주소(동·호수·층 등, 형식 자유, 단독주택은 비울 수 있음) */
  addressDetail: string;
  /** ‘다음 신청에도 이 주소 사용’. true면 제출 성공 시에만 재사용 주소를 이 주소로 바꾼다. false면 기존 저장 주소를 그대로 둔다 */
  saveAddressForNext: boolean;
  /** 이 요청의 이름·연락처(요청서에서 확인·수정한 값). 요청에 스냅숏으로 저장하며 내 정보는 바꾸지 않는다 */
  contact: CustomerContact;
  bundleId?: string;
  idempotencyKey: string;
}

export interface ProviderBrief { id: string; name: string; phone: string }

export interface RequestListItem {
  request: RepairRequest;
  provider: ProviderBrief;
  visitDate?: IsoDate;
  paymentDeadline?: IsoDateTime;
  depositAmount?: Won;
  /** 결제 대기 중 마지막 예약금 결제 시도의 상태(실패·처리 중·결과 확인 중). 성공하면 예약이 생겨 보낸 요청에서 빠진다 */
  depositAttempt?: 'failed' | 'processing' | 'unknown';
}

export interface BundleListItem {
  bundleId: string;
  taskTitles: string[];
  items: RequestListItem[];
  updatedAt: IsoDateTime;
}

export interface FilteredBundleListItem extends BundleListItem {
  /** 조건에 맞지 않아 목록에서 숨긴 같은 묶음의 업체별 요청 수(데이터는 그대로 있다) */
  hiddenItemCount: number;
}

/** 보낸 요청 조회 결과(예약으로 이어진 묶음 제외). hasAnyRequest로 ‘보낸 요청 자체 없음’과 ‘조건에 맞는 요청 없음’을 구분한다. */
export interface RequestListResult {
  /** 조건에 맞는 묶음(묶음 안에는 맞는 업체별 요청만). 요청 접수일 최신순 */
  bundles: FilteredBundleListItem[];
  /** 조건과 무관하게 이 사용자의 요청이 하나라도 있는지 */
  hasAnyRequest: boolean;
}

export interface RequestDetail {
  request: RepairRequest;
  provider: ProviderBrief;
  /** 제출 당시 방문 주소. null이면 이전 데이터라 확인 필요 */
  visitAddress: VisitAddress | null;
  group?: PublicGroup;
  groupClosed: boolean;
  approval?: Approval;
  now: IsoDateTime;
}

export interface BundleDetail {
  bundleId: string;
  tasks: TaskItem[];
  items: RequestDetail[];
  now: IsoDateTime;
}

export interface ApprovalView extends RequestDetail {
  approval: Approval;
  groupEnded: boolean;
  inFlightPayment?: Transaction;
}

// ───────── 결제 ─────────
export interface PaymentResult {
  tx: Transaction;
  bookingId?: string;
}

export interface TransactionDetail {
  tx: Transaction;
  providerName?: string;
  bookingId?: string;
  requestId?: string;
  /** 결제 대상 설명 */
  subject: string;
}

export type LedgerEntry =
  | { kind: 'payment'; id: string; at: IsoDateTime; tx: Transaction; subject: string; bookingId?: string; providerName?: string }
  | { kind: 'refund'; id: string; at: IsoDateTime; refund: Refund; subject: string; bookingId: string; providerName: string }
  | { kind: 'deduction'; id: string; at: IsoDateTime; deduction: Deduction; subject: string; bookingId: string; providerName: string };

// ───────── 예약 ─────────
export interface BookingListItem {
  booking: Booking;
  providerName: string;
  /** 예약 상세의 “지금 확인할 내용”에 해당하는 한 줄 요약 */
  attention: string | null;
  /** 고객이 해야 할 미처리 행동(실제 데이터 기준). ‘확인 필요만’ 필터에 쓴다 */
  pendingActions: PendingAction[];
  groupClosed: boolean;
  /** 마감 전 예상 / 마감 후 확정 출장비 */
  tripFee: { kind: 'expected' | 'confirmed' | 'locked'; amount: Won | null };
  /** 일정 변경 상태(목록·상세 공통 기준) */
  schedule: ScheduleState;
}

export interface BookingQueryResult {
  /** 조건에 맞는 예약(기존 정렬: 확인할 내용이 있는 예약 먼저, 그다음 방문일 최신순) */
  items: BookingListItem[];
  /** 조건과 무관하게 이 탭에 예약이 하나라도 있는지(‘예약 없음’과 ‘결과 없음’ 구분) */
  hasAnyInTab: boolean;
  /** 방문일이 없거나 잘못돼 날짜 조건에서 제외한 예약 수(추정하지 않음) */
  excludedMissingVisitDate: number;
}

export interface PrepaidSummary {
  depositPaid: Won;
  materialPrepaid: Won;
  changePaid: Won;
  refunded: Won;
  deducted: Won;
  available: Won;
}

export interface BookingDetail {
  booking: Booking;
  /** 이 예약의 원래 요청(최초 요청 내용·업체 응답 확인용). 비교 요청이면 묶음의 업체 수 */
  origin?: { requestId: string; bundleId: string; bundleSize: number };
  provider: ProviderDetail | (ProviderSummary & { phone: string; afterServiceTerms: string[] });
  /** 승인·확정된 방문 주소. null이면 확인 필요 */
  visitAddress: VisitAddress | null;
  group: PublicGroup;
  groupClosed: boolean;
  groupEnded: boolean;
  /** 내 출장비와 분담 기준(마감 후 = 마감 시 확정 세대 수) */
  tripFee: TripFeeBasis;
  approval?: Approval;
  prepaid: PrepaidSummary;
  delay?: DelayNotice;
  proposals: ChangeProposal[];
  materials: MaterialOffer[];
  additionalWorks: AdditionalWork[];
  statement?: FinalStatement;
  ledger: LedgerEntry[];
  review?: Review;
  /** 무료 취소가 적용되는 사유(지연 대기, 업체 사유 변경 제안 등) */
  freeCancel: { reason: string } | null;
  /** 일정 변경 상태(목록·상세 공통 기준, scheduleStateOf) */
  schedule: ScheduleState;
  now: IsoDateTime;
}

export interface CancelContext {
  cause: CancelCause;
  causeLabel: string;
  preview: CancelPreview;
  /** 이미 접수된 취소가 있으면 그 결과 */
  existing?: { refund?: Refund };
}

export interface ChangeOption {
  group: PublicGroup;
  preview: DateChangePreview;
}

export interface ChangeRequestInput {
  bookingId: string;
  kind: 'date' | 'time';
  targetGroupId?: string;
  newDateWish?: IsoDate;
  newSlot: TimeSlot;
  reason: string;
  /** 지연 대응에서 무료 변경을 선택한 경우 */
  delayId?: string;
  idempotencyKey: string;
}

export interface ProposalResult {
  proposal: ChangeProposal;
  tx?: Transaction;
  refund?: Refund;
  booking?: Booking;
}

export interface ProposalView {
  proposal: ChangeProposal;
  booking: Booking;
  providerName: string;
  groupClosed: boolean;
  preview: DateChangePreview | null;
  providerPhone: string;
  /** 업체 사유 무료 취소(제안 중이거나 거절한 뒤) 환불 미리보기 */
  cancelPreview: CancelPreview;
}

export interface MaterialView {
  offer: MaterialOffer;
  booking: Booking;
  providerName: string;
  tx?: Transaction;
}

export interface AdditionalView {
  work: AdditionalWork;
  booking: Booking;
  providerName: string;
}

export interface StatementView {
  statement: FinalStatement;
  booking: Booking;
  providerName: string;
  providerPhone: string;
  prepaid: PrepaidSummary;
  settlement: Settlement;
  inFlightPayment?: Transaction;
  refund?: Refund;
}

export interface StatementResult {
  statement: FinalStatement;
  settlement: Settlement;
  tx?: Transaction;
  refund?: Refund;
}

export interface ReviewContext {
  booking: Booking;
  providerName: string;
  eligible: boolean;
  existing?: Review;
}

export interface NoticeLanding {
  path: string;
  /** 알림 이후 상태가 바뀐 경우 안내 문구 (ERR-NOTI-02) */
  staleMessage?: string;
}

// ───────── 저장소 ─────────
export interface Repository {
  /** 데이터 변경 시 구독자에게 알림. 화면 재조회 신호로만 쓴다. */
  subscribe(listener: () => void): Unsubscribe;
  /** 현재 데이터 공급자에 따른 시계(목업은 고정 시계). 화면 표시용 */
  now(): IsoDateTime;

  // 탐색
  listCategories(): Promise<Category[]>;
  searchAddresses(keyword: string): Promise<Address[]>;
  /** 이 사용자가 마지막으로 저장한 탐색 지역·건물 주소(없으면 null). 재접속 시 기본값 */
  getExploreAddress(): Promise<Address | null>;
  /** 탐색 지역·건물 주소 저장. 기존 요청·예약 주소는 바꾸지 않는다 */
  setExploreAddress(addressId: string): Promise<Address>;
  /** 저장에 동의한 재사용 방문 주소(사용자당 최근 1개, 없으면 null) */
  getSavedVisitAddress(): Promise<SavedVisitAddress | null>;
  getAddress(id: string): Promise<Address>;
  listProviders(q: ProviderQuery): Promise<ProviderSummary[]>;
  getProvider(id: string, addressId: string | null): Promise<ProviderDetail>;
  /**
   * 그 날짜(KST)에 이 주소로 지금 신청할 수 있는 공동 예약 그룹(접수 중·마감 전·남은 자리 있음·주소 범위 안).
   * 주소가 없으면 빈 목록, 주소 판단이 불가하면 address_unavailable.
   */
  listJointGroups(providerId: string, addressId: string | null, date: IsoDate): Promise<PublicGroup[]>;

  // 요청
  createRequest(input: NewRequestInput): Promise<RepairRequest>;
  listRequests(): Promise<BundleListItem[]>;
  /**
   * 내 예약 > 보낸 요청: 예약으로 이어지지 않은 요청 묶음만(src/domain/reservationTabs.ts) 조건(요청 접수일 범위·상태)으로 조회한다.
   * 필터는 조회 조건일 뿐 데이터를 바꾸지 않는다.
   * 서버 구현은 페이지네이션이 생겨도 이 조건을 전체 조회에 적용해야 한다(로드된 항목만 거르지 않는다).
   */
  queryRequests(query: RequestListQuery): Promise<RequestListResult>;
  getRequest(id: string): Promise<RequestDetail>;
  getBundle(bundleId: string): Promise<BundleDetail>;
  supplementRequest(id: string, input: { message: string; photoNames: string[]; idempotencyKey: string }): Promise<RepairRequest>;
  withdrawRequest(id: string): Promise<RepairRequest>;

  // 승인·결제
  getApproval(requestId: string): Promise<ApprovalView>;
  simulateDepositPayment(input: { requestId: string; approvalVersion: number; consentedRecheck?: boolean; idempotencyKey: string }): Promise<PaymentResult>;
  getTransaction(txId: string): Promise<TransactionDetail>;
  /** 결제 재실행이 아니라 상태 조회. 처리 중·확인 중 결제의 최신 결과를 가져온다. */
  refreshPayment(txId: string): Promise<PaymentResult>;

  // 예약
  listBookings(): Promise<BookingListItem[]>;
  /**
   * 조건(탭·상태 그룹·방문일 범위·확인 필요)으로 내 예약을 조회한다. 필터는 조회 조건일 뿐 데이터를 바꾸지 않는다.
   * 서버 구현은 페이지네이션이 생겨도 이 조건을 전체 조회에 적용해야 한다.
   */
  queryBookings(query: BookingListQuery): Promise<BookingQueryResult>;
  getBooking(id: string): Promise<BookingDetail>;
  listChangeOptions(bookingId: string): Promise<ChangeOption[]>;
  requestChange(input: ChangeRequestInput): Promise<ChangeProposal>;
  getProposal(id: string): Promise<ProposalView>;
  respondToProposal(id: string, decision: 'accept' | 'reject', idempotencyKey: string): Promise<ProposalResult>;
  /** 기존 방문 불가 업체 제안(또는 협의 중 재제안)에 다른 일정(날짜 + 정확한 시각, 희망 일정)을 요청한다 */
  requestOtherSchedule(input: { proposalId: string; date: string; time: string; note?: string; idempotencyKey: string }): Promise<ChangeProposal>;
  withdrawProposal(id: string): Promise<ChangeProposal>;
  getCancelContext(bookingId: string): Promise<CancelContext>;
  cancelBooking(input: { bookingId: string; expectedRefund: Won; idempotencyKey: string }): Promise<{ booking: Booking; refund: Refund }>;
  respondToDelayWait(delayId: string): Promise<DelayNotice>;
  getDelay(delayId: string): Promise<{ delay: DelayNotice; booking: Booking; providerName: string; providerPhone: string }>;

  // 자재·추가 작업
  getMaterial(offerId: string): Promise<MaterialView>;
  agreeAndPayMaterial(offerId: string, idempotencyKey: string): Promise<PaymentResult>;
  getAdditionalWork(id: string): Promise<AdditionalView>;
  respondToAdditionalWork(id: string, decision: 'agree' | 'decline'): Promise<AdditionalWork>;

  // 최종 정산
  getFinalStatement(bookingId: string): Promise<StatementView>;
  confirmSettlement(input: { bookingId: string; statementVersion: number; idempotencyKey: string }): Promise<StatementResult>;
  reportDispute(bookingId: string): Promise<FinalStatement>;

  // 이용 후
  listLedger(): Promise<LedgerEntry[]>;
  getLedgerEntry(id: string): Promise<LedgerEntry>;
  getReviewContext(bookingId: string): Promise<ReviewContext>;
  createReview(input: { bookingId: string; rating: number; body: string; photoNames: string[]; idempotencyKey: string }): Promise<Review>;
  getProfile(): Promise<CustomerProfile>;
  /**
   * 내 정보 이름·연락처 수정(사용자별 데이터, 인증 아님). 이후 새 수리 요청서의 기본값이 된다.
   * 이미 제출된 요청·확정된 예약의 연락처 스냅숏은 바꾸지 않는다. 형식이 맞지 않으면 invalid, 저장하지 못하면 storage_failed(변경 없음).
   */
  updateProfile(input: CustomerContact): Promise<CustomerProfile>;

  // 알림 진입(S-02)
  resolveNotice(noticeId: string): Promise<NoticeLanding>;
}

export type { DelayChoice };
