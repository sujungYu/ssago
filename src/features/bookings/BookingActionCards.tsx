import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useRepo } from '../../app/context';
import { useAction, useAttemptKey } from '../../app/hooks';
import { formatDate, formatDateTime } from '../../domain/time';
import { formatWon } from '../../domain/money';
import { ActionCard, Banner, Button, KV, LinkButton, MockPayNotice } from '../../components/ui';
import type { BookingDetail } from '../../data/repositories/types';
import type { AdditionalWork, MaterialOffer } from '../../domain/types';
import { VisitText } from '../shared';

/**
 * 예약 상세 상단 확인 카드(spec 5.17) — 공통 ActionCard 모양만 쓰고 입력·처리는 상황별로 따로 둔다.
 * 응답이 끝나면(동의·거절·결제 성공) 데이터가 바뀌어 카드가 사라지고, 기록은 아래 ‘예약 정보’의 자재·추가 작업 목록과 각 상세에 남는다.
 * 이미 처리된 항목에 다시 응답하면 저장소가 거부하고(change_stale·결제 중복 방지) 화면은 최신 상태로 다시 그린다.
 */

/** 방문 지연: 기존 대응 선택 화면(기다리기·무료 변경·무료 취소)으로 */
export function DelayActionCard({ d }: { d: BookingDetail }) {
  const dl = d.delay!;
  return (
    <ActionCard id={`delay-${dl.id}`} title="방문이 지연되고 있어요"
      actions={<LinkButton to={`/delays/${dl.id}`} variant="primary" block>대응 선택하기</LinkButton>}>
      <KV rows={[
        { k: '예약 방문 일정', v: <VisitText date={dl.originalDate} time={dl.originalVisitTime} /> },
        { k: '변경 도착 예상', v: <span className="nowrap">{formatDateTime(dl.newEta)}</span> },
      ]} />
      <p className="small">기다리기, 무료 변경, 무료 취소 중에서 선택할 수 있어요.</p>
    </ActionCard>
  );
}

/** C. 추가 작업 동의: 내용·비용·일정 영향 + [동의하기]/[동의하지 않기](기존 respondToAdditionalWork). 동의 없이는 작업·금액을 확정하지 않는다 */
export function AdditionalActionCard({ w }: { w: AdditionalWork }) {
  const repo = useRepo();
  const action = useAction();
  const respond = (decision: 'agree' | 'decline') => void action.run(async () => { await repo.respondToAdditionalWork(w.id, decision); });
  return (
    <ActionCard id={`additional-${w.id}`} title="추가 작업에 동의해 주세요"
      actions={<>
        {action.error && <Banner tone="danger" title={action.error.title}>{action.error.hint} 다시 시도할 수 있어요.</Banner>}
        <div className="detail-actions__pair">
          <Button variant="primary" block busy={action.busy} onClick={() => respond('agree')}>동의하기</Button>
          <Button variant="secondary" block disabled={action.busy} onClick={() => respond('decline')}>동의하지 않기</Button>
        </div>
      </>}>
      <p className="strong">{w.scope}</p>
      <p className="small">{w.reason}</p>
      <KV rows={[
        { k: '추가 금액', v: <span className="money strong">{formatWon(w.amount)}</span> },
        { k: '일정 영향', v: w.followUp ? <span>후속 방문 <span className="nowrap">{formatDate(w.followUp.date)}</span> <span className="nowrap">{w.followUp.window}</span></span> : '추가 방문 없음' },
      ]} />
      <p className="xs muted">동의하면 {formatWon(w.amount)}이 최종 금액에 반영돼요. 동의하지 않으면 추가 비용은 청구되지 않아요.</p>
    </ActionCard>
  );
}

/**
 * D. 자재 확인·선결제 동의: 사양·수량·금액·납기·취소 조건 + 동의 체크 + [동의하고 {금액} 모의 결제](기존 agreeAndPayMaterial).
 * 자재는 선결제해야 업체가 주문하는 조건이라 결제 행동이 있다. 실패하면 동의·입력을 그대로 두고 다시 시도, 결과 확인 중이면 카드가 사라지고 예약 정보에 결제 상태로 남는다.
 */
export function MaterialActionCard({ m }: { m: MaterialOffer }) {
  const repo = useRepo();
  const nav = useNavigate();
  const action = useAction();
  const key = useAttemptKey('mat');
  const [ok, setOk] = useState(false);
  const pay = () => void action.run(async () => { const r = await repo.agreeAndPayMaterial(m.id, key.get()); nav(`/pay/${r.tx.id}`); });
  return (
    <ActionCard id={`material-${m.id}`} title="자재 주문 조건을 확인해 주세요"
      actions={<>
        {action.error && <Banner tone="danger" title={action.error.title}>{action.error.hint} 다시 시도할 수 있어요.</Banner>}
        <Button variant="primary" block disabled={!ok} busy={action.busy} onClick={pay}>
          {action.busy ? '결제 진행 중… 화면을 닫지 마세요' : `동의하고 ${formatWon(m.price)} 모의 결제`}
        </Button>
        <MockPayNotice compact />
      </>}>
      <KV rows={[
        { k: '자재', v: <span>{m.name}<span className="xs muted" style={{ display: 'block' }}>{m.spec} · {m.quantity}개</span></span> },
        { k: '금액', v: <span className="money strong">{formatWon(m.price)}</span> },
        { k: '납기', v: formatDate(m.deliveryDate) },
      ]} />
      <p className="small">{m.cancellationTerms}</p>
      {m.nonRefundableIfCancelled > 0 && <p className="xs muted">주문·제작이 시작된 뒤 취소하면 회수 불가능한 실제 비용 최대 {formatWon(m.nonRefundableIfCancelled)}이 출장비와 별도로 공제될 수 있어요.</p>}
      <p className="xs muted">선결제해야 업체가 주문해요. 결제 전에는 청구되지 않아요.</p>
      <label className="check">
        <input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} />
        <span>자재 조건과 취소 조건을 확인했고, {formatWon(m.price)} 선결제에 동의해요.</span>
      </label>
    </ActionCard>
  );
}
