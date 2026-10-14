import { describe, expect, it } from 'vitest';
import { MockRepository } from './mockRepository';

const repo = () => new MockRepository({ latencyMs: 0 });

describe('취소 조건의 ‘별도 주문 자재’ 안내 표시 조건(hasOrderedMaterialTerms)', () => {
  it('예약금 결제 대기 요청: 별도 주문 자재 조건이 없으면 false(부품·자재 예상 금액이 있어도)', async () => {
    const v = await repo().getApproval('rq-3');
    expect(v.request.status).toBe('approved_pending_payment');
    expect(v.approval.partsEstimate).toBeGreaterThan(0);
    expect(v.hasOrderedMaterialTerms).toBe(false);
  });
  it('이 요청에서 이어진 예약에 동의한 자재의 회수 불가 비용이 있으면 true, 동의 전이거나 회수 불가 비용이 0이면 false', async () => {
    const r = repo();
    const db = r.__db();
    const bk = db.bookings.find((b) => b.requestId === 'rq-3') ?? (() => {
      const b = structuredClone(db.bookings[0]);
      b.id = 'bk-test'; b.requestId = 'rq-3'; db.bookings.push(b); return b;
    })();
    const base = structuredClone(db.materials.find((m) => m.id === 'mt-1')!);
    db.materials.push({ ...base, id: 'mt-test', bookingId: bk.id, agreedAt: undefined, nonRefundableIfCancelled: 30000 });
    expect((await r.getApproval('rq-3')).hasOrderedMaterialTerms).toBe(false); // 동의 전
    db.materials.find((m) => m.id === 'mt-test')!.nonRefundableIfCancelled = 0;
    db.materials.find((m) => m.id === 'mt-test')!.agreedAt = '2026-10-13T10:00:00+09:00';
    expect((await r.getApproval('rq-3')).hasOrderedMaterialTerms).toBe(false); // 회수 불가 비용 없음
    db.materials.find((m) => m.id === 'mt-test')!.nonRefundableIfCancelled = 30000;
    expect((await r.getApproval('rq-3')).hasOrderedMaterialTerms).toBe(true);
  });
});
