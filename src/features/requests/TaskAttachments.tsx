import { useState } from 'react';
import { Icon } from '../../components/Icon';
import { PhotoLightbox } from '../../components/PhotoLightbox';
import type { ShowcaseImage } from '../../domain/types';

/**
 * 작업 설명 아래 첨부 사진(spec 5.35). 실제 데모 이미지가 있는 첨부는 96×96 둥근 썸네일(파일명은 숨김, 대체 텍스트로 전달),
 * 누르면 원본 비율로 크게 본다(기존 PhotoLightbox — 여러 장이면 넘기기). 이미지가 없는 첨부는 기존 파일명 칩 그대로(깨진 이미지·가짜 미리보기 없음).
 * 첨부가 없으면 아무것도 그리지 않는다. 여러 장은 가로로 나열하고 좁으면 줄바꿈한다.
 */
export function TaskAttachments({ title, names, images }: { title: string; names: string[]; images: Record<string, ShowcaseImage> }) {
  const [open, setOpen] = useState<number | null>(null);
  if (names.length === 0) return null;
  const withImage = names.filter((n) => images[n]);
  const nameOnly = names.filter((n) => !images[n]);
  return (
    <>
      {withImage.length > 0 && (
        <ul className="attach-thumbs" aria-label={`${title} 첨부 사진`}>
          {withImage.map((n, i) => (
            <li key={n}>
              <button type="button" className="attach-thumb" aria-label={`첨부 사진 ${i + 1} 크게 보기`} onClick={() => setOpen(i)}>
                <img src={images[n].src} alt={images[n].alt} width={96} height={96} loading="lazy" decoding="async" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {nameOnly.length > 0 && <div className="chips">{nameOnly.map((n) => <span key={n} className="photo-chip"><Icon name="camera" size={14} />{n}</span>)}</div>}
      {open !== null && (
        <PhotoLightbox title={title} items={withImage.map((n, i) => ({ image: images[n], label: `첨부 사진 ${i + 1}` }))}
          index={open} onIndex={setOpen} onClose={() => setOpen(null)} />
      )}
    </>
  );
}
