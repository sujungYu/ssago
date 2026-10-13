import { describe, expect, it } from 'vitest';
import { MockRepository } from './mockRepository';
import { RepoError } from '../../domain/errors';
import { isWithinSlots } from '../../domain/visitTime';
import { DevController } from '../../dev/devController';

// 고객 가능 시간(범위) / 업체 제안 방문 시각 / 예약 방문 시각 구분과 일정 변경·지연 흐름
const repo = () => new MockRepository({ latencyMs: 0 });
const code = async (p: Promise<unknown>) => { try { await p; return 'ok'; } catch (e) { return e instanceof RepoError ? e.code : 'other'; } };

describe('시드 데이터', () => {
  it('모든 승인의 업체 제안 방문 시각이 그 요청의 고객 가능 시간 안에 있다', () => {
    const db = repo().__db();
    for (const ap of db.approvals) {
      const req = db.requests.find((r) => r.id === ap.requestId)!;
      expect(ap.visitTime, ap.requestId).toBeTruthy();
      expect(isWithinSlots(ap.visitTime!, req.slots), `${ap.requestId} ${ap.visitTime} / ${req.slots}`).toBe(true);
    }
  });
  it('모든 예약은 승인에서 제안된 시각으로 확정돼 있고, 고객 가능 시간을 따로 가진다', () => {
    const db = repo().__db();
    for (const b of db.bookings) {
      const ap = db.approvals.find((a) => a.requestId === b.requestId)!;
      expect(b.visitTime, b.id).toBe(ap.visitTime);
      expect(b.customerSlots.length, b.id).toBeGreaterThan(0);
    }
  });
});

describe('결제 전 제안 시각 → 결제 후 확정 시각', () => {
  it('결제 전에는 승인에만 제안 시각이 있고, 결제 성공 후 그 시각으로 예약이 확정된다', async () => {
    const r = repo();
    const ap = await r.getApproval('rq-4'); // 고객 가능 시간 13:00–16:00, 업체 제안 14:00
    expect(ap.request.slots).toEqual(['13:00–16:00']);
    expect(ap.approval.visitTime).toBe('14:00');
    expect(ap.request.bookingId).toBeUndefined();
    const res = await r.simulateDepositPayment({ requestId: 'rq-4', approvalVersion: ap.approval.version, idempotencyKey: 'pay-vt' });
    const b = (await r.getBooking(res.bookingId!)).booking;
    expect(b.visitDate).toBe('2026-10-20');
    expect(b.visitTime).toBe('14:00');
    expect(b.customerSlots).toEqual(['13:00–16:00']);
    // 예약 알림·목록에도 같은 방문 시각
    expect(r.__db().notices[0].title).toBe('예약이 확정됐어요 · 방문 예정 10월 20일 (화) 14:00');
    const item = (await r.listBookings()).find((x) => x.booking.id === b.id)!;
    expect(item.booking.visitTime).toBe('14:00');
  });
  it('승인에 방문 시각이 없으면 예약도 비워 둔다(범위 시작·중간값으로 추정하지 않음)', async () => {
    const r = repo();
    delete r.__db().approvals.find((a) => a.requestId === 'rq-4')!.visitTime;
    const ap = await r.getApproval('rq-4');
    const res = await r.simulateDepositPayment({ requestId: 'rq-4', approvalVersion: ap.approval.version, idempotencyKey: 'pay-nt' });
    const b = (await r.getBooking(res.bookingId!)).booking;
    expect(b.visitTime).toBeUndefined();
    expect(r.__db().notices[0].title).toContain('방문 시각 확인 필요');
  });
  it('업체 승인(모의)은 고객 가능 시간 밖이거나 시각이 없으면 거절된다', () => {
    const r = repo(); const ctl = new DevController(r);
    expect(ctl.approveRequest('rq-1', '').ok).toBe(false);
    expect(ctl.approveRequest('rq-1', '20:00').ok).toBe(false); // rq-1 가능 시간 09:00–12:00, 13:00–16:00
    expect(r.__db().requests.find((x) => x.id === 'rq-1')!.status).toBe('reviewing');
    expect(ctl.approveRequest('rq-1', '15:30').ok).toBe(true);
    expect(r.__db().approvals.find((a) => a.requestId === 'rq-1')!.visitTime).toBe('15:30');
  });
});

describe('업체 일정 변경 제안', () => {
  it('수락 전에는 기존 시각 유지, 무응답(시간 경과)도 수락으로 보지 않는다', async () => {
    const r = repo(); const ctl = new DevController(r);
    const before = (await r.getBooking('bk-k4')).booking;
    expect([before.visitDate, before.visitTime]).toEqual(['2026-10-14', '14:00']);
    ctl.setNow(new Date(new Date(r.now()).getTime() + 3 * 86400000).toISOString());
    const after = (await r.getBooking('bk-k4')).booking;
    expect([after.visitDate, after.visitTime, after.status]).toEqual(['2026-10-14', '14:00', 'confirmed']);
    expect(r.__db().proposals.find((p) => p.id === 'pr-k4')!.status).toBe('proposed');
  });
  it('수락하면 새 시각으로 바뀌고 기존 시각·사유·동의 시각을 기록한다. 고객 가능 시간은 고치지 않는다', async () => {
    const r = repo();
    await r.respondToProposal('pr-k4', 'accept', 'acc-1');
    const b = (await r.getBooking('bk-k4')).booking;
    expect([b.visitDate, b.visitTime]).toEqual(['2026-10-19', '10:00']);
    expect(b.customerSlots).toEqual(['13:00–16:00']); // 가능 시간 밖 제안이어도 기존 범위는 그대로
    expect(b.scheduleChanges).toEqual([{
      proposalId: 'pr-k4', from: { date: '2026-10-14', time: '14:00' }, to: { date: '2026-10-19', time: '10:00' },
      reason: '이전 작업이 길어져 같은 날 방문이 어려워졌어요.', consentedAt: r.now(),
    }]);
  });
  it('거절하면 자동 변경·자동 취소 없이 예약 유지 → 업체 사유 무료 취소를 고객이 직접 선택할 수 있다', async () => {
    const r = repo();
    const res = await r.respondToProposal('pr-k4', 'reject', 'rej-1');
    expect(res.refund).toBeUndefined();
    const b = (await r.getBooking('bk-k4')).booking;
    expect([b.status, b.visitDate, b.visitTime]).toEqual(['confirmed', '2026-10-14', '14:00']);
    expect(r.__db().refunds.filter((x) => x.bookingId === 'bk-k4')).toHaveLength(0);
    const ctx = await r.getCancelContext('bk-k4');
    expect(ctx.cause).toBe('policy_free');
    expect(ctx.causeLabel).toMatch(/거절/);
    const done = await r.cancelBooking({ bookingId: 'bk-k4', expectedRefund: ctx.preview.refundTotal, idempotencyKey: 'cx-1' });
    expect(done.refund.amount).toBe(ctx.preview.refundTotal);
  });
  it('같은 날 시각 변경(14:00 → 15:00)도 수락해야만 반영된다', async () => {
    const r = repo(); const ctl = new DevController(r);
    expect(ctl.proposeProviderChange('bk-k1', '', '15:00').ok).toBe(true);
    const p = r.__db().proposals.at(-1)!;
    expect(p.oldVisit).toEqual({ date: '2026-10-19', time: '14:00' });
    expect((await r.getBooking('bk-k1')).booking.visitTime).toBe('14:00');
    await r.respondToProposal(p.id, 'accept', 'acc-2');
    const b = (await r.getBooking('bk-k1')).booking;
    expect([b.visitDate, b.visitTime]).toEqual(['2026-10-19', '15:00']);
    expect(r.__db().notices[0].title).toBe('일정 변경이 확정됐어요 · 방문 예정 10월 19일 (월) 15:00');
  });
});

describe('고객 일정 변경 요청', () => {
  it('요청 단계에는 새 방문 시각이 없고, 업체가 시각을 제안한 뒤 고객이 수락해야 반영된다', async () => {
    const r = repo(); const ctl = new DevController(r);
    const p = await r.requestChange({ bookingId: 'bk-k1', kind: 'time', newSlot: '16:00–19:00', reason: '퇴근 후로', idempotencyKey: 'chg-1' });
    expect(p.newVisit.time).toBeUndefined();
    expect(p.newVisit.wishSlot).toBe('16:00–19:00');
    expect(await code(r.respondToProposal(p.id, 'accept', 'acc-x'))).toBe('change_stale'); // 업체 동의 전
    expect(ctl.providerAgreesChange(p.id, '').ok).toBe(false);
    expect(ctl.providerAgreesChange(p.id, '17:30').ok).toBe(true);
    expect((await r.getBooking('bk-k1')).booking.visitTime).toBe('14:00');
    await r.respondToProposal(p.id, 'accept', 'acc-3');
    expect((await r.getBooking('bk-k1')).booking.visitTime).toBe('17:30');
  });
  it('거절하면 기존 일정 유지', async () => {
    const r = repo(); const ctl = new DevController(r);
    const p = await r.requestChange({ bookingId: 'bk-k1', kind: 'time', newSlot: '16:00–19:00', reason: '퇴근 후로', idempotencyKey: 'chg-2' });
    ctl.providerAgreesChange(p.id, '17:30');
    await r.respondToProposal(p.id, 'reject', 'rej-2');
    const b = (await r.getBooking('bk-k1')).booking;
    expect([b.status, b.visitTime]).toEqual(['confirmed', '14:00']);
  });
});

describe('당일 지연 안내', () => {
  it('변경 도착 예상은 따로 두고 예약 방문 시각을 덮어쓰지 않는다', async () => {
    const r = repo();
    const { delay, booking } = await r.getDelay('dl-k3');
    expect(delay.originalVisitTime).toBe('14:00');
    expect(new Date(delay.newEta).toISOString()).toBe('2026-10-13T05:20:00.000Z'); // 한국 14:20
    expect(booking.visitTime).toBe('14:00');
    await r.respondToDelayWait('dl-k3');
    expect((await r.getBooking('bk-k3')).booking.visitTime).toBe('14:00');
  });
  it('무응답은 선택으로 처리하지 않는다(시간이 지나도 열린 채로 남고 예약은 그대로)', async () => {
    const r = repo(); const ctl = new DevController(r);
    ctl.setNow(new Date(new Date(r.now()).getTime() + 86400000).toISOString());
    const d = r.__db().delays.find((x) => x.id === 'dl-k3')!;
    expect(d.choice).toBeUndefined();
    const b = (await r.getBooking('bk-k3')).booking;
    expect([b.status, b.visitTime]).toEqual(['confirmed', '14:00']);
  });
  it('개발 도구로 만든 지연도 예약 시각을 바꾸지 않는다', async () => {
    const r = repo(); const ctl = new DevController(r);
    expect(ctl.startDelay('bk-k1').ok).toBe(true);
    const d = r.__db().delays.at(-1)!;
    expect(d.originalVisitTime).toBe('14:00');
    expect((await r.getBooking('bk-k1')).booking.visitTime).toBe('14:00');
  });
});
