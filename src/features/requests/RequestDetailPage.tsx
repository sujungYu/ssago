import { DepositPaySection } from '../payment/ApprovalPage';
import { COMPARE_REQUESTS_ENABLED } from '../../domain/demoScope';
import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { Page } from '../../app/Page';
import { useRepo } from '../../app/context';
import { useAction, useAsync } from '../../app/hooks';
import { formatDate, formatDateTime } from '../../domain/time';
import { Icon } from '../../components/Icon';
import { ActionCard, AsyncView, Banner, Button, Dialog, KV, LinkButton, PhoneButton, Section } from '../../components/ui';
import type { RequestDetail } from '../../data/repositories/types';
import { progressOfRequest, unlessComplete } from '../../domain/progressStep';
import { ProgressSteps } from '../../components/ProgressSteps';
import { ContactText, VisitAddressText, slotsText } from '../shared';
import { isConvertedToBooking, listPath } from '../../domain/reservationTabs';

function Body({ d }: { d: RequestDetail }) {
  const repo = useRepo();
  const nav = useNavigate();
  const action = useAction();
  const [confirm, setConfirm] = useState(false);
  const r = d.request;
  const ap = d.approval;
  // 철회 가능한 상태(기존 정책 그대로): 결제 전 진행 중 요청만. 예약 확정·종료된 요청에는 철회 버튼이 없다(확정 예약 취소는 예약 상세에서).
  const canWithdraw = ['reviewing', 'needs_info', 'approved_pending_payment'].includes(r.status) && !isConvertedToBooking(r);
  // 비교 요청(같은 묶음에 업체 2곳 이상)이면 철회 확인에 ‘다른 업체에 보낸 요청은 유지돼요.’를 덧붙인다
  // 비교 요청을 쓰지 않는 데모에서는 묶음을 조회하지 않는다(개별 업체 요청)
  const bundle = useAsync(() => (canWithdraw && COMPARE_REQUESTS_ENABLED ? repo.getBundle(r.bundleId) : Promise.resolve(null)), [repo, r.bundleId, canWithdraw]);
  const isCompare = !!bundle.data && new Set(bundle.data.items.map((i) => i.provider.id)).size > 1;

  return (
    <>
      {/* 상단 확인 영역(spec 5.17): 진행 단계 바로 아래, 일반 정보보다 위. 상태 배지·설명을 따로 반복하지 않는다(진행 단계·종료 안내·행동 카드가 대신) */}
      {/* A. 요청서 보완: 업체가 남긴 실제 요청 내용 + [요청서 보완하기](기존 보완 화면·제출 흐름) */}
      {r.status === 'needs_info' && (
        <ActionCard id="info-req" title="요청서를 보완해 주세요"
          actions={<LinkButton to={`/requests/${r.id}/supplement`} variant="primary" block>요청서 보완하기</LinkButton>}>
          <p className="small muted">{d.provider.name}의 요청{r.infoRequest ? ` · ${formatDateTime(r.infoRequest.requestedAt)}` : ''}</p>
          {r.infoRequest
            ? <p className="act-card__msg">{r.infoRequest.message}</p>
            : <p className="act-card__msg muted">요청 내용을 불러오지 못했어요. 업체에 전화로 확인해 주세요.</p>}
        </ActionCard>
      )}
      {r.status === 'reviewing' && r.infoRequest?.response && <Banner tone="info" title="보완한 내용을 업체가 확인하고 있어요">{r.infoRequest.response.message}</Banner>}
      {r.status === 'rejected' && <Banner tone="danger" title="업체가 거절했어요">{r.rejectionReason ?? '사유가 전달되지 않았어요.'} 취소수수료는 없어요. 다른 업체에 요청할 수 있어요.</Banner>}
      {r.status === 'approval_expired' && <Banner tone="warn" title="결제 기한이 지나 예약이 확정되지 않았어요">취소수수료는 없어요. 새 요청을 보낼 수 있어요.</Banner>}
      {r.status === 'closed_other_booking' && <Banner tone="info" title="같은 작업으로 다른 업체 예약이 확정됐어요">이 요청은 취소수수료 없이 종료됐어요.</Banner>}
      {r.status === 'withdrawn' && <Banner tone="info" title="직접 취소한 요청이에요">취소수수료는 없어요.</Banner>}

      {/* B(예약 확정 전). 승인·결제 대기: 승인된 방문 시각·바뀐 조건 확인·동의와 예약금 결제를 이 화면 상단 카드에서(별도 승인 조건 화면 없음) */}
      {r.status === 'approved_pending_payment' && ap && <DepositPaySection requestId={r.id} />}
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
            { k: '방문 가능한 시간', v: slotsText(r.slots) },
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

      {/* 하단 버튼 영역(고정 없이 마지막 본문 다음, 간격 24px). 다음 행동(보완·결제)이 있으면 먼저 두고,
          그 아래 [보낸 요청 목록으로](흰 바탕·블루) + [이 업체 요청 철회하기](흰 바탕·빨강)를 데스크톱은 나란히, 모바일은 목록 버튼을 위로 세로 배치.
          예약으로 이어진 요청은 보낸 요청 목록에 없으므로 목록 버튼 대신 위 ‘예약 보기’로 이동한다. */}
      {!isConvertedToBooking(r) && (
        <div className="detail-actions">
          <div className={`detail-actions__pair${canWithdraw ? '' : ' detail-actions__pair--single'}`}>
            <LinkButton to={listPath('requests')} variant="secondary" block>보낸 요청 목록으로</LinkButton>
            {canWithdraw && <Button variant="danger" block onClick={() => setConfirm(true)}>이 업체 요청 철회하기</Button>}
          </div>
        </div>
      )}

      {/* 철회 확인(한 번). 처음 포커스는 ‘돌아가기’, 닫으면 상세의 철회 버튼으로 돌아간다. ‘철회하기’를 눌렀을 때만 이 업체 요청을 철회한다 */}
      {confirm && (
        <Dialog
          variant="confirm" title={`${d.provider.name}에 보낸 요청을 철회할까요?`} onClose={() => { if (!action.busy) setConfirm(false); }}
          actions={<>
            <Button block disabled={action.busy} onClick={() => setConfirm(false)}>돌아가기</Button>
            <Button variant="danger-solid" block busy={action.busy} onClick={() => void action.run(async () => { await repo.withdrawRequest(r.id); setConfirm(false); nav(`/requests/${r.id}`, { replace: true }); })}>철회하기</Button>
          </>}
        >
          {(isCompare || action.error) ? <>
            {isCompare && <p className="small muted">다른 업체에 보낸 요청은 유지돼요.</p>}
            {action.error && <Banner tone="danger" title={action.error.title}>{action.error.hint} 다시 시도해 주세요.</Banner>}
          </> : null}
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
  const loc = useLocation();
  const ready = !!q.data;
  // 결제 대기 중 예약금 결제가 처리 중·결과 확인 중이면 진행 단계 설명도 ‘결과 확인 중’으로(이전 승인 조건 화면과 같은 기준)
  const pending = q.data?.request.status === 'approved_pending_payment';
  const inFlight = useAsync(() => (pending ? repo.getApproval(id).then((v) => !!v.inFlightPayment, () => false) : Promise.resolve(false)), [repo, id, pending]);
  // #pay(알림·이전 승인 조건 주소)로 들어오면 예약금 결제 영역이 그려진 뒤 한 번 스크롤·포커스한다
  useEffect(() => {
    if (!ready || loc.hash !== '#pay') return;
    const t = window.setTimeout(() => { const el = document.getElementById('pay'); if (el) { el.scrollIntoView({ block: 'start' }); el.focus({ preventScroll: true }); } }, 400);
    return () => window.clearTimeout(t);
  }, [ready, loc.hash, loc.key]);
  return (
    <Page title="요청 상세" back={backOf(q.data)} progress={q.data && <ProgressSteps progress={unlessComplete(progressOfRequest(q.data.request.status, { inFlight: !!inFlight.data }))} />}>
      <AsyncView state={q}>{(d) => <Body d={d} />}</AsyncView>
    </Page>
  );
}
