/**
 * 내 예약의 예약 탭(확정된 예약·완료·취소) 필터. 화면과 분리한 순수 함수. 조회 조건만 바꾸며 예약 상태·데이터를 바꾸지 않는다.
 * - 날짜 기준은 예약의 방문일(Booking.visitDate, 한국 날짜). 접수일·결제일·취소일이 아니다.
 *   일정 변경은 고객이 수락해야 visitDate가 바뀌고(제안 확인 대기 중에는 기존 날짜), 지연 안내는 바꾸지 않으며,
 *   취소 예약은 취소 직전 확정 방문일을 그대로 갖는다. 후속 방문(followUp)이 있어도 최초 방문일(visitDate)이 기준이다.
 * - 상태·방문일·확인 필요는 AND.
 */
import { addDaysYmd, customRangeError, formatYmdDots, isValidYmd } from './requestFilter';
import { seoulYmd } from './time';
import type { Booking, IsoDate, IsoDateTime } from './types';
import { bookingTabOf, type BookingTab } from './reservationTabs';
import { ACTIVE_GROUP_LABEL, PAST_GROUP_LABEL, activeGroupOf, bookingHasTodo, type ActiveGroup, type BookingDisplayInput, type PastGroup, type PendingAction } from './statusDisplay';

export type { BookingTab };
/** 확정된 예약/완료·취소 구분 — 탭 분류 공통 규칙(src/domain/reservationTabs.ts)을 그대로 쓴다 */
export const tabOf = bookingTabOf;

// ───────── 상태 그룹 ─────────
// 선택지 값·이름은 카드 대표 상태(src/domain/statusDisplay.ts)와 같다. 여러 내부 상태를 묶은 그룹은 같은 묶음으로 조회한다.
export type ActiveStatus = 'all' | ActiveGroup;
export type PastStatus = 'all' | PastGroup;

export const ACTIVE_STATUS_OPTIONS: { value: ActiveStatus; label: string; hint?: string }[] = [
  { value: 'all', label: '전체' },
  { value: 'scheduled', label: ACTIVE_GROUP_LABEL.scheduled, hint: '후속 방문 예정 포함' },
  { value: 'rescheduling', label: ACTIVE_GROUP_LABEL.rescheduling, hint: '업체가 기존 일정에 방문할 수 없어 새 일정을 정하는 중' },
  { value: 'in_progress', label: ACTIVE_GROUP_LABEL.in_progress },
  { value: 'final_confirm', label: ACTIVE_GROUP_LABEL.final_confirm },
  { value: 'settlement_waiting', label: ACTIVE_GROUP_LABEL.settlement_waiting, hint: '금액 협의·결제 결과 확인 포함' },
];
export const PAST_STATUS_OPTIONS: { value: PastStatus; label: string }[] = [
  { value: 'all', label: '전체' },
  { value: 'completed', label: PAST_GROUP_LABEL.completed },
  { value: 'request_cancelled', label: PAST_GROUP_LABEL.request_cancelled },
  { value: 'cancelled', label: PAST_GROUP_LABEL.cancelled },
];

/**
 * 확정된 예약 상태 그룹 = 카드 대표 상태와 같은 기준(src/domain/statusDisplay.ts activeGroupOf).
 * 기존 일정 방문 불가·새 일정 미확정 → 일정 조율 중, 후속 방문 일정 확정 → 방문 예정, 금액 이견·잔금 결제 결과 확인·작업 중단 후 정산 대기 → 정산 진행 중.
 * 조건 재확인 예약도 작업 상태로 분류한다.
 */
export const activeStatusOf = (i: Omit<BookingDisplayInput, 'pendingActions'>): Exclude<ActiveStatus, 'all'> | null => activeGroupOf(i);
/** 완료·취소 상태 그룹: 취소가 우선, 그다음 작업 완료(중단 후 정산 완료 포함) */
export function pastStatusOf(b: Pick<Booking, 'status' | 'workStatus'>): Exclude<PastStatus, 'all'> | null {
  if (b.status === 'cancelled') return 'cancelled';
  if (b.workStatus === 'completed') return 'completed';
  return null;
}

// ───────── 고객이 해야 할 행동(확인 필요) ─────────
/** 실제 미처리 데이터에서 계산한 고객 행동. 카드 문구·색상으로 추정하지 않는다(정의는 statusDisplay.ts). */
export type { PendingAction };

// ───────── 방문일 기간 ─────────
export type ActivePeriod = 'all' | 'today' | 'this_week' | 'custom';
export type PastPeriod = 'all' | '30d' | '90d' | 'custom';
export const ACTIVE_PERIOD_OPTIONS: { value: ActivePeriod; label: string }[] = [
  { value: 'all', label: '전체 기간' }, { value: 'today', label: '오늘' }, { value: 'this_week', label: '이번 주' }, { value: 'custom', label: '직접 선택' },
];
export const PAST_PERIOD_OPTIONS: { value: PastPeriod; label: string }[] = [
  { value: 'all', label: '전체 기간' }, { value: '30d', label: '최근 30일' }, { value: '90d', label: '최근 90일' }, { value: 'custom', label: '직접 선택' },
];

/** 이번 주(한국 날짜, 월요일~일요일) */
export function weekRange(today: IsoDate): { from: IsoDate; to: IsoDate } {
  const dow = new Date(`${today}T00:00:00Z`).getUTCDay(); // 0=일
  const from = addDaysYmd(today, -((dow + 6) % 7));
  return { from, to: addDaysYmd(from, 6) };
}

export interface ActiveFilter { status: ActiveStatus; period: ActivePeriod; from?: IsoDate; to?: IsoDate; actionOnly: boolean }
export interface PastFilter { status: PastStatus; period: PastPeriod; from?: IsoDate; to?: IsoDate }
export interface BookingsFilterState { tab: BookingTab; active: ActiveFilter; past: PastFilter }

export const DEFAULT_ACTIVE: ActiveFilter = { status: 'all', period: 'all', actionOnly: false };
export const DEFAULT_PAST: PastFilter = { status: 'all', period: 'all' };
export const DEFAULT_BOOKINGS_FILTER: BookingsFilterState = { tab: 'active', active: DEFAULT_ACTIVE, past: DEFAULT_PAST };

// ───────── 조회 조건(서버로 넘길 수 있는 형태) ─────────
export interface BookingListQuery {
  tab: BookingTab;
  /** 확정된 예약이면 ActiveStatus, 완료·취소면 PastStatus 그룹. 없으면 전체 */
  statusGroup?: Exclude<ActiveStatus | PastStatus, 'all'>;
  /** 방문일(한국 날짜) 포함 범위 */
  visitFrom?: IsoDate;
  visitTo?: IsoDate;
  /** 고객 행동이 필요한 예약만(확정된 예약 탭) */
  actionRequiredOnly?: boolean;
}

export function toBookingQuery(f: BookingsFilterState, nowIso: IsoDateTime): BookingListQuery {
  const today = seoulYmd(nowIso);
  const q: BookingListQuery = { tab: f.tab };
  if (f.tab === 'active') {
    const a = f.active;
    if (a.status !== 'all') q.statusGroup = a.status;
    if (a.period === 'today') { q.visitFrom = today; q.visitTo = today; }
    else if (a.period === 'this_week') { const w = weekRange(today); q.visitFrom = w.from; q.visitTo = w.to; }
    else if (a.period === 'custom' && a.from && a.to) { q.visitFrom = a.from; q.visitTo = a.to; }
    if (a.actionOnly) q.actionRequiredOnly = true;
  } else {
    const p = f.past;
    if (p.status !== 'all') q.statusGroup = p.status;
    const days = p.period === '30d' ? 30 : p.period === '90d' ? 90 : 0;
    if (days) { q.visitFrom = addDaysYmd(today, -(days - 1)); q.visitTo = today; }
    else if (p.period === 'custom' && p.from && p.to) { q.visitFrom = p.from; q.visitTo = p.to; }
  }
  return q;
}

type Filterable = { booking: Pick<Booking, 'status' | 'workStatus' | 'visitDate' | 'followUp'>; pendingActions: PendingAction[]; schedule?: BookingDisplayInput['schedule']; statementStatus?: BookingDisplayInput['statementStatus']; balanceInFlight?: boolean };

/**
 * 조건으로 거른다(원본·순서 유지). 방문일이 없거나 잘못된 예약은 추정하지 않고, 날짜 조건이 있을 때만 제외하며 그 수를 돌려준다.
 */
export function filterBookings<T extends Filterable>(items: T[], q: BookingListQuery): { items: T[]; excludedMissingVisitDate: number } {
  let excluded = 0;
  const out = items.filter((it) => {
    const b = it.booking;
    if (tabOf(b) !== q.tab) return false;
    if (q.statusGroup && (q.tab === 'active' ? activeStatusOf(it) : pastStatusOf(b)) !== q.statusGroup) return false;
    if (q.actionRequiredOnly && !bookingHasTodo(it)) return false;
    if (q.visitFrom || q.visitTo) {
      if (!isValidYmd(b.visitDate)) { excluded++; return false; }
      if (q.visitFrom && b.visitDate < q.visitFrom) return false;
      if (q.visitTo && b.visitDate > q.visitTo) return false;
    }
    return true;
  });
  return { items: out, excludedMissingVisitDate: excluded };
}

/**
 * 완료·취소 탭의 요청 취소(예약 확정 전 고객 취소, spec 5.47). 예약 필터와 같은 조회 조건을 쓴다.
 * - 상태: 전체·요청 취소일 때만 포함(이용 완료·예약 취소를 고르면 없음).
 * - 날짜: 이 탭의 날짜 기준은 확정 방문일인데 요청 취소에는 확정 방문일이 없다(희망일·승인 제안일은 확정 방문일이 아니고, 요청일·취소일로 대신하지 않음).
 *   그래서 날짜 조건이 있으면 제외하고 그 수를 돌려준다(‘전체 기간’에서는 보인다).
 */
export function filterCancelledRequests<T>(items: T[], q: BookingListQuery): { items: T[]; excludedNoVisitDate: number } {
  if (q.tab !== 'past') return { items: [], excludedNoVisitDate: 0 };
  if (q.statusGroup && q.statusGroup !== 'request_cancelled') return { items: [], excludedNoVisitDate: 0 };
  if (q.visitFrom || q.visitTo) return { items: [], excludedNoVisitDate: items.length };
  return { items, excludedNoVisitDate: 0 };
}

// ───────── 표시 ─────────
const rangeLabel = (from?: IsoDate, to?: IsoDate) => (from && to ? `${formatYmdDots(from)} ~ ${formatYmdDots(to)}` : '직접 선택');
export function activeStatusLabel(f: ActiveFilter): string | null {
  return f.status === 'all' ? null : ACTIVE_STATUS_OPTIONS.find((o) => o.value === f.status)!.label;
}
export function pastStatusLabel(f: PastFilter): string | null {
  return f.status === 'all' ? null : PAST_STATUS_OPTIONS.find((o) => o.value === f.status)!.label;
}
export function periodLabel(f: { period: string; from?: IsoDate; to?: IsoDate }, options: { value: string; label: string }[]): string | null {
  if (f.period === 'all') return null;
  if (f.period === 'custom') return rangeLabel(f.from, f.to);
  return options.find((o) => o.value === f.period)?.label ?? null;
}

// ───────── URL 쿼리(탭별 독립 키, 날짜·상태만) ─────────
export const BOOKING_FILTER_KEYS = ['tab', 'a_status', 'a_visit', 'a_from', 'a_to', 'a_action', 'p_status', 'p_visit', 'p_from', 'p_to'] as const;
const pick = <T extends string>(v: string | null, opts: { value: T }[], dflt: T): T => (opts.some((o) => o.value === v) ? (v as T) : dflt);
function parseRange<P extends string>(period: P, from: string | null, to: string | null): { period: P | 'all'; from?: IsoDate; to?: IsoDate } {
  if (period !== 'custom') return { period };
  return customRangeError(from ?? undefined, to ?? undefined) ? { period: 'all' } : { period, from: from!, to: to! };
}

/** 잘못된 값은 기본값으로 */
export function parseBookingsFilter(p: URLSearchParams): BookingsFilterState {
  const tab: BookingTab = p.get('tab') === 'past' ? 'past' : 'active';
  const aRange = parseRange(pick(p.get('a_visit'), ACTIVE_PERIOD_OPTIONS, 'all'), p.get('a_from'), p.get('a_to'));
  const pRange = parseRange(pick(p.get('p_visit'), PAST_PERIOD_OPTIONS, 'all'), p.get('p_from'), p.get('p_to'));
  return {
    tab,
    active: { status: pick(p.get('a_status'), ACTIVE_STATUS_OPTIONS, 'all'), ...aRange, actionOnly: p.get('a_action') === '1' } as ActiveFilter,
    past: { status: pick(p.get('p_status'), PAST_STATUS_OPTIONS, 'all'), ...pRange } as PastFilter,
  };
}
export function writeBookingsFilter(base: URLSearchParams, f: BookingsFilterState): URLSearchParams {
  const p = new URLSearchParams(base);
  for (const k of BOOKING_FILTER_KEYS) p.delete(k);
  if (f.tab === 'past') p.set('tab', 'past');
  const a = f.active, s = f.past;
  if (a.status !== 'all') p.set('a_status', a.status);
  if (a.period !== 'all') p.set('a_visit', a.period);
  if (a.period === 'custom' && a.from && a.to) { p.set('a_from', a.from); p.set('a_to', a.to); }
  if (a.actionOnly) p.set('a_action', '1');
  if (s.status !== 'all') p.set('p_status', s.status);
  if (s.period !== 'all') p.set('p_visit', s.period);
  if (s.period === 'custom' && s.from && s.to) { p.set('p_from', s.from); p.set('p_to', s.to); }
  return p;
}
export function hasBookingFilterParams(p: URLSearchParams): boolean {
  return BOOKING_FILTER_KEYS.some((k) => p.has(k));
}
/** 현재 탭 조건의 키(목록 위치 저장용) */
export function bookingFilterKey(f: BookingsFilterState): string {
  return writeBookingsFilter(new URLSearchParams(), f).toString();
}
