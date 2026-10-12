/**
 * 가격 계산 순수 함수. UI·데이터 접근 코드와 분리한다. (서비스 정책서 POL-FEE, POL-PAY, POL-CAN)
 * 모든 금액은 정수 원화다.
 */
import type { CancelCause, StatementItem, Won } from './types';

/** 세대별 출장비 = floor(총액 / 확정 세대 수). 세대 수가 0 이하이면 나눗셈하지 않고 null. */
export function perHouseholdFee(totalTripFee: Won, households: number): Won | null {
  if (!Number.isInteger(households) || households <= 0) return null;
  return Math.floor(totalTripFee / households);
}

/** 새로 참여하는 고객 기준의 예상 분담액. 결제 대기 자리는 세대 수에 넣지 않는다. */
export function expectedFeeForJoiner(totalTripFee: Won, confirmedHouseholds: number): Won {
  return perHouseholdFee(totalTripFee, confirmedHouseholds + 1) ?? totalTripFee;
}

/** 단독 방문(그룹 총 출장비 전액 부담) 대비 절감. 할인액이 아니라 분담에 따른 절감으로 표시한다. */
export function tripFeeSavings(totalTripFee: Won, households: number): { amount: Won; percent: number } | null {
  const fee = perHouseholdFee(totalTripFee, households);
  if (fee === null || totalTripFee <= 0) return null;
  const amount = totalTripFee - fee;
  return { amount, percent: Math.round((amount / totalTripFee) * 100) };
}

// ───────── 최종 정산 ─────────
export function sumItems(items: StatementItem[]): Won {
  return items.reduce((acc, it) => acc + it.amount, 0);
}

export interface PrepaidLedger {
  /** 수납 성공한 예약금·자재 선결제·변경 부족분 합계 */
  paidIn: Won;
  /** 환불(요청 포함, 실패 제외)된 금액 */
  refundedOut: Won;
  /** 출장비·자재·변경 비용 등으로 이미 공제·충당된 금액 */
  deducted: Won;
}

/** 최종 정산에 사용 가능한 선결제 잔액. 이미 환불·공제·다른 비용에 쓴 금액은 다시 쓰지 않는다. */
export function availablePrepaid(l: PrepaidLedger): Won {
  return Math.max(0, l.paidIn - l.refundedOut - l.deducted);
}

export type SettlementKind = 'pay' | 'zero' | 'refund';
export interface Settlement {
  finalTotal: Won;
  prepaid: Won;
  delta: Won; // 최종 대금 − 선결제 잔액
  kind: SettlementKind;
  /** 추가 결제액(양수일 때) 또는 환불액(음수일 때) 절댓값 */
  amount: Won;
}

export function computeSettlement(items: StatementItem[], prepaid: Won): Settlement {
  const finalTotal = sumItems(items);
  const delta = finalTotal - prepaid;
  const kind: SettlementKind = delta > 0 ? 'pay' : delta === 0 ? 'zero' : 'refund';
  return { finalTotal, prepaid, delta, kind, amount: Math.abs(delta) };
}

// ───────── 취소 ─────────
export interface CancelInput {
  cause: CancelCause;
  groupClosed: boolean;
  depositPaid: Won;
  materialPrepaid: Won;
  /** 마감 시 확정된 본인 세대 출장비(또는 유지하기로 한 값). 마감 전에는 null */
  confirmedTripFee: Won | null;
  /** 사전 동의·증빙 등 적용 조건을 충족한 회수 불가능 자재 비용 */
  materialDeduction: Won;
}

export interface CancelPreview {
  cause: CancelCause;
  tripFeeDeduction: Won;
  materialDeduction: Won;
  refundTotal: Won;
  prepaidTotal: Won;
  /** 다른 세대 분담액에 미치는 영향 안내 종류 */
  othersImpact: 'recalculated' | 'unchanged';
}

/**
 * 취소 금액 미리보기.
 * - 고객 사유·마감 전: 출장비 공제 없음 (남은 세대 예상 분담액 재계산)
 * - 고객 사유·마감 후: 본인 확정 출장비 공제 (다른 세대 확정 출장비 유지)
 * - 업체 사유·정책상 무료 취소: 공제 없이 해당 선결제 전액 환불
 * 자재 공제는 출장비와 별도 항목이다.
 */
export function previewCancellation(input: CancelInput): CancelPreview {
  const prepaidTotal = input.depositPaid + input.materialPrepaid;
  if (input.cause !== 'customer') {
    return {
      cause: input.cause, tripFeeDeduction: 0, materialDeduction: 0,
      refundTotal: prepaidTotal, prepaidTotal,
      othersImpact: input.groupClosed ? 'unchanged' : 'recalculated',
    };
  }
  const tripFeeDeduction = input.groupClosed && input.confirmedTripFee !== null
    ? Math.min(input.confirmedTripFee, input.depositPaid)
    : 0;
  const materialDeduction = Math.min(Math.max(0, input.materialDeduction), input.materialPrepaid);
  const refundTotal = prepaidTotal - tripFeeDeduction - materialDeduction;
  return {
    cause: 'customer', tripFeeDeduction, materialDeduction, refundTotal, prepaidTotal,
    othersImpact: input.groupClosed ? 'unchanged' : 'recalculated',
  };
}

// ───────── 날짜 변경 ─────────
export interface DateChangeInput {
  oldGroupClosed: boolean;
  depositPaid: Won;
  confirmedTripFee: Won | null;
  newGroupTotalTripFee: Won;
}
export interface DateChangePreview {
  /** 기존 확정 출장비 몫을 변경 수수료로 공제(기존 그룹에 충당). 마감 전에는 0 */
  changeFee: Won;
  carriedDeposit: Won;
  requiredDeposit: Won;
  /** 새 예약금 부족분 — 추가 결제 */
  shortfall: Won;
  /** 새 그룹 총액이 달라 예약금 초과분이 생기는 경우: 처리 방식 미정 */
  excessUndecided: Won;
}

export function previewDateChange(i: DateChangeInput): DateChangePreview {
  const changeFee = i.oldGroupClosed && i.confirmedTripFee !== null ? Math.min(i.confirmedTripFee, i.depositPaid) : 0;
  const carriedDeposit = i.depositPaid - changeFee;
  const required = i.newGroupTotalTripFee;
  return {
    changeFee, carriedDeposit, requiredDeposit: required,
    shortfall: Math.max(0, required - carriedDeposit),
    excessUndecided: Math.max(0, carriedDeposit - required),
  };
}
