import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { MockRepository } from '../data/mock/mockRepository';
import type { Repository } from '../data/repositories/types';
import { useAccountId } from './account';

/**
 * 데이터 공급자 주입 지점. 2차에서 Supabase 구현체를 같은 Repository 계약으로 만들어 여기서만 교체한다.
 * 화면은 useRepo()로 받은 계약만 사용하며 목업·시드를 직접 import하지 않는다.
 */
const RepoCtx = createContext<Repository | null>(null);
export function RepoProvider({ repo, children }: { repo: Repository; children: ReactNode }) {
  return <RepoCtx.Provider value={repo}>{children}</RepoCtx.Provider>;
}
export function useRepo(): Repository {
  const r = useContext(RepoCtx);
  if (!r) throw new Error('RepoProvider가 필요합니다.');
  return r;
}
/**
 * 데이터 공급자 생성. 로그인 없는 데모라 모든 데이터는 목업(가상 데모 고객 1명)이다. 인증·실제 DB 연결은 없다.
 * 이후 데이터를 실제 저장소로 바꾸면 같은 Repository 계약으로 여기만 교체한다(그때는 인증·RLS가 함께 필요하다).
 */
export function createDefaultServices(): { repo: MockRepository } {
  return { repo: new MockRepository({ persist: true }) };
}

// ───────── 앱 상태(방문 지역·비교 묶음) ─────────
interface AppState {
  addressId: string | null;
  setAddressId(id: string | null): void;
  /** 같은 작업을 다른 업체에도 요청할 때 연결할 비교 묶음 */
  bundleId: string | null;
  setBundleId(id: string | null): void;
}
const AppCtx = createContext<AppState | null>(null);
const KEY = 'on-gimae/app-state/v1';
function loadState(): { addressId: string | null } {
  try { return JSON.parse(sessionStorage.getItem(KEY) ?? '{}'); } catch { return { addressId: null }; }
}
/** 사용자별 화면 상태(방문 지역 등)를 지운다. 로그인 계정이 바뀌거나 로그아웃할 때 호출. */
export function clearUserAppState(): void {
  try {
    sessionStorage.removeItem(KEY);
    sessionStorage.removeItem(LIST_SCROLL_KEY);
    sessionStorage.removeItem(LIST_FILTER_KEY);
    sessionStorage.removeItem(PROVIDER_PICK_KEY);
  } catch { /* 저장 불가 환경 */ }
}

// ───────── 목록 필터(마지막 적용값) ─────────
const LIST_FILTER_KEY = 'on-gimae/list-filter/v1';
/** 목록별 마지막 적용 필터(쿼리 문자열, 날짜·상태만). 계정 id와 함께 저장해 다른 계정에는 쓰지 않는다. */
export function saveListFilter(list: string, owner: string | undefined, query: string): void {
  try {
    const all = JSON.parse(sessionStorage.getItem(LIST_FILTER_KEY) ?? '{}');
    all[list] = { owner, query };
    sessionStorage.setItem(LIST_FILTER_KEY, JSON.stringify(all));
  } catch { /* 저장 불가 환경 */ }
}
export function loadListFilter(list: string, owner: string | undefined): string | null {
  try {
    const v = JSON.parse(sessionStorage.getItem(LIST_FILTER_KEY) ?? '{}')[list];
    return v && v.owner === owner && typeof v.query === 'string' && v.query ? v.query : null;
  } catch { return null; }
}

// ───────── 업체 상세 공동 예약 선택(요청서에서 돌아올 때 복원) ─────────
const PROVIDER_PICK_KEY = 'on-gimae/provider-pick/v1';
/** 업체 상세의 선택 상태. 방문 기록 항목(location.key)별로 저장해, 같은 항목으로 돌아왔을 때만 되살린다(이동과 무관). */
export interface ProviderPick { providerId: string; date: string | null; month: { year: number; month: number }; groupId: string | null }
export function saveProviderPick(entryKey: string, pick: ProviderPick): void {
  try {
    const all = JSON.parse(sessionStorage.getItem(PROVIDER_PICK_KEY) ?? '{}');
    delete all[entryKey];
    all[entryKey] = pick;
    const keys = Object.keys(all);
    if (keys.length > 20) delete all[keys[0]];
    sessionStorage.setItem(PROVIDER_PICK_KEY, JSON.stringify(all));
  } catch { /* 저장 불가 환경 */ }
}
export function loadProviderPick(entryKey: string, providerId: string): ProviderPick | null {
  try {
    const v = JSON.parse(sessionStorage.getItem(PROVIDER_PICK_KEY) ?? '{}')[entryKey];
    return v && v.providerId === providerId && v.month ? v : null;
  } catch { return null; }
}

// ───────── 목록 위치(상세에 들어갔다 돌아올 때 복원) ─────────
const LIST_SCROLL_KEY = 'on-gimae/list-scroll/v1';
function readScrolls(): Record<string, number> {
  try { return JSON.parse(sessionStorage.getItem(LIST_SCROLL_KEY) ?? '{}'); } catch { return {}; }
}
/** 방문 기록 항목(location.key)별 스크롤 위치. 계정이 바뀌면 clearUserAppState로 지운다. */
export function saveListScroll(entryKey: string, y: number): void {
  try {
    const all = readScrolls();
    all[entryKey] = Math.round(y);
    const keys = Object.keys(all);
    if (keys.length > 30) delete all[keys[0]];
    sessionStorage.setItem(LIST_SCROLL_KEY, JSON.stringify(all));
  } catch { /* 저장 불가 환경 */ }
}
export function loadListScroll(entryKey: string): number | undefined {
  return readScrolls()[entryKey];
}

/**
 * 계정마다 앱 상태와 화면 트리를 새로 만든다(key=계정). 계정이 바뀌면 이전 사용자의 조회 캐시·입력 중 상태·방문 지역이
 * 다음 사용자에게 남지 않는다. 로그인 없는 데모에서는 항상 가상 데모 고객이지만, 이후 실제 계정을 붙일 수 있게 구조를 유지한다.
 */
export function AppStateProvider({ children }: { children: ReactNode }) {
  const account = useAccountId();
  return <AccountAppState key={account}>{children}</AccountAppState>;
}

function AccountAppState({ children }: { children: ReactNode }) {
  const repo = useRepo();
  const [addressId, setAddr] = useState<string | null>(() => loadState().addressId ?? null);
  const [bundleId, setBundleId] = useState<string | null>(null);
  const cache = useCallback((id: string | null) => {
    setAddr(id);
    try { sessionStorage.setItem(KEY, JSON.stringify({ addressId: id })); } catch { /* 저장 불가 환경 */ }
  }, []);
  /**
   * 탐색 지역·건물 주소 저장. 사용자별 데이터로 저장소에 남겨 재접속 시 기본값으로 쓴다(이 탭의 캐시는 sessionStorage).
   * 최근 예약 주소로 자동 덮어쓰지 않는다 — 고객이 직접 고른 값만 저장한다.
   */
  const setAddressId = useCallback((id: string | null) => {
    cache(id);
    if (id) void repo.setExploreAddress(id).catch(() => { /* 저장 실패해도 이번 화면에서는 선택값을 쓴다 */ });
  }, [cache, repo]);
  // 이 탭에 캐시가 없으면(새 접속) 이 사용자가 마지막으로 저장한 탐색 주소를 불러온다.
  useEffect(() => {
    if (addressId !== null) return;
    let alive = true;
    // 불러오는 사이 고객이 직접 고른 값이 있으면 덮어쓰지 않는다
    repo.getExploreAddress().then((a) => { if (alive && a && loadState().addressId == null) cache(a.id); }, () => { /* 없으면 미설정으로 둔다 */ });
    return () => { alive = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const value = useMemo(() => ({ addressId, setAddressId, bundleId, setBundleId }), [addressId, setAddressId, bundleId]);
  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}
export function useAppState(): AppState {
  const s = useContext(AppCtx);
  if (!s) throw new Error('AppStateProvider가 필요합니다.');
  return s;
}
