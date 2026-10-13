import { useState } from 'react';
import { CapsuleButton, OptionPicker, PeriodPicker, ToggleCapsule } from '../../components/filters';
import {
  ACTIVE_PERIOD_OPTIONS, ACTIVE_STATUS_OPTIONS, PAST_PERIOD_OPTIONS, PAST_STATUS_OPTIONS, activeStatusLabel, pastStatusLabel, periodLabel,
  type BookingsFilterState,
} from '../../domain/bookingFilter';

type Open = { kind: 'status' | 'period'; anchor: HTMLElement } | null;

const VISIT_NOTE = (
  <p className="small muted">예약 방문일(한국 시간) 기준이에요. 접수·결제·취소일이 아니에요. 일정 변경은 수락해야 바뀌고, 후속 방문이 있는 작업은 최초 방문일 기준이에요. 시작일과 종료일을 모두 포함해요.</p>
);

/**
 * 예약 탭 필터 막대(탭별 독립). 확정된 예약: [상태 ▾] [방문일 ▾] [확인 필요만]  예약 N건 / 완료·취소: [상태 ▾] [방문일 ▾]  예약 N건.
 * 초기화 버튼 없음(‘전체’·‘전체 기간’으로 그 조건만 해제). 규칙·매핑은 src/domain/bookingFilter.ts.
 */
export function BookingFilterBar({ filter, onApply, count }: { filter: BookingsFilterState; onApply: (f: BookingsFilterState) => void; count?: number }) {
  const [open, setOpen] = useState<Open>(null);
  const done = (f: BookingsFilterState) => { setOpen(null); onApply(f); };
  const active = filter.tab === 'active';
  const a = filter.active, p = filter.past;
  return (
    <div className="filter-bar">
      <div className="filter-bar__buttons" role="group" aria-label={active ? '확정된 예약 필터' : '완료·취소 필터'}>
        <CapsuleButton label="상태" defaultValue="전체" value={active ? activeStatusLabel(a) : pastStatusLabel(p)} onClick={(el) => setOpen({ kind: 'status', anchor: el })} />
        <CapsuleButton label="방문일" defaultValue="전체 기간" value={periodLabel(active ? a : p, active ? ACTIVE_PERIOD_OPTIONS : PAST_PERIOD_OPTIONS)} onClick={(el) => setOpen({ kind: 'period', anchor: el })} />
        {active && <ToggleCapsule label="확인 필요만" pressed={a.actionOnly} onToggle={() => onApply({ ...filter, active: { ...a, actionOnly: !a.actionOnly } })} />}
      </div>
      <p className="filter-bar__count small" aria-live="polite">{count === undefined ? ' ' : <>예약 <b>{count}</b>건</>}</p>

      {open?.kind === 'status' && active && (
        <OptionPicker title="상태" name="booking-active-status" anchor={open.anchor} onClose={() => setOpen(null)} options={ACTIVE_STATUS_OPTIONS}
          value={a.status} onApply={(status) => done({ ...filter, active: { ...a, status } })} />
      )}
      {open?.kind === 'status' && !active && (
        <OptionPicker title="상태" name="booking-past-status" anchor={open.anchor} onClose={() => setOpen(null)} options={PAST_STATUS_OPTIONS}
          note={<p className="small muted">취소된 예약의 환불 처리 중·완료는 각 예약 카드에서 확인해요.</p>}
          value={p.status} onApply={(status) => done({ ...filter, past: { ...p, status } })} />
      )}
      {open?.kind === 'period' && active && (
        <PeriodPicker title="방문일" name="booking-active-visit" anchor={open.anchor} onClose={() => setOpen(null)} options={ACTIVE_PERIOD_OPTIONS}
          note={<>{VISIT_NOTE}<p className="small muted">‘이번 주’는 월요일부터 일요일까지예요.</p></>}
          value={a} onApply={(v) => done({ ...filter, active: { status: a.status, actionOnly: a.actionOnly, ...v } })} />
      )}
      {open?.kind === 'period' && !active && (
        <PeriodPicker title="방문일" name="booking-past-visit" anchor={open.anchor} onClose={() => setOpen(null)} options={PAST_PERIOD_OPTIONS}
          note={<>{VISIT_NOTE}<p className="small muted">‘최근 N일’은 오늘을 포함한 N일이에요.</p></>}
          value={p} onApply={(v) => done({ ...filter, past: { status: p.status, ...v } })} />
      )}
    </div>
  );
}
