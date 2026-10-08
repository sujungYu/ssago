import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { ActionBar, Page } from '../../app/Page';
import { useRepo } from '../../app/context';
import { useAction, useAsync, useAttemptKey } from '../../app/hooks';
import { formatWon } from '../../domain/money';
import { formatDateTime } from '../../domain/time';
import type { Refund } from '../../domain/types';
import { AsyncView, Badge, Banner, Button, KV, LinkButton, Section } from '../../components/ui';
import type { CancelContext } from '../../data/repositories/types';
import { REFUND_STATUS } from '../shared';

export function RefundBox({ refund }: { refund: Refund }) {
  const s = REFUND_STATUS[refund.status];
  return (
    <div className="card stack">
      <div className="row row--between row--wrap"><h3>환불</h3><Badge tone={s.tone}>{s.label}</Badge></div>
      <KV rows={[
        { k: '환불 요청 금액', v: <span className="money strong">{formatWon(refund.amount)}</span> },
        { k: '요청 시각', v: <span className="nowrap">{formatDateTime(refund.requestedAt)}</span> },
        { k: '사유', v: refund.reason },
      ]} />
      <p className="small">{s.hint}</p>
    </div>
  );
}

function Body({ c, bookingId, reload }: { c: CancelContext; bookingId: string; reload: () => void }) {
  const repo = useRepo();
  const action = useAction();
  const key = useAttemptKey('cnl');
  const [consented, setConsented] = useState<number | null>(null);
  const [done, setDone] = useState<Refund | null>(null);
  const pv = c.preview;
  const ok = consented === pv.refundTotal; // 금액이 바뀌면 동의가 초기화된다
  const refund = done ?? c.existing?.refund ?? null;

  if (refund) {
    return (
      <>
        <Banner tone="success" title="취소가 접수됐어요">공제 내역과 환불 상태를 아래에서 확인할 수 있어요.</Banner>
        <RefundBox refund={refund} />
        <LinkButton to={`/bookings/${bookingId}`} variant="primary" block>예약 상세 보기</LinkButton>
        <LinkButton to="/ledger" variant="secondary" block>결제·환불 내역</LinkButton>
      </>
    );
  }
  const free = c.cause !== 'customer';
  const submit = () => void action.run(async () => {
    try {
      const r = await repo.cancelBooking({ bookingId, expectedRefund: pv.refundTotal, idempotencyKey: key.get() });
      setDone(r.refund);
    } catch (e) {
      if ((e as { code?: string }).code === 'stale_cancel') { setConsented(null); reload(); }
      throw e;
    }
  });
  return (
    <>
      {free ? <Banner tone="success" title="무료 취소가 적용돼요">{c.causeLabel}</Banner>
        : <Banner tone="warn" title="고객 사유 취소예요">취소 전에 아래 환불 금액과 공제 내역을 꼭 확인해 주세요.</Banner>}
      <Section title="환불 금액">
        <div className="card stack">
          <KV rows={[
            { k: '결제한 예약금·선결제', v: <span className="money">{formatWon(pv.prepaidTotal)}</span> },
            { k: '확정 출장비 공제', v: <span className="money money--neg">{pv.tripFeeDeduction ? `−${formatWon(pv.tripFeeDeduction)}` : formatWon(0)}</span> },
            { k: '회수 불가능 자재비 공제', v: <span className="money money--neg">{pv.materialDeduction ? `−${formatWon(pv.materialDeduction)}` : formatWon(0)}</span> },
            { k: '환불 요청 금액', v: <span className="money strong">{formatWon(pv.refundTotal)}</span>, total: true },
          ]} />
          <ul className="stack--sm stack small muted">
            {free ? <li>· 해당 선결제는 공제 없이 전액 환불 대상이에요.</li> : pv.tripFeeDeduction > 0
              ? <li>· 접수 마감 후 취소라 내 확정 출장비만 공제돼요. 다른 세대의 확정 출장비는 바뀌지 않아요.</li>
              : <li>· 접수 마감 전이라 출장비 공제가 없어요. 남은 세대의 예상 출장비는 다시 계산돼요.</li>}
            {pv.materialDeduction > 0 && <li>· 자재비 공제는 동의한 조건에 따라 회수 불가능한 실제 비용만 별도로 반영돼요.</li>}
            <li>· 환불은 ‘처리 요청’이 접수되는 것이고, 카드·계좌에 실제 반영되는 시점은 결제수단에 따라 달라요. 모의 환불이라 실제 환불은 일어나지 않아요.</li>
          </ul>
        </div>
      </Section>
      {action.error && (
        <Banner tone="danger" title={action.error.title}>{action.error.hint}{action.error.code === 'stale_cancel' && ' 바뀐 금액을 다시 확인하고 동의해 주세요.'}</Banner>
      )}
      <label className="check card">
        <input type="checkbox" checked={ok} onChange={(e) => setConsented(e.target.checked ? pv.refundTotal : null)} />
        <span>환불 금액 {formatWon(pv.refundTotal)}과 공제 내역을 확인했고, 예약을 취소해요.</span>
      </label>
      <ActionBar note="취소하면 되돌릴 수 없어요">
        <Button variant="danger" block disabled={!ok} busy={action.busy} onClick={submit}>예약 취소하고 환불 요청</Button>
        <LinkButton to={`/bookings/${bookingId}`} variant="secondary" block>예약 유지하기</LinkButton>
      </ActionBar>
    </>
  );
}

/** C-17 취소·환불 금액 확인 */
export function CancelPage() {
  const { id = '' } = useParams();
  const repo = useRepo();
  const q = useAsync(() => repo.getCancelContext(id), [repo, id]);
  return (
    <Page title="취소·환불 확인" back={`/bookings/${id}`}>
      <AsyncView state={q}>{(c) => <Body c={c} bookingId={id} reload={q.reload} />}</AsyncView>
    </Page>
  );
}
