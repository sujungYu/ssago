import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ActionBar, Page } from '../../app/Page';
import { useAppState, useRepo } from '../../app/context';
import { useAction, useAsync } from '../../app/hooks';
import { formatDateTime, formatRemaining } from '../../domain/time';
import { formatSlot } from '../../domain/visitTime';
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
 * 선택한 날짜의 공동 예약 카드. 시간은 신청할 수 있는 고객 가능 시간(확정 방문 시각 아님)이다.
 * 내 예상 출장비는 기존 정책 그대로 ‘결제 완료된 확정 세대 + 본인’으로 나눈 값이며, 계산 근거는 ‘출장비 계산 상세’에 접어 둔다.
 */
function JointGroupCard({ g, now, checked, onChange }: { g: PublicGroup; now: string; checked: boolean; onChange: () => void }) {
  const fee = jointFeeView(g);
  return (
    <div className="joint-card">
      <label className="radio-card">
        <input type="radio" name="joint-group" checked={checked} onChange={onChange} aria-describedby={`jg-${g.id}-fee`} />
        <div className="grow stack--sm stack">
          <div className="row row--between row--wrap">
            <span className="strong">신청 가능 시간 <span className="nowrap">{g.slots.map(formatSlot).join(' / ')}</span></span>
            <Badge tone="info">{g.scopeType === 'complex' ? '같은 단지' : '가까운 이웃'}</Badge>
          </div>
          <KV rows={[
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
function JointSchedule({ p, addressId, now, onPick, picked, notice }: {
  p: ProviderDetail; addressId: string; now: string; picked: string | null; notice: UnjoinableReason | null;
  onPick: (groupId: string | null, date?: IsoDate | null) => void;
}) {
  const repo = useRepo();
  const today = todayYmd(now);
  const counts = joinableDateCounts(p.groups, now);
  const [month, setMonth] = useState<YearMonth>(() => initialMonth(today, counts.keys()));
  const [date, setDate] = useState<IsoDate | null>(null);
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
        <p className="jcal__prompt">공동 예약 날짜를 선택해주세요.</p>
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
                시간은 신청할 수 있는 고객 가능 시간이에요. 정확한 방문 시각은 업체가 승인할 때 제안해요.
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
  // 공동 그룹 선택만 이 화면의 선택 상태로 둔다. 새 날짜 요청은 별도 버튼으로 바로 신규 요청 흐름에 들어가 두 선택이 동시에 켜지지 않는다.
  const [picked, setPicked] = useState<{ groupId: string; date: IsoDate } | null>(null);
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
  // 요청서로 넘어가기 전에 최신 상태(마감·자리·주소 범위)를 다시 확인한다. 제출할 때도 저장소가 한 번 더 검증한다.
  const request = () => go.run(async () => {
    if (!picked || !addressId) return;
    const fresh = await repo.listJointGroups(p.id, addressId, picked.date);
    if (fresh.some((g) => g.id === picked.groupId)) { nav(`/providers/${p.id}/request?group=${picked.groupId}`); return; }
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
      <div className="chips" aria-label="수행 작업">{p.scope.map((s) => <Badge key={s} tone="info">{s}</Badge>)}</div>

      <Section title="공동 예약 일정">
        {addressId === null && <Banner tone="info" title="지역·건물 주소를 설정해 주세요">주소를 정하면 참여할 수 있는 공동 날짜를 보여드려요.</Banner>}
        {addressId === null && <LinkButton to={`/address?back=${encodeURIComponent(`/providers/${p.id}`)}`} variant="secondary" block><Icon name="pin" size={18} />지역·건물 주소 설정하기</LinkButton>}
        {addressId !== null && p.jointAvailable === null && (
          <Banner tone="warn" title="현재 공동 예약 참여 가능 여부를 확인하기 어려워요">다시 확인하기 전에는 참여할 수 있다고 안내하지 않아요. 새 날짜로 요청은 보낼 수 있어요.</Banner>
        )}
        {showCalendar && addressId && (
          <JointSchedule p={p} addressId={addressId} now={now} picked={picked?.groupId ?? null} notice={notice} onPick={onPick} />
        )}
        {go.error && <Banner tone="danger" title={go.error.title}>{go.error.hint}</Banner>}
        {/* 캘린더 밖: 공동 예약이 없는 날짜를 누르는 대신 이 버튼으로 새 날짜를 요청한다 */}
        <div className="card stack--sm stack new-date">
          <LinkButton to={`/providers/${p.id}/request?new=1`} variant="secondary" block><Icon name="calendar" size={18} />다른 날짜로 새 예약 요청</LinkButton>
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

      <ActionBar note={picked ? '요청만으로는 예약이 확정되지 않아요. 업체 승인과 예약금 결제 후 확정돼요.' : '공동 예약 날짜와 일정을 선택해 주세요'}>
        <Button variant="primary" block disabled={!picked} busy={go.busy} onClick={() => void request()}>선택한 일정으로 수리 요청하기</Button>
      </ActionBar>
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
