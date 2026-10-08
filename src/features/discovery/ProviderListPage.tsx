import { Link, useSearchParams } from 'react-router-dom';
import { Page } from '../../app/Page';
import { useAppState, useRepo } from '../../app/context';
import { useAsync } from '../../app/hooks';
import { formatDate } from '../../domain/time';
import { formatWon } from '../../domain/money';
import type { ProviderSummary } from '../../domain/types';
import { Icon } from '../../components/Icon';
import { AsyncView, Badge, Banner, EmptyState, LinkButton, Stars } from '../../components/ui';
import { initialOf } from '../shared';

export function JointBadge({ p, hasAddress }: { p: ProviderSummary; hasAddress: boolean }) {
  if (!hasAddress) return <Badge>방문 지역을 정하면 확인할 수 있어요</Badge>;
  if (p.jointAvailable === null) return <Badge tone="warn">공동 예약 가능 여부 확인 필요</Badge>;
  if (!p.jointAvailable) return <Badge>참여 가능한 공동 날짜 없음</Badge>;
  return <Badge tone="info">공동 예약 가능</Badge>;
}

export function ProviderListPage() {
  const repo = useRepo();
  const [sp] = useSearchParams();
  const categoryId = sp.get('category') ?? '';
  const { addressId } = useAppState();
  const cats = useAsync(() => repo.listCategories(), [repo]);
  const list = useAsync(() => repo.listProviders({ categoryId, addressId }), [repo, categoryId, addressId]);
  const catName = cats.data?.find((c) => c.id === categoryId)?.name ?? '업체 목록';
  return (
    <Page title={catName} back="/">
      <div className="card row row--between">
        <div className="grow">
          <p className="small muted">현재 조회 지역</p>
          <p className="strong">{addressId ? '설정한 방문 지역' : '아직 설정하지 않았어요'}</p>
        </div>
        <LinkButton to={`/address?back=${encodeURIComponent(`/providers?category=${categoryId}`)}`} variant="secondary" sm>{addressId ? '변경' : '설정'}</LinkButton>
      </div>
      <AsyncView state={list}>
        {(items) => (
          <>
            {addressId && items.some((p) => p.jointAvailable === null) && (
              <Banner tone="warn" title="현재 공동 예약 참여 가능 여부를 확인하기 어려워요">다시 확인하기 전에는 참여할 수 있다고 안내하지 않아요. 잠시 뒤 다시 시도해 주세요.</Banner>
            )}
            {items.length === 0 ? (
              <EmptyState icon="tool" title="이 작업을 맡는 업체가 아직 없어요" action={<LinkButton to="/" variant="secondary">다른 작업 보기</LinkButton>}>
                다른 카테고리를 확인하거나 나중에 다시 찾아 주세요.
              </EmptyState>
            ) : (
              <ul className="stack" aria-label="업체 목록">
                {items.map((p) => {
                  const fee = p.nextJoint?.expectedFee ?? null;
                  const sv = fee !== null && fee < p.soloTripFee ? Math.round(((p.soloTripFee - fee) / p.soloTripFee) * 100) : null;
                  return (
                    <li key={p.id}>
                      <Link to={`/providers/${p.id}`} className="card stack--sm stack" style={{ textDecoration: 'none', color: 'inherit' }}>
                        <div className="row row--top">
                          <span className="avatar" aria-hidden>{initialOf(p.name)}</span>
                          <div className="grow">
                            <p className="strong">{p.name}</p>
                            <p className="small muted"><Stars value={p.rating} /> {p.rating.toFixed(1)} · 리뷰 {p.reviewCount}개</p>
                          </div>
                          <Icon name="chevron" size={18} />
                        </div>
                        <p className="small">기본 출장비 <span className="money strong">{formatWon(p.soloTripFee)}</span> <span className="muted">(혼자 방문 기준)</span></p>
                        <div className="row row--wrap"><JointBadge p={p} hasAddress={addressId !== null} /></div>
                        {p.nextJoint && (
                          <p className="small">
                            가까운 공동 날짜 <span className="strong nowrap">{formatDate(p.nextJoint.date)}</span>
                            {p.nextJoint.expectedFee !== null && <> · 예상 출장비 <span className="money strong">{formatWon(p.nextJoint.expectedFee)}</span></>}
                            {sv !== null && <span className="muted"> · 혼자 방문할 때보다 약 {sv}% 덜 내요</span>}
                          </p>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </AsyncView>
    </Page>
  );
}
