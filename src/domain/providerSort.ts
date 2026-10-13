/**
 * 카테고리별 업체 목록 정렬(spec 5.30). 화면과 분리한 순수 함수. 업체를 숨기거나 더하지 않고 순서만 바꾼다.
 * 날짜·예상 출장비는 카드에 표시하는 값(ProviderSummary.nextJoint — 가장 빠른 신청 가능한 공동 예약 후보)을 그대로 쓴다.
 * 기준이 같으면 저장소가 준 기존 순서를 유지한다(안정 정렬) — 다시 고르거나 새로고침해도 순서가 흔들리지 않는다.
 */
import type { ProviderSummary } from './types';

export type ProviderSort = 'visit' | 'fee' | 'reviews' | 'rating';
export const DEFAULT_PROVIDER_SORT: ProviderSort = 'visit';

export const PROVIDER_SORT_OPTIONS: { value: ProviderSort; label: string }[] = [
  { value: 'visit', label: '방문 날짜 빠른 순' },
  { value: 'fee', label: '예상 출장비 낮은 순' },
  { value: 'reviews', label: '리뷰 많은 순' },
  { value: 'rating', label: '별점 높은 순' },
];

export const isProviderSort = (v: string | null): v is ProviderSort => PROVIDER_SORT_OPTIONS.some((o) => o.value === v);
export const providerSortLabel = (s: ProviderSort): string => PROVIDER_SORT_OPTIONS.find((o) => o.value === s)!.label;

type Sortable = Pick<ProviderSummary, 'rating' | 'reviewCount' | 'nextJoint'>;

/** 오름차순 비교. 값이 없으면(후보 없음·계산 불가) 뒤로 */
const ascMissingLast = (a: string | number | null | undefined, b: string | number | null | undefined): number => {
  const ma = a === null || a === undefined, mb = b === null || b === undefined;
  if (ma || mb) return Number(ma) - Number(mb);
  return a < b ? -1 : a > b ? 1 : 0;
};

const COMPARE: Record<ProviderSort, (a: Sortable, b: Sortable) => number> = {
  // 카드의 공동 예약 후보 날짜(YYYY-MM-DD 문자열 비교). 후보 없음은 뒤
  visit: (a, b) => ascMissingLast(a.nextJoint?.date, b.nextJoint?.date),
  // 카드의 공동 예약 후보 예상 출장비만 비교(기본 출장비와 섞지 않음). 후보 없음·계산 불가는 뒤
  fee: (a, b) => ascMissingLast(a.nextJoint?.expectedFee, b.nextJoint?.expectedFee),
  reviews: (a, b) => b.reviewCount - a.reviewCount,
  rating: (a, b) => b.rating - a.rating || b.reviewCount - a.reviewCount,
};

/** 새 배열을 돌려준다(원본·카드 데이터는 그대로). Array.prototype.sort는 안정 정렬이라 동률은 기존 순서 */
export function sortProviders<T extends Sortable>(items: T[], sort: ProviderSort): T[] {
  return [...items].sort(COMPARE[sort]);
}
