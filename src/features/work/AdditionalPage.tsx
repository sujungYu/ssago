import { useParams } from 'react-router-dom';
import { Page } from '../../app/Page';
import { useRepo } from '../../app/context';
import { useAction, useAsync } from '../../app/hooks';
import { formatDate } from '../../domain/time';
import { formatWon } from '../../domain/money';
import { AsyncView, Banner, Button, KV, LinkButton, Section } from '../../components/ui';

/** C-20 추가 작업 확인. 동의 없이는 금액이 청구되지 않는다. */
export function AdditionalPage() {
  const { id = '' } = useParams();
  const repo = useRepo();
  const q = useAsync(() => repo.getAdditionalWork(id), [repo, id]);
  const action = useAction();
  return (
    <Page title="추가 작업 확인" back={q.data ? `/bookings/${q.data.booking.id}` : '/bookings'}>
      <AsyncView state={q}>
        {({ work: w, booking, providerName }) => (
          <>
            <Banner tone="info" title="동의하기 전에는 비용이 청구되지 않아요">{providerName}가 작업 중 추가로 필요한 내용을 알려왔어요.</Banner>
            <div className="card stack">
              <h2 style={{ fontSize: 'var(--fs-lg)' }}>{w.scope}</h2>
              <p className="small">{w.reason}</p>
              <KV rows={[
                { k: '추가 금액', v: <span className="money strong">{formatWon(w.amount)}</span> },
                ...(w.followUp ? [{ k: '후속 방문', v: <span>{formatDate(w.followUp.date)}<br />{w.followUp.window}</span> }] : []),
              ]} />
            </div>
            {w.status === 'proposed' ? (
              <Section title="어떻게 할까요?">
                <div className="stack--sm stack">
                  <Button variant="secondary" block busy={action.busy} onClick={() => void action.run(async () => { await repo.respondToAdditionalWork(w.id, 'agree'); })}>동의하고 추가 작업 진행</Button>
                  <Button variant="secondary" block busy={action.busy} onClick={() => void action.run(async () => { await repo.respondToAdditionalWork(w.id, 'decline'); })}>동의하지 않아요</Button>
                </div>
                <p className="xs muted">동의하면 {formatWon(w.amount)}이 최종 금액에 반영돼요. 동의하지 않으면 추가 비용은 청구되지 않아요. 기존 작업 진행 여부는 업체와 전화로 확인해 주세요.</p>
              </Section>
            ) : (
              <Banner tone={w.status === 'agreed' ? 'success' : 'info'} title={w.status === 'agreed' ? '추가 작업에 동의했어요' : '추가 작업에 동의하지 않았어요'}>
                {w.status === 'agreed' ? '동의한 금액은 최종 금액 확인 때 반영돼요.' : '추가 비용은 청구되지 않아요. 남은 작업은 업체와 전화로 확인해 주세요.'}
              </Banner>
            )}
            {action.error && <Banner tone="danger" title={action.error.title}>{action.error.hint}</Banner>}
            <LinkButton to={`/bookings/${booking.id}`} variant="secondary" block>예약 상세 보기</LinkButton>
          </>
        )}
      </AsyncView>
    </Page>
  );
}
