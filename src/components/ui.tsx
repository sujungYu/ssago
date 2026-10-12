import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react';
import { Link, type LinkProps } from 'react-router-dom';
import { describeError } from '../domain/errors';
import { formatWon } from '../domain/money';
import type { Tone } from '../domain/rules';
import { Icon } from './Icon';
import type { AsyncState } from '../app/hooks';

// ───────── 버튼 ─────────
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'default';
const vcls = (v: Variant, block?: boolean, sm?: boolean) =>
  ['btn', v !== 'default' && `btn--${v}`, block && 'btn--block', sm && 'btn--sm'].filter(Boolean).join(' ');

export function Button({ variant = 'default', block, sm, busy, children, disabled, ...rest }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; block?: boolean; sm?: boolean; busy?: boolean }) {
  return (
    <button type="button" {...rest} disabled={disabled || busy} aria-busy={busy || undefined} className={vcls(variant, block, sm)}>
      {busy && <span className="btn__spin" aria-hidden />}
      {children}
    </button>
  );
}
export function LinkButton({ variant = 'default', block, sm, children, ...rest }: LinkProps & { variant?: Variant; block?: boolean; sm?: boolean }) {
  return <Link {...rest} className={vcls(variant, block, sm)}>{children}</Link>;
}
export function PhoneButton({ phone, name }: { phone: string; name: string }) {
  return (
    <a className={vcls('secondary', false, true)} href={`tel:${phone.replace(/[^0-9]/g, '')}`}>
      <Icon name="phone" size={16} /> {name}에 전화 <span className="nowrap">{phone}</span>
    </a>
  );
}

// ───────── 표시 ─────────
export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`badge badge--${tone}`}>{children}</span>;
}
export function Money({ value, negative, className }: { value: number; negative?: boolean; className?: string }) {
  return <span className={['money', negative && 'money--neg', className].filter(Boolean).join(' ')}>{negative ? '−' : ''}{formatWon(value)}</span>;
}
export function Banner({ tone = 'info', title, children, icon }: { tone?: 'info' | 'warn' | 'danger' | 'success'; title?: string; children?: ReactNode; icon?: string }) {
  const ic = icon ?? (tone === 'danger' || tone === 'warn' ? 'warn' : tone === 'success' ? 'check' : 'info');
  return (
    <div className={`banner banner--${tone}`} role={tone === 'danger' ? 'alert' : 'status'}>
      <span className="banner__icon"><Icon name={ic} size={20} /></span>
      <div className="banner__body">
        {title && <span className="banner__title">{title}</span>}
        {children && <span className="small">{children}</span>}
      </div>
    </div>
  );
}
export function KV({ rows }: { rows: { k: ReactNode; v: ReactNode; total?: boolean; key?: string }[] }) {
  return (
    <dl className="kv" style={{ margin: 0 }}>
      {rows.map((r, i) => (
        <div key={r.key ?? i} className={`kv__row${r.total ? ' kv__row--total' : ''}`}>
          <dt className="kv__k">{r.k}</dt>
          <dd className="kv__v" style={{ margin: 0 }}>{r.v}</dd>
        </div>
      ))}
    </dl>
  );
}
export function Section({ title, aside, children, id }: { title?: ReactNode; aside?: ReactNode; children: ReactNode; id?: string }) {
  const hid = useId();
  return (
    <section className="section" aria-labelledby={title ? hid : undefined} id={id}>
      {title && (
        <div className="section__head">
          <h2 id={hid}>{title}</h2>
          {aside}
        </div>
      )}
      {children}
    </section>
  );
}
export function MockPayNotice({ compact }: { compact?: boolean }) {
  if (compact) return <span className="mock-label"><Icon name="warn" size={14} />모의 결제 · 실제 청구 없음</span>;
  return (
    <Banner tone="warn" title="모의 결제입니다" icon="warn">
      실제 카드·계좌 결제나 환불이 일어나지 않는 연습용 화면이에요. 입력한 결제 정보도 없어요.
    </Banner>
  );
}
export function Stars({ value }: { value: number }) {
  const full = Math.round(value);
  return <span className="stars" role="img" aria-label={`별점 5점 만점에 ${value}점`}>{'★'.repeat(full)}{'☆'.repeat(Math.max(0, 5 - full))}</span>;
}

// ───────── 상태 화면 ─────────
export function Skeleton({ h = 72, n = 1 }: { h?: number; n?: number }) {
  return <>{Array.from({ length: n }, (_, i) => <div key={i} className="skeleton" style={{ height: h }} aria-hidden />)}</>;
}
export function LoadingBlock({ label = '불러오는 중이에요' }: { label?: string }) {
  return (
    <div className="stack" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">{label}</span>
      <Skeleton h={28} /><Skeleton h={96} n={3} />
    </div>
  );
}
export function EmptyState({ icon = 'list', title, children, action }: { icon?: string; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <Icon name={icon} size={40} />
      <p className="empty__title">{title}</p>
      {children && <p className="muted small">{children}</p>}
      {action}
    </div>
  );
}
export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const d = describeError(error);
  return (
    <div className="stack" role="alert">
      <Banner tone="danger" title={d.title}>{d.hint}</Banner>
      {onRetry && <Button variant="secondary" block onClick={onRetry}><Icon name="refresh" size={18} />다시 시도</Button>}
    </div>
  );
}
/** 조회 상태(로딩·실패·재시도)를 한곳에서 처리한다. 화면은 성공 데이터만 그린다. */
export function AsyncView<T>({ state, children, loading }: { state: AsyncState<T>; children: (data: T) => ReactNode; loading?: ReactNode }) {
  if (state.data !== undefined && !state.error) return <>{children(state.data)}</>;
  if (state.error) return <ErrorState error={state.error} onRetry={state.reload} />;
  return <>{loading ?? <LoadingBlock />}</>;
}

// ───────── 입력 ─────────
export function Field({ label, hint, error, children, id }: { label: string; hint?: string; error?: string | null; children: (p: { id: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }) => ReactNode; id?: string }) {
  const auto = useId();
  const fid = id ?? auto;
  const desc = [hint && `${fid}-hint`, error && `${fid}-err`].filter(Boolean).join(' ') || undefined;
  return (
    <div className="field">
      <label className="field__label" htmlFor={fid}>{label}</label>
      {children({ id: fid, 'aria-describedby': desc, 'aria-invalid': error ? true : undefined })}
      {hint && <span className="field__hint" id={`${fid}-hint`}>{hint}</span>}
      {error && <span className="field__error" id={`${fid}-err`} role="alert">{error}</span>}
    </div>
  );
}

/** 비밀번호 입력 + 표시·숨기기 버튼. Field의 render prop(id·aria-*)을 그대로 받는다. */
export function PasswordInput(props: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const [shown, setShown] = useState(false);
  return (
    <div className="pw">
      <input {...props} type={shown ? 'text' : 'password'} className="input pw__input" autoCapitalize="none" autoCorrect="off" spellCheck={false} />
      <button type="button" className="pw__toggle" aria-label={shown ? '비밀번호 숨기기' : '비밀번호 표시'} aria-pressed={shown}
        aria-controls={props.id} onClick={() => setShown((v) => !v)}>
        <Icon name={shown ? 'eyeOff' : 'eye'} size={20} />
      </button>
    </div>
  );
}

// ───────── 대화상자 ─────────
export function Dialog({ title, onClose, children, actions }: { title: string; onClose: () => void; children: ReactNode; actions: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const tid = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>('button, [href], input, textarea, select');
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current();
      if (e.key === 'Tab' && ref.current) {
        const f = Array.from(ref.current.querySelectorAll<HTMLElement>('button:not(:disabled), [href], input, textarea, select'));
        if (!f.length) return;
        const a = f[0], z = f[f.length - 1];
        if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); }
        else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); prev?.focus(); };
  }, []);
  return (
    <div className="dialog-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby={tid} ref={ref}>
        <h2 id={tid}>{title}</h2>
        <div className="stack">{children}</div>
        <div className="stack--sm stack">{actions}</div>
      </div>
    </div>
  );
}

// ───────── 온김에 공동 예약이란? ─────────
export function GuideCard() {
  return (
    <section className="guide" aria-labelledby="guide-t">
      <h2 className="guide__title" id="guide-t" style={{ fontSize: 'var(--fs-md)' }}><Icon name="users" size={22} />온김에 공동 예약이란?</h2>
      <p className="guide__body small">같은 업체를 같은 날 가까운 이웃과 함께 예약하면, 업체의 출장비를 확정된 세대 수만큼 나눠 내요.</p>
      <ol className="guide__steps">
        <li className="guide__step"><b>1</b><span>참여할 수 있는 공동 날짜를 골라 요청해요</span></li>
        <li className="guide__step"><b>2</b><span>업체가 승인하면 예약금을 내고 예약을 확정해요</span></li>
        <li className="guide__step"><b>3</b><span>마감 뒤 확정 세대 수로 나눈 출장비를 정산해요</span></li>
      </ol>
    </section>
  );
}
