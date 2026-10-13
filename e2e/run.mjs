/**
 * 사용자 화면 e2e 점검. 데모 빌드(화면 없는 개발용 시나리오 훅 `window.__sagoDev` 포함)를 미리보기 서버로 띄워 실제 브라우저로 흐름을 따라간다.
 *   npm run e2e            # 데모 빌드 후 전체 점검
 *   E2E_ONLY=결제 npm run e2e   # 이름에 포함된 점검만 실행
 * 결과는 docs/verification-log.md 에 기록된다.
 */
import { chromium } from 'playwright-core';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4174;
const BASE = `http://localhost:${PORT}`;
const CHROME = process.env.CHROME_PATH || (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const DB_KEY = 'on-gimae/mock-db/v3';
const APP_KEY = 'on-gimae/app-state/v1';

// npx 대신 node로 vite를 직접 실행한다(Windows에서도 셸 없이 실행·종료되도록).
const VITE = join(ROOT, 'node_modules/vite/bin/vite.js');
const vite = (args, opts = {}) => spawnSync(process.execPath, [VITE, ...args], { cwd: ROOT, stdio: 'inherit', ...opts });

// ───────── 빌드·서버 ─────────
if (!process.env.E2E_SKIP_BUILD) {
  if (vite(['build', '--mode', 'demo']).status !== 0) process.exit(1);
}
const server = spawn(process.execPath, [VITE, 'preview', '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'ignore' });
const stopServer = () => { try { server.kill(); } catch { /* ignore */ } };
process.on('exit', stopServer);
for (let i = 0; i < 50; i++) {
  try { if ((await fetch(BASE)).ok) break; } catch { /* wait */ }
  await new Promise((r) => setTimeout(r, 200));
}

const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
// 헤드리스 Chrome은 기본으로 스크롤바를 숨긴다. 스크롤바가 자리를 차지하는 데스크톱(Windows 등) 환경 점검용으로 따로 띄운다.
const browserSB = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'], ignoreDefaultArgs: ['--hide-scrollbars'] });

// ───────── 도우미 ─────────
const results = [];
const skipped = [];
const only = process.env.E2E_ONLY;
/** 데모 범위: 비교 요청(같은 작업을 여러 업체에 요청·비교)을 쓰는지(src/domain/demoScope.ts). 끄면 비교 요청 점검은 건너뛴다 */
const COMPARE = /COMPARE_REQUESTS_ENABLED *= *true/.test(readFileSync(join(ROOT, 'src/domain/demoScope.ts'), 'utf8'));
/** 비교 요청을 켠 데모에서만 실행하는 점검(끄면 건너뜀으로 기록) */
async function testCompare(name, fn, opts) {
  if (COMPARE) return test(name, fn, opts);
  if (only && !name.includes(only)) return;
  skipped.push(name);
  console.log(`  - (비교 요청 제외로 건너뜀) ${name}`);
}
async function test(name, fn, opts = {}) {
  if (only && !name.includes(only)) return;
  const ctx = await (opts.browser ?? browser).newContext({ viewport: { width: opts.width ?? 390, height: opts.height ?? 844 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/ERR_INTERNET_DISCONNECTED|Failed to load resource|Failed to fetch/.test(m.text())) errors.push(`console: ${m.text()}`); });
  page.setDefaultTimeout(6000);
  const t0 = Date.now();
  try {
    await fn(page);
    if (errors.length) throw new Error(`브라우저 오류 ${errors.join(' | ')}`);
    results.push({ name, ok: true, ms: Date.now() - t0 });
    console.log(`  ✓ ${name}`);
  } catch (e) {
    results.push({ name, ok: false, ms: Date.now() - t0, error: String(e.message ?? e).split('\n')[0] });
    console.log(`  ✕ ${name}\n      ${String(e.message ?? e).split('\n').slice(0, 3).join('\n      ')}`);
    try { mkdirSync(join(ROOT, 'e2e/failures'), { recursive: true }); await page.screenshot({ path: join(ROOT, `e2e/failures/${name.replace(/[^\p{L}\p{N}]+/gu, '_')}.png`), fullPage: true }); } catch { /* ignore */ }
  } finally { await ctx.close(); }
}
/** 요청 상세 예약금 결제 버튼(‘예약금 {금액} 결제하기’) */
const PAY_BTN = /^예약금 [0-9,]+원 결제하기$/;
/** 예약 상세 펼치기(Fold) 버튼·열기. 이미 열려 있으면 그대로 둔다 */
function foldBtn(page, title) { return page.locator('.fold__btn').filter({ hasText: title }); }
async function openFold(page, title) {
  const b = foldBtn(page, title);
  await b.waitFor();
  if ((await b.getAttribute('aria-expanded')) !== 'true') await b.click();
  await page.locator('#' + (await b.getAttribute('aria-controls'))).waitFor();
}
/** 섹션(제목 h2) 본문 텍스트 */
async function sectionText(page, title) { return (await page.locator('section').filter({ has: page.getByRole('heading', { name: title, exact: true, level: 2 }) }).first().innerText()).replace(/\s+/g, ' '); }
const eq = (a, b, msg) => { if (a !== b) throw new Error(`${msg}: 기대 ${JSON.stringify(b)} / 실제 ${JSON.stringify(a)}`); };
const truthy = (v, msg) => { if (!v) throw new Error(msg); };

/**
 * 새 세션으로 시작(로그인 없는 데모: 가상 데모 고객). patch(db)로 목업 상태를 미리 바꿀 수 있다.
 * address를 주면 업체 찾기 탐색 주소(이 탭의 화면 상태)로 넣는다. null이면 미설정으로 시작.
 */
async function start(page, { path = '/', address = 'ad-apt', patch, latency = 30 } = {}) {
  await page.goto(`${BASE}/`); // 같은 출처에서 저장소 준비
  await page.evaluate(() => { sessionStorage.clear(); localStorage.clear(); });
  await page.goto(`${BASE}${path}`); // 앱이 시드 DB를 만들고 데모 고객으로 소유 계정을 정한다
  await page.waitForFunction((k) => JSON.parse(sessionStorage.getItem(k) ?? '{}').ownerAccountId === 'demo-customer', DB_KEY);
  await page.evaluate(([appKey, addr]) => { if (addr) sessionStorage.setItem(appKey, JSON.stringify({ addressId: addr })); }, [APP_KEY, address]);
  await page.evaluate(() => new Promise((r) => setTimeout(r, 50)));
  const fns = [new Function('db', `db.settings.latencyMs = ${Number(latency)};`)];
  if (patch) fns.push(...[].concat(patch)); // 함수 하나 또는 배열(각 함수는 브라우저에서 독립 실행되므로 바깥 변수를 참조하지 않는다)
  await patchDb(page, fns, path);
}
async function patchDb(page, fn, path) {
  // 앱은 이미 시드를 sessionStorage에 저장했다. 없으면 먼저 한 번 쓰이도록 새로고침한다.
  let has = await page.evaluate((k) => !!sessionStorage.getItem(k), DB_KEY);
  if (!has) { await page.reload(); await page.waitForTimeout(200); has = await page.evaluate((k) => !!sessionStorage.getItem(k), DB_KEY); }
  const src = [].concat(fn).map((f) => `(${f.toString()})(db);`).join('\n');
  await page.evaluate(([k, code]) => { const db = JSON.parse(sessionStorage.getItem(k)); (new Function('db', code))(db); sessionStorage.setItem(k, JSON.stringify(db)); }, [DB_KEY, src]);
  if (path === null) await page.reload(); else await page.goto(`${BASE}${path ?? '/'}`);
}
/** 화면 없는 개발용 시나리오 훅(window.__sagoDev, 데모 빌드 전용)으로 업체 응답·시간 경과 같은 이벤트를 일으킨다. */
async function dev(page, method, ...args) {
  await page.waitForFunction(() => !!window.__sagoDev);
  return page.evaluate(([m, a]) => Promise.resolve(window.__sagoDev[m](...a)), [method, args]);
}
const db = (page) => page.evaluate((k) => JSON.parse(sessionStorage.getItem(k)), DB_KEY);
const txt = (page, t, o = {}) => page.getByText(t, { exact: false, ...o }).first();
const waitText = (page, t, o) => txt(page, t, o).waitFor();

// ═════════ 점검 ═════════
console.log('\n싸고 사용자 화면 e2e\n');

await test('탐색: 주소 설정 → 카테고리 → 업체 목록(공동 예약 표시) → 업체 상세', async (page) => {
  await start(page, { address: null });
  await page.getByRole('link', { name: '지역·건물 주소 설정하기' }).click();
  await page.getByLabel('주소 검색').fill('햇살');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: /햇살마을 3단지 서울/ }).click();
  await waitText(page, '업체 찾기', { exact: true }).catch(() => {});
  await page.getByRole('link', { name: '수전·배수', exact: true }).click();
  await waitText(page, '한빛설비');
  await waitText(page, '공동 예약 후보');
  await waitText(page, '예상 출장비');
  await page.getByRole('link', { name: /한빛설비/ }).first().click();
  await waitText(page, '방문 날짜 선택');
  await page.locator('.jcal').waitFor();
  await page.getByRole('button', { name: /2026년 10월 19일 월요일, 공동 예약 참여 가능/ }).click();
  await waitText(page, '약 12,500원');
  await waitText(page, '본인 예약 확정 시 4세대 기준');
  eq(await page.getByText('결제 대기 자리를 빼고').count(), 0, '긴 설명 없음');
});

await test('탐색: 주소 미설정이면 공동 예약 가능 여부를 단정하지 않는다', async (page) => {
  await start(page, { address: null, path: '/providers?category=c2' });
  await waitText(page, '지역·건물 주소를 정하면 확인할 수 있어요');
  truthy(!(await page.getByText('공동 예약 후보', { exact: true }).count()), '단정 표시');
});

await test('탐색: 주소 판단 서비스 장애 시 확인 필요 안내', async (page) => {
  await start(page, { path: '/providers?category=c2', patch: (d) => { d.settings.addressServiceDown = true; } });
  await waitText(page, '공동 예약 가능 여부 확인 필요');
  await waitText(page, '다시 확인하기 전에는 참여할 수 있다고 안내하지 않아요');
});

await test('탐색: 업체 없는 카테고리는 빈 상태', async (page) => {
  await start(page, { path: '/providers?category=c5' });
  await waitText(page, '이 작업을 맡는 업체가 아직 없어요');
});

await test('탐색: 조회 실패 → 다시 시도로 복구', async (page) => {
  await start(page, { path: '/bookings?tab=requests', patch: (d) => { d.settings.failNextQuery = true; } });
  await waitText(page, '정보를 불러오지 못했습니다');
  await page.getByRole('button', { name: /다시 시도/ }).click();
  await waitText(page, '보낸 요청');
  await waitText(page, '예약금 결제');
});

await test('로딩 상태 표시', async (page) => {
  await start(page, { path: '/bookings?tab=requests', latency: 1500 });
  await page.waitForSelector('[aria-busy="true"]');
  await waitText(page, '예약금 결제');
});

await test('요청: 공동 날짜로 복수 작업 요청서 제출', async (page) => {
  await start(page, { path: '/providers/p1' });
  await page.getByRole('button', { name: /2026년 10월 19일 월요일, 공동 예약 참여 가능/ }).click();
  await page.locator('.joint-card').first().waitFor(); // 날짜당 그룹 하나 → 자동 선택(라디오 없음)
  await page.getByRole('button', { name: '이 날짜로 수리 요청하기' }).click();
  await page.waitForURL((u) => u.searchParams.get('group') === 'g1');
  await waitText(page, '수리 요청서');
  await waitText(page, '방문 가능한 시간');
  await page.getByRole('button', { name: '요청 보내기' }).click();
  await waitText(page, '필요한 작업을 하나 이상 선택해 주세요.'); // 검증 메시지(작업 선택 영역)
  await pickTask(page, '배수 트랩 교체', '욕실 배수 냄새'); // 고른 순서와 무관하게 업체 작업 목록 순서로 저장
  await pickTask(page, '수전 교체', '주방·욕실 수전 각각 교체');
  await page.getByLabel('상세 주소', { exact: true }).fill('301동 1204호');
  await timeChip(page, '09:00').check();
  await page.getByRole('button', { name: '요청 보내기' }).dblclick(); // 연타해도 한 번만
  await openSentDetail(page);
  await waitText(page, '업체가 작업 가능 여부와 견적을 확인하고 있어요.'); // 검토 중: 진행 단계 설명(상태 배지는 중복이라 없음)
  const d = await db(page);
  const mine = d.requests.filter((r) => r.tasks.length === 2 && r.tasks[0].description === '주방·욕실 수전 각각 교체');
  eq(mine.length, 1, '연타 후 생성된 요청 수');
  eq(mine[0].status, 'reviewing', '요청 상태');
  eq(mine[0].bookingId, undefined, '요청만으로 예약이 생기지 않음');
  eq(JSON.stringify(mine[0].slots), '["09:00"]', '고른 정확한 시각 저장(범위 아님)');
});

await test('요청: 새 요청은 업체 상세에서 고른 희망 날짜가 필요하다(없거나 접수 기준 밖이면 다시 고르기, 날짜 입력란 없음)', async (page) => {
  await start(page, { path: '/providers/p1/request?new=1' });
  await waitText(page, '희망 날짜를 다시 골라 주세요');
  truthy(await page.getByRole('button', { name: '요청 보내기' }).isDisabled(), '희망 날짜 없이 제출 불가');
  eq(await page.locator('input[type=date]').count(), 0, '요청서에 날짜 입력란 없음');
  await page.goto(`${BASE}/providers/p1/request?new=1&date=2026-10-25`); // 한빛설비 일요일(쉬는 요일)
  await waitText(page, '업체가 쉬는 요일이에요.');
  truthy(await page.getByRole('button', { name: '요청 보내기' }).isDisabled(), '접수 기준 밖 날짜 제출 불가');
  await page.goto(`${BASE}/providers/p1/request?new=1&date=2026-10-21`);
  const kv = await page.locator('form .card').first().innerText();
  truthy(kv.includes('새 요청') && kv.includes('희망 날짜') && kv.includes('10월 21일 (수)') && kv.includes('요청만으로 예약이 확정되지 않아요'), `요청서 희망 날짜: ${kv}`);
  await pickTask(page, '수전 교체');
  await page.getByLabel('상세 주소', { exact: true }).fill('301동 1204호');
  await timeChip(page, '09:00').check();
  await page.getByRole('button', { name: '요청 보내기' }).click();
  await waitText(page, '요청을 보냈어요');
  const mine = (await db(page)).requests.at(-1);
  eq(mine.groupId, null, '새 요청은 그룹 ID 없음');
  eq(mine.newDateWish, '2026-10-21', '희망 날짜 저장');
});

await testCompare('요청: 비교 묶음에서 업체별 승인 조건 비교', async (page) => {
  await start(page, { path: '/bookings?tab=requests' });
  await page.getByRole('link', { name: /욕실 세면대 수전 교체/ }).first().click();
  await waitText(page, '업체별 응답');
  await waitText(page, '한빛설비'); await waitText(page, '새봄수리');
  await waitText(page, '업체 할인 조건은 상세에서 확인해요'); // 요약 카드에는 안내만
  await page.locator('.resp-card').filter({ hasText: '새봄수리' }).getByRole('link', { name: '상세 조건 보기' }).click();
  await waitText(page, '5,000원 할인'); // 업체 할인 조건은 상세(승인 조건 확인)에서 사전 표시
  await page.goBack();
  await waitText(page, '하나를 예약하면 나머지 요청은 종료돼요');
});

// ───────── 업체 찾기: 공동 예약 한 줄 안내 + 이용 방법 ─────────
const guideBtn = (page) => page.getByRole('button', { name: '공동 예약 이용 방법' });
const guideDlg = (page) => page.getByRole('dialog', { name: '싸고 공동 예약이란?' });
const activeInDialog = (page) => page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'));
const activeLabel = (page) => page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.textContent?.trim());

/** 카테고리 제목·안내 문구·이용 방법 버튼의 위치 */
/** 카테고리 제목·안내 문구(줄별)·정보 아이콘·버튼(터치 영역)의 위치 */
async function hintLayout(page) {
  return page.evaluate(() => {
    const r = (b) => ({ x: b.left, y: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height, cy: b.top + b.height / 2 });
    const h = [...document.querySelectorAll('h2')].find((x) => x.textContent === '어떤 생활 수리가 필요하세요?');
    const hint = document.querySelector('.coop-hint');
    const btn = hint.querySelector('button');
    const icon = btn.querySelector('svg');
    const range = document.createRange();
    range.setStart(hint, 0); range.setEndBefore(btn);
    const lines = [...range.getClientRects()].filter((x) => x.width > 0);
    const last = lines.reduce((a, b) => (b.bottom > a.bottom || (b.bottom === a.bottom && b.right > a.right) ? b : a));
    const head = h.parentElement;
    return {
      head: r(head.getBoundingClientRect()), h: r(h.getBoundingClientRect()), btn: r(btn.getBoundingClientRect()), icon: r(icon.getBoundingClientRect()),
      textLeft: Math.min(...lines.map((x) => x.left)), textTop: Math.min(...lines.map((x) => x.top)), last: r(last), inHead: head.contains(hint),
      vw: document.documentElement.clientWidth, sw: document.documentElement.scrollWidth,
      textColor: getComputedStyle(hint).color, btnColor: getComputedStyle(btn).color, fontSize: parseFloat(getComputedStyle(hint).fontSize),
      hintCount: document.querySelectorAll('.coop-hint').length, name: btn.getAttribute('aria-label'),
    };
  });
}

await test('업체 찾기: 공동 예약 안내는 카테고리 제목 영역에만(지역 아래 중복 없음), 큰 카드 없음, 자동으로 띄우지 않음', async (page) => {
  await start(page, { path: '/' });
  await waitText(page, '이웃과 같은 업체·같은 날 예약하고 출장비를 나눠 내요.');
  eq(await page.locator('main .guide, main ol, main .banner .coop-hint').count(), 0, '큰 설명 카드·단계 목록·배너');
  eq(await guideDlg(page).count(), 0, '자동으로 열리지 않음');
  const L = await hintLayout(page);
  eq(L.hintCount, 1, '안내는 한 번만');
  eq(L.inHead, true, '카테고리 제목 영역 안');
  const area = (await page.getByRole('heading', { name: '지역·건물 주소' }).boundingBox()).y;
  truthy(area < L.h.y, '지역·건물 주소가 위');
  truthy(L.h.y < 330, `카테고리 제목이 첫 화면 위쪽(${L.h.y}px)`);
  truthy(L.textColor !== L.btnColor, '안내(회색)와 이용 방법(블루) 색 구분');
  // 키보드 포커스 표시
  await guideBtn(page).focus();
  const outline = await guideBtn(page).evaluate((el) => getComputedStyle(el).outlineStyle);
  truthy(outline !== 'none', '이용 방법 포커스 표시');
  // 카테고리·지역 설정 동작 유지
  await page.getByRole('link', { name: '수전·배수', exact: true }).click();
  await page.waitForURL((u) => u.pathname === '/providers');
  await waitText(page, '공동 예약 후보');
});

for (const w of [320, 360, 390, 600, 768, 1024, 1280]) {
  await test(`업체 찾기: 카테고리 제목·안내 배치 ${w}px(겹침·잘림·가로 스크롤 없음)`, async (page) => {
    await start(page, { path: '/' });
    await waitText(page, '이웃과 같은 업체·같은 날 예약하고 출장비를 나눠 내요.');
    const L = await hintLayout(page);
    truthy(L.sw <= L.vw, '가로 스크롤');
    truthy(L.btn.r <= L.vw && L.textLeft >= 0 && L.head.r <= L.vw, '잘림');
    truthy(L.fontSize >= 13, `글자 축소 없음(${L.fontSize}px)`);
    eq(L.name, '공동 예약 이용 방법', '접근성 이름');
    truthy(Math.round(L.icon.w) === 20 && Math.round(L.icon.h) === 20, `아이콘 20px(${L.icon.w}×${L.icon.h})`);
    truthy(L.btn.w >= 44 && L.btn.h >= 44, `터치 영역 44px 이상(${L.btn.w}×${L.btn.h})`);
    truthy(Math.abs(L.icon.cy - L.last.cy) < 6, `아이콘이 문구 마지막 줄과 같은 줄(아이콘 ${L.icon.cy} / 문구 ${L.last.cy})`);
    truthy(Math.abs(L.icon.x - L.last.r - 8) <= 2, `문구와 아이콘 간격 8px(${(L.icon.x - L.last.r).toFixed(1)}px)`);
    // 한 줄에 들어가면 제목 왼쪽·안내 오른쪽 끝(세로 가운데, 24px 이상), 아니면 제목 아래 왼쪽 정렬(약 8px)
    const sameLine = L.textTop < L.h.b - 1;
    if (w >= 1024) truthy(sameLine, `넓은 화면은 같은 줄(${w}px)`);
    if (w <= 390) truthy(!sameLine, `좁은 화면은 제목 아래(${w}px)`);
    if (sameLine) {
      truthy(Math.abs(L.h.cy - L.icon.cy) < 6, `같은 줄 세로 가운데(제목 ${L.h.cy} / 아이콘 ${L.icon.cy})`);
      truthy(L.textLeft - L.h.r >= 24, `제목과 안내 사이 간격(${L.textLeft - L.h.r}px)`);
      truthy(Math.abs(L.icon.r - L.head.r) <= 13, `안내·아이콘이 오른쪽 끝(${L.icon.r} / ${L.head.r})`);
    } else {
      truthy(Math.abs(L.textLeft - L.h.x) <= 1, `왼쪽 정렬(${L.textLeft} / ${L.h.x})`);
      truthy(L.textTop - L.h.b >= 4 && L.textTop - L.h.b <= 14, `제목–안내 간격(${(L.textTop - L.h.b).toFixed(1)}px)`);
    }
    const descGrid = await page.evaluate(() => Math.round(document.querySelector('.cat-grid').getBoundingClientRect().top - document.querySelector('.section__head--hint').getBoundingClientRect().bottom));
    eq(descGrid, 12, '안내–카테고리 사이 섹션 간격만(불필요한 여백 없음)');
    eq(await page.getByText('직접 고치기 막막한', { exact: false }).count(), 0, '중복 설명 없음');
    if (process.env.E2E_SHOTS !== '0') {
      await guideBtn(page).hover(); await page.waitForTimeout(200);
      const tb = await page.locator('.info-btn__tip').boundingBox();
      truthy(tb.x >= 0 && tb.x + tb.width <= w, `툴팁이 화면 안(${JSON.stringify(tb)})`);
      const hb = await page.locator('.section__head--hint').boundingBox();
      await page.screenshot({ path: join(ROOT, `e2e/screens/${w}_home_hint_tooltip.png`), clip: { x: 0, y: Math.max(0, hb.y - 50), width: w, height: hb.height + 70 } });
      await page.mouse.move(1, 1);
    }
    await guideBtn(page).click();
    await guideDlg(page).waitFor();
    await guideDlg(page).getByRole('button', { name: '확인' }).click();
    await guideDlg(page).waitFor({ state: 'detached' });
  }, { width: w });
}

await test('업체 찾기: 정보 아이콘 툴팁(호버·키보드 포커스)과 클릭·Enter로 이용 방법 열기', async (page) => {
  await start(page, { path: '/' });
  await waitText(page, '이웃과 같은 업체·같은 날 예약하고 출장비를 나눠 내요.');
  const tip = page.locator('.info-btn__tip');
  const tipShown = () => tip.evaluate((el) => getComputedStyle(el).visibility === 'visible');
  eq(await tipShown(), false, '평소에는 툴팁 숨김');
  await guideBtn(page).hover();
  await page.waitForTimeout(200);
  eq(await tipShown(), true, '호버 시 툴팁');
  eq((await tip.innerText()).trim(), '공동 예약 이용 방법', '툴팁 문구');
  const tb = await tip.boundingBox();
  truthy(tb.x >= 0 && tb.x + tb.width <= 390, `툴팁이 화면 안(${JSON.stringify(tb)})`);
  await page.mouse.move(5, 5);
  await page.waitForTimeout(200);
  eq(await tipShown(), false, '호버 해제 시 숨김');
  // 키보드: Tab으로 포커스 → 툴팁 + 포커스 표시, Enter로 열기
  await page.getByRole('link', { name: /지역·건물 주소 변경/ }).focus();
  for (let i = 0; i < 6 && (await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))) !== '공동 예약 이용 방법'; i++) await page.keyboard.press('Tab');
  eq(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), '공동 예약 이용 방법', 'Tab으로 정보 아이콘 도달');
  await page.waitForTimeout(200);
  eq(await tipShown(), true, '키보드 포커스 시 툴팁');
  truthy((await guideBtn(page).evaluate((el) => getComputedStyle(el).outlineStyle)) !== 'none', '포커스 표시');
  await page.keyboard.press('Enter');
  await guideDlg(page).waitFor();
  await page.keyboard.press('Escape');
  await guideDlg(page).waitFor({ state: 'detached' });
  // 마우스 클릭
  await guideBtn(page).click();
  await guideDlg(page).waitFor();
  await guideDlg(page).getByRole('button', { name: '확인' }).click();
});

await test('업체 찾기: 이용 방법(모바일 하단 시트) 포커스 이동·가두기·Escape·복귀, 배경 스크롤 잠금·위치 유지', async (page) => {
  await page.setViewportSize({ width: 390, height: 600 });
  await start(page, { path: '/' });
  await waitText(page, '이웃과 같은 업체·같은 날 예약하고 출장비를 나눠 내요.');
  await page.evaluate(() => window.scrollTo(0, 120));
  await page.waitForTimeout(100);
  const y0 = await page.evaluate(() => window.scrollY);
  await guideBtn(page).click();
  await guideDlg(page).waitFor();
  const t = await guideDlg(page).innerText();
  for (const part of ['같은 업체를 같은 날 가까운 이웃과 함께 예약하면, 출장비를 마감 시 확정된 세대 수로 나눠 내요.', '참여 가능한 공동 날짜를 선택해 수리를 요청해요.', '업체가 승인하면 조건을 확인하고 예약금을 결제해요.', '마감 시 세대별 출장비가 확정되고, 작업 완료 후 최종 정산해요.']) truthy(t.includes(part), `내용: ${part}`);
  truthy(!/수리비[^.]*마감/.test(t), '마감에 전체 수리비가 확정되는 것처럼 설명');
  eq(await activeInDialog(page), true, '열리면 내부로 포커스');
  eq(await page.evaluate(() => getComputedStyle(document.documentElement).overflow), 'hidden', '배경 스크롤 잠금');
  const box = await page.locator('.dialog').boundingBox();
  truthy(Math.abs(box.y + box.height - 600) < 2, `모바일은 하단 시트(${JSON.stringify(box)})`);
  for (let i = 0; i < 4; i++) { await page.keyboard.press('Tab'); eq(await activeInDialog(page), true, `Tab ${i + 1} 후에도 내부`); }
  await page.keyboard.press('Shift+Tab'); eq(await activeInDialog(page), true, 'Shift+Tab 후에도 내부');
  await page.keyboard.press('Escape');
  await guideDlg(page).waitFor({ state: 'detached' });
  eq(await activeLabel(page), '공동 예약 이용 방법', 'Escape 후 이용 방법 버튼으로 복귀');
  eq(await page.evaluate(() => window.scrollY), y0, 'Escape 후 스크롤 위치 유지');
  eq(await page.evaluate(() => document.documentElement.style.overflow), '', '닫으면 스크롤 잠금 해제');
  // 닫기 버튼·확인 버튼
  await guideBtn(page).click();
  await guideDlg(page).getByRole('button', { name: '닫기' }).click();
  await guideDlg(page).waitFor({ state: 'detached' });
  eq(await activeLabel(page), '공동 예약 이용 방법', '닫기 후 복귀');
  await guideBtn(page).click();
  await guideDlg(page).getByRole('button', { name: '확인' }).click();
  await guideDlg(page).waitFor({ state: 'detached' });
  eq(await page.evaluate(() => window.scrollY), y0, '확인 후 스크롤 위치 유지');
  eq(await activeLabel(page), '공동 예약 이용 방법', '확인 후 복귀');
});

await test('업체 찾기: 이용 방법 데스크톱은 가운데 모달 · 작은 화면은 본문만 스크롤되고 확인 버튼이 보임', async (page) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await start(page, { path: '/' });
  await guideBtn(page).click();
  const b = await page.locator('.dialog').boundingBox();
  const mid = await page.evaluate(() => { const r = document.querySelector('.dialog-backdrop').getBoundingClientRect(); return r.left + r.width / 2; }); // 배경(스크롤바 자리를 뺀 화면)의 가운데
  truthy(b.y > 40 && b.y + b.height < 760 && Math.abs(b.x + b.width / 2 - mid) < 4, `데스크톱 가운데 모달(${JSON.stringify(b)})`);
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 360, height: 380 });
  await guideBtn(page).click();
  const ok = guideDlg(page).getByRole('button', { name: '확인' });
  const okBox = await ok.boundingBox();
  truthy(okBox.y + okBox.height <= 380, `작은 화면에서 확인 버튼이 화면 안(${JSON.stringify(okBox)})`);
  const body = page.locator('.dialog__body');
  const scrollable = await body.evaluate((el) => el.scrollHeight > el.clientHeight);
  truthy(scrollable, '작은 화면에서는 본문 내부 스크롤');
  await body.evaluate((el) => el.scrollTo(0, el.scrollHeight));
  await guideDlg(page).getByText('마감 시 세대별 출장비가 확정되고').waitFor();
  const lastBox = await guideDlg(page).getByText('마감 시 세대별 출장비가 확정되고').boundingBox();
  truthy(lastBox.y + lastBox.height <= okBox.y, '마지막 단계가 확인 버튼에 가리지 않음');
  await ok.click();
});

// ───────── 주소: 탐색 주소 / 재사용 방문 주소 / 요청·예약 방문 주소 ─────────
const detailInput = (page) => page.getByLabel('상세 주소', { exact: true });
const saveBox = (page) => page.getByRole('checkbox', { name: /다음 신청에도 이 주소 사용/ });
/** 요청서 제출 성공 → 수리 요청 완료 화면 → ‘요청 내용 확인하기’로 요청 상세(단일)·비교 요청 상세(묶음)로 이동 */
async function openSentDetail(page) {
  await page.getByRole('heading', { name: '수리 요청을 보냈어요' }).waitFor();
  await page.getByRole('link', { name: '요청 내용 확인하기' }).click();
  await page.waitForURL((u) => /^\/requests\/(bundle\/)?[^/]+$/.test(u.pathname));
}
/** 요청서 작업 선택 칩(업체 등록 작업, 체크박스) */
function taskChip(page, name) { return page.getByRole('group', { name: '어떤 작업이 필요한가요?' }).getByRole('checkbox', { name, exact: true }); }
/** 작업 카드(고른 작업별 설명·사진) */
function taskCard(page, name) { return page.locator('[data-task]').filter({ has: page.getByRole('heading', { name, exact: true }) }); }
/** 요청서 방문 가능한 시각 칩(정확한 시각, 체크박스) */
function timeChip(page, t) { return page.getByRole('group', { name: '방문 가능한 시각 (여러 개 선택 가능)' }).getByRole('checkbox', { name: t, exact: true }); }
/** 작업을 고르고 그 작업의 자세한 설명을 쓴다 */
async function pickTask(page, name, description) {
  await taskChip(page, name).check();
  if (description !== undefined) await taskCard(page, name).getByLabel('자세한 설명').fill(description);
}
/** 새 날짜 요청 기본 입력: ‘수전 교체’(한빛설비·새봄수리 모두 등록)를 고르고 설명에 구분용 문구를 쓴다 */
async function fillNewDateRequest(page, note, task = '수전 교체') {
  await pickTask(page, task, note);
  await timeChip(page, '09:00').check();
}

await test('주소: 내 정보에 주소 메뉴 없음 · 최초 지역·건물 설정 → 재접속 시 복원(동·호수 미표시, URL에 주소 없음)', async (page) => {
  await start(page, { path: '/me', address: null });
  await waitText(page, '결제·환불 내역');
  truthy(!(await page.locator('main').innerText()).includes('저장된 주소'), '내 정보 주소 메뉴');
  await page.goto(`${BASE}/`);
  await page.getByRole('link', { name: '지역·건물 주소 설정하기' }).click();
  await page.getByRole('button', { name: /달빛길 단독주택/ }).click();
  await page.waitForURL((u) => u.pathname === '/');
  await page.getByRole('link', { name: /지역·건물 주소 변경: 달빛길 단독주택/ }).waitFor();
  truthy(!decodeURIComponent(page.url()).includes('달빛'), 'URL에 주소');
  eq((await db(page)).exploreAddressId, 'ad-house', '사용자별 탐색 주소 저장');
  // 재접속: 이 탭의 화면 캐시를 지우고 다시 열어도 저장한 탐색 주소로 시작
  await page.evaluate((k) => sessionStorage.removeItem(k), APP_KEY);
  await page.reload();
  await page.getByRole('link', { name: /지역·건물 주소 변경: 달빛길 단독주택/ }).waitFor();
  // 다시 바꾸면 업체 목록·공동 예약 후보를 새 주소로 조회
  await page.getByRole('link', { name: /지역·건물 주소 변경/ }).click();
  await page.getByRole('button', { name: /햇살마을 3단지 서울/ }).click();
  await page.getByRole('link', { name: '수전·배수', exact: true }).click();
  await waitText(page, '공동 예약 후보');
});

await test('주소: 첫 신청 저장 선택 → 같은 건물 다음 신청 자동 입력·수정(미선택이면 기존 저장 유지)', async (page) => {
  await start(page, { path: '/providers/p1/request?new=1&date=2026-10-21' });
  await waitText(page, '다음 신청에도 이 주소 사용');
  eq(await detailInput(page).inputValue(), '', '처음에는 상세 주소 비어 있음');
  eq(await saveBox(page).isChecked(), false, '저장 기본값 미선택');
  await fillNewDateRequest(page, '첫 신청');
  await detailInput(page).fill('301동 1204호');
  await saveBox(page).check();
  await page.getByRole('button', { name: '요청 보내기' }).click();
  await waitText(page, '다음 신청에 쓸 주소도 저장했어요');
  let d = await db(page);
  eq(d.savedVisitAddress.detail, '301동 1204호', '저장한 재사용 주소');
  // 두 번째 신청: 같은 건물 → 자동 입력 + 안내
  await page.goto(`${BASE}/providers/p2/request?new=1&date=2026-10-21`);
  await waitText(page, '저장한 주소를 불러왔어요. 방문 주소를 확인해주세요.');
  eq(await detailInput(page).inputValue(), '301동 1204호', '자동 입력');
  await detailInput(page).fill('301동 1205호'); // 확인·수정
  await waitText(page, '저장한 주소와 다르게 수정했어요');
  await fillNewDateRequest(page, '두 번째 신청');
  await page.getByRole('button', { name: '요청 보내기' }).click();
  await waitText(page, '요청을 보냈어요');
  truthy(!(await page.locator('main').innerText()).includes('주소도 저장했어요'), '미선택인데 저장 안내');
  d = await db(page);
  eq(d.savedVisitAddress.detail, '301동 1204호', '미선택 시 기존 저장 주소 유지');
  eq(d.requests.find((r) => r.tasks[0].description === '두 번째 신청').visitAddress.detail, '301동 1205호', '이번 요청에는 입력한 주소');
  await openSentDetail(page);
  await waitText(page, '301동 1205호'); // 요청 상세의 방문 주소
});

await test('주소: 다른 건물 선택 시 이전 동·호수 비움 · 같은 건물로 돌아오면 다시 자동 입력 · 탐색 주소는 그대로', async (page) => {
  await start(page, { path: '/providers/p1/request?new=1&date=2026-10-21', patch: (d) => { d.savedVisitAddress = { addressId: 'ad-apt', line1: '서울 가상구 햇살로 100 (햇살마을 3단지)', detail: '301동 1204호', savedAt: '2026-10-13T00:00:00Z' }; } });
  await waitText(page, '저장한 주소를 불러왔어요');
  await page.getByRole('button', { name: '다른 주소' }).click();
  const dlg = page.getByRole('dialog', { name: '방문할 건물 주소' });
  await dlg.getByRole('button', { name: /햇살마을 3단지 상가동/ }).click(); // 같은 단지의 다른 건물
  await waitText(page, '건물 주소가 바뀌어 상세 주소를 비웠어요');
  eq(await detailInput(page).inputValue(), '', '다른 건물에 이전 동·호수를 붙이지 않음');
  truthy(!(await page.locator('main').innerText()).includes('저장한 주소를 불러왔어요'), '다른 건물 자동 입력 안내');
  await waitText(page, '이 신청에만 쓰는 주소예요');
  await page.getByRole('button', { name: '다른 주소' }).click();
  await page.getByRole('dialog', { name: '방문할 건물 주소' }).getByRole('button', { name: /햇살마을 3단지 서울/ }).click();
  await waitText(page, '저장한 주소를 불러왔어요');
  eq(await detailInput(page).inputValue(), '301동 1204호', '같은 건물로 돌아오면 다시 자동 입력');
  eq(JSON.parse(await page.evaluate((k) => sessionStorage.getItem(k), APP_KEY)).addressId, 'ad-apt', '탐색 주소 그대로');
});

await test('주소: 제출 실패 시 저장했다고 표시하지 않음 · 탐색·재사용 주소를 바꿔도 기존 요청·예약 주소 유지', async (page) => {
  // 다음 저장 1회 실패(네트워크 오류) 상태에서 제출
  await start(page, { path: '/providers/p1/request?group=g1', patch: (d) => { d.settings.failNextWrite = true; } });
  await pickTask(page, '수전 교체', '실패할 신청');
  await timeChip(page, '09:00').check();
  await detailInput(page).fill('301동 1204호');
  await saveBox(page).check();
  await page.getByRole('button', { name: '요청 보내기' }).click();
  await page.locator('.banner--danger').first().waitFor();
  eq(new URL(page.url()).pathname, '/providers/p1/request', '실패 시 신청서에 머묾');
  truthy(!(await page.locator('main').innerText()).includes('주소도 저장했어요'), '실패인데 저장 안내');
  let d0 = await db(page);
  eq(d0.savedVisitAddress, null, '실패 시 재사용 주소 저장 안 함');
  eq(d0.requests.some((r) => r.tasks[0].description === '실패할 신청'), false, '실패 시 요청 없음');
  // 다시 보내면 성공하고 그때 저장
  await page.getByRole('button', { name: '요청 보내기' }).click();
  await waitText(page, '다음 신청에 쓸 주소도 저장했어요');
  d0 = await db(page);
  eq(d0.savedVisitAddress.detail, '301동 1204호', '성공 시 저장');
  // 기존 요청·예약 주소 보존
  await page.goto(`${BASE}/bookings/bk-k15`);
  await waitText(page, '105동 702호');
  await page.goto(`${BASE}/address?back=/`);
  await page.getByRole('button', { name: /달빛길 단독주택/ }).click();
  await page.goto(`${BASE}/bookings/bk-k15`);
  await waitText(page, '서울 가상구 숲길 45 (푸른숲 2단지)');
  await waitText(page, '105동 702호');
  await page.goto(`${BASE}/requests/rq-3`);
  await waitText(page, '301동 1204호');
});

await test('주소: 모바일 키보드(낮은 화면)에서 상세 주소 입력란이 하단 제출 버튼에 가리지 않음', async (page) => {
  await page.setViewportSize({ width: 360, height: 420 }); // 키보드가 올라온 높이를 가정
  await start(page, { path: '/providers/p1/request?new=1&date=2026-10-21' });
  await waitText(page, '다음 신청에도 이 주소 사용');
  await detailInput(page).focus();
  await detailInput(page).press('End');
  await page.waitForTimeout(200);
  const input = await detailInput(page).boundingBox();
  // 제출 버튼은 하단에 고정되지 않으므로 입력란을 가리는 고정 요소가 없다
  const pinned = await page.evaluate(() => [...document.querySelectorAll('body *')].some((e) => ['fixed', 'sticky'].includes(getComputedStyle(e).position) && e.textContent.includes('요청 보내기')));
  truthy(input && !pinned && input.y >= 0 && input.y + input.height <= 420, `입력란 ${JSON.stringify(input)} / 고정 요소 ${pinned}`);
  await page.getByRole('button', { name: '요청 보내기' }).waitFor();
});

// ───────── 내 예약 필터(진행 중·이용 내역) ─────────
const bkStatus = (page) => page.getByRole('button', { name: /^상태 필터/ });
const bkVisit = (page) => page.getByRole('button', { name: /^방문일 필터/ });
const bkToggle = (page) => page.getByRole('button', { name: '할 일 있는 예약만' });
/** 카드의 할 일 문구(없으면 '') */
const todoOf = async (card) => (await card.locator('.card-todo').count()) ? (await card.locator('.card-todo').innerText()).trim() : '';
const bkCards = (page) => page.locator('main .booking-list > li');
const bkTab = (page, name) => page.getByRole('tab', { name });
/** 조회가 끝나 목록 배지가 조건에 맞을 때까지 기다린 뒤 배지 목록 */
async function bkBadges(page, allowed) {
  if (allowed) await page.waitForFunction((al) => { const b = [...document.querySelectorAll('main .booking-list > li .badge')].map((x) => x.textContent); return b.length > 0 && b.every((x) => al.includes(x)); }, allowed).catch(() => {});
  return page.locator('main .booking-list > li .badge').allInnerTexts();
}
async function bkCount(page, n) {
  await page.locator('.filter-bar__count', { hasText: `예약 ${n}건` }).waitFor();
  await page.waitForFunction((k) => document.querySelectorAll('main .booking-list > li').length === k, n).catch(() => {});
  eq(await bkCards(page).count(), n, `표시 예약 수 ${n}`);
}
async function bkPick(page, which, label) {
  await (which === 'status' ? bkStatus(page) : bkVisit(page)).click();
  const dlg = page.getByRole('dialog', { name: which === 'status' ? '상태' : '방문일' });
  await dlg.getByRole('radio', { name: new RegExp('^' + label) }).check();
  await dlg.getByRole('button', { name: '적용', exact: true }).click();
  await dlg.waitFor({ state: 'detached' });
}

await test('내 예약 필터: 확정된 예약 상태·방문일·할 일 있는 예약만(AND), 건수 일치, 전체로 그 조건만 해제, 초기화 없음', async (page) => {
  await start(page, { path: '/bookings?tab=active' });
  await bkCount(page, 11);
  eq((await bkStatus(page).innerText()).trim(), '상태', '기본 표시');
  eq((await bkVisit(page).innerText()).trim(), '방문일', '기본 표시');
  eq(await bkToggle(page).getAttribute('aria-pressed'), 'false', '확인 필요만 기본 꺼짐');
  const h = (await bkStatus(page).boundingBox()).height;
  truthy(h >= 40 && h <= 44, `높이 ${h}`);
  eq(await page.getByRole('button', { name: /초기화/ }).count(), 0, '초기화 버튼 없음');
  await bkPick(page, 'status', '방문 예정');
  // 방문 예정: 후속 방문 일정이 확정된 작업 포함. 기존 일정 방문 불가로 새 일정을 정하는 예약은 ‘일정 조율 중’(필터 그룹은 그대로) — 확인 필요 라벨은 대표 상태 옆
  const sch = await bkBadges(page, ['방문 예정', '일정 조율 중']);
  truthy(sch.every((x) => ['방문 예정', '일정 조율 중'].includes(x)) && sch.includes('일정 조율 중'), `방문 예정 그룹만: ${sch}`);
  await bkCount(page, 6);
  await bkPick(page, 'status', '작업 중');
  eq((await bkBadges(page, ['작업 중'])).join(), '작업 중', '작업 중');
  eq(await todoOf(bkCards(page).first()), '추가 작업을 확인해 주세요', '작업 중 카드 할 일');
  await bkPick(page, 'status', '최종 정산');
  eq((await bkBadges(page, ['최종 정산'])).join(), '최종 정산,최종 정산,최종 정산', '최종 정산 3건');
  eq((await bkCards(page).locator('.card-todo').allInnerTexts()).map((x) => x.trim()).join('|'), '최종 금액을 확인해 주세요|최종 금액을 확인해 주세요|최종 금액을 확인해 주세요', '최종 정산 할 일');
  await bkPick(page, 'status', '정산 진행 중');
  await bkCount(page, 1);
  eq((await bkBadges(page, ['정산 진행 중'])).join(), '정산 진행 중', '정산 대기·금액 이견 → 정산 진행 중');
  // 할 일 있는 예약만: 정산 진행 중(금액 협의 중)은 고객 할 일이 없어 결과 없음(행동 영역도 없음)
  eq(await bkCards(page).locator('.card-todo').count(), 0, '금액 협의 중에는 할 일 문구 없음');
  await bkToggle(page).click();
  // 토글은 주소(조건)를 바꿔 다시 그려지므로 반영될 때까지 기다린 뒤 확인한다
  await page.getByRole('button', { name: '할 일 있는 예약만', pressed: true }).waitFor({ timeout: 3000 }).catch(() => {});
  eq(await bkToggle(page).getAttribute('aria-pressed'), 'true', '토글 켜짐');
  await waitText(page, '선택한 조건에 맞는 예약이 없어요.');
  await bkPick(page, 'status', '전체');
  await bkCount(page, 7); // 지연·제안·자재·추가 작업·최종 금액 ×3
  await bkPick(page, 'status', '방문 예정');
  await bkCount(page, 3); // 방문 예정 AND 확인 필요
  await bkToggle(page).click();
  await bkPick(page, 'visit', '이번 주'); // 10-12(월)~10-18(일)
  await bkVisit(page).filter({ hasText: '이번 주' }).waitFor();
  await bkCount(page, 5); // 밝은전기(bk-k1)는 데모 공동 예약 일정 이동으로 다음 주(10-19), 후속 방문 예약(bk-k7)은 최초 방문일(10-14) 기준
  await bkPick(page, 'visit', '오늘');
  await bkCount(page, 1);
  await bkPick(page, 'status', '전체'); // 상태만 해제 → 오늘 방문(확정된 예약) 전체
  eq(new URL(page.url()).search, '?tab=active&a_visit=today', '상태만 해제');
  await bkPick(page, 'visit', '전체 기간');
  eq(new URL(page.url()).search, '?tab=active', '방문일만 해제');
  await bkCount(page, 11);
});

await test('내 예약 필터: 탭별 독립 조건 · 탭 전환 후 유지 · 상세 복귀 시 탭·조건 복원', async (page) => {
  await start(page, { path: '/bookings?tab=active' });
  await bkCount(page, 11);
  await bkPick(page, 'status', '방문 예정');
  await bkTab(page, '완료·취소').click();
  await bkCount(page, 6);
  eq((await bkStatus(page).innerText()).trim(), '상태', '완료·취소는 별도 조건(기본)');
  eq(await bkToggle(page).count(), 0, '완료·취소에는 확인 필요만 없음');
  await bkPick(page, 'status', '예약 취소');
  truthy((await bkBadges(page, ['예약 취소'])).every((x) => x === '예약 취소'), '취소된 예약만');
  await bkCount(page, 4);
  await bkPick(page, 'status', '이용 완료');
  await bkCount(page, 2);
  await bkPick(page, 'status', '예약 취소');
  await bkTab(page, '확정된 예약').click();
  await bkStatus(page).filter({ hasText: '방문 예정' }).waitFor();
  await bkCount(page, 6);
  await bkTab(page, '완료·취소').click();
  await bkStatus(page).filter({ hasText: '예약 취소' }).waitFor();
  await bkCount(page, 4);
  await bkCards(page).first().getByRole('link').click();
  await page.waitForURL((u) => u.pathname.startsWith('/bookings/bk-'));
  await page.getByRole('link', { name: '예약 목록으로' }).waitFor(); // 완료·취소 예약 상세 하단 목록 버튼
  await page.getByRole('link', { name: '뒤로 가기' }).click(); // 헤더 ‘뒤로’는 앱 안 이전 화면(같은 조건의 목록)으로 기록을 되돌림
  await page.waitForURL((u) => u.pathname === '/bookings' && u.search.includes('tab=past'));
  eq(await bkTab(page, '완료·취소').getAttribute('aria-selected'), 'true', '완료·취소 탭 복원');
  await bkStatus(page).filter({ hasText: '예약 취소' }).waitFor();
  await bkCount(page, 4);
  const qs = decodeURIComponent(new URL(page.url()).search);
  truthy(!/bk-|ad-|동|호/.test(qs), `URL에 조건 외 정보: ${qs}`);
});

await test('내 예약 필터: 방문일 직접 선택 오류 · 결과 없음에서도 조작 · 적용 전 닫으면 유지 · 키보드', async (page) => {
  await start(page, { path: '/bookings?tab=past' });
  await bkCount(page, 6);
  await bkVisit(page).click();
  const dlg = page.getByRole('dialog', { name: '방문일' });
  await waitText(page, '접수·결제·취소일이 아니에요');
  await dlg.getByRole('radio', { name: '직접 선택', exact: true }).check();
  await dlg.getByRole('button', { name: '적용', exact: true }).click();
  await waitText(page, '시작일을 입력해 주세요');
  await dlg.getByLabel('시작일', { exact: true }).fill('2026-10-12');
  await dlg.getByLabel('종료일', { exact: true }).fill('2026-10-10');
  await dlg.getByRole('button', { name: '적용', exact: true }).click();
  await waitText(page, '종료일은 시작일과 같거나 늦어야 해요');
  await dlg.getByLabel('시작일', { exact: true }).fill('2025-01-01');
  await dlg.getByLabel('종료일', { exact: true }).fill('2025-01-02');
  await dlg.getByRole('button', { name: '적용', exact: true }).click();
  await waitText(page, '선택한 조건에 맞는 예약이 없어요.');
  await waitText(page, '날짜나 상태를 변경해주세요.');
  eq(await page.getByRole('button', { name: /초기화/ }).count(), 0, '빈 결과에도 초기화 없음');
  truthy(!(await page.locator('main').innerText()).includes('완료되거나 취소된 예약이 없어요'), '예약 없음과 구분');
  // 적용 전 닫으면 유지(키보드: Enter로 열고 Esc로 닫으면 버튼으로 포커스 복귀)
  await bkStatus(page).focus();
  await page.keyboard.press('Enter');
  await page.getByRole('dialog', { name: '상태' }).getByRole('radio', { name: /^예약 취소/ }).check();
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label')?.startsWith('상태 필터')).catch(() => {});
  eq(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), '상태 필터: 전체', '닫으면 포커스 복귀·적용 안 됨');
  await bkPick(page, 'visit', '전체 기간'); // 결과 없음에서도 조작
  await bkCount(page, 6);
});

await test('내 예약 필터: 일정 변경 합의 전에는 기존 방문일, 수락 후 바뀐 방문일 기준', async (page) => {
  await start(page, { path: '/bookings?a_visit=custom&a_from=2026-10-19&a_to=2026-10-19' });
  await bkCount(page, 1); // 10-19 방문은 밝은전기(bk-k1)뿐 — bk-k4는 제안(10-19) 확인 대기라 기존 10-14 기준
  truthy(!(await page.locator('main').innerText()).includes('깔끔마감'), '수락 전 깔끔마감 없음');
  await page.goto(`${BASE}/bookings/bk-k4`);
  await page.locator('#schedule-change').getByRole('button', { name: '새 일정 수락' }).click();
  await page.locator('#schedule-change').waitFor({ state: 'detached' });
  await page.goto(`${BASE}/bookings?a_visit=custom&a_from=2026-10-19&a_to=2026-10-19`);
  await bkCount(page, 2);
  await waitText(page, '깔끔마감');
});

await test('내 예약 필터: 조회 오류는 빈 결과와 구분하고 다시 시도', async (page) => {
  await start(page, { path: '/bookings?tab=active', patch: (d) => { d.settings.failNextQuery = true; } });
  await waitText(page, '정보를 불러오지 못했습니다');
  truthy(!(await page.locator('main').innerText()).includes('선택한 조건에 맞는 예약이 없어요'), '오류를 빈 결과로 표시');
  await page.getByRole('button', { name: /다시 시도/ }).click();
  await bkCount(page, 11);
});

// ───────── 보낸 요청 필터(캡슐형: 요청 상태 단일 선택 + 접수일) ─────────
const statusBtn = (page) => page.getByRole('button', { name: /^요청 상태 필터/ });
const periodBtn = (page) => page.getByRole('button', { name: /^접수일 필터/ });
const cards = (page) => page.locator('main .request-list > li');
const badges = (page) => page.locator('main .request-list > li .badge').allInnerTexts();
/** 조회가 끝난 뒤의 건수 문구(조회 중에는 비어 있다) */
const COUNT_LABEL = COMPARE ? '요청 묶음' : '보낸 요청';
const countText = async (page) => { await page.locator('.filter-bar__count', { hasText: COUNT_LABEL }).waitFor(); await page.waitForSelector('.request-list[aria-busy]', { state: 'detached' }).catch(() => {}); return page.locator('.filter-bar__count').innerText(); };
/** 보낸 요청 탭의 필터 쿼리(tab은 따로 확인한다) */
const search = (page) => { const p = new URLSearchParams(new URL(page.url()).search); eq(p.get('tab'), 'requests', '보낸 요청 탭'); p.delete('tab'); const q = p.toString(); return q ? `?${q}` : ''; };
const onPath = (page, p) => page.waitForURL((u) => u.pathname === p);
const listBadges = async (page) => { await page.locator('main .request-list .badge').first().waitFor(); return badges(page); };
const ENDED = ['업체 거절', '요청 취소', '결제 기한 만료'];
async function pickStatus(page, label) {
  await statusBtn(page).click();
  const dlg = page.getByRole('dialog', { name: '요청 상태' });
  await dlg.getByRole('radio', { name: new RegExp('^' + label) }).check();
  await dlg.getByRole('button', { name: '적용', exact: true }).click();
  await dlg.waitFor({ state: 'detached' });
}
async function pickPeriod(page, label) {
  await periodBtn(page).click();
  const dlg = page.getByRole('dialog', { name: '접수일' });
  await dlg.getByRole('radio', { name: label, exact: true }).check();
  await dlg.getByRole('button', { name: '적용', exact: true }).click();
  await dlg.waitFor({ state: 'detached' });
}

await test('요청 필터: 캡슐 버튼 [요청 상태][접수일] 순서·높이·기본 표시, 건수 일치, 초기화 버튼 없음', async (page) => {
  await start(page, { path: '/bookings?tab=requests' });
  await waitText(page, '예약금 결제');
  const sb = await statusBtn(page).boundingBox(); const pb = await periodBtn(page).boundingBox();
  truthy(sb.x < pb.x && Math.abs(sb.y - pb.y) < 2, '요청 상태가 먼저, 같은 줄');
  truthy(sb.height >= 40 && sb.height <= 44 && pb.height >= 40 && pb.height <= 44, `높이 40~44px(${sb.height}, ${pb.height})`);
  eq((await statusBtn(page).innerText()).trim(), '요청 상태', '기본 표시');
  eq((await periodBtn(page).innerText()).trim(), '접수일', '기본 표시');
  truthy(parseFloat(await statusBtn(page).evaluate((el) => getComputedStyle(el).borderTopLeftRadius)) >= 20, '캡슐형 모서리');
  eq(await page.locator('.capsule--on').count(), 0, '기본값은 강조 없음');
  eq(await countText(page), `${COUNT_LABEL} ${await cards(page).count()}건`, '건수 = 표시 묶음 수');
  eq(await page.getByRole('button', { name: /초기화/ }).count(), 0, '초기화 버튼 없음');
});

await test('요청 필터: 대표 상태 단일 선택(업체 검토 중·예약금 결제 대기·업체 거절·요청 취소·결제 기한 만료, 예약 완료 없음) = 카드 배지, 확인 필요 라벨 · 전체로 그 조건만 해제', async (page) => {
  await start(page, { path: '/bookings?tab=requests' });
  await waitText(page, '예약금 결제');
  const total = await cards(page).count();
  const expectGroup = async (label, query, allowed) => {
    await pickStatus(page, label);
    eq(search(page), `?status=${query}`, `${label} URL`);
    await statusBtn(page).filter({ hasText: label }).waitFor();
    eq(await statusBtn(page).evaluate((el) => el.classList.contains('capsule--on')), true, `${label} 강조`);
    // 전환 렌더가 끝나 목록이 이 조건으로 바뀔 때까지 기다린다(끝내 맞지 않으면 시간 초과로 실패)
    await page.waitForFunction((al) => { const b = [...document.querySelectorAll('main .request-list > li .badge')].map((x) => x.textContent); return b.length > 0 && b.every((x) => al.includes(x)); }, allowed).catch(() => {});
    const shown = await listBadges(page);
    truthy(shown.length > 0 && shown.every((x) => allowed.includes(x)), `${label}: ${shown}`);
    eq(await countText(page), `${COUNT_LABEL} ${await cards(page).count()}건`, `${label} 건수`);
    return shown;
  };
  // 할 일 문구: 추가 정보 필요(rq-2)는 ‘업체 검토 중’ + ‘요청서를 보완해 주세요’, 결제 대기는 ‘예약금 결제’ + ‘예약금을 결제해 주세요’
  await expectGroup('업체 검토 중', 'reviewing', ['업체 검토 중']);
  // 할 일: 보완 요청(rq-2)만 ‘요청서를 보완해 주세요’, 업체 검토만 기다리는 rq-1에는 없음
  eq((await cards(page).locator('.card-todo').allInnerTexts()).map((x) => x.trim()).join('|'), '요청서를 보완해 주세요', '검토 중 할 일');
  await expectGroup('예약금 결제', 'payment_pending', ['예약금 결제']);
  const payTodos = (await cards(page).locator('.card-todo').allInnerTexts()).map((x) => x.trim());
  truthy(payTodos.length === await cards(page).count() && payTodos.every((x) => x === '예약금을 결제해 주세요'), `결제 대기 할 일: ${payTodos}`);
  eq(await page.locator('main .request-list .badge').filter({ hasText: '확인 필요' }).count(), 0, '확인 필요 배지 없음');
  await statusBtn(page).click();
  const opts = await page.getByRole('dialog', { name: '요청 상태' }).getByRole('radio').evaluateAll((rs) => rs.map((r) => r.closest('label')?.querySelector('.opt__label, span')?.textContent ?? r.getAttribute('aria-label') ?? ''));
  eq(await page.getByRole('dialog', { name: '요청 상태' }).getByRole('radio', { name: /^예약 완료/ }).count(), 0, '보낸 요청 필터에 예약 완료 없음');
  eq(await page.getByRole('dialog', { name: '요청 상태' }).getByRole('radio', { name: /^(종료|철회|승인 만료|추가 정보 필요)/ }).count(), 0, `이전 이름 없음: ${opts}`);
  await page.keyboard.press('Escape');
  eq((await expectGroup('업체 거절', 'rejected', ['업체 거절'])).join(), '업체 거절', '업체 거절');
  eq((await expectGroup('요청 취소', 'withdrawn', ['요청 취소'])).join(), '요청 취소', '철회 → 요청 취소');
  eq((await expectGroup('결제 기한 만료', 'expired', ['결제 기한 만료'])).join(), '결제 기한 만료', '승인 만료 → 결제 기한 만료');
  // 종료 상태는 연한 회색(진행 상태는 연한 블루)
  eq(await page.locator('main .request-list .badge').first().evaluate((e) => getComputedStyle(e).backgroundColor), 'rgb(238, 240, 243)', '종료 회색 배지');
  // 접수일과 함께 적용한 뒤 상태만 ‘전체’로 → 접수일은 유지
  await pickPeriod(page, '최근 30일');
  eq(search(page), '?period=30d&status=expired', '두 조건');
  await pickStatus(page, '전체');
  eq(search(page), '?period=30d', '상태만 해제');
  await periodBtn(page).filter({ hasText: '최근 30일' }).waitFor();
  await statusBtn(page).filter({ hasText: '요청 상태' }).waitFor();
  await pickPeriod(page, '전체 기간');
  eq(search(page), '', '접수일만 해제');
  await page.locator('.filter-bar__count', { hasText: `${COUNT_LABEL} ${total}건` }).waitFor();
});

await test('요청 필터: 접수일 직접 선택(오류·경계) + 상태 AND → 결과 없음에서도 필터 조작, 적용 전 닫으면 유지', async (page) => {
  await page.setViewportSize({ width: 360, height: 760 });
  await start(page, { path: '/bookings?tab=requests' });
  await waitText(page, '예약금 결제');
  await periodBtn(page).click();
  const dlg = page.getByRole('dialog', { name: '접수일' });
  await waitText(page, '방문일이 아니에요');
  await dlg.getByRole('radio', { name: '직접 선택', exact: true }).check();
  await dlg.getByRole('button', { name: '적용', exact: true }).click();
  await waitText(page, '시작일을 입력해 주세요');
  await dlg.getByLabel('시작일', { exact: true }).fill('2026-10-12');
  await dlg.getByLabel('종료일', { exact: true }).fill('2026-10-10');
  await dlg.getByRole('button', { name: '적용', exact: true }).click();
  await waitText(page, '종료일은 시작일과 같거나 늦어야 해요');
  await dlg.getByLabel('종료일', { exact: true }).fill('2026-10-12');
  await waitText(page, '2026.10.12');
  await ((n) => process.env.E2E_SHOTS !== '0' && page.screenshot({ path: join(ROOT, `e2e/screens/360_filter_${n}.png`) }))('period_sheet');
  await dlg.getByRole('button', { name: '적용', exact: true }).click();
  await dlg.waitFor({ state: 'detached' });
  await periodBtn(page).filter({ hasText: '2026.10.12 ~ 2026.10.12' }).waitFor();
  truthy(await periodBtn(page).evaluate((el) => el.scrollWidth <= el.clientWidth + 1), '직접 선택 기간이 잘리지 않음');
  // 10-12 접수(한국 날짜, 시작·종료 포함): rq-2(20:00), rq-10(09:00)
  await page.locator('.filter-bar__count', { hasText: `${COUNT_LABEL} 2건` }).waitFor();
  const labels = await cards(page).allInnerTexts();
  truthy(labels.length === 2 && labels.every((t) => t.includes('요청 접수일 2026.10.12')), '모두 10-12 접수');
  // 적용 전에 닫으면 기존 조건 유지(편집값 ≠ 적용값)
  await statusBtn(page).click();
  await page.getByRole('dialog', { name: '요청 상태' }).getByRole('radio', { name: /^예약금 결제/ }).check();
  await page.keyboard.press('Escape');
  await statusBtn(page).filter({ hasText: '요청 상태' }).waitFor();
  eq(search(page).includes('status'), false, '닫으면 적용 안 됨');
  // AND → 결과 없음(10-12 접수 중 업체 거절 없음)
  await pickStatus(page, '업체 거절');
  await waitText(page, '선택한 조건에 맞는 요청이 없어요.');
  await waitText(page, '날짜나 상태를 변경해주세요.');
  await ((n) => process.env.E2E_SHOTS !== '0' && page.screenshot({ path: join(ROOT, `e2e/screens/360_filter_${n}.png`) }))('no_result');
  eq(await countText(page), `${COUNT_LABEL} 0건`, '결과 없음 건수');
  eq(await page.getByRole('button', { name: /초기화/ }).count(), 0, '빈 상태에도 초기화 버튼 없음');
  truthy(!(await page.locator('main').innerText()).includes('보낸 요청이 없어요'), '요청 없음과 구분');
  // 결과가 없어도 필터를 계속 조작
  await pickPeriod(page, '전체 기간');
  const shown = await listBadges(page);
  eq(shown.join(), '업체 거절', `기간 해제 후 업체 거절만: ${shown}`);
});

await test('요청 필터: 키보드로 열기·선택·적용, 포커스 이동·복귀 · 데스크톱 팝오버/모바일 하단 시트', async (page) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await start(page, { path: '/bookings?tab=requests' });
  await waitText(page, '예약금 결제');
  await statusBtn(page).focus();
  await page.keyboard.press('Enter');
  const dlg = page.getByRole('dialog', { name: '요청 상태' });
  await dlg.waitFor();
  eq(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]')), true, '열리면 내부로 포커스');
  // 데스크톱: 버튼 아래 팝오버, 배경 어둡게 하지 않음
  const bb = await statusBtn(page).boundingBox(); const db0 = await page.locator('.dialog').boundingBox();
  truthy(db0.y >= bb.y + bb.height && db0.y - (bb.y + bb.height) < 20 && Math.abs(db0.x - bb.x) < 20, `팝오버 위치(${JSON.stringify(db0)})`);
  eq(await page.locator('.dialog-backdrop').evaluate((el) => getComputedStyle(el).backgroundColor), 'rgba(0, 0, 0, 0)', '팝오버 배경 투명');
  await dlg.getByRole('radio', { name: /^전체/ }).focus();
  await page.keyboard.press('ArrowDown'); // 업체 검토 중
  await page.keyboard.press('ArrowDown'); // 예약금 결제 대기
  eq(await dlg.getByRole('radio', { name: /^예약금 결제/ }).isChecked(), true, '방향키로 선택');
  await dlg.getByRole('button', { name: '적용', exact: true }).focus();
  await page.keyboard.press('Enter');
  await dlg.waitFor({ state: 'detached' });
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '요청 상태 필터: 예약금 결제').catch(() => {});
  eq(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), '요청 상태 필터: 예약금 결제', '닫히면 버튼으로 포커스 복귀');
  eq(search(page), '?status=payment_pending', '키보드로 적용');
  // 모바일: 하단 시트
  await page.setViewportSize({ width: 390, height: 700 });
  await periodBtn(page).click();
  const box = await page.locator('.dialog').boundingBox();
  truthy(Math.abs(box.y + box.height - 700) < 2, `모바일 하단 시트(${JSON.stringify(box)})`);
  await page.getByRole('dialog', { name: '접수일' }).getByRole('button', { name: '닫기' }).click();
});

await testCompare('요청 필터: 묶음 안 서로 다른 상태 — 선택 상태 요청만 표시, 상세 비교에는 전체 유지', async (page) => {
  // b-sink: rq-3(결제 대기) + rq-4 철회로 상태를 나눈다
  await start(page, { path: '/bookings?tab=requests', patch: (d) => { d.requests.find((r) => r.id === 'rq-4').status = 'withdrawn'; } });
  await pickStatus(page, '종료');
  await page.waitForURL((u) => u.search === '?tab=requests&status=ended');
  await countText(page); // 조회가 끝난 목록을 읽는다
  const sink = cards(page).filter({ hasText: '욕실 세면대 수전 교체 · 배수 트랩 교체' }).filter({ hasText: '2개 업체에 요청' });
  await sink.first().waitFor();
  const t = await sink.first().innerText();
  truthy(t.includes("철회") && !t.includes("예약금 결제 대기") && t.includes("목록에서만 숨겼어요"), `묶음 안 선택 상태만: ${JSON.stringify(t)}`);
  await sink.first().getByRole('link').click();
  await page.waitForURL((u) => u.pathname === '/requests/bundle/b-sink');
  await waitText(page, '한빛설비'); await waitText(page, '새봄수리'); // 숨긴 요청도 상세 비교에 그대로
});

await test('요청 필터: 상세 진입 후 복귀·새로고침·뒤로가기·잘못된 쿼리', async (page) => {
  await start(page, { path: '/bookings?tab=requests&status=reviewing' });
  eq((await listBadges(page)).join(), '업체 검토 중,업체 검토 중', '주소의 필터 적용');
  await page.getByRole('link', { name: /현관문 손잡이 교체/ }).click();
  await onPath(page, '/requests/rq-2');
  await page.getByRole('link', { name: '보낸 요청 목록으로' }).waitFor(); // 요청 상세 하단 목록 버튼
  await page.getByRole('link', { name: '뒤로 가기' }).click(); // 헤더 ‘뒤로’는 앱 안 이전 화면(같은 조건의 목록)으로 기록을 되돌림
  await page.waitForURL((u) => u.pathname === '/bookings' && u.search === '?tab=requests&status=reviewing');
  eq((await listBadges(page)).join(), '업체 검토 중,업체 검토 중', '상세 복귀 후 필터 유지');
  await page.reload();
  eq((await listBadges(page)).join(), '업체 검토 중,업체 검토 중', '새로고침 후 유지');
  await pickStatus(page, '예약금 결제');
  eq(search(page), '?status=payment_pending', '두 번째 적용');
  await page.goBack();
  await page.waitForURL((u) => u.search === '?tab=requests&status=reviewing');
  await page.waitForTimeout(200);
  eq((await badges(page)).join(), '업체 검토 중,업체 검토 중', '뒤로가기로 이전 조건');
  // 이전 주소의 ‘추가 정보 필요’ 조건은 ‘업체 검토 중’으로 연결된다
  await page.goto(`${BASE}/bookings?tab=requests&status=needs_info`);
  await statusBtn(page).filter({ hasText: '업체 검토 중' }).waitFor();
  eq((await listBadges(page)).join(), '업체 검토 중,업체 검토 중', '이전 주소(추가 정보 필요) → 업체 검토 중');
  await page.locator('.tabbar').getByRole('link', { name: '내 정보' }).click();
  await page.locator('.tabbar').getByRole('link', { name: '내 예약' }).click();
  await page.waitForURL((u) => u.search === '?tab=requests&status=reviewing');
  for (const bad of ['period=custom&from=2026-99-01&to=x&status=zzz', 'status=reviewing,needs_info', 'status=approved_pending_payment', 'status=booked']) {
    await page.goto(`${BASE}/requests?${bad}`); // 이전 내 요청 주소 → 보낸 요청 탭(쿼리 유지 후 검증)
    await page.waitForURL((u) => u.pathname === '/bookings' && u.search === '?tab=requests');
    await periodBtn(page).filter({ hasText: '접수일' }).waitFor();
    await statusBtn(page).filter({ hasText: '요청 상태' }).waitFor();
  }
});

await test('요청 필터: 목록 위치 유지(상세 → 뒤로) · 필터 변경 시 처음으로', async (page) => {
  await page.setViewportSize({ width: 390, height: 600 });
  await start(page, { path: '/bookings?tab=requests' });
  await waitText(page, '예약금 결제');
  const last = cards(page).last();
  await last.scrollIntoViewIfNeeded();
  await page.waitForTimeout(150);
  const y = await page.evaluate(() => window.scrollY);
  truthy(y > 100, `스크롤 가능한 목록 (${y})`);
  await last.getByRole('link').click();
  await page.waitForURL((u) => u.pathname !== '/bookings');
  await page.goBack();
  await page.waitForURL((u) => u.pathname === '/bookings');
  await page.waitForTimeout(400);
  const back = await page.evaluate(() => window.scrollY);
  truthy(Math.abs(back - y) < 40, `복귀 위치 ${back} / 이전 ${y}`);
  await statusBtn(page).scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollTo(0, 200));
  await pickStatus(page, '예약금 결제');
  await page.waitForTimeout(200);
  eq(await page.evaluate(() => window.scrollY), 0, '필터 변경 시 목록 처음으로');
});

await test('요청 필터: 다른 소유 계정의 목업 상태가 남아 있으면 데모 고객 데이터로 초기화(필터·위치·방문 지역 포함)', async (page) => {
  await start(page, { path: '/bookings?tab=requests' });
  await pickStatus(page, '요청 취소');
  truthy((await page.evaluate(() => JSON.stringify({ ...sessionStorage }))).includes('list-filter'), '필터 저장');
  // 이전 버전·다른 계정의 상태를 흉내 낸다(사용자 구분 구조는 유지된다)
  await page.evaluate((k) => { const d = JSON.parse(sessionStorage.getItem(k)); d.ownerAccountId = 'someone-else'; d.requests[0].tasks[0].title = '다른 계정 데이터'; sessionStorage.setItem(k, JSON.stringify(d)); }, DB_KEY);
  await page.goto(`${BASE}/bookings`);
  await waitText(page, '예약금 결제');
  const dump = await page.evaluate(() => JSON.stringify({ ...sessionStorage }));
  truthy(!dump.includes('다른 계정 데이터'), '다른 계정 목업 데이터가 남음');
  // 방문 기록(nav-trail: 브라우저 뒤로가기 대상 경로)은 적용된 필터가 아니므로 제외하고 본다
  const saved = await page.evaluate(() => JSON.stringify(Object.fromEntries(Object.entries(sessionStorage).filter(([k]) => k !== 'nav-trail'))));
  truthy(!saved.includes('status=withdrawn'), '다른 계정 필터가 남음');
  eq(new URL(page.url()).search, '?tab=requests', '필터 초기화(첫 탭·기본 조건)');
});

await test('요청: 추가 정보 요청 → 보완 제출 → 검토 중', async (page) => {
  await start(page, { path: '/requests/rq-2' });
  await page.getByRole('link', { name: '요청서 보완하기' }).click();
  await page.getByRole('button', { name: '보완 내용 보내기' }).click();
  await waitText(page, '내용을 입력하거나 사진을 추가해 주세요');
  await page.getByLabel('보완 내용').fill('손잡이 사진을 추가했어요.');
  await page.getByRole('button', { name: '보완 내용 보내기' }).click();
  await waitText(page, '보완한 내용을 보냈어요');
  await waitText(page, '업체가 작업 가능 여부와 견적을 확인하고 있어요.'); // 검토 중: 진행 단계 설명(상태 배지는 중복이라 없음)
});

await test('요청: 철회 확인(단일 업체) — 업체명 제목·보조 설명 없음, 돌아가기는 상태 유지·포커스 복원, 철회하기로만 철회', async (page) => {
  await start(page, { path: '/requests/rq-1' });
  const open = page.getByRole('button', { name: '이 업체 요청 철회하기' });
  await open.click();
  const dlg = page.getByRole('dialog', { name: '밝은전기에 보낸 요청을 철회할까요?' });
  await dlg.waitFor();
  const t = await dlg.innerText();
  truthy(!t.includes('다른 업체에 보낸 요청은 유지돼요') && !t.includes('취소수수료') && !t.includes('확정된 예약'), `단일 업체: 보조 설명·긴 문구 없음 ${t}`);
  eq(await page.evaluate(() => document.activeElement?.textContent), '돌아가기', '처음 포커스 = 돌아가기');
  await dlg.getByRole('button', { name: '돌아가기' }).click();
  eq(await page.getByRole('dialog').count(), 0, '돌아가기 → 닫힘');
  eq(await page.evaluate(() => document.activeElement?.textContent), '이 업체 요청 철회하기', '닫으면 철회 버튼으로 포커스');
  eq((await db(page)).requests.find((r) => r.id === 'rq-1').status, 'reviewing', '돌아가기는 상태 변경 없음');
  await open.click();
  await page.getByRole('dialog').getByRole('button', { name: '철회하기', exact: true }).click();
  await waitText(page, '직접 취소한 요청이에요');
  eq((await db(page)).requests.find((r) => r.id === 'rq-1').status, 'withdrawn', '철회 상태');
});


// ───────── 요청 상세: 중복 상태 안내 정리·하단 버튼·철회 확인 ─────────
const withdrawBtn = (page) => page.getByRole('button', { name: '이 업체 요청 철회하기' });
const listBtn = (page) => page.getByRole('link', { name: '보낸 요청 목록으로' });

await test('요청 상세: 검토 중은 진행 단계 설명만(배지·중복 설명 없음), 다른 상태 안내 유지, 상태별 버튼 범위', async (page) => {
  await start(page, { path: '/requests/rq-1' }); // 검토 중
  await waitText(page, '업체가 작업 가능 여부와 견적을 확인하고 있어요.');
  const m = await page.locator('main').innerText();
  truthy(!m.includes('업체가 요청을 검토하고 있어요. 아직 예약이 확정된 것은 아니에요.'), '중복 설명 없음');
  eq(await page.locator('main .badge').filter({ hasText: '업체 검토 중' }).count(), 0, '검토 중 배지 없음');
  eq(await page.locator('.steps__current, [aria-current="step"]').count() >= 1, true, '진행 단계 강조 유지');
  truthy(await listBtn(page).isVisible() && await withdrawBtn(page).isVisible(), '목록·철회 버튼');
  // 추가 정보 필요: 보완 필요 카드(보완 버튼 한 개)·철회 유지
  await page.goto(`${BASE}/requests/rq-2`);
  await waitText(page, '요청서를 보완해 주세요');
  truthy(await page.getByRole('link', { name: '요청서 보완하기' }).count() === 1 && await withdrawBtn(page).isVisible(), '보완 요청 카드·버튼');
  // 결제 대기: 결제 기한 안내·결제 버튼·철회 유지
  await page.goto(`${BASE}/requests/rq-3`);
  await waitText(page, '결제 기한');
  truthy(await page.getByRole('button', { name: PAY_BTN }).isVisible() && await withdrawBtn(page).isVisible(), '결제 대기 버튼');
  // 종료(거절·철회·만료): 사유 안내 유지, 철회 버튼 없음, 목록 버튼만(전체 너비)
  for (const [id, text] of [['rq-5', '업체가 거절했어요'], ['rq-6', '직접 취소한 요청이에요'], ['rq-7', '결제 기한이 지나 예약이 확정되지 않았어요']]) {
    await page.goto(`${BASE}/requests/${id}`);
    await waitText(page, text);
    eq(await withdrawBtn(page).count(), 0, `${id} 철회 버튼 없음`);
    truthy(await listBtn(page).isVisible(), `${id} 목록 버튼`);
  }
  // 예약으로 이어진 요청: 목록·철회 버튼 없이 예약 보기(확정 예약 취소는 예약 상세에서)
  const booked = (await db(page)).requests.find((r) => r.status === 'booked');
  await page.goto(`${BASE}/requests/${booked.id}`);
  await waitText(page, '예약 완료 · 요청 과정이 끝났어요');
  eq(await withdrawBtn(page).count() + await listBtn(page).count(), 0, '예약 확정 요청에는 철회·목록 버튼 없음');
});

await test('요청 상세: ‘보낸 요청 목록으로’는 내 예약 > 보낸 요청(마지막 필터 복원), 브라우저 뒤로가기로 상세 복귀', async (page) => {
  await start(page, { path: '/bookings?tab=requests&status=reviewing' });
  await page.getByRole('link', { name: /현관문 손잡이 교체/ }).click();
  await page.waitForURL((u) => u.pathname === '/requests/rq-2');
  await listBtn(page).click();
  await page.waitForURL((u) => u.pathname === '/bookings' && u.search === '?tab=requests&status=reviewing');
  eq(await page.getByRole('tab', { name: '보낸 요청' }).getAttribute('aria-selected'), 'true', '보낸 요청 탭');
  await page.goBack();
  await page.waitForURL((u) => u.pathname === '/requests/rq-2');
});

await testCompare('요청 상세: 비교 요청 철회 — 보조 설명, 이 업체 요청만 철회(다른 업체 유지), 실패 시 안내·다시 시도, 처리 중 중복 방지', async (page) => {
  await start(page, { path: '/requests/rq-3' }); // b-sink: 한빛설비(rq-3)·새봄수리(rq-4)
  await withdrawBtn(page).click();
  const dlg = page.getByRole('dialog', { name: '한빛설비에 보낸 요청을 철회할까요?' });
  await dlg.waitFor();
  await dlg.getByText('다른 업체에 보낸 요청은 유지돼요.').waitFor();
  eq(await page.getByRole('dialog').count(), 1, '모달 하나');
  // 실패 → 모달 안 오류, 상태 그대로 → 다시 시도
  await page.evaluate(() => { window.__sagoDev.db.settings.failNextWrite = true; });
  await dlg.getByRole('button', { name: '철회하기', exact: true }).click();
  await dlg.locator('.banner--danger').waitFor();
  eq((await db(page)).requests.find((r) => r.id === 'rq-3').status, 'approved_pending_payment', '실패 시 상태 그대로');
  await dlg.getByRole('button', { name: '철회하기', exact: true }).dblclick(); // 다시 시도(연타해도 한 번)
  await waitText(page, '직접 취소한 요청이에요');
  const d = await db(page);
  eq(d.requests.find((r) => r.id === 'rq-3').status, 'withdrawn', '이 업체 요청만 철회');
  eq(d.requests.find((r) => r.id === 'rq-4').status, 'approved_pending_payment', '다른 업체 요청 유지');
  eq(await withdrawBtn(page).count(), 0, '철회 후 버튼 없음');
});

for (const w of [390, 1280]) {
  await test(`요청 상세 하단 버튼·철회 모달 ${w}px: 본문 다음 24px·카드 너비, ${w < 600 ? '세로(목록 위)' : '같은 너비 나란히 12px'}, 48px, 색 구분, 고정 없음 · 모달 420px·24px·버튼 나란히 44px·12px, 포커스 가두기·복원`, async (page) => {
    await page.setViewportSize({ width: w, height: 800 });
    await start(page, { path: '/requests/rq-1' });
    await withdrawBtn(page).waitFor();
    const r = await page.evaluate(() => {
      const area = document.querySelector('.detail-actions'); const ar = area.getBoundingClientRect();
      const prev = area.previousElementSibling.getBoundingClientRect(); const card = [...document.querySelectorAll('main section .card')].at(-1).getBoundingClientRect();
      const [l, wd] = [...area.querySelectorAll('.btn')].map((b) => ({ r: b.getBoundingClientRect(), c: getComputedStyle(b), text: b.textContent }));
      const chain = []; for (let e = area; e && e !== document.body; e = e.parentElement) chain.push(getComputedStyle(e).position);
      return {
        gap: Math.round(ar.top - prev.bottom), width: Math.round(ar.width) === Math.round(card.width) && Math.round(ar.left) === Math.round(card.left), pinned: chain.some((p) => p === 'fixed' || p === 'sticky'),
        order: [l.text, wd.text], side: Math.abs(l.r.top - wd.r.top) < 1, stacked: wd.r.top > l.r.bottom, btnGap: Math.round(wd.r.top > l.r.bottom ? wd.r.top - l.r.bottom : wd.r.left - l.r.right),
        sameW: Math.abs(l.r.width - wd.r.width) < 1, h: [Math.round(l.r.height), Math.round(wd.r.height)],
        list: [l.c.backgroundColor, l.c.borderTopColor, l.c.color], wd: [wd.c.backgroundColor, wd.c.borderTopColor, wd.c.color],
        bottomSpace: Math.round(document.querySelector('main').getBoundingClientRect().bottom - ar.bottom), overflow: document.documentElement.scrollWidth > innerWidth,
      };
    });
    truthy(r.gap === 24 && r.width && !r.pinned && !r.overflow && r.bottomSpace >= 24, `배치 ${JSON.stringify(r)}`);
    eq(r.order.join('/'), '보낸 요청 목록으로/이 업체 요청 철회하기', '목록 버튼 먼저');
    if (w < 600) truthy(r.stacked && r.btnGap === 12, `모바일 세로 ${JSON.stringify(r)}`);
    else truthy(r.side && r.sameW && r.btnGap === 12, `데스크톱 나란히 ${JSON.stringify(r)}`);
    truthy(r.h.every((x) => x >= 44 && x <= 48), `높이 ${r.h}`);
    eq(JSON.stringify(r.list), JSON.stringify(['rgb(255, 255, 255)', 'rgb(49, 93, 168)', 'rgb(49, 93, 168)']), '목록: 흰 바탕·블루 테두리·글씨');
    eq(JSON.stringify(r.wd), JSON.stringify(['rgb(255, 255, 255)', 'rgb(179, 38, 30)', 'rgb(179, 38, 30)']), '철회: 흰 바탕·빨간 테두리·글씨(채움 아님)');
    // hover: 의미 색 유지
    await withdrawBtn(page).hover();
    const hv = await withdrawBtn(page).evaluate((b) => [getComputedStyle(b).color, getComputedStyle(b).borderTopColor]);
    eq(JSON.stringify(hv), JSON.stringify(['rgb(179, 38, 30)', 'rgb(179, 38, 30)']), 'hover도 빨간 글씨·테두리');
    // 키보드로 열기 → 모달
    await withdrawBtn(page).focus(); await page.keyboard.press('Enter');
    const dlg = page.getByRole('dialog', { name: '밝은전기에 보낸 요청을 철회할까요?' });
    await dlg.waitFor();
    const m = await dlg.evaluate((el) => {
      const r = el.getBoundingClientRect(); const c = getComputedStyle(el);
      const [back, ok] = [...el.querySelectorAll('.dialog__actions .btn')].map((b) => ({ r: b.getBoundingClientRect(), c: getComputedStyle(b), t: b.textContent }));
      return { w: Math.round(r.width), left: Math.round(r.left), right: Math.round(innerWidth - r.right), pad: c.paddingLeft, top: Math.round(r.top), h: Math.round(r.height),
        order: [back.t, ok.t], side: Math.abs(back.r.top - ok.r.top) < 1, gap: Math.round(ok.r.left - back.r.right), bh: [Math.round(back.r.height), Math.round(ok.r.height)],
        ok: [ok.c.backgroundColor, ok.c.color], back: [back.c.backgroundColor, back.c.borderTopColor], focus: document.activeElement?.textContent, describedby: el.getAttribute('aria-describedby') };
    });
    truthy(m.w <= 440 && m.w >= 280 && m.left >= 16 && m.right >= 16 && m.pad === '24px' && m.h < 260, `모달 크기 ${JSON.stringify(m)}`);
    truthy(m.order.join('/') === '돌아가기/철회하기' && m.side && m.gap === 12 && m.bh.every((x) => x === 44), `모달 버튼 ${JSON.stringify(m)}`);
    eq(JSON.stringify(m.ok), JSON.stringify(['rgb(179, 38, 30)', 'rgb(255, 255, 255)']), '철회하기: 빨간 채움·흰 글씨');
    eq(m.back[1], 'rgb(201, 206, 214)', '돌아가기: 중립 테두리');
    eq(m.focus, '돌아가기', '처음 포커스');
    // 포커스 가두기: Tab 두 번이면 다시 돌아가기
    await page.keyboard.press('Tab'); eq(await page.evaluate(() => document.activeElement?.textContent), '철회하기', 'Tab → 철회하기');
    await page.keyboard.press('Tab'); eq(await page.evaluate(() => document.activeElement?.textContent), '돌아가기', '모달 안에 가둠');
    if (w === 390) await page.screenshot({ path: join(ROOT, 'e2e/screens/390_withdraw_dialog.png') });
    await page.keyboard.press('Escape');
    eq(await page.getByRole('dialog').count(), 0, 'Escape로 닫힘');
    eq(await page.evaluate(() => document.activeElement?.textContent), '이 업체 요청 철회하기', '포커스 복원');
    eq((await db(page)).requests.find((x) => x.id === 'rq-1').status, 'reviewing', '닫아도 상태 그대로');
    if (w === 390) { await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)); await page.screenshot({ path: join(ROOT, 'e2e/screens/390_request_detail_actions.png') }); }
  }, { width: w });
}

// ───────── 상세 상단 공통 행동 카드(spec 5.17) ─────────
/** 공통 행동 카드 모양: 회색 테두리·둥근 모서리, 연한 블루 머리(정보 아이콘 + 문구), 구체 제목, 흰 본문, 노란 바탕·테두리·안쪽 카드 없음, 넘침 없음 */
async function actCardStyle(loc) {
  return loc.evaluate((c) => {
    const cs = getComputedStyle(c); const cr = c.getBoundingClientRect();
    const head = c.querySelector('.act-card__head, .cost__head'); const hs = getComputedStyle(head);
    const body = c.querySelector('.act-card__body') ?? c;
    return {
      bg: cs.backgroundColor, border: cs.borderTopColor, bw: cs.borderTopWidth, radius: parseFloat(cs.borderTopLeftRadius),
      headBg: hs.backgroundColor, headColor: hs.color, headText: head.textContent.trim(), headIcon: !!head.querySelector('svg'),
      headTop: Math.round(head.getBoundingClientRect().top - cr.top), bodyBg: getComputedStyle(body).backgroundColor,
      title: c.querySelector('.act-card__title')?.textContent ?? '', textAlign: getComputedStyle(c.querySelector('.act-card__title')).textAlign,
      nested: c.querySelectorAll('.card:not(.check), .banner--warn').length,
      yellow: [c, ...c.querySelectorAll('*')].some((e) => ['rgb(255, 243, 214)'].includes(getComputedStyle(e).backgroundColor) && !e.closest('.badge, .mock-label')),
      overflow: document.documentElement.scrollWidth > innerWidth || [...c.querySelectorAll('*')].some((e) => e.getBoundingClientRect().right > cr.right + 0.5),
    };
  });
}
function expectActCard(r, head = '확인이 필요해요') {
  truthy(r.bg === 'rgb(255, 255, 255)' && r.border === 'rgb(228, 230, 234)' && r.bw === '1px' && r.radius >= 12, `회색 테두리·둥근 흰 카드 ${JSON.stringify(r)}`);
  truthy(r.headBg === 'rgb(237, 243, 252)' && r.headColor === 'rgb(49, 93, 168)' && r.headText === head && r.headIcon && r.headTop <= 1, `연한 블루 머리 ‘${head}’ ${JSON.stringify(r)}`);
  truthy(r.bodyBg === 'rgb(255, 255, 255)' || r.bodyBg === 'rgba(0, 0, 0, 0)', `흰 본문 ${r.bodyBg}`);
  truthy(r.textAlign === 'start' || r.textAlign === 'left', `왼쪽 정렬 ${r.textAlign}`);
  truthy(r.nested === 0 && !r.yellow && !r.overflow, `노란 바탕·안쪽 카드·넘침 없음 ${JSON.stringify(r)}`);
}

// ───────── 요청 상세: 보완 요청 카드(추가 정보 필요) ─────────
const infoCard = (page) => page.locator('section#info-req');
for (const w of [360, 1280]) {
  await test(`요청 상세 보완 카드(A) ${w}px: 공통 행동 카드(블루 머리·제목·업체명·실제 요청 내용·보완 버튼), 진행 단계 아래·일반 정보 위, 중복 안내·하단 버튼 없음, 버튼 44px, 긴 내용 줄바꿈, 키보드`, async (page) => {
    await page.setViewportSize({ width: w, height: 900 });
    const long = '손잡이 브랜드나 모델명이 보이는 사진을 한 장 더 올려 주세요. 문틀과 손잡이 사이 간격(mm)과 증상(헐거움·소음)도 알려 주세요. 아주긴영문모델명ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789도 그대로 보여요.';
    await start(page, { path: '/requests/rq-2' });
    await page.waitForFunction(() => !!window.__sagoDev);
    await page.evaluate((m) => { window.__sagoDev.db.requests.find((r) => r.id === 'rq-2').infoRequest.message = m; window.__sagoDev.setSettings({}); }, long);
    await page.getByText('아주긴영문모델명', { exact: false }).waitFor();
    await infoCard(page).waitFor();
    const t = (await infoCard(page).innerText()).replace(/\s+/g, ' ');
    for (const s of ['확인이 필요해요', '요청서를 보완해 주세요', '든든문고리의 요청', '모델명이 보이는 사진', '증상(헐거움·소음)', '요청서 보완하기']) truthy(t.includes(s), `카드 ‘${s}’: ${t}`);
    // 위치: 본문 첫 요소(진행 단계 바로 아래), 업체 연락·보낸 요청 정보보다 위
    eq(await page.evaluate(() => document.querySelector('main .act-card')?.id), 'info-req', '상단 확인 영역');
    truthy(await page.evaluate(() => { const c = document.getElementById('info-req').getBoundingClientRect(); const sec = [...document.querySelectorAll('main .section h2')].find((h) => h.textContent === '업체 연락'); return c.bottom <= sec.getBoundingClientRect().top; }), '일반 정보보다 위');
    expectActCard(await actCardStyle(infoCard(page)));
    const main = await page.locator('main').innerText();
    truthy(!main.includes('업체가 확인하고 싶은 내용이 있어요') && !main.includes('추가 정보 필요'), '이전 안내·배지 중복 없음');
    eq(await page.getByRole('link', { name: '요청서 보완하기' }).count(), 1, '보완 버튼 한 개(하단 없음)');
    truthy(await page.getByRole('link', { name: '보낸 요청 목록으로' }).isVisible() && await page.getByRole('button', { name: '이 업체 요청 철회하기' }).isVisible(), '하단 목록·철회 유지');
    truthy((await page.locator('nav.steps').innerText()).includes('업체 검토·견적'), '진행 단계 유지');
    const r = await infoCard(page).evaluate((c) => {
      const cr = c.getBoundingClientRect(); const btn = c.querySelector('.act-card__actions .btn'); const br = btn.getBoundingClientRect(); const msg = c.querySelector('.act-card__msg').getBoundingClientRect();
      return { btnH: Math.round(br.height), btnW: Math.round(br.width), inner: Math.round(cr.width - 2 - 32), gap: Math.round(br.top - msg.bottom), btnBelow: br.top >= msg.bottom };
    });
    truthy(r.btnH >= 44 && r.gap <= 40 && r.btnBelow && Math.abs(r.btnW - r.inner) <= 2, `하단 버튼 44px·카드 너비·내용 가까이 ${JSON.stringify(r)}`);
    // 키보드: 보완 버튼 포커스 → Enter로 기존 보완 화면
    await page.getByRole('link', { name: '요청서 보완하기' }).focus();
    truthy(await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle !== 'none'), '포커스 표시');
    await page.keyboard.press('Enter');
    await page.waitForURL((u) => u.pathname === '/requests/rq-2/supplement');
    if (w === 360) {
      // 보완 제출 → 재검토 상태: 보완 필요 카드 사라짐, 재검토 안내 유지
      await page.getByLabel('보완 내용').fill('모델명 사진을 추가했어요.');
      await page.getByRole('button', { name: '보완 내용 보내기' }).click();
      await waitText(page, '보완한 내용을 업체가 확인하고 있어요');
      eq(await infoCard(page).count(), 0, '재검토 상태에서는 보완 필요 카드 없음');
    } else {
      await page.goBack(); await infoCard(page).waitFor();
      await page.mouse.move(0, 0);
      await infoCard(page).screenshot({ path: join(ROOT, `e2e/screens/${w}_info_request.png`) });
    }
  }, { width: w });
}
await test('요청 상태: 거절·철회·만료·타 업체 예약으로 종료 안내', async (page) => {
  await start(page, { path: '/requests/rq-5' }); await waitText(page, '업체가 거절했어요');
  await page.goto(`${BASE}/requests/rq-6`); await waitText(page, '직접 취소한 요청이에요');
  await page.goto(`${BASE}/requests/rq-7`); await waitText(page, '결제 기한이 지나 예약이 확정되지 않았어요');
  await page.goto(`${BASE}/requests/rq-8`); await waitText(page, '다른 업체 예약이 확정됐어요');
});

await test('결제: 요청 상세에서 조건 확인 → 동의 → [예약금 {금액} 결제하기] → 예약 확정, 연타해도 거래 1건, 같은 묶음 다른 업체 요청은 데모 범위대로', async (page) => {
  await start(page, { path: '/requests/rq-3' });
  await page.waitForURL((u) => u.pathname === '/requests/rq-3');
  const sec = page.locator('section#pay');
  await sec.getByRole('heading', { name: '방문 일정과 금액을 확인해 주세요' }).waitFor();
  const st = await sec.innerText();
  const stx = st.replace(/\s+/g, ' ');
  // 기본 화면: 방문 일정 · 예상 총금액(안내 두 줄) · 지금 결제할 예약금(안내) · 예약금 결제 기한(남은 시간 같은 줄) + 접힌 펼치기 둘
  for (const k of ['확인이 필요해요', '방문 일정 10월 19일 (월) 10:00', '예상 총금액 약 112,500원', '작업 견적·자재비·내 예상 출장비를 포함한 금액이에요.', '자재비와 참여 세대 수에 따라 달라질 수 있어요.', '지금 결제할 예약금 50,000원', '예약금은 최종 정산 시 차감돼요.', '예약금 결제 기한 10월 14일 (수) 15:00 · 20시간 0분 남음', '견적 상세', '취소 조건', '방문 일정과 금액, 취소 조건을 확인했어요.', '모의 결제 · 실제 청구 없음']) truthy(stx.includes(k), `결제 카드 ‘${k}’: ${stx}`);
  // 기본 화면에서 뺀 정보: 요청 당시 가능 시간·접수 마감·예상 잔액·작업별 견적·반복 안내
  for (const gone of ['방문 가능한 시간', '13:00~16:00', '접수 마감', '잔액', '62,500원', '욕실 세면대 수전 교체', '그룹 총 출장비', '작업 견적 합계', '조건 확인에 동의하면', '도착 예정 시각']) truthy(!stx.includes(gone), `기본 화면에 없음 ‘${gone}’: ${stx}`);
  // 예약금은 연한 블루 강조 영역, 예상 총금액과 구분
  eq(await sec.locator('.pay-deposit').evaluate((e) => getComputedStyle(e).backgroundColor), 'rgb(237, 243, 252)', '예약금 강조 영역');
  const ap0 = (await db(page)).approvals.find((a) => a.requestId === 'rq-3');
  eq((await sec.locator('.pay-deposit__v').innerText()).trim(), ap0.depositAmount.toLocaleString('ko-KR') + '원', '예약금 = 실제 승인 데이터');
  // 펼치기: 기본 접힘 → 견적 상세(작업별 견적·합계·자재·내 출장비와 세대 기준·할인 조건·예상 총금액)
  eq((await sec.locator('.fold__btn').evaluateAll((bs) => bs.map((b) => b.textContent + ':' + b.getAttribute('aria-expanded')))).join(), '견적 상세:false,취소 조건:false', '펼치기 기본 접힘');
  await sec.locator('.fold__btn').filter({ hasText: '견적 상세' }).click();
  const es = (await page.locator('#pay-estimate-panel').innerText()).replace(/\s+/g, ' ');
  for (const k of ['욕실 세면대 수전 교체', '50,000원', '작업 견적 합계 80,000원', '부품·자재 예상 20,000원', '내 예상 출장비 약 12,500원', '예상 총금액 약 112,500원', '그룹 총 출장비 50,000원 ÷ 4세대', '확정 3세대 + 나', '결제 대기 중인 자리는 세지 않아요']) truthy(es.includes(k), `견적 상세 ‘${k}’: ${es}`);
  truthy(!es.includes('잔액'), '예상 잔액 없음');
  await sec.locator('.fold__btn').filter({ hasText: '취소 조건' }).click();
  const cs = (await page.locator('#pay-cancel-panel').innerText()).replace(/\s+/g, ' ');
  for (const k of ['접수 마감 전 취소 예약금을 전액 환불해요.', '접수 마감 후 취소 내 확정 출장비를 차감하고 나머지 예약금을 환불해요.', '업체 사유 취소 차감 없이 선결제 전액을 환불해요.', '별도 주문 자재', '회수 불가능 비용', '접수 마감: 10월 18일 (일) 18:00']) truthy(cs.includes(k), `취소 조건 ‘${k}’: ${cs}`);
  // 문구를 눌러도 체크, 체크 영역 안쪽 여백
  const chk = sec.locator('label.pay-check');
  truthy(parseFloat(await chk.evaluate((e) => getComputedStyle(e).paddingLeft)) >= 12 && parseFloat(await chk.evaluate((e) => getComputedStyle(e).paddingTop)) >= 12, '체크 영역 안쪽 여백');
  await chk.locator('span').click();
  eq(await page.getByRole('checkbox').isChecked(), true, '문구 클릭으로 선택');
  await page.getByRole('checkbox').uncheck();
  // B(예약 확정 전): 공통 행동 카드, 진행 단계 바로 아래·일반 정보 위, 상태 배지·설명 반복 없음
  expectActCard(await actCardStyle(sec));
  eq(await page.evaluate(() => document.querySelector('main .act-card')?.id), 'pay', '상단 확인 영역');
  eq(await page.locator('main .badge').filter({ hasText: '예약금 결제' }).count(), 0, '상세에 같은 상태 배지 반복 없음');
  // 중간 단계 버튼 없음(승인 조건 확인·새 예약 조건 확인)
  for (const b of ['승인 조건 확인하고 결제하기', '승인 조건 확인하기', '새 예약 조건 확인하기']) eq(await page.getByRole('link', { name: b }).or(page.getByRole('button', { name: b })).count(), 0, `${b} 없음`);
  const pay = page.getByRole('button', { name: PAY_BTN });
  eq(await pay.count(), 1, '주 행동 버튼 하나');
  const dep = (await db(page)).approvals.find((a) => a.requestId === 'rq-3').depositAmount;
  eq((await pay.innerText()).trim(), `예약금 ${dep.toLocaleString('ko-KR')}원 결제하기`, '버튼에 예약금 금액');
  truthy(await pay.isDisabled(), '동의 전에는 결제 버튼 비활성');
  eq((await db(page)).transactions.filter((t) => t.requestId === 'rq-3').length, 0, '동의 전 거래 없음');
  await page.getByRole('checkbox').check();
  await pay.dblclick();
  await waitText(page, '예약이 확정됐어요');
  const d = await db(page);
  eq(d.transactions.filter((t) => t.requestId === 'rq-3' && t.kind === 'deposit').length, 1, '예약금 거래 수');
  eq(d.requests.find((r) => r.id === 'rq-3').status, 'booked', '요청 상태');
  eq(d.requests.find((r) => r.id === 'rq-4').status, COMPARE ? 'closed_other_booking' : 'approved_pending_payment', '같은 묶음의 다른 업체 요청(데모: 개별 요청이라 그대로)');
  eq(d.bookings.filter((b) => b.requestId === 'rq-3').length, 1, '예약 수');
  // 결제 성공·예약 생성 확인 → 그 예약 상세로 바로 이동
  await page.waitForURL((u) => u.pathname === `/bookings/${d.requests.find((r) => r.id === 'rq-3').bookingId}`);
  await waitText(page, '방문 일정');
});

await test('결제 실패: 예약 미확정 → 다시 시도하면 성공', async (page) => {
  await start(page, { path: '/requests/rq-3/approval', patch: (d) => { d.settings.payOutcome = 'fail'; } });
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: PAY_BTN }).click();
  await waitText(page, '결제가 완료되지 않았어요');
  let d = await db(page);
  eq(d.requests.find((r) => r.id === 'rq-3').status, 'approved_pending_payment', '실패 후 요청 상태');
  eq(d.bookings.filter((b) => b.requestId === 'rq-3').length, 0, '실패 후 예약 없음');
  await patchDb(page, (x) => { x.settings.payOutcome = 'success'; }, null);
  await page.getByRole('link', { name: '요청 상세에서 다시 확인하기' }).click();
  await page.waitForURL((u) => u.pathname === '/requests/rq-3' && u.hash === '#pay');
  eq(await page.getByRole('checkbox').isChecked(), false, '다시 결제하려면 다시 동의');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: PAY_BTN }).click();
  await waitText(page, '예약이 확정됐어요');
  d = await db(page);
  eq(d.transactions.filter((t) => t.requestId === 'rq-3' && t.status === 'success').length, 1, '성공 거래');
});

await test('결제 처리 중·결과 확인 중: 재결제 차단, 결과 확인으로만 갱신', async (page) => {
  await start(page, { path: '/requests/rq-3/approval', patch: (d) => { d.settings.payOutcome = 'unknown'; } });
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: PAY_BTN }).click();
  await waitText(page, '결제 결과를 확인하고 있어요');
  await waitText(page, '다시 결제하지 마세요');
  await page.goto(`${BASE}/requests/rq-3`);
  await waitText(page, '결제 결과를 확인하는 중이라 다시 결제할 수 없어요');
  truthy(await page.getByRole('button', { name: PAY_BTN }).isDisabled(), '재결제 버튼 비활성');
  await patchDb(page, (d) => { d.settings.resolveOutcome = 'unknown'; }, null);
  await page.getByRole('link', { name: '결제 결과 확인하기' }).click();
  await page.getByRole('button', { name: '결제 결과 확인하기' }).click();
  await waitText(page, '결제 결과를 확인하고 있어요'); // 여전히 확인 중
  eq((await db(page)).transactions.filter((t) => t.requestId === 'rq-3').length, 1, '거래 수 유지');
  await patchDb(page, (d) => { d.settings.resolveOutcome = 'success'; }, null);
  await page.getByRole('button', { name: '결제 결과 확인하기' }).click();
  await waitText(page, '예약이 확정됐어요');
  eq((await db(page)).transactions.filter((t) => t.requestId === 'rq-3' && t.kind === 'deposit').length, 1, '최종 거래 수');
});

await test('결제: 승인 조건 버전이 바뀌면 동의가 초기화된다', async (page) => {
  await start(page, { path: '/requests/rq-3/approval' });
  await page.getByRole('checkbox').check();
  await dev(page, 'bumpApprovalVersion', 'rq-3');
  await page.waitForFunction(() => !document.querySelector('input[type=checkbox]').checked);
  truthy(await page.getByRole('button', { name: PAY_BTN }).isDisabled(), '버전 변경 후 결제 버튼 비활성');
});

await test('재확인: 기존 그룹 종료 → 새 조건 동의 후 결제', async (page) => {
  // 목록: 예약금 결제 + 할 일 ‘예약금을 결제해 주세요’(별도 ‘승인 조건 변경’ 상태 없음)
  await start(page, { path: '/bookings?tab=requests' });
  const card = page.locator('main .request-list > li').filter({ has: page.locator('a[href="/requests/rq-10"]') });
  await card.locator('.badge').first().waitFor();
  eq((await card.locator('.badge').allInnerTexts()).join(), '예약금 결제', '목록 대표 상태');
  eq(await todoOf(card), '예약금을 결제해 주세요', '목록 할 일');
  await page.goto(`${BASE}/requests/rq-10`);
  await waitText(page, '방문 일정과 금액을 확인해 주세요');
  eq(await page.getByRole('link', { name: '새 예약 조건 확인하기' }).count(), 0, '중간 확인 버튼 없음');
  await waitText(page, '기존 공동 예약이 종료됐어요');
  await waitText(page, '혼자 부담할 수도 있어요');
  const st = await page.locator('section#pay').innerText();
  const rx = st.replace(/\s+/g, ' ');
  // 요청 당시와 달라진 일정·예약금만 간결하게(이전 → 새), 동의 문구도 바뀐 조건 기준
  for (const k of ['확인이 필요해요', '일정과 금액이 바뀌었어요', '이전 일정 (종료됨)', '예약금 50,000원', '새 방문 일정', '예약금 60,000원', '지금 결제할 예약금 60,000원', '예상 총금액', '예약금 결제 기한', '바뀐 방문 일정과 금액, 취소 조건을 확인했어요.']) truthy(rx.includes(k), `바뀐 조건 ‘${k}’: ${rx}`);
  truthy(!rx.includes('새 접수 마감') && !rx.includes('방문 가능한 시간'), '기본 화면에 접수 마감·가능 시간 없음');
  // 이전 → 새 일정은 두 칸 나란히
  const cmp = await page.locator('section#pay .sched-compare__item').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
  truthy(cmp.length === 2 && cmp[0] === cmp[1], `일정 비교 나란히 ${cmp}`);
  truthy(await page.getByRole('button', { name: PAY_BTN }).isDisabled(), '동의 전 비활성');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: PAY_BTN }).click();
  await waitText(page, '예약이 확정됐어요');
});

await test('결제: 승인 만료·종료 요청은 결제 영역·버튼 없음, 이전 승인 조건 주소는 요청 상세(#pay)로', async (page) => {
  await start(page, { path: '/requests/rq-7/approval' });
  await page.waitForURL((u) => u.pathname === '/requests/rq-7');
  await waitText(page, '결제 기한이 지나 예약이 확정되지 않았어요');
  eq(await page.locator('section#pay').count(), 0, '만료: 결제 영역 없음');
  eq(await page.getByRole('button', { name: PAY_BTN }).count(), 0, '만료: 결제 버튼 없음');
  // 결제 기한이 지난 뒤 누르면 결제하지 않고 최신 상태로
  await page.goto(`${BASE}/requests/rq-3/approval`);
  await page.waitForURL((u) => u.pathname === '/requests/rq-3' && u.hash === '#pay');
  await page.getByRole('checkbox').check();
  await dev(page, 'expireApproval', 'rq-3');
  await page.getByRole('button', { name: PAY_BTN }).click().catch(() => {});
  await waitText(page, '결제 기한이 지나 예약이 확정되지 않았어요');
  eq((await db(page)).transactions.filter((t) => t.requestId === 'rq-3').length, 0, '만료 후 거래 없음');
  eq((await db(page)).bookings.filter((b) => b.requestId === 'rq-3').length, 0, '만료 후 예약 없음');
  await page.goto(`${BASE}/requests/rq-10/recheck`);
  await page.waitForURL((u) => u.pathname === '/requests/rq-10' && u.hash === '#pay');
  await waitText(page, '일정과 금액이 바뀌었어요');
});

// ───────── 데모 범위: 단일 업체 요청(비교 요청 숨김) ─────────
if (!COMPARE) {
  await test('데모 범위: 비교 요청 UI 없음 — 보낸 요청은 업체 요청마다 카드 하나·각자 상세, 건수 = 요청 수, 비교 문구·버튼 없음', async (page) => {
    await start(page, { path: '/bookings?tab=requests' });
    const n = await countText(page);
    const links = await page.locator('main .request-list > li > a').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
    eq(n, `보낸 요청 ${links.length}건`, '건수 = 표시된 요청 수');
    truthy(links.length > 0 && links.every((h) => (h.startsWith("/requests/rq-") && h.split("/").length === 3)), `모두 개별 요청 상세: ${links}`);
    eq(new Set(links).size, links.length, '같은 요청 중복 없음');
    truthy(links.includes('/requests/rq-3') && links.includes('/requests/rq-4'), '같은 묶음의 업체 요청도 각각');
    const main = await page.locator('main').innerText();
    for (const t of ['개 업체에 요청', '비교해서 하나를 고를 수 있어요', '요청 묶음', '목록에서만 숨겼어요']) truthy(!main.includes(t), `목록에 ‘${t}’ 없음`);
    await page.getByRole('button', { name: /^요청 상태 필터/ }).click();
    const dlgText = await page.getByRole('dialog').innerText();
    truthy(!dlgText.includes('비교'), '상태 필터에 비교 항목 없음');
    await page.keyboard.press('Escape');
    // 카드 → 그 요청 상세
    await page.locator('a[href="/requests/rq-4"]').click();
    await page.waitForURL((u) => u.pathname === '/requests/rq-4');
    await page.locator('section#pay').waitFor();
    const det = await page.locator('main').innerText();
    for (const t of ['같은 작업을 다른 업체에도 요청하기', '하나를 예약하면 나머지 요청은 종료돼요', '개 업체에 요청', '비교 요청']) truthy(!det.includes(t), `상세에 ‘${t}’ 없음`);
    // 철회 확인에 비교 요청 보조 설명 없음
    await page.getByRole('button', { name: '이 업체 요청 철회하기' }).click();
    truthy(!(await page.getByRole('dialog').innerText()).includes('다른 업체에 보낸 요청은 유지돼요'), '철회 확인에 비교 설명 없음');
  });

  await test('데모 범위: 이전 비교 요청 주소 → 보낸 요청 목록(여러 업체)·요청 상세(한 업체)·없는 묶음도 목록으로(빈 화면 없음), 묶음 데이터 보존', async (page) => {
    await start(page, { path: '/requests/bundle/b-sink' });
    await page.waitForURL((u) => u.pathname === '/bookings' && u.search.includes('tab=requests'));
    await countText(page);
    eq(await page.locator('.resp-card').count(), 0, '비교 화면 없음');
    await page.goto(`${BASE}/requests/bundle/b-sink`);
    await page.waitForURL((u) => u.pathname === '/bookings');
    await page.goBack(); // 바꿔 이동했으므로 비교 주소로 되돌아가지 않는다
    await page.waitForTimeout(300);
    truthy(!new URL(page.url()).pathname.startsWith('/requests/bundle/'), `뒤로가기로 비교 주소 반복 없음: ${page.url()}`);
    const d = await db(page);
    const solo = d.requests.find((r) => d.requests.filter((x) => x.bundleId === r.bundleId).length === 1 && r.status === 'reviewing');
    await page.goto(`${BASE}/requests/bundle/${solo.bundleId}`);
    await page.waitForURL((u) => u.pathname === `/requests/${solo.id}`);
    await page.locator('.app-header__title').filter({ hasText: '요청 상세' }).waitFor();
    await page.goto(`${BASE}/requests/bundle/b-nope`);
    await page.waitForURL((u) => u.pathname === '/bookings' && u.search.includes('tab=requests'));
    await countText(page);
    const after = await db(page);
    eq(after.requests.filter((r) => r.bundleId === 'b-sink').length, 2, '묶음 데이터 그대로(삭제·재전송 없음)');
    eq(after.requests.length, d.requests.length, '요청 수 그대로');
  });

  await test('데모 범위: 여러 작업 선택 → 단일 업체 요청 제출 → 완료 화면·요청 상세(비교 문구 없음)', async (page) => {
    await start(page, { path: '/providers/p1/request?new=1&date=2026-10-21' });
    await pickTask(page, '수전 교체', '주방 수전');
    await pickTask(page, '샤워기 교체', '욕실 샤워기');
    await timeChip(page, '09:00').check();
    await detailInput(page).fill('301동 1204호');
    await page.getByRole('button', { name: '요청 보내기' }).click();
    await page.getByRole('heading', { name: '수리 요청을 보냈어요' }).waitFor();
    const t = await page.locator('.sent').innerText();
    truthy(t.includes('수리 요청을 보냈어요') && t.includes('한빛설비') && !t.includes('개 업체'), `단일 업체 완료 화면: ${t}`);
    await page.getByRole('link', { name: '요청 내용 확인하기' }).click();
    await page.waitForURL((u) => (u.pathname.startsWith("/requests/rq-") && u.pathname.split("/").length === 3));
    await waitText(page, '수전 교체'); await waitText(page, '샤워기 교체');
  });

  for (const w of [360, 390, 1280]) {
    await test(`예약금 결제 영역 ${w}px: 조건·동의·결제 버튼이 잘리거나 넘치지 않음, 버튼 높이·전체 너비(모바일), 새 조건도 동일`, async (page) => {
      for (const id of ['rq-3', 'rq-10']) {
        await start(page, { path: `/requests/${id}#pay` });
        const sec = page.locator('section#pay');
        await sec.getByRole('button', { name: PAY_BTN }).waitFor();
        const r = await page.evaluate(() => {
          const sec = document.getElementById('pay');
          const btn = [...sec.querySelectorAll('button')].find((b) => /결제하기$/.test(b.textContent));
          const chk = sec.querySelector('label.pay-check').getBoundingClientRect();
          const b = btn.getBoundingClientRect(); const sb = sec.getBoundingClientRect();
          const clipped = [...sec.querySelectorAll('*')].some((e) => e.scrollWidth > e.clientWidth + 1 && !['visible', 'auto', 'scroll'].includes(getComputedStyle(e).overflowX));
          return { overflow: document.documentElement.scrollWidth > innerWidth, clipped, btnH: Math.round(b.height), btnW: Math.round(b.width), secW: Math.round(sb.width), btnBelowCheck: b.top >= chk.bottom, fixed: getComputedStyle(btn.parentElement).position === 'fixed' || getComputedStyle(btn).position === 'fixed' };
        });
        truthy(!r.overflow && !r.clipped, `가로 넘침·잘림 없음 ${id} ${JSON.stringify(r)}`);
        truthy(r.btnH >= 44 && r.btnBelowCheck && !r.fixed, `버튼 높이·동의 아래·고정 아님 ${JSON.stringify(r)}`);
        if (w < 768) truthy(Math.abs(r.btnW - (r.secW - 34)) <= 2, `모바일 카드 안 전체 너비 ${JSON.stringify(r)}`);
        await sec.screenshot({ path: join(ROOT, `e2e/screens/${w}_deposit_pay_${id}.png`) });
      }
    }, { width: w });
  }
}

await test('시나리오 훅: 업체 승인 이벤트 → 알림 진입(S-02) → 결제 대기 / 상태 변경 후 최신 안내', async (page) => {
  await start(page, { path: '/requests/rq-1' });
  let r = await dev(page, 'approveRequest', 'rq-1', ''); // 방문 시각 없이 승인하면 거절
  truthy(!r.ok && r.message.includes('업체 제안 방문 시각이 필요해요'), r.message);
  r = await dev(page, 'approveRequest', 'rq-1', '20:00'); // 고객 가능 시간 밖
  truthy(!r.ok && r.message.includes('고객 가능 시간(09:00~12:00, 13:00~16:00) 안의 시각이어야 해요'), r.message);
  r = await dev(page, 'approveRequest', 'rq-1', '10:30');
  truthy(r.ok && r.message.includes('승인했어요'), r.message);
  eq((await db(page)).approvals.find((a) => a.requestId === 'rq-1').visitTime, '10:30', '업체 제안 방문 시각');
  const noticeId = (await db(page)).notices[0].id;
  await dev(page, 'expireApproval', 'rq-1');
  await page.goto(`${BASE}/notice/${noticeId}`);
  await waitText(page, '알림 이후 내용이 바뀌었어요');
});

await test('예약 목록·상세: 확정된 예약/완료·취소, 마감 후 확정 출장비, 타 세대 정보 비노출', async (page) => {
  await start(page, { path: '/bookings?tab=active' });
  // 목록: 대표 상태 + (응답이 필요할 때만) 확인 필요 라벨. 구체 행동 문장·정보 아이콘은 목록에 없다(상세에서)
  const k3 = page.locator('a[href="/bookings/bk-k3"]');
  await k3.locator('.badge').first().waitFor();
  eq((await k3.locator('.badge').allInnerTexts()).join(), '방문 예정', '대표 상태 배지 하나(확인 필요 배지 없음)');
  eq(await todoOf(k3), '방문 지연 대응을 선택해 주세요', '지연 대응 할 일');
  eq(await page.locator('main .booking-list .badge').filter({ hasText: '확인 필요' }).count(), 0, '확인 필요 배지 없음');
  const listText = await page.locator('main .booking-list').innerText();
  for (const gone of ['지연되고 있어요', '추가 작업 동의가 필요해요', '자재 조건을 확인하고', '금액을 협의 중이에요', '리뷰를 작성할 수 있어요', '결제 결과를 확인 중이에요']) truthy(!listText.includes(gone), `목록 설명 문구 없음: ${gone}`);
  eq(await page.locator('main .booking-list svg').count(), 0, '목록의 정보 아이콘 없음');
  // 할 일 영역: 회색 구분선 + 12px, 주황 점(6~8px) + 8px + 차콜 600 본문 문구. 카드 바탕·테두리는 그대로
  const st = await k3.evaluate((a) => {
    const t = a.querySelector('.card-todo'); const d = a.querySelector('.card-todo__dot'); const ts = getComputedStyle(t); const ds = getComputedStyle(d); const cs = getComputedStyle(a);
    return { line: ts.borderTopColor, pad: ts.paddingTop, color: ts.color, weight: ts.fontWeight, size: ts.fontSize, dot: [Math.round(d.getBoundingClientRect().width), ds.backgroundColor, d.getAttribute('aria-hidden')], gap: ts.columnGap, cardBg: cs.backgroundColor, cardBorder: cs.borderTopColor, status: [getComputedStyle(a.querySelector('.badge')).backgroundColor, getComputedStyle(a.querySelector('.badge')).color] };
  });
  eq(JSON.stringify(st), JSON.stringify({ line: 'rgb(228, 230, 234)', pad: '12px', color: 'rgb(32, 36, 44)', weight: '600', size: '15px', dot: [7, 'rgb(181, 73, 12)', 'true'], gap: '8px', cardBg: 'rgb(255, 255, 255)', cardBorder: 'rgb(228, 230, 234)', status: ['rgb(237, 243, 252)', 'rgb(49, 93, 168)'] }), '할 일 영역 디자인');
  // 할 일이 없는 카드: 행동 영역·구분선 없음 · 결제 결과·업체 응답 대기·금액 협의 중에는 문구 없음
  eq(await todoOf(page.locator('a[href="/bookings/bk-k2"]')), '', '할 일 없는 예약');
  eq((await page.locator('a[href="/bookings/bk-k2"] .badge').allInnerTexts()).join(), '방문 예정', '할 일 없는 예약 배지');
  eq((await page.locator('a[href="/bookings/bk-k9"] .badge').allInnerTexts()).join(), '최종 정산', '최종 정산(대표 상태)');
  eq(await todoOf(page.locator('a[href="/bookings/bk-k9"]')), '최종 금액을 확인해 주세요', '최종 금액 할 일');
  eq((await page.locator('a[href="/bookings/bk-k12"] .badge').allInnerTexts()).join(), '정산 진행 중', '금액 협의 중 → 정산 진행 중');
  eq(await todoOf(page.locator('a[href="/bookings/bk-k12"]')), '', '금액 협의 중에는 할 일 없음');
  for (const [id, todo] of [['bk-k4', '새 일정을 확인해 주세요'], ['bk-k5', '자재 주문 조건을 확인해 주세요'], ['bk-k6', '추가 작업을 확인해 주세요']]) eq(await todoOf(page.locator(`a[href="/bookings/${id}"]`)), todo, `${id} 할 일`);
  // 카드를 누르면 상세 상단 해당 확인 카드(실제 행동 버튼)
  await page.locator('a[href="/bookings/bk-k6"]').click();
  await page.waitForURL((u) => u.pathname === '/bookings/bk-k6');
  await page.getByRole('button', { name: '동의하기' }).waitFor();
  eq(await page.evaluate(() => document.querySelector('main .act-card')?.id), 'additional-aw-1', '상세 상단 추가 작업 카드');
  await page.goBack();
  await page.waitForURL((u) => u.pathname === '/bookings');
  await page.locator('a[href="/bookings/bk-k7"] .badge').first().waitFor();
  eq((await page.locator('a[href="/bookings/bk-k7"] .badge').allInnerTexts()).join(), '방문 예정', '후속 방문 일정 확정 → 방문 예정');
  truthy((await page.locator('a[href="/bookings/bk-k7"]').innerText()).includes('후속 방문 예정 · 10월 20일'), '후속 방문 날짜 표시');
  await page.getByRole('tab', { name: '완료·취소' }).click();
  await waitText(page, '예약 취소');
  const pastBadges = await page.locator('main .booking-list .badge').evaluateAll((els) => els.map((e) => [e.textContent, getComputedStyle(e).backgroundColor]));
  truthy(pastBadges.every(([t, bg]) => (t === '예약 취소' && bg === 'rgb(238, 240, 243)') || (t === '이용 완료' && bg === 'rgb(232, 244, 236)')), `완료·취소 색: ${JSON.stringify(pastBadges)}`);
  await page.goto(`${BASE}/bookings/bk-k2`);
  await openFold(page, '공동 예약 정보'); // 마감 후: 내 확정 출장비 + 마감 시 세대 기준 계산
  await waitText(page, '내 확정 출장비'); await waitText(page, '12,500원'); await waitText(page, '÷ 4세대');
  await waitText(page, '다른 세대의 주소·작업·사진은 보이지 않아요');
  // 마감 전 공동 예약: ‘확정 출장비’가 아니라 현재 예상 출장비와 계산 기준
  const open = (await db(page)).bookings.map((b) => ({ b, g: null })).length && await page.evaluate(() => { const d = window.__sagoDev.db; const b = d.bookings.find((x) => x.status === 'confirmed' && x.lockedTripFee === undefined && !d.groups.find((g) => g.id === x.groupId).closed); return b ? b.id : null; });
  if (open) {
    await page.goto(`${BASE}/bookings/${open}`);
    await openFold(page, '공동 예약 정보');
    const g = (await page.locator('#fold-group-panel').innerText()).replace(/\s+/g, ' ');
    truthy(g.includes('현재 예상 출장비') && !g.includes('내 확정 출장비') && g.includes('접수 상태 접수 중') && g.includes('지금 확정된 세대 기준 예상'), `마감 전 예상 금액: ${g}`);
  } else {
    // 시드에 마감 전 예약이 없으면 한 예약의 그룹을 접수 중으로 되돌려 확인한다
    await patchDb(page, (d) => { const b = d.bookings.find((x) => x.id === 'bk-k2'); const g = d.groups.find((x) => x.id === b.groupId); g.closed = false; }, '/bookings/bk-k2');
    await openFold(page, '공동 예약 정보');
    const g = (await page.locator('#fold-group-panel').innerText()).replace(/\s+/g, ' ');
    truthy(g.includes('현재 예상 출장비') && !g.includes('내 확정 출장비') && g.includes('접수 상태 접수 중'), `마감 전 예상 금액: ${g}`);
  }
  const html = await page.content();
  truthy(!/anchorKey|radius:|complex:/.test(html), '내부 기준 키 노출');
});

// ───────── 예약 상세: 예약 정보 · 작업·방문 주소 · 금액·정산(최종 금액 확인 통합) ─────────
const costCard = (page) => page.locator('#settlement');
const costText = async (page) => (await costCard(page).innerText()).replace(/\s+/g, ' ');
const heroText = async (page) => (await page.locator('#settlement .cost__balance').innerText()).replace(/\s+/g, ' ').trim();
const openDetail = async (page, name) => { const s = costCard(page).locator('summary').filter({ hasText: name }); await s.click(); };
const payBtn = (page, re) => costCard(page).getByRole('button', { name: re });
/** 금액 행: 라벨과 금액 사이에 계산 근거 문구가 있을 수 있다 */
const hasRow = (t, label, amount) => new RegExp(label + '[\\s\\S]{0,90}?' + amount).test(t);
const loadBooking = async (page, id) => { await page.goto(`${BASE}/bookings/${id}`); await costCard(page).waitFor(); await page.locator('#settlement .cost__balance').waitFor(); };

await test('예약 상세 구성: (확인 카드) → 예약 정보 / 방문 주소 / 작업 내용 세 카드 → (최종 금액 등록 후) 금액·정산 → 예약 목록으로, 반복 상태 배지 없음, 펼치기 기본 닫힘(일정 변경 내역·요청 당시 내용 없음)', async (page) => {
  await start(page, { path: '/bookings/bk-k9' });
  await costCard(page).waitFor();
  // 최종 금액 확인 대기(E): 기존 금액·정산 카드가 상단 확인 영역으로(별도 중복 카드 없음)
  const h9 = await page.locator('main h2').allInnerTexts();
  truthy(h9.indexOf('최종 금액을 확인해 주세요') === 0 && h9.indexOf('예약 정보') > 0 && !h9.includes('금액·정산'), `본문 순서 ${h9}`);
  // 최종 금액 등록 전 상태가 아니면(정산 진행 중 등) 금액·정산은 예약 정보 아래
  await page.goto(`${BASE}/bookings/bk-k12`);
  await costCard(page).waitFor();
  const h12 = await page.locator('main h2').allInnerTexts();
  truthy(h12.indexOf('예약 정보') < h12.indexOf('방문 주소') && h12.indexOf('방문 주소') < h12.indexOf('작업 내용') && h12.indexOf('작업 내용') < h12.indexOf('금액·정산') && !h12.includes('최종 금액을 확인해 주세요'), `정산 진행 중 순서 ${h12}`);
  // 결제 내역은 한 곳에서만: 금액·정산 카드가 있으면 예약 정보에는 결제 내역 펼치기가 없다
  eq(await foldBtn(page, '결제 내역').count(), 0, '금액·정산 카드가 있으면 예약 정보 결제 내역 없음');
  eq(await costCard(page).locator('summary').filter({ hasText: '결제 내역' }).count(), 1, '금액·정산 카드의 결제 내역');
  await page.goto(`${BASE}/bookings/bk-k4`);
  await page.getByRole('heading', { name: '예약 정보', exact: true }).waitFor();
  const heads = await page.locator('main h2').allInnerTexts();
  for (const gone of ['방문 일정·진행', '공동 예약', '예약 금액·결제', '내 작업·방문 주소', '작업·방문 주소', '자재·추가 작업', '예약 관리', '일정 변경']) truthy(!heads.includes(gone), `이전 영역 남음: ${gone}`);
  eq(heads.join('|'), '새 방문 일정을 확인해 주세요|예약 정보|방문 주소|작업 내용', `확인 카드 → 예약 정보 → 방문 주소 → 작업 내용 순서: ${heads}`);
  // 세 영역은 각각 제목 + 흰 둥근 카드(같은 너비·회색 테두리)
  const cardsStyle = await page.evaluate(() => ['booking-info', 'work', 'visit-address'].map((id) => { const e = document.getElementById(id); const cs = getComputedStyle(e); return [cs.backgroundColor, cs.borderTopColor, parseFloat(cs.borderTopLeftRadius) >= 12, Math.round(e.getBoundingClientRect().width)].join(); }));
  truthy(new Set(cardsStyle).size === 1 && cardsStyle[0].startsWith('rgb(255, 255, 255),rgb(228, 230, 234),true'), `세 카드 같은 스타일·너비: ${cardsStyle}`);
  const info = await sectionText(page, '예약 정보');
  for (const s of ['깔끔마감', '깔끔마감에 전화', '방문 일정 방문 일정 조율 중', '공동 예약 정보', '결제 내역']) truthy(info.includes(s), `예약 정보 ‘${s}’: ${info}`);
  truthy(!info.includes('일정 변경 내역'), `일정 변경 내역 펼치기 없음: ${info}`);
  for (const gone of ['진행 상태', '일정 조율 중 일정', '작업 전', '응답 전', '욕실 실리콘 보수', '햇살로', '결제한 금액', '10월 14일']) truthy(!info.includes(gone), `예약 정보에 없음 ‘${gone}’: ${info}`);
  truthy(!info.includes('제안된 새 일정') && !info.includes('10월 19일 (월) 10:00'), '진행 중 제안 비교는 상단 카드에서만');
  eq(await page.locator('#booking-info .badge, #work .badge, #visit-address .badge').count(), 0, '세 카드에 상태 배지 없음');
  const work = await sectionText(page, '작업 내용');
  truthy(work.includes('욕실 실리콘 보수') && work.includes('곰팡이 제거 후 재시공') && !work.includes('요청 당시 내용') && !work.includes('원본 요청 기록 보기') && !work.includes('요청 방식') && !work.includes('요청일') && !work.includes('방문 가능한 시간') && !work.includes('자재·추가 작업 상세'), `작업 내용(작업명·설명만, 요청 당시 내용·원본 링크·요청 정보 없음, 자재·추가 작업 없으면 펼치기 생략): ${work}`);
  const addr = await sectionText(page, '방문 주소');
  truthy(addr.includes('햇살로') && addr.includes('301동') && addr.includes('연락받을 분') && /010-\*{4}-\d{4}/.test(addr) && addr.includes('나와 이 업체만 볼 수 있어요') && !addr.includes('원') && !addr.includes('방문 일정'), `방문 주소: ${addr}`);
  // 펼치기: 기본 닫힘, aria-expanded·연결 영역, 여러 개 동시에 열림
  const folds = await page.locator('.fold__btn').evaluateAll((bs) => bs.map((b) => [b.textContent, b.getAttribute('aria-expanded'), !!document.getElementById(b.getAttribute('aria-controls')), document.getElementById(b.getAttribute('aria-controls')).getAttribute('aria-labelledby') === b.id, document.getElementById(b.getAttribute('aria-controls')).hidden].join()));
  eq(folds.join('|'), '공동 예약 정보,false,true,true,true|결제 내역,false,true,true,true', '펼치기 기본 닫힘·연결(일정 변경 내역·요청 당시 내용 없음)');
  // 키보드: 포커스 → Enter로 열기, Space로 닫기, 포커스 표시
  await foldBtn(page, '공동 예약 정보').focus();
  await page.keyboard.press('Enter');
  eq(await foldBtn(page, '공동 예약 정보').getAttribute('aria-expanded'), 'true', 'Enter로 열림');
  await page.keyboard.press('Tab');
  eq(await page.evaluate(() => document.activeElement?.textContent), '결제 내역', 'Tab으로 다음 펼치기');
  truthy(await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle !== 'none'), '포커스 표시');
  await page.keyboard.press('Space');
  eq((await page.locator('.fold__btn[aria-expanded="true"]').allInnerTexts()).join(), '공동 예약 정보,결제 내역', '여러 펼치기 동시에 열림');
  const grp = (await page.locator('#fold-group-panel').innerText()).replace(/\s+/g, ' ');
  for (const s of ['참여 확정 세대 3세대', '접수 상태 마감됨', '접수 마감 10월 13일 (화) 18:00', '내 확정 출장비 16,666원', '그룹 총 출장비 50,000원', '÷ 3세대', '다른 세대의 주소·작업·사진은 보이지 않아요']) truthy(grp.includes(s), `공동 예약 정보 ‘${s}’: ${grp}`);
  const pays = (await page.locator('#fold-payments-panel').innerText()).replace(/\s+/g, ' ');
  truthy(pays.includes('예약금') && pays.includes('결제 완료') && pays.includes('50,000원') && pays.includes('10월 9일') && (pays.match(/50,000원/g) ?? []).length === 1, `결제 내역(예약금 한 번, 상태·날짜): ${pays}`);
  // 정보가 다시 조회돼도 열어둔 영역은 닫히지 않는다
  await page.evaluate(() => window.__sagoDev.setSettings({}));
  await page.waitForTimeout(300);
  eq((await page.locator('.fold__btn[aria-expanded="true"]').allInnerTexts()).join(), '공동 예약 정보,결제 내역', '갱신 후에도 열림 유지');
  // 일정 변경 내역 펼치기는 없지만 기록·기존 날짜 데이터는 그대로
  eq(await page.locator('#fold-schedule, #fold-schedule-panel, #fold-origin, #fold-origin-panel').count(), 0, '제거한 펼치기 없음');
  eq((await db(page)).bookings.find((x) => x.id === 'bk-k4').visitDate, '2026-10-14', '기존 방문 날짜 데이터 보존');
  truthy((await db(page)).proposals.some((x) => x.bookingId === 'bk-k4'), '일정 변경 제안 기록 보존');
  const main = await page.locator('main').innerText();
  for (const gone of ['최초 요청 내용 보기', '최종 내역 보기', '확정된 예약으로']) truthy(!main.includes(gone), `링크 남음: ${gone}`);
  // 작업명·설명은 작업 카드에서 한 번만, 원본 요청 링크 없음(원본 요청 데이터는 보존)
  eq((main.match(/욕실 실리콘 보수/g) ?? []).length, 1, '작업명 한 번만');
  eq((main.match(/곰팡이 제거 후 재시공/g) ?? []).length, 1, '작업 설명 한 번만');
  eq(await page.getByRole('link', { name: '원본 요청 기록 보기' }).count(), 0, '원본 요청 기록 링크 없음');
  eq(await page.locator('#work img').count(), 0, '첨부하지 않은 사진을 이미지로 만들지 않음');
  // 모바일·데스크톱: 펼친 상태에서 긴 주소·금액이 잘리거나 가로로 넘치지 않음
  for (const w of [360, 1280]) {
    await page.setViewportSize({ width: w, height: 900 });
    const o = await page.evaluate(() => ({ page: document.documentElement.scrollWidth > innerWidth, out: [...document.querySelectorAll('#booking-info *, #work *, #visit-address *')].filter((e) => { const c = e.closest('.card').getBoundingClientRect(); const r = e.getBoundingClientRect(); return r.width > 0 && r.right > c.right + 0.5; }).length }));
    truthy(!o.page && o.out === 0, `${w}px 넘침 없음 ${JSON.stringify(o)}`);
    if (w === 360) await page.screenshot({ path: join(ROOT, 'e2e/screens/360_booking_detail_sections.png'), fullPage: true });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  const bk4 = (await db(page)).bookings.find((x) => x.id === 'bk-k4');
  truthy((await db(page)).requests.some((r) => r.id === bk4.requestId && r.tasks.length > 0), '원본 요청 데이터 보존');
  // 하단: 예약 목록으로(마지막), 일정 변경·취소 유지
  const last = await page.evaluate(() => [...document.querySelectorAll('main .stack > *')].at(-1).textContent);
  truthy(last.includes('예약 목록으로'), `마지막은 예약 목록으로: ${last}`);
  await page.getByRole('link', { name: '예약 취소하기' }).waitFor();
  eq(await page.getByRole('link', { name: /업체 변경 제안|일정 변경을 제안했어요/ }).count(), 0, '별도 변경 확인 화면으로 가는 링크 없음');
});

await test('금액·정산 표시 기준: 방문 예정·작업 중·후속 작업은 카드·예상 정산액·확인 버튼 없음(빈 여백 없음), 결제 기록은 예약 정보의 결제 내역에, 동의 금액 유지, 날짜·작업 상태만으로 표시하지 않음, 0원 등록과 미등록 구분', async (page) => {
  await start(page, { path: '/bookings/bk-k4' });
  await page.getByRole('heading', { name: '예약 정보', exact: true }).waitFor();
  for (const id of ['bk-k4', 'bk-k6', 'bk-k7']) {
    await page.goto(`${BASE}/bookings/${id}`);
    await page.getByRole('heading', { name: '예약 정보', exact: true }).waitFor();
    const main = await page.locator('main').innerText();
    eq(await page.locator('#settlement').count(), 0, `${id} 금액·정산 카드 없음`);
    truthy(!main.includes('예상 추가 결제액') && !main.includes('결제할 금액') && !main.includes('금액·정산'), `${id} 예상 정산액·제목 없음`);
    eq(await page.getByRole('checkbox').count(), 0, `${id} 확인 체크 없음`);
    // 숨긴 영역 여백 없음: 마지막 정보 카드(작업 내용) 섹션 다음은 (리뷰 또는) 하단 버튼
    const next = await page.evaluate(() => { const s = document.getElementById('work').closest('section'); const n = s.nextElementSibling; return { cls: n?.className ?? '', gap: Math.round(n.getBoundingClientRect().top - s.getBoundingClientRect().bottom) }; });
    truthy(next.cls.includes('detail-actions') && next.gap === 24, `${id} 작업 내용 다음 바로 하단 버튼(24px) ${JSON.stringify(next)}`);
    // 예약 정보 > 결제 내역: 예약금 기록(처리 상태·날짜), ‘결제한 금액’ 요약 반복 없음
    await openFold(page, '결제 내역');
    const t = (await page.locator('#fold-payments-panel').innerText()).replace(/\s+/g, ' ');
    truthy(t.includes('예약금') && t.includes('결제 완료') && !t.includes('결제한 예약금') && !(await page.locator('main').innerText()).includes('결제한 금액'), `${id} 결제 내역: ${t}`);
  }
  // 추가 작업 동의 금액은 상단 확인 카드·작업 카드에 유지
  await page.goto(`${BASE}/bookings/bk-k6`);
  await waitText(page, '추가 작업에 동의해 주세요');
  truthy((await page.locator('main').innerText()).includes('25,000원'), '추가 작업 금액');
  await page.goto(`${BASE}/bookings/bk-k5`);
  await waitText(page, '자재 주문 조건을 확인해 주세요');
  // 방문일이 지나고 작업 상태가 바뀌어도 최종 금액이 없으면 카드 없음
  await patchDb(page, (d) => { const b = d.bookings.find((x) => x.id === 'bk-k1'); b.visitDate = '2026-10-01'; b.workStatus = 'final_confirm_waiting'; }, '/bookings/bk-k1');
  await page.getByRole('heading', { name: '예약 정보', exact: true }).waitFor();
  eq(await page.locator('#settlement').count(), 0, '최종 금액 미등록이면 날짜·작업 상태만으로 표시하지 않음');
  // 최종 금액이 0원이어도 등록됨 → 카드 표시(차액 = 0 − 선결제 잔액 → 환불 예정)
  await patchDb(page, (d) => { d.statements.find((s) => s.bookingId === 'bk-k10').items = [{ kind: 'labor', label: '작업비', amount: 0 }]; }, '/bookings/bk-k10');
  await costCard(page).waitFor();
  eq(await heroText(page), '환불 예정 금액 50,000원', '0원 최종 금액도 등록 상태로 표시');
});

await test('금액·정산(추가 결제): 결제할 금액만 크게 → 확인 체크 전 비활성·‘금액이 달라요’는 가능 → 결제하기(연타 1회) → 결제 결과 → 정산 완료 표시', async (page) => {
  await start(page, { path: '/bookings/bk-k9' });
  await costCard(page).waitFor();
  eq(await heroText(page), '결제할 금액 62,500원', '결제할 금액');
  truthy((await costText(page)).includes('업체가 제시한 최종 금액 기준이에요'), '확인 전 안내');
  // 금액·정산 카드 자체가 상단 확인 카드(공통 블루 머리 + 제목), 같은 안내를 다른 카드에 반복하지 않음
  eq((await page.locator('main').innerText()).split('최종 금액을 확인해 주세요').length - 1, 1, '제목 한 번(중복 카드 없음)');
  expectActCard(await actCardStyle(costCard(page)));
  await openDetail(page, '금액 상세');
  const t = await costText(page);
  for (const [k, v] of [['수리비', '100,000원'], ['작업비', '80,000원'], ['부품·자재비', '20,000원'], ['내 확정 출장비', '12,500원'], ['총금액', '112,500원'], ['선결제 차감', '50,000원'], ['결제할 금액', '62,500원']]) truthy(hasRow(t, k, v), `상세 ‘${k} ${v}’: ${t}`);
  const pay = payBtn(page, '62,500원 결제하기');
  truthy(await pay.isDisabled(), '확인 전 결제 비활성');
  truthy(await payBtn(page, '금액이 달라요').isEnabled(), '금액이 달라요는 체크 없이 가능');
  await costCard(page).getByRole('checkbox').check();
  truthy(await pay.isEnabled(), '확인 후 활성');
  eq(await page.evaluate(() => ['fixed', 'sticky'].includes(getComputedStyle(document.querySelector('#settlement .btn--primary').parentElement).position)), false, '버튼은 카드 안 일반 흐름');
  await pay.dblclick();
  await page.waitForURL((u) => u.pathname.startsWith('/pay/'));
  await waitText(page, '결제');
  const d = await db(page);
  eq(d.transactions.filter((x) => x.bookingId === 'bk-k9' && x.kind === 'balance').length, 1, '잔금 거래 한 번');
  eq(d.statements.find((s) => s.bookingId === 'bk-k9').status, 'settled', '정산 완료');
  await loadBooking(page, 'bk-k9');
  eq(await heroText(page), '추가 결제한 금액 62,500원', '정산 후 표시');
  eq(await costCard(page).getByRole('checkbox').count(), 0, '정산 후 확인 없음');
});

await test('금액·정산(차액 0원·환불 예정): 추가 결제 없음 0원 → 정산 완료하기 / 환불 예정 금액 → 환불 진행하기 → 환불 요청(완료 아님)', async (page) => {
  await start(page, { path: '/bookings/bk-k10' });
  await costCard(page).waitFor();
  eq(await heroText(page), '추가 결제 없음 0원', '차액 0원');
  await costCard(page).getByRole('checkbox').check();
  await payBtn(page, '확인하고 정산 완료하기').click();
  await page.waitForFunction(() => document.querySelector('#settlement .cost__balance')?.textContent.includes('추가 결제·환불 없음'));
  eq((await db(page)).transactions.filter((x) => x.bookingId === 'bk-k10' && x.kind === 'balance').length, 0, '결제 없음');
  await loadBooking(page, 'bk-k11');
  eq(await heroText(page), '환불 예정 금액 7,500원', '환불 예정(절댓값)');
  truthy((await costText(page)).includes('확인 후 환불이 진행돼요.'), '환불 안내');
  await costCard(page).getByRole('checkbox').check();
  await payBtn(page, '확인하고 환불 진행하기').click();
  await page.waitForFunction(() => document.querySelector('#settlement .cost__balance')?.textContent.includes('환불 금액'));
  await costCard(page).getByText('환불 처리 요청 접수', { exact: true }).waitFor();
  truthy((await costText(page)).includes('환불 처리 요청 접수') && !(await costText(page)).includes('환불 처리 완료'), '환불 요청과 완료 구분');
  const r = (await db(page)).refunds.filter((x) => x.bookingId === 'bk-k11');
  eq(r.length, 1, '환불 건수'); eq(r[0].status, 'requested', '요청 상태');
});

await test('금액·정산: 금액이 달라요 → 이견 접수(정산 대기, 청구 없음), 실패하면 안내·다시 시도, 결제 확인 중이면 다시 결제 불가', async (page) => {
  await start(page, { path: '/bookings/bk-k9' });
  await costCard(page).waitFor();
  await payBtn(page, '금액이 달라요').click();
  await page.getByRole('button', { name: '이견 접수하고 정산 보류하기' }).click();
  await costCard(page).getByText('금액을 협의하고 있어요').waitFor();
  eq(await costCard(page).getByRole('checkbox').count(), 0, '협의 중 확인 없음');
  eq((await db(page)).transactions.filter((x) => x.bookingId === 'bk-k9' && x.kind === 'balance').length, 0, '청구 없음');
  // 정산 실패 → 안내·재시도
  await loadBooking(page, 'bk-k10');
  await page.evaluate(() => { window.__sagoDev.db.settings.failNextWrite = true; });
  await costCard(page).getByRole('checkbox').check();
  await payBtn(page, '확인하고 정산 완료하기').click();
  await costCard(page).locator('.banner--danger').waitFor();
  eq((await db(page)).statements.find((s) => s.bookingId === 'bk-k10').status, 'awaiting_customer', '실패 시 그대로');
  await payBtn(page, '확인하고 정산 완료하기').click();
  await page.waitForFunction(() => document.querySelector('#settlement .cost__balance')?.textContent.includes('추가 결제·환불 없음'));
  // 결제 처리 중 → 다시 결제 불가
  await start(page, { path: '/bookings/bk-k11', patch: (d) => { d.settings.payOutcome = 'processing'; } });
  await loadBooking(page, 'bk-k9');
  await costCard(page).getByRole('checkbox').check();
  await payBtn(page, '62,500원 결제하기').click();
  await page.waitForURL((u) => u.pathname.startsWith('/pay/'));
  await loadBooking(page, 'bk-k9');
  await costCard(page).locator('.banner--warn').waitFor();
  await costCard(page).getByRole('checkbox').check();
  truthy(await payBtn(page, '62,500원 결제하기').isDisabled(), '확인 중에는 결제 버튼 비활성');
  eq((await db(page)).statements.find((s) => s.bookingId === 'bk-k9').status, 'awaiting_customer', '확인 중이라 정산 완료 아님');
  // 잔금 결제 실패 → 청구 없음 안내, 다시 결제 가능(정산은 그대로 확인 필요)
  await start(page, { path: '/bookings/bk-k11', patch: (d) => { d.settings.payOutcome = 'fail'; } });
  await loadBooking(page, 'bk-k9');
  await costCard(page).getByRole('checkbox').check();
  await payBtn(page, '62,500원 결제하기').click();
  await page.waitForURL((u) => u.pathname.startsWith('/pay/'));
  await loadBooking(page, 'bk-k9');
  await costCard(page).getByText('잔금 결제가 완료되지 않았어요').waitFor();
  await costCard(page).getByRole('checkbox').check();
  truthy(await payBtn(page, '62,500원 결제하기').isEnabled(), '실패 후 다시 결제 가능');
  eq((await db(page)).statements.find((s) => s.bookingId === 'bk-k9').status, 'awaiting_customer', '실패 시 정산 그대로');
});

await test('금액·정산 상태별: 협의 중(bk-k12)·정산 완료(결제·환불 완료)·취소(환불 요청)·이전 환불이 있는 선결제 잔액·여러 작업의 실제 완료 상태', async (page) => {
  await start(page, { path: '/bookings/bk-k12' });
  await costCard(page).waitFor();
  truthy((await costText(page)).includes('금액을 협의하고 있어요') && await costCard(page).getByRole('link', { name: /전화/ }).count() === 1, '협의 중 안내·전화');
  eq(await costCard(page).getByRole('checkbox').count(), 0, '협의 중 확인 없음');
  await loadBooking(page, 'bk-k13');
  eq(await heroText(page), '추가 결제한 금액 30,000원', '정산 완료(결제)');
  await loadBooking(page, 'bk-k14');
  eq(await heroText(page), '환불 금액 7,500원', '정산 완료(환불)');
  await costCard(page).getByText('환불 처리 완료', { exact: true }).waitFor(); // 환불 완료 상태

  await loadBooking(page, 'bk-k16');
  eq(await heroText(page), '취소 환불 금액 33,334원', '취소 환불');
  truthy((await costText(page)).includes('환불 처리 요청 접수'), '취소 환불 상태');
  await openDetail(page, '금액 상세');
  truthy((await costText(page)).includes('공제·충당된 금액'), '취소 공제');
  eq(await costCard(page).getByRole('checkbox').count(), 0, '취소 예약 확인 없음');
  // 이전 환불이 있는 선결제 잔액: 50,000 − 20,000 = 30,000 → 112,500 − 30,000 = 82,500
  await patchDb(page, (d) => { d.refunds.push({ id: 'rf-prev', bookingId: 'bk-k9', amount: 20000, reason: '부분 환불(테스트)', purpose: 'cancel', status: 'completed', requestedAt: '2026-10-10T10:00:00+09:00' }); }, '/bookings/bk-k9');
  await page.locator('#settlement .cost__balance').waitFor();
  eq(await heroText(page), '결제할 금액 82,500원', '남은 잔액으로만 차감');
  await openDetail(page, '금액 상세');
  truthy((await costText(page)).includes('환불 20,000원 = 잔액 30,000원'), '잔액 계산 근거');
  // 여러 작업의 실제 완료 상태(일괄 완료로 표시하지 않음)
  await patchDb(page, (d) => { d.statements.find((s) => s.bookingId === 'bk-k9').actualWork[1].done = false; }, '/bookings/bk-k9');
  await costCard(page).waitFor();
  const work = (await page.locator('#work').innerText()).replace(/\s+/g, ' ');
  // 작업별 배지 대신 실제 작업 완료 요약 한 줄(데이터는 유지), 정산 판단용 요약은 금액·정산 카드에도
  truthy(work.includes('업체가 등록한 실제 작업 2건 중 1건 완료') && work.includes('미완료: 배수 트랩 교체') && !work.includes('수전 교체 완료'), `실제 작업 완료 요약: ${work}`);
  eq(await page.locator('#work .badge').count(), 0, '작업 내용에 상태 배지 없음');
  await costCard(page).getByText('실제 작업 2건 중 1건 완료').waitFor(); // 확인 영역 작업 요약
  truthy(work.includes('욕실 세면대 수전 교체') && work.includes('배수 트랩 교체'), '작업 내용에 작업 전체');
});

await test('이전 최종 금액 확인 주소: 예약 상세 금액·정산으로 한 번 이동(반복 없음), 뒤로가기 정상 · 예약 목록으로(탭·필터 복원)', async (page) => {
  await start(page, { path: '/bookings?tab=active&a_visit=today' });
  await page.locator('main .booking-list > li a').first().waitFor();
  await page.goto(`${BASE}/bookings/bk-k9/final`);
  await page.waitForURL((u) => u.pathname === '/bookings/bk-k9' && u.hash === '#settlement');
  await costCard(page).waitFor();
  await page.waitForTimeout(400);
  eq(new URL(page.url()).pathname + new URL(page.url()).hash, '/bookings/bk-k9#settlement', '이동 반복 없음');
  truthy(await costCard(page).evaluate((el) => { const r = el.getBoundingClientRect(); return r.top < innerHeight && r.bottom > 0; }), '금액·정산이 화면에');
  await page.goBack();
  await page.waitForURL((u) => u.pathname === '/bookings');
  // 진행 중 예약 → 확정된 예약(마지막 필터 복원)
  await page.goto(`${BASE}/bookings?tab=active&a_visit=today`);
  await page.locator('main .booking-list > li a').first().click();
  await page.waitForURL((u) => /^\/bookings\/bk-/.test(u.pathname));
  await page.getByRole('link', { name: '예약 목록으로' }).click();
  await page.waitForURL((u) => u.pathname === '/bookings' && u.search === '?tab=active&a_visit=today');
  // 이용 완료·취소 → 완료·취소 탭
  for (const id of ['bk-k14', 'bk-k16']) {
    await loadBooking(page, id);
    eq(await page.getByRole('link', { name: '예약 목록으로' }).getAttribute('href'), '/bookings?tab=past', `${id} 완료·취소 탭`);
  }
});

for (const w of [360, 320, 1280]) {
  await test(`금액·정산 확인 상자 ${w}px: 안쪽 여백·체크박스 간격·첫 줄 정렬·줄바꿈, 상자 어디를 눌러도 선택, 키보드, 결제 버튼 활성화 · 금액·버튼 잘림 없음`, async (page) => {
    await page.setViewportSize({ width: w, height: 800 });
    await start(page, { path: '/bookings/bk-k9' });
    await costCard(page).waitFor();
    const box = costCard(page).locator('label.check.card').filter({ hasText: '실제 작업 내용과 최종 금액을 확인했어요.' });
    const pay = payBtn(page, '62,500원 결제하기');
    const r = await box.evaluate((l) => {
      const cs = getComputedStyle(l); const lr = l.getBoundingClientRect();
      const cb = l.querySelector('input').getBoundingClientRect(); const sp = l.querySelector('span');
      const range = document.createRange(); range.selectNodeContents(sp); const lines = [...range.getClientRects()];
      const first = lines[0]; const card = document.querySelector('#settlement').getBoundingClientRect();
      return {
        pl: parseFloat(cs.paddingLeft), pr: parseFloat(cs.paddingRight), pt: parseFloat(cs.paddingTop), pb: parseFloat(cs.paddingBottom),
        cbLeft: Math.round(cb.left - lr.left - parseFloat(cs.borderLeftWidth)), cbW: Math.round(cb.width), gap: Math.round(sp.getBoundingClientRect().left - cb.right),
        firstLineMid: first.top + first.height / 2, cbMid: cb.top + cb.height / 2,
        overflow: document.documentElement.scrollWidth > innerWidth || [...document.querySelectorAll('#settlement *')].some((e) => e.getBoundingClientRect().right > card.right + 0.5),
        lines: new Set(lines.map((x) => Math.round(x.top))).size, labelFor: l.control === l.querySelector('input'), cursor: cs.cursor,
      };
    });
    if (w >= 600) truthy(r.pl >= 20 && r.pl <= 24 && r.pr >= 20 && r.pr <= 24, `데스크톱 좌우 20~24px ${JSON.stringify(r)}`);
    else truthy(r.pl >= 16 && r.pr >= 16, `모바일 좌우 16px 이상 ${JSON.stringify(r)}`);
    truthy(r.pt >= 16 && r.pt <= 20 && r.pb >= 16 && r.pb <= 20, `상하 16~20px ${JSON.stringify(r)}`);
    eq(r.cbLeft, r.pl, '체크박스는 안쪽 여백에서 시작'); eq(r.cbW, 22, '체크박스 줄어들지 않음'); eq(r.gap, 12, '체크박스–문구 12px');
    truthy(Math.abs(r.firstLineMid - r.cbMid) <= 2 && !r.overflow && r.labelFor && r.cursor === 'pointer', `정렬·넘침 없음·label 연결 ${JSON.stringify(r)}`);
    if (w === 320) truthy(r.lines >= 2, `좁은 화면 여러 줄(${r.lines})`);
    truthy(await pay.isDisabled(), '확인 전 결제 비활성');
    await box.scrollIntoViewIfNeeded(); const bb = await box.boundingBox();
    await box.click({ position: { x: bb.width - 6, y: bb.height / 2 } });
    truthy(await box.locator('input').isChecked() && await pay.isEnabled(), '여백 클릭으로 선택 → 결제 활성');
    await box.click({ position: { x: 6, y: 6 } });
    truthy(!(await box.locator('input').isChecked()) && await pay.isDisabled(), '다시 클릭하면 해제');
    await box.locator('input').focus();
    await page.keyboard.press('Space');
    truthy(await pay.isEnabled(), '키보드 선택');
    if (w !== 320) { await page.mouse.move(0, 0); await costCard(page).screenshot({ path: join(ROOT, `e2e/screens/${w}_booking_settlement.png`) }); }
  }, { width: w });
}

await test('취소(마감 후): 본인 확정 출장비 12,500원 공제 · 환불 37,500원 · 재취소 불가', async (page) => {
  await start(page, { path: '/bookings/bk-k2/cancel' });
  await waitText(page, '고객 사유 취소예요');
  await waitText(page, '−12,500원'); await waitText(page, '37,500원');
  await waitText(page, '다른 세대의 확정 출장비는 바뀌지 않아요');
  const btn = page.getByRole('button', { name: /예약 취소하고 환불 요청/ });
  truthy(await btn.isDisabled(), '동의 전 비활성');
  await page.getByRole('checkbox').check();
  await btn.dblclick();
  await waitText(page, '취소가 접수됐어요');
  await waitText(page, '환불 처리 요청 접수');
  const d = await db(page);
  eq(d.refunds.filter((r) => r.bookingId === 'bk-k2').length, 1, '환불 건수');
  eq(d.deductions.filter((x) => x.bookingId === 'bk-k2').length, 1, '공제 건수');
  await page.reload();
  await waitText(page, '취소가 접수됐어요'); // 재진입해도 기존 결과만 표시
  eq((await db(page)).refunds.filter((r) => r.bookingId === 'bk-k2').length, 1, '재진입 후 환불 건수');
});

await test('취소(마감 전): 출장비 공제 없음 · 남은 세대 재계산 안내', async (page) => {
  await start(page, { path: '/bookings/bk-k1/cancel' });
  await waitText(page, '−12,500원', { exact: false }).catch(() => {});
  await waitText(page, '접수 마감 전이라 출장비 공제가 없어요');
});

await test('취소 금액이 바뀌면 동의가 초기화되고 새 금액을 다시 확인해야 한다', async (page) => {
  await start(page, { path: '/bookings/bk-k5/cancel' });
  await page.getByRole('checkbox').check();
  await dev(page, 'payAndOrderMaterial', 'bk-k5');
  await page.waitForFunction(() => !document.querySelector('input[type=checkbox]').checked);
  truthy(await page.getByRole('button', { name: /예약 취소하고 환불 요청/ }).isDisabled(), '금액 변경 후 취소 버튼 비활성');
  await waitText(page, '−30,000원'); // 자재비 공제는 출장비와 별도 항목
});

await test('지연: 기다리기·무료 변경·무료 취소를 동등하게 제시(미리 선택·추천 없음)', async (page) => {
  await start(page, { path: '/delays/dl-k3' });
  await waitText(page, '어느 쪽도 추천하거나 자동으로 선택하지 않아요');
  await waitText(page, '기다리기'); await waitText(page, '무료로 일정 변경'); await waitText(page, '무료로 취소');
  eq(await page.locator('input:checked').count(), 0, '미리 선택된 항목');
  truthy(!(await page.getByText('추천', { exact: false }).count()) || (await page.getByText('추천하거나', { exact: false }).count()) > 0, '추천 표시');
  eq((await db(page)).delays[0].status, 'open', '선택 전 지연 상태');
  await page.getByRole('button', { name: '기다리기로 해요' }).click();
  await waitText(page, '기다리기를 선택했어요');
  eq((await db(page)).delays[0].choice, 'wait', '기록된 선택');
});

await test('지연: 변경 도착 예상은 예약 방문 시각과 따로 표시(덮어쓰지 않음)', async (page) => {
  await start(page, { path: '/delays/dl-k3' });
  await waitText(page, '예약 방문 예정');
  const main = await page.locator('main').innerText();
  truthy(main.includes('10월 13일 (화) 14:00'), '예약 방문 예정 14:00');
  truthy(/변경 도착 예상[\s\S]*14:20/.test(main), '변경 도착 예상 14:20');
  truthy(main.includes('응답하지 않아도 일정 변경이나 취소로 처리하지 않아요'), '무응답 안내');
  truthy(!/\d+분 (이상|넘게) 지연/.test(main), '확정되지 않은 분 단위 기준 표시 없음');
  await page.goto(`${BASE}/bookings/bk-k3`);
  await waitText(page, '변경 도착 예상');
  eq((await db(page)).bookings.find((b) => b.id === 'bk-k3').visitTime, '14:00', '예약 방문 시각 유지');
});

await test('지연: 무료 변경 요청 → 변경 수수료 없음 · 합의 전 기존 일정 유지', async (page) => {
  await start(page, { path: '/delays/dl-k3' });
  await page.getByRole('link', { name: '일정 변경 요청하기' }).click();
  await waitText(page, '방문 지연으로 인한 무료 변경이에요');
  await page.getByLabel('같은 날 시간만').check();
  await page.getByRole('button', { name: '16:00~19:00' }).click();
  await page.getByRole('button', { name: '변경 요청 보내기' }).click();
  await page.waitForURL((u) => u.pathname === '/bookings/bk-k3' && u.hash === '#schedule-change');
  await waitText(page, '일정 변경을 요청했어요');
  const d = await db(page);
  const k3 = d.bookings.find((b) => b.id === 'bk-k3');
  eq(`${k3.visitDate} ${k3.visitTime}`, '2026-10-13 14:00', '합의 전 예약 방문 시각 유지');
  eq(d.proposals.find((p) => p.bookingId === 'bk-k3').newVisit.time, undefined, '고객 요청 단계에는 새 방문 시각 없음');
});

// ───────── 일정 변경: 예약 상세 상단 카드에서 바로 응답(기존 일정 방문 가능 여부별) ─────────
const sched = (page) => page.locator('#schedule-change');
const schedText = async (page) => (await sched(page).innerText()).replace(/\s+/g, ' ');
const infoText = async (page) => (await page.locator('section').filter({ has: page.getByRole('heading', { name: '예약 정보', exact: true }) }).innerText()).replace(/\s+/g, ' ');
const listCard = (page, id) => page.locator(`a[href="/bookings/${id}"]`);

await test('일정 변경 B(기존 방문 불가): 상단 카드 하나(방문 불가·새 일정·사유·비용, 중복 안내 없음), 거절 없음, 목록·상세·진행 표시 같은 상태, 업체 사유 무료 취소 안내 → 새 일정 수락으로 확정', async (page) => {
  await start(page, { path: '/bookings/bk-k4' });
  await sched(page).waitFor();
  const t = await schedText(page);
  for (const s of ['확인이 필요해요', '새 방문 일정을 확인해 주세요', '기존 방문 일정', '10월 14일 (수) 14:00', '방문 불가', '제안된 새 일정', '10월 19일 (월) 10:00', '이전 작업이 길어져', '변경 비용 없음 · 확정 출장비 유지']) truthy(t.includes(s), `카드 ‘${s}’: ${t}`);
  for (const s of ['업체가 방문할 수 없어요', '밖의 제안이에요', '수락 후 새 일정이 확정돼요.']) truthy(!t.includes(s), `중복 안내 없음 ‘${s}’: ${t}`);
  // 뺀 문구 자리에 빈 문단·여백이 남지 않는다: 카드 본문 마지막 요소는 정보 행(KV), 버튼까지 간격은 카드 기본 간격
  const tail = await sched(page).evaluate((c) => ({ emptyP: [...c.querySelectorAll('p')].filter((x) => !x.textContent.trim()).length, rows: [...c.querySelectorAll('.kv__k')].map((x) => x.textContent) }));
  truthy(tail.emptyP === 0 && tail.rows.join('/') === '변경 사유/비용', `빈 문단 없음·정보 행은 사유·비용 ${JSON.stringify(tail)}`);
  truthy(await sched(page).getByRole('button', { name: '새 일정 수락' }).isVisible() && await sched(page).getByRole('button', { name: '다른 일정 요청' }).isVisible(), '수락·다른 일정 요청');
  eq(await sched(page).getByRole('button', { name: '새 일정 거절' }).count(), 0, '방문 불가면 거절(=기존 유지) 없음');
  const main = await page.locator('main').innerText();
  truthy(!main.includes('업체가 일정 변경을 제안했어요') && !main.includes('변경 제안 · 확인 대기'), '상단 이동 안내·중간 카드 중복 없음');
  const info = await infoText(page);
  truthy(info.includes('방문 일정 방문 일정 조율 중') && !info.includes('10월 14일') && !info.includes('방문 예정') && !info.includes('제안된 새 일정') && !info.includes('이전 작업이 길어져'), `예약 정보는 방문 일정 조율 중(기존 날짜 없음): ${info}`);
  truthy(!(await page.locator('nav.steps').innerText()).includes('방문할 수 없어'), '진행 표시에 같은 설명 반복 없음');
  eq((t.match(/확정돼요/g) ?? []).length, 0, '확정 안내 문구 없음(버튼으로 충분)');
  await waitText(page, '업체 사유로 무료 취소할 수 있어요.');
  // 목록도 같은 기준
  await page.goto(`${BASE}/bookings?tab=active`);
  const lc = (await listCard(page, 'bk-k4').innerText()).replace(/\s+/g, ' ');
  // 목록: 날짜 자리 ‘방문 일정 조율 중’, 대표 상태 ‘일정 조율 중’ + 할 일 ‘새 일정을 확인해 주세요’, 기존 날짜·노란 방문 불가 문구 없음
  truthy(lc.includes('방문 일정 조율 중') && !lc.includes('10월 14일') && !lc.includes('방문 불가') && !lc.includes('방문 예정'), `목록 카드: ${lc}`);
  await listCard(page, 'bk-k4').locator('.badge').first().waitFor();
  eq((await listCard(page, 'bk-k4').locator('.badge').allInnerTexts()).join(), '일정 조율 중', '목록 배지');
  eq(await todoOf(listCard(page, 'bk-k4')), '새 일정을 확인해 주세요', '응답할 제안 → 할 일');
  eq(await listCard(page, 'bk-k4').locator('[style*="--c-warn"]').count(), 0, '노란 경고 문구 없음');
  // 수락(연타해도 한 번)
  await page.goto(`${BASE}/bookings/bk-k4`);
  await sched(page).getByRole('button', { name: '새 일정 수락' }).dblclick();
  await sched(page).waitFor({ state: 'detached' });
  const b = (await db(page)).bookings.find((x) => x.id === 'bk-k4');
  eq(`${b.visitDate} ${b.visitTime} ${b.workStatus}`, '2026-10-19 10:00 scheduled', '새 일정 확정·방문 예정');
  truthy(b.lockedTripFee !== undefined && b.scheduleChanges.length === 1, '확정 출장비 유지·변경 기록 한 번');
  const info2 = await infoText(page);
  truthy(info2.includes('방문 일정 10월 19일 (월) 10:00') && !info2.includes('조율 중') && !info2.includes('방문 불가'), `수락 후 예약 정보(확정 날짜·시각): ${info2}`);
  eq(await page.getByText('일정 변경 내역').count(), 0, '일정 변경 내역 펼치기 없음');
  truthy((await db(page)).proposals.some((x) => x.bookingId === b.id && x.status === 'accepted'), '수락 기록 보존');
  eq(await page.getByText('업체 사유로 무료 취소할 수 있어요.').count(), 0, '확정 후 무료 취소 안내 없음');
});

await test('일정 변경 B: 다른 일정 요청(검증·실패 시 입력 유지·재시도·중복 방지) → 일정 협의 중(희망 일정은 확정 아님) → 업체 재제안 → 고객 수락으로만 확정', async (page) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await start(page, { path: '/bookings/bk-k4' });
  await sched(page).getByRole('button', { name: '다른 일정 요청' }).click();
  await sched(page).getByRole('button', { name: '희망 일정 보내기' }).click();
  await sched(page).getByText('희망 날짜를 선택해 주세요.').waitFor();
  eq(await page.evaluate(() => document.activeElement?.type), 'date', '첫 오류(날짜)로 포커스');
  await sched(page).locator('input[type=date]').fill('2026-10-22');
  await sched(page).getByRole('button', { name: '희망 일정 보내기' }).click();
  await sched(page).getByText('희망 시각을 선택해 주세요.').waitFor();
  await sched(page).getByRole('radio', { name: '10:00', exact: true }).check();
  await page.evaluate(() => { window.__sagoDev.db.settings.failNextWrite = true; });
  await sched(page).getByRole('button', { name: '희망 일정 보내기' }).click();
  await sched(page).locator('.banner--danger').waitFor();
  eq(await sched(page).locator('input[type=date]').inputValue(), '2026-10-22', '실패 시 입력 유지');
  eq((await db(page)).proposals.find((p) => p.id === 'pr-k4').status, 'proposed', '실패 시 기존 상태 유지');
  await sched(page).getByRole('button', { name: '희망 일정 보내기' }).dblclick();
  await sched(page).getByText('새 방문 일정을 협의하고 있어요').waitFor();
  const t = await schedText(page);
  truthy(t.includes('내가 요청한 희망 일정') && t.includes('10월 22일 (목) 10:00') && t.includes('업체 응답을 기다리고 있어요') && !t.includes('확인이 필요해요') && t.includes('업체가 일정을 다시 제안하면 여기서 수락할 수 있어요.'), `협의 중 카드: ${t}`);
  eq(await sched(page).getByRole('button', { name: '새 일정 수락' }).count(), 0, '협의 중에는 수락할 새 일정 없음');
  let d = await db(page);
  const reqs = d.proposals.filter((p) => p.bookingId === 'bk-k4' && p.replyTo === 'pr-k4');
  eq(reqs.length, 1, '희망 일정 요청 한 건');
  eq(`${d.bookings.find((b) => b.id === 'bk-k4').visitDate} ${d.bookings.find((b) => b.id === 'bk-k4').visitTime}`, '2026-10-14 14:00', '희망 일정이 기존 기록을 덮어쓰지 않음');
  await page.goto(`${BASE}/bookings?tab=active`);
  // 다른 일정을 요청하고 업체 답을 기다리는 중: 일정 조율 중, 확인 필요 없음
  await listCard(page, 'bk-k4').locator('.badge').first().waitFor();
  eq((await listCard(page, 'bk-k4').locator('.badge').allInnerTexts()).join(), '일정 조율 중', '목록 배지');
  eq(await todoOf(listCard(page, 'bk-k4')), '', '희망 일정 전달 후 업체 응답 대기: 할 일 없음');
  truthy((await listCard(page, 'bk-k4').innerText()).includes('방문 일정 조율 중'), '목록 날짜 자리');
  // 업체 재제안 → 고객 수락
  await dev(page, 'providerAgreesChange', reqs[0].id, '10:30');
  await page.goto(`${BASE}/bookings/bk-k4`);
  await sched(page).getByText('10월 22일 (목) 10:30').waitFor();
  truthy(await sched(page).getByRole('button', { name: '다른 일정 요청' }).isVisible(), '재제안에도 다른 일정 요청 가능');
  await sched(page).getByRole('button', { name: '새 일정 수락' }).click();
  await sched(page).waitFor({ state: 'detached' });
  d = await db(page);
  const b = d.bookings.find((x) => x.id === 'bk-k4');
  eq(`${b.visitDate} ${b.visitTime}`, '2026-10-22 10:30', '업체 재제안 수락으로만 확정');
  eq(d.transactions.filter((x) => x.bookingId === 'bk-k4' && x.kind === 'change_shortfall').length, 0, '추가 결제 없음');
  eq(d.bookings.filter((x) => x.requestId === b.requestId).length, 1, '새 예약 중복 생성 없음');
});

await test('일정 변경 A(기존 일정에도 방문 가능): 안내·새 일정 수락/거절, 거절하면 기존 일정 유지 · 방문 가능 여부 미지정은 확인 필요(거절 없음)', async (page) => {
  await start(page, { path: '/bookings/bk-k1' });
  await dev(page, 'proposeProviderChange', 'bk-k1', '2026-10-21', '10:00', 'yes');
  await page.goto(`${BASE}/bookings/bk-k1`);
  await sched(page).waitFor();
  const t = await schedText(page);
  truthy(t.includes('새 방문 일정을 확인해 주세요') && t.includes('새 일정을 수락하기 전까지 기존 일정이 유지돼요.') && !t.includes('방문 불가'), `A 카드: ${t}`);
  truthy((await infoText(page)).includes('방문 일정 10월 19일 (월) 14:00'), 'A는 기존 일정 그대로 표시');
  await sched(page).getByRole('button', { name: '새 일정 거절' }).click();
  await sched(page).waitFor({ state: 'detached' });
  let b = (await db(page)).bookings.find((x) => x.id === 'bk-k1');
  eq(`${b.visitDate} ${b.visitTime}`, '2026-10-19 14:00', '거절 → 기존 일정 유지');
  truthy((await db(page)).proposals.some((x) => x.bookingId === 'bk-k1' && x.status === 'rejected'), '거절 기록 보존(화면 펼치기 없음)');
  // 다시 제안(A) → 수락
  await dev(page, 'proposeProviderChange', 'bk-k1', '2026-10-21', '11:00', 'yes');
  await page.goto(`${BASE}/bookings/bk-k1`);
  await sched(page).getByRole('button', { name: '새 일정 수락' }).click();
  await sched(page).waitFor({ state: 'detached' });
  b = (await db(page)).bookings.find((x) => x.id === 'bk-k1');
  eq(`${b.visitDate} ${b.visitTime}`, '2026-10-21 11:00', '수락 → 새 일정');
  // 방문 가능 여부 미지정 → 확인 필요
  await start(page, { path: '/bookings/bk-k1' });
  await dev(page, 'proposeProviderChange', 'bk-k1', '2026-10-21', '10:00');
  await page.goto(`${BASE}/bookings/bk-k1`);
  await sched(page).getByText('방문 가능 여부 확인 필요').first().waitFor();
  eq(await sched(page).getByRole('button', { name: '새 일정 거절' }).count(), 0, '확인 필요면 거절(=기존 유지) 없음');
  truthy(await sched(page).getByRole('button', { name: '다른 일정 요청' }).isVisible() && await sched(page).getByRole('link', { name: /전화/ }).count() === 1, '다른 일정 요청·업체 전화');
});

await test('일정 변경 B 미응답: 예약 유지·기존 날짜 기록 보존·자동 확정·완료·취소 없음(날짜가 지나도), 이전 제안 응답 방지', async (page) => {
  await start(page, { path: '/bookings/bk-k4', patch: (d) => { d.now = '2026-10-20T12:00:00+09:00'; } });
  await sched(page).waitFor();
  const b = (await db(page)).bookings.find((x) => x.id === 'bk-k4');
  eq(`${b.status} ${b.workStatus} ${b.visitDate}`, 'confirmed scheduled 2026-10-14', '예약 유지·작업 상태 그대로');
  truthy((await infoText(page)).includes('방문 일정 조율 중'), '방문 예정처럼 보이지 않음');
  // 화면을 연 뒤 제안이 바뀌면(이미 처리됨) 응답 거부·안내
  await page.evaluate(() => { window.__sagoDev.db.proposals.find((p) => p.id === 'pr-k4').status = 'withdrawn'; });
  await sched(page).getByRole('button', { name: '새 일정 수락' }).click();
  await sched(page).locator('.banner--danger').waitFor();
  eq((await db(page)).bookings.find((x) => x.id === 'bk-k4').visitDate, '2026-10-14', '이전 제안 응답으로 바뀌지 않음');
});

await test('일정 변경 B: 업체 사유 무료 취소 → 공제 없이 선결제 전액 환불(요청·완료 구분), 다른 세대 확정 출장비 그대로', async (page) => {
  await start(page, { path: '/bookings/bk-k4' });
  const g0 = (await db(page)).groups.find((g) => g.id === 'gc-p5');
  await page.getByRole('link', { name: '예약 취소하기' }).click();
  await waitText(page, '업체가 기존 일정에 방문할 수 없어요');
  await waitText(page, '50,000원');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: /예약 취소하고 환불 요청/ }).dblclick();
  await waitText(page, '취소가 접수됐어요');
  const d = await db(page);
  const rf = d.refunds.filter((r) => r.bookingId === 'bk-k4');
  eq(rf.length, 1, '환불 한 건'); eq(rf[0].amount, 50000, '선결제 전액'); eq(rf[0].status, 'requested', '환불 요청(완료 아님)');
  eq(d.deductions.filter((x) => x.bookingId === 'bk-k4').length, 0, '공제 없음');
  const g1 = d.groups.find((g) => g.id === 'gc-p5');
  eq(g1.finalPerHouseholdFee, g0.finalPerHouseholdFee, '다른 세대 확정 출장비 그대로');
  await page.goto(`${BASE}/bookings/bk-k4`);
  await costCard(page).getByText('환불 처리 요청 접수', { exact: true }).waitFor();
  eq(await sched(page).count(), 0, '취소된 예약에는 변경 카드 없음');
});

await test('이전 일정 변경 주소(/proposals/:id): 예약 상세 변경 영역으로 한 번 이동(반복 없음), 뒤로가기 정상, 없는 제안은 안내', async (page) => {
  await start(page, { path: '/bookings?tab=active' });
  await page.goto(`${BASE}/proposals/pr-k4`);
  await page.waitForURL((u) => u.pathname === '/bookings/bk-k4' && u.hash === '#schedule-change');
  await sched(page).waitFor();
  await page.waitForTimeout(400);
  eq(new URL(page.url()).pathname + new URL(page.url()).hash, '/bookings/bk-k4#schedule-change', '반복 없음');
  await page.reload();
  await sched(page).waitFor();
  await page.goBack();
  await page.waitForURL((u) => u.pathname === '/bookings');
  await page.goto(`${BASE}/proposals/pr-nope`);
  await page.getByText('일정 변경 내역을 찾을 수 없어요').waitFor({ timeout: 12000 }); // 조회(모의 지연) 후 안내
});

for (const w of [360, 1280]) {
  await test(`일정 변경 카드 ${w}px: 날짜 비교·사유·버튼 잘림·가로 넘침 없음, 키보드로 응답 버튼 이동`, async (page) => {
    await page.setViewportSize({ width: w, height: 900 });
    await start(page, { path: '/bookings/bk-k4' });
    await sched(page).waitFor();
    const r = await sched(page).evaluate((s) => {
      const c = s.getBoundingClientRect();
      return { overflow: document.documentElement.scrollWidth > innerWidth, out: [...s.querySelectorAll('*')].filter((e) => e.getBoundingClientRect().right > c.right + 0.5).map((e) => e.textContent.slice(0, 20)),
        btnH: [...s.querySelectorAll('.btn')].map((b) => Math.round(b.getBoundingClientRect().height)) };
    });
    truthy(!r.overflow && !r.out.length && r.btnH.every((h) => h >= 44), `카드 ${JSON.stringify(r)}`);
    // 공통 행동 카드(블루 머리·제목·흰 본문·하단 버튼), 노란색·안쪽 카드 없음. 기존 ↔ 제안 일정은 두 칸 나란히
    expectActCard(await actCardStyle(sched(page)));
    const cmp = await sched(page).locator('.sched-compare__item').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
    truthy(cmp.length === 2 && cmp[0] === cmp[1], `일정 비교 나란히 ${cmp}`);
    await sched(page).getByRole('button', { name: '새 일정 수락' }).focus();
    await page.keyboard.press('Tab');
    eq(await page.evaluate(() => document.activeElement?.textContent), '다른 일정 요청', 'Tab으로 다음 응답 버튼');
    await page.keyboard.press('Enter');
    await sched(page).locator('input[type=date]').waitFor();
    await page.mouse.move(0, 0);
    await sched(page).screenshot({ path: join(ROOT, `e2e/screens/${w}_schedule_change.png`) });
  }, { width: w });
}

// ───────── 예약 상세 상단 확인 카드: 추가 작업(C)·자재(D)·여러 확인 사항 ─────────
const actCards = (page) => page.locator('main .act-cards > .act-card, main .act-cards > .cost');
const badgesOf = async (page, id) => { await page.locator('a[href="/bookings/' + id + '"] .badge').first().waitFor(); return page.locator('a[href="/bookings/' + id + '"] .badge').allInnerTexts(); };

await test('확인 카드 C(추가 작업): 실제 내용·금액·일정 영향 → 처리 중 중복 방지 → 실패 시 상태 유지·재시도 → 동의 후 카드·확인 필요 라벨 정리, 기록 유지, 이미 처리한 동의는 다시 응답 불가', async (page) => {
  await start(page, { path: '/bookings/bk-k6' });
  const card = page.locator('section[id^="additional-"]');
  await card.waitFor();
  const t = (await card.innerText()).replace(/\s+/g, ' ');
  for (const k of ['확인이 필요해요', '추가 작업에 동의해 주세요', '스위치 박스 1개 교체 및 배선 정리', '배선이 낡아', '추가 금액 25,000원', '일정 영향 추가 방문 없음']) truthy(t.includes(k), '카드 ‘' + k + '’: ' + t);
  expectActCard(await actCardStyle(card));
  eq(await page.evaluate(() => document.querySelector('main .act-card')?.id), 'additional-aw-1', '상단 확인 영역(일반 정보보다 위)');
  // 실패 → 카드 안 오류, 동의 상태 그대로 → 다시 시도
  await page.evaluate(() => { window.__sagoDev.db.settings.failNextWrite = true; });
  await card.getByRole('button', { name: '동의하기' }).click();
  await card.locator('.banner--danger').waitFor();
  eq((await db(page)).additionalWorks.find((w) => w.id === 'aw-1').status, 'proposed', '실패 시 상태 유지');
  await card.getByRole('button', { name: '동의하기' }).dblclick();
  await card.waitFor({ state: 'detached' });
  const d = await db(page);
  eq(d.additionalWorks.find((w) => w.id === 'aw-1').status, 'agreed', '동의 반영');
  // 기록은 작업 내용 > 자재·추가 작업 상세에 남는다(동의함), 응답 버튼은 다시 나오지 않는다
  await openFold(page, '자재·추가 작업 상세');
  const rec = (await page.locator('#fold-extra-panel').innerText()).replace(/\s+/g, ' ');
  truthy(rec.includes('추가 작업 · 스위치 박스 1개 교체 및 배선 정리') && rec.includes('추가 금액 25,000원') && rec.includes('일정 영향 추가 방문 없음') && rec.includes('처리 동의함'), `기록 유지: ${rec}`);
  eq(await page.locator('#fold-extra-panel button, #fold-extra-panel a').count(), 0, '기록에는 동의·결제 버튼 없음');
  // 목록: 확인 필요 라벨 정리
  await page.goto(BASE + '/bookings?tab=active');
  eq((await badgesOf(page, 'bk-k6')).join(), '작업 중', '대표 상태 유지');
  eq(await todoOf(page.locator('a[href="/bookings/bk-k6"]')), '', '응답 후 할 일 문구 사라짐');
  // 필터 포함 여부도 바로 갱신
  await bkToggle(page).click();
  await page.locator('.filter-bar__count', { hasText: '예약 6건' }).waitFor();
  eq(await page.locator('a[href="/bookings/bk-k6"]').count(), 0, '할 일 있는 예약만에서 빠짐');
  // 이미 처리한 동의에 다시 응답하면 거부(기존 상세 화면)
  const r = await page.evaluate(async () => { try { await window.__sagoDev.repo.respondToAdditionalWork('aw-1', 'decline'); return 'ok'; } catch (e) { return e.code ?? String(e); } }).catch(() => 'n/a');
  truthy(r !== 'ok', '처리된 동의 재응답 거부: ' + r);
});

await test('확인 카드 D(자재): 사양·금액·납기·취소 조건 → 동의 전 결제 불가 → 동의 후 모의 선결제 → 결제 결과, 카드·라벨 정리(결제 상태는 예약 정보에)', async (page) => {
  await start(page, { path: '/bookings/bk-k5' });
  const card = page.locator('section[id^="material-"]');
  await card.waitFor();
  const t = (await card.innerText()).replace(/\s+/g, ' ');
  const m = (await db(page)).materials.find((x) => x.bookingId === 'bk-k5');
  for (const k of ['확인이 필요해요', '자재 주문 조건을 확인해 주세요', m.name, m.spec, m.price.toLocaleString('ko-KR') + '원', '납기', m.cancellationTerms.slice(0, 12), '모의 결제 · 실제 청구 없음']) truthy(t.includes(k), '카드 ‘' + k + '’: ' + t);
  expectActCard(await actCardStyle(card));
  const pay = card.getByRole('button', { name: /모의 결제$/ });
  truthy(await pay.isDisabled(), '동의 전 결제 불가');
  eq((await db(page)).transactions.filter((x) => x.materialOfferId === m.id).length, 0, '동의 전 거래 없음');
  await card.getByRole('checkbox').check();
  await pay.dblclick();
  await page.waitForURL((u) => u.pathname.startsWith('/pay/'));
  eq((await db(page)).transactions.filter((x) => x.materialOfferId === m.id).length, 1, '연타해도 거래 1건');
  await page.goto(BASE + '/bookings/bk-k5');
  await page.getByRole('heading', { name: '예약 정보', exact: true }).waitFor();
  eq(await page.locator('section[id^="material-"]').count(), 0, '선결제 후 카드 없음');
  await openFold(page, '결제 내역');
  truthy((await page.locator('#fold-payments-panel').innerText()).includes('자재비 선결제') && (await page.locator('#fold-payments-panel').innerText()).includes('결제 완료'), '자재 선결제 기록은 결제 내역에');
  await openFold(page, '자재·추가 작업 상세');
  const mrec = (await page.locator('#fold-extra-panel').innerText()).replace(/\s+/g, ' ');
  truthy(mrec.includes(m.name) && mrec.includes(m.spec) && mrec.includes('선결제 결제 완료') && mrec.includes('업체 주문 주문 전') && mrec.includes('취소 조건'), `자재 기록: ${mrec}`);
  await page.goto(BASE + '/bookings?tab=active');
  eq((await badgesOf(page, 'bk-k5')).join(), '방문 예정', '대표 상태 유지');
  eq(await todoOf(page.locator('a[href="/bookings/bk-k5"]')), '', '선결제 후 할 일 문구 사라짐');
});

for (const w of [360, 1280]) {
  await test('확인 카드 여러 개 ' + w + 'px: 일정·지연·추가 작업·자재·최종 금액이 동시에 있으면 각각 카드(누락·중복 없음), 긴 내용·라벨 잘림 없음, 키보드로 카드 버튼 이동', async (page) => {
    await page.setViewportSize({ width: w, height: 900 });
    // bk-k9(최종 금액 확인)에 추가 작업·자재·지연·업체 일정 제안을 함께 둔다
    await start(page, { path: '/bookings/bk-k9', patch: (d) => {
      const long = '배관 교체 범위가 예상보다 넓어 아주긴부품명ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789까지 함께 교체해야 해요';
      d.additionalWorks.push({ id: 'aw-x', bookingId: 'bk-k9', reason: long, scope: '배관 연장 교체 및 보온재 시공(긴 작업명이 줄바꿈되는지 확인)', amount: 30000, followUp: { date: '2026-10-21', window: '09:00–12:00' }, status: 'proposed' });
      d.materials.push({ id: 'mt-x', bookingId: 'bk-k9', name: '보온재', spec: '25mm 발포 보온재', quantity: 2, price: 12000, deliveryDate: '2026-10-20', cancellationTerms: '주문 후 취소 시 실비 공제', nonRefundableIfCancelled: 0, paymentStatus: 'none', orderStatus: 'not_ordered' });
      d.delays.push({ id: 'dl-x', bookingId: 'bk-k9', originalDate: '2026-10-09', originalVisitTime: '10:00', newEta: '2026-10-09T10:30:00+09:00', status: 'open' });
    } });
    await costCard(page).waitFor();
    const ids = await actCards(page).evaluateAll((els) => els.map((e) => e.id));
    eq(ids.join(), 'delay-dl-x,additional-aw-x,material-mt-x,settlement', '확인 사항마다 카드 하나(누락 없음)');
    // 같은 내용 중복 없음: 각 제목 한 번씩
    const main = await page.locator('main').innerText();
    for (const t of ['방문이 지연되고 있어요', '추가 작업에 동의해 주세요', '자재 주문 조건을 확인해 주세요', '최종 금액을 확인해 주세요']) eq(main.split(t).length - 1, 1, t + ' 한 번');
    // 카드가 일반 정보보다 위
    truthy(await page.evaluate(() => { const last = [...document.querySelectorAll('main .act-cards > *')].at(-1).getBoundingClientRect(); const info = [...document.querySelectorAll('main h2')].find((h) => h.textContent === '예약 정보').getBoundingClientRect(); return last.bottom <= info.top; }), '일반 정보보다 위');
    for (const id of ids) {
      const r = await actCardStyle(page.locator('#' + id));
      truthy(!r.overflow, id + ' 넘침 없음 ' + JSON.stringify(r));
    }
    eq(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, '가로 넘침 없음');
    // 목록: 확인 필요 라벨(최종 금액 외 확인 사항이 있으므로)
    await page.goto(BASE + '/bookings?tab=active');
    eq((await badgesOf(page, 'bk-k9')).join(), '최종 정산', '대표 상태');
    // 여러 할 일: 중요한 하나 + 외 N건(지연 → 추가 작업 → 자재 → 최종 금액)
    eq(await todoOf(page.locator('a[href="/bookings/bk-k9"]')), '방문 지연 대응을 선택해 주세요 외 3건', '여러 할 일 요약');
    const tr = await page.locator('a[href="/bookings/bk-k9"] .card-todo').evaluate((e) => ({ over: e.scrollWidth > e.clientWidth + 1, right: e.getBoundingClientRect().right <= e.closest('a').getBoundingClientRect().right }));
    truthy(!tr.over && tr.right, `할 일 문구 잘림 없음 ${JSON.stringify(tr)}`);
    // 키보드: 카드 링크에 포커스 → Enter로 상세
    await page.locator('a[href="/bookings/bk-k9"]').focus();
    await page.keyboard.press('Enter');
    await page.waitForURL((u) => u.pathname === '/bookings/bk-k9');
    // 키보드: 추가 작업 카드 [동의하기] → Tab → [동의하지 않기]
    const add = page.locator('#additional-aw-x');
    await add.getByRole('button', { name: '동의하기' }).focus();
    await page.keyboard.press('Tab');
    eq(await page.evaluate(() => document.activeElement?.textContent), '동의하지 않기', 'Tab으로 다음 버튼');
    truthy(await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle !== 'none'), '포커스 표시');
    await page.keyboard.press('Enter');
    await add.waitFor({ state: 'detached' });
    eq((await db(page)).additionalWorks.find((x) => x.id === 'aw-x').status, 'declined', '키보드로 응답');
    eq(await actCards(page).count(), 3, '응답한 카드만 사라짐');
    await page.mouse.move(0, 0);
    await page.locator('main .act-cards').screenshot({ path: join(ROOT, 'e2e/screens/' + w + '_action_cards.png') });
  }, { width: w });
}

await test('방문 시각: 요청(가능 시간) → 승인(제안 시각) → 결제 → 내 예약 목록·상세·알림이 같은 시각', async (page) => {
  await start(page, { path: '/requests/rq-4' });
  await waitText(page, '방문 일정과 금액을 확인해 주세요');
  let main = await page.locator('main').innerText();
  truthy((await page.locator('#pay').innerText()).replace(/\s+/g, ' ').includes('방문 일정 10월 20일 (화) 14:00'), '결제 전 제안 시각(결제 카드)');
  truthy(main.includes('13:00~16:00'), '고객 가능 시간은 보낸 요청 내용에 표시');
  eq((await db(page)).bookings.filter((b) => b.requestId === 'rq-4').length, 0, '승인 ≠ 예약 확정(결제 전 예약 없음)');
  await page.goto(`${BASE}/requests/rq-4/approval`);
  await waitText(page, '방문 일정과 금액을 확인해 주세요');
  truthy((await page.locator('main').innerText()).includes('10월 20일 (화) 14:00'), '승인 확인 화면 제안 시각');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: PAY_BTN }).click();
  await waitText(page, '예약이 확정됐어요');
  const d = await db(page);
  const bk = d.bookings.find((b) => b.requestId === 'rq-4');
  eq(bk.visitTime, '14:00', '결제 후 확정 시각');
  truthy(d.notices[0].title.includes('방문 예정 10월 20일 (화) 14:00'), `알림: ${d.notices[0].title}`);
  await page.goto(`${BASE}/bookings/${bk.id}`);
  await waitText(page, '방문 일정');
  main = await page.locator('main').innerText();
  truthy(main.includes('10월 20일 (화) 14:00'), '예약 상세 방문 시각');
  await page.goto(`${BASE}/bookings?tab=active`);
  await page.getByText('방문 예정 · 10월 20일 (화) 14:00').first().waitFor();
  truthy(!(await page.locator('main').innerText()).includes('13:00~16:00'), '목록에 가능 시간 범위를 방문 시각으로 표시하지 않음');
});

await test('방문 시각: 데이터에 없으면 추정하지 않고 ‘방문 시각 확인 필요’', async (page) => {
  await start(page, { path: '/bookings/bk-k1', patch: (d) => { delete d.bookings.find((b) => b.id === 'bk-k1').visitTime; } });
  await waitText(page, '방문 시각 확인 필요');
  truthy(!(await page.locator('main').innerText()).includes('10월 19일 (월) 13:00'), '범위 시작값으로 추정하지 않음');
  await page.goto(`${BASE}/bookings?tab=active`);
  await waitText(page, '방문 시각 확인 필요');
});

await test('변경(고객 요청): 마감 후 변경은 기존 확정 출장비 몫을 비용으로 안내', async (page) => {
  await start(page, { path: '/bookings/bk-k2/change' });
  await waitText(page, '다른 공동 날짜로');
  await page.locator('input[name="grp"]').first().check();
  await waitText(page, '변경 비용(기존 확정 출장비 몫)');
  await waitText(page, '12,500원');
  await page.getByRole('button', { name: /^\d\d:\d\d~\d\d:\d\d$/ }).first().click();
  await page.getByLabel('변경 사유').fill('일정이 바뀌었어요');
  await page.getByRole('button', { name: '변경 요청 보내기' }).click();
  await waitText(page, '업체가 동의하기 전까지 기존 일정이 유지돼요');
});

await test('자재: 동의 전 청구 없음 → 선결제 후에도 주문은 별도 상태', async (page) => {
  await start(page, { path: '/materials/mt-1' });
  await waitText(page, '동의하기 전에는 결제되지 않아요');
  await waitText(page, '최대 30,000원');
  truthy(await page.getByRole('button', { name: /동의하고/ }).isDisabled(), '동의 전 비활성');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: /동의하고/ }).dblclick();
  await waitText(page, '자재비 선결제 결제가 완료됐어요').catch(() => {});
  await page.goto(`${BASE}/materials/mt-1`);
  await waitText(page, '주문 전');
  const d = await db(page);
  eq(d.transactions.filter((t) => t.materialOfferId === 'mt-1').length, 1, '자재 결제 거래 수');
  eq(d.materials.find((m) => m.id === 'mt-1').orderStatus, 'not_ordered', '주문 상태');
});

await test('추가 작업: 동의하지 않으면 청구 없음', async (page) => {
  await start(page, { path: '/additional/aw-1' });
  await waitText(page, '동의하기 전에는 비용이 청구되지 않아요');
  const before = (await db(page)).transactions.length;
  await page.getByRole('button', { name: '동의하지 않아요' }).click();
  await waitText(page, '추가 작업에 동의하지 않았어요');
  eq((await db(page)).transactions.length, before, '거래 수');
});

await test('이용 후: 정산 완료 건 리뷰 작성, 미정산 건은 작성 불가', async (page) => {
  await start(page, { path: '/bookings/bk-k13/review' });
  await page.getByRole('button', { name: '리뷰 등록하기' }).click();
  await waitText(page, '별점을 선택해 주세요');
  await page.getByRole('button', { name: '5점' }).click();
  await page.getByLabel('후기').fill('친절했어요');
  await page.getByRole('button', { name: '리뷰 등록하기' }).click();
  await waitText(page, '리뷰를 등록했어요');
  await page.goto(`${BASE}/bookings/bk-k9/review`);
  await waitText(page, '정산이 끝난 이용 건에서 리뷰를 쓸 수 있어요');
});

await test('결제·환불 내역: 목록·상세·환불 상태 문구', async (page) => {
  await start(page, { path: '/ledger' });
  await waitText(page, '결제·환불 내역');
  await page.getByRole('button', { name: '환불·공제' }).click();
  await waitText(page, '환불 처리 요청 접수').catch(() => waitText(page, '환불 처리 완료'));
  await page.locator('a[href^="/ledger/"]').first().click();
  await waitText(page, '카드·계좌');
});

await test('빈 상태: 요청·예약·내역이 없을 때', async (page) => {
  await start(page, { path: '/bookings?tab=requests', patch: (d) => { d.requests = []; d.approvals = []; d.bookings = []; d.transactions = []; d.refunds = []; d.deductions = []; d.proposals = []; d.delays = []; d.materials = []; d.additionalWorks = []; d.statements = []; d.reviews = []; } });
  await waitText(page, '보낸 요청이 없어요');
  eq(await page.locator('.filter-bar').count(), 0, '요청이 없으면 필터 숨김');
  await page.locator('.empty').getByRole('link', { name: '업체 찾아보기' }).waitFor();
  await page.getByRole('tab', { name: '확정된 예약' }).click(); await waitText(page, '확정된 예약이 없어요');
  eq(await page.locator('.filter-bar').count(), 0, '예약이 없으면 필터 숨김');
  await page.getByRole('tab', { name: '완료·취소' }).click(); await waitText(page, '완료되거나 취소된 예약이 없어요');
  await page.goto(`${BASE}/ledger`); await waitText(page, '내역이 없어요');
});

await test('시스템: 없는 화면은 안전한 안내(S-05), 이용 안내(S-03)', async (page) => {
  await start(page, { path: '/requests/없는요청' });
  await waitText(page, '이 내역을 확인할 수 없습니다');
  await page.goto(`${BASE}/zzz`); await waitText(page, '찾을 수 없는 화면이에요');
  await page.goto(`${BASE}/guide`); await waitText(page, '예약이 확정되는 때');
});

await test('정책 문구: 할인·채팅·보증 표현 금지', async (page) => {
  const urls = ['/', '/providers/p1', '/requests/rq-3/approval', '/bookings/bk-k2', '/guide'];
  await start(page, { path: '/' });
  for (const u of urls) {
    await page.goto(`${BASE}${u}`); await page.waitForTimeout(400);
    const body = await page.locator('body').innerText();
    truthy(!/출장비[^.\n]{0,12}할인(?!\s*조건)/.test(body.replace(/업체 추가 할인 조건/g, '')), `${u}: 출장비 할인 표현`);
    truthy(!/채팅하기|메시지 보내기|보증합니다|인증 업체|인증 배지/.test(body), `${u}: 금지 표현`);
  }
});

// ───────── 업체 상세: 공동 예약 캘린더 ─────────
const dayBtn = (page, md) => page.locator(`.jcal button[data-day="2026-${md}"]`);
const reqBtn = (page) => page.getByRole('button', { name: '이 날짜로 수리 요청하기' });

await test('방문 날짜 캘린더: 공동 예약·새 요청 가능·요청 불가 구분(휴무·과거·48시간 이전 비활성), 처음엔 자동 선택 없음', async (page) => {
  await start(page, { path: '/providers/p1' });
  await page.locator('.jcal').waitFor();
  eq(await page.locator('.jcal__title').innerText(), '2026년 10월', '처음 보여주는 달');
  eq(await page.getByText(/날짜를 선택해 ?주세요/).count(), 0, '캘린더 아래 별도 날짜 선택 안내 없음');
  const joint = await page.locator('.jcal button.jcal__day--open:not([disabled])').evaluateAll((els) => els.map((e) => e.dataset.day));
  eq(JSON.stringify(joint), JSON.stringify(['2026-10-19', '2026-10-21', '2026-10-23']), '공동 예약 날짜(데모: 19·21·23일 그대로)');
  const fresh = await page.locator('.jcal button.jcal__day--new:not([disabled])').evaluateAll((els) => els.map((e) => e.dataset.day.slice(5)));
  eq(fresh.join(','), '10-15,10-16,10-17,10-20,10-22,10-24,10-26,10-27,10-29,10-30,10-31', '새 요청 가능 날짜(한빛설비 월~토, 10/28 휴무, 48시간 이후)');
  truthy(await dayBtn(page, '10-18').isDisabled(), '쉬는 요일(일) 비활성');
  truthy(await dayBtn(page, '10-28').isDisabled(), '휴무일 비활성');
  truthy(await dayBtn(page, '10-14').isDisabled(), '48시간 이전 비활성');
  truthy(await dayBtn(page, '10-12').isDisabled(), '지난 날짜 비활성');
  eq(await page.getByRole('link', { name: '다른 날짜로 새 예약 요청' }).count(), 0, '별도 새 날짜 요청 버튼 없음');
  eq((await page.locator('.jcal__legend').innerText()).replace(/\s+/g, ' ').trim(), '공동 예약 새 요청 가능', '범례');
  eq(await page.locator('input[name="joint-group"]').count(), 0, '날짜 선택 전 카드 없음');
  truthy(await reqBtn(page).isDisabled(), '요청 버튼 비활성');
  // 접근성 이름·오늘 표시(색 외 ‘오늘’ 글자)
  eq(await dayBtn(page, '10-13').getAttribute('aria-label'), '2026년 10월 13일 화요일, 오늘, 요청 불가', '오늘 이름');
  truthy((await dayBtn(page, '10-13').innerText()).includes('오늘'), '오늘 글자');
  eq(await dayBtn(page, '10-19').getAttribute('aria-label'), '2026년 10월 19일 월요일, 공동 예약 참여 가능 1개', '공동 예약 날짜 이름');
  eq(await dayBtn(page, '10-21').getAttribute('aria-label'), '2026년 10월 21일 수요일, 공동 예약 참여 가능 1개', '21일도 공동 예약(데모 두 번째 그룹, 새 요청도 가능하지만 공동 예약 우선)');
  eq(await dayBtn(page, '10-20').getAttribute('aria-label'), '2026년 10월 20일 화요일, 새 요청 가능', '새 요청 날짜 이름');
  eq(await dayBtn(page, '10-18').getAttribute('aria-label'), '2026년 10월 18일 일요일, 요청 불가', '요청 불가 날짜 이름');
  eq(await dayBtn(page, '10-20').locator('.jcal__num').evaluate((e) => getComputedStyle(e).backgroundColor), 'rgb(238, 240, 243)', '새 요청 날짜 연한 회색 원');
  eq(await dayBtn(page, '10-19').locator('.jcal__num').evaluate((e) => getComputedStyle(e).backgroundColor), 'rgb(237, 243, 252)', '가능 날짜 연한 블루 원');
  // 비활성 날짜는 눌러도 아무 일 없음
  await dayBtn(page, '10-18').click({ force: true });
  eq(await page.locator('.jcal button[aria-pressed="true"]').count(), 0, '비활성 날짜는 선택되지 않음');
  truthy(await reqBtn(page).isDisabled(), '날짜 미선택이면 요청 버튼 비활성');
  await page.screenshot({ path: join(ROOT, 'e2e/screens/390_provider_calendar.png'), fullPage: true });
});

/** 같은 날 여러 그룹 구조 확인용: 데모에서 21일에 둔 g1b를 g1과 같은 19일(마감 18일 12:00)로 옮긴다(구조는 그대로 지원) */
const sameDayG1b = (db) => { const g = db.groups.find((x) => x.id === 'g1b'); g.date = '2026-10-19'; g.closeAt = '2026-10-18T12:00:00+09:00'; };

await test('공동 예약 캘린더: 날짜 선택 → 그 날짜 카드만, 같은 날 여러 그룹(구조 유지) 비교·단일 선택, 날짜만으로는 요청 불가', async (page) => {
  await start(page, { path: '/providers/p1', patch: sameDayG1b });
  await dayBtn(page, '10-19').click();
  eq(await dayBtn(page, '10-19').getAttribute('aria-pressed'), 'true', '선택 표시');
  const cards = page.locator('.joint-card');
  await page.locator('.joint-card').first().waitFor();
  eq(await cards.count(), 2, '같은 날 두 그룹');
  eq(await page.locator('input[name="joint-group"]:checked').count(), 0, '그룹 자동 선택 없음');
  truthy(await reqBtn(page).isDisabled(), '날짜만 선택하면 비활성');
  const t1 = await cards.nth(0).innerText(); const t2 = await cards.nth(1).innerText();
  truthy(t1.includes('09:00 · 10:00 · 11:00 · 13:00 · 14:00 · 15:00') && t1.includes('약 12,500원') && t1.includes('본인 예약 확정 시 4세대 기준') && t1.includes('남은 자리') && t1.includes('2자리') && t1.includes('3세대'), `g1 카드: ${t1}`);
  truthy(t2.includes('13:00 · 14:00 · 15:00') && t2.includes('약 22,500원') && t2.includes('본인 예약 확정 시 2세대 기준') && t2.includes('10월 18일 (일) 12:00'), `g1b 카드: ${t2}`);
  truthy(t1.includes('공동 예약') && !t1.includes('같은 단지'), `표시 라벨은 ‘공동 예약’: ${t1}`);
  eq(await page.locator('.joint-card details').count(), 0, '출장비 계산 상세 없음');
  eq(await page.getByText('의 공동 예약', { exact: false }).count(), 0, '날짜 제목 없음');
  eq(await page.getByText('신청 가능한 시각은 요청할 수 있는 후보예요').count(), 0, '긴 설명 없음');
  // 단일 선택
  await cards.nth(0).locator('input').check();
  await cards.nth(1).locator('input').check();
  eq(await page.locator('input[name="joint-group"]:checked').count(), 1, '하나만 선택');
  truthy(await reqBtn(page).isEnabled(), '그룹 선택 후 활성');
  await page.screenshot({ path: join(ROOT, 'e2e/screens/390_provider_calendar_day.png'), fullPage: true });
  // 신청: 최신 상태 확인 후 기존 요청서로(선택한 그룹)
  await reqBtn(page).click();
  await page.waitForURL((u) => u.pathname === '/providers/p1/request' && u.searchParams.get('group') === 'g1b');
  await waitText(page, '수리 요청서');
});


for (const w of [390, 1280]) {
  await test(`업체 상세 ${w}px: 데모 공동 예약 19·21·23일(날짜당 하나), 신청 가능한 시각 안내(요청서와 같은 시각), 날짜 변경 시 선택 해제, 요청서로 그룹 조건 연결, 제공 작업 = 요청서 작업(안내용 칩), 하단 안내·흰 띠·고정 없음`, async (page) => {
    await page.setViewportSize({ width: w, height: 800 });
    await start(page, { path: '/providers/p1' });
    await page.locator('.jcal').waitFor();
    // 제공 작업: 업체 등록 작업(요청서와 같은 데이터·순서), 안내용(선택·버튼 없음)
    const tags = await page.locator('.svc-tags .svc-tag').allInnerTexts();
    eq(tags.join('/'), '수전 교체/샤워기 교체/배수 트랩 교체/배수구 막힘 수리/세면대 부속 교체/실리콘 재시공', '제공 작업 = 업체 등록 작업');
    const tagInfo = await page.evaluate(() => {
      const list = document.querySelector('.svc-tags'); const t = list.querySelector('.svc-tag'); const c = getComputedStyle(t); const r = t.getBoundingClientRect();
      return { interactive: list.querySelectorAll('button, input, a, [role="button"], [tabindex]').length, svg: list.querySelectorAll('svg').length, cursor: c.cursor, h: Math.round(r.height), fs: parseFloat(c.fontSize), border: c.borderTopColor, bg: c.backgroundColor, overflow: document.documentElement.scrollWidth > innerWidth };
    });
    truthy(tagInfo.interactive === 0 && tagInfo.svg === 0 && tagInfo.cursor !== 'pointer' && tagInfo.h === 28 && tagInfo.fs === 13 && tagInfo.border === 'rgb(201, 206, 214)' && tagInfo.bg === 'rgb(255, 255, 255)' && !tagInfo.overflow, `안내용 작은 칩(요청서 칩과 같은 크기·모양) ${JSON.stringify(tagInfo)}`);
    // 하단 안내·흰 띠·고정 없음, 본문 다음 일반 흐름(24px), 카드 너비
    eq(await page.getByText('요청만으로는 예약이 확정되지 않아요').count(), 0, '하단 안내 문구 없음');
    eq(await page.locator('.action-bar').count(), 0, '흰 배경 바 없음');
    const b = await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === '이 날짜로 수리 요청하기');
      const chain = []; for (let e = btn; e && e !== document.body; e = e.parentElement) chain.push(getComputedStyle(e).position);
      const br = btn.getBoundingClientRect(); const prev = btn.previousElementSibling.getBoundingClientRect(); const main = document.querySelector('main');
      const card = [...document.querySelectorAll('section .card')].at(-1).getBoundingClientRect(); const pc = getComputedStyle(btn.parentElement);
      return { pinned: chain.some((p) => p === 'fixed' || p === 'sticky'), gap: Math.round(br.top - prev.bottom), below: Math.round(main.getBoundingClientRect().bottom - br.bottom), pad: parseFloat(getComputedStyle(main).paddingBottom),
        sameWidth: Math.round(br.width) === Math.round(card.width) && Math.round(br.left) === Math.round(card.left), parentBg: pc.backgroundColor, parentBorder: pc.borderTopWidth, bg: getComputedStyle(btn).backgroundColor };
    });
    truthy(!b.pinned && b.gap === 24 && b.below === b.pad && b.sameWidth && b.parentBg === 'rgba(0, 0, 0, 0)' && b.parentBorder === '0px', `버튼 배치 ${JSON.stringify(b)}`);
    truthy(await reqBtn(page).isDisabled(), '일정 선택 전 비활성');
    // 16일: 첫 번째 그룹(g1)만
    await dayBtn(page, '10-19').click();
    await page.locator('.joint-card').first().waitFor();
    eq(await page.locator('.joint-card').count(), 1, '19일 카드 1개');
    eq(await page.locator('.joint-card input, .joint-card details').count(), 0, '라디오·계산 상세 없음');
    eq(await page.getByText('10월 19일(월)의 공동 예약').count(), 0, '날짜 제목 없음');
    eq(await page.getByText('신청 가능한 시각은 요청할 수 있는 후보예요').count(), 0, '긴 설명 없음');
    let c = await page.locator('.joint-card').first().innerText();
    truthy(c.includes('공동 예약') && !c.includes('같은 단지') && c.includes('신청 가능한 시각') && c.includes('09:00 · 10:00 · 11:00 · 13:00 · 14:00 · 15:00') && c.includes('10월 18일 (일) 18:00') && c.includes('확정 세대') && c.includes('남은 자리') && c.includes('약 12,500원') && c.includes('본인 예약 확정 시 4세대 기준') && !c.includes('~'), `g1 카드: ${c}`);
    eq(await page.locator('.kv__times button, .kv__times input').count(), 0, '시각 목록은 안내용(버튼 아님)');
    truthy(await reqBtn(page).isEnabled(), '날짜 선택만으로 그룹 자동 선택 → 활성');
    // 카드 정렬: 라디오 자리 여백 없이 배지·정보 행 왼쪽이 카드 안쪽 여백에 맞고, 시간 목록이 넘치지 않는다
    const al = await page.evaluate(() => {
      const c = document.querySelector('.joint-card'); const cr = c.getBoundingClientRect(); const pad = parseFloat(getComputedStyle(c).paddingLeft) + parseFloat(getComputedStyle(c).borderLeftWidth);
      const badge = c.querySelector('.badge').getBoundingClientRect(); const k = c.querySelector('.kv__k').getBoundingClientRect();
      const t = c.querySelector('.kv__times').getBoundingClientRect();
      return { badge: Math.round(badge.left - cr.left), k: Math.round(k.left - cr.left), pad: Math.round(pad), over: t.right > cr.right - pad + 0.5, page: document.documentElement.scrollWidth > innerWidth };
    });
    truthy(al.badge === al.pad && al.k === al.pad && !al.over && !al.page, `카드 정렬 ${JSON.stringify(al)}`);
    // 17일: 두 번째 그룹(g1b)만, 이전 날짜 선택 해제
    await dayBtn(page, '10-21').click();
    await page.locator('.joint-card').filter({ hasText: '13:00 · 14:00 · 15:00' }).waitFor();
    eq(await page.locator('.joint-card').count(), 1, '21일 카드 1개(이전 날짜 카드 없음)');
    c = await page.locator('.joint-card').first().innerText();
    truthy(c.includes('13:00 · 14:00 · 15:00') && !c.includes('09:00') && c.includes('10월 20일 (화) 12:00') && c.includes('약 22,500원') && c.includes('1세대'), `g1b 카드: ${c}`);
    const cardTimes = (await page.locator('.kv__times').first().innerText()).split('·').map((x) => x.trim());
    truthy(await reqBtn(page).isEnabled(), '바꾼 날짜의 그룹 자동 선택');
    await reqBtn(page).click();
    // 요청서: 선택한 그룹 ID·날짜·마감·출장비, 그 그룹 시각만
    await page.waitForURL((u) => u.pathname === '/providers/p1/request' && u.searchParams.get('group') === 'g1b');
    await waitText(page, '수리 요청서');
    const kv = await page.locator('form .card').first().innerText();
    truthy(kv.includes('공동 예약 날짜 참여') && kv.includes('10월 21일 (수)') && kv.includes('10월 20일 (화) 12:00') && kv.includes('약 22,500원'), `요청서 그룹 조건: ${kv}`);
    await page.locator('.time-pick .svc-chip').first().waitFor();
    const formTimes = (await page.locator('.time-pick .svc-chip').allInnerTexts()).map((x) => x.trim());
    eq(formTimes.join(' '), cardTimes.join(' '), '공동 예약 카드와 요청서 시각 일치(다른 그룹 시각 없음)');
    eq((await page.locator('.task-pick .svc-chip').allInnerTexts()).map((x) => x.trim()).join('/'), tags.join('/'), '요청서 작업 = 업체 상세 제공 작업');
    // 새 요청: 새 요청 가능 날짜 → 안내 카드 → 요청서(희망 날짜만, 그룹 ID 없음)
    await page.goto(`${BASE}/providers/p1`);
    await dayBtn(page, '10-20').click();
    const nc = await page.locator('.new-day').innerText();
    truthy(nc.includes('새 요청') && nc.includes('10월 20일(화)에 새 요청') && nc.includes('현재 참여 가능한 공동 예약은 없어요.') && nc.includes('업체가 방문 가능 여부를 확인해요.') && nc.includes('50,000원') && nc.includes('이후 이웃이 함께하면 출장비를 나눠 낼 수 있어요.'), `새 요청 카드: ${nc}`);
    eq(await page.locator('.joint-card').count(), 0, '새 요청 날짜에는 공동 예약 카드 없음');
    await reqBtn(page).click();
    await page.waitForURL((u) => u.searchParams.get('new') === '1' && u.searchParams.get('date') === '2026-10-20' && !u.searchParams.get('group'));
    if (w === 390) await page.goto(`${BASE}/providers/p1`);
    if (w === 390) { await dayBtn(page, '10-21').click(); await page.locator('.joint-card').first().waitFor(); await page.screenshot({ path: join(ROOT, 'e2e/screens/390_provider_detail_split.png'), fullPage: true }); }
    if (w === 390) { await dayBtn(page, '10-20').click(); await page.locator('.new-day').waitFor(); await page.screenshot({ path: join(ROOT, 'e2e/screens/390_provider_detail_new_day.png'), fullPage: true }); }
  }, { width: w });
}
await test('공동 예약 캘린더: 월 이동(다음 달 일정)·날짜 변경 시 이전 그룹 선택 해제·선택 날짜 제목 유지', async (page) => {
  await start(page, { path: '/providers/p1', patch: (db) => { const g = db.groups.find((x) => x.id === 'g1n'); g.date = '2026-11-03'; g.closeAt = '2026-11-02T18:00:00+09:00'; } /* 다음 달 일정 확인용 */ });
  await dayBtn(page, '10-19').click();
  await page.locator('.joint-card').first().waitFor();
  truthy(await reqBtn(page).isEnabled(), '자동 선택');
  truthy(await page.getByRole('button', { name: '이전 달' }).isDisabled(), '이번 달 이전으로는 이동 불가');
  await page.getByRole('button', { name: '다음 달' }).click();
  eq(await page.locator('.jcal__title').innerText(), '2026년 11월', '다음 달');
  // 월만 옮기면 선택 날짜·카드는 유지된다
  eq(await page.locator('.joint-card').count(), 1, '월 이동 후에도 카드 유지');
  truthy(await reqBtn(page).isEnabled(), '월 이동만으로는 선택 유지');
  await page.locator('.jcal button[data-day="2026-11-03"]').click();
  await page.locator('.joint-card').filter({ hasText: '11월 2일' }).waitFor();
  eq(await page.locator('.joint-card').count(), 1, '11/3 카드만');
  truthy(await reqBtn(page).isEnabled(), '바꾼 날짜의 그룹 자동 선택');
  await reqBtn(page).click();
  await page.waitForURL((u) => u.searchParams.get('group') === 'g1n');
  await page.goBack();
  await page.locator('.jcal').waitFor();
  // 키보드: 방향키로 신청 가능 날짜 이동, Enter로 선택
  await page.getByRole('button', { name: '이전 달' }).click();
  await dayBtn(page, '10-19').focus();
  await page.keyboard.press('Enter');
  await page.locator('.joint-card').filter({ hasText: '10월 18일 (일) 18:00' }).waitFor();
  truthy(await dayBtn(page, '10-19').evaluate((el) => el === document.activeElement && getComputedStyle(el).outlineStyle !== 'none'), '키보드 포커스 표시');
});

await test('공동 예약 캘린더: 이번 달에 일정이 없으면 가장 가까운 달, 연도 넘김(12월 → 1월)', async (page) => {
  await start(page, { path: '/providers/p1', patch: (db) => {
    for (const g of db.groups.filter((x) => x.providerId === 'p1')) { g.date = '2027-01-08'; g.closeAt = '2027-01-07T18:00:00+09:00'; }
    db.groups.find((x) => x.id === 'g1b').date = '2027-02-02'; db.groups.find((x) => x.id === 'g1b').closeAt = '2027-02-01T18:00:00+09:00';
    db.now = '2026-12-20T10:00:00+09:00';
  } });
  await page.locator('.jcal').waitFor();
  eq(await page.locator('.jcal__title').innerText(), '2027년 1월', '가장 가까운 일정의 달');
  await page.locator('.jcal button[data-day="2027-01-08"]').click();
  await page.locator('.joint-card').first().waitFor();
  eq(await page.locator('.joint-card input[type=radio]').count(), 2, '같은 날 두 그룹은 라디오로 직접 선택');
  truthy(await reqBtn(page).isDisabled(), '여러 그룹이면 자동 선택 없음');
  await page.getByRole('button', { name: '이전 달' }).click();
  eq(await page.locator('.jcal__title').innerText(), '2026년 12월', '이전 해로');
  await page.getByRole('button', { name: '다음 달' }).click(); await page.getByRole('button', { name: '다음 달' }).click();
  eq(await page.locator('.jcal__title').innerText(), '2027년 2월', '다음 해 2월');
  truthy(await page.locator('.jcal button[data-day="2027-02-02"]').isEnabled(), '2월 일정');
});

await test('방문 날짜 캘린더: 공동 일정 없음 → 새 요청 날짜만 / 날짜 조회 오류 → 재시도', async (page) => {
  await start(page, { path: '/providers/p1', address: 'ad-far' });
  await page.locator('.jcal').waitFor();
  eq(await page.locator('.jcal button.jcal__day--open').count(), 0, '공동 예약 날짜 없음');
  truthy(await dayBtn(page, '10-19').isEnabled() && await dayBtn(page, '10-18').isDisabled(), '새 요청 기준으로만 날짜 활성(일요일 비활성)');
  await dayBtn(page, '10-19').click();
  await waitText(page, '현재 참여 가능한 공동 예약은 없어요.');
  await reqBtn(page).click();
  await page.waitForURL((u) => u.pathname === '/providers/p1/request' && u.searchParams.get('new') === '1' && u.searchParams.get('date') === '2026-10-19');
  await start(page, { path: '/providers/p1' });
  await page.locator('.jcal').waitFor();
  // 다음 조회(날짜별) 1회 실패: 저장소 변경 알림 없이 설정해 다른 화면 조회에는 영향을 주지 않는다
  await page.waitForFunction(() => !!window.__sagoDev);
  await page.evaluate(() => { window.__sagoDev.db.settings.failNextQuery = true; });
  await dayBtn(page, '10-19').click();
  await page.getByRole('button', { name: '다시 시도' }).click();
  await page.locator('.joint-card').first().waitFor();
  eq(await page.locator('.joint-card').count(), 1, '재시도 후 카드');
});

await test('공동 예약 캘린더: 선택 후 그룹이 마감·자리 없음이 되면 선택 해제·사유·다른 일정 제공', async (page) => {
  await start(page, { path: '/providers/p1', patch: sameDayG1b });
  await dayBtn(page, '10-19').click();
  await page.locator('.joint-card').nth(1).locator('input').check(); // g1b
  await dev(page, 'closeGroup', 'g1b'); // 업체가 접수 마감
  await waitText(page, '선택한 일정을 신청할 수 없게 됐어요');
  await waitText(page, '접수가 마감·종료됐거나');
  eq(await page.locator('input[name="joint-group"]:checked').count(), 0, '선택 해제');
  truthy(await reqBtn(page).isDisabled(), '요청 버튼 비활성');
  eq(await page.locator('.joint-card').count(), 1, '같은 날짜의 다른 일정');
  truthy(await dayBtn(page, '10-20').isEnabled(), '다른 날짜(새 요청) 선택 가능');
  console.log('DEBUG', await page.locator('.joint-card').first().evaluate((e) => e.outerHTML.slice(0, 200)), await page.evaluate(() => sessionStorage.getItem(Object.keys(sessionStorage).find((k) => k.includes('pick')) ?? '')));
  // 자리 없음: 화면 갱신 알림 없이 다른 고객이 자리를 채운 상황 → 요청 버튼을 누를 때 최신 상태로 다시 확인
  await page.locator('.joint-card input').first().check(); // g1
  await page.evaluate(() => { const g = window.__sagoDev.db.groups.find((x) => x.id === 'g1'); g.pendingSeats = g.capacity - g.confirmedHouseholds; });
  await reqBtn(page).click();
  await waitText(page, '남은 자리가 없어요.');
  eq(new URL(page.url()).pathname, '/providers/p1', '요청서로 넘어가지 않음');
  eq(await page.locator('input[name="joint-group"]:checked').count(), 0, '선택 해제');
  truthy(await reqBtn(page).isDisabled(), '요청 버튼 비활성');
});

await test('방문 날짜 캘린더: 공동 예약이 마감·정원 초과된 날짜는 새 요청 기준으로 따로 판단하고 사유를 안내, 날짜 유형을 바꾸면 그룹 선택이 남지 않음', async (page) => {
  // 21일(g1b) 정원 초과, 23일(g1n) 접수 마감 처리
  await start(page, { path: '/providers/p1', patch: (db) => {
    const full = db.groups.find((x) => x.id === 'g1b'); full.pendingSeats = full.capacity - full.confirmedHouseholds;
    db.groups.find((x) => x.id === 'g1n').closed = true;
  } });
  await page.locator('.jcal').waitFor();
  eq(await dayBtn(page, '10-21').getAttribute('aria-label'), '2026년 10월 21일 수요일, 새 요청 가능', '정원 초과 날짜는 새 요청 기준(수요일)');
  eq(await dayBtn(page, '10-23').getAttribute('aria-label'), '2026년 10월 23일 금요일, 새 요청 가능', '마감 날짜는 새 요청 기준(금요일)');
  await dayBtn(page, '10-21').click();
  await waitText(page, '이 날짜의 공동 예약은 남은 자리가 없어요.');
  await dayBtn(page, '10-23').click();
  await waitText(page, '이 날짜의 공동 예약은 접수가 마감됐어요.');
  // 공동 예약 날짜에서 그룹 선택 → 새 요청 날짜로 바꾸면 그룹 선택이 풀리고, 요청서에는 그룹 ID가 가지 않는다
  await dayBtn(page, '10-19').click();
  await page.locator('.joint-card').first().waitFor(); // 날짜당 그룹 하나 → 자동 선택
  truthy(await reqBtn(page).isEnabled(), '그룹 선택 후 활성');
  await dayBtn(page, '10-20').click();
  eq(await page.locator('.joint-card').count(), 0, '공동 예약 카드 사라짐');
  truthy(await reqBtn(page).isEnabled(), '새 요청 날짜는 날짜만으로 활성');
  await reqBtn(page).click();
  await page.waitForURL((u) => u.pathname === '/providers/p1/request' && u.searchParams.get('date') === '2026-10-20' && !u.searchParams.get('group'));
  await waitText(page, '희망 날짜');
  // 뒤로: 새 요청 날짜 선택 복원(그룹 없음), 새로고침해도 같은 날짜
  await page.locator('.app-header').getByRole('button', { name: '뒤로 가기' }).click();
  await page.waitForURL((u) => u.pathname === '/providers/p1');
  await page.locator('.new-day').waitFor();
  eq(await page.locator('.jcal button[aria-pressed="true"]').getAttribute('data-day'), '2026-10-20', '뒤로가기 후 새 요청 날짜 유지');
  await page.reload();
  await page.locator('.new-day').waitFor();
  eq(await page.locator('.jcal button[aria-pressed="true"]').getAttribute('data-day'), '2026-10-20', '새로고침 후 유지');
  eq(await page.locator('input[name="joint-group"]:checked').count(), 0, '그룹 선택 없음');
});

for (const w of [360, 1280]) {
  await test(`공동 예약 캘린더: ${w}px 표시 — 날짜 칸·월 이동 버튼 크기, 펼친 카드가 넘치지 않음`, async (page) => {
    await page.setViewportSize({ width: w, height: 900 });
    await start(page, { path: '/providers/p1' });
    const sz = await page.evaluate(() => [...document.querySelectorAll('.jcal__day, .jcal__navbtn')].map((b) => { const r = b.getBoundingClientRect(); return Math.min(r.width, r.height); }));
    truthy(Math.min(...sz) >= 44, `조작 영역이 작음: ${Math.min(...sz)}`);
    await dayBtn(page, '10-19').click();
    await page.locator('.joint-card').first().waitFor();
    for (const d of await page.locator('.joint-card summary').all()) await d.click();
    const bad = await page.evaluate(() => {
      const out = [];
      for (const card of document.querySelectorAll('.joint-card')) {
        const cr = card.getBoundingClientRect();
        for (const el of card.querySelectorAll('*')) { const r = el.getBoundingClientRect(); if (r.width && (r.right > cr.right + 0.5 || r.left < cr.left - 0.5)) out.push(el.textContent.trim().slice(0, 30)); }
      }
      return { out, over: document.documentElement.scrollWidth > innerWidth };
    });
    truthy(!bad.out.length && !bad.over, `카드 넘침: ${JSON.stringify(bad)}`);
    await page.screenshot({ path: join(ROOT, `e2e/screens/${w}_provider_calendar_day_open.png`), fullPage: true });
  }, { width: w });
}


for (const w of [360, 1280]) {
  await test(`공동 예약 캘린더 디자인 ${w}px: 머리(왼쪽 월·안내 / 오른쪽 회색 이동 버튼), 같은 칸·원 가운데, 선택·공동 예약·새 요청·불가·오늘 구분, 작은 범례(날짜 요약 없음) · 카드의 신청 가능한 시각은 접수 마감 위 정보 행`, async (page) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: w, height: 900 });
    await start(page, { path: '/providers/p1', patch: (db) => { const g = db.groups.find((x) => x.id === 'g1'); g.date = '2026-10-13'; g.closeAt = '2026-10-13T23:00:00+09:00'; } /* 오늘(10-13)이 신청 가능한 경우도 확인 */ });
    await page.locator('.jcal').waitFor();
    const h = await page.evaluate(() => {
      const cal = document.querySelector('.jcal'); const cr = cal.getBoundingClientRect();
      const title = cal.querySelector('.jcal__title').getBoundingClientRect(); const hint = cal.querySelector('.jcal__hint');
      const nav = [...cal.querySelectorAll('.jcal__navbtn')].map((b) => ({ r: b.getBoundingClientRect(), bg: getComputedStyle(b).backgroundColor, radius: parseFloat(getComputedStyle(b).borderTopLeftRadius) }));
      const card = [...document.querySelectorAll('section .card')][0]?.getBoundingClientRect();
      const tds = [...cal.querySelectorAll('tbody tr:first-child td')].map((td) => Math.round(td.getBoundingClientRect().width));
      const days = [...cal.querySelectorAll('.jcal__day')].map((b) => { const r = b.getBoundingClientRect(); const n = b.querySelector('.jcal__num').getBoundingClientRect(); return { w: r.width, h: r.height, center: Math.abs((n.left + n.width / 2) - (r.left + r.width / 2)) }; });
      const st = (d) => { const b = cal.querySelector(`button[data-day="${d}"]`); const n = b.querySelector('.jcal__num'); const c = getComputedStyle(n); return { bg: c.backgroundColor, color: getComputedStyle(b).color, ring: c.boxShadow, mark: b.querySelector('.jcal__mark').textContent }; };
      return {
        titleText: cal.querySelector('.jcal__title').textContent, hintText: hint.textContent, hintBelow: hint.getBoundingClientRect().top >= title.bottom - 1,
        titleLeft: title.left - cr.left < 24, navRight: cr.right - nav[1].r.right < 24 && nav[0].r.left > title.right && Math.abs(nav[0].r.top - nav[1].r.top) < 1 && nav[0].r.left < nav[1].r.left,
        navBg: nav.map((n) => n.bg), navRadius: nav[0].radius,
        legend: cal.querySelectorAll('.jcal__legend').length, summary: /선택한 날짜/.test(cal.textContent), hr: cal.querySelectorAll('hr').length,
        sameCols: new Set(tds).size === 1, minHit: Math.min(...days.map((d) => Math.min(d.w, d.h))), sameH: new Set(days.map((d) => Math.round(d.h))).size === 1, centered: days.every((d) => d.center < 1),
        open: st('2026-10-21'), fresh: st('2026-10-20'), closed: st('2026-10-18'), today: st('2026-10-13'),
        inView: cr.left >= 0 && cr.right <= innerWidth, overflow: document.documentElement.scrollWidth > innerWidth,
      };
    });
    eq(h.titleText, '2026년 10월', '월 제목'); eq(h.hintText, '공동 예약에 참여하거나 새 날짜로 요청할 수 있어요.', '안내');
    truthy(h.hintBelow && h.titleLeft && h.navRight && h.navBg.every((b) => b === 'rgb(238, 240, 243)') && h.navRadius >= 8, `머리 배치 ${JSON.stringify(h)}`);
    truthy(h.legend === 1 && !h.summary && h.hr === 0, '범례 하나, 날짜 요약·구분선 없음');
    truthy(h.sameCols && h.minHit >= 44 && h.sameH && h.centered && h.inView && !h.overflow, `칸·누르는 영역·가운데 ${JSON.stringify(h)}`);
    truthy(h.open.bg === 'rgb(237, 243, 252)' && h.open.color === 'rgb(49, 93, 168)', `가능: 연한 블루 원·블루 숫자 ${JSON.stringify(h.open)}`);
    truthy(h.fresh.bg === 'rgb(238, 240, 243)' && h.fresh.color === 'rgb(32, 36, 44)', `새 요청: 연한 회색 원·진한 숫자 ${JSON.stringify(h.fresh)}`);
    truthy(h.closed.bg === 'rgba(0, 0, 0, 0)' && h.closed.color === 'rgb(201, 206, 214)', `불가: 옅은 회색 숫자 ${JSON.stringify(h.closed)}`);
    truthy(h.today.mark === '오늘' && h.today.ring !== 'none' && h.today.bg === 'rgb(237, 243, 252)', `오늘(신청 가능): 연한 블루 원 + 바깥 테두리 + 오늘 ${JSON.stringify(h.today)}`);
    // 선택: 블루 원·흰 숫자, 오늘이 선택돼도 테두리(오늘)와 채움(선택)이 함께
    await dayBtn(page, '10-13').click();
    await page.locator('.joint-card').first().waitFor();
    const sel = await dayBtn(page, '10-13').evaluate((b) => { const n = getComputedStyle(b.querySelector('.jcal__num')); return { bg: n.backgroundColor, color: n.color, ring: n.boxShadow, pressed: b.getAttribute('aria-pressed') }; });
    truthy(sel.bg === 'rgb(49, 93, 168)' && sel.color === 'rgb(255, 255, 255)' && sel.ring.includes('rgb(49, 93, 168)') && sel.pressed === 'true', `선택(오늘) ${JSON.stringify(sel)}`);
    // 카드: 신청 가능한 시각 = 접수 마감 바로 위 정보 행(같은 크기·굵기 600, 오른쪽 정렬), 상단 중복 제목 없음, 라디오 이름에 날짜·참여 조건
    const card = await page.evaluate(() => {
      const c = document.querySelector('.joint-card'); const rows = [...c.querySelectorAll('.kv__row')].map((r) => r.querySelector('.kv__k').textContent);
      const tv = c.querySelector('.kv__times').closest('.kv__v'); const dv = [...c.querySelectorAll('.kv__row')][1].querySelector('.kv__v');
      const k = c.querySelector('.kv__k'); const r = c.querySelector('.kv__row').getBoundingClientRect(); const vr = tv.getBoundingClientRect();
      return { rows: rows.slice(0, 2), timeText: tv.textContent, fs: [getComputedStyle(tv).fontSize, getComputedStyle(dv).fontSize], fw: getComputedStyle(tv).fontWeight, align: getComputedStyle(tv).textAlign,
        kColor: getComputedStyle(k).color, rightEdge: Math.abs(vr.right - r.right) < 1, topTitle: c.querySelectorAll('.radio-card .strong').length === 0 || ![...c.querySelectorAll('.radio-card .strong')].some((e) => e.textContent.includes('신청 가능')),
        chips: c.querySelectorAll('.kv__times button, .kv__times input, .kv__times .svc-chip').length, radio: c.querySelectorAll('input[type=radio]').length, details: c.querySelectorAll('details').length, badge: c.querySelector('.badge').textContent, badgeBg: getComputedStyle(c.querySelector('.badge')).backgroundColor,
        overflow: [...c.querySelectorAll('*')].some((e) => e.getBoundingClientRect().right > c.getBoundingClientRect().right + 0.5) };
    });
    eq(card.rows.join('/'), '신청 가능한 시각/접수 마감', '접수 마감 바로 위');
    eq(card.timeText, '09:00 · 10:00 · 11:00 · 13:00 · 14:00 · 15:00', '그룹 실제 시각');
    truthy(card.fs[0] === card.fs[1] && card.fw === '600' && card.align === 'right' && card.rightEdge && card.kColor === 'rgb(96, 103, 115)', `정보 행 표현 ${JSON.stringify(card)}`);
    truthy(card.topTitle && card.chips === 0 && !card.overflow, `상단 중복 제목·칩·넘침 없음 ${JSON.stringify(card)}`);
    truthy(card.radio === 0 && card.details === 0 && card.badge === '공동 예약' && card.badgeBg === 'rgb(237, 243, 252)', `라디오·계산 상세 없음, 연한 블루 ‘공동 예약’ 라벨 ${JSON.stringify(card)}`);
    truthy(await reqBtn(page).isEnabled(), '날짜 선택만으로 그룹 자동 선택 → 요청 버튼 활성');
    await page.locator('.jcal').screenshot({ path: join(ROOT, `e2e/screens/${w}_joint_calendar.png`) });
    await page.locator('.joint-card').first().screenshot({ path: join(ROOT, `e2e/screens/${w}_joint_card.png`) });
  }, { width: w });
}
// ───────── 요청서 뒤로가기(업체 상세 ↔ 요청서 루프·복귀) ─────────
const histIdx = (page) => page.evaluate(() => history.state?.idx);
const pathQ = (page) => { const u = new URL(page.url()); return u.pathname + u.search; };
const headerBack = (page) => page.locator('.app-header').getByRole('button', { name: '뒤로 가기' }).or(page.locator('.app-header').getByRole('link', { name: '뒤로 가기' })).first();
/** 업체 목록 → 업체 상세(앱 안 이동) */
async function openDetailFromList(page) {
  await start(page, { path: '/providers?category=c2' });
  await page.locator('ul[aria-label="업체 목록"] a').first().click();
  await page.locator('.jcal').waitFor();
}

await test('요청서 뒤로가기: 공동 일정 → 요청서 → 상단 뒤로는 업체 상세로 한 번만(선택 유지), 업체 상세 뒤로는 목록, 3회 반복해도 기록이 늘지 않음', async (page) => {
  await openDetailFromList(page);
  const detailIdx = await histIdx(page);
  const len0 = await page.evaluate(() => history.length);
  const req0 = (await db(page)).requests.length;
  for (let i = 0; i < 3; i++) {
    if (await reqBtn(page).isDisabled()) {
      await dayBtn(page, '10-21').click(); // g1b(데모: 21일) — 날짜를 고르면 자동 선택
      await page.locator('.joint-card').first().waitFor();
    }
    await reqBtn(page).click();
    await page.waitForURL((u) => u.pathname === '/providers/p1/request');
    eq(new URL(page.url()).searchParams.get('group'), 'g1b', '선택한 그룹으로 요청서');
    await waitText(page, '수리 요청서');
    await headerBack(page).click();
    await page.waitForURL((u) => u.pathname === '/providers/p1');
    eq(await histIdx(page), detailIdx, `#${i + 1} 같은 기록 항목으로 복귀(새 기록 아님)`);
    await page.locator('.joint-card').first().waitFor();
    eq(await page.locator('.jcal button[aria-pressed="true"]').getAttribute('data-day'), '2026-10-21', '선택 날짜 유지');
    eq(await page.locator('.joint-card').count(), 1, '선택 그룹 카드 유지');
    truthy(await reqBtn(page).isEnabled(), '다시 요청 가능');
    await page.waitForTimeout(500);
    eq(new URL(page.url()).pathname, '/providers/p1', '자동으로 요청서로 이동하지 않음');
  }
  eq(await page.evaluate(() => history.length), len0 + 1, '기록은 요청서 1칸만(앞으로 가기용)');
  eq((await db(page)).requests.length, req0, '뒤로가기만으로 요청 생성 없음');
  await headerBack(page).click();
  await page.waitForURL((u) => u.pathname === '/providers');
  eq(pathQ(page), '/providers?category=c2', '업체 상세 뒤로는 목록(요청서로 가지 않음)');
});

await test('요청서 뒤로가기: 새 요청 날짜 → 요청서 → 상단 뒤로 → 업체 상세(날짜 유지) → 다시 요청 흐름 정상', async (page) => {
  await openDetailFromList(page);
  const detailIdx = await histIdx(page);
  await dayBtn(page, '10-22').click();
  await reqBtn(page).click();
  await page.waitForURL((u) => u.pathname === '/providers/p1/request' && u.searchParams.get('new') === '1' && u.searchParams.get('date') === '2026-10-22');
  await waitText(page, '수리 요청서');
  await headerBack(page).click();
  await page.waitForURL((u) => u.pathname === '/providers/p1');
  eq(await histIdx(page), detailIdx, '같은 기록 항목');
  eq(await page.locator('input[name="joint-group"]:checked').count(), 0, '공동 그룹 선택 없음');
  eq(await page.locator('.jcal button[aria-pressed="true"]').getAttribute('data-day'), '2026-10-22', '새 요청 날짜 유지');
  await reqBtn(page).click();
  await waitText(page, '수리 요청서');
});

await test('요청서 뒤로가기: 브라우저 뒤로·앞으로 — 선택 유지, 자동 이동 없음, 요청 생성 없음', async (page) => {
  await openDetailFromList(page);
  const req0 = (await db(page)).requests.length;
  await dayBtn(page, '10-19').click();
  await page.locator('.joint-card').first().waitFor(); // 날짜당 그룹 하나 → 자동 선택
  await reqBtn(page).click();
  await page.waitForURL((u) => u.pathname === '/providers/p1/request');
  for (let i = 0; i < 3; i++) {
    await page.goBack();
    await page.waitForURL((u) => u.pathname === '/providers/p1');
    await page.locator('.joint-card').first().waitFor();
    truthy(await reqBtn(page).isEnabled() && await page.locator('.joint-card').count() === 1, `#${i + 1} 브라우저 뒤로 후 선택 유지`);
    await page.waitForTimeout(400);
    eq(new URL(page.url()).pathname, '/providers/p1', '자동 이동 없음');
    await page.goForward();
    await page.waitForURL((u) => u.pathname === '/providers/p1/request');
    await waitText(page, '수리 요청서');
  }
  await page.goBack(); await page.waitForURL((u) => u.pathname === '/providers/p1');
  await page.goBack(); await page.waitForURL((u) => u.pathname === '/providers');
  eq((await db(page)).requests.length, req0, '요청 생성 없음');
});

await test('요청서 뒤로가기: 요청서 직접 진입·새로고침 → 상단 뒤로는 업체 상세로 교체, 그다음 뒤로는 업체 찾기', async (page) => {
  await start(page, { path: '/providers/p1/request?group=g1' });
  await waitText(page, '수리 요청서');
  await page.reload();
  await waitText(page, '수리 요청서');
  const len = await page.evaluate(() => history.length);
  await headerBack(page).click();
  await page.waitForURL((u) => u.pathname === '/providers/p1');
  eq(await page.evaluate(() => history.length), len, '기록을 쌓지 않고 교체');
  await page.locator('.jcal').waitFor();
  await headerBack(page).click();
  await page.waitForURL((u) => u.pathname === '/');
  // 업체 상세 직접 진입·새로고침
  await page.goto(`${BASE}/providers/p1`); await page.reload();
  await page.locator('.jcal').waitFor();
});

await test('요청서 뒤로가기: 잘못된 업체 → 안내·업체 찾기, 잘못된 그룹 → 안내 후 업체 상세로, 외부 복귀 경로 무시', async (page) => {
  await start(page, { path: '/providers/nope/request?group=g1' });
  await waitText(page, '업체 정보를 찾을 수 없어요');
  truthy(await page.getByRole('link', { name: '업체 찾기로 가기' }).isVisible(), '업체 찾기 링크');
  await headerBack(page).click();
  await page.waitForURL((u) => u.pathname === '/');
  await page.goto(`${BASE}/providers/p1/request?group=nope`);
  await waitText(page, '수리 요청서');
  truthy(await page.getByRole('button', { name: '요청 보내기' }).isDisabled(), '없는 그룹으로는 제출 불가');
  await headerBack(page).click();
  await page.waitForURL((u) => u.pathname === '/providers/p1');
  // 기록 state에 외부 경로를 넣어도 앱 밖으로 나가지 않는다
  await page.evaluate(() => { history.pushState({ usr: { returnTo: '//evil.example/x' }, key: 'x1', idx: 5 }, '', '/providers/p1/request?new=1&date=2026-10-21'); dispatchEvent(new PopStateEvent('popstate', { state: history.state })); });
  await waitText(page, '수리 요청서');
  await headerBack(page).click();
  await page.waitForURL((u) => u.pathname === '/providers/p1');
  eq(new URL(page.url()).origin, BASE, '앱 안에 머무름');
});

await test('요청서 뒤로가기: 요청서에 있는 동안 그룹이 마감되면 돌아왔을 때 선택 해제·사유 안내', async (page) => {
  await openDetailFromList(page);
  await dayBtn(page, '10-21').click();
  await page.locator('.joint-card').first().waitFor(); // g1b(데모: 21일) 자동 선택
  await reqBtn(page).click();
  await waitText(page, '수리 요청서');
  await dev(page, 'closeGroup', 'g1b');
  await headerBack(page).click();
  await page.waitForURL((u) => u.pathname === '/providers/p1');
  await waitText(page, '선택한 일정을 신청할 수 없게 됐어요');
  eq(await page.locator('input[name="joint-group"]:checked').count(), 0, '선택 해제');
  truthy(await reqBtn(page).isDisabled(), '요청 버튼 비활성');
});


// ───────── 공동 예약 데모 일정: 업체별 3개 날짜(10/19~25)·저장 상태 이전 ─────────
const enabledDays = (page) => page.locator('.jcal button.jcal__day--open:not([disabled])').evaluateAll((bs) => bs.map((b) => b.dataset.day));
const PROVIDER_DATES = { p1: ['19', '21', '23'], p2: ['20', '22', '24'], p3: ['19', '22', '25'], p4: ['21', '22', '24'], p5: ['19', '20', '23'], p6: ['20', '23', '24'], p7: ['20', '23', '25'], p8: ['21', '24', '25'] };

await test('공동 예약 데모 일정: 모든 업체 캘린더에 10/19~25 중 서로 다른 날짜 3개·날짜당 그룹 하나, 새로고침해도 같은 날짜, 요청서와 날짜 일치', async (page) => {
  await start(page, { path: '/providers/p1' });
  for (const [pid, days] of Object.entries(PROVIDER_DATES)) {
    await page.goto(`${BASE}/providers/${pid}`);
    await page.locator('.jcal').waitFor();
    const want = days.map((d) => `2026-10-${d}`);
    eq(JSON.stringify(await enabledDays(page)), JSON.stringify(want), `${pid} 신청 가능 날짜`);
    for (const d of days) {
      await dayBtn(page, `10-${d}`).click();
      await page.locator('.joint-card').first().waitFor();
      eq(await page.locator('.joint-card').count(), 1, `${pid} 10/${d} 그룹 하나`);
    }
    // 마지막 날짜 그룹 → 요청서 날짜·마감 일치
    const last = days.at(-1);
    const cardText = await page.locator('.joint-card').first().innerText();
    await page.locator('.joint-card').first().waitFor(); // 날짜당 그룹 하나 → 자동 선택
    await reqBtn(page).click();
    await page.waitForURL((u) => u.pathname === `/providers/${pid}/request` && !!u.searchParams.get('group'));
    await waitText(page, '수리 요청서');
    const kv = await page.locator('form .card').first().innerText();
    const dayText = `10월 ${Number(last)}일 (${"일월화수목금토"[new Date(Date.UTC(2026, 9, Number(last))).getUTCDay()]})`;
    truthy(kv.includes(dayText), `${pid} 요청서 방문 날짜 ${dayText}: ${kv}`);
    const close = cardText.match(/\d+월 \d+일 \([^)]+\) \d{2}:\d{2}/)?.[0];
    truthy(close && kv.includes(close), `${pid} 접수 마감 일치 ${close}`);
  }
  // 새로고침해도 같은 날짜(고정 데이터)
  await page.goto(`${BASE}/providers/p6`);
  await page.locator('.jcal').waitFor();
  const before = await enabledDays(page);
  await page.reload(); await page.locator('.jcal').waitFor();
  eq(JSON.stringify(await enabledDays(page)), JSON.stringify(before), '새로고침 후 같은 날짜');
});

await test('공동 예약 데모 일정: 예전 일정으로 저장된 탭 → 예전 일정 복원·병합 없이 새 일정, 다른 저장 데이터(주소·내 정보·기록) 유지', async (page) => {
  await start(page, { path: '/' });
  const prev = await page.evaluate((k) => {
    const db = JSON.parse(sessionStorage.getItem(k));
    delete db.scheduleVersion; // 예전 버전 저장 상태
    const set = (id, date, closeAt) => { const g = db.groups.find((x) => x.id === id); g.date = date; g.closeAt = closeAt; };
    set('g1', '2026-10-16', '2026-10-15T18:00:00+09:00'); set('g1b', '2026-10-16', '2026-10-15T12:00:00+09:00'); set('g1n', '2026-11-03', '2026-11-02T18:00:00+09:00');
    db.groups = db.groups.filter((g) => !['g2a', 'g2b', 'g3a', 'g3b'].includes(g.id));
    const base = db.groups.find((x) => x.id === 'g1');
    db.groups.push({ ...base, id: 'g3', date: '2026-10-17', closeAt: '2026-10-16T18:00:00+09:00' });
    db.customer.name = '이전상태 고객';
    sessionStorage.setItem(k, JSON.stringify(db));
    return { requests: JSON.stringify(db.requests), bookings: JSON.stringify(db.bookings) };
  }, DB_KEY);
  const app0 = await page.evaluate((k) => sessionStorage.getItem(k), APP_KEY);
  await page.goto(`${BASE}/providers/p1`);
  await page.locator('.jcal').waitFor();
  eq(JSON.stringify(await enabledDays(page)), JSON.stringify(['2026-10-19', '2026-10-21', '2026-10-23']), '예전 일정(10/16·10/17·11/03) 복원 없음');
  if (await page.getByRole('button', { name: '다음 달' }).isEnabled()) {
    await page.getByRole('button', { name: '다음 달' }).click();
    eq((await enabledDays(page)).length, 0, '다음 달(11/03 예전 일정) 없음');
    await page.getByRole('button', { name: '이전 달' }).click();
  }
  const d = await db(page);
  eq(d.scheduleVersion, 2, '일정 버전 갱신');
  eq(d.groups.filter((g) => g.id === 'g1').length, 1, '같은 그룹 중복 없음');
  truthy(!d.groups.some((g) => g.id === 'g3'), '참조 없는 예전 일정 제거');
  eq(d.customer.name, '이전상태 고객', '내 정보 유지');
  eq(JSON.stringify(d.requests), prev.requests, '요청 기록 그대로');
  eq(JSON.stringify(d.bookings), prev.bookings, '예약 기록 그대로');
  eq(await page.evaluate((k) => sessionStorage.getItem(k), APP_KEY), app0, '탐색 주소 등 앱 상태 유지');
  await page.reload(); await page.locator('.jcal').waitFor();
  eq(JSON.stringify(await enabledDays(page)), JSON.stringify(['2026-10-19', '2026-10-21', '2026-10-23']), '새로고침 후에도 새 일정');
});

await test('공동 예약 데모 일정: 저장해 둔 선택 날짜가 더 이상 신청 가능하지 않으면 정리(유효한 달로)·안내, 다시 고르면 정상', async (page) => {
  await openDetailFromList(page);
  await dayBtn(page, '10-21').click();
  await page.locator('.joint-card').first().waitFor(); // 날짜당 그룹 하나 → 자동 선택
  await reqBtn(page).click();
  await waitText(page, '수리 요청서');
  // 요청서에 있는 동안 데모 일정이 바뀜(g1b 10/21 → 11/05)
  await page.evaluate(() => { const g = window.__sagoDev.db.groups.find((x) => x.id === 'g1b'); g.date = '2026-11-05'; g.closeAt = '2026-11-04T18:00:00+09:00'; window.__sagoDev.setSettings({}); });
  await headerBack(page).click();
  await page.waitForURL((u) => u.pathname === '/providers/p1');
  await waitText(page, '선택한 일정을 신청할 수 없게 됐어요');
  eq(await page.locator('.jcal button[aria-pressed="true"]').count(), 0, '예전 선택 날짜 정리');
  eq(await page.locator('.jcal__title').innerText(), '2026년 10월', '유효한 신청 가능 날짜가 있는 달');
  truthy(await reqBtn(page).isDisabled(), '요청 버튼 비활성');
  await dayBtn(page, '10-19').click();
  await page.locator('.joint-card').first().waitFor(); // 날짜당 그룹 하나 → 자동 선택
  truthy(await reqBtn(page).isEnabled(), '다시 고르면 정상');
});
await test('배포 라우팅: Vercel식 정적 서버에서 규칙 없으면 깊은 경로 404(원인 재현), vercel.json 규칙 적용 시 새로고침·뒤로가기 정상·정적 파일 보존', async (page) => {
  const run = async (rewrite, port) => {
    const sp = spawn(process.execPath, [join(ROOT, 'e2e/vercel-static.mjs')], { cwd: ROOT, stdio: 'ignore', env: { ...process.env, PORT: String(port), ...(rewrite ? { REWRITE: '1' } : {}) } });
    try {
      const B = `http://localhost:${port}`;
      for (let i = 0; i < 50; i++) { try { if ((await fetch(B)).ok) break; } catch { /* 대기 */ } await new Promise((r) => setTimeout(r, 100)); }
      const code = async (p) => (await fetch(B + p)).status;
      const out = { deep: await code('/providers/p1/request?group=g1'), missingAsset: await code('/assets/missing.js'), favicon: await code('/favicon.svg') };
      if (rewrite) {
        await page.goto(`${B}/`);
        await page.evaluate((k) => sessionStorage.setItem(k, JSON.stringify({ addressId: 'ad-apt' })), APP_KEY);
        await page.goto(`${B}/providers/p1`); await page.locator('.jcal').waitFor();
        await page.reload(); await page.locator('.jcal').waitFor();
        await page.goto(`${B}/`); await page.goBack(); await page.locator('.jcal').waitFor(); // 문서 경계를 넘어 깊은 경로를 서버에서 다시 받음
        out.app = true;
      }
      return out;
    } finally { sp.kill(); }
  };
  const before = await run(false, 4181);
  eq(before.deep, 404, '규칙 없으면 깊은 경로 404(Vercel 404와 같은 원인)');
  const after = await run(true, 4182);
  eq(JSON.stringify(after), JSON.stringify({ deep: 200, missingAsset: 404, favicon: 200, app: true }), '규칙 적용 후');
});

// ───────── 비교 요청: 업체별 응답 요약 카드·상태 필터 ─────────
/** b-sink에 검토 중·추가 정보 필요·거절 요청을 더해 5곳으로 만든다(시드는 바꾸지 않음) */
const fiveSink = (d) => {
  const base = d.requests.find((r) => r.id === 'rq-3');
  const add = (id, providerId, status, extra = {}) => d.requests.push({ ...structuredClone(base), id, providerId, status, groupId: null, bookingId: undefined, ...extra });
  add('rq-s3', 'p3', 'reviewing');
  add('rq-s4', 'p4', 'needs_info', { infoRequest: { message: '세면대 아래 배관이 보이는 사진을 한 장 더 올려 주세요.', requestedAt: '2026-10-13T16:00:00+09:00' } });
  add('rq-s5', 'p5', 'rejected', { rejectionReason: '해당 날짜에는 일정이 꽉 차서 맡기 어려워요.' });
};
const respCards = (page) => page.locator('.resp-card');
const respCard = (page, name) => respCards(page).filter({ has: page.locator('.resp-card__name', { hasText: name }) });
const bundleTitle = (page) => page.locator('.section__head--filter h2');
async function pickBundleStatus(page, label) {
  await page.getByRole('button', { name: /^전체 상태 필터/ }).click();
  const dlg = page.getByRole('dialog', { name: '요청 상태' });
  await dlg.getByText(label, { exact: true }).click();
  await dlg.getByRole('button', { name: '적용' }).click();
  await dlg.waitFor({ state: 'detached' });
}

await testCompare('비교 요청: 업체별 응답 요약 카드 — 결제 대기는 방문·예상 총금액·결제 기한·상세 조건 보기만, 상태별 행동 연결', async (page) => {
  await start(page, { path: '/requests/bundle/b-sink', patch: fiveSink });
  await respCards(page).first().waitFor();
  eq(await bundleTitle(page).innerText(), '업체별 응답 · 5곳', '전체 업체 수');
  eq(await respCards(page).count(), 5, '카드 5개');
  const hb = await respCard(page, '한빛설비').innerText();
  truthy(hb.includes('예약금 결제') && hb.includes('방문 예정') && hb.includes('10월 19일 (월)') && hb.includes('10:00') && hb.includes('약 112,500원') && hb.includes('결제 기한') && hb.includes('남음'), `결제 대기 카드: ${hb}`);
  truthy(!/그룹 총 출장비|예약금|부품·자재|업체 견적/.test(hb.replace(/예약금 결제 (대기|기한)/g, '')), `요약 카드에 상세 금액이 펼쳐짐: ${hb}`);
  eq(await respCard(page, '한빛설비').getByRole('link').count(), 1, '카드마다 버튼 하나');
  eq(await respCard(page, '한빛설비').getByRole('link', { name: '상세 조건 보기' }).getAttribute('href'), '/requests/rq-3/approval', '상세 이동');
  const sb = await respCard(page, '새봄수리').innerText();
  truthy(sb.includes('약 115,000원') && sb.includes('업체 할인 조건은 상세에서 확인해요'), `할인 조건 업체: ${sb}`);
  const rv = respCard(page, '밝은전기');
  truthy((await rv.innerText()).includes('업체가 작업과 일정을 확인하고 있어요.'), '검토 중 안내');
  eq(await rv.getByRole('link', { name: '요청 상세 보기' }).getAttribute('href'), '/requests/rq-s3', '검토 중 → 요청 상세');
  const ni = page.locator('.resp-card').filter({ hasText: '추가 정보 필요' });
  truthy((await ni.innerText()).includes('배관이 보이는 사진'), '보완 요청 요약');
  eq(await ni.getByRole('link', { name: '요청 보완하기' }).getAttribute('href'), '/requests/rq-s4/supplement', '보완 이동');
  const ej = page.locator('.resp-card--ended');
  truthy((await ej.innerText()).includes('업체 거절') && (await ej.innerText()).includes('일정이 꽉 차서'), '종료: 실제 상태·사유');
  eq(await ej.getByRole('link', { name: '상세 조건 보기' }).count(), 0, '종료 카드에 결제 행동 없음');
  eq(await ej.getByRole('link', { name: '요청 상세 보기' }).count(), 1, '종료 → 요청 상세');
  await waitText(page, '하나를 예약하면 나머지 요청은 종료돼요');
  await waitText(page, '요청한 작업');
  truthy(await page.getByRole('button', { name: '같은 작업을 다른 업체에도 요청하기' }).isVisible(), '다른 업체 추가 요청');
});

await testCompare('비교 요청: 상태 필터(결제 대기·추가 정보 필요·업체 검토 중·종료) 건수·빈 결과·전체로 해제, 다른 묶음에는 적용 안 됨', async (page) => {
  await start(page, { path: '/requests/bundle/b-sink', patch: [fiveSink, (d) => { d.requests.find((r) => r.id === 'rq-s5').status = 'withdrawn'; }] });
  await respCards(page).first().waitFor();
  for (const [label, n, q] of [['예약금 결제', 2, 'payment_pending'], ['추가 정보 필요', 1, 'needs_info'], ['업체 검토 중', 1, 'reviewing'], ['종료', 1, 'ended']]) {
    await pickBundleStatus(page, label);
    await page.waitForURL((u) => u.searchParams.get('status') === q);
    // 주소가 바뀐 직후 목록이 다시 그려지기 전 값을 읽지 않도록 제목이 갱신될 때까지 기다린다
    await page.getByRole('button', { name: /^전체 상태 필터/ }).filter({ hasText: label }).waitFor({ timeout: 3000 }).catch(() => {});
    await bundleTitle(page).filter({ hasText: `전체 5곳 중 ${n}곳` }).waitFor({ timeout: 3000 }).catch(() => {});
    eq(await bundleTitle(page).innerText(), `업체별 응답 · 전체 5곳 중 ${n}곳`, `${label} 건수`);
    eq(await respCards(page).count(), n, `${label} 카드 수`);
    eq(await page.getByRole('button', { name: /^전체 상태 필터/ }).innerText(), label, '캡슐에 선택값');
  }
  truthy((await respCards(page).first().innerText()).includes('철회'), '종료 그룹 안의 실제 상태(철회)');
  // 빈 결과: 검토 중을 없애고 다시 고른다 → 안내·필터 조작 가능
  await patchDb(page, (d) => { d.requests.find((r) => r.id === 'rq-s3').status = 'withdrawn'; }, null);
  await pickBundleStatus(page, '업체 검토 중');
  await waitText(page, '선택한 상태의 업체 응답이 없어요.');
  eq(await bundleTitle(page).innerText(), '업체별 응답 · 전체 5곳 중 0곳', '빈 결과 건수');
  await pickBundleStatus(page, '전체');
  await page.waitForURL((u) => !u.searchParams.has('status'));
  await page.waitForFunction(() => document.querySelectorAll('.resp-card').length === 5).catch(() => {});
  eq(await respCards(page).count(), 5, '전체로 해제');
  // 다른 비교 요청에는 이 필터가 적용되지 않는다
  await pickBundleStatus(page, '종료');
  await page.goto(`${BASE}/requests/bundle/b-lamp`);
  await respCards(page).first().waitFor();
  truthy((await bundleTitle(page).innerText()).startsWith('업체별 응답 · ') && !(await bundleTitle(page).innerText()).includes('중'), '다른 묶음은 전체');
  eq(new URL(page.url()).search, '', '다른 묶음 URL에 필터 없음');
  // 예약 완료 요청은 전체에서 보이고 종료로 분류되지 않는다
  const booked = page.locator('.resp-card').filter({ hasText: '예약 완료' });
  eq(await booked.getByRole('link', { name: '예약 보기' }).count(), 1, '예약 완료 → 예약 보기');
  eq(await booked.getByRole('link', { name: '상세 조건 보기' }).count(), 0, '예약 확정에 결제 버튼 없음');
  await pickBundleStatus(page, '종료');
  await page.waitForURL((u) => u.searchParams.get('status') === 'ended'); // 목록이 다시 그려진 뒤 확인
  await page.locator('.resp-card').filter({ hasText: '예약 완료' }).first().waitFor({ state: 'detached', timeout: 3000 }).catch(() => {});
  eq(await page.locator('.resp-card').filter({ hasText: '예약 완료' }).count(), 0, '예약 완료는 종료에 없음');
});

await testCompare('비교 요청: 예상 총금액 = 승인 조건 화면 예상 총액, 견적 누락 시 금액 확인 필요(0원 대체 없음)', async (page) => {
  await start(page, { path: '/requests/bundle/b-sink' });
  await respCard(page, '한빛설비').getByRole('link', { name: '상세 조건 보기' }).click();
  await page.waitForURL((u) => u.pathname === '/requests/rq-3/approval');
  await waitText(page, '예상 총액');
  const t = await page.locator('main').innerText();
  truthy(t.includes('약 112,500원') && t.includes('약 12,500원') && t.includes('80,000원') && t.includes('20,000원') && t.includes('본인 예약 확정 시 4세대 기준'), `승인 조건 화면 내역: ${t.slice(0, 400)}`);
  await page.goto(`${BASE}/requests/rq-4/approval`);
  await waitText(page, '약 115,000원');
  await waitText(page, '위 예상 총액에는 반영하지 않았어요');
  // 견적 누락
  await patchDb(page, (d) => { d.approvals.find((a) => a.requestId === 'rq-3').tasks[1].estimate = null; }, '/requests/bundle/b-sink');
  await respCards(page).first().waitFor();
  const hb = await respCard(page, '한빛설비').innerText();
  truthy(hb.includes('금액 확인 필요') && !hb.includes('112,500') && !hb.includes('82,500'), `누락 시 카드: ${hb}`);
  await page.goto(`${BASE}/requests/rq-3/approval`);
  await waitText(page, '견적 없음: 배수 트랩 교체');
  truthy(!(await page.locator('main').innerText()).includes('약 82,500원'), '승인 화면에도 임의 금액 없음');
});

await testCompare('비교 요청: 상세에서 돌아오면 필터·목록 위치 복원', async (page) => {
  await page.setViewportSize({ width: 390, height: 600 });
  await start(page, { path: '/requests/bundle/b-sink', patch: fiveSink });
  await respCards(page).first().waitFor();
  await pickBundleStatus(page, '예약금 결제');
  await page.waitForURL((u) => u.searchParams.get('status') === 'payment_pending');
  await respCard(page, '새봄수리').scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, 120));
  await page.waitForTimeout(250);
  const y = await page.evaluate(() => Math.round(scrollY));
  truthy(y > 100, `스크롤됨 ${y}`);
  await respCard(page, '새봄수리').getByRole('link', { name: '상세 조건 보기' }).click();
  await page.waitForURL((u) => u.pathname === '/requests/rq-4/approval');
  await page.goBack();
  await page.waitForURL((u) => u.pathname === '/requests/bundle/b-sink' && u.searchParams.get('status') === 'payment_pending');
  await respCards(page).first().waitFor();
  await page.waitForFunction((yy) => Math.abs(scrollY - yy) < 4, y);
  eq(await respCards(page).count(), 2, '필터 유지');
});

for (const w of [360, 1280]) {
  await testCompare(`비교 요청: ${w}px 1곳·2곳·여러 곳 배치(데스크톱 2열·모바일 1열), 긴 이름·배지 겹침 없음`, async (page) => {
    await page.setViewportSize({ width: w, height: 900 });
    for (const [label, patch, n] of [['1곳', (d) => { d.requests.find((r) => r.id === 'rq-4').bundleId = 'b-solo'; }, 1], ['2곳', null, 2], ['5곳', [fiveSink, (d) => { d.providers.find((p) => p.id === 'p1').name = '한빛설비 욕실·주방 생활배관 전문 협동조합'; }], 5]]) {
      await start(page, { path: '/requests/bundle/b-sink', patch: patch ?? undefined });
      await respCards(page).first().waitFor();
      eq(await respCards(page).count(), n, `${label} 카드 수`);
      const lay = await page.evaluate(() => {
        const cs = [...document.querySelectorAll('.resp-card')].map((e) => e.getBoundingClientRect());
        const overlap = [...document.querySelectorAll('.resp-card__head')].some((h) => { const [a, b] = h.children; const ra = a.getBoundingClientRect(); const rb = b.getBoundingClientRect(); return ra.right > rb.left + 0.5 && ra.bottom > rb.top + 0.5 && ra.top < rb.bottom - 0.5; });
        return { cols: new Set(cs.map((r) => Math.round(r.left))).size, overflow: document.documentElement.scrollWidth > innerWidth, overlap };
      });
      eq(lay.cols, w >= 768 && n > 1 ? 2 : 1, `${label} 열 수`);
      truthy(!lay.overflow && !lay.overlap, `${label} 넘침·겹침 ${JSON.stringify(lay)}`);
      if (n === 5) await page.screenshot({ path: join(ROOT, `e2e/screens/${w}_bundle_summary.png`), fullPage: true });
    }
  }, { width: w });
}

await testCompare('비교 요청: 한 업체 결제 → 같은 작업의 다른 업체 요청은 종료(기존 정책 유지), 카드에 실제 사유', async (page) => {
  await start(page, { path: '/requests/bundle/b-sink' });
  await respCard(page, '한빛설비').getByRole('link', { name: '상세 조건 보기' }).click();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: PAY_BTN }).click();
  await waitText(page, '예약이 확정됐어요');
  await page.goto(`${BASE}/requests/bundle/b-sink`);
  await respCards(page).first().waitFor();
  truthy((await respCard(page, '새봄수리').innerText()).includes('같은 작업을 다른 업체로 예약해 종료됐어요.'), '다른 업체 요청 종료');
  eq(await respCard(page, '한빛설비').getByRole('link', { name: '예약 보기' }).count(), 1, '예약 완료 카드');
});

// ───────── 진행 단계 표시(내 요청 3단계 · 내 예약 3단계) ─────────
/** 진행 표시 상태: 없으면 null. flow = request|booking, current = aria-current 단계 전체 라벨, done = 완료 단계, note = 보조 안내 */
const stepState = async (page) => {
  await page.waitForTimeout(80);
  return page.evaluate(() => {
    const navs = [...document.querySelectorAll('nav.steps')];
    if (!navs.length) return null;
    const nav = navs[0];
    const items = [...nav.querySelectorAll('li')];
    const label = (li) => li.querySelector('.steps__label--full').textContent;
    return {
      count: navs.length, flow: nav.dataset.flow, total: items.length,
      current: items.filter((li) => li.getAttribute('aria-current') === 'step').map(label).join(','),
      done: items.filter((li) => li.classList.contains('steps__item--done')).map(label),
      note: nav.querySelector('.steps__note')?.textContent ?? null,
    };
  });
};
const expectStep = async (page, flow, current, doneCount, noteIncludes, label) => {
  await page.locator(`nav.steps[data-flow="${flow}"]`).waitFor();
  const st = await stepState(page);
  eq(st.count, 1, `${label}: 진행 표시 하나`);
  eq(st.flow, flow, `${label}: 과정`);
  eq(st.total, 3, `${label}: 3단계`);
  eq(st.current, current, `${label}: 현재 단계`);
  eq(st.done.length, doneCount, `${label}: 완료 단계 수`);
  if (noteIncludes === null) eq(st.note, null, `${label}: 안내 없음`);
  else if (noteIncludes) truthy((st.note ?? '').includes(noteIncludes), `${label}: 안내 ${st.note}`);
};

await test('진행 과정: 요청서(1) → 검토(2) → 보완(2) → 승인·결제 대기(3) → 결제 성공 시 예약 상세(내 예약 1)로 이동', async (page) => {
  await start(page, { path: '/providers/p1' });
  await dayBtn(page, '10-19').click();
  await page.locator('.joint-card').first().waitFor(); // 날짜당 그룹 하나 → 자동 선택
  await reqBtn(page).click();
  await waitText(page, '수리 요청서');
  await expectStep(page, 'request', '수리 요청', 0, null, '요청서');
  await pickTask(page, '수전 교체', '주방 수전 교체');
  await page.getByLabel('상세 주소', { exact: true }).fill('301동 1204호');
  await timeChip(page, '09:00').check(); await timeChip(page, '10:00').check(); // 업체가 이 중 10:00을 제안
  await page.getByRole('button', { name: '요청 보내기' }).click();
  await openSentDetail(page);
  await expectStep(page, 'request', '업체 검토·견적', 1, '업체가 작업 가능 여부와 견적을 확인하고 있어요.', '검토 중');
  const id = new URL(page.url()).pathname.split('/').pop();
  await dev(page, 'requestInfo', id);
  await expectStep(page, 'request', '업체 검토·견적', 1, '추가 정보를 요청했어요', '추가 정보 필요');
  await page.getByRole('link', { name: '요청서 보완하기' }).click();
  await waitText(page, '보완 내용');
  await expectStep(page, 'request', '업체 검토·견적', 1, '추가 정보를 요청했어요', '보완 화면');
  await page.getByLabel('보완 내용').fill('수전 모델 사진을 다시 올렸어요.');
  await page.getByRole('button', { name: '보완 내용 보내기' }).click();
  await waitText(page, '보완한 내용을 보냈어요');
  await expectStep(page, 'request', '업체 검토·견적', 1, '견적을 확인하고 있어요', '보완 후 재검토');
  truthy((await dev(page, 'approveRequest', id, '10:00')).ok, '업체 승인');
  await expectStep(page, 'request', '예약금 결제', 2, null, '승인·결제 대기(요청 상세)');
  await page.goto(`${BASE}/requests/${id}/approval`); // 이전 승인 조건 주소 → 요청 상세 결제 영역
  await page.waitForURL((u) => u.pathname === `/requests/${id}` && u.hash === '#pay');
  await expectStep(page, 'request', '예약금 결제', 2, null, '요청 상세 결제 영역');
  const bk0 = (await db(page)).bookings.length;
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: PAY_BTN }).click();
  await page.waitForURL((u) => u.pathname.startsWith('/bookings/bk-'));
  const d = await db(page);
  const req = d.requests.find((r) => r.id === id);
  eq(new URL(page.url()).pathname, `/bookings/${req.bookingId}`, '그 예약 상세로 이동');
  await waitText(page, '예약이 확정됐어요');
  await expectStep(page, 'booking', '예약 확정', 0, null, '예약 상세(방문 예정)');
  eq(d.bookings.length, bk0 + 1, '예약 1건 생성');
  // 새로고침·뒤로가기로 중복 예약이 생기지 않는다(결제 화면 기록은 교체됨)
  await page.reload();
  await expectStep(page, 'booking', '예약 확정', 0, null, '새로고침');
  await page.goBack();
  await page.waitForTimeout(400);
  truthy(!new URL(page.url()).pathname.endsWith('/approval'), `뒤로가기로 결제 화면이 다시 열리지 않음: ${page.url()}`);
  eq((await db(page)).bookings.length, bk0 + 1, '중복 예약 없음');
  // 완료 요청: 진행 표시 대신 완료 요약 + 예약 보기, 재결제·보완·철회 없음
  await page.goto(`${BASE}/requests/${id}`);
  await waitText(page, '예약 완료 · 요청 과정이 끝났어요');
  eq(await stepState(page), null, '완료 요청에는 진행 표시 없음');
  for (const b of [PAY_BTN, '요청서 보완하기', '이 업체 요청 철회하기']) eq(await page.getByRole('button', { name: b }).or(page.getByRole('link', { name: b })).count(), 0, `${b} 없음`);
  await page.getByRole('link', { name: '예약 보기' }).click();
  await page.waitForURL((u) => u.pathname === `/bookings/${req.bookingId}`);
  // 이전 승인 화면 주소를 직접 열어도 다시 결제할 수 없다(요청 상세의 예약 완료 요약)
  await page.goto(`${BASE}/requests/${id}/approval`);
  await waitText(page, '예약 완료 · 요청 과정이 끝났어요');
  eq(await page.getByRole('button', { name: PAY_BTN }).count(), 0, '재결제 버튼 없음');
  eq(await stepState(page), null, '완료 요청에 진행 표시 없음');
});

await testCompare('진행 과정: 비교 요청은 합친 단계 없음, 예약한 업체는 예약 완료·예약 보기, 같은 묶음 다른 업체는 다른 업체 예약으로 종료', async (page) => {
  await start(page, { path: '/requests/rq-3/approval' });
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: PAY_BTN }).click();
  await page.waitForURL((u) => u.pathname.startsWith('/bookings/'));
  await page.goto(`${BASE}/requests/bundle/b-sink`);
  await page.locator('.resp-card').first().waitFor();
  eq(await page.locator('nav.steps').count(), 0, '비교 요청 화면에는 진행 표시 없음');
  const hb = page.locator('.resp-card').filter({ hasText: '한빛설비' });
  truthy((await hb.innerText()).includes('예약 완료'), '예약한 업체: 예약 완료');
  eq(await hb.getByRole('link', { name: '예약 보기' }).count(), 1, '예약 보기 연결');
  truthy((await page.locator('.resp-card').filter({ hasText: '새봄수리' }).innerText()).includes('다른 업체 예약으로 종료'), '다른 업체 종료');
  await page.goto(`${BASE}/requests/rq-4`);
  await waitText(page, '다른 업체 예약이 확정됐어요');
  eq(await stepState(page), null, '종료 요청에는 진행 표시 없음');
  // 보낸 요청 목록: 예약이 확정된 묶음은 없고, 필터에도 예약 완료·예약 확정 선택지가 없다
  await page.goto(`${BASE}/bookings?tab=requests`);
  await page.getByRole('button', { name: /^요청 상태 필터/ }).click();
  await page.getByRole('dialog').getByText('업체 검토 중', { exact: true }).waitFor();
  eq(await page.getByRole('dialog').getByText('예약 완료', { exact: true }).count(), 0, '보낸 요청 필터에 ‘예약 완료’ 없음');
  eq(await page.getByRole('dialog').getByText('예약 확정', { exact: true }).count(), 0, '요청 필터에 ‘예약 확정’ 문구 없음');
});

await test('진행 과정: 결제 실패·결과 확인 중은 내 요청 3단계(예약 확정 표시 없음), 확인 성공 시 예약 상세로', async (page) => {
  await start(page, { path: '/requests/rq-3/approval', patch: (d) => { d.settings.payOutcome = 'fail'; } });
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: PAY_BTN }).click();
  await waitText(page, '결제가 완료되지 않았어요');
  await expectStep(page, 'request', '예약금 결제', 2, '결제가 완료되지 않았어요', '결제 실패');
  eq(await page.locator('nav.steps[data-flow="booking"]').count(), 0, '실패 시 예약 과정 없음');
  await patchDb(page, (d) => { d.settings.payOutcome = 'unknown'; d.settings.resolveOutcome = 'unknown'; }, '/requests/rq-3/approval');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: PAY_BTN }).click();
  await waitText(page, '결제 결과를 확인하고 있어요');
  await expectStep(page, 'request', '예약금 결제', 2, '결과를 확인하고 있어요', '결과 확인 중');
  const payUrl = page.url();
  await page.goto(`${BASE}/requests/rq-3/approval`);
  await expectStep(page, 'request', '예약금 결제', 2, '결과를 확인하고 있어요', '결과 확인 중(승인 화면)');
  await page.goto(payUrl);
  await page.getByRole('button', { name: '결제 결과 확인하기' }).click();
  await waitText(page, '결제 결과를 확인하고 있어요');
  await expectStep(page, 'request', '예약금 결제', 2, '결과를 확인하고 있어요', '여전히 확인 중');
  await patchDb(page, (d) => { d.settings.resolveOutcome = 'success'; }, null);
  await page.getByRole('button', { name: '결제 결과 확인하기' }).click();
  await page.waitForURL((u) => u.pathname.startsWith('/bookings/bk-'));
  await waitText(page, '예약이 확정됐어요');
  await expectStep(page, 'booking', '예약 확정', 0, null, '확인 성공 후 예약 상세');
  eq((await db(page)).transactions.filter((t) => t.requestId === 'rq-3' && t.kind === 'deposit' && t.status === 'success').length, 1, '성공 거래 1건');
  // 기존 결제 결과 화면도 내 예약 과정과 ‘예약 확인하기’(생성된 예약 상세) · ‘확정된 예약 목록’
  await page.goto(payUrl);
  await expectStep(page, 'booking', '예약 확정', 0, null, '결제 결과(성공)');
  const bkHref = await page.getByRole('link', { name: '예약 확인하기' }).getAttribute('href');
  truthy(/^\/bookings\/bk-/.test(bkHref), `예약 확인하기 → 생성된 예약 상세(${bkHref})`);
  eq(await page.getByRole('link', { name: '확정된 예약 목록' }).getAttribute('href'), '/bookings?tab=active', '확정된 예약 탭으로');
  // 성공했지만 예약을 확인하지 못한 경우: 결과 확인만(재결제 유도 없음)
  await patchDb(page, (d) => { const t = d.transactions.find((x) => x.requestId === 'rq-3' && x.status === 'success'); delete t.bookingId; }, null);
  await waitText(page, '예약 생성 결과를 확인하고 있어요');
  await expectStep(page, 'request', '예약금 결제', 2, '예약 생성 결과를 확인하고 있어요', '예약 생성 미확인');
  eq(await page.getByRole('button', { name: /결제하기/ }).count(), 0, '재결제 버튼 없음');
  truthy(await page.getByRole('button', { name: '결제 결과 확인하기' }).isVisible(), '결과 확인 제공');
});

await test('진행 과정: 내 예약 — 방문 예정(1)·작업 중(2)·후속 작업(2)·최종 정산(3)·이용 완료, 취소·중단은 진행 표시 없음, 직접 접근·새로고침', async (page) => {
  await start(page, { path: '/bookings/bk-k1' });
  for (const [id, cur, done, note] of [['bk-k1', '예약 확정', 0, null], ['bk-k6', '방문·작업', 1, '작업을 진행하고 있어요'], ['bk-k7', '방문·작업', 1, '후속 방문'], ['bk-k9', '최종 정산', 2, '최종 금액을 확인'], ['bk-k12', null], ['bk-k15', null], ['bk-k17', null]]) {
    await page.goto(`${BASE}/bookings/${id}`); await page.reload();
    await page.locator('main h2, main .card').first().waitFor();
    if (cur === null) { await page.waitForTimeout(300); eq(await stepState(page), null, `${id} 진행 표시 없음(취소·중단)`); continue; }
    await expectStep(page, 'booking', cur, done, note, id);
  }
  await page.goto(`${BASE}/bookings/bk-k13`);
  await page.locator('nav.steps[data-flow="booking"]').waitFor();
  const st = await stepState(page);
  eq(st.current, '', '이용 완료: 현재 단계 없음');
  eq(st.done.length, 3, '이용 완료: 모든 단계 완료');
  truthy(st.note.includes('이용 완료'), '이용 완료 안내');
  // 조건 재확인 예약은 1단계 + 안내
  await patchDb(page, (d) => { d.bookings.find((b) => b.id === 'bk-k2').status = 'terms_recheck'; }, '/bookings/bk-k2');
  await expectStep(page, 'booking', '예약 확정', 0, '조건이 바뀌어', '조건 재확인');
  // 예약 하위 화면·목록에는 표시하지 않음, 변경·취소 화면 정상
  for (const p of ['/bookings?tab=active', '/bookings?tab=past', '/bookings/bk-k1/change', '/bookings/bk-k1/cancel', '/bookings?tab=requests', '/', '/providers/p1', '/me']) {
    await page.goto(`${BASE}${p}`); await page.waitForTimeout(250);
    eq(await page.locator('nav.steps').count(), 0, `${p}에는 표시하지 않음`);
  }
  await page.goto(`${BASE}/bookings/bk-k1/cancel`);
  await waitText(page, '접수 마감 전이라 출장비 공제가 없어요');
});

await test('진행 과정: 단계는 누를 수 없고 업무 상태·경로를 바꾸지 않음', async (page) => {
  for (const p of ['/requests/rq-3', '/bookings/bk-k6']) {
    await start(page, { path: p });
    await page.locator('nav.steps').waitFor();
    eq(await page.locator('nav.steps a, nav.steps button, nav.steps [tabindex]').count(), 0, '조작 요소 없음');
    const before = JSON.stringify((await db(page)).requests.map((r) => r.status)) + JSON.stringify((await db(page)).bookings.map((b) => b.workStatus));
    for (const li of await page.locator('nav.steps li').all()) await li.click();
    await page.waitForTimeout(200);
    eq(new URL(page.url()).pathname, p, '이동 없음');
    eq(JSON.stringify((await db(page)).requests.map((r) => r.status)) + JSON.stringify((await db(page)).bookings.map((b) => b.workStatus)), before, '상태 변경 없음');
  }
});

for (const w of [360, 1280]) {
  await test(`진행 과정: ${w}px 세 단계가 잘리지 않고 높이가 과하지 않음(내 요청·내 예약)`, async (page) => {
    await page.setViewportSize({ width: w, height: 800 });
    for (const [p, labels, short] of [['/requests/rq-1', '수리 요청,업체 검토·견적,예약금 결제', '요청,검토·견적,결제'], ['/bookings/bk-k6', '예약 확정,방문·작업,최종 정산', '확정,방문·작업,정산']]) {
      await start(page, { path: p });
      await page.locator('nav.steps li[aria-current="step"]').waitFor();
      const r = await page.evaluate(() => {
        const nav = document.querySelector('nav.steps'); const nr = nav.getBoundingClientRect();
        const ls = [...nav.querySelectorAll('.steps__label')].filter((l) => getComputedStyle(l).display !== 'none' && l.getBoundingClientRect().width > 1);
        const header = document.querySelector('.app-header').getBoundingClientRect();
        const firstMain = document.querySelector('main .stack > *').getBoundingClientRect();
        return {
          visible: ls.map((l) => l.textContent).join(','), clipped: ls.filter((l) => l.scrollWidth > l.clientWidth + 1 || l.getBoundingClientRect().right > nr.right + 1 || l.getBoundingClientRect().left < nr.left - 1).length,
          height: Math.round(nr.height), overflow: document.documentElement.scrollWidth > innerWidth, belowHeader: nr.top >= header.bottom - 1, first: Math.abs(firstMain.top - nr.top) < 1,
        };
      });
      eq(r.visible, w < 480 ? short : labels, `${p} 라벨`);
      truthy(!r.clipped && !r.overflow, `잘림·가로 넘침 ${JSON.stringify(r)}`);
      truthy(r.height <= 100, `높이 ${r.height}`);
      truthy(r.belowHeader && r.first, `헤더 아래·본문 맨 위 ${JSON.stringify(r)}`);
      await page.screenshot({ path: join(ROOT, `e2e/screens/${w}_progress_${p.includes('bookings') ? 'booking' : 'request'}.png`) });
    }
  }, { width: w });
}

// ───────── 요청서 제출 오류 → 첫 오류로 스크롤·포커스 ─────────
/** 현재 포커스 대상과 가림 여부(상단 헤더 아래·하단 버튼 영역 위에 라벨·오류까지 보이는지) */
const focusInfo = (page) => page.evaluate(() => {
  const el = document.activeElement;
  const region = el.closest('[data-err-region]') ?? el.closest('.field') ?? el;
  const r = region.getBoundingClientRect();
  const h = document.querySelector('.app-header').getBoundingClientRect();
  // 하단 고정 버튼 영역이 있으면 그 위, 없으면(요청서) 화면 아래까지
  const barEl = document.querySelector('.action-bar'); const bar = barEl ? barEl.getBoundingClientRect() : { top: innerHeight };
  const errId = (el.getAttribute('aria-describedby') ?? '').split(' ').find((id) => id.endsWith('-err'));
  return {
    target: el.dataset.errTarget ?? el.tagName, invalid: el.getAttribute('aria-invalid'),
    error: errId ? document.getElementById(errId)?.textContent : null,
    visible: r.top >= h.bottom - 0.5 && r.bottom <= bar.top + 0.5, top: Math.round(r.top), headerBottom: Math.round(h.bottom), bottom: Math.round(r.bottom), barTop: Math.round(bar.top),
  };
});
/** 스크롤이 멈출 때까지 기다린다(부드러운 스크롤 포함) */
const settle = (page) => page.evaluate(() => new Promise((res) => { let last = -1, same = 0; const tick = () => { const y = Math.round(scrollY); same = y === last ? same + 1 : 0; last = y; if (same >= 4) res(); else requestAnimationFrame(tick); }; tick(); }));
const sendBtn = (page) => page.getByRole('button', { name: '요청 보내기' });
const noSaved = (d) => { d.savedVisitAddress = null; };

await test('요청서 오류 이동: 여러 항목이 비면 화면 순서상 첫 오류로 이동 → 고칠 때마다 다음 오류로, 오류 해제, 정상 요청은 한 번만', async (page) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 700 });
  await start(page, { path: '/providers/p1/request?new=1&date=2026-10-21', patch: noSaved });
  await waitText(page, '수리 요청서');
  eq(await page.locator('.field__error').count(), 0, '제출 전에는 오류 없음');
  const req0 = (await db(page)).requests.length;
  await sendBtn(page).click();
  await settle(page);
  let fi = await focusInfo(page);
  truthy(fi.target === 'tasks' && fi.invalid === 'true' && fi.error.includes('필요한 작업을 하나 이상 선택해 주세요.'), `첫 오류=작업 선택(첫 칩): ${JSON.stringify(fi)}`);
  truthy(fi.visible, `헤더·하단 버튼에 가리지 않음 ${JSON.stringify(fi)}`);
  eq(await page.locator('.field__error').count(), 3, '모든 오류를 항목 가까이에 표시(작업·상세 주소·시간 — 희망 날짜는 업체 상세에서 고름)');
  truthy((await page.locator('form p.sr-only[role="status"]').innerText()).includes('고칠 항목 3개 중 첫 항목으로 이동'), '제출 실패 한 번 알림');
  eq(await page.locator('.field__error[role="alert"]').count(), 0, '오류 문구 개별 낭독 없음');
  await page.keyboard.press('Space'); // 포커스된 첫 작업 칩을 키보드로 선택
  eq(await taskChip(page, '수전 교체').isChecked(), true, '키보드로 작업 선택');
  eq(await page.locator('.field__error').count(), 2, '고친 항목 오류 해제');
  await sendBtn(page).click(); await settle(page);
  fi = await focusInfo(page);
  truthy(fi.target === 'detail' && fi.error.includes('상세 주소') && fi.visible, `다음 오류=상세 주소 ${JSON.stringify(fi)}`);
  await page.keyboard.type('301동 1204호');
  await sendBtn(page).click(); await settle(page);
  fi = await focusInfo(page);
  truthy(fi.target === 'slots' && fi.error.includes('방문 가능한 시각을 하나 이상 선택해 주세요') && fi.visible, `다음 오류=시간(첫 선택 버튼) ${JSON.stringify(fi)}`);
  await page.keyboard.press('Space'); // 포커스된 시간 버튼을 키보드로 선택
  eq(await page.locator('.field__error').count(), 0, '모든 오류 해제');
  eq((await db(page)).requests.length, req0, '오류 동안 제출 없음');
  await sendBtn(page).dblclick();
  await waitText(page, '요청을 보냈어요');
  eq((await db(page)).requests.length, req0 + 1, '한 번만 제출');
});

await test('요청서 오류 이동: 작업을 모두 해제하고 Enter 제출 → 작업 선택으로 이동, 다시 고르면 작성 중 설명·사진 복원', async (page) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await start(page, { path: '/providers/p1/request?group=g1' });
  await pickTask(page, '수전 교체', '주방 수전 교체');
  await taskCard(page, '수전 교체').locator('input[type="file"]').setInputFiles({ name: 'faucet.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('x') });
  await taskChip(page, '수전 교체').uncheck();
  eq(await taskCard(page, '수전 교체').count(), 0, '해제하면 입력 영역 숨김');
  await page.getByLabel('상세 주소', { exact: true }).fill('301동 1204호');
  // Enter 제출: 입력란에서 Enter → 같은 검증·이동
  await page.getByLabel('상세 주소', { exact: true }).press('Enter');
  await settle(page);
  const fi = await focusInfo(page);
  truthy(fi.target === 'tasks' && fi.error === '필요한 작업을 하나 이상 선택해 주세요.', `작업 선택으로 ${JSON.stringify(fi)}`);
  truthy(fi.visible, `가림 없음 ${JSON.stringify(fi)}`);
  await page.keyboard.press('Space'); // 포커스된 첫 칩(수전 교체) 다시 선택
  eq(await taskCard(page, '수전 교체').getByLabel('자세한 설명').inputValue(), '주방 수전 교체', '다시 고르면 설명 복원');
  await taskCard(page, '수전 교체').getByText('faucet.jpg').waitFor();
});

await test('요청서 오류 이동: 건물 주소가 없으면 주소 선택 버튼으로 이동', async (page) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await start(page, { path: '/providers/p1/request?new=1&date=2026-10-21', address: null, patch: [(d) => { d.exploreAddressId = null; }, (d) => { d.savedVisitAddress = null; }] });
  await waitText(page, '수리 요청서');
  await pickTask(page, '수전 교체', '주방 수전 교체');
  await sendBtn(page).click(); await settle(page);
  const fi = await page.evaluate(() => ({ target: document.activeElement.dataset.errTarget, text: document.activeElement.textContent, desc: document.getElementById(document.activeElement.getAttribute('aria-describedby') ?? '')?.textContent }));
  eq(fi.target, 'base', '주소 선택 버튼');
  truthy(fi.desc.includes('방문할 건물 주소를 선택해 주세요'), `버튼과 오류 연결: ${JSON.stringify(fi)}`);
});

await test('요청서 오류 이동: 360×560 작은 화면·부드러운 스크롤에서도 첫 오류가 헤더·하단 버튼에 가리지 않음(한 번만 이동)', async (page) => {
  await page.setViewportSize({ width: 360, height: 560 });
  await start(page, { path: '/providers/p1/request?new=1&date=2026-10-21', patch: noSaved });
  await pickTask(page, '수전 교체', '주방 수전 교체');
  await page.getByLabel('상세 주소', { exact: true }).fill('301동 1204호');
  await page.evaluate(() => window.scrollTo(0, 0));
  const ys = [];
  await sendBtn(page).click();
  for (let k = 0; k < 30; k++) { ys.push(await page.evaluate(() => Math.round(scrollY))); await page.waitForTimeout(30); }
  await settle(page);
  const fi = await focusInfo(page);
  truthy(fi.target === 'slots' && fi.visible, `시간 선택이 가리지 않음 ${JSON.stringify(fi)}`);
  // 한 번만 이동: 스크롤 위치가 한 방향으로만 변한다(위아래로 튀지 않음)
  const diffs = ys.slice(1).map((y, k) => Math.sign(y - ys[k])).filter(Boolean);
  truthy(new Set(diffs).size <= 1, `스크롤이 튐 ${ys.join(',')}`);
  // 모션 줄이기: 애니메이션 없이 즉시 위치
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await timeChip(page, '09:00').check(); // 시간 선택 → 오류 해제
  await taskChip(page, '수전 교체').uncheck(); // 작업 선택 해제 → 작업 오류
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await sendBtn(page).click();
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
  const fi2 = await focusInfo(page);
  truthy(fi2.target === 'tasks' && fi2.visible, `모션 줄이기: 즉시 이동 ${JSON.stringify(fi2)}`);
});

await test('요청서 오류 이동: 네트워크·처리 실패는 입력란으로 이동하지 않고 폼 수준 안내·다시 보내기, 입력 유지·한 번만 제출', async (page) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await start(page, { path: '/providers/p1/request?group=g1' });
  await pickTask(page, '수전 교체', '주방 수전 교체');
  await page.getByLabel('상세 주소', { exact: true }).fill('301동 1204호');
  await timeChip(page, '09:00').check();
  const req0 = (await db(page)).requests.length;
  await page.waitForFunction(() => !!window.__sagoDev);
  await page.evaluate(() => { window.__sagoDev.db.settings.failNextWrite = true; });
  await sendBtn(page).click();
  await waitText(page, '입력한 내용은 그대로 있어요');
  const active = await page.evaluate(() => document.activeElement?.dataset?.errTarget ?? null);
  eq(active, null, '임의 입력란으로 포커스 이동 없음');
  eq(await page.locator('.field__error').count(), 0, '필드 오류로 표시하지 않음');
  eq(await taskCard(page, '수전 교체').getByLabel('자세한 설명').inputValue(), '주방 수전 교체', '입력 유지');
  eq((await db(page)).requests.length, req0, '실패 시 요청 없음');
  await page.getByRole('button', { name: '다시 보내기' }).click();
  await waitText(page, '요청을 보냈어요');
  eq((await db(page)).requests.length, req0 + 1, '재시도로 한 번만 제출');
});

// ───────── 업체 찾기: 이미지 중심 카테고리 카드 ─────────
// 카드 표시 제목(데이터의 카테고리 이름·ID·라우팅은 그대로)
const CAT_NAMES = ['방충망', '수전·배수', '문손잡이·경첩', '수납장·서랍', '창문 보수', '조명·스위치', '커튼·선반', '생활 부속품', '실리콘·줄눈', '기타 수리'];
const CAT_FILES = ['flat/c1-screen', 'flat/c2-faucet', 'flat/c3-handle-hinge', 'flat/c4-drawer', 'flat/c5-window-seal', 'flat/c6-bulb-switch', 'flat/c7-curtain', 'flat/c8-towel', 'flat/c9-caulk-tile', 'flat/c10-toolbox'];

await test('카테고리 카드: 10개 순서·이름·개별 이미지 매핑, 장식 이미지 alt 비움·크기 지정, 카드 전체가 하나의 링크', async (page) => {
  await start(page, { path: '/' });
  await page.locator('a.cat-card').nth(9).waitFor();
  await page.waitForFunction(() => [...document.querySelectorAll('.cat-card img')].every((i) => i.complete && i.naturalWidth > 0));
  const cards = await page.locator('a.cat-card').evaluateAll((els) => els.map((a) => {
    const img = a.querySelector('img');
    return { href: a.getAttribute('href'), name: a.querySelector('.cat-card__name').textContent, src: img?.getAttribute('src'), alt: img?.getAttribute('alt'), w: img?.getAttribute('width'), h: img?.getAttribute('height'), nested: a.querySelectorAll('a, button').length };
  }));
  eq(cards.length, 10, '카드 10개');
  cards.forEach((cd, i) => {
    eq(cd.href, `/providers?category=c${i + 1}`, `${i + 1} 이동`);
    eq(cd.name, CAT_NAMES[i], `${i + 1} 이름·순서`);
    eq(cd.src, `/categories/${CAT_FILES[i]}.svg`, `${i + 1} 개별 자산`);
    truthy(cd.alt === '' && cd.w === '96' && cd.h === '96' && cd.nested === 0, `${i + 1} alt·크기·중첩 ${JSON.stringify(cd)}`);
  });
  eq(new Set(cards.map((x) => x.src)).size, 10, '카드마다 다른 이미지');
  // 접근성 이름은 카테고리명만(이미지 중복 낭독 없음)
  eq(await page.getByRole('link', { name: '창문 보수', exact: true }).count(), 1, '링크 이름 = 표시 제목');
  // 배지·다른 클릭 요소 없음
  eq(await page.locator('.cat-card .badge').count(), 0, '배지 없음');
  // 공동 예약 한 줄 안내·정보 아이콘, 주소 설정 유지
  await waitText(page, '이웃과 같은 업체·같은 날 예약하고 출장비를 나눠 내요.');
  eq(await page.getByRole('button', { name: '공동 예약 이용 방법' }).count(), 1, '정보 아이콘');
  await page.locator('.explore-address').waitFor();
});

for (const [w, cols] of [[360, 2], [390, 2], [640, 3], [768, 3], [1280, 3]]) {
  await test(`카테고리 카드: ${w}px ${cols}열, 이미지 영역 높이 통일, 긴 이름 잘림·겹침 없음, 터치 영역`, async (page) => {
    await page.setViewportSize({ width: w, height: 900 });
    await start(page, { path: '/' });
    await page.locator('a.cat-card').nth(9).waitFor();
    await page.waitForFunction(() => [...document.querySelectorAll('.cat-card img')].every((i) => i.complete && i.naturalWidth > 0));
    const r = await page.evaluate(() => {
      const cards = [...document.querySelectorAll('a.cat-card')];
      const rc = cards.map((a) => a.getBoundingClientRect());
      const arts = cards.map((a) => Math.round(a.querySelector('.cat-card__art').getBoundingClientRect().height));
      const imgs = cards.map((a) => { const i = a.querySelector('img').getBoundingClientRect(); const box = a.querySelector('.cat-card__art').getBoundingClientRect(); return { ratio: +(i.width / i.height).toFixed(2), inside: i.left >= box.left - .5 && i.right <= box.right + .5 && i.top >= box.top - .5 && i.bottom <= box.bottom + .5 }; });
      const names = cards.map((a) => { const n = a.querySelector('.cat-card__name'); const cs = getComputedStyle(n); return { clip: n.scrollWidth > n.clientWidth + 1 || n.scrollHeight > n.clientHeight + 1, ellipsis: cs.textOverflow === 'ellipsis' }; });
      return {
        cols: new Set(rc.map((x) => Math.round(x.left))).size, arts: [...new Set(arts)], ratios: [...new Set(imgs.map((x) => x.ratio))], inside: imgs.every((x) => x.inside),
        clipped: names.filter((x) => x.clip || x.ellipsis).length, minH: Math.min(...rc.map((x) => x.height)), maxH: Math.max(...rc.map((x) => x.height)), minW: Math.min(...rc.map((x) => x.width)),
        overflow: document.documentElement.scrollWidth > innerWidth,
        heights: [...new Set(rc.map((x) => Math.round(x.height)))],
        lines: Math.max(...cards.map((a) => { const sp = document.createRange(); sp.selectNodeContents(a.querySelector('.cat-card__name')); return new Set([...sp.getClientRects()].map((q) => Math.round(q.top))).size; })),
        type: [...new Set(cards.map((a) => { const cs = getComputedStyle(a.querySelector('.cat-card__name')); return `${cs.fontSize}/${cs.fontWeight}/${cs.color}`; }))],
        icon: [...new Set(cards.map((a) => Math.round(a.querySelector('img').getBoundingClientRect().width)))],
        gap: [...new Set(cards.map((a) => Math.round(a.querySelector('.cat-card__name').getBoundingClientRect().top - a.querySelector('.cat-card__art').getBoundingClientRect().bottom)))],
        padTop: [...new Set(cards.map((a) => Math.round(a.querySelector('.cat-card__art').getBoundingClientRect().top - a.getBoundingClientRect().top)))],
        bg: [...new Set(cards.map((a) => getComputedStyle(a).backgroundColor))],
      };
    });
    eq(r.cols, cols, '열 수');
    eq(r.heights.length, 1, `카드 높이 통일 ${r.heights}`);
    truthy(r.lines <= (w >= 600 ? 1 : 2), `제목 줄 수(충분한 너비에서는 한 줄) ${r.lines}`);
    eq(JSON.stringify(r.type), JSON.stringify(['15px/600/rgb(32, 36, 44)']), '제목 15px·600·차콜');
    truthy(r.icon.length === 1 && r.icon[0] >= 64 && r.icon[0] <= 88, `아이콘 크기 ${r.icon}`);
    truthy(r.gap.length === 1 && r.gap[0] >= 12 && r.gap[0] <= 16, `아이콘-제목 간격 ${r.gap}`);
    truthy(r.padTop.every((p) => p >= 16 && p <= 24), `카드 위 여백 ${r.padTop}`);
    eq(JSON.stringify(r.bg), JSON.stringify(['rgb(255, 255, 255)']), '모든 카드 흰 배경');
    eq(r.arts.length, 1, `이미지 영역 높이 통일 ${r.arts}`);
    truthy(r.ratios.every((x) => Math.abs(x - 1) < .03) && r.inside, `이미지 비율 유지·잘림 없음 ${JSON.stringify(r)}`);
    eq(r.clipped, 0, '이름 잘림·말줄임 없음');
    truthy(!r.overflow, '가로 넘침 없음');
    truthy(r.minH >= 44 && r.minW >= 44 && r.maxH <= 170, `카드 크기 ${JSON.stringify(r)}`);
    await page.locator('.cat-grid').scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(ROOT, `e2e/screens/${w}_category_cards.png`), fullPage: true });
  }, { width: w });
}

await test('카테고리 카드: 여러 화면 너비(브라우저 확대·축소에 해당)에서 마지막 줄도 왼쪽부터 같은 너비로 채움, 제목·가운뎃점 잘림 없음', async (page) => {
  await start(page, { path: '/' });
  const bad = [];
  // 브라우저 확대·축소는 CSS 화면 너비를 바꾸는 것과 같다(예: 1280px에서 200% = 640px, 50% = 2560px)
  for (const w of [320, 360, 480, 599, 600, 640, 700, 719, 720, 768, 1024, 1280, 2560]) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.waitForTimeout(80);
    const r = await page.evaluate(() => {
      const cards = [...document.querySelectorAll('a.cat-card')].map((a) => a.getBoundingClientRect());
      const cols = new Set(cards.map((x) => Math.round(x.left))).size;
      const first = cards[0], last = cards[cards.length - 1];
      const lastRow = cards.filter((x) => Math.round(x.top) === Math.round(last.top));
      const rows = [...new Set(cards.map((x) => Math.round(x.top)))].map((t) => cards.filter((x) => Math.round(x.top) === t).map((x) => Math.round(x.height)));
      const clipped = [...document.querySelectorAll('.cat-card__name')].filter((n) => {
        const card = n.closest('a').getBoundingClientRect(); const range = document.createRange(); range.selectNodeContents(n);
        return [...range.getClientRects()].some((q) => q.left < card.left - .5 || q.right > card.right + .5) || n.scrollWidth > n.clientWidth + 1;
      }).length;
      return { cols, lastLeft: Math.round(last.left), firstLeft: Math.round(first.left), lastW: Math.round(last.width), firstW: Math.round(first.width), lastRowCount: lastRow.length,
        rowHeightsSame: rows.every((h) => new Set(h).size === 1), clipped, overflow: document.documentElement.scrollWidth > innerWidth };
    });
    const expectCols = w >= 600 ? 3 : 2;
    if (r.cols !== expectCols) bad.push(`${w}px 열 ${r.cols}`);
    if (r.lastLeft !== r.firstLeft && r.lastRowCount === 1) bad.push(`${w}px 마지막 카드가 첫 열이 아님`);
    if (Math.abs(r.lastW - r.firstW) > 1) bad.push(`${w}px 마지막 카드 너비 ${r.lastW}/${r.firstW}`);
    if (!r.rowHeightsSame) bad.push(`${w}px 같은 행 카드 높이 다름`);
    if (r.clipped) bad.push(`${w}px 제목 잘림 ${r.clipped}`);
    if (r.overflow) bad.push(`${w}px 가로 넘침`);
    if (w === 640) await page.screenshot({ path: join(ROOT, 'e2e/screens/640_category_cards_left.png'), clip: { x: 0, y: 180, width: 640, height: 640 } });
  }
  truthy(!bad.length, bad.join(' / '));
});

await test('카테고리 카드: 이미지를 불러오지 못해도 이름·영역·이동 유지 → 업체 목록에 같은 주소', async (page) => {
  await page.route('**/categories/flat/c5-window-seal.svg', (route) => route.abort());
  await start(page, { path: '/' });
  const card = page.getByRole('link', { name: '창문 보수', exact: true });
  await card.waitFor();
  await page.waitForFunction(() => !document.querySelector('a[href="/providers?category=c5"] img'));
  const h = await page.evaluate(() => [...document.querySelectorAll('.cat-card__art')].map((e) => Math.round(e.getBoundingClientRect().height)));
  eq(new Set(h).size, 1, '실패한 카드도 같은 이미지 영역 높이');
  await card.click();
  await page.waitForURL((u) => u.pathname === '/providers' && u.searchParams.get('category') === 'c5');
  await page.locator('.region-card').getByText('햇살마을 3단지', { exact: true }).waitFor();
});

await test('카테고리 카드: 키보드 Tab·Enter로 선택, 포커스 표시, 업체 목록 이동·주소 전달', async (page) => {
  await start(page, { path: '/' });
  await page.locator('a.cat-card').first().waitFor();
  await page.locator('a.cat-card').nth(1).focus();
  const outline = await page.locator('a.cat-card').nth(1).evaluate((el) => getComputedStyle(el).outlineStyle);
  await page.keyboard.press('Tab');
  eq(await page.evaluate(() => document.activeElement.getAttribute('href')), '/providers?category=c3', 'Tab으로 다음 카드');
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Enter');
  await page.waitForURL((u) => u.pathname === '/providers' && u.searchParams.get('category') === 'c2');
  await page.locator('.region-card').getByText('햇살마을 3단지', { exact: true }).waitFor();
  await page.locator('ul[aria-label="업체 목록"]').waitFor();
  truthy(outline !== 'none', `포커스 표시 ${outline}`);
});

// ───────── 내 정보 수정(이름·연락처) ─────────
const editBtn = (page) => page.getByRole('button', { name: '내 정보 수정' });
const pDlg = (page) => page.getByRole('dialog', { name: '내 정보 수정' });
const pName = (page) => pDlg(page).getByLabel('이름', { exact: true });
const pPhone = (page) => pDlg(page).getByLabel('연락처', { exact: true });
const profileCard = (page) => page.locator('main .card.row').first();

await test('내 정보 수정: 현재 값 표시 → 저장 → 즉시 반영·완료 안내·마스킹 유지 → 새로고침 후 유지', async (page) => {
  await start(page, { path: '/me' });
  await editBtn(page).waitFor();
  eq((await editBtn(page).innerText()).trim(), '수정', '버튼 글자');
  await editBtn(page).click();
  await pDlg(page).waitFor();
  eq(await pName(page).inputValue(), '김온다 (가상 고객)', '현재 이름 미리 표시');
  eq(await pPhone(page).inputValue(), '010-0000-0000', '현재 연락처(전체 번호) 미리 표시');
  eq(await pPhone(page).getAttribute('type'), 'tel', '전화번호 키보드(type)');
  eq(await pPhone(page).getAttribute('inputmode'), 'tel', '전화번호 키보드(inputmode)');
  const dialogText = await pDlg(page).innerText();
  truthy(dialogText.includes('가상 정보를 입력해도 돼요') && !/인증 완료|본인 확인 완료|인증됨/.test(dialogText), '가상 정보 안내·인증 표현 없음');
  truthy(/취소/.test(dialogText) && /저장하기/.test(dialogText), '하단 버튼');
  truthy((await pDlg(page).getByRole('button', { name: '저장하기' }).getAttribute('class')).includes('primary'), '저장하기 = 주요 버튼');
  await pName(page).fill('  박데모  ');
  await pPhone(page).fill('010 9876-5432');
  await pDlg(page).getByRole('button', { name: '저장하기' }).click();
  await pDlg(page).waitFor({ state: 'detached' });
  await waitText(page, '정보를 수정했어요.');
  const card = await profileCard(page).innerText();
  truthy(card.includes('박데모') && card.includes('010-****-5432') && !card.includes('9876'), `즉시 반영·마스킹: ${card}`);
  eq(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), '내 정보 수정', '닫은 뒤 수정 버튼으로 포커스');
  const d = await db(page);
  eq(d.customer.phone, '01098765432', '숫자만 저장');
  eq(d.customer.name, '박데모', '앞뒤 공백 제거');
  await page.reload();
  await waitText(page, '박데모');
  truthy((await profileCard(page).innerText()).includes('010-****-5432'), '새로고침 후 유지');
  truthy(!(await page.locator('main').innerText()).includes('정보를 수정했어요.'), '완료 안내는 새로고침 후 다시 뜨지 않음');
  const banner = await page.locator('main .banner--info').last().innerText();
  truthy(banner.includes('이 브라우저 탭에만 저장') && banner.includes('새로고침해도 유지') && banner.includes('이름·연락처'), `저장 범위 안내: ${banner}`);
  await editBtn(page).click();
  eq(await pPhone(page).inputValue(), '010-9876-5432', '다시 열면 저장한 값');
});

await test('내 정보 수정: 취소·닫기·Escape·바깥 누르기는 변경을 반영하지 않음', async (page) => {
  await start(page, { path: '/me' });
  for (const how of ['cancel', 'close', 'escape', 'backdrop']) {
    await editBtn(page).click();
    await pName(page).fill(`바뀐이름-${how}`);
    await pPhone(page).fill('010-1111-1111');
    if (how === 'cancel') await pDlg(page).getByRole('button', { name: '취소' }).click();
    if (how === 'close') await pDlg(page).getByRole('button', { name: '닫기' }).click();
    if (how === 'escape') await page.keyboard.press('Escape');
    if (how === 'backdrop') await page.mouse.click(5, 5);
    await pDlg(page).waitFor({ state: 'detached' });
    const card = await profileCard(page).innerText();
    truthy(card.includes('김온다 (가상 고객)') && card.includes('010-****-0000'), `${how}: 반영 안 됨 ${card}`);
    truthy(!(await page.locator('main').innerText()).includes('정보를 수정했어요.'), `${how}: 완료 안내 없음`);
    await editBtn(page).click();
    eq(await pName(page).inputValue(), '김온다 (가상 고객)', `${how}: 다시 열면 저장된 값`);
    await pDlg(page).getByRole('button', { name: '취소' }).click();
  }
  eq((await db(page)).customer.name, '김온다 (가상 고객)', '저장소 그대로');
});

await test('내 정보 수정: 빈 값·공백 이름·잘못된 연락처 → 입력란 아래 오류, 첫 오류로 포커스, 고치면 저장', async (page) => {
  await start(page, { path: '/me' });
  await editBtn(page).click();
  await pName(page).fill('   ');
  await pPhone(page).fill('');
  await pDlg(page).getByRole('button', { name: '저장하기' }).click();
  await waitText(page, '이름을 입력해 주세요');
  await waitText(page, '연락처를 입력해 주세요');
  eq(await page.evaluate(() => document.activeElement?.getAttribute('data-err-target')), 'name', '첫 오류(이름)로 포커스');
  eq(await pName(page).getAttribute('aria-invalid'), 'true', '이름 오류 연결');
  truthy((await pName(page).getAttribute('aria-describedby')).length > 0, '오류 문구 연결');
  // 이름만 고치면 다음 저장 때 연락처로
  await pName(page).fill('Kim Demo');
  for (const [v, msg] of [['011-1234-5678', '010으로 시작하는'], ['010-1234-567', '11자리'], ['010-1234-5678#', '숫자와 하이픈']]) {
    await pPhone(page).fill(v);
    await pDlg(page).getByRole('button', { name: '저장하기' }).click();
    await waitText(page, msg);
    eq(await page.evaluate(() => document.activeElement?.getAttribute('data-err-target')), 'phone', `${v}: 연락처로 포커스`);
    truthy(await pDlg(page).isVisible(), '오류면 닫히지 않음');
  }
  eq((await db(page)).customer.name, '김온다 (가상 고객)', '오류면 저장 안 함');
  // Enter로 제출(키보드)
  await pPhone(page).fill('01012345678');
  await pPhone(page).press('Enter');
  await pDlg(page).waitFor({ state: 'detached' });
  truthy((await profileCard(page).innerText()).includes('Kim Demo'), '한글 외 이름 허용·Enter 저장');
});

await test('내 정보 수정: 저장 실패 시 입력 유지·실패 안내, 저장 중 중복 제출·닫기 방지', async (page) => {
  await start(page, { path: '/me', latency: 600 });
  await editBtn(page).click();
  await pName(page).fill('실패후성공');
  await pPhone(page).fill('010-2222-3333');
  await page.evaluate(() => { window.__sagoDev.db.settings.failNextWrite = true; });
  await pDlg(page).getByRole('button', { name: '저장하기' }).click();
  await waitText(page, '정보를 저장하지 못했어요.');
  eq(await pName(page).inputValue(), '실패후성공', '실패 후 이름 유지');
  eq(await pPhone(page).inputValue(), '010-2222-3333', '실패 후 연락처 유지');
  truthy(!(await page.locator('main').innerText()).includes('정보를 수정했어요.'), '실패인데 완료 안내 없음');
  truthy((await profileCard(page).innerText()).includes('김온다 (가상 고객)'), '실패면 반영 안 함');
  // 저장 중: 버튼 비활성·연타해도 한 번, Escape로 닫히지 않음
  const save = pDlg(page).getByRole('button', { name: '저장하기' });
  await save.click();
  eq(await save.getAttribute('aria-busy'), 'true', '저장 중 표시');
  truthy(await save.isDisabled(), '저장 중 비활성');
  await save.click({ force: true }).catch(() => {});
  await page.keyboard.press('Escape');
  truthy(await pDlg(page).isVisible(), '저장 중에는 닫히지 않음');
  await pDlg(page).waitFor({ state: 'detached' });
  await waitText(page, '정보를 수정했어요.');
  truthy((await profileCard(page).innerText()).includes('실패후성공'), '다시 저장하면 반영');
});

await test('내 정보 수정 → 새 요청서 기본값, 직접 입력한 값은 덮어쓰지 않음, 기존 요청·예약 연락처 유지', async (page) => {
  await start(page, { path: '/me' });
  await editBtn(page).click();
  await pName(page).fill('박데모');
  await pPhone(page).fill('01098765432');
  await pDlg(page).getByRole('button', { name: '저장하기' }).click();
  await waitText(page, '정보를 수정했어요.');
  // 새 수리 요청서: 바뀐 값이 기본값
  await page.goto(`${BASE}/providers/p1/request?new=1&date=2026-10-21`);
  const fName = page.locator('main').getByLabel('이름', { exact: true });
  const fPhone = page.locator('main').getByLabel('연락처', { exact: true });
  await page.waitForFunction(() => [...document.querySelectorAll('main input')].some((i) => i.value === '박데모'));
  eq(await fName.inputValue(), '박데모', '요청서 이름 기본값');
  eq(await fPhone.inputValue(), '010-9876-5432', '요청서 연락처 기본값');
  eq(await fPhone.getAttribute('inputmode'), 'tel', '요청서 연락처 키보드');
  // 작성 중 직접 고친 값은 내 정보가 바뀌어도 그대로
  await fName.fill('요청용 이름');
  await page.evaluate(() => window.__sagoDev.repo.updateProfile({ name: '다른이름', phone: '01055556666' }));
  await page.waitForTimeout(400);
  eq(await fName.inputValue(), '요청용 이름', '직접 입력한 이름 유지');
  eq(await fPhone.inputValue(), '010-9876-5432', '열려 있는 요청서는 다시 채우지 않음');
  // 요청서에서 잘못된 연락처 → 해당 칸 오류·포커스
  await fillNewDateRequest(page, '연락처 확인용 요청');
  await detailInput(page).fill('301동 1204호');
  await fPhone.fill('010-12');
  await page.getByRole('button', { name: '요청 보내기' }).click();
  await waitText(page, '11자리');
  eq(await page.evaluate(() => document.activeElement?.getAttribute('data-err-target')), 'phone', '요청서 연락처 오류로 포커스');
  await fPhone.fill('010-7777-8888');
  await page.getByRole('button', { name: '요청 보내기' }).click();
  await openSentDetail(page);
  await waitText(page, '요청용 이름');
  truthy((await page.locator('main').innerText()).includes('010-****-8888'), '제출한 연락처(마스킹)');
  const d = await db(page);
  const created = d.requests.find((r) => r.tasks[0].description === '연락처 확인용 요청');
  eq(JSON.stringify(created.contact), JSON.stringify({ name: '요청용 이름', phone: '01077778888' }), '요청 스냅숏');
  eq(d.customer.name, '다른이름', '요청서에서 고쳐도 내 정보는 그대로');
  // 기존 요청·확정 예약은 제출 당시 정보
  await page.goto(`${BASE}/requests/rq-3`);
  await waitText(page, '연락처');
  truthy((await page.locator('main').innerText()).includes('김온다 (가상 고객) · 010-****-0000'), '기존 요청 연락처 유지');
  await page.goto(`${BASE}/bookings/bk-k2`);
  await page.getByRole('heading', { name: '예약 정보', exact: true }).waitFor();
  await waitText(page, '김온다 (가상 고객)');
  const bk = await page.locator('main').innerText();
  truthy(bk.includes('김온다 (가상 고객) · 010-****-0000') && !bk.includes('다른이름'), '기존 예약 연락처 유지');
});

for (const w of [390, 1280]) {
  await test(`내 정보 수정: ${w}px 배치·키보드 조작(열기·Tab 순서·닫기 후 포커스), 가로 넘침 없음`, async (page) => {
    await page.setViewportSize({ width: w, height: 800 });
    await start(page, { path: '/me' });
    await editBtn(page).focus();
    await page.keyboard.press('Enter');
    await pDlg(page).waitFor();
    const r = await page.evaluate(() => {
      const dlg = document.querySelector('[role=dialog]').getBoundingClientRect();
      const btns = [...document.querySelectorAll('.dialog-actions-row button')].map((b) => b.getBoundingClientRect());
      return { overflow: document.documentElement.scrollWidth > innerWidth, inView: dlg.left >= 0 && dlg.right <= innerWidth + .5 && dlg.bottom <= innerHeight + .5,
        sideBySide: btns.length === 2 && Math.abs(btns[0].top - btns[1].top) < 1 && btns[0].right <= btns[1].left, primaryWider: btns[1].width > btns[0].width,
        tall: btns.every((b) => b.height >= 44) };
    });
    truthy(!r.overflow && r.inView && r.sideBySide && r.primaryWider && r.tall, `배치 ${JSON.stringify(r)}`);
    const card = await profileCard(page).evaluate((el) => { const b = el.querySelector('button').getBoundingClientRect(); const c = el.getBoundingClientRect(); return { right: c.right - b.right, inside: b.right <= c.right }; });
    truthy(card.inside && card.right < 40, `수정 버튼이 프로필 영역 오른쪽 ${JSON.stringify(card)}`);
    // Tab 순서: 닫기 → 이름 → 연락처 → 취소 → 저장하기 → (갇힘) 닫기
    const seq = [];
    for (let i = 0; i < 6; i++) { seq.push(await page.evaluate(() => document.activeElement?.getAttribute('aria-label') || document.activeElement?.getAttribute('data-err-target') || document.activeElement?.textContent.trim())); await page.keyboard.press('Tab'); }
    eq(seq.join(','), '닫기,name,phone,취소,저장하기,닫기', 'Tab 순서·포커스 가둠');
    if (w === 390) await page.screenshot({ path: join(ROOT, 'e2e/screens/390_me_edit.png') });
    if (w === 1280) await page.screenshot({ path: join(ROOT, 'e2e/screens/1280_me_edit.png') });
    await page.keyboard.press('Escape');
    await pDlg(page).waitFor({ state: 'detached' });
    eq(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), '내 정보 수정', '닫은 뒤 수정 버튼으로 포커스');
  }, { width: w });
}

// ───────── 내 예약 통합 메뉴: 보낸 요청 / 확정된 예약 / 완료·취소 ─────────
const resTab = (page, name) => page.getByRole('tab', { name, exact: true });
const resCount = async (page) => {
  await page.locator('.filter-bar__count b').waitFor();
  await page.waitForSelector('main [aria-busy="true"]', { state: 'detached' }).catch(() => {});
  return Number(await page.locator('.filter-bar__count b').innerText());
};
const listLinks = (page) => page.locator('main [role="tabpanel"] ul.request-list > li > a, main [role="tabpanel"] ul.booking-list > li > a');
const hrefs = async (page) => listLinks(page).evaluateAll((as) => as.map((a) => a.getAttribute('href')));
async function openTab(page, name) {
  await resTab(page, name).click();
  await page.waitForFunction((n) => document.querySelector('[role=tab][aria-selected=true]')?.textContent === n, name);
  await resCount(page);
  return hrefs(page);
}

await test('내 예약 통합: 메뉴 3개·탭 순서·기본 탭·URL 반영, 상세 뒤로·새로고침·브라우저 뒤로로 탭 복원, 키보드 탭 이동', async (page) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await start(page, { path: '/bookings' });
  await page.waitForURL((u) => u.search === '?tab=requests');
  eq((await page.getByRole('tab').allInnerTexts()).join('/'), '보낸 요청/확정된 예약/완료·취소', '탭 순서');
  eq(await resTab(page, '보낸 요청').getAttribute('aria-selected'), 'true', '처음은 보낸 요청');
  eq((await page.locator('nav.top-nav a').allInnerTexts()).map((x) => x.trim()).join('/'), '업체 찾기/내 예약/내 정보', '상단 메뉴');
  eq(await page.locator('nav.top-nav').getByRole('link', { name: '내 예약' }).getAttribute('aria-current'), 'page', '내 예약 활성');
  eq(await page.getByRole('link', { name: '내 요청' }).count(), 0, '내 요청 메뉴 없음');
  await openTab(page, '확정된 예약');
  eq(new URL(page.url()).search, '?tab=active', '탭 선택이 URL에');
  await page.reload();
  await resTab(page, '확정된 예약').waitFor();
  eq(await resTab(page, '확정된 예약').getAttribute('aria-selected'), 'true', '새로고침 후 탭 유지');
  await listLinks(page).first().click();
  await page.waitForURL((u) => u.pathname.startsWith('/bookings/bk-'));
  eq(await page.locator('nav.top-nav').getByRole('link', { name: '내 예약' }).getAttribute('aria-current'), 'page', '예약 상세에서도 내 예약 활성');
  await page.goBack();
  await page.waitForURL((u) => u.pathname === '/bookings');
  eq(await resTab(page, '확정된 예약').getAttribute('aria-selected'), 'true', '브라우저 뒤로 → 탭 복원');
  // 키보드: 좌우 화살표로 탭 이동(선택 포함), 선택 탭만 Tab 순서에 있음
  await resTab(page, '확정된 예약').focus();
  await page.keyboard.press('ArrowRight');
  await page.waitForURL((u) => u.search.includes('tab=past'));
  eq(await page.evaluate(() => document.activeElement?.textContent), '완료·취소', '화살표로 다음 탭');
  await page.keyboard.press('ArrowRight');
  await page.waitForURL((u) => u.search.includes('tab=requests'));
  await page.locator('[role=tabpanel][aria-labelledby="res-tab-requests"]').waitFor({ timeout: 3000 }).catch(() => {}); // 주소가 바뀐 뒤 다시 그려질 때까지
  eq(await page.locator('[role=tab][tabindex="0"]').count(), 1, '선택 탭만 Tab 순서');
  eq(await page.locator('[role=tabpanel]').getAttribute('aria-labelledby'), 'res-tab-requests', '탭 패널 연결');
  // 요청 상세·비교 요청에서도 내 예약 활성
  for (const p of ['/requests/rq-3', ...(COMPARE ? ['/requests/bundle/b-sink'] : []), '/requests/rq-3/approval']) {
    await page.goto(`${BASE}${p}`);
    await page.locator('nav.top-nav').waitFor();
    eq(await page.locator('nav.top-nav').getByRole('link', { name: '내 예약' }).getAttribute('aria-current'), 'page', `${p} 내 예약 활성`);
  }
});

await test('내 예약 통합: 각 요청·예약은 한 탭에만(건수 = 표시 수), 확정 전 종료 요청은 보낸 요청에 사유와 함께', async (page) => {
  await start(page, { path: '/bookings?tab=requests' });
  const nSent = await resCount(page);
  const sent = await hrefs(page);
  eq(nSent, sent.length, '보낸 요청 건수 = 표시 묶음 수');
  const active = await openTab(page, '확정된 예약');
  eq(await resCount(page), active.length, '확정된 예약 건수 = 표시 수');
  const past = await openTab(page, '완료·취소');
  eq(await resCount(page), past.length, '완료·취소 건수 = 표시 수');
  const d = await db(page);
  eq(active.filter((h) => past.includes(h)).length, 0, '예약 중복 없음');
  eq([...active, ...past].sort().join(), d.bookings.map((b) => `/bookings/${b.id}`).sort().join(), '모든 예약이 정확히 한 탭에');
  if (COMPARE) {
    const converted = new Set(d.requests.filter((r) => r.status === 'booked' || r.bookingId).map((r) => r.bundleId));
    const expectedBundles = [...new Set(d.requests.filter((r) => !converted.has(r.bundleId)).map((r) => r.bundleId))];
    eq(sent.length, expectedBundles.length, '보낸 요청 = 예약으로 이어지지 않은 묶음');
  } else {
    // 데모(개별 요청): 업체 요청 하나가 카드 하나, 각자 요청 상세로. 예약으로 이어진 요청·다른 업체 예약으로 종료된 요청(비교 결과)은 없다
    const expected = d.requests.filter((r) => r.status !== 'booked' && !r.bookingId && r.status !== 'closed_other_booking').map((r) => `/requests/${r.id}`).sort();
    eq([...sent].sort().join(), expected.join(), '보낸 요청 = 예약으로 이어지지 않은 업체 요청 각각');
    truthy(!sent.some((h) => h.startsWith('/requests/bundle/')), '비교 요청 화면 링크 없음');
  }
  truthy(!sent.some((h) => h === '/requests/bundle/b-lamp' || h === '/requests/rq-8'), '다른 업체 예약으로 종료된 묶음은 보낸 요청에 없음');
  // 종료된 요청: 상태와 사유
  await openTab(page, '보낸 요청');
  const main = await page.locator('main').innerText();
  truthy(main.includes('업체 거절') && main.includes('거절 사유: 서랍 레일 규격 확인이 어려워'), '거절 + 사유');
  truthy(main.includes('요청 취소') && main.includes('결제 기한 만료') && !main.includes('철회') && !main.includes('승인 만료'), '요청 취소·결제 기한 만료(이전 이름 없음)');
  truthy(main.includes('업체 검토 중') && main.includes('요청서를 보완해 주세요') && main.includes('예약금 결제') && !main.includes('추가 정보 필요') && !main.includes('확인 필요'), '검토(보완 요청은 할 일)·예약금 결제');
  truthy(!main.includes('예약 완료'), '보낸 요청에 예약 완료 없음');
  // 확정된 예약: 최종 금액 확인·정산 대기 유지 / 완료·취소: 이용 완료·취소(환불 상태)
  await openTab(page, '확정된 예약');
  const a = await page.locator('main').innerText();
  truthy(a.includes('최종 정산') && a.includes('정산 진행 중'), '정산 전 예약은 확정된 예약');
  await openTab(page, '완료·취소');
  const p = await page.locator('main').innerText();
  truthy(p.includes('이용 완료') && p.includes('예약 취소') && /환불/.test(p), `완료·취소(환불 상태 표시): ${p.slice(0, 300)}`);
});

await testCompare('내 예약 통합: 결제 실패·확인 중은 보낸 요청 유지 → 결제 성공이면 비교 묶음이 빠지고 선택한 예약만 확정된 예약 → 취소하면 완료·취소에만', async (page) => {
  await start(page, { path: '/requests/rq-3/approval', patch: (d) => { d.settings.payOutcome = 'fail'; } });
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: PAY_BTN }).click();
  await waitText(page, '결제가 완료되지 않았어요');
  eq(await page.getByRole('link', { name: '보낸 요청 목록' }).getAttribute('href'), '/bookings?tab=requests', '실패 → 보낸 요청 목록');
  await page.goto(`${BASE}/bookings?tab=requests`);
  await resCount(page);
  truthy((await hrefs(page)).includes('/requests/bundle/b-sink'), '결제 실패: 보낸 요청 유지');
  await waitText(page, '예약금 결제 실패');
  await patchDb(page, (d) => { d.settings.payOutcome = 'unknown'; d.settings.resolveOutcome = 'unknown'; }, '/requests/rq-3/approval');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: PAY_BTN }).click();
  await waitText(page, '결제 결과를 확인하고 있어요');
  const payUrl = page.url();
  await page.goto(`${BASE}/bookings?tab=requests`);
  await resCount(page);
  truthy((await hrefs(page)).includes('/requests/bundle/b-sink'), '결과 확인 중: 보낸 요청 유지');
  await waitText(page, '예약금 결제 결과 확인 중');
  const activeBefore = (await openTab(page, '확정된 예약')).length;
  // 결제 성공(결과 확인)
  await patchDb(page, (d) => { d.settings.resolveOutcome = 'success'; }, null);
  await page.goto(payUrl);
  await page.getByRole('button', { name: '결제 결과 확인하기' }).click();
  await page.waitForURL((u) => u.pathname.startsWith('/bookings/bk-'));
  const bkPath = new URL(page.url()).pathname;
  // 예약 상세에는 요청 당시 내용 펼치기가 없다(작업 내용은 작업 카드에서 한 번만)
  await page.locator('#work').waitFor();
  eq(await page.getByText('요청 당시 내용').count(), 0, '요청 당시 내용 펼치기 없음');
  await page.getByRole('link', { name: '예약 목록으로' }).click();
  await page.waitForURL((u) => u.pathname === '/bookings' && u.search.includes('tab=active'));
  const active = (await resCount(page), await hrefs(page));
  eq(active.length, activeBefore + 1, '선택한 업체 예약 하나만 추가');
  eq(active.filter((h) => h === bkPath).length, 1, '확정된 예약에 한 번');
  const sent = await openTab(page, '보낸 요청');
  truthy(!sent.includes('/requests/bundle/b-sink') && !sent.includes('/requests/rq-4'), '비교 묶음(다른 업체 포함)은 보낸 요청에서 빠짐');
  // 원본 기록은 상세에서 그대로
  await page.goto(`${BASE}/requests/bundle/b-sink`);
  await waitText(page, '다른 업체 예약으로 종료');
  // 확정 후 취소 → 완료·취소에만, 묶음은 돌아오지 않음
  const id = bkPath.split('/').pop();
  await page.evaluate(async (bid) => { const r = window.__sagoDev.repo; const c = await r.getCancelContext(bid); await r.cancelBooking({ bookingId: bid, expectedRefund: c.preview.refundTotal, idempotencyKey: 'e2e-cancel' }); }, id);
  await page.goto(`${BASE}${bkPath}`);
  await page.getByRole('link', { name: '예약 목록으로' }).click();
  await page.waitForURL((u) => u.search.includes('tab=past'));
  await resCount(page);
  eq((await hrefs(page)).filter((h) => h === bkPath).length, 1, '취소 → 완료·취소');
  truthy(!(await openTab(page, '확정된 예약')).includes(bkPath), '확정된 예약에서 빠짐');
  truthy(!(await openTab(page, '보낸 요청')).includes('/requests/bundle/b-sink'), '취소돼도 비교 묶음은 보낸 요청으로 돌아오지 않음');
  eq((await db(page)).requests.find((r) => r.id === 'rq-4').status, 'closed_other_booking', '다른 업체 요청은 다시 활성화하지 않음');
});

await test('내 예약 통합: 새 요청 제출 → 보낸 요청(목록 문구·이동), 확정 전 거절은 보낸 요청에만', async (page) => {
  await start(page, { path: '/providers/p1/request?new=1&date=2026-10-21' });
  await fillNewDateRequest(page, '통합 탭 확인용 요청');
  await detailInput(page).fill('301동 1204호');
  await page.getByRole('button', { name: '요청 보내기' }).click();
  await page.waitForURL((u) => /^\/requests\/rq-[^/]+\/sent$/.test(u.pathname));
  const rid = new URL(page.url()).pathname.split('/')[2];
  await page.getByRole('main').getByRole('link', { name: '보낸 요청', exact: true }).click(); // 완료 화면의 보조 안내 링크
  await page.waitForURL((u) => u.pathname === '/bookings' && u.search.includes('tab=requests'));
  await resCount(page);
  truthy((await hrefs(page)).includes(`/requests/${rid}`), '제출한 요청이 보낸 요청에');
  await dev(page, 'rejectRequest', rid);
  await page.reload();
  await resCount(page);
  truthy((await hrefs(page)).includes(`/requests/${rid}`), '거절돼도 보낸 요청에 남음');
  const card = page.locator(`a[href="/requests/${rid}"]`);
  truthy((await card.innerText()).includes('업체 거절'), '종료 상태 표시');
  await openTab(page, '확정된 예약');
  truthy(!(await hrefs(page)).some((h) => h.includes(rid)), '확정된 예약에는 없음');
  truthy(!(await openTab(page, '완료·취소')).some((h) => h.includes(rid)), '완료·취소에도 없음');
});

// ───────── 수리 요청 완료 화면 ─────────
/** 앱 안 이동(문서를 새로 불러오지 않음) — 앱 상태(비교 묶음 등)를 유지한 채 주소만 바꾼다 */
const spaGo = (page, p) => page.evaluate((to) => { history.pushState(history.state, '', to); dispatchEvent(new PopStateEvent('popstate', { state: history.state })); }, p);
const sentText = (page) => page.locator('.sent').innerText();
const sentHeading = (page) => page.getByRole('heading', { name: '수리 요청을 보냈어요' });
/** 단일 업체 요청을 제출하고 완료 화면에서 멈춘다 */
async function submitSingleRequest(page) {
  await start(page, { path: '/providers/p1/request?new=1&date=2026-10-21' });
  await fillNewDateRequest(page, '완료 화면 배치 확인');
  await detailInput(page).fill('301동 1204호');
  await page.getByRole('button', { name: '요청 보내기' }).click();
  await page.waitForURL((u) => u.pathname.startsWith('/requests/rq-') && u.pathname.endsWith('/sent'));
  await sentHeading(page).waitFor();
}
/** 비교 묶음(b-sink: 한빛설비·새봄수리)에 밝은전기(p3) 요청을 더해 제출한다 */
async function submitCompareRequest(page) {
  await start(page, { path: '/requests/bundle/b-sink' });
  await page.getByRole('button', { name: '같은 작업을 다른 업체에도 요청하기' }).click();
  await page.waitForURL((u) => u.pathname === '/');
  await spaGo(page, '/providers/p3/request?new=1&date=2026-10-21');
  await waitText(page, '같은 작업을 다른 업체에도 요청하고 있어요');
  // 앞선 요청 작업(직접 입력: 욕실 세면대 수전 교체·배수 트랩 교체)은 밝은전기 작업 목록에 없어 미리 고르지 않는다 → 이 업체 작업을 고른다
  await waitText(page, '이 업체 작업 목록에 없어 선택하지 않았어요');
  eq(await page.locator('.task-pick .svc-chip__input:checked').count(), 0, '다른 업체 작업은 미리 선택되지 않음');
  await pickTask(page, '스위치 교체', '거실 스위치');
  await pickTask(page, '조명 교체', '거실 등');
  await timeChip(page, '09:00').check();
  await detailInput(page).fill('301동 1204호');
  const n0 = (await db(page)).requests.length;
  await page.getByRole('button', { name: '요청 보내기' }).click();
  await page.waitForURL((u) => /^\/requests\/rq-[^/]+\/sent$/.test(u.pathname));
  await sentHeading(page).waitFor();
  return n0;
}

await test('요청 완료: 단일 요청 제출 → 완료 화면(실제 요약·확정 조건, 제목 포커스) → 새로고침·뒤로·앞으로 중복 없음 → 요청 상세, 목록에서는 상세로 바로', async (page) => {
  await start(page, { path: '/providers/p1' });
  await spaGo(page, '/providers/p1/request?new=1&date=2026-10-21');
  await waitText(page, '수리 요청서');
  await pickTask(page, '수전 교체', '완료 화면 확인 작업');
  await timeChip(page, '09:00').check();
  await detailInput(page).fill('301동 1204호');
  const n0 = (await db(page)).requests.length;
  await page.getByRole('button', { name: '요청 보내기' }).dblclick(); // 연타해도 한 번만
  await page.waitForURL((u) => /^\/requests\/rq-[^/]+\/sent$/.test(u.pathname));
  const rid = new URL(page.url()).pathname.split('/')[2];
  await sentHeading(page).waitFor();
  eq(await page.evaluate(() => document.activeElement?.textContent), '수리 요청을 보냈어요', '이동 후 제목에 포커스');
  const t = await sentText(page);
  for (const s of ['업체가 작업 가능 여부와 견적을 확인하고 있어요.', '요청한 수리', '수전 교체', '요청한 업체', '한빛설비', '아직 예약이 확정된 것은 아니에요.', '업체 승인 후 예약금을 결제하면 예약이 확정돼요.', '요청 내용 확인하기', '보낸 요청에서 진행 상황을 확인할 수 있어요.']) truthy(t.includes(s), `완료 화면 ‘${s}’: ${t}`);
  for (const s of ['예약 완료', '예약이 확정됐어요', '방문 예정', '10월 21일', ' 외 ', '개 업체']) truthy(!t.includes(s), `표시하지 않음 ‘${s}’: ${t}`);
  eq(await page.locator('.sent__icon').evaluate((e) => getComputedStyle(e).color), 'rgb(49, 93, 168)', '블루 체크 아이콘');
  const d = await db(page);
  eq(d.requests.length, n0 + 1, '연타해도 요청 하나');
  const r = d.requests.find((x) => x.id === rid);
  eq(r.status, 'reviewing', '검토 중'); eq(r.bookingId, undefined, '요청만으로 예약 없음');
  // 새로고침: 저장된 요청을 조회해 같은 내용, 새 요청 없음
  await page.reload();
  await sentHeading(page).waitFor();
  truthy((await sentText(page)).includes('수전 교체'), '새로고침 후 같은 요약');
  eq((await db(page)).requests.length, n0 + 1, '새로고침해도 새 요청 없음');
  // 뒤로가기: 요청서가 아니라 업체 상세(요청서 기록은 완료 화면으로 바뀜) → 앞으로 가도 재제출 없음
  await page.goBack();
  await page.waitForURL((u) => u.pathname === '/providers/p1');
  await page.goForward();
  await sentHeading(page).waitFor();
  eq((await db(page)).requests.length, n0 + 1, '뒤로·앞으로 이동해도 새 요청 없음');
  // 키보드로 ‘요청 내용 확인하기’ → 이 요청의 상세
  await page.getByRole('link', { name: '요청 내용 확인하기' }).focus();
  await page.keyboard.press('Enter');
  await page.waitForURL((u) => u.pathname === `/requests/${rid}`);
  await waitText(page, '업체가 작업 가능 여부와 견적을 확인하고 있어요.'); // 검토 중: 진행 단계 설명(상태 배지는 중복이라 없음)
  eq((await db(page)).requests.length, n0 + 1, '버튼으로 다시 제출되지 않음');
  // 나중에 보낸 요청 목록에서 고르면 완료 화면을 거치지 않고 상세로
  await page.goto(`${BASE}/bookings?tab=requests`);
  await resCount(page);
  await page.locator(`a[href="/requests/${rid}"]`).click();
  await page.waitForURL((u) => u.pathname === `/requests/${rid}`);
  await waitText(page, '업체가 작업 가능 여부와 견적을 확인하고 있어요.'); // 검토 중: 진행 단계 설명(상태 배지는 중복이라 없음)
  eq(await sentHeading(page).count(), 0, '목록에서는 완료 화면 없음');
});

await testCompare('요청 완료: 비교 요청 제출 → ‘N개 업체에 수리 요청을 보냈어요’·대표 작업 외 N건 → 비교 요청 상세', async (page) => {
  const n0 = await submitCompareRequest(page);
  const t = await sentText(page);
  for (const s of ['3개 업체에 수리 요청을 보냈어요', '조명 교체 외 1건', '3개 업체', '한빛설비, 새봄수리, 밝은전기', '아직 예약이 확정된 것은 아니에요.']) truthy(t.includes(s), `비교 요약 ‘${s}’: ${t}`);
  const d = await db(page);
  eq(d.requests.length, n0 + 1, '요청 하나 추가');
  eq(d.requests.at(-1).bundleId, 'b-sink', '같은 비교 묶음');
  await page.getByRole('link', { name: '요청 내용 확인하기' }).click();
  await page.waitForURL((u) => u.pathname === '/requests/bundle/b-sink');
  await waitText(page, '업체별 응답');
  await waitText(page, '밝은전기');
});

await test('요청 완료: 제출 실패 시 작성 화면 유지(완료 화면 없음) · 잘못된 주소는 안내와 보낸 요청 경로 · 검토가 지난 요청은 상세로(반복 없음)', async (page) => {
  await start(page, { path: '/providers/p1/request?new=1&date=2026-10-21', patch: (d) => { d.settings.failNextWrite = true; } });
  await fillNewDateRequest(page, '실패 확인 작업');
  await detailInput(page).fill('301동 1204호');
  const n0 = (await db(page)).requests.length;
  await page.getByRole('button', { name: '요청 보내기' }).click();
  await waitText(page, '입력한 내용은 그대로 있어요');
  eq(new URL(page.url()).pathname, '/providers/p1/request', '작성 화면 유지');
  eq(await sentHeading(page).count(), 0, '완료 화면 없음');
  eq((await db(page)).requests.length, n0, '요청 없음');
  // 없는 요청
  await page.goto(`${BASE}/requests/rq-nope/sent`);
  await waitText(page, '요청 내용을 찾을 수 없어요');
  await page.getByRole('link', { name: '보낸 요청 보기' }).click();
  await page.waitForURL((u) => u.pathname === '/bookings' && u.search.includes('tab=requests'));
  // 이미 승인된 요청 → 상세(비교 요청을 켜면 비교 요청 상세, 데모는 그 요청 상세). 한 번만 이동하고 머문다
  const target = COMPARE ? '/requests/bundle/b-sink' : '/requests/rq-3';
  await page.goto(`${BASE}/requests/rq-3/sent`);
  await page.waitForURL((u) => u.pathname === target);
  await waitText(page, COMPARE ? '업체별 응답' : '예약금 결제');
  await page.waitForTimeout(400);
  eq(new URL(page.url()).pathname, target, '이동 반복 없음');
  eq(await sentHeading(page).count(), 0, '완료 안내 없음');
  eq((await db(page)).requests.length, n0, '조회만으로 요청 생성 없음');
});

await test('요청 확정 안내 위치: 업체 찾기 홈·요청서에는 없음(주소·카테고리·공동 예약 안내 유지, 요청 완료 화면에서만 안내)', async (page) => {
  await start(page, { path: '/' });
  await page.locator('.cat-grid').waitFor();
  const home = await page.locator('main').innerText();
  truthy(!home.includes('요청만으로는 예약이 확정되지 않아요') && !home.includes('예약금을 결제해야 예약이 확정돼요'), '홈 안내 박스 제거');
  truthy(home.includes('지역·건물 주소') && home.includes('어떤 생활 수리가 필요하세요?'), '주소·카테고리 유지');
  eq(await page.locator('main .banner').count(), 0, '홈에 남은 안내 박스 없음');
  // 카테고리 영역 아래 = 본문 아래 여백만(빈 상자 자리 없음)
  const gap = await page.evaluate(() => { const m = document.querySelector('main'); const s = m.querySelector('.stack'); return Math.round(m.getBoundingClientRect().bottom - s.lastElementChild.getBoundingClientRect().bottom - parseFloat(getComputedStyle(m).paddingBottom)); });
  truthy(gap <= 1, `홈 하단 남는 여백 ${gap}px`);
  await page.goto(`${BASE}/providers/p1/request?new=1&date=2026-10-21`);
  await page.getByRole('button', { name: '요청 보내기' }).waitFor();
  eq(await page.getByText('업체 승인 후 예약금을 결제하면 예약이 확정돼요.').count(), 0, '요청서 버튼 근처 안내 문구 없음(다른 곳에도 없음)');
  eq(await page.locator('.action-bar').count(), 0, '하단 고정 버튼 영역 없음');
  eq(await page.locator('main .banner').filter({ hasText: '예약이 확정' }).count(), 0, '큰 배너 아님');
});

for (const w of [360, 1280]) {
  await test(`요청 완료 화면 ${w}px: 잘림·가로 넘침 없음, 과하게 길지 않음(주요 버튼이 첫 화면 안), 공통 헤더·로고 유지`, async (page) => {
    await page.setViewportSize({ width: w, height: 800 });
    await (COMPARE ? submitCompareRequest(page) : submitSingleRequest(page));
    await page.evaluate(() => window.scrollTo(0, 0));
    const r = await page.evaluate(() => {
      const s = document.querySelector('.sent').getBoundingClientRect();
      const btn = [...document.querySelectorAll('.sent a')].find((a) => a.textContent === '요청 내용 확인하기').getBoundingClientRect();
      const tabbar = document.querySelector('.tabbar'); const tb = tabbar && getComputedStyle(tabbar).display !== 'none' ? tabbar.getBoundingClientRect().top : innerHeight;
      const clipped = [...document.querySelectorAll('.sent *')].some((e) => e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflow !== 'visible');
      return { overflow: document.documentElement.scrollWidth > innerWidth, clipped, width: Math.round(s.width), btnBottom: Math.round(btn.bottom), visibleBottom: Math.round(tb), btnH: Math.round(btn.height),
        logo: !!document.querySelector('.app-header__brand'), nav: !!document.querySelector('nav.top-nav') };
    });
    truthy(!r.overflow && !r.clipped && r.width <= 480 && r.btnH >= 44, `배치 ${JSON.stringify(r)}`);
    truthy(r.btnBottom <= r.visibleBottom, `주요 버튼이 첫 화면 안 ${JSON.stringify(r)}`);
    truthy(r.logo && r.nav, '로고·공통 헤더');
    await page.mouse.move(0, 0);
    await page.screenshot({ path: join(ROOT, `e2e/screens/${w}_request_sent.png`) });
  }, { width: w });
}

// ───────── 요청서 작업 선택: 업체 등록 작업 다중 선택 칩 ─────────
const chipNames = (page) => page.locator('.task-pick .svc-chip').allInnerTexts().then((a) => a.map((x) => x.trim()));

await test('작업 선택 칩: 업체별 등록 작업만(순서), 직접 입력·임의 항목 없음, 처음엔 미선택, 체크박스 선택 상태', async (page) => {
  await start(page, { path: '/providers/p1/request?new=1&date=2026-10-21' });
  await page.locator('.task-pick .svc-chip').first().waitFor();
  eq((await chipNames(page)).join('/'), '수전 교체/샤워기 교체/배수 트랩 교체/배수구 막힘 수리/세면대 부속 교체/실리콘 재시공', '한빛설비 작업');
  const main = await page.locator('main').innerText();
  for (const s of ['어떤 작업인가요?', '작업 추가하기', '목록에 없어요', '잘 모르겠어요']) truthy(!main.includes(s), `없음: ${s}`);
  await waitText(page, '업체가 제공하는 작업 중 여러 개 선택할 수 있어요.');
  eq(await page.locator('.task-pick .svc-chip__input:checked').count(), 0, '처음엔 선택 없음');
  eq(await page.locator('[data-task]').count(), 0, '선택 전 작업 카드 없음');
  eq(await taskChip(page, '수전 교체').getAttribute('type'), 'checkbox', '체크박스');
  await page.goto(`${BASE}/providers/p3/request?new=1&date=2026-10-21`);
  await page.locator('.task-pick .svc-chip').first().waitFor();
  eq((await chipNames(page)).join('/'), '조명 교체/스위치 교체/콘센트 교체/센서등 설치/생활 부속품 설치', '밝은전기 작업');
});

await test('작업 선택 칩: 여러 개 선택·해제, 카드는 업체 작업 순서·작업명 제목, 입력이 섞이지 않음, 재선택 시 복원, 해제한 작업은 제출 제외', async (page) => {
  await start(page, { path: '/providers/p1/request?new=1&date=2026-10-21' });
  await pickTask(page, '실리콘 재시공', '욕실 벽 실리콘 들뜸');
  await pickTask(page, '수전 교체', '주방·욕실 수전 각각 교체');
  await taskCard(page, '수전 교체').locator('input[type="file"]').setInputFiles({ name: 'faucet.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('x') });
  eq((await page.locator('[data-task] h3').allInnerTexts()).join('/'), '수전 교체/실리콘 재시공', '업체 작업 순서(고른 순서와 무관)');
  eq(await page.locator('.task-pick .svc-chip__input:checked').count(), 2, '두 개 선택');
  // 수전 교체 해제 → 그 카드만 숨김, 실리콘 재시공 내용은 그대로
  await taskChip(page, '수전 교체').uncheck();
  eq((await page.locator('[data-task] h3').allInnerTexts()).join('/'), '실리콘 재시공', '해제한 작업 카드 숨김');
  eq(await taskCard(page, '실리콘 재시공').getByLabel('자세한 설명').inputValue(), '욕실 벽 실리콘 들뜸', '다른 작업 내용 유지');
  // 키보드로 다시 선택 → 작성 중 내용 복원
  await taskChip(page, '수전 교체').focus();
  await page.keyboard.press('Space');
  eq(await taskChip(page, '수전 교체').isChecked(), true, '키보드 선택');
  eq(await taskCard(page, '수전 교체').getByLabel('자세한 설명').inputValue(), '주방·욕실 수전 각각 교체', '재선택 시 설명 복원');
  await taskCard(page, '수전 교체').getByText('faucet.jpg').waitFor();
  await page.keyboard.press('Space');
  eq(await taskChip(page, '수전 교체').isChecked(), false, '키보드 해제');
  // 제출: 지금 고른 작업(실리콘 재시공)만
  await timeChip(page, '09:00').check();
  await detailInput(page).fill('301동 1204호');
  await page.getByRole('button', { name: '요청 보내기' }).click();
  await page.waitForURL((u) => /\/sent$/.test(u.pathname));
  const rid = new URL(page.url()).pathname.split('/')[2];
  const r = (await db(page)).requests.find((x) => x.id === rid);
  eq(JSON.stringify(r.tasks.map((t) => [t.serviceId, t.title, t.description, t.photoNames])), JSON.stringify([['sv-p1-silicone', '실리콘 재시공', '욕실 벽 실리콘 들뜸', []]]), '해제한 작업은 제외, 작업 ID·당시 작업명 저장');
  eq(r.status, 'reviewing', '업체 검토 그대로(작업 선택으로 확정 없음)');
  truthy((await page.locator('.sent').innerText()).includes('실리콘 재시공'), '완료 화면 요약');
  await openSentDetail(page);
  await waitText(page, '실리콘 재시공'); await waitText(page, '욕실 벽 실리콘 들뜸');
  // 이전 직접 입력 요청도 그대로 표시
  await page.goto(`${BASE}/requests/bundle/b-sink`);
  await waitText(page, '욕실 세면대 수전 교체');
});

await test('작업 선택 칩: 여러 작업 제출 → 요청 상세·비교 요청에 작업명·설명·사진 표시', async (page) => {
  await start(page, { path: '/providers/p1/request?new=1&date=2026-10-21' });
  await pickTask(page, '배수 트랩 교체', '욕실 배수 냄새');
  await pickTask(page, '수전 교체', '주방 수전 누수');
  await taskCard(page, '수전 교체').locator('input[type="file"]').setInputFiles({ name: 'kitchen.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('x') });
  await timeChip(page, '09:00').check();
  await detailInput(page).fill('301동 1204호');
  await page.getByRole('button', { name: '요청 보내기' }).click();
  await sentHeading(page).waitFor();
  truthy((await page.locator('.sent').innerText()).includes('수전 교체 외 1건'), '대표 작업 외 1건');
  await openSentDetail(page);
  await waitText(page, '주방 수전 누수');
  const t = await page.locator('main').innerText();
  for (const s of ['수전 교체', '주방 수전 누수', '배수 트랩 교체', '욕실 배수 냄새', 'kitchen.jpg']) truthy(t.includes(s), `요청 상세 ‘${s}’`);
  const rid = new URL(page.url()).pathname.split('/').pop();
  const b = (await db(page)).requests.find((x) => x.id === rid).bundleId;
  await page.goto(`${BASE}/requests/bundle/${b}`);
  await waitText(page, '수전 교체');
});

await test('작업 선택 칩: 등록 작업이 없는 업체는 안내만(임의 목록 없음)·제출 불가 · 업체가 바뀌면 이전 업체 작업 선택이 남지 않음', async (page) => {
  await start(page, { path: '/providers/p1/request?new=1&date=2026-10-21', patch: (d) => { d.providers.find((p) => p.id === 'p7').services = []; } });
  await pickTask(page, '수전 교체', '이전 업체 작업');
  // 앱 안에서 다른 업체 요청서로 이동(같은 화면 구성) → 선택·작성 내용 초기화, 새 업체 작업만
  await spaGo(page, '/providers/p3/request?new=1&date=2026-10-21');
  await waitText(page, '밝은전기');
  await page.locator('.task-pick .svc-chip').filter({ hasText: '조명 교체' }).waitFor();
  eq(await page.locator('.task-pick .svc-chip__input:checked').count(), 0, '이전 업체 선택 없음');
  eq(await page.locator('[data-task]').count(), 0, '이전 업체 작업 카드 없음');
  truthy(!(await chipNames(page)).includes('수전 교체'), '이전 업체 작업 없음');
  // 등록 작업 없음
  await page.goto(`${BASE}/providers/p7/request?new=1&date=2026-10-21`);
  await waitText(page, '이 업체에 등록된 작업이 없어요');
  eq(await page.locator('.task-pick .svc-chip').count(), 0, '임의 칩 없음');
  truthy(await page.getByRole('button', { name: '요청 보내기' }).isDisabled(), '제출 불가');
});

for (const w of [360, 1280]) {
  await test(`작업 선택 칩 ${w}px: 방문 주소와 같은 흰 카드(중복 제목 없음), 작은 칩(28px·13px·6px 간격)·왼쪽부터 줄바꿈, 선택 전후 너비 같음, 누르는 영역 안 겹침, 긴 이름 넘침 없음, 포커스 표시`, async (page) => {
    await page.emulateMedia({ reducedMotion: 'reduce' }); // 색 전환 없이 최종 색으로 확인
    await page.setViewportSize({ width: w, height: 900 });
    await start(page, { path: '/providers/p1/request?new=1&date=2026-10-21', patch: (d) => { d.providers.find((p) => p.id === 'p1').services.push({ id: 'sv-p1-long', name: '아주 긴 작업 이름 예시: 욕실 세면대 하부 배수관 전체 교체 및 주변 실리콘 재시공 포함 작업' }); } });
    await page.locator('.task-pick .svc-chip').first().waitFor();
    // 글꼴 부분 파일은 새 글자가 처음 보일 때 받아진다 → 작업 카드 글자를 한 번 띄웠다 닫고 글꼴이 준비된 뒤 측정(렌더링 차이 제외)
    await taskChip(page, '수전 교체').check(); await taskChip(page, '배수 트랩 교체').check();
    await page.evaluate(() => document.fonts.ready);
    await taskChip(page, '수전 교체').uncheck(); await taskChip(page, '배수 트랩 교체').uncheck();
    await page.evaluate(() => document.fonts.ready);
    const before = await page.evaluate(() => [...document.querySelectorAll('.task-pick .svc-chip__pill')].map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width * 10) / 10]; }));
    await taskChip(page, '수전 교체').check();
    await taskChip(page, '배수 트랩 교체').check();
    const r = await page.evaluate(() => {
      const card = document.querySelector('.task-pick'); const addr = [...document.querySelectorAll('section .card')].find((c) => c.textContent.includes('도로명·지번 주소'));
      const st = (e) => { const c = getComputedStyle(e); return [c.backgroundColor, c.borderTopWidth, c.borderTopColor, c.borderTopLeftRadius, c.paddingLeft, c.paddingTop]; };
      const cr = card.getBoundingClientRect(); const ar = addr.getBoundingClientRect();
      const pills = [...document.querySelectorAll('.task-pick .svc-chip__pill')]; const pr = pills.map((e) => e.getBoundingClientRect());
      const labels = [...document.querySelectorAll('.task-pick .svc-chip')].map((e) => e.getBoundingClientRect());
      const overlap = labels.some((a, i) => labels.some((b, j) => i < j && a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5));
      const rows = [...new Set(pr.map((x) => Math.round(x.top)))];
      const sameRowGaps = pr.slice(1).map((x, i) => (Math.round(x.top) === Math.round(pr[i].top) ? Math.round(x.left - pr[i].right) : null)).filter((g) => g !== null);
      const rowGap = rows.length > 1 ? Math.round(rows[1] - rows[0] - pr[0].height) : null;
      const sel = pills.find((e) => e.previousElementSibling.checked); const cs = getComputedStyle(sel); const un = getComputedStyle(pills.find((e) => !e.previousElementSibling.checked));
      const long = pills.at(-1).getBoundingClientRect();
      return {
        sameCard: JSON.stringify(st(card)) === JSON.stringify(st(addr)), cardStyle: st(card), sameWidth: Math.round(cr.width) === Math.round(ar.width) && Math.round(cr.left) === Math.round(ar.left),
        dupTitle: [...document.querySelectorAll('main h2, main h3, main legend')].filter((e) => e.textContent.trim() === '어떤 작업이 필요한가요?' && getComputedStyle(e).position !== 'absolute').length,
        sectionTitle: card.closest('section')?.querySelector('h2')?.textContent,
        nested: !!card.querySelector('[data-task]') || !!card.querySelector('.card'), cardsBelow: [...document.querySelectorAll('[data-task]')].every((e) => e.getBoundingClientRect().top >= cr.bottom),
        h: Math.round(pr[0].height), fs: parseFloat(getComputedStyle(pills[0]).fontSize), radius: parseFloat(getComputedStyle(pills[0]).borderTopLeftRadius),
        firstLeft: Math.round(pr[0].left - cr.left), cardPad: parseFloat(getComputedStyle(card).paddingLeft) + parseFloat(getComputedStyle(card).borderLeftWidth),
        rows: rows.length, sameRowGaps, rowGap, overlap,
        selBg: cs.backgroundColor, selColor: cs.color, selBorder: cs.borderTopColor, unBg: un.backgroundColor, unColor: un.color, unBorder: un.borderTopColor,
        icon: sel.querySelector('svg') ? Math.round(sel.querySelector('svg').getBoundingClientRect().width) : 0, unIcon: !!pills.find((e) => !e.previousElementSibling.checked).querySelector('svg'),
        longInside: long.right <= cr.right + 0.5, overflow: document.documentElement.scrollWidth > innerWidth,
        after: pr.map((x) => [Math.round(x.left), Math.round(x.top), Math.round(x.width * 10) / 10]),
      };
    });
    truthy(r.sameCard && r.sameWidth, `방문 주소 카드와 같은 스타일·너비 ${JSON.stringify(r.cardStyle)}`);
    eq(r.dupTitle, 0, '중복 제목 없음'); eq(r.sectionTitle, '작업 내용', '바깥 제목 유지');
    truthy(!r.nested && r.cardsBelow, '작업 카드는 선택 카드 아래(중첩 없음)');
    truthy(r.h >= 28 && r.h <= 30 && r.fs >= 12 && r.fs <= 13 && r.radius >= 14, `작은 타원형 칩 ${JSON.stringify(r)}`);
    eq(r.firstLeft, r.cardPad, '카드 안쪽 여백에서 왼쪽부터');
    truthy(r.sameRowGaps.every((g) => g >= 6 && g <= 8) && (r.rowGap === null || (r.rowGap >= 6 && r.rowGap <= 10)), `칩 간격 ${JSON.stringify([r.sameRowGaps, r.rowGap])}`);
    truthy(r.rows >= 2 && !r.overlap && r.longInside && !r.overflow, `줄바꿈·누르는 영역 안 겹침·긴 이름 넘침 없음 ${JSON.stringify(r)}`);
    truthy(r.selBg === 'rgb(237, 243, 252)' && r.selColor === 'rgb(49, 93, 168)' && r.selBorder === 'rgb(49, 93, 168)' && r.icon === 12 && !r.unIcon, `선택: 연한 블루·블루·12px 체크 ${JSON.stringify(r)}`);
    truthy(r.unBg === 'rgb(255, 255, 255)' && r.unColor === 'rgb(32, 36, 44)' && r.unBorder === 'rgb(201, 206, 214)', `선택 전: 흰 바탕·회색 테두리·차콜 ${JSON.stringify(r)}`);
    truthy(r.after.every(([l, t, wd], i) => Math.abs(l - before[i][0]) <= 1 && t === before[i][1] && Math.abs(wd - before[i][2]) <= 1), `선택해도 칩 너비·위치 그대로(1px 미만 글자 렌더링 차이 허용) ${JSON.stringify([before, r.after])}`);
    // 키보드 포커스 표시(실선, 칩 바깥 2px)
    await taskChip(page, '샤워기 교체').focus();
    await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Tab');
    const f = await page.evaluate(() => { const p = document.activeElement.nextElementSibling; const c = getComputedStyle(p); return { style: c.outlineStyle, width: parseFloat(c.outlineWidth) }; });
    truthy(f.style === 'solid' && f.width >= 2, `포커스 표시 ${JSON.stringify(f)}`);
    await page.locator('.task-pick').screenshot({ path: join(ROOT, `e2e/screens/${w}_task_chips.png`) });
  }, { width: w });
}

// ───────── 요청서 방문 가능한 시간: 정확한 시각 다중 선택 ─────────
const timeNames = (page) => page.locator('.time-pick .svc-chip').allInnerTexts().then((a) => a.map((x) => x.trim()));

await test('방문 가능한 시간: 새 날짜·공동 예약별 선택 가능 시각(1시간 간격), 안내 한 문장, 다중 선택·해제(키보드), 제출 시 정확한 시각 저장 → 상세 표시, 범위 칩 없음', async (page) => {
  await start(page, { path: '/providers/p1/request?group=g1' });
  await page.locator('.time-pick .svc-chip').first().waitFor();
  eq((await timeNames(page)).join(' '), '09:00 10:00 11:00 13:00 14:00 15:00', '공동 예약(g1 09:00–12:00 · 13:00–16:00) 시각');
  const sec = page.locator('section').filter({ has: page.getByRole('heading', { name: '방문 가능한 시간', exact: true }) });
  const st = await sec.innerText();
  truthy(st.includes('방문 가능한 시간을 여러 개 선택하면, 업체가 그중 방문 시간을 제안해요.'), '안내 한 문장');
  for (const s of ['방문받을 수 있는 시각을 선택해 주세요', '업체가 선택한 시각 중 방문 시간을 제안해요', '09:00~12:00', '고객 가능 시간']) truthy(!st.includes(s), `없음: ${s}`);
  eq(await page.getByText('방문 가능한 시간을 여러 개 선택하면, 업체가 그중 방문 시간을 제안해요.').count(), 1, '안내는 한 번만');
  // 다중 선택·해제
  await timeChip(page, '14:00').check();
  await timeChip(page, '09:00').focus(); await page.keyboard.press('Space');
  await timeChip(page, '11:00').check(); await timeChip(page, '11:00').uncheck();
  eq(await page.locator('.time-pick .svc-chip__input:checked').count(), 2, '두 시각 선택');
  await pickTask(page, '수전 교체', '시간 선택 확인');
  await detailInput(page).fill('301동 1204호');
  await page.getByRole('button', { name: '요청 보내기' }).click();
  await page.waitForURL((u) => /\/sent$/.test(u.pathname));
  const rid = new URL(page.url()).pathname.split('/')[2];
  const r = (await db(page)).requests.find((x) => x.id === rid);
  eq(JSON.stringify(r.slots), '["09:00","14:00"]', '고른 정확한 시각(시각 순)');
  eq(r.status, 'reviewing', '시간 선택으로 배정·확정 없음');
  await openSentDetail(page);
  await waitText(page, '09:00, 14:00');
  truthy((await page.locator('main').innerText()).includes('방문 가능한 시간'), '상세 라벨');
  // 새 날짜 요청: 공통 시간대 9개 시각
  await page.goto(`${BASE}/providers/p2/request?new=1&date=2026-10-21`);
  await page.locator('.time-pick .svc-chip').first().waitFor();
  eq((await timeNames(page)).join(' '), '09:00 10:00 11:00 13:00 14:00 15:00 16:00 17:00 18:00', '새 날짜 요청 시각');
});

await test('방문 가능한 시간: 업체 제안은 고른 시각 중 하나만 → 결제로 예약 확정, 과거 범위형 요청은 범위 그대로 표시', async (page) => {
  await start(page, { path: '/providers/p1/request?new=1&date=2026-10-21' });
  await fillNewDateRequest(page, '제안 확인');
  await timeChip(page, '14:00').check();
  await detailInput(page).fill('301동 1204호');
  await page.getByRole('button', { name: '요청 보내기' }).click();
  await page.waitForURL((u) => /\/sent$/.test(u.pathname));
  const rid = new URL(page.url()).pathname.split('/')[2];
  let res = await dev(page, 'approveRequest', rid, '10:00');
  truthy(!res.ok && res.message.includes('고른 방문 가능한 시각(09:00, 14:00) 중 하나여야 해요'), `고르지 않은 시각 제안 거부: ${res.message}`);
  res = await dev(page, 'approveRequest', rid, '14:00');
  truthy(res.ok, '고른 시각으로 승인');
  await page.goto(`${BASE}/requests/${rid}/approval`);
  await waitText(page, '09:00, 14:00');
  eq((await db(page)).requests.find((x) => x.id === rid).bookingId, undefined, '승인만으로 예약 없음');
  // 과거 범위형 요청(rq-3: 직접 입력·범위 시간)은 범위 그대로
  await page.goto(`${BASE}/requests/rq-3`);
  await waitText(page, '방문 가능한 시간');
  const t = await page.locator('main').innerText();
  truthy(/\d{2}:\d{2}~\d{2}:\d{2}/.test(t), `범위 표시 유지: ${t.slice(0, 400)}`);
  truthy(JSON.stringify((await db(page)).requests.find((x) => x.id === 'rq-3').slots).includes('–'), '저장값 범위 그대로');
});

await test('방문 가능한 시간: 미선택 오류는 카드 안 칩 아래·첫 칩으로 이동, 일정이 바뀌어 고른 시각이 사라지면 해제·안내, 선택 가능한 시각이 없으면 안내·제출 불가', async (page) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await start(page, { path: '/providers/p1/request?group=g1' });
  await pickTask(page, '수전 교체', '오류 확인');
  await detailInput(page).fill('301동 1204호');
  await page.getByRole('button', { name: '요청 보내기' }).click();
  await settle(page);
  const fi = await focusInfo(page);
  truthy(fi.target === 'slots' && fi.error === '방문 가능한 시각을 하나 이상 선택해 주세요.' && fi.visible, `첫 오류=첫 시각 칩 ${JSON.stringify(fi)}`);
  const pos = await page.evaluate(() => { const e = document.getElementById('req-slots-err'); const card = e.closest('.card'); const chips = card.querySelector('.svc-chips'); return { inCard: !!card && !!card.querySelector('.time-pick'), below: e.getBoundingClientRect().top >= chips.getBoundingClientRect().bottom }; });
  truthy(pos.inCard && pos.below, `오류 문구는 카드 안 칩 아래 ${JSON.stringify(pos)}`);
  // 일정 변경: 그룹 시간대가 13:00–16:00만 남으면 고른 09:00은 해제·안내
  await timeChip(page, '09:00').check(); await timeChip(page, '13:00').check();
  await page.evaluate(() => { const d = window.__sagoDev.db; d.groups.find((g) => g.id === 'g1').slots = ['13:00–16:00']; window.__sagoDev.setSettings({}); });
  await waitText(page, '선택할 수 없게 된 시각(09:00)은 선택을 해제했어요');
  eq((await timeNames(page)).join(' '), '13:00 14:00 15:00', '바뀐 시각 목록');
  eq(await page.locator('.time-pick .svc-chip__input:checked').count(), 1, '남은 선택 13:00');
  // 선택 가능한 시각 없음
  await page.evaluate(() => { const d = window.__sagoDev.db; d.groups.find((g) => g.id === 'g1').slots = []; window.__sagoDev.setSettings({}); });
  await waitText(page, '지금 선택할 수 있는 방문 시각이 없어요');
  truthy(await page.getByRole('button', { name: '요청 보내기' }).isDisabled(), '제출 불가');
});

for (const w of [360, 1280]) {
  await test(`방문 가능한 시간 ${w}px: 제목은 카드 바깥, 안내·칩·오류는 연락받을 정보와 같은 흰 카드 안, 작은 칩 왼쪽부터 줄바꿈·넘침 없음`, async (page) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: w, height: 900 });
    await start(page, { path: '/providers/p1/request?new=1&date=2026-10-21' });
    await page.locator('.time-pick .svc-chip').first().waitFor();
    await timeChip(page, '10:00').check();
    const r = await page.evaluate(() => {
      const pick = document.querySelector('.time-pick'); const card = pick.closest('.card');
      const contact = [...document.querySelectorAll('section')].find((s) => s.querySelector('h2')?.textContent === '연락받을 정보').querySelector('.card');
      const st = (e) => { const c = getComputedStyle(e); return [c.backgroundColor, c.borderTopWidth, c.borderTopColor, c.borderTopLeftRadius, c.paddingLeft, c.paddingTop]; };
      const cr = card.getBoundingClientRect(); const kr = contact.getBoundingClientRect();
      const h2 = card.closest('section').querySelector('h2');
      const pills = [...pick.querySelectorAll('.svc-chip__pill')].map((e) => e.getBoundingClientRect());
      const hint = pick.querySelector('.time-pick__hint').getBoundingClientRect();
      return {
        sameCard: JSON.stringify(st(card)) === JSON.stringify(st(contact)), sameWidth: Math.round(cr.width) === Math.round(kr.width) && Math.round(cr.left) === Math.round(kr.left),
        titleOutside: h2.textContent === '방문 가능한 시간' && h2.getBoundingClientRect().bottom <= cr.top, fieldsetBorder: getComputedStyle(pick).borderTopWidth,
        h: Math.round(pills[0].height), left: Math.round(pills[0].left - cr.left), pad: parseFloat(getComputedStyle(card).paddingLeft) + 1,
        rows: new Set(pills.map((p) => Math.round(p.top))).size, inside: pills.every((p) => p.right <= cr.right - 1),
        hintGap: Math.round(pills[0].top - hint.bottom), overflow: document.documentElement.scrollWidth > innerWidth,
      };
    });
    truthy(r.sameCard && r.sameWidth && r.titleOutside && r.fieldsetBorder === '0px', `카드 ${JSON.stringify(r)}`);
    truthy(r.h >= 28 && r.h <= 30 && r.left === r.pad && r.inside && !r.overflow && r.hintGap >= 6 && r.hintGap <= 14, `칩·여백 ${JSON.stringify(r)}`);
    if (w === 360) truthy(r.rows >= 2, `모바일 줄바꿈 ${r.rows}`);
    await page.locator('.time-pick').locator('xpath=ancestor::div[contains(@class,"card")][1]').screenshot({ path: join(ROOT, `e2e/screens/${w}_visit_times.png`) });
  }, { width: w });
}

for (const w of [360, 1280]) {
  await test(`요청서 ‘요청 보내기’ ${w}px: 하단 고정 없음(문서 흐름), 마지막 입력 영역 다음 24px, 버튼 아래 본문 여백만, 배경 띠·구분선·안내 문구 없음`, async (page) => {
    await page.setViewportSize({ width: w, height: 800 });
    await start(page, { path: '/providers/p1/request?new=1&date=2026-10-21' });
    const btn = page.getByRole('button', { name: '요청 보내기' });
    await btn.waitFor();
    await page.evaluate(() => window.scrollTo(0, 0));
    const r = await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === '요청 보내기');
      const chain = []; for (let e = b; e && e !== document.body; e = e.parentElement) chain.push(getComputedStyle(e).position);
      const br = b.getBoundingClientRect(); const prev = b.previousElementSibling.getBoundingClientRect();
      const main = document.querySelector('main'); const mr = main.getBoundingClientRect();
      const parent = getComputedStyle(b.parentElement);
      return {
        pinned: chain.some((p) => p === 'fixed' || p === 'sticky'), parentIsForm: b.parentElement.tagName === 'FORM',
        gap: Math.round(br.top - prev.bottom), below: Math.round(mr.bottom - br.bottom), mainPad: parseFloat(getComputedStyle(main).paddingBottom),
        offscreenAtTop: br.top > innerHeight, width: Math.round(br.width), formWidth: Math.round(b.parentElement.getBoundingClientRect().width),
        parentBg: parent.backgroundColor, parentBorder: parent.borderTopWidth, parentShadow: parent.boxShadow, bg: getComputedStyle(b).backgroundColor,
      };
    });
    truthy(!r.pinned && r.parentIsForm && r.offscreenAtTop, `고정 아님(처음 화면에 떠 있지 않음) ${JSON.stringify(r)}`);
    eq(r.gap, 24, '마지막 입력 영역과 24px');
    eq(r.below, r.mainPad, '버튼 아래는 본문 아래 여백만(보정 공간 없음)');
    truthy(r.width === r.formWidth && r.bg === 'rgb(49, 93, 168)', `본문 너비·블루 ${JSON.stringify(r)}`);
    truthy(r.parentBg === 'rgba(0, 0, 0, 0)' && r.parentBorder === '0px' && r.parentShadow === 'none', `배경 띠·구분선·그림자 없음 ${JSON.stringify(r)}`);
    eq(await page.locator('.action-bar, .action-bar__note').count(), 0, '하단 바·안내 문구 없음');
    eq(await page.getByText('업체 승인 후 예약금을 결제하면 예약이 확정돼요.').count(), 0, '안내 문구 없음');
    // 끝까지 스크롤하면 버튼이 마지막 입력 영역 아래에 보이고, 입력 내용과 겹치지 않는다 → 제출 동작
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await fillNewDateRequest(page, '고정 해제 확인');
    await detailInput(page).fill('301동 1204호');
    await btn.click();
    await sentHeading(page).waitFor();
  }, { width: w });
}

await test('내 예약 통합: 탭별 필터·목록 위치가 독립적으로 유지된다', async (page) => {
  await page.setViewportSize({ width: 390, height: 600 });
  await start(page, { path: '/bookings?tab=active' });
  await resCount(page);
  await page.evaluate(() => window.scrollTo(0, 500));
  await page.waitForTimeout(250);
  const yActive = await page.evaluate(() => window.scrollY);
  truthy(yActive > 300, `확정된 예약 스크롤 ${yActive}`);
  // 탭은 헤더 아래에 붙어 있어 스크롤한 채로 바로 누를 수 있다
  const tb = await page.locator('[role=tablist]').boundingBox();
  truthy(tb.y >= 53 && tb.y <= 64, `탭이 헤더 아래 고정(${tb.y})`); // 헤더 52 + 1 + 띠 여백 8
  await openTab(page, '보낸 요청');
  await page.waitForTimeout(300);
  eq(await page.evaluate(() => window.scrollY), 0, '처음 연 보낸 요청은 맨 위');
  await page.evaluate(() => window.scrollTo(0, 240));
  await page.waitForTimeout(250);
  const ySent = await page.evaluate(() => window.scrollY);
  await openTab(page, '확정된 예약');
  await page.waitForTimeout(400);
  truthy(Math.abs((await page.evaluate(() => window.scrollY)) - yActive) < 40, '확정된 예약으로 돌아오면 그 위치');
  await openTab(page, '보낸 요청');
  await page.waitForTimeout(400);
  truthy(Math.abs((await page.evaluate(() => window.scrollY)) - ySent) < 40, '보낸 요청으로 돌아오면 그 위치');
  await page.evaluate(() => window.scrollTo(0, 0));
  // 필터 독립: 보낸 요청 조건이 확정된 예약 조건에 영향 없음
  await openTab(page, '보낸 요청');
  await pickStatus(page, '요청 취소');
  await openTab(page, '확정된 예약');
  eq((await bkStatus(page).innerText()).trim(), '상태', '확정된 예약 조건은 기본');
  await openTab(page, '보낸 요청');
  await statusBtn(page).filter({ hasText: '요청 취소' }).waitFor();
});

for (const w of [360, 1280, 320, 200]) {
  await test(`내 예약 밑줄형 탭: ${w}px${w <= 320 ? '(확대·좁은 화면)' : ''} — 배경 없음·선택 밑줄(3px, 구분선과 겹침)·굵기·색, 카드 너비 구분선, 전환 시 움직임 없음, 잘림·가로 넘침 없음, 필터 간격`, async (page) => {
    await page.setViewportSize({ width: w, height: 800 });
    await start(page, { path: '/bookings?tab=active' });
    await resCount(page);
    const measure = () => page.evaluate(() => {
      const list = document.querySelector('[role=tablist]'); const lr = list.getBoundingClientRect(); const lc = getComputedStyle(list);
      const tabs = [...list.querySelectorAll('[role=tab]')];
      const rects = tabs.map((t) => t.getBoundingClientRect());
      const sel = tabs.find((t) => t.getAttribute('aria-selected') === 'true'); const other = tabs.find((t) => t !== sel);
      const cs = getComputedStyle(sel), co = getComputedStyle(other);
      const ul = getComputedStyle(sel, '::after'), ulo = getComputedStyle(other, '::after');
      const filter = document.querySelector('.filter-bar').getBoundingClientRect();
      const card = document.querySelector('#res-panel ul.request-list > li > a, #res-panel ul.booking-list > li > a')?.getBoundingClientRect();
      const main = document.querySelector('main .stack').getBoundingClientRect();
      return {
        overflow: document.documentElement.scrollWidth > innerWidth,
        clipped: tabs.some((t) => t.scrollWidth > t.clientWidth + 1 || t.scrollHeight > t.clientHeight + 1),
        oneRow: rects.every((x) => Math.abs(x.top - rects[0].top) < 1),
        sameWidth: rects.every((x) => Math.abs(x.width - rects[0].width) < 1),
        inView: lr.left >= 0 && lr.right <= innerWidth + .5,
        width: Math.round(lr.width), mainWidth: Math.round(main.width), cardWidth: card ? Math.round(card.width) : null, left: Math.round(lr.left - main.left),
        listBg: lc.backgroundColor, listRadius: parseFloat(lc.borderTopLeftRadius), divider: lc.boxShadow,
        tabBg: [cs.backgroundColor, co.backgroundColor], tabShadow: [cs.boxShadow, co.boxShadow], tabRadius: parseFloat(co.borderTopLeftRadius),
        tallTabs: rects.every((x) => x.height >= 44),
        ulH: parseFloat(ul.height), ulColor: ul.backgroundColor, ulOther: ulo.backgroundColor, ulW: Math.round(parseFloat(ul.width)), selW: Math.round(sel.getBoundingClientRect().width),
        ulBottom: Math.round(sel.getBoundingClientRect().bottom), listBottom: Math.round(lr.bottom),
        selWeight: Number(cs.fontWeight), otherWeight: Number(co.fontWeight), selColor: cs.color, otherColor: co.color,
        gapToFilter: Math.round(filter.top - lr.bottom), gaps: rects.slice(1).map((x, i) => Math.round(x.left - rects[i].right)),
        rects: rects.map((x) => [Math.round(x.left - lr.left), Math.round(x.top), Math.round(x.width), Math.round(x.height)]), listH: Math.round(lr.height), exact: rects.map((x) => [x.left - lr.left, x.top, x.width, x.height]),
      };
    });
    const r = await measure();
    truthy(!r.overflow && !r.clipped && r.oneRow && r.inView && r.tallTabs, `배치 ${JSON.stringify(r)}`);
    truthy(r.listBg === 'rgba(0, 0, 0, 0)' && r.listRadius === 0 && r.tabBg.every((b) => b === 'rgba(0, 0, 0, 0)') && r.tabShadow.every((s) => s === 'none') && r.tabRadius === 0, `배경·그림자·둥근 모양 없음 ${JSON.stringify(r)}`);
    truthy(/rgb\(228, 230, 234\).*inset|inset.*rgb\(228, 230, 234\)/.test(r.divider) && r.width === r.mainWidth, `1px 회색 구분선이 본문(카드) 너비 ${JSON.stringify(r)}`);
    if (r.cardWidth) eq(r.width, r.cardWidth, '탭 영역 = 목록 카드 너비');
    eq(r.ulH, 3, '밑줄 3px'); eq(r.ulColor, 'rgb(49, 93, 168)', '밑줄 브랜드 블루'); eq(r.ulOther, 'rgba(0, 0, 0, 0)', '비선택 밑줄 없음');
    eq(r.ulW, r.selW, '밑줄 = 선택 탭 누르는 영역 너비'); eq(r.ulBottom, r.listBottom, '밑줄이 구분선과 같은 위치');
    eq(r.selWeight, 600, '선택 600'); eq(r.otherWeight, 500, '비선택 500');
    eq(r.selColor, 'rgb(49, 93, 168)', '선택 블루'); eq(r.otherColor, 'rgb(96, 103, 115)', '비선택 보조 회색');
    truthy(r.gapToFilter >= 20 && r.gapToFilter <= 24, `필터까지 ${r.gapToFilter}px`);
    if (w >= 360) eq(r.rects.every(([, , , h]) => h === 48), true, `평소 너비에서는 한 줄 48px(${JSON.stringify(r.rects)})`);
    if (w < 600) truthy(r.sameWidth && r.width === r.mainWidth, `모바일: 세 칸 같은 너비·본문 너비 ${JSON.stringify(r)}`);
    if (w === 1280) {
      truthy(r.left === 0 && r.gaps.every((g) => g >= 16 && g <= 24) && r.rects[2][0] + r.rects[2][2] - r.rects[0][0] < r.mainWidth * 0.7, `데스크톱: 왼쪽부터 자연스러운 너비·사이 16~24px ${JSON.stringify(r)}`);
      truthy(r.rects.every(([, , wd]) => wd >= 80 && wd <= 140), `데스크톱 탭 너비(패딩 16px) ${JSON.stringify(r.rects)}`);
    }
    if (w === 360) {
      eq(await page.locator('.tabbar li').count(), 3, '하단 메뉴 3개');
      eq(await page.locator('.tabbar').getByRole('link', { name: '내 예약' }).getAttribute('aria-current'), 'page', '하단 메뉴 내 예약 활성');
    }
    // 전환 시 레이아웃 움직임 없음: 탭 위치·크기와 목록 높이가 그대로
    for (const name of ['완료·취소', '보낸 요청', '확정된 예약']) {
      await openTab(page, name);
      const r2 = await measure();
      // 0.5px 미만(글자 렌더링 소수점 차이)은 눈에 보이지 않으므로 허용
      truthy(r2.listH === r.listH && r2.exact.every((x, i) => x.every((v, j) => Math.abs(v - r.exact[i][j]) < 0.5)), `${name} 선택 후 탭 위치·크기·높이 동일 ${JSON.stringify([r.exact, r2.exact])}`);
    }
    // hover: 선택과 헷갈리지 않음(밑줄·블루·굵기 없음)
    await resTab(page, '완료·취소').hover();
    const h = await resTab(page, '완료·취소').evaluate((t) => { const c = getComputedStyle(t); return { ul: getComputedStyle(t, '::after').backgroundColor, color: c.color, weight: Number(c.fontWeight) }; });
    truthy(h.ul === 'rgba(0, 0, 0, 0)' && h.color !== 'rgb(49, 93, 168)' && h.weight === 500, `hover 은은 ${JSON.stringify(h)}`);
    // 키보드 포커스 표시: 실선, 버튼 안쪽(잘리지 않음)
    await resTab(page, '확정된 예약').focus();
    await page.keyboard.press('ArrowLeft');
    await page.waitForURL((u) => u.search.includes('tab=requests'));
    await page.locator('[role=tab][aria-selected=true]', { hasText: '보낸 요청' }).waitFor();
    const f = await page.evaluate(() => {
      const a = document.activeElement; const cs = getComputedStyle(a);
      return { text: a.textContent, selected: a.getAttribute('aria-selected'), style: cs.outlineStyle, width: parseFloat(cs.outlineWidth), offset: parseFloat(cs.outlineOffset) };
    });
    truthy(f.text === '보낸 요청' && f.selected === 'true' && f.style === 'solid' && f.width >= 2 && f.offset <= -f.width, `포커스 표시 ${JSON.stringify(f)}`);
    await resCount(page);
    truthy((await hrefs(page)).length > 0, '보낸 요청 목록 표시');
    if (w === 360 || w === 1280) { await page.mouse.move(5, 400); await page.waitForTimeout(250); await page.screenshot({ path: join(ROOT, `e2e/screens/${w}_reservations_tabs.png`) }); }
    // 새로고침·뒤로가기에도 선택 유지
    await page.reload(); await resCount(page);
    eq(await resTab(page, '보낸 요청').getAttribute('aria-selected'), 'true', '새로고침 후 선택 유지');
    await page.goto(`${BASE}/bookings?tab=past`); await resCount(page);
    eq(await resTab(page, '완료·취소').getAttribute('aria-selected'), 'true', '직접 URL 접근 선택');
    await page.goBack(); await resCount(page);
    eq(await resTab(page, '보낸 요청').getAttribute('aria-selected'), 'true', '뒤로가기 후 선택 유지');
  }, { width: w });
}

// ───────── 상단 메뉴: 업체 찾기 앞 홈 아이콘 ─────────
const homeLink = (page) => page.locator('nav.top-nav').getByRole('link', { name: '업체 찾기 홈으로 이동', exact: true });

await test('상단 메뉴 홈 아이콘: 주요 화면 공통·접근성 이름·아이콘 장식·크기·간격·색, 이동과 활성 표시, 뒤로가기·제목 유지', async (page) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await start(page, { path: '/' });
  for (const [p, title] of [['/', null], ['/bookings?tab=requests', null], ['/requests/rq-3', '요청 상세'], ...(COMPARE ? [['/requests/bundle/b-sink', '비교 요청']] : []), ['/bookings/bk-k2', '예약 상세'], ['/me', null]]) {
    await page.goto(`${BASE}${p}`);
    await homeLink(page).waitFor();
    const r = await homeLink(page).evaluate((a) => {
      const svg = a.querySelector('svg'); const span = a.querySelector('span');
      const sr = svg.getBoundingClientRect(); const tr = span.getBoundingClientRect();
      return { text: a.textContent.trim(), hidden: svg.getAttribute('aria-hidden'), size: Math.round(sr.width), gap: Math.round(tr.left - sr.right), iconFirst: sr.right <= tr.left,
        iconColor: getComputedStyle(svg).stroke, color: getComputedStyle(a).color, current: a.getAttribute('aria-current'), href: a.getAttribute('href') };
    });
    eq(r.text, '업체 찾기', `${p} 텍스트 유지`);
    truthy(r.hidden === 'true' && r.iconFirst && r.size >= 18 && r.size <= 20 && r.gap >= 6 && r.gap <= 8, `${p} 아이콘(장식·앞·18~20px·간격 6~8px) ${JSON.stringify(r)}`);
    eq(r.iconColor, r.color, `${p} 아이콘 색 = 메뉴 색`);
    eq(r.href, '/', `${p} 업체 찾기로`);
    eq(r.current, p === '/' ? 'page' : null, `${p} 활성 표시`);
    eq((await page.locator('nav.top-nav a').allInnerTexts()).map((x) => x.trim()).join('/'), '업체 찾기/내 예약/내 정보', `${p} 메뉴 3개`);
    eq(await page.locator('nav.top-nav').getByRole('link', { name: '내 예약' }).getAttribute('aria-current'), p === '/' || p === '/me' ? null : 'page', `${p} 내 예약 활성`);
    if (title) {
      eq((await page.locator('.app-header__title').innerText()).trim(), title, `${p} 제목 유지`);
      eq(await page.locator('.app-header').getByRole('link', { name: '뒤로 가기' }).or(page.locator('.app-header').getByRole('button', { name: '뒤로 가기' })).count(), 1, `${p} 뒤로가기 유지`);
    }
  }
  // 활성 상태 색: 업체 찾기 화면에서 아이콘도 활성 색
  await page.goto(`${BASE}/`);
  const active = await homeLink(page).evaluate((a) => ({ c: getComputedStyle(a).color, s: getComputedStyle(a.querySelector('svg')).stroke }));
  eq(active.s, active.c, '활성 상태에서도 아이콘 색 = 메뉴 색');
  // 요청 상세·비교 요청에서 눌러 업체 찾기로
  for (const p of ['/requests/rq-3', ...(COMPARE ? ['/requests/bundle/b-sink'] : [])]) {
    await page.goto(`${BASE}${p}`);
    await homeLink(page).click();
    await page.waitForURL((u) => u.pathname === '/');
    await waitText(page, '어떤 생활 수리가 필요하세요?');
    eq(await homeLink(page).getAttribute('aria-current'), 'page', `${p} → 업체 찾기 활성`);
  }
  // 키보드
  await page.goto(`${BASE}/requests/rq-3`);
  await homeLink(page).focus();
  await page.keyboard.press('Enter');
  await page.waitForURL((u) => u.pathname === '/');
});

for (const w of [768, 1024, 390]) {
  await test(`상단 메뉴 홈 아이콘: ${w}px 배치 — 제목·뒤로가기·메뉴 겹침·잘림 없음`, async (page) => {
    await page.setViewportSize({ width: w, height: 800 });
    await start(page, { path: '/' });
    for (const p of ['/', '/requests/rq-3', ...(COMPARE ? ['/requests/bundle/b-sink'] : []), '/bookings/bk-k9']) {
      await page.goto(`${BASE}${p}`);
      await page.locator('.app-header').waitFor();
      const r = await page.evaluate(() => {
        const nav = document.querySelector('nav.top-nav'); const shown = getComputedStyle(nav).display !== 'none';
        const links = [...nav.querySelectorAll('a')].map((a) => a.getBoundingClientRect());
        const title = document.querySelector('.app-header__title, .app-header__brand')?.getBoundingClientRect();
        const back = document.querySelector('.app-header .icon-btn')?.getBoundingClientRect();
        return {
          shown, overflow: document.documentElement.scrollWidth > innerWidth,
          oneLine: links.every((l) => l.height < 48), inView: links.every((l) => l.right <= innerWidth + .5 && l.left >= -.5),
          noOverlapTitle: !shown || !title || title.right <= links[0].left + .5, noOverlapBack: !shown || !back || back.right <= links[0].left + .5,
          linksApart: links.every((l, i) => i === 0 || links[i - 1].right <= l.left + .5),
        };
      });
      truthy(!r.overflow, `${p} 가로 넘침`);
      if (w >= 768) truthy(r.shown && r.oneLine && r.inView && r.noOverlapTitle && r.noOverlapBack && r.linksApart, `${p} 상단 메뉴 배치 ${JSON.stringify(r)}`);
      else eq(r.shown, false, '모바일은 상단 메뉴 대신 하단 탭(기존)');
    }
    if (w === 768) { await page.goto(`${BASE}${COMPARE ? '/requests/bundle/b-sink' : '/requests/rq-3'}`); await page.locator(COMPARE ? '.resp-card' : '#pay').first().waitFor(); await page.screenshot({ path: join(ROOT, 'e2e/screens/768_topnav_home.png'), clip: { x: 0, y: 0, width: 768, height: 120 } }); }
  }, { width: w });
}

// ───────── 탐색 주소 공유(업체 찾기 ↔ 카테고리별 업체 목록) ─────────
const region = (page) => page.locator('.region-card');
const regionText = async (page) => (await region(page).innerText()).replace(/\s+/g, ' ').trim();
/** 업체 목록의 공동 예약 배지 문구(업체 순서대로) */
const jointBadges = (page) => page.locator('ul[aria-label="업체 목록"] .badge').allInnerTexts();
async function pickAddress(page, label) {
  await page.locator('ul[aria-label="검색 결과"] .list-row__title', { hasText: new RegExp(`^${label}$`) }).click();
}

await test('탐색 주소: 업체 찾기에서 고른 주소가 카테고리 목록 ‘현재 조회 지역’에 실제 값으로 표시(업체 찾기와 일치)', async (page) => {
  await start(page, { path: '/', address: null, patch: (db) => { db.exploreAddressId = null; } });
  await page.getByRole('link', { name: '지역·건물 주소 설정하기' }).click();
  await pickAddress(page, '햇살마을 3단지');
  await waitText(page, '서울 가상구 햇살로 100 (햇살마을 3단지)');
  const home = await page.locator('.explore-address').innerText();
  await page.locator('a.cat-card').nth(1).click();
  await region(page).getByText('햇살마을 3단지', { exact: true }).waitFor();
  const t = await regionText(page);
  truthy(t.includes('현재 조회 지역') && t.includes('햇살마을 3단지') && t.includes('서울 가상구 햇살로 100 (햇살마을 3단지)'), t);
  truthy(!t.includes('설정한 지역·건물 주소') && !/301동|1204호/.test(t), `안내 문구·상세 주소 노출: ${t}`);
  for (const line of home.split('\n').filter((l) => l && l !== '변경')) truthy(t.includes(line), `업체 찾기와 다름: ${line}`);
});

await test('탐색 주소: 업체 목록에서 변경 → 목록·업체 찾기 함께 반영, 카테고리 유지·다시 조회, 요청·예약 주소는 그대로', async (page) => {
  await start(page, { path: '/providers?category=c2' });
  await region(page).getByText('햇살마을 3단지', { exact: true }).waitFor();
  const before = await db(page);
  truthy((await jointBadges(page)).includes('공동 예약 후보'), '변경 전 공동 예약 후보');
  await region(page).getByRole('link', { name: '변경' }).click();
  await page.waitForURL((u) => u.pathname === '/address');
  await pickAddress(page, '먼바다로 빌라');
  await page.waitForURL((u) => u.pathname === '/providers' && u.searchParams.get('category') === 'c2');
  await region(page).getByText('먼바다로 빌라', { exact: true }).waitFor();
  truthy((await regionText(page)).includes('서울 가상구 먼바다로 77 (빌라)'), '새 기본 주소');
  const badges = await jointBadges(page);
  truthy(badges.length > 0 && !badges.includes('공동 예약 후보'), `이전 주소 결과가 남음: ${badges}`);
  truthy(!(await page.getByText('가까운 공동 날짜').count()), '이전 주소의 공동 날짜');
  await page.goto(`${BASE}/`);
  await page.locator('.explore-address').getByText('먼바다로 빌라').waitFor();
  const after = await db(page);
  eq(after.exploreAddressId, 'ad-far', '저장된 탐색 주소');
  eq(JSON.stringify(after.requests.map((r) => [r.id, r.addressId, r.visitAddress])), JSON.stringify(before.requests.map((r) => [r.id, r.addressId, r.visitAddress])), '요청 방문 주소');
  eq(JSON.stringify(after.bookings.map((b) => [b.id, b.addressId, b.visitAddress])), JSON.stringify(before.bookings.map((b) => [b.id, b.addressId, b.visitAddress])), '예약 방문 주소');
  eq(JSON.stringify(after.savedVisitAddress), JSON.stringify(before.savedVisitAddress), '재사용 상세 주소');
});

await test('탐색 주소: 변경 취소(뒤로)·브라우저 뒤로가기·카테고리 전환·새로고침에도 같은 주소', async (page) => {
  await start(page, { path: '/providers?category=c2', address: 'ad-apt2' });
  await region(page).getByText('푸른숲 2단지', { exact: true }).waitFor();
  // 변경 화면에서 고르지 않고 돌아오면 기존 주소 유지
  await region(page).getByRole('link', { name: '변경' }).click();
  await page.waitForURL((u) => u.pathname === '/address');
  await page.getByRole('link', { name: /뒤로/ }).first().click();
  await page.waitForURL((u) => u.pathname === '/providers');
  await region(page).getByText('푸른숲 2단지', { exact: true }).waitFor();
  await region(page).getByRole('link', { name: '변경' }).click();
  await page.waitForURL((u) => u.pathname === '/address');
  await page.goBack();
  await region(page).getByText('푸른숲 2단지', { exact: true }).waitFor();
  // 업체 찾기로 뒤로 → 다른 카테고리
  await page.goto(`${BASE}/`);
  await page.locator('.explore-address').getByText('푸른숲 2단지', { exact: true }).waitFor();
  await page.locator('a.cat-card').nth(4).click();
  await region(page).getByText('푸른숲 2단지', { exact: true }).waitFor();
  await page.goBack();
  await page.locator('.explore-address').getByText('푸른숲 2단지', { exact: true }).waitFor();
  await page.goForward();
  await region(page).getByText('푸른숲 2단지', { exact: true }).waitFor();
  await page.reload();
  await region(page).getByText('푸른숲 2단지', { exact: true }).waitFor();
  eq((await db(page)).exploreAddressId !== undefined, true, '저장소 유지');
});

await test('탐색 주소: 빠르게 연속 변경해도 마지막 주소 결과만 표시(이전 주소 결과가 덮어쓰지 않음)', async (page) => {
  // 기준: 처음부터 먼바다로 빌라(공동 예약 후보 없음)로 연 결과
  await start(page, { path: '/providers?category=c2', address: 'ad-far' });
  await region(page).getByText('먼바다로 빌라', { exact: true }).waitFor();
  await page.locator('ul[aria-label="업체 목록"]').waitFor();
  const expected = await jointBadges(page);
  truthy(!expected.includes('공동 예약 후보'), `기준 주소에 후보가 있으면 점검이 약해짐: ${expected}`);
  // 응답을 느리게 하고(900ms) 응답이 오기 전에 연달아 바꾼다: 햇살마을(후보 있음) → 달빛길(후보 있음) → 먼바다로 빌라
  await start(page, { path: '/providers?category=c2', address: 'ad-apt', latency: 900 });
  await region(page).getByText('햇살마을 3단지', { exact: true }).waitFor();
  const seen = [];
  const sample = setInterval(() => { regionText(page).then((t) => jointBadges(page).then((b) => seen.push([t, b.join('|')]))).catch(() => {}); }, 50);
  for (const label of ['달빛길 단독주택', '먼바다로 빌라']) {
    await region(page).getByRole('link', { name: '변경' }).click();
    await page.waitForURL((u) => u.pathname === '/address');
    await pickAddress(page, label);
    await page.waitForURL((u) => u.pathname === '/providers');
  }
  await region(page).getByText('먼바다로 빌라', { exact: true }).waitFor();
  await page.locator('ul[aria-label="업체 목록"]').waitFor();
  await page.waitForTimeout(2000); // 늦게 오는 이전 주소의 응답이 있어도
  clearInterval(sample);
  eq(JSON.stringify(await jointBadges(page)), JSON.stringify(expected), '최종 목록이 마지막 주소 기준');
  // ‘먼바다로 빌라’가 표시된 순간에 이전 주소의 ‘공동 예약 후보’가 함께 보인 적이 없어야 한다
  const mixed = seen.filter(([t, b]) => t.includes('먼바다로 빌라') && b.includes('공동 예약 후보'));
  truthy(seen.some(([t]) => t.includes('먼바다로 빌라')), '표본 수집');
  truthy(!mixed.length, `이전 주소 결과가 새 주소와 함께 보임: ${JSON.stringify(mixed[0])}`);
});

await test('탐색 주소: 미설정이면 설정 안내·버튼(임의 기본 주소로 대체하지 않음)', async (page) => {
  await start(page, { path: '/providers?category=c2', address: null, patch: (db) => { db.exploreAddressId = null; } });
  await region(page).getByText('조회할 지역·건물 주소를 설정해주세요').waitFor();
  const t = await regionText(page);
  truthy(!/햇살|달빛|푸른숲|가상구/.test(t), `기본 주소로 대체됨: ${t}`);
  await page.locator('ul[aria-label="업체 목록"]').waitFor();
  const badges = await jointBadges(page);
  truthy(badges.every((b) => b === '지역·건물 주소를 정하면 확인할 수 있어요'), `미설정 배지: ${badges}`);
  await region(page).getByRole('link', { name: '설정' }).click();
  await page.waitForURL((u) => u.pathname === '/address' && u.searchParams.get('back') === '/providers?category=c2');
});

await test('탐색 주소: 불러오는 중에는 로딩 표시(안내 문구·목록을 실제 주소처럼 보여주지 않음)', async (page) => {
  await start(page, { path: '/', latency: 1500 });
  await page.goto(`${BASE}/providers?category=c2`);
  await page.locator('.region-card[aria-busy="true"]').waitFor();
  const t = await regionText(page);
  truthy(!/설정한 지역|햇살|설정해주세요/.test(t), `로딩 중 문구: ${t}`);
  eq(await page.locator('ul[aria-label="업체 목록"]').count(), 0, '로딩 중 목록');
  await region(page).getByText('햇살마을 3단지', { exact: true }).waitFor({ timeout: 8000 });
  await page.locator('ul[aria-label="업체 목록"]').waitFor({ timeout: 8000 });
});

await test('탐색 주소: 주소를 확인하지 못하면 오류 안내·다시 시도·변경, 공동 예약 가능 여부를 단정하지 않음', async (page) => {
  await start(page, { path: '/providers?category=c2', address: 'ad-gone' });
  await region(page).getByText('주소를 확인하지 못했어요').waitFor();
  await waitText(page, '주소를 확인하지 못해 공동 예약 참여 가능 여부를 알 수 없어요');
  const badges = await jointBadges(page);
  truthy(badges.length > 0 && badges.every((b) => b === '공동 예약 가능 여부 확인 필요'), `오류 시 배지: ${badges}`);
  truthy(!(await page.getByText('가까운 공동 날짜').count()), '오류 시 공동 날짜 표시');
  truthy(await region(page).getByRole('button', { name: '다시 시도' }).isVisible(), '다시 시도');
  truthy(await region(page).getByRole('link', { name: '변경' }).isVisible(), '변경');
});

await test('탐색 주소: 모바일(360px) 긴 주소 줄바꿈 · 버튼과 겹치지 않음', async (page) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await start(page, { path: '/providers?category=c2', patch: (db) => { const a = db.addressBook.find((x) => x.id === 'ad-apt'); a.label = '햇살마을 3단지 행복한우리집아파트 주민공동시설동'; a.line1 = '서울특별시 가상구 아주아주긴도로명햇살로123번길 100-25 (햇살마을 3단지 행복한우리집아파트)'; } });
  await region(page).getByText('주민공동시설동', { exact: false }).waitFor();
  const r = await page.evaluate(() => {
    const card = document.querySelector('.region-card'); const text = card.querySelector('.grow').getBoundingClientRect(); const btn = card.querySelector('.region-card__actions').getBoundingClientRect(); const c = card.getBoundingClientRect();
    return { overlap: text.right > btn.left + 0.5 && text.bottom > btn.top && text.top < btn.bottom, inside: btn.right <= c.right + 0.5 && text.left >= c.left, over: document.documentElement.scrollWidth > innerWidth, lines: Math.round(card.querySelector('.grow .strong').getBoundingClientRect().height / 20) };
  });
  truthy(!r.overlap && r.inside && !r.over, `겹침·넘침 ${JSON.stringify(r)}`);
  truthy(r.lines >= 2, `긴 주소가 줄바꿈되지 않음 ${JSON.stringify(r)}`);
  await page.screenshot({ path: join(ROOT, 'e2e/screens/360_region_long_address.png') });
});

// ───────── 로그인 없는 데모 ─────────
const pathOf = (page) => new URL(page.url()).pathname;
const AUTH_WORDS = /로그인|로그아웃|회원가입|비밀번호/;
const ROUTES_FOR_AUTH_SCAN = ['/', '/address', '/providers?category=c2', '/providers/p1', '/providers/p1/request?group=g1', '/requests', '/requests/rq-3', '/requests/rq-3/approval', '/bookings', '/bookings?tab=past', '/bookings/bk-k2', '/bookings/bk-k2/cancel', '/bookings/bk-k9', '/ledger', '/me', '/guide', '/없는화면'];

await test('로그인 없는 데모: 첫 접속은 바로 업체 찾기(로그인 화면·대기 없음)', async (page) => {
  await page.goto(`${BASE}/`);
  await waitText(page, '이웃과 같은 업체·같은 날 예약하고 출장비를 나눠 내요.');
  eq(pathOf(page), '/', '첫 화면');
  eq(await page.locator('.boot, [aria-busy="true"] .btn__spin').count(), 0, '세션 확인 대기 화면 없음');
  truthy(!AUTH_WORDS.test(await page.locator('body').innerText()), '로그인 관련 문구');
});

await test('로그인 없는 데모: 내부 화면 직접 접근·새로고침 정상(내 예약 세 탭·내 정보·상세, 이전 내 요청 주소)', async (page) => {
  await start(page, { path: '/' });
  for (const [p, text] of [['/bookings?tab=requests', '예약금 결제'], ['/bookings?tab=active', '방문 예정'], ['/bookings?tab=past', '이용 완료'], ['/me', '내역·안내'], ['/bookings/bk-k2', '공동 예약 정보'], ['/requests/rq-3', '업체가 제안한 방문 시각']]) {
    await page.goto(`${BASE}${p}`);
    await waitText(page, text);
    eq(pathOf(page) + (p.includes('?') ? new URL(page.url()).search : ''), p, `${p} 직접 접근`);
    await page.reload();
    await waitText(page, text);
    eq(pathOf(page) + (p.includes('?') ? new URL(page.url()).search : ''), p, `${p} 새로고침`);
  }
  // 이전 내 요청 목록 주소 → 보낸 요청 탭
  await page.goto(`${BASE}/requests`);
  await page.waitForURL((u) => u.pathname === '/bookings' && u.search === '?tab=requests');
  eq(await page.getByRole('tab', { name: '보낸 요청' }).getAttribute('aria-selected'), 'true', '이전 주소 → 보낸 요청 탭');
});

await test('로그인 없는 데모: 이전 인증 주소는 업체 찾기로 이동', async (page) => {
  await start(page, { path: '/' });
  for (const p of ['/login', '/signup', '/signup/done', '/password/reset', '/password/reset/sent', '/password/new', '/login?next=/bookings']) {
    await page.goto(`${BASE}${p}`);
    await page.waitForURL((u) => u.pathname === '/');
    await waitText(page, '이웃과 같은 업체·같은 날 예약하고 출장비를 나눠 내요.');
  }
});

await test('로그인 없는 데모: 어느 화면에도 로그인·회원가입·로그아웃·계정 이메일이 없다', async (page) => {
  await start(page, { path: '/me' });
  await waitText(page, '로그인 없는 데모예요');
  const me = await page.locator('main').innerText();
  truthy(!/@|로그아웃|로그인하|회원가입/.test(me.replace('로그인 없는 데모예요', '')), `내 정보: ${me}`);
  const bad = [];
  for (const r of ROUTES_FOR_AUTH_SCAN) {
    await page.goto(`${BASE}${r}`); await page.waitForTimeout(250);
    const t = (await page.locator('body').innerText()).replace('로그인 없는 데모예요', '');
    if (AUTH_WORDS.test(t)) bad.push(r);
    if (await page.locator('input[type="password"], input[type="email"]').count()) bad.push(`${r}(입력)`);
  }
  truthy(!bad.length, `인증 UI가 남은 화면: ${bad.join(', ')}`);
});

await test('로그인 없는 데모: 실제 서버로 데이터를 보내거나 받지 않는다(목업만)', async (page) => {
  const external = [];
  page.on('request', (r) => { const u = new URL(r.url()); if (u.origin !== BASE && !u.protocol.startsWith('data')) external.push(u.origin); });
  await start(page, { path: '/' });
  for (const p of ['/requests', '/bookings', '/me', '/providers/p1/request?new=1&date=2026-10-21']) { await page.goto(`${BASE}${p}`); await page.waitForTimeout(300); }
  truthy(!external.length, `외부 요청: ${[...new Set(external)].join(', ')}`);
  const store = await page.evaluate(() => Object.keys(localStorage).join(','));
  truthy(!/sb-|supabase|auth/i.test(store), `인증 세션 저장값: ${store}`);
});

await test('DEV 버튼 제거: 모바일·데스크톱 어느 화면에도 개발 도구 버튼·패널과 그 빈 자리가 없다', async (page) => {
  await start(page, { path: '/' });
  const bad = [];
  for (const w of [360, 1280]) {
    await page.setViewportSize({ width: w, height: 800 });
    for (const r of ROUTES_FOR_AUTH_SCAN) {
      await page.goto(`${BASE}${r}`); await page.waitForTimeout(200);
      const n = await page.evaluate(() => Array.from(document.querySelectorAll('body *')).filter((el) =>
        el.matches('.dev-fab,.dev-panel') || (el.children.length === 0 && (el.textContent ?? '').trim() === 'DEV') || /개발용 시나리오/.test(el.getAttribute('aria-label') ?? '')).length);
      if (n) bad.push(`${w}px ${r}`);
      // 헤더 밖에서 화면 오른쪽 위에 떠 있는 요소가 없다
      const fixed = await page.evaluate(() => Array.from(document.querySelectorAll('body *')).filter((el) => {
        if (getComputedStyle(el).position !== 'fixed' || el.closest('.app-header')) return false;
        const rc = el.getBoundingClientRect(); return rc.width > 0 && rc.top < 64 && rc.right > innerWidth - 120;
      }).length);
      if (fixed) bad.push(`${w}px ${r}(오른쪽 위 고정 요소)`);
    }
    // 헤더 안쪽 좌우 여백이 같다(오른쪽에 버튼 자리를 비워 두지 않음)
    const pad = await page.evaluate(() => { const cs = getComputedStyle(document.querySelector('.app-header__inner')); return [cs.paddingLeft, cs.paddingRight]; });
    eq(pad[0], pad[1], `${w}px 헤더 좌우 여백`);
  }
  truthy(!bad.length, `DEV 버튼·빈 자리가 남은 화면: ${bad.join(', ')}`);
  eq(await page.evaluate(() => typeof window.__sagoDev), 'object', '데모 빌드에서는 화면 없는 시나리오 훅 유지');
});

// ───────── 필터 열기·닫기 시 가로 밀림(스크롤바 자리) ─────────
/** 헤더·본문·카드·필터 버튼의 가로 위치와 화면 너비 */
const layoutX = (page) => page.evaluate(() => {
  const x = (sel) => { const el = Array.from(document.querySelectorAll(sel)).find((e) => !e.closest('[role="dialog"]')); return el ? Math.round(el.getBoundingClientRect().left * 10) / 10 : null; };
  return { header: x('.app-header__brand'), title: x('main h2'), card: x('main .card'), capsule: x('.capsule'), clientW: document.documentElement.clientWidth };
});
/** 열고(→ 위치·잠금 확인) 닫고(→ 위치·스크롤·포커스 확인)를 닫는 방법을 바꿔 가며 반복한다. */
async function openCloseRepeat(page, opener, label, { popover }) {
  const base = await layoutX(page);
  for (const how of ['Escape', '닫기 버튼', '바깥 누르기']) {
    await opener.scrollIntoViewIfNeeded();
    const y0 = await page.evaluate(() => scrollY);
    await opener.click();
    const dlg = page.getByRole('dialog');
    await dlg.waitFor();
    const open = await layoutX(page);
    eq(JSON.stringify({ ...open, clientW: 0 }), JSON.stringify({ ...base, clientW: 0 }), `${label} 연 동안 가로 위치(${how})`);
    eq(await page.evaluate(() => document.documentElement.style.overflow), 'hidden', `${label} 배경 스크롤 잠금`);
    eq(await page.evaluate(() => scrollY), y0, `${label} 연 동안 스크롤 위치`);
    if (popover !== undefined) {
      const box = await dlg.boundingBox(); const ob = await opener.boundingBox();
      eq(await dlg.evaluate((el) => el.classList.contains('dialog--popover')), popover, `${label} 팝오버 여부`);
      if (popover) truthy(Math.abs(box.x - ob.x) < 1 && box.y > ob.y + ob.height, `${label} 팝오버가 버튼 바로 아래에 붙지 않음: ${box.x}/${ob.x}`);
    }
    if (how === 'Escape') await page.keyboard.press('Escape');
    else if (how === '닫기 버튼') await dlg.getByRole('button', { name: '닫기' }).first().click();
    else await page.mouse.click(4, popover ? 600 : 80);
    await dlg.waitFor({ state: 'detached' });
    // 가로 위치만 비교한다(clientWidth는 잠금·스크롤 높이 변화에 따라 달라질 수 있고, scrollbar-gutter로 위치에는 영향이 없다)
    eq(JSON.stringify({ ...(await layoutX(page)), clientW: 0 }), JSON.stringify({ ...base, clientW: 0 }), `${label} 닫은 뒤 가로 위치(${how})`);
    eq(await page.evaluate(() => scrollY), y0, `${label} 닫은 뒤 스크롤 위치(${how})`);
    eq(await page.evaluate(() => document.documentElement.style.overflow), '', `${label} 잠금 해제`);
    truthy(await opener.evaluate((el) => el === document.activeElement), `${label} 닫은 뒤 포커스 복원(${how})`);
  }
}
const FILTER_PAGES = [['/bookings?tab=requests', '보낸 요청'], ['/bookings?tab=active', '확정된 예약'], ['/bookings?tab=past', '완료·취소']];
for (const [w, hgt] of [[1280, 720], [390, 844]]) {
  for (const scroll of [true, false]) {
    await test(`필터 열기·닫기: 화면이 옆으로 밀리지 않음(${w}px, 스크롤바 ${scroll ? '있음' : '없음'}, 내 예약 세 탭 모든 필터 3회 반복)`, async (page) => {
      for (const [path, name] of FILTER_PAGES) {
        // 스크롤바 없는 페이지: 목록을 1건씩만 남긴다
        await start(page, { path, patch: scroll ? undefined : (db) => { db.requests = db.requests.slice(0, 1); db.bookings = db.bookings.filter((b) => b.id === 'bk-k1' || b.id === 'bk-k15'); } });
        await page.locator('.capsule').first().waitFor();
        await page.locator('main .card').first().waitFor(); // 목록이 그려진 뒤 측정
        await page.waitForTimeout(150);
        const sc = await page.evaluate(() => document.documentElement.scrollHeight > innerHeight + 1);
        eq(sc, scroll, `${name} 스크롤 여부`);
        if (scroll) await page.evaluate(() => window.scrollTo(0, 60)); // 스크롤된 상태에서 열고 닫아도 위치 유지
        const n = await page.locator('.capsule[aria-haspopup="dialog"]').count();
        truthy(n >= 2, `${name} 필터 수`);
        for (let i = 0; i < n; i++) await openCloseRepeat(page, page.locator('.capsule[aria-haspopup="dialog"]').nth(i), `${name} 필터 ${i + 1}`, { popover: w >= 768 });
      }
    }, { browser: browserSB, width: w, height: hgt });
  }
  await test(`다른 대화상자 부작용 없음: 공동 예약 안내(${w}px, 스크롤바 표시 환경)`, async (page) => {
    await start(page, { path: '/' });
    await page.locator('main .card').first().waitFor(); // 업종 카드까지 그려진 뒤 측정
    await openCloseRepeat(page, guideBtn(page), '공동 예약 안내', {});
  }, { browser: browserSB, width: w, height: hgt });
}

// ───────── 필터 선택지 테두리·포커스 표시 잘림 ─────────
/** 요소의 outline(바깥 폭 = 두께 + offset)이 대화상자 스크롤 영역의 보이는 부분 안에 온전히 들어가는지 */
const ringInside = (loc) => loc.evaluate((el) => {
  const cs = getComputedStyle(el);
  const ext = cs.outlineStyle === 'none' ? 0 : parseFloat(cs.outlineWidth) + Math.max(0, parseFloat(cs.outlineOffset));
  const r = el.getBoundingClientRect(); const body = el.closest('.dialog__body'); const b = body.getBoundingClientRect();
  const view = { top: b.top + body.clientTop, left: b.left + body.clientLeft, bottom: b.top + body.clientTop + body.clientHeight, right: b.left + body.clientLeft + body.clientWidth };
  const ring = { top: r.top - ext, left: r.left - ext, bottom: r.bottom + ext, right: r.right + ext };
  const ok = ring.top >= view.top - 0.5 && ring.left >= view.left - 0.5 && ring.bottom <= view.bottom + 0.5 && ring.right <= view.right + 0.5;
  return { ok, outline: cs.outlineStyle, ext, ring, view, scrollable: body.scrollHeight > body.clientHeight + 1 };
});
for (const [w, hgt] of [[390, 844], [390, 520], [1280, 800], [1280, 560]]) {
  await test(`필터 선택지: 첫·마지막 항목 선택 테두리·키보드 포커스 표시가 잘리지 않음(${w}×${hgt}${hgt < 600 ? ', 내부 스크롤' : ''})`, async (page) => {
    let scrolledOnce = false;
    for (const path of ['/bookings?tab=requests', '/bookings?tab=active', '/bookings?tab=past']) {
      await start(page, { path });
      const n = await page.locator('.capsule[aria-haspopup="dialog"]').count();
      for (let i = 0; i < n; i++) {
        const label = `${path} 필터 ${i + 1}`;
        // ① 마우스: 첫·마지막 항목 선택 → 선택 테두리만(포커스 표시 없음), 잘림 없음
        await page.locator('.capsule[aria-haspopup="dialog"]').nth(i).click();
        const dlg = page.getByRole('dialog'); await dlg.waitFor();
        const items = dlg.locator('.choice');
        const cnt = await items.count();
        for (const k of [cnt - 1, 0]) {
          await items.nth(k).click();
          truthy(await items.nth(k).evaluate((el) => el.classList.contains('choice--on')), `${label} 마우스 선택 ${k}`);
          const m = await ringInside(items.nth(k));
          eq(m.outline, 'none', `${label} 마우스 선택 시 포커스 표시 없음(선택 테두리와 구분)`);
          truthy(m.ok, `${label} 마우스 선택 ${k} 테두리 잘림 ${JSON.stringify(m)}`);
        }
        await page.keyboard.press('Escape'); await dlg.waitFor({ state: 'detached' });
        // ② 키보드: 열고 Tab으로 선택된 첫 항목(‘전체’ 등)에 포커스 → 방향키로 마지막까지 → 다시 첫 항목
        await page.locator('.capsule[aria-haspopup="dialog"]').nth(i).focus();
        await page.keyboard.press('Enter'); await dlg.waitFor();
        await page.keyboard.press('Tab');
        const first = await ringInside(items.first());
        eq(first.outline, 'solid', `${label} 첫 항목 키보드 포커스 표시`);
        truthy(first.ok, `${label} 첫 항목 포커스 표시 잘림 ${JSON.stringify(first)}`);
        for (let k = 1; k < cnt; k++) {
          await page.keyboard.press('ArrowDown');
          const r = await ringInside(items.nth(k));
          if (r.scrollable) scrolledOnce = true;
          eq(r.outline, 'solid', `${label} ${k + 1}번째 항목 포커스 표시`);
          truthy(r.ok, `${label} ${k + 1}번째 항목 포커스 표시 잘림 ${JSON.stringify(r)}`);
        }
        // 마지막 항목이 ‘직접 선택’이면 날짜 입력도 포커스 표시가 잘리지 않아야 한다
        if (await dlg.locator('input[type="date"]').count()) {
          await page.keyboard.press('Tab');
          const d = await ringInside(dlg.locator('input[type="date"]').first());
          truthy(d.ext > 0 && d.ok, `${label} 날짜 입력 포커스 표시 잘림 ${JSON.stringify(d)}`);
          await page.keyboard.press('Shift+Tab');
        }
        await page.keyboard.press('ArrowDown'); // 마지막에서 첫 항목으로 돌아간다
        const back = await ringInside(items.first());
        truthy(back.outline === 'solid' && back.ok, `${label} 다시 첫 항목 ${JSON.stringify(back)}`);
        // 적용 동작 유지: 첫 항목(기본값) 적용 후 닫힘
        await dlg.getByRole('button', { name: '적용' }).click(); await dlg.waitFor({ state: 'detached' });
      }
    }
    if (hgt < 600) truthy(scrolledOnce, '내부 스크롤 상태를 한 번 이상 점검');
  }, { width: w, height: hgt });
}

// ───────── 키보드·접근성 ─────────
await test('접근성: 모든 입력에 이름이 있고 키보드로 대화상자를 닫을 수 있다', async (page) => {
  await start(page, { path: '/providers/p1/request?group=g1' });
  const unnamed = await page.evaluate(() => Array.from(document.querySelectorAll('input,textarea,select')).filter((el) => {
    const id = el.id; const lab = id && document.querySelector(`label[for="${id}"]`);
    return !(lab || el.getAttribute('aria-label') || el.closest('label'));
  }).length);
  eq(unnamed, 0, '이름 없는 입력');
  eq(await page.locator('h1').count(), 1, 'h1 개수');
  await page.goto(`${BASE}/requests/rq-1`);
  await page.getByRole('button', { name: '이 업체 요청 철회하기' }).click();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  eq(await page.getByRole('dialog', { name: '밝은전기에 보낸 요청을 철회할까요?' }).count(), 0, 'ESC로 닫기');
  await page.keyboard.press('Shift+Tab'); // 열었던 버튼에서 이전 요소로 이동 가능해야 한다
  const focused = await page.evaluate(() => document.activeElement?.tagName);
  truthy(focused && focused !== 'BODY', `키보드 포커스 이동 (활성 요소: ${focused})`);
});

// ───────── 반응형 ─────────
const WIDTHS = [360, 390, 430, 768, 1280];
const ROUTES = ['/', '/address', '/providers?category=c2', '/providers/p1', '/providers/p1/request?group=g1', '/bookings?tab=requests', '/requests/bundle/b-sink', '/requests/rq-3', '/requests/rq-2/supplement',
  '/requests/rq-3/approval', '/requests/rq-10/recheck', '/bookings?tab=active', '/bookings?tab=past', '/bookings/bk-k2', '/bookings/bk-k4', '/bookings/bk-k5', '/bookings/bk-k16', '/bookings/bk-k2/change', '/bookings/bk-k2/cancel', '/delays/dl-k3', '/proposals/pr-k4', '/materials/mt-1',
  '/additional/aw-1', '/bookings/bk-k9', '/bookings/bk-k14', '/bookings/bk-k13/review', '/ledger', '/me', '/guide'];
await test('브랜드: 탭 제목·파비콘·헤더 로고(싸고 홈), 화면에 이전 서비스명 없음', async (page) => {
  await start(page, { path: '/' });
  truthy((await page.title()).startsWith('싸고'), `탭 제목: ${await page.title()}`);
  const icon = await page.locator('link[rel="icon"]').getAttribute('href');
  const res = await page.request.get(`${BASE}${icon}`);
  truthy(res.ok() && (await res.text()).includes('#315DA8'), '파비콘');
  const home = page.getByRole('link', { name: '싸고 홈', exact: true });
  await home.waitFor();
  eq(await home.locator('svg[aria-hidden="true"]').count(), 1, '헤더 심볼은 스크린리더에서 숨김');
  await page.getByRole('button', { name: '공동 예약 이용 방법' }).click();
  await page.locator('.dialog .guide__art[aria-hidden="true"]').waitFor(); // 공동 방문 일러스트는 이용 방법 안에서만
  await page.getByRole('button', { name: '확인' }).click();
  const bad = [];
  for (const r of ROUTES) {
    await page.goto(`${BASE}${r}`); await page.waitForTimeout(250);
    if ((await page.locator('body').innerText()).includes('온김에')) bad.push(r);
  }
  eq(await page.locator('.guide__art').count(), 0, '일러스트는 업체 찾기에만'); // 마지막 화면(/guide)
  truthy(!bad.length, `이전 서비스명이 남은 화면: ${bad.join(', ')}`);
});

mkdirSync(join(ROOT, 'e2e/screens'), { recursive: true });
for (const w of WIDTHS) {
  await test(`반응형 ${w}px: 모든 화면에서 가로 넘침·잘림 없음`, async (page) => {
    await start(page, { path: '/' });
    const bad = [];
    const all = ROUTES.map((r) => [r, '']);
    for (const [r, mode] of all) {
      await page.goto(`${BASE}${r}`);
      await page.waitForTimeout(350);
      const info = await page.evaluate(() => {
        const vw = document.documentElement.clientWidth;
        const over = document.documentElement.scrollWidth > vw + 1;
        // 텍스트·버튼이 화면 밖으로 나가거나 부모에서 잘리는지
        const clipped = [];
        for (const el of document.querySelectorAll('main *, header *')) {
          if (el.closest('.sr-only') || el.classList.contains('sr-only')) continue;
          if (getComputedStyle(el).clip === 'rect(0px, 0px, 0px, 0px)') continue; // 화면에서 숨기고 스크린리더용으로 남긴 텍스트(예: 좁은 화면의 진행 단계 전체 라벨)
          const cs = getComputedStyle(el);
          if (cs.display === 'none' || cs.visibility === 'hidden') continue;
          const rc = el.getBoundingClientRect();
          if (rc.width === 0 || rc.height === 0) continue;
          if (rc.right > vw + 1 || rc.left < -1) clipped.push(`${el.tagName}.${el.className}`.slice(0, 50));
          if (el.children.length === 0 && el.scrollWidth > el.clientWidth + 1 && cs.overflow !== 'visible') clipped.push(`clip:${el.tagName}.${el.className}`.slice(0, 50));
        }
        return { over, clipped: clipped.slice(0, 3) };
      });
      if (info.over || info.clipped.length) bad.push(`${r} ${info.over ? '[가로 스크롤]' : ''} ${info.clipped.join(',')}`);
      if (process.env.E2E_SHOTS !== '0') await page.screenshot({ path: join(ROOT, `e2e/screens/${w}_${mode ? `${mode}_` : ''}${r.replace(/[^a-z0-9]+/gi, '_')}.png`), fullPage: true });
    }
    truthy(!bad.length, bad.join(' / '));
  }, { width: w });
}

// ═════════ 정리 ═════════
await browser.close();
await browserSB.close();
stopServer();

// 운영 빌드에 개발 도구가 포함되지 않았는지 확인
let prodOk = null;
if (!only) {
  const env = { ...process.env }; for (const k of Object.keys(env)) if (k.startsWith('VITE_')) delete env[k];
  const r = vite(['build', '--outDir', 'dist-prod', '--emptyOutDir'], { encoding: 'utf8', stdio: 'pipe', env });
  const files = readdirSync(join(ROOT, 'dist-prod/assets')).filter((f) => f.endsWith('.js'));
  const leaked = files.filter((f) => /__sagoDev|승인 조건 버전을|service_role/.test(readFileSync(join(ROOT, 'dist-prod/assets', f), 'utf8')));
  prodOk = r.status === 0 && leaked.length === 0 && !files.some((f) => /^dev(Hook|Controller)/i.test(f));
  results.push({ name: '운영 빌드에는 개발용 시나리오 훅이 포함되지 않는다', ok: prodOk, ms: 0, error: prodOk ? undefined : `포함됨: ${leaked.join(',')}` });
  console.log(`  ${prodOk ? '✓' : '✕'} 운영 빌드에는 개발용 시나리오 훅이 포함되지 않는다`);
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} 통과${skipped.length ? ` · 건너뜀 ${skipped.length}(비교 요청 제외)` : ''}`);
if (!only) {
  const lines = [`# e2e 점검 기록`, '', `실행: ${new Date().toISOString()} · 브라우저: Chromium(headless) · 목업 시계 2026-10-13 19:00 (Asia/Seoul)`, '', `결과: **${results.length - failed.length}/${results.length} 통과**`, '', '| 결과 | 점검 | 비고 |', '|---|---|---|',
    ...results.map((r) => `| ${r.ok ? '통과' : '실패'} | ${r.name} | ${r.error ?? ''} |`), ...skipped.map((n) => `| 건너뜀 | ${n} | 비교 요청 제외 |`)];
  mkdirSync(join(ROOT, 'docs'), { recursive: true });
  writeFileSync(join(ROOT, 'docs/e2e-report.md'), lines.join('\n') + '\n');
}
process.exit(failed.length ? 1 : 0);
