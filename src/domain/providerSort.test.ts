import { describe, expect, it } from 'vitest';
import { DEFAULT_PROVIDER_SORT, PROVIDER_SORT_OPTIONS, isProviderSort, sortProviders } from './providerSort';
import { MockRepository } from '../data/mock/mockRepository';

type P = { id: string; rating: number; reviewCount: number; nextJoint?: { date: string; expectedFee: number | null } };
const p = (id: string, rating: number, reviewCount: number, date?: string, fee?: number | null): P =>
  ({ id, rating, reviewCount, nextJoint: date ? { date, expectedFee: fee ?? null } : undefined });
// 저장소가 준 기존 순서
const items = [
  p('a', 4.8, 50, '2026-10-21', 15000),
  p('b', 4.5, 120, '2026-10-19', 20000),
  p('none1', 4.9, 10),
  p('c', 4.8, 90, '2026-10-19', 12500),
  p('nofee', 4.2, 5, '2026-10-20', null),
  p('none2', 4.1, 200),
];
const ids = (s: Parameters<typeof sortProviders>[1]) => sortProviders(items, s).map((x) => x.id);

describe('업체 목록 정렬', () => {
  it('선택지 네 개, 기본값은 방문 날짜 빠른 순', () => {
    expect(PROVIDER_SORT_OPTIONS.map((o) => o.label)).toEqual(['방문 날짜 빠른 순', '예상 출장비 낮은 순', '리뷰 많은 순', '별점 높은 순']);
    expect(DEFAULT_PROVIDER_SORT).toBe('visit');
    expect([isProviderSort('fee'), isProviderSort('price'), isProviderSort(null)]).toEqual([true, false, false]);
  });
  it('방문 날짜 빠른 순: 카드 후보 날짜 오름차순, 같은 날짜는 기존 순서, 후보 없는 업체는 뒤(기존 순서)', () => {
    expect(ids('visit')).toEqual(['b', 'c', 'nofee', 'a', 'none1', 'none2']);
  });
  it('예상 출장비 낮은 순: 카드 후보 예상 출장비만, 후보 없음·계산 불가는 뒤', () => {
    expect(ids('fee')).toEqual(['c', 'a', 'b', 'none1', 'nofee', 'none2']);
  });
  it('리뷰 많은 순', () => expect(ids('reviews')).toEqual(['none2', 'b', 'c', 'a', 'none1', 'nofee']));
  it('별점 높은 순: 같은 별점은 리뷰 많은 업체 먼저', () => expect(ids('rating')).toEqual(['none1', 'c', 'a', 'b', 'nofee', 'none2']));
  it('업체를 숨기거나 더하지 않고, 원본과 카드 후보를 바꾸지 않는다', () => {
    const snap = JSON.stringify(items);
    for (const o of PROVIDER_SORT_OPTIONS) expect(sortProviders(items, o.value).map((x) => x.id).sort()).toEqual(items.map((x) => x.id).sort());
    expect(JSON.stringify(items)).toBe(snap);
  });
  it('실제 데모 목록: 업체 수 그대로(숨기거나 더하지 않음), 같은 기준이면 결과가 같다', async () => {
    const r = new MockRepository({ latencyMs: 0 });
    for (let i = 1; i <= 9; i++) {
      const list = await r.listProviders({ categoryId: `c${i}`, addressId: 'ad-apt' });
      for (const o of PROVIDER_SORT_OPTIONS) {
        const a = sortProviders(list, o.value).map((x) => x.id);
        expect(a).toHaveLength(list.length);
        expect(new Set(a).size).toBe(list.length);
        expect(sortProviders(list, o.value).map((x) => x.id)).toEqual(a);
      }
    }
  });
});
