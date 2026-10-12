/// <reference types="vite/client" />
interface ImportMetaEnv {
  /** 데모 빌드에서만 화면 없는 개발용 시나리오 훅(window.__sagoDev)을 포함 */
  readonly VITE_ENABLE_DEV_TOOLS?: string;
}
