import { describe, expect, it } from 'vitest';
import { showSettlementCard, summarizeBookingCost, type CostInput, type TripFeeBasis } from './bookingCost';

const trip = (p: Partial<TripFeeBasis> = {}): TripFeeBasis => ({ kind: 'confirmed', amount: 16666, households: 3, groupTotal: 50000, currentHouseholds: 3, ...p });
const prepaid = (p: Partial<CostInput['prepaid']> = {}) => {
  const v = { depositPaid: 50000, materialPrepaid: 0, changePaid: 0, refunded: 0, deducted: 0, ...p };
  return { ...v, available: Math.max(0, v.depositPaid + v.materialPrepaid + v.changePaid - v.refunded - v.deducted) };
};
const input = (p: Partial<CostInput> = {}): CostInput => ({
  laborEstimates: [40000], partsEstimate: 5000, agreedMaterials: [], agreedAdditional: [], tripFee: trip(), prepaid: prepaid(), cancelled: false, ...p,
});

describe('예상 금액(작업 완료 전)', () => {
  it('예시: 40,000 + 5,000 + 확정 출장비 16,666 = 61,666, 예약금 50,000 → 예상 추가 결제액 11,666', () => {
    const c = summarizeBookingCost(input());
    expect(c.lines.map((l) => [l.label, l.amount])).toEqual([['예상 작업비', 40000], ['예상 부품·자재비', 5000], ['내 확정 출장비', 16666]]);
    expect(c.total).toEqual({ label: '예상 총금액', amount: 61666 });
    expect(c.payments).toEqual([{ key: 'deposit', label: '결제한 예약금', amount: 50000 }]);
    expect(c.balance).toEqual({ kind: 'pay', label: '예상 추가 결제액', amount: 11666 });
    expect(c.note).toBe('작업 완료 후 합의된 실제 내역으로 최종 정산됩니다.');
  });
  it('마감 전에는 ‘현재 예상 출장비’, 확정 출장비가 있어도 총액은 ‘예상’', () => {
    expect(summarizeBookingCost(input({ tripFee: trip({ kind: 'expected', amount: 25000 }) })).lines[2].label).toBe('현재 예상 출장비');
    expect(summarizeBookingCost(input()).total!.label).toBe('예상 총금액');
  });
  it('작업비는 작업별 견적의 합이고 자재비를 다시 더하지 않는다', () => {
    const c = summarizeBookingCost(input({ laborEstimates: [50000, 30000], partsEstimate: 20000, tripFee: trip({ amount: 12500 }) }));
    expect(c.total!.amount).toBe(112500); // 80,000 + 20,000 + 12,500
  });
  it('추가 결제 0원과 환불', () => {
    expect(summarizeBookingCost(input({ prepaid: prepaid({ depositPaid: 61666 }) })).balance).toEqual({ kind: 'zero', label: '예상 추가 결제 없음', amount: 0 });
    expect(summarizeBookingCost(input({ prepaid: prepaid({ depositPaid: 70000 }) })).balance).toEqual({ kind: 'refund', label: '예상 환불액', amount: 8334 });
  });
  it('자재 선결제가 있어도 같은 자재비를 두 번 청구하지 않는다(총액에 한 번, 선결제에서 한 번 차감)', () => {
    const c = summarizeBookingCost(input({ agreedMaterials: [{ name: '맞춤 도어', price: 30000 }], prepaid: prepaid({ materialPrepaid: 30000 }) }));
    expect(c.total!.amount).toBe(91666);
    expect(c.payments.map((p) => p.label)).toEqual(['결제한 예약금', '결제한 자재 선결제']);
    expect(c.balance.amount).toBe(11666); // 자재 없을 때와 같은 차액
  });
  it('동의한 추가 작업은 합산한다', () => {
    expect(summarizeBookingCost(input({ agreedAdditional: [{ scope: '배선 정리', amount: 25000 }] })).total!.amount).toBe(86666);
  });
  it('이미 공제·환불된 선결제는 다시 차감하지 않는다', () => {
    const c = summarizeBookingCost(input({ prepaid: prepaid({ deducted: 12500, refunded: 5000 }) }));
    expect(c.paidIn).toBe(50000);
    expect(c.used).toEqual({ deducted: 12500, refunded: 5000 });
    expect(c.available).toBe(32500);
    expect(c.balance).toEqual({ kind: 'pay', label: '예상 추가 결제액', amount: 29166 });
  });
  it('업체 할인은 금액이 없어 조건만 보여주고 총액에 반영하지 않는다', () => {
    const c = summarizeBookingCost(input({ discountNote: '작업비 5,000원 할인' }));
    expect(c.discountNote).toBe('작업비 5,000원 할인');
    expect(c.total!.amount).toBe(61666);
  });
});

describe('데이터 누락은 0원으로 대신하지 않는다', () => {
  it.each([
    ['작업비 견적 없음(현장 확인)', { laborEstimates: [40000, null] }],
    ['승인 없음', { laborEstimates: undefined, partsEstimate: undefined }],
    ['부품 예상 없음', { partsEstimate: null }],
    ['출장비 미산정', { tripFee: trip({ amount: null }) }],
  ] as const)('%s → 해당 항목·총액·차액 모두 미산정', (_n, p) => {
    const c = summarizeBookingCost(input(p as Partial<CostInput>));
    expect(c.lines.some((l) => l.amount === null)).toBe(true);
    expect(c.total!.amount).toBeNull();
    expect(c.balance.kind).toBe('unknown');
    expect(c.balance.amount).toBeNull();
  });
});

describe('최종 내역 이후·취소', () => {
  const items = [{ kind: 'labor' as const, label: '작업비', amount: 80000 }, { kind: 'material' as const, label: '부품·자재비', amount: 20000 }, { kind: 'trip_fee' as const, label: '확정 출장비', amount: 12500 }];
  it('업체가 등록한 최종 내역(확인 전)은 확정 금액처럼 쓰지 않는다', () => {
    const c = summarizeBookingCost(input({ statement: { status: 'awaiting_customer', items } }));
    expect(c.stage).toBe('final_awaiting');
    expect(c.total).toEqual({ label: '업체가 등록한 최종 금액(확인 전)', amount: 112500 });
    expect(c.balance).toEqual({ kind: 'pay', label: '결제할 금액', amount: 62500 });
    // 금액 상세: 수리비(작업비 + 부품·자재비)와 내 확정 출장비로 나눈다(합 = 총금액, 중복 없음)
    expect([c.repair, c.trip.amount, c.repairLines.map((l) => l.label)]).toEqual([100000, 12500, ['작업비', '부품·자재비']]);
  });
  it('확인 전 차액: 0원은 ‘추가 결제 없음’, 음수는 ‘환불 예정 금액’(절댓값)', () => {
    const small = [{ kind: 'labor' as const, label: '작업비', amount: 30000 }, { kind: 'trip_fee' as const, label: '확정 출장비', amount: 12500 }];
    expect(summarizeBookingCost(input({ statement: { status: 'awaiting_customer', items: small }, prepaid: prepaid({ deducted: 7500 }) })).balance)
      .toEqual({ kind: 'zero', label: '추가 결제 없음', amount: 0 });
    expect(summarizeBookingCost(input({ statement: { status: 'awaiting_customer', items: small }, prepaid: prepaid() })).balance)
      .toEqual({ kind: 'refund', label: '환불 예정 금액', amount: 7500 });
  });
  it('이전 환불·공제가 있으면 남은 선결제 잔액으로만 차감(중복 차감 없음)', () => {
    // 예약금 50,000 중 20,000 이미 환불 → 잔액 30,000. 최종 112,500 − 30,000 = 82,500
    const c = summarizeBookingCost(input({ statement: { status: 'awaiting_customer', items }, prepaid: prepaid({ depositPaid: 50000, refunded: 20000 }) }));
    expect([c.available, c.balance.amount, c.used.refunded]).toEqual([30000, 82500, 20000]);
  });
  it('협의 중·정산 완료 문구', () => {
    expect(summarizeBookingCost(input({ statement: { status: 'disputed', items } })).total!.label).toContain('협의 중');
    const s = summarizeBookingCost(input({ statement: { status: 'settled', items } }));
    expect([s.stage, s.total!.label, s.balance.label]).toEqual(['settled', '최종 금액', '추가 결제한 금액']);
  });
  it('취소된 예약은 예상 총액 없이 결제·공제·환불만', () => {
    const c = summarizeBookingCost(input({ cancelled: true, prepaid: prepaid({ deducted: 12500, refunded: 37500 }) }));
    expect([c.stage, c.total, c.lines.length]).toEqual(['cancelled', null, 0]);
    expect(c.balance).toEqual({ kind: 'refund', label: '취소 환불 요청 금액', amount: 37500 });
  });
});

describe('금액·정산 카드 표시 기준', () => {
  it('최종 금액 등록 여부·실제 상태로만 판단(0원도 등록됨), 등록 전에는 숨김, 취소는 기록이 있을 때만', () => {
    expect(showSettlementCard({ cancelled: false, hasStatement: false, moneyRecords: 3 })).toBe(false); // 방문 예정·작업 중(예약금 결제 기록이 있어도)
    expect(showSettlementCard({ cancelled: false, hasStatement: true, moneyRecords: 0 })).toBe(true); // 최종 금액 등록(0원 포함)
    expect(showSettlementCard({ cancelled: true, hasStatement: false, moneyRecords: 2 })).toBe(true);
    expect(showSettlementCard({ cancelled: true, hasStatement: false, moneyRecords: 0 })).toBe(false);
  });
});
