import { useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { useRepo } from '../../app/context';
import { useAction, useAsync, useAttemptKey } from '../../app/hooks';
import { formatDateTime, formatRemaining } from '../../domain/time';
import { formatWon } from '../../domain/money';
import { approvalEstimate } from '../../domain/approvalCost';
import type { ApprovalView } from '../../data/repositories/types';
import { ActionCard, Banner, Button, ErrorState, Fold, LoadingBlock } from '../../components/ui';
import { PAYMENT_STATUS, VisitText } from '../shared';

/**
 * 예약금 결제(요청 상세 안, spec 5.16). 업체가 승인한 요청에서 조건을 확인·동의하고 바로 예약금을 결제한다(별도 승인 조건 화면 없음).
 * - 기본 화면(spec 5.20): 방문 일정 · 예상 총금액 · 지금 결제할 예약금(연한 블루 강조) · 예약금 결제 기한만. 견적 상세·취소 조건은 접힌 펼치기
 * - 새 조건(공동 예약 종료로 일정·금액이 바뀜): 이전 → 새 일정·예약금을 간결하게 비교하고, 확인 체크 전에는 결제할 수 없다
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
  // 본인은 결제 전이라 확정 세대에 없다(예약이 이어진 요청이면 포함된 것으로 보고 중복으로 더하지 않는다)
  const est = approvalEstimate(ap, v.group?.confirmedHouseholds ?? 0, { selfConfirmed: !!v.request.bookingId, confirmedTripFee: v.confirmedTripFee });
  const { totalTripFee, myTripFee: expectedFee } = est;
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

  const deadline = <span><span className="nowrap">{formatDateTime(ap.paymentDeadline)}</span> <span className="muted small nowrap">· {formatRemaining(now, ap.paymentDeadline)}</span></span>;
  const closeAt = rc ? rc.newCloseAt : ap.groupCloseAt;
  return (
    <ActionCard id="pay" className="pay-card" title="방문 일정과 금액을 확인해 주세요" head={inflight ? '결제 결과를 확인하고 있어요' : undefined}
      actions={<>
        {/* 확인 체크(문구를 눌러도 선택) → 결제 버튼 → 모의 결제 안내. 고정 하단 영역 없이 카드 안 일반 흐름 */}
        <label className="pay-check">
          <input type="checkbox" checked={checked} onChange={(e) => setConsented(e.target.checked ? ap.version : null)} />
          <span>{rc ? '바뀐 방문 일정과 금액, 취소 조건을 확인했어요.' : '방문 일정과 금액, 취소 조건을 확인했어요.'}</span>
        </label>
        {action.error && (
          <Banner tone="danger" title={action.error.title}>
            {action.error.hint}
            {action.error.code === 'version_changed' && ' 변경된 내용을 다시 확인하고 동의해 주세요.'}
          </Banner>
        )}
        <Button variant="primary" block disabled={!checked || !!inflight} busy={action.busy} onClick={pay}>
          {action.busy ? '결제 진행 중… 화면을 닫지 마세요' : `예약금 ${formatWon(depositAmount)} 결제하기`}
        </Button>
      </>}>
      {inflight && (
        <p className="small">{PAYMENT_STATUS[inflight.status].label} · 결제 결과를 확인하는 중이라 다시 결제할 수 없어요. <Link to={`/pay/${inflight.id}`}>결제 결과 확인하기</Link></p>
      )}
      {/* 요청 당시와 달라진 조건(조건 재확인): 실제 종료 사유 + 이전 → 새 일정·예약금만 간결하게. 동의 전에는 결제할 수 없다 */}
      {rc && (
        <>
          <p className="small">{rc.endedGroupNote} 일정과 금액이 바뀌었어요. 새 날짜는 아직 확정된 세대가 없어 출장비 <span className="money strong">{formatWon(totalTripFee)}</span> 전액을 혼자 부담할 수도 있어요.</p>
          <div className="sched-compare">
            <div className="sched-compare__item"><span className="sched-compare__k">이전 일정 (종료됨)</span><span className="sched-compare__v"><VisitText date={ap.visitDate} time={ap.visitTime} /></span>
              {rc.newDepositAmount !== ap.depositAmount && <span className="xs muted">예약금 {formatWon(ap.depositAmount)}</span>}</div>
            <div className="sched-compare__item sched-compare__item--new"><span className="sched-compare__k">새 방문 일정</span><span className="sched-compare__v"><VisitText date={rc.newVisitDate} time={rc.newVisitTime} /></span>
              {rc.newDepositAmount !== ap.depositAmount && <span className="xs">예약금 {formatWon(rc.newDepositAmount)}</span>}</div>
          </div>
        </>
      )}

      <dl className="pay-sum">
        <div className="pay-sum__row">
          <dt>방문 일정</dt>
          <dd><VisitText date={rc ? rc.newVisitDate : ap.visitDate} time={rc ? rc.newVisitTime : ap.visitTime} strong /></dd>
        </div>
        <div className="pay-sum__row">
          <dt>예상 총금액</dt>
          <dd>{est.total === null ? <span className="strong">금액 확인 필요</span> : <span className="money strong">약 {formatWon(est.total)}</span>}</dd>
        </div>
      </dl>
      <p className="xs muted pay-note">
        {est.tripFeeConfirmed
          ? <>작업 견적·자재비·내 출장비를 포함한 금액이에요.<br />자재비에 따라 달라질 수 있어요.</>
          : <>작업 견적·자재비·참여 시 예상 출장비를 포함한 금액이에요.<br />자재비와 참여 세대 수에 따라 달라질 수 있어요.</>}
        {est.total === null && <><br />견적이 없는 작업({est.laborMissing.join(', ')})이 있어 아직 합산하지 않았어요.</>}
      </p>

      {/* 지금 결제할 예약금: 예상 총금액과 구분되는 연한 블루 강조 영역 */}
      <div className="pay-deposit">
        <span className="pay-deposit__k">지금 결제할 예약금</span>
        <span className="pay-deposit__v money">{formatWon(depositAmount)}</span>
      </div>
      <p className="xs muted pay-note">예약금은 최종 정산 시 차감돼요.</p>

      <dl className="pay-sum">
        <div className="pay-sum__row"><dt>예약금 결제 기한</dt><dd>{deadline}</dd></div>
      </dl>

      <div className="folds">
        <Fold id="pay-estimate" title="견적 상세">
          <ul className="pay-tasks">
            {ap.tasks.map((t) => (
              <li key={t.title} className="row row--between row--top">
                <div className="grow"><p className="strong small">{t.title}</p>{t.note && <p className="xs muted">{t.note}</p>}</div>
                <span className="money small nowrap">{t.estimate !== null ? formatWon(t.estimate) : '현장 확인'}</span>
              </li>
            ))}
          </ul>
          <dl className="cost__list">
            <CostRow k="작업 견적 합계" v={est.labor === null ? <span className="small">금액 확인 필요<span className="xs muted" style={{ display: 'block' }}>견적 없음: {est.laborMissing.join(', ')}</span></span> : <span className="money">{formatWon(est.labor)}</span>} />
            <CostRow k="부품·자재 예상" v={<span className="money">{formatWon(est.parts)}</span>} />
            {/* 예상 총금액에 들어간 값과 같은 출장비(est.myTripFee). 확정됐으면 ‘내 출장비’ 확정 금액 */}
            <CostRow k={est.tripFeeConfirmed ? '내 출장비' : '참여 시 예상 출장비'} v={<span className="money">{est.tripFeeConfirmed ? '' : '약 '}{formatWon(expectedFee)}</span>} />
            <CostRow k="예상 총금액" v={est.total === null ? <span className="strong">금액 확인 필요</span> : <span className="money strong">약 {formatWon(est.total)}</span>} strong />
          </dl>
          {/* 세대 분담 안내: 공동 예약(분담 2세대 이상)이고 출장비가 아직 확정 전일 때만. 세대 = 결제 완료 확정 세대 + 본인(결제 대기 자리 제외) */}
          {est.joint && !est.tripFeeConfirmed && (
            <p className="xs muted">예약이 확정되면 총 출장비 {formatWon(totalTripFee)}을 나를 포함한 {est.householdsWithMe}세대가 나눠요.<br />출장비는 접수 마감 때 확정된 세대 수에 따라 달라질 수 있어요.</p>
          )}
          {ap.materialNote && <p className="xs muted">자재: {ap.materialNote}</p>}
        </Fold>
        <Fold id="pay-cancel" title="취소 조건">
          {/* 실제 구현된 취소 정책(domain/pricing previewCancellation)과 같은 기준. 접수 마감 = 이 방문 날짜의 공동 예약 접수 마감(새 조건이면 새 마감) */}
          <p className="pay-terms__close">접수 마감 · <span className="nowrap">{formatDateTime(closeAt)}</span></p>
          <table className="pay-terms">
            <thead><tr><th scope="col">취소 시점·사유</th><th scope="col">환불 기준</th></tr></thead>
            <tbody>
              <tr><th scope="row">예약금 결제 전</th><td>비용 없이 요청 취소</td></tr>
              <tr><th scope="row">접수 마감 전</th><td>예약금 전액 환불</td></tr>
              <tr><th scope="row">접수 마감 후</th><td>내 확정 출장비 차감 후 환불</td></tr>
              <tr><th scope="row">업체 사유 취소</th><td>결제한 금액 전액 환불</td></tr>
            </tbody>
          </table>
          {/* 별도 주문 자재 조건이 있는 요청에만(부품·자재 예상 금액만으로는 표시하지 않음). 차감 여부·금액은 기존 자재 정책 그대로 */}
          {v.hasOrderedMaterialTerms && (
            <p className="xs muted"><span className="strong">별도 주문 자재</span><br />주문 전 동의한 자재의 회수 불가 비용이 있다면 추가로 차감돼요.</p>
          )}
        </Fold>
      </div>
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
