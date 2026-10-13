/**
 * 내 예약(통합 메뉴) 탭 분류 — 목록 노출 기준을 한 곳에서 관리한다. 업무 상태를 바꾸거나 새 상태를 만들지 않는다.
 *
 * - 보낸 요청(requests): 예약금 결제 성공으로 예약이 생기기 전의 요청 묶음. 검토 중·추가 정보 필요·승인 후 결제 대기
 *   (결제 실패·결과 확인 중 포함 — 예약이 생기지 않았으므로)·업체 거절·철회·승인 만료처럼 예약으로 이어지지 않고 끝난 요청도 남긴다.
 * - 확정된 예약(active): 예약이 확정된 뒤 이용 완료·예약 취소 전까지(방문 예정·작업 중·후속 방문 대기·최종 금액 확인·정산 대기·조건 재확인).
 * - 완료·취소(past): 최종 정산까지 끝난 이용 완료(workStatus=completed) 또는 확정 후 취소된 예약(환불 상태는 카드에서 계속 표시).
 *
 * 판단 근거는 실제 데이터의 연결 관계다(날짜·화면 문구로 추측하지 않음).
 * - 요청이 예약으로 이어졌는지 = 요청의 bookingId(예약금 결제 성공 시 예약 생성과 함께 기록) 또는 요청 상태 booked.
 * - 비교 요청 묶음은 묶음 단위로 한 탭에만 둔다: 묶음 안 한 요청이라도 예약으로 이어졌으면 묶음 전체를 보낸 요청에서 빼고,
 *   그 예약 하나만 확정된 예약/완료·취소에 보인다. 예약이 나중에 취소돼도 묶음은 보낸 요청으로 돌아오지 않는다
 *   (다른 업체 요청을 다시 활성화하지 않는다). 원본 요청·업체 응답 기록은 지우지 않고 요청·비교 요청 상세에서 계속 볼 수 있다.
 */
import type { Booking, RepairRequest } from './types';

export type ReservationTab = 'requests' | 'active' | 'past';
export type BookingTab = Exclude<ReservationTab, 'requests'>;

export const RESERVATION_TABS: { value: ReservationTab; label: string }[] = [
  { value: 'requests', label: '보낸 요청' },
  { value: 'active', label: '확정된 예약' },
  { value: 'past', label: '완료·취소' },
];
export const tabLabel = (t: ReservationTab): string => RESERVATION_TABS.find((x) => x.value === t)!.label;

/** 이 요청이 예약으로 이어졌는가(예약금 결제 성공 → 예약 생성) */
export function isConvertedToBooking(r: Pick<RepairRequest, 'status' | 'bookingId'>): boolean {
  return r.status === 'booked' || !!r.bookingId;
}

/** 요청 묶음(같은 작업의 업체별 요청)이 보낸 요청 탭에 남는가: 어느 요청도 예약으로 이어지지 않았을 때만 */
export function bundleInRequestsTab(requests: Pick<RepairRequest, 'status' | 'bookingId'>[]): boolean {
  return requests.length > 0 && !requests.some(isConvertedToBooking);
}

/**
 * 비교 요청을 쓰지 않는 데모: 개별 요청이 보낸 요청 탭에 남는가. 예약으로 이어지지 않았고, 비교 요청의 결과(다른 업체 예약으로 종료)가 아닐 때.
 * (원본 묶음 데이터는 그대로 두고 목록만 개별 요청 기준으로 만든다)
 */
export function requestInRequestsTab(r: Pick<RepairRequest, 'status' | 'bookingId'>): boolean {
  return !isConvertedToBooking(r) && r.status !== 'closed_other_booking';
}

/** 예약의 탭: 취소됐거나 최종 정산까지 끝나 이용 완료면 완료·취소, 그 외(작업이 끝났어도 정산이 남았으면)는 확정된 예약 */
export function bookingTabOf(b: Pick<Booking, 'status' | 'workStatus'>): BookingTab {
  return b.status === 'cancelled' || b.workStatus === 'completed' ? 'past' : 'active';
}

/** 상세 화면의 ‘목록으로’ 이동 대상 */
export const listPath = (t: ReservationTab): string => `/bookings?tab=${t}`;
export const LIST_LINK_LABEL: Record<ReservationTab, string> = {
  requests: '보낸 요청으로', active: '확정된 예약으로', past: '완료·취소 내역으로',
};
