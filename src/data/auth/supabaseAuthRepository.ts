/**
 * AuthRepository의 Supabase Auth 구현. 비밀번호는 SDK로 Supabase에 바로 보내고 저장·로그하지 않는다.
 * 세션 저장·갱신은 SDK(persistSession·autoRefreshToken)가 한다.
 * 클라이언트가 없으면(환경 값 미설정) 모든 요청을 auth_not_configured로 거절한다 — 모의 성공 없음.
 */
import { isAuthApiError, isAuthRetryableFetchError, isAuthSessionMissingError, isAuthWeakPasswordError, type Session, type SupabaseClient } from '@supabase/supabase-js';
import { RepoError, type RepoErrorCode } from '../../domain/errors';
import type { AuthEvent, AuthRepository, AuthSession } from '../repositories/auth';
import type { Unsubscribe } from '../repositories/types';

type AuthClient = Pick<SupabaseClient['auth'],
  'getSession' | 'getUser' | 'onAuthStateChange' | 'signInWithPassword' | 'signUp' | 'signOut' | 'resetPasswordForEmail' | 'updateUser'>;

export interface SupabaseAuthOptions {
  passwordMinLength: number;
  openedFromRecoveryLink?: boolean;
  /** 메일 링크가 돌아올 주소의 기준(기본: 현재 origin) */
  origin?: string;
}

const toSession = (s: Session | null | undefined): AuthSession | null =>
  s?.user ? { userId: s.user.id, email: s.user.email ?? '' } : null;

/** 오류 → 화면 코드. 인증 오류와 네트워크 오류를 구분하고, 서버 원문 메시지는 화면에 보내지 않는다. */
export function mapAuthError(e: unknown, op: 'signIn' | 'signUp' | 'reset' | 'update' | 'session'): RepoError {
  if (e instanceof RepoError) return e;
  const code = (c: RepoErrorCode) => new RepoError(c);
  if (isAuthRetryableFetchError(e)) return code('auth_network'); // 연결 실패·5xx
  if (e instanceof TypeError) return code('auth_network'); // fetch 자체 실패
  if (isAuthWeakPasswordError(e)) return code('auth_weak_password');
  if (isAuthSessionMissingError(e)) return code(op === 'update' ? 'auth_recovery_invalid' : 'auth_invalid_credentials');
  if (isAuthApiError(e)) {
    const c = e.code ?? '';
    if (e.status === 429 || c.startsWith('over_')) return code('auth_rate_limited');
    if (c === 'email_not_confirmed') return code('auth_email_not_confirmed');
    if (op === 'signIn' && (c === 'invalid_credentials' || e.status === 400)) return code('auth_invalid_credentials');
    if (op === 'signUp' && (c === 'user_already_exists' || c === 'email_exists')) return code('auth_signup_exists');
    if (c === 'signup_disabled' || c === 'email_provider_disabled') return code('auth_signup_disabled');
    if (c === 'email_address_invalid' || c === 'validation_failed') return code('auth_invalid_email');
    if (op === 'update' && (e.status === 401 || e.status === 403)) return code('auth_recovery_invalid');
  }
  return code('auth_failed');
}

export class SupabaseAuthRepository implements AuthRepository {
  readonly kind = 'supabase' as const;
  readonly configured: boolean;
  readonly passwordMinLength: number;
  readonly openedFromRecoveryLink: boolean;
  private origin: string;
  /** 가입 중 잠깐 생기는 세션의 이벤트를 화면에 알리지 않는다(가입 완료 → 로그인 화면 흐름 유지) */
  private quiet = false;

  constructor(private client: AuthClient | null, opts: SupabaseAuthOptions) {
    this.configured = !!client;
    this.passwordMinLength = opts.passwordMinLength;
    this.openedFromRecoveryLink = !!opts.openedFromRecoveryLink;
    this.origin = opts.origin ?? (typeof window !== 'undefined' ? window.location.origin : '');
  }

  private get c(): AuthClient {
    if (!this.client) throw new RepoError('auth_not_configured');
    return this.client;
  }

  async restoreSession(): Promise<AuthSession | null> {
    if (!this.client) return null;
    const { data, error } = await this.client.getSession();
    if (error) {
      const mapped = mapAuthError(error, 'session');
      if (mapped.code === 'auth_network') throw mapped;
      await this.client.signOut({ scope: 'local' });
      return null;
    }
    if (!data.session) return null;
    // 저장된 세션이 서버에서도 유효한지 확인한다. 무효(401·403·세션 없음)면 지우고, 네트워크 실패면 저장된 세션으로 진행한다
    // (보호 대상이 목업 데이터라서 오프라인 진입을 막지 않는다 — 실제 데이터는 서버가 매 요청 검증해야 한다).
    const user = await this.client.getUser();
    if (user.error) {
      if (isAuthRetryableFetchError(user.error)) return toSession(data.session);
      await this.client.signOut({ scope: 'local' });
      return null;
    }
    return toSession(data.session);
  }

  subscribe(listener: (e: AuthEvent) => void): Unsubscribe {
    if (!this.client) return () => {};
    const { data } = this.client.onAuthStateChange((event, session) => {
      if (this.quiet) return;
      const s = toSession(session);
      // 콜백 안에서 다른 인증 메서드를 기다리지 않는다(SDK 권고). 화면 상태만 알린다.
      if (event === 'SIGNED_OUT' || !s) listener({ type: 'SIGNED_OUT' });
      else if (event === 'PASSWORD_RECOVERY') listener({ type: 'PASSWORD_RECOVERY', session: s });
      else if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') listener({ type: 'SIGNED_IN', session: s });
    });
    return () => data.subscription.unsubscribe();
  }

  async signIn(input: { email: string; password: string }): Promise<AuthSession> {
    try {
      const { data, error } = await this.c.signInWithPassword({ email: input.email.trim(), password: input.password });
      if (error) throw error;
      const s = toSession(data.session);
      if (!s) throw new RepoError('auth_failed');
      return s;
    } catch (e) { throw mapAuthError(e, 'signIn'); }
  }

  async signUp(input: { email: string; password: string }): Promise<{ needsEmailConfirmation: boolean }> {
    let created = false;
    this.quiet = true;
    try {
      const { data, error } = await this.c.signUp({
        email: input.email.trim(), password: input.password,
        options: { emailRedirectTo: `${this.origin}/login` },
      });
      if (error) throw error;
      created = !!data.session;
      // 이번 흐름은 "가입 완료 → 로그인 화면"이므로, 가입과 함께 세션이 생겼으면 바로 로그아웃한다.
      if (created) await this.client!.signOut({ scope: 'local' });
    } catch (e) {
      throw mapAuthError(e, 'signUp');
    } finally {
      this.quiet = false;
    }
    return { needsEmailConfirmation: !created };
  }

  async signOut(): Promise<void> {
    if (!this.client) return;
    // scope: 'local' — 이 기기만 로그아웃. SDK는 서버 호출이 실패해도 로컬 세션을 지운다.
    await this.client.signOut({ scope: 'local' });
  }

  async requestPasswordReset(email: string): Promise<void> {
    try {
      const { error } = await this.c.resetPasswordForEmail(email.trim(), { redirectTo: `${this.origin}/password/new` });
      if (error) throw error;
    } catch (e) {
      const mapped = mapAuthError(e, 'reset');
      // 계정 유무를 드러내지 않도록 네트워크·요청 제한·미설정 외에는 성공과 같은 안내를 한다.
      if (['auth_network', 'auth_rate_limited', 'auth_not_configured'].includes(mapped.code)) throw mapped;
    }
  }

  async updatePassword(newPassword: string): Promise<void> {
    try {
      const { error } = await this.c.updateUser({ password: newPassword });
      if (error) throw error;
    } catch (e) { throw mapAuthError(e, 'update'); }
  }
}
