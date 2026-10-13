import { Fragment, useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { returnState } from '../../app/backNav';
import { loadProviderPick, saveProviderPick, type ProviderPick } from '../../app/context';
import { Page } from '../../app/Page';
import { useAppState, useRepo } from '../../app/context';
import { useAction, useAsync } from '../../app/hooks';
import { formatDate, formatDateTime, formatRemaining } from '../../domain/time';
import { selectableTimes } from '../../domain/visitTime';
import { formatWon } from '../../domain/money';
import { seatsLeft } from '../../domain/rules';
import {
  formatDayTitle, initialMonth, joinableDateCounts, jointFeeView, monthRange, todayYmd, unjoinableReason, UNJOINABLE_TEXT, type UnjoinableReason, type YearMonth,
} from '../../domain/jointCalendar';
import type { IsoDate, ProviderDetail, PublicGroup } from '../../domain/types';
import { Icon } from '../../components/Icon';
import { AsyncView, Badge, Banner, Button, ErrorState, KV, LinkButton, PhoneButton, Section, Skeleton, Stars } from '../../components/ui';
import { initialOf } from '../shared';
import { JointCalendar } from './JointCalendar';

/**
 * 선택한 날짜의 공동 예약 카드. ‘신청 가능한 시각’은 그 그룹 시간대에서 요청서와 같은 기준(selectableTimes, 1시간 간격)으로 만든
 * 요청 후보 시각을 안내만 한다(선택 버튼 아님, 확정 방문 시각 아님). 실제 다중 선택은 요청서에서 한다.
 * 내 예상 출장비는 기존 정책 그대로 ‘결제 완료된 확정 세대 + 본인’으로 나눈 값이며, 계산 근거는 ‘출장비 계산 상세’에 접어 둔다.
 */
function JointGroupCard({ g, now, checked, onChange }: { g: PublicGroup; now: string; checked: boolean; onChange: () => void }) {
  const fee = jointFeeView(g);
  const times = selectableTimes(g.slots);
  const scope = g.scopeType === 'complex' ? '같은 단지' : '가까운 이웃';
  // 시간 제목이 없으므로 라디오 이름에 날짜·참여 조건·신청 가능한 시각·마감을 담는다
  const name = `${formatDate(g.date)} ${scope} 공동 예약 · 신청 가능한 시각 ${times.join(', ')} · 접수 마감 ${formatDateTime(g.closeAt)}`;
  return (
    <div className="joint-card">
      <label className="radio-card">
        <input type="radio" name="joint-group" checked={checked} onChange={onChange} aria-label={name} aria-describedby={`jg-${g.id}-fee`} />
        <div className="grow stack--sm stack">
          <div className="row row--wrap"><Badge tone="info">{scope}</Badge></div>
          <KV rows={[
            // 신청 가능한 시각: 그룹 시간대에서 요청서와 같은 기준으로 만든 후보(안내용 값, 선택 버튼 아님). 길면 값 영역 안에서 시각 단위로 줄바꿈
            { k: '신청 가능한 시각', v: <span className="kv__times">{times.map((t, i) => <Fragment key={t}>{i > 0 && ' · '}<span className="nowrap">{t}</span></Fragment>)}</span> },
            { k: '접수 마감', v: <><span className="nowrap">{formatDateTime(g.closeAt)}</span> <span className="muted nowrap">({formatRemaining(now, g.closeAt)})</span></> },
            { k: '확정 세대', v: `${fee.confirmed}세대` },
            { k: '남은 자리', v: `${seatsLeft(g)}자리` },
            { k: '내 예상 출장비', v: <span id={`jg-${g.id}-fee`}><span className="money strong">약 {formatWon(fee.myFee)}</span><span className="xs muted" style={{ display: 'block' }}>본인 예약 확정 시 {fee.householdsWithMe}세대 기준</span></span> },
          ]} />
        </div>
      </label>
      <details className="disclosure joint-card__detail">
        <summary>출장비 계산 상세<Icon name="chevron" size={18} /></summary>
        <KV rows={[
          { k: '그룹 총 출장비', v: <span className="money">{formatWon(g.totalTripFee)}</span> },
          { k: '현재 확정 세대(결제 완료)', v: `${fee.confirmed}세대` },
          { k: '결제 대기 자리', v: `${g.pendingSeats}자리 · 분담 세대 수에서 제외` },
          { k: '본인 예약 확정 시 분담', v: <><span className="money strong">약 {formatWon(fee.myFee)}</span><span className="xs muted" style={{ display: 'block' }}>{formatWon(g.totalTripFee)} ÷ {fee.householdsWithMe}세대</span></> },
          ...(fee.savings ? [{ k: '혼자 방문할 때와 비교', v: <span className="money">{formatWon(fee.savings.amount)}({fee.savings.percent}%) 덜 내요</span> }] : []),
        ]} />
        <p className="xs muted">원 단위는 내림해요. 마감 전에 다른 세대가 확정되면 더 줄어들 수 있고, 최종 출장비는 마감 때 확정된 세대 수로 정해져요.</p>
      </details>
    </div>
  );
}

/** 날짜 선택 → 그 날짜의 신청 가능한 공동 예약 카드 → 그룹 하나 선택(자동 선택 없음) */
function JointSchedule({ p, addressId, now, onPick, picked, notice, restored, onView }: {
  p: ProviderDetail; addressId: string; now: string; picked: string | null; notice: UnjoinableReason | null;
  onPick: (groupId: string | null, date?: IsoDate | null) => void;
  /** 이 기록 항목에 저장해 둔 선택(요청서에서 뒤로 돌아온 경우). 이동은 하지 않고 화면 상태만 되살린다 */
  restored: ProviderPick | null;
  onView: (v: { date: IsoDate | null; month: YearMonth }) => void;
}) {
  const repo = useRepo();
  const today = todayYmd(now);
  const counts = joinableDateCounts(p.groups, now);
  const [month, setMonth] = useState<YearMonth>(() => restored?.month ?? initialMonth(today, counts.keys()));
  const [date, setDate] = useState<IsoDate | null>(() => restored?.date ?? null);
  useEffect(() => { onView({ date, month }); }, [date, month]); // eslint-disable-line react-hooks/exhaustive-deps
  const day = useAsync(() => (date ? repo.listJointGroups(p.id, addressId, date) : Promise.resolve(null)), [repo, p.id, addressId, date]);

  // 선택 후 최신 상태에서 그 그룹을 신청할 수 없게 되면 선택을 풀고 사유를 알린다
  useEffect(() => {
    if (!picked || !day.data || day.loading) return;
    if (!day.data.some((g) => g.id === picked)) onPick(null, date);
  }, [day.data, day.loading, picked]); // eslint-disable-line react-hooks/exhaustive-deps

  if (counts.size === 0) {
    return <Banner tone="info" title="현재 신청 가능한 공동 예약이 없어요.">아래 ‘다른 날짜로 새 예약 요청’으로 원하는 날짜를 요청할 수 있어요. 이후 가까운 이웃이 같은 날을 선택하면 함께할 수 있어요.</Banner>;
  }
  return (
    <div className="stack">
      <JointCalendar month={month} range={monthRange(today, counts.keys())} counts={counts} today={today} selected={date}
        onMonth={setMonth} onSelect={(d) => { setDate(d); onPick(null, d); }} />
      {date === null ? (
        <>
          {notice && <Banner tone="warn" title="선택한 일정을 신청할 수 없게 됐어요">{UNJOINABLE_TEXT[notice]} 다른 날짜를 고르거나 새 예약을 요청해 주세요.</Banner>}
          <p className="jcal__prompt">공동 예약 날짜를 선택해주세요.</p>
        </>
      ) : (
        <div className="stack" aria-live="polite">
          <h3>{formatDayTitle(date, today)}의 공동 예약</h3>
          {notice && (
            <Banner tone="warn" title="선택한 일정을 신청할 수 없게 됐어요">{UNJOINABLE_TEXT[notice]} 같은 날짜의 다른 일정을 고르거나 다른 날짜로 새 예약을 요청해 주세요.</Banner>
          )}
          {day.error ? <ErrorState error={day.error} onRetry={day.reload} /> : !day.data ? (
            <div className="stack--sm stack" aria-busy="true"><span className="sr-only">공동 예약을 불러오는 중이에요</span><Skeleton h={150} /></div>
          ) : day.data.length === 0 ? (
            <p className="muted">이 날짜에는 지금 신청할 수 있는 공동 예약이 없어요. 다른 날짜를 고르거나 새 예약을 요청해 주세요.</p>
          ) : (
            <>
              <p className="xs muted">
                신청 가능한 시각은 요청할 수 있는 후보예요. 요청서에서 방문 가능한 시각을 여러 개 고르면 업체가 그중 방문 시간을 제안해요.
                내 예상 출장비는 결제 대기 자리를 빼고, 본인 예약이 확정되면 함께 나눌 세대 수로 계산했어요. 최종 출장비는 마감 때 확정된 세대 수로 정해져요.
                선택한 지역·건물 기준 후보이며, 신청할 때 정확한 방문 주소로 동일 단지·최초 예약지 반경 300m 조건을 다시 확인해요.
              </p>
              <fieldset className="stack--sm stack" style={{ border: 0, padding: 0, margin: 0 }}>
                <legend className="sr-only">{formatDayTitle(date, today)} 공동 예약 중 하나 선택</legend>
                {day.data.map((g) => <JointGroupCard key={g.id} g={g} now={now} checked={picked === g.id} onChange={() => onPick(g.id, date)} />)}
              </fieldset>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Body({ p, addressId, now }: { p: ProviderDetail; addressId: string | null; now: string }) {
  const repo = useRepo();
  const nav = useNavigate();
  const loc = useLocation();
  // 이 기록 항목(location.key)에 저장해 둔 선택. 요청서에서 뒤로 돌아오면 같은 항목이라 날짜·그룹·달을 되살린다.
  // 저장해 둔 날짜가 지금 신청 가능한 날짜가 아니면(일정 변경·마감 등) 날짜·그룹·달을 되살리지 않고 정리한다.
  // 그룹까지 골라 두었던 경우에만 신청할 수 없게 됐다고 알린다.
  const [{ restored, staleGroup }] = useState(() => {
    const r = loadProviderPick(loc.key, p.id);
    if (!r?.date || joinableDateCounts(p.groups, now).has(r.date)) return { restored: r, staleGroup: null as string | null };
    return { restored: null, staleGroup: r.groupId };
  });
  // 공동 그룹 선택만 이 화면의 선택 상태로 둔다. 새 날짜 요청은 별도 버튼으로 바로 신규 요청 흐름에 들어가 두 선택이 동시에 켜지지 않는다.
  const [picked, setPicked] = useState<{ groupId: string; date: IsoDate } | null>(() => (restored?.groupId && restored.date ? { groupId: restored.groupId, date: restored.date } : null));
  const [view, setView] = useState<{ date: IsoDate | null; month: YearMonth } | null>(null);
  // 선택이 바뀔 때마다 이 기록 항목에 저장한다(저장만 하고 화면 이동은 하지 않는다)
  useEffect(() => {
    if (view) saveProviderPick(loc.key, { providerId: p.id, date: view.date, month: view.month, groupId: picked?.groupId ?? null });
  }, [view, picked, loc.key, p.id]);
  const [notice, setNotice] = useState<UnjoinableReason | null>(null);
  const go = useAction();
  const onPick = (groupId: string | null, date?: IsoDate | null) => {
    if (groupId && date) { setPicked({ groupId, date }); setNotice(null); return; }
    // 날짜를 바꾸면 이전 선택을 조용히 푼다. 같은 날짜에서 그룹을 신청할 수 없게 되면 사유를 알린다.
    if (picked && date === picked.date) void explain(picked.groupId);
    else setNotice(null);
    setPicked(null);
  };
  /** 신청할 수 없게 된 사유: 최신 업체 정보(마감 시각·남은 자리·주소 범위)로 판단한다 */
  const explain = async (groupId: string) => {
    const latest = await repo.getProvider(p.id, addressId).catch(() => null);
    setNotice(unjoinableReason(latest?.groups.find((g) => g.id === groupId), repo.now()) ?? 'unavailable');
  };
  useEffect(() => { if (staleGroup) void explain(staleGroup); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // 요청서로 넘어가기 전에 최신 상태(마감·자리·주소 범위)를 다시 확인한다. 제출할 때도 저장소가 한 번 더 검증한다.
  const request = () => go.run(async () => {
    if (!picked || !addressId) return;
    const fresh = await repo.listJointGroups(p.id, addressId, picked.date);
    if (fresh.some((g) => g.id === picked.groupId)) { nav(`/providers/${p.id}/request?group=${encodeURIComponent(picked.groupId)}`, { state: returnState(loc.pathname) }); return; }
    await explain(picked.groupId);
    setPicked(null);
  });
  const showCalendar = addressId !== null && p.jointAvailable !== null;
  return (
    <>
      <div className="row row--top">
        <span className="avatar" aria-hidden>{initialOf(p.name)}</span>
        <div className="grow">
          <h2 style={{ fontSize: 'var(--fs-xl)' }}>{p.name}</h2>
          <p className="small muted"><Stars value={p.rating} /> {p.rating.toFixed(1)} · 리뷰 {p.reviewCount}개 · {p.area}</p>
        </div>
      </div>
      <p>{p.intro}</p>
      {/* 제공 작업: 요청서의 작업 선택 칩과 같은 업체 등록 작업(ID·이름·순서). 여기서는 안내용(선택·클릭 없음) */}
      {p.services.length > 0 && <ul className="svc-tags" aria-label="제공 작업">{p.services.map((s) => <li key={s.id} className="svc-tag">{s.name}</li>)}</ul>}

      <Section title="공동 예약 일정">
        {addressId === null && <Banner tone="info" title="지역·건물 주소를 설정해 주세요">주소를 정하면 참여할 수 있는 공동 날짜를 보여드려요.</Banner>}
        {addressId === null && <LinkButton to={`/address?back=${encodeURIComponent(`/providers/${p.id}`)}`} variant="secondary" block><Icon name="pin" size={18} />지역·건물 주소 설정하기</LinkButton>}
        {addressId !== null && p.jointAvailable === null && (
          <Banner tone="warn" title="현재 공동 예약 참여 가능 여부를 확인하기 어려워요">다시 확인하기 전에는 참여할 수 있다고 안내하지 않아요. 새 날짜로 요청은 보낼 수 있어요.</Banner>
        )}
        {showCalendar && addressId && (
          <JointSchedule p={p} addressId={addressId} now={now} picked={picked?.groupId ?? null} notice={notice} onPick={onPick} restored={restored} onView={setView} />
        )}
        {go.error && <Banner tone="danger" title={go.error.title}>{go.error.hint}</Banner>}
        {/* 캘린더 밖: 공동 예약이 없는 날짜를 누르는 대신 이 버튼으로 새 날짜를 요청한다 */}
        <div className="card stack--sm stack new-date">
          <LinkButton to={`/providers/${p.id}/request?new=1`} state={returnState(loc.pathname)} variant="secondary" block><Icon name="calendar" size={18} />다른 날짜로 새 예약 요청</LinkButton>
          <p className="xs muted">원하는 날짜를 직접 정해요. 이 업체의 기본 출장비는 <span className="money">{formatWon(p.soloTripFee)}</span>이고, 같은 날 이웃이 함께하면 확정된 세대 수로 나눠요.</p>
        </div>
      </Section>

      <Section title="리뷰">
        {p.reviews.length === 0 ? <p className="muted small">아직 리뷰가 없어요.</p> : (
          <ul className="card card--flush divided">
            {p.reviews.map((r) => (
              <li key={r.id} className="stack--sm stack" style={{ padding: 'var(--sp-4)' }}>
                <div className="row row--between"><span className="small strong">{r.author} · {r.workLabel}</span><Stars value={r.rating} /></div>
                <p className="small">{r.body}</p>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="연락처·사후 처리 조건">
        <div className="card stack">
          <PhoneButton phone={p.phone} name={p.name} />
          <p className="xs muted">연락은 전화로 해요. 앱 안 채팅은 제공하지 않아요.</p>
          <h3>업체가 제시하는 사후 처리 조건</h3>
          <ul className="stack--sm stack">{p.afterServiceTerms.map((t) => <li key={t} className="small">· {t}</li>)}</ul>
          <p className="xs muted">위 조건은 업체가 직접 안내하는 내용이에요. 싸고가 공통 사후 보증(A/S)을 제공하는 것은 아니에요.</p>
        </div>
      </Section>

      {/* 하단 고정 없이 마지막 본문 다음(간격 24px)에 둔다. 공동 예약 그룹을 고르면 켜진다 */}
      <Button variant="primary" block disabled={!picked} busy={go.busy} onClick={() => void request()}>선택한 일정으로 수리 요청하기</Button>
    </>
  );
}

export function ProviderDetailPage() {
  const { id = '' } = useParams();
  const repo = useRepo();
  const { addressId } = useAppState();
  const q = useAsync(() => repo.getProvider(id, addressId), [repo, id, addressId]);
  return (
    <Page title={q.data?.name ?? '업체 상세'} back="history">
      <AsyncView state={q}>{(p) => <Body p={p} addressId={addressId} now={repo.now()} />}</AsyncView>
    </Page>
  );
}
