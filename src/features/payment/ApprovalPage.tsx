import { useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { useRepo } from '../../app/context';
import { useAction, useAsync, useAttemptKey } from '../../app/hooks';
import { formatDateTime, formatRemaining } from '../../domain/time';
import { formatWon } from '../../domain/money';
import { approvalEstimate } from '../../domain/approvalCost';
import type { ApprovalView } from '../../data/repositories/types';
import { ActionCard, Banner, Button, ErrorState, KV, LoadingBlock, MockPayNotice } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { PAYMENT_STATUS, VisitText, slotsText } from '../shared';
import { DURATION_NOTE } from '../../domain/visitTime';

/**
 * 예약금 결제(요청 상세 안, spec 5.16). 업체가 승인한 요청에서 조건을 확인·동의하고 바로 예약금을 결제한다(별도 승인 조건 화면 없음).
 * - 일반 승인: 방문 시각·예약금 결제 기한·작업 견적·금액·취소 조건 → 동의 → [예약금 {금액} 결제하기]
 * - 새 조건(공동 예약 종료로 일정·출장비 조건이 바뀜): 이전 → 새 일정·예약금을 비교해 보여주고, 바뀐 조건 동의 전에는 결제할 수 없다
 * 동의 없이 결제하지 않는다. 기존 모의 결제(성공·실패·처리 중·결과 확인 중)와 검증(버전·기한·마감·재확인)을 그대로 쓰고, 결제 성공 후에만 예약이 확정된다.
 */
function Panel({ v, reload }: { v: ApprovalView; reload: () => void }) {
  const repo = useRepo();
  const nav = useNavigate();
  const action = useAction();
  const attempt = useAttemptKey('dep');
  const ap = v.approval;
  const rc = ap.recheck;
  const [consented, setConsented] = useState<number | null>(null);
  const checked = consented === ap.version; // 조건(버전)이 바뀌면 동의가 초기화된다
  const now = repo.now();
  const depositAmount = rc ? rc.newDepositAmount : ap.depositAmount;
  const est = approvalEstimate(ap, v.group?.confirmedHouseholds ?? 0);
  const { totalTripFee, confirmedHouseholds: confirmedNow, myTripFee: expectedFee } = est;
  const inflight = v.inFlightPayment;

  const pay = () => void action.run(async () => {
    try {
      const res = await repo.simulateDepositPayment({ requestId: v.request.id, approvalVersion: ap.version, consentedRecheck: rc ? true : undefined, idempotencyKey: attempt.get() });
      // 결제 성공 + 예약 생성 확인 → 그 예약 상세(요청 상세 기록을 바꿔 뒤로가기로 결제가 다시 열리지 않게). 실패·처리 중·결과 확인 중 → 결제 결과 화면
      if (res.tx.status === 'success' && res.bookingId) nav(`/bookings/${res.bookingId}`, { replace: true, state: { flash: '예약이 확정됐어요' } });
      else nav(`/pay/${res.tx.id}`);
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === 'version_changed' || code === 'recheck_required' || code === 'group_closed' || code === 'payment_expired') reload();
      throw e;
    }
  });

  const title = rc ? '바뀐 방문 조건을 확인해 주세요' : '승인된 조건을 확인하고 예약금을 결제해 주세요';
  return (
    <ActionCard id="pay" title={title} head={inflight ? '결제 결과를 확인하고 있어요' : undefined}
      actions={<>
        {action.error && (
          <Banner tone="danger" title={action.error.title}>
            {action.error.hint}
            {action.error.code === 'version_changed' && ' 변경된 내용을 다시 확인하고 동의해 주세요.'}
          </Banner>
        )}
        <Button variant="primary" block disabled={!checked || !!inflight} busy={action.busy} onClick={pay}>
          {action.busy ? '결제 진행 중… 화면을 닫지 마세요' : `예약금 ${formatWon(depositAmount)} 결제하기`}
        </Button>
        <MockPayNotice compact />
        {!checked && !inflight && <p className="xs muted">조건 확인에 동의하면 결제할 수 있어요.</p>}
      </>}>
      {/* 바뀐 조건(조건 재확인): 실제 종료 사유 + 이전 → 새 일정·예약금 비교 */}
      {rc && <p className="small">{rc.endedGroupNote} 바뀐 일정과 출장비 조건에 동의해야 결제할 수 있어요.</p>}
      {inflight && (
        <p className="small">{PAYMENT_STATUS[inflight.status].label} · 결제 결과를 확인하는 중이라 다시 결제할 수 없어요. <Link to={`/pay/${inflight.id}`}>결제 결과 확인하기</Link></p>
      )}
      {rc ? (
        <div className="sched-compare">
          <div className="sched-compare__item"><span className="sched-compare__k">이전 일정 (종료됨)</span><span className="sched-compare__v"><VisitText date={ap.visitDate} time={ap.visitTime} /></span></div>
          <div className="sched-compare__item sched-compare__item--new"><span className="sched-compare__k">새 방문 시각</span><span className="sched-compare__v"><VisitText date={rc.newVisitDate} time={rc.newVisitTime} /></span></div>
        </div>
      ) : null}
      <KV rows={rc ? [
        ...(rc.newDepositAmount !== ap.depositAmount ? [{ k: '이전 예약금', v: <span className="money muted">{formatWon(ap.depositAmount)}</span> }] : []),
        { k: '새 예약금', v: <span className="money strong">{formatWon(depositAmount)}</span> },
        { k: '새 접수 마감', v: <span className="nowrap">{formatDateTime(rc.newCloseAt)}</span> },
        { k: '예약금 결제 기한', v: <span><span className="nowrap">{formatDateTime(ap.paymentDeadline)}</span> <span className="muted xs nowrap">{formatRemaining(now, ap.paymentDeadline)}</span></span> },
      ] : [
        { k: '업체가 제안한 방문 시각', v: <VisitText date={ap.visitDate} time={ap.visitTime} strong /> },
        { k: '요청한 방문 가능한 시간', v: slotsText(v.request.slots) },
        { k: '예약금', v: <span className="money strong">{formatWon(depositAmount)}</span> },
        { k: '예약금 결제 기한', v: <span><span className="nowrap">{formatDateTime(ap.paymentDeadline)}</span> <span className="muted xs nowrap">{formatRemaining(now, ap.paymentDeadline)}</span></span> },
        { k: '접수 마감', v: <span className="nowrap">{formatDateTime(ap.groupCloseAt)}</span> },
      ]} />
      <p className="xs muted">방문 시각은 업체의 도착 예정 시각이에요. {DURATION_NOTE} 결제하기 전에는 예약이 확정되지 않아요.</p>
      {rc && <p className="small">새 그룹은 아직 확정된 세대가 없어요. 이 예약을 먼저 확정하면 당장은 <span className="money strong">{formatWon(totalTripFee)}</span> 전액을 혼자 부담할 수도 있어요. 이후 같은 날 이웃이 함께하면 확정된 세대 수로 나눠요.</p>}

      <details className="disclosure">
        <summary>작업 견적·예상 금액<Icon name="chevron" size={16} /></summary>
        <div className="stack">
          {ap.tasks.map((t) => (
            <div key={t.title} className="row row--between row--top">
              <div className="grow"><p className="strong small">{t.title}</p>{t.note && <p className="xs muted">{t.note}</p>}</div>
              <span className="money small">{t.estimate !== null ? formatWon(t.estimate) : '현장 확인'}</span>
            </div>
          ))}
          {ap.materialNote && <p className="small">{ap.materialNote}</p>}
          <dl className="cost__list">
            <CostRow k="그룹 총 출장비" v={<span className="money">{formatWon(totalTripFee)}</span>} />
            <CostRow k={confirmedNow === 0 ? '내 출장비(나 혼자일 때)' : `내 예상 출장비 (확정 ${confirmedNow}세대 + 나)`} v={<span className="money">약 {formatWon(expectedFee)}</span>} />
            <CostRow k="업체 견적 합계" v={est.labor === null ? <span className="small">금액 확인 필요<span className="xs muted" style={{ display: 'block' }}>견적 없음: {est.laborMissing.join(', ')}</span></span> : <span className="money">{formatWon(est.labor)}</span>} />
            <CostRow k="부품·자재 예상" v={<span className="money">{formatWon(est.parts)}</span>} />
            <CostRow k="예상 총액 (최종 금액 아님)" v={est.total === null ? <span className="strong">금액 확인 필요</span> : <span className="money strong">약 {formatWon(est.total)}</span>} strong />
          </dl>
          <p className="xs muted">예약금은 그룹 총 출장비와 같고, 낸 예약금은 최종 금액에서 차감돼요. 최종 금액은 작업이 끝난 뒤 확인해요.</p>
          {ap.discountNote && <p className="xs muted">업체 추가 할인 조건: {ap.discountNote} — 조건 충족이 확인된 뒤 적용돼요.</p>}
        </div>
      </details>
      <details className="disclosure">
        <summary>취소 조건<Icon name="chevron" size={16} /></summary>
        <ul className="stack--sm stack">{ap.cancellationTerms.map((t) => <li key={t} className="small">· {t}</li>)}</ul>
      </details>

      <label className="check">
        <input type="checkbox" checked={checked} onChange={(e) => setConsented(e.target.checked ? ap.version : null)} />
        <span>{rc ? '새 방문 일정과 출장비 조건이 달라졌음을 확인했고, 이 조건으로 예약금 결제에 동의해요.' : '승인 조건과 취소 조건을 확인했고, 예약금 결제에 동의해요.'}</span>
      </label>
    </ActionCard>
  );
}

/** 금액 행(이름 왼쪽 · 금액 오른쪽). 행동 카드의 왼쪽 정렬 KV와 달리 금액 비교는 오른쪽 정렬로 둔다 */
function CostRow({ k, v, strong }: { k: string; v: React.ReactNode; strong?: boolean }) {
  return <div className={`cost__row${strong ? ' cost__row--strong' : ''}`}><dt className="cost__k">{k}</dt><dd className="cost__v">{v}</dd></div>;
}

/** 요청 상세의 예약금 결제 카드(#pay). 승인·결제 대기 상태에서만 그린다 */
export function DepositPaySection({ requestId }: { requestId: string }) {
  const repo = useRepo();
  const q = useAsync(() => repo.getApproval(requestId), [repo, requestId]);
  if (q.error) return <ErrorState error={q.error} onRetry={q.reload} />;
  if (!q.data) return <LoadingBlock />;
  return q.data.request.status === 'approved_pending_payment' ? <Panel v={q.data} reload={q.reload} /> : null;
}

/** 이전 승인 조건 확인·새 조건 확인 주소(/requests/:id/approval·/recheck) → 요청 상세의 예약금 결제 영역(한 번만 바꿔 이동) */
export function ApprovalRedirect() {
  const { id = '' } = useParams();
  return <Navigate to={{ pathname: `/requests/${encodeURIComponent(id)}`, hash: 'pay' }} replace />;
}
