import { Link, useNavigate, useParams } from 'react-router-dom';
import { Page } from '../../app/Page';
import { useRepo } from '../../app/context';
import { useAction, useAsync } from '../../app/hooks';
import { formatWon } from '../../domain/money';
import { formatDateTime } from '../../domain/time';
import type { TransactionDetail } from '../../data/repositories/types';
import { AsyncView, Banner, Button, KV, LinkButton, MockPayNotice } from '../../components/ui';
import { PAYMENT_STATUS } from '../shared';
import { progressOfPayment } from '../../domain/progressStep';
import { ProgressSteps } from '../../components/ProgressSteps';
import { listPath } from '../../domain/reservationTabs';

function nextLinks(d: TransactionDetail): { primary?: { to: string; label: string }; secondary?: { to: string; label: string } } {
  const t = d.tx;
  const ok = t.status === 'success';
  switch (t.kind) {
    case 'deposit':
      // 예약 생성 확인 전: 결과 확인만(보낸 요청에 남아 있다)
      if (ok && !d.bookingId) return { secondary: { to: listPath('requests'), label: '보낸 요청 목록' } };
      // 결제 성공 + 예약 생성: 생성된 예약 상세 / 확정된 예약 목록. 실패·확인 중: 승인 내용 / 보낸 요청 목록
      return ok && d.bookingId ? { primary: { to: `/bookings/${d.bookingId}`, label: '예약 확인하기' }, secondary: { to: listPath('active'), label: '확정된 예약 목록' } }
        : { primary: { to: d.requestId ? `/requests/${d.requestId}#pay` : listPath('requests'), label: '요청 상세에서 다시 확인하기' }, secondary: { to: listPath('requests'), label: '보낸 요청 목록' } };
    case 'material_prepay':
      return { primary: { to: d.bookingId ? `/bookings/${d.bookingId}` : '/bookings', label: '예약 상세 보기' } };
    case 'change_shortfall':
      return { primary: { to: d.bookingId ? `/bookings/${d.bookingId}` : '/bookings', label: '예약 상세 보기' } };
    case 'balance':
      return { primary: { to: d.bookingId ? `/bookings/${d.bookingId}` : '/bookings', label: '예약 상세 보기' } };
  }
}

/** 상단 뒤로: 예약금 결제 성공·예약 생성 → 확정된 예약, 그 밖의 예약금 결제 → 보낸 요청, 예약 중 결제 → 예약 상세 */
function backOf(d?: TransactionDetail): string {
  if (!d) return '/bookings';
  if (d.tx.kind === 'deposit') return d.tx.status === 'success' && d.bookingId ? listPath('active') : listPath('requests');
  return d.bookingId ? `/bookings/${d.bookingId}` : '/bookings';
}

/** S-01 결제 진행·결과(모의). 결과를 확인 중일 때는 재결제 대신 상태 조회만 제공한다. */
export function PaymentResultPage() {
  const { txId = '' } = useParams();
  const repo = useRepo();
  const q = useAsync(() => repo.getTransaction(txId), [repo, txId]);
  const action = useAction();
  const nav = useNavigate();
  /** 결과 다시 확인(재결제 아님). 예약금 결제 성공과 예약 생성이 확인되면 그 예약 상세로 */
  const recheck = (txId: string) => void action.run(async () => {
    const res = await repo.refreshPayment(txId);
    if (res.tx.kind === 'deposit' && res.tx.status === 'success' && res.bookingId) nav(`/bookings/${res.bookingId}`, { replace: true, state: { flash: '예약이 확정됐어요' } });
    else q.reload();
  });
  return (
    <Page title="결제 결과" back={backOf(q.data)} progress={q.data && <ProgressSteps progress={progressOfPayment(q.data.tx.kind, q.data.tx.status, !!q.data.bookingId)} />}>
      <AsyncView state={q}>
        {(d) => {
          const t = d.tx;
          const st = PAYMENT_STATUS[t.status];
          const links = nextLinks(d);
          const bookingPending = t.kind === 'deposit' && t.status === 'success' && !d.bookingId;
          const title = t.status === 'success' ? (t.kind === 'deposit' ? (bookingPending ? '예약 생성 결과를 확인하고 있어요' : '예약이 확정됐어요') : `${d.subject} 결제가 완료됐어요`)
            : t.status === 'failed' ? '결제가 완료되지 않았어요' : '결제 결과를 확인하고 있어요';
          const tone = t.status === 'success' ? 'success' : t.status === 'failed' ? 'danger' : 'warn';
          return (
            <>
              <MockPayNotice />
              <Banner tone={tone} title={title}>
                {t.status === 'success' && t.kind === 'deposit' && (bookingPending ? '결제는 완료됐어요. 예약이 만들어졌는지 확인하는 중이니 다시 결제하지 마세요.' : '예약금 결제가 끝나 예약이 확정됐어요. 이제 내 예약에서 방문·작업·정산을 확인해요.')}
                {t.status === 'success' && t.kind !== 'deposit' && '결제 내역은 결제·환불 내역에서 다시 볼 수 있어요.'}
                {t.status === 'failed' && '예약은 확정되지 않았고 청구된 금액도 없어요. 다시 시도할 수 있어요.'}
                {(t.status === 'processing' || t.status === 'unknown' || t.status === 'pending') && '결제가 중복되지 않도록 다시 결제하지 마세요. 아래에서 결과를 확인할 수 있어요.'}
              </Banner>
              <div className="card stack">
                <KV rows={[
                  { k: '결제 항목', v: d.subject },
                  ...(d.providerName ? [{ k: '업체', v: d.providerName }] : []),
                  { k: '금액', v: <span className="money strong">{formatWon(t.amount)}</span> },
                  { k: '상태', v: st.label },
                  { k: '시각', v: <span className="nowrap">{formatDateTime(t.createdAt)}</span> },
                ]} />
                <p className="xs muted">{st.hint}</p>
              </div>
              {(t.status === 'processing' || t.status === 'unknown' || bookingPending) && (
                <Button variant="primary" block busy={action.busy} onClick={() => recheck(t.id)}>결제 결과 확인하기</Button>
              )}
              {action.error && <Banner tone="danger" title={action.error.title}>{action.error.hint}</Banner>}
              <div className="stack--sm stack">
                {links.primary && <LinkButton to={links.primary.to} variant={t.status === 'processing' || t.status === 'unknown' ? 'secondary' : 'primary'} block>{links.primary.label}</LinkButton>}
                {links.secondary && <LinkButton to={links.secondary.to} variant="secondary" block>{links.secondary.label}</LinkButton>}
              </div>
              <p className="xs muted"><Link to={`/ledger/${t.id}`}>결제·환불 상세 보기</Link></p>
            </>
          );
        }}
      </AsyncView>
    </Page>
  );
}
