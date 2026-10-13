/**
 * 방문 시간 규칙. 세 가지를 구분한다.
 * - 방문 가능한 시간(TimeSlot): 고객이 요청서에 낸 희망 시각. 새 요청은 정확한 시각 목록(예: 09:00, 14:00),
 *   이전 요청은 범위(예: 13:00–16:00 → 화면 표시 13:00~16:00)
 * - 업체 제안 방문 시각(VisitTime): 업체가 고객이 고른 시각 중에서(이전 요청은 범위 안에서) 제시한 도착 예정 시각. 예) 14:00
 * - 예약 방문 시각(VisitTime): 고객이 승인 조건을 확인하고 예약금을 결제해 확정한 시각
 * 방문 시각은 도착 예정 시각이며 작업 소요 시간이 아니다. 모든 시각은 한국 시간(Asia/Seoul)이다.
 * 범위의 시작·중간값 등으로 방문 시각을 추정하지 않는다. 값이 없으면 ‘방문 시각 확인 필요’로 표시한다.
 */
import { formatDate } from './time';
import type { IsoDate, TimeSlot, VisitTime } from './types';

export const VISIT_TIME_MISSING = '방문 시각 확인 필요';
export const DURATION_NOTE = '작업 소요 시간은 수리 내용에 따라 달라집니다.';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isValidVisitTime(t: string | null | undefined): t is VisitTime {
  return !!t && HHMM.test(t);
}

// ───────── 방문 가능한 시각(요청서) ─────────
// 새 요청은 고객이 고른 정확한 시각 목록(예: ["09:00", "14:00"])을 slots에 저장한다. 이전 요청의 시간 범위("13:00–16:00")는
// 그대로 두고 범위로 표시·검증한다(특정 시각으로 바꾸지 않는다). 선택은 희망 시각일 뿐 배정·확정이 아니다.

/** 선택 가능한 시각 간격(분). 일정 데이터가 시간대(범위)만 주므로 그 안에서 이 간격으로 시각을 만든다 */
export const VISIT_TIME_STEP_MIN = 60;
/**
 * 새 날짜 요청의 방문 가능 시간대. 업체별 운영 시간 데이터가 아직 없어 모든 업체에 공통으로 쓴다(공동 예약은 그 그룹의 시간대).
 * 요청서 화면과 저장소 검증이 이 값을 함께 쓴다.
 */
export const NEW_DATE_WINDOWS: TimeSlot[] = ['09:00–12:00', '13:00–16:00', '16:00–19:00'];

/** "14:00"처럼 정확한 시각 하나인지(범위가 아님) */
export const isExactTime = (slot: TimeSlot): boolean => isValidVisitTime(slot.trim());

const toMin = (t: VisitTime) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const toHHMM = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/**
 * 시간대 목록 → 선택 가능한 정확한 시각(오름차순·중복 없음). 범위는 시작 시각부터 간격마다, 끝 시각은 제외한다
 * (예: 09:00–12:00 → 09:00 · 10:00 · 11:00 — 끝 시각에 도착하면 그 시간대 안에서 방문할 수 없음). 정확한 시각 항목은 그대로 쓴다.
 */
export function selectableTimes(windows: TimeSlot[], stepMin = VISIT_TIME_STEP_MIN): VisitTime[] {
  const out = new Set<VisitTime>();
  for (const w of windows) {
    if (isExactTime(w)) { out.add(w.trim()); continue; }
    const s = parseSlot(w);
    if (!s) continue;
    for (let m = toMin(s.start); m < toMin(s.end); m += stepMin) out.add(toHHMM(m));
  }
  return [...out].sort();
}

/** 새 요청의 방문 가능한 시각이 유효한지: 하나 이상, 중복 없음, 모두 선택 가능한 시각 */
export function isValidRequestTimes(times: TimeSlot[], windows: TimeSlot[]): boolean {
  if (!times.length || new Set(times).size !== times.length) return false;
  const allowed = new Set(selectableTimes(windows));
  return times.every((t) => isExactTime(t) && allowed.has(t));
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

/** 시각이 고객이 낸 시간 안인지. 정확한 시각(새 요청)은 같은 시각이어야 하고, 범위(이전 요청)는 시작·끝 포함. 도착 예정 시각 기준이다. */
export function isWithinSlot(time: VisitTime, slot: TimeSlot): boolean {
  if (!isValidVisitTime(time)) return false;
  if (isExactTime(slot)) return time === slot.trim();
  const s = parseSlot(slot);
  return !!s && time >= s.start && time <= s.end;
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
  if (!isWithinSlots(time, customerSlots)) return customerSlots.every(isExactTime)
    ? `고객이 고른 방문 가능한 시각(${formatSlots(customerSlots)}) 중 하나여야 해요.`
    : `고객 가능 시간(${formatSlots(customerSlots)}) 안의 시각이어야 해요.`;
  return null;
}

/** 방문 시각 표시: 10월 16일 (금) 14:00 · 값이 없으면 ‘방문 시각 확인 필요’를 붙인다(추정하지 않음) */
export function formatVisit(date: IsoDate, time?: VisitTime | null): string {
  return isValidVisitTime(time) ? `${formatDate(date)} ${time}` : `${formatDate(date)} · ${VISIT_TIME_MISSING}`;
}
