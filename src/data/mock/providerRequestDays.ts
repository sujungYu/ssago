import type { NewRequestPolicy } from '../../domain/types';

/**
 * 업체별 새 요청 접수 기준(가상 데이터). 업체 상세 ‘방문 날짜 선택’의 ‘새 요청 가능’ 날짜와 요청 접수 검증이 이 값을 함께 쓴다.
 * 실제 서비스에서는 업체(파트너)가 운영 요일·휴무일·접수 기간을 등록하는 데이터다 — 이번 데모에는 등록 화면·서버 연동이 없다.
 * 공동 예약 데모 일정(seed.ts 그룹)과는 별개다: 공동 예약 날짜가 운영 요일이 아니어도 그 그룹은 그대로 참여할 수 있다.
 * 공통 접수 기준(지금부터 48시간 이후, domain/visitDays.ts)은 모든 업체에 함께 적용된다.
 * weekdays: 0 = 일요일 ~ 6 = 토요일.
 */
export const PROVIDER_REQUEST_DAYS: Record<string, NewRequestPolicy> = {
  // 한빛설비: 월~토, 10/28(수) 휴무
  p1: { weekdays: [1, 2, 3, 4, 5, 6], closedDates: ['2026-10-28'], lastDate: '2026-11-30' },
  // 새봄수리: 월~금, 10/30(금) 휴무
  p2: { weekdays: [1, 2, 3, 4, 5], closedDates: ['2026-10-30'], lastDate: '2026-11-30' },
  // 밝은전기: 월요일 정기 휴무(화~일)
  p3: { weekdays: [0, 2, 3, 4, 5, 6], closedDates: [], lastDate: '2026-11-22' },
  // 든든문고리: 월·수·금·토
  p4: { weekdays: [1, 3, 5, 6], closedDates: ['2026-11-07'], lastDate: '2026-11-30' },
  // 깔끔마감: 월~금
  p5: { weekdays: [1, 2, 3, 4, 5], closedDates: [], lastDate: '2026-11-30' },
  // 손맵시: 화~토, 10/27(화) 휴무
  p6: { weekdays: [2, 3, 4, 5, 6], closedDates: ['2026-10-27'], lastDate: '2026-11-30' },
  // 맑은창방충망: 수·토·일
  p7: { weekdays: [0, 3, 6], closedDates: [], lastDate: '2026-11-29' },
  // 반듯설치: 월~토, 접수는 11/8까지
  p8: { weekdays: [1, 2, 3, 4, 5, 6], closedDates: [], lastDate: '2026-11-08' },
};
