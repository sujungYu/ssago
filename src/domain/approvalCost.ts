/**
 * 업체 승인 조건의 ‘예상 총금액’ 계산(순수 함수). 비교 요청 요약 카드와 승인 조건 확인 화면이 같은 값을 쓴다.
 *
 * 예상 총금액 = 작업비(업체 견적 합계) + 부품·자재 예상 + 본인 예상 출장비 − 적용이 확정된 업체 할인
 * - 본인 예상 출장비는 기존 정책(expectedFeeForJoiner): 결제 완료된 확정 세대 + 본인으로 나눈 값. 결제 대기 자리는 넣지 않는다.
 *   그룹 총 출장비를 그대로 더하지 않는다. 조건 재확인(새 그룹)이면 확정 세대 0 기준(본인 혼자일 때 = 총액).
 * - 부품·자재는 승인 조건의 별도 항목(partsEstimate)으로 한 번만 더한다. 작업별 견적에 자재가 포함됐는지 나타내는 데이터는 없으므로
 *   작업비에서 따로 빼거나 다시 더하지 않는다.
 * - 업체 할인은 자유 서술 조건(discountNote)이라 충족 여부를 판정할 수 없어 적용하지 않는다(0원). 상세에서 조건을 보여준다.
 * - 견적이 없는(현장 확인) 작업이 있으면 0원으로 대체하지 않고 총금액을 null(‘금액 확인 필요’)로 둔다.
 */
import { expectedFeeForJoiner } from './pricing';
import type { Approval, Won } from './types';

export interface ApprovalEstimate {
  /** 작업비 합계. 견적 없는 작업이 있으면 null */
  labor: Won | null;
  /** 견적이 없는 작업 이름 */
  laborMissing: string[];
  parts: Won;
  /** 출장비 분담 기준 그룹 총 출장비 */
  totalTripFee: Won;
  /** 현재 확정 세대(결제 완료) */
  confirmedHouseholds: number;
  /** 본인 예약 확정 시 분담 세대 수(확정 + 본인) */
  householdsWithMe: number;
  /** 본인 예상 출장비 */
  myTripFee: Won;
  /** 적용이 확정된 할인(현재 데이터로는 항상 0) */
  discountApplied: Won;
  /** 조건부 할인 안내(적용하지 않음) */
  discountNote?: string;
  /** 예상 총금액. 금액 정보가 빠졌으면 null */
  total: Won | null;
}

export function approvalEstimate(ap: Approval, confirmedHouseholds: number): ApprovalEstimate {
  const rc = ap.recheck;
  const totalTripFee = rc ? rc.newTotalTripFee : ap.totalTripFee;
  const confirmed = rc ? 0 : Math.max(0, confirmedHouseholds);
  const laborMissing = ap.tasks.filter((t) => t.estimate === null || !Number.isFinite(t.estimate)).map((t) => t.title);
  const labor = laborMissing.length ? null : ap.tasks.reduce((a, t) => a + (t.estimate as number), 0);
  const parts = Number.isFinite(ap.partsEstimate) ? ap.partsEstimate : NaN;
  const myTripFee = expectedFeeForJoiner(totalTripFee, confirmed);
  const discountApplied = 0;
  const total = labor === null || Number.isNaN(parts) || !ap.tasks.length ? null : labor + parts + myTripFee - discountApplied;
  return {
    labor, laborMissing, parts, totalTripFee, confirmedHouseholds: confirmed, householdsWithMe: confirmed + 1, myTripFee,
    discountApplied, discountNote: ap.discountNote, total,
  };
}
