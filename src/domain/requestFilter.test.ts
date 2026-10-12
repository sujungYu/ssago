import { describe, expect, it } from 'vitest';
import {
  DEFAULT_REQUEST_FILTER, STATUS_FILTER_OPTIONS, addDaysYmd, customRangeError, filterRequestBundles, isDefaultFilter,
  parseRequestFilter, periodSummary, statusSummary, toListQuery, toggleStatus, writeRequestFilter, type RequestFilter,
} from './requestFilter';
import { REQUEST_STATUS } from './rules';
import type { RequestStatus } from './types';

const item = (id: string, status: RequestStatus, createdAt: string) => ({ id, request: { status, createdAt } });
const bundle = (id: string, ...items: ReturnType<typeof item>[]) => ({ bundleId: id, items });
const f = (p: Partial<RequestFilter>): RequestFilter => ({ ...DEFAULT_REQUEST_FILTER, ...p });
const qs = (s: string) => new URLSearchParams(s);

describe('요청 접수일 기간(한국 시간)', () => {
  it('전체 기간·전체 상태는 조건이 없다', () => {
    expect(toListQuery(DEFAULT_REQUEST_FILTER, '2026-10-13T10:00:00Z')).toEqual({});
  });
  it('최근 N일은 오늘을 포함한 N개 날짜', () => {
    expect(toListQuery(f({ period: '7d' }), '2026-10-13T10:00:00+09:00')).toEqual({ createdFrom: '2026-10-07', createdTo: '2026-10-13' });
    expect(toListQuery(f({ period: '30d' }), '2026-10-13T10:00:00+09:00').createdFrom).toBe('2026-09-14');
    expect(toListQuery(f({ period: '90d' }), '2026-10-13T10:00:00+09:00').createdFrom).toBe('2026-07-16');
  });
  it('오늘은 UTC가 아니라 한국 날짜로 정한다', () => {
    // UTC 10-13 15:00 = 한국 10-14 00:00
    expect(toListQuery(f({ period: '7d' }), '2026-10-13T14:59:59Z').createdTo).toBe('2026-10-13');
    expect(toListQuery(f({ period: '7d' }), '2026-10-13T15:00:00Z').createdTo).toBe('2026-10-14');
  });
  it('시작일·종료일 경계를 모두 포함하고, 접수 시각은 한국 날짜로 비교한다', () => {
    const bs = [bundle('b',
      item('before', 'reviewing', '2026-10-06T14:59:59Z'), // 한국 10-06 23:59:59
      item('startEdge', 'reviewing', '2026-10-06T15:00:00Z'), // 한국 10-07 00:00
      item('endEdge', 'reviewing', '2026-10-13T14:59:59Z'), // 한국 10-13 23:59:59
      item('after', 'reviewing', '2026-10-13T15:00:00Z'), // 한국 10-14 00:00
    )];
    const r = filterRequestBundles(bs, { createdFrom: '2026-10-07', createdTo: '2026-10-13' });
    expect(r[0].items.map((i) => i.id)).toEqual(['startEdge', 'endEdge']);
    expect(r[0].hiddenItemCount).toBe(2);
  });
  it('직접 선택: 시작일=종료일이면 그날 하루', () => {
    const q = toListQuery(f({ period: 'custom', from: '2026-10-12', to: '2026-10-12' }), '2026-10-13T00:00:00Z');
    expect(q).toEqual({ createdFrom: '2026-10-12', createdTo: '2026-10-12' });
  });
  it('달·윤년 경계 날짜 계산', () => {
    expect(addDaysYmd('2028-03-01', -1)).toBe('2028-02-29');
    expect(addDaysYmd('2026-01-01', -1)).toBe('2025-12-31');
  });
});

describe('직접 선택 입력 오류', () => {
  it('둘 다 입력해야 한다', () => {
    expect(customRangeError('', '')).toEqual({ from: '시작일을 입력해 주세요.', to: '종료일을 입력해 주세요.' });
  });
  it('시작일이 종료일보다 늦으면 오류', () => {
    expect(customRangeError('2026-10-10', '2026-10-09')?.to).toMatch(/같거나 늦어야/);
    expect(customRangeError('2026-10-10', '2026-10-10')).toBeNull();
  });
  it('존재하지 않는 날짜는 오류', () => {
    expect(customRangeError('2026-02-30', '2026-03-01')?.from).toBeTruthy();
  });
});

describe('상태 필터', () => {
  const bs = [
    bundle('b-sink', item('rq-3', 'approved_pending_payment', '2026-10-13T01:00:00Z'), item('rq-4', 'rejected', '2026-10-13T01:10:00Z')),
    bundle('b-booked', item('rq-k', 'booked', '2026-10-08T01:00:00Z')),
    bundle('b-old', item('rq-6', 'withdrawn', '2026-10-01T01:00:00Z')),
  ];
  it('복수 상태는 OR, 묶음 안에서는 맞는 요청만 남긴다', () => {
    const r = filterRequestBundles(bs, { statuses: ['approved_pending_payment', 'withdrawn'] });
    expect(r.map((b) => b.bundleId)).toEqual(['b-sink', 'b-old']);
    expect(r[0].items.map((i) => i.id)).toEqual(['rq-3']);
    expect(r[0].hiddenItemCount).toBe(1);
  });
  it('날짜와 상태는 AND', () => {
    const r = filterRequestBundles(bs, { statuses: ['approved_pending_payment', 'withdrawn'], createdFrom: '2026-10-07', createdTo: '2026-10-13' });
    expect(r.map((b) => b.bundleId)).toEqual(['b-sink']);
  });
  it('날짜만 거르면 상태는 모두', () => {
    const r = filterRequestBundles(bs, { createdFrom: '2026-10-08', createdTo: '2026-10-08' });
    expect(r.map((b) => b.bundleId)).toEqual(['b-booked']);
  });
  it('승인 완료·결제 대기와 예약 확정은 서로 다른 옵션이다', () => {
    expect(filterRequestBundles(bs, { statuses: ['approved_pending_payment'] }).map((b) => b.bundleId)).toEqual(['b-sink']);
    expect(filterRequestBundles(bs, { statuses: ['booked'] }).map((b) => b.bundleId)).toEqual(['b-booked']);
  });
  it('필터 옵션은 코드의 요청 상태와 1:1이고 새 상태를 만들지 않는다', () => {
    expect(STATUS_FILTER_OPTIONS.map((o) => o.value).sort()).toEqual(Object.keys(REQUEST_STATUS).sort());
    expect(STATUS_FILTER_OPTIONS.filter((o) => o.label.includes('승인 완료'))).toHaveLength(1);
  });
  it('기본 정렬은 요청 접수일 최신순이고 원본을 바꾸지 않는다', () => {
    const snapshot = JSON.stringify(bs);
    expect(filterRequestBundles(bs, {}).map((b) => b.bundleId)).toEqual(['b-sink', 'b-booked', 'b-old']);
    expect(JSON.stringify(bs)).toBe(snapshot);
  });
  it('선택 규칙: 옵션 순서로 정렬, 개별 선택을 모두 해제하면 전체 상태', () => {
    let s = toggleStatus([], 'booked');
    s = toggleStatus(s, 'reviewing');
    expect(s).toEqual(['reviewing', 'booked']);
    expect(toggleStatus(toggleStatus(s, 'booked'), 'reviewing')).toEqual([]);
  });
  it('버튼 요약: 하나면 상태명, 여럿이면 개수, 직접 선택은 YYYY.MM.DD', () => {
    expect(statusSummary(f({}))).toBe('전체 상태');
    expect(statusSummary(f({ statuses: ['booked'] }))).toBe('예약 확정');
    expect(statusSummary(f({ statuses: ['booked', 'reviewing', 'withdrawn'] }))).toBe('상태 3개');
    expect(periodSummary(f({ period: 'custom', from: '2026-10-01', to: '2026-10-08' }))).toBe('2026.10.01 ~ 2026.10.08');
  });
});

describe('URL 쿼리', () => {
  it('왕복해도 같은 값', () => {
    const v = f({ period: 'custom', from: '2026-10-01', to: '2026-10-08', statuses: ['needs_info', 'booked'] });
    expect(parseRequestFilter(writeRequestFilter(qs(''), v))).toEqual(v);
  });
  it('기본값은 쿼리에 넣지 않고, 다른 쿼리 값은 유지한다', () => {
    expect(writeRequestFilter(qs('x=1&period=7d&status=booked'), DEFAULT_REQUEST_FILTER).toString()).toBe('x=1');
  });
  it('잘못된 값은 기본값으로', () => {
    expect(parseRequestFilter(qs('period=1y&status=foo,,booked,booked'))).toEqual(f({ statuses: ['booked'] }));
    expect(parseRequestFilter(qs('period=custom&from=2026-10-09&to=2026-10-01'))).toEqual(DEFAULT_REQUEST_FILTER);
    expect(parseRequestFilter(qs('period=custom&from=2026-13-01&to=2026-10-01'))).toEqual(DEFAULT_REQUEST_FILTER);
    expect(parseRequestFilter(qs('period=custom'))).toEqual(DEFAULT_REQUEST_FILTER);
    expect(parseRequestFilter(qs('period=7d&from=2026-10-01'))).toEqual(f({ period: '7d' }));
  });
  it('초기화 판단', () => {
    expect(isDefaultFilter(parseRequestFilter(qs('')))).toBe(true);
    expect(isDefaultFilter(f({ period: '7d' }))).toBe(false);
  });
});
