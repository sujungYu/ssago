import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ActionBar, Page } from '../../app/Page';
import { useRepo } from '../../app/context';
import { useAction, useAsync, useAttemptKey } from '../../app/hooks';
import { formatWon } from '../../domain/money';
import { AsyncView, Badge, Banner, Button, Dialog, KV, LinkButton, MockPayNotice, PhoneButton, Section } from '../../components/ui';
import type { StatementView } from '../../data/repositories/types';
import { PAYMENT_STATUS } from '../shared';
import { RefundBox } from '../changes/CancelPage';

function Body({ v, bookingId }: { v: StatementView; bookingId: string }) {
  const repo = useRepo();
  const nav = useNavigate();
  const action = useAction();
  const key = useAttemptKey('fin');
  const [consented, setConsented] = useState<string | null>(null);
  const [dlg, setDlg] = useState(false);
  const { statement: st, settlement: s, prepaid } = v;
  const stamp = `${st.version}:${s.delta}`;
  const ok = consented === stamp; // 금액·버전이 바뀌면 동의가 초기화된다
  const inflight = v.inFlightPayment;
  const settled = st.status === 'settled';
  const disputed = st.status === 'disputed';

  const confirm = () => void action.run(async () => {
    const r = await repo.confirmSettlement({ bookingId, statementVersion: st.version, idempotencyKey: key.get() });
    if (r.tx) nav(`/pay/${r.tx.id}`);
  });

  const resultRow = s.kind === 'pay' ? { k: '추가로 결제할 금액', v: <span className="money strong">{formatWon(s.amount)}</span> }
    : s.kind === 'zero' ? { k: '추가 결제·환불', v: <span className="money strong">0원</span> }
    : { k: '환불받을 금액', v: <span className="money strong">{formatWon(s.amount)}</span> };

  return (
    <>
      {settled && <Banner tone="success" title="정산이 끝났어요">{st.settledKind === 'pay' ? '최종 잔금 결제가 완료됐어요.' : st.settledKind === 'refund' ? '차액 환불을 요청했어요.' : '추가 결제 없이 확인이 끝났어요.'}</Banner>}
      {disputed && (
        <Banner tone="warn" title="금액을 협의하고 있어요">업체와 합의하기 전에는 확정되거나 자동으로 청구되지 않아요. 합의 내용으로 최종 금액이 바뀌면 다시 안내해 드려요.</Banner>
      )}
      {!settled && !disputed && <Banner tone="info" title="작업이 끝났어요. 최종 금액을 확인해 주세요">확인하기 전에는 추가 금액이 청구되지 않아요.</Banner>}
      {inflight && (
        <Banner tone="warn" title={PAYMENT_STATUS[inflight.status].label}>결제 결과를 확인 중이라 다시 결제할 수 없어요. <Link to={`/pay/${inflight.id}`}>결제 결과 확인하기</Link></Banner>
      )}

      <Section title="실제 작업 내용">
        <ul className="card card--flush divided">
          {st.actualWork.map((w) => (
            <li key={w.title} className="row row--between" style={{ padding: 'var(--sp-4)' }}>
              <span>{w.title}</span><Badge tone={w.done ? 'success' : 'warn'}>{w.done ? '완료' : '미완료'}</Badge>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="최종 금액">
        <div className="card stack">
          <KV rows={[
            ...st.items.map((it) => ({ k: it.label, v: <span className={`money${it.amount < 0 ? ' money--neg' : ''}`}>{it.amount < 0 ? `−${formatWon(-it.amount)}` : formatWon(it.amount)}</span>, key: it.label })),
            { k: '최종 대금', v: <span className="money strong">{formatWon(s.finalTotal)}</span>, total: true },
          ]} />
          <hr className="hr" />
          <KV rows={[
            { k: '결제한 예약금·선결제', v: <span className="money">{formatWon(prepaid.depositPaid + prepaid.materialPrepaid + prepaid.changePaid)}</span> },
            ...(prepaid.deducted ? [{ k: '이미 공제·충당된 금액', v: <span className="money money--neg">−{formatWon(prepaid.deducted)}</span> }] : []),
            ...(prepaid.refunded ? [{ k: '이미 환불 요청한 금액', v: <span className="money money--neg">−{formatWon(prepaid.refunded)}</span> }] : []),
            { k: '정산에 쓸 선결제 잔액', v: <span className="money">{formatWon(s.prepaid)}</span> },
            { ...resultRow, total: true },
          ]} />
          <p className="xs muted">최종 대금 {formatWon(s.finalTotal)} − 선결제 잔액 {formatWon(s.prepaid)} = {s.delta >= 0 ? formatWon(s.delta) : `−${formatWon(-s.delta)}`}. 이미 환불·공제된 금액은 다시 차감하지 않아요.</p>
        </div>
      </Section>

      {v.refund && <RefundBox refund={v.refund} />}
      {action.error && <Banner tone="danger" title={action.error.title}>{action.error.hint}</Banner>}

      {(disputed || !settled) && <PhoneButton phone={v.providerPhone} name={v.providerName} />}
      <LinkButton to={`/bookings/${bookingId}`} variant="secondary" block>예약 상세 보기</LinkButton>
      {settled && <LinkButton to={`/bookings/${bookingId}/review`} variant="primary" block>리뷰 작성하기</LinkButton>}

      {!settled && !disputed && (
        <>
          {s.kind === 'pay' && <MockPayNotice />}
          <label className="check card"><input type="checkbox" checked={ok} onChange={(e) => setConsented(e.target.checked ? stamp : null)} /><span>실제 작업 내용과 최종 금액을 확인했어요.</span></label>
          <ActionBar note={s.kind === 'pay' ? '모의 결제 · 실제 청구 없음' : s.kind === 'refund' ? '환불은 처리 요청이 접수되며, 모의 환불이라 실제 입금되지 않아요' : '추가 결제가 없어요'}>
            <Button variant="primary" block disabled={!ok || !!inflight} busy={action.busy} onClick={confirm}>
              {s.kind === 'pay' ? `확인하고 ${formatWon(s.amount)} 모의 결제` : s.kind === 'zero' ? '확인하기 (추가 결제 없음)' : `확인하고 ${formatWon(s.amount)} 환불 요청`}
            </Button>
            <Button variant="secondary" block onClick={() => setDlg(true)}>금액이 달라요</Button>
          </ActionBar>
        </>
      )}
      {dlg && (
        <Dialog title="금액이 다른가요?" onClose={() => setDlg(false)}
          actions={<>
            <Button variant="primary" block busy={action.busy} onClick={() => void action.run(async () => { await repo.reportDispute(bookingId); setDlg(false); })}>이견 접수하고 정산 보류하기</Button>
            <Button block onClick={() => setDlg(false)}>돌아가기</Button>
          </>}>
          <p>이견을 접수하면 업체와 합의하기 전까지 금액이 확정되거나 자동으로 청구되지 않아요.</p>
          <p className="small muted">싸고는 누가 옳은지 판단하지 않아요. 먼저 {v.providerName}에 전화로 확인해 보세요.</p>
          <PhoneButton phone={v.providerPhone} name={v.providerName} />
          {action.error && <Banner tone="danger" title={action.error.title}>{action.error.hint}</Banner>}
        </Dialog>
      )}
    </>
  );
}

/** C-21 최종 금액 확인 */
export function FinalStatementPage() {
  const { id = '' } = useParams();
  const repo = useRepo();
  const q = useAsync(() => repo.getFinalStatement(id), [repo, id]);
  return (
    <Page title="최종 금액 확인" back={`/bookings/${id}`}>
      <AsyncView state={q}>{(v) => <Body v={v} bookingId={id} />}</AsyncView>
    </Page>
  );
}
