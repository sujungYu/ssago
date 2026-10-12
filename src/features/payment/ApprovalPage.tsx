import { useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { ActionBar, Page } from '../../app/Page';
import { useRepo } from '../../app/context';
import { useAction, useAsync, useAttemptKey } from '../../app/hooks';
import { formatDate, formatDateTime, formatRemaining } from '../../domain/time';
import { formatWon } from '../../domain/money';
import { approvalEstimate } from '../../domain/approvalCost';
import type { ApprovalView } from '../../data/repositories/types';
import { AsyncView, Banner, Button, KV, LinkButton, MockPayNotice, Section } from '../../components/ui';
import { PAYMENT_STATUS, VisitText, slotsText } from '../shared';
import { DURATION_NOTE } from '../../domain/visitTime';
import { progressOfRequest, unlessComplete } from '../../domain/progressStep';
import { ProgressSteps } from '../../components/ProgressSteps';

function Panel({ v, reload }: { v: ApprovalView; reload: () => void }) {
  const repo = useRepo();
  const nav = useNavigate();
  const action = useAction();
  const attempt = useAttemptKey('dep');
  const ap = v.approval;
  const rc = ap.recheck;
  const [consented, setConsented] = useState<number | null>(null);
  const checked = consented === ap.version;
  const now = repo.now();
  const pending = v.request.status === 'approved_pending_payment';
  const depositAmount = rc ? rc.newDepositAmount : ap.depositAmount;
  // 비교 요청 요약 카드와 같은 계산(src/domain/approvalCost.ts). 결제 대기 자리는 확정 세대에 넣지 않는다.
  const est = approvalEstimate(ap, v.group?.confirmedHouseholds ?? 0);
  const { totalTripFee, confirmedHouseholds: confirmedNow, myTripFee: expectedFee } = est;
  const inflight = v.inFlightPayment;

  if (!pending) {
    return (
      <>
        <Banner tone="info" title="지금은 결제할 수 없는 상태예요">{v.request.status === 'booked' ? '이미 예약이 확정되었어요.' : '요청 상태를 확인해 주세요.'}</Banner>
        <LinkButton to={v.request.bookingId ? `/bookings/${v.request.bookingId}` : `/requests/${v.request.id}`} variant="primary" block>
          {v.request.bookingId ? '예약 상세 보기' : '요청 상세 보기'}
        </LinkButton>
      </>
    );
  }

  const pay = () => void action.run(async () => {
    try {
      const res = await repo.simulateDepositPayment({ requestId: v.request.id, approvalVersion: ap.version, consentedRecheck: rc ? true : undefined, idempotencyKey: attempt.get() });
      // 결제 성공과 예약 생성이 모두 확인되면 그 예약 상세로(이 화면 기록은 교체해 뒤로가기로 결제 화면이 다시 열리지 않게 한다).
      // 실패·처리 중·결과 확인 중이거나 예약을 아직 확인하지 못하면 결제 결과 화면에서 상태를 확인한다(재결제 유도 없음).
      if (res.tx.status === 'success' && res.bookingId) nav(`/bookings/${res.bookingId}`, { replace: true, state: { flash: '예약이 확정됐어요' } });
      else nav(`/pay/${res.tx.id}`, { replace: true });
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === 'version_changed' || code === 'recheck_required' || code === 'group_closed' || code === 'payment_expired') reload();
      throw e;
    }
  });

  return (
    <>
      {rc ? (
        <Banner tone="warn" title="기존 공동 예약이 종료됐어요">{rc.endedGroupNote} 아래 새 조건을 확인하고 동의해야 결제할 수 있어요.</Banner>
      ) : (
        <Banner tone="info" title="승인만으로는 예약이 확정되지 않아요">예약금을 결제하면 업체가 제안한 방문 시각으로 예약이 확정돼요. 결제하기 전에 아래 조건을 확인해 주세요.</Banner>
      )}
      {inflight && (
        <Banner tone="warn" title={PAYMENT_STATUS[inflight.status].label}>
          결제 결과를 확인하는 중이라 다시 결제할 수 없어요. <Link to={`/pay/${inflight.id}`}>결제 결과 확인하기</Link>
        </Banner>
      )}

      <Section title="방문 일정과 기한">
        <div className="card">
          <KV rows={rc ? [
            { k: '이전 일정', v: <span>{formatDate(ap.visitDate)} <span className="muted">(종료됨)</span></span> },
            { k: '업체가 제안한 새 방문 시각', v: <VisitText date={rc.newVisitDate} time={rc.newVisitTime} strong /> },
            { k: '고객 가능 시간', v: slotsText(v.request.slots) },
            { k: '새 접수 마감', v: <span className="nowrap">{formatDateTime(rc.newCloseAt)}</span> },
            { k: '결제 기한', v: <span className="nowrap">{formatDateTime(ap.paymentDeadline)}</span> },
          ] : [
            { k: '업체가 제안한 방문 시각', v: <VisitText date={ap.visitDate} time={ap.visitTime} strong /> },
            { k: '고객 가능 시간', v: slotsText(v.request.slots) },
            { k: '접수 마감', v: <span className="nowrap">{formatDateTime(ap.groupCloseAt)}</span> },
            { k: '결제 기한', v: <span><span className="nowrap">{formatDateTime(ap.paymentDeadline)}</span><br /><span className="muted xs">{formatRemaining(now, ap.paymentDeadline)}</span></span> },
          ]} />
          <p className="xs muted" style={{ marginTop: 'var(--sp-2)' }}>방문 시각은 업체의 도착 예정 시각이에요. {DURATION_NOTE} 결제 기한·접수 마감은 방문 시각과 별개예요.</p>
        </div>
      </Section>

      {rc && (
        <div className="card stack">
          <h3>달라진 출장비 조건</h3>
          <p className="small">새 그룹은 아직 확정된 세대가 없어요. 이 예약을 먼저 확정하면 당장은 <span className="money strong">{formatWon(totalTripFee)}</span> 전액을 나 혼자 부담할 수도 있어요. 이후 같은 날 이웃이 함께하면 확정된 세대 수로 나눠요.</p>
          <p className="xs muted">이웃이 합류하지 않으면 출장비가 나뉘지 않을 수 있다는 점에 동의해야 결제할 수 있어요.</p>
        </div>
      )}

      <Section title="작업 범위와 업체 견적">
        <div className="card stack">
          {ap.tasks.map((t) => (
            <div key={t.title} className="row row--between row--top">
              <div className="grow"><p className="strong">{t.title}</p><p className="small muted">{t.note}</p></div>
              <span className="money small">{t.estimate !== null ? formatWon(t.estimate) : '현장 확인'}</span>
            </div>
          ))}
          <p className="xs muted">업체 견적은 작업 전 예상 금액이에요. 최종 금액은 작업이 끝난 뒤 실제 내용으로 다시 확인해요.</p>
          {ap.materialNote && <p className="small">{ap.materialNote}</p>}
        </div>
      </Section>

      <Section title="금액">
        <div className="card stack">
          <KV rows={[
            { k: '지금 결제하는 예약금', v: <span className="money strong">{formatWon(depositAmount)}</span> },
            { k: '그룹 총 출장비', v: <span className="money">{formatWon(totalTripFee)}</span> },
            { k: confirmedNow === 0 ? '내 출장비(나 혼자일 때)' : `내 예상 출장비 (확정 ${confirmedNow}세대 + 나)`, v: <span className="money">약 {formatWon(expectedFee)}</span> },
            { k: '업체 견적 합계', v: est.labor === null ? <span className="small">금액 확인 필요<span className="xs muted" style={{ display: 'block' }}>견적 없음: {est.laborMissing.join(', ')}</span></span> : <span className="money">{formatWon(est.labor)}</span> },
            { k: '부품·자재 예상', v: <span className="money">{formatWon(est.parts)}</span> },
            { k: '예상 총액 (최종 금액 아님)', v: est.total === null ? <span className="strong">금액 확인 필요</span> : <span className="money strong">약 {formatWon(est.total)}</span>, total: true },
          ]} />
          <p className="xs muted">예상 총액 = 업체 견적 합계 + 부품·자재 예상 + 내 출장비{confirmedNow === 0 ? '(나 혼자일 때)' : `(본인 예약 확정 시 ${est.householdsWithMe}세대 기준)`}. 결제 대기 자리는 세대 수에 넣지 않고, 업체 할인은 조건 충족이 확인되기 전이라 빼지 않았어요.</p>
          <p className="xs muted">예약금은 그룹 총 출장비와 같아요. 마감 때 확정된 세대 수로 내 출장비가 정해지고, 낸 예약금은 최종 금액에서 차감돼요. 최종 금액은 작업이 끝난 뒤 확인해요.</p>
          {ap.discountNote && <div className="panel small">업체 추가 할인 조건: {ap.discountNote}<span className="xs muted" style={{ display: 'block' }}>조건을 충족하는지 업체가 확인한 뒤 적용돼요. 위 예상 총액에는 반영하지 않았어요.</span></div>}
        </div>
      </Section>

      <Section title="취소 조건">
        <ul className="card stack--sm stack">{ap.cancellationTerms.map((t) => <li key={t} className="small">· {t}</li>)}</ul>
      </Section>

      <MockPayNotice />
      <label className="check card">
        <input type="checkbox" checked={checked} onChange={(e) => setConsented(e.target.checked ? ap.version : null)} />
        <span>{rc ? '새 방문 일정과 출장비 조건이 달라졌음을 확인했고, 이 조건으로 예약금 결제에 동의해요.' : '위 승인 조건과 취소 조건을 확인했고, 예약금 결제에 동의해요.'}</span>
      </label>

      {action.error && (
        <Banner tone="danger" title={action.error.title}>
          {action.error.hint}
          {action.error.code === 'version_changed' && ' 변경된 내용을 다시 확인하고 동의해 주세요.'}
        </Banner>
      )}
      <ActionBar note={!checked ? '조건 확인에 동의하면 결제할 수 있어요' : '모의 결제 · 실제 청구 없음'}>
        <Button variant="primary" block disabled={!checked || !!inflight} busy={action.busy} onClick={pay}>
          {action.busy ? '결제 진행 중… 화면을 닫지 마세요' : `예약금 ${formatWon(depositAmount)} 모의 결제하기`}
        </Button>
      </ActionBar>
    </>
  );
}

export function ApprovalPage({ mode }: { mode: 'approval' | 'recheck' }) {
  const { id = '' } = useParams();
  const repo = useRepo();
  const q = useAsync(() => repo.getApproval(id), [repo, id]);
  return (
    <Page title={mode === 'recheck' ? '새 예약 조건 확인' : '승인 내용 확인'} back={`/requests/${id}`}
      progress={q.data && <ProgressSteps progress={unlessComplete(progressOfRequest(q.data.request.status, { inFlight: !!q.data.inFlightPayment }))} />}>
      <AsyncView state={q}>
        {(v) => {
          const hasRc = !!v.approval.recheck && v.request.status === 'approved_pending_payment';
          if (mode === 'approval' && hasRc) return <Navigate to={`/requests/${id}/recheck`} replace />;
          if (mode === 'recheck' && !hasRc && v.request.status === 'approved_pending_payment') return <Navigate to={`/requests/${id}/approval`} replace />;
          return <Panel v={v} reload={q.reload} />;
        }}
      </AsyncView>
    </Page>
  );
}
