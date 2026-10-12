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
const only = process.env.E2E_ONLY;
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
  await page.getByRole('link', { name: /수전·샤워기·배수 부품/ }).click();
  await waitText(page, '한빛설비');
  await waitText(page, '공동 예약 후보');
  await waitText(page, '예상 출장비');
  await page.getByRole('link', { name: /한빛설비/ }).first().click();
  await waitText(page, '공동 예약 일정');
  await waitText(page, '공동 예약 날짜를 선택해주세요.');
  await page.getByRole('button', { name: /2026년 10월 16일 금요일, 신청 가능/ }).click();
  await waitText(page, '약 12,500원');
  await waitText(page, '본인 예약 확정 시 4세대 기준');
  await waitText(page, '결제 대기 자리를 빼고');
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
  await start(page, { path: '/requests', patch: (d) => { d.settings.failNextQuery = true; } });
  await waitText(page, '정보를 불러오지 못했습니다');
  await page.getByRole('button', { name: /다시 시도/ }).click();
  await waitText(page, '내 요청');
  await waitText(page, '업체 승인 완료 · 결제 대기');
});

await test('로딩 상태 표시', async (page) => {
  await start(page, { path: '/requests', latency: 1500 });
  await page.waitForSelector('[aria-busy="true"]');
  await waitText(page, '업체 승인 완료 · 결제 대기');
});

await test('요청: 공동 날짜로 복수 작업 요청서 제출', async (page) => {
  await start(page, { path: '/providers/p1' });
  await page.getByRole('button', { name: /2026년 10월 16일 금요일, 신청 가능/ }).click();
  await page.locator('input[name="joint-group"]').first().check();
  await page.getByRole('button', { name: '선택한 일정으로 수리 요청하기' }).click();
  await waitText(page, '수리 요청서');
  await waitText(page, '고객 가능 시간');
  await page.getByRole('button', { name: '요청 보내기' }).click();
  await waitText(page, '작업 내용을 입력해 주세요'); // 검증 메시지
  await page.getByLabel('어떤 작업인가요?').fill('주방 수전 교체');
  await page.getByRole('button', { name: '작업 추가하기' }).click();
  await page.getByLabel('어떤 작업인가요?').nth(1).fill('배수 트랩 교체');
  await page.getByLabel('상세 주소', { exact: true }).fill('301동 1204호');
  await page.getByRole('button', { name: '09:00~12:00' }).click();
  await page.getByRole('button', { name: '요청 보내기' }).dblclick(); // 연타해도 한 번만
  await waitText(page, '요청을 보냈어요');
  await waitText(page, '업체 검토 중');
  const d = await db(page);
  const mine = d.requests.filter((r) => r.tasks.length === 2 && r.tasks[0].title === '주방 수전 교체');
  eq(mine.length, 1, '연타 후 생성된 요청 수');
  eq(mine[0].status, 'reviewing', '요청 상태');
  eq(mine[0].bookingId, undefined, '요청만으로 예약이 생기지 않음');
  eq(JSON.stringify(mine[0].slots), '["09:00–12:00"]', '고객 가능 시간 범위 저장');
});

await test('요청: 새 날짜 요청은 희망 날짜가 필요하다', async (page) => {
  await start(page, { path: '/providers/p1/request?new=1' });
  await page.getByLabel('어떤 작업인가요?').fill('욕실 수전 교체');
  await page.getByLabel('상세 주소', { exact: true }).fill('301동 1204호');
  await page.getByRole('button', { name: '09:00~12:00' }).click();
  await page.getByRole('button', { name: '요청 보내기' }).click();
  await waitText(page, '희망 방문 날짜를 선택해 주세요');
  await page.getByLabel('희망 방문 날짜').fill('2026-10-21');
  await page.getByRole('button', { name: '요청 보내기' }).click();
  await waitText(page, '요청을 보냈어요');
});

await test('요청: 비교 묶음에서 업체별 승인 조건 비교', async (page) => {
  await start(page, { path: '/requests' });
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
    const h = [...document.querySelectorAll('h2')].find((x) => x.textContent === '어떤 수리가 필요하세요?');
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
  await waitText(page, '이웃과 같은 날 예약하면 출장비를 나눠 내요.');
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
  await page.getByRole('link', { name: /수전·샤워기/ }).click();
  await page.waitForURL((u) => u.pathname === '/providers');
  await waitText(page, '공동 예약 후보');
});

for (const w of [320, 360, 390, 768, 1280]) {
  await test(`업체 찾기: 카테고리 제목·안내 배치 ${w}px(겹침·잘림·가로 스크롤 없음)`, async (page) => {
    await start(page, { path: '/' });
    await waitText(page, '이웃과 같은 날 예약하면 출장비를 나눠 내요.');
    const L = await hintLayout(page);
    truthy(L.sw <= L.vw, '가로 스크롤');
    truthy(L.btn.r <= L.vw && L.textLeft >= 0 && L.head.r <= L.vw, '잘림');
    truthy(L.fontSize >= 13, `글자 축소 없음(${L.fontSize}px)`);
    eq(L.name, '공동 예약 이용 방법', '접근성 이름');
    truthy(Math.round(L.icon.w) === 20 && Math.round(L.icon.h) === 20, `아이콘 20px(${L.icon.w}×${L.icon.h})`);
    truthy(L.btn.w >= 44 && L.btn.h >= 44, `터치 영역 44px 이상(${L.btn.w}×${L.btn.h})`);
    truthy(Math.abs(L.icon.cy - L.last.cy) < 6, `아이콘이 문구 마지막 줄과 같은 줄(아이콘 ${L.icon.cy} / 문구 ${L.last.cy})`);
    truthy(Math.abs(L.icon.x - L.last.r - 8) <= 2, `문구와 아이콘 간격 8px(${(L.icon.x - L.last.r).toFixed(1)}px)`);
    if (w >= 720) {
      truthy(Math.abs(L.h.cy - L.icon.cy) < 6, `같은 줄 수직 중앙(제목 ${L.h.cy} / 아이콘 ${L.icon.cy})`);
      truthy(L.textLeft - L.h.r >= 24, `제목과 안내 사이 간격(${L.textLeft - L.h.r}px)`);
      truthy(Math.abs(L.icon.r - L.head.r) <= 1, `아이콘이 오른쪽 끝(${L.icon.r} / ${L.head.r})`);
    } else {
      truthy(L.textTop >= L.h.b - 1, `안내가 제목 다음 줄(${L.textTop} / ${L.h.b})`);
      truthy(Math.abs(L.textLeft - L.h.x) <= 1, `왼쪽 정렬(${L.textLeft} / ${L.h.x})`);
    }
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
  await waitText(page, '이웃과 같은 날 예약하면 출장비를 나눠 내요.');
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
  await waitText(page, '이웃과 같은 날 예약하면 출장비를 나눠 내요.');
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
async function fillNewDateRequest(page, title) {
  await page.getByLabel('어떤 작업인가요?').fill(title);
  await page.getByLabel('희망 방문 날짜').fill('2026-10-21');
  await page.getByRole('button', { name: '09:00~12:00' }).click();
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
  await page.getByRole('link', { name: /수전·샤워기/ }).click();
  await waitText(page, '공동 예약 후보');
});

await test('주소: 첫 신청 저장 선택 → 같은 건물 다음 신청 자동 입력·수정(미선택이면 기존 저장 유지)', async (page) => {
  await start(page, { path: '/providers/p1/request?new=1' });
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
  await page.goto(`${BASE}/providers/p2/request?new=1`);
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
  eq(d.requests.find((r) => r.tasks[0].title === '두 번째 신청').visitAddress.detail, '301동 1205호', '이번 요청에는 입력한 주소');
  await waitText(page, '301동 1205호'); // 요청 상세의 방문 주소
});

await test('주소: 다른 건물 선택 시 이전 동·호수 비움 · 같은 건물로 돌아오면 다시 자동 입력 · 탐색 주소는 그대로', async (page) => {
  await start(page, { path: '/providers/p1/request?new=1', patch: (d) => { d.savedVisitAddress = { addressId: 'ad-apt', line1: '서울 가상구 햇살로 100 (햇살마을 3단지)', detail: '301동 1204호', savedAt: '2026-10-13T00:00:00Z' }; } });
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
  await page.getByLabel('어떤 작업인가요?').fill('실패할 신청');
  await page.getByRole('button', { name: '09:00~12:00' }).click();
  await detailInput(page).fill('301동 1204호');
  await saveBox(page).check();
  await page.getByRole('button', { name: '요청 보내기' }).click();
  await page.locator('.banner--danger').first().waitFor();
  eq(new URL(page.url()).pathname, '/providers/p1/request', '실패 시 신청서에 머묾');
  truthy(!(await page.locator('main').innerText()).includes('주소도 저장했어요'), '실패인데 저장 안내');
  let d0 = await db(page);
  eq(d0.savedVisitAddress, null, '실패 시 재사용 주소 저장 안 함');
  eq(d0.requests.some((r) => r.tasks[0].title === '실패할 신청'), false, '실패 시 요청 없음');
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
  await start(page, { path: '/providers/p1/request?new=1' });
  await waitText(page, '다음 신청에도 이 주소 사용');
  await detailInput(page).focus();
  await detailInput(page).press('End');
  await page.waitForTimeout(200);
  const input = await detailInput(page).boundingBox();
  const bar = await page.locator('.action-bar').boundingBox();
  truthy(input && bar && input.y + input.height <= bar.y && input.y >= 0, `입력란 ${JSON.stringify(input)} / 하단 버튼 ${JSON.stringify(bar)}`);
  await page.getByRole('button', { name: '요청 보내기' }).waitFor();
});

// ───────── 내 예약 필터(진행 중·이용 내역) ─────────
const bkStatus = (page) => page.getByRole('button', { name: /^상태 필터/ });
const bkVisit = (page) => page.getByRole('button', { name: /^방문일 필터/ });
const bkToggle = (page) => page.getByRole('button', { name: '확인 필요만' });
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

await test('내 예약 필터: 진행 중 상태·방문일·확인 필요(AND), 건수 일치, 전체로 그 조건만 해제, 초기화 없음', async (page) => {
  await start(page, { path: '/bookings' });
  await bkCount(page, 11);
  eq((await bkStatus(page).innerText()).trim(), '상태', '기본 표시');
  eq((await bkVisit(page).innerText()).trim(), '방문일', '기본 표시');
  eq(await bkToggle(page).getAttribute('aria-pressed'), 'false', '확인 필요만 기본 꺼짐');
  const h = (await bkStatus(page).boundingBox()).height;
  truthy(h >= 40 && h <= 44, `높이 ${h}`);
  eq(await page.getByRole('button', { name: /초기화/ }).count(), 0, '초기화 버튼 없음');
  await bkPick(page, 'status', '방문 예정');
  truthy((await bkBadges(page, ['방문 예정'])).every((x) => x === '방문 예정'), '방문 예정만');
  await bkCount(page, 5);
  await bkPick(page, 'status', '작업 중');
  const w = await bkBadges(page, ['작업 중', '후속 방문 대기']);
  truthy(w.includes('작업 중') && w.includes('후속 방문 대기'), `작업 중(후속 방문 대기 포함): ${w}`);
  await bkPick(page, 'status', '최종 금액 확인 필요');
  truthy((await bkBadges(page, ['최종 금액 확인 필요'])).length === 3, '최종 금액 확인 필요 3건');
  await bkPick(page, 'status', '정산 대기');
  await bkCount(page, 1);
  // 확인 필요만: 정산 대기(금액 협의 중)는 고객 행동이 없어 결과 없음
  await bkToggle(page).click();
  eq(await bkToggle(page).getAttribute('aria-pressed'), 'true', '토글 켜짐');
  await waitText(page, '선택한 조건에 맞는 예약이 없어요.');
  await bkPick(page, 'status', '전체');
  await bkCount(page, 7); // 지연·제안·자재·추가 작업·최종 금액 ×3
  await bkPick(page, 'status', '방문 예정');
  await bkCount(page, 3); // 방문 예정 AND 확인 필요
  await bkToggle(page).click();
  await bkPick(page, 'visit', '이번 주'); // 10-12(월)~10-18(일)
  await bkVisit(page).filter({ hasText: '이번 주' }).waitFor();
  await bkCount(page, 5);
  await bkPick(page, 'visit', '오늘');
  await bkCount(page, 1);
  await bkPick(page, 'status', '전체'); // 상태만 해제 → 오늘 방문(진행 중) 전체
  eq(new URL(page.url()).search, '?a_visit=today', '상태만 해제');
  await bkPick(page, 'visit', '전체 기간');
  eq(new URL(page.url()).search, '', '방문일만 해제');
  await bkCount(page, 11);
});

await test('내 예약 필터: 탭별 독립 조건 · 탭 전환 후 유지 · 상세 복귀 시 탭·조건 복원', async (page) => {
  await start(page, { path: '/bookings' });
  await bkCount(page, 11);
  await bkPick(page, 'status', '방문 예정');
  await bkTab(page, '이용 내역').click();
  await bkCount(page, 6);
  eq((await bkStatus(page).innerText()).trim(), '상태', '이용 내역은 별도 조건(기본)');
  eq(await bkToggle(page).count(), 0, '이용 내역에는 확인 필요만 없음');
  await bkPick(page, 'status', '취소됨');
  truthy((await bkBadges(page, ['취소됨'])).every((x) => x === '취소됨'), '취소됨만');
  await bkCount(page, 4);
  await bkPick(page, 'status', '이용 완료');
  await bkCount(page, 2);
  await bkPick(page, 'status', '취소됨');
  await bkTab(page, '진행 중').click();
  await bkStatus(page).filter({ hasText: '방문 예정' }).waitFor();
  await bkCount(page, 5);
  await bkTab(page, '이용 내역').click();
  await bkStatus(page).filter({ hasText: '취소됨' }).waitFor();
  await bkCount(page, 4);
  await bkCards(page).first().getByRole('link').click();
  await page.waitForURL((u) => u.pathname.startsWith('/bookings/bk-'));
  await page.getByRole('link', { name: '뒤로 가기' }).click(); // 쿼리 없는 /bookings 링크
  await page.waitForURL((u) => u.pathname === '/bookings' && u.search.includes('tab=past'));
  eq(await bkTab(page, '이용 내역').getAttribute('aria-selected'), 'true', '이용 내역 탭 복원');
  await bkStatus(page).filter({ hasText: '취소됨' }).waitFor();
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
  truthy(!(await page.locator('main').innerText()).includes('이용 내역이 없어요'), '예약 없음과 구분');
  // 적용 전 닫으면 유지(키보드: Enter로 열고 Esc로 닫으면 버튼으로 포커스 복귀)
  await bkStatus(page).focus();
  await page.keyboard.press('Enter');
  await page.getByRole('dialog', { name: '상태' }).getByRole('radio', { name: /^취소됨/ }).check();
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label')?.startsWith('상태 필터')).catch(() => {});
  eq(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), '상태 필터: 전체', '닫으면 포커스 복귀·적용 안 됨');
  await bkPick(page, 'visit', '전체 기간'); // 결과 없음에서도 조작
  await bkCount(page, 6);
});

await test('내 예약 필터: 일정 변경 합의 전에는 기존 방문일, 수락 후 바뀐 방문일 기준', async (page) => {
  await start(page, { path: '/bookings?a_visit=custom&a_from=2026-10-19&a_to=2026-10-19' });
  await waitText(page, '선택한 조건에 맞는 예약이 없어요.'); // bk-k4는 제안(10-19) 확인 대기 → 기존 10-14 기준
  await page.goto(`${BASE}/proposals/pr-k4`);
  await page.getByRole('button', { name: '변경 수락하기' }).click();
  await waitText(page, '수락됨');
  await page.goto(`${BASE}/bookings?a_visit=custom&a_from=2026-10-19&a_to=2026-10-19`);
  await bkCount(page, 1);
  await waitText(page, '깔끔마감');
});

await test('내 예약 필터: 조회 오류는 빈 결과와 구분하고 다시 시도', async (page) => {
  await start(page, { path: '/bookings', patch: (d) => { d.settings.failNextQuery = true; } });
  await waitText(page, '정보를 불러오지 못했습니다');
  truthy(!(await page.locator('main').innerText()).includes('선택한 조건에 맞는 예약이 없어요'), '오류를 빈 결과로 표시');
  await page.getByRole('button', { name: /다시 시도/ }).click();
  await bkCount(page, 11);
});

// ───────── 내 요청 필터(캡슐형: 요청 상태 단일 선택 + 접수일) ─────────
const statusBtn = (page) => page.getByRole('button', { name: /^요청 상태 필터/ });
const periodBtn = (page) => page.getByRole('button', { name: /^접수일 필터/ });
const cards = (page) => page.locator('main .request-list > li');
const badges = (page) => page.locator('main .request-list > li .badge').allInnerTexts();
/** 조회가 끝난 뒤의 건수 문구(조회 중에는 비어 있다) */
const countText = async (page) => { await page.locator('.filter-bar__count', { hasText: '요청 묶음' }).waitFor(); await page.waitForSelector('.request-list[aria-busy]', { state: 'detached' }).catch(() => {}); return page.locator('.filter-bar__count').innerText(); };
const search = (page) => new URL(page.url()).search;
const onPath = (page, p) => page.waitForURL((u) => u.pathname === p);
const listBadges = async (page) => { await page.locator('main .request-list .badge').first().waitFor(); return badges(page); };
const ENDED = ['업체 거절', '철회', '승인 만료', '다른 업체 예약으로 종료'];
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
  await start(page, { path: '/requests' });
  await waitText(page, '업체 승인 완료 · 결제 대기');
  const sb = await statusBtn(page).boundingBox(); const pb = await periodBtn(page).boundingBox();
  truthy(sb.x < pb.x && Math.abs(sb.y - pb.y) < 2, '요청 상태가 먼저, 같은 줄');
  truthy(sb.height >= 40 && sb.height <= 44 && pb.height >= 40 && pb.height <= 44, `높이 40~44px(${sb.height}, ${pb.height})`);
  eq((await statusBtn(page).innerText()).trim(), '요청 상태', '기본 표시');
  eq((await periodBtn(page).innerText()).trim(), '접수일', '기본 표시');
  truthy(parseFloat(await statusBtn(page).evaluate((el) => getComputedStyle(el).borderTopLeftRadius)) >= 20, '캡슐형 모서리');
  eq(await page.locator('.capsule--on').count(), 0, '기본값은 강조 없음');
  eq(await countText(page), `요청 묶음 ${await cards(page).count()}건`, '건수 = 표시 묶음 수');
  eq(await page.getByRole('button', { name: /초기화/ }).count(), 0, '초기화 버튼 없음');
});

await test('요청 필터: 상태 그룹 단일 선택(결제 대기·추가 정보 필요·업체 검토 중·예약 완료·종료) · 전체로 그 조건만 해제', async (page) => {
  await start(page, { path: '/requests' });
  await waitText(page, '업체 승인 완료 · 결제 대기');
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
    eq(await countText(page), `요청 묶음 ${await cards(page).count()}건`, `${label} 건수`);
    return shown;
  };
  await expectGroup('결제 대기', 'payment_pending', ['업체 승인 완료 · 결제 대기']);
  await expectGroup('추가 정보 필요', 'needs_info', ['추가 정보 필요']);
  await expectGroup('업체 검토 중', 'reviewing', ['업체 검토 중']);
  await expectGroup('예약 완료', 'booked', ['예약 완료']);
  const ended = await expectGroup('종료', 'ended', ENDED);
  truthy(new Set(ended).size >= 3, `종료에 구체 상태가 그대로 보임: ${ended}`);
  // 접수일과 함께 적용한 뒤 상태만 ‘전체’로 → 접수일은 유지
  await pickPeriod(page, '최근 30일');
  eq(search(page), '?period=30d&status=ended', '두 조건');
  await pickStatus(page, '전체');
  eq(search(page), '?period=30d', '상태만 해제');
  await periodBtn(page).filter({ hasText: '최근 30일' }).waitFor();
  await statusBtn(page).filter({ hasText: '요청 상태' }).waitFor();
  await pickPeriod(page, '전체 기간');
  eq(search(page), '', '접수일만 해제');
  await page.locator('.filter-bar__count', { hasText: `요청 묶음 ${total}건` }).waitFor();
});

await test('요청 필터: 접수일 직접 선택(오류·경계) + 상태 AND → 결과 없음에서도 필터 조작, 적용 전 닫으면 유지', async (page) => {
  await page.setViewportSize({ width: 360, height: 760 });
  await start(page, { path: '/requests' });
  await waitText(page, '업체 승인 완료 · 결제 대기');
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
  await page.locator('.filter-bar__count', { hasText: '요청 묶음 2건' }).waitFor();
  const labels = await cards(page).allInnerTexts();
  truthy(labels.length === 2 && labels.every((t) => t.includes('요청 접수일 2026.10.12')), '모두 10-12 접수');
  // 적용 전에 닫으면 기존 조건 유지(편집값 ≠ 적용값)
  await statusBtn(page).click();
  await page.getByRole('dialog', { name: '요청 상태' }).getByRole('radio', { name: /^예약 완료/ }).check();
  await page.keyboard.press('Escape');
  await statusBtn(page).filter({ hasText: '요청 상태' }).waitFor();
  eq(search(page).includes('status'), false, '닫으면 적용 안 됨');
  // AND → 결과 없음(10-12 접수 중 종료 상태 없음)
  await pickStatus(page, '종료');
  await waitText(page, '선택한 조건에 맞는 요청이 없어요.');
  await waitText(page, '날짜나 상태를 변경해주세요.');
  await ((n) => process.env.E2E_SHOTS !== '0' && page.screenshot({ path: join(ROOT, `e2e/screens/360_filter_${n}.png`) }))('no_result');
  eq(await countText(page), '요청 묶음 0건', '결과 없음 건수');
  eq(await page.getByRole('button', { name: /초기화/ }).count(), 0, '빈 상태에도 초기화 버튼 없음');
  truthy(!(await page.locator('main').innerText()).includes('아직 보낸 수리 요청이 없어요'), '요청 없음과 구분');
  // 결과가 없어도 필터를 계속 조작
  await pickPeriod(page, '전체 기간');
  const shown = await listBadges(page);
  truthy(shown.length > 0 && shown.every((x) => ENDED.includes(x)), `기간 해제 후 종료 상태만: ${shown}`);
});

await test('요청 필터: 키보드로 열기·선택·적용, 포커스 이동·복귀 · 데스크톱 팝오버/모바일 하단 시트', async (page) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await start(page, { path: '/requests' });
  await waitText(page, '업체 승인 완료 · 결제 대기');
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
  await page.keyboard.press('ArrowDown'); // 결제 대기
  eq(await dlg.getByRole('radio', { name: /^결제 대기/ }).isChecked(), true, '방향키로 선택');
  await dlg.getByRole('button', { name: '적용', exact: true }).focus();
  await page.keyboard.press('Enter');
  await dlg.waitFor({ state: 'detached' });
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '요청 상태 필터: 결제 대기').catch(() => {});
  eq(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), '요청 상태 필터: 결제 대기', '닫히면 버튼으로 포커스 복귀');
  eq(search(page), '?status=payment_pending', '키보드로 적용');
  // 모바일: 하단 시트
  await page.setViewportSize({ width: 390, height: 700 });
  await periodBtn(page).click();
  const box = await page.locator('.dialog').boundingBox();
  truthy(Math.abs(box.y + box.height - 700) < 2, `모바일 하단 시트(${JSON.stringify(box)})`);
  await page.getByRole('dialog', { name: '접수일' }).getByRole('button', { name: '닫기' }).click();
});

await test('요청 필터: 묶음 안 서로 다른 상태 — 선택 상태 요청만 표시, 상세 비교에는 전체 유지', async (page) => {
  // b-sink: rq-3(결제 대기) + rq-4 철회로 상태를 나눈다
  await start(page, { path: '/requests', patch: (d) => { d.requests.find((r) => r.id === 'rq-4').status = 'withdrawn'; } });
  await pickStatus(page, '종료');
  await page.waitForURL((u) => u.search === '?status=ended');
  await countText(page); // 조회가 끝난 목록을 읽는다
  const sink = cards(page).filter({ hasText: '욕실 세면대 수전 교체 · 배수 트랩 교체' }).filter({ hasText: '2개 업체에 요청' });
  await sink.first().waitFor();
  const t = await sink.first().innerText();
  truthy(t.includes("철회") && !t.includes("업체 승인 완료 · 결제 대기") && t.includes("목록에서만 숨겼어요"), `묶음 안 선택 상태만: ${JSON.stringify(t)}`);
  await sink.first().getByRole('link').click();
  await page.waitForURL((u) => u.pathname === '/requests/bundle/b-sink');
  await waitText(page, '한빛설비'); await waitText(page, '새봄수리'); // 숨긴 요청도 상세 비교에 그대로
});

await test('요청 필터: 상세 진입 후 복귀·새로고침·뒤로가기·잘못된 쿼리', async (page) => {
  await start(page, { path: '/requests?status=needs_info' });
  eq((await listBadges(page)).join(), '추가 정보 필요', '주소의 필터 적용');
  await page.getByRole('link', { name: /현관문 손잡이 교체/ }).click();
  await onPath(page, '/requests/rq-2');
  await page.getByRole('link', { name: '뒤로 가기' }).click(); // 헤더 ‘뒤로’는 쿼리 없는 /requests 링크
  await page.waitForURL((u) => u.pathname === '/requests' && u.search === '?status=needs_info');
  eq((await listBadges(page)).join(), '추가 정보 필요', '상세 복귀 후 필터 유지');
  await page.reload();
  eq((await listBadges(page)).join(), '추가 정보 필요', '새로고침 후 유지');
  await pickStatus(page, '업체 검토 중');
  eq(search(page), '?status=reviewing', '두 번째 적용');
  await page.goBack();
  await page.waitForURL((u) => u.search === '?status=needs_info');
  await page.waitForTimeout(200);
  eq((await badges(page)).join(), '추가 정보 필요', '뒤로가기로 이전 조건');
  await page.locator('.tabbar').getByRole('link', { name: '내 정보' }).click();
  await page.locator('.tabbar').getByRole('link', { name: '내 요청' }).click();
  await page.waitForURL((u) => u.search === '?status=needs_info');
  for (const bad of ['period=custom&from=2026-99-01&to=x&status=zzz', 'status=reviewing,needs_info', 'status=approved_pending_payment']) {
    await page.goto(`${BASE}/requests?${bad}`);
    await page.waitForURL((u) => u.pathname === '/requests' && u.search === '');
    await periodBtn(page).filter({ hasText: '접수일' }).waitFor();
    await statusBtn(page).filter({ hasText: '요청 상태' }).waitFor();
  }
});

await test('요청 필터: 목록 위치 유지(상세 → 뒤로) · 필터 변경 시 처음으로', async (page) => {
  await page.setViewportSize({ width: 390, height: 600 });
  await start(page, { path: '/requests' });
  await waitText(page, '업체 승인 완료 · 결제 대기');
  const last = cards(page).last();
  await last.scrollIntoViewIfNeeded();
  await page.waitForTimeout(150);
  const y = await page.evaluate(() => window.scrollY);
  truthy(y > 100, `스크롤 가능한 목록 (${y})`);
  await last.getByRole('link').click();
  await page.waitForURL((u) => u.pathname !== '/requests');
  await page.goBack();
  await page.waitForURL((u) => u.pathname === '/requests');
  await page.waitForTimeout(400);
  const back = await page.evaluate(() => window.scrollY);
  truthy(Math.abs(back - y) < 40, `복귀 위치 ${back} / 이전 ${y}`);
  await statusBtn(page).scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollTo(0, 200));
  await pickStatus(page, '예약 완료');
  await page.waitForTimeout(200);
  eq(await page.evaluate(() => window.scrollY), 0, '필터 변경 시 목록 처음으로');
});

await test('요청 필터: 다른 소유 계정의 목업 상태가 남아 있으면 데모 고객 데이터로 초기화(필터·위치·방문 지역 포함)', async (page) => {
  await start(page, { path: '/requests' });
  await pickStatus(page, '종료');
  truthy((await page.evaluate(() => JSON.stringify({ ...sessionStorage }))).includes('list-filter'), '필터 저장');
  // 이전 버전·다른 계정의 상태를 흉내 낸다(사용자 구분 구조는 유지된다)
  await page.evaluate((k) => { const d = JSON.parse(sessionStorage.getItem(k)); d.ownerAccountId = 'someone-else'; d.requests[0].tasks[0].title = '다른 계정 데이터'; sessionStorage.setItem(k, JSON.stringify(d)); }, DB_KEY);
  await page.goto(`${BASE}/requests`);
  await waitText(page, '업체 승인 완료 · 결제 대기');
  const dump = await page.evaluate(() => JSON.stringify({ ...sessionStorage }));
  truthy(!dump.includes('다른 계정 데이터'), '다른 계정 목업 데이터가 남음');
  truthy(!dump.includes('status=ended'), '다른 계정 필터가 남음');
  eq(new URL(page.url()).search, '', '필터 초기화');
});

await test('요청: 추가 정보 요청 → 보완 제출 → 검토 중', async (page) => {
  await start(page, { path: '/requests/rq-2' });
  await page.getByRole('link', { name: '요청서 보완하기' }).click();
  await page.getByRole('button', { name: '보완 내용 보내기' }).click();
  await waitText(page, '내용을 입력하거나 사진을 추가해 주세요');
  await page.getByLabel('보완 내용').fill('손잡이 사진을 추가했어요.');
  await page.getByRole('button', { name: '보완 내용 보내기' }).click();
  await waitText(page, '보완한 내용을 보냈어요');
  await waitText(page, '업체 검토 중');
});

await test('요청: 철회는 취소수수료 없음 안내 후 완료', async (page) => {
  await start(page, { path: '/requests/rq-1' });
  await page.getByRole('button', { name: '이 업체 요청 철회하기' }).click();
  await waitText(page, '취소수수료는 없어요');
  await page.getByRole('button', { name: '요청 철회하기', exact: true }).click();
  await waitText(page, '직접 철회한 요청이에요');
  eq((await db(page)).requests.find((r) => r.id === 'rq-1').status, 'withdrawn', '철회 상태');
});

await test('요청 상태: 거절·철회·만료·타 업체 예약으로 종료 안내', async (page) => {
  await start(page, { path: '/requests/rq-5' }); await waitText(page, '업체가 거절했어요');
  await page.goto(`${BASE}/requests/rq-6`); await waitText(page, '직접 철회한 요청이에요');
  await page.goto(`${BASE}/requests/rq-7`); await waitText(page, '결제 기한이 지나 예약이 확정되지 않았어요');
  await page.goto(`${BASE}/requests/rq-8`); await waitText(page, '다른 업체 예약이 확정됐어요');
});

await test('결제: 승인 조건 → 동의 → 모의 결제 → 예약 확정, 연타해도 거래 1건, 비교 묶음 종료', async (page) => {
  await start(page, { path: '/requests/rq-3/approval' });
  await waitText(page, '승인만으로는 예약이 확정되지 않아요');
  await waitText(page, '모의 결제입니다');
  const pay = page.getByRole('button', { name: /모의 결제하기/ });
  truthy(await pay.isDisabled(), '동의 전에는 결제 버튼 비활성');
  await page.getByRole('checkbox').check();
  await pay.dblclick();
  await waitText(page, '예약이 확정됐어요');
  const d = await db(page);
  eq(d.transactions.filter((t) => t.requestId === 'rq-3' && t.kind === 'deposit').length, 1, '예약금 거래 수');
  eq(d.requests.find((r) => r.id === 'rq-3').status, 'booked', '요청 상태');
  eq(d.requests.find((r) => r.id === 'rq-4').status, 'closed_other_booking', '같은 묶음의 다른 업체 요청');
  eq(d.bookings.filter((b) => b.requestId === 'rq-3').length, 1, '예약 수');
  // 결제 성공·예약 생성 확인 → 그 예약 상세로 바로 이동
  await page.waitForURL((u) => u.pathname === `/bookings/${d.requests.find((r) => r.id === 'rq-3').bookingId}`);
  await waitText(page, '방문 예정');
});

await test('결제 실패: 예약 미확정 → 다시 시도하면 성공', async (page) => {
  await start(page, { path: '/requests/rq-3/approval', patch: (d) => { d.settings.payOutcome = 'fail'; } });
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: /모의 결제하기/ }).click();
  await waitText(page, '결제가 완료되지 않았어요');
  let d = await db(page);
  eq(d.requests.find((r) => r.id === 'rq-3').status, 'approved_pending_payment', '실패 후 요청 상태');
  eq(d.bookings.filter((b) => b.requestId === 'rq-3').length, 0, '실패 후 예약 없음');
  await patchDb(page, (x) => { x.settings.payOutcome = 'success'; }, null);
  await page.getByRole('link', { name: '승인 내용으로 돌아가기' }).click();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: /모의 결제하기/ }).click();
  await waitText(page, '예약이 확정됐어요');
  d = await db(page);
  eq(d.transactions.filter((t) => t.requestId === 'rq-3' && t.status === 'success').length, 1, '성공 거래');
});

await test('결제 처리 중·결과 확인 중: 재결제 차단, 결과 확인으로만 갱신', async (page) => {
  await start(page, { path: '/requests/rq-3/approval', patch: (d) => { d.settings.payOutcome = 'unknown'; } });
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: /모의 결제하기/ }).click();
  await waitText(page, '결제 결과를 확인하고 있어요');
  await waitText(page, '다시 결제하지 마세요');
  await page.goto(`${BASE}/requests/rq-3/approval`);
  await waitText(page, '결제 결과를 확인하는 중이라 다시 결제할 수 없어요');
  truthy(await page.getByRole('button', { name: /모의 결제하기/ }).isDisabled(), '재결제 버튼 비활성');
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
  truthy(await page.getByRole('button', { name: /모의 결제하기/ }).isDisabled(), '버전 변경 후 결제 버튼 비활성');
});

await test('재확인: 기존 그룹 종료 → 새 조건 동의 후 결제', async (page) => {
  await start(page, { path: '/requests/rq-10' });
  await waitText(page, '새 조건 확인 필요');
  await page.getByRole('link', { name: '새 예약 조건 확인하기' }).click();
  await waitText(page, '기존 공동 예약이 종료됐어요');
  await waitText(page, '혼자 부담할 수도 있어요');
  truthy(await page.getByRole('button', { name: /모의 결제하기/ }).isDisabled(), '동의 전 비활성');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: /모의 결제하기/ }).click();
  await waitText(page, '예약이 확정됐어요');
});

await test('결제: 승인 만료·종료 요청은 결제 불가 안내', async (page) => {
  await start(page, { path: '/requests/rq-7/approval' });
  await waitText(page, '지금은 결제할 수 없는 상태예요');
});

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

await test('예약 목록·상세: 진행/이용 내역, 마감 후 확정 출장비, 타 세대 정보 비노출', async (page) => {
  await start(page, { path: '/bookings' });
  await waitText(page, '지연되고 있어요');
  await page.getByRole('tab', { name: '이용 내역' }).click();
  await waitText(page, '취소됨');
  await page.goto(`${BASE}/bookings/bk-k2`);
  await waitText(page, '내 확정 출장비'); await waitText(page, '12,500원'); await waitText(page, '4세대');
  await waitText(page, '다른 세대의 주소·작업·사진은 보이지 않아요');
  const html = await page.content();
  truthy(!/anchorKey|radius:|complex:/.test(html), '내부 기준 키 노출');
});

// ───────── 예약 금액·결제(통합 카드) ─────────
const costCard = (page) => page.locator('.cost');
const costText = async (page) => (await costCard(page).innerText()).replace(/\s+/g, ' ');

await test('예약 금액·결제: 한 카드에서 총금액 → 결제한 금액 → 예상 추가 결제액, 중복 영역 없음', async (page) => {
  await start(page, { path: '/bookings/bk-k4' });
  await waitText(page, '예약 금액·결제');
  const t = await costText(page);
  for (const part of ['예상 작업비 40,000원', '예상 부품·자재비 5,000원', '내 확정 출장비 16,666원', '예상 총금액 61,666원', '예상 추가 결제액 11,666원', '작업 완료 후 합의된 실제 내역으로 최종 정산됩니다.']) {
    truthy(t.includes(part), `카드에 “${part}” 없음: ${t}`);
  }
  truthy(/결제한 예약금 −\s?(차감 )?50,000원/.test(t), `선결제 차감 표시: ${t}`);
  const main = await page.locator('main').innerText();
  for (const gone of ['금액·자재', '결제·변경 기록', '최종 정산에 쓸 선결제']) truthy(!main.includes(gone), `이전 영역 남음: ${gone}`);
  eq(await costCard(page).getByRole('button').count(), 0, '금액 카드에 결제·취소 버튼 없음');
  truthy(!(await costCard(page).innerText()).includes('예약 취소'), '취소는 예약 관리 영역에만');
  await page.getByRole('link', { name: '예약 취소하기' }).waitFor();
  // 출장비 상세: 그룹 총액·세대·절감액은 펼쳤을 때만
  eq(await page.getByText('그룹 총 출장비').isVisible(), false, '접힌 상태');
  await costCard(page).getByText('출장비 계산 상세').click();
  const d1 = await costText(page);
  truthy(d1.includes('그룹 총 출장비 50,000원') && d1.includes('분담 기준 세대 수(마감 시 확정) 3세대') && d1.includes('단독 방문 대비 절감액'), `출장비 상세: ${d1}`);
  // 결제 내역: 기존 거래 상세 화면 재사용
  await costCard(page).getByText('결제 내역 보기').click();
  await waitText(page, '정산에 사용 가능한 잔액');
  await costCard(page).getByRole('link', { name: /예약금/ }).click();
  await page.waitForURL((u) => u.pathname.startsWith('/ledger/'));
  // 일정 변경 제안은 별도 영역에서 계속 접근 가능
  await page.goto(`${BASE}/bookings/bk-k4`);
  await page.getByRole('heading', { name: '일정 변경' }).waitFor();
  await page.getByRole('link', { name: /업체 변경 제안/ }).click();
  await page.waitForURL((u) => u.pathname === '/proposals/pr-k4');
});

await test('예약 금액·결제: 마감 전 예상 출장비 · 데이터 누락은 0원 대신 ‘확인 필요’', async (page) => {
  await start(page, { path: '/bookings/bk-k1' });
  await waitText(page, '현재 예상 출장비');
  truthy((await costText(page)).includes('예상 총금액'), '마감 전 예상 총금액');
  await patchDb(page, (d) => { d.approvals.find((a) => a.requestId === 'rq-k4').tasks[0].estimate = null; }, '/bookings/bk-k4');
  await waitText(page, '업체가 현장 확인 후 산정해요');
  const t = await costText(page);
  truthy(t.includes('예상 작업비') && t.includes('확인 필요'), `누락 항목: ${t}`);
  truthy(t.includes('예상 총금액 아직 산정되지 않았어요') && t.includes('예상 추가 결제액 아직 산정되지 않았어요'), `총액·차액 미산정: ${t}`);
  truthy(!/(^|\s)0원/.test(t) && !t.includes('16,666원 예상 총금액 21,666원') && !t.includes('예상 총금액 21,666원'), `0원·부분합으로 대신하지 않음: ${t}`);
});

await test('예약 금액·결제: 자재 선결제·동의 필요 자재 접근, 공제 이후 잔액', async (page) => {
  await start(page, { path: '/bookings/bk-k5' });
  await page.getByRole('heading', { name: '자재·추가 작업' }).waitFor();
  await page.locator('main').getByText('동의 필요').first().waitFor();
  await page.getByRole('link', { name: /맞춤|도어|자재/ }).filter({ hasText: '납기' }).first().click();
  await page.waitForURL((u) => u.pathname.startsWith('/materials/'));
  // 마감 후 취소된 예약: 결제·공제·환불만, 예상 총액 없음
  await page.goto(`${BASE}/bookings/bk-k16`);
  await waitText(page, '취소 환불 요청 금액');
  const t = await costText(page);
  truthy(t.includes('이미 공제·충당된 금액') && !t.includes('예상 총금액'), `취소 예약 카드: ${t}`);
});

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
  await page.waitForURL((u) => u.pathname.startsWith('/proposals/'));
  await waitText(page, '업체 응답 대기');
  const d = await db(page);
  const k3 = d.bookings.find((b) => b.id === 'bk-k3');
  eq(`${k3.visitDate} ${k3.visitTime}`, '2026-10-13 14:00', '합의 전 예약 방문 시각 유지');
  eq(d.proposals.find((p) => p.bookingId === 'bk-k3').newVisit.time, undefined, '고객 요청 단계에는 새 방문 시각 없음');
});

await test('변경(업체 제안): 수락 전 기존 시각 유지 · 거절해도 자동 취소 없음 → 업체 사유 무료 취소를 직접 선택', async (page) => {
  await start(page, { path: '/proposals/pr-k4' });
  await waitText(page, '업체 사유 변경이에요');
  await waitText(page, '기존 방문 시각'); await waitText(page, '제안된 새 방문 시각');
  await waitText(page, '처음 요청서에 낸 가능 시간(13:00~16:00) 밖의 시각이에요');
  await page.goto(`${BASE}/bookings/bk-k4`);
  await waitText(page, '변경 제안 · 확인 대기');
  truthy((await page.locator('main').innerText()).includes('10월 14일 (수) 14:00'), '수락 전 예약 방문 시각 유지');
  await page.goto(`${BASE}/proposals/pr-k4`);
  await page.getByRole('button', { name: '변경 거절하기 (기존 예약 유지)' }).click();
  await waitText(page, '자동으로 취소되지 않아요');
  await page.getByRole('button', { name: '변경 거절하기', exact: true }).click();
  await waitText(page, '변경을 거절했어요 · 기존 예약이 유지돼요');
  let d = await db(page);
  const k4 = d.bookings.find((b) => b.id === 'bk-k4');
  eq(`${k4.status} ${k4.visitDate} ${k4.visitTime}`, 'confirmed 2026-10-14 14:00', '거절 후 예약 유지');
  eq(d.refunds.filter((x) => x.bookingId === 'bk-k4').length, 0, '자동 환불 없음');
  await page.getByRole('link', { name: '업체 사유 무료 취소 · 환불 금액 확인' }).click();
  await waitText(page, '업체가 제안한 일정 변경을 거절했어요');
  await page.getByRole('button', { name: /취소/ }).last().waitFor();
  d = await db(page);
  eq(d.deductions.filter((x) => x.bookingId === 'bk-k4').length, 0, '공제 없음');
});
await test('변경(업체 제안): 수락', async (page) => {
  await start(page, { path: '/proposals/pr-k4' });
  await page.getByRole('button', { name: '변경 수락하기' }).click();
  await waitText(page, '수락됨');
  const b = (await db(page)).bookings.find((x) => x.id === 'bk-k4');
  eq(b.visitDate, '2026-10-19', '새 날짜'); truthy(b.lockedTripFee !== undefined, '확정 출장비 유지');
  eq(b.visitTime, '10:00', '새 방문 시각');
  eq(JSON.stringify(b.customerSlots), '["13:00–16:00"]', '고객 가능 시간은 그대로');
  eq(b.scheduleChanges.length, 1, '변경 기록'); eq(b.scheduleChanges[0].from.time, '14:00', '기존 시각 기록'); truthy(b.scheduleChanges[0].consentedAt, '동의 시각 기록');
  await page.getByRole('link', { name: '예약 상세 보기' }).click();
  await waitText(page, '일정 변경 기록');
  await waitText(page, '10월 19일 (월) 10:00');
});

await test('방문 시각: 요청(가능 시간) → 승인(제안 시각) → 결제 → 내 예약 목록·상세·알림이 같은 시각', async (page) => {
  await start(page, { path: '/requests/rq-4' });
  await waitText(page, '업체가 제안한 방문 시각');
  let main = await page.locator('main').innerText();
  truthy(main.includes('10월 16일 (금) 14:00'), '결제 전 제안 시각');
  truthy(main.includes('13:00~16:00'), '고객 가능 시간 표시');
  truthy(main.includes('승인만으로는 예약이 확정되지 않아요'), '승인 ≠ 예약 확정');
  await page.goto(`${BASE}/requests/rq-4/approval`);
  await waitText(page, '작업 소요 시간은 수리 내용에 따라 달라집니다.');
  truthy((await page.locator('main').innerText()).includes('10월 16일 (금) 14:00'), '승인 확인 화면 제안 시각');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: /모의 결제하기/ }).click();
  await waitText(page, '예약이 확정됐어요');
  const d = await db(page);
  const bk = d.bookings.find((b) => b.requestId === 'rq-4');
  eq(bk.visitTime, '14:00', '결제 후 확정 시각');
  truthy(d.notices[0].title.includes('방문 예정 10월 16일 (금) 14:00'), `알림: ${d.notices[0].title}`);
  await page.goto(`${BASE}/bookings/${bk.id}`);
  await waitText(page, '방문 예정');
  main = await page.locator('main').innerText();
  truthy(main.includes('10월 16일 (금) 14:00'), '예약 상세 방문 시각');
  await page.goto(`${BASE}/bookings`);
  await page.getByText('방문 예정 · 10월 16일 (금) 14:00').first().waitFor();
  truthy(!(await page.locator('main').innerText()).includes('13:00~16:00'), '목록에 가능 시간 범위를 방문 시각으로 표시하지 않음');
});

await test('방문 시각: 데이터에 없으면 추정하지 않고 ‘방문 시각 확인 필요’', async (page) => {
  await start(page, { path: '/bookings/bk-k1', patch: (d) => { delete d.bookings.find((b) => b.id === 'bk-k1').visitTime; } });
  await waitText(page, '방문 시각 확인 필요');
  truthy(!(await page.locator('main').innerText()).includes('10월 17일 (토) 13:00'), '범위 시작값으로 추정하지 않음');
  await page.goto(`${BASE}/bookings`);
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

await test('최종 정산: 112,500원 − 50,000원 = 62,500원 모의 결제', async (page) => {
  await start(page, { path: '/bookings/bk-k9/final' });
  await waitText(page, '112,500원'); await waitText(page, '62,500원');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: /62,500원 모의 결제/ }).dblclick();
  await waitText(page, '최종 잔금 결제가 완료됐어요');
  const d = await db(page);
  eq(d.transactions.filter((t) => t.bookingId === 'bk-k9' && t.kind === 'balance').length, 1, '잔금 거래 수');
  eq(d.statements.find((s) => s.bookingId === 'bk-k9').status, 'settled', '정산 상태');
});
await test('최종 정산: 차액 0원은 결제 없이 확인', async (page) => {
  await start(page, { path: '/bookings/bk-k10/final' });
  await waitText(page, '추가 결제·환불');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: /확인하기 \(추가 결제 없음\)/ }).click();
  await waitText(page, '정산이 끝났어요');
  eq((await db(page)).transactions.filter((t) => t.bookingId === 'bk-k10' && t.kind === 'balance').length, 0, '결제 없음');
});
await test('최종 정산: 환불 7,500원', async (page) => {
  await start(page, { path: '/bookings/bk-k11/final' });
  await waitText(page, '환불받을 금액');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: /7,500원 환불 요청/ }).click();
  await waitText(page, '차액 환불을 요청했어요');
  const r = (await db(page)).refunds.filter((x) => x.bookingId === 'bk-k11');
  eq(r.length, 1, '환불 건수'); eq(r[0].amount, 7500, '환불 금액');
});
await test('최종 정산: 이견 접수 시 자동 확인·청구 없음', async (page) => {
  await start(page, { path: '/bookings/bk-k9/final' });
  await page.getByRole('button', { name: '금액이 달라요' }).click();
  await page.getByRole('button', { name: '이견 접수하고 정산 보류하기' }).click();
  await waitText(page, '금액을 협의하고 있어요');
  truthy(!(await page.getByRole('button', { name: /모의 결제/ }).count()), '이견 중 결제 버튼');
  eq((await db(page)).transactions.filter((t) => t.bookingId === 'bk-k9' && t.kind === 'balance').length, 0, '청구 없음');
});
await test('최종 정산: 이미 환불·공제된 선결제는 다시 쓰지 않는다 (취소 예약)', async (page) => {
  await start(page, { path: '/bookings/bk-k18' });
  await waitText(page, '취소된 예약이에요');
  await page.locator('.cost').getByText('결제 내역 보기').click(); // 결제·공제·환불 기록은 통합 카드의 결제 내역에서
  await waitText(page, '환불 처리 요청 접수');
  const t = (await page.locator('.cost').innerText()).replace(/\s+/g, ' ');
  truthy(t.includes('이미 공제·충당된 금액') && t.includes('취소 환불 요청 금액') && !t.includes('이미 환불 요청한 금액'), `공제·환불 구분 표시: ${t}`);
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
  await start(page, { path: '/requests', patch: (d) => { d.requests = []; d.approvals = []; d.bookings = []; d.transactions = []; d.refunds = []; d.deductions = []; d.proposals = []; d.delays = []; d.materials = []; d.additionalWorks = []; d.statements = []; d.reviews = []; } });
  await waitText(page, '아직 보낸 수리 요청이 없어요.');
  eq(await page.locator('.filter-bar').count(), 0, '요청이 없으면 필터 숨김');
  await page.locator('.empty').getByRole('link', { name: '업체 찾기' }).waitFor();
  await page.goto(`${BASE}/bookings`); await waitText(page, '진행 중인 예약이 없어요');
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
const reqBtn = (page) => page.getByRole('button', { name: '선택한 일정으로 수리 요청하기' });

await test('공동 예약 캘린더: 신청 가능한 날짜만 활성화(마감·자리 없음 제외), 처음엔 자동 선택 없음', async (page) => {
  await start(page, { path: '/providers/p1' });
  await page.locator('.jcal').waitFor();
  eq(await page.locator('.jcal__title').innerText(), '2026년 10월', '처음 보여주는 달');
  await waitText(page, '공동 예약 날짜를 선택해주세요.');
  const enabled = await page.locator('.jcal button[data-day]:not([disabled])').evaluateAll((els) => els.map((e) => e.dataset.day));
  eq(JSON.stringify(enabled), JSON.stringify(['2026-10-16']), '활성 날짜(10/17 g3은 남은 자리 0, 10/20 g2는 주소 범위 밖)');
  truthy(await dayBtn(page, '10-17').isDisabled(), '자리 없는 날짜 비활성');
  truthy(await dayBtn(page, '10-12').isDisabled(), '지난 날짜 비활성');
  eq(await page.locator('input[name="joint-group"]').count(), 0, '날짜 선택 전 카드 없음');
  truthy(await reqBtn(page).isDisabled(), '요청 버튼 비활성');
  // 접근성 이름·오늘 표시(색 외 ‘오늘’ 글자)
  eq(await dayBtn(page, '10-13').getAttribute('aria-label'), '2026년 10월 13일 화요일, 오늘, 신청 가능한 공동 예약 없음', '오늘 이름');
  truthy((await dayBtn(page, '10-13').innerText()).includes('오늘'), '오늘 글자');
  eq(await dayBtn(page, '10-16').getAttribute('aria-label'), '2026년 10월 16일 금요일, 신청 가능한 공동 예약 2개', '가능 날짜 이름');
  eq(await dayBtn(page, '10-16').locator('.jcal__dot').count(), 1, '가능 날짜 점');
  // 비활성 날짜는 눌러도 아무 일 없음
  await dayBtn(page, '10-17').click({ force: true });
  await waitText(page, '공동 예약 날짜를 선택해주세요.');
  await page.screenshot({ path: join(ROOT, 'e2e/screens/390_provider_calendar.png'), fullPage: true });
});

await test('공동 예약 캘린더: 날짜 선택 → 그 날짜 카드만, 같은 날 여러 그룹 비교·단일 선택, 날짜만으로는 요청 불가', async (page) => {
  await start(page, { path: '/providers/p1' });
  await dayBtn(page, '10-16').click();
  await waitText(page, '10월 16일(금)의 공동 예약');
  eq(await dayBtn(page, '10-16').getAttribute('aria-pressed'), 'true', '선택 표시');
  const cards = page.locator('.joint-card');
  await page.locator('.joint-card').first().waitFor(); 
  eq(await cards.count(), 2, '같은 날 두 그룹');
  eq(await page.locator('input[name="joint-group"]:checked').count(), 0, '그룹 자동 선택 없음');
  truthy(await reqBtn(page).isDisabled(), '날짜만 선택하면 비활성');
  const t1 = await cards.nth(0).innerText(); const t2 = await cards.nth(1).innerText();
  truthy(t1.includes('09:00~12:00') && t1.includes('약 12,500원') && t1.includes('본인 예약 확정 시 4세대 기준') && t1.includes('남은 자리') && t1.includes('2자리') && t1.includes('3세대'), `g1 카드: ${t1}`);
  truthy(t2.includes('13:00~16:00') && t2.includes('약 22,500원') && t2.includes('본인 예약 확정 시 2세대 기준') && t2.includes('10월 15일 (목) 12:00'), `g1b 카드: ${t2}`);
  truthy(!t1.includes('그룹 총 출장비') || !(await cards.nth(0).locator('details').evaluate((d) => d.open)), '계산 상세는 접혀 있음');
  eq(await page.getByText('정확한 방문 시각은 업체가 승인할 때 제안해요').count(), 1, '공통 안내는 한 번만');
  // 계산 상세: 숫자와 기준 일치
  await cards.nth(0).getByText('출장비 계산 상세').click();
  const d1 = await cards.nth(0).locator('details').innerText();
  truthy(d1.includes('50,000원') && d1.includes('1자리 · 분담 세대 수에서 제외') && d1.includes('50,000원 ÷ 4세대') && d1.includes('약 12,500원') && d1.includes('37,500원(75%) 덜 내요') && d1.includes('마감 때 확정된 세대 수'), `계산 상세: ${d1}`);
  truthy(!(await page.locator('input[name="joint-group"]:checked').count()), '계산 상세를 펼쳐도 선택되지 않음');
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

await test('공동 예약 캘린더: 월 이동(다음 달 일정)·날짜 변경 시 이전 그룹 선택 해제·선택 날짜 제목 유지', async (page) => {
  await start(page, { path: '/providers/p1' });
  await dayBtn(page, '10-16').click();
  await page.locator('.joint-card input').first().check();
  truthy(await reqBtn(page).isEnabled(), '선택');
  truthy(await page.getByRole('button', { name: '이전 달' }).isDisabled(), '이번 달 이전으로는 이동 불가');
  await page.getByRole('button', { name: '다음 달' }).click();
  eq(await page.locator('.jcal__title').innerText(), '2026년 11월', '다음 달');
  // 월만 옮기면 선택 날짜·카드는 유지되고 제목에 날짜가 남는다
  await waitText(page, '10월 16일(금)의 공동 예약');
  truthy(await reqBtn(page).isEnabled(), '월 이동만으로는 선택 유지');
  await page.locator('.jcal button[data-day="2026-11-03"]').click();
  await waitText(page, '11월 3일(화)의 공동 예약');
  eq(await page.locator('input[name="joint-group"]:checked').count(), 0, '다른 날짜를 고르면 이전 그룹 해제');
  truthy(await reqBtn(page).isDisabled(), '날짜 변경 후 비활성');
  await page.locator('.joint-card').first().waitFor(); 
  eq(await page.locator('.joint-card').count(), 1, '11/3 카드만');
  // 키보드: 방향키로 신청 가능 날짜 이동, Enter로 선택
  await page.getByRole('button', { name: '이전 달' }).click();
  await dayBtn(page, '10-16').focus();
  await page.keyboard.press('Enter');
  await waitText(page, '10월 16일(금)의 공동 예약');
  truthy(await dayBtn(page, '10-16').evaluate((el) => el === document.activeElement && getComputedStyle(el).outlineStyle !== 'none'), '키보드 포커스 표시');
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
  await waitText(page, '2027년 1월 8일(금)의 공동 예약');
  await page.getByRole('button', { name: '이전 달' }).click();
  eq(await page.locator('.jcal__title').innerText(), '2026년 12월', '이전 해로');
  await page.getByRole('button', { name: '다음 달' }).click(); await page.getByRole('button', { name: '다음 달' }).click();
  eq(await page.locator('.jcal__title').innerText(), '2027년 2월', '다음 해 2월');
  truthy(await page.locator('.jcal button[data-day="2027-02-02"]').isEnabled(), '2월 일정');
});

await test('공동 예약 캘린더: 공동 일정 없음 → 안내·새 날짜 요청 / 날짜 조회 오류 → 재시도', async (page) => {
  await start(page, { path: '/providers/p1', address: 'ad-far' });
  await waitText(page, '현재 신청 가능한 공동 예약이 없어요.');
  eq(await page.locator('.jcal').count(), 0, '캘린더 없음');
  await page.getByRole('link', { name: '다른 날짜로 새 예약 요청' }).click();
  await page.waitForURL((u) => u.pathname === '/providers/p1/request' && u.searchParams.get('new') === '1');
  await start(page, { path: '/providers/p1' });
  await page.locator('.jcal').waitFor();
  // 다음 조회(날짜별) 1회 실패: 저장소 변경 알림 없이 설정해 다른 화면 조회에는 영향을 주지 않는다
  await page.waitForFunction(() => !!window.__sagoDev);
  await page.evaluate(() => { window.__sagoDev.db.settings.failNextQuery = true; });
  await dayBtn(page, '10-16').click();
  await page.getByRole('button', { name: '다시 시도' }).click();
  await page.locator('.joint-card').first().waitFor(); 
  eq(await page.locator('.joint-card').count(), 2, '재시도 후 카드');
});

await test('공동 예약 캘린더: 선택 후 그룹이 마감·자리 없음이 되면 선택 해제·사유·다른 일정 제공', async (page) => {
  await start(page, { path: '/providers/p1' });
  await dayBtn(page, '10-16').click();
  await page.locator('.joint-card').nth(1).locator('input').check(); // g1b
  await dev(page, 'closeGroup', 'g1b'); // 업체가 접수 마감
  await waitText(page, '선택한 일정을 신청할 수 없게 됐어요');
  await waitText(page, '접수가 마감·종료됐거나');
  eq(await page.locator('input[name="joint-group"]:checked').count(), 0, '선택 해제');
  truthy(await reqBtn(page).isDisabled(), '요청 버튼 비활성');
  eq(await page.locator('.joint-card').count(), 1, '같은 날짜의 다른 일정');
  truthy(await page.getByRole('link', { name: '다른 날짜로 새 예약 요청' }).isVisible(), '새 날짜 요청');
  // 자리 없음: 화면 갱신 알림 없이 다른 고객이 자리를 채운 상황 → 요청 버튼을 누를 때 최신 상태로 다시 확인
  await page.locator('.joint-card input').first().check(); // g1
  await page.evaluate(() => { const g = window.__sagoDev.db.groups.find((x) => x.id === 'g1'); g.pendingSeats = g.capacity - g.confirmedHouseholds; });
  await reqBtn(page).click();
  await waitText(page, '남은 자리가 없어요.');
  eq(new URL(page.url()).pathname, '/providers/p1', '요청서로 넘어가지 않음');
  eq(await page.locator('input[name="joint-group"]:checked').count(), 0, '선택 해제');
  truthy(await reqBtn(page).isDisabled(), '요청 버튼 비활성');
});

for (const w of [360, 1280]) {
  await test(`공동 예약 캘린더: ${w}px 표시 — 날짜 칸·월 이동 버튼 크기, 펼친 카드가 넘치지 않음`, async (page) => {
    await page.setViewportSize({ width: w, height: 900 });
    await start(page, { path: '/providers/p1' });
    const sz = await page.evaluate(() => [...document.querySelectorAll('.jcal__day, .jcal__head .icon-btn')].map((b) => { const r = b.getBoundingClientRect(); return Math.min(r.width, r.height); }));
    truthy(Math.min(...sz) >= 40, `조작 영역이 작음: ${Math.min(...sz)}`);
    await dayBtn(page, '10-16').click();
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
    if (!(await page.locator('input[name="joint-group"]:checked').count())) {
      await dayBtn(page, '10-16').click();
      await page.locator('.joint-card').nth(1).locator('input').check();
    }
    await reqBtn(page).click();
    await page.waitForURL((u) => u.pathname === '/providers/p1/request');
    eq(new URL(page.url()).searchParams.get('group'), 'g1b', '선택한 그룹으로 요청서');
    await waitText(page, '수리 요청서');
    await headerBack(page).click();
    await page.waitForURL((u) => u.pathname === '/providers/p1');
    eq(await histIdx(page), detailIdx, `#${i + 1} 같은 기록 항목으로 복귀(새 기록 아님)`);
    await page.locator('.joint-card').first().waitFor();
    eq(await page.locator('.jcal button[aria-pressed="true"]').getAttribute('data-day'), '2026-10-16', '선택 날짜 유지');
    truthy(await page.locator('.joint-card').nth(1).locator('input').isChecked(), '선택 그룹 유지');
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

await test('요청서 뒤로가기: 새 날짜 요청 → 요청서 → 상단 뒤로 → 업체 상세 → 다시 요청 흐름 정상', async (page) => {
  await openDetailFromList(page);
  const detailIdx = await histIdx(page);
  await page.getByRole('link', { name: '다른 날짜로 새 예약 요청' }).click();
  await page.waitForURL((u) => u.pathname === '/providers/p1/request' && u.searchParams.get('new') === '1');
  await waitText(page, '수리 요청서');
  await headerBack(page).click();
  await page.waitForURL((u) => u.pathname === '/providers/p1');
  eq(await histIdx(page), detailIdx, '같은 기록 항목');
  eq(await page.locator('input[name="joint-group"]:checked').count(), 0, '공동 그룹 선택 없음');
  await page.getByRole('link', { name: '다른 날짜로 새 예약 요청' }).click();
  await waitText(page, '수리 요청서');
});

await test('요청서 뒤로가기: 브라우저 뒤로·앞으로 — 선택 유지, 자동 이동 없음, 요청 생성 없음', async (page) => {
  await openDetailFromList(page);
  const req0 = (await db(page)).requests.length;
  await dayBtn(page, '10-16').click();
  await page.locator('.joint-card').first().locator('input').check();
  await reqBtn(page).click();
  await page.waitForURL((u) => u.pathname === '/providers/p1/request');
  for (let i = 0; i < 3; i++) {
    await page.goBack();
    await page.waitForURL((u) => u.pathname === '/providers/p1');
    await page.locator('.joint-card').first().waitFor();
    truthy(await page.locator('.joint-card').first().locator('input').isChecked(), `#${i + 1} 브라우저 뒤로 후 선택 유지`);
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
  await page.evaluate(() => { history.pushState({ usr: { returnTo: '//evil.example/x' }, key: 'x1', idx: 5 }, '', '/providers/p1/request?new=1'); dispatchEvent(new PopStateEvent('popstate', { state: history.state })); });
  await waitText(page, '수리 요청서');
  await headerBack(page).click();
  await page.waitForURL((u) => u.pathname === '/providers/p1');
  eq(new URL(page.url()).origin, BASE, '앱 안에 머무름');
});

await test('요청서 뒤로가기: 요청서에 있는 동안 그룹이 마감되면 돌아왔을 때 선택 해제·사유 안내', async (page) => {
  await openDetailFromList(page);
  await dayBtn(page, '10-16').click();
  await page.locator('.joint-card').nth(1).locator('input').check(); // g1b
  await reqBtn(page).click();
  await waitText(page, '수리 요청서');
  await dev(page, 'closeGroup', 'g1b');
  await headerBack(page).click();
  await page.waitForURL((u) => u.pathname === '/providers/p1');
  await waitText(page, '선택한 일정을 신청할 수 없게 됐어요');
  eq(await page.locator('input[name="joint-group"]:checked').count(), 0, '선택 해제');
  truthy(await reqBtn(page).isDisabled(), '요청 버튼 비활성');
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

await test('비교 요청: 업체별 응답 요약 카드 — 결제 대기는 방문·예상 총금액·결제 기한·상세 조건 보기만, 상태별 행동 연결', async (page) => {
  await start(page, { path: '/requests/bundle/b-sink', patch: fiveSink });
  await respCards(page).first().waitFor();
  eq(await bundleTitle(page).innerText(), '업체별 응답 · 5곳', '전체 업체 수');
  eq(await respCards(page).count(), 5, '카드 5개');
  const hb = await respCard(page, '한빛설비').innerText();
  truthy(hb.includes('업체 승인 완료 · 결제 대기') && hb.includes('방문 예정') && hb.includes('10월 16일 (금)') && hb.includes('10:00') && hb.includes('약 112,500원') && hb.includes('결제 기한') && hb.includes('남음'), `결제 대기 카드: ${hb}`);
  truthy(!/그룹 총 출장비|예약금|부품·자재|업체 견적/.test(hb), `요약 카드에 상세 금액이 펼쳐짐: ${hb}`);
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

await test('비교 요청: 상태 필터(결제 대기·추가 정보 필요·업체 검토 중·종료) 건수·빈 결과·전체로 해제, 다른 묶음에는 적용 안 됨', async (page) => {
  await start(page, { path: '/requests/bundle/b-sink', patch: [fiveSink, (d) => { d.requests.find((r) => r.id === 'rq-s5').status = 'withdrawn'; }] });
  await respCards(page).first().waitFor();
  for (const [label, n, q] of [['결제 대기', 2, 'payment_pending'], ['추가 정보 필요', 1, 'needs_info'], ['업체 검토 중', 1, 'reviewing'], ['종료', 1, 'ended']]) {
    await pickBundleStatus(page, label);
    await page.waitForURL((u) => u.searchParams.get('status') === q);
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
  eq(await page.locator('.resp-card').filter({ hasText: '예약 완료' }).count(), 0, '예약 완료는 종료에 없음');
});

await test('비교 요청: 예상 총금액 = 승인 조건 화면 예상 총액, 견적 누락 시 금액 확인 필요(0원 대체 없음)', async (page) => {
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

await test('비교 요청: 상세에서 돌아오면 필터·목록 위치 복원', async (page) => {
  await page.setViewportSize({ width: 390, height: 600 });
  await start(page, { path: '/requests/bundle/b-sink', patch: fiveSink });
  await respCards(page).first().waitFor();
  await pickBundleStatus(page, '결제 대기');
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
  await test(`비교 요청: ${w}px 1곳·2곳·여러 곳 배치(데스크톱 2열·모바일 1열), 긴 이름·배지 겹침 없음`, async (page) => {
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

await test('비교 요청: 한 업체 결제 → 같은 작업의 다른 업체 요청은 종료(기존 정책 유지), 카드에 실제 사유', async (page) => {
  await start(page, { path: '/requests/bundle/b-sink' });
  await respCard(page, '한빛설비').getByRole('link', { name: '상세 조건 보기' }).click();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: /모의 결제하기/ }).click();
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
  await dayBtn(page, '10-16').click();
  await page.locator('.joint-card').first().locator('input').check();
  await reqBtn(page).click();
  await waitText(page, '수리 요청서');
  await expectStep(page, 'request', '수리 요청', 0, null, '요청서');
  await page.getByLabel('어떤 작업인가요?').fill('주방 수전 교체');
  await page.getByLabel('상세 주소', { exact: true }).fill('301동 1204호');
  await page.getByRole('button', { name: '09:00~12:00' }).click();
  await page.getByRole('button', { name: '요청 보내기' }).click();
  await waitText(page, '요청을 보냈어요');
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
  await page.goto(`${BASE}/requests/${id}/approval`);
  await expectStep(page, 'request', '예약금 결제', 2, null, '승인 조건 확인');
  const bk0 = (await db(page)).bookings.length;
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: /모의 결제하기/ }).click();
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
  for (const b of ['승인 조건 확인하고 결제하기', '요청서 보완하기', '이 업체 요청 철회하기']) eq(await page.getByRole('button', { name: b }).or(page.getByRole('link', { name: b })).count(), 0, `${b} 없음`);
  await page.getByRole('link', { name: '예약 보기' }).click();
  await page.waitForURL((u) => u.pathname === `/bookings/${req.bookingId}`);
  // 승인 화면을 직접 열어도 다시 결제할 수 없다
  await page.goto(`${BASE}/requests/${id}/approval`);
  await waitText(page, '지금은 결제할 수 없는 상태예요');
  eq(await page.getByRole('button', { name: /모의 결제하기/ }).count(), 0, '재결제 버튼 없음');
  eq(await stepState(page), null, '완료 요청의 승인 화면에 진행 표시 없음');
});

await test('진행 과정: 비교 요청은 합친 단계 없음, 예약한 업체는 예약 완료·예약 보기, 같은 묶음 다른 업체는 다른 업체 예약으로 종료', async (page) => {
  await start(page, { path: '/requests/rq-3/approval' });
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: /모의 결제하기/ }).click();
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
  // 내 요청 목록 필터 표시는 ‘예약 완료’
  await page.goto(`${BASE}/requests`);
  await page.getByRole('button', { name: /^요청 상태 필터/ }).click();
  await page.getByRole('dialog').getByText('예약 완료', { exact: true }).waitFor();
  eq(await page.getByRole('dialog').getByText('예약 확정', { exact: true }).count(), 0, '요청 필터에 ‘예약 확정’ 문구 없음');
});

await test('진행 과정: 결제 실패·결과 확인 중은 내 요청 3단계(예약 확정 표시 없음), 확인 성공 시 예약 상세로', async (page) => {
  await start(page, { path: '/requests/rq-3/approval', patch: (d) => { d.settings.payOutcome = 'fail'; } });
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: /모의 결제하기/ }).click();
  await waitText(page, '결제가 완료되지 않았어요');
  await expectStep(page, 'request', '예약금 결제', 2, '결제가 완료되지 않았어요', '결제 실패');
  eq(await page.locator('nav.steps[data-flow="booking"]').count(), 0, '실패 시 예약 과정 없음');
  await patchDb(page, (d) => { d.settings.payOutcome = 'unknown'; d.settings.resolveOutcome = 'unknown'; }, '/requests/rq-3/approval');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: /모의 결제하기/ }).click();
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
  // 기존 결제 결과 화면도 내 예약 과정과 ‘예약 보기’
  await page.goto(payUrl);
  await expectStep(page, 'booking', '예약 확정', 0, null, '결제 결과(성공)');
  eq(await page.getByRole('link', { name: '예약 보기' }).count(), 1, '예약 보기');
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
  for (const p of ['/bookings', '/bookings?tab=past', '/bookings/bk-k1/change', '/bookings/bk-k1/cancel', '/bookings/bk-k9/final', '/requests', '/', '/providers/p1', '/me']) {
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
  await page.locator('a.cat').nth(1).click();
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
  await page.locator('a.cat').nth(4).click();
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
const ROUTES_FOR_AUTH_SCAN = ['/', '/address', '/providers?category=c2', '/providers/p1', '/providers/p1/request?group=g1', '/requests', '/requests/rq-3', '/requests/rq-3/approval', '/bookings', '/bookings?tab=past', '/bookings/bk-k2', '/bookings/bk-k2/cancel', '/bookings/bk-k9/final', '/ledger', '/me', '/guide', '/없는화면'];

await test('로그인 없는 데모: 첫 접속은 바로 업체 찾기(로그인 화면·대기 없음)', async (page) => {
  await page.goto(`${BASE}/`);
  await waitText(page, '이웃과 같은 날 예약하면 출장비를 나눠 내요.');
  eq(pathOf(page), '/', '첫 화면');
  eq(await page.locator('.boot, [aria-busy="true"] .btn__spin').count(), 0, '세션 확인 대기 화면 없음');
  truthy(!AUTH_WORDS.test(await page.locator('body').innerText()), '로그인 관련 문구');
});

await test('로그인 없는 데모: 내부 화면 직접 접근·새로고침 정상(내 요청·내 예약·내 정보·상세)', async (page) => {
  await start(page, { path: '/' });
  for (const [p, text] of [['/requests', '업체 승인 완료 · 결제 대기'], ['/bookings', '예약'], ['/me', '내역·안내'], ['/bookings/bk-k2', '예약 금액·결제'], ['/requests/rq-3', '업체가 제안한 방문 시각']]) {
    await page.goto(`${BASE}${p}`);
    await waitText(page, text);
    eq(pathOf(page), p, `${p} 직접 접근`);
    await page.reload();
    await waitText(page, text);
    eq(pathOf(page), p, `${p} 새로고침`);
  }
});

await test('로그인 없는 데모: 이전 인증 주소는 업체 찾기로 이동', async (page) => {
  await start(page, { path: '/' });
  for (const p of ['/login', '/signup', '/signup/done', '/password/reset', '/password/reset/sent', '/password/new', '/login?next=/bookings']) {
    await page.goto(`${BASE}${p}`);
    await page.waitForURL((u) => u.pathname === '/');
    await waitText(page, '이웃과 같은 날 예약하면 출장비를 나눠 내요.');
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
  for (const p of ['/requests', '/bookings', '/me', '/providers/p1/request?new=1']) { await page.goto(`${BASE}${p}`); await page.waitForTimeout(300); }
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
const FILTER_PAGES = [['/requests', '내 요청'], ['/bookings', '내 예약 진행 중'], ['/bookings?tab=past', '내 예약 이용 내역']];
for (const [w, hgt] of [[1280, 720], [390, 844]]) {
  for (const scroll of [true, false]) {
    await test(`필터 열기·닫기: 화면이 옆으로 밀리지 않음(${w}px, 스크롤바 ${scroll ? '있음' : '없음'}, 내 요청·내 예약 모든 필터 3회 반복)`, async (page) => {
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
    for (const path of ['/requests', '/bookings', '/bookings?tab=past']) {
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
  eq(await page.getByRole('dialog', { name: '이 요청을 철회할까요?' }).count(), 0, 'ESC로 닫기');
  await page.keyboard.press('Shift+Tab'); // 열었던 버튼에서 이전 요소로 이동 가능해야 한다
  const focused = await page.evaluate(() => document.activeElement?.tagName);
  truthy(focused && focused !== 'BODY', `키보드 포커스 이동 (활성 요소: ${focused})`);
});

// ───────── 반응형 ─────────
const WIDTHS = [360, 390, 430, 768, 1280];
const ROUTES = ['/', '/address', '/providers?category=c2', '/providers/p1', '/providers/p1/request?group=g1', '/requests', '/requests/bundle/b-sink', '/requests/rq-3', '/requests/rq-2/supplement',
  '/requests/rq-3/approval', '/requests/rq-10/recheck', '/bookings', '/bookings/bk-k2', '/bookings/bk-k4', '/bookings/bk-k5', '/bookings/bk-k16', '/bookings/bk-k2/change', '/bookings/bk-k2/cancel', '/delays/dl-k3', '/proposals/pr-k4', '/materials/mt-1',
  '/additional/aw-1', '/bookings/bk-k9/final', '/bookings/bk-k14', '/bookings/bk-k13/review', '/ledger', '/me', '/guide'];
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
console.log(`\n${results.length - failed.length}/${results.length} 통과`);
if (!only) {
  const lines = [`# e2e 점검 기록`, '', `실행: ${new Date().toISOString()} · 브라우저: Chromium(headless) · 목업 시계 2026-10-13 19:00 (Asia/Seoul)`, '', `결과: **${results.length - failed.length}/${results.length} 통과**`, '', '| 결과 | 점검 | 비고 |', '|---|---|---|',
    ...results.map((r) => `| ${r.ok ? '통과' : '실패'} | ${r.name} | ${r.error ?? ''} |`)];
  mkdirSync(join(ROOT, 'docs'), { recursive: true });
  writeFileSync(join(ROOT, 'docs/e2e-report.md'), lines.join('\n') + '\n');
}
process.exit(failed.length ? 1 : 0);
