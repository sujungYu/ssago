/** 목업 저장소의 내부 상태. 화면은 이 파일을 직접 import하지 않는다. */
import type {
  Address, AdditionalWork, Approval, Booking, Category, ChangeProposal, CustomerProfile, DelayNotice, Deduction,
  FinalStatement, GroupRecord, MaterialOffer, MockNotice, ProviderReview, Refund, RepairRequest, Review, Transaction,
} from '../../domain/types';

export interface AddressRecord extends Address {
  /** 참여 자격 판단용 비공개 키(단지 ID 또는 기준 장소 키). 화면으로 내보내지 않는다. */
  anchors: string[];
}

export interface ProviderRecord {
  id: string;
  name: string;
  categoryIds: string[];
  scope: string[];
  rating: number;
  reviewCount: number;
  soloTripFee: number;
  area: string;
  intro: string;
  phone: string;
  afterServiceTerms: string[];
  reviews: ProviderReview[];
}

export type PayOutcome = 'success' | 'fail' | 'processing' | 'unknown';
export type ResolveOutcome = 'success' | 'fail' | 'unknown';

export interface MockSettings {
  latencyMs: number;
  /** 다음 조회 1회를 실패시킨다 */
  failNextQuery: boolean;
  /** 주소·단지 판단 서비스 장애 재현 — 공동 예약 가능 여부를 단정하지 않는다 */
  addressServiceDown: boolean;
  payOutcome: PayOutcome;
  resolveOutcome: ResolveOutcome;
}

export interface MockDb {
  version: number;
  now: string;
  seq: number;
  /** 이 목업 상태를 쓰는 로그인 계정(Supabase user id). 계정이 바뀌거나 로그아웃하면 새 데모 상태로 초기화한다. */
  ownerAccountId: string | null;
  customer: CustomerProfile;
  addressBook: AddressRecord[];
  categories: Category[];
  providers: ProviderRecord[];
  groups: GroupRecord[];
  requests: RepairRequest[];
  approvals: Approval[];
  bookings: Booking[];
  transactions: Transaction[];
  refunds: Refund[];
  deductions: Deduction[];
  proposals: ChangeProposal[];
  delays: DelayNotice[];
  materials: MaterialOffer[];
  additionalWorks: AdditionalWork[];
  statements: FinalStatement[];
  reviews: Review[];
  notices: MockNotice[];
  /** 멱등성 키 → 결과 식별자 */
  keyed: Record<string, string>;
  settings: MockSettings;
}

export const DEFAULT_SETTINGS: MockSettings = {
  latencyMs: 200,
  failNextQuery: false,
  addressServiceDown: false,
  payOutcome: 'success',
  resolveOutcome: 'success',
};
