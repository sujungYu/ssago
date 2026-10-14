import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useRepo } from '../../app/context';
import { useAction, useAttemptKey } from '../../app/hooks';
import { formatDate, formatDateTime } from '../../domain/time';
import { formatWon } from '../../domain/money';
import { ActionCard, Banner, Button, Fold, KV, LinkButton } from '../../components/ui';
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
 * D. 자재 확인·선결제 동의: 사양·수량·금액·납기·취소 조건 + 동의 체크 + [{금액} 결제하기](기존 agreeAndPayMaterial).
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
          {action.busy ? '결제 진행 중… 화면을 닫지 마세요' : `${formatWon(m.price)} 결제하기`}
        </Button>
      </>}>
      <KV rows={[
        { k: '자재', v: <span>{m.name}<span className="xs muted" style={{ display: 'block' }}>{m.spec} · {m.quantity}개</span></span> },
        { k: '금액', v: <span className="money strong">{formatWon(m.price)}</span> },
        { k: '납기', v: formatDate(m.deliveryDate) },
      ]} />
      {/* 결제 전 동의 화면이라 주문 전이라도 자재 취소 조건 표를 펼쳐 보여준다(실제 비용 발생 여부와 무관, spec 5.40). 접수 마감은 자재 기준이 아니라 두지 않는다 */}
      <div className="mat-note"><p>결제 후 업체가 주문·제작을 시작해요.</p></div>
      <MaterialCancelTerms id={`mat-cancel-${m.id}`} />
      <label className="check">
        <input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} />
        <span>자재 조건과 취소 조건을 확인했고, {formatWon(m.price)} 선결제에 동의해요.</span>
      </label>
    </ActionCard>
  );
}

/**
 * 자재 취소 조건 표(spec 5.40). 요청 상세 ‘취소 조건’ 표(.pay-terms)와 같은 모양 — 흰 바탕, 가로 구분선만, 두 열 왼쪽 정렬.
 * 요청 상세 ‘취소 조건’과 같은 펼치기(Fold, 파란 제목 + 오른쪽 화살표, 버튼 aria-expanded). 처음엔 접힌 상태(spec 5.43).
 * 표와 아래 안내만 접힘 영역 — 자재 정보·주문 안내·동의 체크·결제 버튼은 밖. 금액은 넣지 않는다(실제 차감은 기존 자재 정책 materialDeductionOf).
 */
export function MaterialCancelTerms({ id }: { id: string }) {
  return (
    <div className="folds mat-cancel-fold">
    <Fold id={id} title="자재 취소 조건">
      <table className="pay-terms">
        <thead><tr><th scope="col">취소 시점·사유</th><th scope="col">환불 기준</th></tr></thead>
        <tbody>
          <tr><th scope="row">자재 결제 전</th><td>비용 없이 취소</td></tr>
          <tr><th scope="row">결제 후 주문·제작 전</th><td>자재 선결제금 전액 환불</td></tr>
          <tr><th scope="row">주문·제작 시작 후</th><td>사전 동의한 실제 회수 불가 비용 차감 후 환불</td></tr>
          <tr><th scope="row">업체 사유 취소</th><td>자재 선결제금 전액 환불</td></tr>
        </tbody>
      </table>
      <p className="xs muted">차감 금액과 근거는 취소 전에 안내해요. 출장비 취소 조건은 별도로 적용돼요.</p>
    </Fold>
    </div>
  );
}
