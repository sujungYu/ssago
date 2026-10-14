import type { ShowcaseImage } from '../../domain/types';

/**
 * 요청 첨부 사진의 데모 이미지(첨부 파일명 → 실제 이미지). 목업 요청은 파일명만 보관하므로(TaskItem.photoNames),
 * 여기에 실제 이미지가 연결된 파일명만 요청 상세에서 썸네일로 보여준다(spec 5.35). 없는 파일명은 기존처럼 파일명 표시.
 * 임의의 사진·업체 작업 사례 사진을 대신 연결하지 않는다 — 사용자가 제공한 데모 사진만 public/demo/attachments/에 두고 연결한다.
 *
 * 연결된 첨부(2026-10-14, 사용자 제공 데모 사진): ‘욕실 세면대 수전 교체’의 faucet.jpg(요청 rq-3·rq-4 등, seed.ts T_FAUCET)
 * 이미지: 썸네일 320×240, 확대용 1440×1080 WebP(원본 1448×1086을 4:3 가운데 맞춤)
 */
export const DEMO_ATTACHMENT_PHOTOS: Record<string, ShowcaseImage> = {
  'faucet.jpg': {
    src: '/demo/attachments/faucet-thumb.webp',
    fullSrc: '/demo/attachments/faucet.webp',
    alt: '물방울이 맺히고 토수구 끝에서 물이 떨어지는 욕실 세면대 수전',
    width: 1440,
    height: 1080,
  },
};
