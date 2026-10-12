/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_ENABLE_DEV_TOOLS?: string;
  /** Supabase 프로젝트 URL(공개 가능 값) */
  readonly VITE_SUPABASE_URL?: string;
  /** Supabase publishable 키(공개 가능 값, RLS 전제) */
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  /** 기존 프로젝트의 anon 키(publishable 키 대신) */
  readonly VITE_SUPABASE_ANON_KEY?: string;
  /** Supabase 프로젝트의 최소 비밀번호 길이와 같은 값(기본 6) */
  readonly VITE_AUTH_PASSWORD_MIN_LENGTH?: string;
}
