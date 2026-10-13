import { useRef, type KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import { Page } from '../../app/Page';
import { useRepo } from '../../app/context';
import { useAsync } from '../../app/hooks';
import { formatWon } from '../../domain/money';
import { Icon } from '../../components/Icon';
import { AsyncView, EmptyState, LinkButton } from '../../components/ui';
import type { BookingListItem, BookingQueryResult, RequestListResult } from '../../data/repositories/types';
import { VisitText, bookingBadge } from '../shared';
import { useListScrollRestore, useUrlFilter, type UrlFilterCodec } from '../../app/listFilter';
import { toBookingQuery } from '../../domain/bookingFilter';
import { toListQuery } from '../../domain/requestFilter';
import { RESERVATION_TABS, type ReservationTab } from '../../domain/reservationTabs';
import {
  hasReservationFilterParams, parseReservationFilter, tabFilterKey, toBookingsState, writeReservationFilter, type ReservationListFilter,
} from '../../domain/reservationFilter';
import { BookingFilterBar } from './BookingFilters';
import { RequestFilterBar } from '../requests/RequestFilters';
import { SentRequestList } from '../requests/RequestsPage';

const TRIP_LABEL = { expected: '마감 전 예상 출장비', confirmed: '확정 출장비', locked: '유지되는 확정 출장비' } as const;

/** 예약 방문 시각 라벨. 고객 가능 시간 범위가 아니라 확정된 방문 시각을 보여준다. */
/** 방문 일정 라벨. 업체가 기존 일정에 방문할 수 없으면 정상 방문 예정처럼 보이지 않게 ‘기존 일정(방문 불가)’ */
export const visitLabel = (b: BookingListItem['booking'], schedule?: { oldVisitUnavailable: boolean }) =>
  (schedule?.oldVisitUnavailable && b.status === 'confirmed' ? '기존 일정' : b.status === 'confirmed' && b.workStatus === 'scheduled' ? '방문 예정' : '방문 일정');

export function BookingCard({ it }: { it: BookingListItem }) {
  const b = it.booking;
  return (
    <Link to={`/bookings/${b.id}`} className="card stack--sm stack" style={{ textDecoration: 'none', color: 'inherit' }}>
      <div className="row row--between row--wrap">
        <p className="strong">{it.providerName}</p>
        {bookingBadge(b, it.schedule)}
      </div>
      <p>{b.tasks.map((t) => t.title).join(' · ')}</p>
      <p className="small">{visitLabel(b, it.schedule)} · <VisitText date={b.visitDate} time={b.visitTime} /></p>
      {it.schedule.oldVisitUnavailable && it.schedule.label && <p className="small strong" style={{ color: 'var(--c-warn)' }}>{it.schedule.label}</p>}
      {b.status === 'confirmed' && it.tripFee.amount !== null && (
        <p className="small muted">{TRIP_LABEL[it.tripFee.kind]} <span className="money">{formatWon(it.tripFee.amount)}</span></p>
      )}
      {it.attention && (
        <p className="small strong row" style={{ color: 'var(--c-primary)' }}><Icon name="info" size={16} />{it.attention}</p>
      )}
    </Link>
  );
}

const CODEC: UrlFilterCodec<ReservationListFilter> = { list: 'reservations', parse: parseReservationFilter, write: writeReservationFilter, has: hasReservationFilterParams };

type TabData = { kind: 'requests'; r: RequestListResult } | { kind: 'bookings'; r: BookingQueryResult };

const EMPTY: Record<ReservationTab, { title: string; body: string; icon: string; findLink?: boolean }> = {
  requests: { icon: 'list', title: '보낸 요청이 없어요', body: '업체를 찾아 수리를 요청하면, 예약이 확정되기 전까지 업체 답변과 진행 상황을 여기에서 확인할 수 있어요.', findLink: true },
  active: { icon: 'calendar', title: '확정된 예약이 없어요', body: '업체 승인 후 예약금을 결제하면 확정된 예약이 여기에 나타나요. 승인 대기·결제 대기 요청은 보낸 요청에서 확인해요.', findLink: true },
  past: { icon: 'calendar', title: '완료되거나 취소된 예약이 없어요', body: '이용을 마쳤거나(최종 정산까지 완료) 확정 후 취소한 예약이 여기에 모여요.' },
};

/**
 * C-06·C-13 내 예약(통합): 보낸 요청 / 확정된 예약 / 완료·취소 탭. 분류 기준은 src/domain/reservationTabs.ts 한 곳에서 관리하고,
 * 같은 요청에서 생긴 예약은 한 탭에만 보인다. 탭과 탭별 필터는 URL(tab + 탭별 키)로 관리해 뒤로가기·새로고침·상세 복귀에서 복원하며,
 * 탭마다 필터·목록 위치가 따로 유지된다.
 */
export function BookingsPage() {
  const repo = useRepo();
  const { filter, apply } = useUrlFilter(CODEC);
  const tab = filter.tab;
  const key = tabFilterKey(filter);
  const q = useAsync<TabData>(() => (filter.tab === 'requests'
    ? repo.queryRequests(toListQuery(filter.requests, repo.now())).then((r) => ({ kind: 'requests' as const, r }))
    : repo.queryBookings(toBookingQuery(toBookingsState({ ...filter, tab: filter.tab }), repo.now())).then((r) => ({ kind: 'bookings' as const, r }))), [repo, key]);
  const ready = q.data !== undefined && !q.loading;
  useListScrollRestore(CODEC.list, ready, key, tab);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  // 탭 전환: 기록을 쌓지 않고(replace) 주소의 tab만 바꾼다. 목록 위치는 탭마다 저장·복원한다(scope = 탭).
  const setTab = (t: ReservationTab) => { if (t !== tab) apply({ ...filter, tab: t }, { replace: true, keepScroll: true }); };
  // 탭 목록 키보드: 좌우 화살표·Home·End로 탭 이동(선택도 함께)
  const onTabKey = (e: KeyboardEvent, i: number) => {
    const n = RESERVATION_TABS.length;
    const next = e.key === 'ArrowRight' ? (i + 1) % n : e.key === 'ArrowLeft' ? (i - 1 + n) % n : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : -1;
    if (next < 0) return;
    e.preventDefault();
    setTab(RESERVATION_TABS[next].value);
    tabRefs.current[next]?.focus();
  };
  const hasAny = !ready || !q.data ? undefined : q.data.kind === 'requests' ? q.data.r.hasAnyRequest : q.data.r.hasAnyInTab;
  const count = ready && !q.error && q.data ? (q.data.kind === 'requests' ? q.data.r.bundles.length : q.data.r.items.length) : undefined;
  const empty = EMPTY[tab];

  return (
    <Page title="내 예약" tabs>
      <h2 style={{ fontSize: 'var(--fs-xl)' }}>내 예약</h2>
      {/* 밑줄형 탭(시각 디자인만 — tablist·tab·tabpanel 관계, 방향키 이동, URL·탭별 위치 복원은 그대로) */}
      <div className="tabs-bar">
        <div role="tablist" aria-label="내 예약 구분" aria-orientation="horizontal" className="tabs">
          {RESERVATION_TABS.map((t, i) => (
            <button key={t.value} type="button" ref={(el) => { tabRefs.current[i] = el; }} role="tab" id={`res-tab-${t.value}`} aria-controls="res-panel"
              className="tabs__tab" data-label={t.label} aria-selected={tab === t.value} tabIndex={tab === t.value ? 0 : -1} onClick={() => setTab(t.value)} onKeyDown={(e) => onTabKey(e, i)}>
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <div role="tabpanel" id="res-panel" aria-labelledby={`res-tab-${tab}`} className="stack stack--lg">
        {/* 이 탭에 내역 자체가 없으면 필터를 보여주지 않는다 */}
        {hasAny !== false && (tab === 'requests'
          ? <RequestFilterBar filter={filter.requests} onApply={(requests) => apply({ ...filter, requests })} count={count} />
          : <BookingFilterBar filter={toBookingsState({ ...filter, tab })} onApply={(b) => apply({ ...filter, active: b.active, past: b.past })} count={count} />)}
        <AsyncView state={q}>
          {(d) => {
            if (d.kind === 'requests' ? !d.r.hasAnyRequest : !d.r.hasAnyInTab) {
              return (
                <EmptyState icon={empty.icon} title={empty.title} action={empty.findLink ? <LinkButton to="/" variant="primary">업체 찾아보기</LinkButton> : undefined}>
                  {empty.body}
                </EmptyState>
              );
            }
            const n = d.kind === 'requests' ? d.r.bundles.length : d.r.items.length;
            return (
              <>
                {d.kind === 'bookings' && d.r.excludedMissingVisitDate > 0 && <p className="small muted">방문일이 확인되지 않은 예약 {d.r.excludedMissingVisitDate}건은 방문일 조건에서 제외했어요. ‘전체 기간’에서는 보여요.</p>}
                {n === 0 ? (
                  // 초기화 버튼은 두지 않는다. 위 필터는 그대로 조작할 수 있다.
                  <EmptyState icon="filter" title={d.kind === 'requests' ? '선택한 조건에 맞는 요청이 없어요.' : '선택한 조건에 맞는 예약이 없어요.'}>날짜나 상태를 변경해주세요.</EmptyState>
                ) : d.kind === 'requests' ? (
                  <SentRequestList bundles={d.r.bundles} busy={q.loading} />
                ) : (
                  <ul className="stack booking-list" aria-busy={q.loading || undefined}>{d.r.items.map((it) => <li key={it.booking.id}><BookingCard it={it} /></li>)}</ul>
                )}
              </>
            );
          }}
        </AsyncView>
      </div>
    </Page>
  );
}
