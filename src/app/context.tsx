import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { MockRepository } from '../data/mock/mockRepository';
import type { Repository } from '../data/repositories/types';

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
export function createDefaultRepo(): MockRepository {
  return new MockRepository({ persist: true });
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
export function AppStateProvider({ children }: { children: ReactNode }) {
  const [addressId, setAddr] = useState<string | null>(() => loadState().addressId ?? null);
  const [bundleId, setBundleId] = useState<string | null>(null);
  const setAddressId = useCallback((id: string | null) => {
    setAddr(id);
    try { sessionStorage.setItem(KEY, JSON.stringify({ addressId: id })); } catch { /* 저장 불가 환경 */ }
  }, []);
  const value = useMemo(() => ({ addressId, setAddressId, bundleId, setBundleId }), [addressId, setAddressId, bundleId]);
  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}
export function useAppState(): AppState {
  const s = useContext(AppCtx);
  if (!s) throw new Error('AppStateProvider가 필요합니다.');
  return s;
}
