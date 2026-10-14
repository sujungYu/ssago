/// <reference types="node" />
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MockRepository } from './mockRepository';
import { DEMO_ATTACHMENT_PHOTOS } from './attachmentPhotos';

const repo = () => new MockRepository({ latencyMs: 0 });
const PUBLIC = join(process.cwd(), 'public');

describe('요청 첨부 사진 미리보기(attachmentImages)', () => {
  it('연결된 데모 이미지 파일이 실제로 있고 WebP다(썸네일·확대용)', () => {
    for (const [name, img] of Object.entries(DEMO_ATTACHMENT_PHOTOS)) {
      for (const p of [img.src, img.fullSrc!]) {
        expect(p, name).toMatch(/^\/demo\/attachments\/.+\.webp$/);
        expect(existsSync(join(PUBLIC, p)), p).toBe(true);
        expect(statSync(join(PUBLIC, p)).size, p).toBeLessThan(300 * 1024);
      }
      expect(img.alt.trim().length, name).toBeGreaterThan(0);
    }
  });

  it('faucet.jpg 첨부가 있는 요청은 그 이미지를 돌려준다', async () => {
    const d = await repo().getRequest('rq-3');
    expect(d.request.tasks.flatMap((t) => t.photoNames)).toContain('faucet.jpg');
    expect(d.attachmentImages['faucet.jpg']).toEqual(DEMO_ATTACHMENT_PHOTOS['faucet.jpg']);
  });

  it('이미지가 연결되지 않은 첨부는 돌려주지 않는다 — 화면은 파일명 표시', async () => {
    const r = repo();
    r.__db().requests.find((q) => q.id === 'rq-3')!.tasks[0].photoNames = ['faucet.jpg', 'no-image.jpg'];
    expect(Object.keys((await r.getRequest('rq-3')).attachmentImages)).toEqual(['faucet.jpg']);
  });
});
