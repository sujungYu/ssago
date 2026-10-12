import { describe, expect, it } from 'vitest';
import { SYMBOL } from './marks';
import favicon from '../../../public/favicon.svg?raw';
import appIcon from '../../../public/brand/app-icon.svg?raw';
import symbol from '../../../public/brand/symbol.svg?raw';
import symbolSmall from '../../../public/brand/symbol-small.svg?raw';

// public/ 의 정적 SVG 자산이 컴포넌트 심볼과 같은 형태를 쓰는지 확인한다.
describe('브랜드 자산', () => {
  it.each([
    ['favicon.svg', favicon, 'simple'],
    ['brand/symbol-small.svg', symbolSmall, 'simple'],
    ['brand/symbol.svg', symbol, 'full'],
    ['brand/app-icon.svg', appIcon, 'full'],
  ] as const)('%s는 같은 심볼 경로를 쓴다', (_file, svg, variant) => {
    expect(svg).toMatch(/viewBox="0 0 \d+ \d+"/);
    expect(svg).toContain(`stroke-width="${SYMBOL[variant].stroke}"`);
    for (const d of SYMBOL[variant].paths) expect(svg).toContain(`d="${d}"`);
    expect(svg.includes('<rect x="13.5"')).toBe(SYMBOL[variant].windows.length > 0);
  });

  it('파비콘·앱 아이콘에는 글자가 없다', () => {
    for (const svg of [favicon, appIcon]) expect(svg).not.toMatch(/<text/);
  });
});
