import { Link, useNavigate, useParams } from 'react-router-dom';
import { Page } from '../../app/Page';
import { useAppState, useRepo } from '../../app/context';
import { useAsync } from '../../app/hooks';
import { formatDateTime, formatRemaining } from '../../domain/time';
import { formatWon } from '../../domain/money';
import { AsyncView, Banner, Button, KV, Section } from '../../components/ui';
import { RequestBadge } from './RequestsPage';
import { VisitText, slotsText } from '../shared';

/** C-07 비교 요청 묶음 상세: 같은 작업에 대한 업체별 승인 조건을 나란히 본다. */
export function BundlePage() {
  const { bundleId = '' } = useParams();
  const repo = useRepo();
  const nav = useNavigate();
  const { setBundleId } = useAppState();
  const q = useAsync(() => repo.getBundle(bundleId), [repo, bundleId]);
  return (
    <Page title="비교 요청" back="/requests">
      <AsyncView state={q}>
        {(b) => (
          <>
            <Section title="요청한 작업">
              <div className="card"><ul className="stack--sm stack">{b.tasks.map((t) => <li key={t.id}><p className="strong">{t.title}</p>{t.description && <p className="small muted">{t.description}</p>}</li>)}</ul></div>
            </Section>
            <Banner tone="info" title="하나를 예약하면 나머지 요청은 종료돼요">결제로 예약을 확정하면 같은 작업의 다른 업체 요청은 취소수수료 없이 종료돼요. 승인만으로는 확정되지 않아요.</Banner>
            <Section title="업체별 응답">
              <div className={`compare ${b.items.length > 1 ? 'compare--2' : ''}`}>
                {b.items.map((d) => {
                  const ap = d.approval;
                  const ended = ['rejected', 'withdrawn', 'approval_expired', 'closed_other_booking'].includes(d.request.status);
                  const est = ap ? ap.tasks.reduce((a, t) => a + (t.estimate ?? 0), 0) : 0;
                  return (
                    <div key={d.request.id} className="card stack" style={ended ? { opacity: 0.85 } : undefined}>
                      <div className="row row--between row--wrap"><h3>{d.provider.name}</h3><RequestBadge status={d.request.status} recheck={!!ap?.recheck} /></div>
                      {ap && !ended ? (
                        <KV rows={[
                          { k: '업체가 제안한 방문 시각', v: <VisitText date={ap.visitDate} time={ap.visitTime} strong /> },
                          { k: '결제 기한', v: <span>{formatDateTime(ap.paymentDeadline)}<br /><span className="muted xs">{formatRemaining(repo.now(), ap.paymentDeadline)}</span></span> },
                          { k: '업체 견적(작업비)', v: <span className="money">{formatWon(est)}</span> },
                          { k: '부품·자재 예상', v: <span className="money">{formatWon(ap.partsEstimate)}</span> },
                          { k: '그룹 총 출장비', v: <span className="money">{formatWon(ap.totalTripFee)}</span> },
                          { k: '지금 낼 예약금', v: <span className="money strong">{formatWon(ap.depositAmount)}</span> },
                          ...(ap.discountNote ? [{ k: '업체 할인 조건', v: ap.discountNote }] : []),
                        ]} />
                      ) : (
                        <p className="small muted">{d.request.status === 'reviewing' ? '업체가 아직 검토 중이에요. 승인 조건이 오면 여기에서 비교할 수 있어요.' : d.request.status === 'needs_info' ? '업체가 추가 정보를 요청했어요.' : d.request.rejectionReason ?? '이 요청은 종료되었어요.'}</p>
                      )}
                      <p className="xs muted">고객 가능 시간 · {slotsText(d.request.slots)}</p>
                      <Link className={`btn ${ap && !ended && d.request.status === 'approved_pending_payment' ? 'btn--primary' : 'btn--secondary'} btn--block`}
                        to={d.request.status === 'approved_pending_payment' ? (ap?.recheck ? `/requests/${d.request.id}/recheck` : `/requests/${d.request.id}/approval`) : `/requests/${d.request.id}`}>
                        {d.request.status === 'approved_pending_payment' ? '승인 조건 확인하기' : '요청 상세 보기'}
                      </Link>
                    </div>
                  );
                })}
              </div>
            </Section>
            <Button variant="secondary" block onClick={() => { setBundleId(b.bundleId); nav('/'); }}>같은 작업을 다른 업체에도 요청하기</Button>
          </>
        )}
      </AsyncView>
    </Page>
  );
}
