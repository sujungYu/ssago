import { Navigate, useParams } from 'react-router-dom';
import { Page } from '../../app/Page';
import { useRepo } from '../../app/context';
import { useAsync } from '../../app/hooks';
import { describeError } from '../../domain/errors';
import { Banner, LinkButton, LoadingBlock, Section } from '../../components/ui';

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
      <Banner tone="warn" title={reason ?? '찾을 수 없는 화면이에요'}>삭제되었거나 볼 수 있는 권한이 없는 내용일 수 있어요. 아래에서 내 요청·예약을 확인해 주세요.</Banner>
      <div className="stack--sm stack">
        <LinkButton to="/requests" variant="primary" block>내 요청 보기</LinkButton>
        <LinkButton to="/bookings" variant="secondary" block>내 예약 보기</LinkButton>
        <LinkButton to="/" variant="secondary" block>업체 찾기</LinkButton>
      </div>
    </Page>
  );
}

/** S-03 이용 안내·약관·개인정보. 실제 약관 문안과 법률 검토는 미정이라 서비스 규칙 요약만 둔다. */
export function GuidePage() {
  const items: [string, string[]][] = [
    ['예약이 확정되는 때', ['요청이 승인되어도 예약은 확정되지 않아요.', '결제 기한 안에 예약금을 결제하면 예약이 확정돼요.', '결제 기한은 승인 후 24시간 또는 공동 예약 접수 마감 중 빠른 시각이에요.']],
    ['출장비 분담', ['같은 업체를 같은 날 예약한 이웃과 확정된 세대 수로 출장비를 나눠요.', '결제 대기 중인 자리는 세대 수에 포함하지 않아요.', '마감 전에는 예상 출장비이고, 마감 때 확정돼요.']],
    ['취소와 환불', ['마감 전 취소는 출장비 공제가 없어요.', '마감 후 취소는 내 확정 출장비가 공제돼요. 다른 세대의 출장비는 바뀌지 않아요.', '자재비 공제는 출장비와 별도 항목이며, 동의한 조건의 회수 불가능한 실제 비용만 해당돼요.', '업체 사유 취소는 해당 선결제가 전액 환불 대상이에요.', '환불은 ‘처리 요청’과 카드·계좌 ‘실제 반영’ 시점이 달라요.']],
    ['추가 작업과 최종 금액', ['추가 작업은 동의해야 청구돼요.', '최종 금액은 실제 작업 내용으로 확인하고, 동의 없이 자동 청구하지 않아요.', '금액 이견이 있으면 합의 전까지 정산을 보류해요.']],
    ['연락과 사후 처리', ['연락은 전화로 해요. 앱 안 채팅은 제공하지 않아요.', '사후 처리는 업체가 제시한 조건에 따라요. 온김에가 공통 A/S를 보증하지 않아요.']],
    ['개인정보', ['내 주소·작업 내용·사진은 나와 요청을 받은 업체만 볼 수 있어요.', '공동 예약의 다른 세대에게는 세대 수, 마감, 출장비 같은 집계만 보여요.']],
  ];
  return (
    <Page title="이용 안내·약관·개인정보" back="history">
      <Banner tone="warn" title="요약 안내예요">실제 약관과 개인정보 처리방침 문안은 법률 검토 전이라 이 화면에 없어요. 아래는 서비스 규칙 요약이에요.</Banner>
      {items.map(([t, ls]) => (
        <Section key={t} title={t}><ul className="card stack--sm stack">{ls.map((l) => <li key={l} className="small">· {l}</li>)}</ul></Section>
      ))}
    </Page>
  );
}
