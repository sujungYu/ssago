import { isRetiredCategory } from '../../domain/categories';
import type { MockDb } from './db';

/**
 * 저장된 목업 상태의 카테고리·업체 소속을 지금 시드 기준으로 맞춘다(spec 5.34). 바꿨으면 true. 여러 번 불러도 결과가 같다.
 * - 없앤 카테고리(‘기타 수리’ c10)를 카테고리 목록에서 뺀다.
 * - 같은 ID로 두 번 저장된 업체는 처음 하나만 남긴다(업체 ID·요청·예약 연결은 그대로).
 * - 시드에 같은 ID가 있는 업체: 소속 카테고리와 등록 작업의 카테고리 연결만 시드 값으로 바꾼다(업체 이름·연락처·리뷰 등 다른 저장값은 그대로).
 *   시드에 없는 업체는 없앤 카테고리만 뺀다.
 * - 요청·예약에 저장된 업체·작업 기록(이름·작업명 스냅숏)은 건드리지 않는다.
 */
export function migrateCatalog(db: MockDb, seed: MockDb): boolean {
  const before = JSON.stringify({ c: db.categories, p: db.providers.map((p) => [p.id, p.categoryIds, p.services?.map((s) => s.categoryId)]) });
  db.categories = db.categories.filter((c) => !isRetiredCategory(c.id));
  const seen = new Set<string>();
  db.providers = db.providers.filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)));
  const seedById = new Map(seed.providers.map((p) => [p.id, p]));
  for (const p of db.providers) {
    const s = seedById.get(p.id);
    p.categoryIds = (s ? [...s.categoryIds] : p.categoryIds).filter((c) => !isRetiredCategory(c));
    if (!p.services) continue;
    const seedSv = new Map((s?.services ?? []).map((x) => [x.id, x.categoryId]));
    p.services = p.services.map((x) => {
      const cat = seedSv.has(x.id) ? seedSv.get(x.id) : x.categoryId;
      const { categoryId: _old, ...rest } = x; // eslint-disable-line @typescript-eslint/no-unused-vars
      return cat && !isRetiredCategory(cat) ? { ...rest, categoryId: cat } : rest;
    });
  }
  return JSON.stringify({ c: db.categories, p: db.providers.map((p) => [p.id, p.categoryIds, p.services?.map((s) => s.categoryId)]) }) !== before;
}
