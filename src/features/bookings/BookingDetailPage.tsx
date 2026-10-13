import { COMPARE_REQUESTS_ENABLED } from '../../domain/demoScope';
import { useEffect } from 'react';
import { Link, Navigate, useLocation, useParams } from 'react-router-dom';
import { Page } from '../../app/Page';
import { useRepo } from '../../app/context';
import { useAsync } from '../../app/hooks';
import { progressOfBooking } from '../../domain/progressStep';
import { ProgressSteps } from '../../components/ProgressSteps';
import { formatDate, formatDateTime } from '../../domain/time';
import { formatWon } from '../../domain/money';
import { Icon } from '../../components/Icon';
import { AsyncView, Badge, Banner, EmptyState, KV, LinkButton, LoadingBlock, PhoneButton, Section } from '../../components/ui';
import { AdditionalActionCard, DelayActionCard, MaterialActionCard } from './BookingActionCards';
import { TONE_BADGE } from '../../domain/statusDisplay';
import { ScheduleChangeCard } from './ScheduleChangeCard';
import type { BookingDetail } from '../../data/repositories/types';
import { ContactText, PAYMENT_STATUS, VisitAddressText, VisitText, bookingDisplayOfDetail, slotsText } from '../shared';
import { BookingCostCard, PaymentRecords, costOf, settlementVisible } from './BookingCostCard';
import { TRIP_LABEL } from '../../domain/bookingCost';
import { DURATION_NOTE, formatVisit } from '../../domain/visitTime';
import { visitLabel } from './BookingsPage';
import { bookingTabOf, listPath } from '../../domain/reservationTabs';

/**
 * 상단 확인 영역(spec 5.17): 진행 단계 바로 아래, 일반 정보보다 위. 확인 사항마다 공통 행동 카드 하나(숨기거나 합치지 않음).
 * 일정 변경(B) · 방문 지연 · 추가 작업(C) · 자재(D) · 최종 금액(E, 기존 금액·정산 카드를 이 자리로 올림). 기다리기만 하는 상태(결제 확인 중 등)는 카드를 만들지 않는다.
 */
function ActionCards({ d, costOnTop }: { d: BookingDetail; costOnTop: boolean }) {
  const b = d.booking;
  const live = b.status === 'confirmed';
  const cards = [
    <ScheduleChangeCard key="sch" d={d} />,
    live && d.delay ? <DelayActionCard key="dl" d={d} /> : null,
    ...(live ? d.additionalWorks.filter((w) => w.status === 'proposed').map((w) => <AdditionalActionCard key={w.id} w={w} />) : []),
    ...(live ? d.materials.filter((m) => m.paymentStatus === 'none').map((m) => <MaterialActionCard key={m.id} m={m} />) : []),
    costOnTop ? <BookingCostCard key="cost" d={d} /> : null,
  ];
  return <div className="act-cards">{cards}</div>;
}

/** 작업별 실제 상태: 업체가 등록한 최종 작업 내역이 있으면 그 완료 여부, 없으면 예약의 진행 상태 */
function taskState(d: BookingDetail, title: string): { label: string; tone: 'success' | 'warn' | 'info' | 'neutral' } | null {
  const w = d.statement?.actualWork.find((x) => x.title === title);
  if (w) return w.done ? { label: '완료', tone: 'success' } : { label: '미완료', tone: 'warn' };
  if (d.booking.status === 'cancelled') return null;
  return ({ scheduled: { label: '작업 전', tone: 'neutral' }, in_progress: { label: '작업 중', tone: 'info' }, followup_waiting: { label: '후속 작업 대기', tone: 'info' } } as const)[d.booking.workStatus as 'scheduled'] ?? null;
}

const PROPOSAL_STATUS = { requested: '업체 응답 대기', proposed: '확인 필요', accepted: '수락함', rejected: '거절함', withdrawn: '철회함' } as const;

function Body({ d }: { d: BookingDetail }) {
  const repo = useRepo();
  const b = d.booking;
  const cancelled = b.status === 'cancelled';
  const tf = d.tripFee;
  const sch = d.schedule;
  const history = b.scheduleChanges ?? [];
  const openProposal = d.proposals.some((p) => p.status === 'requested' || p.status === 'proposed');
  const canChange = b.status === 'confirmed' && b.workStatus === 'scheduled' && !openProposal && !sch.oldVisitUnavailable;
  const canCancel = b.status === 'confirmed' && b.workStatus === 'scheduled';
  const beforeVisit = b.status === 'confirmed' && b.workStatus === 'scheduled';
  // 업체 사유 무료 취소(기존 일정 방문 불가·업체 제안 등): 취소 버튼 근처에 짧게 안내
  const providerFreeCancel = canCancel && !!d.freeCancel && (sch.kind !== 'normal' || /업체/.test(d.freeCancel.reason));
  // 금액·정산 카드: 최종 금액 등록 후(확인·협의·처리 중·정산 완료)와 기록이 있는 취소 예약만(공통 기준). 그 전에는 숨기고 결제 기록은 예약 세부 정보에서
  const showCost = settlementVisible(d);
  const c = costOf(d);
  // E. 최종 금액 확인(협의로 수정된 금액 재확인 포함)이 필요하면 기존 금액·정산 카드를 상단 확인 영역으로 올린다(중복 카드 없음)
  const costOnTop = showCost && c.stage === 'final_awaiting';
  const disp = bookingDisplayOfDetail(d);
  // 요청 당시 내용(원본 기록 — 수정하거나 현재 작업으로 덮어쓰지 않는다)
  const origin = useAsync(() => (d.origin ? repo.getRequest(d.origin.requestId) : Promise.resolve(null)), [repo, d.origin?.requestId]);
  // 실제 작업 목록: 최종 내역이 있으면 업체가 등록한 실제 작업, 없으면 예약 작업
  const works = d.statement ? d.statement.actualWork.map((w) => ({ key: w.title, title: w.title, description: b.tasks.find((t) => t.title === w.title)?.description ?? '' }))
    : b.tasks.map((t) => ({ key: t.id, title: t.title, description: t.description }));
  const extraWorks = d.statement ? b.tasks.filter((t) => !d.statement!.actualWork.some((w) => w.title === t.title)) : [];
  // 완료된(응답이 끝난) 제안·요청 기록(응답 버튼 없이 ‘일정 변경 내역’에서만)
  const doneProposals = d.proposals.filter((p) => !(p.status === 'requested' || p.status === 'proposed'));

  return (
    <>
      {cancelled && (
        <Banner tone="info" title="취소된 예약이에요">
          {b.cancelCause === 'provider' ? '업체 사유 취소라 공제 없이 해당 선결제가 전액 환불 대상이에요.' : b.cancelCause === 'policy_free' ? '정책상 무료 취소가 적용됐어요.' : '고객 사유로 취소됐어요.'}
        </Banner>
      )}
      {/* 일정 변경과 무관한 무료 변경·취소 사유(지연·자재 납기 등)만 상단에. 일정 변경 사유는 아래 변경 카드·취소 버튼 근처에서 */}
      {d.freeCancel && sch.kind === 'normal' && !providerFreeCancel && <Banner tone="warn" title="무료 변경·취소가 적용돼요">{d.freeCancel.reason}</Banner>}

      <ActionCards d={d} costOnTop={costOnTop} />

      {/* 예약 정보(통합): 업체·전화 / 작업·상태 / 방문 일정 / 주소·연락처 / 공동 예약 / 세부 정보·변경 내역·요청 당시 내용 */}
      <Section title="예약 정보">
        <div className="card stack booking-info">
          <div className="row row--between row--wrap" style={{ gap: 'var(--sp-2)' }}>
            <p className="strong" style={{ fontSize: 'var(--fs-lg)' }}>{d.provider.name}</p>
            <PhoneButton phone={d.provider.phone} name={d.provider.name} />
          </div>
          <hr className="hr" />

          <div className="stack" id="work" tabIndex={-1}>
            <ul className="stack">
              {works.map((w) => {
                const s = taskState(d, w.title);
                return (
                  <li key={w.key} className="stack--sm stack">
                    <div className="row row--between row--top" style={{ gap: 'var(--sp-2)' }}>
                      <p className="strong work-title">{w.title}</p>
                      {s && <Badge tone={s.tone}>{s.label}</Badge>}
                    </div>
                    {w.description && <p className="small muted">{w.description}</p>}
                  </li>
                );
              })}
              {extraWorks.map((t) => <li key={t.id} className="small muted">{t.title} · 업체 작업 내역에 없음</li>)}
            </ul>
            {(d.materials.length > 0 || d.additionalWorks.length > 0) && (
              <ul className="card card--flush divided">
                {d.materials.map((m) => (
                  <li key={m.id}>
                    <Link to={`/materials/${m.id}`} className="list-row">
                      <div className="list-row__main">
                        <span className="list-row__title">자재 · {m.name}</span>
                        <span className="small muted">{m.spec} · {m.quantity}개 · 납기 {formatDate(m.deliveryDate)}</span>
                        <span className="small muted">결제 {m.paymentStatus === 'none' ? '전' : PAYMENT_STATUS[m.paymentStatus].label} · 주문 {m.orderStatus === 'ordered' ? '완료' : '전'}</span>
                      </div>
                      {m.paymentStatus === 'none' ? <Badge tone="neutral">응답 전</Badge> : <Icon name="chevron" size={18} />}
                    </Link>
                  </li>
                ))}
                {d.additionalWorks.map((w) => (
                  <li key={w.id}>
                    <Link to={`/additional/${w.id}`} className="list-row">
                      <div className="list-row__main"><span className="list-row__title">추가 작업 · {w.scope}</span></div>
                      <Badge tone={w.status === 'agreed' ? 'success' : 'neutral'}>{w.status === 'agreed' ? '동의함' : w.status === 'declined' ? '동의하지 않음' : '응답 전'}</Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <hr className="hr" />

          {/* 현재 방문 일정 또는 방문 불가·협의 상태(진행 중인 제안의 비교·응답은 상단 카드에서만) */}
          <KV rows={[
            // 기존 방문 불가·새 일정 미확정이면 날짜 대신 ‘방문 일정 조율 중’만(기존 날짜는 예약 세부 정보·변경 내역에 기록으로). 비교·사유·응답은 상단 카드에서만
            disp.visitPending
              ? { k: '방문 일정', v: '방문 일정 조율 중' }
              : { k: visitLabel(b), v: <span><VisitText date={b.visitDate} time={b.visitTime} strong />{d.delay && <> <Badge tone="warn">지연 안내</Badge></>}</span> },
            // 지연 안내의 변경 도착 예상은 예약 방문 시각을 덮어쓰지 않고 따로 보여준다
            ...(d.delay ? [{ k: '변경 도착 예상', v: <span className="nowrap">{formatDateTime(d.delay.newEta)}</span> }] : []),
            ...(sch.kind !== 'normal' && !sch.oldVisitUnavailable && sch.label ? [{ k: '일정 변경', v: <span className="small">{sch.label}</span> }] : []),
            // 진행 상태: 목록과 같은 대표 상태(확인 필요 라벨은 상단 카드가 대신하므로 반복하지 않음)
            { k: '진행 상태', v: <Badge tone={TONE_BADGE[disp.tone]}>{disp.label}</Badge> },
            ...(b.followUp ? [{ k: '후속 방문', v: <span>{formatDate(b.followUp.date)}<br />{b.followUp.window}</span> }] : []),
          ]} />
          {b.followUp && <p className="small muted">{b.followUp.note}</p>}
          <hr className="hr" />

          <div className="stack--sm stack">
            <p className="small"><VisitAddressText va={d.visitAddress} /></p>
            {/* 예약 확정 당시 이름·연락처(요청에서 복사한 스냅숏, 내 정보 수정과 무관) */}
            {b.contact && <p className="small"><span className="muted">연락처</span> <ContactText c={b.contact} /></p>}
            <p className="xs muted">정확한 주소와 연락처는 나와 이 업체만 볼 수 있어요.</p>
          </div>

          {!cancelled && (
            <>
              <hr className="hr" />
              <KV rows={[
                { k: '공동 예약 참여 세대', v: `${d.group.confirmedHouseholds}세대` },
                { k: '접수 상태', v: d.groupEnded ? '종료됨' : d.groupClosed ? '마감됨' : '접수 중' },
              ]} />
              {d.groupEnded && <Banner tone="warn" title="이 공동 예약은 종료됐어요" />}
            </>
          )}

          {/* 보조 정보: 방문 전에는 펼친 채로 보여준다 */}
          <details className="disclosure" open={beforeVisit}>
            <summary>예약 세부 정보<Icon name="chevron" size={16} /></summary>
            <KV rows={[
              ...(sch.oldVisitUnavailable ? [{ k: '기존 방문 일정(방문 불가)', v: <VisitText date={b.visitDate} time={b.visitTime} /> }] : []),
              ...(b.customerSlots.length ? [{ k: '요청 시 방문 가능한 시간', v: slotsText(b.customerSlots) }] : []),
              ...(!cancelled ? [{ k: '공동 예약 접수 마감', v: <span className="nowrap">{formatDateTime(d.group.closeAt)}</span> }] : []),
            ]} />
            {!cancelled && tf.kind === 'confirmed' && tf.households !== null && tf.households !== d.group.confirmedHouseholds && (
              <p className="xs muted">마감 시 확정 세대는 {tf.households}세대였어요. 출장비는 마감 시 기준으로 확정돼요.</p>
            )}
            <p className="xs muted">방문 시각은 업체의 도착 예정 시각이에요. {DURATION_NOTE} 다른 세대의 주소·작업·사진은 보이지 않아요.</p>
            {!showCost && (
              <div className="stack--sm stack booking-paid">
                <h3 className="small">결제한 금액</h3>
                <KV rows={[
                  ...c.payments.map((p) => ({ key: p.key, k: p.label, v: <span className="money">{formatWon(p.amount)}</span> })),
                  ...(c.used.deducted ? [{ k: '공제·충당된 금액', v: <span className="money">{formatWon(c.used.deducted)}</span> }] : []),
                  ...(c.used.refunded ? [{ k: '환불 요청한 금액', v: <span className="money">{formatWon(c.used.refunded)}</span> }] : []),
                  { k: TRIP_LABEL[tf.kind], v: tf.amount === null ? <span className="cost__missing">확인 필요</span> : <span className="money">{formatWon(tf.amount)}</span> },
                ]} />
                {tf.groupTotal !== null && tf.households ? <p className="xs muted">출장비 = 그룹 총 출장비 {formatWon(tf.groupTotal)} ÷ {tf.households}세대{tf.kind === 'expected' ? '(현재 확정 세대, 마감 때 확정)' : '(마감 시 확정)'}</p> : null}
                <PaymentRecords d={d} />
                <p className="xs muted">작업이 끝나 업체가 최종 금액을 등록하면 정산 금액을 확인할 수 있어요.</p>
              </div>
            )}
          </details>
          {(doneProposals.length > 0 || history.length > 0) && (
            <details className="disclosure">
              <summary>일정 변경 내역<Icon name="chevron" size={16} /></summary>
              <ul className="stack--sm stack">
                {doneProposals.map((p) => (
                  <li key={p.id} className="small">
                    <span className="strong">{p.origin === 'provider' ? '업체 변경 제안' : p.replyTo ? '내 희망 일정 요청' : '내 변경 요청'}</span> · {PROPOSAL_STATUS[p.status]}{p.customerReply === 'other_requested' ? ' · 다른 일정 요청' : ''}
                    <br /><span className="xs muted">{formatVisit(p.oldVisit.date, p.oldVisit.time)} → {p.newVisit.time ? formatVisit(p.newVisit.date, p.newVisit.time) : `${formatDate(p.newVisit.date)} ${p.newVisit.wishSlot ?? ''}`.trim()}{p.respondedAt ? ` · 응답 ${formatDateTime(p.respondedAt)}` : ''}</span>
                  </li>
                ))}
                {history.map((h) => (
                  <li key={`ch-${h.proposalId}`} className="small">
                    <span className="strong">확정</span> · <span className="nowrap">{formatVisit(h.from.date, h.from.time)}</span> → <span className="nowrap strong">{formatVisit(h.to.date, h.to.time)}</span>
                    <br /><span className="xs muted">사유: {h.reason} · 고객 동의 {formatDateTime(h.consentedAt)}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
          {d.origin && (
            <details className="disclosure">
              <summary>요청 당시 내용<Icon name="chevron" size={16} /></summary>
              {origin.data ? (
                <div className="stack">
                  {origin.data.request.tasks.map((t) => (
                    <div key={t.id} className="stack--sm stack">
                      <p className="strong small">{t.title}</p>
                      {t.description && <p className="small">{t.description}</p>}
                      {t.photoNames.length > 0 && <div className="chips">{t.photoNames.map((n) => <span key={n} className="photo-chip"><Icon name="camera" size={14} />{n}</span>)}</div>}
                    </div>
                  ))}
                  <KV rows={[
                    { k: '요청일', v: formatDate(origin.data.request.createdAt.slice(0, 10)) },
                    { k: '방문 가능한 시간', v: slotsText(origin.data.request.slots) },
                    ...(COMPARE_REQUESTS_ENABLED && d.origin.bundleSize > 1 ? [{ k: '비교 요청', v: `업체 ${d.origin.bundleSize}곳에 보냄` }] : []),
                  ]} />
                </div>
              ) : origin.error ? <p className="small muted">요청 당시 내용을 불러오지 못했어요.</p> : <p className="small muted">불러오는 중이에요</p>}
            </details>
          )}
        </div>
      </Section>

      {/* 금액·정산(최종 금액 등록 후·기록이 있는 취소 예약만. 숨기면 영역·여백을 남기지 않는다) */}
      {showCost && !costOnTop && (
        <Section title="금액·정산">
          <BookingCostCard d={d} />
        </Section>
      )}

      {d.review && <div className="card stack--sm stack"><p className="strong">내가 쓴 리뷰 <span className="stars" aria-label={`${d.review.rating}점`}>{'★'.repeat(d.review.rating)}</span></p><p className="small">{d.review.body}</p></div>}

      {/* 하단 버튼: 상태별 관리 행동 + 예약 목록으로(진행 중 → 확정된 예약, 이용 완료·취소 → 완료·취소) */}
      <div className="detail-actions">
        {canChange && <LinkButton to={`/bookings/${b.id}/change`} variant="secondary" block>날짜·시간 변경 요청</LinkButton>}
        {d.statement?.status === 'settled' && !d.review && <LinkButton to={`/bookings/${b.id}/review`} variant="primary" block>리뷰 작성하기</LinkButton>}
        {openProposal && !canChange && b.status === 'confirmed' && <p className="xs muted">진행 중인 일정 변경이 있어 새 변경 요청은 할 수 없어요.</p>}
        <div className={`detail-actions__pair${canCancel ? '' : ' detail-actions__pair--single'}`}>
          <LinkButton to={listPath(bookingTabOf(b))} variant="secondary" block>예약 목록으로</LinkButton>
          {canCancel && <LinkButton to={`/bookings/${b.id}/cancel`} variant="danger" block>예약 취소하기</LinkButton>}
        </div>
        {providerFreeCancel && <p className="xs muted cancel-note">업체 사유로 무료 취소할 수 있어요. 공제 없이 선결제 전액이 환불돼요.</p>}
      </div>
    </>
  );
}

/** 이전 최종 금액 확인 주소(/bookings/:id/final) → 예약 상세의 금액·정산 영역(한 번만 바꿔 이동, 반복 없음) */
export function FinalStatementRedirect() {
  const { id = '' } = useParams();
  return <Navigate to={{ pathname: `/bookings/${encodeURIComponent(id)}`, hash: 'settlement' }} replace />;
}

/** 이전 일정 변경 확인 주소(/proposals/:id) → 그 예약 상세의 일정 변경 영역(한 번만 바꿔 이동). 없는 제안이면 안내와 내 예약 경로 */
export function ProposalRedirect() {
  const { id = '' } = useParams();
  const repo = useRepo();
  const q = useAsync(() => repo.getProposal(id), [repo, id]);
  if (q.data) return <Navigate to={{ pathname: `/bookings/${encodeURIComponent(q.data.booking.id)}`, hash: 'schedule-change' }} replace />;
  return (
    <Page title="일정 변경" back="/bookings">
      {q.error ? (
        <EmptyState icon="calendar" title="일정 변경 내역을 찾을 수 없어요" action={<LinkButton to={listPath('active')} variant="primary">확정된 예약 보기</LinkButton>}>
          주소가 잘못됐거나 확인할 수 없는 내역이에요.
        </EmptyState>
      ) : <LoadingBlock />}
    </Page>
  );
}

export function BookingDetailPage() {
  const { id = '' } = useParams();
  const repo = useRepo();
  const loc = useLocation();
  const q = useAsync(() => repo.getBooking(id), [repo, id]);
  const ready = !!q.data;
  // #settlement·#schedule-change(알림·이전 주소)로 들어오면 그 영역으로 한 번 스크롤·포커스한다(영역이 없으면 위에서 시작)
  useEffect(() => {
    if (!ready || (loc.hash !== '#settlement' && loc.hash !== '#schedule-change')) return;
    const el = document.getElementById(loc.hash.slice(1));
    if (el) { el.scrollIntoView({ block: 'start' }); el.focus({ preventScroll: true }); }
  }, [ready, loc.hash, loc.key]);
  return (
    <Page title="예약 상세" back={q.data ? listPath(bookingTabOf(q.data.booking)) : '/bookings'}
      progress={q.data && <ProgressSteps progress={progressOfBooking(q.data.booking)} />}>
      <AsyncView state={q}>{(d) => <Body d={d} />}</AsyncView>
    </Page>
  );
}
