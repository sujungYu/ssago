import { describe, expect, it } from 'vitest';
import { MockRepository } from './mockRepository';
import { RepoError } from '../../domain/errors';
import { DevController } from '../../dev/devController';

const repo = () => new MockRepository({ latencyMs: 0 });
const ids = (r: { items: { booking: { id: string } }[] }) => r.items.map((x) => x.booking.id).sort();
const code = async (p: Promise<unknown>) => { try { await p; return 'ok'; } catch (e) { return e instanceof RepoError ? e.code : 'other'; } };

describe('내 예약 조회(queryBookings)', () => {
  it('두 탭 기본 전체 조회는 기존 목록과 같은 구성', async () => {
    const r = repo();
    const all = await r.listBookings();
    const active = await r.queryBookings({ tab: 'active' });
    const past = await r.queryBookings({ tab: 'past' });
    expect(active.items.length + past.items.length).toBe(all.length);
    expect(ids(past)).toEqual(['bk-k13', 'bk-k14', 'bk-k15', 'bk-k16', 'bk-k17', 'bk-k18']);
    expect(active.hasAnyInTab && past.hasAnyInTab).toBe(true);
    // 기존 정렬 유지: 확인할 내용이 있는 예약이 먼저
    const att = active.items.map((x) => !!x.attention);
    expect(att.indexOf(false) === -1 || att.slice(att.indexOf(false)).every((x) => !x)).toBe(true);
  });
  it('확인 필요는 실제 미처리 데이터 기준(제안·자재·추가 작업·지연·최종 금액)', async () => {
    const res = await repo().queryBookings({ tab: 'active', actionRequiredOnly: true });
    expect(ids(res)).toEqual(['bk-k10', 'bk-k11', 'bk-k3', 'bk-k4', 'bk-k5', 'bk-k6', 'bk-k9']);
    expect(ids(res)).not.toContain('bk-k12'); // 정산 대기(금액 협의 중) — 고객 앱 행동 없음
  });
  it('처리·철회된 제안은 확인 필요에서 빠진다', async () => {
    const r = repo();
    // 기존 방문 불가 제안에 다른 일정을 요청하면 업체 응답 대기(고객 행동 아님)
    await r.requestOtherSchedule({ proposalId: 'pr-k4', date: '2026-10-22', time: '10:00', idempotencyKey: 'oth-f' });
    expect(ids(await r.queryBookings({ tab: 'active', actionRequiredOnly: true }))).not.toContain('bk-k4');
    // 고객이 낸 변경 요청(업체 응답 대기)·철회는 고객 행동이 아님
    const p = await r.requestChange({ bookingId: 'bk-k1', kind: 'time', newSlot: '16:00–19:00', reason: '일정', idempotencyKey: 'chg-f' });
    expect(ids(await r.queryBookings({ tab: 'active', actionRequiredOnly: true }))).not.toContain('bk-k1');
    new DevController(r).providerAgreesChange(p.id, '17:00'); // 업체가 동의 → 고객 최종 확인 필요
    expect(ids(await r.queryBookings({ tab: 'active', actionRequiredOnly: true }))).toContain('bk-k1');
  });
  it('방문일 기준: 제안 확인 대기 중에는 기존 날짜, 수락하면 바뀐 날짜', async () => {
    const r = repo();
    const on = (d: string) => r.queryBookings({ tab: 'active', visitFrom: d, visitTo: d }).then(ids);
    expect(await on('2026-10-14')).toContain('bk-k4');
    expect(await on('2026-10-19')).not.toContain('bk-k4');
    await r.respondToProposal('pr-k4', 'accept', 'acc-f');
    expect(await on('2026-10-19')).toContain('bk-k4');
    expect(await on('2026-10-14')).not.toContain('bk-k4');
  });
  it('지연 안내는 기준 날짜를 바꾸지 않는다 · 다일 작업은 최초 방문일 기준', async () => {
    const r = repo();
    expect(ids(await r.queryBookings({ tab: 'active', visitFrom: '2026-10-13', visitTo: '2026-10-13' }))).toContain('bk-k3');
    expect(ids(await r.queryBookings({ tab: 'active', visitFrom: '2026-10-20', visitTo: '2026-10-20' }))).not.toContain('bk-k7'); // 후속 방문일(10-20)이 아니라
    expect(ids(await r.queryBookings({ tab: 'active', visitFrom: '2026-10-14', visitTo: '2026-10-14' }))).toContain('bk-k7'); // 최초 방문일(10-14)
  });
  it('취소 예약은 취소 직전 확정 방문일 기준', async () => {
    const r = repo();
    const ctx = await r.getCancelContext('bk-k1');
    await r.cancelBooking({ bookingId: 'bk-k1', expectedRefund: ctx.preview.refundTotal, idempotencyKey: 'cx-f' });
    const res = await r.queryBookings({ tab: 'past', statusGroup: 'cancelled', visitFrom: '2026-10-19', visitTo: '2026-10-19' });
    expect(ids(res)).toEqual(['bk-k1']);
  });
  it('방문일 누락은 추정하지 않고 날짜 조건에서 제외(수를 알림), 전체 기간에는 유지', async () => {
    const r = repo();
    r.__db().bookings.find((b) => b.id === 'bk-k2')!.visitDate = '';
    const dated = await r.queryBookings({ tab: 'active', visitFrom: '2026-10-01', visitTo: '2026-10-31' });
    expect(ids(dated)).not.toContain('bk-k2');
    expect(dated.excludedMissingVisitDate).toBe(1);
    expect(ids(await r.queryBookings({ tab: 'active' }))).toContain('bk-k2');
  });
  it('결과 없음과 예약 없음 구분 · 조회 오류는 빈 결과가 아님', async () => {
    const r = repo();
    expect(await r.queryBookings({ tab: 'past', visitFrom: '2025-01-01', visitTo: '2025-01-02' })).toMatchObject({ items: [], hasAnyInTab: true });
    r.__db().bookings = r.__db().bookings.filter((b) => b.status !== 'cancelled' && b.workStatus !== 'completed');
    expect(await r.queryBookings({ tab: 'past' })).toMatchObject({ items: [], hasAnyInTab: false });
    r.__db().settings.failNextQuery = true;
    expect(await code(r.queryBookings({ tab: 'active' }))).toBe('network');
  });
  it('필터 조회는 예약 데이터를 바꾸지 않는다', async () => {
    const r = repo();
    const before = JSON.stringify(r.__db().bookings);
    await r.queryBookings({ tab: 'active', statusGroup: 'scheduled', actionRequiredOnly: true, visitFrom: '2026-10-12', visitTo: '2026-10-18' });
    expect(JSON.stringify(r.__db().bookings)).toBe(before);
  });
});
