import { describe, expect, it } from 'vitest';
import { MockRepository } from './mockRepository';
import { DevController } from '../../dev/devController';

// 예약 상세 출장비 분담 기준(마감 전 예상 / 마감 시 확정)과 선결제 잔액
const repo = () => new MockRepository({ latencyMs: 0 });

describe('출장비 분담 기준', () => {
  it('마감 전: 현재 확정 세대 기준 예상 출장비', async () => {
    const tf = (await repo().getBooking('bk-k1')).tripFee;
    expect(tf.kind).toBe('expected');
    expect(tf.households).toBe(tf.currentHouseholds);
  });
  it('마감 후: 마감 시 확정 세대 기준 확정 출장비', async () => {
    const tf = (await repo().getBooking('bk-k4')).tripFee;
    expect(tf).toEqual({ kind: 'confirmed', amount: 16666, households: 3, groupTotal: 50000, currentHouseholds: 3 });
  });
  it('마감 후 다른 세대가 취소해도 내 확정 출장비와 분담 기준은 그대로, 현재 참여 세대만 줄어든다', async () => {
    const r = repo();
    const ctx = await r.getCancelContext('bk-k6');
    await r.cancelBooking({ bookingId: 'bk-k6', expectedRefund: ctx.preview.refundTotal, idempotencyKey: 'c-k6' });
    const tf = (await r.getBooking('bk-k7')).tripFee;
    expect([tf.amount, tf.households, tf.currentHouseholds]).toEqual([10000, 4, 3]);
  });
  it('개발 도구로 마감하면 마감 시 세대 수를 기록한다', async () => {
    const r = repo(); const ctl = new DevController(r);
    const before = (await r.getBooking('bk-k1')).tripFee;
    expect(ctl.closeGroup('g5').ok).toBe(true);
    const tf = (await r.getBooking('bk-k1')).tripFee;
    expect([tf.kind, tf.households]).toEqual(['confirmed', before.currentHouseholds]);
  });
});

describe('선결제 잔액', () => {
  it('예약금만 낸 예약', async () => {
    const p = (await repo().getBooking('bk-k4')).prepaid;
    expect([p.depositPaid, p.materialPrepaid, p.available]).toEqual([50000, 0, 50000]);
  });
  it('자재 선결제도 있는 예약은 각각 집계하고 잔액에 합산한다', async () => {
    const r = repo(); const ctl = new DevController(r);
    ctl.payAndOrderMaterial('bk-k5');
    const p = (await r.getBooking('bk-k5')).prepaid;
    expect(p.materialPrepaid).toBeGreaterThan(0);
    expect(p.available).toBe(p.depositPaid + p.materialPrepaid);
  });
  it('마감 후 날짜 변경 수수료로 충당된 금액은 잔액에서 빠진다', async () => {
    const r = repo();
    const opts = await r.listChangeOptions('bk-k2');
    const target = opts.find((o) => o.preview.changeFee > 0)!;
    expect(target).toBeTruthy(); // 마감 후 변경이라 기존 확정 출장비 몫이 충당된다
    const p0 = (await r.getBooking('bk-k2')).prepaid;
    const pr = await r.requestChange({ bookingId: 'bk-k2', kind: 'date', targetGroupId: target.group.id, newSlot: target.group.slots[0], reason: '일정', idempotencyKey: 'ch-k2' });
    new DevController(r).providerAgreesChange(pr.id, '10:00');
    await r.respondToProposal(pr.id, 'accept', 'acc-k2');
    const p = (await r.getBooking('bk-k2')).prepaid;
    expect(p.deducted).toBe(target.preview.changeFee);
    expect(p.available).toBe(p0.available + p.changePaid - target.preview.changeFee);
    // 화면 요약도 충당액을 다시 차감하지 않는다
    const { costOf } = await import('../../features/bookings/BookingCostCard');
    const c = costOf(await r.getBooking('bk-k2'));
    expect(c.used.deducted).toBe(target.preview.changeFee);
    expect(c.available).toBe(p.available);
  });
});
