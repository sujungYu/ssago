import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../app/auth';
import { loadListFilter, loadListScroll, saveListFilter, saveListScroll } from '../../app/context';
import {
  hasFilterParams, parseRequestFilter, writeRequestFilter, type RequestFilter,
} from '../../domain/requestFilter';

type FilterNavState = { filterOwner?: string } | null;
const LIST = 'requests';

/**
 * 내 요청 필터를 URL 쿼리(날짜·상태만, 고객 정보 없음)로 관리한다.
 * - 적용할 때마다 방문 기록을 하나 쌓는다 → 뒤로가기로 이전 조건, 새로고침으로 현재 조건 복원.
 * - 쿼리 없이 목록에 들어오면(상세 화면 헤더의 ‘뒤로’, 하단 탭) 이 세션의 마지막 적용값을 복원한다.
 * - 잘못된 쿼리 값은 기본값으로 바꾸고 URL도 정리한다.
 * - 다른 계정에서 만든 기록(로그아웃·계정 전환 후 뒤로가기 등)의 필터는 쓰지 않는다.
 *   기록 항목의 state에 적용한 계정을 남겨 구분하고, 계정이 바뀌면 세션 저장값도 지운다(clearUserAppState).
 */
export function useRequestFilter() {
  const [params, setParams] = useSearchParams();
  const loc = useLocation();
  const { state } = useAuth();
  const owner = state.status === 'signedIn' ? state.session.userId : undefined;
  const hasParams = hasFilterParams(params);
  // 다른 계정이 적용한 기록 항목이면 쓰지 않는다. 직접 입력·북마크한 주소(state 없음)는 검증 후 쓴다.
  const stateOwner = (loc.state as FilterNavState)?.filterOwner;
  const foreign = hasParams && stateOwner !== undefined && stateOwner !== owner;

  // 처음 그릴 때 한 번: 쿼리가 없으면 마지막 적용값을 쓴다. 사용자가 다시 적용하면 버린다.
  const saved = useRef<string | null | undefined>(undefined);
  if (saved.current === undefined) saved.current = hasParams ? null : loadListFilter(LIST, owner);

  const source = !hasParams && saved.current ? saved.current : foreign ? '' : params.toString();
  const filter = useMemo<RequestFilter>(() => parseRequestFilter(new URLSearchParams(source)), [source]);

  // URL을 실제 적용값과 맞춘다(기록을 쌓지 않음)
  const canonical = writeRequestFilter(params, filter).toString();
  useEffect(() => {
    if (canonical !== params.toString()) setParams(new URLSearchParams(canonical), { replace: true, state: { filterOwner: owner } });
  }, [canonical, params, setParams, owner]);

  // 마지막 적용값 저장
  const filterQuery = writeRequestFilter(new URLSearchParams(), filter).toString();
  useEffect(() => { saveListFilter(LIST, owner, filterQuery); }, [owner, filterQuery]);

  const apply = useCallback((next: RequestFilter) => {
    saved.current = null;
    setParams(writeRequestFilter(params, next), { state: { filterOwner: owner } });
    window.scrollTo(0, 0); // 필터를 바꾸면 목록 처음으로
  }, [params, setParams, owner]);

  return { filter, apply };
}

/**
 * 목록 위치 유지. 방문 기록 항목(location.key)별로 스크롤 위치를 저장해 뒤로가기·새로고침에서 복원하고,
 * 새 기록 항목으로 들어온 경우(헤더 ‘뒤로’ 링크 등)는 같은 조건의 마지막 위치를 복원한다.
 */
export function useListScrollRestore(ready: boolean, filterKey: string) {
  const { key } = useLocation();
  const lastKey = `${LIST}:last:${filterKey}`;
  // 복원할 위치는 이 기록 항목에 처음 들어왔을 때 읽어 둔다. 목록이 그려지기 전의 스크롤 이벤트(브라우저 자동 복원,
  // 짧은 로딩 화면)가 저장값을 덮어쓰지 않도록, 복원이 끝나기 전에는 저장하지 않는다.
  const pending = useRef<{ key: string; y?: number; done: boolean } | null>(null);
  if (pending.current?.key !== key) {
    // 마지막 위치는 처음 들어왔을 때만(주소 정리로 key가 바뀐 경우 포함). 필터를 바꾼 뒤에는 처음부터 보여준다.
    const entering = pending.current === null || !pending.current.done;
    pending.current = { key, y: loadListScroll(key) ?? (entering ? loadListScroll(lastKey) : undefined), done: false };
  }

  useEffect(() => {
    let frame = 0;
    const onScroll = () => {
      if (!pending.current?.done) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => { saveListScroll(key, window.scrollY); saveListScroll(lastKey, window.scrollY); });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => { cancelAnimationFrame(frame); window.removeEventListener('scroll', onScroll); };
  }, [key, lastKey]);

  useEffect(() => {
    const p = pending.current;
    if (!ready || !p || p.done) return;
    p.done = true;
    if (p.y) requestAnimationFrame(() => window.scrollTo(0, p.y!));
  }, [ready, key]);
}
