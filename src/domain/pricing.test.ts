import { describe, expect, it } from 'vitest';
import {
  availablePrepaid, computeSettlement, expectedFeeForJoiner, perHouseholdFee, previewCancellation, previewDateChange, tripFeeSavings,
} from './pricing';
import { canApproveAt, checkPayable, isValidCloseAt, paymentDeadline } from './rules';

const items = [
  { kind: 'labor' as const, label: '작업비', amount: 80000 },
  { kind: 'material' as const, label: '부품', amount: 20000 },
  { kind: 'trip_fee' as const, label: '출장비', amount: 12500 },
];

describe('출장비 분담', () => {
  it('총 50,000원 / 4세대 = 12,500원', () => expect(perHouseholdFee(50000, 4)).toBe(12500));
  it('3세대는 내림 처리', () => expect(perHouseholdFee(50000, 3)).toBe(16666));
  it('0세대는 나누지 않는다', () => expect(perHouseholdFee(50000, 0)).toBeNull());
  it('신규 참여자 예상 분담액은 결제 대기를 세대 수에 넣지 않는다', () => expect(expectedFeeForJoiner(50000, 3)).toBe(12500));
  it('절감액은 37,500원(75%)', () => expect(tripFeeSavings(50000, 4)).toEqual({ amount: 37500, percent: 75 }));
});

describe('최종 정산', () => {
  it('112,500원 − 예약금 50,000원 = 62,500원 추가 결제', () => {
    expect(computeSettlement(items, 50000)).toMatchObject({ finalTotal: 112500, delta: 62500, kind: 'pay', amount: 62500 });
  });
  it('차액 0원은 확인만', () => expect(computeSettlement(items, 112500).kind).toBe('zero'));
  it('선결제가 더 크면 환불', () => expect(computeSettlement(items, 120000)).toMatchObject({ kind: 'refund', amount: 7500 }));
  it('이미 환불·공제된 선결제는 다시 쓰지 않는다', () => {
    expect(availablePrepaid({ paidIn: 130000, refundedOut: 87500, deducted: 42500 })).toBe(0);
    expect(availablePrepaid({ paidIn: 50000, refundedOut: 0, deducted: 12500 })).toBe(37500);
  });
});

describe('취소', () => {
  const base = { groupClosed: false, depositPaid: 50000, materialPrepaid: 0, confirmedTripFee: null, materialDeduction: 0 };
  it('마감 전 고객 취소는 출장비 공제 없음', () => {
    expect(previewCancellation({ ...base, cause: 'customer' })).toMatchObject({ tripFeeDeduction: 0, refundTotal: 50000, othersImpact: 'recalculated' });
  });
  it('마감 후 고객 취소는 본인 확정 출장비만 공제, 타 세대 유지', () => {
    expect(previewCancellation({ ...base, cause: 'customer', groupClosed: true, confirmedTripFee: 12500 }))
      .toMatchObject({ tripFeeDeduction: 12500, refundTotal: 37500, othersImpact: 'unchanged' });
  });
  it('자재 공제는 출장비와 별도 항목: 130,000 − 12,500 − 30,000 = 87,500', () => {
    expect(previewCancellation({ ...base, cause: 'customer', groupClosed: true, depositPaid: 50000, materialPrepaid: 80000, confirmedTripFee: 12500, materialDeduction: 30000 }))
      .toMatchObject({ tripFeeDeduction: 12500, materialDeduction: 30000, refundTotal: 87500 });
  });
  it('업체 사유는 전액 환불', () => {
    expect(previewCancellation({ ...base, cause: 'provider', groupClosed: true, depositPaid: 50000, materialPrepaid: 20000, confirmedTripFee: 12500, materialDeduction: 20000 }))
      .toMatchObject({ tripFeeDeduction: 0, materialDeduction: 0, refundTotal: 70000 });
  });
});

describe('날짜 변경', () => {
  it('마감 후 변경은 기존 확정 출장비를 수수료로 공제하고 부족분만 추가 결제', () => {
    expect(previewDateChange({ oldGroupClosed: true, depositPaid: 50000, confirmedTripFee: 12500, newGroupTotalTripFee: 50000 }))
      .toMatchObject({ changeFee: 12500, carriedDeposit: 37500, shortfall: 12500, excessUndecided: 0 });
  });
  it('마감 전 변경은 수수료 없음', () => {
    expect(previewDateChange({ oldGroupClosed: false, depositPaid: 50000, confirmedTripFee: null, newGroupTotalTripFee: 50000 }).changeFee).toBe(0);
  });
});

describe('기한 규칙', () => {
  it('결제 기한 = min(승인+24h, 그룹 마감)', () => {
    expect(paymentDeadline('2026-10-13T10:00:00+09:00', '2026-10-15T18:00:00+09:00')).toBe(new Date('2026-10-14T10:00:00+09:00').toISOString());
    expect(paymentDeadline('2026-10-15T10:00:00+09:00', '2026-10-15T18:00:00+09:00')).toBe(new Date('2026-10-15T18:00:00+09:00').toISOString());
  });
  it('승인은 마감 1시간 전까지', () => {
    expect(canApproveAt('2026-10-15T17:00:00+09:00', '2026-10-15T18:00:00+09:00')).toBe(true);
    expect(canApproveAt('2026-10-15T17:01:00+09:00', '2026-10-15T18:00:00+09:00')).toBe(false);
  });
  it('마감은 방문 전날 18:00 이내', () => {
    expect(isValidCloseAt('2026-10-15T18:00:00+09:00', '2026-10-16')).toBe(true);
    expect(isValidCloseAt('2026-10-15T19:00:00+09:00', '2026-10-16')).toBe(false);
  });
  it('승인만으로 확정되지 않고, 진행 중 결제가 있으면 막는다', () => {
    const ok = { request: { status: 'approved_pending_payment' as const }, approval: { version: 1, paymentDeadline: '', recheck: undefined }, groupClosed: false, groupEnded: false, confirmedVersion: 1, hasInFlightPayment: false };
    expect(checkPayable(ok)).toEqual({ ok: true });
    expect(checkPayable({ ...ok, hasInFlightPayment: true })).toEqual({ ok: false, reason: 'in_progress' });
    expect(checkPayable({ ...ok, confirmedVersion: 0 })).toEqual({ ok: false, reason: 'version_changed' });
    expect(checkPayable({ ...ok, groupClosed: true })).toEqual({ ok: false, reason: 'closed' });
  });
});
