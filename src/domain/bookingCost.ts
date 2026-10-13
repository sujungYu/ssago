/**
 * 예약 상세 ‘예약 금액·결제’ 요약 계산. 화면과 분리한 순수 함수. (spec 5.2)
 *
 * 항목 정의(데이터 계약):
 * - 작업비: 승인 작업별 업체 견적(ApprovedTask.estimate). 작업비만이며 부품·자재를 포함하지 않는다. null = 현장 확인(미산정).
 * - 부품·자재비: 승인의 부품·자재 예상(Approval.partsEstimate). 일반 부품 예상이다.
 * - 별도 동의 자재: 예약 후 고객이 동의·선결제한 맞춤 자재(MaterialOffer). partsEstimate에 포함하지 않는 별도 건으로 본다
 *   (승인 materialNote “맞춤 자재는 별도 안내 후 동의”). 동의 전 자재는 합산하지 않는다.
 * - 출장비: 마감 전 현재 예상 / 마감 후 확정(마감 시 세대 수 기준) / 변경 후 유지되는 확정값.
 * 값이 없으면 0원으로 대신하지 않고 null(확인 필요)로 두며, 그러면 총액·차액도 확정적으로 계산하지 않는다.
 *
 * 차액 = 예상(또는 최종) 총금액 − 정산에 사용 가능한 선결제 잔액.
 * 선결제 잔액은 이미 환불·공제·다른 비용에 쓴 금액을 뺀 값이다(availablePrepaid). 다시 차감하지 않는다.
 * 이 요약은 표시만 한다. 결제·환불은 기존 최종 정산 흐름에서만 일어난다.
 */
import { computeSettlement, sumItems } from './pricing';
import type { StatementItem, StatementStatus, Won } from './types';

/** null = 데이터 없음(확인 필요) */
export type Amount = Won | null;

export interface TripFeeBasis {
  kind: 'expected' | 'confirmed' | 'locked';
  amount: Amount;
  /** 분담 기준 세대 수: 마감 전 = 현재 확정 세대, 마감 후 = 마감 시 확정 세대, 유지값 = 알 수 없음(null) */
  households: number | null;
  /** 분담 기준 그룹 총 출장비. 유지값이면 변경 전 그룹 기준이라 null */
  groupTotal: Amount;
  /** 현재 참여 확정 세대(마감 후 취소로 줄 수 있음). 표시용 */
  currentHouseholds: number;
}

export interface PrepaidInput {
  depositPaid: Won;
  materialPrepaid: Won;
  changePaid: Won;
  /** 취소 환불(요청 포함). 정산 차액 환불은 포함하지 않는다 */
  refunded: Won;
  /** 출장비·자재·변경 비용 등으로 이미 공제·충당된 금액 */
  deducted: Won;
  /** 정산에 사용 가능한 선결제 잔액 */
  available: Won;
}

export interface CostInput {
  /** 승인이 없으면 undefined(확인 필요) */
  laborEstimates?: Amount[];
  partsEstimate?: Amount;
  agreedMaterials: { name: string; price: Won }[];
  agreedAdditional: { scope: string; amount: Won }[];
  tripFee: TripFeeBasis;
  discountNote?: string;
  prepaid: PrepaidInput;
  statement?: { status: StatementStatus; items: StatementItem[] };
  cancelled: boolean;
}

export type CostStage = 'estimate' | 'final_awaiting' | 'final_disputed' | 'settled' | 'cancelled';

export interface CostLine { key: string; label: string; amount: Amount; hint?: string }
export interface PaymentLine { key: string; label: string; amount: Won }

export interface CostSummary {
  stage: CostStage;
  lines: CostLine[];
  /** 업체 할인 조건(금액 미정이라 총액에 반영하지 않음) */
  discountNote?: string;
  total: { label: string; amount: Amount } | null;
  /** 금액 상세용 묶음: 수리비(작업비 + 부품·자재비 + 별도 자재·추가 작업·할인)와 내 출장비. 같은 항목을 두 번 더하지 않는다 */
  repair: Amount;
  repairLines: CostLine[];
  trip: { label: string; amount: Amount };
  /** 결제 성공한 선결제 항목(0원 제외) */
  payments: PaymentLine[];
  paidIn: Won;
  /** 이미 공제·환불돼 정산에 다시 쓰지 않는 금액 */
  used: { deducted: Won; refunded: Won };
  /** 정산에 반영되는 선결제 잔액 */
  available: Won;
  balance: { kind: 'pay' | 'zero' | 'refund' | 'unknown'; label: string; amount: Amount };
  note: string;
}

export const TRIP_LABEL = { expected: '현재 예상 출장비', confirmed: '내 확정 출장비', locked: '유지되는 내 확정 출장비' } as const;
export const FINAL_NOTE = '작업 완료 후 합의된 실제 내역으로 최종 정산됩니다.';

const sumKnown = (xs: Amount[]): Amount => (xs.some((x) => x === null) ? null : (xs as Won[]).reduce((a, b) => a + b, 0));

function paymentsOf(p: PrepaidInput): PaymentLine[] {
  return [
    { key: 'deposit', label: '결제한 예약금', amount: p.depositPaid },
    { key: 'material', label: '결제한 자재 선결제', amount: p.materialPrepaid },
    { key: 'change', label: '결제한 일정 변경 부족분', amount: p.changePaid },
  ].filter((x) => x.amount > 0);
}

function balanceOf(delta: number | null, labels: { pay: string; zero: string; refund: string; unknown: string }): CostSummary['balance'] {
  if (delta === null) return { kind: 'unknown', label: labels.unknown, amount: null };
  if (delta > 0) return { kind: 'pay', label: labels.pay, amount: delta };
  if (delta < 0) return { kind: 'refund', label: labels.refund, amount: -delta };
  return { kind: 'zero', label: labels.zero, amount: 0 };
}

export function summarizeBookingCost(i: CostInput): CostSummary {
  const p = i.prepaid;
  const base = {
    payments: paymentsOf(p),
    paidIn: p.depositPaid + p.materialPrepaid + p.changePaid,
    used: { deducted: p.deducted, refunded: p.refunded },
    available: p.available,
  };

  if (i.cancelled) {
    return {
      ...base, stage: 'cancelled', lines: [], total: null, repair: null, repairLines: [], trip: { label: TRIP_LABEL[i.tripFee.kind], amount: i.tripFee.amount },
      balance: { kind: p.refunded > 0 ? 'refund' : 'zero', label: '취소 환불 요청 금액', amount: p.refunded },
      note: '취소 환불은 ‘처리 요청’과 카드·계좌에 실제 반영되는 시점이 달라요.',
    };
  }

  // 업체가 최종 내역을 등록한 뒤: 최종 내역 기준(기존 최종 정산 화면과 같은 계산)
  if (i.statement) {
    const st = i.statement;
    const s = computeSettlement(st.items, p.available);
    const lines = st.items.map((it, n) => ({ key: `st-${n}`, label: it.label, amount: it.amount }));
    const repairLines = st.items.map((it, n) => ({ it, n })).filter(({ it }) => it.kind !== 'trip_fee').map(({ it, n }) => ({ key: `st-${n}`, label: it.label, amount: it.amount }));
    const split = { repair: repairLines.reduce((a, l) => a + (l.amount ?? 0), 0), repairLines, trip: { label: '내 출장비', amount: st.items.filter((it) => it.kind === 'trip_fee').reduce((a, it) => a + it.amount, 0) } };
    if (st.status === 'settled') {
      return {
        ...base, ...split, stage: 'settled', lines, total: { label: '최종 금액', amount: s.finalTotal },
        balance: balanceOf(s.delta, { pay: '추가 결제한 금액', zero: '추가 결제·환불 없음', refund: '환불 금액', unknown: '' }),
        note: '합의한 최종 내역으로 정산이 끝났어요.',
      };
    }
    const disputed = st.status === 'disputed';
    return {
      ...base, ...split, stage: disputed ? 'final_disputed' : 'final_awaiting', lines,
      total: { label: disputed ? '업체가 등록한 최종 금액(협의 중)' : '업체가 등록한 최종 금액(확인 전)', amount: sumItems(st.items) },
      balance: balanceOf(s.delta, disputed
        ? { pay: '합의 전 · 예상 추가 결제액', zero: '합의 전 · 예상 추가 결제 없음', refund: '합의 전 · 예상 환불액', unknown: '' }
        : { pay: '추가로 결제할 금액', zero: '추가 결제 없음', refund: '환불 예정 금액', unknown: '' }),
      note: disputed ? '금액을 협의하는 동안에는 청구하거나 확정하지 않아요.' : '내용을 확인하고 동의해야 정산이 진행돼요. 지금 자동으로 결제·환불되지 않아요.',
    };
  }

  // 작업 완료 전: 예상 금액
  const labor = i.laborEstimates === undefined || i.laborEstimates.length === 0 ? null : sumKnown(i.laborEstimates);
  const parts = i.partsEstimate === undefined ? null : i.partsEstimate;
  const lines: CostLine[] = [
    { key: 'labor', label: '예상 작업비', amount: labor, hint: labor === null ? '업체가 현장 확인 후 산정해요' : undefined },
    { key: 'parts', label: '예상 부품·자재비', amount: parts, hint: parts === null ? '아직 산정되지 않았어요' : undefined },
    ...i.agreedMaterials.map((m, n) => ({ key: `mat-${n}`, label: `별도 동의 자재 · ${m.name}`, amount: m.price })),
    ...i.agreedAdditional.map((w, n) => ({ key: `add-${n}`, label: `동의한 추가 작업 · ${w.scope}`, amount: w.amount })),
    { key: 'trip', label: TRIP_LABEL[i.tripFee.kind], amount: i.tripFee.amount, hint: i.tripFee.amount === null ? '아직 산정되지 않았어요' : undefined },
  ];
  const total = sumKnown(lines.map((l) => l.amount));
  const repairLines = lines.filter((l) => l.key !== 'trip');
  return {
    ...base, stage: 'estimate', lines, discountNote: i.discountNote,
    repair: sumKnown(repairLines.map((l) => l.amount)), repairLines, trip: { label: TRIP_LABEL[i.tripFee.kind], amount: i.tripFee.amount },
    total: { label: '예상 총금액', amount: total },
    balance: balanceOf(total === null ? null : total - p.available, {
      pay: '예상 추가 결제액', zero: '예상 추가 결제 없음', refund: '예상 환불액', unknown: '예상 추가 결제액',
    }),
    note: FINAL_NOTE,
  };
}

/**
 * 예약 상세 ‘금액·정산’ 카드 표시 기준(spec 5.14). 화면의 실제 상태와 최종 금액 등록 여부로만 판단한다.
 * - 업체가 최종 금액(최종 내역)을 등록했으면 표시: 확인 필요·금액 협의 중(정산 대기)·결제 처리 중·정산 완료 모두. 금액이 0원이어도 ‘등록됨’이다.
 * - 취소된 예약은 결제·공제·환불 기록이 있을 때만 표시(환불·공제 금액과 처리 상태).
 * - 그 밖(방문 예정·작업 중·후속 작업 등 최종 금액 등록 전)은 숨긴다 — 예상 정산액·확인·결제 버튼 없음.
 *   방문일이 지났거나 작업이 끝났다는 이유만으로 표시하지 않는다(최종 내역이 있어야 한다). 새 업무 상태·자동 전환 없음.
 */
export function showSettlementCard(i: { cancelled: boolean; hasStatement: boolean; moneyRecords: number }): boolean {
  if (i.hasStatement) return true;
  if (i.cancelled) return i.moneyRecords > 0;
  return false;
}

// ───────── 예약 상세 ‘공동 예약 정보’의 내 출장비·절약 안내(spec 5.24) ─────────
export interface TripShareView {
  /** 다른 세대와 출장비를 나누는 예약인가. 아니면(일반 예약 — 분담 세대가 나 하나) 공동 예약 정보·절약 안내를 그리지 않는다 */
  joint: boolean;
  /** 마감 전 ‘예상 출장비’, 마감 후·유지값 ‘내 출장비’ */
  label: string;
  amount: Amount;
  /** 기본 출장비(이 예약 그룹의 총 출장비 = 혼자 방문할 때 내는 출장비) − 내 출장비. 계산할 수 없거나 0원 이하면 null(안내 숨김) */
  saving: Won | null;
  /** 절약 안내 문장(saving이 있을 때만) */
  savingText: string | null;
  /** 분담 기준 문장(총 출장비·세대 수가 있을 때만) */
  splitText: string | null;
}

/**
 * 내 출장비와 공동 예약 절약 금액. 출장비만으로 계산한다(예약금·자재비·작업비를 쓰지 않는다). 절약 금액은 덜 낸 출장비이지 돌려받는 돈이 아니다.
 * - 마감 전(expected): 지금 확정 세대 기준 예상값 → ‘예상 출장비’, ‘공동 예약으로 출장비 약 ○원 절약 예상’
 * - 마감 후(confirmed): 마감 때 확정된 출장비·세대 수 → ‘내 출장비’, ‘공동 예약으로 출장비 ○원 절약했어요.’
 * - 일정 변경으로 유지한 출장비(locked): 기준 그룹 총액을 알 수 없어 절약 금액·분담 문장 없이 ‘내 출장비’만
 */
export function tripShareView(tf: TripFeeBasis, fmt: (w: Won) => string): TripShareView {
  const label = tf.kind === 'expected' ? '예상 출장비' : '내 출장비';
  const joint = tf.kind === 'locked' || (tf.households ?? 0) >= 2;
  const raw = tf.groupTotal !== null && tf.amount !== null && tf.kind !== 'locked' ? tf.groupTotal - tf.amount : null;
  const saving = joint && raw !== null && raw > 0 ? raw : null;
  const savingText = saving === null ? null
    : tf.kind === 'expected' ? `공동 예약으로 출장비 약 ${fmt(saving)} 절약 예상` : `공동 예약으로 출장비 ${fmt(saving)} 절약했어요.`;
  const splitText = joint && tf.groupTotal !== null && tf.households
    ? `총 출장비 ${fmt(tf.groupTotal)}을 ${tf.kind === 'expected' ? '지금 ' : ''}${tf.households}세대가 나눠요.${tf.kind === 'expected' ? ' 접수 마감 때 확정 세대 수로 확정돼요.' : ''}`
    : null;
  return { joint, label, amount: tf.amount, saving, savingText, splitText };
}

// ───────── 최종 정산 ‘금액 상세’의 차감 행(spec 5.26) ─────────
export interface AppliedPrepaidLine { key: 'deposit' | 'material' | 'change'; label: string; amount: Won; /** 이미 공제·환불돼 이번 정산에서 뺀 금액 */ excluded: Won }

/**
 * 이번 정산에 실제로 차감되는 선결제를 결제 종류별 행으로 나눈다. 합계는 정산 계산에 쓰는 잔액(available)과 항상 같다 — 계산을 바꾸지 않고 나눠 보여주기만 한다.
 * 이미 공제·충당·취소 환불된 금액(paidIn − available)은 예약금 → 일정 변경 추가 결제 → 자재비 순으로 빼서 다시 차감하지 않는다
 * (출장비·변경 수수료 공제는 예약금에서 충당되고, 자재 공제는 취소 때만 생긴다). 0원이 된 행은 숨긴다.
 */
export function appliedPrepaidLines(c: Pick<CostSummary, 'payments' | 'paidIn' | 'available'>): AppliedPrepaidLine[] {
  const LABEL = { deposit: '결제한 예약금', material: '결제한 자재비', change: '일정 변경 추가 결제' } as const;
  const order: AppliedPrepaidLine['key'][] = ['deposit', 'change', 'material'];
  let used = Math.max(0, c.paidIn - c.available);
  const out: AppliedPrepaidLine[] = [];
  for (const key of order) {
    const paid = c.payments.find((p) => p.key === key)?.amount ?? 0;
    if (paid <= 0) continue;
    const excluded = Math.min(paid, used);
    used -= excluded;
    if (paid - excluded > 0) out.push({ key, label: LABEL[key], amount: paid - excluded, excluded });
  }
  // 표시 순서: 예약금 → 자재비 → 일정 변경 추가 결제
  return out.sort((a, b) => ['deposit', 'material', 'change'].indexOf(a.key) - ['deposit', 'material', 'change'].indexOf(b.key));
}
