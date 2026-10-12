import { Link } from 'react-router-dom';
import { Page } from '../../app/Page';
import { useRepo } from '../../app/context';
import { useAsync } from '../../app/hooks';
import { formatWon } from '../../domain/money';
import { Icon } from '../../components/Icon';
import { AsyncView, EmptyState, LinkButton } from '../../components/ui';
import type { BookingListItem } from '../../data/repositories/types';
import { VisitText, bookingBadge } from '../shared';
import { useListScrollRestore, useUrlFilter, type UrlFilterCodec } from '../../app/listFilter';
import {
  bookingFilterKey, hasBookingFilterParams, parseBookingsFilter, toBookingQuery, writeBookingsFilter, type BookingTab, type BookingsFilterState,
} from '../../domain/bookingFilter';
import { BookingFilterBar } from './BookingFilters';

const TRIP_LABEL = { expected: '마감 전 예상 출장비', confirmed: '확정 출장비', locked: '유지되는 확정 출장비' } as const;

/** 예약 방문 시각 라벨. 고객 가능 시간 범위가 아니라 확정된 방문 시각을 보여준다. */
export const visitLabel = (b: BookingListItem['booking']) => (b.status === 'confirmed' && b.workStatus === 'scheduled' ? '방문 예정' : '방문 일정');

export function BookingCard({ it }: { it: BookingListItem }) {
  const b = it.booking;
  return (
    <Link to={`/bookings/${b.id}`} className="card stack--sm stack" style={{ textDecoration: 'none', color: 'inherit' }}>
      <div className="row row--between row--wrap">
        <p className="strong">{it.providerName}</p>
        {bookingBadge(b)}
      </div>
      <p>{b.tasks.map((t) => t.title).join(' · ')}</p>
      <p className="small">{visitLabel(b)} · <VisitText date={b.visitDate} time={b.visitTime} /></p>
      {b.status === 'confirmed' && it.tripFee.amount !== null && (
        <p className="small muted">{TRIP_LABEL[it.tripFee.kind]} <span className="money">{formatWon(it.tripFee.amount)}</span></p>
      )}
      {it.attention && (
        <p className="small strong row" style={{ color: 'var(--c-primary)' }}><Icon name="info" size={16} />{it.attention}</p>
      )}
    </Link>
  );
}

const BOOKINGS_CODEC: UrlFilterCodec<BookingsFilterState> = { list: 'bookings', parse: parseBookingsFilter, write: writeBookingsFilter, has: hasBookingFilterParams };

/**
 * C-13 내 예약: 진행 중과 이용 내역(완료·취소). 탭과 탭별 필터를 URL로 관리해 탭 전환·상세 복귀·새로고침에서 복원한다.
 * 진행 중·이용 내역 필터는 서로 독립이다.
 */
export function BookingsPage() {
  const repo = useRepo();
  const { filter, apply } = useUrlFilter(BOOKINGS_CODEC);
  const key = bookingFilterKey(filter);
  const q = useAsync(() => repo.queryBookings(toBookingQuery(filter, repo.now())), [repo, key]);
  const ready = q.data !== undefined && !q.loading;
  useListScrollRestore(BOOKINGS_CODEC.list, ready, key);
  const tab = filter.tab;
  const setTab = (t: BookingTab) => { if (t !== tab) apply({ ...filter, tab: t }, { replace: true }); };
  return (
    <Page title="내 예약" tabs>
      <h2 style={{ fontSize: 'var(--fs-xl)' }}>내 예약</h2>
      <div role="tablist" aria-label="예약 구분" className="tabs">
        <button role="tab" aria-selected={tab === 'active'} onClick={() => setTab('active')}>진행 중</button>
        <button role="tab" aria-selected={tab === 'past'} onClick={() => setTab('past')}>이용 내역</button>
      </div>
      {/* 이 탭에 예약 자체가 없으면 필터를 보여주지 않는다 */}
      {!(ready && q.data && !q.data.hasAnyInTab) && (
        <BookingFilterBar filter={filter} onApply={apply} count={ready && !q.error ? q.data!.items.length : undefined} />
      )}
      <AsyncView state={q}>
        {({ items, hasAnyInTab, excludedMissingVisitDate }) => !hasAnyInTab ? (
          <EmptyState icon="calendar" title={tab === 'active' ? '진행 중인 예약이 없어요' : '이용 내역이 없어요'}
            action={tab === 'active' ? <LinkButton to="/" variant="primary">업체 찾아보기</LinkButton> : undefined}>
            {tab === 'active' ? '요청이 승인되고 예약금을 결제하면 여기에 나타나요.' : '완료되거나 취소된 예약이 여기에 모여요.'}
          </EmptyState>
        ) : (
          <>
            {excludedMissingVisitDate > 0 && <p className="small muted">방문일이 확인되지 않은 예약 {excludedMissingVisitDate}건은 방문일 조건에서 제외했어요. ‘전체 기간’에서는 보여요.</p>}
            {items.length === 0 ? (
              // 초기화 버튼은 두지 않는다. 위 필터는 그대로 조작할 수 있다.
              <EmptyState icon="filter" title="선택한 조건에 맞는 예약이 없어요.">날짜나 상태를 변경해주세요.</EmptyState>
            ) : (
              <ul className="stack booking-list" role="tabpanel" aria-busy={q.loading || undefined}>{items.map((it) => <li key={it.booking.id}><BookingCard it={it} /></li>)}</ul>
            )}
          </>
        )}
      </AsyncView>
    </Page>
  );
}
