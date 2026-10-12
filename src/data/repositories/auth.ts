/**
 * 인증 계약. 인증 화면·라우트 보호는 이 인터페이스만 사용한다. 구현은 Supabase Auth(src/data/auth/supabaseAuthRepository.ts).
 * 비밀번호 보관·검증·세션 관리는 Supabase Auth가 하며, 이 앱은 비밀번호를 저장·로그하지 않는다.
 * 실패는 RepoError(auth_*)로 던진다. 인증 오류(자격·정책)와 네트워크 오류(auth_network)를 구분한다.
 */
import type { Unsubscribe } from './types';

export interface AuthSession {
  userId: string;
  email: string;
}

export type AuthEvent =
  | { type: 'SIGNED_IN'; session: AuthSession }
  | { type: 'SIGNED_OUT' }
  /** 비밀번호 재설정 메일의 링크로 들어온 복구 세션 */
  | { type: 'PASSWORD_RECOVERY'; session: AuthSession };

export interface AuthRepository {
  /**
   * supabase: Supabase Auth 실제 연결.
   * demo: Supabase 연결 전 임시 데모 로그인(이 브라우저 안에서만 유효, 실제 계정 아님) — 화면에 데모 표시를 해야 한다.
   */
  readonly kind: 'supabase' | 'demo';
  /** 요청을 처리할 수 있는지. false면 모든 요청이 auth_not_configured로 실패한다. */
  readonly configured: boolean;
  /** 화면 안내용 비밀번호 최소 길이(Supabase 프로젝트 설정과 맞춘 값) */
  readonly passwordMinLength: number;
  /** 재설정 링크로 열렸는지(앱 시작 시 URL 기준) */
  readonly openedFromRecoveryLink: boolean;
  /** 저장된 세션을 확인하고, 서버에서 무효로 판정되면 지운 뒤 null. 네트워크 실패는 auth_network. */
  restoreSession(): Promise<AuthSession | null>;
  subscribe(listener: (e: AuthEvent) => void): Unsubscribe;
  signIn(input: { email: string; password: string }): Promise<AuthSession>;
  /** 가입 후 세션이 만들어져도 로그아웃 상태로 돌려놓는다. needsEmailConfirmation: 확인 메일이 필요한 설정인지 */
  signUp(input: { email: string; password: string }): Promise<{ needsEmailConfirmation: boolean }>;
  /** 이 기기의 세션을 지운다(네트워크 실패여도 로컬 세션은 지워진다). */
  signOut(): Promise<void>;
  requestPasswordReset(email: string): Promise<void>;
  /** 재설정 링크의 복구 세션에서 새 비밀번호 저장 */
  updatePassword(newPassword: string): Promise<void>;
}
