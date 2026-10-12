import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { ActionBar, Page } from '../../app/Page';
import { useAppState, useRepo } from '../../app/context';
import { useAsync } from '../../app/hooks';
import { formatDate, formatDateTime, formatRemaining } from '../../domain/time';
import { formatSlot } from '../../domain/visitTime';
import { formatWon } from '../../domain/money';
import { expectedFeeForJoiner, tripFeeSavings } from '../../domain/pricing';
import { seatsLeft } from '../../domain/rules';
import type { ProviderDetail, PublicGroup } from '../../domain/types';
import { Icon } from '../../components/Icon';
import { AsyncView, Badge, Banner, KV, LinkButton, PhoneButton, Section, Stars } from '../../components/ui';
import { initialOf } from '../shared';

function GroupOption({ g, now, checked, onChange }: { g: PublicGroup; now: string; checked: boolean; onChange: () => void }) {
  const left = seatsLeft(g);
  const fee = expectedFeeForJoiner(g.totalTripFee, g.confirmedHouseholds);
  const sv = tripFeeSavings(g.totalTripFee, g.confirmedHouseholds + 1);
  return (
    <label className="radio-card">
      <input type="radio" name="slot" checked={checked} onChange={onChange} />
      <div className="grow stack--sm stack">
        <div className="row row--between row--wrap">
          <span className="strong">{formatDate(g.date)}</span>
          <Badge tone="info">{g.scopeType === 'complex' ? '같은 단지' : '가까운 이웃'}</Badge>
        </div>
        <p className="small">고를 수 있는 가능 시간 <span className="nowrap">{g.slots.map(formatSlot).join(' / ')}</span></p>
        <p className="small">접수 마감 <span className="nowrap">{formatDateTime(g.closeAt)}</span> <span className="muted">({formatRemaining(now, g.closeAt)})</span></p>
        <KV rows={[
          { k: '확정 세대', v: `${g.confirmedHouseholds}세대` },
          { k: '결제 대기 자리', v: `${g.pendingSeats}자리` },
          { k: '남은 자리', v: `${left}자리` },
          { k: '그룹 총 출장비', v: <span className="money">{formatWon(g.totalTripFee)}</span> },
          { k: '내 예상 출장비', v: <span className="money strong">약 {formatWon(fee)}</span> },
        ]} />
        <p className="xs muted">
          예상 출장비는 지금 확정된 세대와 나를 기준으로 나눈 값이에요. 결제 대기 자리는 세대 수에 넣지 않으며, 마감 때 확정된 세대 수로 최종 확정돼요.
          {sv && <> 혼자 방문하는 경우보다 {formatWon(sv.amount)}({sv.percent}%) 덜 내는 계산이에요.</>}
        </p>
      </div>
    </label>
  );
}

function Body({ p, addressId, now }: { p: ProviderDetail; addressId: string | null; now: string }) {
  const [sel, setSel] = useState<string>('');
  const joint = p.groups;
  const target = sel === 'new' ? `/providers/${p.id}/request?new=1` : sel ? `/providers/${p.id}/request?group=${sel}` : null;
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
        {addressId !== null && joint.length > 0 && <p className="xs muted">선택한 지역·건물 기준의 공동 예약 후보예요. 신청할 때 정확한 방문 주소로 동일 단지·최초 예약지 반경 300m 조건을 다시 확인해요.</p>}
        {addressId !== null && p.jointAvailable !== null && joint.length === 0 && (
          <Banner tone="info" title="지금 참여할 수 있는 공동 날짜가 없어요">새 날짜로 요청하면, 이후 가까운 이웃이 같은 날을 선택해 함께할 수 있어요.</Banner>
        )}
        <fieldset className="stack--sm stack" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="sr-only">요청할 날짜 선택</legend>
          {joint.map((g) => <GroupOption key={g.id} g={g} now={now} checked={sel === g.id} onChange={() => setSel(g.id)} />)}
          <label className="radio-card">
            <input type="radio" name="slot" checked={sel === 'new'} onChange={() => setSel('new')} />
            <div className="grow stack--sm stack">
              <span className="strong">새 날짜로 요청하기</span>
              <p className="small muted">원하는 날짜를 직접 정해요. 이 업체의 기본 출장비는 <span className="money">{formatWon(p.soloTripFee)}</span>이고, 같은 날 이웃이 함께하면 확정된 세대 수로 나눠요.</p>
            </div>
          </label>
        </fieldset>
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

      <ActionBar note={!target ? '요청할 날짜를 선택해 주세요' : '요청만으로는 예약이 확정되지 않아요'}>
        {target ? <LinkButton to={target} variant="primary" block>이 날짜로 수리 요청하기</LinkButton> : <button className="btn btn--primary btn--block" disabled>수리 요청하기</button>}
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
