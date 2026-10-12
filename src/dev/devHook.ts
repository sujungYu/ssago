/**
 * 개발용 시나리오 이벤트 훅(화면 없음). dev 서버 또는 VITE_ENABLE_DEV_TOOLS=true 빌드에서만 main.tsx가 불러온다.
 * 사용자 화면에는 아무것도 그리지 않고, e2e·브라우저 콘솔에서 `window.__sagoDev`로 업체 응답·시간 경과 같은 이벤트를 일으킨다.
 */
import type { MockRepository } from '../data/mock/mockRepository';
import { DevController } from './devController';

declare global {
  interface Window { __sagoDev?: DevController }
}

export function installDevHook(repo: MockRepository) {
  window.__sagoDev = new DevController(repo);
}
