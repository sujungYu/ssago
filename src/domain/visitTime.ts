/**
 * 방문 시간 규칙. 세 가지를 구분한다.
 * - 고객 가능 시간(TimeSlot): 고객이 요청서에 제출한 범위. 예) 13:00–16:00 → 화면 표시 13:00~16:00
 * - 업체 제안 방문 시각(VisitTime): 업체가 고객 가능 시간 안에서 제시한 도착 예정 시각. 예) 14:00
 * - 예약 방문 시각(VisitTime): 고객이 승인 조건을 확인하고 예약금을 결제해 확정한 시각
 * 방문 시각은 도착 예정 시각이며 작업 소요 시간이 아니다. 모든 시각은 한국 시간(Asia/Seoul)이다.
 * 범위의 시작·중간값 등으로 방문 시각을 추정하지 않는다. 값이 없으면 ‘방문 시각 확인 필요’로 표시한다.
 */
import { formatDate } from './time';
import type { IsoDate, TimeSlot, VisitTime } from './types';

export const VISIT_TIME_MISSING = '방문 시각 확인 필요';
export const DURATION_NOTE = '작업 소요 시간은 수리 내용에 따라 달라집니다.';
export const ARRIVAL_NOTE = '방문 시각은 업체의 도착 예정 시각이에요.';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isValidVisitTime(t: string | null | undefined): t is VisitTime {
  return !!t && HHMM.test(t);
}

/** "13:00–16:00"(목업 저장 형식) · "13:00~16:00" · "13:00-16:00" → 시작·끝 */
export function parseSlot(slot: TimeSlot): { start: VisitTime; end: VisitTime } | null {
  const m = /^(\d{2}:\d{2})\s*[–~-]\s*(\d{2}:\d{2})$/.exec(slot.trim());
  if (!m || !isValidVisitTime(m[1]) || !isValidVisitTime(m[2]) || m[1] >= m[2]) return null;
  return { start: m[1], end: m[2] };
}

/** 고객 가능 시간 표시: 13:00~16:00 */
export function formatSlot(slot: TimeSlot): string {
  const s = parseSlot(slot);
  return s ? `${s.start}~${s.end}` : slot;
}
export const formatSlots = (slots: TimeSlot[]) => slots.map(formatSlot).join(', ');

/** 시각이 범위 안인지(시작·끝 포함). 도착 예정 시각 기준이다. */
export function isWithinSlot(time: VisitTime, slot: TimeSlot): boolean {
  const s = parseSlot(slot);
  return !!s && isValidVisitTime(time) && time >= s.start && time <= s.end;
}
export function isWithinSlots(time: VisitTime, slots: TimeSlot[]): boolean {
  return slots.some((s) => isWithinSlot(time, s));
}

/**
 * 최초 업체 제안(승인)의 방문 시각 검증. 고객 가능 시간 안이어야 한다.
 * 가능 시간 밖의 시각은 최초 승인으로 받지 않고, 예약 후 별도 변경 제안·고객 동의로만 처리한다.
 */
export function proposedVisitTimeError(time: string | null | undefined, customerSlots: TimeSlot[]): string | null {
  if (!time) return '업체 제안 방문 시각이 필요해요.';
  if (!isValidVisitTime(time)) return '방문 시각은 HH:MM 형식이어야 해요.';
  if (!isWithinSlots(time, customerSlots)) return `고객 가능 시간(${formatSlots(customerSlots)}) 안의 시각이어야 해요.`;
  return null;
}

/** 방문 시각 표시: 10월 16일 (금) 14:00 · 값이 없으면 ‘방문 시각 확인 필요’를 붙인다(추정하지 않음) */
export function formatVisit(date: IsoDate, time?: VisitTime | null): string {
  return isValidVisitTime(time) ? `${formatDate(date)} ${time}` : `${formatDate(date)} · ${VISIT_TIME_MISSING}`;
}
