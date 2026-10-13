/**
 * 내 예약(통합) 목록의 탭 + 탭별 필터 ↔ URL. 탭마다 필터가 독립이며(서로 다른 쿼리 키), 탭 선택도 URL(tab)에 남겨
 * 뒤로가기·새로고침·상세에서 돌아올 때 복원한다. 쿼리에는 날짜·상태만 넣는다(고객 정보 없음).
 * - 보낸 요청: status·period·from·to (기존 내 요청 필터, src/domain/requestFilter.ts)
 * - 확정된 예약: a_status·a_visit·a_from·a_to·a_action / 완료·취소: p_status·p_visit·p_from·p_to (src/domain/bookingFilter.ts)
 */
import {
  BOOKING_FILTER_KEYS, parseBookingsFilter, writeBookingsFilter, type ActiveFilter, type BookingsFilterState, type PastFilter,
} from './bookingFilter';
import { FILTER_PARAM_KEYS, parseRequestFilter, writeRequestFilter, type RequestFilter } from './requestFilter';
import { RESERVATION_TABS, type BookingTab, type ReservationTab } from './reservationTabs';

export interface ReservationListFilter {
  tab: ReservationTab;
  requests: RequestFilter;
  active: ActiveFilter;
  past: PastFilter;
}

const isTab = (v: string | null): v is ReservationTab => RESERVATION_TABS.some((t) => t.value === v);
const ACTIVE_KEYS = BOOKING_FILTER_KEYS.filter((k) => k.startsWith('a_'));
const PAST_KEYS = BOOKING_FILTER_KEYS.filter((k) => k.startsWith('p_'));

/**
 * 잘못된 값은 기본값으로. tab이 없으면(이전 주소) 들어 있는 필터 키로 탭을 정한다:
 * 확정된 예약 키(a_*) → 확정된 예약, 완료·취소 키(p_*) → 완료·취소, 그 밖에는 첫 탭(보낸 요청).
 */
export function parseReservationFilter(p: URLSearchParams): ReservationListFilter {
  const raw = p.get('tab');
  const tab: ReservationTab = isTab(raw) ? raw
    : raw === null && ACTIVE_KEYS.some((k) => p.has(k)) ? 'active'
    : raw === null && PAST_KEYS.some((k) => p.has(k)) ? 'past'
    : 'requests';
  const b = parseBookingsFilter(p);
  return { tab, requests: parseRequestFilter(p), active: b.active, past: b.past };
}

/** 탭은 항상 쓰고(현재 탭을 URL로 복원), 기본값인 필터는 뺀다. 필터와 무관한 쿼리 값은 유지한다. */
export function writeReservationFilter(base: URLSearchParams, f: ReservationListFilter): URLSearchParams {
  const others = new URLSearchParams(base);
  for (const k of ['tab', ...FILTER_PARAM_KEYS, ...BOOKING_FILTER_KEYS]) others.delete(k);
  const out = new URLSearchParams({ tab: f.tab });
  for (const [k, v] of writeRequestFilter(new URLSearchParams(), f.requests)) out.append(k, v);
  for (const [k, v] of writeBookingsFilter(new URLSearchParams(), { tab: 'active', active: f.active, past: f.past })) out.append(k, v);
  for (const [k, v] of others) out.append(k, v);
  return out;
}

/**
 * 필터 조건이 주소에 있는가. tab만 있는 주소(예: 상세의 ‘보낸 요청으로’ 링크)는 조건이 없는 것으로 보고,
 * 공통 훅이 마지막 적용 조건에 그 탭을 덮어 쓴다(src/app/listFilter.ts).
 */
export function hasReservationFilterParams(p: URLSearchParams): boolean {
  return [...FILTER_PARAM_KEYS, ...BOOKING_FILTER_KEYS].some((k) => k !== 'tab' && p.has(k));
}

/** 현재 탭과 그 탭의 필터만으로 만든 키(조회 재실행·목록 위치 저장용). 다른 탭의 필터가 바뀌어도 같다. */
export function tabFilterKey(f: ReservationListFilter): string {
  const p = new URLSearchParams({ tab: f.tab });
  const src = f.tab === 'requests' ? writeRequestFilter(new URLSearchParams(), f.requests)
    : writeBookingsFilter(new URLSearchParams(), { tab: 'active', active: f.active, past: f.past });
  const keys: readonly string[] = f.tab === 'requests' ? FILTER_PARAM_KEYS : f.tab === 'active' ? ACTIVE_KEYS : PAST_KEYS;
  for (const [k, v] of src) if (keys.includes(k)) p.append(k, v);
  return p.toString();
}

/** 예약 탭의 조회 조건 입력(기존 예약 필터 형식) */
export function toBookingsState(f: ReservationListFilter & { tab: BookingTab }): BookingsFilterState {
  return { tab: f.tab, active: f.active, past: f.past };
}
