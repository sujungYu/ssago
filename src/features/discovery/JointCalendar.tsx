import { useRef, type KeyboardEvent } from 'react';
import { Icon } from '../../components/Icon';
import { addMonths, cmpYm, dayLabel, monthWeeks, type YearMonth } from '../../domain/jointCalendar';
import type { IsoDate } from '../../domain/types';

const WEEK = ['일', '월', '화', '수', '목', '금', '토'];

/**
 * 공동 예약 일정 월 캘린더(외부 라이브러리 없음). 신청 가능한 공동 예약이 있는 날짜만 누를 수 있다.
 * 머리: 왼쪽 ‘2026년 10월’ + 아래 안내, 오른쪽 이전·다음 달 버튼. 날짜 칸은 같은 크기(누르는 영역 44px 이상)이고 숫자는 원 가운데:
 * 선택 = 블루 원·흰 숫자, 신청 가능 = 연한 블루 원·블루 숫자, 불가 = 옅은 회색 숫자(누를 수 없음), 오늘 = 얇은 원 테두리 + 작은 ‘오늘’.
 * 오늘이 신청 가능·선택이어도 원 채움(상태)과 바깥 테두리(오늘)가 겹치지 않게 함께 보인다. 상태는 각 날짜의 접근성 이름으로도 전달한다(범례 없음).
 * 키보드: Tab으로 들어와 방향키(←→ 하루, ↑↓ 한 주)·Home·End로 신청 가능한 날짜 사이를 이동하고 Enter·Space로 고른다.
 */
export function JointCalendar({ month, range, counts, today, selected, onMonth, onSelect }: {
  month: YearMonth; range: { min: YearMonth; max: YearMonth }; counts: Map<IsoDate, number>; today: IsoDate; selected: IsoDate | null;
  onMonth: (m: YearMonth) => void; onSelect: (d: IsoDate) => void;
}) {
  const gridRef = useRef<HTMLTableElement>(null);
  const weeks = monthWeeks(month);
  const days = weeks.flat().filter((d): d is IsoDate => d !== null);
  const enabled = days.filter((d) => (counts.get(d) ?? 0) > 0 && d >= today);
  const canPrev = cmpYm(month, range.min) > 0;
  const canNext = cmpYm(month, range.max) < 0;
  // 한 번에 하나의 날짜만 Tab 순서에 둔다(선택한 날짜 → 없으면 첫 신청 가능 날짜)
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
          <p className="jcal__hint">신청 가능한 날짜를 선택해 주세요.</p>
        </div>
        <div className="jcal__nav">
          <button type="button" className="jcal__navbtn" aria-label="이전 달" disabled={!canPrev} onClick={() => onMonth(addMonths(month, -1))}><Icon name="back" size={18} /></button>
          <button type="button" className="jcal__navbtn jcal__next" aria-label="다음 달" disabled={!canNext} onClick={() => onMonth(addMonths(month, 1))}><Icon name="back" size={18} /></button>
        </div>
      </div>
      <table className="jcal__grid" ref={gridRef} aria-label={`${month.year}년 ${month.month}월 공동 예약 일정`}>
        <thead><tr>{WEEK.map((w) => <th key={w} scope="col" abbr={`${w}요일`}>{w}</th>)}</tr></thead>
        <tbody>
          {weeks.map((wk, wi) => (
            <tr key={wi}>
              {wk.map((d, di) => {
                if (!d) return <td key={di} />;
                const count = d >= today ? counts.get(d) ?? 0 : 0;
                const on = selected === d;
                const isToday = d === today;
                const cls = ['jcal__day', count > 0 && 'jcal__day--open', on && 'jcal__day--on', isToday && 'jcal__day--today'].filter(Boolean).join(' ');
                return (
                  <td key={di}>
                    <button type="button" className={cls} data-day={d} disabled={count === 0} aria-pressed={count > 0 ? on : undefined}
                      aria-label={dayLabel(d, today, count, on)} tabIndex={d === tabStop ? 0 : -1}
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
    </div>
  );
}
