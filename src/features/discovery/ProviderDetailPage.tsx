import { Fragment, useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { returnState } from '../../app/backNav';
import { loadProviderPick, saveProviderPick } from '../../app/context';
import { Page } from '../../app/Page';
import { useAppState, useRepo } from '../../app/context';
import { useAction, useAsync } from '../../app/hooks';
import { formatDate, formatDateTime, formatRemaining } from '../../domain/time';
import { selectableTimes } from '../../domain/visitTime';
import { formatWon } from '../../domain/money';
import { seatsLeft } from '../../domain/rules';
import {
  formatDayTitle, initialMonth, jointFeeView, monthRange, todayYmd, unjoinableReason, UNJOINABLE_TEXT, type UnjoinableReason, type YearMonth,
} from '../../domain/jointCalendar';
import { NEW_REQUEST_BLOCK_TEXT, jointNoteForNewDay, newRequestBlock, visitDays } from '../../domain/visitDays';
import type { IsoDate, ProviderDetail, PublicGroup } from '../../domain/types';
import { Icon } from '../../components/Icon';
import { AsyncView, Badge, Banner, Button, ErrorState, KV, LinkButton, PhoneButton, Section, Skeleton, Stars } from '../../components/ui';
import { initialOf } from '../shared';
import { JointCalendar } from './JointCalendar';
import { ProviderIntro, ProviderPortfolio } from './ProviderShowcase';

/**
 * 선택한 날짜의 공동 예약 카드. ‘신청 가능한 시각’은 그 그룹 시간대에서 요청서와 같은 기준(selectableTimes, 1시간 간격)으로 만든
 * 요청 후보 시각을 안내만 한다(선택 버튼 아님, 확정 방문 시각 아님). 실제 다중 선택은 요청서에서 한다.
 * 내 예상 출장비는 기존 정책 그대로 ‘결제 완료된 확정 세대 + 본인’으로 나눈 값(계산 기준 ‘본인 예약 확정 시 N세대 기준’).
 * 표시 라벨은 ‘공동 예약’ 하나다(참여 조건 scopeType 데이터는 그대로 두고, 여러 그룹일 때 라디오 이름에만 쓴다).
 * select가 없으면(그 날짜 그룹이 하나 — 자동 선택) 라디오 없는 카드, 있으면(같은 날 여러 그룹) 기존처럼 라디오로 하나를 고른다.
 */
function JointGroupCard({ g, now, select }: { g: PublicGroup; now: string; select?: { checked: boolean; onChange: () => void } }) {
  const fee = jointFeeView(g);
  const times = selectableTimes(g.slots);
  const body = (
    <div className="grow stack--sm stack">
      <div className="row row--wrap"><Badge tone="info">공동 예약</Badge></div>
      <KV rows={[
        // 신청 가능한 시각: 그룹 시간대에서 요청서와 같은 기준으로 만든 후보(안내용 값, 선택 버튼 아님). 길면 값 영역 안에서 시각 단위로 줄바꿈
        { k: '신청 가능한 시각', v: <span className="kv__times">{times.map((t, i) => <Fragment key={t}>{i > 0 && ' · '}<span className="nowrap">{t}</span></Fragment>)}</span> },
        { k: '접수 마감', v: <><span className="nowrap">{formatDateTime(g.closeAt)}</span> <span className="muted nowrap">({formatRemaining(now, g.closeAt)})</span></> },
        { k: '확정 세대', v: `${fee.confirmed}세대` },
        { k: '남은 자리', v: `${seatsLeft(g)}자리` },
        { k: '내 예상 출장비', v: <span id={`jg-${g.id}-fee`}><span className="money strong">약 {formatWon(fee.myFee)}</span><span className="xs muted" style={{ display: 'block' }}>본인 예약 확정 시 {fee.householdsWithMe}세대 기준</span></span> },
      ]} />
    </div>
  );
  if (!select) return <div className="joint-card card">{body}</div>;
  const scope = g.scopeType === 'complex' ? '같은 단지' : '가까운 이웃';
  // 시간 제목이 없으므로 라디오 이름에 날짜·참여 조건·신청 가능한 시각·마감을 담는다
  const name = `${formatDate(g.date)} ${scope} 공동 예약 · 신청 가능한 시각 ${times.join(', ')} · 접수 마감 ${formatDateTime(g.closeAt)}`;
  return (
    <div className="joint-card">
      <label className="radio-card">
        <input type="radio" name="joint-group" checked={select.checked} onChange={select.onChange} aria-label={name} aria-describedby={`jg-${g.id}-fee`} />
        {body}
      </label>
    </div>
  );
}

/**
 * 새 요청 날짜를 고르면 보이는 안내. 희망 날짜로 요청할 수 있다는 뜻일 뿐 방문 확정일이 아니다(업체가 방문 가능 여부를 확인한다).
 * 공동 예약 안내(jointNote)는 그 날짜에 마감·정원 초과 그룹이 있으면 그 사유, 없으면 ‘현재 참여 가능한 공동 예약은 없어요’.
 */
function NewDayCard({ title, jointNote, soloTripFee }: { title: string; jointNote: string; soloTripFee: number }) {
  return (
    <div className="card stack--sm stack new-day">
      <div className="row row--wrap"><Badge>새 요청</Badge></div>
      <h3>{title}에 새 요청</h3>
      <p className="small">{jointNote}</p>
      <p className="small">업체가 방문 가능 여부를 확인해요.</p>
      <KV rows={[{ k: '기본 출장비', v: <span className="money strong">{formatWon(soloTripFee)}</span> }]} />
      <p className="xs muted">이후 이웃이 함께하면 출장비를 나눠 낼 수 있어요.</p>
    </div>
  );
}

function Body({ p, addressId, now }: { p: ProviderDetail; addressId: string | null; now: string }) {
  const repo = useRepo();
  const nav = useNavigate();
  const loc = useLocation();
  const today = todayYmd(now);
  // 공동 예약 날짜는 조회 주소가 있고 참여 가능 여부를 확인할 수 있을 때만. 새 요청 날짜는 업체 접수 기준으로 따로 판단한다(visitDays)
  const showJoint = addressId !== null && p.jointAvailable !== null;
  const days = visitDays(showJoint ? p.groups : [], p.newRequest, now);
  // 이 기록 항목(location.key)에 저장해 둔 선택. 요청서에서 뒤로 돌아오면 같은 항목이라 날짜·그룹·달을 되살린다.
  // 저장한 날짜를 지금 고를 수 없으면(일정 변경·마감·접수 기준 변경) 날짜·그룹을 정리한다(골라 둔 그룹이 신청 불가가 되면 날짜도 푼다).
  // 그룹까지 골라 두었던 경우에만 신청할 수 없게 됐다고 알린다.
  const [init] = useState(() => {
    const r = loadProviderPick(loc.key, p.id);
    const kind = r?.date ? days.kindOf(r.date) : 'none';
    // 골라 둔 그룹을 더 이상 신청할 수 없으면 그 날짜가 새 요청 날짜여도 날짜까지 풀어, 공동 예약 대신 새 요청으로 조용히 바뀌지 않게 한다
    const keep = !!r?.date && kind !== 'none' && !(r.groupId && kind !== 'joint');
    return {
      date: keep ? r!.date : null,
      groupId: keep && kind === 'joint' ? r!.groupId : null,
      month: r?.month ?? initialMonth(today, days.all),
      staleGroup: r?.groupId && kind !== 'joint' ? r.groupId : null,
    };
  });
  const [date, setDate] = useState<IsoDate | null>(init.date);
  const [month, setMonth] = useState<YearMonth>(init.month);
  const [groupId, setGroupId] = useState<string | null>(init.groupId);
  const [notice, setNotice] = useState<UnjoinableReason | null>(null);
  const [newBlock, setNewBlock] = useState<string | null>(null);
  // 선택이 바뀔 때마다 이 기록 항목에 저장한다(저장만 하고 화면 이동은 하지 않는다)
  useEffect(() => {
    saveProviderPick(loc.key, { providerId: p.id, date, month, groupId });
  }, [date, month, groupId, loc.key, p.id]);

  const kind = date ? days.kindOf(date) : 'none';
  const day = useAsync(() => (kind === 'joint' && date && addressId ? repo.listJointGroups(p.id, addressId, date) : Promise.resolve(null)), [repo, p.id, addressId, date, kind]);
  // 공동 예약 날짜였지만 최신 조회에서 신청 가능한 그룹이 없으면, 새 요청 기준을 따로 확인해 새 요청 날짜로 안내한다(공동 예약 우선은 참여 가능할 때만)
  const jointGone = kind === 'joint' && !!day.data && !day.loading && day.data.length === 0;
  const view: 'joint' | 'new' | 'none' = jointGone ? (date && days.newDates.has(date) ? 'new' : 'none') : kind;

  /** 신청할 수 없게 된 사유: 최신 업체 정보(마감 시각·남은 자리·주소 범위)로 판단한다 */
  const explain = async (gid: string) => {
    const latest = await repo.getProvider(p.id, addressId).catch(() => null);
    setNotice(unjoinableReason(latest?.groups.find((g) => g.id === gid), repo.now()) ?? 'unavailable');
  };
  useEffect(() => { if (init.staleGroup) void explain(init.staleGroup); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // 고른 그룹을 최신 상태에서 신청할 수 없게 되면(날짜가 더 이상 공동 예약 날짜가 아닌 경우 포함) 선택을 풀고 사유를 알린다
  useEffect(() => {
    if (!groupId) return;
    if (kind !== 'joint') { void explain(groupId); setGroupId(null); return; }
    if (!day.data || day.loading) return;
    if (!day.data.some((g) => g.id === groupId)) { void explain(groupId); setGroupId(null); }
  }, [day.data, day.loading, groupId, kind]); // eslint-disable-line react-hooks/exhaustive-deps

  // 날짜를 고른 뒤 그 날짜의 신청 가능한 그룹이 하나면 그 그룹을 자동 선택한다(날짜마다 한 번).
  // 여러 그룹이면 고르지 않고, 신청 불가로 선택이 풀린 뒤에는 다시 자동 선택하지 않는다(사유 안내 유지).
  // 자동 선택을 이미 판단한 날짜. 되살린 그룹이 있으면 그 날짜는 판단한 것으로 본다(풀린 뒤 자동으로 다시 고르지 않음)
  const [autoDate, setAutoDate] = useState<IsoDate | null>(init.groupId ? init.date : null);
  useEffect(() => {
    if (view !== 'joint' || !date || !day.data || day.loading || autoDate === date) return;
    setAutoDate(date);
    if (!groupId && day.data.length === 1) setGroupId(day.data[0].id);
  }, [view, date, day.data, day.loading, groupId, autoDate]);

  // 날짜를 바꾸면 이전 그룹 선택·안내를 조용히 푼다(날짜 유형이 바뀌어도 이전 그룹이 남지 않음)
  const selectDate = (d: IsoDate) => { setDate(d); setGroupId(null); setNotice(null); setNewBlock(null); };
  const pickGroup = (gid: string) => { setGroupId(gid); setNotice(null); };

  const go = useAction();
  // 요청서로 넘어가기 전에 최신 상태를 다시 확인한다. 제출할 때도 저장소가 한 번 더 검증한다.
  // 공동 예약: 고른 그룹 ID만 넘긴다(날짜·시간대·마감·출장비는 요청서가 그 그룹에서 읽음). 새 요청: 희망 날짜만 넘기고 그룹 ID는 넣지 않는다.
  const request = () => go.run(async () => {
    if (!date) return;
    if (view === 'joint') {
      if (!groupId || !addressId) return;
      const fresh = await repo.listJointGroups(p.id, addressId, date);
      if (fresh.some((g) => g.id === groupId)) { nav(`/providers/${p.id}/request?group=${encodeURIComponent(groupId)}`, { state: returnState(loc.pathname) }); return; }
      await explain(groupId);
      setGroupId(null);
      return;
    }
    if (view === 'new') {
      const latest = await repo.getProvider(p.id, addressId);
      const block = newRequestBlock(latest.newRequest, date, repo.now());
      if (block) { setNewBlock(NEW_REQUEST_BLOCK_TEXT[block]); return; }
      nav(`/providers/${p.id}/request?new=1&date=${date}`, { state: returnState(loc.pathname) });
    }
  });
  const canRequest = !!date && (view === 'new' ? !newBlock : view === 'joint' && !!groupId);
  const title = date ? formatDayTitle(date, today) : '';

  return (
    <>
      <div className="row row--top">
        <span className="avatar" aria-hidden>{initialOf(p.name)}</span>
        <div className="grow">
          <h2 style={{ fontSize: 'var(--fs-xl)' }}>{p.name}</h2>
          <p className="small muted"><Stars value={p.rating} /> {p.rating.toFixed(1)} · 리뷰 {p.reviewCount}개 · {p.area}</p>
        </div>
      </div>
      {/* 기본 정보 → 제공 작업 칩 → 업체 소개 → 작업 사례 → 방문 날짜 선택 순서 */}
      {/* 제공 작업: 요청서의 작업 선택 칩과 같은 업체 등록 작업(ID·이름·순서). 제목 없이 칩만, 안내용(선택·클릭 없음) */}
      {p.services.length > 0 && <ul className="svc-tags" aria-label="제공 작업">{p.services.map((s) => <li key={s.id} className="svc-tag">{s.name}</li>)}</ul>}
      {/* 소개·사례는 업체 데이터(profile·portfolio)를 공통 컴포넌트로 보여준다 */}
      {p.profile ? <ProviderIntro intro={p.intro} profile={p.profile} /> : <p>{p.intro}</p>}
      <ProviderPortfolio cases={p.portfolio} />

      {/* 방문 날짜 선택: 공동 예약 참여와 새 요청을 캘린더 하나에서 고른다(날짜 유형으로 두 흐름을 구분) */}
      <Section title="방문 날짜 선택">
        {addressId === null && (
          <>
            <Banner tone="info" title="지역·건물 주소를 설정해 주세요">주소를 정하면 참여할 수 있는 공동 예약 날짜도 함께 보여드려요. 지금은 새 요청 날짜만 고를 수 있어요.</Banner>
            <LinkButton to={`/address?back=${encodeURIComponent(`/providers/${p.id}`)}`} variant="secondary" block><Icon name="pin" size={18} />지역·건물 주소 설정하기</LinkButton>
          </>
        )}
        {addressId !== null && p.jointAvailable === null && (
          <Banner tone="warn" title="현재 공동 예약 참여 가능 여부를 확인하기 어려워요">다시 확인하기 전에는 참여할 수 있다고 안내하지 않아요. 새 요청 날짜는 고를 수 있어요.</Banner>
        )}
        {days.all.length === 0 ? (
          <Banner tone="info" title="지금 고를 수 있는 방문 날짜가 없어요">이 업체에 참여할 수 있는 공동 예약이 없고, 새 요청을 받는 날짜도 없어요. 업체에 전화로 문의해 주세요.</Banner>
        ) : (
          <>
            <JointCalendar month={month} range={monthRange(today, days.all)} kindOf={days.kindOf} jointCount={(d) => days.joint.get(d) ?? 0}
              today={today} selected={date} onMonth={setMonth} onSelect={selectDate} />
            {/* 날짜 미선택: 캘린더 안내만 두고 별도 안내 문구는 없다(요청 버튼은 비활성) */}
            {date === null ? (
              notice && <Banner tone="warn" title="선택한 일정을 신청할 수 없게 됐어요">{UNJOINABLE_TEXT[notice]} 다른 날짜를 골라 주세요.</Banner>
            ) : (
              <div className="stack" aria-live="polite">
                {notice && <Banner tone="warn" title="선택한 일정을 신청할 수 없게 됐어요">{UNJOINABLE_TEXT[notice]} 같은 날짜의 다른 일정이나 다른 날짜를 골라 주세요.</Banner>}
                {view === 'joint' ? (
                  day.error ? <ErrorState error={day.error} onRetry={day.reload} /> : !day.data ? (
                    <div className="stack--sm stack" aria-busy="true"><span className="sr-only">공동 예약을 불러오는 중이에요</span><Skeleton h={150} /></div>
                  ) : day.data.length === 1 && (groupId === day.data[0].id || autoDate !== date) ? (
                    // 날짜당 그룹 하나(현재 데모): 날짜를 고르면 그 그룹이 자동 선택돼 라디오 없이 카드만 보여준다.
                    // 다른 그룹이 신청 불가가 돼 하나만 남았고 선택이 풀린 경우에는 아래처럼 직접 고르게 한다(자동으로 다시 고르지 않음)
                    <JointGroupCard g={day.data[0]} now={now} />
                  ) : (
                    // 같은 날 여러 그룹(실제 서비스 구조): 임의로 고르거나 숨기지 않고 하나를 직접 고르게 한다
                    <fieldset className="stack--sm stack" style={{ border: 0, padding: 0, margin: 0 }}>
                      <legend className="sr-only">{title} 공동 예약 중 하나 선택</legend>
                      {day.data.map((g) => <JointGroupCard key={g.id} g={g} now={now} select={{ checked: groupId === g.id, onChange: () => pickGroup(g.id) }} />)}
                    </fieldset>
                  )
                ) : view === 'new' ? (
                  <>
                    <NewDayCard title={title} soloTripFee={p.soloTripFee}
                      jointNote={jointGone ? '이 날짜의 공동 예약은 지금 참여할 수 없어요.' : jointNoteForNewDay(date, showJoint ? p.groups : [], showJoint ? p.closedJointDates : [], now)} />
                    {newBlock && <Banner tone="warn" title="이 날짜로는 요청할 수 없게 됐어요">{newBlock} 다른 날짜를 골라 주세요.</Banner>}
                  </>
                ) : (
                  <p className="muted">이 날짜에는 지금 참여할 수 있는 공동 예약이 없고, 새 요청도 받지 않아요. 다른 날짜를 골라 주세요.</p>
                )}
              </div>
            )}
          </>
        )}
        {go.error && <Banner tone="danger" title={go.error.title}>{go.error.hint}</Banner>}
      </Section>

      <Section title="리뷰">
        {p.reviews.length > 0 && <p className="xs muted">가상 데모 리뷰예요. 실제 이용 후기가 아니에요.</p>}
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

      {/* 하단 고정 없이 마지막 본문 다음(간격 24px)에 둔다. 새 요청 날짜는 날짜를 고르면, 공동 예약 날짜는 그룹을 고르면 켜진다 */}
      <Button variant="primary" block disabled={!canRequest} busy={go.busy} onClick={() => void request()}>이 날짜로 수리 요청하기</Button>
    </>
  );
}

export function ProviderDetailPage() {
  const { id = '' } = useParams();
  const repo = useRepo();
  const { addressId } = useAppState();
  const q = useAsync(() => repo.getProvider(id, addressId), [repo, id, addressId]);
  return (
    <Page title={q.data?.name ?? (q.loading ? null : '업체 상세')} back="history">
      <AsyncView state={q}>{(p) => <Body p={p} addressId={addressId} now={repo.now()} />}</AsyncView>
    </Page>
  );
}
