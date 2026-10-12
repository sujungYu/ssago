import { describe, expect, it } from 'vitest';
import { emailError, newPasswordErrors, parsePasswordMin, validateSignIn, validateSignUp } from './auth';

describe('인증 입력 검증', () => {
  it('이메일 필수·형식', () => {
    expect(emailError('')).toMatch('입력');
    expect(emailError('   ')).toMatch('입력');
    for (const bad of ['abc', 'a@b', 'a b@c.com', '@b.co', 'a@.co']) expect(emailError(bad)).toMatch('형식');
    expect(emailError('name@example.com')).toBeUndefined();
    expect(emailError('  name@mail.co.kr ')).toBeUndefined();
  });

  it('로그인은 필수 입력만 검사한다', () => {
    expect(Object.keys(validateSignIn({ email: '', password: '' }))).toEqual(['email', 'password']);
    expect(validateSignIn({ email: 'a@b.co', password: 'x' })).toEqual({});
  });

  it('회원가입: 최소 길이(설정값)·비밀번호 확인 일치', () => {
    const ok = { email: 'a@b.co', password: 'abcdef', confirm: 'abcdef' };
    expect(validateSignUp(ok, 6)).toEqual({});
    expect(validateSignUp(ok, 8).password).toMatch('8자 이상');
    expect(validateSignUp({ ...ok, confirm: 'abcdeg' }, 6).confirm).toMatch('일치');
    expect(validateSignUp({ ...ok, confirm: '' }, 6).confirm).toMatch('한 번 더');
    expect(newPasswordErrors({ password: '', confirm: '' }, 6)).toEqual({ password: expect.any(String), confirm: expect.any(String) });
  });

  it('오류 문구에 비밀번호를 넣지 않는다', () => {
    const secret = 'my-Secret-pw';
    const all = JSON.stringify([validateSignUp({ email: 'x', password: secret, confirm: 'other' }, 20), validateSignIn({ email: '', password: secret })]);
    expect(all).not.toContain(secret);
  });

  it('최소 길이 설정값: Supabase 기본 6, 6~72 정수만', () => {
    expect(parsePasswordMin(undefined)).toBe(6);
    expect(parsePasswordMin('8')).toBe(8);
    for (const bad of ['', 'abc', '4', '7.5', '100']) expect(parsePasswordMin(bad)).toBe(6);
  });
});
