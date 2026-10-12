/**
 * 브라우저용 Supabase 클라이언트. 공개 가능한 프로젝트 URL과 publishable(또는 anon) 키만 쓴다.
 * service role / secret 키는 절대 VITE_ 변수나 브라우저 코드에 넣지 않는다(번들에 그대로 포함됨).
 * 값이 없으면 null — 앱은 "연결 미설정"을 안내하고 로그인을 성공 처리하지 않는다.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL?.trim();
// 새 프로젝트의 publishable 키를 권장. 기존 프로젝트는 anon 키를 같은 변수에 넣어도 된다.
const key = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? import.meta.env.VITE_SUPABASE_ANON_KEY)?.trim();

/** SDK가 URL 해시를 읽고 지우기 전에 재설정 링크 여부를 기록한다. */
const hash = typeof window !== 'undefined' ? window.location.hash : '';
export const OPENED_FROM_RECOVERY_LINK = /(^|[#&])type=recovery(&|$)/.test(hash) || /(^|[#&])error_code=otp_expired/.test(hash);

function isValidUrl(v: string | undefined): v is string {
  if (!v) return false;
  try { return ['https:', 'http:'].includes(new URL(v).protocol); } catch { return false; }
}

export const supabase: SupabaseClient | null = isValidUrl(url) && key
  ? createClient(url, key, {
    auth: {
      persistSession: true, // 새로고침 후 세션 유지(Supabase 기본: localStorage)
      autoRefreshToken: true,
      detectSessionInUrl: true, // 가입 확인·비밀번호 재설정 메일 링크 처리
    },
  })
  : null;
