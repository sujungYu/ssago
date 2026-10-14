/**
 * 요청·예약의 사용자 표시 상태와 할 일(spec 5.17·5.18). 내부 업무 상태(RequestStatus·Booking.status·workStatus·정산 상태)·탭 분류·결제 조건은
 * 그대로 두고, 목록·필터·상세 배지가 같은 이름과 같은 ‘할 일’ 기준을 쓰도록 여기 한 곳에서 매핑한다.
 *
 * - 대표 상태 색: 진행(progress) = 연한 블루, 종료(ended) = 연한 회색, 이용 완료(done) = 연한 그린,
 *   결제 필요(payment: 예약금 결제·최종 정산) = 연한 주황, 업체 거절(rejected) = 연한 빨강(2026-10-14, spec 5.45).
 * - 할 일(actions): 고객이 지금 처리해야 할 미처리 행동만. 업체 검토·업체 응답 대기(희망 일정 전달 후 등)·결제·환불 결과 대기·금액 협의 중에는 없다.
 *   목록 카드 하단에 중요한 행동 한 줄(+ ‘외 N건’)을 보여주고, 상세 상단 확인 카드에서 모든 행동을 처리한다.
 */
import type { Booking, RequestStatus, StatementStatus } from './types';

export type DisplayTone = 'progress' | 'ended' | 'done' | 'payment' | 'rejected';

/** 고객 할 일 종류(중요한 순서 = ACTION_ORDER) */
export type ActionKind = 'deposit' | 'supplement' | 'delay' | 'schedule' | 'additional' | 'material' | 'final_statement';
export const ACTION_TEXT: Record<ActionKind, string> = {
  deposit: '예약금을 결제해 주세요',
  supplement: '요청서를 보완해 주세요',
  delay: '방문 지연 대응을 선택해 주세요',
  schedule: '새 일정을 확인해 주세요',
  additional: '추가 작업을 확인해 주세요',
  material: '자재 주문 조건을 확인해 주세요',
  final_statement: '최종 금액을 확인해 주세요',
};
/** 한 건에 여러 할 일이 있으면 이 순서로 먼저 보여준다(방문 당일 지연 → 일정 → 작업 중 동의 → 정산) */
const ACTION_ORDER: ActionKind[] = ['deposit', 'supplement', 'delay', 'schedule', 'additional', 'material', 'final_statement'];
const sortActions = (a: ActionKind[]): ActionKind[] => [...new Set(a)].sort((x, y) => ACTION_ORDER.indexOf(x) - ACTION_ORDER.indexOf(y));

export interface StatusDisplay {
  label: string;
  tone: DisplayTone;
  /** 미처리 할 일(중요한 순). 비어 있으면 목록에 행동 영역을 두지 않는다 */
  actions: ActionKind[];
}

/** 목록 카드 행동 문구: 중요한 행동 하나 + ‘외 N건’ */
export function actionSummary(actions: ActionKind[]): string | null {
  if (!actions.length) return null;
  return ACTION_TEXT[actions[0]] + (actions.length > 1 ? ` 외 ${actions.length - 1}건` : '');
}

// ───────── 보낸 요청 ─────────
/** 보낸 요청 대표 상태(업무 상태 → 표시). 추가 정보 필요도 ‘업체 검토 중’(할 일: 요청서 보완) */
const REQUEST_DISPLAY_WITHDRAWN = '요청 취소';
export const REQUEST_DISPLAY: Record<RequestStatus, { label: string; tone: DisplayTone }> = {
  reviewing: { label: '업체 검토 중', tone: 'progress' },
  needs_info: { label: '업체 검토 중', tone: 'progress' },
  approved_pending_payment: { label: '예약금 결제', tone: 'payment' },
  rejected: { label: '업체 거절', tone: 'rejected' },
  withdrawn: { label: REQUEST_DISPLAY_WITHDRAWN, tone: 'ended' },
  approval_expired: { label: '결제 기한 만료', tone: 'ended' },
  closed_other_booking: { label: '다른 업체 예약으로 종료', tone: 'ended' },
  booked: { label: '예약 완료', tone: 'done' },
};

/**
 * 보낸 요청의 할 일: 요청서 보완(needs_info), 예약금 결제(결제 대기 — 조건이 바뀌었으면 상세에서 새 조건 동의 후 결제).
 * 예약금 결제가 처리 중·결과 확인 중이면 기다리는 중이라 없다.
 */
export function requestActions(status: RequestStatus, opts: { paymentInFlight?: boolean } = {}): ActionKind[] {
  if (status === 'needs_info') return ['supplement'];
  if (status === 'approved_pending_payment' && !opts.paymentInFlight) return ['deposit'];
  return [];
}

/** 목록 항목(요청 + 마지막 예약금 결제 시도)의 할 일. 카드 행동 문구와 ‘확인 필요’ 필터가 이 함수를 함께 쓴다 */
export function requestItemActions(i: { request: { status: RequestStatus }; depositAttempt?: 'failed' | 'processing' | 'unknown' }): ActionKind[] {
  return requestActions(i.request.status, { paymentInFlight: i.depositAttempt === 'processing' || i.depositAttempt === 'unknown' });
}

export function requestDisplay(status: RequestStatus, opts: { paymentInFlight?: boolean } = {}): StatusDisplay {
  return { ...REQUEST_DISPLAY[status], actions: requestActions(status, opts) };
}

// ───────── 예약 ─────────
/** 고객이 지금 해야 할 미처리 행동(실제 데이터에서 계산 — mockRepository.pendingActionsOf·shared.pendingActionsOfDetail) */
export type PendingAction = 'proposal' | 'material' | 'additional' | 'delay' | 'final_statement';
const PENDING_TO_ACTION: Record<PendingAction, ActionKind> = {
  proposal: 'schedule', material: 'material', additional: 'additional', delay: 'delay', final_statement: 'final_statement',
};

/**
 * 확정된 예약 대표 상태 그룹 = 카드 배지 = ‘예약 상태’ 필터 값(이름도 같다).
 * ‘settlement_waiting’은 이전 주소 호환을 위해 값 이름을 유지하고 ‘정산 진행 중’으로 보인다.
 * ‘rescheduling’(일정 조율 중) = 방문 예정이던 예약의 기존 일정에 업체가 방문할 수 없고 새 일정이 아직 확정되지 않음.
 */
export type ActiveGroup = 'scheduled' | 'rescheduling' | 'in_progress' | 'final_confirm' | 'settlement_waiting';
export const ACTIVE_GROUP_LABEL: Record<ActiveGroup, string> = {
  scheduled: '방문 예정', rescheduling: '일정 조율 중', in_progress: '작업 중', final_confirm: '최종 정산', settlement_waiting: '정산 진행 중',
};

export interface BookingDisplayInput {
  booking: Pick<Booking, 'status' | 'workStatus' | 'followUp'>;
  /** 일정 변경 상태(scheduleStateOf). 기존 일정 방문 불가·새 일정 미확정이면 방문 예정처럼 보이지 않게 한다 */
  schedule?: { oldVisitUnavailable: boolean };
  statementStatus?: StatementStatus;
  /** 최종 잔금 결제가 처리 중·결과 확인 중 */
  balanceInFlight?: boolean;
  pendingActions: PendingAction[];
}

/**
 * 확정된 예약 탭의 대표 상태 그룹. 취소·이용 완료(완료·취소 탭)는 null.
 * - 방문 예정이지만 기존 일정 방문 불가·새 일정 미확정: ‘일정 조율 중’
 * - 후속 방문 대기: 후속 방문 일정이 확정됐으면 ‘방문 예정’, 아니면 ‘작업 중’
 * - 최종 금액 확인 대기: 금액 이견(협의 중)·잔금 결제 결과 확인 중이면 ‘정산 진행 중’, 아니면 ‘최종 정산’(협의로 금액이 수정돼 다시 확인할 때 포함)
 * - 작업 중단 후 정산 대기: ‘정산 진행 중’
 * - 조건 재확인(terms_recheck)은 별도 대표 상태 없이 작업 상태로 보여준다
 */
export function activeGroupOf(i: Omit<BookingDisplayInput, 'pendingActions'>): ActiveGroup | null {
  const b = i.booking;
  if (b.status === 'cancelled' || b.workStatus === 'completed') return null;
  switch (b.workStatus) {
    case 'scheduled': return i.schedule?.oldVisitUnavailable ? 'rescheduling' : 'scheduled';
    case 'in_progress': return 'in_progress';
    case 'followup_waiting': return b.followUp ? 'scheduled' : 'in_progress';
    case 'final_confirm_waiting': return i.statementStatus === 'disputed' || i.balanceInFlight ? 'settlement_waiting' : 'final_confirm';
    case 'stopped_settlement_waiting': return 'settlement_waiting';
  }
}

/** 예약의 할 일(중요한 순). 취소된 예약은 없다 */
export const bookingActions = (i: Pick<BookingDisplayInput, 'booking' | 'pendingActions'>): ActionKind[] =>
  i.booking.status === 'cancelled' ? [] : sortActions(i.pendingActions.map((a) => PENDING_TO_ACTION[a]));

/** ‘확인 필요’ 필터 기준 = 카드 행동 문구와 같은 판단 */
export const bookingHasTodo = (i: Pick<BookingDisplayInput, 'booking' | 'pendingActions'>): boolean => bookingActions(i).length > 0;

/** 완료·취소 탭 대표 상태 = 카드 배지 = 완료·취소 상태 필터 값 */
/** 요청 취소(request_cancelled) = 예약 확정 전 고객이 취소한 요청(withdrawn), 예약 취소(cancelled) = 확정 후 취소된 예약(spec 5.47) */
export type PastGroup = 'completed' | 'request_cancelled' | 'cancelled';
export const PAST_GROUP_LABEL: Record<PastGroup, string> = { completed: '이용 완료', request_cancelled: REQUEST_DISPLAY_WITHDRAWN, cancelled: '예약 취소' };

export interface BookingDisplay extends StatusDisplay {
  group: ActiveGroup | null;
  /** 기존 일정 방문 불가 · 새 일정 미확정(날짜 자리에 ‘방문 일정 조율 중’) */
  visitPending: boolean;
}

export function bookingDisplay(i: BookingDisplayInput): BookingDisplay {
  const b = i.booking;
  if (b.status === 'cancelled') return { label: PAST_GROUP_LABEL.cancelled, tone: 'ended', actions: [], group: null, visitPending: false };
  if (b.workStatus === 'completed') return { label: PAST_GROUP_LABEL.completed, tone: 'done', actions: [], group: null, visitPending: false };
  const group = activeGroupOf(i)!;
  return { label: ACTIVE_GROUP_LABEL[group], tone: group === 'final_confirm' ? 'payment' : 'progress', actions: bookingActions(i), group, visitPending: group === 'rescheduling' };
}

/** 대표 상태 색 → 배지 색 */
export const TONE_BADGE = { progress: 'info', ended: 'neutral', done: 'success', payment: 'payment', rejected: 'rejected' } as const;
