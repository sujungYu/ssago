import { useEffect } from 'react';
import { Navigate, useLocation, useParams } from 'react-router-dom';
import { Page } from '../../app/Page';
import { useRepo } from '../../app/context';
import { useAsync } from '../../app/hooks';
import { progressOfBooking } from '../../domain/progressStep';
import { ProgressSteps } from '../../components/ProgressSteps';
import { formatDate, formatDateTime } from '../../domain/time';
import { formatWon } from '../../domain/money';
import { Icon } from '../../components/Icon';
import { AsyncView, Banner, EmptyState, Fold, KV, LinkButton, LoadingBlock, Section } from '../../components/ui';
import { AdditionalActionCard, DelayActionCard, MaterialActionCard } from './BookingActionCards';
import { ScheduleChangeCard } from './ScheduleChangeCard';
import type { BookingDetail } from '../../data/repositories/types';
import { ContactText, PAYMENT_STATUS, ProviderContactRow, VisitAddressText, VisitText, bookingDisplayOfDetail } from '../shared';
import { BookingCostCard, costOf, settlementVisible } from './BookingCostCard';
import { tripShareView } from '../../domain/bookingCost';
import { DURATION_NOTE } from '../../domain/visitTime';
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

function Body({ d }: { d: BookingDetail }) {
  const b = d.booking;
  const cancelled = b.status === 'cancelled';
  const tf = d.tripFee;
  const sch = d.schedule;
  const openProposal = d.proposals.some((p) => p.status === 'requested' || p.status === 'proposed');
  const canChange = b.status === 'confirmed' && b.workStatus === 'scheduled' && !openProposal && !sch.oldVisitUnavailable;
  const canCancel = b.status === 'confirmed' && b.workStatus === 'scheduled';
  // 업체 사유 무료 취소(기존 일정 방문 불가·업체 제안 등): 취소 버튼 근처에 짧게 안내
  const providerFreeCancel = canCancel && !!d.freeCancel && (sch.kind !== 'normal' || /업체/.test(d.freeCancel.reason));
  // 금액·정산 카드: 최종 금액 등록 후(확인·협의·처리 중·정산 완료)와 기록이 있는 취소 예약만(공통 기준). 그 전에는 숨기고 결제 기록은 예약 세부 정보에서
  const showCost = settlementVisible(d);
  const c = costOf(d);
  // E. 최종 금액 확인(협의로 수정된 금액 재확인 포함)이 필요하면 기존 금액·정산 카드를 상단 확인 영역으로 올린다(중복 카드 없음)
  const costOnTop = showCost && c.stage === 'final_awaiting';
  const disp = bookingDisplayOfDetail(d);
  // 결제한 예약금·별도 선결제(성공 거래 합계). 정산 계산·결제 기록은 그대로이고 여기서는 보여주기만 한다.
  // 금액·정산 카드가 있으면(최종 금액 등록 후·기록이 있는 취소) 그 카드의 [금액 상세]에만 두고 여기서는 숨긴다 — 펼침 상태와 무관(spec 5.27)
  const pre = d.prepaid;
  const paidRows = cancelled || showCost ? [] : [
    ...(pre.depositPaid > 0 ? [{ k: '결제한 예약금', v: <span className="money strong">{formatWon(pre.depositPaid)}</span> }] : []),
    // 예약금에 합치지 않고 따로(맞춤 자재 선결제·일정 변경 추가 결제)
    ...(pre.materialPrepaid > 0 ? [{ k: '결제한 자재비', v: <span className="money">{formatWon(pre.materialPrepaid)}</span> }] : []),
    ...(pre.changePaid > 0 ? [{ k: '일정 변경 추가 결제', v: <span className="money">{formatWon(pre.changePaid)}</span> }] : []),
  ];
  const share = tripShareView(tf, formatWon);

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

      {/* 예약 정보(spec 5.19): 업체·전화 · 확정 방문 일정. 상태 배지는 두지 않는다(진행 단계·상단 확인 카드가 안내) */}
      <Section title="예약 정보">
        <div className="card stack booking-info" id="booking-info">
          <ProviderContactRow name={d.provider.name} phone={d.provider.phone} numberOnly />
          <KV rows={[
            // 기존 방문 불가·새 일정 미확정이면 날짜 대신 ‘방문 일정 조율 중’. 일정 비교·사유·응답은 상단 확인 카드에서만(일정 변경 기록은 데이터로 보존, 화면 펼치기 없음)
            { k: '방문 일정', v: disp.visitPending ? '방문 일정 조율 중' : <VisitText date={b.visitDate} time={b.visitTime} strong /> },
            // 지연 안내의 변경 도착 예상은 예약 방문 시각을 덮어쓰지 않고 따로 보여준다
            ...(d.delay ? [{ k: '변경 도착 예상', v: <span className="nowrap">{formatDateTime(d.delay.newEta)}</span> }] : []),
            ...(b.followUp ? [{ k: '후속 방문', v: <span><span className="nowrap">{formatDate(b.followUp.date)}</span> <span className="nowrap">{b.followUp.window}</span></span> }] : []),
          ]} />
          {b.followUp && <p className="small muted">{b.followUp.note}</p>}
          {!disp.visitPending && !cancelled && <p className="xs muted">방문 시각은 업체의 도착 예정 시각이에요. {DURATION_NOTE}</p>}
          {/* 결제한 예약금(별도 ‘결제 내역’ 펼치기 대신). 결제·환불 기록은 상단 금액·정산 카드와 결제 내역 화면에서 */}
          {paidRows.length > 0 && (
            <div className="stack--sm stack" id="paid-deposit">
              <KV rows={paidRows} />
              <p className="xs muted">{paidRows.length > 1 ? '결제한 예약금과 선결제 금액은 최종 정산 시 차감돼요.' : '결제한 예약금은 최종 정산 시 차감돼요.'}</p>
            </div>
          )}

          <div className="folds">
            {/* 공동 예약 정보: 다른 세대와 출장비를 나누는 예약만(일반 예약 — 분담 세대가 나 하나 — 에는 그리지 않는다) */}
            {!cancelled && share.joint && (
              <Fold id="fold-group" title="공동 예약 정보">
                <KV rows={[
                  { k: '참여 확정 세대', v: `${d.group.confirmedHouseholds}세대` },
                  { k: '접수 상태', v: d.groupEnded ? '종료됨' : d.groupClosed ? '마감됨' : '접수 중' },
                  { k: '접수 마감', v: <span className="nowrap">{formatDateTime(d.group.closeAt)}</span> },
                ]} />
                {/* 내 출장비 + 절약 안내(연한 블루 영역)·분담 문구. 출장비만으로 계산하며 돌려받는 금액이 아니다.
                    금액·정산 카드가 있으면 그 카드의 [금액 상세]에만 두고 여기서는 그리지 않는다 — 펼침 상태와 무관(spec 5.28) */}
                {!showCost && (
                  <>
                    <div className="trip-share" id="trip-share">
                      <p className="trip-share__row"><span>{share.label}</span>{share.amount === null ? <span className="cost__missing">확인 필요</span> : <span className="money strong">{formatWon(share.amount)}</span>}</p>
                      {share.savingText && <p className="trip-share__saving">{share.savingText}</p>}
                    </div>
                    {share.splitText ? <p className="xs muted">{share.splitText}</p>
                      : tf.kind === 'locked' ? <p className="xs muted">일정 변경 때 기존 확정 출장비를 그대로 유지하기로 했어요.</p> : null}
                    {tf.kind === 'confirmed' && tf.households !== null && tf.households !== d.group.confirmedHouseholds && (
                      <p className="xs muted">마감 시 확정 세대는 {tf.households}세대였어요. 마감 후 취소한 세대가 있어도 확정 출장비는 그대로예요.</p>
                    )}
                  </>
                )}
                {d.groupEnded && <p className="small strong">이 공동 예약은 종료됐어요.</p>}
                <p className="xs muted">같은 날 같은 업체를 함께 부르는 이웃 세대와 출장비를 나눠요. 다른 세대의 주소·작업·사진은 보이지 않아요.</p>
              </Fold>
            )}
          </div>
        </div>
      </Section>

      {/* 방문 주소: 예약에 저장된 주소·연락처 스냅숏(탐색 주소·내 정보 수정과 무관) */}
      <Section title="방문 주소">
        <div className="card stack--sm stack" id="visit-address">
          <p style={{ overflowWrap: 'anywhere' }}><VisitAddressText va={d.visitAddress} /></p>
          {b.contact && <p className="small"><span className="muted">연락받을 분</span> <ContactText c={b.contact} /></p>}
          <p className="xs muted">정확한 주소와 연락처는 나와 이 업체만 볼 수 있어요.</p>
        </div>
      </Section>

      {/* 작업 내용: 신청 작업명·설명·첨부 사진을 한 번만(작업별 구분). 요청 방식·요청일·당시 가능 시간은 보여주지 않는다(원본 요청 데이터는 보존).
          자재·추가 작업으로 실제 수행 내용이 달라졌으면 아래 펼치기에서. 실제 작업 완료 여부는 최종 금액 확인 영역(금액·정산)에서 */}
      <Section title="작업 내용">
        <div className="card stack" id="work" tabIndex={-1}>
          <ul className="stack work-list">
            {b.tasks.map((t) => (
              <li key={t.id} className="stack--sm stack">
                <p className="strong work-title">{t.title}</p>
                {t.description && <p className="small muted" style={{ overflowWrap: 'anywhere' }}>{t.description}</p>}
                {t.photoNames.length > 0 && <div className="chips">{t.photoNames.map((n) => <span key={n} className="photo-chip"><Icon name="camera" size={14} />{n}</span>)}</div>}
              </li>
            ))}
          </ul>
          {d.statement && (() => {
            // 업체가 등록한 실제 작업(정산 판단용): 완료 여부를 기록으로 함께 보여준다(배지 대신 문장)
            const done = d.statement.actualWork.filter((w) => w.done).length;
            return <p className="small muted">업체가 등록한 실제 작업 {d.statement.actualWork.length}건 중 {done}건 완료{d.statement.actualWork.some((w) => !w.done) ? ` · 미완료: ${d.statement.actualWork.filter((w) => !w.done).map((w) => w.title).join(', ')}` : ''}</p>;
          })()}

          <div className="folds">
            {(d.materials.length > 0 || d.additionalWorks.length > 0) && (
              <Fold id="fold-extra" title="자재·추가 작업 상세">
                {d.materials.map((m) => (
                  <div key={m.id} className="fold__item">
                    <p className="fold__item-title">자재 · {m.name}</p>
                    <KV rows={[
                      { k: '사양', v: m.spec },
                      { k: '수량', v: `${m.quantity}개` },
                      { k: '금액', v: <span className="money">{formatWon(m.price)}</span> },
                      { k: '납기', v: formatDate(m.deliveryDate) },
                      // 실제 처리 상태: 결제 전은 결제 완료처럼 표현하지 않는다
                      { k: '선결제', v: m.paymentStatus === 'none' ? '결제 전 · 동의 전' : `${PAYMENT_STATUS[m.paymentStatus].label}${m.agreedAt ? ` · 동의 ${formatDateTime(m.agreedAt)}` : ''}` },
                      { k: '업체 주문', v: m.orderStatus === 'ordered' ? '주문 완료' : '주문 전' },
                    ]} />
                  </div>
                ))}
                {d.additionalWorks.map((w) => (
                  <div key={w.id} className="fold__item">
                    <p className="fold__item-title">추가 작업 · {w.scope}</p>
                    <KV rows={[
                      { k: '사유', v: w.reason },
                      { k: '추가 금액', v: <span className="money">{formatWon(w.amount)}</span> },
                      { k: '일정 영향', v: w.followUp ? <span>후속 방문 <span className="nowrap">{formatDate(w.followUp.date)}</span> <span className="nowrap">{w.followUp.window}</span></span> : '추가 방문 없음' },
                      { k: '처리', v: w.status === 'agreed' ? `동의함${w.respondedAt ? ` · ${formatDateTime(w.respondedAt)}` : ''}` : w.status === 'declined' ? `동의하지 않음${w.respondedAt ? ` · ${formatDateTime(w.respondedAt)}` : ''}` : '응답 전(위 확인 카드에서 응답)' },
                    ]} />
                  </div>
                ))}
              </Fold>
            )}
          </div>
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
