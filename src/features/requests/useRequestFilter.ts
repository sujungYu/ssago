import { useListScrollRestore as useScrollRestore, useUrlFilter, type UrlFilterCodec } from '../../app/listFilter';
import { hasFilterParams, parseRequestFilter, writeRequestFilter, type RequestFilter } from '../../domain/requestFilter';

/** 내 요청 필터 ↔ URL(날짜·상태만). 동작은 공통 훅(src/app/listFilter.ts) 설명 참고 */
const REQUEST_CODEC: UrlFilterCodec<RequestFilter> = { list: 'requests', parse: parseRequestFilter, write: writeRequestFilter, has: hasFilterParams };

export function useRequestFilter() {
  return useUrlFilter(REQUEST_CODEC);
}

/** 내 요청 목록 위치 유지 */
export function useListScrollRestore(ready: boolean, filterKey: string) {
  useScrollRestore(REQUEST_CODEC.list, ready, filterKey);
}
