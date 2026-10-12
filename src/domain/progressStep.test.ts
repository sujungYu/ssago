import { describe, expect, it } from 'vitest';
import { FLOW_STEPS, FORM_PROGRESS, progressOfBooking, progressOfPayment, progressOfRequest, unlessComplete } from './progressStep';
import type { Booking, PaymentStatus, RequestStatus, TxKind, WorkStatus } from './types';

const ALL: RequestStatus[] = ['reviewing', 'needs_info', 'approved_pending_payment', 'rejected', 'withdrawn', 'approval_expired', 'closed_other_booking', 'booked'];

describe('진행 과정 구성', () => {
  it('내 요청 3단계·내 예약 3단계(기존 4번째 ‘예약 확정’은 요청 과정에서 빠짐)', () => {
    expect(FLOW_STEPS.request.map((s) => s.label)).toEqual(['수리 요청', '업체 검토·견적', '예약금 결제']);
    expect(FLOW_STEPS.booking.map((s) => s.label)).toEqual(['예약 확정', '방문·작업', '최종 정산']);
    expect(FORM_PROGRESS).toEqual({ flow: 'request', view: { kind: 'step', step: 1 } });
  });
});

describe('내 요청 매핑', () => {
  it('요청 상태 8개를 빠짐없이 매핑한다', () => {
    const m = Object.fromEntries(ALL.map((s) => [s, progressOfRequest(s).view]));
    expect(m).toEqual({
      reviewing: { kind: 'step', step: 2, note: 'reviewing' },
      needs_info: { kind: 'step', step: 2, note: 'needs_info' },
      approved_pending_payment: { kind: 'step', step: 3, note: undefined },
      booked: { kind: 'complete' },
      rejected: { kind: 'ended' }, withdrawn: { kind: 'ended' }, approval_expired: { kind: 'ended' }, closed_other_booking: { kind: 'ended' },
    });
    expect(ALL.every((s) => progressOfRequest(s).flow === 'request')).toBe(true);
  });
  it('예약 완료 요청은 진행 표시 대신 완료 요약(unlessComplete → null)', () => {
    expect(unlessComplete(progressOfRequest('booked'))).toBeNull();
    expect(unlessComplete(progressOfRequest('reviewing'))).not.toBeNull();
  });
  it('결제 처리 중이면 3단계 + 확인 중 안내', () => {
    expect(progressOfRequest('approved_pending_payment', { inFlight: true }).view).toEqual({ kind: 'step', step: 3, note: 'payment_checking' });
  });
});

describe('예약금 결제 → 과정 전환', () => {
  it('성공 + 예약 생성 확인 = 내 예약 1단계, 성공했지만 예약 미확인 = 내 요청 3단계(결과 확인)', () => {
    expect(progressOfPayment('deposit', 'success', true)).toEqual({ flow: 'booking', view: { kind: 'step', step: 1 } });
    expect(progressOfPayment('deposit', 'success', false)).toEqual({ flow: 'request', view: { kind: 'step', step: 3, note: 'booking_checking' } });
  });
  it('실패·대기·처리 중·결과 확인 중은 내 요청 3단계(예약 확정 표시 없음)', () => {
    const st: PaymentStatus[] = ['pending', 'processing', 'unknown', 'failed'];
    for (const s of st) {
      const p = progressOfPayment('deposit', s, false)!;
      expect(p.flow).toBe('request');
      expect(p.view).toMatchObject({ kind: 'step', step: 3 });
    }
    expect(progressOfPayment('deposit', 'failed', false)!.view).toMatchObject({ note: 'payment_failed' });
  });
  it('예약금이 아닌 결제에는 진행 표시 없음', () => {
    for (const k of ['material_prepay', 'change_shortfall', 'balance'] as TxKind[]) expect(progressOfPayment(k, 'success', true)).toBeNull();
  });
});

describe('내 예약 매핑(업무 상태만 사용)', () => {
  const b = (workStatus: WorkStatus, status: Booking['status'] = 'confirmed') => progressOfBooking({ status, workStatus }).view;
  it('방문 예정 1 · 작업 중·후속 대기 2 · 최종 확인 3 · 완료 = 모두 완료 + 이용 완료', () => {
    expect(b('scheduled')).toEqual({ kind: 'step', step: 1, note: undefined });
    expect(b('in_progress')).toEqual({ kind: 'step', step: 2, note: 'in_progress' });
    expect(b('followup_waiting')).toEqual({ kind: 'step', step: 2, note: 'followup_waiting' });
    expect(b('final_confirm_waiting')).toEqual({ kind: 'step', step: 3, note: 'final_confirm' });
    expect(b('completed')).toEqual({ kind: 'complete', note: 'used' });
  });
  it('조건 재확인 예약은 1단계 + 안내', () => {
    expect(b('scheduled', 'terms_recheck')).toEqual({ kind: 'step', step: 1, note: 'terms_recheck' });
  });
  it('취소·작업 중단은 정상 진행·완료로 보이지 않는다(기존 종료 사유 유지)', () => {
    expect(b('scheduled', 'cancelled')).toEqual({ kind: 'ended' });
    expect(b('completed', 'cancelled')).toEqual({ kind: 'ended' });
    expect(b('stopped_settlement_waiting')).toEqual({ kind: 'ended' });
  });
});
