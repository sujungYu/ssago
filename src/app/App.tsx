import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import { HomePage } from '../features/discovery/HomePage';
import { AddressPage } from '../features/discovery/AddressPage';
import { ProviderListPage } from '../features/discovery/ProviderListPage';
import { ProviderDetailPage } from '../features/discovery/ProviderDetailPage';
import { RequestFormPage } from '../features/requests/RequestFormPage';
import { RequestsPage } from '../features/requests/RequestsPage';
import { BundlePage } from '../features/requests/BundlePage';
import { RequestDetailPage } from '../features/requests/RequestDetailPage';
import { SupplementPage } from '../features/requests/SupplementPage';
import { ApprovalPage } from '../features/payment/ApprovalPage';
import { PaymentResultPage } from '../features/payment/PaymentResultPage';
import { BookingsPage } from '../features/bookings/BookingsPage';
import { BookingDetailPage } from '../features/bookings/BookingDetailPage';
import { ChangeRequestPage } from '../features/changes/ChangeRequestPage';
import { ProposalPage } from '../features/changes/ProposalPage';
import { CancelPage } from '../features/changes/CancelPage';
import { DelayPage } from '../features/changes/DelayPage';
import { MaterialPage } from '../features/work/MaterialPage';
import { AdditionalPage } from '../features/work/AdditionalPage';
import { FinalStatementPage } from '../features/work/FinalStatementPage';
import { LedgerDetailPage, LedgerPage } from '../features/history/LedgerPages';
import { ReviewPage } from '../features/history/ReviewPage';
import { MePage } from '../features/history/MePage';
import { GuidePage, NoticePage, NotFoundPage } from '../features/system/SystemPages';
import { AppStateProvider } from './context';

/** 로그인 없는 데모에서 없앤 인증 화면 주소. 들어오면 업체 찾기로 보낸다(이전 링크·북마크 대비). */
const OLD_AUTH_PATHS = ['/login', '/signup', '/signup/done', '/password/reset', '/password/reset/sent', '/password/new'];

function ScrollTop() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return null;
}

export function App() {
  return (
    <BrowserRouter>
      <ScrollTop />
      {/* 계정(데모에서는 가상 데모 고객 고정)마다 화면 트리·앱 상태를 새로 만든다 */}
      <AppStateProvider>
        <Routes>
          {/* 로그인 없는 데모: 모든 화면을 바로 이용한다(인증 가드 없음). 데이터는 전부 목업이다. */}
          {OLD_AUTH_PATHS.map((p) => <Route key={p} path={p} element={<Navigate to="/" replace />} />)}
          <Route path="/" element={<HomePage />} />
          <Route path="/address" element={<AddressPage />} />
          <Route path="/providers" element={<ProviderListPage />} />
          <Route path="/providers/:id" element={<ProviderDetailPage />} />
          <Route path="/providers/:id/request" element={<RequestFormPage />} />
          <Route path="/requests" element={<RequestsPage />} />
          <Route path="/requests/bundle/:bundleId" element={<BundlePage />} />
          <Route path="/requests/:id" element={<RequestDetailPage />} />
          <Route path="/requests/:id/supplement" element={<SupplementPage />} />
          <Route path="/requests/:id/approval" element={<ApprovalPage mode="approval" />} />
          <Route path="/requests/:id/recheck" element={<ApprovalPage mode="recheck" />} />
          <Route path="/pay/:txId" element={<PaymentResultPage />} />
          <Route path="/bookings" element={<BookingsPage />} />
          <Route path="/bookings/:id" element={<BookingDetailPage />} />
          <Route path="/bookings/:id/change" element={<ChangeRequestPage />} />
          <Route path="/bookings/:id/cancel" element={<CancelPage />} />
          <Route path="/bookings/:id/final" element={<FinalStatementPage />} />
          <Route path="/bookings/:id/review" element={<ReviewPage />} />
          <Route path="/proposals/:id" element={<ProposalPage />} />
          <Route path="/delays/:id" element={<DelayPage />} />
          <Route path="/materials/:id" element={<MaterialPage />} />
          <Route path="/additional/:id" element={<AdditionalPage />} />
          <Route path="/ledger" element={<LedgerPage />} />
          <Route path="/ledger/:id" element={<LedgerDetailPage />} />
          <Route path="/me" element={<MePage />} />
          <Route path="/guide" element={<GuidePage />} />
          <Route path="/notice/:id" element={<NoticePage />} />
          <Route path="/home" element={<Navigate to="/" replace />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </AppStateProvider>
    </BrowserRouter>
  );
}
