import { useAppState, useRepo } from '../../app/context';
import { useAsync, type AsyncState } from '../../app/hooks';
import type { Address } from '../../domain/types';

/**
 * 업체 찾기의 탐색 지역·건물 주소. 업체 찾기·카테고리별 업체 목록·업체 상세가 같은 앱 상태(addressId)를 읽는다(화면별 주소 상태 없음).
 * 주소 내용은 저장소에서 불러온다(실제 주소 검색으로 등록한 주소 또는 시드의 가상 주소). 동·호수 같은 신청용 상세 주소는 여기에 없다.
 */
export function useExploreAddress(): { addressId: string | null; address: AsyncState<Address | null> } {
  const repo = useRepo();
  const { addressId } = useAppState();
  const address = useAsync(() => (addressId ? repo.getAddress(addressId) : Promise.resolve(null)), [repo, addressId]);
  return { addressId, address };
}

/** 표시용 제목: 건물·단지명, 없으면 기본 주소 */
export function addressTitle(a: Address): string {
  return a.label.trim() || a.line1;
}
/** 제목 아래 보조 줄: 기본 주소(제목과 같으면 생략) */
export function addressSubline(a: Address): string | null {
  return a.label.trim() && a.line1 !== a.label ? a.line1 : null;
}
