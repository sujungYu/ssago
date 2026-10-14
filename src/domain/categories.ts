/**
 * 없앤 카테고리(ID → 안내용 이름). 카테고리 목록·업체 소속에서는 빠졌고, 예전 주소(`/providers?category=c10`)로 들어오면 안내 후 홈으로 보낸다.
 * 저장된 목업 상태에 남아 있어도 다시 보이지 않게 저장소가 불러올 때 정리한다(spec 5.34).
 */
export const RETIRED_CATEGORIES: Record<string, string> = {
  c10: '기타 수리', // 2026-10-14 제거. 작업은 남은 카테고리로 옮기고, 맞는 곳이 없는 작업(거울·액자 걸기)은 카테고리 연결 없이 업체 작업으로만 둔다
};

export const isRetiredCategory = (id: string): boolean => Object.hasOwn(RETIRED_CATEGORIES, id);

/** 예전 카테고리 주소로 들어왔을 때 홈에서 보여주는 안내 */
export const retiredCategoryNotice = (id: string): string =>
  `‘${RETIRED_CATEGORIES[id]}’ 카테고리는 더 이상 제공하지 않아요. 아래에서 필요한 수리를 골라 주세요.`;
