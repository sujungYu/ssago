import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import { App } from './app/App';
import { AppStateProvider, RepoProvider, createDefaultRepo } from './app/context';

const repo = createDefaultRepo();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RepoProvider repo={repo}>
      <AppStateProvider>
        <App />
      </AppStateProvider>
    </RepoProvider>
  </StrictMode>,
);
