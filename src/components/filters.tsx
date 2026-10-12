import { useState, type ReactNode } from 'react';
import { Icon } from './Icon';
import { Button, Dialog, Field } from './ui';
import { customRangeError, formatYmdDots } from '../domain/requestFilter';
import type { IsoDate } from '../domain/types';

/*
 * 목록 필터 공통 UI(내 요청·내 예약). 캡슐형 버튼 → 편집용 선택지(데스크톱 팝오버, 모바일 하단 시트, 공통 Dialog).
 * 편집 중인 값은 ‘적용’ 때만 반영하고, 적용 전에 닫으면 기존 조건을 유지한다. 초기화 버튼은 두지 않는다(‘전체’로 해제).
 */

/** 캡슐형 필터 버튼. 기본값이면 필터 이름, 적용되면 선택값을 보여주고 연한 블루로 구분한다. */
export function CapsuleButton({ label, value, defaultValue, onClick }: { label: string; value: string | null; defaultValue: string; onClick: (el: HTMLElement) => void }) {
  const active = value !== null;
  return (
    <button type="button" className={`capsule${active ? ' capsule--on' : ''}`} aria-haspopup="dialog"
      aria-label={`${label} 필터: ${value ?? defaultValue}`} onClick={(e) => onClick(e.currentTarget)}>
      <span className="capsule__text">{value ?? label}</span>
      <Icon name="down" size={16} />
    </button>
  );
}

/** 켜고 끄는 캡슐형 토글(바로 적용). 선택 상태는 aria-pressed와 체크 표시로 알린다. */
export function ToggleCapsule({ label, pressed, onToggle }: { label: string; pressed: boolean; onToggle: () => void }) {
  return (
    <button type="button" className={`capsule capsule--toggle${pressed ? ' capsule--on' : ''}`} aria-pressed={pressed} onClick={onToggle}>
      <span className="capsule__check" aria-hidden>{pressed && <Icon name="check" size={14} />}</span>
      <span className="capsule__text">{label}</span>
    </button>
  );
}

export function Choice({ name, checked, onChange, children, hint }: { name: string; checked: boolean; onChange: () => void; children: string; hint?: string }) {
  return (
    <label className={`choice${checked ? ' choice--on' : ''}`}>
      {/* 키보드로 옮겨 온 항목을 포커스 표시까지 보이게 스크롤한다(브라우저는 작은 라디오만 보이게 맞춘다) */}
      <input type="radio" name={name} checked={checked} onChange={onChange} onFocus={(e) => e.currentTarget.closest('label')?.scrollIntoView({ block: 'nearest' })} />
      <span className="grow">{children}{hint && <span className="choice__hint">{hint}</span>}</span>
      {checked && <span className="choice__mark" aria-hidden>선택됨</span>}
    </label>
  );
}

/** 단일 선택 목록 */
export function OptionPicker<T extends string>({ title, name, options, value, anchor, onClose, onApply, note }: {
  title: string; name: string; options: { value: T; label: string; hint?: string }[]; value: T; anchor: HTMLElement;
  onClose: () => void; onApply: (v: T) => void; note?: ReactNode;
}) {
  const [draft, setDraft] = useState<T>(value); // 편집 중인 값
  return (
    <Dialog title={title} onClose={onClose} closeLabel="닫기" anchor={anchor}
      actions={<Button variant="primary" block onClick={() => onApply(draft)}>적용</Button>}>
      {note}
      <fieldset className="choices">
        <legend className="sr-only">{title}(하나 선택)</legend>
        {options.map((o) => <Choice key={o.value} name={name} checked={draft === o.value} onChange={() => setDraft(o.value)} hint={o.hint}>{o.label}</Choice>)}
      </fieldset>
    </Dialog>
  );
}

export interface PeriodValue<P extends string> { period: P; from?: IsoDate; to?: IsoDate }

/** 기간 선택(프리셋 + 직접 선택). 직접 선택은 시작·종료일 필수, 시작일이 늦으면 오류 */
export function PeriodPicker<P extends string>({ title, name, options, value, anchor, onClose, onApply, note }: {
  title: string; name: string; options: { value: P; label: string }[]; value: PeriodValue<P>; anchor: HTMLElement;
  onClose: () => void; onApply: (v: PeriodValue<P>) => void; note?: ReactNode;
}) {
  const [period, setPeriod] = useState<P>(value.period);
  const [from, setFrom] = useState(value.from ?? '');
  const [to, setTo] = useState(value.to ?? '');
  const [touched, setTouched] = useState(false);
  const custom = period === 'custom';
  const errs = custom ? customRangeError(from, to) : null;
  const apply = () => {
    setTouched(true);
    if (errs) return;
    onApply(custom ? { period, from, to } : { period });
  };
  return (
    <Dialog title={title} onClose={onClose} closeLabel="닫기" anchor={anchor}
      actions={<Button variant="primary" block onClick={apply}>적용</Button>}>
      {note}
      <fieldset className="choices">
        <legend className="sr-only">기간</legend>
        {options.map((o) => <Choice key={o.value} name={name} checked={period === o.value} onChange={() => setPeriod(o.value)}>{o.label}</Choice>)}
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
