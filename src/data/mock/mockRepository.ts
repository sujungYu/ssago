import { RepoError } from '../../domain/errors';
import { expectedFeeForJoiner, computeSettlement, perHouseholdFee } from '../../domain/pricing';
import { checkPayable } from '../../domain/rules';
import { REQUEST_PRIORITY } from '../../domain/rules';
import { filterRequestBundles } from '../../domain/requestFilter';
import { detailError, toVisitAddress } from '../../domain/address';
import { maskPhone, normalizeContact } from '../../domain/profile';
import type { TripFeeBasis } from '../../domain/bookingCost';
import { filterBookings, tabOf, type BookingListQuery, type PendingAction } from '../../domain/bookingFilter';
import { bundleInRequestsTab, requestInRequestsTab } from '../../domain/reservationTabs';
import { COMPARE_REQUESTS_ENABLED } from '../../domain/demoScope';
import { resolveSelectedTasks } from '../../domain/taskSelection';
import { NEW_DATE_WINDOWS, isValidRequestTimes, isValidVisitTime } from '../../domain/visitTime';
import { canRequestOther, isLatestOpen, scheduleStateOf } from '../../domain/scheduleChange';
import { seoulYmd } from '../../domain/time';
import type {
  AdditionalWork, Booking, Category, ChangeProposal, CustomerContact, CustomerProfile, DelayNotice, FinalStatement, Address,
  ProviderDetail, ProviderSummary, RepairRequest, Review, Transaction, Won, GroupRecord, SavedVisitAddress, IsoDate, PublicGroup,
} from '../../domain/types';
import { isGroupJoinable } from '../../domain/jointCalendar';
import type {
  AdditionalView, ApprovalView, BookingDetail, BookingListItem, BookingQueryResult, BundleDetail, BundleListItem, CancelContext, ChangeOption,
  RequestListQuery, RequestListResult,
  ChangeRequestInput, LedgerEntry, MaterialView, NewRequestInput, NoticeLanding, PaymentResult, ProposalResult, ProposalView,
  ProviderBrief, ProviderQuery, Repository, RequestDetail, RequestListItem, ReviewContext, StatementResult, StatementView,
  TransactionDetail,
} from '../repositories/types';
import type { MockDb, ProviderRecord } from './db';
import {
  addressAnchors, applyPaymentSuccess, byId, cancelBookingInternal, cancelPreviewOf, datePreviewFor,
  finalizeProposalAccept, freeCancelReasonOf, markPaymentFailure, nid, prepaidOf, seatsOf, stateOfRequest, toPublicGroup,
} from './engine';
import { DEFAULT_CUSTOMER, createSeed } from './seed';
import { PROVIDER_SERVICES } from './providerServices';
import { migrateDemoSchedule } from './scheduleMigration';

// v3: 주소 구조 변경(탐색 주소 / 재사용 방문 주소 / 요청·예약 방문 주소 스냅숏 분리). 이전 형식 저장값은 읽지 않는다.
const STORAGE_KEY = 'on-gimae/mock-db/v3';

export interface MockRepoOptions {
  persist?: boolean;
  seed?: MockDb;
  latencyMs?: number;
}

const TX_SUBJECT: Record<Transaction['kind'], string> = {
  deposit: '예약금', material_prepay: '자재비 선결제', change_shortfall: '일정 변경 부족분', balance: '최종 잔금',
};

export class MockRepository implements Repository {
  private db: MockDb;
  private listeners = new Set<() => void>();
  private persist: boolean;

  constructor(opts: MockRepoOptions = {}) {
    this.persist = opts.persist ?? false;
    const loaded = this.persist ? this.load() : null;
    this.db = loaded ?? opts.seed ?? createSeed('full');
    if (opts.latencyMs !== undefined) this.db.settings.latencyMs = opts.latencyMs;
    // 이전 버전 데모 일정으로 저장된 상태는 공동 예약 일정만 새 기준으로 옮긴다(다른 저장 데이터·기록은 그대로)
    const migrated = !!loaded && migrateDemoSchedule(this.db, createSeed('full'));
    if (this.persist && (!loaded || migrated)) this.save(); // 새 세션의 시드도 저장해 새로고침·점검 도구가 같은 상태를 보게 한다
  }

  // ───────── 인프라 ─────────
  /** 개발용 시나리오 도구 전용. 화면 코드는 사용하지 않는다. */
  __db(): MockDb { return this.db; }
  __replace(next: MockDb): void { this.db = next; this.commit(); }
  __commit(): void { this.commit(); }
  /**
   * 로그인 계정이 바뀌면(로그아웃 포함) 목업 상태를 새 데모 시드로 초기화한다. 이전 계정이 만든 요청·예약·거래가 남지 않게 한다.
   * 같은 계정이면(새로고침 후 세션 복원 등) 진행 중이던 목업 상태를 유지한다. 목업 설정은 유지한다.
   * 실제 데이터 연결 후에는 이 교체가 아니라 서버·RLS가 본인 데이터만 돌려줘야 한다.
   */
  __switchOwner(accountId: string | null): void {
    if (this.db.ownerAccountId === accountId) return;
    const next = createSeed('full');
    next.ownerAccountId = accountId;
    next.settings = { ...this.db.settings };
    this.__replace(next);
  }

  private load(): MockDb | null {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as MockDb) : null;
    } catch { return null; }
  }
  /** 저장에 성공했는지 돌려준다(저장하지 않는 설정이면 true). 대부분의 쓰기는 실패해도 화면 동작을 이어 간다. */
  private save(): boolean {
    if (!this.persist) return true;
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(this.db)); return true; } catch { return false; /* 저장 불가 환경에서도 동작 */ }
  }
  private commit(): void {
    this.save();
    this.listeners.forEach((l) => l());
  }
  private async delay(): Promise<void> {
    const ms = this.db.settings.latencyMs;
    if (ms > 0) await new Promise((r) => setTimeout(r, ms));
  }
  private async read<T>(fn: () => T): Promise<T> {
    await this.delay();
    if (this.db.settings.failNextQuery) {
      this.db.settings.failNextQuery = false;
      this.save(); // 구독자에게 알리지 않는다(알리면 즉시 재조회되어 실패 상태가 가려진다)
      throw new RepoError('network');
    }
    return fn();
  }
  private async write<T>(fn: () => T): Promise<T> {
    await this.delay();
    if (this.db.settings.failNextWrite) {
      this.db.settings.failNextWrite = false;
      this.save(); // 아무 데이터도 바꾸지 않고 실패(구독자에게 알리지 않음)
      throw new RepoError('network');
    }
    const out = fn();
    this.commit();
    return out;
  }

  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  now() { return this.db.now; }

  // ───────── 내부 도우미 ─────────
  private brief(p: ProviderRecord): ProviderBrief { return { id: p.id, name: p.name, phone: p.phone }; }
  private provider(id: string): ProviderRecord {
    const p = byId(this.db.providers, id);
    if (!p) throw new RepoError('not_found');
    return p;
  }
  /** 업체 등록 작업(표시 순서). 이전 목업 상태(작업 데이터가 없던 때 저장된 것)는 기본 데이터로 채운다 */
  private servicesOf(p: ProviderRecord) { return p.services ?? PROVIDER_SERVICES[p.id] ?? []; }
  private request(id: string): RepairRequest {
    const r = byId(this.db.requests, id);
    if (!r) throw new RepoError('not_found');
    return r;
  }
  private booking(id: string): Booking {
    const b = byId(this.db.bookings, id);
    if (!b) throw new RepoError('not_found');
    return b;
  }
  private group(id: string): GroupRecord {
    const g = byId(this.db.groups, id);
    if (!g) throw new RepoError('not_found');
    return g;
  }
  private address(id: string): Address {
    const a = byId(this.db.addressBook, id);
    if (!a) throw new RepoError('not_found');
    return { id: a.id, label: a.label, line1: a.line1, kind: a.kind };
  }
  /** 이 주소로 참여 가능하고 접수가 열린 그룹만 반환한다. 주소 판단이 불가하면(주소 판단 서비스 장애·주소록에 없는 주소) null. */
  private eligibleGroups(providerId: string, addressId: string | null): GroupRecord[] | null {
    if (addressId === null || this.db.settings.addressServiceDown) return null;
    if (!byId(this.db.addressBook, addressId)) return null; // 확인할 수 없는 주소: 참여 가능 여부를 단정하지 않는다
    const anchors = addressAnchors(this.db, addressId);
    return this.db.groups.filter((g) => g.providerId === providerId && !g.closed && !g.ended && anchors.includes(g.anchorKey));
  }
  private summary(p: ProviderRecord, addressId: string | null): ProviderSummary {
    const gs = this.eligibleGroups(p.id, addressId);
    const open = gs?.filter((g) => seatsOf(g) > 0).sort((a, b) => a.date.localeCompare(b.date));
    return {
      id: p.id, name: p.name, categoryIds: p.categoryIds, scope: p.scope, rating: p.rating, reviewCount: p.reviewCount,
      soloTripFee: p.soloTripFee, area: p.area,
      jointAvailable: gs === null ? null : (open?.length ?? 0) > 0,
      nextJoint: open && open[0] ? { date: open[0].date, expectedFee: expectedFeeForJoiner(open[0].totalTripFee, open[0].confirmedHouseholds) } : undefined,
    };
  }
  private inFlight(filter: (t: Transaction) => boolean): Transaction | undefined {
    return this.db.transactions.find((t) => (t.status === 'processing' || t.status === 'unknown') && filter(t));
  }
  private reqListItem(r: RepairRequest): RequestListItem {
    const ap = this.db.approvals.find((a) => a.requestId === r.id);
    const g = r.groupId ? byId(this.db.groups, r.groupId) : undefined;
    return {
      request: r, provider: this.brief(this.provider(r.providerId)), visitDate: ap?.visitDate ?? g?.date ?? r.newDateWish,
      paymentDeadline: r.status === 'approved_pending_payment' ? ap?.paymentDeadline : undefined,
      depositAmount: ap ? (ap.recheck?.newDepositAmount ?? ap.depositAmount) : undefined,
      depositAttempt: r.status === 'approved_pending_payment' ? this.depositAttemptOf(r.id) : undefined,
    };
  }
  private depositAttemptOf(requestId: string): RequestListItem['depositAttempt'] {
    const last = this.db.transactions.filter((t) => t.kind === 'deposit' && t.requestId === requestId).at(-1);
    return last && (last.status === 'failed' || last.status === 'processing' || last.status === 'unknown') ? last.status : undefined;
  }
  private reqDetail(r: RepairRequest): RequestDetail {
    const ap = this.db.approvals.find((a) => a.requestId === r.id);
    const g = r.groupId ? byId(this.db.groups, r.groupId) : undefined;
    return {
      request: r, provider: this.brief(this.provider(r.providerId)), visitAddress: r.visitAddress ?? null,
      group: g ? toPublicGroup(g) : undefined, groupClosed: !!g?.closed, approval: ap, now: this.db.now,
    };
  }

  // ───────── 탐색 ─────────
  listCategories(): Promise<Category[]> { return this.read(() => this.db.categories); }
  searchAddresses(keyword: string): Promise<Address[]> {
    return this.read(() => {
      const q = keyword.trim();
      return this.db.addressBook
        .filter((a) => !q || a.line1.includes(q) || a.label.includes(q))
        .map((a) => this.address(a.id));
    });
  }
  getAddress(id: string): Promise<Address> { return this.read(() => this.address(id)); }

  // ───────── 사용자별 주소 ─────────
  // 목업: 사용자별 데이터는 목업 DB(sessionStorage)에 있고 계정이 바뀌면 새 시드로 초기화된다(__switchOwner).
  // 실제 연동 시 같은 계약으로 서버의 사용자별 저장소(RLS)에서 읽고 쓴다.
  getExploreAddress(): Promise<Address | null> {
    return this.read(() => {
      const id = this.db.exploreAddressId;
      return id && byId(this.db.addressBook, id) ? this.address(id) : null;
    });
  }
  setExploreAddress(addressId: string): Promise<Address> {
    return this.write(() => {
      const a = this.address(addressId);
      this.db.exploreAddressId = a.id; // 탐색 주소만 바꾼다. 요청·예약 방문 주소와 재사용 주소는 그대로
      return a;
    });
  }
  getSavedVisitAddress(): Promise<SavedVisitAddress | null> {
    return this.read(() => (this.db.savedVisitAddress ? { ...this.db.savedVisitAddress } : null));
  }

  listProviders(q: ProviderQuery): Promise<ProviderSummary[]> {
    return this.read(() => {
      const list = this.db.providers.filter((p) => p.categoryIds.includes(q.categoryId)).map((p) => this.summary(p, q.addressId));
      return list.sort((a, b) => Number(!!b.jointAvailable) - Number(!!a.jointAvailable) || b.rating - a.rating);
    });
  }

  getProvider(id: string, addressId: string | null): Promise<ProviderDetail> {
    return this.read(() => {
      const p = this.provider(id);
      const gs = this.eligibleGroups(id, addressId) ?? [];
      return {
        ...this.summary(p, addressId), intro: p.intro, phone: p.phone, afterServiceTerms: p.afterServiceTerms, reviews: p.reviews,
        services: this.servicesOf(p),
        groups: gs.sort((a, b) => a.date.localeCompare(b.date)).map(toPublicGroup),
      };
    });
  }

  listJointGroups(providerId: string, addressId: string | null, date: IsoDate): Promise<PublicGroup[]> {
    return this.read(() => {
      this.provider(providerId);
      if (addressId === null) return [];
      const gs = this.eligibleGroups(providerId, addressId);
      if (gs === null) throw new RepoError('address_unavailable');
      return gs.filter((g) => g.date === date).map(toPublicGroup).filter((g) => isGroupJoinable(g, this.db.now))
        .sort((a, b) => a.slots[0].localeCompare(b.slots[0]) || a.closeAt.localeCompare(b.closeAt));
    });
  }

  // ───────── 요청 ─────────
  createRequest(input: NewRequestInput): Promise<RepairRequest> {
    return this.write(() => {
      const existing = this.db.keyed[input.idempotencyKey];
      if (existing) return this.request(existing); // 같은 제출은 최초 접수 건을 돌려준다 (ERR-REQ-03)
      const p = this.provider(input.providerId);
      const base = this.address(input.addressId);
      if (detailError(base.kind, input.addressDetail)) throw new RepoError('invalid');
      // 이 업체의 등록 작업만, 하나 이상, 중복 없이(이전 업체 작업 ID가 섞이면 거부). 작업명은 지금 이름을 요청 당시 이름으로 보관
      const tasks = resolveSelectedTasks(this.servicesOf(p), input.tasks);
      if (!tasks) throw new RepoError('invalid');
      const contact = normalizeContact(input.contact ?? { name: '', phone: '' });
      if (!contact) throw new RepoError('invalid');
      if (input.groupId) {
        const gs = this.eligibleGroups(input.providerId, input.addressId);
        if (gs === null) throw new RepoError('address_unavailable');
        const g = byId(this.db.groups, input.groupId);
        if (!g || g.closed || g.ended || seatsOf(g) === 0) throw new RepoError('group_closed');
        if (!gs.some((x) => x.id === g.id)) throw new RepoError('address_not_eligible');
      } else if (!input.newDateWish) throw new RepoError('invalid');
      // 방문 가능한 시각: 이 일정(공동 예약 = 그룹 시간대, 새 날짜 = 공통 시간대)에서 고를 수 있는 정확한 시각만. 범위·없는 시각·중복은 거부
      const windows = input.groupId ? byId(this.db.groups, input.groupId)!.slots : NEW_DATE_WINDOWS;
      if (!isValidRequestTimes(input.slots, windows)) throw new RepoError('invalid');
      const id = nid(this.db, 'rq');
      const r: RepairRequest = {
        id, bundleId: input.bundleId ?? `b-${id}`, providerId: input.providerId, groupId: input.groupId, newDateWish: input.newDateWish,
        slots: [...input.slots].sort(), tasks: tasks.map((t) => ({ ...t, id: nid(this.db, 't') })), addressId: input.addressId,
        // 저장 선택 여부와 관계없이 이번 요청에는 정확한 방문 주소를 스냅숏으로 보존한다
        visitAddress: toVisitAddress(base, input.addressDetail), status: 'reviewing', createdAt: this.db.now, updatedAt: this.db.now,
        // 제출 당시 이름·연락처 스냅숏(내 정보를 참조하지 않는다 — 나중에 내 정보를 수정해도 이 요청은 그대로)
        contact,
      };
      this.db.requests.push(r); // 제출만으로 자리·세대 수·결제는 발생하지 않는다
      this.db.keyed[input.idempotencyKey] = id;
      // 접수에 성공한 같은 처리 안에서만 재사용 주소를 바꾼다. 선택하지 않으면 기존 저장 주소를 그대로 둔다(삭제하지 않음).
      if (input.saveAddressForNext) {
        this.db.savedVisitAddress = { addressId: base.id, line1: base.line1, detail: r.visitAddress!.detail, savedAt: this.db.now };
      }
      return r;
    });
  }

  listRequests(): Promise<BundleListItem[]> {
    return this.read(() => this.bundleList());
  }

  queryRequests(query: RequestListQuery): Promise<RequestListResult> {
    // 목업은 전체를 메모리에서 거른다. 서버 구현은 같은 조건을 조회 쿼리에 넣는다.
    return this.read(() => {
      // 보낸 요청 탭: 예약으로 이어진 요청이 있는 묶음은 통째로 뺀다(그 예약은 예약 탭에만 보인다). 원본 요청은 지우지 않는다.
      const all = COMPARE_REQUESTS_ENABLED
        ? this.bundleList().filter((b) => bundleInRequestsTab(b.items.map((i) => i.request)))
        // 비교 요청을 쓰지 않는 데모: 업체별 개별 요청 하나씩(묶음 데이터는 보존, 목록·건수만 개별 요청 기준)
        : [...this.db.requests].filter(requestInRequestsTab).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
          .map((r) => ({ bundleId: r.bundleId, taskTitles: r.tasks.map((t) => t.title), items: [this.reqListItem(r)], updatedAt: r.updatedAt }));
      return { bundles: filterRequestBundles(all, query), hasAnyRequest: all.length > 0 };
    });
  }

  private bundleList(): BundleListItem[] {
    const map = new Map<string, RepairRequest[]>();
    for (const r of this.db.requests) map.set(r.bundleId, [...(map.get(r.bundleId) ?? []), r]);
    const rank = (r: RepairRequest) => REQUEST_PRIORITY.indexOf(r.status);
    return [...map.entries()].map(([bundleId, rs]) => ({
      bundleId, taskTitles: rs[0].tasks.map((t) => t.title),
      items: [...rs].sort((a, b) => rank(a) - rank(b)).map((r) => this.reqListItem(r)),
      updatedAt: rs.map((r) => r.updatedAt).sort().at(-1)!,
    })).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  getRequest(id: string): Promise<RequestDetail> { return this.read(() => this.reqDetail(this.request(id))); }

  getBundle(bundleId: string): Promise<BundleDetail> {
    return this.read(() => {
      const rs = this.db.requests.filter((r) => r.bundleId === bundleId);
      if (!rs.length) throw new RepoError('not_found');
      return { bundleId, tasks: rs[0].tasks, items: rs.map((r) => this.reqDetail(r)), now: this.db.now };
    });
  }

  supplementRequest(id: string, input: { message: string; photoNames: string[]; idempotencyKey: string }): Promise<RepairRequest> {
    return this.write(() => {
      const r = this.request(id);
      if (this.db.keyed[input.idempotencyKey]) return r;
      if (r.status !== 'needs_info' || !r.infoRequest) throw new RepoError('request_ended');
      if (!input.message.trim() && !input.photoNames.length) throw new RepoError('invalid');
      r.infoRequest.response = { message: input.message, photoNames: input.photoNames, respondedAt: this.db.now };
      if (input.photoNames.length) r.tasks[0].photoNames = [...r.tasks[0].photoNames, ...input.photoNames];
      r.status = 'reviewing';
      r.updatedAt = this.db.now;
      this.db.keyed[input.idempotencyKey] = r.id;
      return r;
    });
  }

  withdrawRequest(id: string): Promise<RepairRequest> {
    return this.write(() => {
      const r = this.request(id);
      if (this.inFlight((t) => t.requestId === r.id)) throw new RepoError('payment_in_progress'); // 성공 거래를 철회로 지우지 않는다
      if (!['reviewing', 'needs_info', 'approved_pending_payment'].includes(r.status)) throw new RepoError('request_ended');
      if (r.status === 'approved_pending_payment' && r.groupId) {
        const g = byId(this.db.groups, r.groupId);
        if (g) g.pendingSeats = Math.max(0, g.pendingSeats - 1); // 자리 해제
      }
      r.status = 'withdrawn';
      r.updatedAt = this.db.now;
      return r;
    });
  }

  // ───────── 승인·결제 ─────────
  getApproval(requestId: string): Promise<ApprovalView> {
    return this.read(() => {
      const r = this.request(requestId);
      const d = this.reqDetail(r);
      if (!d.approval) throw new RepoError('not_found');
      const g = r.groupId ? byId(this.db.groups, r.groupId) : undefined;
      return {
        ...d, approval: d.approval, groupEnded: !!g?.ended,
        inFlightPayment: this.inFlight((t) => t.requestId === r.id && t.kind === 'deposit'),
      };
    });
  }

  simulateDepositPayment(input: { requestId: string; approvalVersion: number; consentedRecheck?: boolean; idempotencyKey: string }): Promise<PaymentResult> {
    return this.write(() => {
      const prior = this.db.keyed[input.idempotencyKey];
      if (prior) { const tx = byId(this.db.transactions, prior)!; return { tx, bookingId: tx.bookingId }; } // 연타·재전송은 기존 결과
      const r = this.request(input.requestId);
      const ap = this.db.approvals.find((a) => a.requestId === r.id);
      if (!ap) throw new RepoError('not_found');
      const success = this.db.transactions.find((t) => t.requestId === r.id && t.kind === 'deposit' && t.status === 'success');
      if (success) return { tx: success, bookingId: success.bookingId };
      const g = byId(this.db.groups, ap.groupId)!;
      const inflight = this.inFlight((t) => t.requestId === r.id && t.kind === 'deposit');
      const verdict = checkPayable({
        request: r, approval: { ...ap, recheck: input.consentedRecheck ? undefined : ap.recheck }, groupClosed: g.closed,
        groupEnded: input.consentedRecheck ? false : g.ended, confirmedVersion: input.approvalVersion, hasInFlightPayment: !!inflight,
      });
      if (!verdict.ok) {
        const map: Record<typeof verdict.reason, ConstructorParameters<typeof RepoError>[0]> = {
          expired: 'payment_expired', closed: 'group_closed', recheck_required: 'recheck_required', request_ended: 'request_ended',
          booked: 'request_ended', version_changed: 'version_changed', in_progress: 'payment_in_progress',
        };
        throw new RepoError(map[verdict.reason]);
      }
      const recheck = ap.recheck;
      const amount = recheck ? recheck.newDepositAmount : ap.depositAmount;
      const tx: Transaction = {
        id: nid(this.db, 'tx'), kind: 'deposit', requestId: r.id, amount, status: 'pending', idempotencyKey: input.idempotencyKey,
        createdAt: this.db.now, mock: true,
      };
      this.db.transactions.push(tx);
      this.db.keyed[input.idempotencyKey] = tx.id;
      this.settleByOutcome(tx);
      return { tx, bookingId: tx.bookingId };
    });
  }

  /** 모의 결제 결과를 개발 도구 설정에 따라 반영한다. */
  private settleByOutcome(tx: Transaction): void {
    const outcome = this.db.settings.payOutcome;
    if (outcome === 'success') applyPaymentSuccess(this.db, tx);
    else if (outcome === 'fail') markPaymentFailure(this.db, tx);
    else tx.status = outcome; // processing | unknown — 성공으로 단정하지 않는다
  }

  getTransaction(txId: string): Promise<TransactionDetail> {
    return this.read(() => {
      const tx = byId(this.db.transactions, txId);
      if (!tx) throw new RepoError('not_found');
      const reqId = tx.requestId ?? (tx.bookingId ? this.booking(tx.bookingId).requestId : undefined);
      const providerId = reqId ? this.request(reqId).providerId : undefined;
      return { tx, providerName: providerId ? this.provider(providerId).name : undefined, bookingId: tx.bookingId, requestId: tx.requestId, subject: TX_SUBJECT[tx.kind] };
    });
  }

  refreshPayment(txId: string): Promise<PaymentResult> {
    return this.write(() => {
      const tx = byId(this.db.transactions, txId);
      if (!tx) throw new RepoError('not_found');
      if (tx.status === 'processing' || tx.status === 'unknown') {
        const o = this.db.settings.resolveOutcome;
        if (o === 'success') applyPaymentSuccess(this.db, tx);
        else if (o === 'fail') markPaymentFailure(this.db, tx);
        else tx.status = 'unknown';
      }
      return { tx, bookingId: tx.bookingId };
    });
  }

  // ───────── 예약 ─────────
  /**
   * 내 출장비와 분담 기준. 마감 후에는 마감 시 확정 세대 수(finalHouseholds) 기준이며,
   * 마감 후 다른 세대가 취소해 현재 참여 세대가 줄어도 다시 계산하지 않는다. 변경으로 유지된 확정값은 변경 전 그룹 기준이다.
   */
  private tripFeeOf(b: Booking): TripFeeBasis {
    const g = this.group(b.groupId);
    const currentHouseholds = g.confirmedHouseholds;
    if (b.lockedTripFee !== undefined) return { kind: 'locked', amount: b.lockedTripFee, households: null, groupTotal: null, currentHouseholds };
    if (g.closed) return { kind: 'confirmed', amount: g.finalPerHouseholdFee, households: g.finalHouseholds ?? null, groupTotal: g.totalTripFee, currentHouseholds };
    return { kind: 'expected', amount: perHouseholdFee(g.totalTripFee, g.confirmedHouseholds), households: g.confirmedHouseholds, groupTotal: g.totalTripFee, currentHouseholds };
  }

  private attention(b: Booking): string | null {
    const db = this.db;
    if (b.status === 'cancelled') {
      const rf = db.refunds.find((x) => x.bookingId === b.id);
      return rf ? (rf.status === 'completed' ? '환불 처리가 완료됐어요' : '환불 처리 중이에요') : null;
    }
    if (db.delays.some((d) => d.bookingId === b.id && d.status === 'open')) return '방문이 지연되고 있어요 · 대응을 선택해 주세요';
    // 일정 변경: 목록·상세 공통 기준(scheduleStateOf)
    const sch = scheduleStateOf(b, db.proposals);
    if (sch.kind === 'provider_proposed') return sch.oldVisitUnavailable ? '방문 일정 변경이 필요해요 · 새 일정을 확인해 주세요' : '일정 변경 제안을 확인해 주세요';
    if (sch.kind === 'customer_request_agreed') return '일정 변경 동의 · 새 일정을 확인해 주세요';
    if (sch.kind === 'negotiating' || sch.kind === 'unavailable_open') return sch.label;
    if (db.transactions.some((t) => t.bookingId === b.id && (t.status === 'processing' || t.status === 'unknown'))) return '결제 결과를 확인 중이에요';
    if (db.materials.some((m) => m.bookingId === b.id && m.paymentStatus === 'none')) return '자재 조건을 확인하고 동의해 주세요';
    if (db.additionalWorks.some((w) => w.bookingId === b.id && w.status === 'proposed')) return '추가 작업 동의가 필요해요';
    const st = db.statements.find((s) => s.bookingId === b.id);
    if (st?.status === 'awaiting_customer') return '최종 금액을 확인해 주세요';
    if (st?.status === 'disputed') return '금액을 협의 중이에요 · 정산 대기';
    if (st?.status === 'settled' && !db.reviews.some((r) => r.bookingId === b.id)) return '리뷰를 작성할 수 있어요';
    return null;
  }

  /** 고객이 지금 해야 할 미처리 행동(실제 데이터). 처리·철회된 제안, 업체 응답 대기, 금액 협의 중, 리뷰 작성(선택)은 넣지 않는다. */
  private pendingActionsOf(b: Booking): PendingAction[] {
    if (b.status === 'cancelled') return [];
    const db = this.db;
    const out: PendingAction[] = [];
    if (b.status === 'terms_recheck') out.push('terms_recheck');
    if (db.proposals.some((p) => p.bookingId === b.id && p.status === 'proposed')) out.push('proposal');
    if (db.materials.some((m) => m.bookingId === b.id && m.paymentStatus === 'none')) out.push('material');
    if (db.additionalWorks.some((w) => w.bookingId === b.id && w.status === 'proposed')) out.push('additional');
    if (db.delays.some((d) => d.bookingId === b.id && d.status === 'open')) out.push('delay');
    if (db.statements.some((s) => s.bookingId === b.id && s.status === 'awaiting_customer')) out.push('final_statement');
    return out;
  }

  private bookingItems(): BookingListItem[] {
    return [...this.db.bookings].sort((a, b) => b.visitDate.localeCompare(a.visitDate)).map((b) => {
      const tf = this.tripFeeOf(b);
      return {
        booking: b, providerName: this.provider(b.providerId).name, attention: this.attention(b), pendingActions: this.pendingActionsOf(b),
        groupClosed: this.group(b.groupId).closed, tripFee: { kind: tf.kind, amount: tf.amount },
        schedule: scheduleStateOf(b, this.db.proposals),
      };
    });
  }

  listBookings(): Promise<BookingListItem[]> {
    return this.read(() => this.bookingItems());
  }

  queryBookings(query: BookingListQuery): Promise<BookingQueryResult> {
    // 목업은 전체를 메모리에서 거른다. 정렬은 기존 화면과 같다(확인할 내용 먼저, 그다음 방문일 최신순).
    return this.read(() => {
      const all = this.bookingItems();
      const { items, excludedMissingVisitDate } = filterBookings(all, query);
      return {
        items: items.map((it, i) => ({ it, i })).sort((a, b) => Number(!!b.it.attention) - Number(!!a.it.attention) || a.i - b.i).map((x) => x.it),
        hasAnyInTab: all.some((it) => tabOf(it.booking) === query.tab),
        excludedMissingVisitDate,
      };
    });
  }

  getBooking(id: string): Promise<BookingDetail> {
    return this.read(() => {
      const b = this.booking(id);
      const p = this.provider(b.providerId);
      const g = this.group(b.groupId);
      const tf = this.tripFeeOf(b);
      const ledger = this.ledgerFor(b.id);
      const req = byId(this.db.requests, b.requestId);
      return {
        booking: b,
        origin: req ? { requestId: req.id, bundleId: req.bundleId, bundleSize: this.db.requests.filter((r) => r.bundleId === req.bundleId).length } : undefined,
        provider: { ...this.summary(p, null), phone: p.phone, afterServiceTerms: p.afterServiceTerms },
        visitAddress: b.visitAddress ?? null,
        group: toPublicGroup(g), groupClosed: g.closed, groupEnded: g.ended,
        tripFee: tf, approval: this.db.approvals.find((a) => a.requestId === b.requestId),
        prepaid: prepaidOf(this.db, b.id),
        delay: this.db.delays.find((d) => d.bookingId === b.id && d.status === 'open'),
        proposals: this.db.proposals.filter((x) => x.bookingId === b.id),
        schedule: scheduleStateOf(b, this.db.proposals),
        materials: this.db.materials.filter((m) => m.bookingId === b.id),
        additionalWorks: this.db.additionalWorks.filter((w) => w.bookingId === b.id),
        statement: this.db.statements.find((s) => s.bookingId === b.id),
        ledger, review: this.db.reviews.find((r) => r.bookingId === b.id),
        freeCancel: b.status === 'confirmed' ? (freeCancelReasonOf(this.db, b) ? { reason: freeCancelReasonOf(this.db, b)! } : null) : null,
        now: this.db.now,
      };
    });
  }

  // ───────── 일정 변경 ─────────
  listChangeOptions(bookingId: string): Promise<ChangeOption[]> {
    return this.read(() => {
      const b = this.booking(bookingId);
      const gs = this.eligibleGroups(b.providerId, b.addressId) ?? [];
      return gs.filter((g) => g.id !== b.groupId && seatsOf(g) > 0).map((g) => ({
        group: toPublicGroup(g), preview: datePreviewFor(this.db, b, g.totalTripFee),
      }));
    });
  }

  requestChange(input: ChangeRequestInput): Promise<ChangeProposal> {
    return this.write(() => {
      const prior = this.db.keyed[input.idempotencyKey];
      if (prior) return byId(this.db.proposals, prior)!;
      const b = this.booking(input.bookingId);
      if (b.status !== 'confirmed') throw new RepoError('request_ended');
      if (this.db.proposals.some((p) => p.bookingId === b.id && (p.status === 'requested' || p.status === 'proposed'))) throw new RepoError('change_stale');
      const free = input.delayId ? 'delay' as const : undefined;
      let newDate = b.visitDate;
      let groupId: string | undefined;
      let cost: ChangeProposal['cost'];
      if (input.kind === 'time') {
        cost = { tripFeeCharged: 0, additionalDeposit: 0, note: '같은 날짜의 시간 변경은 업체가 승인하면 무료예요. 승인 전에는 기존 시간이 유지돼요.' };
      } else if (input.targetGroupId) {
        const g = this.group(input.targetGroupId);
        newDate = g.date;
        groupId = g.id;
        const pv = datePreviewFor(this.db, b, g.totalTripFee);
        cost = free
          ? { tripFeeCharged: 0, additionalDeposit: pv.shortfall, note: '지연으로 인한 무료 변경이에요. 변경 수수료 없이 확정 출장비가 유지돼요.' }
          : {
            tripFeeCharged: pv.changeFee, additionalDeposit: pv.shortfall,
            note: pv.changeFee > 0
              ? '기존 그룹 마감 후 변경이라 기존 확정 출장비 몫이 변경 비용으로 쓰이고, 새 예약금이 부족하면 차액을 추가 결제해요.'
              : '기존 그룹 마감 전이라 변경 수수료가 없어요.',
          };
      } else {
        if (!input.newDateWish) throw new RepoError('invalid');
        newDate = input.newDateWish;
        cost = { tripFeeCharged: 0, additionalDeposit: 0, note: '새 그룹 조건과 비용은 업체가 일정을 제안하면 알려드려요. 합의 전까지 기존 일정이 유지돼요.' };
      }
      const p: ChangeProposal = {
        id: nid(this.db, 'pr'), bookingId: b.id, origin: 'customer', status: 'requested', free,
        // 고객 요청 단계에는 새 방문 시각이 없다. 고객이 원하는 가능 시간만 두고, 업체가 동의할 때 방문 시각을 제안한다.
        oldVisit: { date: b.visitDate, time: b.visitTime }, newVisit: { date: newDate, wishSlot: input.newSlot, groupId },
        reason: input.reason, cost, createdAt: this.db.now,
      };
      this.db.proposals.push(p);
      this.db.keyed[input.idempotencyKey] = p.id;
      if (input.delayId) {
        const d = byId(this.db.delays, input.delayId);
        if (d) { d.status = 'resolved'; d.choice = 'free_change'; d.respondedAt = this.db.now; }
      }
      return p;
    });
  }

  getProposal(id: string): Promise<ProposalView> {
    return this.read(() => {
      const p = byId(this.db.proposals, id);
      if (!p) throw new RepoError('not_found');
      const b = this.booking(p.bookingId);
      const g = this.group(b.groupId);
      let preview: ProposalView['preview'] = null;
      if (p.newVisit.groupId && p.origin === 'customer') preview = datePreviewFor(this.db, b, this.group(p.newVisit.groupId).totalTripFee);
      return { proposal: p, booking: b, providerName: this.provider(b.providerId).name, providerPhone: this.provider(b.providerId).phone, groupClosed: g.closed, preview, cancelPreview: cancelPreviewOf(this.db, b, 'policy_free') };
    });
  }

  respondToProposal(id: string, decision: 'accept' | 'reject', idempotencyKey: string): Promise<ProposalResult> {
    return this.write(() => {
      const p = byId(this.db.proposals, id);
      if (!p) throw new RepoError('not_found');
      const prior = this.db.keyed[idempotencyKey];
      if (prior) {
        const t = byId(this.db.transactions, prior);
        return { proposal: p, tx: t, booking: this.booking(p.bookingId) };
      }
      if (p.status !== 'proposed') throw new RepoError('change_stale');
      if (!isLatestOpen(p, this.db.proposals)) throw new RepoError('change_stale'); // 이전 제안에는 응답할 수 없다
      const b = this.booking(p.bookingId);
      if (b.status !== 'confirmed') throw new RepoError('request_ended');
      if (decision === 'reject') {
        // 기존 일정에 방문할 수 없는(또는 확인이 필요한) 제안은 ‘거절 = 기존 일정 유지’가 될 수 없다 → 수락하거나 다른 일정을 요청한다
        if (canRequestOther(p)) throw new RepoError('invalid');
        p.respondedAt = this.db.now;
        // 거절하면 기존 예약(날짜·방문 시각)을 그대로 둔다. 자동 변경·자동 취소하지 않는다.
        // 업체 사유 제안을 거절한 경우 고객은 다른 일정을 협의하거나 업체 사유 무료 취소를 직접 선택한다(freeCancelReasonOf).
        this.db.keyed[idempotencyKey] = id;
        p.status = 'rejected';
        return { proposal: p, booking: b };
      }
      if (!p.newVisit.time) throw new RepoError('invalid'); // 업체가 새 방문 시각을 제안하지 않은 변경은 수락할 수 없다
      if (p.cost.additionalDeposit > 0 && p.origin === 'customer') {
        if (this.inFlight((t) => t.proposalId === p.id)) throw new RepoError('payment_in_progress');
        const tx: Transaction = {
          id: nid(this.db, 'tx'), kind: 'change_shortfall', bookingId: b.id, proposalId: p.id, amount: p.cost.additionalDeposit, status: 'pending',
          idempotencyKey, createdAt: this.db.now, mock: true,
        };
        this.db.transactions.push(tx);
        this.db.keyed[idempotencyKey] = tx.id;
        this.settleByOutcome(tx);
        return { proposal: p, tx: tx, booking: b };
      }
      this.db.keyed[idempotencyKey] = id;
      finalizeProposalAccept(this.db, p);
      return { proposal: p, booking: b };
    });
  }

  /**
   * 기존 일정에 방문할 수 없는 업체 제안(또는 그 협의의 재제안)에 ‘다른 일정 요청’으로 답한다.
   * 이 제안은 수락하지 않고 끝내고(고객 응답 기록), 고객 희망 일정(날짜 + 정확한 시각)을 담은 변경 요청을 만든다. 업체가 다시 제안하고
   * 고객이 수락해야만 새 일정이 확정된다. 업체 사유라 변경 비용 없이 기존 확정 출장비를 유지한다(free = provider). 기존 예약·작업·주소·선결제는 그대로.
   */
  requestOtherSchedule(input: { proposalId: string; date: string; time: string; note?: string; idempotencyKey: string }): Promise<ChangeProposal> {
    return this.write(() => {
      const prior = this.db.keyed[input.idempotencyKey];
      if (prior) return byId(this.db.proposals, prior)!;
      const p = byId(this.db.proposals, input.proposalId);
      if (!p) throw new RepoError('not_found');
      if (!canRequestOther(p) || !isLatestOpen(p, this.db.proposals)) throw new RepoError('change_stale');
      const b = this.booking(p.bookingId);
      if (b.status !== 'confirmed') throw new RepoError('request_ended');
      if (!input.date || input.date <= seoulYmd(this.db.now) || !isValidVisitTime(input.time)) throw new RepoError('invalid');
      p.status = 'rejected'; p.customerReply = 'other_requested'; p.respondedAt = this.db.now;
      const req: ChangeProposal = {
        id: nid(this.db, 'pr'), bookingId: b.id, origin: 'customer', status: 'requested', free: 'provider', replyTo: p.replyTo ?? p.id,
        oldVisit: { date: b.visitDate, time: b.visitTime }, newVisit: { date: input.date, wishSlot: input.time },
        reason: input.note?.trim() ? `기존 일정에 방문할 수 없어 다른 일정을 요청했어요. ${input.note.trim()}` : '기존 일정에 방문할 수 없어 다른 일정을 요청했어요.',
        cost: { tripFeeCharged: 0, additionalDeposit: 0, note: '업체 사유 변경이라 변경 비용이 없고, 확정 출장비가 그대로 유지돼요.' },
        createdAt: this.db.now,
      };
      this.db.proposals.push(req);
      this.db.keyed[input.idempotencyKey] = req.id;
      return req;
    });
  }

  withdrawProposal(id: string): Promise<ChangeProposal> {
    return this.write(() => {
      const p = byId(this.db.proposals, id);
      if (!p) throw new RepoError('not_found');
      if (p.origin !== 'customer' || !['requested', 'proposed'].includes(p.status)) throw new RepoError('change_stale');
      p.status = 'withdrawn';
      return p;
    });
  }

  // ───────── 취소·지연 ─────────
  getCancelContext(bookingId: string): Promise<CancelContext> {
    return this.read(() => {
      const b = this.booking(bookingId);
      const reason = b.status === 'confirmed' ? freeCancelReasonOf(this.db, b) : null;
      const cause = b.status === 'cancelled' ? (b.cancelCause ?? 'customer') : reason ? 'policy_free' : 'customer';
      return {
        cause, causeLabel: reason ?? (cause === 'provider' ? '업체 사유 취소' : '고객 사유 취소'),
        preview: cancelPreviewOf(this.db, b, cause),
        existing: b.status === 'cancelled' ? { refund: this.db.refunds.find((r) => r.bookingId === b.id) } : undefined,
      };
    });
  }

  cancelBooking(input: { bookingId: string; expectedRefund: Won; idempotencyKey: string }): Promise<{ booking: Booking; refund: import('../../domain/types').Refund }> {
    return this.write(() => {
      const b = this.booking(input.bookingId);
      const existing = this.db.refunds.find((r) => r.bookingId === b.id && r.purpose === 'cancel');
      if (b.status === 'cancelled' && existing) {
        if (this.db.keyed[input.idempotencyKey]) return { booking: b, refund: existing }; // 같은 요청의 재전송
        throw new RepoError('already_cancelled'); // 재공제·재환불 금지
      }
      if (b.status !== 'confirmed') throw new RepoError('request_ended');
      const reason = freeCancelReasonOf(this.db, b);
      const cause = reason ? 'policy_free' : 'customer';
      const preview = cancelPreviewOf(this.db, b, cause);
      if (preview.refundTotal !== input.expectedRefund) throw new RepoError('stale_cancel'); // 확인 이후 조건이 바뀜
      const text = cause === 'customer'
        ? `고객 사유 취소 · 선결제 ${preview.prepaidTotal.toLocaleString('ko-KR')}원 − 공제 ${(preview.tripFeeDeduction + preview.materialDeduction).toLocaleString('ko-KR')}원`
        : '무료 취소 · 해당 선결제 전액 환불';
      const { refund } = cancelBookingInternal(this.db, b, cause, text);
      this.db.keyed[input.idempotencyKey] = refund.id;
      return { booking: b, refund };
    });
  }

  getDelay(delayId: string): Promise<{ delay: DelayNotice; booking: Booking; providerName: string; providerPhone: string }> {
    return this.read(() => {
      const d = byId(this.db.delays, delayId);
      if (!d) throw new RepoError('not_found');
      const b = this.booking(d.bookingId);
      const p = this.provider(b.providerId);
      return { delay: d, booking: b, providerName: p.name, providerPhone: p.phone };
    });
  }

  respondToDelayWait(delayId: string): Promise<DelayNotice> {
    return this.write(() => {
      const d = byId(this.db.delays, delayId);
      if (!d) throw new RepoError('not_found');
      if (d.status !== 'open') throw new RepoError('change_stale');
      d.status = 'resolved'; d.choice = 'wait'; d.respondedAt = this.db.now; // 사용자가 직접 고른 경우에만 기록한다
      return d;
    });
  }

  // ───────── 자재·추가 작업 ─────────
  getMaterial(offerId: string): Promise<MaterialView> {
    return this.read(() => {
      const m = byId(this.db.materials, offerId);
      if (!m) throw new RepoError('not_found');
      const b = this.booking(m.bookingId);
      return { offer: m, booking: b, providerName: this.provider(b.providerId).name, tx: m.paymentTxId ? byId(this.db.transactions, m.paymentTxId) : this.inFlight((t) => t.materialOfferId === m.id) };
    });
  }

  agreeAndPayMaterial(offerId: string, idempotencyKey: string): Promise<PaymentResult> {
    return this.write(() => {
      const prior = this.db.keyed[idempotencyKey];
      if (prior) { const tx = byId(this.db.transactions, prior)!; return { tx, bookingId: tx.bookingId }; }
      const m = byId(this.db.materials, offerId);
      if (!m) throw new RepoError('not_found');
      const done = this.db.transactions.find((t) => t.materialOfferId === m.id && t.status === 'success');
      if (done) return { tx: done, bookingId: done.bookingId };
      if (this.inFlight((t) => t.materialOfferId === m.id)) throw new RepoError('payment_in_progress');
      if (this.booking(m.bookingId).status !== 'confirmed') throw new RepoError('request_ended');
      const tx: Transaction = {
        id: nid(this.db, 'tx'), kind: 'material_prepay', bookingId: m.bookingId, materialOfferId: m.id, amount: m.price, status: 'pending',
        idempotencyKey, createdAt: this.db.now, mock: true,
      };
      this.db.transactions.push(tx);
      this.db.keyed[idempotencyKey] = tx.id;
      m.paymentStatus = 'pending';
      this.settleByOutcome(tx);
      if (tx.status === 'processing' || tx.status === 'unknown') m.paymentStatus = tx.status;
      return { tx, bookingId: tx.bookingId };
    });
  }

  getAdditionalWork(id: string): Promise<AdditionalView> {
    return this.read(() => {
      const w = byId(this.db.additionalWorks, id);
      if (!w) throw new RepoError('not_found');
      const b = this.booking(w.bookingId);
      return { work: w, booking: b, providerName: this.provider(b.providerId).name };
    });
  }

  respondToAdditionalWork(id: string, decision: 'agree' | 'decline'): Promise<AdditionalWork> {
    return this.write(() => {
      const w = byId(this.db.additionalWorks, id);
      if (!w) throw new RepoError('not_found');
      if (w.status !== 'proposed') throw new RepoError('change_stale');
      w.status = decision === 'agree' ? 'agreed' : 'declined'; // 거절한 금액은 최종 청구에 반영하지 않는다
      w.respondedAt = this.db.now;
      if (decision === 'agree' && w.followUp) {
        const b = this.booking(w.bookingId);
        b.followUp = { date: w.followUp.date, window: w.followUp.window, note: '업체와 합의한 후속 방문이에요. 최초 공동 출장비는 후속 방문에 자동 적용되지 않아요.' };
        b.workStatus = 'followup_waiting';
      }
      return w;
    });
  }

  // ───────── 최종 정산 ─────────
  getFinalStatement(bookingId: string): Promise<StatementView> {
    return this.read(() => {
      const b = this.booking(bookingId);
      const st = this.db.statements.find((s) => s.bookingId === bookingId);
      if (!st) throw new RepoError('not_found');
      const p = this.provider(b.providerId);
      const prepaid = prepaidOf(this.db, bookingId);
      return {
        statement: st, booking: b, providerName: p.name, providerPhone: p.phone, prepaid,
        settlement: computeSettlement(st.items, prepaid.available),
        inFlightPayment: this.inFlight((t) => t.bookingId === bookingId && t.kind === 'balance'),
        refund: this.db.refunds.find((r) => r.bookingId === bookingId && r.purpose === 'settlement'),
      };
    });
  }

  confirmSettlement(input: { bookingId: string; statementVersion: number; idempotencyKey: string }): Promise<StatementResult> {
    return this.write(() => {
      const b = this.booking(input.bookingId);
      const st = this.db.statements.find((s) => s.bookingId === b.id);
      if (!st) throw new RepoError('not_found');
      const prior = this.db.keyed[input.idempotencyKey];
      const prepaid = prepaidOf(this.db, b.id);
      if (prior) {
        const tx = byId(this.db.transactions, prior);
        return { statement: st, settlement: computeSettlement(st.items, prepaid.available), tx, refund: this.db.refunds.find((r) => r.bookingId === b.id && r.purpose === 'settlement') };
      }
      if (st.status === 'settled') throw new RepoError('already_cancelled');
      if (st.status === 'disputed') throw new RepoError('change_stale'); // 이견 중에는 자동 확인·청구 없음
      if (st.version !== input.statementVersion) throw new RepoError('version_changed');
      if (this.inFlight((t) => t.bookingId === b.id && t.kind === 'balance')) throw new RepoError('payment_in_progress');
      const settlement = computeSettlement(st.items, prepaid.available);
      this.db.keyed[input.idempotencyKey] = st.id;
      if (settlement.kind === 'pay') {
        const tx: Transaction = {
          id: nid(this.db, 'tx'), kind: 'balance', bookingId: b.id, amount: settlement.amount, status: 'pending', idempotencyKey: input.idempotencyKey,
          createdAt: this.db.now, mock: true,
        };
        this.db.transactions.push(tx);
        this.db.keyed[input.idempotencyKey] = tx.id;
        this.settleByOutcome(tx);
        return { statement: st, settlement, tx };
      }
      st.status = 'settled'; st.settledKind = settlement.kind; st.confirmedAt = this.db.now; b.workStatus = 'completed';
      if (settlement.kind === 'refund') {
        const refund = {
          id: nid(this.db, 'rf'), bookingId: b.id, amount: settlement.amount, reason: '최종 금액 정산 · 선결제 초과분', purpose: 'settlement' as const,
          status: 'requested' as const, requestedAt: this.db.now,
        };
        this.db.refunds.push(refund);
        return { statement: st, settlement, refund };
      }
      return { statement: st, settlement };
    });
  }

  reportDispute(bookingId: string): Promise<FinalStatement> {
    return this.write(() => {
      const st = this.db.statements.find((s) => s.bookingId === bookingId);
      if (!st) throw new RepoError('not_found');
      if (st.status === 'settled') throw new RepoError('change_stale');
      st.status = 'disputed'; // 자동 청구·자동 합의 없음. 업체와 직접 협의한다.
      return st;
    });
  }

  // ───────── 이용 후 ─────────
  private ledgerFor(bookingId?: string): LedgerEntry[] {
    const db = this.db;
    const nameOfBooking = (id: string) => this.provider(this.booking(id).providerId).name;
    const out: LedgerEntry[] = [];
    for (const tx of db.transactions) {
      if (bookingId && tx.bookingId !== bookingId) continue;
      const rid = tx.requestId ?? (tx.bookingId ? this.booking(tx.bookingId).requestId : undefined);
      const name = rid ? this.provider(this.request(rid).providerId).name : undefined;
      out.push({ kind: 'payment', id: tx.id, at: tx.createdAt, tx, subject: `${TX_SUBJECT[tx.kind]}${tx.mock ? ' (모의)' : ''}`, bookingId: tx.bookingId, providerName: name });
    }
    for (const r of db.refunds) {
      if (bookingId && r.bookingId !== bookingId) continue;
      out.push({ kind: 'refund', id: r.id, at: r.requestedAt, refund: r, subject: r.reason, bookingId: r.bookingId, providerName: nameOfBooking(r.bookingId) });
    }
    for (const d of db.deductions) {
      if (bookingId && d.bookingId !== bookingId) continue;
      out.push({ kind: 'deduction', id: d.id, at: d.createdAt, deduction: d, subject: d.label, bookingId: d.bookingId, providerName: nameOfBooking(d.bookingId) });
    }
    return out.sort((a, b) => b.at.localeCompare(a.at));
  }

  listLedger(): Promise<LedgerEntry[]> { return this.read(() => this.ledgerFor()); }
  getLedgerEntry(id: string): Promise<LedgerEntry> {
    return this.read(() => {
      const e = this.ledgerFor().find((x) => x.id === id);
      if (!e) throw new RepoError('not_found');
      return e;
    });
  }

  getReviewContext(bookingId: string): Promise<ReviewContext> {
    return this.read(() => {
      const b = this.booking(bookingId);
      const st = this.db.statements.find((s) => s.bookingId === bookingId);
      return {
        booking: b, providerName: this.provider(b.providerId).name, eligible: st?.status === 'settled' && b.status === 'confirmed',
        existing: this.db.reviews.find((r) => r.bookingId === bookingId),
      };
    });
  }

  createReview(input: { bookingId: string; rating: number; body: string; photoNames: string[]; idempotencyKey: string }): Promise<Review> {
    return this.write(() => {
      const prior = this.db.keyed[input.idempotencyKey];
      if (prior) return byId(this.db.reviews, prior)!;
      const b = this.booking(input.bookingId);
      const st = this.db.statements.find((s) => s.bookingId === b.id);
      if (st?.status !== 'settled' || b.status !== 'confirmed') throw new RepoError('not_reviewable'); // 취소·미정산 건에 자격을 자동 부여하지 않는다
      const dup = this.db.reviews.find((r) => r.bookingId === b.id);
      if (dup) return dup;
      if (input.rating < 1 || input.rating > 5 || !input.body.trim()) throw new RepoError('invalid');
      const rv: Review = {
        id: nid(this.db, 'rv'), bookingId: b.id, providerId: b.providerId, rating: input.rating, body: input.body.trim(),
        photoNames: input.photoNames, createdAt: this.db.now, // 요청 사진·주소는 자동으로 붙이지 않는다
      };
      this.db.reviews.push(rv);
      this.db.keyed[input.idempotencyKey] = rv.id;
      return rv;
    });
  }

  getProfile(): Promise<CustomerProfile> {
    return this.read(() => this.profile());
  }

  updateProfile(input: CustomerContact): Promise<CustomerProfile> {
    return this.write(() => {
      const next = normalizeContact(input);
      if (!next) throw new RepoError('invalid');
      const prev = this.db.customer;
      this.db.customer = { id: prev.id, ...next, phoneMasked: maskPhone(next.phone) };
      // 브라우저 저장에 실패하면 바꾸지 않은 것으로 되돌린다(새로고침하면 사라질 값을 저장했다고 알리지 않는다)
      if (!this.save()) { this.db.customer = prev; throw new RepoError('storage_failed'); }
      return this.profile();
    });
  }

  /** 저장된 고객 정보가 없거나 형식이 잘못됐으면 기본 가상 고객 정보를 쓴다(이전 형식 저장값 포함). */
  private profile(): CustomerProfile {
    const c = this.db.customer as Partial<CustomerProfile> | undefined;
    const ok = c && typeof c.name === 'string' && typeof c.phone === 'string' ? normalizeContact({ name: c.name, phone: c.phone }) : null;
    const v = ok ?? DEFAULT_CUSTOMER;
    return { id: c?.id ?? 'cu1', ...v, phoneMasked: maskPhone(v.phone) };
  }

  // ───────── 알림 진입 ─────────
  resolveNotice(noticeId: string): Promise<NoticeLanding> {
    return this.read(() => {
      const n = byId(this.db.notices, noticeId);
      if (!n) throw new RepoError('not_found');
      const { type, id, state } = n.entity;
      let current: string | undefined;
      let latest = n.path;
      if (type === 'request') { const r = byId(this.db.requests, id); const ap = this.db.approvals.find((a) => a.requestId === id); current = r && stateOfRequest(r, ap); latest = `/requests/${id}`; }
      else if (type === 'booking') { const b = byId(this.db.bookings, id); current = b && `${b.status}:${b.workStatus}`; latest = `/bookings/${id}`; }
      else if (type === 'delay') { const d = byId(this.db.delays, id); current = d?.status; latest = d ? `/bookings/${d.bookingId}` : latest; }
      else if (type === 'proposal') { const p = byId(this.db.proposals, id); current = p?.status; latest = p ? `/bookings/${p.bookingId}` : latest; }
      else if (type === 'material') { const m = byId(this.db.materials, id); current = m?.paymentStatus; latest = m ? `/bookings/${m.bookingId}` : latest; }
      else if (type === 'additional') { const w = byId(this.db.additionalWorks, id); current = w?.status; latest = w ? `/bookings/${w.bookingId}` : latest; }
      else if (type === 'statement') { const s = this.db.statements.find((x) => x.bookingId === id); current = s?.status; latest = `/bookings/${id}`; }
      if (current === state) return { path: n.path };
      return { path: latest, staleMessage: '현재 상태가 변경되었습니다. 최신 내역을 확인해 주세요.' };
    });
  }
}
