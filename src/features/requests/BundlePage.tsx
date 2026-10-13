import { useMemo, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { Page } from '../../app/Page';
import { useAppState, useRepo } from '../../app/context';
import { useAsync } from '../../app/hooks';
import { useListScrollRestore, useUrlFilter, type UrlFilterCodec } from '../../app/listFilter';
import { formatDateTime, formatRemaining } from '../../domain/time';
import { formatWon } from '../../domain/money';
import { listPath } from '../../domain/reservationTabs';
import { approvalEstimate } from '../../domain/approvalCost';
import {
  BUNDLE_STATUS_OPTIONS, filterBundleItems, hasBundleFilterParams, parseBundleFilter, writeBundleFilter, type BundleStatusFilter,
} from '../../domain/bundleFilter';
import type { RequestDetail } from '../../data/repositories/types';
import type { RequestStatus } from '../../domain/types';
import { AsyncView, Banner, Button, KV, LinkButton, LoadingBlock, Section } from '../../components/ui';
import { CapsuleButton, OptionPicker } from '../../components/filters';
import { RequestBadge } from './RequestsPage';
import { VisitText } from '../shared';

/** 종료 상태의 구체 사유(카드에는 실제 상태를 보여준다. 필터에서만 ‘종료’로 묶는다) */
const ENDED_TEXT: Partial<Record<RequestStatus, string>> = {
  rejected: '업체가 요청을 거절했어요.',
  withdrawn: '요청을 철회했어요.',
  approval_expired: '결제 기한이 지나 승인이 만료됐어요.',
  closed_other_booking: '같은 작업을 다른 업체로 예약해 종료됐어요.',
};

/**
 * 업체별 응답 요약 카드. 핵심 조건만 보여주고 상세 조건(작업 범위·작업비·자재비·출장비 계산·할인·예약금·취소 조건)은
 * 기존 승인 조건 확인 화면에서 본다. 카드에서 바로 결제하지 않는다. 버튼은 카드마다 하나(클릭 영역이 겹치지 않음).
 */
function ResponseCard({ d, now }: { d: RequestDetail; now: string }) {
  const r = d.request;
  const ap = d.approval;
  const head = (
    <div className="resp-card__head">
      <h3 className="resp-card__name">{d.provider.name}</h3>
      <RequestBadge status={r.status} recheck={!!ap?.recheck} />
    </div>
  );
  if (r.status === 'approved_pending_payment' && ap) {
    const est = approvalEstimate(ap, d.group?.confirmedHouseholds ?? 0);
    const visitDate = ap.recheck ? ap.recheck.newVisitDate : ap.visitDate;
    const visitTime = ap.recheck ? ap.recheck.newVisitTime : ap.visitTime;
    return (
      <article className="card stack--sm stack resp-card" aria-label={`${d.provider.name} 응답`}>
        {head}
        <KV rows={[
          { k: '방문 예정', v: <VisitText date={visitDate} time={visitTime} /> },
          { k: '예상 총금액', v: est.total === null ? <span className="strong">금액 확인 필요</span> : <span className="money strong">약 {formatWon(est.total)}</span> },
          { k: '예약금 결제 기한', v: <span className="nowrap" title={formatDateTime(ap.paymentDeadline)}>{formatRemaining(now, ap.paymentDeadline)}</span> },
        ]} />
        <p className="xs muted resp-card__note">
          {ap.recheck ? '새 그룹 조건이라 출장비를 혼자 부담할 수도 있어요.' : '출장비는 마감 때 확정된 세대 수로 정해져요.'}
          {est.discountNote && ' 업체 할인 조건은 상세에서 확인해요.'}
        </p>
        <LinkButton to={`/requests/${r.id}#pay`} variant="primary" block>상세 조건 보기</LinkButton>
      </article>
    );
  }
  if (r.status === 'booked') {
    return (
      <article className="card stack--sm stack resp-card" aria-label={`${d.provider.name} 응답`}>
        {head}
        {ap && <KV rows={[{ k: '방문 예정', v: <VisitText date={ap.visitDate} time={ap.visitTime} /> }]} />}
        <p className="small muted">예약 완료 · 일정·작업·정산은 내 예약에서 관리해요.</p>
        <LinkButton to={r.bookingId ? `/bookings/${r.bookingId}` : `/requests/${r.id}`} variant="secondary" block>{r.bookingId ? '예약 보기' : '요청 상세 보기'}</LinkButton>
      </article>
    );
  }
  if (r.status === 'needs_info') {
    return (
      <article className="card stack--sm stack resp-card" aria-label={`${d.provider.name} 응답`}>
        {head}
        <p className="small clamp-2">{r.infoRequest?.message ?? '업체가 추가 정보를 요청했어요.'}</p>
        <LinkButton to={`/requests/${r.id}/supplement`} variant="primary" block>요청 보완하기</LinkButton>
      </article>
    );
  }
  if (r.status === 'reviewing') {
    return (
      <article className="card stack--sm stack resp-card" aria-label={`${d.provider.name} 응답`}>
        {head}
        <p className="small muted">업체가 작업과 일정을 확인하고 있어요.</p>
        <LinkButton to={`/requests/${r.id}`} variant="secondary" block>요청 상세 보기</LinkButton>
      </article>
    );
  }
  // 종료(거절·철회·승인 만료·다른 업체 예약으로 종료): 결제·예약 행동 없음
  return (
    <article className="card stack--sm stack resp-card resp-card--ended" aria-label={`${d.provider.name} 응답`}>
      {head}
      <p className="small muted clamp-2">{r.status === 'rejected' && r.rejectionReason ? r.rejectionReason : ENDED_TEXT[r.status] ?? '이 요청은 종료됐어요.'}</p>
      <LinkButton to={`/requests/${r.id}`} variant="secondary" block>요청 상세 보기</LinkButton>
    </article>
  );
}

/** C-07 비교 요청 묶음: 같은 작업에 대한 업체별 응답을 요약 카드로 비교한다. 상태로 거를 수 있다(조회 조건만). */
/** 이 묶음에서 확정된 예약(있으면). 확정된 묶음은 보낸 요청 목록에 없으므로 뒤로는 그 예약 상세로 */
const bookedOf = (b?: { items: { request: { bookingId?: string } }[] }): string | undefined => b?.items.find((i) => i.request.bookingId)?.request.bookingId;

export function BundlePage() {
  const { bundleId = '' } = useParams();
  const repo = useRepo();
  const nav = useNavigate();
  const { setBundleId } = useAppState();
  // 묶음마다 다른 필터 기록(세션 저장 키에 묶음 id 포함) — 다른 비교 요청에 적용되지 않는다
  const codec = useMemo<UrlFilterCodec<BundleStatusFilter>>(() => ({
    list: `bundle:${bundleId}`, parse: parseBundleFilter, write: writeBundleFilter, has: hasBundleFilterParams,
  }), [bundleId]);
  const { filter, apply } = useUrlFilter(codec);
  const [picker, setPicker] = useState<HTMLElement | null>(null);
  const q = useAsync(() => repo.getBundle(bundleId), [repo, bundleId]);
  useListScrollRestore(codec.list, !!q.data, filter);
  const label = BUNDLE_STATUS_OPTIONS.find((o) => o.value === filter)?.label ?? '전체';
  return (
    <Page title="비교 요청" back={bookedOf(q.data) ? `/bookings/${bookedOf(q.data)}` : listPath('requests')}>
      <AsyncView state={q}>
        {(b) => {
          const shown = filterBundleItems(b.items, filter);
          const total = b.items.length;
          return (
            <>
              <Section title="요청한 작업">
                <div className="card"><ul className="stack--sm stack">{b.tasks.map((t) => <li key={t.id}><p className="strong">{t.title}</p>{t.description && <p className="small muted">{t.description}</p>}</li>)}</ul></div>
              </Section>
              <Banner tone="info" title="하나를 예약하면 나머지 요청은 종료돼요">결제로 예약을 확정하면 같은 작업의 다른 업체 요청은 취소수수료 없이 종료돼요. 승인만으로는 확정되지 않아요.</Banner>
              <Section
                title={filter === 'all' ? `업체별 응답 · ${total}곳` : `업체별 응답 · 전체 ${total}곳 중 ${shown.length}곳`}
                aside={<CapsuleButton label="전체 상태" value={filter === 'all' ? null : label} defaultValue="전체" onClick={setPicker} />}
                headClassName="section__head--filter">
                {shown.length === 0 ? (
                  <p className="muted resp-empty" role="status">선택한 상태의 업체 응답이 없어요.</p>
                ) : (
                  <div className={`compare ${shown.length > 1 ? 'compare--2' : ''}`}>
                    {shown.map((d) => <ResponseCard key={d.request.id} d={d} now={b.now} />)}
                  </div>
                )}
              </Section>
              <Button variant="secondary" block onClick={() => { setBundleId(b.bundleId); nav('/'); }}>같은 작업을 다른 업체에도 요청하기</Button>
              {picker && (
                <OptionPicker title="요청 상태" name="bundle-status" options={BUNDLE_STATUS_OPTIONS} value={filter} anchor={picker}
                  onClose={() => setPicker(null)} onApply={(v) => { setPicker(null); apply(v); }} />
              )}
            </>
          );
        }}
      </AsyncView>
    </Page>
  );
}

/**
 * 비교 요청을 쓰지 않는 데모(COMPARE_REQUESTS_ENABLED = false)의 이전 비교 요청 주소(/requests/bundle/:id):
 * 업체 요청이 하나면 그 요청 상세로, 여러 업체면 보낸 요청 목록(개별 요청으로 보임)으로 한 번 바꿔 이동한다. 없는 묶음도 목록으로.
 */
export function BundleRedirect() {
  const { bundleId = '' } = useParams();
  const repo = useRepo();
  const q = useAsync(() => repo.getBundle(bundleId), [repo, bundleId]);
  if (q.error) return <Navigate to={listPath('requests')} replace />;
  if (q.data) return <Navigate to={q.data.items.length === 1 ? `/requests/${q.data.items[0].request.id}` : listPath('requests')} replace />;
  return <Page title="보낸 요청" back={listPath('requests')}><LoadingBlock /></Page>;
}
