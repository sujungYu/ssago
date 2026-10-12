import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import { App } from './app/App';
import { RepoProvider, clearUserAppState, createDefaultServices } from './app/context';
import { DEMO_ACCOUNT_ID } from './app/account';

const { repo } = createDefaultServices();

// 로그인 없는 데모: 앱 시작 즉시(세션 확인 없이) 가상 데모 고객 맥락으로 목업 데이터를 연다.
// 이 탭에 다른 소유 계정의 목업 상태(이전 버전·다른 계정)가 남아 있으면 새 데모 데이터로 바꾸고 화면 상태를 지운다.
if (repo.__db().ownerAccountId !== DEMO_ACCOUNT_ID) {
  repo.__switchOwner(DEMO_ACCOUNT_ID);
  clearUserAppState();
}

// 개발용 시나리오 이벤트 훅(화면 없음)은 dev 서버 또는 VITE_ENABLE_DEV_TOOLS=true 일 때만 번들에 들어간다(운영 빌드에서는 조건이 정적으로 false가 되어 제거됨).
if (import.meta.env.DEV || import.meta.env.VITE_ENABLE_DEV_TOOLS === 'true') {
  void import('./dev/devHook').then((m) => m.installDevHook(repo));
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RepoProvider repo={repo}>
      <App />
    </RepoProvider>
  </StrictMode>,
);
