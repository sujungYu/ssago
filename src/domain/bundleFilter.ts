/**
 * 비교 요청(같은 작업의 업체별 요청 묶음) 상태 필터. 조회 조건만 바꾸며 요청 데이터·업무 상태를 바꾸지 않는다.
 * - 단일 선택. 'all' = 상태 조건 해제.
 * - 상태 그룹은 보낸 요청 필터와 같은 매핑(STATUS_GROUP_STATUSES)을 쓴다: 결제 대기 = 승인 후 결제 전(approved_pending_payment, 조건 재확인 포함),
 *   종료 = 업체 거절·철회·승인 만료·다른 업체 예약으로 종료. 카드에는 실제 상태·사유를 보여준다.
 * - 예약 확정(booked)은 이 필터의 선택지에 없으며 ‘전체’에서만 보인다(종료로 분류하지 않는다).
 */
import { STATUS_GROUP_STATUSES } from './requestFilter';
import type { RequestStatus } from './types';

export type BundleStatusFilter = 'all' | 'payment_pending' | 'needs_info' | 'reviewing' | 'ended';

export const BUNDLE_STATUS_OPTIONS: { value: BundleStatusFilter; label: string }[] = [
  { value: 'all', label: '전체' },
  { value: 'payment_pending', label: '결제 대기' },
  { value: 'needs_info', label: '추가 정보 필요' },
  { value: 'reviewing', label: '업체 검토 중' },
  { value: 'ended', label: '종료' },
];

const VALUES = BUNDLE_STATUS_OPTIONS.map((o) => o.value);

export function matchesBundleStatus(status: RequestStatus, f: BundleStatusFilter): boolean {
  return f === 'all' || STATUS_GROUP_STATUSES[f].includes(status);
}

/** 전체 묶음에서 거른다(묶음 조회는 페이지 나눔 없이 모든 업체 요청을 돌려준다) */
export function filterBundleItems<T extends { request: { status: RequestStatus } }>(items: T[], f: BundleStatusFilter): T[] {
  return items.filter((i) => matchesBundleStatus(i.request.status, f));
}

// ───────── URL ↔ 필터(상태만) ─────────
export function parseBundleFilter(p: URLSearchParams): BundleStatusFilter {
  const v = p.get('status') as BundleStatusFilter | null;
  return v && VALUES.includes(v) ? v : 'all';
}
export function writeBundleFilter(base: URLSearchParams, f: BundleStatusFilter): URLSearchParams {
  const p = new URLSearchParams(base);
  if (f === 'all') p.delete('status'); else p.set('status', f);
  return p;
}
export const hasBundleFilterParams = (p: URLSearchParams): boolean => p.has('status');
