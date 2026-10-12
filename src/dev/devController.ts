/**
 * 개발용 시나리오 컨트롤러. 시간 경과·업체 응답처럼 실제로는 기다려야 하는 이벤트를 목업 저장소에 직접 일으킨다.
 * 운영 빌드에는 포함되지 않는다(App에서 import.meta.env 조건으로만 lazy-load).
 * 화면 코드는 이 파일을 import하지 않는다.
 */
import { paymentDeadline } from '../domain/rules';
import { perHouseholdFee } from '../domain/pricing';
import { latestCloseAt } from '../domain/time';
import { isValidVisitTime, proposedVisitTimeError } from '../domain/visitTime';
import type { GroupRecord, StatementItem } from '../domain/types';
import { byId, endGroup, nid, notify, stateOfRequest } from '../data/mock/engine';
import { createSeed } from '../data/mock/seed';
import type { MockRepository } from '../data/mock/mockRepository';
import type { MockSettings } from '../data/mock/db';

export type Preset = 'full' | 'lean' | 'empty';
export interface EventResult { ok: boolean; message: string }
const ok = (message: string): EventResult => ({ ok: true, message });
const no = (message: string): EventResult => ({ ok: false, message });

export class DevController {
  constructor(private repo: MockRepository) {}
  private get db() { return this.repo.__db(); }
  private done(r: EventResult): EventResult { this.repo.__commit(); return r; }

  // ───────── 상태 점검용 목록 ─────────
  snapshot() {
    const d = this.db;
    return {
      now: d.now,
      requests: d.requests.map((r) => ({ id: r.id, status: r.status, providerId: r.providerId, label: r.tasks[0]?.title ?? r.id })),
      groups: d.groups.map((g) => ({ id: g.id, providerId: g.providerId, date: g.date, closed: g.closed, ended: g.ended, confirmed: g.confirmedHouseholds, pending: g.pendingSeats })),
      bookings: d.bookings.map((b) => ({ id: b.id, status: b.status, work: b.workStatus, label: b.tasks[0]?.title ?? b.id })),
      inFlight: d.transactions.filter((t) => t.status === 'processing' || t.status === 'unknown').map((t) => ({ id: t.id, kind: t.kind, status: t.status })),
      refunds: d.refunds.map((r) => ({ id: r.id, status: r.status, amount: r.amount })),
      settings: { ...d.settings },
      notices: d.notices.slice(0, 8),
    };
  }

  // ───────── 설정·초기화 ─────────
  reset(preset: Preset): EventResult {
    const settings = { ...this.db.settings };
    const next = createSeed(preset);
    next.settings = settings;
    next.ownerAccountId = this.db.ownerAccountId; // 로그인한 계정의 상태로 유지
    this.repo.__replace(next);
    return ok(`시나리오를 '${preset}'로 초기화했어요.`);
  }
  setSettings(patch: Partial<MockSettings>): EventResult {
    Object.assign(this.db.settings, patch);
    return this.done(ok('목업 설정을 바꿨어요.'));
  }
  setNow(iso: string): EventResult {
    this.db.now = iso;
    // 기한이 지난 결제 대기 승인은 만료, 마감 시각이 지난 그룹은 마감 처리한다.
    let n = 0;
    for (const r of this.db.requests.filter((x) => x.status === 'approved_pending_payment')) {
      const ap = this.db.approvals.find((a) => a.requestId === r.id);
      if (ap && new Date(ap.paymentDeadline).getTime() <= new Date(iso).getTime() && !ap.recheck) { this.expireApproval(r.id); n++; }
    }
    for (const g of this.db.groups.filter((x) => !x.closed && !x.ended && new Date(x.closeAt).getTime() <= new Date(iso).getTime())) { this.closeGroup(g.id); n++; }
    return this.done(ok(`시계를 옮겼어요. 기한·마감 처리 ${n}건.`));
  }

  // ───────── 요청·승인 ─────────
  /** 업체 승인(모의). 업체가 고객 가능 시간 안에서 방문 시각을 제안해야 한다. 범위에서 시각을 추정하지 않는다. */
  approveRequest(requestId: string, visitTime: string): EventResult {
    const r = byId(this.db.requests, requestId);
    if (!r) return no('요청이 없어요.');
    if (!['reviewing', 'needs_info'].includes(r.status)) return no('검토 중·추가 정보 필요 상태의 요청만 승인할 수 있어요.');
    const timeErr = proposedVisitTimeError(visitTime, r.slots);
    if (timeErr) return no(timeErr);
    const prov = byId(this.db.providers, r.providerId)!;
    let g: GroupRecord | undefined = r.groupId ? byId(this.db.groups, r.groupId) : undefined;
    if (!g) {
      const date = r.newDateWish ?? '2026-10-22';
      g = {
        id: nid(this.db, 'g'), providerId: prov.id, date, slots: r.slots.length ? [...r.slots] : ['09:00–12:00'],
        closeAt: latestCloseAt(date), totalTripFee: prov.soloTripFee, capacity: 5, confirmedHouseholds: 0, pendingSeats: 0, scopeType: 'complex',
        closed: false, ended: false, finalPerHouseholdFee: null, anchorKey: 'pending-new',
      };
      this.db.groups.push(g);
      r.groupId = g.id;
    }
    if (g.closed || g.ended) return no('마감·종료된 그룹이에요.');
    const approvedAt = this.db.now;
    this.db.approvals = this.db.approvals.filter((a) => a.requestId !== r.id);
    this.db.approvals.push({
      id: nid(this.db, 'ap'), requestId: r.id, version: 1, approvedAt, groupCloseAt: g.closeAt,
      paymentDeadline: paymentDeadline(approvedAt, g.closeAt), visitDate: g.date, visitTime,
      totalTripFee: g.totalTripFee, depositAmount: g.totalTripFee,
      tasks: r.tasks.map((t) => ({ title: t.title, note: '요청하신 범위로 작업합니다.', estimate: 40000 })),
      partsEstimate: 15000, cancellationTerms: ['마감 전에는 출장비 공제 없이 취소할 수 있어요.', '마감 후 취소하면 본인 확정 출장비가 공제돼요.'], groupId: g.id,
    });
    g.pendingSeats += 1;
    r.status = 'approved_pending_payment';
    r.updatedAt = this.db.now;
    notify(this.db, '업체가 요청을 승인했어요. 조건을 확인해 주세요.', `/requests/${r.id}/approval`, { type: 'request', id: r.id, state: stateOfRequest(r) });
    return this.done(ok(`${r.id}를 승인했어요(결제 대기).`));
  }
  requestInfo(requestId: string): EventResult {
    const r = byId(this.db.requests, requestId);
    if (!r || r.status !== 'reviewing') return no('검토 중인 요청만 가능해요.');
    r.status = 'needs_info';
    r.infoRequest = { message: '고장 부위가 보이도록 사진을 한 장 더 올려 주시고, 수전 모델명을 알려 주세요.', requestedAt: this.db.now };
    r.updatedAt = this.db.now;
    notify(this.db, '업체가 추가 정보를 요청했어요.', `/requests/${r.id}/supplement`, { type: 'request', id: r.id, state: stateOfRequest(r) });
    return this.done(ok('추가 정보를 요청했어요.'));
  }
  rejectRequest(requestId: string): EventResult {
    const r = byId(this.db.requests, requestId);
    if (!r || !['reviewing', 'needs_info', 'approved_pending_payment'].includes(r.status)) return no('거절할 수 없는 상태예요.');
    if (r.status === 'approved_pending_payment') this.releasePending(r.groupId);
    r.status = 'rejected'; r.rejectionReason = '해당 일정에 방문이 어렵습니다.'; r.updatedAt = this.db.now;
    notify(this.db, '업체가 요청을 거절했어요.', `/requests/${r.id}`, { type: 'request', id: r.id, state: stateOfRequest(r) });
    return this.done(ok('거절했어요.'));
  }
  expireApproval(requestId: string): EventResult {
    const r = byId(this.db.requests, requestId);
    if (!r || r.status !== 'approved_pending_payment') return no('결제 대기 요청만 만료할 수 있어요.');
    this.releasePending(r.groupId);
    r.status = 'approval_expired'; r.updatedAt = this.db.now;
    notify(this.db, '결제 기한이 지나 승인이 만료됐어요.', `/requests/${r.id}`, { type: 'request', id: r.id, state: stateOfRequest(r) });
    return this.done(ok('승인을 만료시켰어요.'));
  }
  bumpApprovalVersion(requestId: string): EventResult {
    const ap = this.db.approvals.find((a) => a.requestId === requestId);
    if (!ap) return no('승인 조건이 없어요.');
    ap.version += 1;
    ap.partsEstimate += 5000;
    return this.done(ok(`승인 조건 버전을 ${ap.version}로 올렸어요(부품 예상 +5,000원).`));
  }
  private releasePending(groupId: string | null) {
    const g = groupId ? byId(this.db.groups, groupId) : undefined;
    if (g) g.pendingSeats = Math.max(0, g.pendingSeats - 1);
  }

  // ───────── 그룹 ─────────
  closeGroup(groupId: string): EventResult {
    const g = byId(this.db.groups, groupId);
    if (!g || g.closed || g.ended) return no('이미 마감·종료된 그룹이에요.');
    g.closed = true;
    g.finalPerHouseholdFee = perHouseholdFee(g.totalTripFee, g.confirmedHouseholds);
    for (const r of this.db.requests.filter((x) => x.groupId === g.id && x.status === 'approved_pending_payment')) {
      r.status = 'approval_expired'; r.updatedAt = this.db.now;
    }
    g.pendingSeats = 0;
    return this.done(ok(`그룹 마감: 확정 ${g.confirmedHouseholds}세대, 세대별 ${g.finalPerHouseholdFee ?? '미정'}원.`));
  }
  endGroupEvent(groupId: string): EventResult {
    const g = byId(this.db.groups, groupId);
    if (!g || g.closed || g.ended) return no('마감 전 그룹만 종료할 수 있어요.');
    endGroup(this.db, g);
    return this.done(ok('그룹이 종료되어 결제 대기 고객에게 재확인이 생겼어요.'));
  }

  // ───────── 예약·작업 ─────────
  startDelay(bookingId: string): EventResult {
    const b = byId(this.db.bookings, bookingId);
    if (!b || b.status !== 'confirmed') return no('확정 예약만 가능해요.');
    if (this.db.delays.some((d) => d.bookingId === b.id && d.status === 'open')) return no('이미 열린 지연 안내가 있어요.');
    const id = nid(this.db, 'dl');
    // 지연 안내는 예약 방문 시각을 바꾸지 않는다. 변경 도착 예상은 따로 둔다.
    this.db.delays.push({ id, bookingId: b.id, originalDate: b.visitDate, originalVisitTime: b.visitTime, newEta: new Date(new Date(this.db.now).getTime() + 80 * 60000).toISOString(), status: 'open' });
    notify(this.db, '방문이 지연되고 있어요. 대응을 선택해 주세요.', `/delays/${id}`, { type: 'delay', id, state: 'open' });
    return this.done(ok('지연 안내를 만들었어요.'));
  }
  /** 업체 일정 변경 제안(모의). 새 방문 시각은 고객 가능 시간 밖이어도 되며 고객이 수락해야만 반영된다. */
  proposeProviderChange(bookingId: string, newDate: string, visitTime: string): EventResult {
    const b = byId(this.db.bookings, bookingId);
    if (!b || b.status !== 'confirmed') return no('확정 예약만 가능해요.');
    if (!isValidVisitTime(visitTime)) return no('새 방문 시각(HH:MM)을 입력하세요.');
    if (this.db.proposals.some((p) => p.bookingId === b.id && (p.status === 'requested' || p.status === 'proposed'))) return no('확인 대기 중인 변경이 이미 있어요.');
    const id = nid(this.db, 'pr');
    this.db.proposals.push({
      id, bookingId: b.id, origin: 'provider', status: 'proposed', free: 'provider',
      oldVisit: { date: b.visitDate, time: b.visitTime }, newVisit: { date: newDate || b.visitDate, time: visitTime },
      reason: '이전 작업이 길어져 같은 날 방문이 어려워졌어요.',
      cost: { tripFeeCharged: 0, additionalDeposit: 0, note: '업체 사유 변경이라 변경 수수료가 없어요. 확정 출장비는 그대로 유지돼요.' }, createdAt: this.db.now,
    });
    notify(this.db, '업체가 일정 변경을 제안했어요.', `/proposals/${id}`, { type: 'proposal', id, state: 'proposed' });
    return this.done(ok('업체 변경 제안을 만들었어요.'));
  }
  /** 고객 변경 요청에 업체가 동의(모의). 업체가 새 방문 시각을 정해 제안하고, 고객이 최종 수락한다. */
  providerAgreesChange(proposalId: string, visitTime: string): EventResult {
    const p = byId(this.db.proposals, proposalId);
    if (!p || p.origin !== 'customer' || p.status !== 'requested') return no('고객이 요청한 변경만 업체가 동의할 수 있어요.');
    if (!isValidVisitTime(visitTime)) return no('업체가 제안할 새 방문 시각(HH:MM)을 입력하세요.');
    p.newVisit.time = visitTime;
    p.status = 'proposed';
    notify(this.db, '업체가 일정 변경에 동의했어요. 내용을 확인해 주세요.', `/proposals/${p.id}`, { type: 'proposal', id: p.id, state: 'proposed' });
    return this.done(ok('업체가 변경 요청에 동의했어요(고객 최종 확인 대기).'));
  }
  offerMaterial(bookingId: string): EventResult {
    const b = byId(this.db.bookings, bookingId);
    if (!b || b.status !== 'confirmed') return no('확정 예약만 가능해요.');
    const id = nid(this.db, 'mt');
    this.db.materials.push({
      id, bookingId: b.id, name: '맞춤 서랍 도어', spec: '가로 420mm × 세로 600mm, 화이트 무광, 2장', quantity: 2, price: 80000, deliveryDate: '2026-10-20',
      cancellationTerms: '주문·제작이 시작된 뒤 취소하면, 반품·환급이 불가능한 실제 비용만 공제될 수 있어요. 공제 금액과 근거는 취소 전에 안내돼요.',
      nonRefundableIfCancelled: 30000, paymentStatus: 'none', orderStatus: 'not_ordered',
    });
    notify(this.db, '업체가 자재 주문 조건을 보냈어요.', `/materials/${id}`, { type: 'material', id, state: 'none' });
    return this.done(ok('자재 조건을 만들었어요.'));
  }
  payAndOrderMaterial(bookingId: string): EventResult {
    const m = this.db.materials.find((x) => x.bookingId === bookingId && x.paymentStatus === 'none');
    if (!m) return no('결제 전인 자재 조건이 없어요.');
    const tx = { id: nid(this.db, 'tx'), kind: 'material_prepay' as const, bookingId, materialOfferId: m.id, amount: m.price, status: 'success' as const, idempotencyKey: `dev-${m.id}`, createdAt: this.db.now, mock: true as const };
    this.db.transactions.push(tx);
    m.paymentStatus = 'success'; m.paymentTxId = tx.id; m.agreedAt = this.db.now; m.orderStatus = 'ordered';
    return this.done(ok('자재 선결제·업체 주문이 처리됐어요(재현용).'));
  }
  markMaterialOrdered(offerId: string): EventResult {
    const m = byId(this.db.materials, offerId);
    if (!m || m.paymentStatus !== 'success') return no('선결제가 끝난 자재만 주문 처리할 수 있어요.');
    m.orderStatus = 'ordered';
    return this.done(ok('업체가 자재를 주문했어요.'));
  }
  materialDelayed(bookingId: string): EventResult {
    const b = byId(this.db.bookings, bookingId);
    if (!b) return no('예약이 없어요.');
    b.freeCancelReason = '자재 도착이 약속한 납기보다 늦어져 무료 변경·취소가 적용돼요.';
    return this.done(ok('자재 도착 지연을 기록했어요(무료 변경·취소).'));
  }
  proposeAdditionalWork(bookingId: string): EventResult {
    const b = byId(this.db.bookings, bookingId);
    if (!b || b.status !== 'confirmed') return no('확정 예약만 가능해요.');
    const id = nid(this.db, 'aw');
    this.db.additionalWorks.push({ id, bookingId: b.id, reason: '배관이 낡아 연결부 교체가 함께 필요해요.', scope: '연결 배관 2개 교체', amount: 25000, status: 'proposed' });
    b.workStatus = 'followup_waiting';
    notify(this.db, '업체가 추가 작업을 제안했어요.', `/additional/${id}`, { type: 'additional', id, state: 'proposed' });
    return this.done(ok('추가 작업을 제안했어요.'));
  }
  registerFinalStatement(bookingId: string, kind: 'pay' | 'zero' | 'refund'): EventResult {
    const b = byId(this.db.bookings, bookingId);
    if (!b || b.status !== 'confirmed') return no('확정 예약만 가능해요.');
    if (this.db.statements.some((s) => s.bookingId === b.id)) return no('이미 최종 내역이 있어요.');
    const group = byId(this.db.groups, b.groupId)!;
    const trip = b.lockedTripFee ?? group.finalPerHouseholdFee ?? perHouseholdFee(group.totalTripFee, Math.max(1, group.confirmedHouseholds)) ?? group.totalTripFee;
    const labor = kind === 'pay' ? 80000 : kind === 'zero' ? 30000 : 20000;
    const mat = kind === 'pay' ? 20000 : kind === 'zero' ? 7500 : 0;
    const items: StatementItem[] = [
      { kind: 'labor', label: '작업비', amount: labor },
      ...(mat ? [{ kind: 'material' as const, label: '부품·자재비', amount: mat }] : []),
      { kind: 'trip_fee', label: '확정 출장비', amount: trip },
    ];
    this.db.statements.push({ id: nid(this.db, 'st'), bookingId: b.id, version: 1, status: 'awaiting_customer', actualWork: b.tasks.map((t) => ({ title: t.title, done: true })), items });
    b.workStatus = 'final_confirm_waiting';
    notify(this.db, '작업이 끝나 최종 금액을 확인할 수 있어요.', `/bookings/${b.id}/final`, { type: 'statement', id: b.id, state: 'awaiting_customer' });
    return this.done(ok('작업 완료·최종 금액을 등록했어요.'));
  }

  // ───────── 결제·환불 ─────────
  async resolveInFlightPayments(): Promise<EventResult> {
    const list = this.db.transactions.filter((t) => t.status === 'processing' || t.status === 'unknown');
    if (!list.length) return no('확인 중인 결제가 없어요.');
    for (const t of list) await this.repo.refreshPayment(t.id);
    return ok(`${list.length}건의 결제 결과를 갱신했어요(설정: ${this.db.settings.resolveOutcome}).`);
  }
  setRefundStatus(refundId: string, status: 'requested' | 'completed' | 'failed' | 'unknown'): EventResult {
    const r = byId(this.db.refunds, refundId);
    if (!r) return no('환불이 없어요.');
    r.status = status;
    if (status === 'completed') r.completedAt = this.db.now;
    return this.done(ok(`환불 상태를 ${status}로 바꿨어요.`));
  }
}
