/*
 * 싸고 브랜드 심볼의 형태 원본(집 + 렌치). 48×48 격자, 선 끝은 둥글게.
 * public/favicon.svg, public/brand/*.svg 도 같은 경로 값을 쓴다(marks.test.ts가 확인).
 *
 * - full: 창문(작은 사각형 4개) 포함. 32px 이상에서 사용.
 * - simple: 창문 생략, 선을 조금 굵게, 렌치 입구를 조금 넓게. 32px 미만·파비콘에서 사용.
 */

export const SYMBOL_VIEWBOX = '0 0 48 48';
/** 이 크기(px) 미만이면 단순형 심볼을 쓴다 */
export const SIMPLE_BELOW = 32;

export type SymbolVariant = 'full' | 'simple';

type SymbolMark = { stroke: number; paths: string[]; windows: { x: number; y: number }[] };

const ROOF = 'M5 22 24 6 43 22';
const RIGHT_WALL_AND_FLOOR = 'M39 20V41H21';

export const SYMBOL: Record<SymbolVariant, SymbolMark> = {
  full: {
    stroke: 4,
    paths: [
      ROOF,
      RIGHT_WALL_AND_FLOOR,
      // 왼쪽 벽 → 왼쪽 아래 모서리에서 오른쪽 위로 올라가는 렌치 손잡이
      'M9 20V41L25.32 28.76',
      // 렌치 머리: 오른쪽 위가 열린 고리
      'M28.61 21.42A4.6 4.6 0 1 0 33.29 27.66',
    ],
    windows: [
      { x: 13.5, y: 20.5 }, { x: 17.8, y: 20.5 },
      { x: 13.5, y: 24.8 }, { x: 17.8, y: 24.8 },
    ],
  },
  simple: {
    stroke: 4.6,
    paths: [
      ROOF,
      RIGHT_WALL_AND_FLOOR,
      'M9 20V41L24.3 29.23',
      'M27.62 20.77A5.3 5.3 0 1 0 33.33 28.19',
    ],
    windows: [],
  },
};

export const WINDOW_SIZE = 3.2;
