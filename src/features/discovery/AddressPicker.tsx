import { useCallback, useState } from 'react';
import { useAppState, useRepo } from '../../app/context';
import { useAction } from '../../app/hooks';
import type { PostcodeAddressInput } from '../../domain/address';
import { PostcodeDialog } from './PostcodeSearch';

/** 주소 검색을 여는 버튼·링크에 붙이는 표시. 고른 뒤 연 요소가 다시 그려져도(주소 카드 교체 등) 같은 자리로 포커스를 돌려준다 */
export const ADDRESS_OPENER = { 'data-address-opener': '' } as const;

/**
 * 업체 찾기 지역·건물 주소 설정(공통). 홈·업체 목록·업체 상세의 [설정·변경]이 같은 주소 검색 레이어를 그 화면 위에 바로 연다(중간 화면 없음).
 * 결과를 고르면 주소를 등록해 탐색 주소로 저장(기존 공통 상태 setAddressId — 탭 sessionStorage + 사용자별 탐색 주소)하고 레이어를 닫는다.
 * 확인 단계 없음. 닫기·바깥 누르기는 저장하지 않아 기존 주소(미설정이면 미설정)를 유지한다. 저장 실패면 레이어 안에 안내하고 다시 고를 수 있다.
 * 반환: open(연 버튼 onClick에), dialog(화면에 렌더).
 */
export function useExploreAddressPicker() {
  const repo = useRepo();
  const { setAddressId } = useAppState();
  const [isOpen, setOpen] = useState(false);
  const save = useAction();
  const { clearError } = save;
  const open = useCallback(() => { clearError(); setOpen(true); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const select = async (input: PostcodeAddressInput) => {
    const a = await save.run(() => repo.registerAddress(input));
    if (!a) return;
    setAddressId(a.id);
    setOpen(false);
    keepFocusOnOpener();
  };

  const dialog = isOpen ? (
    <PostcodeDialog title="주소 검색" note="도로명·지번·건물명으로 검색해 주세요." error={save.error}
      onSelect={(a) => { void select(a); }} onClose={() => setOpen(false)} />
  ) : null;
  return { open, dialog };
}

/** 닫힌 뒤 잠시 동안 포커스를 잃으면(연 버튼이 새 주소 카드로 바뀌는 등) 화면의 주소 검색 버튼·카드로 옮긴다. 다른 곳에 포커스가 있으면 건드리지 않는다 */
function keepFocusOnOpener() {
  const until = Date.now() + 1500;
  let stopped = false;
  const stop = () => { stopped = true; };
  // 사용자가 직접 누르거나 키를 쓰면 그만둔다(의도한 포커스 이동을 되돌리지 않음)
  document.addEventListener('pointerdown', stop, { once: true, capture: true });
  document.addEventListener('keydown', stop, { once: true, capture: true });
  const tick = () => {
    if (stopped) return;
    const act = document.activeElement;
    if (!act || act === document.body) document.querySelector<HTMLElement>('[data-address-opener]')?.focus();
    if (Date.now() < until) window.setTimeout(tick, 50);
    else { document.removeEventListener('pointerdown', stop, { capture: true }); document.removeEventListener('keydown', stop, { capture: true }); }
  };
  window.setTimeout(tick, 0);
}
