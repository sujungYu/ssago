import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { useAccountId } from './account';
import { loadListFilter, loadListScroll, saveListFilter, saveListScroll } from './context';

/** 목록 필터 ↔ URL 쿼리 변환(모듈 상수로 만들어 참조가 바뀌지 않게 한다) */
export interface UrlFilterCodec<F> {
  /** 세션 저장·목록 위치 키 구분용 이름 */
  list: string;
  parse(p: URLSearchParams): F;
  write(base: URLSearchParams, f: F): URLSearchParams;
  has(p: URLSearchParams): boolean;
}

type FilterNavState = { filterOwner?: string } | null;

/** 저장된 조건 위에 현재 주소의 (필터가 아닌) 쿼리 값을 덮어 쓴다 */
function overlay(saved: string, params: URLSearchParams): string {
  const p = new URLSearchParams(saved);
  for (const [k, v] of params) p.set(k, v);
  return p.toString();
}

/**
 * 목록 필터를 URL 쿼리(조회 조건만, 고객 정보 없음)로 관리한다. 내 예약(보낸 요청·확정된 예약·완료·취소 탭)이 쓴다.
 * - 적용할 때마다 방문 기록을 하나 쌓는다 → 뒤로가기로 이전 조건, 새로고침으로 현재 조건 복원(replace로 바꿀 수도 있음).
 * - 쿼리 없이 목록에 들어오면(상세 화면 헤더의 ‘뒤로’, 하단 탭) 이 세션의 마지막 적용값을 복원한다.
 *   필터가 아닌 쿼리(예: 내 예약의 tab)만 있으면 마지막 적용값에 그 값을 덮어 쓴다(‘보낸 요청으로’ → 보낸 요청 탭 + 마지막 조건).
 * - 잘못된 쿼리 값은 기본값으로 바꾸고 URL도 정리한다.
 * - 다른 계정에서 만든 기록의 필터는 쓰지 않는다(로그인 없는 데모에서는 항상 가상 데모 고객).
 *   기록 항목의 state에 적용한 계정을 남겨 구분하고, 계정이 바뀌면 세션 저장값도 지운다(clearUserAppState).
 */
export function useUrlFilter<F>(codec: UrlFilterCodec<F>) {
  const [params, setParams] = useSearchParams();
  const loc = useLocation();
  const owner = useAccountId();
  const hasParams = codec.has(params);
  // 다른 계정이 적용한 기록 항목이면 쓰지 않는다. 직접 입력·북마크한 주소(state 없음)는 검증 후 쓴다.
  const stateOwner = (loc.state as FilterNavState)?.filterOwner;
  const foreign = hasParams && stateOwner !== undefined && stateOwner !== owner;

  // 처음 그릴 때 한 번: 쿼리가 없으면 마지막 적용값을 쓴다. 사용자가 다시 적용하면 버린다.
  const saved = useRef<string | null | undefined>(undefined);
  if (saved.current === undefined) saved.current = hasParams ? null : loadListFilter(codec.list, owner);

  const source = !hasParams && saved.current ? overlay(saved.current, params) : foreign ? '' : params.toString();
  const filter = useMemo<F>(() => codec.parse(new URLSearchParams(source)), [source, codec]);

  // URL을 실제 적용값과 맞춘다(기록을 쌓지 않음)
  const canonical = codec.write(params, filter).toString();
  useEffect(() => {
    if (canonical !== params.toString()) setParams(new URLSearchParams(canonical), { replace: true, state: { filterOwner: owner } });
  }, [canonical, params, setParams, owner]);

  // 마지막 적용값 저장
  const filterQuery = codec.write(new URLSearchParams(), filter).toString();
  useEffect(() => { saveListFilter(codec.list, owner, filterQuery); }, [owner, filterQuery, codec]);

  /** keepScroll: 탭 전환처럼 목록 위치 복원(useListScrollRestore의 scope)에 맡길 때 */
  const apply = useCallback((next: F, opts?: { replace?: boolean; keepScroll?: boolean }) => {
    saved.current = null;
    setParams(codec.write(params, next), { replace: opts?.replace, state: { filterOwner: owner } });
    if (!opts?.keepScroll) window.scrollTo(0, 0); // 조건을 바꾸면 목록 처음으로
  }, [params, setParams, owner, codec]);

  return { filter, apply };
}

/**
 * 목록 위치 유지. 방문 기록 항목(location.key)별로 스크롤 위치를 저장해 뒤로가기·새로고침에서 복원하고,
 * 새 기록 항목으로 들어온 경우(헤더 ‘뒤로’ 링크 등)는 같은 조건의 마지막 위치를 복원한다.
 * scope(예: 탭)가 바뀌면 처음 들어온 것으로 보고 그 범위·조건의 마지막 위치를 복원한다(탭마다 위치를 따로 유지).
 */
export function useListScrollRestore(list: string, ready: boolean, filterKey: string, scope = '') {
  const { key } = useLocation();
  const lastKey = `${list}:last:${filterKey}`;
  // 복원할 위치는 이 기록 항목에 처음 들어왔을 때 읽어 둔다. 목록이 그려지기 전의 스크롤 이벤트(브라우저 자동 복원,
  // 짧은 로딩 화면)가 저장값을 덮어쓰지 않도록, 복원이 끝나기 전에는 저장하지 않는다.
  const pending = useRef<{ key: string; scope: string; y?: number; done: boolean; scopeChanged: boolean } | null>(null);
  if (pending.current?.key !== key) {
    // 마지막 위치는 처음 들어왔을 때만(주소 정리로 key가 바뀐 경우·다른 탭으로 옮긴 경우 포함). 같은 탭에서 필터를 바꾼 뒤에는 처음부터 보여준다.
    const scopeChanged = pending.current !== null && pending.current.scope !== scope;
    const entering = pending.current === null || !pending.current.done || scopeChanged;
    pending.current = { key, scope, y: loadListScroll(key) ?? (entering ? loadListScroll(lastKey) : undefined), done: false, scopeChanged };
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
    else if (p.scopeChanged) window.scrollTo(0, 0); // 처음 여는 탭은 맨 위부터
  }, [ready, key]);
}
