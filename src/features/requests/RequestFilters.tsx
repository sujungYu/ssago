import { COMPARE_REQUESTS_ENABLED } from '../../domain/demoScope';
import { useState } from 'react';
import { CapsuleButton, OptionPicker, PeriodPicker, ToggleCapsule } from '../../components/filters';
import {
  PERIOD_OPTIONS, STATUS_GROUP_OPTIONS, periodButtonLabel, statusSummary, type RequestFilter,
} from '../../domain/requestFilter';

type Open = { kind: 'status' | 'period'; anchor: HTMLElement } | null;

/**
 * 보낸 요청 필터 막대: [요청 상태 ▾] [요청일 ▾] [확인 필요]  보낸 요청 N건. ‘확인 필요’는 확정된 예약 탭과 같은 토글. 초기화 버튼은 두지 않는다(각 필터의 ‘전체’로 그 조건만 해제).
 * 공통 필터 UI(src/components/filters.tsx)를 쓰고, 규칙·상태 매핑은 src/domain/requestFilter.ts.
 */
export function RequestFilterBar({ filter, onApply, count }: { filter: RequestFilter; onApply: (f: RequestFilter) => void; count?: number }) {
  const [open, setOpen] = useState<Open>(null);
  const done = (f: RequestFilter) => { setOpen(null); onApply(f); };
  return (
    <div className="filter-bar">
      <div className="filter-bar__buttons" role="group" aria-label="보낸 요청 필터">
        <CapsuleButton label="요청 상태" defaultValue="전체" value={statusSummary(filter)} onClick={(el) => setOpen({ kind: 'status', anchor: el })} />
        <CapsuleButton label="요청일" defaultValue="전체 기간" value={periodButtonLabel(filter)} onClick={(el) => setOpen({ kind: 'period', anchor: el })} />
        <ToggleCapsule label="확인 필요" pressed={!!filter.actionOnly} onToggle={() => onApply({ ...filter, actionOnly: !filter.actionOnly })} />
      </div>
      <p className="filter-bar__count small" aria-live="polite">{count === undefined ? ' ' : <>{COMPARE_REQUESTS_ENABLED ? '요청 묶음' : '보낸 요청'} <b>{count}</b>건</>}</p>
      {open?.kind === 'status' && (
        <OptionPicker title="요청 상태" name="status-group" anchor={open.anchor} onClose={() => setOpen(null)}
          options={STATUS_GROUP_OPTIONS.map((o) => (o.value === 'reviewing' ? { ...o, hint: '추가 정보 요청 포함' } : o.value === 'payment_pending' ? { ...o, hint: '바뀐 조건 확인 포함' } : o))}
          value={filter.status} onApply={(status) => done({ ...filter, status })} />
      )}
      {open?.kind === 'period' && (
        <PeriodPicker title="요청일" name="period" anchor={open.anchor} onClose={() => setOpen(null)} options={PERIOD_OPTIONS}
          note={<p className="small muted">수리를 요청한 날(요청일) 기준이에요. 방문일이 아니에요. 한국 시간 기준이며 시작일과 종료일을 모두 포함해요.</p>}
          value={filter} onApply={(v) => done(v.period === 'custom' ? { status: filter.status, actionOnly: filter.actionOnly, ...v } : { status: filter.status, actionOnly: filter.actionOnly, period: v.period })} />
      )}
    </div>
  );
}
