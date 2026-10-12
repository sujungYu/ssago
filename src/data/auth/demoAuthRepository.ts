/**
 * ⚠️ 임시 데모 로그인 — Supabase 연결 전까지만 쓴다(src/app/context.tsx에서 Supabase 값이 없을 때 선택).
 * Supabase URL·키를 넣으면 자동으로 SupabaseAuthRepository로 바뀌고 이 파일은 쓰이지 않는다. 연결 후 삭제 대상.
 *
 * - 실제 계정·서버 인증이 아니다. 가입한 계정과 로그인 상태는 이 브라우저의 localStorage에만 있고 다른 기기·브라우저와 공유되지 않는다.
 * - 비밀번호 원문은 저장하지 않는다. 계정마다 무작위 솔트를 붙인 SHA-256 해시만 저장한다(브라우저 저장소는 보안 저장소가 아님 — 데모 한정).
 * - 화면은 kind === 'demo'일 때 "데모 로그인 · 실제 계정 아님"을 표시한다.
 * - 로그인 화면에서 처음 쓰는 이메일은 그 자리에서 데모 계정을 만들고 로그인시킨다(데모 편의). 이미 있는 이메일은 비밀번호를 확인한다.
 * - 메일을 보낼 수 없어 비밀번호 재설정은 끝까지 진행되지 않는다.
 */
import { RepoError } from '../../domain/errors';
import type { AuthEvent, AuthRepository, AuthSession } from '../repositories/auth';
import type { Unsubscribe } from '../repositories/types';

const ACCOUNTS_KEY = 'on-gimae/demo-auth/accounts/v1';
const SESSION_KEY = 'on-gimae/demo-auth/session/v1';

interface DemoAccount { id: string; email: string; salt: string; hash: string }
type KV = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export interface DemoAuthOptions {
  passwordMinLength: number;
  /** 테스트용 저장소 주입(기본 localStorage) */
  storage?: KV;
  latencyMs?: number;
}

const hex = (buf: ArrayBuffer) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
const randomId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
async function hashPassword(salt: string, password: string): Promise<string> {
  if (!crypto?.subtle) throw new RepoError('auth_failed'); // http(비보안) 주소 등 Web Crypto를 못 쓰는 환경
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}:${password}`)));
}
const normalize = (email: string) => email.trim().toLowerCase();

export class DemoAuthRepository implements AuthRepository {
  readonly kind = 'demo' as const;
  readonly configured = true;
  readonly passwordMinLength: number;
  readonly openedFromRecoveryLink = false;
  private storage: KV | null;
  private latencyMs: number;
  private listeners = new Set<(e: AuthEvent) => void>();

  constructor(opts: DemoAuthOptions) {
    this.passwordMinLength = opts.passwordMinLength;
    this.latencyMs = opts.latencyMs ?? 300;
    this.storage = opts.storage ?? (() => { try { return window.localStorage; } catch { return null; } })();
  }

  // ───────── 저장소 ─────────
  private read<T>(key: string, fallback: T): T {
    try { const raw = this.storage?.getItem(key); return raw ? (JSON.parse(raw) as T) : fallback; } catch { return fallback; }
  }
  private write(key: string, value: unknown | null) {
    try { if (value === null) this.storage?.removeItem(key); else this.storage?.setItem(key, JSON.stringify(value)); }
    catch { throw new RepoError('auth_failed'); }
  }
  private accounts(): DemoAccount[] { return this.read<DemoAccount[]>(ACCOUNTS_KEY, []); }
  private async wait() { if (this.latencyMs > 0) await new Promise((r) => setTimeout(r, this.latencyMs)); }
  private emit(e: AuthEvent) { this.listeners.forEach((l) => l(e)); }

  // ───────── 계약 ─────────
  async restoreSession(): Promise<AuthSession | null> {
    const s = this.read<AuthSession | null>(SESSION_KEY, null);
    // 세션의 계정이 지워졌으면 세션도 무효
    if (s && !this.accounts().some((a) => a.id === s.userId)) { this.write(SESSION_KEY, null); return null; }
    return s;
  }

  subscribe(listener: (e: AuthEvent) => void): Unsubscribe {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  async signIn(input: { email: string; password: string }): Promise<AuthSession> {
    await this.wait();
    const email = normalize(input.email);
    let acc = this.accounts().find((a) => a.email === email);
    // ⚠️ 임시(데모 편의): 이 브라우저에 없는 이메일이면 회원가입 없이 그 자리에서 데모 계정을 만들고 로그인시킨다.
    // 이미 있는 이메일은 비밀번호를 확인한다(틀리면 "이메일 또는 비밀번호를 확인해주세요").
    // Supabase 연결 후에는 이 동작이 없다 — 가입한 계정만 로그인된다.
    if (!acc) acc = await this.createAccount(email, input.password);
    else if (acc.hash !== await hashPassword(acc.salt, input.password)) throw new RepoError('auth_invalid_credentials');
    const session: AuthSession = { userId: acc.id, email: acc.email };
    this.write(SESSION_KEY, session);
    this.emit({ type: 'SIGNED_IN', session });
    return session;
  }

  async signUp(input: { email: string; password: string }): Promise<{ needsEmailConfirmation: boolean }> {
    await this.wait();
    const email = normalize(input.email);
    const list = this.accounts();
    // Supabase에서 이메일 확인을 끈 데모 설정과 같은 동작(이미 가입된 이메일 안내)
    if (list.some((a) => a.email === email)) throw new RepoError('auth_signup_exists');
    await this.createAccount(email, input.password);
    // 가입만으로는 로그인하지 않는다(가입 완료 → 로그인 화면 흐름)
    return { needsEmailConfirmation: false };
  }

  private async createAccount(email: string, password: string): Promise<DemoAccount> {
    if (password.length < this.passwordMinLength) throw new RepoError('auth_weak_password');
    const salt = randomId();
    const acc: DemoAccount = { id: `demo-${randomId()}`, email, salt, hash: await hashPassword(salt, password) };
    this.write(ACCOUNTS_KEY, [...this.accounts(), acc]);
    return acc;
  }

  async signOut(): Promise<void> {
    this.write(SESSION_KEY, null);
    this.emit({ type: 'SIGNED_OUT' });
  }

  async requestPasswordReset(_email: string): Promise<void> {
    await this.wait(); // 데모는 메일을 보내지 않는다. 화면은 데모 안내를 함께 보여 준다.
  }

  async updatePassword(_newPassword: string): Promise<void> {
    throw new RepoError('auth_recovery_invalid'); // 데모에는 재설정 메일 링크(복구 세션)가 없다
  }
}
