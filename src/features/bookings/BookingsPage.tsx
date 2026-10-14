import { useRef, type KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import { Page } from '../../app/Page';
import { useRepo } from '../../app/context';
import { useAsync, useTodoCounts } from '../../app/hooks';
import { formatWon } from '../../domain/money';
import { AsyncView, CountBadge, EmptyState, LinkButton } from '../../components/ui';
import type { BookingListItem, BookingQueryResult, RequestListResult } from '../../data/repositories/types';
import { CardChevron, StatusBadges, TodoHead, VisitText } from '../shared';
import { formatDate } from '../../domain/time';
import { useListScrollRestore, useUrlFilter, type UrlFilterCodec } from '../../app/listFilter';
import { toBookingQuery } from '../../domain/bookingFilter';
import { toListQuery } from '../../domain/requestFilter';
import { RESERVATION_TABS, type ReservationTab } from '../../domain/reservationTabs';
import {
  hasReservationFilterParams, parseReservationFilter, tabFilterKey, toBookingsState, writeReservationFilter, type ReservationListFilter,
} from '../../domain/reservationFilter';
import { BookingFilterBar } from './BookingFilters';
import { RequestFilterBar } from '../requests/RequestFilters';
import { SentRequestCard, SentRequestList } from '../requests/RequestsPage';

const TRIP_LABEL = { expected: '마감 전 예상 출장비', confirmed: '확정 출장비', locked: '유지되는 확정 출장비' } as const;

/** 확정된 방문 일정 라벨(대표 상태가 방문 예정이면 ‘방문 예정’, 그 밖에는 ‘방문 일정’) */
export const visitLabel = (b: BookingListItem['booking']) => (b.status === 'confirmed' && b.workStatus === 'scheduled' ? '방문 예정' : '방문 일정');

/**
 * 예약 카드: 업체 · [대표 상태] / 작업 / 방문 일정 / 출장비 / (할 일이 있으면) 주황 점 + 행동 문구 한 줄. 구체 확인 내용·안내 문구는 상세에서(목록에는 정보 아이콘·설명 문구 없음).
 * 기존 일정 방문 불가 · 새 일정 미확정이면 기존 날짜를 방문 예정처럼 보이지 않게 날짜 자리에 ‘방문 일정 조율 중’.
 * 후속 방문 일정이 확정된 작업은 그 날짜를 방문 예정으로 보여준다.
 */
export function BookingCard({ it }: { it: BookingListItem }) {
  const b = it.booking;
  const disp = it.display;
  const followUpNext = b.status === 'confirmed' && b.workStatus === 'followup_waiting' && b.followUp;
  return (
    <Link to={`/bookings/${b.id}`} className={`card stack--sm stack${disp.actions.length ? ' card--todo' : ''}`} style={{ textDecoration: 'none', color: 'inherit' }}>
      {/* 할 일이 있을 때만 상단 머리(처리는 상세 상단 확인 카드에서) */}
      <TodoHead actions={disp.actions} />
      {/* 첫 행: 작업명(가장 크고 굵게, 줄바꿈) · 상태 태그 · 상세 이동 꺾쇠 → 그 아래 업체명(기본 크기·보통 굵기). 요청 카드와 같은 위계(spec 5.50·5.51) */}
      <div className="card-top">
        <p className="strong card-top__title">{b.tasks.map((t) => t.title).join(' · ')}</p>
        <StatusBadges d={disp} />
        <CardChevron />
      </div>
      <p className="card-provider">{it.providerName}</p>
      {disp.visitPending ? <p className="small">방문 일정 조율 중</p>
        : followUpNext ? <p className="small">후속 방문 예정 · <span className="nowrap">{formatDate(followUpNext.date)}</span> <span className="nowrap">{followUpNext.window}</span></p>
        : <p className="small">{visitLabel(b)} · <VisitText date={b.visitDate} time={b.visitTime} /></p>}
      {b.status === 'confirmed' && it.tripFee.amount !== null && (
        <p className="small muted">{TRIP_LABEL[it.tripFee.kind]} <span className="money">{formatWon(it.tripFee.amount)}</span></p>
      )}
      {/* 취소된 예약: 환불 처리 상태(정보, 행동 안내 아님) */}
      {b.status === 'cancelled' && it.attention && <p className="small muted">{it.attention}</p>}
    </Link>
  );
}

const CODEC: UrlFilterCodec<ReservationListFilter> = { list: 'reservations', parse: parseReservationFilter, write: writeReservationFilter, has: hasReservationFilterParams };

type TabData = { kind: 'requests'; r: RequestListResult } | { kind: 'bookings'; r: BookingQueryResult };

const EMPTY: Record<ReservationTab, { title: string; body: string; icon: string; findLink?: boolean }> = {
  requests: { icon: 'list', title: '보낸 요청이 없어요', body: '업체를 찾아 수리를 요청하면, 예약이 확정되기 전까지 업체 답변과 진행 상황을 여기에서 확인할 수 있어요.', findLink: true },
  active: { icon: 'calendar', title: '확정된 예약이 없어요', body: '업체 승인 후 예약금을 결제하면 확정된 예약이 여기에 나타나요. 승인 대기·결제 대기 요청은 보낸 요청에서 확인해요.', findLink: true },
  past: { icon: 'calendar', title: '완료되거나 취소된 내역이 없어요', body: '이용을 마쳤거나(최종 정산까지 완료) 취소한 예약, 예약 확정 전에 취소한 요청이 여기에 모여요.' },
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
  const count = ready && !q.error && q.data ? (q.data.kind === 'requests' ? q.data.r.bundles.length : q.data.r.items.length + q.data.r.cancelledRequests.length) : undefined;
  const empty = EMPTY[tab];
  const todo = useTodoCounts();

  return (
    <Page title="내 예약" tabs>
      <h2 style={{ fontSize: 'var(--fs-xl)' }}>내 예약</h2>
      {/* 밑줄형 탭(시각 디자인만 — tablist·tab·tabpanel 관계, 방향키 이동, URL·탭별 위치 복원은 그대로) */}
      <div className="tabs-bar">
        <div role="tablist" aria-label="내 예약 구분" aria-orientation="horizontal" className="tabs">
          {RESERVATION_TABS.map((t, i) => (
            <button key={t.value} type="button" ref={(el) => { tabRefs.current[i] = el; }} role="tab" id={`res-tab-${t.value}`} aria-controls="res-panel"
              className="tabs__tab" data-label={t.label} aria-selected={tab === t.value} tabIndex={tab === t.value ? 0 : -1} onClick={() => setTab(t.value)} onKeyDown={(e) => onTabKey(e, i)}>
              {/* 확인 필요 건수(탭 전체, 필터와 무관). 완료·취소에는 없음(spec 5.48) */}
              <span className="tabs__label">{t.label}{t.value !== 'past' && <CountBadge n={todo?.[t.value]} />}</span>
            </button>
          ))}
        </div>
      </div>
      <div role="tabpanel" id="res-panel" aria-labelledby={`res-tab-${tab}`} className="stack stack--lg res-panel">
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
            const n = d.kind === 'requests' ? d.r.bundles.length : d.r.items.length + d.r.cancelledRequests.length;
            return (
              <>
                {d.kind === 'bookings' && d.r.excludedMissingVisitDate > 0 && <p className="small muted">방문일이 확인되지 않은 예약 {d.r.excludedMissingVisitDate}건은 방문일 조건에서 제외했어요. ‘전체 기간’에서는 보여요.</p>}
                {/* 요청 취소는 확정 방문일이 없어 방문일 조건에 맞출 수 없다(요청일·취소일로 대신하지 않음, spec 5.47) */}
                {d.kind === 'bookings' && d.r.excludedCancelledRequests > 0 && <p className="small muted">요청 취소 {d.r.excludedCancelledRequests}건은 확정된 방문일이 없어 방문일 조건에서 제외했어요. ‘전체 기간’에서는 보여요.</p>}
                {n === 0 ? (
                  // 초기화 버튼은 두지 않는다. 위 필터는 그대로 조작할 수 있다.
                  <EmptyState icon="filter" title={d.kind === 'requests' ? '선택한 조건에 맞는 요청이 없어요.' : '선택한 조건에 맞는 예약이 없어요.'}>날짜나 상태를 변경해주세요.</EmptyState>
                ) : d.kind === 'requests' ? (
                  <SentRequestList bundles={d.r.bundles} busy={q.loading} />
                ) : (
                  <ul className="stack booking-list" aria-busy={q.loading || undefined}>
                    {d.r.items.map((it) => <li key={it.booking.id}><BookingCard it={it} /></li>)}
                    {/* 완료·취소 탭: 예약 다음에 요청 취소(요청 카드 그대로, 누르면 요청 상세) */}
                    {d.r.cancelledRequests.map((i) => (
                      <li key={i.request.id}><SentRequestCard b={{ bundleId: i.request.bundleId, taskTitles: i.request.tasks.map((t) => t.title), items: [i], updatedAt: i.request.updatedAt, hiddenItemCount: 0 }} /></li>
                    ))}
                  </ul>
                )}
              </>
            );
          }}
        </AsyncView>
      </div>
    </Page>
  );
}
