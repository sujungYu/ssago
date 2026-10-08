import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Page } from '../../app/Page';
import { useRepo } from '../../app/context';
import { useAction, useAsync, useAttemptKey } from '../../app/hooks';
import { formatDate } from '../../domain/time';
import { formatWon } from '../../domain/money';
import { AsyncView, Badge, Banner, Button, Dialog, KV, LinkButton, MockPayNotice, Section } from '../../components/ui';
import type { ProposalView } from '../../data/repositories/types';
import { ActionBar } from '../../app/Page';

const STATUS = { requested: '업체 응답 대기', proposed: '확인 필요', accepted: '수락됨', rejected: '거절됨', withdrawn: '철회됨' } as const;

function Body({ v }: { v: ProposalView }) {
  const repo = useRepo();
  const nav = useNavigate();
  const action = useAction();
  const key = useAttemptKey('prp');
  const [dlg, setDlg] = useState<'reject' | 'withdraw' | null>(null);
  const p = v.proposal;
  const fromProvider = p.origin === 'provider';
  const shortfall = p.cost.additionalDeposit;

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
      <p className="small muted">{v.providerName} · 합의 전까지 기존 일정이 유지돼요.</p>
      {p.free === 'delay' && <Banner tone="success" title="방문 지연에 따른 무료 변경이에요" />}
      {fromProvider && <Banner tone="info" title="업체 사유 변경이에요">{p.reason}</Banner>}
      {!fromProvider && <Banner tone="info" title="변경 사유">{p.reason}</Banner>}

      <Section title="일정 비교">
        <div className="card"><KV rows={[
          { k: '기존 일정', v: <span>{formatDate(p.oldVisit.date)}<br />{p.oldVisit.window}</span> },
          { k: '새 일정', v: <span className="strong">{formatDate(p.newVisit.date)}<br />{p.newVisit.window}</span> },
        ]} /></div>
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
      {p.status === 'accepted' && <LinkButton to={`/bookings/${p.bookingId}`} variant="primary" block>예약 상세 보기</LinkButton>}
      {p.status !== 'accepted' && <LinkButton to={`/bookings/${p.bookingId}`} variant="secondary" block>예약 상세로</LinkButton>}

      {p.status === 'proposed' && (
        <ActionBar note={shortfall > 0 ? `수락하면 ${formatWon(shortfall)}을 모의 결제해요` : '수락하면 일정이 바뀌어요'}>
          <Button variant="primary" block busy={action.busy} onClick={accept}>{shortfall > 0 ? `수락하고 ${formatWon(shortfall)} 모의 결제` : '변경 수락하기'}</Button>
          <Button variant="secondary" block onClick={() => setDlg('reject')}>{fromProvider ? '수락하지 않고 환불받으며 취소하기' : '변경하지 않기'}</Button>
        </ActionBar>
      )}

      {dlg === 'reject' && (
        <Dialog title={fromProvider ? '수락하지 않고 예약을 취소할까요?' : '변경하지 않을까요?'} onClose={() => setDlg(null)}
          actions={<>
            <Button variant={fromProvider ? 'danger' : 'primary'} block busy={action.busy} onClick={reject}>{fromProvider ? '환불받으며 취소하기' : '변경하지 않기'}</Button>
            <Button block onClick={() => setDlg(null)}>돌아가기</Button>
          </>}>
          {fromProvider ? (
            <>
              <p>업체 사유 변경이라 수수료와 공제 없이 해당 선결제 전체가 환불 대상이에요.</p>
              <KV rows={[{ k: '환불 요청 금액', v: <span className="money strong">{formatWon(v.cancelPreview.refundTotal)}</span> }]} />
              <p className="xs muted">환불은 ‘처리 요청’이 접수되는 것이고, 카드·계좌에 실제 반영되는 시점은 결제수단에 따라 달라요.</p>
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
