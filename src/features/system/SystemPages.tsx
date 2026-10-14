import { Navigate, useParams } from 'react-router-dom';
import { Page } from '../../app/Page';
import { useRepo } from '../../app/context';
import { useAsync } from '../../app/hooks';
import { describeError } from '../../domain/errors';
import { Banner, Fold, LinkButton, LoadingBlock, Section } from '../../components/ui';

/** S-02 알림 진입. 대상 화면으로 이동하되, 알림 이후 상태가 바뀌었으면 최신 상태를 안내한다. */
export function NoticePage() {
  const { id = '' } = useParams();
  const repo = useRepo();
  const q = useAsync(() => repo.resolveNotice(id), [repo, id]);
  if (q.data) return <Navigate to={q.data.path} replace state={q.data.staleMessage ? { notice: q.data.staleMessage } : null} />;
  if (q.error) return <NotFoundPage reason={describeError(q.error).title} />;
  return <Page title="알림 확인" back="/"><LoadingBlock label="알림 내용을 확인하는 중이에요" /></Page>;
}

/** S-05 상태·접근 안내 */
export function NotFoundPage({ reason }: { reason?: string }) {
  return (
    <Page title="확인할 수 없어요" back="/">
      <Banner tone="warn" title={reason ?? '찾을 수 없는 화면이에요'}>삭제되었거나 볼 수 있는 권한이 없는 내용일 수 있어요. 아래에서 내 예약(보낸 요청·확정된 예약·완료·취소)을 확인해 주세요.</Banner>
      <div className="stack--sm stack">
        <LinkButton to="/bookings" variant="primary" block>내 예약 보기</LinkButton>
        <LinkButton to="/" variant="secondary" block>업체 찾기</LinkButton>
      </div>
    </Page>
  );
}

/**
 * S-03 서비스 이용 안내. 서비스 규칙 요약(항목별 흰 카드) + FAQ(기존 펼치기 `Fold`, 처음엔 모두 접힘) + 작은 데모 안내.
 * 정식 이용약관·개인정보처리방침이 아니며(문안은 법률 검토 전) 그 문서로 표시·연결하지 않는다.
 */
export function GuidePage() {
  const items: [string, string[]][] = [
    ['예약 확정', ['업체가 요청을 승인한 뒤 예약금을 결제하면 예약이 확정돼요.', '예약금 결제 기한은 요청 상세에서 확인할 수 있어요.']],
    ['공동 예약과 출장비', ['같은 날 같은 업체를 부르는 이웃과 출장비를 나눠요.', '결제 대기자는 참여 확정 세대 수에 포함되지 않아요.', '내 출장비는 접수 마감 때 확정된 세대 수로 정해져요.']],
    ['일정 변경·취소', ['일정 변경은 상대방이 수락한 뒤 확정돼요.', '접수 마감 전 취소에는 출장비 공제가 없어요.', '마감 후 취소에는 내 확정 출장비가 공제돼요. 다른 세대의 출장비는 늘어나지 않아요.', '업체 사유로 취소되면 결제한 금액을 전액 환불해요.', '주문 자재의 취소 비용은 결제 전 안내되고 동의한 조건에 따라 실제 발생 비용만 반영돼요.']],
    ['추가 작업과 최종 정산', ['추가 작업은 내용과 비용에 동의한 뒤 진행해요.', '작업이 끝나면 실제 작업 내용과 최종 금액을 확인해요.', '결제한 예약금과 선결제 금액을 차감해 추가 결제 또는 환불 금액을 계산해요.', '금액이 다르면 ‘금액이 달라요’를 선택해 업체와 확인해주세요.']],
    ['업체 연락과 사후 처리', ['업체와의 연락은 상세 화면의 전화 버튼을 이용해주세요.', '사후 처리는 업체가 안내한 조건에 따라 진행돼요. 싸고가 공통 A/S를 보장하지는 않아요.']],
    ['내 정보 공개 범위', ['정확한 주소와 연락처, 작업 내용·사진은 나와 요청받은 업체만 볼 수 있어요.', '다른 참여 세대에게는 세대 수와 접수 마감, 출장비 등 공동 예약 정보만 보여요.']],
  ];
  const faqs: [string, string][] = [
    ['업체가 승인했는데 왜 예약이 확정되지 않나요?', '업체 승인만으로는 예약이 확정되지 않아요. 안내된 기한 안에 예약금을 결제해야 예약이 확정돼요.'],
    ['예약금과 내 출장비는 왜 다른가요?', '예약금은 예약을 확정하기 위해 미리 결제하는 금액이고, 내 출장비는 함께 예약한 세대가 나눠 부담하는 금액이에요. 결제한 예약금은 최종 정산에서 차감돼요.'],
    ['혼자 예약해도 되나요?', '가능해요. 접수 마감 때 함께 예약한 이웃이 없으면 기본 출장비를 부담해요.'],
    ['이웃과 같은 수리를 요청해야 하나요?', '같은 업체가 제공하는 작업이라면 서로 다른 수리도 요청할 수 있어요. 실제 작업 가능 여부는 업체가 요청서를 확인한 뒤 안내해요.'],
    ['업체가 제안한 새 일정에 방문받기 어려우면 어떻게 하나요?', '예약 상세에서 ‘다른 일정 요청’을 선택해 방문 가능한 일정을 전달해주세요.'],
    ['최종 금액이 예상과 다르면 어떻게 하나요?', '최종 정산 화면에서 ‘금액이 달라요’를 선택하고 업체와 확인해주세요.'],
  ];
  return (
    <Page title="서비스 이용 안내" back="history">
      {items.map(([t, ls]) => (
        <Section key={t} title={t}><ul className="card stack--sm stack">{ls.map((l) => <li key={l} className="small">· {l}</li>)}</ul></Section>
      ))}
      <Section title="FAQ">
        <div className="card faq">
          {faqs.map(([q, a], i) => <Fold key={q} id={`faq-${i + 1}`} title={q}><p className="small">{a}</p></Fold>)}
        </div>
      </Section>
      <p className="small muted">데모에서는 결제·환불이 모의로 진행되며 실제 금액이 청구되지 않아요.</p>
    </Page>
  );
}
