import { useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ActionBar, Page } from '../../app/Page';
import { useRepo } from '../../app/context';
import { useAction, useAsync, useAttemptKey } from '../../app/hooks';
import { addHours, formatDate, formatDateTime, seoulYmd } from '../../domain/time';
import { formatWon } from '../../domain/money';
import type { DateChangePreview } from '../../domain/pricing';
import { AsyncView, Banner, Button, Field, KV, Section } from '../../components/ui';

const SLOTS = ['09:00–12:00', '13:00–16:00', '16:00–19:00'];

function PreviewRows({ pv, free }: { pv: DateChangePreview; free: boolean }) {
  const fee = free ? 0 : pv.changeFee;
  return (
    <>
      <KV rows={[
        { k: '변경 비용(기존 확정 출장비 몫)', v: <span className="money">{formatWon(fee)}</span> },
        { k: '이어서 쓰는 예약금', v: <span className="money">{formatWon(free ? pv.carriedDeposit + pv.changeFee : pv.carriedDeposit)}</span> },
        { k: '새 일정에 필요한 예약금', v: <span className="money">{formatWon(pv.requiredDeposit)}</span> },
        { k: '추가로 결제할 금액', v: <span className="money strong">{formatWon(free ? Math.max(0, pv.requiredDeposit - pv.carriedDeposit - pv.changeFee) : pv.shortfall)}</span>, total: true },
      ]} />
      {pv.excessUndecided > 0 && <p className="xs muted">새 일정의 예약금이 더 적어 남는 {formatWon(pv.excessUndecided)}의 처리 방식은 아직 정해지지 않았어요. 업체 제안 단계에서 안내돼요.</p>}
    </>
  );
}

/** C-15 날짜·시간 변경 요청. 합의 전까지 기존 일정과 조건이 유지된다. */
export function ChangeRequestPage() {
  const { id = '' } = useParams();
  const [sp] = useSearchParams();
  const delayId = sp.get('delay') ?? undefined;
  const repo = useRepo();
  const nav = useNavigate();
  const detail = useAsync(() => repo.getBooking(id), [repo, id]);
  const opts = useAsync(() => repo.listChangeOptions(id), [repo, id]);
  const action = useAction();
  const key = useAttemptKey('chg');
  const [mode, setMode] = useState<'group' | 'new' | 'time'>('group');
  const [groupId, setGroupId] = useState('');
  const [newDate, setNewDate] = useState('');
  const [slot, setSlot] = useState('');
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);

  return (
    <Page title="날짜·시간 변경 요청" back={`/bookings/${id}`}>
      <AsyncView state={detail}>
        {(d) => {
          const b = d.booking;
          if (b.status !== 'confirmed') return <Banner tone="info" title="변경할 수 없는 예약이에요">취소되었거나 이미 종료된 예약은 일정을 바꿀 수 없어요.</Banner>;
          const free = !!delayId;
          const o = opts.data ?? [];
          const group = o.find((x) => x.group.id === groupId);
          const minDate = seoulYmd(addHours(repo.now(), 48));
          const slotChoices = mode === 'group' ? (group?.group.slots ?? []) : SLOTS.filter((s) => mode !== 'time' || s !== b.visitWindow);
          const errs = {
            target: mode === 'group' && !groupId ? '변경할 공동 날짜를 선택해 주세요.' : mode === 'new' && (!newDate || newDate < minDate) ? `${formatDate(minDate)} 이후 날짜를 선택해 주세요.` : null,
            slot: !slot ? '시간대를 선택해 주세요.' : null,
            reason: !free && !reason.trim() ? '변경 사유를 입력해 주세요.' : null,
          };
          const valid = !Object.values(errs).some(Boolean);
          const submit = () => {
            setTouched(true);
            if (!valid) return;
            void action.run(async () => {
              const p = await repo.requestChange({
                bookingId: id, kind: mode === 'time' ? 'time' : 'date', targetGroupId: mode === 'group' ? groupId : undefined,
                newDateWish: mode === 'new' ? newDate : undefined, newSlot: slot,
                reason: reason.trim() || '방문 지연에 따른 무료 일정 변경', delayId, idempotencyKey: key.get(),
              });
              nav(`/proposals/${p.id}`, { state: { flash: '변경 요청을 보냈어요. 업체가 동의하기 전까지 기존 일정이 유지돼요.' } });
            });
          };
          return (
            <form className="stack stack--lg" noValidate onSubmit={(e) => { e.preventDefault(); submit(); }}>
              <Banner tone="info" title="합의 전까지 기존 일정이 유지돼요">업체가 동의하고 내가 최종 확인하기 전에는 지금 예약이 그대로예요.</Banner>
              {free && <Banner tone="success" title="방문 지연으로 인한 무료 변경이에요">변경 수수료 없이 확정 출장비가 유지돼요.</Banner>}
              <div className="card"><KV rows={[
                { k: '지금 일정', v: <span>{formatDate(b.visitDate)}<br />{b.visitWindow}</span> },
                { k: '공동 예약 마감', v: <span className="nowrap">{formatDateTime(d.group.closeAt)} {d.groupClosed ? '(마감됨)' : ''}</span> },
              ]} /></div>

              <Section title="어떻게 바꿀까요?">
                <div className="stack--sm stack" role="radiogroup" aria-label="변경 방식">
                  <label className="radio-card"><input type="radio" name="mode" checked={mode === 'group'} onChange={() => { setMode('group'); setSlot(''); }} /><span className="grow"><b>다른 공동 날짜로</b><br /><span className="small muted">참여할 수 있는 다른 날짜로 옮겨요.</span></span></label>
                  <label className="radio-card"><input type="radio" name="mode" checked={mode === 'new'} onChange={() => { setMode('new'); setSlot(''); }} /><span className="grow"><b>새 날짜로</b><br /><span className="small muted">원하는 날짜를 제안하면 업체가 조건을 알려줘요.</span></span></label>
                  <label className="radio-card"><input type="radio" name="mode" checked={mode === 'time'} onChange={() => { setMode('time'); setSlot(''); }} /><span className="grow"><b>같은 날 시간만</b><br /><span className="small muted">방문 날짜는 그대로 시간대만 바꿔요.</span></span></label>
                </div>
              </Section>

              {mode === 'group' && (
                <Section title="참여할 수 있는 공동 날짜">
                  <AsyncView state={opts}>
                    {(list) => list.length === 0 ? <Banner tone="info" title="지금 옮길 수 있는 공동 날짜가 없어요">새 날짜로 변경을 요청해 보세요.</Banner> : (
                      <div className="stack--sm stack" role="radiogroup" aria-label="공동 날짜">
                        {list.map((x) => (
                          <label key={x.group.id} className="radio-card">
                            <input type="radio" name="grp" checked={groupId === x.group.id} onChange={() => { setGroupId(x.group.id); setSlot(''); }} />
                            <div className="grow stack--sm stack">
                              <span className="strong">{formatDate(x.group.date)}</span>
                              <span className="small muted">접수 마감 {formatDateTime(x.group.closeAt)} · 확정 {x.group.confirmedHouseholds}세대</span>
                              {groupId === x.group.id && <PreviewRows pv={x.preview} free={free} />}
                            </div>
                          </label>
                        ))}
                      </div>
                    )}
                  </AsyncView>
                  {touched && errs.target && <p className="field__error" role="alert">{errs.target}</p>}
                </Section>
              )}
              {mode === 'new' && (
                <Section title="희망 날짜">
                  <Field label="희망 방문 날짜" error={touched ? errs.target : null}>{(p) => <input {...p} type="date" className="input" min={minDate} value={newDate} onChange={(e) => setNewDate(e.target.value)} />}</Field>
                  <Banner tone="info">새 그룹의 출장비와 예약금은 업체가 일정을 제안할 때 알려드려요. 지금은 비용이 청구되지 않아요.</Banner>
                </Section>
              )}
              {mode === 'time' && <Banner tone="info" title="같은 날 시간 변경은 업체가 승인하면 무료예요" />}

              <Section title="희망 시간대">
                {slotChoices.length === 0 ? <p className="small muted">먼저 변경할 날짜를 선택해 주세요.</p> : (
                  <div className="chips" role="group" aria-label="희망 시간대">
                    {slotChoices.map((s) => <button key={s} type="button" className="chip" aria-pressed={slot === s} onClick={() => setSlot(s)}>{s}</button>)}
                  </div>
                )}
                {touched && errs.slot && <p className="field__error" role="alert">{errs.slot}</p>}
              </Section>

              <Field label={free ? '변경 사유 (선택)' : '변경 사유'} error={touched ? errs.reason : null}>
                {(p) => <textarea {...p} className="textarea" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />}
              </Field>
              {action.error && <Banner tone="danger" title={action.error.title}>{action.error.hint}</Banner>}
              <ActionBar note="제출해도 비용은 아직 청구되지 않아요"><Button type="submit" variant="primary" block busy={action.busy}>변경 요청 보내기</Button></ActionBar>
            </form>
          );
        }}
      </AsyncView>
    </Page>
  );
}
