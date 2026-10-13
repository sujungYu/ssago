import { afterEach, describe, expect, it } from 'vitest';
import { createSeed } from './seed';
import { DEMO_SCHEDULE_VERSION, RETIRED_ANCHOR, migrateDemoSchedule } from './scheduleMigration';
import { MockRepository } from './mockRepository';
import { latestCloseAt } from '../../domain/time';
import type { MockDb } from './db';

/** 이전(v1) 데모 일정으로 저장된 상태를 흉내 낸다: 한빛설비 10/16 같은 단지 그룹 2개·10/17·10/20·11/03, 다른 업체 기간 밖 일정 */
function oldSavedState(): MockDb {
  const db = createSeed('full');
  delete db.scheduleVersion;
  const set = (id: string, date: string, closeAt: string) => { const g = db.groups.find((x) => x.id === id)!; g.date = date; g.closeAt = closeAt; };
  set('g1', '2026-10-16', '2026-10-15T18:00:00+09:00');
  set('g1b', '2026-10-16', '2026-10-15T12:00:00+09:00');
  set('g1n', '2026-11-03', '2026-11-02T18:00:00+09:00');
  set('g4', '2026-10-16', '2026-10-15T18:00:00+09:00');
  set('g5', '2026-10-17', '2026-10-16T18:00:00+09:00');
  db.groups = db.groups.filter((g) => !['g2a', 'g2b', 'g3a', 'g3b', 'g4a', 'g4b', 'g4c', 'g5a', 'g5b', 'g6a', 'g6b', 'g6c', 'g7a', 'g7b', 'g7c', 'g8a', 'g8b', 'g8c'].includes(g.id));
  const base = db.groups.find((x) => x.id === 'g1')!;
  db.groups.push({ ...base, id: 'g2', date: '2026-10-20', closeAt: '2026-10-19T18:00:00+09:00', anchorKey: 'radius:dalbit-a' });
  db.groups.push({ ...base, id: 'g3', date: '2026-10-17', closeAt: '2026-10-16T18:00:00+09:00', capacity: 4, confirmedHouseholds: 3, pendingSeats: 1 });
  // 사용자 데이터: 진행 상태 변화·내 정보·주소·실행 중 만든 그룹
  db.groups.find((x) => x.id === 'g1')!.pendingSeats = 2;
  db.customer.name = '홍길동(데모)';
  db.savedVisitAddress = { addressId: 'ad-apt', line1: '서울 가상구 햇살로 100 (햇살마을 3단지)', detail: '301동 1204호', savedAt: '2026-10-13T00:00:00Z' };
  db.groups.push({ ...base, id: 'g150', date: '2026-10-28', closeAt: '2026-10-27T18:00:00+09:00', anchorKey: 'pending-new' });
  return db;
}
const openOf = (db: MockDb) => db.groups.filter((g) => !g.closed && !g.ended && g.anchorKey !== 'pending-new' && g.anchorKey !== RETIRED_ANCHOR);

describe('공동 예약 데모 일정 이전(저장 상태)', () => {
  it('새 시드: 모든 업체가 10/19~25 중 서로 다른 날짜 3개, 날짜당 하나, 마감 정책 충족, 업체별 조합이 모두 다름', () => {
    const db = createSeed('full');
    expect(db.scheduleVersion).toBe(DEMO_SCHEDULE_VERSION);
    const combos = new Set<string>();
    for (const p of db.providers) {
      const gs = openOf(db).filter((g) => g.providerId === p.id);
      const dates = [...new Set(gs.map((g) => g.date))].sort();
      expect(dates, p.id).toHaveLength(3);
      const perArea = gs.map((g) => `${g.date}|${g.anchorKey}`);
      expect(new Set(perArea).size, p.id).toBe(perArea.length);
      for (const g of gs) {
        expect(g.date >= '2026-10-19' && g.date <= '2026-10-25', g.id).toBe(true);
        expect(new Date(g.closeAt) <= new Date(latestCloseAt(g.date)), g.id).toBe(true);
      }
      combos.add(dates.join(','));
    }
    expect(combos.size).toBe(db.providers.length);
  });

  it('기본 데모 주소(햇살마을)에서 모든 업체가 3개 날짜·날짜당 그룹 하나로 보인다', async () => {
    const r = new MockRepository({ latencyMs: 0 });
    for (const p of r.__db().providers) {
      const gs = (await r.getProvider(p.id, 'ad-apt')).groups;
      const dates = gs.map((g) => g.date);
      expect(new Set(dates).size, p.id).toBe(3);
      expect(dates.length, p.id).toBe(3);
      for (const d of dates) expect((await r.listJointGroups(p.id, 'ad-apt', d)).length, `${p.id} ${d}`).toBe(1);
    }
  });

  it('이전 저장 상태: 열린 데모 일정만 새 기준으로(진행 상태 유지), 옛 일정 제거, 새 일정 추가, 다른 데이터·기록 그대로, 한 번만', () => {
    const db = oldSavedState();
    const before = { requests: JSON.stringify(db.requests), bookings: JSON.stringify(db.bookings), approvals: JSON.stringify(db.approvals), customer: db.customer.name, saved: db.savedVisitAddress };
    expect(migrateDemoSchedule(db, createSeed('full'))).toBe(true);
    const seed = createSeed('full');
    // 열린 일정 = 새 시드와 같은 날짜 조합(중복 ID 없음)
    const ids = db.groups.map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(openOf(db).map((g) => `${g.id}@${g.date}`).sort()).toEqual(openOf(seed).map((g) => `${g.id}@${g.date}`).sort());
    const g1 = db.groups.find((x) => x.id === 'g1')!;
    expect([g1.date, g1.closeAt, g1.pendingSeats]).toEqual(['2026-10-19', '2026-10-18T18:00:00+09:00', 2]); // 진행 상태(결제 대기 자리) 유지
    expect(db.groups.some((g) => g.id === 'g2' || g.id === 'g3')).toBe(false); // 참조 없는 옛 일정 제거
    expect(db.groups.find((x) => x.id === 'g150')?.date).toBe('2026-10-28'); // 실행 중 만든 그룹 유지
    expect(db.groups.find((x) => x.id === 'gc-p1')?.date).toBe('2026-10-14'); // 마감된 과거 그룹 유지
    // 기록·내 정보·주소는 그대로(날짜 일괄 변경 없음)
    expect(JSON.stringify(db.requests)).toBe(before.requests);
    expect(JSON.stringify(db.bookings)).toBe(before.bookings);
    expect(JSON.stringify(db.approvals)).toBe(before.approvals);
    expect(db.customer.name).toBe(before.customer);
    expect(db.savedVisitAddress).toEqual(before.saved);
    expect(migrateDemoSchedule(db, createSeed('full'))).toBe(false); // 이미 새 버전
  });

  it('옛 일정을 참조하는 기록이 있으면 연결(ID)을 지키고 캘린더에서는 빠진다', async () => {
    const db = oldSavedState();
    db.requests.push({ ...db.requests.find((r) => r.id === 'rq-3')!, id: 'rq-old', bundleId: 'b-old', groupId: 'g3', status: 'reviewing', bookingId: undefined });
    migrateDemoSchedule(db, createSeed('full'));
    const g3 = db.groups.find((x) => x.id === 'g3')!;
    expect(g3.anchorKey).toBe(RETIRED_ANCHOR);
    const r = new MockRepository({ seed: db, latencyMs: 0 });
    expect((await r.getRequest('rq-old')).request.groupId).toBe('g3');
    expect(await r.listJointGroups('p1', 'ad-apt', '2026-10-17')).toEqual([]);
  });

  describe('저장소에서 복원(sessionStorage)', () => {
    const store = new Map<string, string>();
    const g = globalThis as unknown as { sessionStorage?: Storage };
    const prev = g.sessionStorage;
    afterEach(() => { store.clear(); g.sessionStorage = prev; });
    it('예전 일정이 저장된 탭을 다시 열어도 예전 일정이 복원·병합되지 않고, 새로고침해도 같은 날짜', async () => {
      g.sessionStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k), clear: () => store.clear(), key: () => null, length: 0 } as Storage;
      store.set('on-gimae/mock-db/v3', JSON.stringify(oldSavedState()));
      store.set('on-gimae/app-state/v1', JSON.stringify({ addressId: 'ad-apt' }));
      const r1 = new MockRepository({ persist: true, latencyMs: 0 });
      const p1 = await r1.getProvider('p1', 'ad-apt');
      expect(p1.groups.map((x) => x.date).sort()).toEqual(['2026-10-19', '2026-10-21', '2026-10-23']);
      expect(await r1.listJointGroups('p1', 'ad-apt', '2026-10-16')).toEqual([]);
      expect(store.get('on-gimae/app-state/v1')).toBe(JSON.stringify({ addressId: 'ad-apt' })); // 다른 저장값 유지
      const r2 = new MockRepository({ persist: true, latencyMs: 0 }); // 새로고침
      expect((await r2.getProvider('p1', 'ad-apt')).groups.map((x) => x.date).sort()).toEqual(['2026-10-19', '2026-10-21', '2026-10-23']);
      expect(JSON.parse(store.get('on-gimae/mock-db/v3')!).scheduleVersion).toBe(DEMO_SCHEDULE_VERSION);
    });
  });
});
