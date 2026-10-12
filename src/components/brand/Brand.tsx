import { SIMPLE_BELOW, SYMBOL, SYMBOL_VIEWBOX, WINDOW_SIZE, type SymbolVariant } from './marks';

/**
 * 집 + 렌치 심볼. 색은 currentColor(기본: 주요 파랑).
 * label이 없으면 장식으로 보고 스크린리더에서 숨긴다(옆에 서비스명이 있을 때).
 */
export function BrandSymbol({ size = 32, variant, label }: { size?: number; variant?: SymbolVariant; label?: string }) {
  const mark = SYMBOL[variant ?? (size < SIMPLE_BELOW ? 'simple' : 'full')];
  return (
    <svg
      className="brand-symbol" width={size} height={size} viewBox={SYMBOL_VIEWBOX} preserveAspectRatio="xMidYMid meet"
      fill="none" stroke="currentColor" strokeWidth={mark.stroke} strokeLinecap="round" strokeLinejoin="round"
      role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true} focusable="false"
    >
      {mark.paths.map((d) => <path key={d} d={d} />)}
      {mark.windows.length > 0 && (
        <g fill="currentColor" stroke="none">
          {mark.windows.map((w) => <rect key={`${w.x}-${w.y}`} x={w.x} y={w.y} width={WINDOW_SIZE} height={WINDOW_SIZE} rx={0.6} />)}
        </g>
      )}
    </svg>
  );
}

/**
 * 심볼 + ‘싸고’ 글자 조합(헤더용). 글자는 실제 텍스트(Pretendard)로 둔다.
 * 링크로 감쌀 때는 링크에 aria-label="싸고 홈"을 준다.
 */
export function BrandLogo() {
  return (
    <span className="brand brand--sm">
      <BrandSymbol size={28} />
      <span className="brand__text">
        <span className="brand__name">싸고</span>
      </span>
    </span>
  );
}
