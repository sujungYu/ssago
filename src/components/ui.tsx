import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Link, type LinkProps } from 'react-router-dom';
import { describeError } from '../domain/errors';
import type { Tone } from '../domain/rules';
import { Icon } from './Icon';
import { CoopVisitIllustration } from './brand/CoopVisitIllustration';
import type { AsyncState } from '../app/hooks';

// ───────── 버튼 ─────────
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-solid' | 'default';
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
/**
 * 상세 상단 공통 행동 카드(spec 5.17): 회색 테두리 카드 + 연한 블루 머리(정보 아이콘 · ‘확인이 필요해요’) + 구체 제목 + 흰 본문 + 하단 버튼.
 * 표시만 공통이고 입력·처리 로직은 상황별 컴포넌트가 가진다. head로 기다리는 상태 등 머리 문구를 바꿀 수 있다.
 */
export function ActionCard({ id, title, head = '확인이 필요해요', children, actions, className }: {
  id: string; title: ReactNode; head?: string; children?: ReactNode; actions?: ReactNode; className?: string;
}) {
  return (
    <section className={`act-card${className ? ` ${className}` : ''}`} id={id} tabIndex={-1} aria-labelledby={`${id}-title`}>
      <p className="act-card__head"><Icon name="info" size={16} />{head}</p>
      <div className="act-card__body stack--sm stack">
        <h2 id={`${id}-title`} className="act-card__title">{title}</h2>
        {children}
      </div>
      {actions && <div className="act-card__actions">{actions}</div>}
    </section>
  );
}

/**
 * 펼치기(spec 5.19): 기본 닫힘, 제목 오른쪽 화살표, 버튼에 aria-expanded·aria-controls, 내용은 제목과 연결된 영역.
 * 열림 상태는 컴포넌트 상태라 데이터가 다시 조회돼도 사용자가 열어둔 영역이 닫히지 않는다. 여러 개를 동시에 열 수 있다.
 */
export function Fold({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`fold${open ? ' fold--open' : ''}`} data-fold={id}>
      <h3 className="fold__head">
        <button type="button" className="fold__btn" id={`${id}-btn`} aria-expanded={open} aria-controls={`${id}-panel`} onClick={() => setOpen((o) => !o)}>
          <span>{title}</span><Icon name="chevron" size={16} />
        </button>
      </h3>
      <div className="fold__panel" id={`${id}-panel`} role="region" aria-labelledby={`${id}-btn`} hidden={!open}>{children}</div>
    </div>
  );
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
export function Section({ title, aside, children, id, headClassName }: { title?: ReactNode; aside?: ReactNode; children: ReactNode; id?: string; /** 제목 영역 배치 변형(예: section__head--hint) */ headClassName?: string }) {
  const hid = useId();
  return (
    <section className="section" aria-labelledby={title ? hid : undefined} id={id}>
      {title && (
        <div className={`section__head${headClassName ? ` ${headClassName}` : ''}`}>
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
/** liveError=false: 오류 문구를 즉시 낭독하지 않는다(폼이 제출 실패를 한 번만 알리고, 포커스가 옮겨지면 연결된 오류가 읽힌다) */
export function Field({ label, hint, error, children, id, liveError = true }: { label: string; hint?: string; error?: string | null; children: (p: { id: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }) => ReactNode; id?: string; liveError?: boolean }) {
  const auto = useId();
  const fid = id ?? auto;
  const desc = [hint && `${fid}-hint`, error && `${fid}-err`].filter(Boolean).join(' ') || undefined;
  return (
    <div className="field">
      <label className="field__label" htmlFor={fid}>{label}</label>
      {children({ id: fid, 'aria-describedby': desc, 'aria-invalid': error ? true : undefined })}
      {hint && <span className="field__hint" id={`${fid}-hint`}>{hint}</span>}
      {error && <span className="field__error" id={`${fid}-err`} role={liveError ? 'alert' : undefined}>{error}</span>}
    </div>
  );
}

/** 비밀번호 입력 + 표시·숨기기 버튼. Field의 render prop(id·aria-*)을 그대로 받는다. */
// ───────── 대화상자 ─────────
/**
 * 확인 대화상자. 좁은 화면에서는 하단 시트, 넓은 화면에서는 가운데 대화상자. closeLabel을 주면 제목 옆에 닫기 버튼을 둔다.
 * 열리면 내부로 포커스를 옮기고 Tab을 안에 가두며 Escape로 닫는다. 열린 동안 배경 스크롤을 잠그고,
 * 닫으면 연 버튼으로 포커스를 돌려준다(스크롤 위치는 그대로). 본문만 내부 스크롤되어 하단 버튼이 내용을 가리지 않는다.
 * anchor를 주면 768px 이상에서는 그 버튼 아래에 팝오버로 띄운다(배경 어둡게 하지 않음, 바깥을 누르면 닫힘).
 */
/**
 * variant='confirm': 짧은 확인 대화상자. 모바일·데스크톱 모두 화면 가운데(좌우 여백), 최대 너비 420px, 안쪽 여백 24px, 하단 두 버튼을 같은 너비로 나란히.
 * 처음 포커스는 actions의 첫 버튼(보조·안전한 선택을 왼쪽 첫 번째에 둔다), 닫으면 연 버튼으로 돌아간다.
 */
export function Dialog({ title, onClose, children, actions, closeLabel, anchor, variant }: { title: string; onClose: () => void; children?: ReactNode; actions: ReactNode; closeLabel?: string; anchor?: HTMLElement | null; variant?: 'confirm' }) {
  const ref = useRef<HTMLDivElement>(null);
  const tid = useId();
  const bid = useId();
  const hasBody = children !== undefined && children !== null && children !== false;
  // 팝오버 위치(데스크톱 + anchor일 때만). 열릴 때 한 번 계산한다(열린 동안 배경 스크롤은 잠김).
  const [pop] = useState<{ top: number; left: number } | null>(() => {
    if (!anchor || typeof window === 'undefined' || !window.matchMedia?.('(min-width: 768px)').matches) return null;
    const r = anchor.getBoundingClientRect();
    const width = Math.min(380, window.innerWidth - 32);
    return { top: r.bottom + 8, left: Math.max(16, Math.min(r.left, window.innerWidth - width - 16)) };
  });
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const scrollY = window.scrollY;
    const html = document.documentElement;
    const prevOverflow = html.style.overflow;
    // 배경 스크롤 잠금(스크롤 위치는 유지됨). 스크롤바가 사라져도 레이아웃이 밀리지 않도록 base.css에서 html에 scrollbar-gutter: stable을 둔다.
    // 데스크톱 팝오버도 잠근다: 위치를 열 때 한 번 계산해 고정하므로, 배경이 스크롤되면 기준 버튼과 어긋난다.
    html.style.overflow = 'hidden';
    const first = ref.current?.querySelector<HTMLElement>('button, [href], input, textarea, select');
    first?.focus({ preventScroll: true });
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
    return () => {
      document.removeEventListener('keydown', onKey);
      html.style.overflow = prevOverflow;
      prev?.focus({ preventScroll: true });
      if (window.scrollY !== scrollY) window.scrollTo(0, scrollY);
    };
  }, []);
  return (
    <div className={`dialog-backdrop${pop ? ' dialog-backdrop--popover' : ''}${variant === 'confirm' ? ' dialog-backdrop--center' : ''}`} onMouseDown={(e) => {
      // 바깥을 눌러 닫을 때 브라우저 기본 동작(포커스를 body로 옮김)을 막아, 닫은 뒤 연 버튼으로 포커스가 돌아가게 한다.
      if (e.target === e.currentTarget) { e.preventDefault(); onClose(); }
    }}>
      <div className={`dialog${pop ? ' dialog--popover' : ''}${variant === 'confirm' ? ' dialog--confirm' : ''}`} role="dialog" aria-modal="true" aria-labelledby={tid} aria-describedby={hasBody ? bid : undefined} ref={ref}
        style={pop ? { top: pop.top, left: pop.left, maxHeight: `calc(100dvh - ${pop.top + 16}px)` } : undefined}>
        {closeLabel ? (
          <div className="dialog__head">
            <h2 id={tid}>{title}</h2>
            <button type="button" className="icon-btn" aria-label={closeLabel} onClick={onClose}><Icon name="close" /></button>
          </div>
        ) : <h2 id={tid}>{title}</h2>}
        {hasBody && <div className="stack dialog__body" id={bid}>{children}</div>}
        {actions && <div className={variant === 'confirm' ? 'dialog__actions dialog__actions--pair' : 'stack--sm stack dialog__actions'}>{actions}</div>}
      </div>
    </div>
  );
}

// ───────── 싸고 공동 예약이란? ─────────
/**
 * 업체 찾기 ‘어떤 생활 수리가 필요하세요?’ 제목 아래의 소개 문구 + 원형 정보 아이콘 버튼(접근성 이름 ‘공동 예약 이용 방법’).
 * 마지막 어절과 아이콘을 줄바꿈 없이 묶어 아이콘만 다음 줄로 떨어지지 않게 한다. 호버·키보드 포커스 시 같은 문구의 툴팁을 보여준다. 누르면 상세 안내(모바일 하단 시트, 데스크톱 모달)를 연다.
 * 자동으로 띄우거나 확인을 강제하지 않는다. 출장비만 마감 때 확정되며 수리비는 작업 완료 후 최종 정산된다.
 */
export function CoopGuideHint() {
  const [open, setOpen] = useState(false);
  const tipRef = useRef<HTMLSpanElement>(null);
  const [tipStart, setTipStart] = useState(false);
  // 툴팁이 화면 왼쪽 밖으로 나가면 아이콘 왼쪽 기준으로 펼친다
  const placeTip = (btn: HTMLElement) => setTipStart(btn.getBoundingClientRect().right - (tipRef.current?.offsetWidth ?? 0) < 8);
  return (
    <>
      <p className="coop-hint">
        이웃과 같은 업체·같은 날 예약하고 출장비를 나눠{' '}
        <span className="nowrap">
          내요.
          <button type="button" className={`info-btn${tipStart ? ' info-btn--tip-start' : ''}`} aria-label="공동 예약 이용 방법" aria-haspopup="dialog"
            onClick={() => setOpen(true)} onMouseEnter={(e) => placeTip(e.currentTarget)} onFocus={(e) => placeTip(e.currentTarget)}>
            <Icon name="info" size={20} />
            {/* 시각용 툴팁(이름은 aria-label로 이미 같은 문구라 중복해서 읽히지 않게 숨김) */}
            <span ref={tipRef} className="info-btn__tip" aria-hidden>공동 예약 이용 방법</span>
          </button>
        </span>
      </p>
      {open && (
        <Dialog title="싸고 공동 예약이란?" onClose={() => setOpen(false)} closeLabel="닫기"
          actions={<Button variant="primary" block onClick={() => setOpen(false)}>확인</Button>}>
          <CoopVisitIllustration className="guide__art" />
          <p>같은 업체를 같은 날 가까운 이웃과 함께 예약하면, 출장비를 마감 시 확정된 세대 수로 나눠 내요.</p>
          <ol className="guide-steps">
            <li><b aria-hidden>1</b><span>참여 가능한 공동 날짜를 선택해 수리를 요청해요.</span></li>
            <li><b aria-hidden>2</b><span>업체가 승인하면 조건을 확인하고 예약금을 결제해요.</span></li>
            <li><b aria-hidden>3</b><span>마감 시 세대별 출장비가 확정되고, 작업 완료 후 최종 정산해요.</span></li>
          </ol>
        </Dialog>
      )}
    </>
  );
}
