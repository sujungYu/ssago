import { describe, expect, it } from 'vitest';
import { MockRepository } from './mockRepository';
import { DevController } from '../../dev/devController';

const repo = () => new MockRepository({ latencyMs: 0 });
/** ‘확인 필요’ 필터 결과 카드 수(탭 전체, 다른 조건 없음) */
const filterCounts = async (r: MockRepository) => ({
  requests: (await r.queryRequests({ actionRequiredOnly: true })).bundles.length,
  active: (await r.queryBookings({ tab: 'active', actionRequiredOnly: true })).items.length,
});

describe('확인 필요 건수(spec 5.48)', () => {
  it('보낸 요청·확정된 예약 = ‘확인 필요’ 필터 결과 카드 수, 0보다 크다(시드)', async () => {
    const r = repo();
    const c = await r.getTodoCounts();
    expect(c).toEqual(await filterCounts(r));
    expect(c.requests).toBeGreaterThan(0);
    expect(c.active).toBeGreaterThan(0);
  });
  it('할 일이 여러 개인 카드도 1건', async () => {
    const r = repo();
    const before = (await r.getTodoCounts()).active;
    // bk-k6(추가 작업 동의 대기)에 자재 주문 동의 대기도 더한다 → 할 일 2개인 카드
    const db = r.__db();
    db.materials.push({ ...structuredClone(db.materials.find((m) => m.id === 'mt-1')!), id: 'mt-multi', bookingId: 'bk-k6' });
    const k6 = (await r.queryBookings({ tab: 'active', actionRequiredOnly: true })).items.find((it) => it.booking.id === 'bk-k6')!;
    expect(k6.display.actions.length).toBeGreaterThan(1);
    expect((await r.getTodoCounts()).active).toBe(before);
  });
  it('조회(목록·상세를 연 것)만으로는 줄지 않고, 실제 상태 변경(결제 성공·철회·기한 만료·응답)에 맞춰 바뀐다', async () => {
    const r = repo();
    const dev = new DevController(r);
    const before = await r.getTodoCounts();
    await r.getRequest('rq-3'); await r.getBooking('bk-k6'); await r.queryRequests({}); // 열어 보기만
    expect(await r.getTodoCounts()).toEqual(before);
    // 예약금 결제 대기 rq-4 철회 → 보낸 요청 확인 필요 −1(요청 취소는 완료·취소, 할 일 없음)
    await r.withdrawRequest('rq-4');
    expect((await r.getTodoCounts()).requests).toBe(before.requests - 1);
    // rq-10 기한 만료 → −1
    dev.expireApproval('rq-10');
    expect((await r.getTodoCounts()).requests).toBe(before.requests - 2);
    // 추가 작업 동의(bk-k6) → 확정된 예약 −1
    const add = r.__db().additionalWorks.find((w) => w.bookingId === 'bk-k6' && w.status === 'proposed')!;
    await r.respondToAdditionalWork(add.id, 'agree');
    const after = await r.getTodoCounts();
    expect(after.active).toBe(before.active - 1);
    expect(after).toEqual(await filterCounts(r));
  });
  it('개발용 ‘다음 조회 실패’를 소비하지 않는다(목록 조회 실패 재현 유지)', async () => {
    const r = repo();
    r.__db().settings.failNextQuery = true;
    await r.getTodoCounts();
    await expect(r.queryRequests({})).rejects.toMatchObject({ code: 'network' });
  });
});
