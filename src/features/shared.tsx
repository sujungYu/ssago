import type { Booking, IsoDate, PaymentStatus, RefundStatus, TimeSlot, VisitTime } from '../domain/types';
import { formatDate } from '../domain/time';
import { VISIT_TIME_MISSING, formatSlots, isValidVisitTime } from '../domain/visitTime';
import { VISIT_ADDRESS_MISSING } from '../domain/address';
import type { CustomerContact, VisitAddress } from '../domain/types';
import { maskPhone } from '../domain/profile';
import type { Tone } from '../domain/rules';
import { Badge } from '../components/ui';

export const WORK_STATUS: Record<Booking['workStatus'], { label: string; tone: Tone }> = {
  scheduled: { label: '방문 예정', tone: 'info' },
  in_progress: { label: '작업 중', tone: 'info' },
  followup_waiting: { label: '후속 방문 대기', tone: 'action' },
  final_confirm_waiting: { label: '최종 금액 확인 필요', tone: 'action' },
  completed: { label: '이용 완료', tone: 'success' },
  stopped_settlement_waiting: { label: '정산 대기', tone: 'warn' },
};

/**
 * 예약 상태 배지. 작업 진행 상태(workStatus)를 보여주되, 업체가 기존 일정에 방문할 수 없어 새 일정을 정하는 중이면(scheduleStateOf)
 * ‘방문 예정’ 대신 ‘일정 협의 중’으로 보여준다(목록·상세 공통). 작업 상태 값은 바꾸지 않는다.
 */
export function bookingBadge(b: Pick<Booking, 'status' | 'workStatus' | 'cancelCause'>, schedule?: { oldVisitUnavailable: boolean }) {
  if (b.status === 'cancelled') return <Badge tone="neutral">취소됨</Badge>;
  if (schedule?.oldVisitUnavailable && b.status === 'confirmed' && b.workStatus === 'scheduled') return <Badge tone="warn">일정 협의 중</Badge>;
  if (b.status === 'terms_recheck') return <Badge tone="warn">조건 재확인 필요</Badge>;
  const s = WORK_STATUS[b.workStatus];
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

export const PAYMENT_STATUS: Record<PaymentStatus, { label: string; tone: Tone; hint: string }> = {
  pending: { label: '결제 준비 중', tone: 'info', hint: '결제를 준비하고 있어요.' },
  processing: { label: '결제 진행 중', tone: 'info', hint: '결제 결과를 기다리고 있어요. 다시 결제하지 마세요.' },
  success: { label: '결제 완료', tone: 'success', hint: '결제가 완료됐어요.' },
  failed: { label: '결제 실패', tone: 'danger', hint: '결제가 완료되지 않았어요. 청구된 금액은 없어요.' },
  unknown: { label: '결제 결과 확인 중', tone: 'warn', hint: '결과를 아직 알 수 없어요. 다시 결제하지 말고 결과 확인을 눌러 주세요.' },
};

/** 환불 “요청 접수”와 카드·계좌 “실제 반영”을 구분해 표시한다(입금 완료로 단정하지 않는다). */
export const REFUND_STATUS: Record<RefundStatus, { label: string; tone: Tone; hint: string }> = {
  requested: { label: '환불 처리 요청 접수', tone: 'info', hint: '환불 처리를 요청했어요. 카드·계좌에 실제 반영되는 시점은 결제수단에 따라 달라요.' },
  completed: { label: '환불 처리 완료', tone: 'success', hint: '환불 처리가 끝났어요. 카드·계좌에 보이는 시점은 결제수단에 따라 달라요.' },
  failed: { label: '환불 처리 확인 중', tone: 'warn', hint: '환불 처리를 다시 확인하고 있어요. 취소는 그대로 유지돼요.' },
  unknown: { label: '환불 결과 확인 중', tone: 'warn', hint: '환불 결과를 확인하고 있어요. 확인되면 이 화면에 표시돼요.' },
};

export const TX_KIND_LABEL = { deposit: '예약금', material_prepay: '자재비 선결제', change_shortfall: '일정 변경 부족분', balance: '최종 잔금' } as const;

/** 방문 가능한 시간 표시: 새 요청은 고른 정확한 시각(09:00, 14:00), 이전 요청은 범위(13:00~16:00). 확정 방문 시각으로 쓰지 않는다. */
export const slotsText = (slots: TimeSlot[]) => formatSlots(slots);

/**
 * 방문 일정(날짜 + 단일 방문 시각) 표시. 날짜와 시각이 각각 줄바꿈되지 않게 묶는다.
 * 시각이 없으면 추정하지 않고 ‘방문 시각 확인 필요’를 보여준다.
 */
export function VisitText({ date, time, strong }: { date: IsoDate; time?: VisitTime | null; strong?: boolean }) {
  return (
    <span className={strong ? 'strong' : undefined}>
      {/^\d{4}-\d{2}-\d{2}$/.test(date ?? '') ? <span className="nowrap">{formatDate(date)}</span> : <Badge tone="warn">방문일 확인 필요</Badge>}{' '}
      {isValidVisitTime(time) ? <span className="nowrap">{time}</span> : <Badge tone="warn">{VISIT_TIME_MISSING}</Badge>}
    </span>
  );
}

/** 요청·예약의 방문 주소(제출 당시 스냅숏). 없으면 현재 주소로 추정하지 않고 ‘방문 주소 확인 필요’ */
export function VisitAddressText({ va }: { va: VisitAddress | null }) {
  if (!va) return <Badge tone="warn">{VISIT_ADDRESS_MISSING}</Badge>;
  return <span>{va.line1}{va.detail && <><br />{va.detail}</>}</span>;
}

/** 요청·예약의 이름·연락처(제출 당시 스냅숏). 내 정보와 같은 방식으로 연락처 가운데를 가린다. */
export function ContactText({ c }: { c: CustomerContact }) {
  return <span>{c.name} · <span className="nowrap">{maskPhone(c.phone)}</span></span>;
}

export function initialOf(name: string) { return name.slice(0, 1); }
