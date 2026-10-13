import { Link, useSearchParams } from 'react-router-dom';
import { Page } from '../../app/Page';
import { useRepo } from '../../app/context';
import { useAsync } from '../../app/hooks';
import { formatDate } from '../../domain/time';
import { formatWon } from '../../domain/money';
import type { ProviderSummary } from '../../domain/types';
import { Icon } from '../../components/Icon';
import { AsyncView, Badge, Banner, Button, EmptyState, LinkButton, LoadingBlock, Skeleton, Stars } from '../../components/ui';
import { describeError } from '../../domain/errors';
import { initialOf } from '../shared';
import { addressSubline, addressTitle, useExploreAddress } from './exploreAddress';

export function JointBadge({ p, hasAddress, addressUnknown }: { p: ProviderSummary; hasAddress: boolean; addressUnknown?: boolean }) {
  if (!hasAddress) return <Badge>지역·건물 주소를 정하면 확인할 수 있어요</Badge>;
  // 주소를 확인하지 못했으면 참여 가능 여부를 단정하지 않는다
  if (addressUnknown || p.jointAvailable === null) return <Badge tone="warn">공동 예약 가능 여부 확인 필요</Badge>;
  if (!p.jointAvailable) return <Badge>참여 가능한 공동 날짜 없음</Badge>;
  // 지역·건물 기준 후보. 신청할 때 정확한 주소로 동일 단지·반경 300m 조건을 다시 확인한다.
  return <Badge tone="info">공동 예약 후보</Badge>;
}

export function ProviderListPage() {
  const repo = useRepo();
  const [sp] = useSearchParams();
  const categoryId = sp.get('category') ?? '';
  // 업체 찾기와 같은 탐색 주소(앱 상태)를 쓴다. 업체 목록·공동 예약 후보 조회에도 같은 주소 id를 넘긴다.
  const { addressId, address } = useExploreAddress();
  const cats = useAsync(() => repo.listCategories(), [repo]);
  const list = useAsync(() => repo.listProviders({ categoryId, addressId }), [repo, categoryId, addressId]);
  // 카테고리 이름을 불러오는 동안은 제목을 비워 두고(null), 실패하거나 없는 카테고리일 때만 기본 문구를 쓴다
  const catName = cats.data?.find((c) => c.id === categoryId)?.name ?? (cats.loading ? null : '업체 목록');
  const addressUnknown = addressId !== null && !!address.error; // 주소를 확인하지 못함
  const addressLoading = addressId !== null && !address.data && !address.error;
  const changeTo = `/address?back=${encodeURIComponent(`/providers?category=${categoryId}`)}`;
  return (
    <Page title={catName} back="/">
      <div className="card row row--between region-card" aria-busy={addressLoading || undefined}>
        <div className="grow">
          <p className="small muted">현재 조회 지역</p>
          {addressId === null ? (
            <p className="strong">조회할 지역·건물 주소를 설정해주세요</p>
          ) : address.data ? (
            <>
              <p className="strong">{addressTitle(address.data)}</p>
              {addressSubline(address.data) && <p className="small muted">{addressSubline(address.data)}</p>}
            </>
          ) : address.error ? (
            <>
              <p className="strong">주소를 확인하지 못했어요</p>
              <p className="small muted">{describeError(address.error).hint}</p>
            </>
          ) : (
            <><span className="sr-only">주소를 불러오는 중이에요</span><Skeleton h={20} /></>
          )}
        </div>
        <div className="region-card__actions">
          {addressUnknown && <Button sm onClick={address.reload}>다시 시도</Button>}
          <LinkButton to={changeTo} variant={addressId === null ? 'primary' : 'secondary'} sm>{addressId === null ? '설정' : '변경'}</LinkButton>
        </div>
      </div>
      {/* 주소를 불러오는 동안은 목록을 보여주지 않는다(주소와 다른 기준의 결과처럼 보이지 않게) */}
      {addressLoading ? <LoadingBlock /> : (
      <AsyncView state={list}>
        {(items) => (
          <>
            {addressUnknown && (
              <Banner tone="warn" title="주소를 확인하지 못해 공동 예약 참여 가능 여부를 알 수 없어요">주소를 다시 불러오거나 변경한 뒤 확인해 주세요.</Banner>
            )}
            {addressId && !addressUnknown && items.some((p) => p.jointAvailable) && <p className="xs muted">‘공동 예약 후보’는 선택한 지역·건물 기준이에요. 신청할 때 정확한 방문 주소로 참여 조건을 다시 확인해요.</p>}
            {addressId && !addressUnknown && items.some((p) => p.jointAvailable === null) && (
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
                        <div className="row row--wrap"><JointBadge p={p} hasAddress={addressId !== null} addressUnknown={addressUnknown} /></div>
                        {p.nextJoint && !addressUnknown && (
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
      )}
    </Page>
  );
}
