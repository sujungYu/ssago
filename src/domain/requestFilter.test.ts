import { describe, expect, it } from 'vitest';
import { REQUEST_DISPLAY } from './statusDisplay';
import {
  DEFAULT_REQUEST_FILTER, STATUS_GROUP_OPTIONS, STATUS_GROUP_STATUSES, addDaysYmd, customRangeError, filterRequestBundles, isDefaultFilter,
  parseRequestFilter, periodButtonLabel, periodSummary, statusSummary, toListQuery, writeRequestFilter, type RequestFilter,
} from './requestFilter';
import { REQUEST_STATUS } from './rules';
import type { RequestStatus } from './types';

const item = (id: string, status: RequestStatus, createdAt: string) => ({ id, request: { status, createdAt } });
const bundle = (id: string, ...items: (ReturnType<typeof item> & { depositAttempt?: 'failed' | 'processing' | 'unknown' })[]) => ({ bundleId: id, items });
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
  it('보낸 요청 필터 = 목록 대표 상태 넷(예약 완료·요청 취소 선택지 없음 — 요청 취소는 완료·취소 탭)', () => {
    expect(STATUS_GROUP_OPTIONS.map((o) => o.value)).toEqual(['all', 'reviewing', 'payment_pending', 'rejected', 'expired']);
    expect(STATUS_GROUP_OPTIONS.map((o) => o.label)).toEqual(['전체', '업체 검토 중', '예약금 결제', '업체 거절', '결제 기한 만료']);
    expect(Object.values(STATUS_GROUP_STATUSES).flat()).not.toContain('booked');
  });
  it('선택지 이름은 카드 배지(REQUEST_DISPLAY)와 같고, 그 선택지가 그 이름의 업무 상태만 거른다', () => {
    for (const o of STATUS_GROUP_OPTIONS) {
      if (o.value === 'all') continue;
      for (const st of STATUS_GROUP_STATUSES[o.value]) expect(REQUEST_DISPLAY[st].label).toBe(o.label);
    }
  });
  it('업체 거절·요청 취소·결제 기한 만료는 각각, 업체 검토 중은 추가 정보 필요 포함', () => {
    const r = run({ status: 'rejected' });
    expect(r.map((b) => b.bundleId)).toEqual(['b-sink']);
    expect(r[0].items.map((x) => x.request.status)).toEqual(['rejected']);
    expect(run({ status: 'reviewing' }).map((b) => b.items.map((x) => x.id))).toEqual([['rq-1', 'rq-2']]);
  });
  it('업무 상태는 합치지 않는다: 다른 업체 예약으로 종료(비교 요청 결과)·요청 취소(완료·취소 탭)는 선택지 없이, 나머지는 한 번씩', () => {
    const all = Object.values(STATUS_GROUP_STATUSES).flat();
    expect([...all].sort()).toEqual(Object.keys(REQUEST_STATUS).filter((k) => k !== 'booked' && k !== 'closed_other_booking' && k !== 'withdrawn').sort());
    expect(new Set(all).size).toBe(all.length);
  });
  it('접수일 단독 · 상태 단독 · 두 조건 AND(묶음 안 업체별 접수일이 달라도 업체별 요청 기준)', () => {
    // 최근 7일(10-07~10-13): b-new 안에서 rq-1(10-12)만, rq-2(10-05)는 숨김
    const d = run({ period: '7d' });
    expect(d.map((b) => b.bundleId)).toEqual(['b-sink', 'b-new', 'b-booked']);
    expect(d.find((b) => b.bundleId === 'b-new')!.items.map((x) => x.id)).toEqual(['rq-1']);
    // 업체 검토 중 + 최근 7일 → rq-2(추가 정보 필요, 10-05 접수)는 빠지고 rq-1만
    expect(run({ period: '7d', status: 'reviewing' }).map((b) => b.items.map((x) => x.id))).toEqual([['rq-1']]);
    // 업체 검토 중 + 최근 30일 → 둘 다
    expect(run({ period: '30d', status: 'reviewing' }).map((b) => b.items.map((x) => x.id))).toEqual([['rq-1', 'rq-2']]);
  });
  it('전체 선택은 그 조건만 해제한다', () => {
    const both = f({ period: '7d', status: 'expired' });
    expect({ ...both, status: 'all' }).toEqual(f({ period: '7d' }));
    expect(toListQuery({ ...both, period: 'all' }, '2026-10-13T00:00:00Z')).toEqual({ statuses: STATUS_GROUP_STATUSES.expired });
  });
  it('버튼 표시: 기본값이면 이름, 적용되면 선택값(직접 선택은 YYYY.MM.DD)', () => {
    expect([statusSummary(f({})), periodButtonLabel(f({}))]).toEqual([null, null]);
    expect(statusSummary(f({ status: 'payment_pending' }))).toBe('예약금 결제');
    expect(periodButtonLabel(f({ period: '30d' }))).toBe('최근 30일');
    expect(periodSummary(f({ period: 'custom', from: '2026-10-01', to: '2026-10-08' }))).toBe('2026.10.01 ~ 2026.10.08');
  });
});

describe('URL 쿼리', () => {
  it('왕복해도 같은 값', () => {
    const v = f({ period: 'custom', from: '2026-10-01', to: '2026-10-08', status: 'expired' });
    expect(parseRequestFilter(writeRequestFilter(qs(''), v))).toEqual(v);
    expect(writeRequestFilter(qs(''), v).toString()).toBe('period=custom&from=2026-10-01&to=2026-10-08&status=expired');
    // 이전 주소: 추가 정보 필요 → 업체 검토 중, 종료 → 전체
    expect(parseRequestFilter(qs('status=needs_info')).status).toBe('reviewing');
    expect(parseRequestFilter(qs('status=ended')).status).toBe('all');
    expect(parseRequestFilter(qs('status=withdrawn')).status).toBe('all'); // 요청 취소는 완료·취소 탭으로 옮김(spec 5.47) — 이전 주소는 전체
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
    expect(parseRequestFilter(qs('period=7d&from=2026-10-01&status=booked'))).toEqual(f({ period: '7d' })); // 없앤 ‘예약 완료’는 전체로
  });
  it('기본값 판단', () => {
    expect(isDefaultFilter(parseRequestFilter(qs('')))).toBe(true);
    expect(isDefaultFilter(f({ status: 'reviewing' }))).toBe(false);
  });
});

describe('확인 필요(보낸 요청)', () => {
  const at = '2026-10-12T01:00:00Z';
  const bs = [
    bundle('b-pay', item('rq-pay', 'approved_pending_payment', at)),
    bundle('b-paying', { ...item('rq-paying', 'approved_pending_payment', at), depositAttempt: 'processing' as const }),
    bundle('b-info', item('rq-info', 'needs_info', '2026-10-01T01:00:00Z')),
    bundle('b-review', item('rq-review', 'reviewing', at)),
    bundle('b-rej', item('rq-rej', 'rejected', at)),
  ];
  const run = (p: Partial<RequestFilter>) => filterRequestBundles(bs, toListQuery(f(p), '2026-10-13T10:00:00+09:00')).map((b) => b.bundleId);
  it('고객이 처리할 할 일(요청서 보완·예약금 결제)이 있는 요청만, 결제 처리 중·업체 검토 중·종료는 제외', () => {
    expect(run({ actionOnly: true }).sort()).toEqual(['b-info', 'b-pay']);
  });
  it('요청 상태·요청일과 함께 적용(AND)', () => {
    expect(run({ actionOnly: true, status: 'payment_pending' })).toEqual(['b-pay']);
    expect(run({ actionOnly: true, period: '7d' })).toEqual(['b-pay']);
    expect(run({ actionOnly: true, status: 'reviewing', period: '7d' })).toEqual([]);
  });
  it('URL: action=1로 저장·복원, 끄면 키를 지우고 기본 필터로 본다', () => {
    const on = writeRequestFilter(new URLSearchParams(), f({ actionOnly: true }));
    expect(on.get('action')).toBe('1');
    expect(parseRequestFilter(on).actionOnly).toBe(true);
    expect(isDefaultFilter(parseRequestFilter(on))).toBe(false);
    expect(writeRequestFilter(on, f({})).has('action')).toBe(false);
  });
});
