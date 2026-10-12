/*
 * 공동 방문 소개 일러스트(장식). 양쪽의 작은 집 두 채, 가운데 공구 가방을 든 수리 기사,
 * 두 집 아래를 잇는 부드러운 곡선. 파랑·연한 파랑·아이보리·짙은 회색만 쓴다.
 * 업체 사진·작업 사진을 대신하지 않는다. 업체 찾기의 공동 예약 안내에만 둔다.
 */

const BLUE = '#315DA8';
const LIGHT = '#B9CDEE';
const IVORY = '#FFF9EC';
const SKIN = '#F4E3C8';
const GRAY = '#3A404B';

function House({ x, windowLeft }: { x: number; windowLeft: boolean }) {
  // x = 집 가운데
  return (
    <g>
      <rect x={x - 20} y={40} width={40} height={28} rx={3} fill={IVORY} />
      <rect x={x - 5} y={51} width={10} height={17} rx={2} fill={GRAY} />
      <rect x={windowLeft ? x - 16 : x + 9} y={46} width={7} height={7} rx={1.5} fill={LIGHT} />
      <path d={`M${x - 26} 43 ${x} 22 ${x + 26} 43`} fill="none" stroke={BLUE} strokeWidth={6} strokeLinecap="round" strokeLinejoin="round" />
    </g>
  );
}

export function CoopVisitIllustration({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 280 86" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">
      {/* 두 집을 잇는 방문 경로 */}
      <path d="M48 71C100 87 180 87 232 71" fill="none" stroke={LIGHT} strokeWidth={5} strokeLinecap="round" />
      <House x={48} windowLeft />
      <House x={232} windowLeft={false} />

      {/* 수리 기사: 오른쪽으로 걷는 모습 */}
      <g strokeLinecap="round" strokeLinejoin="round" fill="none">
        <path d="M137 60 131 78M143 60 150 77" stroke={GRAY} strokeWidth={5} />
        <path d="M132 42 125 55" stroke={BLUE} strokeWidth={5} />
      </g>
      <rect x={129} y={35} width={22} height={28} rx={8} fill={BLUE} />
      <circle cx={140} cy={25} r={8} fill={SKIN} />
      <path d="M132 24a8 8 0 0 1 16 0z" fill={GRAY} />
      <path d="M147 24h5" stroke={GRAY} strokeWidth={2.5} strokeLinecap="round" />
      <path d="M148 42 155 54" stroke={BLUE} strokeWidth={5} strokeLinecap="round" fill="none" />
      {/* 공구 가방 */}
      <path d="M155 54v-3.5h10V54" stroke={GRAY} strokeWidth={2.5} strokeLinejoin="round" fill="none" />
      <rect x={150} y={54} width={20} height={14} rx={2.5} fill={GRAY} />
      <rect x={150} y={59} width={20} height={2} fill={LIGHT} />
    </svg>
  );
}
