import { useState } from 'react';
import { Icon } from '../../components/Icon';
import { Button, Dialog, Field } from '../../components/ui';
import {
  PERIOD_OPTIONS, STATUS_GROUP_OPTIONS, customRangeError, formatYmdDots, periodButtonLabel, statusSummary,
  type PeriodPreset, type RequestFilter, type StatusGroup,
} from '../../domain/requestFilter';

type Open = { kind: 'status' | 'period'; anchor: HTMLElement } | null;

/**
 * 내 요청 필터 막대: [요청 상태 ▾] [접수일 ▾]  요청 묶음 N건. 초기화 버튼은 두지 않는다(각 필터의 ‘전체’로 그 조건만 해제).
 * 버튼을 누르면 편집용 선택지(모바일 하단 시트, 데스크톱 팝오버)를 열고 ‘적용’ 때만 반영한다. 적용 전에 닫으면 기존 조건 유지.
 * 필터 규칙·상태 매핑은 src/domain/requestFilter.ts.
 */
export function RequestFilterBar({ filter, onApply, count }: { filter: RequestFilter; onApply: (f: RequestFilter) => void; count?: number }) {
  const [open, setOpen] = useState<Open>(null);
  const status = statusSummary(filter);
  const period = periodButtonLabel(filter);
  const apply = (f: RequestFilter) => { setOpen(null); onApply(f); };
  return (
    <div className="filter-bar">
      <div className="filter-bar__buttons" role="group" aria-label="요청 필터">
        <CapsuleButton label="요청 상태" value={status} onClick={(el) => setOpen({ kind: 'status', anchor: el })} />
        <CapsuleButton label="접수일" value={period} onClick={(el) => setOpen({ kind: 'period', anchor: el })} />
      </div>
      <p className="filter-bar__count small" aria-live="polite">{count === undefined ? ' ' : <>요청 묶음 <b>{count}</b>건</>}</p>
      {open?.kind === 'status' && <StatusPicker filter={filter} anchor={open.anchor} onClose={() => setOpen(null)} onApply={apply} />}
      {open?.kind === 'period' && <PeriodPicker filter={filter} anchor={open.anchor} onClose={() => setOpen(null)} onApply={apply} />}
    </div>
  );
}

/** 캡슐형 필터 버튼. 기본값이면 필터 이름, 적용되면 선택값을 보여주고 연한 블루로 구분한다. */
function CapsuleButton({ label, value, onClick }: { label: string; value: string | null; onClick: (el: HTMLElement) => void }) {
  const active = value !== null;
  return (
    <button type="button" className={`capsule${active ? ' capsule--on' : ''}`} aria-haspopup="dialog"
      aria-label={`${label} 필터: ${value ?? (label === '접수일' ? '전체 기간' : '전체')}`} onClick={(e) => onClick(e.currentTarget)}>
      <span className="capsule__text">{value ?? label}</span>
      <Icon name="down" size={16} />
    </button>
  );
}

function Choice({ name, checked, onChange, children, hint }: { name: string; checked: boolean; onChange: () => void; children: string; hint?: string }) {
  return (
    <label className={`choice${checked ? ' choice--on' : ''}`}>
      <input type="radio" name={name} checked={checked} onChange={onChange} />
      <span className="grow">{children}{hint && <span className="choice__hint">{hint}</span>}</span>
      {checked && <span className="choice__mark" aria-hidden>선택됨</span>}
    </label>
  );
}

const ENDED_HINT = '업체 거절·철회·승인 만료·다른 업체 예약으로 종료';

function StatusPicker({ filter, anchor, onClose, onApply }: { filter: RequestFilter; anchor: HTMLElement; onClose: () => void; onApply: (f: RequestFilter) => void }) {
  const [draft, setDraft] = useState<StatusGroup>(filter.status); // 편집 중인 값(적용 전에는 목록에 반영하지 않음)
  return (
    <Dialog title="요청 상태" onClose={onClose} closeLabel="닫기" anchor={anchor}
      actions={<Button variant="primary" block onClick={() => onApply({ ...filter, status: draft })}>적용</Button>}>
      <fieldset className="choices">
        <legend className="sr-only">요청 상태(하나 선택)</legend>
        {STATUS_GROUP_OPTIONS.map((o) => (
          <Choice key={o.value} name="status-group" checked={draft === o.value} onChange={() => setDraft(o.value)} hint={o.value === 'ended' ? ENDED_HINT : undefined}>{o.label}</Choice>
        ))}
      </fieldset>
    </Dialog>
  );
}

function PeriodPicker({ filter, anchor, onClose, onApply }: { filter: RequestFilter; anchor: HTMLElement; onClose: () => void; onApply: (f: RequestFilter) => void }) {
  const [period, setPeriod] = useState<PeriodPreset>(filter.period);
  const [from, setFrom] = useState(filter.from ?? '');
  const [to, setTo] = useState(filter.to ?? '');
  const [touched, setTouched] = useState(false);
  const custom = period === 'custom';
  const errs = custom ? customRangeError(from, to) : null;
  const apply = () => {
    setTouched(true);
    if (errs) return;
    onApply(custom ? { status: filter.status, period, from, to } : { status: filter.status, period });
  };
  return (
    <Dialog title="접수일" onClose={onClose} closeLabel="닫기" anchor={anchor}
      actions={<Button variant="primary" block onClick={apply}>적용</Button>}>
      <p className="small muted">수리를 요청한 날(요청 접수일) 기준이에요. 방문일이 아니에요. 한국 시간 기준이며 시작일과 종료일을 모두 포함해요.</p>
      <fieldset className="choices">
        <legend className="sr-only">기간</legend>
        {PERIOD_OPTIONS.map((o) => (
          <Choice key={o.value} name="period" checked={period === o.value} onChange={() => setPeriod(o.value)}>{o.label}</Choice>
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
          {from && to && !errs && <p className="small">선택 기간: <b className="nowrap">{formatYmdDots(from)}</b> ~ <b className="nowrap">{formatYmdDots(to)}</b></p>}
        </div>
      )}
    </Dialog>
  );
}
