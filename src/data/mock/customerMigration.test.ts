import { afterEach, describe, expect, it } from 'vitest';
import { MockRepository } from './mockRepository';
import { migrateDefaultCustomerName } from './customerMigration';
import { createSeed, DEFAULT_CUSTOMER } from './seed';

describe('기본 고객 이름 ‘유수리’(spec 5.52)', () => {
  it('새 시드: 내 정보·요청·예약 연락받을 분이 유수리, 예전 이름·‘(가상 고객)’ 없음', () => {
    const db = createSeed('full');
    expect(DEFAULT_CUSTOMER.name).toBe('유수리');
    const names = [db.customer.name, ...db.requests.map((r) => r.contact?.name), ...db.bookings.map((b) => b.contact?.name)];
    expect(names.some((n) => /김온다|가상 고객/.test(n ?? ''))).toBe(false);
  });
  it('저장 상태에 예전 기본 이름이 남아 있으면 바꾸고, 직접 바꾼 이름·연락처·다른 정보는 그대로', () => {
    const db = createSeed('full');
    db.customer.name = '김온다 (가상 고객)';
    db.requests[0].contact = { name: '김온다 (가상 고객)', phone: '01012345678' };
    db.requests[1].contact = { name: '김온다', phone: '01000000000' };
    db.requests[2].contact = { name: '박직접', phone: '01099998888' };
    db.bookings[0].contact = { name: '김온다 (가상 고객)', phone: '01000000000' };
    const before = structuredClone(db);
    expect(migrateDefaultCustomerName(db)).toBe(true);
    expect(db.customer.name).toBe('유수리');
    expect(db.requests[0].contact).toEqual({ name: '유수리', phone: '01012345678' });
    expect(db.requests[1].contact).toEqual({ name: '유수리', phone: '01000000000' });
    expect(db.requests[2].contact).toEqual({ name: '박직접', phone: '01099998888' });
    expect(db.bookings[0].contact?.name).toBe('유수리');
    expect({ ...db.requests[0], contact: null }).toEqual({ ...before.requests[0], contact: null });
    expect(db.customer.phone).toBe(before.customer.phone);
    expect(migrateDefaultCustomerName(db)).toBe(false); // 다시 불러도 같음
  });
  it('직접 바꾼 내 정보 이름은 덮어쓰지 않는다', () => {
    const db = createSeed('full');
    db.customer.name = '홍길동';
    migrateDefaultCustomerName(db);
    expect(db.customer.name).toBe('홍길동');
  });

  describe('저장소에서 복원(새로고침)', () => {
    const store = new Map<string, string>();
    const g = globalThis as unknown as { sessionStorage?: Storage };
    const prev = g.sessionStorage;
    afterEach(() => { store.clear(); g.sessionStorage = prev; });
    it('예전 이름으로 저장된 탭을 열면 유수리로 보이고 저장도 바뀐다', async () => {
      g.sessionStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k), clear: () => store.clear(), key: () => null, length: 0 } as Storage;
      const db = createSeed('full');
      db.customer.name = '김온다 (가상 고객)';
      db.bookings.forEach((b) => { b.contact = { name: '김온다 (가상 고객)', phone: '01000000000' }; });
      store.set('on-gimae/mock-db/v3', JSON.stringify(db));
      const r = new MockRepository({ persist: true, latencyMs: 0 });
      expect((await r.getProfile()).name).toBe('유수리');
      expect((await r.getBooking('bk-k2')).booking.contact?.name).toBe('유수리');
      expect(store.get('on-gimae/mock-db/v3')).not.toContain('김온다');
    });
  });
});
