import { useEffect, useRef, useState } from 'react';
import { Banner, Button, Dialog, LoadingBlock } from '../../components/ui';
import { postcodeToInput, type PostcodeAddressInput } from '../../domain/address';
import { loadPostcode, type PostcodeCtor } from './postcode';

/**
 * 실제 주소 검색 레이어(카카오 우편번호 서비스 embed). 업체 찾기 주소 설정(useExploreAddressPicker)과 요청서의 방문 건물 변경에서 함께 쓴다.
 * 도로명·지번·건물명으로 검색해 결과를 고르면 onSelect, 닫기 버튼·바깥 누르기(포커스가 앱 쪽이면 Escape도)는 onClose(선택 주소는 그대로).
 * 화면 안 레이어(모바일 하단 시트·데스크톱 모달, 배경 스크롤 잠금)에 넣어 팝업 창을 쓰지 않는다. 동·호수는 받지 않는다.
 * 열리면 검색 영역으로 포커스를 옮기고(데스크톱은 검색창), 닫히면 Dialog가 연 버튼으로 돌려준다.
 * 불러오기 실패·시간 초과면 다시 시도 안내만 보여주고 가상 검색 결과로 대체하지 않는다.
 */
export function PostcodeDialog({ title, note, error, onSelect, onClose }: {
  title: string; note?: string; /** 고른 주소를 저장하지 못했을 때 안내(레이어는 열린 채로 다시 고를 수 있다) */ error?: { title: string; hint?: string } | null;
  onSelect: (a: PostcodeAddressInput) => void; onClose: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [attempt, setAttempt] = useState(0);
  const pick = useRef(onSelect);
  pick.current = onSelect;
  const ctorRef = useRef<PostcodeCtor | null>(null);

  useEffect(() => {
    let alive = true;
    setState('loading');
    loadPostcode().then((C) => { if (alive) { ctorRef.current = C; setState('ready'); } }, () => { if (alive) setState('error'); });
    return () => { alive = false; };
  }, [attempt]);

  // 영역이 보인 뒤에 넣는다(검색 화면이 영역 크기에 맞춰 그려진다). 넣은 뒤 검색 영역(프레임)으로 포커스 — 데스크톱은 서비스가 검색창에 포커스한다(focusInput)
  useEffect(() => {
    const el = box.current, Postcode = ctorRef.current;
    if (state !== 'ready' || !el || !Postcode) return;
    el.replaceChildren();
    try {
      new Postcode({
        // submitMode false: 검색할 때 프레임이 기록을 쌓지 않게 한다(쌓이면 뒤로 가기가 보이지 않는 검색 기록부터 되돌림)
        width: '100%', height: '100%', focusInput: true, submitMode: false,
        oncomplete: (d) => { const a = postcodeToInput(d); if (a) pick.current(a); },
      }).embed(el, { autoClose: false });
    } catch { setState('error'); return; }
    let tries = 0;
    const t = window.setInterval(() => {
      const f = el.querySelector('iframe');
      if (f) { window.clearInterval(t); if (!el.contains(document.activeElement)) f.focus(); }
      else if (++tries > 40) window.clearInterval(t);
    }, 50);
    return () => window.clearInterval(t);
  }, [state]);

  return (
    <Dialog title={title} onClose={onClose} closeLabel="닫기" actions={null}>
      {note && <p className="small muted">{note}</p>}
      {error && <Banner tone="danger" title={error.title}>{error.hint}</Banner>}
      {state === 'loading' && <LoadingBlock label="주소 검색을 불러오는 중이에요" />}
      {state === 'error' && (
        <div className="stack">
          <Banner tone="warn" title="주소 검색을 불러오지 못했어요">인터넷 연결을 확인한 뒤 다시 시도해 주세요. 선택한 주소는 바뀌지 않았어요.</Banner>
          <Button variant="primary" block onClick={() => setAttempt((n) => n + 1)}>다시 시도</Button>
        </div>
      )}
      <div ref={box} className="postcode" hidden={state !== 'ready'} />
      {/* 검색 프레임에서 Tab으로 나오면 레이어 밖(배경 화면)으로 가지 않고 닫기 버튼으로 돌아간다 */}
      {state === 'ready' && <span tabIndex={0} className="sr-only" onFocus={(e) => e.currentTarget.closest('[role="dialog"]')?.querySelector<HTMLElement>('button')?.focus()} />}
    </Dialog>
  );
}
