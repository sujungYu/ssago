import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Page } from '../../app/Page';
import { useRepo } from '../../app/context';
import { useAction, useAsync, useAttemptKey } from '../../app/hooks';
import { formatWon } from '../../domain/money';
import { AsyncView, Badge, Banner, Button, Dialog, KV, LinkButton, MockPayNotice, Section } from '../../components/ui';
import type { ProposalView } from '../../data/repositories/types';
import { ActionBar } from '../../app/Page';
import { PhoneButton } from '../../components/ui';
import { formatSlot, isWithinSlots } from '../../domain/visitTime';
import { VisitText, slotsText } from '../shared';

const STATUS = { requested: '업체 응답 대기', proposed: '변경 제안 · 확인 대기', accepted: '수락됨', rejected: '거절됨', withdrawn: '철회됨' } as const;

function Body({ v }: { v: ProposalView }) {
  const repo = useRepo();
  const nav = useNavigate();
  const action = useAction();
  const key = useAttemptKey('prp');
  const [dlg, setDlg] = useState<'reject' | 'withdraw' | null>(null);
  const p = v.proposal;
  const fromProvider = p.origin === 'provider';
  const shortfall = p.cost.additionalDeposit;
  const bookingActive = v.booking.status === 'confirmed';
  // 처음 요청서에 낸 가능 시간 밖의 새 시각이면 알린다. 기존 범위는 고치지 않고 이 제안에 대한 동의로만 처리한다.
  const outside = !!p.newVisit.time && v.booking.customerSlots.length > 0 && !isWithinSlots(p.newVisit.time, v.booking.customerSlots);

  const accept = () => void action.run(async () => {
    const res = await repo.respondToProposal(p.id, 'accept', key.get());
    if (res.tx) nav(`/pay/${res.tx.id}`);
  });
  const reject = () => void action.run(async () => { await repo.respondToProposal(p.id, 'reject', key.get()); setDlg(null); });
  const withdraw = () => void action.run(async () => { await repo.withdrawProposal(p.id); setDlg(null); });

  return (
    <>
      <div className="row row--between row--wrap">
        <h2 style={{ fontSize: 'var(--fs-xl)' }}>{fromProvider ? '업체의 일정 변경 제안' : '내 일정 변경 요청'}</h2>
        <Badge tone={p.status === 'proposed' ? 'action' : p.status === 'accepted' ? 'success' : 'neutral'}>{STATUS[p.status]}</Badge>
      </div>
      <p className="small muted">{v.providerName} · 내가 수락하기 전까지 기존 예약 방문 시각이 유지돼요. 응답하지 않아도 바뀌지 않아요.</p>
      {p.free === 'delay' && <Banner tone="success" title="방문 지연에 따른 무료 변경이에요" />}
      {fromProvider && <Banner tone="info" title="업체 사유 변경이에요">{p.reason}</Banner>}
      {!fromProvider && <Banner tone="info" title="변경 사유">{p.reason}</Banner>}

      <Section title="일정 비교">
        <div className="card"><KV rows={[
          { k: '기존 방문 시각', v: <VisitText date={p.oldVisit.date} time={p.oldVisit.time} /> },
          p.newVisit.time
            ? { k: fromProvider ? '제안된 새 방문 시각' : '업체가 제안한 새 방문 시각', v: <VisitText date={p.newVisit.date} time={p.newVisit.time} strong /> }
            : { k: '새로 가능한 시간', v: <span><span className="nowrap">{p.newVisit.wishSlot ? formatSlot(p.newVisit.wishSlot) : '-'}</span><br /><span className="xs muted">업체가 이 안에서 새 방문 시각을 제안하면 확인할 수 있어요</span></span> },
        ]} />
        {outside && <p className="xs muted" style={{ marginTop: 'var(--sp-2)' }}>처음 요청서에 낸 가능 시간({slotsText(v.booking.customerSlots)}) 밖의 시각이에요. 기존 가능 시간은 바뀌지 않고, 내가 수락해야만 예약이 이 시각으로 바뀌어요.</p>}
        </div>
      </Section>

      <Section title="비용">
        <div className="card stack">
          <KV rows={[
            { k: '변경 비용', v: <span className="money">{formatWon(p.cost.tripFeeCharged)}</span> },
            { k: '추가 결제', v: <span className="money strong">{formatWon(shortfall)}</span> },
          ]} />
          <p className="small">{p.cost.note}</p>
          {v.preview && v.preview.excessUndecided > 0 && <p className="xs muted">새 일정의 예약금이 더 적어 남는 {formatWon(v.preview.excessUndecided)}의 처리 방식은 아직 정해지지 않았어요.</p>}
        </div>
      </Section>

      {shortfall > 0 && p.status === 'proposed' && <MockPayNotice />}
      {action.error && <Banner tone="danger" title={action.error.title}>{action.error.hint}</Banner>}

      {(p.status === 'requested' || p.status === 'proposed') && !fromProvider && (
        <Button variant="ghost" block onClick={() => setDlg('withdraw')}>변경 요청 철회하기</Button>
      )}
      {p.status === 'rejected' && fromProvider && bookingActive && (
        <div className="card stack">
          <Banner tone="info" title="변경을 거절했어요 · 기존 예약이 유지돼요">자동으로 바뀌거나 취소되지 않아요. 업체에 전화해 다른 일정을 협의하거나, 업체 사유로 무료 취소할 수 있어요.</Banner>
          <PhoneButton phone={v.providerPhone} name={v.providerName} />
          <LinkButton to={`/bookings/${p.bookingId}/cancel`} variant="secondary" block>업체 사유 무료 취소 · 환불 금액 확인</LinkButton>
        </div>
      )}
      {p.status === 'accepted' && <LinkButton to={`/bookings/${p.bookingId}`} variant="primary" block>예약 상세 보기</LinkButton>}
      {p.status !== 'accepted' && <LinkButton to={`/bookings/${p.bookingId}`} variant="secondary" block>예약 상세로</LinkButton>}

      {p.status === 'proposed' && (
        <ActionBar note={shortfall > 0 ? `수락하면 ${formatWon(shortfall)}을 모의 결제해요` : '수락하면 일정이 바뀌어요'}>
          <Button variant="primary" block busy={action.busy} onClick={accept}>{shortfall > 0 ? `수락하고 ${formatWon(shortfall)} 모의 결제` : '변경 수락하기'}</Button>
          <Button variant="secondary" block onClick={() => setDlg('reject')}>{fromProvider ? '변경 거절하기 (기존 예약 유지)' : '변경하지 않기'}</Button>
        </ActionBar>
      )}

      {dlg === 'reject' && (
        <Dialog title={fromProvider ? '일정 변경을 거절할까요?' : '변경하지 않을까요?'} onClose={() => setDlg(null)}
          actions={<>
            <Button variant="primary" block busy={action.busy} onClick={reject}>{fromProvider ? '변경 거절하기' : '변경하지 않기'}</Button>
            <Button block onClick={() => setDlg(null)}>돌아가기</Button>
          </>}>
          {fromProvider ? (
            <>
              <p>거절해도 기존 예약(<VisitText date={p.oldVisit.date} time={p.oldVisit.time} />)은 그대로예요. 자동으로 취소되지 않아요.</p>
              <p className="small">거절한 뒤 업체와 다른 일정을 협의하거나, 원하면 업체 사유로 무료 취소할 수 있어요. 업체 사유 취소는 공제 없이 해당 선결제 전체(<span className="money">{formatWon(v.cancelPreview.refundTotal)}</span>)가 환불 대상이에요.</p>
            </>
          ) : <p>제안된 변경을 받아들이지 않고 기존 일정을 유지해요.</p>}
        </Dialog>
      )}
      {dlg === 'withdraw' && (
        <Dialog title="변경 요청을 철회할까요?" onClose={() => setDlg(null)}
          actions={<><Button variant="danger" block busy={action.busy} onClick={withdraw}>요청 철회하기</Button><Button block onClick={() => setDlg(null)}>돌아가기</Button></>}>
          <p>철회해도 기존 예약은 그대로 유지돼요.</p>
        </Dialog>
      )}
    </>
  );
}

/** C-16 변경 제안 확인 */
export function ProposalPage() {
  const { id = '' } = useParams();
  const repo = useRepo();
  const q = useAsync(() => repo.getProposal(id), [repo, id]);
  return (
    <Page title="일정 변경 확인" back={q.data ? `/bookings/${q.data.booking.id}` : '/bookings'}>
      <AsyncView state={q}>{(v) => <Body v={v} />}</AsyncView>
    </Page>
  );
}
