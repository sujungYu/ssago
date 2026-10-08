import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Page } from '../../app/Page';
import { useRepo } from '../../app/context';
import { useAsync } from '../../app/hooks';
import { formatDateTime } from '../../domain/time';
import { formatWon } from '../../domain/money';
import type { LedgerEntry } from '../../data/repositories/types';
import { AsyncView, Badge, Banner, EmptyState, KV, LinkButton, MockPayNotice } from '../../components/ui';
import { PAYMENT_STATUS, REFUND_STATUS, TX_KIND_LABEL } from '../shared';

function entryView(l: LedgerEntry) {
  if (l.kind === 'payment') return { title: TX_KIND_LABEL[l.tx.kind], amount: l.tx.amount, badge: <Badge tone={PAYMENT_STATUS[l.tx.status].tone}>{PAYMENT_STATUS[l.tx.status].label}</Badge>, sign: '' };
  if (l.kind === 'refund') return { title: l.refund.purpose === 'settlement' ? '정산 차액 환불' : '취소 환불', amount: l.refund.amount, badge: <Badge tone={REFUND_STATUS[l.refund.status].tone}>{REFUND_STATUS[l.refund.status].label}</Badge>, sign: '' };
  return { title: l.deduction.kind === 'trip_fee' ? '출장비 공제' : '자재비 공제', amount: l.deduction.amount, badge: <Badge>공제</Badge>, sign: '−' };
}

/** C-25 결제·환불 내역 */
export function LedgerPage() {
  const repo = useRepo();
  const q = useAsync(() => repo.listLedger(), [repo]);
  const [f, setF] = useState<'all' | 'pay' | 'refund'>('all');
  return (
    <Page title="결제·환불 내역" back="/me">
      <MockPayNotice compact />
      <div className="chips" role="group" aria-label="내역 종류">
        {([['all', '전체'], ['pay', '결제'], ['refund', '환불·공제']] as const).map(([k, label]) => (
          <button key={k} type="button" className="chip" aria-pressed={f === k} onClick={() => setF(k)}>{label}</button>
        ))}
      </div>
      <AsyncView state={q}>
        {(all) => {
          const list = all.filter((l) => f === 'all' || (f === 'pay' ? l.kind === 'payment' : l.kind !== 'payment')).sort((a, b) => b.at.localeCompare(a.at));
          return list.length === 0 ? (
            <EmptyState icon="wallet" title="내역이 없어요">결제나 환불이 생기면 여기에서 확인할 수 있어요.</EmptyState>
          ) : (
            <ul className="card card--flush divided">
              {list.map((l) => {
                const v = entryView(l);
                return (
                  <li key={l.id}>
                    <Link to={`/ledger/${l.id}`} className="list-row">
                      <div className="list-row__main">
                        <span className="list-row__title">{v.title}</span>
                        <span className="small muted">{l.providerName ?? ''} · {formatDateTime(l.at)}</span>
                        <span>{v.badge}</span>
                      </div>
                      <span className="money strong">{v.sign}{formatWon(v.amount)}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          );
        }}
      </AsyncView>
    </Page>
  );
}

/** C-22 결제·환불 상세 */
export function LedgerDetailPage() {
  const { id = '' } = useParams();
  const repo = useRepo();
  const q = useAsync(() => repo.getLedgerEntry(id), [repo, id]);
  return (
    <Page title="결제·환불 상세" back="history">
      <AsyncView state={q}>
        {(l) => {
          const v = entryView(l);
          return (
            <>
              {l.kind === 'payment' && <MockPayNotice />}
              <div className="card stack">
                <div className="row row--between row--wrap"><h2 style={{ fontSize: 'var(--fs-lg)' }}>{v.title}</h2>{v.badge}</div>
                <KV rows={[
                  { k: '금액', v: <span className="money strong">{v.sign}{formatWon(v.amount)}</span> },
                  ...(l.providerName ? [{ k: '업체', v: l.providerName }] : []),
                  { k: l.kind === 'refund' ? '요청 시각' : '처리 시각', v: <span className="nowrap">{formatDateTime(l.at)}</span> },
                  ...(l.kind === 'refund' && l.refund.completedAt ? [{ k: '처리 완료 시각', v: <span className="nowrap">{formatDateTime(l.refund.completedAt)}</span> }] : []),
                  { k: '내용', v: l.subject },
                ]} />
                {l.kind === 'payment' && <p className="small">{PAYMENT_STATUS[l.tx.status].hint}</p>}
                {l.kind === 'refund' && <p className="small">{REFUND_STATUS[l.refund.status].hint}</p>}
                {l.kind === 'deduction' && <p className="small">마감 후 취소 또는 동의한 조건에 따라 차감된 금액이에요. 출장비와 자재비는 각각 별도 항목으로 표시돼요.</p>}
              </div>
              {l.kind === 'payment' && (l.tx.status === 'processing' || l.tx.status === 'unknown') && <LinkButton to={`/pay/${l.tx.id}`} variant="primary" block>결제 결과 확인하기</LinkButton>}
              {l.bookingId && <LinkButton to={`/bookings/${l.bookingId}`} variant="secondary" block>연결된 예약 보기</LinkButton>}
              <Banner tone="info">환불은 ‘처리 요청’과 카드·계좌에 ‘실제 반영’되는 시점이 달라요.</Banner>
            </>
          );
        }}
      </AsyncView>
    </Page>
  );
}
