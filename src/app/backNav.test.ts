import { describe, expect, it } from 'vitest';
import { safeInternalPath } from './backNav';

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
