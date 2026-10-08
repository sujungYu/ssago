import { useParams } from 'react-router-dom';
import { Page } from '../../app/Page';
import { useRepo } from '../../app/context';
import { useAction, useAsync } from '../../app/hooks';
import { formatDate, formatDateTime } from '../../domain/time';
import { AsyncView, Banner, Button, KV, LinkButton, PhoneButton, Section } from '../../components/ui';

const CHOICE = { wait: '기다리기를 선택했어요', free_change: '무료 일정 변경을 요청했어요', free_cancel: '무료 취소를 선택했어요' } as const;

/** C-18 지연 안내·대응 선택. 세 선택지는 동등하게 보여주고, 추천하거나 미리 선택하지 않는다. */
export function DelayPage() {
  const { id = '' } = useParams();
  const repo = useRepo();
  const q = useAsync(() => repo.getDelay(id), [repo, id]);
  const action = useAction();
  return (
    <Page title="방문 지연 안내" back={q.data ? `/bookings/${q.data.booking.id}` : '/bookings'}>
      <AsyncView state={q}>
        {({ delay, booking, providerName, providerPhone }) => (
          <>
            <Banner tone="warn" title={`${providerName}의 방문이 늦어지고 있어요`}>아래 세 가지 중에서 직접 선택해 주세요. 어느 쪽도 추천하거나 자동으로 선택하지 않아요.</Banner>
            <div className="card stack">
              <KV rows={[
                { k: '원래 시간대', v: <span>{formatDate(delay.originalDate)}<br />{delay.originalWindow}</span> },
                { k: '변경된 도착 예상', v: <span className="nowrap strong">{formatDateTime(delay.newEta)}</span> },
              ]} />
              <PhoneButton phone={providerPhone} name={providerName} />
            </div>
            {delay.status === 'resolved' ? (
              <>
                <Banner tone="info" title={delay.choice ? CHOICE[delay.choice] : '지연 안내가 처리됐어요'}>선택하신 내용은 예약 상세에서 확인할 수 있어요.</Banner>
                <LinkButton to={`/bookings/${booking.id}`} variant="primary" block>예약 상세 보기</LinkButton>
              </>
            ) : (
              <Section title="어떻게 할까요?">
                <div className="stack">
                  <div className="card stack--sm stack">
                    <h3>기다리기</h3>
                    <p className="small muted">예약은 그대로 유지돼요. 변경 도착 시간에 맞춰 업체가 방문해요.</p>
                    <Button variant="secondary" block busy={action.busy} onClick={() => void action.run(async () => { await repo.respondToDelayWait(delay.id); })}>기다리기로 해요</Button>
                  </div>
                  <div className="card stack--sm stack">
                    <h3>무료로 일정 변경</h3>
                    <p className="small muted">변경 수수료 없이 다른 날짜·시간으로 바꿔요. 확정 출장비는 유지돼요.</p>
                    <LinkButton to={`/bookings/${booking.id}/change?delay=${delay.id}`} variant="secondary" block>일정 변경 요청하기</LinkButton>
                  </div>
                  <div className="card stack--sm stack">
                    <h3>무료로 취소</h3>
                    <p className="small muted">공제 없이 해당 선결제가 환불 대상이에요. 환불 금액은 다음 화면에서 확인해요.</p>
                    <LinkButton to={`/bookings/${booking.id}/cancel`} variant="secondary" block>취소·환불 금액 확인하기</LinkButton>
                  </div>
                </div>
              </Section>
            )}
            {action.error && <Banner tone="danger" title={action.error.title}>{action.error.hint}</Banner>}
          </>
        )}
      </AsyncView>
    </Page>
  );
}
