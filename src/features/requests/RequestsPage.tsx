import { Link } from 'react-router-dom';
import { useRepo } from '../../app/context';
import { REQUEST_STATUS } from '../../domain/rules';
import { formatDate, formatRemaining, seoulYmd } from '../../domain/time';
import { formatYmdDots } from '../../domain/requestFilter';
import { Icon } from '../../components/Icon';
import { Badge } from '../../components/ui';
import type { FilteredBundleListItem } from '../../data/repositories/types';
import type { RequestStatus } from '../../domain/types';

export function RequestBadge({ status, recheck }: { status: RequestStatus; recheck?: boolean }) {
  const s = REQUEST_STATUS[status];
  return <Badge tone={s.tone}>{recheck ? '새 조건 확인 필요' : s.label}</Badge>;
}

/** 예약으로 이어지지 않고 끝난 요청(업체 거절·철회·승인 만료 등) */
const isEnded = (s: RequestStatus) => !['reviewing', 'needs_info', 'approved_pending_payment', 'booked'].includes(s);

/** 묶음에 표시되는 요청들의 요청 접수일(한국 날짜). 여러 날이면 범위로 */
function receivedLabel(b: FilteredBundleListItem): string {
  const days = [...new Set(b.items.map((i) => seoulYmd(i.request.createdAt)))].sort();
  const first = formatYmdDots(days[0]);
  return days.length > 1 ? `${first} ~ ${formatYmdDots(days.at(-1)!)}` : first;
}

/**
 * 내 예약 > 보낸 요청 목록(C-06): 예약이 확정되기 전의 요청 묶음. 같은 작업을 여러 업체에 요청한 비교 요청은 묶음 하나로 보인다.
 * 거절·철회·승인 만료로 끝난 요청도 남기고 카드에 종료 상태를 보여준다(사유는 요청 상세). 예약으로 이어진 묶음은 이 목록에 없다.
 */
export function SentRequestList({ bundles, busy }: { bundles: FilteredBundleListItem[]; busy?: boolean }) {
  const repo = useRepo();
  return (
    <ul className="stack request-list" aria-busy={busy || undefined}>
      {bundles.map((b) => {
        const total = b.items.length + b.hiddenItemCount;
        // 묶음 전체 기준으로 이동한다(숨긴 요청도 비교 화면에서 그대로 보인다)
        const single = total === 1;
        const to = single ? `/requests/${b.items[0].request.id}` : `/requests/bundle/${b.bundleId}`;
        const ended = b.hiddenItemCount === 0 && b.items.every((i) => isEnded(i.request.status));
        return (
          <li key={b.items.length === 1 && b.hiddenItemCount === 0 ? b.items[0].request.id : b.bundleId}>
            <Link to={to} className="card stack--sm stack" style={{ textDecoration: 'none', color: 'inherit' }}>
              <div className="row row--between">
                <p className="strong">{b.taskTitles.join(' · ')}</p>
                <Icon name="chevron" size={18} />
              </div>
              <p className="xs muted">요청 접수일 {receivedLabel(b)}</p>
              {!single && <p className="xs muted">{total}개 업체에 요청 · {ended ? '모든 업체 요청이 종료됐어요' : '비교해서 하나를 고를 수 있어요'}</p>}
              <ul className="stack--sm stack">
                {b.items.map((i) => (
                  <li key={i.request.id} className="row row--between row--wrap" style={{ gap: 'var(--sp-2)' }}>
                    <span className="small">{i.provider.name}{i.visitDate && <span className="muted"> · 방문일 {formatDate(i.visitDate)}</span>}</span>
                    <RequestBadge status={i.request.status} />
                    {i.paymentDeadline && <span className="xs muted" style={{ flexBasis: '100%' }}>예약금 결제 기한 {formatRemaining(repo.now(), i.paymentDeadline)}</span>}
                    {i.depositAttempt && <span className="xs strong" style={{ flexBasis: '100%', color: i.depositAttempt === 'failed' ? 'var(--c-danger)' : 'var(--c-primary)' }}>{i.depositAttempt === 'failed' ? '예약금 결제 실패 · 기한 안에 다시 결제할 수 있어요' : '예약금 결제 결과 확인 중 · 다시 결제하지 마세요'}</span>}
                    {/* 종료된 요청: 종료 사유(업체 거절은 업체가 남긴 사유, 그 밖에는 상태 안내) */}
                    {isEnded(i.request.status) && <span className="xs muted" style={{ flexBasis: '100%' }}>{i.request.status === 'rejected' && i.request.rejectionReason ? `거절 사유: ${i.request.rejectionReason}` : REQUEST_STATUS[i.request.status].hint}</span>}
                  </li>
                ))}
              </ul>
              {b.hiddenItemCount > 0 && (
                <p className="xs muted">조건에 맞지 않는 다른 업체 요청 {b.hiddenItemCount}건은 목록에서만 숨겼어요. 눌러서 모두 볼 수 있어요.</p>
              )}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
