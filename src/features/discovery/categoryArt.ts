/**
 * 업체 찾기 카테고리 카드의 아이콘·표시 제목(카테고리 ID 기준). 데이터의 카테고리 ID·이름·분류 범위·라우팅은 바꾸지 않는다.
 * 아이콘: public/categories/flat/ 의 개별 SVG(96×96). 공통 제작 기준 — 단순한 도형을 채운 플랫 컬러, 그라데이션·그림자·3D 없음,
 * 블루·민트·옐로·코랄·그린·회색 팔레트에서 아이콘마다 주요 색 2~3개, 같은 크기·여백(약 6~90 영역)·둥근 모서리. 글자 없음.
 * 아이콘은 장식이라 화면에서 alt를 비우고, 카테고리를 설명하는 것은 항상 아래 표시 제목 텍스트다.
 */
export const CATEGORY_ART: Record<string, string> = {
  c1: '/categories/flat/c1-screen.svg', // 망과 프레임
  c2: '/categories/flat/c2-faucet.svg', // 수도꼭지와 물방울
  c3: '/categories/flat/c3-handle-hinge.svg', // 레버 손잡이와 경첩
  c4: '/categories/flat/c4-drawer.svg', // 서랍과 손잡이
  c5: '/categories/flat/c5-window-seal.svg', // 창문 프레임과 틈새 부품(실링 띠)
  c6: '/categories/flat/c6-bulb-switch.svg', // 전구와 스위치
  c7: '/categories/flat/c7-curtain.svg', // 커튼과 봉
  c8: '/categories/flat/c8-towel.svg', // 수건걸이와 수건
  c9: '/categories/flat/c9-caulk-tile.svg', // 실리콘 건과 타일
  c10: '/categories/flat/c10-toolbox.svg', // 공구함과 렌치
};
/** 원본 크기(비율 유지·레이아웃 흔들림 방지용 width/height) */
export const CATEGORY_ART_SIZE = { width: 96, height: 96 } as const;

/**
 * 카드 표시 제목(업체 찾기 화면 전용 짧은 이름). 표시만 줄였을 뿐 분류 범위·업체 연결은 데이터의 카테고리 그대로다.
 * 예: ‘수전·배수’ = 샤워기 포함(c2), ‘문 수리’ = 문손잡이·경첩·문(c3), ‘조명·전기’ = 스위치·콘센트 포함(c6), ‘커튼·선반’ = 블라인드 포함(c7).
 * 업체 목록·상세의 제목과 세부 설명은 데이터 이름을 쓴다. 없으면 데이터 이름을 쓴다.
 */
export const CATEGORY_TITLE: Record<string, string> = {
  c1: '방충망',
  c2: '수전·배수',
  c3: '문손잡이·경첩',
  c4: '수납장·서랍',
  c5: '창문 보수',
  c6: '조명·스위치',
  c7: '커튼·선반',
  c8: '생활 부속품',
  c9: '실리콘·줄눈',
  c10: '기타 수리',
};
