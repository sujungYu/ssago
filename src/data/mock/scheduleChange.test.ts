import { describe, expect, it } from 'vitest';
import { MockRepository } from './mockRepository';
import { RepoError } from '../../domain/errors';
import { DevController } from '../../dev/devController';

const repo = () => new MockRepository({ latencyMs: 0 });
const code = async (p: Promise<unknown>) => { try { await p; return 'ok'; } catch (e) { return e instanceof RepoError ? e.code : 'other'; } };

describe('일정 변경: 기존 일정 방문 가능 여부별 흐름', () => {
  it('B: 다른 일정 요청 → 협의 중(희망 일정은 확정 아님) → 업체 재제안 → 고객 수락으로만 확정, 출장비 유지·기록 보존', async () => {
    const r = repo(); const ctl = new DevController(r);
    const before = await r.getBooking('bk-k4');
    const fee = before.tripFee.amount;
    const req = await r.requestOtherSchedule({ proposalId: 'pr-k4', date: '2026-10-22', time: '10:00', idempotencyKey: 'oth-1' });
    expect(await r.requestOtherSchedule({ proposalId: 'pr-k4', date: '2026-10-22', time: '10:00', idempotencyKey: 'oth-1' })).toEqual(req); // 같은 시도는 한 번
    let d = await r.getBooking('bk-k4');
    expect([d.schedule.kind, d.schedule.label]).toEqual(['negotiating', '기존 일정 방문 불가 · 새 일정 협의 중']);
    expect([d.booking.visitDate, d.booking.visitTime]).toEqual(['2026-10-14', '14:00']); // 희망 일정이 기존 기록을 덮어쓰지 않음
    const old = r.__db().proposals.find((p) => p.id === 'pr-k4')!;
    expect([old.status, old.customerReply]).toEqual(['rejected', 'other_requested']);
    expect([req.origin, req.status, req.replyTo, req.newVisit.date, req.newVisit.wishSlot, req.cost.tripFeeCharged, req.cost.additionalDeposit]).toEqual(['customer', 'requested', 'pr-k4', '2026-10-22', '10:00', 0, 0]);
    expect((await r.getCancelContext('bk-k4')).cause).toBe('policy_free'); // 협의 중에도 업체 사유 무료 취소
    // 이전 제안에는 다시 응답할 수 없다
    expect(await code(r.respondToProposal('pr-k4', 'accept', 'acc-old'))).toBe('change_stale');
    // 업체 재제안 → 고객 수락
    expect(ctl.providerAgreesChange(req.id, '10:30').ok).toBe(true);
    d = await r.getBooking('bk-k4');
    expect([d.schedule.kind, d.schedule.oldVisitUnavailable]).toEqual(['provider_proposed', true]);
    await r.respondToProposal(req.id, 'accept', 'acc-1');
    d = await r.getBooking('bk-k4');
    expect([d.booking.visitDate, d.booking.visitTime, d.booking.workStatus, d.booking.status, d.schedule.kind]).toEqual(['2026-10-22', '10:30', 'scheduled', 'confirmed', 'normal']);
    expect(d.tripFee.amount).toBe(fee); // 업체 사유: 기존 확정 출장비 유지, 추가 결제 없음
    expect(r.__db().transactions.filter((t) => t.bookingId === 'bk-k4' && t.kind === 'change_shortfall')).toHaveLength(0);
    expect(d.booking.scheduleChanges?.at(-1)).toMatchObject({ from: { date: '2026-10-14', time: '14:00' }, to: { date: '2026-10-22', time: '10:30' } });
    expect(r.__db().bookings.filter((b) => b.requestId === d.booking.requestId)).toHaveLength(1); // 새 예약 중복 생성 없음
  });
  it('B: 새 일정 수락 → 새 날짜·시각으로 확정, 방문 예정', async () => {
    const r = repo();
    await r.respondToProposal('pr-k4', 'accept', 'acc-b');
    const d = await r.getBooking('bk-k4');
    expect([d.booking.visitDate, d.booking.visitTime, d.booking.workStatus, d.schedule.kind, d.freeCancel]).toEqual(['2026-10-19', '10:00', 'scheduled', 'normal', null]);
  });
  it('B 미응답: 예약 유지·자동 확정·완료·취소 없음(시간이 지나도)', async () => {
    const r = repo(); const ctl = new DevController(r);
    ctl.setNow('2026-10-20T12:00:00+09:00');
    const d = await r.getBooking('bk-k4');
    expect([d.booking.status, d.booking.workStatus, d.booking.visitDate, d.schedule.label]).toEqual(['confirmed', 'scheduled', '2026-10-14', '기존 일정 방문 불가 · 새 일정 확인 필요']);
    expect(r.__db().proposals.find((p) => p.id === 'pr-k4')!.status).toBe('proposed');
  });
  it('확인 필요(방문 가능 여부 미지정): 기존 방문 가능으로 처리하지 않음(거절 불가, 다른 일정 요청 가능)', async () => {
    const r = repo(); const ctl = new DevController(r);
    ctl.proposeProviderChange('bk-k1', '2026-10-21', '10:00');
    const p = r.__db().proposals.at(-1)!;
    const d = await r.getBooking('bk-k1');
    expect([d.schedule.oldVisit, d.schedule.label]).toEqual(['unknown', '일정 변경 제안 · 기존 일정 방문 가능 여부 확인 필요']);
    expect(await code(r.respondToProposal(p.id, 'reject', 'rj-u'))).toBe('invalid');
    expect(await code(r.requestOtherSchedule({ proposalId: p.id, date: '2026-10-23', time: '09:00', idempotencyKey: 'o-u' }))).toBe('ok');
  });
  it('희망 일정 검증·취소된 예약·이미 응답한 제안', async () => {
    const r = repo();
    expect(await code(r.requestOtherSchedule({ proposalId: 'pr-k4', date: '2026-10-13', time: '10:00', idempotencyKey: 'o-1' }))).toBe('invalid'); // 오늘 이전
    expect(await code(r.requestOtherSchedule({ proposalId: 'pr-k4', date: '2026-10-22', time: '25:00', idempotencyKey: 'o-2' }))).toBe('invalid');
    expect(r.__db().proposals.find((p) => p.id === 'pr-k4')!.status).toBe('proposed'); // 실패 시 기존 상태 유지
    await r.respondToProposal('pr-k4', 'accept', 'a-1');
    expect(await code(r.requestOtherSchedule({ proposalId: 'pr-k4', date: '2026-10-22', time: '10:00', idempotencyKey: 'o-3' }))).toBe('change_stale');
  });
});
