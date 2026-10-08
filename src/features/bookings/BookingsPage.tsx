import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Page } from '../../app/Page';
import { useRepo } from '../../app/context';
import { useAsync } from '../../app/hooks';
import { formatDate } from '../../domain/time';
import { formatWon } from '../../domain/money';
import { Icon } from '../../components/Icon';
import { AsyncView, EmptyState, LinkButton } from '../../components/ui';
import type { BookingListItem } from '../../data/repositories/types';
import { bookingBadge } from '../shared';

const TRIP_LABEL = { expected: '마감 전 예상 출장비', confirmed: '확정 출장비', locked: '유지되는 확정 출장비' } as const;

export function BookingCard({ it }: { it: BookingListItem }) {
  const b = it.booking;
  return (
    <Link to={`/bookings/${b.id}`} className="card stack--sm stack" style={{ textDecoration: 'none', color: 'inherit' }}>
      <div className="row row--between row--wrap">
        <p className="strong">{it.providerName}</p>
        {bookingBadge(b)}
      </div>
      <p>{b.tasks.map((t) => t.title).join(' · ')}</p>
      <p className="small">{formatDate(b.visitDate)} · <span className="nowrap">{b.visitWindow}</span></p>
      {b.status === 'confirmed' && it.tripFee.amount !== null && (
        <p className="small muted">{TRIP_LABEL[it.tripFee.kind]} <span className="money">{formatWon(it.tripFee.amount)}</span></p>
      )}
      {it.attention && (
        <p className="small strong row" style={{ color: 'var(--c-primary)' }}><Icon name="info" size={16} />{it.attention}</p>
      )}
    </Link>
  );
}

/** C-13 내 예약: 진행 중과 이용 내역(완료·취소) */
export function BookingsPage() {
  const repo = useRepo();
  const q = useAsync(() => repo.listBookings(), [repo]);
  const [tab, setTab] = useState<'active' | 'past'>('active');
  return (
    <Page title="내 예약" tabs>
      <h2 style={{ fontSize: 'var(--fs-xl)' }}>내 예약</h2>
      <div role="tablist" aria-label="예약 구분" className="tabs">
        <button role="tab" aria-selected={tab === 'active'} onClick={() => setTab('active')}>진행 중</button>
        <button role="tab" aria-selected={tab === 'past'} onClick={() => setTab('past')}>이용 내역</button>
      </div>
      <AsyncView state={q}>
        {(all) => {
          const isPast = (x: BookingListItem) => x.booking.status === 'cancelled' || x.booking.workStatus === 'completed';
          const list = all.filter((x) => (tab === 'past' ? isPast(x) : !isPast(x)))
            .sort((a, b) => Number(!!b.attention) - Number(!!a.attention));
          return list.length === 0 ? (
            <EmptyState icon="calendar" title={tab === 'active' ? '진행 중인 예약이 없어요' : '이용 내역이 없어요'}
              action={tab === 'active' ? <LinkButton to="/" variant="primary">업체 찾아보기</LinkButton> : undefined}>
              {tab === 'active' ? '요청이 승인되고 예약금을 결제하면 여기에 나타나요.' : '완료되거나 취소된 예약이 여기에 모여요.'}
            </EmptyState>
          ) : (
            <ul className="stack" role="tabpanel">{list.map((it) => <li key={it.booking.id}><BookingCard it={it} /></li>)}</ul>
          );
        }}
      </AsyncView>
    </Page>
  );
}
