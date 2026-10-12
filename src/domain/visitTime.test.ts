import { describe, expect, it } from 'vitest';
import { VISIT_TIME_MISSING, formatSlot, formatVisit, isWithinSlot, isWithinSlots, parseSlot, proposedVisitTimeError } from './visitTime';

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
