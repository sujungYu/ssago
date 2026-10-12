/**
 * 업체 찾기 카테고리 대표 이미지(카테고리 ID → 개별 파일). 파일은 public/categories/ 에 있고, 교체할 때는 같은 이름으로 덮어쓰거나 여기 경로만 바꾼다.
 * 공통 제작 기준: 160×120 SVG, 같은 시점(정면 + 오른쪽 위로 깊이 6·4)·왼쪽 위 조명·바닥 그림자 위치, 블루·아이보리 팔레트, 글자·로고·배지 없음.
 * 대표 이미지는 카테고리의 일부 작업을 보여줄 뿐이라 카테고리명을 항상 함께 표시한다.
 */
export const CATEGORY_ART: Record<string, string> = {
  c1: '/categories/c1-window-screen.svg', // 방충망 프레임(망)
  c2: '/categories/c2-faucet.svg', // 수전과 물방울
  c3: '/categories/c3-door-handle.svg', // 문 일부와 레버형 손잡이
  c4: '/categories/c4-drawer-cabinet.svg', // 살짝 열린 서랍장
  c5: '/categories/c5-window-glass.svg', // 유리 창문과 창틀(방충망과 구분)
  c6: '/categories/c6-bulb-socket.svg', // 전구와 소켓
  c7: '/categories/c7-curtain-rod.svg', // 커튼과 커튼봉
  c8: '/categories/c8-towel-holder.svg', // 벽면 수건걸이
  c9: '/categories/c9-tile-sealant.svg', // 타일과 실리콘 건
  c10: '/categories/c10-toolbox-wrench.svg', // 공구 가방과 렌치
};
/** 원본 크기(비율 유지·레이아웃 흔들림 방지용 width/height) */
export const CATEGORY_ART_SIZE = { width: 160, height: 120 } as const;
