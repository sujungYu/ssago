import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import type { AuthRepository, AuthSession } from '../data/repositories/auth';
import { describeError } from '../domain/errors';
import { Banner, Button } from '../components/ui';
import { Icon } from '../components/Icon';
import { BrandLogo } from '../components/brand/Brand';

/**
 * 인증 주입 지점과 화면용 로그인 상태.
 * 라우트 보호(RequireAuth)는 화면 이동 제어일 뿐 데이터 보안이 아니다. 실제 데이터를 연결하면 서버·RLS가 매 요청 권한을 검증해야 한다.
 */
export type AuthState =
  | { status: 'loading' }
  /** 세션 확인 중 네트워크 오류 — 로그인 화면으로 보내지 않고 다시 시도하게 한다 */
  | { status: 'error'; error: unknown }
  | { status: 'signedOut' }
  | { status: 'signedIn'; session: AuthSession; recovery: boolean };

interface AuthCtxValue { auth: AuthRepository; state: AuthState }
const AuthCtx = createContext<AuthCtxValue | null>(null);

/**
 * 세션 확인이 끝날 때까지 앱 화면 대신 로딩 화면만 그린다(내부 화면이 잠깐 보이지 않게).
 * onAccount: 로그인 계정이 정해지거나 바뀔 때(로그아웃 = null) 화면보다 먼저 호출 — 사용자별 캐시·목업 상태 초기화에 쓴다.
 */
export function AuthProvider({ auth, onAccount, children }: { auth: AuthRepository; onAccount?: (userId: string | null) => void; children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const onAccountRef = useRef(onAccount);
  onAccountRef.current = onAccount;

  useEffect(() => {
    let alive = true;
    let restored = false;
    const off = auth.subscribe((e) => {
      if (!alive || !restored) return; // 첫 확인이 끝나기 전 이벤트는 restoreSession 결과로 대신한다
      if (e.type === 'SIGNED_OUT') {
        onAccountRef.current?.(null);
        setState({ status: 'signedOut' });
      } else {
        onAccountRef.current?.(e.session.userId);
        setState((cur) => ({
          status: 'signedIn', session: e.session,
          recovery: e.type === 'PASSWORD_RECOVERY' || (cur.status === 'signedIn' && cur.recovery && cur.session.userId === e.session.userId),
        }));
      }
    });
    setState({ status: 'loading' });
    auth.restoreSession().then(
      (s) => {
        if (!alive) return;
        restored = true;
        onAccountRef.current?.(s?.userId ?? null);
        setState(s ? { status: 'signedIn', session: s, recovery: auth.openedFromRecoveryLink } : { status: 'signedOut' });
      },
      (error) => { if (alive) setState({ status: 'error', error }); },
    );
    return () => { alive = false; off(); };
  }, [auth, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const value = useMemo(() => ({ auth, state }), [auth, state]);

  if (state.status === 'loading') return <BootScreen><span className="btn__spin" aria-hidden /><p className="muted">로그인 상태를 확인하고 있어요</p></BootScreen>;
  if (state.status === 'error') {
    const d = describeError(state.error);
    return (
      <BootScreen>
        <Banner tone="danger" title={d.title}>{d.hint}</Banner>
        <Button variant="primary" block onClick={retry}><Icon name="refresh" size={18} />다시 시도</Button>
      </BootScreen>
    );
  }
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

function BootScreen({ children }: { children: ReactNode }) {
  return (
    <main className="boot" aria-busy="true" aria-live="polite">
      <h1 className="auth__logo"><BrandLogo size="lg" /></h1>
      <div className="stack boot__body">{children}</div>
    </main>
  );
}

export function useAuth(): AuthCtxValue {
  const v = useContext(AuthCtx);
  if (!v) throw new Error('AuthProvider가 필요합니다.');
  return v;
}

/** 로그인 후에만 볼 수 있는 화면 묶음. 비로그인(세션 무효·로그아웃 포함)이면 로그인 화면으로 보낸다. */
export function RequireAuth() {
  const { state } = useAuth();
  if (state.status !== 'signedIn') return <Navigate to="/login" replace />;
  return <Outlet />;
}
