import { useEffect, useId, useRef, useState } from 'react';
import { Icon } from './Icon';

/**
 * 정렬 드롭다운. 작은 버튼(흰 바탕·연회색 테두리, 선택된 기준 + 아래 화살표) → 버튼 아래 메뉴(선택 항목은 블루 + 체크).
 * 고르면 바로 적용하고 닫는다. 키보드: 버튼에서 Enter·Space·↓로 열기, 메뉴에서 ↑·↓·Home·End 이동, Enter·Space 선택, Escape·Tab 닫기.
 * 닫으면 버튼으로 포커스를 돌려준다. 메뉴 바깥을 누르면 닫는다. 오른쪽 정렬이라 좁은 화면에서도 가로로 넘치지 않는다.
 */
export function SortMenu<T extends string>({ label, value, options, onChange }: {
  /** 접근성 이름(예: ‘정렬’) */ label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const current = options.find((o) => o.value === value) ?? options[0];
  const items = () => [...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? [])];
  const close = (focusBtn = true) => { setOpen(false); if (focusBtn) btnRef.current?.focus(); };
  const pick = (v: T) => { close(); if (v !== value) onChange(v); };

  useEffect(() => {
    if (!open) return;
    // 열리면 선택된 항목에 포커스
    const list = items();
    (list[options.findIndex((o) => o.value === value)] ?? list[0])?.focus();
    const onDown = (e: MouseEvent) => { if (!wrapRef.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const onMenuKey = (e: React.KeyboardEvent) => {
    const list = items();
    const i = list.indexOf(document.activeElement as HTMLElement);
    const go = (n: number) => { e.preventDefault(); list[(n + list.length) % list.length]?.focus(); };
    if (e.key === 'ArrowDown') go(i + 1);
    else if (e.key === 'ArrowUp') go(i - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(list.length - 1);
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'Tab') setOpen(false);
  };

  return (
    <div className="sort-menu" ref={wrapRef}>
      <button ref={btnRef} type="button" className="sort-menu__btn" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined}
        aria-label={`${label}: ${current.label}`}
        onClick={() => setOpen((o) => !o)} onKeyDown={(e) => { if (e.key === 'ArrowDown' && !open) { e.preventDefault(); setOpen(true); } }}>
        <span>{current.label}</span>
        <Icon name="down" size={14} />
      </button>
      {open && (
        <ul className="sort-menu__list" id={menuId} role="menu" aria-label={label} ref={menuRef} onKeyDown={onMenuKey}>
          {options.map((o) => {
            const on = o.value === value;
            return (
              <li key={o.value} role="none">
                <button type="button" role="menuitemradio" aria-checked={on} tabIndex={-1} className={`sort-menu__item${on ? ' sort-menu__item--on' : ''}`} onClick={() => pick(o.value)}>
                  <span>{o.label}</span>
                  <span className="sort-menu__check" aria-hidden>{on && <Icon name="check" size={16} />}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
