import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useRepo } from '../../app/context';
import { useAction, useAsync, useAttemptKey } from '../../app/hooks';
import { formatDate } from '../../domain/time';
import { formatWon } from '../../domain/money';
import { appliedPrepaidLines, showSettlementCard, summarizeBookingCost, tripShareView, type Amount, type CostSummary } from '../../domain/bookingCost';
import { Icon } from '../../components/Icon';
import { Banner, Button, Dialog, PhoneButton } from '../../components/ui';
import type { BookingDetail, StatementView } from '../../data/repositories/types';
import type { Refund } from '../../domain/types';
import { PAYMENT_STATUS, REFUND_STATUS } from '../shared';

/** 화면 데이터 → 금액 요약 입력. 동의·결제 완료한 자재와 동의한 추가 작업만 합산한다. */
export function costOf(d: BookingDetail): CostSummary {
  const ap = d.approval;
  return summarizeBookingCost({
    laborEstimates: ap?.tasks.map((t) => t.estimate),
    partsEstimate: ap ? ap.partsEstimate : undefined,
    agreedMaterials: d.materials.filter((m) => m.paymentStatus === 'success').map((m) => ({ name: m.name, price: m.price })),
    agreedAdditional: d.additionalWorks.filter((w) => w.status === 'agreed').map((w) => ({ scope: w.scope, amount: w.amount })),
    tripFee: d.tripFee,
    discountNote: ap?.discountNote,
    prepaid: d.prepaid,
    statement: d.statement ? { status: d.statement.status, items: d.statement.items } : undefined,
    cancelled: d.booking.status === 'cancelled',
  });
}

/** ‘금액·정산’ 카드를 보여줄지(공통 기준 showSettlementCard). 최종 금액 등록 전에는 숨기고 예약 세부 정보에서 결제 기록만 보여준다 */
export const settlementVisible = (d: BookingDetail): boolean =>
  showSettlementCard({ cancelled: d.booking.status === 'cancelled', hasStatement: !!d.statement, moneyRecords: d.ledger.length });

type Won = number;
const won = (a: Amount, missing = '확인 필요') => (a === null ? <span className="cost__missing">{missing}</span> : <span className="money">{a < 0 ? `−${formatWon(-a)}` : formatWon(a)}</span>);
const minus = (a: Won) => <span className="money"><span aria-hidden>−</span><span className="sr-only">차감 </span>{formatWon(a)}</span>;

function Row({ k, v, hint, strong, sub }: { k: string; v: React.ReactNode; hint?: React.ReactNode; strong?: boolean; sub?: boolean }) {
  return (
    <div className={`cost__row${strong ? ' cost__row--strong' : ''}${sub ? ' cost__row--sub' : ''}`}>
      <dt className="cost__k">{k}{hint && <span className="cost__hint">{hint}</span>}</dt>
      <dd className="cost__v">{v}</dd>
    </div>
  );
}

const STAGE_BADGE: Record<CostSummary['stage'], { label: string }> = {
  estimate: { label: '예상 금액' },
  final_awaiting: { label: '최종 정산' },
  final_disputed: { label: '금액 협의 중' },
  settled: { label: '정산 완료' },
  cancelled: { label: '취소됨' },
};

/** 취소 환불(정산 차액 환불 제외)의 실제 처리 상태 */
const cancelRefunds = (d: BookingDetail): Refund[] => d.ledger.flatMap((l) => (l.kind === 'refund' && l.refund.purpose !== 'settlement' ? [l.refund] : []));

/**
 * 예약 상세 ‘금액·정산’ 카드(spec 5.2·5.13). 최종 금액 확인·정산을 이 카드 안에서 한다(별도 최종 금액 확인 화면 없음).
 * - 기본 화면: 지금 처리할 차액 하나만 크게(최종 수리 총금액 − 정산에 사용 가능한 선결제 잔액). 양수 = 결제할 금액, 음수 = 환불 예정 금액(절댓값), 0 = 추가 결제 없음.
 *   최종 금액이 아직 없으면 예상 금액·확인 필요로 구분하고 0원으로 대신하지 않는다.
 * - [금액 상세]: 수리비(작업비 + 부품·자재비 …) · 내 출장비(+ 공동 예약 절약) · 최종 총금액 · 결제한 예약금(·자재비 등, 이번 정산에 실제 차감되는 금액) · 결과.
 *   별도 [결제 내역] 펼치기는 두지 않는다(결제·환불 기록은 결제 내역 화면에서 본다, spec 5.26).
 * - 확인 필요 상태에서만 확인 체크 + [결제하기 / 정산 완료하기 / 환불 진행하기] + [금액이 달라요]. 기존 정산·이견 함수(confirmSettlement·reportDispute)를 그대로 쓴다.
 */
export function BookingCostCard({ d }: { d: BookingDetail }) {
  const repo = useRepo();
  const c = costOf(d);
  const b = d.booking;
  const st = STAGE_BADGE[c.stage];
  // 최종 내역이 있으면 기존 최종 정산 조회(진행 중 결제·정산 환불 포함)를 그대로 쓴다
  const sv = useAsync(() => (d.statement ? repo.getFinalStatement(b.id) : Promise.resolve(null)), [repo, b.id, d.statement?.status, d.statement?.version]);
  const view = sv.data ?? null;
  const refunds = cancelRefunds(d);

  const hero = (() => {
    const kind = c.balance.kind;
    if (c.stage === 'cancelled') {
      return { kind: c.balance.amount ? 'refund' : 'zero', label: c.balance.amount ? '취소 환불 금액' : '취소 환불', value: c.balance.amount ? formatWon(c.balance.amount) : '환불 없음' };
    }
    if (kind === 'unknown') return { kind, label: c.balance.label, value: '금액 확인 필요' };
    return { kind, label: c.balance.label, value: formatWon(c.balance.amount ?? 0) };
  })();

  // E. 최종 금액 확인 대기: 상단 확인 영역에서 공통 행동 카드 머리(연한 블루 · ‘확인이 필요해요’)와 구체 제목을 붙인다.
  // 협의로 금액이 수정돼 다시 확인할 때(내역 버전 2 이상)는 ‘수정된 최종 금액’. 잔금 결제 결과 확인 중이면 기다리는 상태로.
  const attn = c.stage === 'final_awaiting';
  const balanceInFlight = d.ledger.some((l) => l.kind === 'payment' && l.tx.kind === 'balance' && (l.tx.status === 'processing' || l.tx.status === 'unknown'));
  const attnTitle = (d.statement?.version ?? 1) > 1 ? '수정된 최종 금액을 다시 확인해 주세요' : '최종 금액을 확인해 주세요';
  return (
    // 확인 대기가 아니면 카드 제목은 바깥 섹션 제목(‘금액·정산’), 상태는 예약 정보의 ‘진행 상태’와 겹치지 않게 차액 라벨·안내로만 보여준다
    <div className={`card stack cost${attn ? ' cost--attn' : ''}`} id="settlement" tabIndex={-1} role="region" aria-label={attn ? attnTitle : `금액·정산 · ${st.label}`}>
      {attn && <p className="act-card__head cost__head"><Icon name="info" size={16} />{balanceInFlight ? '결제 결과를 확인하고 있어요' : '확인이 필요해요'}</p>}
      {attn && <h2 className="act-card__title">{attnTitle}</h2>}

      <div className={`cost__balance cost__balance--${hero.kind}`}>
        <span className="cost__balance-k">{hero.label}</span>
        <span className="cost__balance-v">{hero.value}</span>
      </div>
      <StageNote d={d} c={c} view={view} refunds={refunds} />

      {c.stage === 'final_awaiting' && view && <ConfirmBox d={d} c={c} view={view} />}
      {c.stage === 'final_disputed' && <PhoneButton phone={d.provider.phone} name={d.provider.name} />}

      <div className="cost__more">
        <AmountDetail d={d} c={c} />
      </div>
    </div>
  );
}

/** 단계별 짧은 안내(실제 상태와 같은 문구) */
function StageNote({ d, c, view, refunds }: { d: BookingDetail; c: CostSummary; view: StatementView | null; refunds: Refund[] }) {
  switch (c.stage) {
    case 'estimate':
      return (
        <p className="small muted">
          {c.balance.kind === 'unknown' ? '산정되지 않은 항목이 있어 아직 계산하지 않았어요. ' : '승인 견적 기준 예상 금액이에요. '}
          작업이 끝나면 업체가 최종 금액을 등록하고, 여기서 확인해요. 지금 결제·환불되지 않아요.
        </p>
      );
    case 'final_awaiting':
      return (
        <p className="small muted">
          업체가 제시한 최종 금액 기준이에요. 확인하기 전에는 결제·환불되지 않아요.{c.balance.kind === 'refund' ? ' 확인 후 환불이 진행돼요.' : ''}
        </p>
      );
    case 'final_disputed':
      return <Banner tone="warn" title="금액을 협의하고 있어요">업체와 합의하기 전에는 청구되거나 확정되지 않아요. 합의 내용으로 금액이 바뀌면 다시 확인해요.</Banner>;
    case 'settled': {
      const kind = d.statement?.settledKind;
      const rf = view?.refund;
      return (
        <p className="small muted">
          {kind === 'pay' ? '최종 잔금 결제로 정산이 끝났어요.' : kind === 'refund'
            ? <>정산이 끝났어요.{rf && <> 환불: <strong>{REFUND_STATUS[rf.status].label}</strong> ({formatDate(rf.requestedAt.slice(0, 10))})</>}</>
            : '추가 결제·환불 없이 정산이 끝났어요.'}
        </p>
      );
    }
    case 'cancelled':
      return refunds.length ? (
        <ul className="stack--sm stack">
          {refunds.map((r) => <li key={r.id} className="small">환불 {formatWon(r.amount)} · <strong>{REFUND_STATUS[r.status].label}</strong> · {formatDate(r.requestedAt.slice(0, 10))}<span className="xs muted" style={{ display: 'block' }}>{r.reason}</span></li>)}
        </ul>
      ) : <p className="small muted">환불할 선결제가 없어요.</p>;
  }
}

/** 최종 금액 확인 체크 + 정산 버튼(카드 안 일반 흐름) + 금액이 달라요 */
function ConfirmBox({ d, c, view }: { d: BookingDetail; c: CostSummary; view: StatementView }) {
  const repo = useRepo();
  const nav = useNavigate();
  const action = useAction();
  const key = useAttemptKey('fin');
  const [consented, setConsented] = useState<string | null>(null);
  const [dlg, setDlg] = useState(false);
  const { statement: st, settlement: s } = view;
  const stamp = `${st.version}:${s.delta}`;
  const ok = consented === stamp; // 금액·버전이 바뀌면 확인이 초기화된다
  const inflight = view.inFlightPayment;
  const done = st.actualWork.filter((w) => w.done).length;
  // 마지막 잔금 결제가 실패했으면 알리고 다시 결제할 수 있게 한다(진행 중이 아니면 버튼은 그대로)
  const lastBalance = d.ledger.filter((l) => l.kind === 'payment' && l.tx.kind === 'balance').at(-1);
  const failed = !inflight && lastBalance?.kind === 'payment' && lastBalance.tx.status === 'failed';
  const confirm = () => void action.run(async () => {
    const r = await repo.confirmSettlement({ bookingId: d.booking.id, statementVersion: st.version, idempotencyKey: key.get() });
    if (r.tx) nav(`/pay/${r.tx.id}`); // 잔금 결제는 기존 결제 결과 화면에서 성공·실패·확인 중을 확인한다
  });
  const label = s.kind === 'pay' ? `${formatWon(s.amount)} 결제하기` : s.kind === 'zero' ? '확인하고 정산 완료하기' : '확인하고 환불 진행하기';
  return (
    <div className="stack cost__confirm">
      <p className="small">
        실제 작업 {st.actualWork.length}건 중 {done}건 완료 · <a href="#work">작업 내용 확인하기</a>
      </p>
      {failed && <Banner tone="danger" title="잔금 결제가 완료되지 않았어요">청구되지 않았어요. 내용을 확인하고 다시 결제할 수 있어요.</Banner>}
      {inflight && (
        <Banner tone="warn" title={PAYMENT_STATUS[inflight.status].label}>결제 결과를 확인 중이라 다시 결제할 수 없어요. <Link to={`/pay/${inflight.id}`}>결제 결과 확인하기</Link></Banner>
      )}
      <label className="check card"><input type="checkbox" checked={ok} onChange={(e) => setConsented(e.target.checked ? stamp : null)} /><span>실제 작업 내용과 최종 금액을 확인했어요.</span></label>
      {action.error && <Banner tone="danger" title={action.error.title}>{action.error.hint} 다시 시도할 수 있어요.</Banner>}
      <div className="stack--sm stack">
        <Button variant="primary" block disabled={!ok || !!inflight} busy={action.busy} onClick={confirm}>{label}</Button>
        <Button variant="secondary" block onClick={() => setDlg(true)}>금액이 달라요</Button>
      </div>
      <p className="xs muted">{s.kind === 'pay' ? '모의 결제예요. 실제로 청구되지 않아요.' : s.kind === 'refund' ? '모의 환불이에요. 확인하면 환불 처리가 요청되고 실제 입금되지 않아요.' : '추가 결제 없이 정산을 마쳐요.'}</p>
      {dlg && (
        <Dialog title="금액이 다른가요?" onClose={() => setDlg(false)}
          actions={<>
            <Button variant="primary" block busy={action.busy} onClick={() => void action.run(async () => { await repo.reportDispute(d.booking.id); setDlg(false); })}>이견 접수하고 정산 보류하기</Button>
            <Button block onClick={() => setDlg(false)}>돌아가기</Button>
          </>}>
          <p>이견을 접수하면 업체와 합의하기 전까지 금액이 확정되거나 자동으로 청구되지 않아요.</p>
          <p className="small muted">싸고는 누가 옳은지 판단하지 않아요. 먼저 {d.provider.name}에 전화로 확인해 보세요.</p>
          <PhoneButton phone={d.provider.phone} name={d.provider.name} />
          {action.error && <Banner tone="danger" title={action.error.title}>{action.error.hint}</Banner>}
        </Dialog>
      )}
      {c.discountNote && <p className="xs muted">업체 할인 조건: {c.discountNote}</p>}
    </div>
  );
}

/** [금액 상세] 수리비 · 내 출장비(+ 절약) · 최종 총금액 · 결제한 예약금 등 차감 · 결과(한 번씩만, 중첩 펼치기 없음) */
function AmountDetail({ d, c }: { d: BookingDetail; c: CostSummary }) {
  const tf = d.tripFee;
  const est = c.stage === 'estimate';
  // 절약 = 기본 출장비(그룹 총 출장비) − 이 행의 내 출장비. 일반 예약·유지값·0원 이하이면 숨긴다(예약 상세 공동 예약 정보와 같은 기준)
  const share = tripShareView({ ...tf, amount: c.trip.amount }, formatWon);
  const savingLine = share.saving === null ? null
    : tf.kind === 'expected' ? `공동 예약으로 출장비 약 ${formatWon(share.saving)} 절약 예상` : `공동 예약으로 출장비 ${formatWon(share.saving)} 절약`;
  const applied = appliedPrepaidLines(c);
  return (
    <details className="disclosure">
      <summary>금액 상세<Icon name="chevron" size={16} /></summary>
      {c.stage === 'cancelled' ? (
        <dl className="cost__list">
          <Row k="결제한 금액" v={<span className="money">{formatWon(c.paidIn)}</span>} hint={c.payments.map((p) => `${p.label.replace('결제한 ', '')} ${formatWon(p.amount)}`).join(' · ') || undefined} />
          {c.used.deducted > 0 && <Row k="공제·충당된 금액" v={minus(c.used.deducted)} />}
          <Row k="취소 환불 금액" v={<span className="money">{formatWon(c.used.refunded)}</span>} strong />
        </dl>
      ) : (
        <>
          <dl className="cost__list">
            <Row k={est ? '예상 수리비' : '수리비'} v={won(c.repair)} hint={est ? '작업비 + 부품·자재비(동의한 자재·추가 작업 포함)' : '작업비 + 부품·자재비'} />
            {c.repairLines.map((l) => <Row key={l.key} k={l.label} v={won(l.amount, l.hint ?? '확인 필요')} sub />)}
            <Row k={est ? c.trip.label : '내 출장비'} v={won(c.trip.amount)}
              hint={savingLine ? <span className="cost__saving"><span aria-hidden>↳ </span>{savingLine}</span> : tf.kind === 'locked' ? '일정 변경 때 기존 확정 출장비를 그대로 유지했어요' : undefined} />
          </dl>
          <dl className="cost__list">
            <Row k={est ? '예상 총금액' : '최종 총금액'} v={won(c.total?.amount ?? null, '아직 산정되지 않았어요')} strong />
            {/* 이번 정산에 실제로 차감되는 선결제(합계 = 정산 잔액). 이미 공제·환불된 금액은 빼고 보여준다 */}
            {applied.map((l) => <Row key={l.key} k={l.label} v={minus(l.amount)} hint={l.excluded > 0 ? `${formatWon(l.amount + l.excluded)} 중 이미 공제·환불된 ${formatWon(l.excluded)}은 빼고 차감해요` : undefined} />)}
            <Row k={c.balance.label} v={c.balance.amount === null ? <span className="cost__missing">확인 필요</span> : <span className="money">{formatWon(c.balance.amount)}</span>} strong />
          </dl>
          {c.discountNote && est && <p className="small muted">업체 할인 조건({c.discountNote})은 금액이 정해지지 않아 예상 총금액에 넣지 않았어요.</p>}
          {tf.kind === 'confirmed' && tf.households !== null && tf.currentHouseholds < tf.households && (
            <p className="small muted">마감 후 취소한 세대가 있어 지금 참여 세대는 {tf.currentHouseholds}세대예요. 확정 출장비는 마감 시 {tf.households}세대 기준 그대로예요.</p>
          )}
        </>
      )}
    </details>
  );
}
