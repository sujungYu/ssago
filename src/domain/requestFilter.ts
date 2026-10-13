/**
 * 내 예약 > 보낸 요청 목록 필터(조회 조건). 화면과 분리된 순수 함수.
 * - 날짜 기준은 ‘요청 접수일’(RepairRequest.createdAt)의 Asia/Seoul 날짜. 방문 예정일이 아니다.
 * - 기간은 시작일·종료일 모두 포함. ‘최근 N일’은 오늘을 포함한 N개의 날짜.
 * - 상태는 사용자용 상태 그룹 단일 선택(‘종료’는 예약으로 이어지지 않고 끝난 업무 상태를 묶음). 날짜와는 AND. 'all' = 전체.
 * - 보낸 요청 탭에는 예약으로 이어진 요청 묶음이 없으므로(src/domain/reservationTabs.ts) ‘예약 완료’ 선택지는 두지 않는다.
 * 필터는 조회 조건만 바꾸며 요청 데이터·상태를 바꾸지 않는다.
 */
import { seoulYmd } from './time';
import type { IsoDate, IsoDateTime, RepairRequest, RequestStatus } from './types';

// ───────── 화면 필터 값(URL에 저장하는 값) ─────────
export type PeriodPreset = 'all' | '7d' | '30d' | '90d' | 'custom';

/** 사용자용 상태 그룹(필터 전용). 업무 상태(RequestStatus)를 바꾸지 않고 조회 조건으로만 묶는다. */
export type StatusGroup = 'all' | 'payment_pending' | 'needs_info' | 'reviewing' | 'ended';

export interface RequestFilter {
  period: PeriodPreset;
  /** period='custom'일 때만 사용. YYYY-MM-DD(한국 날짜) */
  from?: IsoDate;
  to?: IsoDate;
  /** 단일 선택. 'all' = 전체 */
  status: StatusGroup;
}

export const DEFAULT_REQUEST_FILTER: RequestFilter = { period: 'all', status: 'all' };

export const PERIOD_OPTIONS: { value: PeriodPreset; label: string }[] = [
  { value: 'all', label: '전체 기간' },
  { value: '7d', label: '최근 7일' },
  { value: '30d', label: '최근 30일' },
  { value: '90d', label: '최근 90일' },
  { value: 'custom', label: '직접 선택' },
];

const PRESET_DAYS: Partial<Record<PeriodPreset, number>> = { '7d': 7, '30d': 30, '90d': 90 };

/**
 * 상태 그룹 → 업무 상태 매핑. 예약 전 요청 상태 7개가 ‘전체’를 뺀 4개 그룹에 빠짐없이 한 번씩 들어간다.
 * booked(예약금 결제 성공)는 보낸 요청에 나오지 않아 어느 그룹에도 넣지 않는다.
 * - 결제 대기: approved_pending_payment. ‘승인 완료’만 따로 있는 상태는 없다(업체 승인 = 결제 대기 진입, 승인 조건 재확인
 *   recheck도 이 상태의 표시값). 그래서 결제 전 승인 상태를 하나로 묶는다.
 * - 종료: 업체 거절·철회·승인 만료·다른 업체 예약으로 종료. 카드에는 구체 상태를 그대로 보여준다.
 */
export const STATUS_GROUP_STATUSES: Record<Exclude<StatusGroup, 'all'>, RequestStatus[]> = {
  payment_pending: ['approved_pending_payment'],
  needs_info: ['needs_info'],
  reviewing: ['reviewing'],
  ended: ['rejected', 'withdrawn', 'approval_expired', 'closed_other_booking'],
};

export const STATUS_GROUP_OPTIONS: { value: StatusGroup; label: string }[] = [
  { value: 'all', label: '전체' },
  { value: 'payment_pending', label: '예약금 결제 대기' },
  { value: 'needs_info', label: '추가 정보 필요' },
  { value: 'reviewing', label: '업체 검토 중' },
  { value: 'ended', label: '종료' },
];
const isStatusGroup = (s: string | null): s is StatusGroup => STATUS_GROUP_OPTIONS.some((o) => o.value === s);

// ───────── 날짜 ─────────
const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** 실제로 존재하는 날짜(YYYY-MM-DD)인지 */
export function isValidYmd(s: string | null | undefined): s is IsoDate {
  if (!s || !YMD.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** YYYY-MM-DD에 일수를 더한다(달력 계산, 시간대 영향 없음) */
export function addDaysYmd(ymd: IsoDate, days: number): IsoDate {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 2026-10-08 → 2026.10.08 */
export function formatYmdDots(ymd: IsoDate): string {
  return ymd.replaceAll('-', '.');
}

/** 직접 선택 기간의 입력 오류. 없으면 null */
export function customRangeError(from?: string, to?: string): { from?: string; to?: string } | null {
  const e: { from?: string; to?: string } = {};
  if (!from) e.from = '시작일을 입력해 주세요.';
  else if (!isValidYmd(from)) e.from = '올바른 날짜를 입력해 주세요.';
  if (!to) e.to = '종료일을 입력해 주세요.';
  else if (!isValidYmd(to)) e.to = '올바른 날짜를 입력해 주세요.';
  if (!e.from && !e.to && from! > to!) e.to = '종료일은 시작일과 같거나 늦어야 해요.';
  return e.from || e.to ? e : null;
}

// ───────── 조회 조건(서버로 넘길 수 있는 형태) ─────────
/** 저장소에 넘기는 조회 조건. 날짜는 한국 날짜 기준 포함 범위. */
export interface RequestListQuery {
  createdFrom?: IsoDate;
  createdTo?: IsoDate;
  /** 비어 있거나 없으면 전체 상태 */
  statuses?: RequestStatus[];
}

/** 화면 필터 → 조회 조건. 오늘은 목업 시계(now)의 한국 날짜. */
export function toListQuery(f: RequestFilter, nowIso: IsoDateTime): RequestListQuery {
  const q: RequestListQuery = {};
  const days = PRESET_DAYS[f.period];
  if (days) {
    const today = seoulYmd(nowIso);
    q.createdFrom = addDaysYmd(today, -(days - 1));
    q.createdTo = today;
  } else if (f.period === 'custom' && f.from && f.to) {
    q.createdFrom = f.from;
    q.createdTo = f.to;
  }
  if (f.status !== 'all') q.statuses = [...STATUS_GROUP_STATUSES[f.status]];
  return q;
}

type Filterable = { request: Pick<RepairRequest, 'status' | 'createdAt'> };

export function matchesQuery(item: Filterable, q: RequestListQuery): boolean {
  const day = seoulYmd(item.request.createdAt);
  if (q.createdFrom && day < q.createdFrom) return false;
  if (q.createdTo && day > q.createdTo) return false;
  if (q.statuses?.length && !q.statuses.includes(item.request.status)) return false;
  return true;
}

/** 묶음의 대표 접수 시각: 표시되는 요청 중 가장 최근 접수 */
export const latestCreatedAt = (items: Filterable[]): IsoDateTime =>
  items.map((i) => i.request.createdAt).sort().at(-1) ?? '';

/**
 * 비교 요청 묶음 필터. 조건에 맞는 업체별 요청이 하나라도 있는 묶음만 남기고,
 * 묶음 안에는 맞는 요청만 둔다(원본은 바꾸지 않는다). 숨긴 요청 수는 hiddenItemCount로 남겨
 * 비교·다른 요청 확인에서 삭제된 것처럼 보이지 않게 한다. 정렬: 요청 접수일 최신순.
 */
export function filterRequestBundles<I extends Filterable, B extends { items: I[] }>(bundles: B[], q: RequestListQuery): (B & { hiddenItemCount: number })[] {
  return bundles
    .map((b) => {
      const items = b.items.filter((i) => matchesQuery(i, q));
      return { ...b, items, hiddenItemCount: b.items.length - items.length };
    })
    .filter((b) => b.items.length > 0)
    .sort((a, b) => latestCreatedAt(b.items).localeCompare(latestCreatedAt(a.items)));
}

// ───────── 요약 표현 ─────────
export function periodSummary(f: RequestFilter): string {
  if (f.period === 'custom' && f.from && f.to) return `${formatYmdDots(f.from)} ~ ${formatYmdDots(f.to)}`;
  return PERIOD_OPTIONS.find((o) => o.value === f.period)?.label ?? '전체 기간';
}

/** 필터 버튼 표시: 기본값이면 null(버튼은 ‘요청 상태’·‘접수일’), 적용되면 선택값 */
export function statusSummary(f: RequestFilter): string | null {
  return f.status === 'all' ? null : STATUS_GROUP_OPTIONS.find((o) => o.value === f.status)!.label;
}
export function periodButtonLabel(f: RequestFilter): string | null {
  return f.period === 'all' ? null : periodSummary(f);
}

export function isDefaultFilter(f: RequestFilter): boolean {
  return f.period === 'all' && f.status === 'all';
}

// ───────── URL 쿼리 ─────────
/** URL 쿼리에는 날짜·상태만 넣는다. 고객 정보는 넣지 않는다. */
export const FILTER_PARAM_KEYS = ['period', 'from', 'to', 'status'] as const;

/** 유효하지 않은 값은 기본값으로 처리한다. */
export function parseRequestFilter(p: URLSearchParams): RequestFilter {
  const raw = p.get('period');
  let period: PeriodPreset = PERIOD_OPTIONS.some((o) => o.value === raw) ? (raw as PeriodPreset) : 'all';
  let from: IsoDate | undefined;
  let to: IsoDate | undefined;
  if (period === 'custom') {
    const f = p.get('from'), t = p.get('to');
    if (customRangeError(f ?? undefined, t ?? undefined)) period = 'all';
    else { from = f!; to = t!; }
  }
  const rawStatus = p.get('status');
  const status: StatusGroup = isStatusGroup(rawStatus) ? rawStatus : 'all'; // 이전 형식(쉼표 목록)·없앤 ‘예약 완료’(booked)·알 수 없는 값은 전체
  return period === 'custom' ? { period, from, to, status } : { period, status };
}

/** 필터 → 쿼리. 다른(필터와 무관한) 쿼리 값은 유지한다. 기본값은 쿼리에서 뺀다. */
export function writeRequestFilter(base: URLSearchParams, f: RequestFilter): URLSearchParams {
  const p = new URLSearchParams(base);
  for (const k of FILTER_PARAM_KEYS) p.delete(k);
  if (f.period !== 'all') p.set('period', f.period);
  if (f.period === 'custom' && f.from && f.to) { p.set('from', f.from); p.set('to', f.to); }
  if (f.status !== 'all') p.set('status', f.status);
  return p;
}

export function hasFilterParams(p: URLSearchParams): boolean {
  return FILTER_PARAM_KEYS.some((k) => p.has(k));
}
