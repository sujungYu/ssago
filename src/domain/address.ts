/**
 * 주소 규칙. 세 가지를 구분한다.
 * - 탐색 주소(Address): 업체 찾기에서 고른 지역·건물 주소. 동·호수 없음. 공동 예약 ‘후보’ 조회에만 쓴다.
 * - 재사용 방문 주소(SavedVisitAddress): 고객이 ‘다음 신청에도 이 주소 사용’에 동의한 건물 + 상세 주소. 사용자당 최근 1개.
 * - 요청·예약 방문 주소(VisitAddress): 제출 당시 스냅숏. 이후 탐색·재사용 주소가 바뀌어도 바뀌지 않는다.
 * 상세 주소는 동·호수·층 등 자유 입력이며 형식을 강제하지 않는다(단독주택은 비어 있을 수 있다).
 */
import type { Address, SavedVisitAddress, VisitAddress } from './types';

export const VISIT_ADDRESS_MISSING = '방문 주소 확인 필요';
export const SAVED_ADDRESS_LOADED = '저장한 주소를 불러왔어요. 방문 주소를 확인해주세요.';

/** 같은 건물(기본 주소)인지: 건물 식별자와 기본 주소가 모두 같아야 한다. ‘같은 동네·같은 단지’만으로는 같다고 보지 않는다. */
export function isSameBuilding(a: { addressId: string; line1: string }, base: Pick<Address, 'id' | 'line1'>): boolean {
  return a.addressId === base.id && a.line1 === base.line1;
}

/** 이 건물에 자동 입력할 저장 상세 주소. 다른 건물이면 null(이전 동·호수를 붙이지 않는다). */
export function savedDetailFor(saved: SavedVisitAddress | null | undefined, base: Pick<Address, 'id' | 'line1'> | null | undefined): string | null {
  if (!saved || !base) return null;
  return isSameBuilding(saved, base) ? saved.detail : null;
}

/** 제출 당시 방문 주소 스냅숏 */
export function toVisitAddress(base: Address, detail: string): VisitAddress {
  return { addressId: base.id, label: base.label, line1: base.line1, kind: base.kind, detail: detail.trim() };
}

/** 상세 주소 입력 검증: 아파트는 방문에 필요한 상세 정보를 요구하되 형식(동·호)은 강제하지 않는다. */
export function detailError(kind: Address['kind'] | undefined, detail: string): string | null {
  if (detail.length > 60) return '상세 주소는 60자까지 입력할 수 있어요.';
  if (kind === 'apartment' && !detail.trim()) return '방문에 필요한 상세 주소(동·호수, 층 등)를 입력해 주세요.';
  return null;
}
