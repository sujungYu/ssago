import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ActionBar, Page } from '../../app/Page';
import { useRepo } from '../../app/context';
import { useAction, useAsync, useAttemptKey } from '../../app/hooks';
import { formatDate } from '../../domain/time';
import { formatWon } from '../../domain/money';
import { AsyncView, Badge, Banner, Button, KV, LinkButton, MockPayNotice, Section } from '../../components/ui';
import { PAYMENT_STATUS } from '../shared';

/** C-19 자재 조건·진행. 수납(결제)과 업체의 주문은 별개 상태로 보여준다. */
export function MaterialPage() {
  const { id = '' } = useParams();
  const repo = useRepo();
  const nav = useNavigate();
  const q = useAsync(() => repo.getMaterial(id), [repo, id]);
  const action = useAction();
  const key = useAttemptKey('mat');
  const [ok, setOk] = useState(false);
  return (
    <Page title="자재 주문 조건" back={q.data ? `/bookings/${q.data.booking.id}` : '/bookings'}>
      <AsyncView state={q}>
        {({ offer: m, booking, providerName, tx }) => {
          const inflight = tx && (tx.status === 'processing' || tx.status === 'unknown');
          const paid = m.paymentStatus === 'success';
          return (
            <>
              <Banner tone="info" title="동의하기 전에는 결제되지 않아요">{providerName}가 필요한 자재의 주문 조건을 보냈어요. 동의하고 선결제해야 업체가 주문해요.</Banner>
              <div className="card stack">
                <h2 style={{ fontSize: 'var(--fs-lg)' }}>{m.name}</h2>
                <KV rows={[
                  { k: '규격', v: m.spec }, { k: '수량', v: `${m.quantity}개` },
                  { k: '금액', v: <span className="money strong">{formatWon(m.price)}</span> },
                  { k: '납기', v: formatDate(m.deliveryDate) },
                ]} />
              </div>
              <Section title="진행 상태">
                <div className="card"><KV rows={[
                  { k: '선결제(수납)', v: <Badge tone={paid ? 'success' : m.paymentStatus === 'none' ? 'neutral' : PAYMENT_STATUS[m.paymentStatus].tone}>{m.paymentStatus === 'none' ? '결제 전' : PAYMENT_STATUS[m.paymentStatus].label}</Badge> },
                  { k: '업체 주문', v: <Badge tone={m.orderStatus === 'ordered' ? 'success' : 'neutral'}>{m.orderStatus === 'ordered' ? '주문 완료' : '주문 전'}</Badge> },
                ]} />
                  <p className="xs muted" style={{ marginTop: 'var(--sp-3)' }}>선결제가 끝나도 업체가 실제로 주문하기 전까지는 ‘주문 전’으로 표시돼요.</p></div>
              </Section>
              <Section title="취소 조건">
                <div className="card stack">
                  <p className="small">{m.cancellationTerms}</p>
                  {m.nonRefundableIfCancelled > 0 && (
                    <p className="small strong">주문·제작이 시작된 뒤 취소하면 회수 불가능한 실제 비용 최대 {formatWon(m.nonRefundableIfCancelled)}이 출장비와 별도로 공제될 수 있어요. (합의·증빙 조건을 충족한 경우)</p>
                  )}
                  <p className="xs muted">납기가 지연되거나 잘못 주문된 경우에는 무료 변경·취소가 적용돼요.</p>
                </div>
              </Section>
              {inflight && <Banner tone="warn" title={PAYMENT_STATUS[tx.status].label}>결제 결과를 확인 중이라 다시 결제할 수 없어요. <Link to={`/pay/${tx.id}`}>결제 결과 확인하기</Link></Banner>}
              {m.paymentStatus === 'none' && !inflight && (
                <>
                  <MockPayNotice />
                  <label className="check card"><input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} /><span>자재 조건과 취소 조건을 확인했고, {formatWon(m.price)} 선결제에 동의해요.</span></label>
                  {action.error && <Banner tone="danger" title={action.error.title}>{action.error.hint}</Banner>}
                  <ActionBar>
                    <Button variant="primary" block disabled={!ok} busy={action.busy} onClick={() => void action.run(async () => { const r = await repo.agreeAndPayMaterial(m.id, key.get()); nav(`/pay/${r.tx.id}`); })}>
                      {action.busy ? '결제 진행 중… 화면을 닫지 마세요' : `${formatWon(m.price)} 결제하기`}
                    </Button>
                    <LinkButton to={`/bookings/${booking.id}`} variant="secondary" block>나중에 결정하기</LinkButton>
                  </ActionBar>
                </>
              )}
              {(paid || inflight) && <LinkButton to={`/bookings/${booking.id}`} variant="secondary" block>예약 상세 보기</LinkButton>}
            </>
          );
        }}
      </AsyncView>
    </Page>
  );
}
