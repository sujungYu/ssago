import { useState } from 'react';
import { Icon } from '../../components/Icon';
import { Button, Dialog, Field } from '../../components/ui';
import {
  DEFAULT_REQUEST_FILTER, PERIOD_OPTIONS, STATUS_FILTER_OPTIONS, customRangeError, formatYmdDots, isDefaultFilter,
  periodSummary, statusSummary, toggleStatus, type PeriodPreset, type RequestFilter,
} from '../../domain/requestFilter';
import type { RequestStatus } from '../../domain/types';

type Sheet = 'period' | 'status' | null;

/**
 * 내 요청 필터 막대: 요청 접수일·상태 버튼, 결과 건수, (적용 중일 때) 초기화.
 * 버튼을 누르면 시트(좁은 화면: 하단, 넓은 화면: 가운데)에서 조건을 고르고 ‘적용’으로 반영한다.
 * 시트에서 바꾸다 닫으면 적용값은 그대로다.
 */
export function RequestFilterBar({ filter, onApply, onReset, count }: {
  filter: RequestFilter; onApply: (f: RequestFilter) => void; onReset: () => void; count?: number;
}) {
  const [open, setOpen] = useState<Sheet>(null);
  const periodOn = filter.period !== 'all';
  const statusOn = filter.statuses.length > 0;
  return (
    <div className="filter-bar">
      <div className="filter-bar__buttons" role="group" aria-label="요청 필터">
        <FilterButton icon="calendar" label="요청 접수일" value={periodSummary(filter)} active={periodOn} onClick={() => setOpen('period')} />
        <FilterButton icon="filter" label="상태" value={statusSummary(filter)} active={statusOn} onClick={() => setOpen('status')} />
      </div>
      <div className="filter-bar__summary">
        <p className="small" aria-live="polite">{count === undefined ? ' ' : <>요청 묶음 <b>{count}</b>건</>}</p>
        {!isDefaultFilter(filter) && <Button variant="ghost" sm onClick={onReset}><Icon name="refresh" size={16} />필터 초기화</Button>}
      </div>
      {open === 'period' && <PeriodSheet filter={filter} onClose={() => setOpen(null)} onApply={(f) => { setOpen(null); onApply(f); }} />}
      {open === 'status' && <StatusSheet filter={filter} onClose={() => setOpen(null)} onApply={(f) => { setOpen(null); onApply(f); }} />}
    </div>
  );
}

function FilterButton({ icon, label, value, active, onClick }: { icon: string; label: string; value: string; active: boolean; onClick: () => void }) {
  return (
    <button type="button" className={`filter-btn${active ? ' filter-btn--on' : ''}`} aria-haspopup="dialog" onClick={onClick}
      aria-label={`${label} 필터: ${value}${active ? ', 적용 중' : ', 기본값'}`}>
      <Icon name={icon} size={18} />
      <span className="filter-btn__text">
        <span className="filter-btn__label">{label}</span>
        <span className="filter-btn__value">{value}</span>
      </span>
      {active && <Icon name="check" size={16} />}
    </button>
  );
}

function Choice({ type, name, checked, onChange, children }: { type: 'radio' | 'checkbox'; name: string; checked: boolean; onChange: () => void; children: string }) {
  return (
    <label className={`choice${checked ? ' choice--on' : ''}`}>
      <input type={type} name={name} checked={checked} onChange={onChange} />
      <span className="grow">{children}</span>
      {checked && <span className="choice__mark" aria-hidden>선택됨</span>}
    </label>
  );
}

function PeriodSheet({ filter, onClose, onApply }: { filter: RequestFilter; onClose: () => void; onApply: (f: RequestFilter) => void }) {
  const [period, setPeriod] = useState<PeriodPreset>(filter.period);
  const [from, setFrom] = useState(filter.from ?? '');
  const [to, setTo] = useState(filter.to ?? '');
  const [touched, setTouched] = useState(false);
  const custom = period === 'custom';
  const errs = custom ? customRangeError(from, to) : null;
  const apply = () => {
    setTouched(true);
    if (errs) return;
    onApply(custom ? { ...filter, period, from, to } : { statuses: filter.statuses, period });
  };
  return (
    <Dialog title="요청 접수일" onClose={onClose} closeLabel="닫기"
      actions={<>
        <Button variant="primary" block onClick={apply}>적용</Button>
        <Button variant="secondary" block onClick={() => { setPeriod('all'); setFrom(''); setTo(''); setTouched(false); }}>기간 초기화</Button>
      </>}>
      <p className="small muted">수리를 요청한 날(요청 접수일) 기준이에요. 방문 예정일이 아니에요. 한국 시간 기준이며 시작일과 종료일을 모두 포함해요.</p>
      <fieldset className="choices">
        <legend className="sr-only">기간</legend>
        {PERIOD_OPTIONS.map((o) => (
          <Choice key={o.value} type="radio" name="period" checked={period === o.value} onChange={() => setPeriod(o.value)}>{o.label}</Choice>
        ))}
      </fieldset>
      {custom && (
        <div className="stack stack--sm">
          <div className="date-range">
            <Field label="시작일" error={touched ? errs?.from : null}>
              {(fp) => <input {...fp} className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />}
            </Field>
            <Field label="종료일" error={touched ? errs?.to : null}>
              {(fp) => <input {...fp} className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} />}
            </Field>
          </div>
          {from && to && !errs && <p className="small">선택 기간: <b>{formatYmdDots(from)} ~ {formatYmdDots(to)}</b></p>}
        </div>
      )}
    </Dialog>
  );
}

function StatusSheet({ filter, onClose, onApply }: { filter: RequestFilter; onClose: () => void; onApply: (f: RequestFilter) => void }) {
  const [picked, setPicked] = useState<RequestStatus[]>(filter.statuses);
  const all = picked.length === 0;
  return (
    <Dialog title="요청 상태" onClose={onClose} closeLabel="닫기"
      actions={<>
        <Button variant="primary" block onClick={() => onApply({ ...filter, statuses: picked })}>적용</Button>
        <Button variant="secondary" block onClick={() => setPicked(DEFAULT_REQUEST_FILTER.statuses)}>상태 초기화</Button>
      </>}>
      <p className="small muted">여러 상태를 고르면 하나라도 해당하는 요청을 보여줘요.</p>
      <fieldset className="choices">
        <legend className="sr-only">상태(여러 개 선택 가능)</legend>
        <Choice type="checkbox" name="status" checked={all} onChange={() => setPicked([])}>전체 상태</Choice>
        {STATUS_FILTER_OPTIONS.map((o) => (
          <Choice key={o.value} type="checkbox" name="status" checked={picked.includes(o.value)} onChange={() => setPicked((p) => toggleStatus(p, o.value))}>{o.label}</Choice>
        ))}
      </fieldset>
    </Dialog>
  );
}
