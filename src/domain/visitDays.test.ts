import { describe, expect, it } from 'vitest';
import { jointNoteForNewDay, newRequestBlock, newRequestDates, visitDays } from './visitDays';
import type { NewRequestPolicy, PublicGroup } from './types';

const NOW = '2026-10-13T19:00:00+09:00'; // 화요일. 48시간 이후 = 10/15(목)부터
const POLICY: NewRequestPolicy = { weekdays: [1, 2, 3, 4, 5], closedDates: ['2026-10-21'], lastDate: '2026-10-31' };
const g = (p: Partial<PublicGroup>): PublicGroup => ({
  id: 'g', providerId: 'p1', date: '2026-10-20', slots: ['09:00–12:00'], closeAt: '2026-10-19T18:00:00+09:00', totalTripFee: 50000,
  capacity: 4, confirmedHouseholds: 1, pendingSeats: 0, scopeType: 'complex', ...p,
});

describe('새 요청 가능 날짜(업체 접수 기준 + 48시간)', () => {
  it('지난 날짜·48시간 이전·접수 범위 밖·휴무일·쉬는 요일은 요청 불가', () => {
    expect(newRequestBlock(POLICY, '2026-10-12', NOW)).toBe('past');
    expect(newRequestBlock(POLICY, '2026-10-14', NOW)).toBe('lead_time');
    expect(newRequestBlock(POLICY, '2026-11-02', NOW)).toBe('out_of_range');
    expect(newRequestBlock(POLICY, '2026-10-21', NOW)).toBe('closed_date');
    expect(newRequestBlock(POLICY, '2026-10-18', NOW)).toBe('day_off'); // 일요일
    expect(newRequestBlock(POLICY, '2026-10-15', NOW)).toBeNull();
  });
  it('접수 기준이 없으면 어떤 날짜도 요청할 수 없다(공동 예약이 없다고 요청 가능으로 보지 않음)', () => {
    expect(newRequestBlock(null, '2026-10-20', NOW)).toBe('no_policy');
    expect(newRequestDates(null, NOW)).toEqual([]);
  });
  it('잘못된 날짜 문자열은 요청 불가', () => {
    expect(newRequestBlock(POLICY, '2026-13-40', NOW)).not.toBeNull();
    expect(newRequestBlock(POLICY, 'x', NOW)).not.toBeNull();
  });
  it('오늘부터 마지막 날짜까지 가능한 날짜만', () => {
    const ds = newRequestDates(POLICY, NOW);
    expect(ds[0]).toBe('2026-10-15');
    expect(ds).not.toContain('2026-10-21');
    expect(ds).not.toContain('2026-10-17'); // 토요일
    expect(ds[ds.length - 1]).toBe('2026-10-30');
  });
});

describe('날짜 유형(공동 예약 우선)', () => {
  it('신청 가능한 그룹이 있으면 공동 예약, 아니면 새 요청 기준, 둘 다 아니면 요청 불가', () => {
    const d = visitDays([g({ id: 'a', date: '2026-10-20' }), g({ id: 'b', date: '2026-10-24', closeAt: '2026-10-23T18:00:00+09:00' })], POLICY, NOW);
    expect(d.kindOf('2026-10-20')).toBe('joint'); // 새 요청도 가능하지만 공동 예약 우선
    expect(d.kindOf('2026-10-24')).toBe('joint'); // 토요일(운영 요일 아님)이어도 공동 예약 그룹은 참여 가능
    expect(d.kindOf('2026-10-22')).toBe('new');
    expect(d.kindOf('2026-10-21')).toBe('none'); // 휴무
    expect(d.joint.get('2026-10-20')).toBe(1);
  });
  it('같은 날짜 여러 그룹은 그룹 수로 센다', () => {
    const d = visitDays([g({ id: 'a' }), g({ id: 'b' })], POLICY, NOW);
    expect(d.joint.get('2026-10-20')).toBe(2);
  });
  it('마감·정원 초과 그룹만 있는 날짜는 새 요청 기준으로 따로 판단한다', () => {
    const full = g({ id: 'f', date: '2026-10-22', confirmedHouseholds: 4 });
    const closed = g({ id: 'c', date: '2026-10-23', closeAt: '2026-10-13T18:00:00+09:00' });
    const d = visitDays([full, closed], POLICY, NOW);
    expect(d.kindOf('2026-10-22')).toBe('new');
    expect(d.kindOf('2026-10-23')).toBe('new');
    expect(jointNoteForNewDay('2026-10-22', [full, closed], [], NOW)).toBe('이 날짜의 공동 예약은 남은 자리가 없어요.');
    expect(jointNoteForNewDay('2026-10-23', [full, closed], [], NOW)).toBe('이 날짜의 공동 예약은 접수가 마감됐어요.');
    expect(jointNoteForNewDay('2026-10-26', [], ['2026-10-26'], NOW)).toBe('이 날짜의 공동 예약은 접수가 마감됐어요.');
    expect(jointNoteForNewDay('2026-10-27', [full, closed], [], NOW)).toBe('현재 참여 가능한 공동 예약은 없어요.');
  });
  it('고를 수 있는 날짜 전체(달 범위 계산용)는 두 유형을 합친 정렬 목록', () => {
    const d = visitDays([g({ id: 'a', date: '2026-10-24', closeAt: '2026-10-23T18:00:00+09:00' })], { ...POLICY, lastDate: '2026-10-16' }, NOW);
    expect(d.all).toEqual(['2026-10-15', '2026-10-16', '2026-10-24']);
  });
});
