import { Link } from 'react-router-dom';
import { formatDate } from '../../domain/time';
import { formatWon } from '../../domain/money';
import { tripFeeSavings } from '../../domain/pricing';
import { TRIP_LABEL, summarizeBookingCost, type Amount, type CostSummary } from '../../domain/bookingCost';
import { Icon } from '../../components/Icon';
import { Badge } from '../../components/ui';
import type { BookingDetail } from '../../data/repositories/types';
import { PAYMENT_STATUS, REFUND_STATUS, TX_KIND_LABEL } from '../shared';

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

const won = (a: Amount, missing = '확인 필요') => (a === null ? <span className="cost__missing">{missing}</span> : <span className="money">{formatWon(a)}</span>);
const minus = (a: Won) => <span className="money"><span aria-hidden>−</span><span className="sr-only">차감 </span>{formatWon(a)}</span>;
type Won = number;

function Row({ k, v, hint, strong }: { k: string; v: React.ReactNode; hint?: string; strong?: boolean }) {
  return (
    <div className={`cost__row${strong ? ' cost__row--strong' : ''}`}>
      <dt className="cost__k">{k}{hint && <span className="cost__hint">{hint}</span>}</dt>
      <dd className="cost__v">{v}</dd>
    </div>
  );
}

const STAGE_BADGE: Record<CostSummary['stage'], { label: string; tone: 'info' | 'action' | 'warn' | 'success' | 'neutral' }> = {
  estimate: { label: '예상 금액', tone: 'info' },
  final_awaiting: { label: '최종 내역 확인 필요', tone: 'action' },
  final_disputed: { label: '금액 협의 중', tone: 'warn' },
  settled: { label: '정산 완료', tone: 'success' },
  cancelled: { label: '취소됨', tone: 'neutral' },
};

/**
 * ‘예약 금액·결제’ 통합 카드. 총비용 → 결제한 금액 → 앞으로 낼(받을) 금액 순서.
 * 표시만 하며 결제·환불은 최종 정산 화면(/bookings/:id/final)에서만 일어난다.
 */
export function BookingCostCard({ d }: { d: BookingDetail }) {
  const c = costOf(d);
  const b = d.booking;
  const usedSome = c.used.deducted > 0 || c.used.refunded > 0;
  const cancelled = c.stage === 'cancelled';
  const usedHint = cancelled ? undefined : '정산에 다시 쓰지 않아요';
  const st = STAGE_BADGE[c.stage];
  return (
    <div className="card stack cost">
      <div className="row row--between row--wrap">
        <Badge tone={st.tone}>{st.label}</Badge>
        {d.statement && <Link to={`/bookings/${b.id}/final`} className="small">최종 내역 보기</Link>}
      </div>

      {c.lines.length > 0 && (
        <dl className="cost__list">
          {c.lines.map((l) => <Row key={l.key} k={l.label} v={won(l.amount)} hint={l.hint} />)}
          {c.discountNote && <Row k="업체 할인 조건" v={<span className="cost__missing">최종 정산에서 반영</span>} hint={c.discountNote} />}
        </dl>
      )}
      {c.total && (
        <dl className="cost__list cost__list--total">
          <Row k={c.total.label} v={won(c.total.amount, '아직 산정되지 않았어요')} strong />
        </dl>
      )}

      <dl className="cost__list">
        {usedSome ? (
          <>
            <Row k="결제한 금액" v={<span className="money">{formatWon(c.paidIn)}</span>} hint={c.payments.map((p) => `${p.label.replace('결제한 ', '')} ${formatWon(p.amount)}`).join(' · ')} />
            {c.used.deducted > 0 && <Row k="이미 공제·충당된 금액" v={<span className="money">{formatWon(c.used.deducted)}</span>} hint={usedHint} />}
            {/* 취소 예약은 아래 ‘취소 환불 요청 금액’으로 한 번만 보여준다 */}
            {c.used.refunded > 0 && !cancelled && <Row k="이미 환불 요청한 금액" v={<span className="money">{formatWon(c.used.refunded)}</span>} hint={usedHint} />}
            {c.stage !== 'cancelled' && <Row k="현재 정산에 반영되는 금액" v={minus(c.available)} />}
          </>
        ) : c.payments.length > 0 ? (
          c.payments.map((p) => <Row key={p.key} k={p.label} v={minus(p.amount)} />)
        ) : (
          <Row k="결제한 금액" v={<span className="money">{formatWon(0)}</span>} />
        )}
      </dl>

      <div className={`cost__balance cost__balance--${c.balance.kind}`}>
        <span className="cost__balance-k">{c.balance.label}</span>
        <span className="cost__balance-v">{c.balance.amount === null ? '아직 산정되지 않았어요' : formatWon(c.balance.amount)}</span>
      </div>
      {c.stage === 'estimate' && c.balance.kind === 'unknown' && (
        <p className="small muted">산정되지 않은 항목이 있어 총금액과 추가 결제액을 계산하지 않았어요. 업체가 금액을 정하면 다시 보여드려요.</p>
      )}
      {c.discountNote && c.stage === 'estimate' && <p className="small muted">업체 할인은 금액이 정해지지 않아 예상 총금액에 넣지 않았어요.</p>}
      <p className="small muted">{c.note}{c.stage === 'estimate' ? ' 지금 결제하거나 환불되지 않아요.' : ''}</p>

      <div className="cost__more">
        {c.stage !== 'cancelled' && <TripFeeDetail d={d} />}
        <PaymentHistory d={d} available={c.available} />
      </div>
    </div>
  );
}

function TripFeeDetail({ d }: { d: BookingDetail }) {
  const tf = d.tripFee;
  const sv = tf.groupTotal !== null && tf.households ? tripFeeSavings(tf.groupTotal, tf.households) : null;
  return (
    <details className="disclosure">
      <summary>출장비 계산 상세<Icon name="chevron" size={16} /></summary>
      <dl className="cost__list">
        <Row k="그룹 총 출장비" v={tf.groupTotal === null ? <span className="cost__missing">변경 전 그룹 기준</span> : <span className="money">{formatWon(tf.groupTotal)}</span>} />
        <Row k={tf.kind === 'expected' ? '분담 기준 세대 수(현재 확정)' : tf.kind === 'confirmed' ? '분담 기준 세대 수(마감 시 확정)' : '분담 기준 세대 수'}
          v={tf.households === null ? <span className="cost__missing">{tf.kind === 'locked' ? '변경 전 그룹 기준' : '확인 필요'}</span> : `${tf.households}세대`} />
        <Row k={TRIP_LABEL[tf.kind]} v={won(tf.amount)} />
        {sv && <Row k="단독 방문 대비 절감액" v={<span className="money">{formatWon(sv.amount)} ({sv.percent}%)</span>} />}
      </dl>
      {tf.kind === 'expected' && <p className="small muted">마감 전이라 확정 세대 수에 따라 바뀔 수 있어요. 마감 때 확정돼요.</p>}
      {tf.kind === 'confirmed' && tf.households !== null && tf.currentHouseholds < tf.households && (
        <p className="small muted">마감 후 취소한 세대가 있어 지금 참여 세대는 {tf.currentHouseholds}세대예요. 확정 출장비는 마감 시 {tf.households}세대 기준 그대로이고 다시 계산하지 않아요.</p>
      )}
      {tf.kind === 'locked' && <p className="small muted">일정 변경을 수락하면서 기존 확정 출장비를 그대로 유지하기로 했어요.</p>}
      <p className="small muted">절감액은 할인이 아니라 같은 날 이웃과 출장비를 나눠 생기는 차이예요.</p>
    </details>
  );
}

function PaymentHistory({ d, available }: { d: BookingDetail; available: Won }) {
  const refunds = d.ledger.some((l) => l.kind === 'refund');
  return (
    <details className="disclosure">
      <summary>결제 내역 보기<Icon name="chevron" size={16} /></summary>
      {d.ledger.length === 0 ? <p className="small muted">아직 결제 내역이 없어요.</p> : (
        <ul className="divided">
          {d.ledger.map((l) => (
            <li key={l.id}>
              <Link to={`/ledger/${l.id}`} className="list-row" style={{ padding: 'var(--sp-3) 0' }}>
                <div className="list-row__main">
                  <span className="list-row__title">{l.kind === 'payment' ? TX_KIND_LABEL[l.tx.kind] : l.kind === 'refund' ? '환불' : `공제 · ${l.deduction.label}`}</span>
                  <span className="small muted">{l.kind === 'payment' ? PAYMENT_STATUS[l.tx.status].label : l.kind === 'refund' ? REFUND_STATUS[l.refund.status].label : '선결제에서 충당'} · {formatDate(l.at.slice(0, 10))}</span>
                </div>
                <span className="money small strong">{l.kind === 'payment' ? formatWon(l.tx.amount) : <>{minus(l.kind === 'refund' ? l.refund.amount : l.deduction.amount)}</>}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <dl className="cost__list"><Row k="정산에 사용 가능한 잔액" v={<span className="money strong">{formatWon(available)}</span>} /></dl>
      {refunds && <p className="small muted">환불은 ‘처리 요청’과 카드·계좌에 실제 반영되는 시점이 달라요.</p>}
    </details>
  );
}
