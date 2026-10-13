/**
 * 예약 일정 변경 상태(spec 5.15). 예약 상세·내 예약 목록·진행 표시가 같은 기준을 쓴다.
 * 작업 진행 상태(workStatus)와 별개로, 변경 제안·응답 기록(proposals)과 현재 예약 방문 일정으로만 판단한다. 새 업무 상태는 없다.
 *
 * - 업체가 기존 일정에 방문할 수 없다고 한 제안(oldVisitAvailable = 'no')이 지금 예약 일정을 대상으로 하고, 아직 새 일정이 확정되지 않았으면
 *   ‘기존 일정 방문 불가’다. 예약·기존 날짜 기록은 그대로 두되, 기존 날짜로 정상 방문할 것처럼 표시하지 않는다.
 * - 새 일정은 고객이 수락했을 때만 확정된다(미응답·거절·날짜 경과로 자동 확정·완료·취소하지 않는다).
 */
import type { Booking, ChangeProposal } from './types';

export type OldVisitAvailability = 'yes' | 'no' | 'unknown';

export type ScheduleStateKind =
  /** 변경 없음·완료된 변경만 있음 */
  | 'normal'
  /** 업체 제안 응답 대기(기존 일정 방문 가능 여부 포함) */
  | 'provider_proposed'
  /** 고객 변경 요청 · 업체 응답 대기(기존 일정 유지) */
  | 'customer_requested'
  /** 고객 변경 요청에 업체가 동의(새 시각 제안) · 고객 확인 대기 */
  | 'customer_request_agreed'
  /** 기존 일정 방문 불가 · 고객이 다른 일정을 요청해 업체 응답 대기 */
  | 'negotiating'
  /** 기존 일정 방문 불가 · 진행 중인 제안·요청이 없음(협의 필요) */
  | 'unavailable_open';

export interface ScheduleState {
  kind: ScheduleStateKind;
  /** 응답·확인이 필요한 진행 중 제안(요청 포함) */
  open?: ChangeProposal;
  /** 기존(현재 예약) 일정에 업체가 방문할 수 있는지 */
  oldVisit: OldVisitAvailability;
  /** 기존 일정으로 진행할 수 없음(표시·무료 취소 기준) */
  oldVisitUnavailable: boolean;
  /** 화면 공통 문구(목록·상세·진행 표시). 변경이 없으면 null */
  label: string | null;
}

const isOpen = (p: ChangeProposal) => p.status === 'requested' || p.status === 'proposed';
const sameVisit = (b: Pick<Booking, 'visitDate' | 'visitTime'>, v: { date: string; time?: string }) => v.date === b.visitDate && (v.time ?? null) === (b.visitTime ?? null);

export const availabilityOf = (p: ChangeProposal): OldVisitAvailability => (p.origin !== 'provider' ? 'yes' : p.oldVisitAvailable ?? 'unknown');

/** 이 예약의 일정 변경 상태 */
export function scheduleStateOf(b: Pick<Booking, 'id' | 'status' | 'visitDate' | 'visitTime'>, proposals: ChangeProposal[]): ScheduleState {
  const mine = proposals.filter((p) => p.bookingId === b.id);
  if (b.status === 'cancelled') return { kind: 'normal', oldVisit: 'yes', oldVisitUnavailable: false, label: null };
  const open = [...mine].reverse().find(isOpen);
  // 지금 예약 일정을 대상으로 한 ‘기존 방문 불가’ 업체 제안(수락되지 않음)이 있으면 기존 일정으로 진행할 수 없다
  const unavailable = mine.some((p) => p.origin === 'provider' && p.oldVisitAvailable === 'no' && p.status !== 'accepted' && p.status !== 'withdrawn' && sameVisit(b, p.oldVisit));
  if (open?.origin === 'provider' && open.status === 'proposed') {
    const av = availabilityOf(open);
    return {
      kind: 'provider_proposed', open, oldVisit: av, oldVisitUnavailable: av === 'no',
      label: av === 'no' ? '기존 일정 방문 불가 · 새 일정 확인 필요' : av === 'unknown' ? '일정 변경 제안 · 기존 일정 방문 가능 여부 확인 필요' : '일정 변경 제안 · 기존 일정 유지',
    };
  }
  if (open && open.origin === 'customer') {
    if (unavailable || open.replyTo) {
      return open.status === 'requested'
        ? { kind: 'negotiating', open, oldVisit: 'no', oldVisitUnavailable: true, label: '기존 일정 방문 불가 · 새 일정 협의 중' }
        : { kind: 'provider_proposed', open, oldVisit: 'no', oldVisitUnavailable: true, label: '기존 일정 방문 불가 · 새 일정 확인 필요' };
    }
    return open.status === 'requested'
      ? { kind: 'customer_requested', open, oldVisit: 'yes', oldVisitUnavailable: false, label: '일정 변경 요청 · 업체 응답 대기' }
      : { kind: 'customer_request_agreed', open, oldVisit: 'yes', oldVisitUnavailable: false, label: '일정 변경 동의 · 확인 필요' };
  }
  if (unavailable) return { kind: 'unavailable_open', oldVisit: 'no', oldVisitUnavailable: true, label: '기존 일정 방문 불가 · 새 일정 협의 필요' };
  return { kind: 'normal', oldVisit: 'yes', oldVisitUnavailable: false, label: null };
}

/** 응답 가능한 제안인지: 진행 중이고 이 예약의 가장 최근 진행 중 제안(이전 제안은 응답 불가) */
export function isLatestOpen(p: ChangeProposal, proposals: ChangeProposal[]): boolean {
  if (!isOpen(p)) return false;
  const latest = [...proposals].reverse().find((x) => x.bookingId === p.bookingId && isOpen(x));
  return latest?.id === p.id;
}

/** ‘다른 일정 요청’이 가능한 제안: 기존 방문 불가(또는 확인 필요) 업체 제안, 또는 그 협의에서 업체가 다시 제안한 일정 */
export const canRequestOther = (p: ChangeProposal): boolean =>
  p.status === 'proposed' && ((p.origin === 'provider' && availabilityOf(p) !== 'yes') || (p.origin === 'customer' && !!p.replyTo));

/** ‘거절(기존 일정 유지)’이 가능한 제안: 기존 일정에도 방문 가능한 경우만 */
export const canRejectKeepingOld = (p: ChangeProposal): boolean =>
  p.status === 'proposed' && !canRequestOther(p);
