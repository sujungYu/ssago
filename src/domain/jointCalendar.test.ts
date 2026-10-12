import { describe, expect, it } from 'vitest';
import {
  addMonths, dayLabel, formatDayTitle, initialMonth, isGroupJoinable, joinableDateCounts, jointFeeView, monthRange, monthWeeks, todayYmd, unjoinableReason,
} from './jointCalendar';
import { expectedFeeForJoiner } from './pricing';
import { MockRepository } from '../data/mock/mockRepository';
import { DevController } from '../dev/devController';
import { RepoError } from './errors';
import type { PublicGroup } from './types';

const NOW = '2026-10-13T19:00:00+09:00';
const g = (p: Partial<PublicGroup>): PublicGroup => ({
  id: 'x', providerId: 'p1', date: '2026-10-16', slots: ['09:00–12:00'], closeAt: '2026-10-15T18:00:00+09:00', totalTripFee: 50000,
  capacity: 5, confirmedHouseholds: 2, pendingSeats: 0, scopeType: 'complex', ...p,
});

describe('신청 가능한 일정', () => {
  it('마감 전이고 남은 자리가 있어야 신청 가능(결제 대기 자리도 수용 한도에 포함)', () => {
    expect(isGroupJoinable(g({}), NOW)).toBe(true);
    expect(isGroupJoinable(g({ capacity: 4, confirmedHouseholds: 3, pendingSeats: 1 }), NOW)).toBe(false);
    expect(isGroupJoinable(g({ closeAt: '2026-10-13T19:00:00+09:00' }), NOW)).toBe(false);
    expect(unjoinableReason(g({ closeAt: '2026-10-13T18:59:00+09:00' }), NOW)).toBe('closed');
    expect(unjoinableReason(g({ capacity: 2 }), NOW)).toBe('full');
    expect(unjoinableReason(undefined, NOW)).toBe('unavailable');
    expect(unjoinableReason(g({}), NOW)).toBeNull();
  });
  it('마감·자리 없음 그룹만 있는 날짜는 활성화하지 않고, 같은 날 여러 그룹은 개수로 센다', () => {
    const m = joinableDateCounts([g({ id: 'a' }), g({ id: 'b' }), g({ id: 'c', date: '2026-10-17', capacity: 2 }), g({ id: 'd', date: '2026-10-18', closeAt: NOW })], NOW);
    expect([...m]).toEqual([['2026-10-16', 2]]);
  });
});

describe('캘린더 계산(Asia/Seoul)', () => {
  it('오늘은 한국 시간 기준(UTC로는 전날이어도)', () => {
    expect(todayYmd('2026-10-31T15:30:00Z')).toBe('2026-11-01'); // KST 11/1 00:30
    expect(todayYmd('2026-10-31T14:59:00Z')).toBe('2026-10-31');
  });
  it('월 이동과 연도 넘김', () => {
    expect(addMonths({ year: 2026, month: 12 }, 1)).toEqual({ year: 2027, month: 1 });
    expect(addMonths({ year: 2027, month: 1 }, -1)).toEqual({ year: 2026, month: 12 });
  });
  it('일요일 시작 칸: 2026년 10월 1일은 목요일, 31일까지', () => {
    const w = monthWeeks({ year: 2026, month: 10 });
    expect(w[0].slice(0, 5)).toEqual([null, null, null, null, '2026-10-01']);
    expect(w.flat().filter(Boolean)).toHaveLength(31);
    expect(w.every((r) => r.length === 7)).toBe(true);
    expect(monthWeeks({ year: 2028, month: 2 }).flat().filter(Boolean)).toHaveLength(29); // 윤년
  });
  it('처음 보여줄 달: 이번 달에 일정이 없으면 가장 가까운 이후 일정의 달', () => {
    expect(initialMonth('2026-10-13', ['2026-10-16', '2026-11-03'])).toEqual({ year: 2026, month: 10 });
    expect(initialMonth('2026-12-20', ['2027-01-05', '2027-02-01'])).toEqual({ year: 2027, month: 1 });
    expect(initialMonth('2026-10-13', [])).toEqual({ year: 2026, month: 10 });
    expect(initialMonth('2026-10-13', ['2026-10-01'])).toEqual({ year: 2026, month: 10 }); // 지난 날짜는 무시
  });
  it('이동 범위: 이번 달 ~ max(마지막 일정 달, 이번 달+2)', () => {
    expect(monthRange('2026-10-13', ['2026-10-16'])).toEqual({ min: { year: 2026, month: 10 }, max: { year: 2026, month: 12 } });
    expect(monthRange('2026-10-13', ['2027-03-02'])).toEqual({ min: { year: 2026, month: 10 }, max: { year: 2027, month: 3 } });
  });
  it('제목·접근성 이름에 전체 날짜·요일·가능 여부', () => {
    expect(formatDayTitle('2026-10-16', '2026-10-13')).toBe('10월 16일(금)');
    expect(formatDayTitle('2027-01-05', '2026-12-20')).toBe('2027년 1월 5일(화)');
    expect(dayLabel('2026-10-16', '2026-10-13', 2, true)).toBe('2026년 10월 16일 금요일, 신청 가능한 공동 예약 2개, 선택됨');
    expect(dayLabel('2026-10-13', '2026-10-13', 0, false)).toBe('2026년 10월 13일 화요일, 오늘, 신청 가능한 공동 예약 없음');
  });
});

describe('카드 출장비(기존 정책과 같은 값)', () => {
  it('결제 완료 확정 세대 + 본인으로 나누고, 결제 대기 자리는 넣지 않는다', () => {
    const v = jointFeeView({ totalTripFee: 50000, confirmedHouseholds: 3 });
    expect(v).toEqual({ confirmed: 3, householdsWithMe: 4, myFee: 12500, savings: { amount: 37500, percent: 75 } });
    expect(v.myFee).toBe(expectedFeeForJoiner(50000, 3));
    expect(jointFeeView({ totalTripFee: 45000, confirmedHouseholds: 1 }).myFee).toBe(22500);
  });
  it('확정 0세대여도 0으로 나누지 않는다(본인 1세대 기준 = 총액)', () => {
    expect(jointFeeView({ totalTripFee: 50000, confirmedHouseholds: 0 })).toMatchObject({ householdsWithMe: 1, myFee: 50000 });
  });
  it('원 단위는 내림', () => {
    expect(jointFeeView({ totalTripFee: 50000, confirmedHouseholds: 2 }).myFee).toBe(16666);
  });
});

describe('날짜별 공동 예약 조회(목업)', () => {
  const repo = () => new MockRepository({ latencyMs: 0 });
  it('그 날짜의 신청 가능한 그룹만(같은 날 여러 그룹, 자리 없는 그룹 제외)', async () => {
    const r = repo();
    expect((await r.listJointGroups('p1', 'ad-apt', '2026-10-16')).map((x) => x.id)).toEqual(['g1', 'g1b']);
    expect(await r.listJointGroups('p1', 'ad-apt', '2026-10-17')).toEqual([]); // g3: 남은 자리 0
    expect(await r.listJointGroups('p1', 'ad-far', '2026-10-16')).toEqual([]); // 주소 범위 밖
    expect(await r.listJointGroups('p1', null, '2026-10-16')).toEqual([]);
  });
  it('주소 판단이 불가하면 단정하지 않고 오류', async () => {
    const r = repo();
    new DevController(r).setSettings({ addressServiceDown: true });
    await expect(r.listJointGroups('p1', 'ad-apt', '2026-10-16')).rejects.toBeInstanceOf(RepoError);
  });
  it('마감 처리되거나 시간이 지나면 빠진다', async () => {
    const r = repo(); const dev = new DevController(r);
    dev.closeGroup('g1b');
    expect((await r.listJointGroups('p1', 'ad-apt', '2026-10-16')).map((x) => x.id)).toEqual(['g1']);
    dev.setNow('2026-10-15T18:00:00+09:00');
    expect(await r.listJointGroups('p1', 'ad-apt', '2026-10-16')).toEqual([]);
  });
});
