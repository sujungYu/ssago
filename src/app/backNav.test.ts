import { describe, expect, it } from 'vitest';
import { backSteps, recordNav, safeInternalPath, type Trail } from './backNav';

describe('복귀 경로 검증', () => {
  it('앱 내부 경로만 허용한다', () => {
    expect(safeInternalPath('/providers/p1')).toBe('/providers/p1');
    expect(safeInternalPath('/providers?category=c2')).toBe('/providers?category=c2');
  });
  it('외부 URL·프로토콜 상대 주소·역슬래시·줄바꿈·문자열이 아닌 값은 거부한다', () => {
    for (const bad of ['https://evil.example', '//evil.example/x', String.raw`/\evil.example`, 'providers/p1', 'javascript:alert(1)', '/a\nb', '', null, undefined, 42, { p: '/' }]) {
      expect(safeInternalPath(bad)).toBeNull();
    }
  });
});

describe('앱 안 이동 기록과 상단 뒤로가기', () => {
  const walk = (steps: [action: 'PUSH' | 'REPLACE' | 'POP', key: string, path: string][]) => {
    let t: Trail = {};
    let last: string | null = null;
    for (const [a, k, p] of steps) { t = recordNav(t, a, k, p, last); last = k; }
    return t;
  };

  it('목록 → 상세: 상세에서 한 칸 뒤로(목록 조건 그대로)', () => {
    const t = walk([['POP', 'default', '/bookings?tab=past&status=cancelled'], ['PUSH', 'a', '/bookings/bk-1']]);
    expect(backSteps(t, 'a', 1)).toBe(1);
  });
  it('결제 내역 → 예약 상세: 예약 목록이 아니라 결제 내역으로', () => {
    const t = walk([['POP', 'default', '/me'], ['PUSH', 'l', '/ledger/lg-1'], ['PUSH', 'b', '/bookings/bk-1']]);
    expect(t[t.b.prev!].path).toBe('/ledger/lg-1');
    expect(backSteps(t, 'b', 2)).toBe(1);
  });
  it('상세 → 하위 화면 → 제출 후 상세로 교체: 같은 상세는 건너뛰고 그 앞 화면으로', () => {
    const t = walk([['POP', 'default', '/bookings?tab=active'], ['PUSH', 'a', '/bookings/bk-1'], ['PUSH', 'c', '/bookings/bk-1/change'], ['REPLACE', 'd', '/bookings/bk-1#schedule-change']]);
    expect(backSteps(t, 'd', 2)).toBe(2);
  });
  it('직접 진입(앞 항목 없음)이면 null → 대체 경로', () => {
    const t = walk([['POP', 'default', '/bookings/bk-1']]);
    expect(backSteps(t, 'default', 0)).toBeNull();
  });
  it('실제 기록보다 많이 뒤로 가지 않는다', () => {
    const t = walk([['POP', 'default', '/'], ['PUSH', 'a', '/bookings/bk-1']]);
    expect(backSteps(t, 'a', 0)).toBeNull();
  });
  it('새로고침(첫 항목이 이미 아는 key)이면 앞 항목을 유지', () => {
    const t0 = walk([['POP', 'default', '/'], ['PUSH', 'a', '/providers?category=c2']]);
    const t = recordNav(t0, 'POP', 'a', '/providers?category=c2', null);
    expect(t.a.prev).toBe('default');
  });
});
