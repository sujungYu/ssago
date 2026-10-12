/**
 * 고객 이름·연락처 규칙(내 정보 수정·수리 요청서 공통). 연락처 인증이 아니며, 데모에서는 가상 정보를 써도 된다.
 * - 이름: 앞뒤 공백 제거 후 1~20자. 글자 종류(한글·영문 등)는 제한하지 않는다.
 * - 연락처: 숫자·하이픈·공백 입력을 허용하고, 검증·저장은 숫자만 기준으로 한다. 데모 기준 010으로 시작하는 휴대전화 11자리.
 *   저장값은 숫자만(예: 01012345678), 입력란에는 하이픈 형식으로 보여 주고, 요약 표시는 가운데 4자리를 가린다.
 */
import type { CustomerContact } from './types';

export const NAME_MAX = 20;
export const PHONE_HINT = '010으로 시작하는 휴대전화 번호 11자리예요. 하이픈(-)은 넣어도, 빼도 돼요.';

export const phoneDigits = (s: string): string => s.replace(/\D/g, '');

export function nameError(name: string): string | null {
  const v = name.trim();
  if (!v) return '이름을 입력해 주세요. 공백만으로는 저장할 수 없어요.';
  if (v.length > NAME_MAX) return `이름은 ${NAME_MAX}자 이내로 입력해 주세요.`;
  return null;
}

export function phoneError(phone: string): string | null {
  if (!phone.trim()) return '연락처를 입력해 주세요.';
  if (/[^\d\s-]/.test(phone)) return '숫자와 하이픈(-)만 입력해 주세요.';
  const d = phoneDigits(phone);
  if (!d.startsWith('010')) return '010으로 시작하는 휴대전화 번호를 입력해 주세요.';
  if (d.length !== 11) return `휴대전화 번호 11자리를 입력해 주세요. 지금 ${d.length}자리예요.`;
  return null;
}

/** 저장용 값으로 정리한다(이름 앞뒤 공백 제거, 연락처 숫자만). 유효하지 않으면 null */
export function normalizeContact(input: { name: string; phone: string }): CustomerContact | null {
  if (nameError(input.name) || phoneError(input.phone)) return null;
  return { name: input.name.trim(), phone: phoneDigits(input.phone) };
}

/** 01012345678 → 010-1234-5678 (11자리가 아니면 그대로) */
export function formatPhone(digits: string): string {
  const d = phoneDigits(digits);
  return d.length === 11 ? `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}` : digits;
}

/** 요약 표시용 마스킹(기존 방식 유지): 010-****-5678 */
export function maskPhone(digits: string): string {
  const d = phoneDigits(digits);
  return d.length === 11 ? `${d.slice(0, 3)}-****-${d.slice(7)}` : '연락처 확인 필요';
}
