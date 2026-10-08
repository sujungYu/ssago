import { Link } from 'react-router-dom';
import { Page } from '../../app/Page';
import { useRepo } from '../../app/context';
import { useAsync } from '../../app/hooks';
import { REQUEST_PRIORITY, REQUEST_STATUS } from '../../domain/rules';
import { formatDate, formatRemaining } from '../../domain/time';
import { Icon } from '../../components/Icon';
import { AsyncView, Badge, EmptyState, LinkButton } from '../../components/ui';
import type { RequestStatus } from '../../domain/types';

export function RequestBadge({ status, recheck }: { status: RequestStatus; recheck?: boolean }) {
  const s = REQUEST_STATUS[status];
  return <Badge tone={s.tone}>{recheck ? '새 조건 확인 필요' : s.label}</Badge>;
}

/** C-06 내 요청: 같은 작업을 여러 업체에 요청한 묶음 목록 */
export function RequestsPage() {
  const repo = useRepo();
  const q = useAsync(() => repo.listRequests(), [repo]);
  return (
    <Page title="내 요청" tabs>
      <h2 style={{ fontSize: 'var(--fs-xl)' }}>내 요청</h2>
      <AsyncView state={q}>
        {(bundles) => bundles.length === 0 ? (
          <EmptyState icon="list" title="아직 보낸 요청이 없어요" action={<LinkButton to="/" variant="primary">업체 찾아보기</LinkButton>}>
            업체를 찾아 수리를 요청하면 여기에서 답변을 확인할 수 있어요.
          </EmptyState>
        ) : (
          <ul className="stack">
            {[...bundles].sort((a, b) => {
              const rank = (x: typeof a) => Math.min(...x.items.map((i) => REQUEST_PRIORITY.indexOf(i.request.status)));
              return rank(a) - rank(b) || b.updatedAt.localeCompare(a.updatedAt);
            }).map((b) => {
              const single = b.items.length === 1;
              const to = single ? `/requests/${b.items[0].request.id}` : `/requests/bundle/${b.bundleId}`;
              return (
                <li key={b.bundleId}>
                  <Link to={to} className="card stack--sm stack" style={{ textDecoration: 'none', color: 'inherit' }}>
                    <div className="row row--between">
                      <p className="strong">{b.taskTitles.join(' · ')}</p>
                      <Icon name="chevron" size={18} />
                    </div>
                    {!single && <p className="xs muted">{b.items.length}개 업체에 요청 · 비교해서 하나를 고를 수 있어요</p>}
                    <ul className="stack--sm stack">
                      {b.items.map((i) => (
                        <li key={i.request.id} className="row row--between row--wrap" style={{ gap: 'var(--sp-2)' }}>
                          <span className="small">{i.provider.name}{i.visitDate && <span className="muted"> · {formatDate(i.visitDate)}</span>}</span>
                          <RequestBadge status={i.request.status} />
                          {i.paymentDeadline && <span className="xs muted" style={{ flexBasis: '100%' }}>결제 기한 {formatRemaining(repo.now(), i.paymentDeadline)}</span>}
                        </li>
                      ))}
                    </ul>
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
