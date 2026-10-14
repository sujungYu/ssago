import { afterEach, describe, expect, it } from 'vitest';
import { MockRepository } from './mockRepository';
import { migrateCatalog } from './catalogMigration';
import { createSeed } from './seed';
import type { MockDb } from './db';

/** ‘기타 수리’가 있던 때 저장된 상태: 카테고리 c10, 업체 소속·작업 연결 c10, 같은 업체가 두 번 저장된 경우 */
function oldSaved(): MockDb {
  const db = createSeed('full');
  db.categories.push({ id: 'c10', name: '기타 수리·교체·설치' });
  for (const id of ['p1', 'p24', 'p34']) db.providers.find((p) => p.id === id)!.categoryIds.push('c10');
  const p24 = db.providers.find((p) => p.id === 'p24')!;
  p24.categoryIds = ['c2', 'c6', 'c10'];
  p24.services = p24.services!.map((s) => (s.id === 'sv-p24-stopper' || s.id === 'sv-p24-mirror' ? { ...s, categoryId: 'c10' } : s));
  db.providers.push(structuredClone(db.providers.find((p) => p.id === 'p1')!)); // 같은 ID 중복 저장
  return db;
}

describe('카테고리 정리(‘기타 수리’ 제거) — 저장된 상태', () => {
  it('없앤 카테고리·소속·작업 연결을 지우고 시드 기준으로 맞춘다. 같은 ID 업체는 하나만. 다시 불러도 그대로', () => {
    const db = oldSaved();
    expect(migrateCatalog(db, createSeed('full'))).toBe(true);
    expect(db.categories.map((c) => c.id)).not.toContain('c10');
    expect(db.providers.filter((p) => p.id === 'p1')).toHaveLength(1);
    expect(db.providers.some((p) => p.categoryIds.includes('c10'))).toBe(false);
    const p24 = db.providers.find((p) => p.id === 'p24')!;
    expect(p24.categoryIds).toEqual(['c2', 'c6', 'c3']);
    expect(p24.services!.find((s) => s.id === 'sv-p24-stopper')!.categoryId).toBe('c3');
    expect(p24.services!.find((s) => s.id === 'sv-p24-mirror')!.categoryId).toBeUndefined();
    expect(migrateCatalog(db, createSeed('full'))).toBe(false);
  });

  it('요청·예약의 업체·작업 기록은 그대로다', () => {
    const db = oldSaved();
    const before = structuredClone({ r: db.requests, b: db.bookings });
    migrateCatalog(db, createSeed('full'));
    expect({ r: db.requests, b: db.bookings }).toEqual(before);
  });

  describe('저장소에서 복원(sessionStorage)', () => {
    const store = new Map<string, string>();
    const g = globalThis as unknown as { sessionStorage?: Storage };
    const prev = g.sessionStorage;
    afterEach(() => { store.clear(); g.sessionStorage = prev; });
    it('예전 상태가 저장된 탭을 다시 열어도 ‘기타 수리’·중복 업체가 보이지 않는다', async () => {
      g.sessionStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k), clear: () => store.clear(), key: () => null, length: 0 } as Storage;
      store.set('on-gimae/mock-db/v3', JSON.stringify(oldSaved()));
      const r = new MockRepository({ persist: true, latencyMs: 0 });
      expect((await r.listCategories()).map((c) => c.id)).not.toContain('c10');
      expect(await r.listProviders({ categoryId: 'c10', addressId: 'ad-apt' })).toEqual([]);
      const c2 = await r.listProviders({ categoryId: 'c2', addressId: 'ad-apt' });
      expect(new Set(c2.map((p) => p.id)).size).toBe(c2.length);
      expect(c2.filter((p) => p.id === 'p1')).toHaveLength(1);
      expect(JSON.parse(store.get('on-gimae/mock-db/v3')!).categories.map((c: { id: string }) => c.id)).not.toContain('c10'); // 정리한 상태를 저장
    });
  });
});
