import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BOOKINGS_FILTER, activeStatusOf, filterBookings, parseBookingsFilter, pastStatusOf, periodLabel, tabOf, toBookingQuery, weekRange,
  writeBookingsFilter, ACTIVE_PERIOD_OPTIONS, type BookingsFilterState, type PendingAction,
} from './bookingFilter';
import type { Booking } from './types';

const NOW = '2026-10-13T19:00:00+09:00'; // 화요일
const bk = (id: string, status: Booking['status'], workStatus: Booking['workStatus'], visitDate: string, pendingActions: PendingAction[] = []) =>
  ({ id, booking: { status, workStatus, visitDate }, pendingActions });
const f = (p: Partial<BookingsFilterState> & { a?: Partial<BookingsFilterState['active']>; s?: Partial<BookingsFilterState['past']> } = {}): BookingsFilterState => ({
  tab: p.tab ?? 'active', active: { ...DEFAULT_BOOKINGS_FILTER.active, ...p.a }, past: { ...DEFAULT_BOOKINGS_FILTER.past, ...p.s },
});
const items = [
  bk('sched-today', 'confirmed', 'scheduled', '2026-10-13', ['delay']),
  bk('sched-sun', 'confirmed', 'scheduled', '2026-10-18'),
  bk('sched-next-mon', 'confirmed', 'scheduled', '2026-10-19', ['proposal']),
  bk('working', 'confirmed', 'in_progress', '2026-10-14', ['additional']),
  bk('followup', 'confirmed', 'followup_waiting', '2026-10-14'),
  bk('final', 'confirmed', 'final_confirm_waiting', '2026-10-09', ['final_statement']),
  bk('stopped', 'confirmed', 'stopped_settlement_waiting', '2026-10-09'),
  bk('recheck', 'terms_recheck', 'scheduled', '2026-10-15', ['terms_recheck']),
  bk('done', 'confirmed', 'completed', '2026-09-20'),
  bk('done-old', 'confirmed', 'completed', '2026-07-01'),
  bk('cancel', 'cancelled', 'scheduled', '2026-10-14'),
  bk('cancel-after-work', 'cancelled', 'in_progress', '2026-10-01'),
  bk('no-date', 'confirmed', 'scheduled', ''),
];
const ids = (state: BookingsFilterState) => filterBookings(items, toBookingQuery(state, NOW)).items.map((x) => x.id);

describe('탭·상태 매핑', () => {
  it('취소 또는 작업 완료면 이용 내역, 나머지는 진행 중', () => {
    expect(items.filter((x) => tabOf(x.booking) === 'past').map((x) => x.id)).toEqual(['done', 'done-old', 'cancel', 'cancel-after-work']);
  });
  it('진행 중 그룹: 후속 방문 대기는 작업 중, 조건 재확인은 그룹 없음(전체에만)', () => {
    expect(activeStatusOf({ status: 'confirmed', workStatus: 'followup_waiting' })).toBe('in_progress');
    expect(activeStatusOf({ status: 'confirmed', workStatus: 'stopped_settlement_waiting' })).toBe('settlement_waiting');
    expect(activeStatusOf({ status: 'terms_recheck', workStatus: 'scheduled' })).toBeNull();
    expect(ids(f())).toContain('recheck');
    for (const s of ['scheduled', 'in_progress', 'final_confirm', 'settlement_waiting'] as const) expect(ids(f({ a: { status: s } }))).not.toContain('recheck');
  });
  it('각 진행 중 상태', () => {
    expect(ids(f({ a: { status: 'scheduled' } }))).toEqual(['sched-today', 'sched-sun', 'sched-next-mon', 'no-date']);
    expect(ids(f({ a: { status: 'in_progress' } }))).toEqual(['working', 'followup']);
    expect(ids(f({ a: { status: 'final_confirm' } }))).toEqual(['final']);
    expect(ids(f({ a: { status: 'settlement_waiting' } }))).toEqual(['stopped']);
  });
  it('이용 내역: 취소가 우선(작업 중 취소도 취소됨)', () => {
    expect(pastStatusOf({ status: 'cancelled', workStatus: 'in_progress' })).toBe('cancelled');
    expect(ids(f({ tab: 'past', s: { status: 'completed' } }))).toEqual(['done', 'done-old']);
    expect(ids(f({ tab: 'past', s: { status: 'cancelled' } }))).toEqual(['cancel', 'cancel-after-work']);
  });
});

describe('방문일(한국 시간)', () => {
  it('이번 주는 월~일', () => {
    expect(weekRange('2026-10-13')).toEqual({ from: '2026-10-12', to: '2026-10-18' });
    expect(weekRange('2026-10-18')).toEqual({ from: '2026-10-12', to: '2026-10-18' }); // 일요일
    expect(weekRange('2026-10-12')).toEqual({ from: '2026-10-12', to: '2026-10-18' }); // 월요일
  });
  it('오늘·이번 주(경계 포함), 방문일 없는 예약은 날짜 조건에서 제외하고 그 수를 알린다', () => {
    expect(ids(f({ a: { period: 'today' } }))).toEqual(['sched-today']);
    const r = filterBookings(items, toBookingQuery(f({ a: { period: 'this_week' } }), NOW));
    expect(r.items.map((x) => x.id)).toEqual(['sched-today', 'sched-sun', 'working', 'followup', 'recheck']);
    expect(r.excludedMissingVisitDate).toBe(1);
    expect(ids(f())).toContain('no-date'); // 전체 기간에서는 유지
  });
  it('오늘은 UTC가 아니라 한국 날짜', () => {
    expect(toBookingQuery(f({ a: { period: 'today' } }), '2026-10-13T15:00:00Z')).toMatchObject({ visitFrom: '2026-10-14', visitTo: '2026-10-14' });
  });
  it('이용 내역 최근 30·90일은 오늘 포함 N일, 직접 선택은 양 끝 포함', () => {
    expect(toBookingQuery(f({ tab: 'past', s: { period: '30d' } }), NOW)).toMatchObject({ visitFrom: '2026-09-14', visitTo: '2026-10-13' });
    // ‘최근 N일’은 오늘까지라, 방문일이 미래인 취소 예약(cancel, 10-14)은 들어가지 않는다(spec 미정 사항으로 기록)
    expect(ids(f({ tab: 'past', s: { period: '30d' } }))).toEqual(['done', 'cancel-after-work']);
    expect(ids(f({ tab: 'past', s: { period: '90d' } }))).toEqual(['done', 'cancel-after-work']); // 07-01은 90일 밖(07-16부터)
    expect(ids(f({ tab: 'past', s: { period: 'custom', from: '2026-07-01', to: '2026-10-01' } }))).toEqual(['done', 'done-old', 'cancel-after-work']);
  });
});

describe('확인 필요·조합', () => {
  it('확인 필요만은 미처리 행동이 있는 예약만(정산 대기라는 이유만으로 넣지 않음)', () => {
    expect(ids(f({ a: { actionOnly: true } }))).toEqual(['sched-today', 'sched-next-mon', 'working', 'final', 'recheck']);
    expect(ids(f({ a: { actionOnly: true } }))).not.toContain('stopped');
  });
  it('상태·방문일·확인 필요는 AND', () => {
    expect(ids(f({ a: { status: 'scheduled', period: 'this_week', actionOnly: true } }))).toEqual(['sched-today']);
    expect(ids(f({ a: { status: 'scheduled', actionOnly: true } }))).toEqual(['sched-today', 'sched-next-mon']);
    expect(ids(f({ a: { status: 'settlement_waiting', actionOnly: true } }))).toEqual([]);
  });
  it('전체 선택은 그 조건만 해제', () => {
    const both = f({ a: { status: 'scheduled', period: 'today', actionOnly: true } });
    expect(toBookingQuery({ ...both, active: { ...both.active, status: 'all' } }, NOW)).toEqual({ tab: 'active', visitFrom: '2026-10-13', visitTo: '2026-10-13', actionRequiredOnly: true });
  });
});

describe('URL·표시', () => {
  it('탭별 독립 키로 왕복', () => {
    const v = f({ tab: 'past', a: { status: 'in_progress', period: 'custom', from: '2026-10-01', to: '2026-10-31', actionOnly: true }, s: { status: 'cancelled', period: '90d' } });
    const qs = writeBookingsFilter(new URLSearchParams(), v);
    expect(qs.toString()).toBe('tab=past&a_status=in_progress&a_visit=custom&a_from=2026-10-01&a_to=2026-10-31&a_action=1&p_status=cancelled&p_visit=90d');
    expect(parseBookingsFilter(qs)).toEqual(v);
    expect(writeBookingsFilter(new URLSearchParams('x=1'), DEFAULT_BOOKINGS_FILTER).toString()).toBe('x=1');
  });
  it('잘못된 값은 기본값(직접 선택 오류 포함)', () => {
    expect(parseBookingsFilter(new URLSearchParams('tab=zz&a_status=done&a_visit=30d&p_status=scheduled&p_visit=today&a_action=yes'))).toEqual(DEFAULT_BOOKINGS_FILTER);
    expect(parseBookingsFilter(new URLSearchParams('a_visit=custom&a_from=2026-10-09&a_to=2026-10-01')).active.period).toBe('all');
  });
  it('버튼 표시', () => {
    expect(periodLabel(f().active, ACTIVE_PERIOD_OPTIONS)).toBeNull();
    expect(periodLabel(f({ a: { period: 'this_week' } }).active, ACTIVE_PERIOD_OPTIONS)).toBe('이번 주');
    expect(periodLabel(f({ a: { period: 'custom', from: '2026-10-01', to: '2026-10-08' } }).active, ACTIVE_PERIOD_OPTIONS)).toBe('2026.10.01 ~ 2026.10.08');
  });
});
