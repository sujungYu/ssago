/**
 * 목업 상태 변경 규칙. repository(사용자 동작)와 개발용 시나리오 도구(업체·시간 이벤트)가 함께 사용한다.
 * 가격 계산과 상태 규칙은 domain/에 두고, 여기서는 저장 상태를 일관되게 갱신하는 일만 한다.
 */
import { formatVisit } from '../../domain/visitTime';
import { availablePrepaid, previewCancellation, previewDateChange, type CancelPreview } from '../../domain/pricing';
import type {
  Approval, Booking, CancelCause, GroupRecord, MockNotice, PublicGroup, Refund, RepairRequest, Transaction, Won,
} from '../../domain/types';
import type { MockDb } from './db';
import type { PrepaidSummary } from '../repositories/types';

export function nid(db: MockDb, prefix: string): string {
  db.seq += 1;
  return `${prefix}-${db.seq}`;
}

export const byId = <T extends { id: string }>(list: T[], id: string): T | undefined => list.find((x) => x.id === id);

export function toPublicGroup(g: GroupRecord): PublicGroup {
  // 비공개 필드(anchorKey, closed, ended, finalPerHouseholdFee)는 내보내지 않는다.
  return {
    id: g.id, providerId: g.providerId, date: g.date, slots: [...g.slots], closeAt: g.closeAt, totalTripFee: g.totalTripFee,
    capacity: g.capacity, confirmedHouseholds: g.confirmedHouseholds, pendingSeats: g.pendingSeats, scopeType: g.scopeType,
  };
}

export function addressAnchors(db: MockDb, addressId: string): string[] {
  return byId(db.addressBook, addressId)?.anchors ?? [];
}

/** 선결제 요약 — 이미 환불·공제·충당한 금액을 최종 정산에서 다시 쓰지 않는다. */
export function prepaidOf(db: MockDb, bookingId: string): PrepaidSummary {
  const paid = (kind: Transaction['kind']) =>
    db.transactions.filter((t) => t.bookingId === bookingId && t.kind === kind && t.status === 'success').reduce((a, t) => a + t.amount, 0);
  const depositPaid = paid('deposit');
  const materialPrepaid = paid('material_prepay');
  const changePaid = paid('change_shortfall');
  // 최종 정산 차액 환불은 정산 결과이므로 정산에 쓸 선결제 잔액 계산에서는 제외한다.
  const refunded = db.refunds.filter((r) => r.bookingId === bookingId && r.purpose === 'cancel').reduce((a, r) => a + r.amount, 0);
  const deducted = db.deductions.filter((d) => d.bookingId === bookingId).reduce((a, d) => a + d.amount, 0);
  return {
    depositPaid, materialPrepaid, changePaid, refunded, deducted,
    available: availablePrepaid({ paidIn: depositPaid + materialPrepaid + changePaid, refundedOut: refunded, deducted }),
  };
}

/** 본인 확정 출장비(유지 약속 > 마감 확정값). 마감 전이면 null */
export function confirmedTripFee(db: MockDb, booking: Booking): Won | null {
  if (booking.lockedTripFee !== undefined) return booking.lockedTripFee;
  const g = byId(db.groups, booking.groupId);
  return g && g.closed ? g.finalPerHouseholdFee : null;
}

/** 회수 불가능 자재 비용 공제: 동의·선결제 완료 후 업체가 실제 주문한 건에만 적용 (POL-MAT-04) */
export function materialDeductionOf(db: MockDb, bookingId: string): Won {
  return db.materials
    .filter((m) => m.bookingId === bookingId && m.paymentStatus === 'success' && m.orderStatus === 'ordered' && m.agreedAt)
    .reduce((a, m) => a + m.nonRefundableIfCancelled, 0);
}

export function freeCancelReasonOf(db: MockDb, booking: Booking): string | null {
  if (booking.freeCancelReason) return booking.freeCancelReason;
  const delay = db.delays.find((d) => d.bookingId === booking.id && d.status === 'open');
  // 몇 분 지연부터 무료 변경·취소를 줄지는 미정이다. 목업은 업체가 지연을 알린 예약에 선택지를 보여줄 뿐 분 단위 기준을 적용하지 않는다.
  if (delay) return '업체가 방문 지연을 알렸어요. 무료 취소를 선택할 수 있어요.';
  const prop = db.proposals.find((p) => p.bookingId === booking.id && p.origin === 'provider' && p.status === 'proposed');
  if (prop) return '업체 사유 일정 변경 제안이 있어요. 무료 취소가 적용돼요.';
  // 업체 사유 변경 제안을 거절해도 예약은 자동 취소되지 않는다. 고객이 원하면 업체 사유 무료 취소를 선택할 수 있다.
  const lastProvider = db.proposals.filter((p) => p.bookingId === booking.id && p.origin === 'provider').at(-1);
  if (lastProvider?.status === 'rejected') return '업체가 제안한 일정 변경을 거절했어요. 업체 사유로 무료 취소할 수 있어요.';
  return null;
}

export function cancelPreviewOf(db: MockDb, booking: Booking, cause: CancelCause): CancelPreview {
  const g = byId(db.groups, booking.groupId)!;
  const pre = prepaidOf(db, booking.id);
  return previewCancellation({
    cause, groupClosed: g.closed, depositPaid: pre.depositPaid + pre.changePaid, materialPrepaid: pre.materialPrepaid,
    confirmedTripFee: confirmedTripFee(db, booking), materialDeduction: materialDeductionOf(db, booking.id),
  });
}

export function notify(db: MockDb, title: string, path: string, entity: MockNotice['entity']): MockNotice {
  const n: MockNotice = { id: nid(db, 'nt'), title, path, entity, createdAt: db.now };
  db.notices.unshift(n);
  return n;
}

// ───────── 그룹 ─────────
export function seatsOf(g: GroupRecord): number {
  return Math.max(0, g.capacity - g.confirmedHouseholds - g.pendingSeats);
}

/** 확정 예약이 모두 취소되면 그룹을 종료하고 결제 대기 고객에게 새 조건 재확인을 요구한다. (GRP-12) */
export function endGroupIfEmpty(db: MockDb, g: GroupRecord): void {
  if (g.closed || g.ended || g.confirmedHouseholds > 0) return;
  endGroup(db, g);
}

export function endGroup(db: MockDb, g: GroupRecord): void {
  g.ended = true;
  for (const r of db.requests.filter((x) => x.groupId === g.id && x.status === 'approved_pending_payment')) {
    const ap = db.approvals.find((a) => a.requestId === r.id);
    if (!ap || ap.recheck) continue;
    const newGroup: GroupRecord = {
      ...g, id: nid(db, 'g'), anchorKey: 'pending-new', ended: false, closed: false, finalPerHouseholdFee: null,
      confirmedHouseholds: 0, pendingSeats: 0,
    };
    db.groups.push(newGroup);
    ap.recheck = {
      endedGroupNote: '함께 예약했던 세대가 모두 취소해 기존 공동 예약이 종료됐어요.',
      newGroupId: newGroup.id, newVisitDate: g.date,
      // 같은 업체·같은 날짜의 새 그룹이므로 업체가 제안했던 방문 시각을 그대로 둔다(없으면 비워 둔다 — 추정하지 않음)
      newVisitTime: ap.visitTime,
      newCloseAt: g.closeAt, newTotalTripFee: g.totalTripFee, newDepositAmount: g.totalTripFee,
    };
    g.pendingSeats = Math.max(0, g.pendingSeats - 1);
    notify(db, '기존 공동 예약이 종료되었어요. 새 조건을 확인해 주세요.', `/requests/${r.id}/recheck`, { type: 'request', id: r.id, state: stateOfRequest(r, ap) });
  }
}

export function stateOfRequest(r: RepairRequest, ap?: Approval): string {
  return `${r.status}${ap?.recheck ? ':recheck' : ''}`;
}

// ───────── 결제 반영 ─────────
export function createBookingFromRequest(db: MockDb, tx: Transaction): Booking {
  const req = byId(db.requests, tx.requestId!)!;
  const ap = db.approvals.find((a) => a.requestId === req.id)!;
  const recheck = ap.recheck;
  const prevGroup = byId(db.groups, ap.groupId)!;
  const group = byId(db.groups, recheck ? recheck.newGroupId : ap.groupId)!;
  if (recheck) {
    // 먼저 유효 결제를 완료한 고객이 새 그룹의 최초 고객이 된다. 기준점은 이 고객의 주소로 고정한다.
    group.anchorKey = addressAnchors(db, req.addressId)[0] ?? `new:${req.addressId}`;
    group.date = recheck.newVisitDate;
    group.closeAt = recheck.newCloseAt;
    group.totalTripFee = recheck.newTotalTripFee;
    prevGroup.pendingSeats = Math.max(0, prevGroup.pendingSeats - 1);
  } else {
    group.pendingSeats = Math.max(0, group.pendingSeats - 1);
  }
  group.confirmedHouseholds += 1;
  const booking: Booking = {
    id: nid(db, 'bk'), requestId: req.id, providerId: req.providerId, groupId: group.id, addressId: req.addressId,
    status: 'confirmed', workStatus: 'scheduled',
    // 예약금 결제 성공 → 업체가 제안한 방문 시각으로 확정. 범위에서 추정하지 않는다.
    visitDate: recheck ? recheck.newVisitDate : ap.visitDate, visitTime: recheck ? recheck.newVisitTime : ap.visitTime,
    customerSlots: [...req.slots],
    // 승인·확정된 방문 주소: 요청의 제출 당시 스냅숏을 복사한다(회원·탐색 주소를 참조하지 않는다)
    visitAddress: req.visitAddress ? { ...req.visitAddress } : undefined,
    tasks: req.tasks, createdAt: db.now,
  };
  db.bookings.push(booking);
  tx.bookingId = booking.id;
  req.status = 'booked';
  req.bookingId = booking.id;
  req.updatedAt = db.now;
  // 같은 비교 묶음의 다른 요청은 종료하고 자리를 해제한다 (취소수수료 없음). 별개 수리 요청(다른 묶음)은 유지한다.
  for (const other of db.requests.filter((r) => r.bundleId === req.bundleId && r.id !== req.id)) {
    if (!['reviewing', 'needs_info', 'approved_pending_payment'].includes(other.status)) continue;
    if (other.status === 'approved_pending_payment' && other.groupId) {
      const og = byId(db.groups, other.groupId);
      if (og) og.pendingSeats = Math.max(0, og.pendingSeats - 1);
    }
    other.status = 'closed_other_booking';
    other.updatedAt = db.now;
  }
  notify(db, `예약이 확정됐어요 · 방문 예정 ${formatVisit(booking.visitDate, booking.visitTime)}`, `/bookings/${booking.id}`, { type: 'booking', id: booking.id, state: `${booking.status}:${booking.workStatus}` });
  return booking;
}

/** 결제 성공 반영. 같은 거래는 한 번만 반영한다. */
export function applyPaymentSuccess(db: MockDb, tx: Transaction): void {
  if (tx.status === 'success') return;
  tx.status = 'success';
  switch (tx.kind) {
    case 'deposit':
      createBookingFromRequest(db, tx);
      break;
    case 'material_prepay': {
      const m = byId(db.materials, tx.materialOfferId!);
      if (m) { m.paymentStatus = 'success'; m.paymentTxId = tx.id; m.agreedAt = db.now; }
      break;
    }
    case 'change_shortfall': {
      const p = byId(db.proposals, tx.proposalId!);
      if (p && p.status === 'proposed') finalizeProposalAccept(db, p);
      break;
    }
    case 'balance': {
      const b = byId(db.bookings, tx.bookingId!);
      const st = db.statements.find((s) => s.bookingId === tx.bookingId);
      if (st && b && st.status === 'awaiting_customer') {
        st.status = 'settled'; st.settledKind = 'pay'; st.confirmedAt = db.now; b.workStatus = 'completed';
      }
      break;
    }
  }
}

export function markPaymentFailure(db: MockDb, tx: Transaction): void {
  tx.status = 'failed';
  if (tx.kind === 'material_prepay') {
    const m = byId(db.materials, tx.materialOfferId!);
    if (m && m.paymentTxId === undefined) m.paymentStatus = 'none';
  }
}

// ───────── 변경 ─────────
export function finalizeProposalAccept(db: MockDb, p: import('../../domain/types').ChangeProposal): void {
  const b = byId(db.bookings, p.bookingId)!;
  const oldGroup = byId(db.groups, b.groupId)!;
  const feeBefore = confirmedTripFee(db, b);
  const free = p.origin === 'provider' || !!p.free;
  if (p.newVisit.groupId && p.newVisit.groupId !== oldGroup.id) {
    const ng = byId(db.groups, p.newVisit.groupId)!;
    oldGroup.confirmedHouseholds = Math.max(0, oldGroup.confirmedHouseholds - 1); // 마감 후면 확정값은 그대로, 현재 참여 세대만 줄인다
    if (!ng.closed) ng.confirmedHouseholds += 1;
    b.groupId = ng.id;
    endGroupIfEmpty(db, oldGroup);
  }
  if (!free && oldGroup.closed && feeBefore !== null && p.cost.tripFeeCharged > 0) {
    // 기존 확정 출장비 몫을 변경 수수료로 공제(기존 그룹에 충당). 제안 1건당 한 번만 반영한다.
    const ddId = `dd-${p.id}`;
    if (!byId(db.deductions, ddId)) {
      db.deductions.push({ id: ddId, bookingId: b.id, kind: 'trip_fee', amount: p.cost.tripFeeCharged, label: '날짜 변경 수수료(기존 확정 출장비 몫 충당)', createdAt: db.now });
    }
  }
  if (free && feeBefore !== null) b.lockedTripFee = feeBefore; // 변경을 수락해도 확정 출장비 유지
  // 고객이 수락한 경우에만 예약 방문 일정을 바꾸고 기록을 남긴다. 고객 가능 시간(customerSlots)은 수정하지 않는다.
  b.scheduleChanges = [...(b.scheduleChanges ?? []), {
    proposalId: p.id, from: { date: b.visitDate, time: b.visitTime }, to: { date: p.newVisit.date, time: p.newVisit.time }, reason: p.reason, consentedAt: db.now,
  }];
  b.visitDate = p.newVisit.date;
  b.visitTime = p.newVisit.time;
  p.status = 'accepted';
  notify(db, `일정 변경이 확정됐어요 · 방문 예정 ${formatVisit(b.visitDate, b.visitTime)}`, `/bookings/${b.id}`, { type: 'booking', id: b.id, state: `${b.status}:${b.workStatus}` });
  const delay = db.delays.find((d) => d.bookingId === b.id && d.status === 'open');
  if (delay && p.free === 'delay') { delay.status = 'resolved'; delay.choice = 'free_change'; delay.respondedAt = db.now; }
}

export function datePreviewFor(db: MockDb, booking: Booking, newGroupTotal: Won) {
  const g = byId(db.groups, booking.groupId)!;
  const pre = prepaidOf(db, booking.id);
  return previewDateChange({
    oldGroupClosed: g.closed, depositPaid: pre.depositPaid + pre.changePaid, confirmedTripFee: confirmedTripFee(db, booking), newGroupTotalTripFee: newGroupTotal,
  });
}

// ───────── 취소 ─────────
export function cancelBookingInternal(
  db: MockDb, booking: Booking, cause: CancelCause, reasonText: string,
): { refund: Refund } {
  const preview = cancelPreviewOf(db, booking, cause);
  const g = byId(db.groups, booking.groupId)!;
  if (preview.tripFeeDeduction > 0) {
    db.deductions.push({ id: nid(db, 'dd'), bookingId: booking.id, kind: 'trip_fee', amount: preview.tripFeeDeduction, label: '확정 출장비(마감 후 취소)', createdAt: db.now });
  }
  if (preview.materialDeduction > 0) {
    db.deductions.push({ id: nid(db, 'dd'), bookingId: booking.id, kind: 'material', amount: preview.materialDeduction, label: '회수 불가능 자재 비용', createdAt: db.now });
  }
  const refund: Refund = {
    id: nid(db, 'rf'), bookingId: booking.id, amount: preview.refundTotal, reason: reasonText, purpose: 'cancel', status: 'requested', requestedAt: db.now,
  };
  db.refunds.push(refund);
  booking.status = 'cancelled';
  booking.cancelledAt = db.now;
  booking.cancelCause = cause;
  // 현재 참여 세대 수는 줄인다. 마감 전이면 남은 세대 예상 출장비가 재계산되고,
  // 마감 후에는 확정 출장비(finalPerHouseholdFee)와 분담 기준(finalHouseholds)을 바꾸지 않는다.
  g.confirmedHouseholds = Math.max(0, g.confirmedHouseholds - 1);
  for (const p of db.proposals.filter((x) => x.bookingId === booking.id && (x.status === 'requested' || x.status === 'proposed'))) {
    p.status = p.origin === 'provider' ? 'rejected' : 'withdrawn';
  }
  const delay = db.delays.find((d) => d.bookingId === booking.id && d.status === 'open');
  if (delay) { delay.status = 'resolved'; delay.choice = 'free_cancel'; delay.respondedAt = db.now; }
  endGroupIfEmpty(db, g);
  return { refund };
}
