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
  p8: { weekdays: [1, 2, 3, 4, 5, 6], closedDates: [], lastDate: '2026-11-08' },  // ───── 추가 업체(p9~p35) ─────
  // 창가손길: 월~금
  p9: { weekdays: [1, 2, 3, 4, 5], closedDates: [], lastDate: '2026-11-30' },
  // 바람길창호: 화~토, 10/31(토) 휴무
  p10: { weekdays: [2, 3, 4, 5, 6], closedDates: ['2026-10-31'], lastDate: '2026-11-30' },
  // 촘촘방충망: 수~일
  p11: { weekdays: [0, 3, 4, 5, 6], closedDates: [], lastDate: '2026-11-29' },
  // 틈새지기: 월·화·목·금
  p12: { weekdays: [1, 2, 4, 5], closedDates: [], lastDate: '2026-11-30' },
  // 열고닫고: 월~토, 접수는 11/15까지
  p13: { weekdays: [1, 2, 3, 4, 5, 6], closedDates: [], lastDate: '2026-11-15' },
  // 산들창: 화~일(월요일 정기 휴무)
  p14: { weekdays: [0, 2, 3, 4, 5, 6], closedDates: [], lastDate: '2026-11-29' },
  // 또르르창문: 월·수·금
  p15: { weekdays: [1, 3, 5], closedDates: [], lastDate: '2026-11-30' },
  // 햇살창틀: 월~금, 11/4(수) 휴무
  p16: { weekdays: [1, 2, 3, 4, 5], closedDates: ['2026-11-04'], lastDate: '2026-11-30' },
  // 물길수리: 월~토
  p17: { weekdays: [1, 2, 3, 4, 5, 6], closedDates: [], lastDate: '2026-11-30' },
  // 똑똑수전: 매일, 10/29(목) 휴무
  p18: { weekdays: [0, 1, 2, 3, 4, 5, 6], closedDates: ['2026-10-29'], lastDate: '2026-11-30' },
  // 맑은물설비: 월~금, 접수는 11/20까지
  p19: { weekdays: [1, 2, 3, 4, 5], closedDates: [], lastDate: '2026-11-20' },
  // 욕실단짝: 화~토
  p20: { weekdays: [2, 3, 4, 5, 6], closedDates: [], lastDate: '2026-11-28' },
  // 물샐틈없이: 월·수·목·토
  p21: { weekdays: [1, 3, 4, 6], closedDates: [], lastDate: '2026-11-30' },
  // 주방손질: 월~금, 11/6(금) 휴무
  p22: { weekdays: [1, 2, 3, 4, 5], closedDates: ['2026-11-06'], lastDate: '2026-11-30' },
  // 욕실살림: 목~일
  p23: { weekdays: [0, 4, 5, 6], closedDates: [], lastDate: '2026-11-29' },
  // 우리집수리: 월~토
  p24: { weekdays: [1, 2, 3, 4, 5, 6], closedDates: [], lastDate: '2026-11-30' },
  // 단단철물: 월~금, 10/28(수) 휴무
  p25: { weekdays: [1, 2, 3, 4, 5], closedDates: ['2026-10-28'], lastDate: '2026-11-30' },
  // 고쳐쓰는집: 화·목·토·일
  p26: { weekdays: [0, 2, 4, 6], closedDates: [], lastDate: '2026-11-29' },
  // 나무결손질: 월~금, 접수는 11/13까지
  p27: { weekdays: [1, 2, 3, 4, 5], closedDates: [], lastDate: '2026-11-13' },
  // 달아드림: 월~토, 11/2(월) 휴무
  p28: { weekdays: [1, 2, 3, 4, 5, 6], closedDates: ['2026-11-02'], lastDate: '2026-11-30' },
  // 반짝설치: 수~일
  p29: { weekdays: [0, 3, 4, 5, 6], closedDates: [], lastDate: '2026-11-29' },
  // 온집부속: 월·화·수·금
  p30: { weekdays: [1, 2, 3, 5], closedDates: [], lastDate: '2026-11-30' },
  // 아늑한손: 화~토
  p31: { weekdays: [2, 3, 4, 5, 6], closedDates: [], lastDate: '2026-11-28' },
  // 방방손질: 월~금, 접수는 11/8까지
  p32: { weekdays: [1, 2, 3, 4, 5], closedDates: [], lastDate: '2026-11-08' },
  // 차곡차곡: 월·수·금·토, 10/30(금) 휴무
  p33: { weekdays: [1, 3, 5, 6], closedDates: ['2026-10-30'], lastDate: '2026-11-30' },
  // 현관지기: 매일, 접수는 11/22까지
  p34: { weekdays: [0, 1, 2, 3, 4, 5, 6], closedDates: [], lastDate: '2026-11-22' },
  // 부엌손길: 화~금
  p35: { weekdays: [2, 3, 4, 5], closedDates: [], lastDate: '2026-11-27' },
};
