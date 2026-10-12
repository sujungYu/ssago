/**
 * 제출 오류가 있을 때 화면 순서상 첫 오류 항목으로 한 번만 이동한다(폼 공통).
 * - 대상은 data-err-target="<키>"로 표시한 실제 입력·조작 요소. 오류 문구가 렌더링된 뒤(effect) 호출한다.
 * - 화면에 보이지 않거나 비활성인 요소는 건너뛴다. 접힌 <details> 안이면 먼저 펼친다.
 * - 실제 스크롤 컨테이너(가장 가까운 스크롤 조상, 없으면 문서)를 기준으로, 상단 고정 헤더와 하단 고정 버튼 영역에 가리지 않게
 *   필요한 만큼만 한 번 스크롤하고, 포커스는 preventScroll로 옮겨 추가 스크롤·튐을 막는다.
 * - 모바일 키보드로 줄어든 화면은 visualViewport로 계산한다. prefers-reduced-motion이면 애니메이션 없이 이동한다.
 */
const GAP = 12;

export const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && p.scrollHeight > p.clientHeight) return p;
  }
  return null;
}

const isShown = (el: HTMLElement): boolean => {
  if ((el as HTMLInputElement).disabled) return false;
  const cs = getComputedStyle(el);
  if (cs.visibility === 'hidden' || cs.display === 'none') return false;
  // 접힌 details 안이면 펼칠 수 있으므로 보이는 것으로 본다
  return el.getClientRects().length > 0 || !!el.closest('details:not([open])');
};

/** 대상 요소를 가리지 않게 보이도록 스크롤하고 포커스한다 */
export function revealAndFocus(target: HTMLElement): void {
  for (let d = target.closest('details'); d; d = d.parentElement?.closest('details') ?? null) d.open = true;
  // 라벨·오류 문구까지 함께 보이도록 감싸는 영역 기준(없으면 대상 자체)
  const region = (target.closest('[data-err-region]') ?? target.closest('.field') ?? target) as HTMLElement;
  const container = scrollParent(target);
  const vv = window.visualViewport;
  const view = container ? container.getBoundingClientRect()
    : { top: vv ? vv.offsetTop : 0, bottom: vv ? vv.offsetTop + vv.height : window.innerHeight };
  const header = document.querySelector<HTMLElement>('.app-header')?.getBoundingClientRect();
  const bar = document.querySelector<HTMLElement>('.action-bar')?.getBoundingClientRect();
  const top = Math.max(view.top, header && header.bottom > view.top ? header.bottom : view.top) + GAP;
  const bottom = Math.min(view.bottom, bar && bar.top < view.bottom && bar.bottom > view.top ? bar.top : view.bottom) - GAP;
  const r = region.getBoundingClientRect();
  let delta = 0;
  if (r.top < top) delta = r.top - top;
  else if (r.bottom > bottom) delta = Math.min(r.bottom - bottom, r.top - top); // 영역이 화면보다 커도 위쪽(라벨)은 헤더 아래에 둔다
  if (delta) (container ?? window).scrollBy({ top: delta, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  target.focus({ preventScroll: true });
}

/** 오류 키 순서(화면 순서)대로 처음 보이는 대상에 이동. 이동했으면 true */
export function focusFirstError(root: ParentNode, orderedKeys: string[]): boolean {
  for (const key of orderedKeys) {
    const el = root.querySelector<HTMLElement>(`[data-err-target="${CSS.escape(key)}"]`);
    if (el && isShown(el)) { revealAndFocus(el); return true; }
  }
  return false;
}
