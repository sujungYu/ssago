/**
 * 업체 상세 ‘공동 예약 일정’ 캘린더의 순수 계산. 날짜는 모두 Asia/Seoul 기준 YYYY-MM-DD 문자열로 다룬다.
 * 신청 가능 판단은 기존 기준(접수 중·마감 전·남은 자리·주소 범위)을 그대로 쓴다. 주소 범위는 저장소가 이미 거른 그룹만 받는다.
 */
import { perHouseholdFee, tripFeeSavings } from './pricing';
import { seatsLeft } from './rules';
import { seoulYmd } from './time';
import type { IsoDate, IsoDateTime, PublicGroup, Won } from './types';

/** 접수 마감 전이고 남은 자리가 있는 그룹만 신청 가능. (종료·마감 처리된 그룹과 주소 범위 밖 그룹은 저장소에서 이미 제외) */
export function isGroupJoinable(g: PublicGroup, now: IsoDateTime): boolean {
  return seatsLeft(g) > 0 && new Date(g.closeAt).getTime() > new Date(now).getTime();
}

/** 신청할 수 없게 된 이유(선택 후 상태가 바뀐 경우 안내용). 그룹이 목록에서 사라졌으면 주소 범위 밖·종료로 본다. */
export type UnjoinableReason = 'closed' | 'full' | 'unavailable';
export function unjoinableReason(g: PublicGroup | undefined, now: IsoDateTime): UnjoinableReason | null {
  if (!g) return 'unavailable';
  if (new Date(g.closeAt).getTime() <= new Date(now).getTime()) return 'closed';
  if (seatsLeft(g) <= 0) return 'full';
  return null;
}
export const UNJOINABLE_TEXT: Record<UnjoinableReason, string> = {
  closed: '접수가 마감됐어요.',
  full: '남은 자리가 없어요.',
  unavailable: '접수가 마감·종료됐거나 현재 주소로는 참여할 수 없게 됐어요.',
};

/** 신청 가능한 그룹이 있는 날짜별 그룹 수 */
export function joinableDateCounts(groups: PublicGroup[], now: IsoDateTime): Map<IsoDate, number> {
  const m = new Map<IsoDate, number>();
  for (const g of groups) if (isGroupJoinable(g, now)) m.set(g.date, (m.get(g.date) ?? 0) + 1);
  return m;
}

export interface YearMonth { year: number; month: number } // month: 1~12
export const ymOf = (ymd: IsoDate): YearMonth => ({ year: Number(ymd.slice(0, 4)), month: Number(ymd.slice(5, 7)) });
export const ymKey = (ym: YearMonth): string => `${ym.year}-${String(ym.month).padStart(2, '0')}`;
export function addMonths(ym: YearMonth, n: number): YearMonth {
  const i = ym.year * 12 + (ym.month - 1) + n;
  return { year: Math.floor(i / 12), month: (i % 12) + 1 };
}
export const cmpYm = (a: YearMonth, b: YearMonth): number => (a.year - b.year) * 12 + (a.month - b.month);

/** 오늘(KST) */
export const todayYmd = (now: IsoDateTime): IsoDate => seoulYmd(now);

/**
 * 처음 보여줄 달: 이번 달에 신청 가능한 날짜가 있으면 이번 달, 없고 이후 일정이 있으면 가장 가까운 일정의 달, 없으면 이번 달.
 */
export function initialMonth(today: IsoDate, dates: Iterable<IsoDate>): YearMonth {
  const cur = ymOf(today);
  const future = [...dates].filter((d) => d >= today).sort();
  if (!future.length || future.some((d) => cmpYm(ymOf(d), cur) === 0)) return cur;
  return ymOf(future[0]);
}

/** 이동 가능한 달 범위: 이번 달 ~ max(마지막 일정의 달, 이번 달 + 2) */
export function monthRange(today: IsoDate, dates: Iterable<IsoDate>): { min: YearMonth; max: YearMonth } {
  const min = ymOf(today);
  let max = addMonths(min, 2);
  for (const d of dates) if (cmpYm(ymOf(d), max) > 0) max = ymOf(d);
  return { min, max };
}

/** 일요일 시작 달력 칸(앞뒤 빈칸은 null), 7칸씩 주 단위 */
export function monthWeeks(ym: YearMonth): (IsoDate | null)[][] {
  const first = new Date(Date.UTC(ym.year, ym.month - 1, 1));
  const days = new Date(Date.UTC(ym.year, ym.month, 0)).getUTCDate();
  const cells: (IsoDate | null)[] = Array(first.getUTCDay()).fill(null);
  for (let d = 1; d <= days; d++) cells.push(`${ymKey(ym)}-${String(d).padStart(2, '0')}`);
  while (cells.length % 7) cells.push(null);
  const weeks: (IsoDate | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토'];
/** 날짜의 요일(달력 계산용, 시간대와 무관하게 날짜 자체로 계산) */
export function weekdayOf(ymd: IsoDate): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return WEEKDAY[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}
/** 예: 10월 16일(금) — 올해가 아니면 연도를 붙인다 */
export function formatDayTitle(ymd: IsoDate, today: IsoDate): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const yy = y !== Number(today.slice(0, 4)) ? `${y}년 ` : '';
  return `${yy}${m}월 ${d}일(${weekdayOf(ymd)})`;
}
/** 날짜 버튼의 접근성 이름 */
export function dayLabel(ymd: IsoDate, today: IsoDate, count: number, selected: boolean): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const parts = [`${y}년 ${m}월 ${d}일 ${weekdayOf(ymd)}요일`];
  if (ymd === today) parts.push('오늘');
  parts.push(count > 0 ? `신청 가능한 공동 예약 ${count}개` : '신청 가능한 공동 예약 없음');
  if (selected) parts.push('선택됨');
  return parts.join(', ');
}

/**
 * 카드의 출장비 표시. 기존 정책(expectedFeeForJoiner)과 같은 값: 결제 완료된 확정 세대 + 본인 1세대로 나눈 금액(원 단위 내림).
 * 결제 대기 자리는 분담 세대 수에 넣지 않는다. 최종 출장비는 마감 때 확정된 세대 수로 정해진다.
 */
export interface JointFeeView {
  /** 현재 확정 세대(결제 완료) */
  confirmed: number;
  /** 본인 예약 확정 시 분담 세대 수 = 확정 세대 + 1 */
  householdsWithMe: number;
  /** 본인 예약 확정 시 세대당 예상 출장비 */
  myFee: Won;
  /** 혼자 방문(총 출장비 전액) 대비 절감 */
  savings: { amount: Won; percent: number } | null;
}
export function jointFeeView(g: Pick<PublicGroup, 'totalTripFee' | 'confirmedHouseholds'>): JointFeeView {
  const confirmed = Math.max(0, g.confirmedHouseholds);
  const householdsWithMe = confirmed + 1; // 항상 1 이상이라 0으로 나누지 않는다
  return {
    confirmed, householdsWithMe,
    myFee: perHouseholdFee(g.totalTripFee, householdsWithMe) ?? g.totalTripFee,
    savings: tripFeeSavings(g.totalTripFee, householdsWithMe),
  };
}
