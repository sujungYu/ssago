import { Link, useParams } from 'react-router-dom';
import { Page } from '../../app/Page';
import { useRepo } from '../../app/context';
import { useAsync } from '../../app/hooks';
import { formatDate, formatDateTime } from '../../domain/time';
import { formatWon } from '../../domain/money';
import { tripFeeSavings } from '../../domain/pricing';
import { Icon } from '../../components/Icon';
import { AsyncView, Badge, Banner, KV, LinkButton, PhoneButton, Section } from '../../components/ui';
import type { BookingDetail } from '../../data/repositories/types';
import { PAYMENT_STATUS, REFUND_STATUS, TX_KIND_LABEL, VisitText, bookingBadge, slotsText } from '../shared';
import { DURATION_NOTE, formatVisit } from '../../domain/visitTime';
import { visitLabel } from './BookingsPage';

function ActionRow({ to, title, desc, tone = 'action' }: { to: string; title: string; desc?: string; tone?: 'action' | 'warn' }) {
  return (
    <Link to={to} className="list-row" style={{ background: tone === 'warn' ? 'var(--c-warn-bg)' : 'var(--c-info-bg)' }}>
      <Icon name={tone === 'warn' ? 'clock' : 'info'} />
      <div className="list-row__main"><span className="list-row__title">{title}</span>{desc && <span className="small muted">{desc}</span>}</div>
      <Icon name="chevron" size={18} />
    </Link>
  );
}

function Attention({ d }: { d: BookingDetail }) {
  const b = d.booking;
  const rows: React.ReactNode[] = [];
  if (b.status === 'confirmed') {
    if (d.delay) rows.push(<ActionRow key="dl" tone="warn" to={`/delays/${d.delay.id}`} title="방문이 지연되고 있어요" desc="기다리기, 무료 변경, 무료 취소 중에서 선택해 주세요" />);
    for (const p of d.proposals.filter((x) => x.status === 'proposed')) rows.push(<ActionRow key={p.id} to={`/proposals/${p.id}`} title={p.origin === 'provider' ? '업체가 일정 변경을 제안했어요' : '업체가 변경에 동의했어요 · 최종 확인이 필요해요'} desc={`${formatVisit(p.oldVisit.date, p.oldVisit.time)} → ${formatVisit(p.newVisit.date, p.newVisit.time)}`} />);
    for (const p of d.proposals.filter((x) => x.status === 'requested')) rows.push(<ActionRow key={p.id} to={`/proposals/${p.id}`} title="변경 요청 · 업체 응답을 기다리고 있어요" desc="합의 전까지 기존 일정이 유지돼요" />);
    for (const m of d.materials.filter((x) => x.paymentStatus === 'none')) rows.push(<ActionRow key={m.id} to={`/materials/${m.id}`} title="자재 주문 조건을 확인해 주세요" desc={`${m.name} · ${formatWon(m.price)}`} />);
    for (const m of d.materials.filter((x) => x.paymentStatus === 'processing' || x.paymentStatus === 'unknown')) rows.push(<ActionRow key={m.id} tone="warn" to={`/materials/${m.id}`} title="자재비 결제 결과를 확인 중이에요" desc="다시 결제하지 말고 결과를 확인해 주세요" />);
    for (const w of d.additionalWorks.filter((x) => x.status === 'proposed')) rows.push(<ActionRow key={w.id} to={`/additional/${w.id}`} title="추가 작업 동의가 필요해요" desc={`${w.scope} · ${formatWon(w.amount)}`} />);
    if (d.statement?.status === 'awaiting_customer') rows.push(<ActionRow key="st" to={`/bookings/${b.id}/final`} title="최종 금액을 확인해 주세요" desc="실제 작업 내용과 정산 금액을 확인해요" />);
    if (d.statement?.status === 'disputed') rows.push(<ActionRow key="sd" tone="warn" to={`/bookings/${b.id}/final`} title="금액을 협의하고 있어요" desc="합의 전에는 청구되거나 확정되지 않아요" />);
    if (d.statement?.status === 'settled' && !d.review) rows.push(<ActionRow key="rv" to={`/bookings/${b.id}/review`} title="이용 후기를 남길 수 있어요" />);
  }
  if (!rows.length) return null;
  return <Section title="지금 확인할 내용"><ul className="card card--flush divided">{rows.map((r, i) => <li key={i}>{r}</li>)}</ul></Section>;
}

function Body({ d }: { d: BookingDetail }) {
  const b = d.booking;
  const cancelled = b.status === 'cancelled';
  const refunds = d.ledger.filter((l) => l.kind === 'refund');
  const tf = d.tripFee;
  const sv = tf.amount !== null && tf.households > 0 ? tripFeeSavings(d.group.totalTripFee, tf.households) : null;
  const openProposal = d.proposals.some((p) => p.status === 'requested' || p.status === 'proposed');
  const canChange = b.status === 'confirmed' && b.workStatus === 'scheduled' && !openProposal;
  const canCancel = b.status === 'confirmed' && b.workStatus === 'scheduled';
  const delayed = !!d.delay;
  return (
    <>
      <div className="stack--sm stack">
        <div className="row row--between row--wrap">
          <h2 style={{ fontSize: 'var(--fs-xl)' }}>{d.provider.name}</h2>
          {bookingBadge(b)}
        </div>
        <p className="muted small">{b.tasks.map((t) => t.title).join(' · ')}</p>
      </div>

      {cancelled && (
        <Banner tone="info" title="취소된 예약이에요">
          {b.cancelCause === 'provider' ? '업체 사유 취소라 공제 없이 해당 선결제가 전액 환불 대상이에요.' : b.cancelCause === 'policy_free' ? '정책상 무료 취소가 적용됐어요.' : '고객 사유로 취소됐어요.'}
        </Banner>
      )}
      {d.freeCancel && <Banner tone="warn" title="무료 변경·취소가 적용돼요">{d.freeCancel.reason}</Banner>}

      <Attention d={d} />

      <Section title="방문 일정·진행">
        <div className="card stack">
          <KV rows={[
            { k: visitLabel(b), v: <span><VisitText date={b.visitDate} time={b.visitTime} strong />{delayed && <> <Badge tone="warn">지연 안내</Badge></>}</span> },
            // 지연 안내의 변경 도착 예상은 예약 방문 시각을 덮어쓰지 않고 따로 보여준다
            ...(d.delay ? [{ k: '변경 도착 예상', v: <span className="nowrap">{formatDateTime(d.delay.newEta)}</span> }] : []),
            // 변경 제안은 고객이 수락하기 전까지 예약에 반영하지 않고 따로 보여준다
            ...d.proposals.filter((p) => p.status === 'proposed' && p.newVisit.time).map((p) => (
              { key: p.id, k: '변경 제안 · 확인 대기', v: <span><VisitText date={p.newVisit.date} time={p.newVisit.time} /><br /><span className="xs muted">수락하기 전까지 위 방문 일정이 유지돼요</span></span> }
            )),
            ...(b.customerSlots.length ? [{ k: '요청 시 고객 가능 시간', v: <span className="muted">{slotsText(b.customerSlots)}</span> }] : []),
            { k: '진행 상태', v: bookingBadge(b) },
            ...(b.followUp ? [{ k: '후속 방문', v: <span>{formatDate(b.followUp.date)}<br />{b.followUp.window}</span> }] : []),
          ]} />
          {b.followUp && <p className="small muted">{b.followUp.note}</p>}
          <p className="xs muted">방문 시각은 업체의 도착 예정 시각이에요. {DURATION_NOTE}</p>
          {(b.scheduleChanges ?? []).length > 0 && (
            <div className="stack--sm stack">
              <h3 className="small">일정 변경 기록</h3>
              <ul className="stack--sm stack">
                {(b.scheduleChanges ?? []).map((c) => (
                  <li key={c.proposalId} className="small">
                    <span className="nowrap">{formatVisit(c.from.date, c.from.time)}</span> → <span className="nowrap strong">{formatVisit(c.to.date, c.to.time)}</span>
                    <br /><span className="xs muted">사유: {c.reason} · 고객 동의 {formatDateTime(c.consentedAt)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <PhoneButton phone={d.provider.phone} name={d.provider.name} />
        </div>
      </Section>

      {!cancelled && (
        <Section title="공동 예약">
          <div className="card stack">
            <KV rows={[
              { k: '접수 마감', v: <span className="nowrap">{formatDateTime(d.group.closeAt)}</span> },
              { k: '확정 세대', v: `${d.group.confirmedHouseholds}세대` },
              { k: '그룹 총 출장비', v: <span className="money">{formatWon(d.group.totalTripFee)}</span> },
              { k: tf.kind === 'expected' ? '내 예상 출장비' : tf.kind === 'locked' ? '유지되는 내 확정 출장비' : '내 확정 출장비', v: tf.amount === null ? '확정 세대 없음' : <span className="money strong">{formatWon(tf.amount)}</span> },
            ]} />
            {tf.kind === 'expected' && <p className="xs muted">마감 전이라 확정 세대 수에 따라 바뀔 수 있어요. 마감 때 확정돼요.</p>}
            {sv && <p className="xs muted">혼자 방문할 때(그룹 총액 기준)보다 {formatWon(sv.amount)}({sv.percent}%) 덜 내는 계산이에요.</p>}
            {d.groupEnded && <Banner tone="warn" title="이 공동 예약은 종료됐어요" />}
            <p className="xs muted">다른 세대의 주소·작업·사진은 보이지 않아요.</p>
          </div>
        </Section>
      )}

      <Section title="내 작업·방문 주소">
        <div className="card stack">
          {b.tasks.map((t) => <div key={t.id}><p className="strong">{t.title}</p>{t.description && <p className="small muted">{t.description}</p>}</div>)}
          <hr className="hr" />
          <p className="small">{d.address.line1}<br />{d.addressDetail}</p>
          <p className="xs muted">정확한 주소는 나와 이 업체만 볼 수 있어요.</p>
        </div>
      </Section>

      <Section title="금액·자재">
        <div className="card stack">
          <KV rows={[
            { k: '예약금 결제', v: <span className="money">{formatWon(d.prepaid.depositPaid)}</span> },
            ...(d.prepaid.materialPrepaid ? [{ k: '자재비 선결제', v: <span className="money">{formatWon(d.prepaid.materialPrepaid)}</span> }] : []),
            ...(d.prepaid.changePaid ? [{ k: '일정 변경 부족분 결제', v: <span className="money">{formatWon(d.prepaid.changePaid)}</span> }] : []),
            ...(d.prepaid.deducted ? [{ k: '공제·충당', v: <span className="money money--neg">−{formatWon(d.prepaid.deducted)}</span> }] : []),
            ...(d.prepaid.refunded ? [{ k: '환불 요청', v: <span className="money money--neg">−{formatWon(d.prepaid.refunded)}</span> }] : []),
            { k: cancelled ? '남은 선결제' : '최종 정산에 쓸 선결제', v: <span className="money strong">{formatWon(d.prepaid.available)}</span>, total: true },
          ]} />
          {d.approval && <p className="xs muted">업체 견적 {formatWon(d.approval.tasks.reduce((a, t) => a + (t.estimate ?? 0), 0))} · 부품·자재 예상 {formatWon(d.approval.partsEstimate)} (최종 금액이 아니에요)</p>}
          {d.materials.length > 0 && (
            <ul className="card card--flush divided" style={{ border: 0 }}>
              {d.materials.map((m) => (
                <li key={m.id}>
                  <Link to={`/materials/${m.id}`} className="list-row" style={{ padding: 'var(--sp-3) 0' }}>
                    <div className="list-row__main"><span className="list-row__title">{m.name}</span>
                      <span className="small muted">{formatWon(m.price)} · 결제 {m.paymentStatus === 'none' ? '전' : PAYMENT_STATUS[m.paymentStatus].label} · 주문 {m.orderStatus === 'ordered' ? '완료' : '전'}</span></div>
                    <Icon name="chevron" size={18} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {d.additionalWorks.length > 0 && (
            <ul className="stack--sm stack">
              {d.additionalWorks.map((w) => (
                <li key={w.id} className="row row--between">
                  <Link to={`/additional/${w.id}`}>추가 작업 · {w.scope}</Link>
                  <Badge tone={w.status === 'agreed' ? 'success' : w.status === 'declined' ? 'neutral' : 'action'}>{w.status === 'agreed' ? '동의함' : w.status === 'declined' ? '동의하지 않음' : '확인 필요'}</Badge>
                </li>
              ))}
            </ul>
          )}
          {d.statement && d.statement.status !== 'awaiting_customer' && (
            <p className="small"><Link to={`/bookings/${b.id}/final`}>최종 금액 보기</Link> · {d.statement.status === 'settled' ? '정산 완료' : '협의 중'}</p>
          )}
        </div>
      </Section>

      {(d.ledger.length > 0 || d.proposals.length > 0) && (
        <Section title="결제·변경 기록">
          <ul className="card card--flush divided">
            {d.ledger.map((l) => (
              <li key={l.id}>
                <Link to={`/ledger/${l.id}`} className="list-row">
                  <div className="list-row__main">
                    <span className="list-row__title">{l.kind === 'payment' ? TX_KIND_LABEL[l.tx.kind] : l.kind === 'refund' ? '환불' : '공제'}</span>
                    <span className="small muted">{l.kind === 'payment' ? PAYMENT_STATUS[l.tx.status].label : l.kind === 'refund' ? REFUND_STATUS[l.refund.status].label : l.subject} · {formatDate(l.at.slice(0, 10))}</span>
                  </div>
                  <span className="money small strong">{formatWon(l.kind === 'payment' ? l.tx.amount : l.kind === 'refund' ? l.refund.amount : l.deduction.amount)}</span>
                </Link>
              </li>
            ))}
            {d.proposals.map((p) => (
              <li key={p.id}>
                <Link to={`/proposals/${p.id}`} className="list-row">
                  <div className="list-row__main">
                    <span className="list-row__title">{p.origin === 'provider' ? '업체 변경 제안' : '내 변경 요청'}</span>
                    <span className="small muted">{formatDate(p.oldVisit.date)} → {formatDate(p.newVisit.date)}</span>
                  </div>
                  <Badge tone={p.status === 'accepted' ? 'success' : p.status === 'proposed' || p.status === 'requested' ? 'info' : 'neutral'}>
                    {({ requested: '응답 대기', proposed: '확인 필요', accepted: '수락됨', rejected: '거절됨', withdrawn: '철회됨' } as const)[p.status]}
                  </Badge>
                </Link>
              </li>
            ))}
          </ul>
          {refunds.length > 0 && <p className="xs muted">환불은 ‘처리 요청’과 카드·계좌에 실제 반영되는 시점이 달라요.</p>}
        </Section>
      )}

      {(canChange || canCancel || d.review || (d.statement?.status === 'settled' && !d.review)) && (
        <Section title="예약 관리">
          <div className="stack--sm stack">
            {canChange && <LinkButton to={`/bookings/${b.id}/change`} variant="secondary" block>날짜·시간 변경 요청</LinkButton>}
            {canCancel && <LinkButton to={`/bookings/${b.id}/cancel`} variant="danger" block>예약 취소하기</LinkButton>}
            {d.statement?.status === 'settled' && !d.review && <LinkButton to={`/bookings/${b.id}/review`} variant="primary" block>리뷰 작성하기</LinkButton>}
            {d.review && <div className="card stack--sm stack"><p className="strong">내가 쓴 리뷰 <span className="stars" aria-label={`${d.review.rating}점`}>{'★'.repeat(d.review.rating)}</span></p><p className="small">{d.review.body}</p></div>}
            {openProposal && !canChange && b.status === 'confirmed' && <p className="xs muted">진행 중인 변경 요청이 있어 새 변경은 할 수 없어요.</p>}
          </div>
        </Section>
      )}
    </>
  );
}

export function BookingDetailPage() {
  const { id = '' } = useParams();
  const repo = useRepo();
  const q = useAsync(() => repo.getBooking(id), [repo, id]);
  return (
    <Page title="예약 상세" back="/bookings">
      <AsyncView state={q}>{(d) => <Body d={d} />}</AsyncView>
    </Page>
  );
}
