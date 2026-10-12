/** 에러 정책서의 안내 문구(초안)를 코드로 매핑한다. 구현 용어·PG 코드는 사용자에게 노출하지 않는다. */
export type RepoErrorCode =
  | 'network' | 'save_unknown' | 'not_found' | 'address_unavailable' | 'address_not_eligible'
  | 'request_ended' | 'group_closed' | 'payment_expired' | 'recheck_required' | 'version_changed'
  | 'payment_in_progress' | 'no_amount_due' | 'stale_cancel' | 'already_cancelled' | 'change_stale'
  | 'not_reviewable' | 'invalid'
  // 인증(Supabase Auth). 인증 오류(자격·정책)와 네트워크 오류를 구분한다.
  | 'auth_not_configured' | 'auth_invalid_credentials' | 'auth_email_not_confirmed' | 'auth_network' | 'auth_rate_limited'
  | 'auth_weak_password' | 'auth_signup_exists' | 'auth_signup_disabled' | 'auth_invalid_email' | 'auth_recovery_invalid' | 'auth_failed';

export class RepoError extends Error {
  readonly code: RepoErrorCode;
  constructor(code: RepoErrorCode, detail?: string) {
    super(detail ?? code);
    this.code = code;
    this.name = 'RepoError';
  }
}

const MESSAGES: Record<RepoErrorCode, { title: string; hint?: string }> = {
  network: { title: '정보를 불러오지 못했습니다. 다시 확인해 주세요.', hint: '예약·결제 내역은 그대로 보관되어 있어요.' },
  save_unknown: { title: '처리 결과를 확인하고 있습니다.', hint: '같은 요청을 다시 보내기 전에 내역에서 결과를 확인해 주세요.' },
  not_found: { title: '이 내역을 확인할 수 없습니다. 내 요청 또는 예약에서 확인해 주세요.' },
  address_unavailable: { title: '현재 공동 예약 참여 가능 여부를 확인하기 어렵습니다.', hint: '다시 확인하기 전에는 참여 가능 여부를 안내하지 않아요.' },
  address_not_eligible: { title: '입력한 주소로는 이 공동 예약에 참여할 수 없습니다.', hint: '주소를 확인하거나 새 날짜로 요청해 주세요.' },
  request_ended: { title: '이 요청은 종료되었습니다. 종료 사유를 확인해 주세요.' },
  group_closed: { title: '이 공동 예약은 추가 접수가 종료되었습니다.', hint: '새 날짜로 요청할 수 있어요.' },
  payment_expired: { title: '결제 기한이 지나 예약이 확정되지 않았습니다.', hint: '취소수수료는 없어요. 새 요청을 보낼 수 있어요.' },
  recheck_required: { title: '기존 공동 예약이 종료되었습니다. 새 예약 조건을 확인해 주세요.' },
  version_changed: { title: '확인할 금액이 변경되었습니다. 최신 내용을 확인해 주세요.' },
  payment_in_progress: { title: '결제 결과를 확인 중입니다. 다시 결제하지 말고 내역을 확인해 주세요.' },
  no_amount_due: { title: '추가로 결제할 금액이 없습니다.' },
  stale_cancel: { title: '취소 금액을 다시 확인해 주세요.', hint: '조건이 바뀌어 환불 금액이 달라졌어요.' },
  already_cancelled: { title: '접수된 취소·환불 내역을 확인해 주세요.' },
  change_stale: { title: '최신 변경 조건을 확인해 주세요.' },
  not_reviewable: { title: '정산이 완료된 실제 이용 건에서 리뷰를 작성할 수 있습니다.' },
  invalid: { title: '입력한 내용을 확인해 주세요.' },
  // 인증 — 비밀번호나 서버 원문 메시지는 넣지 않는다.
  auth_not_configured: { title: '로그인 서버 연결이 설정되지 않았어요.', hint: '설정 전에는 로그인·회원가입을 할 수 없어요. 관리자는 README의 Supabase 설정을 확인해 주세요.' },
  auth_invalid_credentials: { title: '이메일 또는 비밀번호를 확인해주세요.' },
  auth_email_not_confirmed: { title: '이메일 확인이 필요해요.', hint: '가입할 때 받은 메일의 링크를 눌러 확인한 뒤 로그인해 주세요.' },
  auth_network: { title: '네트워크에 연결할 수 없어요.', hint: '연결 상태를 확인한 뒤 다시 시도해 주세요. 입력한 내용은 그대로 있어요.' },
  auth_rate_limited: { title: '요청이 많아 잠시 처리할 수 없어요.', hint: '잠시 후 다시 시도해 주세요.' },
  auth_weak_password: { title: '사용할 수 없는 비밀번호예요.', hint: '더 길게 하거나 다른 비밀번호를 입력해 주세요.' },
  auth_signup_exists: { title: '이 이메일로는 가입할 수 없어요.', hint: '이미 가입했다면 로그인하거나 비밀번호를 재설정해 주세요.' },
  auth_signup_disabled: { title: '지금은 회원가입을 받을 수 없어요.' },
  auth_invalid_email: { title: '이메일 주소를 확인해 주세요.' },
  auth_recovery_invalid: { title: '비밀번호 재설정 링크가 만료됐거나 올바르지 않아요.', hint: '재설정을 다시 요청해 주세요.' },
  auth_failed: { title: '지금은 처리하지 못했어요.', hint: '잠시 후 다시 시도해 주세요.' },
};

export function describeError(e: unknown): { title: string; hint?: string; code: RepoErrorCode } {
  if (e instanceof RepoError) return { ...MESSAGES[e.code], code: e.code };
  return { ...MESSAGES.network, code: 'network' };
}
