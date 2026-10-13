/** 상태·기한 규칙 순수 함수. (서비스 정책서 POL-REQ-05, POL-GRP-02) */
import { addHours, hoursBetween, latestCloseAt, toDate } from './time';
import type { Approval, GroupRecord, IsoDateTime, RepairRequest, RequestStatus } from './types';

/** 결제 기한 = min(승인 시각 + 24시간, 그룹 마감) */
export function paymentDeadline(approvedAt: IsoDateTime, groupCloseAt: IsoDateTime): IsoDateTime {
  const plus24 = addHours(approvedAt, 24);
  return toDate(plus24).getTime() <= toDate(groupCloseAt).getTime() ? plus24 : toDate(groupCloseAt).toISOString();
}

/** 업체 승인은 그룹 마감 1시간 전까지 가능하다. */
export function canApproveAt(nowIso: IsoDateTime, groupCloseAt: IsoDateTime): boolean {
  return hoursBetween(nowIso, groupCloseAt) >= 1;
}

/** 마감은 방문 전날 18:00 이내여야 한다. */
export function isValidCloseAt(closeAt: IsoDateTime, visitYmd: string): boolean {
  return toDate(closeAt).getTime() <= toDate(latestCloseAt(visitYmd)).getTime();
}

/** 접수 가능 여부: 확정 + 결제 대기 자리가 수용 한도에 도달하면 접수 조기 종료(마감 시각은 유지). */
export function seatsLeft(g: Pick<GroupRecord, 'capacity' | 'confirmedHouseholds' | 'pendingSeats'>): number {
  return Math.max(0, g.capacity - g.confirmedHouseholds - g.pendingSeats);
}

export type PayBlock =
  | 'expired' | 'closed' | 'recheck_required' | 'request_ended' | 'booked' | 'version_changed' | 'in_progress';

export interface PayCheckInput {
  request: Pick<RepairRequest, 'status'>;
  approval: Pick<Approval, 'version' | 'paymentDeadline' | 'recheck'>;
  groupClosed: boolean;
  groupEnded: boolean;
  /** 사용자가 화면에서 확인한 조건 버전 */
  confirmedVersion: number;
  hasInFlightPayment: boolean;
}

/** 결제 가능 여부. 정책 경계(마감과 같은 시각 등)는 미정이므로 서버 시계 비교 대신 상태 플래그를 우선한다. */
export function checkPayable(i: PayCheckInput): { ok: true } | { ok: false; reason: PayBlock } {
  if (i.request.status === 'booked') return { ok: false, reason: 'booked' };
  if (i.request.status === 'approval_expired') return { ok: false, reason: 'expired' };
  if (['rejected', 'withdrawn', 'closed_other_booking'].includes(i.request.status))
    return { ok: false, reason: 'request_ended' };
  if (i.request.status !== 'approved_pending_payment') return { ok: false, reason: 'request_ended' };
  if (i.approval.recheck || i.groupEnded) return { ok: false, reason: 'recheck_required' };
  if (i.groupClosed) return { ok: false, reason: 'closed' };
  if (i.confirmedVersion !== i.approval.version) return { ok: false, reason: 'version_changed' };
  if (i.hasInFlightPayment) return { ok: false, reason: 'in_progress' };
  return { ok: true };
}

// ───────── 상태 라벨 ─────────
export type Tone = 'neutral' | 'info' | 'action' | 'success' | 'warn' | 'danger';

export const REQUEST_STATUS: Record<RequestStatus, { label: string; tone: Tone; hint: string }> = {
  reviewing: { label: '업체 검토 중', tone: 'info', hint: '업체가 요청을 검토하고 있어요. 아직 예약이 확정된 것은 아니에요.' },
  needs_info: { label: '추가 정보 필요', tone: 'action', hint: '업체가 확인하고 싶은 내용이 있어요. 요청서를 보완해 주세요.' },
  approved_pending_payment: { label: '예약금 결제 대기', tone: 'action', hint: '업체가 요청을 승인했어요. 예약금을 결제하면 예약이 확정돼요.' },
  rejected: { label: '업체 거절', tone: 'danger', hint: '업체가 이번 요청을 수행하기 어렵다고 답했어요.' },
  withdrawn: { label: '철회', tone: 'neutral', hint: '직접 철회한 요청이에요. 취소수수료는 없어요.' },
  approval_expired: { label: '승인 만료', tone: 'warn', hint: '결제 기한이 지나 예약이 확정되지 않았어요. 취소수수료는 없어요.' },
  closed_other_booking: { label: '다른 업체 예약으로 종료', tone: 'neutral', hint: '같은 작업으로 다른 업체 예약이 확정되어 종료됐어요.' },
  booked: { label: '예약 완료', tone: 'success', hint: '예약금 결제로 요청 과정이 끝났어요. 일정·작업·정산은 내 예약에서 관리해요.' },
};

/** 요청 목록에서 사용자가 먼저 봐야 하는 순서 */
export const REQUEST_PRIORITY: RequestStatus[] = [
  'approved_pending_payment', 'needs_info', 'reviewing', 'booked', 'approval_expired', 'rejected', 'closed_other_booking', 'withdrawn',
];
