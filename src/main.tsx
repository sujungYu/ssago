import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import { App } from './app/App';
import { RepoProvider, clearUserAppState, createDefaultServices } from './app/context';
import { AuthProvider } from './app/auth';

const { repo, auth } = createDefaultServices();

/** 로그인 계정이 정해지거나 바뀔 때(로그아웃 = null): 다른 계정이면 목업 상태·사용자별 화면 상태를 초기화한다. */
function onAccount(userId: string | null) {
  if (repo.__db().ownerAccountId === userId) return;
  repo.__switchOwner(userId);
  clearUserAppState();
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RepoProvider repo={repo}>
      <AuthProvider auth={auth} onAccount={onAccount}>
        <App />
      </AuthProvider>
    </RepoProvider>
  </StrictMode>,
);
