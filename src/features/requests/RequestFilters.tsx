import { useState } from 'react';
import { CapsuleButton, OptionPicker, PeriodPicker } from '../../components/filters';
import {
  PERIOD_OPTIONS, STATUS_GROUP_OPTIONS, periodButtonLabel, statusSummary, type RequestFilter,
} from '../../domain/requestFilter';

type Open = { kind: 'status' | 'period'; anchor: HTMLElement } | null;
const ENDED_HINT = '업체 거절·철회·승인 만료·다른 업체 예약으로 종료';

/**
 * 내 요청 필터 막대: [요청 상태 ▾] [접수일 ▾]  요청 묶음 N건. 초기화 버튼은 두지 않는다(각 필터의 ‘전체’로 그 조건만 해제).
 * 공통 필터 UI(src/components/filters.tsx)를 쓰고, 규칙·상태 매핑은 src/domain/requestFilter.ts.
 */
export function RequestFilterBar({ filter, onApply, count }: { filter: RequestFilter; onApply: (f: RequestFilter) => void; count?: number }) {
  const [open, setOpen] = useState<Open>(null);
  const done = (f: RequestFilter) => { setOpen(null); onApply(f); };
  return (
    <div className="filter-bar">
      <div className="filter-bar__buttons" role="group" aria-label="요청 필터">
        <CapsuleButton label="요청 상태" defaultValue="전체" value={statusSummary(filter)} onClick={(el) => setOpen({ kind: 'status', anchor: el })} />
        <CapsuleButton label="접수일" defaultValue="전체 기간" value={periodButtonLabel(filter)} onClick={(el) => setOpen({ kind: 'period', anchor: el })} />
      </div>
      <p className="filter-bar__count small" aria-live="polite">{count === undefined ? ' ' : <>요청 묶음 <b>{count}</b>건</>}</p>
      {open?.kind === 'status' && (
        <OptionPicker title="요청 상태" name="status-group" anchor={open.anchor} onClose={() => setOpen(null)}
          options={STATUS_GROUP_OPTIONS.map((o) => (o.value === 'ended' ? { ...o, hint: ENDED_HINT } : o))}
          value={filter.status} onApply={(status) => done({ ...filter, status })} />
      )}
      {open?.kind === 'period' && (
        <PeriodPicker title="접수일" name="period" anchor={open.anchor} onClose={() => setOpen(null)} options={PERIOD_OPTIONS}
          note={<p className="small muted">수리를 요청한 날(요청 접수일) 기준이에요. 방문일이 아니에요. 한국 시간 기준이며 시작일과 종료일을 모두 포함해요.</p>}
          value={filter} onApply={(v) => done(v.period === 'custom' ? { status: filter.status, ...v } : { status: filter.status, period: v.period })} />
      )}
    </div>
  );
}
