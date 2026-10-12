/**
 * 인증 화면 입력 규칙(순수 함수). 최종 판정은 Supabase Auth가 하고, 화면은 같은 기준을 미리 안내한다.
 * 비밀번호 최소 길이는 Supabase 프로젝트 설정(Authentication → Providers → Email → Minimum password length)과
 * 같은 값을 VITE_AUTH_PASSWORD_MIN_LENGTH로 맞춘다. 없으면 Supabase 기본값 6.
 */
export const SUPABASE_DEFAULT_PASSWORD_MIN = 6;

export function parsePasswordMin(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= SUPABASE_DEFAULT_PASSWORD_MIN && n <= 72 ? n : SUPABASE_DEFAULT_PASSWORD_MIN;
}

export type FieldErrors<K extends string> = Partial<Record<K, string>>;

export function emailError(raw: string): string | undefined {
  const v = raw.trim();
  if (!v) return '이메일을 입력해 주세요.';
  if (v.length > 254 || !/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(v)) return '이메일 형식을 확인해 주세요. 예: name@example.com';
  return undefined;
}

const compact = <K extends string>(e: FieldErrors<K>): FieldErrors<K> =>
  Object.fromEntries(Object.entries(e).filter(([, v]) => v)) as FieldErrors<K>;

/** 로그인은 필수 입력만 검사한다(길이 기준이 바뀌어도 기존 비밀번호로 로그인할 수 있게). */
export function validateSignIn(v: { email: string; password: string }): FieldErrors<'email' | 'password'> {
  return compact({ email: emailError(v.email), password: v.password ? undefined : '비밀번호를 입력해 주세요.' });
}

export function newPasswordErrors(v: { password: string; confirm: string }, min: number): FieldErrors<'password' | 'confirm'> {
  return compact({
    password: !v.password ? '비밀번호를 입력해 주세요.' : v.password.length < min ? `비밀번호는 ${min}자 이상 입력해 주세요.` : undefined,
    confirm: !v.confirm ? '비밀번호를 한 번 더 입력해 주세요.' : v.password !== v.confirm ? '비밀번호가 일치하지 않아요.' : undefined,
  });
}

export function validateSignUp(v: { email: string; password: string; confirm: string }, min: number): FieldErrors<'email' | 'password' | 'confirm'> {
  return compact({ email: emailError(v.email), ...newPasswordErrors(v, min) });
}
