import { describe, expect, it } from 'vitest';
import { RepoError } from '../../domain/errors';
import { DemoAuthRepository } from './demoAuthRepository';

function memStorage() {
  const m = new Map<string, string>();
  return { m, s: { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) } };
}
const make = (storage = memStorage()) => ({ storage, r: new DemoAuthRepository({ passwordMinLength: 6, storage: storage.s, latencyMs: 0 }) });
const codeOf = async (p: Promise<unknown>) => { try { await p; return 'ok'; } catch (e) { return e instanceof RepoError ? e.code : 'other'; } };

describe('임시 데모 로그인(Supabase 연결 전)', () => {
  it('가입 → 로그인 → 세션 유지(같은 저장소로 새로 만들어도 복원) → 로그아웃', async () => {
    const { storage, r } = make();
    expect(r.kind).toBe('demo');
    expect(await r.signUp({ email: 'A@b.co ', password: 'abcdef' })).toEqual({ needsEmailConfirmation: false });
    expect(await r.restoreSession()).toBeNull(); // 가입만으로는 로그인하지 않음
    const s = await r.signIn({ email: 'a@b.co', password: 'abcdef' });
    expect(s.email).toBe('a@b.co');
    const reloaded = new DemoAuthRepository({ passwordMinLength: 6, storage: storage.s, latencyMs: 0 });
    expect(await reloaded.restoreSession()).toEqual(s);
    const events: string[] = [];
    reloaded.subscribe((e) => events.push(e.type));
    await reloaded.signOut();
    expect(await reloaded.restoreSession()).toBeNull();
    expect(events).toEqual(['SIGNED_OUT']);
  });

  it('처음 쓰는 이메일은 로그인 시 데모 계정을 만들어 로그인하고, 이후엔 비밀번호를 확인한다', async () => {
    const { r } = make();
    const s1 = await r.signIn({ email: 'first@b.co', password: 'abcdef' });
    expect(s1.email).toBe('first@b.co');
    await r.signOut();
    expect(await codeOf(r.signIn({ email: 'first@b.co', password: 'wrong!!' }))).toBe('auth_invalid_credentials');
    expect((await r.signIn({ email: 'first@b.co', password: 'abcdef' })).userId).toBe(s1.userId);
    expect(await codeOf(r.signIn({ email: 'short@b.co', password: 'abc' }))).toBe('auth_weak_password');
  });

  it('비밀번호 원문을 저장하지 않는다', async () => {
    const { storage, r } = make();
    await r.signUp({ email: 'a@b.co', password: 'plain-secret-77' });
    await r.signIn({ email: 'a@b.co', password: 'plain-secret-77' });
    expect([...storage.m.values()].join()).not.toContain('plain-secret-77');
  });

  it('중복 가입·짧은 비밀번호 거절, 계정마다 다른 사용자 ID', async () => {
    const { r } = make();
    await r.signUp({ email: 'a@b.co', password: 'abcdef' });
    expect(await codeOf(r.signUp({ email: 'a@b.co', password: 'zzzzzz' }))).toBe('auth_signup_exists');
    expect(await codeOf(r.signUp({ email: 'c@b.co', password: 'abc' }))).toBe('auth_weak_password');
    await r.signUp({ email: 'b@b.co', password: 'abcdef' });
    const a = await r.signIn({ email: 'a@b.co', password: 'abcdef' });
    const b = await r.signIn({ email: 'b@b.co', password: 'abcdef' });
    expect(a.userId).not.toBe(b.userId);
  });

  it('비밀번호 재설정은 끝까지 진행되지 않는다(메일 없음)', async () => {
    const { r } = make();
    expect(await codeOf(r.requestPasswordReset('a@b.co'))).toBe('ok');
    expect(await codeOf(r.updatePassword('newpass'))).toBe('auth_recovery_invalid');
  });
});
