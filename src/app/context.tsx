import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { MockRepository } from '../data/mock/mockRepository';
import type { Repository } from '../data/repositories/types';
import type { AuthRepository } from '../data/repositories/auth';
import { SupabaseAuthRepository } from '../data/auth/supabaseAuthRepository';
import { DemoAuthRepository } from '../data/auth/demoAuthRepository';
import { OPENED_FROM_RECOVERY_LINK, supabase } from '../data/auth/supabaseClient';
import { parsePasswordMin } from '../domain/auth';
import { useAuth } from './auth';

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
 * 데이터·인증 공급자 생성. 인증은 Supabase Auth(실제 연결), 예약·업체·결제 데이터는 목업이다.
 * 2차에서 데이터도 Supabase 구현체로 바꾸면 여기만 교체한다.
 */
export function createDefaultServices(): { repo: MockRepository; auth: AuthRepository } {
  const repo = new MockRepository({ persist: true });
  const passwordMinLength = parsePasswordMin(import.meta.env.VITE_AUTH_PASSWORD_MIN_LENGTH);
  // ⚠️ 임시: Supabase 값(VITE_SUPABASE_URL·키)이 없으면 연결 전 데모 로그인을 쓴다(이 브라우저 안에서만 유효, 실제 계정 아님).
  // 값을 넣으면 자동으로 Supabase Auth를 쓴다. Supabase 연결 후에는 데모 분기와 demoAuthRepository.ts를 지운다.
  const auth: AuthRepository = supabase
    ? new SupabaseAuthRepository(supabase.auth, { passwordMinLength, openedFromRecoveryLink: OPENED_FROM_RECOVERY_LINK })
    : new DemoAuthRepository({ passwordMinLength });
  return { repo, auth };
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
  try { sessionStorage.removeItem(KEY); } catch { /* 저장 불가 환경 */ }
}

/**
 * 계정마다 앱 상태와 화면 트리를 새로 만든다(key=계정). 계정이 바뀌거나 로그아웃하면
 * 이전 사용자의 조회 캐시·입력 중 상태·방문 지역이 다음 사용자에게 남지 않는다.
 */
export function AppStateProvider({ children }: { children: ReactNode }) {
  const { state } = useAuth();
  const account = state.status === 'signedIn' ? state.session.userId : 'guest';
  return <AccountAppState key={account}>{children}</AccountAppState>;
}

function AccountAppState({ children }: { children: ReactNode }) {
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
