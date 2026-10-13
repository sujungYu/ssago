import type { GroupRecord } from '../../domain/types';
import type { MockDb } from './db';

/**
 * 공동 예약 데모 일정 버전. 시드의 열린 데모 일정(날짜·마감·시간대 등)을 바꾸면 올린다.
 * 목업 DB는 탭의 sessionStorage에 통째로 저장·복원되므로, 버전이 낮은 저장 상태는 아래 이전(migrate)으로 일정만 새 기준에 맞춘다.
 * v2(2026-10-13): 모든 업체가 10/19~25 중 서로 다른 날짜 3개에 날짜당 하나.
 * v3(2026-10-13): 업체를 35곳으로 늘림(카테고리마다 10곳). 새 업체(p9~p35)와 그 공동 예약 일정을 더한다.
 */
export const DEMO_SCHEDULE_VERSION = 3;

/** 이전 데모에만 있던 열린 일정(지금 시드에 없음). 기록이 참조하지 않으면 지운다 */
const RETIRED_DEMO_GROUP_IDS = new Set(['g2', 'g3']);
/** 기록 연결 때문에 남긴 옛 데모 일정 표시: 어떤 주소 기준과도 맞지 않아 캘린더·참여 후보에 나오지 않는다 */
export const RETIRED_ANCHOR = 'retired-demo';

const isOpenDemo = (g: GroupRecord) => !g.closed && !g.ended && g.anchorKey !== 'pending-new';

/**
 * 저장된 목업 상태의 공동 예약 일정만 새 데모 기준으로 맞춘다. 바꿨으면 true.
 * - 시드에 같은 ID가 있는 열린 데모 일정: 일정 정의(업체·날짜·마감·시간대·범위·출장비·정원)는 새 시드 값, 진행 상태(확정 세대·결제 대기 자리·마감·종료·확정 출장비)는 저장값 유지.
 * - 이전 데모에만 있던 일정: 참조하는 기록이 없으면 지우고, 있으면 기록 연결(ID)을 지키되 캘린더에 나오지 않게 한다.
 * - 새 시드에만 있는 일정은 더한다. 실행 중 만든 그룹(새 날짜 승인 등)·마감/종료된 과거 그룹은 그대로.
 * - 새 시드에만 있는 업체는 더한다(같은 ID의 저장된 업체는 그대로 — 기존 업체 ID와 그 업체를 참조하는 요청·예약 연결을 지킨다).
 * - 요청·예약·승인 등 기록(날짜 포함)과 주소·내 정보·설정은 건드리지 않는다. 같은 ID를 두 번 넣지 않아 새·옛 일정이 겹치지 않는다.
 */
export function migrateDemoSchedule(db: MockDb, seed: MockDb): boolean {
  if ((db.scheduleVersion ?? 1) >= DEMO_SCHEDULE_VERSION) return false;
  const seedById = new Map(seed.groups.map((g) => [g.id, g]));
  const referenced = new Set<string>();
  const ref = (id: string | null | undefined) => { if (id) referenced.add(id); };
  db.requests.forEach((r) => ref(r.groupId));
  db.bookings.forEach((b) => ref(b.groupId));
  db.approvals.forEach((a) => { ref(a.groupId); ref(a.recheck?.newGroupId); });
  db.proposals.forEach((p) => ref(p.newVisit.groupId));

  const out: GroupRecord[] = [];
  const seen = new Set<string>();
  for (const g of db.groups) {
    if (seen.has(g.id)) continue; // 같은 ID 중복 저장값은 하나만
    seen.add(g.id);
    const s = seedById.get(g.id);
    if (s && isOpenDemo(s)) {
      out.push({
        ...g, providerId: s.providerId, date: s.date, closeAt: s.closeAt, slots: [...s.slots], anchorKey: s.anchorKey,
        scopeType: s.scopeType, totalTripFee: s.totalTripFee, capacity: s.capacity,
      });
    } else if (!s && RETIRED_DEMO_GROUP_IDS.has(g.id)) {
      if (referenced.has(g.id)) out.push({ ...g, anchorKey: RETIRED_ANCHOR });
    } else out.push(g);
  }
  for (const s of seed.groups) if (!seen.has(s.id)) out.push(structuredClone(s));
  db.groups = out;
  const savedProviders = new Set(db.providers.map((p) => p.id));
  for (const p of seed.providers) if (!savedProviders.has(p.id)) db.providers.push(structuredClone(p));
  db.scheduleVersion = DEMO_SCHEDULE_VERSION;
  return true;
}
