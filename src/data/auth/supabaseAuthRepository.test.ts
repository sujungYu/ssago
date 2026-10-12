import { describe, expect, it, vi } from 'vitest';
import { AuthApiError, AuthRetryableFetchError, AuthWeakPasswordError } from '@supabase/supabase-js';
import { RepoError } from '../../domain/errors';
import { SupabaseAuthRepository, mapAuthError } from './supabaseAuthRepository';

const user = { id: 'u1', email: 'a@b.co' };
const session = { access_token: 't', refresh_token: 'r', user };

/** SDK auth 클라이언트의 필요한 부분만 흉내 낸 가짜. 네트워크를 쓰지 않는다. */
function fakeClient(over: Record<string, unknown> = {}) {
  const listeners: ((event: string, s: unknown) => void)[] = [];
  const emit = (event: string, s: unknown) => listeners.forEach((l) => l(event, s));
  const c = {
    getSession: vi.fn(async () => ({ data: { session }, error: null })),
    getUser: vi.fn(async () => ({ data: { user }, error: null })),
    onAuthStateChange: vi.fn((cb: (event: string, s: unknown) => void) => { listeners.push(cb); return { data: { subscription: { unsubscribe: vi.fn() } } }; }),
    signInWithPassword: vi.fn(async () => ({ data: { session, user }, error: null })),
    signUp: vi.fn(async () => { emit('SIGNED_IN', session); return { data: { session, user }, error: null }; }),
    signOut: vi.fn(async () => { emit('SIGNED_OUT', null); return { error: null }; }),
    resetPasswordForEmail: vi.fn(async () => ({ data: {}, error: null })),
    updateUser: vi.fn(async () => ({ data: { user }, error: null })),
    ...over,
  };
  return { c, emit };
}
const repoOf = (c: unknown) => new SupabaseAuthRepository(c as never, { passwordMinLength: 6, origin: 'https://app.example' });
const codeOf = async (p: Promise<unknown>) => { try { await p; return 'ok'; } catch (e) { return e instanceof RepoError ? e.code : 'other'; } };

describe('오류 구분', () => {
  it('네트워크 오류와 인증 오류를 구분한다', () => {
    expect(mapAuthError(new AuthRetryableFetchError('Failed to fetch', 0), 'signIn').code).toBe('auth_network');
    expect(mapAuthError(new AuthRetryableFetchError('Bad gateway', 502), 'signUp').code).toBe('auth_network');
    expect(mapAuthError(new TypeError('Failed to fetch'), 'signIn').code).toBe('auth_network');
    expect(mapAuthError(new AuthApiError('Invalid login credentials', 400, 'invalid_credentials'), 'signIn').code).toBe('auth_invalid_credentials');
    expect(mapAuthError(new AuthApiError('Email not confirmed', 400, 'email_not_confirmed'), 'signIn').code).toBe('auth_email_not_confirmed');
    expect(mapAuthError(new AuthApiError('rate', 429, 'over_request_rate_limit'), 'signIn').code).toBe('auth_rate_limited');
    expect(mapAuthError(new AuthApiError('exists', 422, 'user_already_exists'), 'signUp').code).toBe('auth_signup_exists');
    expect(mapAuthError(new AuthApiError('disabled', 422, 'signup_disabled'), 'signUp').code).toBe('auth_signup_disabled');
    expect(mapAuthError(new AuthWeakPasswordError('weak', 422, ['length']), 'signUp').code).toBe('auth_weak_password');
    expect(mapAuthError(new Error('???'), 'signIn').code).toBe('auth_failed');
  });
});

describe('Supabase 인증 저장소', () => {
  it('환경 값이 없으면 모든 요청을 거절하고 세션은 없다(모의 성공 없음)', async () => {
    const r = repoOf(null);
    expect(r.configured).toBe(false);
    expect(await r.restoreSession()).toBeNull();
    expect(await codeOf(r.signIn({ email: 'a@b.co', password: 'abcdef' }))).toBe('auth_not_configured');
    expect(await codeOf(r.signUp({ email: 'a@b.co', password: 'abcdef' }))).toBe('auth_not_configured');
    expect(await codeOf(r.requestPasswordReset('a@b.co'))).toBe('auth_not_configured');
  });

  it('로그인: SDK에 그대로 전달하고 세션을 돌려준다', async () => {
    const { c } = fakeClient();
    const s = await repoOf(c).signIn({ email: ' a@b.co ', password: 'pw-123456' });
    expect(s).toEqual({ userId: 'u1', email: 'a@b.co' });
    expect(c.signInWithPassword).toHaveBeenCalledWith({ email: 'a@b.co', password: 'pw-123456' });
  });

  it('잘못된 비밀번호는 같은 안내 코드이고 오류에 비밀번호가 없다', async () => {
    const { c } = fakeClient({ signInWithPassword: vi.fn(async () => ({ data: { session: null, user: null }, error: new AuthApiError('Invalid login credentials', 400, 'invalid_credentials') })) });
    const err = await repoOf(c).signIn({ email: 'a@b.co', password: 'secret-pw-9' }).catch((e) => e);
    expect(err).toBeInstanceOf(RepoError);
    expect(err.code).toBe('auth_invalid_credentials');
    expect(JSON.stringify(err) + String(err.message)).not.toContain('secret-pw-9');
  });

  it('가입 후 세션이 생기면 로그아웃하고, 그 사이 인증 이벤트는 화면에 보내지 않는다', async () => {
    const { c } = fakeClient();
    const r = repoOf(c);
    const events: string[] = [];
    r.subscribe((e) => events.push(e.type));
    expect(await r.signUp({ email: 'a@b.co', password: 'abcdef' })).toEqual({ needsEmailConfirmation: false });
    expect(c.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(events).toEqual([]);
    expect(c.signUp).toHaveBeenCalledWith(expect.objectContaining({ options: { emailRedirectTo: 'https://app.example/login' } }));
  });

  it('이메일 확인이 켜진 환경(세션 없음)은 확인 필요로 알리고 로그아웃을 부르지 않는다', async () => {
    const { c } = fakeClient({ signUp: vi.fn(async () => ({ data: { session: null, user }, error: null })) });
    expect(await repoOf(c).signUp({ email: 'a@b.co', password: 'abcdef' })).toEqual({ needsEmailConfirmation: true });
    expect(c.signOut).not.toHaveBeenCalled();
  });

  it('가입 네트워크 실패는 auth_network', async () => {
    const { c } = fakeClient({ signUp: vi.fn(async () => ({ data: { session: null, user: null }, error: new AuthRetryableFetchError('Failed to fetch', 0) })) });
    expect(await codeOf(repoOf(c).signUp({ email: 'a@b.co', password: 'abcdef' }))).toBe('auth_network');
  });

  it('세션 복원: 서버에서 무효면 지우고 null, 네트워크 실패면 저장된 세션 유지', async () => {
    const invalid = fakeClient({ getUser: vi.fn(async () => ({ data: { user: null }, error: new AuthApiError('bad jwt', 403, 'bad_jwt') })) });
    expect(await repoOf(invalid.c).restoreSession()).toBeNull();
    expect(invalid.c.signOut).toHaveBeenCalledWith({ scope: 'local' });
    const offline = fakeClient({ getUser: vi.fn(async () => ({ data: { user: null }, error: new AuthRetryableFetchError('Failed to fetch', 0) })) });
    expect(await repoOf(offline.c).restoreSession()).toEqual({ userId: 'u1', email: 'a@b.co' });
    expect(offline.c.signOut).not.toHaveBeenCalled();
    const none = fakeClient({ getSession: vi.fn(async () => ({ data: { session: null }, error: null })) });
    expect(await repoOf(none.c).restoreSession()).toBeNull();
  });

  it('인증 상태 변화를 계약 이벤트로 바꾼다', () => {
    const { c, emit } = fakeClient();
    const events: string[] = [];
    repoOf(c).subscribe((e) => events.push(e.type));
    emit('SIGNED_IN', session); emit('TOKEN_REFRESHED', session); emit('PASSWORD_RECOVERY', session); emit('SIGNED_OUT', null);
    expect(events).toEqual(['SIGNED_IN', 'SIGNED_IN', 'PASSWORD_RECOVERY', 'SIGNED_OUT']);
  });

  it('재설정 요청: 계정 유무 관련 오류는 숨기고 네트워크 오류만 알린다', async () => {
    const hidden = fakeClient({ resetPasswordForEmail: vi.fn(async () => ({ data: null, error: new AuthApiError('not found', 400, 'user_not_found') })) });
    expect(await codeOf(repoOf(hidden.c).requestPasswordReset('x@y.co'))).toBe('ok');
    const offline = fakeClient({ resetPasswordForEmail: vi.fn(async () => ({ data: null, error: new AuthRetryableFetchError('Failed to fetch', 0) })) });
    expect(await codeOf(repoOf(offline.c).requestPasswordReset('x@y.co'))).toBe('auth_network');
  });
});
