import type { IsoDate, PaymentStatus, RefundStatus, TimeSlot, VisitTime } from '../domain/types';
import { formatDate } from '../domain/time';
import { VISIT_TIME_MISSING, formatSlots, isValidVisitTime } from '../domain/visitTime';
import { VISIT_ADDRESS_MISSING } from '../domain/address';
import type { CustomerContact, VisitAddress } from '../domain/types';
import { maskPhone } from '../domain/profile';
import type { Tone } from '../domain/rules';
import { Badge, PhoneButton } from '../components/ui';
import { Icon } from '../components/Icon';
import { TONE_BADGE, bookingDisplay, type ActionKind, type BookingDisplay, type PendingAction, type StatusDisplay } from '../domain/statusDisplay';
import type { BookingDetail } from '../data/repositories/types';

/**
 * 상세 카드 최상단의 업체명(왼쪽) + 전화 버튼(오른쪽, ‘업체명에 전화 · 번호’). 요청 상세 ‘보낸 요청’·예약 상세 ‘예약 정보’ 공통.
 * 좁아서 한 줄에 들어가지 않으면 전화 버튼이 다음 줄로 내려간다. 업체명·번호는 화면에서 이 한 곳에만 둔다.
 * numberOnly: 전화 버튼에 아이콘 + 번호만(요청 상세·예약 상세, 2026-10-14). 업체명은 바로 왼쪽에 있다
 */
export function ProviderContactRow({ name, phone, numberOnly }: { name: string; phone: string; numberOnly?: boolean }) {
  return (
    <div className="row row--between row--wrap provider-contact">
      <p className="strong provider-contact__name">{name}</p>
      <PhoneButton phone={phone} name={name} numberOnly={numberOnly} />
    </div>
  );
}

/** 대표 상태 배지. 목록·상세 공통(src/domain/statusDisplay.ts) */
export function StatusBadges({ d }: { d: Pick<StatusDisplay, 'label' | 'tone'> }) {
  return <span className="status-badges"><Badge tone={TONE_BADGE[d.tone]}>{d.label}</Badge></span>;
}

/**
 * 목록 카드 하단 할 일 한 줄(spec 5.18): 작은 주황 점 + 행동 문구(+ ‘외 N건’). 버튼이 아니라 안내이며 카드를 누르면 상세 상단 확인 카드로 간다.
 * 할 일이 없으면 영역·구분선을 그리지 않는다. 점은 장식이고 의미는 문구로 전달한다.
 */
/**
 * 목록 카드 상단 ‘ⓘ 확인이 필요해요’ 머리(spec 5.46). 고객이 처리할 일이 하나라도 있을 때만(‘확인 필요’ 필터와 같은 기준), 여러 개여도 한 번.
 * 상세 화면 확인 카드 머리(.act-card__head)와 같은 모양. 구체적인 할 일은 상세에서 확인한다(목록에는 문구를 두지 않음).
 */
export function TodoHead({ actions }: { actions: ActionKind[] }) {
  if (!actions.length) return null;
  return <p className="act-card__head card-head"><Icon name="info" size={14} />확인이 필요해요</p>;
}

/** 예약 상세 데이터에서 고객이 지금 해야 할 행동(목록의 pendingActions와 같은 기준) */
export function pendingActionsOfDetail(d: BookingDetail): PendingAction[] {
  if (d.booking.status === 'cancelled') return [];
  const out: PendingAction[] = [];
  if (d.proposals.some((p) => p.status === 'proposed')) out.push('proposal');
  if (d.materials.some((m) => m.paymentStatus === 'none')) out.push('material');
  if (d.additionalWorks.some((w) => w.status === 'proposed')) out.push('additional');
  if (d.delay) out.push('delay');
  const balancePending = d.ledger.some((l) => l.kind === 'payment' && l.tx.kind === 'balance' && (l.tx.status === 'processing' || l.tx.status === 'unknown'));
  if (!balancePending && d.statement?.status === 'awaiting_customer') out.push('final_statement');
  return out;
}

/** 예약 상세의 대표 상태(목록과 같은 매핑) */
export function bookingDisplayOfDetail(d: BookingDetail): BookingDisplay {
  const balanceInFlight = d.ledger.some((l) => l.kind === 'payment' && l.tx.kind === 'balance' && (l.tx.status === 'processing' || l.tx.status === 'unknown'));
  return bookingDisplay({ booking: d.booking, schedule: d.schedule, statementStatus: d.statement?.status, balanceInFlight, pendingActions: pendingActionsOfDetail(d) });
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
