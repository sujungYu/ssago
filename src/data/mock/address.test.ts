import { describe, expect, it } from 'vitest';
import { MockRepository } from './mockRepository';
import { RepoError } from '../../domain/errors';
import { detailError, isSameBuilding, savedDetailFor } from '../../domain/address';
import { DevController } from '../../dev/devController';
import type { NewRequestInput } from '../repositories/types';

const repo = () => new MockRepository({ latencyMs: 0 });
const code = async (p: Promise<unknown>) => { try { await p; return 'ok'; } catch (e) { return e instanceof RepoError ? e.code : 'other'; } };
let n = 0;
const req = (p: Partial<NewRequestInput> = {}): NewRequestInput => ({
  providerId: 'p1', groupId: null, newDateWish: '2026-10-22', slots: ['09:00', '10:00'], tasks: [{ serviceId: 'sv-p1-faucet', description: '', photoNames: [] }],
  addressId: 'ad-apt', addressDetail: '301동 1204호', saveAddressForNext: false, contact: { name: '김온다', phone: '010-1234-5678' }, idempotencyKey: `addr-${++n}`, ...p,
});

describe('주소 규칙', () => {
  const saved = { addressId: 'ad-apt', line1: '서울 가상구 햇살로 100 (햇살마을 3단지)', detail: '301동 1204호', savedAt: '' };
  it('같은 건물(식별자+기본 주소)일 때만 저장 상세 주소를 쓴다', () => {
    expect(savedDetailFor(saved, { id: 'ad-apt', line1: saved.line1 })).toBe('301동 1204호');
    // 같은 단지의 다른 건물
    expect(savedDetailFor(saved, { id: 'ad-apt-b', line1: '서울 가상구 햇살로 102 (햇살마을 3단지 상가동)' })).toBeNull();
    // 식별자가 같아도 기본 주소가 바뀌었으면 연결하지 않는다
    expect(isSameBuilding(saved, { id: 'ad-apt', line1: '서울 가상구 햇살로 101' })).toBe(false);
    expect(savedDetailFor(null, { id: 'ad-apt', line1: saved.line1 })).toBeNull();
  });
  it('상세 주소 형식(동·호)을 강제하지 않고, 단독주택은 비워도 된다', () => {
    expect(detailError('house', '')).toBeNull();
    expect(detailError('apartment', '2층 안쪽 집')).toBeNull();
    expect(detailError('apartment', '  ')).toMatch(/상세 주소/);
  });
});

describe('탐색 주소(업체 찾기)', () => {
  it('처음엔 없고, 저장하면 다음 조회(재접속)에서 기본값으로 돌려준다', async () => {
    const r = repo();
    expect(await r.getExploreAddress()).toBeNull();
    await r.setExploreAddress('ad-house');
    expect((await r.getExploreAddress())?.id).toBe('ad-house');
    // 같은 저장소 상태로 다시 연결(새로고침)해도 유지
    const again = new MockRepository({ latencyMs: 0, seed: structuredClone(r.__db()) });
    expect((await again.getExploreAddress())?.id).toBe('ad-house');
  });
  it('탐색 주소에는 동·호수가 없다', async () => {
    expect(Object.keys((await repo().setExploreAddress('ad-apt')))).not.toContain('detail');
  });
  it('최근 예약 주소로 자동으로 바꾸지 않는다(결제·예약 확정 뒤에도 그대로)', async () => {
    const r = repo();
    await r.setExploreAddress('ad-house');
    const ap = await r.getApproval('rq-3'); // 햇살마을 요청
    await r.simulateDepositPayment({ requestId: 'rq-3', approvalVersion: ap.approval.version, idempotencyKey: 'pay-a' });
    expect((await r.getExploreAddress())?.id).toBe('ad-house');
  });
});

describe('탐색 주소로 업체 목록·공동 예약 후보 조회', () => {
  it('같은 카테고리라도 주소에 따라 공동 예약 후보가 달라진다(목업: 가상 주소록의 기준 키 일치로만 판정)', async () => {
    const r = repo();
    const near = await r.listProviders({ categoryId: 'c2', addressId: 'ad-apt' });
    const far = await r.listProviders({ categoryId: 'c2', addressId: 'ad-far' });
    expect(near.some((p) => p.jointAvailable)).toBe(true);
    expect(far.every((p) => p.jointAvailable === false && !p.nextJoint)).toBe(true);
  });
  it('주소가 없거나 확인할 수 없으면 참여 가능 여부를 단정하지 않는다(null)', async () => {
    const r = repo();
    for (const addressId of [null, 'ad-gone']) {
      const list = await r.listProviders({ categoryId: 'c2', addressId });
      expect(list.every((p) => p.jointAvailable === null && !p.nextJoint)).toBe(true);
    }
    expect(await code(r.getAddress('ad-gone'))).toBe('not_found');
  });
  it('탐색 주소를 바꿔도 기존 요청·예약 방문 주소와 재사용 상세 주소는 그대로다', async () => {
    const r = repo();
    const before = structuredClone(r.__db());
    await r.setExploreAddress('ad-far');
    const after = r.__db();
    expect(after.requests.map((x) => x.visitAddress)).toEqual(before.requests.map((x) => x.visitAddress));
    expect(after.bookings.map((x) => x.visitAddress)).toEqual(before.bookings.map((x) => x.visitAddress));
    expect(after.savedVisitAddress).toEqual(before.savedVisitAddress);
  });
});

describe('신청서 주소 저장', () => {
  it('저장 선택 시 제출 성공과 함께 재사용 주소를 저장하고, 이번 요청에는 정확한 방문 주소를 보존한다', async () => {
    const r = repo();
    const created = await r.createRequest(req({ addressDetail: ' 301동 1204호 ', saveAddressForNext: true }));
    expect(created.visitAddress).toEqual({ addressId: 'ad-apt', label: '햇살마을 3단지', line1: '서울 가상구 햇살로 100 (햇살마을 3단지)', kind: 'apartment', detail: '301동 1204호' });
    expect(await r.getSavedVisitAddress()).toMatchObject({ addressId: 'ad-apt', detail: '301동 1204호' });
  });
  it('저장을 선택하지 않으면 기존 재사용 주소를 바꾸지도 지우지도 않는다(요청에는 입력한 주소)', async () => {
    const r = repo();
    await r.createRequest(req({ saveAddressForNext: true }));
    const c = await r.createRequest(req({ addressDetail: '302동 101호', saveAddressForNext: false }));
    expect(c.visitAddress?.detail).toBe('302동 101호');
    expect((await r.getSavedVisitAddress())?.detail).toBe('301동 1204호');
  });
  it('수정 후 저장을 선택하면 재사용 주소를 갱신한다(사용자당 1개)', async () => {
    const r = repo();
    await r.createRequest(req({ saveAddressForNext: true }));
    await r.createRequest(req({ addressId: 'ad-house', addressDetail: '', saveAddressForNext: true }));
    expect(await r.getSavedVisitAddress()).toMatchObject({ addressId: 'ad-house', detail: '' });
  });
  it('제출이 실패하면 저장하지 않는다', async () => {
    const r = repo();
    expect(await code(r.createRequest(req({ tasks: [], saveAddressForNext: true })))).toBe('invalid');
    expect(await code(r.createRequest(req({ addressId: 'ad-far', groupId: 'g1', newDateWish: undefined, saveAddressForNext: true })))).toBe('address_not_eligible');
    r.__db().settings.failNextQuery = true; // 조회 실패는 쓰기에 영향 없음 — 저장 주소 조회만 실패
    expect(await code(r.getSavedVisitAddress())).toBe('network');
    expect(await r.getSavedVisitAddress()).toBeNull();
  });
  it('아파트는 상세 주소가 필요하고 단독주택은 비워도 접수된다', async () => {
    const r = repo();
    expect(await code(r.createRequest(req({ addressDetail: '' })))).toBe('invalid');
    expect(await code(r.createRequest(req({ addressId: 'ad-house', addressDetail: '' })))).toBe('ok');
  });
  it('공동 날짜 참여는 정확한 방문 건물 기준으로 다시 확인한다(같은 단지의 다른 건물은 같은 단지 조건으로 통과)', async () => {
    const r = repo();
    expect(await code(r.createRequest(req({ groupId: 'g1', newDateWish: undefined, addressId: 'ad-apt-b', addressDetail: '2층 201호' })))).toBe('ok');
    expect(await code(r.createRequest(req({ groupId: 'g1', newDateWish: undefined, addressId: 'ad-house', addressDetail: '' })))).toBe('address_not_eligible');
  });
});

describe('요청·예약 방문 주소 보존', () => {
  it('탐색 주소·재사용 주소 변경, 다른 주소로 새 요청을 해도 기존 요청·예약 주소는 그대로', async () => {
    const r = repo();
    const beforeReq = (await r.getRequest('rq-3')).visitAddress;
    const beforeBk = (await r.getBooking('bk-k15')).visitAddress;
    await r.setExploreAddress('ad-house');
    await r.createRequest(req({ addressId: 'ad-house', addressDetail: '', saveAddressForNext: true }));
    expect((await r.getRequest('rq-3')).visitAddress).toEqual(beforeReq);
    expect((await r.getBooking('bk-k15')).visitAddress).toEqual(beforeBk);
  });
  it('예약은 요청의 제출 당시 주소를 복사해 유지한다', async () => {
    const r = repo();
    const ap = await r.getApproval('rq-4');
    const res = await r.simulateDepositPayment({ requestId: 'rq-4', approvalVersion: ap.approval.version, idempotencyKey: 'pay-b' });
    const bk = await r.getBooking(res.bookingId!);
    expect(bk.visitAddress).toEqual((await r.getRequest('rq-4')).visitAddress);
  });
  it('시드의 다른 건물 예약에 햇살마을 동·호수가 붙지 않는다', async () => {
    const va = (await repo().getBooking('bk-k15')).visitAddress!; // 푸른숲 2단지
    expect(va.addressId).toBe('ad-apt2');
    expect(va.detail).not.toBe('301동 1204호');
  });
  it('방문 주소가 없는 이전 데이터는 null(현재 주소로 추정하지 않음)', async () => {
    const r = repo();
    delete r.__db().requests.find((x) => x.id === 'rq-1')!.visitAddress;
    await r.setExploreAddress('ad-house');
    expect((await r.getRequest('rq-1')).visitAddress).toBeNull();
  });
});

describe('계정별 분리', () => {
  it('로그아웃·계정 전환 시 탐색 주소와 재사용 주소가 남지 않는다', async () => {
    const r = repo();
    r.__switchOwner('user-a');
    await r.setExploreAddress('ad-house');
    await r.createRequest(req({ saveAddressForNext: true }));
    r.__switchOwner('user-b');
    expect(await r.getExploreAddress()).toBeNull();
    expect(await r.getSavedVisitAddress()).toBeNull();
    expect(JSON.stringify(r.__db())).not.toContain('"savedAt"');
  });
  it('개발 도구 승인·결제 흐름은 방문 주소를 유지한다', async () => {
    const r = repo(); const ctl = new DevController(r);
    const c = await r.createRequest(req({ addressId: 'ad-house', addressDetail: '대문 옆', saveAddressForNext: false }));
    expect(ctl.approveRequest(c.id, '10:00').ok).toBe(true);
    const ap = await r.getApproval(c.id);
    const res = await r.simulateDepositPayment({ requestId: c.id, approvalVersion: ap.approval.version, idempotencyKey: 'pay-c' });
    expect((await r.getBooking(res.bookingId!)).visitAddress?.detail).toBe('대문 옆');
  });
});

describe('방문 날짜 선택: 새 요청 희망 날짜·업체 상세 날짜 정보', () => {
  it('새 요청 희망 날짜는 업체 접수 기준(운영 요일·휴무일·접수 기간)과 48시간 기준을 지켜야 접수된다', async () => {
    const r = new MockRepository({ latencyMs: 0 });
    expect(await code(r.createRequest(req({ newDateWish: '2026-10-22' })))).toBe('ok'); // 한빛설비 목요일
    expect(await code(r.createRequest(req({ newDateWish: '2026-10-25' })))).toBe('invalid'); // 일요일(쉬는 요일)
    expect(await code(r.createRequest(req({ newDateWish: '2026-10-28' })))).toBe('invalid'); // 휴무일
    expect(await code(r.createRequest(req({ newDateWish: '2026-10-14' })))).toBe('invalid'); // 48시간 이전
    expect(await code(r.createRequest(req({ newDateWish: '2026-12-01' })))).toBe('invalid'); // 접수 기간 밖
  });
  it('새 요청은 그룹 ID 없이 희망 날짜만 저장한다', async () => {
    const r = new MockRepository({ latencyMs: 0 });
    const created = await r.createRequest(req({ newDateWish: '2026-10-22' }));
    expect(created.groupId).toBeNull();
    expect(created.newDateWish).toBe('2026-10-22');
  });
  it('업체 상세는 새 요청 접수 기준을 주고, 기존 공동 예약 데모 날짜(10/19·21·23)는 그대로다', async () => {
    const p = await new MockRepository({ latencyMs: 0 }).getProvider('p1', 'ad-apt');
    expect(p.newRequest?.weekdays).toEqual([1, 2, 3, 4, 5, 6]);
    expect([...new Set(p.groups.map((g) => g.date))]).toEqual(['2026-10-19', '2026-10-21', '2026-10-23']);
    expect(p.closedJointDates).toEqual(['2026-10-14']); // 마감 처리된 시드 그룹(gc-p1)
  });
});
