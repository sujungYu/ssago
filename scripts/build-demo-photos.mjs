/**
 * 가상 업체 소개·작업 사례용 데모 사진을 웹용으로 변환한다(AI로 생성한 사진 — 실제 업체·실제 실적 아님).
 *   node scripts/build-demo-photos.mjs <원본 폴더>
 * 원본 폴더 구조: work/<장면>-before.jpg, work/<장면>-after.jpg, intro/<c1~c10>.jpg (가로 4:3)
 * 결과: public/demo/work|intro/<이름>.webp(확대 보기용, 1440×1080) 와 <이름>-thumb.webp(카드용, 640×480)
 * 변환은 로컬 Chrome의 캔버스로 한다(별도 이미지 라이브러리 없음). Chrome 경로는 CHROME_PATH로 바꿀 수 있다.
 */
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = process.argv[2];
if (!SRC || !existsSync(join(SRC, 'work')) || !existsSync(join(SRC, 'intro'))) {
  console.error('원본 폴더(work/, intro/ 포함)를 인자로 주세요.');
  process.exit(1);
}
const OUT = join(ROOT, 'public/demo');
const FULL = { w: 1440, h: 1080, q: 0.8 };
const THUMB = { w: 640, h: 480, q: 0.76 };
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

rmSync(OUT, { recursive: true, force: true });
const browser = await chromium.launch({ executablePath: CHROME });
const page = await browser.newPage();
let count = 0, bytes = 0;
for (const dir of ['work', 'intro']) {
  mkdirSync(join(OUT, dir), { recursive: true });
  for (const f of readdirSync(join(SRC, dir)).filter((x) => /\.jpe?g$/i.test(x)).sort()) {
    const name = f.replace(/\.jpe?g$/i, '');
    const b64 = readFileSync(join(SRC, dir, f)).toString('base64');
    // 4:3로 가운데를 맞춰 그린다(원본이 4:3이면 잘리지 않는다)
    const out = await page.evaluate(async ({ b64, sizes }) => {
      const bmp = await createImageBitmap(await (await fetch(`data:image/jpeg;base64,${b64}`)).blob());
      const res = [];
      for (const s of sizes) {
        const c = new OffscreenCanvas(s.w, s.h);
        const k = Math.max(s.w / bmp.width, s.h / bmp.height);
        const ctx = c.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(bmp, (s.w - bmp.width * k) / 2, (s.h - bmp.height * k) / 2, bmp.width * k, bmp.height * k);
        const buf = new Uint8Array(await (await c.convertToBlob({ type: 'image/webp', quality: s.q })).arrayBuffer());
        let bin = ''; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
        res.push(btoa(bin));
      }
      bmp.close();
      return res;
    }, { b64, sizes: [FULL, THUMB] });
    for (const [i, suffix] of [[0, ''], [1, '-thumb']]) {
      const buf = Buffer.from(out[i], 'base64');
      writeFileSync(join(OUT, dir, `${name}${suffix}.webp`), buf);
      count += 1; bytes += buf.length;
    }
  }
}
await browser.close();
console.log(`데모 사진 ${count}개 (${(bytes / 1024 / 1024).toFixed(1)}MB) → public/demo`);
