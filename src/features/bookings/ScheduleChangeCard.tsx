import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useRepo } from '../../app/context';
import { useAction, useAttemptKey } from '../../app/hooks';
import { formatWon } from '../../domain/money';
import { addHours, formatDate, seoulYmd } from '../../domain/time';
import { NEW_DATE_WINDOWS, formatSlot, selectableTimes } from '../../domain/visitTime';
import { canRejectKeepingOld, canRequestOther } from '../../domain/scheduleChange';
import { Icon } from '../../components/Icon';
import { ActionCard, Banner, Button, KV, MockPayNotice, PhoneButton } from '../../components/ui';
import type { BookingDetail } from '../../data/repositories/types';
import { VisitText } from '../shared';

/**
 * 예약 상세 상단 ‘일정 변경’ 카드(spec 5.15). 응답이 필요한 변경 제안·요청을 이 카드 하나에서 보여주고 바로 응답한다(별도 확인 화면 없음).
 * - 기존 일정에도 방문 가능(A): [새 일정 수락] / [새 일정 거절](기존 일정 유지)
 * - 기존 일정 방문 불가(B)·확인 필요: [새 일정 수락] / [다른 일정 요청](희망 날짜 + 정확한 시각 전달 → 일정 협의 중 → 업체 재제안 → 고객 수락으로만 확정)
 * - 고객 변경 요청: 업체 응답 대기(철회 가능) / 업체 동의 후 수락·변경하지 않기
 * 새 일정은 수락하기 전까지 확정 일정으로 표시하지 않는다. 처리 중에는 버튼이 잠기고, 실패하면 입력·상태를 그대로 두고 다시 시도할 수 있다.
 */
export function ScheduleChangeCard({ d }: { d: BookingDetail }) {
  const repo = useRepo();
  const nav = useNavigate();
  const action = useAction();
  const respondKey = useAttemptKey('prp');
  const otherKey = useAttemptKey('oth');
  const s = d.schedule;
  const b = d.booking;
  const p = s.open;
  const [otherOpen, setOtherOpen] = useState(false);
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [note, setNote] = useState('');
  const [touched, setTouched] = useState(false);
  const dateRef = useRef<HTMLInputElement>(null);
  const timeRef = useRef<HTMLDivElement>(null);
  if (s.kind === 'normal' || b.status !== 'confirmed') return null;

  const minDate = seoulYmd(addHours(repo.now(), 24));
  const times = selectableTimes(NEW_DATE_WINDOWS);
  const dateErr = !date ? '희망 날짜를 선택해 주세요.' : date < minDate ? `${formatDate(minDate)} 이후 날짜를 선택해 주세요.` : null;
  const timeErr = !time ? '희망 시각을 선택해 주세요.' : null;
  // 협의의 시작이 된 업체 제안(사유·기존 방문 가능 여부 표시용)
  const root = p?.replyTo ? d.proposals.find((x) => x.id === p.replyTo) : p?.origin === 'provider' ? p : d.proposals.filter((x) => x.origin === 'provider').at(-1);
  const unavailable = s.oldVisitUnavailable;
  const providerCause = p?.origin === 'provider' || !!p?.replyTo || p?.free === 'provider' || unavailable;
  const shortfall = p && p.origin === 'customer' && !p.replyTo ? p.cost.additionalDeposit : 0;

  // 제목: 응답이 필요한 제안이면 ‘새 방문 일정을 확인해 주세요’. 응답을 기다리는 상태만 다르게(머리 문구도 대기 상태로)
  const needsResponse = p?.status === 'proposed';
  const title = needsResponse ? '새 방문 일정을 확인해 주세요'
    : s.kind === 'negotiating' ? '새 방문 일정을 협의하고 있어요'
    : s.kind === 'customer_requested' ? '일정 변경을 요청했어요'
    : '새 방문 일정을 정해야 해요';
  // 기존 일정 옆 작은 표시: 방문 불가 / 방문 가능 여부 확인 필요(방문 가능한 제안에는 표시하지 않음 — 데이터 기준, 사유로 추측하지 않음)
  const oldMark = unavailable ? <span className="sched__mark sched__mark--no">방문 불가</span>
    : s.oldVisit === 'unknown' ? <span className="sched__mark">방문 가능 여부 확인 필요</span> : null;
  // 안내는 한 번만. 기존 일정 방문 불가 제안은 일정 비교·‘방문 불가’ 표시·버튼으로 충분해 따로 안내하지 않는다(수락 전에는 확정되지 않는 기준은 그대로)
  const guide = needsResponse
    ? (canRequestOther(p!) ? null : '새 일정을 수락하기 전까지 기존 일정이 유지돼요.')
    : s.kind === 'negotiating' ? '업체가 일정을 다시 제안하면 여기서 수락할 수 있어요.'
    : s.kind === 'customer_requested' ? '업체가 동의하기 전까지 기존 일정이 유지돼요.'
    : '진행 중인 일정 제안이 없어요. 업체에 연락해 새 일정을 정하거나 무료 취소할 수 있어요.';

  const accept = () => p && void action.run(async () => {
    const res = await repo.respondToProposal(p.id, 'accept', respondKey.get());
    if (res.tx) nav(`/pay/${res.tx.id}`); // 고객 요청 변경의 부족분 결제는 기존 결제 결과 화면에서
  });
  const reject = () => p && void action.run(async () => { await repo.respondToProposal(p.id, 'reject', respondKey.get()); });
  const withdraw = () => p && void action.run(async () => { await repo.withdrawProposal(p.id); });
  const sendOther = () => {
    setTouched(true);
    if (dateErr) { dateRef.current?.focus(); return; }
    if (timeErr) { timeRef.current?.querySelector<HTMLInputElement>('input')?.focus(); return; }
    if (!p) return;
    void action.run(async () => {
      await repo.requestOtherSchedule({ proposalId: p.id, date, time, note, idempotencyKey: otherKey.get() });
      setOtherOpen(false);
    });
  };

  // 머리 문구: 고객 응답이 필요하면 ‘확인이 필요해요’, 업체 응답을 기다리기만 하면 그 상태(확인 필요 라벨도 붙지 않음)
  const waiting = s.kind === 'customer_requested' || s.kind === 'negotiating' || s.kind === 'unavailable_open'; // 업체 제안·응답 대기(목록 할 일 없음)
  const newItem = p?.newVisit.time
    ? { k: s.kind === 'customer_request_agreed' ? '업체가 제안한 새 일정' : '제안된 새 일정', v: <VisitText date={p.newVisit.date} time={p.newVisit.time} /> }
    : p ? { k: p.replyTo ? '내가 요청한 희망 일정' : '요청한 일정', v: <span className="nowrap">{formatDate(p.newVisit.date)} {p.newVisit.wishSlot ? formatSlot(p.newVisit.wishSlot) : ''}</span> } : null;

  return (
    <ActionCard id="schedule-change" className="sched" title={title} head={waiting ? '업체 응답을 기다리고 있어요' : undefined}
      actions={!!action.error || (p?.status === 'proposed' && !otherOpen) || (s.kind === 'customer_requested' && p) || s.kind === 'negotiating' || s.kind === 'unavailable_open' || s.oldVisit === 'unknown' || otherOpen ? <>
        {action.error && <Banner tone="danger" title={action.error.title}>{action.error.hint} 다시 시도할 수 있어요.</Banner>}
        {shortfall > 0 && p?.status === 'proposed' && <MockPayNotice compact />}
        {/* 응답 버튼(최신 진행 중 제안에만). 기존 방문 가능: 수락/거절 · 기존 방문 불가: 수락/다른 일정 요청 */}
        {p?.status === 'proposed' && !otherOpen && (
          <div className="detail-actions__pair">
            <Button variant="primary" block busy={action.busy} onClick={accept}>{shortfall > 0 ? `수락하고 ${formatWon(shortfall)} 모의 결제` : '새 일정 수락'}</Button>
            {canRequestOther(p) ? <Button variant="secondary" block disabled={action.busy} onClick={() => setOtherOpen(true)}>다른 일정 요청</Button>
              : canRejectKeepingOld(p) ? <Button variant="secondary" block disabled={action.busy} onClick={reject}>{p.origin === 'provider' ? '새 일정 거절' : '변경하지 않기'}</Button> : null}
          </div>
        )}
        {s.kind === 'customer_requested' && p && <Button variant="secondary" block busy={action.busy} onClick={withdraw}>변경 요청 철회</Button>}
        {(s.kind === 'negotiating' || s.kind === 'unavailable_open' || s.oldVisit === 'unknown') && <PhoneButton phone={d.provider.phone} name={d.provider.name} />}

        {/* 다른 일정 요청: 희망 날짜 + 정확한 시각(희망 일정, 확정 아님) */}
        {otherOpen && p && (
          <div className="stack sched__other" role="group" aria-labelledby="sched-other-title">
            <h3 id="sched-other-title" className="small">다른 일정 요청</h3>
            <p className="xs muted">가능한 날짜와 시각을 업체에 전달해요(희망 일정이에요).</p>
            <label className="field">
              <span className="field__label">희망 날짜</span>
              <input ref={dateRef} type="date" className="input" min={minDate} value={date} onChange={(e) => setDate(e.target.value)}
                aria-invalid={touched && !!dateErr ? true : undefined} aria-describedby={touched && dateErr ? 'sched-date-err' : undefined} />
              {touched && dateErr && <span className="field__error" id="sched-date-err">{dateErr}</span>}
            </label>
            <fieldset className="svc-pick time-pick" ref={timeRef as React.Ref<HTMLFieldSetElement>} aria-describedby={touched && timeErr ? 'sched-time-err' : undefined}>
              <legend className="field__label">희망 시각</legend>
              <div className="svc-chips">
                {times.map((t) => (
                  <label key={t} className="svc-chip">
                    <input type="radio" name="sched-time" className="svc-chip__input" checked={time === t} onChange={() => setTime(t)} />
                    <span className="svc-chip__pill">{time === t && <Icon name="check" size={12} />}<span className="svc-chip__text">{t}</span></span>
                  </label>
                ))}
              </div>
              {touched && timeErr && <span className="field__error" id="sched-time-err">{timeErr}</span>}
            </fieldset>
            <label className="field">
              <span className="field__label">업체에 전할 말 (선택)</span>
              <textarea className="textarea" rows={2} maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
            <div className="detail-actions__pair">
              <Button variant="primary" block busy={action.busy} onClick={sendOther}>희망 일정 보내기</Button>
              <Button variant="secondary" block disabled={action.busy} onClick={() => setOtherOpen(false)}>닫기</Button>
            </div>
          </div>
        )}
      </> : undefined}>
      {/* 일정 비교: 기존 일정 | 제안(요청) 일정 나란히 */}
      <div className="sched-compare">
        <div className="sched-compare__item">
          <span className="sched-compare__k">기존 방문 일정</span>
          <span className="sched-compare__v"><VisitText date={b.visitDate} time={b.visitTime} /></span>
          {oldMark}
        </div>
        {newItem && (
          <div className="sched-compare__item sched-compare__item--new">
            <span className="sched-compare__k">{newItem.k}</span>
            <span className="sched-compare__v">{newItem.v}</span>
          </div>
        )}
      </div>
      <KV rows={[
        ...(root ? [{ k: '변경 사유', v: <span className="sched__reason">{root.reason}</span> }] : []),
        // 방문 불가는 기존 일정 옆 ‘방문 불가’ 표시로만 알린다(같은 내용의 행을 반복하지 않음)
        ...(unavailable ? [] : [{ k: '기존 일정 방문', v: s.oldVisit === 'unknown' ? '가능 여부 확인 필요' : '가능 · 수락 전까지 기존 일정 유지' }]),
        {
          k: '비용',
          v: <span>{providerCause ? '변경 비용 없음 · 확정 출장비 유지'
            : p ? <>변경 비용 {formatWon(p.cost.tripFeeCharged)} · 추가 결제 {formatWon(p.cost.additionalDeposit)}<span className="xs muted" style={{ display: 'block' }}>{p.cost.note}</span></> : '-'}</span>,
        },
      ]} />
      {guide && <p className="small">{guide}</p>}
    </ActionCard>
  );
}
