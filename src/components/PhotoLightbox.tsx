import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { ShowcaseImage } from '../domain/types';
import { Icon } from './Icon';

/**
 * 소개·작업 사례 이미지. 원본 비율(width·height)로 자리를 먼저 잡고 화면 밖 이미지는 늦게 불러온다(lazy).
 * 불러오지 못하면 같은 크기의 자리에 안내 문구를 보여줘 레이아웃이 무너지지 않는다(대체 텍스트는 그대로 전달).
 */
export function ShowcaseImg({ image, full, eager }: { image: ShowcaseImage; /** 확대 보기용 원본을 쓴다 */ full?: boolean; eager?: boolean }) {
  const src = full ? (image.fullSrc ?? image.src) : image.src;
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  return (
    <span className="showcase-img" style={{ '--ratio': image.width / image.height } as CSSProperties}>
      {failedSrc === src ? (
        <span className="showcase-img__fallback" role="img" aria-label={image.alt}>이미지를 불러오지 못했어요</span>
      ) : (
        <img src={src} alt={image.alt} width={image.width} height={image.height} loading={eager ? 'eager' : 'lazy'} decoding="async" onError={() => setFailedSrc(src)} />
      )}
    </span>
  );
}

export interface LightboxItem {
  image: ShowcaseImage;
  /** 사진 구분(예: 작업 전 / 작업 후) */
  label: string;
}

/**
 * 사진 확대 보기. 화면 전체를 덮는 대화상자로, 열리면 닫기 버튼에 포커스를 두고 Tab을 안에 가두며 Escape로 닫는다.
 * 사진이 여러 장이면 ←·→ 키와 이전·다음 버튼으로 넘긴다(끝에서 처음으로 이어짐). 열린 동안 배경 스크롤을 잠그고,
 * 닫으면 연 버튼(썸네일)으로 포커스를 돌려준다(스크롤 위치는 그대로). 사진 바깥 어두운 영역을 눌러도 닫힌다.
 */
export function PhotoLightbox({ title, items, index, onIndex, onClose, note }: {
  title: string; items: LightboxItem[]; index: number; onIndex: (i: number) => void; onClose: () => void; /** 사진 아래 안내(예: 데모 이미지 안내) */ note?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const many = items.length > 1;
  const step = (d: number) => { if (many) onIndex((index + d + items.length) % items.length); };
  const stepRef = useRef(step);
  stepRef.current = step;
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const scrollY = window.scrollY;
    const html = document.documentElement;
    const prevOverflow = html.style.overflow;
    html.style.overflow = 'hidden';
    ref.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); closeRef.current(); return; }
      if (e.key === 'ArrowLeft') { e.preventDefault(); stepRef.current(-1); return; }
      if (e.key === 'ArrowRight') { e.preventDefault(); stepRef.current(1); return; }
      if (e.key === 'Tab' && ref.current) {
        const f = Array.from(ref.current.querySelectorAll<HTMLElement>('button:not(:disabled)'));
        if (!f.length) return;
        const a = f[0], z = f[f.length - 1];
        const inside = ref.current.contains(document.activeElement);
        if (!inside || (e.shiftKey && document.activeElement === a)) { e.preventDefault(); (e.shiftKey ? z : a).focus(); }
        else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      html.style.overflow = prevOverflow;
      prev?.focus({ preventScroll: true });
      if (window.scrollY !== scrollY) window.scrollTo(0, scrollY);
    };
  }, []);
  const cur = items[index] ?? items[0];
  return (
    <div className="lightbox" role="dialog" aria-modal="true" aria-label={`${title} 사진 크게 보기`} ref={ref}>
      <div className="lightbox__bar">
        <p className="lightbox__title">{title}</p>
        <button type="button" className="lightbox__btn" aria-label="닫기" data-autofocus onClick={onClose}><Icon name="close" /></button>
      </div>
      {/* 사진 바깥(어두운 영역)을 누르면 닫는다. 기본 동작(포커스를 body로 옮김)을 막아 닫은 뒤 연 버튼으로 포커스가 돌아가게 한다 */}
      <div className="lightbox__stage" onMouseDown={(e) => { if (!(e.target as HTMLElement).closest('.showcase-img')) { e.preventDefault(); onClose(); } }}>
        <ShowcaseImg key={cur.image.src} image={cur.image} full eager />
      </div>
      <div className="lightbox__foot">
        {many && <button type="button" className="lightbox__btn" aria-label="이전 사진" onClick={() => step(-1)}><Icon name="back" /></button>}
        <div className="lightbox__caption" aria-live="polite">
          <p className="strong">{cur.label}{many && <span className="lightbox__count"> {index + 1}/{items.length}</span>}</p>
          <p className="small">{cur.image.alt}</p>
          {note && <p className="xs lightbox__note">{note}</p>}
        </div>
        {many && <button type="button" className="lightbox__btn" aria-label="다음 사진" onClick={() => step(1)}><Icon name="chevron" /></button>}
      </div>
    </div>
  );
}
