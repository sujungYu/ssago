import type { Won } from './types';

/** 정수 원화 표시. 예: 12,500원 */
export function formatWon(amount: Won): string {
  return `${Math.trunc(amount).toLocaleString('ko-KR')}원`;
}
