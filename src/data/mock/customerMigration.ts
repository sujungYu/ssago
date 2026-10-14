import type { MockDb } from './db';
import { DEFAULT_CUSTOMER } from './seed';

/** 예전 기본 고객 이름(시드 기본값 그대로일 때만 바꾼다 — 사용자가 직접 바꾼 이름은 건드리지 않음) */
const LEGACY_DEFAULT_NAMES = new Set(['김온다 (가상 고객)', '김온다']);

/**
 * 기본 고객 이름 변경(2026-10-14 ‘김온다 (가상 고객)’ → ‘유수리’, spec 5.52). 저장된 상태에 예전 기본 이름이 남아 있으면 새 이름으로 바꾼다.
 * 내 정보(customer)와 요청·예약에 저장된 연락받을 분 이름만 대상이고, 연락처·다른 요청·예약 정보는 그대로. 바꿨으면 true, 여러 번 불러도 같다.
 */
export function migrateDefaultCustomerName(db: MockDb): boolean {
  let changed = false;
  const fix = (c: { name: string } | undefined) => {
    if (c && typeof c.name === 'string' && LEGACY_DEFAULT_NAMES.has(c.name.trim())) { c.name = DEFAULT_CUSTOMER.name; changed = true; }
  };
  fix(db.customer as { name: string } | undefined);
  for (const r of db.requests) fix(r.contact);
  for (const b of db.bookings) fix(b.contact);
  return changed;
}
