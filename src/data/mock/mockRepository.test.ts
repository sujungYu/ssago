import { COMPARE_REQUESTS_ENABLED } from '../../domain/demoScope';
import { requestInRequestsTab } from '../../domain/reservationTabs';
import { describe, expect, it } from 'vitest';
import { MockRepository } from './mockRepository';
import { RepoError } from '../../domain/errors';

const repo = () => new MockRepository({ latencyMs: 0 });
const code = async (p: Promise<unknown>) => { try { await p; return 'ok'; } catch (e) { return e instanceof RepoError ? e.code : 'other'; } };

describe('탐색·개인정보', () => {
  it('주소가 없으면 공동 예약 가능 여부를 단정하지 않는다', async () => {
    const list = await repo().listProviders({ categoryId: 'c2', addressId: null });
    expect(list.length).toBeGreaterThan(0);
    expect(list.every((p) => p.jointAvailable === null)).toBe(true);
  });
  it('주소 서비스 장애 시에도 단정하지 않는다', async () => {
    const r = repo(); r.__db().settings.addressServiceDown = true;
    const list = await r.listProviders({ categoryId: 'c2', addressId: 'ad-apt' });
    expect(list.every((p) => p.jointAvailable === null)).toBe(true);
  });
  it('공개 그룹에는 타 고객 정보·기준 키가 없다', async () => {
    const d = await repo().getProvider('p1', 'ad-apt');
    const json = JSON.stringify(d.groups);
    expect(json).not.toMatch(/anchor|complex:|radius:|addressId|latitude/);
    expect(d.groups.some((g) => g.id === 'g1')).toBe(true);
  });
  it('자격 없는 주소에서는 그룹이 보이지 않는다', async () => {
    const d = await repo().getProvider('p1', 'ad-far');
    expect(d.groups).toHaveLength(0);
  });
  it('데이터 없는 카테고리는 빈 목록', async () => {
    expect(await repo().listProviders({ categoryId: 'c-none', addressId: 'ad-apt' })).toEqual([]); // 데모 카테고리(c1~c10)는 모두 업체 10곳이 있어, 없는 카테고리 ID로 확인한다
  });
  it('조회 실패는 1회만 발생하고 재시도하면 성공', async () => {
    const r = repo(); r.__db().settings.failNextQuery = true;
    expect(await code(r.listCategories())).toBe('network');
    expect(await code(r.listCategories())).toBe('ok');
  });
});

describe('요청', () => {
  const input = (key: string) => ({ providerId: 'p1', groupId: 'g1', slots: ['09:00'], tasks: [{ serviceId: 'sv-p1-faucet', description: '', photoNames: [] }], addressId: 'ad-apt', addressDetail: '301동 1204호', saveAddressForNext: false, contact: { name: '김온다', phone: '01012345678' }, idempotencyKey: key });
  it('같은 키로 두 번 제출해도 요청은 하나', async () => {
    const r = repo(); const before = (await r.listRequests()).flatMap((b) => b.items).length;
    const a = await r.createRequest(input('k1')); const b = await r.createRequest(input('k1'));
    expect(a.id).toBe(b.id);
    expect((await r.listRequests()).flatMap((x) => x.items).length).toBe(before + 1);
  });
  it('자격 없는 주소로 공동 날짜 요청 불가', async () => {
    expect(await code(repo().createRequest({ ...input('k2'), addressId: 'ad-far' }))).toBe('address_not_eligible');
  });
  it('작업 항목이 없으면 거부', async () => {
    expect(await code(repo().createRequest({ ...input('k3'), tasks: [] }))).toBe('invalid');
  });
  it('업체 등록 작업: 상세에 표시 순서대로 제공, 다른 업체 작업·중복은 거부', async () => {
    const r = repo();
    expect((await r.getProvider('p1', 'ad-apt')).services.map((s) => s.name)).toEqual(['수전 교체', '샤워기 교체', '배수 트랩 교체', '배수구 막힘 수리', '세면대 부속 교체', '실리콘 재시공']);
    expect((await r.getProvider('p3', 'ad-apt')).services[0]).toEqual({ id: 'sv-p3-light', name: '조명 교체' });
    expect(await code(r.createRequest({ ...input('k4'), tasks: [{ serviceId: 'sv-p3-light', description: '', photoNames: [] }] }))).toBe('invalid');
    const one = { serviceId: 'sv-p1-faucet', description: '', photoNames: [] };
    expect(await code(r.createRequest({ ...input('k5'), tasks: [one, one] }))).toBe('invalid');
  });
  it('고른 작업 ID와 요청 당시 작업명을 저장(업체 목록 순서), 이후 업체가 이름을 바꿔도 과거 요청 제목은 그대로', async () => {
    const r = repo();
    const c = await r.createRequest({ ...input('k6'), tasks: [
      { serviceId: 'sv-p1-silicone', description: '욕실 벽', photoNames: [] },
      { serviceId: 'sv-p1-faucet', description: '주방·욕실 각각', photoNames: ['a.jpg'] },
    ] });
    expect(c.tasks.map((t) => [t.serviceId, t.title, t.description, t.photoNames])).toEqual([
      ['sv-p1-faucet', '수전 교체', '주방·욕실 각각', ['a.jpg']], ['sv-p1-silicone', '실리콘 재시공', '욕실 벽', []],
    ]);
    r.__db().providers.find((p) => p.id === 'p1')!.services![0].name = '수전 교체(이름 변경)';
    expect((await r.getRequest(c.id)).request.tasks[0].title).toBe('수전 교체');
    expect((await r.getProvider('p1', 'ad-apt')).services[0].name).toBe('수전 교체(이름 변경)');
  });
  it('이전 직접 입력 요청(작업 ID 없음)도 그대로 조회', async () => {
    const d = await repo().getRequest('rq-3');
    expect(d.request.tasks.map((t) => [t.serviceId, t.title])).toEqual([[undefined, '욕실 세면대 수전 교체'], [undefined, '배수 트랩 교체']]);
  });
});

describe('결제·예약 확정', () => {
  it('승인만으로 예약이 확정되지 않는다', async () => {
    const d = await repo().getRequest('rq-3');
    expect(d.request.status).toBe('approved_pending_payment');
    expect(d.request.bookingId).toBeUndefined();
  });
  it('모의 결제 성공 → 예약 확정, 같은 키 재호출은 중복 거래 없음', async () => {
    const r = repo(); const ap = await r.getApproval('rq-3');
    const a = await r.simulateDepositPayment({ requestId: 'rq-3', approvalVersion: ap.approval.version, idempotencyKey: 'pay-1' });
    expect(a.tx.status).toBe('success'); expect(a.bookingId).toBeTruthy();
    const b = await r.simulateDepositPayment({ requestId: 'rq-3', approvalVersion: ap.approval.version, idempotencyKey: 'pay-1' });
    expect(b.tx.id).toBe(a.tx.id);
    expect(r.__db().transactions.filter((t) => t.requestId === 'rq-3' && t.kind === 'deposit')).toHaveLength(1);
    // 같은 비교 묶음의 다른 업체 요청: 비교 요청을 쓰면 종료, 데모(개별 요청)에서는 그대로
    expect((await r.getRequest('rq-4')).request.status).toBe(COMPARE_REQUESTS_ENABLED ? 'closed_other_booking' : 'approved_pending_payment');
  });
  it('결제 실패 → 예약 미확정, 재시도 가능', async () => {
    const r = repo(); r.__db().settings.payOutcome = 'fail';
    const ap = await r.getApproval('rq-3');
    const f = await r.simulateDepositPayment({ requestId: 'rq-3', approvalVersion: ap.approval.version, idempotencyKey: 'pay-f' });
    expect(f.tx.status).toBe('failed'); expect((await r.getRequest('rq-3')).request.status).toBe('approved_pending_payment');
    r.__db().settings.payOutcome = 'success';
    const ok = await r.simulateDepositPayment({ requestId: 'rq-3', approvalVersion: ap.approval.version, idempotencyKey: 'pay-f2' });
    expect(ok.tx.status).toBe('success');
  });
  it('결과 확인 중(처리 중)에는 새 결제를 만들지 않는다', async () => {
    const r = repo(); r.__db().settings.payOutcome = 'processing';
    const ap = await r.getApproval('rq-3');
    const a = await r.simulateDepositPayment({ requestId: 'rq-3', approvalVersion: ap.approval.version, idempotencyKey: 'pay-p1' });
    expect(a.tx.status).toBe('processing');
    expect(await code(r.simulateDepositPayment({ requestId: 'rq-3', approvalVersion: ap.approval.version, idempotencyKey: 'pay-p2' }))).toBe('payment_in_progress');
    expect(r.__db().transactions.filter((t) => t.requestId === 'rq-3' && t.kind === 'deposit')).toHaveLength(1);
    const done = await r.refreshPayment(a.tx.id);
    expect(done.tx.status).toBe('success');
    expect(r.__db().transactions.filter((t) => t.requestId === 'rq-3' && t.kind === 'deposit' && t.status === 'success')).toHaveLength(1);
  });
  it('조건 버전이 다르면 결제 불가', async () => {
    const r = repo();
    expect(await code(r.simulateDepositPayment({ requestId: 'rq-3', approvalVersion: 99, idempotencyKey: 'pay-v' }))).toBe('version_changed');
  });
  it('만료된 승인은 결제 불가', async () => {
    expect(await code(repo().simulateDepositPayment({ requestId: 'rq-7', approvalVersion: 1, idempotencyKey: 'pay-e' }))).toBe('payment_expired');
  });
  it('종료된 그룹(재확인 필요)은 동의 없이 결제 불가', async () => {
    const r = repo(); const ap = await r.getApproval('rq-10');
    expect(ap.approval.recheck).toBeTruthy();
    expect(await code(r.simulateDepositPayment({ requestId: 'rq-10', approvalVersion: ap.approval.version, idempotencyKey: 'pay-r' }))).toBe('recheck_required');
    const ok = await r.simulateDepositPayment({ requestId: 'rq-10', approvalVersion: ap.approval.version, consentedRecheck: true, idempotencyKey: 'pay-r2' });
    expect(ok.tx.status).toBe('success');
  });
});

describe('취소', () => {
  it('마감 후 고객 취소: 본인 확정 출장비 12,500원만 공제', async () => {
    const r = repo(); const c = await r.getCancelContext('bk-k2');
    expect(c.preview.tripFeeDeduction).toBe(12500); expect(c.preview.refundTotal).toBe(37500);
  });
  it('금액이 바뀐 뒤에는 취소가 막힌다(stale)', async () => {
    expect(await code(repo().cancelBooking({ bookingId: 'bk-k2', expectedRefund: 1, idempotencyKey: 'c0' }))).toBe('stale_cancel');
  });
  it('취소는 한 번만, 재호출 시 중복 환불·공제 없음', async () => {
    const r = repo(); const c = await r.getCancelContext('bk-k2');
    const a = await r.cancelBooking({ bookingId: 'bk-k2', expectedRefund: c.preview.refundTotal, idempotencyKey: 'c1' });
    const b = await r.cancelBooking({ bookingId: 'bk-k2', expectedRefund: c.preview.refundTotal, idempotencyKey: 'c1' });
    expect(b.refund.id).toBe(a.refund.id);
    expect(r.__db().refunds.filter((x) => x.bookingId === 'bk-k2')).toHaveLength(1);
    expect(r.__db().deductions.filter((x) => x.bookingId === 'bk-k2' && x.kind === 'trip_fee')).toHaveLength(1);
    expect(await code(r.cancelBooking({ bookingId: 'bk-k2', expectedRefund: c.preview.refundTotal, idempotencyKey: 'c2' }))).toBe('already_cancelled');
  });
  it('지연 대기 사유 취소는 무료(전액 환불)', async () => {
    const c = await repo().getCancelContext('bk-k3');
    expect(c.preview.tripFeeDeduction).toBe(0);
  });
});

describe('최종 정산', () => {
  it('잔금 62,500원 → 결제 성공 시 정산 완료, 중복 결제 없음', async () => {
    const r = repo(); const s = await r.getFinalStatement('bk-k9');
    expect(s.settlement).toMatchObject({ finalTotal: 112500, delta: 62500, kind: 'pay' });
    const a = await r.confirmSettlement({ bookingId: 'bk-k9', statementVersion: s.statement.version, idempotencyKey: 's1' });
    expect(a.tx?.amount).toBe(62500); expect(a.statement.status).toBe('settled');
    await r.confirmSettlement({ bookingId: 'bk-k9', statementVersion: s.statement.version, idempotencyKey: 's1' });
    expect(r.__db().transactions.filter((t) => t.bookingId === 'bk-k9' && t.kind === 'balance')).toHaveLength(1);
  });
  it('0원은 결제 없이 확인만', async () => {
    const r = repo(); const s = await r.getFinalStatement('bk-k10');
    expect(s.settlement.kind).toBe('zero');
    const a = await r.confirmSettlement({ bookingId: 'bk-k10', statementVersion: s.statement.version, idempotencyKey: 's2' });
    expect(a.tx).toBeUndefined(); expect(a.statement.status).toBe('settled');
  });
  it('차액 환불 7,500원', async () => {
    const r = repo(); const s = await r.getFinalStatement('bk-k11');
    expect(s.settlement).toMatchObject({ kind: 'refund', amount: 7500 });
    const a = await r.confirmSettlement({ bookingId: 'bk-k11', statementVersion: s.statement.version, idempotencyKey: 's3' });
    expect(a.refund?.amount).toBe(7500);
  });
  it('이견 접수 중에는 확인·청구되지 않는다', async () => {
    const r = repo(); const s = await r.getFinalStatement('bk-k12');
    expect(await code(r.confirmSettlement({ bookingId: 'bk-k12', statementVersion: s.statement.version, idempotencyKey: 's4' }))).toBe('change_stale');
  });
});

describe('추가 작업·리뷰', () => {
  it('추가 작업을 거절하면 청구되지 않는다', async () => {
    const r = repo(); const before = r.__db().transactions.length;
    const w = await r.respondToAdditionalWork('aw-1', 'decline');
    expect(w.status).toBe('declined'); expect(r.__db().transactions.length).toBe(before);
  });
  it('정산 완료 건만 리뷰 가능', async () => {
    const r = repo();
    expect(await code(r.createReview({ bookingId: 'bk-k9', rating: 5, body: '좋아요', photoNames: [], idempotencyKey: 'rv0' }))).toBe('not_reviewable');
    expect(await code(r.createReview({ bookingId: 'bk-k13', rating: 5, body: '좋아요', photoNames: [], idempotencyKey: 'rv1' }))).toBe('ok');
  });
});

describe('계정별 목업 상태', () => {
  it('다른 계정으로 바뀌면 이전 계정이 만든 요청이 남지 않고, 같은 계정이면 유지된다', async () => {
    const r = repo();
    r.__switchOwner('user-a');
    const created = await r.createRequest({ providerId: 'p1', groupId: 'g1', slots: ['09:00'], tasks: [{ serviceId: 'sv-p1-shower', description: 'A의 요청', photoNames: [] }], addressId: 'ad-apt', addressDetail: '1동 1호', saveAddressForNext: true, contact: { name: '김온다', phone: '01012345678' }, idempotencyKey: 'own-1' });
    r.__switchOwner('user-a');
    expect((await r.getRequest(created.id)).request.tasks[0].description).toBe('A의 요청');
    r.__switchOwner(null); // 로그아웃
    expect(await code(r.getRequest(created.id))).toBe('not_found');
    r.__switchOwner('user-b');
    const titles = (await r.listRequests()).flatMap((b) => b.items.flatMap((i) => i.request.tasks.map((t) => t.description)));
    expect(titles).not.toContain('A의 요청');
    expect(r.__db().ownerAccountId).toBe('user-b');
  });
  it('계정 전환 시 목업 설정은 유지한다', () => {
    const r = repo(); r.__db().settings.payOutcome = 'fail';
    r.__switchOwner('user-a');
    expect(r.__db().settings.payOutcome).toBe('fail');
  });
});

describe('보낸 요청 필터 조회', () => {
  it.skipIf(!COMPARE_REQUESTS_ENABLED)('전체 기간·전체 상태는 예약으로 이어지지 않은 묶음 전부(전체 목록에서 예약된 묶음만 뺌)', async () => {
    const r = repo();
    const [all, res] = await Promise.all([r.listRequests(), r.queryRequests({})]);
    expect(res.hasAnyRequest).toBe(true);
    const unbooked = all.filter((b) => !b.items.some((i) => i.request.status === 'booked' || i.request.bookingId));
    expect(res.bundles.map((b) => b.bundleId).sort()).toEqual(unbooked.map((b) => b.bundleId).sort());
    expect(unbooked.length).toBeLessThan(all.length);
    expect(res.bundles.every((b) => b.hiddenItemCount === 0)).toBe(true);
  });
  it.skipIf(COMPARE_REQUESTS_ENABLED)('데모(개별 요청): 보낸 요청은 업체별 요청 하나씩, 건수 = 요청 수, 비교 결과(다른 업체 예약으로 종료)는 빼고 묶음 데이터는 보존', async () => {
    const r = repo();
    const res = await r.queryRequests({});
    expect(res.bundles.every((b) => b.items.length === 1 && b.hiddenItemCount === 0)).toBe(true);
    const ids = res.bundles.map((b) => b.items[0].request.id);
    expect(ids).toEqual(expect.arrayContaining(['rq-3', 'rq-4']));
    expect(ids).not.toContain('rq-8');
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.sort()).toEqual(r.__db().requests.filter(requestInRequestsTab).map((x) => x.id).sort());
    // 요청 취소(철회)하면 보낸 요청에서 빠지고 완료·취소 탭의 요청 취소로(spec 5.47). 같은 묶음의 다른 업체 요청(rq-3)은 보낸 요청에 그대로
    await r.withdrawRequest('rq-4');
    expect((await r.queryRequests({})).bundles.flatMap((b) => b.items).map((i) => i.request.id)).not.toContain('rq-4');
    const past = await r.queryBookings({ tab: 'past', statusGroup: 'request_cancelled' });
    expect(past.cancelledRequests.map((i) => i.request.id)).toContain('rq-4');
    expect(past.cancelledRequests.some((i) => i.request.id === 'rq-3')).toBe(false);
    expect((await r.queryRequests({})).bundles.flatMap((b) => b.items).map((i) => i.request.id)).toContain('rq-3');
    expect((await r.getBundle('b-sink')).items).toHaveLength(2); // 원본 묶음 데이터 보존
  });
  it.skipIf(!COMPARE_REQUESTS_ENABLED)('비교 묶음은 조건에 맞는 업체 요청만 보여주고, 묶음 상세에는 모두 남는다', async () => {
    const r = repo();
    // b-sink: rq-3·rq-4 모두 승인 완료·결제 대기. 한쪽을 철회해 상태를 나눈다.
    await r.withdrawRequest('rq-4');
    const res = await r.queryRequests({ statuses: ['withdrawn'] });
    const sink = res.bundles.find((b) => b.bundleId === 'b-sink')!;
    expect(sink.items.map((i) => i.request.id)).toEqual(['rq-4']);
    expect(sink.hiddenItemCount).toBe(1);
    expect((await r.getBundle('b-sink')).items).toHaveLength(2);
  });
  it('승인 완료·결제 대기는 보낸 요청에 남고, 예약 확정(booked)은 보낸 요청에 없다(승인만으로 옮기지 않음)', async () => {
    const r = repo();
    const pending = await r.queryRequests({ statuses: ['approved_pending_payment'] });
    const booked = await r.queryRequests({ statuses: ['booked'] });
    expect(pending.bundles.flatMap((b) => b.items).every((i) => i.request.status === 'approved_pending_payment')).toBe(true);
    expect(pending.bundles.length).toBeGreaterThan(0);
    expect(booked.bundles).toEqual([]);
  });
  it('조건에 맞는 요청이 없으면 빈 목록이지만 요청은 있다', async () => {
    const res = await repo().queryRequests({ createdFrom: '2025-01-01', createdTo: '2025-01-31' });
    expect(res).toEqual({ bundles: [], hasAnyRequest: true });
  });
  it('요청 자체가 없으면 hasAnyRequest=false', async () => {
    const r = repo(); r.__db().requests = [];
    expect(await r.queryRequests({ statuses: ['booked'] })).toEqual({ bundles: [], hasAnyRequest: false });
  });
  it('필터 조회는 요청 데이터·상태를 바꾸지 않는다', async () => {
    const r = repo();
    const before = JSON.stringify(r.__db().requests);
    await r.queryRequests({ statuses: ['booked'], createdFrom: '2026-10-10', createdTo: '2026-10-12' });
    expect(JSON.stringify(r.__db().requests)).toBe(before);
  });
  it('조회 실패는 빈 결과가 아니라 오류', async () => {
    const r = repo(); r.__db().settings.failNextQuery = true;
    expect(await code(r.queryRequests({}))).toBe('network');
  });
});
