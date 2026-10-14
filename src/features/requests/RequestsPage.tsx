import { Link } from 'react-router-dom';
import { useRepo } from '../../app/context';
import { formatDate, formatRemaining, seoulYmd } from '../../domain/time';
import { formatYmdDots } from '../../domain/requestFilter';
import { requestDisplay, requestItemActions } from '../../domain/statusDisplay';
import { CardChevron, StatusBadges, TodoHead } from '../shared';
import type { FilteredBundleListItem } from '../../data/repositories/types';
import type { RequestStatus } from '../../domain/types';

/** 요청 대표 상태(목록·상세 공통 매핑, src/domain/statusDisplay.ts) */
export function RequestBadge({ status }: { status: RequestStatus; recheck?: boolean }) {
  return <StatusBadges d={requestDisplay(status)} />;
}

/** 예약으로 이어지지 않고 끝난 요청(업체 거절·철회·승인 만료 등) */
const isEnded = (s: RequestStatus) => !['reviewing', 'needs_info', 'approved_pending_payment', 'booked'].includes(s);

/** 묶음에 표시되는 요청들의 요청일(한국 날짜). 여러 날이면 범위로 */
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
  return (
    <ul className="stack request-list" aria-busy={busy || undefined}>
      {bundles.map((b) => (
        <li key={b.items.length === 1 && b.hiddenItemCount === 0 ? b.items[0].request.id : b.bundleId}><SentRequestCard b={b} /></li>
      ))}
    </ul>
  );
}

/**
 * 요청 카드(묶음 하나). 보낸 요청 목록과 완료·취소 탭의 요청 취소 카드가 함께 쓴다(spec 5.47) — 카드 전체가 요청 상세(비교 요청이면 비교 화면)로 간다.
 * 첫 줄 = 작업명(가장 크고 굵게) / 상태 태그 / 꺾쇠, 그 아래 업체명(기본 크기·보통 굵기)과 방문일 → 요청일 → 결제 기한·거절 사유(spec 5.51).
 * 비교 요청 묶음(업체 여러 곳)은 업체마다 상태가 달라 태그를 업체 줄에 그대로 둔다(데모에서는 비교 요청을 꺼 둠).
 */
export function SentRequestCard({ b }: { b: FilteredBundleListItem }) {
  const repo = useRepo();
  const total = b.items.length + b.hiddenItemCount;
  // 묶음 전체 기준으로 이동한다(숨긴 요청도 비교 화면에서 그대로 보인다)
  const single = total === 1;
  const one = single ? b.items[0] : null;
  const to = single ? `/requests/${b.items[0].request.id}` : `/requests/bundle/${b.bundleId}`;
  const ended = b.hiddenItemCount === 0 && b.items.every((i) => isEnded(i.request.status));
  const todo = b.items.flatMap(requestItemActions);
  // 결제 기한(정보)만 두고 구체 확인 내용·결제 시도 안내는 상세에서. 업체 거절은 업체가 남긴 사유(실제 데이터)
  const notes = (i: FilteredBundleListItem['items'][number]) => <>
    {i.paymentDeadline && <p className="xs muted">예약금 결제 기한 {formatRemaining(repo.now(), i.paymentDeadline)}</p>}
    {i.request.status === 'rejected' && i.request.rejectionReason && <p className="xs muted">거절 사유: {i.request.rejectionReason}</p>}
  </>;
  return (
    <Link to={to} className={`card stack--sm stack${todo.length ? ' card--todo' : ''}`} style={{ textDecoration: 'none', color: 'inherit' }}>
      {/* 할 일(예약금 결제·요청서 보완)이 있을 때만 상단 머리. 결제 결과 확인 중·업체 검토 중에는 없음. ‘확인 필요’ 필터와 같은 기준 */}
      <TodoHead actions={todo} />
      <div className="card-top">
        <p className="strong card-top__title">{b.taskTitles.join(' · ')}</p>
        {one && <RequestBadge status={one.request.status} />}
        <CardChevron />
      </div>
      {one ? (
        <>
          <p className="card-provider">{one.provider.name}{one.visitDate && <span className="small muted"> · 방문일 {formatDate(one.visitDate)}</span>}</p>
          <p className="xs muted">요청일 {receivedLabel(b)}</p>
          {notes(one)}
        </>
      ) : (
        <>
          <p className="xs muted">요청일 {receivedLabel(b)}</p>
          <p className="xs muted">{total}개 업체에 요청 · {ended ? '모든 업체 요청이 종료됐어요' : '비교해서 하나를 고를 수 있어요'}</p>
          <ul className="stack--sm stack">
            {b.items.map((i) => (
              <li key={i.request.id} className="stack--sm stack">
                <div className="card-top">
                  <p className="card-provider card-top__title">{i.provider.name}{i.visitDate && <span className="small muted"> · 방문일 {formatDate(i.visitDate)}</span>}</p>
                  <RequestBadge status={i.request.status} />
                </div>
                {notes(i)}
              </li>
            ))}
          </ul>
        </>
      )}
      {b.hiddenItemCount > 0 && (
        <p className="xs muted">조건에 맞지 않는 다른 업체 요청 {b.hiddenItemCount}건은 목록에서만 숨겼어요. 눌러서 모두 볼 수 있어요.</p>
      )}
    </Link>
  );
}
