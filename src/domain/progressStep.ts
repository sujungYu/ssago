/**
 * 진행 단계(안내용). 기존 업무 상태를 단계로 옮겨 보여줄 뿐, 상태를 바꾸거나 단계를 건너뛰는 기능은 없다.
 * 화면은 단계 숫자를 직접 정하지 않고 이 매핑을 쓴다(상태와 표시가 어긋나지 않게). 두 과정을 나눈다.
 *
 * 보낸 요청(request): 1 수리 요청 · 2 업체 검토·견적 · 3 예약금 결제
 *   - 요청서 작성 = 1, reviewing·needs_info = 2, approved_pending_payment(조건 재확인 포함) = 3
 *   - 예약금 결제 실패·처리 중·결과 확인 중도 3. booked(예약 완료)는 요청 과정 완료 → 진행 표시 대신 완료 요약
 *   - 거절·철회·승인 만료·다른 업체 예약으로 종료 → 진행 표시 대신 기존 종료 상태·사유
 * 내 예약(booking): 1 예약 확정 · 2 방문·작업 · 3 최종 정산
 *   - workStatus scheduled = 1(조건 재확인 필요 예약도 1 + 안내), in_progress·followup_waiting = 2,
 *     final_confirm_waiting = 3, completed = 모든 단계 완료 + ‘이용 완료’
 *   - 취소(status cancelled)·작업 중단 후 정산 대기(stopped_settlement_waiting) → 진행 표시 대신 기존 종료 사유·처리 상태
 *   - 날짜 경과로 작업 시작·완료를 추정하지 않는다(업무 상태만 사용)
 * 예약금 결제 성공과 예약 생성이 확인되면 요청 과정이 끝나고 예약 과정 1단계가 된다.
 */
import type { Booking, PaymentStatus, RequestStatus, TxKind } from './types';

export type Flow = 'request' | 'booking';
export interface StepDef { no: number; label: string; short: string }

export const FLOW_STEPS: Record<Flow, StepDef[]> = {
  request: [
    { no: 1, label: '수리 요청', short: '요청' },
    { no: 2, label: '업체 검토·견적', short: '검토·견적' },
    { no: 3, label: '예약금 결제', short: '결제' },
  ],
  booking: [
    { no: 1, label: '예약 확정', short: '확정' },
    { no: 2, label: '방문·작업', short: '방문·작업' },
    { no: 3, label: '최종 정산', short: '정산' },
  ],
};
export const FLOW_LABEL: Record<Flow, string> = { request: '수리 요청 진행 단계', booking: '예약 진행 단계' };

export type ProgressNote =
  | 'reviewing' | 'needs_info' | 'payment_failed' | 'payment_checking' | 'booking_checking'
  | 'terms_recheck' | 'in_progress' | 'followup_waiting' | 'final_confirm' | 'used';

export const PROGRESS_NOTE_TEXT: Record<ProgressNote, string> = {
  reviewing: '업체가 작업 가능 여부와 견적을 확인하고 있어요.',
  needs_info: '업체가 추가 정보를 요청했어요. 보완하면 다시 검토해요.',
  payment_failed: '예약금 결제가 완료되지 않았어요. 예약은 아직 확정되지 않았어요.',
  payment_checking: '예약금 결제 결과를 확인하고 있어요. 확인되면 예약이 확정돼요.',
  booking_checking: '결제는 완료됐고 예약 생성 결과를 확인하고 있어요. 다시 결제하지 마세요.',
  terms_recheck: '공동 예약 조건이 바뀌어 다시 확인이 필요해요.',
  in_progress: '업체가 방문해 작업을 진행하고 있어요.',
  followup_waiting: '후속 방문을 기다리고 있어요.',
  final_confirm: '작업이 모두 끝났어요. 최종 금액을 확인하고 정산해요.',
  used: '이용 완료 · 작업과 정산이 모두 끝났어요.',
};

/**
 * step: 그 단계가 현재(이전 단계는 완료) · complete: 모든 단계 완료(현재 단계 없음)
 * ended: 진행 표시 대신 기존 종료 상태·사유를 보여준다(그리지 않음)
 */
export type ProgressView =
  | { kind: 'step'; step: number; note?: ProgressNote }
  | { kind: 'complete'; note?: ProgressNote }
  | { kind: 'ended' };
export interface Progress { flow: Flow; view: ProgressView }

/** 보낸 요청 화면용: 요청 과정이 끝난(예약 완료) 경우 진행 표시를 그리지 않고 화면의 완료 요약을 쓴다 */
export const unlessComplete = (p: Progress): Progress | null => (p.view.kind === 'complete' ? null : p);

/** 요청서 작성 화면(아직 요청이 없음) */
export const FORM_PROGRESS: Progress = { flow: 'request', view: { kind: 'step', step: 1 } };

/** 개별 업체 요청 → 보낸 요청 과정. inFlight: 이 요청의 예약금 결제가 처리 중·결과 확인 중 */
export function progressOfRequest(status: RequestStatus, opts: { inFlight?: boolean } = {}): Progress {
  const v = (view: ProgressView): Progress => ({ flow: 'request', view });
  switch (status) {
    case 'reviewing': return v({ kind: 'step', step: 2, note: 'reviewing' });
    case 'needs_info': return v({ kind: 'step', step: 2, note: 'needs_info' });
    case 'approved_pending_payment': return v({ kind: 'step', step: 3, note: opts.inFlight ? 'payment_checking' : undefined });
    case 'booked': return v({ kind: 'complete' }); // 예약 완료: 요청 과정 끝(화면은 완료 요약을 보여준다)
    case 'rejected': case 'withdrawn': case 'approval_expired': case 'closed_other_booking': return v({ kind: 'ended' });
  }
}

/** 예약 → 내 예약 과정 */
export function progressOfBooking(b: Pick<Booking, 'status' | 'workStatus'>): Progress {
  const v = (view: ProgressView): Progress => ({ flow: 'booking', view });
  if (b.status === 'cancelled') return v({ kind: 'ended' });
  switch (b.workStatus) {
    case 'scheduled': return v({ kind: 'step', step: 1, note: b.status === 'terms_recheck' ? 'terms_recheck' : undefined });
    case 'in_progress': return v({ kind: 'step', step: 2, note: 'in_progress' });
    case 'followup_waiting': return v({ kind: 'step', step: 2, note: 'followup_waiting' });
    case 'final_confirm_waiting': return v({ kind: 'step', step: 3, note: 'final_confirm' });
    case 'completed': return v({ kind: 'complete', note: 'used' });
    case 'stopped_settlement_waiting': return v({ kind: 'ended' }); // 작업 중단: 정상 완료처럼 보이지 않게 기존 처리 상태로
  }
}

/**
 * 예약금 결제 거래 → 과정. 성공 + 예약 생성 확인 = 내 예약 1단계. 성공했지만 예약을 확인하지 못하면 보낸 요청 3단계 + 결과 확인 안내.
 * 실패·대기·처리 중·결과 확인 중 = 보낸 요청 3단계. 예약금이 아닌 결제(자재·변경·잔금)는 이 진행 표시와 무관(null).
 */
export function progressOfPayment(kind: TxKind, status: PaymentStatus, hasBooking: boolean): Progress | null {
  if (kind !== 'deposit') return null;
  if (status === 'success') return hasBooking ? { flow: 'booking', view: { kind: 'step', step: 1 } } : { flow: 'request', view: { kind: 'step', step: 3, note: 'booking_checking' } };
  if (status === 'failed') return { flow: 'request', view: { kind: 'step', step: 3, note: 'payment_failed' } };
  return { flow: 'request', view: { kind: 'step', step: 3, note: 'payment_checking' } };
}
