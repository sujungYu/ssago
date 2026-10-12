import { describe, expect, it } from 'vitest';
import {
  DEFAULT_REQUEST_FILTER, STATUS_GROUP_OPTIONS, STATUS_GROUP_STATUSES, addDaysYmd, customRangeError, filterRequestBundles, isDefaultFilter,
  parseRequestFilter, periodButtonLabel, periodSummary, statusSummary, toListQuery, writeRequestFilter, type RequestFilter,
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

describe('상태 그룹 필터(단일 선택)', () => {
  const bs = [
    bundle('b-sink', item('rq-3', 'approved_pending_payment', '2026-10-13T01:00:00Z'), item('rq-4', 'rejected', '2026-10-13T01:10:00Z')),
    bundle('b-booked', item('rq-k', 'booked', '2026-10-08T01:00:00Z')),
    bundle('b-old', item('rq-6', 'withdrawn', '2026-10-01T01:00:00Z')),
    bundle('b-new', item('rq-1', 'reviewing', '2026-10-12T01:00:00Z'), item('rq-2', 'needs_info', '2026-10-05T01:00:00Z')),
  ];
  const run = (p: Partial<RequestFilter>) => filterRequestBundles(bs, toListQuery(f(p), '2026-10-13T10:00:00+09:00'));
  it('전체는 조건 없음 · 최신 접수일 순 · 원본을 바꾸지 않음', () => {
    const snapshot = JSON.stringify(bs);
    expect(toListQuery(DEFAULT_REQUEST_FILTER, '2026-10-13T00:00:00Z')).toEqual({});
    expect(run({}).map((b) => b.bundleId)).toEqual(['b-sink', 'b-new', 'b-booked', 'b-old']);
    expect(JSON.stringify(bs)).toBe(snapshot);
  });
  it('결제 대기 = 업체 승인 후 예약금 결제 전(approved_pending_payment) 하나', () => {
    expect(STATUS_GROUP_STATUSES.payment_pending).toEqual(['approved_pending_payment']);
    const r = run({ status: 'payment_pending' });
    expect(r.map((b) => b.bundleId)).toEqual(['b-sink']);
    expect(r[0].items.map((x) => x.id)).toEqual(['rq-3']); // 같은 묶음의 거절 요청은 숨김(삭제 아님)
    expect(r[0].hiddenItemCount).toBe(1);
  });
  it('예약 확정은 booked만(결제 대기와 분리)', () => {
    expect(run({ status: 'booked' }).map((b) => b.bundleId)).toEqual(['b-booked']);
  });
  it('종료 = 업체 거절·철회·승인 만료·다른 업체 예약으로 종료', () => {
    expect([...STATUS_GROUP_STATUSES.ended].sort()).toEqual(['approval_expired', 'closed_other_booking', 'rejected', 'withdrawn']);
    const r = run({ status: 'ended' });
    expect(r.map((b) => b.bundleId)).toEqual(['b-sink', 'b-old']);
    expect(r[0].items.map((x) => x.request.status)).toEqual(['rejected']); // 카드에는 구체 상태가 그대로
  });
  it('추가 정보 필요·업체 검토 중', () => {
    expect(run({ status: 'needs_info' }).map((b) => b.items.map((x) => x.id))).toEqual([['rq-2']]);
    expect(run({ status: 'reviewing' }).map((b) => b.items.map((x) => x.id))).toEqual([['rq-1']]);
  });
  it('업무 상태 8개가 그룹에 빠짐없이 한 번씩 들어간다(새 상태 없음)', () => {
    const all = Object.values(STATUS_GROUP_STATUSES).flat();
    expect([...all].sort()).toEqual(Object.keys(REQUEST_STATUS).sort());
    expect(new Set(all).size).toBe(all.length);
    expect(STATUS_GROUP_OPTIONS.map((o) => o.label)).toEqual(['전체', '결제 대기', '추가 정보 필요', '업체 검토 중', '예약 완료', '종료']);
  });
  it('접수일 단독 · 상태 단독 · 두 조건 AND(묶음 안 업체별 접수일이 달라도 업체별 요청 기준)', () => {
    // 최근 7일(10-07~10-13): b-new 안에서 rq-1(10-12)만, rq-2(10-05)는 숨김
    const d = run({ period: '7d' });
    expect(d.map((b) => b.bundleId)).toEqual(['b-sink', 'b-new', 'b-booked']);
    expect(d.find((b) => b.bundleId === 'b-new')!.items.map((x) => x.id)).toEqual(['rq-1']);
    // 추가 정보 필요 + 최근 7일 → rq-2는 10-05 접수라 결과 없음
    expect(run({ period: '7d', status: 'needs_info' })).toEqual([]);
    // 추가 정보 필요 + 최근 30일 → 있음
    expect(run({ period: '30d', status: 'needs_info' }).map((b) => b.bundleId)).toEqual(['b-new']);
  });
  it('전체 선택은 그 조건만 해제한다', () => {
    const both = f({ period: '7d', status: 'ended' });
    expect({ ...both, status: 'all' }).toEqual(f({ period: '7d' }));
    expect(toListQuery({ ...both, period: 'all' }, '2026-10-13T00:00:00Z')).toEqual({ statuses: STATUS_GROUP_STATUSES.ended });
  });
  it('버튼 표시: 기본값이면 이름, 적용되면 선택값(직접 선택은 YYYY.MM.DD)', () => {
    expect([statusSummary(f({})), periodButtonLabel(f({}))]).toEqual([null, null]);
    expect(statusSummary(f({ status: 'payment_pending' }))).toBe('결제 대기');
    expect(periodButtonLabel(f({ period: '30d' }))).toBe('최근 30일');
    expect(periodSummary(f({ period: 'custom', from: '2026-10-01', to: '2026-10-08' }))).toBe('2026.10.01 ~ 2026.10.08');
  });
});

describe('URL 쿼리', () => {
  it('왕복해도 같은 값', () => {
    const v = f({ period: 'custom', from: '2026-10-01', to: '2026-10-08', status: 'ended' });
    expect(parseRequestFilter(writeRequestFilter(qs(''), v))).toEqual(v);
    expect(writeRequestFilter(qs(''), v).toString()).toBe('period=custom&from=2026-10-01&to=2026-10-08&status=ended');
  });
  it('기본값은 쿼리에 넣지 않고, 다른 쿼리 값은 유지한다', () => {
    expect(writeRequestFilter(qs('x=1&period=7d&status=booked'), DEFAULT_REQUEST_FILTER).toString()).toBe('x=1');
  });
  it('잘못된 값·이전 형식은 기본값으로', () => {
    expect(parseRequestFilter(qs('period=1y&status=foo'))).toEqual(DEFAULT_REQUEST_FILTER);
    expect(parseRequestFilter(qs('status=reviewing,needs_info'))).toEqual(DEFAULT_REQUEST_FILTER); // 이전 복수 선택 형식
    expect(parseRequestFilter(qs('status=approved_pending_payment'))).toEqual(DEFAULT_REQUEST_FILTER); // 업무 상태 코드 직접 입력
    expect(parseRequestFilter(qs('period=custom&from=2026-10-09&to=2026-10-01'))).toEqual(DEFAULT_REQUEST_FILTER);
    expect(parseRequestFilter(qs('period=custom'))).toEqual(DEFAULT_REQUEST_FILTER);
    expect(parseRequestFilter(qs('period=7d&from=2026-10-01&status=booked'))).toEqual(f({ period: '7d', status: 'booked' }));
  });
  it('기본값 판단', () => {
    expect(isDefaultFilter(parseRequestFilter(qs('')))).toBe(true);
    expect(isDefaultFilter(f({ status: 'reviewing' }))).toBe(false);
  });
});
