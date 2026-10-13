import { Link } from 'react-router-dom';
import { useRepo } from '../../app/context';
import { formatDate, formatRemaining, seoulYmd } from '../../domain/time';
import { formatYmdDots } from '../../domain/requestFilter';
import { Icon } from '../../components/Icon';
import { requestDisplay } from '../../domain/statusDisplay';
import { StatusBadges, TodoLine } from '../shared';
import type { FilteredBundleListItem } from '../../data/repositories/types';
import type { RequestStatus } from '../../domain/types';

/** 요청 대표 상태(목록·상세 공통 매핑, src/domain/statusDisplay.ts) */
export function RequestBadge({ status }: { status: RequestStatus; recheck?: boolean }) {
  return <StatusBadges d={requestDisplay(status)} />;
}
const inFlight = (i: FilteredBundleListItem['items'][number]) => i.depositAttempt === 'processing' || i.depositAttempt === 'unknown';

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
                    {/* 결제 기한(정보)만 두고, 구체 확인 내용·결제 시도 안내는 상세에서 */}
                    {i.paymentDeadline && <span className="xs muted" style={{ flexBasis: '100%' }}>예약금 결제 기한 {formatRemaining(repo.now(), i.paymentDeadline)}</span>}
                    {/* 업체 거절: 업체가 남긴 사유(실제 데이터). 그 밖의 종료는 대표 상태로 충분 */}
                    {i.request.status === 'rejected' && i.request.rejectionReason && <span className="xs muted" style={{ flexBasis: '100%' }}>거절 사유: {i.request.rejectionReason}</span>}
                  </li>
                ))}
              </ul>
              {/* 할 일(있을 때만): 예약금 결제·요청서 보완. 결제 결과 확인 중·업체 검토 중에는 없음 */}
              <TodoLine actions={b.items.flatMap((i) => requestDisplay(i.request.status, { paymentInFlight: inFlight(i) }).actions)} />
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
