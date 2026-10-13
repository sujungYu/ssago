import { describe, expect, it } from 'vitest';
import { actionSummary, bookingDisplay, bookingHasTodo, requestDisplay, requestItemActions, type BookingDisplayInput } from './statusDisplay';
import type { Booking } from './types';

const bd = (workStatus: Booking['workStatus'], extra: Partial<BookingDisplayInput> & { status?: Booking['status']; followUp?: Booking['followUp'] } = {}) =>
  bookingDisplay({ booking: { status: extra.status ?? 'confirmed', workStatus, followUp: extra.followUp }, pendingActions: [], ...extra });

describe('보낸 요청 대표 상태·할 일', () => {
  it('대표 상태: 업체 검토 중 · 예약금 결제 · 업체 거절 · 요청 취소 · 결제 기한 만료', () => {
    expect(requestDisplay('reviewing')).toEqual({ label: '업체 검토 중', tone: 'progress', actions: [] });
    expect(requestDisplay('needs_info')).toEqual({ label: '업체 검토 중', tone: 'progress', actions: ['supplement'] });
    expect(requestDisplay('approved_pending_payment')).toEqual({ label: '예약금 결제', tone: 'progress', actions: ['deposit'] });
    expect(requestDisplay('rejected')).toEqual({ label: '업체 거절', tone: 'ended', actions: [] });
    expect(requestDisplay('withdrawn')).toMatchObject({ label: '요청 취소', tone: 'ended' });
    expect(requestDisplay('approval_expired')).toMatchObject({ label: '결제 기한 만료', tone: 'ended' });
  });
  it('예약금 결제 결과 확인 중이면 할 일 없음(기다리는 중)', () => {
    expect(requestDisplay('approved_pending_payment', { paymentInFlight: true }).actions).toEqual([]);
  });
  it('행동 문구', () => {
    expect(actionSummary(['deposit'])).toBe('예약금을 결제해 주세요');
    expect(actionSummary(['supplement'])).toBe('요청서를 보완해 주세요');
    expect(actionSummary([])).toBeNull();
  });
});

describe('예약 대표 상태·할 일', () => {
  it('확정된 예약: 방문 예정 · 작업 중 · 최종 정산 · 정산 진행 중', () => {
    expect(bd('scheduled')).toMatchObject({ label: '방문 예정', tone: 'progress', group: 'scheduled', actions: [] });
    expect(bd('in_progress').label).toBe('작업 중');
    expect(bd('followup_waiting').label).toBe('작업 중');
    expect(bd('followup_waiting', { followUp: { date: '2026-10-20', window: '09:00–12:00', note: '' } }).label).toBe('방문 예정');
    expect(bd('final_confirm_waiting', { statementStatus: 'awaiting_customer', pendingActions: ['final_statement'] })).toMatchObject({ label: '최종 정산', actions: ['final_statement'] });
    expect(bd('final_confirm_waiting', { statementStatus: 'disputed' })).toMatchObject({ label: '정산 진행 중', actions: [] }); // 협의 중: 고객 할 일 없음
    expect(bd('final_confirm_waiting', { statementStatus: 'awaiting_customer', balanceInFlight: true }).label).toBe('정산 진행 중');
    expect(bd('stopped_settlement_waiting').label).toBe('정산 진행 중');
    expect(bd('scheduled', { status: 'terms_recheck' }).label).toBe('방문 예정');
  });
  it('완료·취소: 이용 완료 · 예약 취소, 할 일 없음', () => {
    expect(bd('completed')).toMatchObject({ label: '이용 완료', tone: 'done', actions: [] });
    expect(bd('in_progress', { status: 'cancelled', pendingActions: ['additional'] })).toMatchObject({ label: '예약 취소', tone: 'ended', actions: [] });
  });
  it('행동 문구: 실제 미처리 행동 → 문구, 여러 개면 중요한 하나 + 외 N건', () => {
    expect(actionSummary(bd('in_progress', { pendingActions: ['additional'] }).actions)).toBe('추가 작업을 확인해 주세요');
    expect(actionSummary(bd('scheduled', { pendingActions: ['material'] }).actions)).toBe('자재 주문 조건을 확인해 주세요');
    expect(actionSummary(bd('scheduled', { pendingActions: ['proposal'] }).actions)).toBe('새 일정을 확인해 주세요');
    expect(actionSummary(bd('final_confirm_waiting', { pendingActions: ['final_statement'] }).actions)).toBe('최종 금액을 확인해 주세요');
    const multi = bd('final_confirm_waiting', { pendingActions: ['final_statement', 'material', 'additional', 'proposal'] });
    expect(multi.actions).toEqual(['schedule', 'additional', 'material', 'final_statement']); // 누락 없이 모두, 중요한 순
    expect(actionSummary(multi.actions)).toBe('새 일정을 확인해 주세요 외 3건');
    expect(bookingHasTodo({ booking: { status: 'confirmed', workStatus: 'final_confirm_waiting' }, pendingActions: ['final_statement'] })).toBe(true);
    expect(bookingHasTodo({ booking: { status: 'confirmed', workStatus: 'stopped_settlement_waiting' }, pendingActions: [] })).toBe(false);
  });
  it('기존 일정 방문 불가 · 새 일정 미확정: 일정 조율 중(필터 그룹도 일정 조율 중), 응답할 제안이 있을 때만 할 일', () => {
    expect(bd('scheduled', { schedule: { oldVisitUnavailable: true }, pendingActions: ['proposal'] })).toMatchObject({ label: '일정 조율 중', visitPending: true, group: 'rescheduling', actions: ['schedule'] });
    expect(bd('scheduled', { schedule: { oldVisitUnavailable: true } }).actions).toEqual([]); // 업체 재제안 대기
    expect(bd('scheduled', { schedule: { oldVisitUnavailable: false }, pendingActions: ['proposal'] })).toMatchObject({ label: '방문 예정', visitPending: false, actions: ['schedule'] });
  });
});

describe('보낸 요청 할 일(확인 필요 기준)', () => {
  it('요청서 보완·예약금 결제만 할 일이고, 결제 처리 중·결과 확인 중이면 기다리는 중이라 없다', () => {
    expect(requestItemActions({ request: { status: 'needs_info' } })).toEqual(['supplement']);
    expect(requestItemActions({ request: { status: 'approved_pending_payment' } })).toEqual(['deposit']);
    expect(requestItemActions({ request: { status: 'approved_pending_payment' }, depositAttempt: 'failed' })).toEqual(['deposit']); // 실패 → 다시 결제
    expect(requestItemActions({ request: { status: 'approved_pending_payment' }, depositAttempt: 'processing' })).toEqual([]);
    expect(requestItemActions({ request: { status: 'approved_pending_payment' }, depositAttempt: 'unknown' })).toEqual([]);
    for (const s of ['reviewing', 'rejected', 'withdrawn', 'approval_expired', 'booked'] as const) expect(requestItemActions({ request: { status: s } }), s).toEqual([]);
  });
});
