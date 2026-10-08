import { lazy, Suspense } from 'react';
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

// 개발용 시나리오 패널은 dev 서버 또는 VITE_ENABLE_DEV_TOOLS=true 일 때만 번들에 들어간다(운영 빌드에서는 조건이 정적으로 false가 되어 제거됨).
const SHOW_DEV = import.meta.env.DEV || import.meta.env.VITE_ENABLE_DEV_TOOLS === 'true';
const DevPanel = SHOW_DEV ? lazy(() => import('../dev/DevPanel')) : null;

function ScrollTop() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return null;
}

export function App() {
  return (
    <BrowserRouter>
      <ScrollTop />
      <Routes>
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
      {DevPanel && <Suspense fallback={null}><DevPanel /></Suspense>}
    </BrowserRouter>
  );
}
