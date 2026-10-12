import { Link } from 'react-router-dom';
import { Page } from '../../app/Page';
import { useRepo } from '../../app/context';
import { useAsync } from '../../app/hooks';
import { REQUEST_STATUS } from '../../domain/rules';
import { formatDate, formatRemaining, seoulYmd } from '../../domain/time';
import { formatYmdDots, toListQuery, writeRequestFilter } from '../../domain/requestFilter';
import { Icon } from '../../components/Icon';
import { AsyncView, Badge, EmptyState, LinkButton } from '../../components/ui';
import type { FilteredBundleListItem } from '../../data/repositories/types';
import type { RequestStatus } from '../../domain/types';
import { RequestFilterBar } from './RequestFilters';
import { useListScrollRestore, useRequestFilter } from './useRequestFilter';

export function RequestBadge({ status, recheck }: { status: RequestStatus; recheck?: boolean }) {
  const s = REQUEST_STATUS[status];
  return <Badge tone={s.tone}>{recheck ? '새 조건 확인 필요' : s.label}</Badge>;
}

/** 묶음에 표시되는 요청들의 요청 접수일(한국 날짜). 여러 날이면 범위로 */
function receivedLabel(b: FilteredBundleListItem): string {
  const days = [...new Set(b.items.map((i) => seoulYmd(i.request.createdAt)))].sort();
  const first = formatYmdDots(days[0]);
  return days.length > 1 ? `${first} ~ ${formatYmdDots(days.at(-1)!)}` : first;
}

/** C-06 내 요청: 같은 작업을 여러 업체에 요청한 묶음 목록. 요청 접수일·상태로 거를 수 있다. */
export function RequestsPage() {
  const repo = useRepo();
  const { filter, apply } = useRequestFilter();
  const filterKey = writeRequestFilter(new URLSearchParams(), filter).toString();
  // 오늘(최근 N일 기준)은 목업 시계의 한국 날짜. 저장소 변경 시 재조회하면서 다시 계산한다.
  const q = useAsync(() => repo.queryRequests(toListQuery(filter, repo.now())), [repo, filterKey]);
  const ready = q.data !== undefined && !q.loading;
  useListScrollRestore(ready, filterKey);

  return (
    <Page title="내 요청" tabs>
      <h2 style={{ fontSize: 'var(--fs-xl)' }}>내 요청</h2>
      {/* 요청 자체가 없으면 필터를 보여주지 않는다 */}
      {!(q.data && !q.data.hasAnyRequest) && (
        <RequestFilterBar filter={filter} onApply={apply} count={ready && !q.error ? q.data!.bundles.length : undefined} />
      )}
      <AsyncView state={q}>
        {({ bundles, hasAnyRequest }) => !hasAnyRequest ? (
          <EmptyState icon="list" title="아직 보낸 수리 요청이 없어요." action={<LinkButton to="/" variant="primary">업체 찾기</LinkButton>}>
            업체를 찾아 수리를 요청하면 여기에서 답변을 확인할 수 있어요.
          </EmptyState>
        ) : bundles.length === 0 ? (
          // 초기화 버튼은 두지 않는다. 위 필터는 그대로 조작할 수 있다.
          <EmptyState icon="filter" title="선택한 조건에 맞는 요청이 없어요.">날짜나 상태를 변경해주세요.</EmptyState>
        ) : (
          <ul className="stack request-list" aria-busy={q.loading || undefined}>
            {bundles.map((b) => {
              const total = b.items.length + b.hiddenItemCount;
              // 묶음 전체 기준으로 이동한다(숨긴 요청도 비교 화면에서 그대로 보인다)
              const single = total === 1;
              const to = single ? `/requests/${b.items[0].request.id}` : `/requests/bundle/${b.bundleId}`;
              return (
                <li key={b.bundleId}>
                  <Link to={to} className="card stack--sm stack" style={{ textDecoration: 'none', color: 'inherit' }}>
                    <div className="row row--between">
                      <p className="strong">{b.taskTitles.join(' · ')}</p>
                      <Icon name="chevron" size={18} />
                    </div>
                    <p className="xs muted">요청 접수일 {receivedLabel(b)}</p>
                    {!single && <p className="xs muted">{total}개 업체에 요청 · 비교해서 하나를 고를 수 있어요</p>}
                    <ul className="stack--sm stack">
                      {b.items.map((i) => (
                        <li key={i.request.id} className="row row--between row--wrap" style={{ gap: 'var(--sp-2)' }}>
                          <span className="small">{i.provider.name}{i.visitDate && <span className="muted"> · 방문일 {formatDate(i.visitDate)}</span>}</span>
                          <RequestBadge status={i.request.status} />
                          {i.paymentDeadline && <span className="xs muted" style={{ flexBasis: '100%' }}>결제 기한 {formatRemaining(repo.now(), i.paymentDeadline)}</span>}
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
        )}
      </AsyncView>
    </Page>
  );
}
