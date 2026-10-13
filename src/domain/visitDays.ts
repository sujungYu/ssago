/**
 * 업체 상세 ‘방문 날짜 선택’ 캘린더의 날짜 유형. 날짜는 모두 Asia/Seoul 기준 YYYY-MM-DD 문자열로 다룬다.
 * - 공동 예약(joint): 이 업체·현재 조회 주소의 그룹 중 신청 가능한(마감 전·남은 자리 있음) 그룹이 있는 날. 기존 기준(isGroupJoinable) 그대로.
 * - 새 요청(new): 업체의 새 요청 접수 기준(운영 요일·휴무일·접수 마지막 날짜)과 공통 접수 기준(지금부터 48시간 이후 날짜)을 모두 만족하는 날.
 *   고객이 희망 날짜로 요청할 수 있는 날일 뿐 방문 확정일이 아니다(업체가 방문 가능 여부를 확인한다).
 *   공동 예약이 없다고 요청 가능으로 보지 않고, 공동 예약이 마감·정원 초과여도 이 기준으로 따로 판단한다.
 * - 요청 불가(none): 둘 다 아님(과거·접수 기준 이전·휴무·접수 범위 밖·접수 기준 없음).
 * 같은 날짜에 두 유형이 모두 가능하면 공동 예약을 우선 표시한다.
 */
import { joinableDateCounts, todayYmd, weekdayOf } from './jointCalendar';
import { seatsLeft } from './rules';
import { addHours, seoulYmd } from './time';
import type { IsoDate, IsoDateTime, NewRequestPolicy, PublicGroup } from './types';

/** 공통 접수 기준: 지금부터 48시간 이후 날짜만 희망 날짜로 고를 수 있다(기존 요청서 기준과 같음) */
export const NEW_REQUEST_LEAD_HOURS = 48;
export const newRequestMinDate = (now: IsoDateTime): IsoDate => seoulYmd(addHours(now, NEW_REQUEST_LEAD_HOURS));

export type NewRequestBlock = 'no_policy' | 'past' | 'lead_time' | 'out_of_range' | 'closed_date' | 'day_off';
export const NEW_REQUEST_BLOCK_TEXT: Record<NewRequestBlock, string> = {
  no_policy: '이 업체는 지금 새 요청을 받을 수 있는 날짜가 없어요.',
  past: '지난 날짜예요.',
  lead_time: '요청은 지금부터 48시간 이후 날짜로 보낼 수 있어요.',
  out_of_range: '업체가 아직 이 날짜의 요청을 받지 않아요.',
  closed_date: '업체 휴무일이에요.',
  day_off: '업체가 쉬는 요일이에요.',
};

const WEEKDAY_INDEX: Record<string, number> = { 일: 0, 월: 1, 화: 2, 수: 3, 목: 4, 금: 5, 토: 6 };
const isYmd = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(new Date(`${d}T12:00:00+09:00`).getTime());

/** 이 날짜로 새 요청을 보낼 수 없는 이유. 보낼 수 있으면 null */
export function newRequestBlock(policy: NewRequestPolicy | null | undefined, date: IsoDate, now: IsoDateTime): NewRequestBlock | null {
  if (!policy) return 'no_policy';
  if (!isYmd(date) || date < todayYmd(now)) return 'past';
  if (date < newRequestMinDate(now)) return 'lead_time';
  if (date > policy.lastDate) return 'out_of_range';
  if (policy.closedDates.includes(date)) return 'closed_date';
  if (!policy.weekdays.includes(WEEKDAY_INDEX[weekdayOf(date)])) return 'day_off';
  return null;
}

/** 오늘부터 접수 마지막 날짜까지 새 요청 가능한 날짜(오름차순) */
export function newRequestDates(policy: NewRequestPolicy | null | undefined, now: IsoDateTime): IsoDate[] {
  if (!policy || !isYmd(policy.lastDate)) return [];
  const out: IsoDate[] = [];
  const start = new Date(`${todayYmd(now)}T12:00:00Z`);
  for (let t = start.getTime(); ; t += 86_400_000) {
    const d = new Date(t).toISOString().slice(0, 10);
    if (d > policy.lastDate) break;
    if (newRequestBlock(policy, d, now) === null) out.push(d);
  }
  return out;
}

export type DayKind = 'joint' | 'new' | 'none';

/** 캘린더에 쓰는 날짜별 유형. 공동 예약 날짜(신청 가능한 그룹 수)와 새 요청 날짜를 합치고, 겹치면 공동 예약 우선 */
export interface VisitDays {
  joint: Map<IsoDate, number>;
  newDates: Set<IsoDate>;
  kindOf: (d: IsoDate) => DayKind;
  /** 고를 수 있는 모든 날짜(달 범위·처음 달 계산용) */
  all: IsoDate[];
}
export function visitDays(groups: PublicGroup[], policy: NewRequestPolicy | null | undefined, now: IsoDateTime): VisitDays {
  const today = todayYmd(now);
  const joint = new Map([...joinableDateCounts(groups, now)].filter(([d]) => d >= today));
  const newDates = new Set(newRequestDates(policy, now));
  const kindOf = (d: IsoDate): DayKind => ((joint.get(d) ?? 0) > 0 ? 'joint' : newDates.has(d) ? 'new' : 'none');
  return { joint, newDates, kindOf, all: [...new Set([...joint.keys(), ...newDates])].sort() };
}

/**
 * 새 요청 날짜 카드의 공동 예약 안내. 이 날짜에 공동 예약이 있었지만 마감·정원 초과로 참여할 수 없으면 그 사유를, 없으면 ‘없어요’.
 * groups = 이 주소로 보이는 그룹(마감 시각이 지났거나 자리가 없는 그룹 포함), closedDates = 접수가 마감 처리된 그룹의 날짜.
 */
export function jointNoteForNewDay(date: IsoDate, groups: PublicGroup[], closedDates: IsoDate[], now: IsoDateTime): string {
  const nowMs = new Date(now).getTime();
  const sameDay = groups.filter((g) => g.date === date);
  const closed = closedDates.includes(date) || sameDay.some((g) => new Date(g.closeAt).getTime() <= nowMs);
  const full = sameDay.some((g) => new Date(g.closeAt).getTime() > nowMs && seatsLeft(g) <= 0);
  if (closed && full) return '이 날짜의 공동 예약은 접수가 마감됐거나 남은 자리가 없어요.';
  if (closed) return '이 날짜의 공동 예약은 접수가 마감됐어요.';
  if (full) return '이 날짜의 공동 예약은 남은 자리가 없어요.';
  return '현재 참여 가능한 공동 예약은 없어요.';
}
