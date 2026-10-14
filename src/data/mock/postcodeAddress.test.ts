import { describe, expect, it } from 'vitest';
import { MockRepository } from './mockRepository';
import { postcodeAddressId, postcodeToAddress, postcodeToInput, savedDetailFor, type PostcodeAddressInput } from '../../domain/address';
import type { NewRequestInput } from '../repositories/types';

const repo = () => new MockRepository({ latencyMs: 0 });
let n = 0;
const req = (p: Partial<NewRequestInput> = {}): NewRequestInput => ({
  providerId: 'p1', groupId: null, newDateWish: '2026-10-22', slots: ['09:00', '10:00'], tasks: [{ serviceId: 'sv-p1-faucet', description: '', photoNames: [] }],
  addressId: 'ad-apt', addressDetail: '101동 202호', saveAddressForNext: false, contact: { name: '김온다', phone: '010-1234-5678' }, idempotencyKey: `pc-${++n}`, ...p,
});

// 카카오 우편번호 서비스 oncomplete 결과 모양(가이드의 필드 이름)
const APT = { zonecode: '06236', roadAddress: '서울 강남구 테헤란로 152', jibunAddress: '서울 강남구 역삼동 737', buildingCode: '1168010100107370000000001', buildingName: '강남파이낸스센터', apartment: 'N' };
const APT2 = { zonecode: '04524', roadAddress: '서울 중구 세종대로 110', jibunAddress: '서울 중구 태평로1가 31', buildingCode: '1114010300100310000000001', buildingName: '', apartment: 'Y' };
const input = (d: object) => postcodeToInput(d)!;

describe('실제 주소 검색 결과 → 건물 주소', () => {
  it('도로명주소·건물명·공동주택 여부를 옮기고, 건물명이 없어도 처리한다', () => {
    const a = postcodeToAddress(input(APT));
    expect(a).toEqual({ id: 'pc:1168010100107370000000001', label: '강남파이낸스센터', line1: '서울 강남구 테헤란로 152', kind: 'house', source: 'postcode' });
    const b = postcodeToAddress(input(APT2));
    expect(b.label).toBe('');
    expect(b.kind).toBe('apartment');
    expect(Object.keys(b)).not.toContain('detail'); // 동·호수 없음
  });
  it('도로명주소가 비면 자동 매핑 도로명, 그것도 없으면 지번. 쓸 주소가 없으면 null', () => {
    expect(input({ jibunAddress: '서울 중구 태평로1가 31', autoRoadAddress: '서울 중구 세종대로 110' }).roadAddress).toBe('서울 중구 세종대로 110');
    expect(postcodeToAddress(input({ jibunAddress: '경기 가상시 리 1' })).line1).toBe('경기 가상시 리 1');
    expect(postcodeToInput({ zonecode: '12345' })).toBeNull();
  });
  it('같은 건물은 같은 ID, 건물관리번호가 없으면 우편번호 + 기본 주소', () => {
    expect(postcodeAddressId(input(APT))).toBe(postcodeAddressId(input({ ...APT, buildingName: '바뀐 이름' })));
    expect(postcodeAddressId(input({ ...APT, buildingCode: '' }))).toBe('pc:06236:서울 강남구 테헤란로 152');
  });
});

describe('실제 주소와 데모 업체·공동 예약 분리', () => {
  it('어떤 실제 주소를 골라도 카테고리 9개 모두 데모 업체(10곳 이상)와 공동 예약 후보가 보인다(오류·빈 목록 없음)', async () => {
    const r = repo();
    for (const d of [APT, APT2]) {
      const a = await r.registerAddress(input(d));
      for (let c = 1; c <= 9; c++) {
        const list = await r.listProviders({ categoryId: `c${c}`, addressId: a.id });
        expect(list.length).toBeGreaterThanOrEqual(10);
        expect(list.every((p) => p.jointAvailable !== null)).toBe(true); // ‘확인 불가’로 비우지 않는다
      }
      expect((await r.listProviders({ categoryId: 'c2', addressId: a.id })).some((p) => p.nextJoint)).toBe(true);
    }
  });
  it('업체의 활동 지역·공동 예약 데이터를 바꾸지 않는다', async () => {
    const r = repo();
    const before = structuredClone({ providers: r.__db().providers, groups: r.__db().groups });
    await r.registerAddress(input(APT));
    expect({ providers: r.__db().providers, groups: r.__db().groups }).toEqual(before);
  });
  it('등록은 같은 건물이면 한 번만 남기고, 탐색 주소로 저장하면 새로고침(같은 저장 상태로 다시 연결) 후에도 유지된다', async () => {
    const r = repo();
    const a = await r.registerAddress(input(APT));
    await r.registerAddress(input(APT));
    expect(r.__db().addressBook.filter((x) => x.id === a.id)).toHaveLength(1);
    await r.setExploreAddress(a.id);
    const again = new MockRepository({ latencyMs: 0, seed: structuredClone(r.__db()) });
    expect(await again.getExploreAddress()).toEqual(a);
    expect(await again.getAddress(a.id)).toEqual(a);
  });
  it('실제 주소로 공동 예약 요청을 보낼 수 있고, 제출 당시 주소를 보존한다. 기존 요청·예약 주소는 그대로', async () => {
    const r = repo();
    const beforeReq = (await r.getRequest('rq-3')).visitAddress;
    const beforeBk = (await r.getBooking('bk-k15')).visitAddress;
    const a = await r.registerAddress(input(APT2));
    await r.setExploreAddress(a.id);
    const g = (await r.getProvider('p1', a.id)).groups[0];
    const created = await r.createRequest(req({ groupId: g.id, newDateWish: undefined, slots: [g.slots[0].slice(0, 5)], addressId: a.id }));
    expect(created.visitAddress).toEqual({ addressId: a.id, label: '', line1: '서울 중구 세종대로 110', kind: 'apartment', detail: '101동 202호' });
    expect((await r.getRequest('rq-3')).visitAddress).toEqual(beforeReq);
    expect((await r.getBooking('bk-k15')).visitAddress).toEqual(beforeBk);
  });
  it('다른 건물로 바꾸면 이전 건물의 저장 상세 주소를 자동 입력하지 않는다', async () => {
    const r = repo();
    const a = await r.registerAddress(input(APT2));
    await r.createRequest(req({ addressId: a.id, saveAddressForNext: true }));
    const saved = await r.getSavedVisitAddress();
    expect(savedDetailFor(saved, a)).toBe('101동 202호');
    const other: PostcodeAddressInput = input(APT);
    expect(savedDetailFor(saved, await r.registerAddress(other))).toBeNull();
  });
});
