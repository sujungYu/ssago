import { describe, expect, it } from 'vitest';
import { MockRepository } from './mockRepository';
import { RepoError } from '../../domain/errors';
import { formatPhone, maskPhone, nameError, normalizeContact, phoneError } from '../../domain/profile';
import type { NewRequestInput } from '../repositories/types';

const repo = () => new MockRepository({ latencyMs: 0 });
const code = async (p: Promise<unknown>) => { try { await p; return 'ok'; } catch (e) { return e instanceof RepoError ? e.code : 'other'; } };
const req = (p: Partial<NewRequestInput> = {}): NewRequestInput => ({
  providerId: 'p1', groupId: null, newDateWish: '2026-10-22', slots: ['09:00–12:00'], tasks: [{ title: '수전 교체', description: '', photoNames: [] }],
  addressId: 'ad-apt', addressDetail: '301동 1204호', saveAddressForNext: false, contact: { name: '김온다', phone: '010-1111-2222' }, idempotencyKey: `pf-${Math.random()}`, ...p,
});

describe('이름·연락처 규칙', () => {
  it('이름: 앞뒤 공백 제거, 공백만이면 오류, 한글 외 글자도 허용', () => {
    expect(nameError('   ')).toMatch(/이름을 입력/);
    expect(nameError('')).toMatch(/이름을 입력/);
    expect(nameError('Kim Onda')).toBeNull();
    expect(nameError('김온다2')).toBeNull();
    expect(nameError('가'.repeat(21))).toMatch(/20자/);
    expect(normalizeContact({ name: '  김온다  ', phone: '01012345678' })?.name).toBe('김온다');
  });
  it('연락처: 하이픈·공백 허용, 숫자 기준 010 + 11자리', () => {
    expect(phoneError('010-1234-5678')).toBeNull();
    expect(phoneError('010 1234 5678')).toBeNull();
    expect(phoneError('01012345678')).toBeNull();
    expect(phoneError('')).toMatch(/연락처를 입력/);
    expect(phoneError('011-1234-5678')).toMatch(/010으로 시작/);
    expect(phoneError('010-1234-567')).toMatch(/11자리.*10자리/);
    expect(phoneError('010-1234-5678a')).toMatch(/숫자와 하이픈/);
    expect(normalizeContact({ name: '김', phone: '010 1234-5678' })?.phone).toBe('01012345678');
  });
  it('표시: 입력란은 하이픈 형식, 요약은 가운데 4자리 가림', () => {
    expect(formatPhone('01012345678')).toBe('010-1234-5678');
    expect(maskPhone('01012345678')).toBe('010-****-5678');
  });
});

describe('내 정보 수정', () => {
  it('기본값은 가상 고객이고, 저장하면 다음 조회(같은 저장소 상태로 다시 연결)에도 유지된다', async () => {
    const r = repo();
    const before = await r.getProfile();
    expect(before.phoneMasked).toBe('010-****-0000');
    const saved = await r.updateProfile({ name: '  박데모 ', phone: '010-9876-5432' });
    expect(saved).toMatchObject({ name: '박데모', phone: '01098765432', phoneMasked: '010-****-5432' });
    const again = new MockRepository({ latencyMs: 0, seed: structuredClone(r.__db()) });
    expect(await again.getProfile()).toMatchObject({ name: '박데모', phone: '01098765432' });
  });
  it('형식이 틀리면 invalid로 거부하고 기존 값을 바꾸지 않는다', async () => {
    const r = repo();
    expect(await code(r.updateProfile({ name: '   ', phone: '01012345678' }))).toBe('invalid');
    expect(await code(r.updateProfile({ name: '김', phone: '0101234' }))).toBe('invalid');
    expect((await r.getProfile()).name).toBe('김온다 (가상 고객)');
  });
  it('저장 실패(쓰기 실패·브라우저 저장 불가)면 바꾸지 않는다', async () => {
    const r = repo();
    r.__db().settings.failNextWrite = true;
    expect(await code(r.updateProfile({ name: '박데모', phone: '01098765432' }))).toBe('network');
    expect((await r.getProfile()).name).toBe('김온다 (가상 고객)');
    // 브라우저 저장소를 쓸 수 없는 환경(테스트 환경에는 sessionStorage가 없다)
    const p = new MockRepository({ latencyMs: 0, persist: true });
    expect(await code(p.updateProfile({ name: '박데모', phone: '01098765432' }))).toBe('storage_failed');
    expect((await p.getProfile()).name).toBe('김온다 (가상 고객)');
  });
  it('저장값이 잘못됐거나 이전 형식(연락처 없음)이면 기본 가상 고객 정보를 쓴다', async () => {
    const r = repo();
    (r.__db() as unknown as { customer: unknown }).customer = { id: 'cu1', name: '   ', phoneMasked: '010-****-0000' };
    expect(await r.getProfile()).toMatchObject({ name: '김온다 (가상 고객)', phone: '01000000000', phoneMasked: '010-****-0000' });
    (r.__db() as unknown as { customer: unknown }).customer = { id: 'cu1', name: '김', phone: 12 };
    expect((await r.getProfile()).phone).toBe('01000000000');
  });
  it('요청은 제출 당시 이름·연락처를 저장하고, 내 정보를 바꿔도 이미 제출된 요청·예약은 그대로다', async () => {
    const r = repo();
    const created = await r.createRequest(req());
    expect(created.contact).toEqual({ name: '김온다', phone: '01011112222' });
    // 확정된 예약: 요청의 스냅숏을 복사
    const d = await r.getRequest('rq-3');
    await r.simulateDepositPayment({ requestId: 'rq-3', approvalVersion: d.approval!.version, idempotencyKey: 'pf-pay' });
    const bookingId = (await r.getRequest('rq-3')).request.bookingId!;
    const bookedContact = (await r.getBooking(bookingId)).booking.contact;
    expect(bookedContact).toEqual({ name: '김온다 (가상 고객)', phone: '01000000000' });

    await r.updateProfile({ name: '박데모', phone: '010-9876-5432' });
    expect((await r.getRequest(created.id)).request.contact).toEqual({ name: '김온다', phone: '01011112222' });
    expect((await r.getBooking(bookingId)).booking.contact).toEqual(bookedContact);
    expect((await r.getBooking('bk-k2')).booking.contact?.name).toBe('김온다 (가상 고객)');
  });
  it('요청 연락처 형식이 틀리면 접수하지 않는다', async () => {
    expect(await code(repo().createRequest(req({ contact: { name: ' ', phone: '01011112222' } })))).toBe('invalid');
    expect(await code(repo().createRequest(req({ contact: { name: '김', phone: '011-1111-2222' } })))).toBe('invalid');
  });
});
