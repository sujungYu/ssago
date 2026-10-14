import { COMPARE_REQUESTS_ENABLED } from '../../domain/demoScope';
import { describe, expect, it } from 'vitest';
import { MockRepository } from './mockRepository';
import { DevController } from '../../dev/devController';
import { bookingTabOf, bundleInRequestsTab, isConvertedToBooking } from '../../domain/reservationTabs';
import { hasReservationFilterParams, parseReservationFilter, tabFilterKey, writeReservationFilter } from '../../domain/reservationFilter';
import { DEFAULT_ACTIVE, DEFAULT_PAST, PAST_STATUS_OPTIONS } from '../../domain/bookingFilter';
import { requestDisplay } from '../../domain/statusDisplay';
import { DEFAULT_REQUEST_FILTER } from '../../domain/requestFilter';
import type { RequestStatus } from '../../domain/types';

const repo = () => new MockRepository({ latencyMs: 0 });
const qs = (s: string) => new URLSearchParams(s);
type R = MockRepository;
const sentBundles = async (r: R) => (await r.queryRequests({})).bundles.map((b) => b.bundleId);
const sentRequestIds = async (r: R) => (await r.queryRequests({})).bundles.flatMap((b) => b.items.map((i) => i.request.id));
const bookingIds = async (r: R, tab: 'active' | 'past') => (await r.queryBookings({ tab })).items.map((i) => i.booking.id);
const pay = async (r: R, requestId: string, key: string) => {
  const d = await r.getRequest(requestId);
  return r.simulateDepositPayment({ requestId, approvalVersion: d.approval!.version, idempotencyKey: key });
};

describe('탭 분류 규칙(공통)', () => {
  it('예약으로 이어졌는지는 요청 상태 booked 또는 bookingId 연결로만 판단한다', () => {
    const pre: RequestStatus[] = ['reviewing', 'needs_info', 'approved_pending_payment', 'rejected', 'withdrawn', 'approval_expired', 'closed_other_booking'];
    for (const status of pre) expect(isConvertedToBooking({ status })).toBe(false);
    expect(isConvertedToBooking({ status: 'booked' })).toBe(true);
    expect(isConvertedToBooking({ status: 'approved_pending_payment', bookingId: 'bk-1' })).toBe(true);
  });
  it('묶음은 어느 요청도 예약으로 이어지지 않았을 때만 보낸 요청(종료된 묶음 포함)', () => {
    expect(bundleInRequestsTab([{ status: 'rejected' }, { status: 'withdrawn' }])).toBe(true);
    expect(bundleInRequestsTab([{ status: 'withdrawn' }])).toBe(false); // 모두 요청 취소면 완료·취소
    expect(bundleInRequestsTab([{ status: 'booked', bookingId: 'b' }, { status: 'closed_other_booking' }])).toBe(false);
    expect(bundleInRequestsTab([])).toBe(false);
  });
  it('예약: 취소·이용 완료(정산 완료)만 완료·취소, 작업이 끝나도 정산이 남으면 확정된 예약', () => {
    expect(bookingTabOf({ status: 'confirmed', workStatus: 'scheduled' })).toBe('active');
    expect(bookingTabOf({ status: 'confirmed', workStatus: 'in_progress' })).toBe('active');
    expect(bookingTabOf({ status: 'confirmed', workStatus: 'followup_waiting' })).toBe('active');
    expect(bookingTabOf({ status: 'confirmed', workStatus: 'final_confirm_waiting' })).toBe('active');
    expect(bookingTabOf({ status: 'confirmed', workStatus: 'stopped_settlement_waiting' })).toBe('active');
    expect(bookingTabOf({ status: 'terms_recheck', workStatus: 'scheduled' })).toBe('active');
    expect(bookingTabOf({ status: 'confirmed', workStatus: 'completed' })).toBe('past');
    expect(bookingTabOf({ status: 'cancelled', workStatus: 'scheduled' })).toBe('past');
  });
});

describe('탭 URL', () => {
  it('탭과 탭별 필터는 서로 다른 키로 독립 저장되고 그대로 복원된다', () => {
    const f = { tab: 'active' as const, requests: { period: '7d' as const, status: 'rejected' as const }, active: { ...DEFAULT_ACTIVE, actionOnly: true }, past: { ...DEFAULT_PAST, status: 'cancelled' as const } };
    const s = writeReservationFilter(qs('x=1'), f).toString();
    expect(s).toBe('tab=active&period=7d&status=rejected&a_action=1&p_status=cancelled&x=1');
    expect(parseReservationFilter(qs(s))).toEqual(f);
  });
  it('탭이 없으면(이전 주소) 들어 있는 필터 키로 탭을 정하고, 잘못된 값은 기본값', () => {
    expect(parseReservationFilter(qs('')).tab).toBe('requests');
    expect(parseReservationFilter(qs('status=reviewing')).tab).toBe('requests');
    expect(parseReservationFilter(qs('a_status=scheduled')).tab).toBe('active');
    expect(parseReservationFilter(qs('p_status=completed')).tab).toBe('past');
    expect(parseReservationFilter(qs('tab=past')).tab).toBe('past');
    expect(parseReservationFilter(qs('tab=nope'))).toEqual({ tab: 'requests', requests: DEFAULT_REQUEST_FILTER, active: DEFAULT_ACTIVE, past: DEFAULT_PAST });
    expect(parseReservationFilter(qs('tab=requests&status=booked')).requests.status).toBe('all'); // 없앤 ‘예약 완료’
    expect(hasReservationFilterParams(qs('tab=active'))).toBe(false); // 탭만 있으면 마지막 조건 + 그 탭
    expect(hasReservationFilterParams(qs('tab=active&a_action=1'))).toBe(true);
    expect(hasReservationFilterParams(qs('x=1'))).toBe(false);
  });
  it('목록 키는 현재 탭과 그 탭의 필터로만 정해진다(다른 탭 필터가 바뀌어도 같음)', () => {
    const base = parseReservationFilter(qs('tab=requests&status=rejected'));
    expect(tabFilterKey(base)).toBe('tab=requests&status=rejected');
    expect(tabFilterKey({ ...base, active: { ...DEFAULT_ACTIVE, status: 'scheduled' } })).toBe('tab=requests&status=rejected');
    expect(tabFilterKey({ ...base, tab: 'past' })).toBe('tab=past');
  });
});

describe('내 예약 탭 노출(중복 없음)', () => {
  it('시드: 각 요청·예약은 정확히 한 탭에만 — 보낸 요청에는 예약으로 이어진 묶음이 없다', async () => {
    const r = repo();
    const sent = await sentRequestIds(r);
    const active = await bookingIds(r, 'active');
    const past = await bookingIds(r, 'past');
    const db = r.__db();
    // 보낸 요청에는 booked·bookingId가 있는 요청, 같은 묶음의 다른 업체 요청이 없다
    const convertedBundles = new Set(db.requests.filter(isConvertedToBooking).map((x) => x.bundleId));
    expect(db.requests.filter((x) => sent.includes(x.id)).some((x) => convertedBundles.has(x.bundleId))).toBe(false);
    // 예약으로 이어지지 않은 요청은 보낸 요청에, 단 요청 취소(withdrawn)는 완료·취소에만(spec 5.47)
    const cancelled = (await r.queryBookings({ tab: 'past' })).cancelledRequests.map((i) => i.request.id);
    expect(db.requests.filter((x) => !convertedBundles.has(x.bundleId) && x.status !== 'withdrawn').map((x) => x.id).sort()).toEqual([...sent].sort());
    expect(cancelled.sort()).toEqual(db.requests.filter((x) => !convertedBundles.has(x.bundleId) && x.status === 'withdrawn').map((x) => x.id).sort());
    expect(sent.filter((id) => cancelled.includes(id))).toEqual([]); // 두 탭에 중복 없음
    // 예약은 확정된 예약/완료·취소 중 하나에만, 빠짐없이
    expect(active.filter((id) => past.includes(id))).toEqual([]);
    expect([...active, ...past].sort()).toEqual(db.bookings.map((b) => b.id).sort());
    // 거절·만료로 끝난 요청은 보낸 요청에 남고, 요청 취소(rq-6)는 완료·취소에
    expect(sent).toEqual(expect.arrayContaining(['rq-5', 'rq-7']));
    expect(sent).not.toContain('rq-6');
    expect(cancelled).toContain('rq-6');
    // 다른 업체 예약으로 종료된 요청(rq-8)은 그 묶음의 예약이 있어 보낸 요청에 없다
    expect(sent).not.toContain('rq-8');
    expect((await r.queryRequests({})).hasAnyRequest).toBe(true);
  });
  it.skipIf(COMPARE_REQUESTS_ENABLED)('데모(개별 요청): 결제 성공한 요청만 예약으로 옮기고, 같은 묶음의 다른 업체 요청은 종료하지 않고 보낸 요청에 남는다(묶음·출처 기록 보존)', async () => {
    const r = repo();
    await pay(r, 'rq-3', 'k-ok');
    const bk = (await r.getRequest('rq-3')).request.bookingId!;
    expect(await sentRequestIds(r)).not.toContain('rq-3');
    expect(await sentRequestIds(r)).toContain('rq-4');
    expect((await r.getRequest('rq-4')).request.status).toBe('approved_pending_payment');
    expect(await bookingIds(r, 'active')).toContain(bk);
    expect((await r.getBooking(bk)).origin).toEqual({ requestId: 'rq-3', bundleId: 'b-sink', bundleSize: 2 });
  });
  it.skipIf(!COMPARE_REQUESTS_ENABLED)('결제 실패·결과 확인 중은 보낸 요청 유지, 결제 성공이면 묶음째 빠지고 그 예약만 확정된 예약에', async () => {
    const r = repo();
    const dev = new DevController(r);
    dev.setSettings({ payOutcome: 'fail' });
    await pay(r, 'rq-3', 'k-fail');
    expect(await sentBundles(r)).toContain('b-sink');
    expect((await r.queryRequests({})).bundles.find((b) => b.bundleId === 'b-sink')!.items.find((i) => i.request.id === 'rq-3')!.depositAttempt).toBe('failed');
    dev.setSettings({ payOutcome: 'unknown' });
    await pay(r, 'rq-3', 'k-unknown');
    expect(await sentBundles(r)).toContain('b-sink');
    expect((await r.queryRequests({})).bundles.find((b) => b.bundleId === 'b-sink')!.items.find((i) => i.request.id === 'rq-3')!.depositAttempt).toBe('unknown');
    const beforeActive = await bookingIds(r, 'active');
    expect(beforeActive.length).toBe((await r.queryBookings({ tab: 'active' })).items.length);

    const r2 = repo();
    const before = await bookingIds(r2, 'active');
    await pay(r2, 'rq-3', 'k-ok');
    const bk = (await r2.getRequest('rq-3')).request.bookingId!;
    expect(await sentBundles(r2)).not.toContain('b-sink'); // rq-4(다른 업체)도 함께 빠진다
    expect(await sentRequestIds(r2)).not.toContain('rq-4');
    expect(await bookingIds(r2, 'active')).toEqual(expect.arrayContaining([...before, bk]));
    expect((await bookingIds(r2, 'active')).length).toBe(before.length + 1); // 선택한 업체 예약 하나만
    // 원본 요청·업체 응답 기록은 그대로(상세에서 확인)
    const bundle = await r2.getBundle('b-sink');
    expect(bundle.items.map((i) => [i.request.id, i.request.status])).toEqual(expect.arrayContaining([['rq-3', 'booked'], ['rq-4', 'closed_other_booking']]));
    expect((await r2.getBooking(bk)).origin).toEqual({ requestId: 'rq-3', bundleId: 'b-sink', bundleSize: 2 });
  });
  it.skipIf(!COMPARE_REQUESTS_ENABLED)('확정 후 취소 → 완료·취소에만, 비교 요청 묶음은 보낸 요청으로 돌아오지 않고 다른 업체 요청도 다시 열리지 않는다', async () => {
    const r = repo();
    await pay(r, 'rq-3', 'k-ok');
    const bk = (await r.getRequest('rq-3')).request.bookingId!;
    const ctx = await r.getCancelContext(bk);
    await r.cancelBooking({ bookingId: bk, expectedRefund: ctx.preview.refundTotal, idempotencyKey: 'k-cancel' });
    expect(await bookingIds(r, 'past')).toContain(bk);
    expect(await bookingIds(r, 'active')).not.toContain(bk);
    expect(await sentBundles(r)).not.toContain('b-sink');
    expect((await r.getRequest('rq-4')).request.status).toBe('closed_other_booking');
  });
  it('확정 전 거절·만료는 보낸 요청에만(종료 상태로), 요청 취소(철회)는 완료·취소에만 — 예약으로 바꾸지 않는다', async () => {
    const r = repo();
    const dev = new DevController(r);
    dev.rejectRequest('rq-1');
    dev.expireApproval('rq-10');
    await r.withdrawRequest('rq-2');
    const items = (await r.queryRequests({})).bundles.flatMap((b) => b.items);
    expect(Object.fromEntries(items.filter((i) => ['rq-1', 'rq-2', 'rq-10'].includes(i.request.id)).map((i) => [i.request.id, i.request.status])))
      .toEqual({ 'rq-1': 'rejected', 'rq-10': 'approval_expired' });
    const past = await r.queryBookings({ tab: 'past' });
    expect(past.cancelledRequests.map((i) => [i.request.id, i.request.status])).toContainEqual(['rq-2', 'withdrawn']);
    const all = [...(await r.queryBookings({ tab: 'active' })).items, ...past.items];
    expect(all.some((it) => ['rq-1', 'rq-2', 'rq-10'].includes(it.booking.requestId))).toBe(false);
    expect(r.__db().bookings.some((b) => b.requestId === 'rq-2')).toBe(false); // 예약 데이터로 바꾸거나 복제하지 않음
  });
  it('최종 금액 확인·정산 대기는 확정된 예약 유지, 정산 완료(이용 완료)되면 완료·취소로만', async () => {
    const r = repo();
    const dev = new DevController(r);
    const actives = (await r.queryBookings({ tab: 'active' })).items;
    const finalWait = actives.find((it) => it.booking.workStatus === 'final_confirm_waiting');
    expect(finalWait).toBeTruthy();
    expect(actives.some((it) => it.booking.workStatus === 'stopped_settlement_waiting' || it.booking.workStatus === 'final_confirm_waiting')).toBe(true);
    // 방문일이 지났다는 이유만으로 옮기지 않는다: 시계를 한참 뒤로 옮겨도 그대로
    dev.setNow('2026-12-31T12:00:00+09:00');
    expect(await bookingIds(r, 'active')).toContain(finalWait!.booking.id);
    expect(await bookingIds(r, 'past')).not.toContain(finalWait!.booking.id);
  });
  it('보낸 요청 필터의 건수 = 실제 표시 묶음 수, 보낸 요청이 없으면 hasAnyRequest=false', async () => {
    const r = repo();
    const ended = await r.queryRequests({ statuses: ['rejected', 'withdrawn', 'approval_expired', 'closed_other_booking'] });
    expect(ended.bundles.every((b) => b.items.every((i) => ['rejected', 'withdrawn', 'approval_expired'].includes(i.request.status)))).toBe(true);
    r.__db().requests = r.__db().requests.filter(isConvertedToBooking);
    expect(await r.queryRequests({})).toEqual({ bundles: [], hasAnyRequest: false });
  });
});

describe('완료·취소 탭의 요청 취소(spec 5.47)', () => {
  it('상태 선택지: 전체 · 이용 완료 · 요청 취소 · 예약 취소, 이름은 카드 라벨과 같다', () => {
    expect(PAST_STATUS_OPTIONS.map((o) => o.label)).toEqual(['전체', '이용 완료', '요청 취소', '예약 취소']);
    expect(PAST_STATUS_OPTIONS.find((o) => o.value === 'request_cancelled')!.label).toBe(requestDisplay('withdrawn').label);
  });
  it('요청 취소 선택 → 요청 취소만, 이용 완료·예약 취소 선택 → 요청 취소 없음, 건수 = 예약 + 요청 취소', async () => {
    const r = repo();
    const all = await r.queryBookings({ tab: 'past' });
    const only = await r.queryBookings({ tab: 'past', statusGroup: 'request_cancelled' });
    expect(only.items).toEqual([]);
    expect(only.cancelledRequests.map((i) => i.request.id)).toEqual(all.cancelledRequests.map((i) => i.request.id));
    expect(all.cancelledRequests.length).toBeGreaterThan(0);
    expect(all.cancelledRequests.every((i) => i.request.status === 'withdrawn')).toBe(true);
    for (const g of ['completed', 'cancelled'] as const) expect((await r.queryBookings({ tab: 'past', statusGroup: g })).cancelledRequests).toEqual([]);
    const c = (await r.queryBookings({ tab: 'past', statusGroup: 'completed' })).items.length + (await r.queryBookings({ tab: 'past', statusGroup: 'cancelled' })).items.length;
    expect(all.items.length + all.cancelledRequests.length).toBe(c + only.cancelledRequests.length);
  });
  it('날짜(방문일) 조건이 있으면 확정 방문일이 없는 요청 취소는 제외하고 그 수를 알린다(날짜를 만들지 않음)', async () => {
    const r = repo();
    const n = (await r.queryBookings({ tab: 'past' })).cancelledRequests.length;
    const d = await r.queryBookings({ tab: 'past', visitFrom: '2026-01-01', visitTo: '2026-12-31' });
    expect(d.cancelledRequests).toEqual([]);
    expect(d.excludedCancelledRequests).toBe(n);
    expect((await r.queryBookings({ tab: 'active' })).cancelledRequests).toEqual([]);
  });
});
