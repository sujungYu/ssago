import type { Won } from './types';

/** 정수 원화 표시. 예: 12,500원 */
export function formatWon(amount: Won): string {
  return `${Math.trunc(amount).toLocaleString('ko-KR')}원`;
}

export function formatSignedWon(amount: Won): string {
  if (amount === 0) return '0원';
  return `${amount > 0 ? '+' : '−'}${formatWon(Math.abs(amount))}`;
}

export function assertWon(amount: number): Won {
  if (!Number.isInteger(amount)) throw new Error('금액은 정수 원화여야 합니다.');
  return amount;
}
