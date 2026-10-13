import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ActionBar, Page } from '../../app/Page';
import { useRepo } from '../../app/context';
import { useAction, useAsync } from '../../app/hooks';
import { REQUEST_STATUS } from '../../domain/rules';
import { formatDate, formatDateTime, formatRemaining } from '../../domain/time';
import { formatWon } from '../../domain/money';
import { Icon } from '../../components/Icon';
import { AsyncView, Banner, Button, Dialog, KV, LinkButton, PhoneButton, Section } from '../../components/ui';
import type { RequestDetail } from '../../data/repositories/types';
import { RequestBadge } from './RequestsPage';
import { progressOfRequest, unlessComplete } from '../../domain/progressStep';
import { ProgressSteps } from '../../components/ProgressSteps';
import { ContactText, VisitAddressText, VisitText, slotsText } from '../shared';
import { DURATION_NOTE } from '../../domain/visitTime';
import { LIST_LINK_LABEL, isConvertedToBooking, listPath } from '../../domain/reservationTabs';

function Body({ d, now }: { d: RequestDetail; now: string }) {
  const repo = useRepo();
  const nav = useNavigate();
  const action = useAction();
  const [confirm, setConfirm] = useState(false);
  const r = d.request;
  const ap = d.approval;
  const meta = REQUEST_STATUS[r.status];
  const canWithdraw = ['reviewing', 'needs_info', 'approved_pending_payment'].includes(r.status);

  return (
    <>
      <div className="stack--sm stack">
        <div className="row row--wrap"><RequestBadge status={r.status} recheck={!!ap?.recheck && r.status === 'approved_pending_payment'} /></div>
        <p className="small muted">{meta.hint}</p>
      </div>

      {r.status === 'needs_info' && r.infoRequest && (
        <Banner tone="warn" title="업체가 확인하고 싶은 내용이 있어요">{r.infoRequest.message}</Banner>
      )}
      {r.status === 'reviewing' && r.infoRequest?.response && <Banner tone="info" title="보완한 내용을 업체가 확인하고 있어요">{r.infoRequest.response.message}</Banner>}
      {r.status === 'rejected' && <Banner tone="danger" title="업체가 거절했어요">{r.rejectionReason ?? '사유가 전달되지 않았어요.'} 취소수수료는 없어요. 다른 업체에 요청할 수 있어요.</Banner>}
      {r.status === 'approval_expired' && <Banner tone="warn" title="결제 기한이 지나 예약이 확정되지 않았어요">취소수수료는 없어요. 새 요청을 보낼 수 있어요.</Banner>}
      {r.status === 'closed_other_booking' && <Banner tone="info" title="같은 작업으로 다른 업체 예약이 확정됐어요">이 요청은 취소수수료 없이 종료됐어요.</Banner>}
      {r.status === 'withdrawn' && <Banner tone="info" title="직접 철회한 요청이에요">취소수수료는 없어요.</Banner>}

      {r.status === 'approved_pending_payment' && ap && (
        <div className="card stack">
          <h3>업체가 승인했어요</h3>
          <KV rows={[
            ap.recheck
              ? { k: '업체가 제안한 방문 시각', v: <VisitText date={ap.recheck.newVisitDate} time={ap.recheck.newVisitTime} strong /> }
              : { k: '업체가 제안한 방문 시각', v: <VisitText date={ap.visitDate} time={ap.visitTime} strong /> },
            { k: '고객 가능 시간', v: slotsText(r.slots) },
            { k: '결제 기한', v: <span className="nowrap">{formatDateTime(ap.paymentDeadline)}</span> },
            { k: '남은 시간', v: formatRemaining(now, ap.paymentDeadline) },
            { k: '예약금', v: <span className="money strong">{formatWon(ap.recheck?.newDepositAmount ?? ap.depositAmount)}</span> },
          ]} />
          <p className="xs muted">승인만으로는 예약이 확정되지 않아요. 결제 기한 안에 예약금을 결제하면 업체가 제안한 방문 시각으로 확정돼요. 방문 시각은 도착 예정 시각이며, {DURATION_NOTE}</p>
        </div>
      )}
      {r.status === 'booked' && (
        <div className="card stack--sm stack done-summary" role="status">
          <p className="strong"><span className="done-summary__mark" aria-hidden>✓</span> 예약 완료 · 요청 과정이 끝났어요</p>
          <p className="small muted">예약금 결제로 예약이 확정됐어요. 일정 변경·취소·작업·정산은 내 예약에서 관리해요.</p>
          {r.bookingId
            ? <LinkButton to={`/bookings/${r.bookingId}`} variant="primary" block>예약 보기</LinkButton>
            : <LinkButton to={listPath('active')} variant="primary" block>확정된 예약에서 확인하기</LinkButton>}
        </div>
      )}

      <Section title="업체 연락">
        <div className="card row row--between row--wrap">
          <span className="strong">{d.provider.name}</span>
          <PhoneButton phone={d.provider.phone} name={d.provider.name} />
        </div>
        <p className="xs muted">연락은 전화로 해요. 앱 안 채팅은 제공하지 않아요.</p>
      </Section>

      <Section title="보낸 요청">
        <div className="card stack">
          {r.tasks.map((t) => (
            <div key={t.id} className="stack--sm stack">
              <p className="strong">{t.title}</p>
              {t.description && <p className="small">{t.description}</p>}
              {t.photoNames.length > 0 && <div className="chips">{t.photoNames.map((n) => <span key={n} className="photo-chip"><Icon name="camera" size={14} />{n}</span>)}</div>}
            </div>
          ))}
          <hr className="hr" />
          <KV rows={[
            { k: '요청 방식', v: d.group ? '공동 예약 날짜 참여' : '새 날짜 요청' },
            ...(d.group ? [{ k: '방문 날짜', v: formatDate(d.group.date) }] : r.newDateWish ? [{ k: '희망 날짜', v: formatDate(r.newDateWish) }] : []),
            { k: '고객 가능 시간', v: slotsText(r.slots) },
            { k: '방문 주소', v: <VisitAddressText va={d.visitAddress} /> },
            // 제출 당시 이름·연락처(내 정보를 나중에 수정해도 바뀌지 않음). 이전 데이터라 없으면 표시하지 않는다
            ...(r.contact ? [{ k: '연락처', v: <ContactText c={r.contact} /> }] : []),
          ]} />
          <p className="xs muted">정확한 주소와 작업 내용은 나와 요청을 받은 업체만 볼 수 있어요.</p>
        </div>
      </Section>

      {d.group && (
        <Section title="공동 예약 현황">
          <div className="card stack--sm stack">
            <KV rows={[
              { k: '확정 세대', v: `${d.group.confirmedHouseholds}세대` },
              { k: '결제 대기 자리', v: `${d.group.pendingSeats}자리` },
              { k: '접수 마감', v: <span className="nowrap">{formatDateTime(d.group.closeAt)}</span> },
            ]} />
            <p className="xs muted">다른 세대의 주소·작업 내용은 공개되지 않아요.</p>
          </div>
        </Section>
      )}

      {action.error && !confirm && <Banner tone="danger" title={action.error.title}>{action.error.hint}</Banner>}
      {/* 예약으로 이어진 요청은 보낸 요청 목록에 없으므로 목록 링크 대신 위 ‘예약 보기’로 이동한다 */}
      {!isConvertedToBooking(r) && <p className="xs muted"><Link to={listPath('requests')}>{LIST_LINK_LABEL.requests}</Link></p>}

      {(r.status === 'needs_info' || r.status === 'approved_pending_payment' || canWithdraw) && (
        <ActionBar>
          {r.status === 'needs_info' && <LinkButton to={`/requests/${r.id}/supplement`} variant="primary" block>요청서 보완하기</LinkButton>}
          {r.status === 'approved_pending_payment' && (
            <LinkButton to={ap?.recheck ? `/requests/${r.id}/recheck` : `/requests/${r.id}/approval`} variant="primary" block>
              {ap?.recheck ? '새 예약 조건 확인하기' : '승인 조건 확인하고 결제하기'}
            </LinkButton>
          )}
          {canWithdraw && <Button variant="ghost" block onClick={() => setConfirm(true)}>이 업체 요청 철회하기</Button>}
        </ActionBar>
      )}

      {confirm && (
        <Dialog
          title="이 요청을 철회할까요?" onClose={() => setConfirm(false)}
          actions={<>
            <Button variant="danger" block busy={action.busy} onClick={() => void action.run(async () => { await repo.withdrawRequest(r.id); setConfirm(false); nav(`/requests/${r.id}`, { replace: true }); })}>요청 철회하기</Button>
            <Button block onClick={() => setConfirm(false)}>계속 유지하기</Button>
          </>}
        >
          <p>{d.provider.name}에 보낸 요청만 철회돼요. 다른 업체 요청과 확정된 예약에는 영향이 없어요.</p>
          <p className="small muted">철회해도 취소수수료는 없어요. 결제 전이라 예약이 확정된 상태가 아니에요. 확정된 예약을 취소하는 것과는 달라요.</p>
          {action.error && <Banner tone="danger" title={action.error.title}>{action.error.hint}</Banner>}
        </Dialog>
      )}
    </>
  );
}

/** 상단 뒤로: 보낸 요청 탭. 예약으로 이어진 요청이면 그 예약 상세(보낸 요청 목록에는 없음) */
const backOf = (d?: RequestDetail): string =>
  d && isConvertedToBooking(d.request) && d.request.bookingId ? `/bookings/${d.request.bookingId}` : listPath('requests');

export function RequestDetailPage() {
  const { id = '' } = useParams();
  const repo = useRepo();
  const q = useAsync(() => repo.getRequest(id), [repo, id]);
  return (
    <Page title="요청 상세" back={backOf(q.data)} progress={q.data && <ProgressSteps progress={unlessComplete(progressOfRequest(q.data.request.status))} />}>
      <AsyncView state={q}>{(d) => <Body d={d} now={repo.now()} />}</AsyncView>
    </Page>
  );
}
