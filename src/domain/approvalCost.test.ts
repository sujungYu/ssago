import { describe, expect, it } from 'vitest';
import { approvalEstimate } from './approvalCost';
import { expectedFeeForJoiner } from './pricing';
import { filterBundleItems, matchesBundleStatus, parseBundleFilter, writeBundleFilter, BUNDLE_STATUS_OPTIONS } from './bundleFilter';
import { STATUS_GROUP_STATUSES } from './requestFilter';
import { MockRepository } from '../data/mock/mockRepository';
import type { Approval, RequestStatus } from './types';

const ap = (p: Partial<Approval> = {}): Approval => ({
  id: 'a', requestId: 'r', version: 1, approvedAt: '2026-10-13T15:00:00+09:00', groupCloseAt: '2026-10-15T18:00:00+09:00',
  paymentDeadline: '2026-10-14T15:00:00+09:00', visitDate: '2026-10-16', visitTime: '10:00', totalTripFee: 50000, depositAmount: 50000,
  tasks: [{ title: '수전', note: '', estimate: 50000 }, { title: '트랩', note: '', estimate: 30000 }], partsEstimate: 20000,
  cancellationTerms: [], groupId: 'g1', ...p,
});

describe('예상 총금액', () => {
  it('작업비 + 부품·자재 + 본인 예상 출장비(확정 세대 + 본인) — 그룹 총 출장비·예약금을 더하지 않는다', () => {
    const e = approvalEstimate(ap(), 3);
    expect(e).toMatchObject({ labor: 80000, parts: 20000, myTripFee: 12500, householdsWithMe: 4, total: 112500, discountApplied: 0 });
    expect(e.myTripFee).toBe(expectedFeeForJoiner(50000, 3));
    expect(e.total).not.toBe(80000 + 20000 + 50000);
  });
  it('결제 대기 자리는 세대 수에 넣지 않는다(확정 세대만 받는다)', () => {
    // 확정 3 + 결제 대기 1인 그룹이어도 확정 3만 넘긴다 → 4세대 분담
    expect(approvalEstimate(ap(), 3).householdsWithMe).toBe(4);
  });
  it('부품·자재는 한 번만 더한다', () => {
    expect(approvalEstimate(ap({ partsEstimate: 0 }), 3).total).toBe(92500);
  });
  it('조건부 업체 할인은 적용하지 않는다(조건 충족 여부를 판정할 수 없음)', () => {
    const e = approvalEstimate(ap({ discountNote: '두 작업 함께 맡기면 5,000원 할인' }), 3);
    expect(e.total).toBe(112500);
    expect(e.discountNote).toContain('5,000원');
  });
  it('견적 없는 작업이 있으면 0원으로 대체하지 않고 금액 확인 필요(null)', () => {
    const e = approvalEstimate(ap({ tasks: [{ title: '수전', note: '', estimate: 50000 }, { title: '트랩', note: '', estimate: null }] }), 3);
    expect(e).toMatchObject({ labor: null, laborMissing: ['트랩'], total: null });
  });
  it('조건 재확인(새 그룹)은 확정 0세대 기준 = 새 총 출장비 전액', () => {
    const e = approvalEstimate(ap({ recheck: { endedGroupNote: '', newVisitDate: '2026-10-20', newCloseAt: '2026-10-19T18:00:00+09:00', newTotalTripFee: 60000, newDepositAmount: 60000 } as Approval['recheck'] }), 3);
    expect(e).toMatchObject({ confirmedHouseholds: 0, householdsWithMe: 1, myTripFee: 60000, total: 80000 + 20000 + 60000 });
  });
  it('시드 데이터: 한빛설비(rq-3) 예상 총금액 112,500원, 새봄수리(rq-4) 확정 2세대 기준', async () => {
    const r = new MockRepository({ latencyMs: 0 });
    const b = await r.getBundle('b-sink');
    const one = b.items.find((i) => i.request.id === 'rq-3')!;
    expect(approvalEstimate(one.approval!, one.group!.confirmedHouseholds).total).toBe(112500);
    const two = b.items.find((i) => i.request.id === 'rq-4')!;
    expect(approvalEstimate(two.approval!, two.group!.confirmedHouseholds)).toMatchObject({ labor: 70000, parts: 25000, myTripFee: 20000, total: 115000 });
  });
});

describe('비교 요청 상태 필터', () => {
  const ALL: RequestStatus[] = ['reviewing', 'needs_info', 'approved_pending_payment', 'rejected', 'withdrawn', 'approval_expired', 'closed_other_booking', 'booked'];
  it('종료는 거절·철회·승인 만료·다른 업체 예약으로 종료를 묶는다', () => {
    expect(ALL.filter((s) => matchesBundleStatus(s, 'ended'))).toEqual(['rejected', 'withdrawn', 'approval_expired', 'closed_other_booking']);
    expect(ALL.filter((s) => matchesBundleStatus(s, 'payment_pending'))).toEqual(['approved_pending_payment']);
  });
  it('예약 확정은 전체에서만 보이고 종료로 분류하지 않는다', () => {
    expect(BUNDLE_STATUS_OPTIONS.map((o) => o.value)).toEqual(['all', 'payment_pending', 'needs_info', 'reviewing', 'ended']);
    expect(matchesBundleStatus('booked', 'all')).toBe(true);
    expect((['payment_pending', 'needs_info', 'reviewing', 'ended'] as const).some((f) => matchesBundleStatus('booked', f))).toBe(false);
    expect(Object.values(STATUS_GROUP_STATUSES).flat()).not.toContain('booked'); // 보낸 요청 필터에도 없음
  });
  it('전체는 조건 해제, 필터는 항목을 바꾸지 않는다', () => {
    const items = ALL.map((status) => ({ request: { status } }));
    expect(filterBundleItems(items, 'all')).toHaveLength(8);
    expect(filterBundleItems(items, 'ended')).toHaveLength(4);
    expect(items.map((i) => i.request.status)).toEqual(ALL);
  });
  it('URL: 잘못된 값은 전체, 전체는 쿼리 없음', () => {
    expect(parseBundleFilter(new URLSearchParams('status=zzz'))).toBe('all');
    expect(parseBundleFilter(new URLSearchParams('status=ended'))).toBe('ended');
    expect(writeBundleFilter(new URLSearchParams('status=ended'), 'all').toString()).toBe('');
  });
});
