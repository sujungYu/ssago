import { describe, expect, it } from 'vitest';
import { NEW_DATE_WINDOWS, VISIT_TIME_MISSING, formatSlot, formatSlots, formatVisit, isValidRequestTimes, isWithinSlot, isWithinSlots, parseSlot, proposedVisitTimeError, selectableTimes } from './visitTime';

describe('고객 가능 시간(범위)', () => {
  it('저장 형식(–)과 표시 형식(~) 모두 읽고, 13:00~16:00으로 표시한다', () => {
    expect(parseSlot('13:00–16:00')).toEqual({ start: '13:00', end: '16:00' });
    expect(parseSlot('13:00~16:00')).toEqual({ start: '13:00', end: '16:00' });
    expect(formatSlot('13:00–16:00')).toBe('13:00~16:00');
    expect(parseSlot('16:00–13:00')).toBeNull();
    expect(parseSlot('오후')).toBeNull();
  });
  it('범위 경계(시작·끝)를 포함한다', () => {
    expect(isWithinSlot('13:00', '13:00–16:00')).toBe(true);
    expect(isWithinSlot('16:00', '13:00–16:00')).toBe(true);
    expect(isWithinSlot('12:59', '13:00–16:00')).toBe(false);
    expect(isWithinSlot('16:01', '13:00–16:00')).toBe(false);
    expect(isWithinSlots('10:00', ['09:00–12:00', '13:00–16:00'])).toBe(true);
  });
});

describe('최초 업체 제안 방문 시각 검증', () => {
  it('고객 가능 시간 안이어야 한다', () => {
    expect(proposedVisitTimeError('14:00', ['13:00–16:00'])).toBeNull();
    expect(proposedVisitTimeError('17:00', ['13:00–16:00'])).toMatch(/13:00~16:00/);
  });
  it('없거나 형식이 틀리면 오류(범위에서 추정하지 않는다)', () => {
    expect(proposedVisitTimeError(undefined, ['13:00–16:00'])).toMatch(/필요/);
    expect(proposedVisitTimeError('2pm', ['13:00–16:00'])).toMatch(/HH:MM/);
    expect(proposedVisitTimeError('24:00', ['13:00–16:00'])).toMatch(/HH:MM/);
  });
});

describe('방문 시각 표시', () => {
  it('날짜와 단일 시각, 한국 날짜 기준', () => {
    expect(formatVisit('2026-10-12', '14:00')).toBe('10월 12일 (월) 14:00');
  });
  it('시각이 없으면 ‘방문 시각 확인 필요’', () => {
    expect(formatVisit('2026-10-12')).toBe(`10월 12일 (월) · ${VISIT_TIME_MISSING}`);
    expect(formatVisit('2026-10-12', '')).toContain(VISIT_TIME_MISSING);
  });
});

describe('방문 가능한 시각(정확한 시각 선택)', () => {
  it('시간대 → 1시간 간격 시작 시각(끝 제외), 겹침 제거·정렬, 정확한 시각 항목은 그대로', () => {
    expect(selectableTimes(['09:00–12:00'])).toEqual(['09:00', '10:00', '11:00']);
    expect(selectableTimes(NEW_DATE_WINDOWS)).toEqual(['09:00', '10:00', '11:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00']);
    expect(selectableTimes(['13:00–16:00', '14:00', 'bad'])).toEqual(['13:00', '14:00', '15:00']);
    expect(selectableTimes([])).toEqual([]);
  });
  it('새 요청 시각: 하나 이상·중복 없음·선택 가능한 시각만(범위 저장 불가)', () => {
    expect(isValidRequestTimes(['09:00', '14:00'], NEW_DATE_WINDOWS)).toBe(true);
    expect(isValidRequestTimes([], NEW_DATE_WINDOWS)).toBe(false);
    expect(isValidRequestTimes(['09:00', '09:00'], NEW_DATE_WINDOWS)).toBe(false);
    expect(isValidRequestTimes(['12:00'], NEW_DATE_WINDOWS)).toBe(false);
    expect(isValidRequestTimes(['09:00–12:00'], NEW_DATE_WINDOWS)).toBe(false);
    expect(isValidRequestTimes(['10:00'], ['13:00–16:00'])).toBe(false);
  });
  it('업체 제안: 정확한 시각 요청은 고른 시각 중 하나, 이전 범위 요청은 범위 안', () => {
    expect(proposedVisitTimeError('14:00', ['09:00', '14:00'])).toBeNull();
    expect(proposedVisitTimeError('14:30', ['09:00', '14:00'])).toContain('고른 방문 가능한 시각');
    expect(proposedVisitTimeError('14:30', ['13:00–16:00'])).toBeNull();
    expect(formatSlots(['09:00', '14:00'])).toBe('09:00, 14:00');
  });
});
