import { useRef, type KeyboardEvent } from 'react';
import { Icon } from '../../components/Icon';
import { addMonths, cmpYm, dayLabel, monthWeeks, type YearMonth } from '../../domain/jointCalendar';
import type { DayKind } from '../../domain/visitDays';
import type { IsoDate } from '../../domain/types';

const WEEK = ['일', '월', '화', '수', '목', '금', '토'];

/**
 * 방문 날짜 선택 월 캘린더(외부 라이브러리 없음). 공동 예약 참여 가능·새 요청 가능 날짜만 누를 수 있다(유형 판단은 domain/visitDays.ts).
 * 머리: 왼쪽 ‘2026년 10월’ + 아래 안내, 오른쪽 이전·다음 달 버튼. 날짜 칸은 같은 크기(누르는 영역 44px 이상)이고 숫자는 원 가운데:
 * 선택 = 진한 블루 원·흰 숫자(유형과 관계없이), 공동 예약 = 연한 블루 원·블루 숫자, 새 요청 = 연한 회색 원·진한 숫자,
 * 요청 불가 = 옅은 회색 숫자(누를 수 없음), 오늘 = 얇은 원 테두리 + 작은 ‘오늘’.
 * 오늘이 가능·선택이어도 원 채움(상태)과 바깥 테두리(오늘)가 겹치지 않게 함께 보인다. 아래 범례 + 각 날짜의 접근성 이름으로 유형을 전달한다.
 * 키보드: Tab으로 들어와 방향키(←→ 하루, ↑↓ 한 주)·Home·End로 고를 수 있는 날짜 사이를 이동하고 Enter·Space로 고른다.
 */
export function JointCalendar({ month, range, kindOf, jointCount, today, selected, onMonth, onSelect }: {
  month: YearMonth; range: { min: YearMonth; max: YearMonth }; kindOf: (d: IsoDate) => DayKind; jointCount: (d: IsoDate) => number;
  today: IsoDate; selected: IsoDate | null; onMonth: (m: YearMonth) => void; onSelect: (d: IsoDate) => void;
}) {
  const gridRef = useRef<HTMLTableElement>(null);
  const weeks = monthWeeks(month);
  const days = weeks.flat().filter((d): d is IsoDate => d !== null);
  const kindAt = (d: IsoDate): DayKind => (d >= today ? kindOf(d) : 'none');
  const enabled = days.filter((d) => kindAt(d) !== 'none');
  const canPrev = cmpYm(month, range.min) > 0;
  const canNext = cmpYm(month, range.max) < 0;
  // 한 번에 하나의 날짜만 Tab 순서에 둔다(선택한 날짜 → 없으면 첫 선택 가능 날짜)
  const tabStop = selected && enabled.includes(selected) ? selected : enabled[0];

  const focusDay = (d: IsoDate) => gridRef.current?.querySelector<HTMLButtonElement>(`button[data-day="${d}"]`)?.focus();
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, d: IsoDate) => {
    const i = days.indexOf(d);
    const step: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    let next: IsoDate | undefined;
    if (e.key === 'Home') next = enabled[0];
    else if (e.key === 'End') next = enabled[enabled.length - 1];
    else if (step[e.key]) {
      const s = step[e.key];
      const ahead = s > 0 ? enabled.filter((x) => x > d) : enabled.filter((x) => x < d).reverse();
      // 한 주 이동은 같은 요일의 신청 가능 날짜를 먼저 찾고, 없으면 그 방향의 가장 가까운 날짜로 간다
      next = Math.abs(s) === 7 ? ahead.find((x) => (days.indexOf(x) - i) % 7 === 0) ?? ahead[0] : ahead[0];
    } else return;
    e.preventDefault();
    if (next) focusDay(next);
  };

  return (
    <div className="jcal">
      <div className="jcal__head">
        <div className="jcal__heading">
          <h3 className="jcal__title" aria-live="polite">{month.year}년 {month.month}월</h3>
          <p className="jcal__hint">공동 예약에 참여하거나 새 날짜로 요청할 수 있어요.</p>
        </div>
        <div className="jcal__nav">
          <button type="button" className="jcal__navbtn" aria-label="이전 달" disabled={!canPrev} onClick={() => onMonth(addMonths(month, -1))}><Icon name="back" size={18} /></button>
          <button type="button" className="jcal__navbtn jcal__next" aria-label="다음 달" disabled={!canNext} onClick={() => onMonth(addMonths(month, 1))}><Icon name="back" size={18} /></button>
        </div>
      </div>
      <table className="jcal__grid" ref={gridRef} aria-label={`${month.year}년 ${month.month}월 방문 날짜`}>
        <thead><tr>{WEEK.map((w) => <th key={w} scope="col" abbr={`${w}요일`}>{w}</th>)}</tr></thead>
        <tbody>
          {weeks.map((wk, wi) => (
            <tr key={wi}>
              {wk.map((d, di) => {
                if (!d) return <td key={di} />;
                const kind = kindAt(d);
                const open = kind !== 'none';
                const on = selected === d && open;
                const isToday = d === today;
                const cls = ['jcal__day', kind === 'joint' && 'jcal__day--open', kind === 'new' && 'jcal__day--new', on && 'jcal__day--on', isToday && 'jcal__day--today'].filter(Boolean).join(' ');
                return (
                  <td key={di}>
                    <button type="button" className={cls} data-day={d} disabled={!open} aria-pressed={open ? on : undefined}
                      aria-label={dayLabel(d, today, kind, kind === 'joint' ? jointCount(d) : 0, on)} tabIndex={d === tabStop ? 0 : -1}
                      onClick={() => onSelect(d)} onKeyDown={(e) => onKey(e, d)}>
                      <span className="jcal__num" aria-hidden>{Number(d.slice(8))}</span>
                      <span className="jcal__mark" aria-hidden>{isToday ? '오늘' : null}</span>
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {/* 범례: 색 표시와 같은 원(선택·요청 불가는 숫자 상태로 구분). 각 날짜의 접근성 이름에도 유형이 들어 있어 화면 낭독에서는 숨긴다 */}
      <ul className="jcal__legend" aria-hidden>
        <li><span className="jcal__swatch jcal__swatch--joint" />공동 예약</li>
        <li><span className="jcal__swatch jcal__swatch--new" />새 요청 가능</li>
      </ul>
    </div>
  );
}
