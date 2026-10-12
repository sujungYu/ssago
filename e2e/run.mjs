/**
 * 사용자 화면 e2e 점검. 데모 빌드(개발용 시나리오 도구 포함)를 미리보기 서버로 띄워 실제 브라우저로 흐름을 따라간다.
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
const DB_KEY = 'on-gimae/mock-db/v2';
const APP_KEY = 'on-gimae/app-state/v1';

// e2e는 실제 Supabase 프로젝트 대신 아래 가짜 Supabase Auth 서버(브라우저 요청 가로채기)로 인증 흐름을 확인한다.
// 실제 프로젝트 설정·이메일 발송·서버 정책은 이 점검으로 확인되지 않는다.
const SB_URL = 'https://e2e-demo.supabase.co';
const SB_STORAGE = 'sb-e2e-demo-auth-token';
const E2E_USER = { email: 'e2e@ongimae.test', password: 'e2e-pass-123' };

// npx 대신 node로 vite를 직접 실행한다(Windows에서도 셸 없이 실행·종료되도록).
const VITE = join(ROOT, 'node_modules/vite/bin/vite.js');
const vite = (args, opts = {}) => spawnSync(process.execPath, [VITE, ...args], { cwd: ROOT, stdio: 'inherit', ...opts });

// ───────── 빌드·서버 ─────────
if (!process.env.E2E_SKIP_BUILD) {
  const env = { ...process.env, VITE_SUPABASE_URL: SB_URL, VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_e2e_dummy', VITE_AUTH_PASSWORD_MIN_LENGTH: '8' };
  if (vite(['build', '--mode', 'demo'], { env }).status !== 0) process.exit(1);
}
const server = spawn(process.execPath, [VITE, 'preview', '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'ignore' });
const stopServer = () => { try { server.kill(); } catch { /* ignore */ } };
process.on('exit', stopServer);
for (let i = 0; i < 50; i++) {
  try { if ((await fetch(BASE)).ok) break; } catch { /* wait */ }
  await new Promise((r) => setTimeout(r, 200));
}

const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });

// ───────── 가짜 Supabase Auth ─────────
const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const userObj = (u) => ({
  id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, email_confirmed_at: u.confirmed ? '2026-10-08T00:00:00Z' : null,
  app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {},
  identities: [{ id: u.id, user_id: u.id, provider: 'email', identity_data: { email: u.email, sub: u.id } }],
  created_at: '2026-10-08T00:00:00Z', updated_at: '2026-10-08T00:00:00Z',
});
class FakeSupabase {
  constructor() { this.users = new Map(); this.tokens = new Map(); this.calls = []; this.offline = false; this.confirmEmail = false; this.delayMs = 0; this.seq = 0; this.add(E2E_USER); }
  add({ email, password }) { const u = { id: `00000000-0000-4000-8000-${String(++this.seq).padStart(12, '0')}`, email, password, confirmed: true }; this.users.set(email, u); return u; }
  issue(u) {
    const now = Math.floor(Date.now() / 1000);
    const access_token = `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ sub: u.id, email: u.email, aud: 'authenticated', role: 'authenticated', exp: now + 3600, iat: now, session_id: `s${now}${u.id}` })}.sig`;
    const s = { access_token, token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: `rt-${u.id}-${now}-${Math.random()}`, user: userObj(u) };
    this.tokens.set(access_token, u); this.tokens.set(s.refresh_token, u);
    return s;
  }
  revokeAll() { this.tokens.clear(); }
  async handle(route) {
    const req = route.request();
    // 실제 Supabase처럼 API 버전 헤더를 노출해야 SDK가 오류 code를 읽는다.
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': 'x-supabase-api-version', 'x-supabase-api-version': '2024-01-01' };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (this.offline) return route.abort('internetdisconnected');
    if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
    const url = new URL(req.url());
    const path = url.pathname.replace('/auth/v1', '');
    this.calls.push(`${req.method()} ${path}${url.searchParams.get('grant_type') ? `?${url.searchParams.get('grant_type')}` : ''}`);
    const body = (() => { try { return req.postDataJSON() ?? {}; } catch { return {}; } })();
    const bearer = (req.headers().authorization ?? '').replace(/^Bearer /, '');
    const json = (status, data) => route.fulfill({ status, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(data) });
    if (path === '/signup' && req.method() === 'POST') {
      if (this.users.has(body.email)) return json(422, { code: 'user_already_exists', msg: 'User already registered' });
      const u = this.add(body);
      if (this.confirmEmail) { u.confirmed = false; return json(200, { ...userObj(u), confirmation_sent_at: '2026-10-08T00:00:00Z' }); }
      return json(200, this.issue(u));
    }
    if (path === '/token' && url.searchParams.get('grant_type') === 'password') {
      const u = this.users.get(body.email);
      if (!u || u.password !== body.password) return json(400, { code: 'invalid_credentials', msg: 'Invalid login credentials' });
      if (!u.confirmed) return json(400, { code: 'email_not_confirmed', msg: 'Email not confirmed' });
      return json(200, this.issue(u));
    }
    if (path === '/token' && url.searchParams.get('grant_type') === 'refresh_token') {
      const u = this.tokens.get(body.refresh_token);
      return u ? json(200, this.issue(u)) : json(400, { code: 'refresh_token_not_found', msg: 'Invalid Refresh Token' });
    }
    if (path === '/user' && req.method() === 'GET') {
      const u = this.tokens.get(bearer);
      return u ? json(200, userObj(u)) : json(403, { code: 'bad_jwt', msg: 'invalid JWT' });
    }
    if (path === '/user' && req.method() === 'PUT') {
      const u = this.tokens.get(bearer);
      if (!u) return json(401, { code: 'no_authorization', msg: 'no auth' });
      if (body.password) u.password = body.password;
      return json(200, userObj(u));
    }
    if (path === '/logout') { this.tokens.delete(bearer); return route.fulfill({ status: 204, headers: cors }); }
    if (path === '/recover') return json(200, {});
    return json(404, { code: 'not_found', msg: 'not found' });
  }
}

// ───────── 도우미 ─────────
const results = [];
const only = process.env.E2E_ONLY;
async function test(name, fn, opts = {}) {
  if (only && !name.includes(only)) return;
  const ctx = await browser.newContext({ viewport: { width: opts.width ?? 390, height: 844 } });
  const fake = new FakeSupabase();
  await ctx.route(`${SB_URL}/**`, (route) => fake.handle(route));
  const page = await ctx.newPage();
  page.fake = fake;
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
 * 새 세션으로 시작. patch(db)로 목업 상태를 미리 바꿀 수 있다.
 * login=true(기본)면 가짜 Supabase가 발급한 세션을 SDK 저장 위치(localStorage)에 넣고 시작한다.
 */
async function start(page, { path = '/', address = 'ad-apt', patch, latency = 30, login = true } = {}) {
  await page.goto(`${BASE}/login`); // 같은 출처에서 저장소 준비
  const session = login ? page.fake.issue(page.fake.users.get(E2E_USER.email)) : null;
  await page.evaluate(([sbKey, s]) => {
    sessionStorage.clear(); localStorage.clear();
    if (s) localStorage.setItem(sbKey, JSON.stringify(s));
  }, [SB_STORAGE, session]);
  await page.goto(`${BASE}${path}`); // 앱이 시드 DB를 만들어 저장
  // 로그인 계정이 정해질 때 이전 사용자 상태(방문 지역 등)를 지우므로, 방문 지역은 그 뒤에 넣는다(다음 이동 때 읽힘).
  if (login) await page.waitForFunction((k) => !!JSON.parse(sessionStorage.getItem(k) ?? '{}').ownerAccountId, DB_KEY);
  await page.evaluate(([appKey, addr]) => { if (addr) sessionStorage.setItem(appKey, JSON.stringify({ addressId: addr })); }, [APP_KEY, address]);
  await page.evaluate(() => new Promise((r) => setTimeout(r, 50)));
  const fns = [new Function('db', `db.settings.latencyMs = ${Number(latency)};`)];
  if (patch) fns.push(patch);
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
const db = (page) => page.evaluate((k) => JSON.parse(sessionStorage.getItem(k)), DB_KEY);
const txt = (page, t, o = {}) => page.getByText(t, { exact: false, ...o }).first();
const waitText = (page, t, o) => txt(page, t, o).waitFor();

// ═════════ 점검 ═════════
console.log('\n싸고 사용자 화면 e2e\n');

await test('탐색: 주소 설정 → 카테고리 → 업체 목록(공동 예약 표시) → 업체 상세', async (page) => {
  await start(page, { address: null });
  await page.getByRole('link', { name: '방문 지역 설정하기' }).click();
  await page.getByLabel('주소 검색').fill('햇살');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: /햇살마을 3단지/ }).click();
  await waitText(page, '업체 찾기', { exact: true }).catch(() => {});
  await page.getByRole('link', { name: /수전·샤워기·배수 부품/ }).click();
  await waitText(page, '한빛설비');
  await waitText(page, '공동 예약 가능');
  await waitText(page, '예상 출장비');
  await page.getByRole('link', { name: /한빛설비/ }).first().click();
  await waitText(page, '공동 예약 일정');
  await waitText(page, '약 12,500원');
  await waitText(page, '결제 대기 자리는 세대 수에 넣지 않으며');
});

await test('탐색: 주소 미설정이면 공동 예약 가능 여부를 단정하지 않는다', async (page) => {
  await start(page, { address: null, path: '/providers?category=c2' });
  await waitText(page, '방문 지역을 정하면 확인할 수 있어요');
  truthy(!(await page.getByText('공동 예약 가능', { exact: true }).count()), '단정 표시');
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
  await page.locator('input[name="slot"]').first().check();
  await page.getByRole('link', { name: '이 날짜로 수리 요청하기' }).click();
  await waitText(page, '수리 요청서');
  await waitText(page, '고객 가능 시간');
  await page.getByRole('button', { name: '요청 보내기' }).click();
  await waitText(page, '작업 내용을 입력해 주세요'); // 검증 메시지
  await page.getByLabel('어떤 작업인가요?').fill('주방 수전 교체');
  await page.getByRole('button', { name: '작업 추가하기' }).click();
  await page.getByLabel('어떤 작업인가요?').nth(1).fill('배수 트랩 교체');
  await page.getByLabel('동·호수').fill('301동 1204호');
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
  await page.getByLabel('동·호수').fill('301동 1204호');
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
  await waitText(page, '5,000원 할인'); // 업체 할인 조건 사전 표시
  await waitText(page, '하나를 예약하면 나머지 요청은 종료돼요');
});

// ───────── 내 요청 필터 ─────────
const statusBtn = (page) => page.getByRole('button', { name: /^상태 필터/ });
const periodBtn = (page) => page.getByRole('button', { name: /^요청 접수일 필터/ });
const cards = (page) => page.locator('main .request-list > li');
const badges = (page) => page.locator('main .request-list > li .badge').allInnerTexts();
/** 조회가 끝난 뒤의 건수 문구(조회 중에는 비어 있다) */
const countText = async (page) => { await page.locator('.filter-bar__summary p', { hasText: '요청 묶음' }).waitFor(); await page.waitForSelector('.request-list[aria-busy]', { state: 'detached' }).catch(() => {}); return page.locator('.filter-bar__summary p').innerText(); };
const search = (page) => new URL(page.url()).search;
const onPath = (page, p) => page.waitForURL((u) => u.pathname === p);
const listBadges = async (page) => { await page.locator('main .request-list .badge').first().waitFor(); return badges(page); };
async function pickStatuses(page, labels) {
  await statusBtn(page).click();
  const dlg = page.getByRole('dialog', { name: '요청 상태' });
  for (const l of labels) await dlg.getByRole('checkbox', { name: l, exact: true }).check();
  await dlg.getByRole('button', { name: '적용', exact: true }).click();
  await dlg.waitFor({ state: 'detached' });
}

await test('요청 필터: 기본 조회 → 복수 상태(OR) → 건수 일치 → 초기화', async (page) => {
  await start(page, { path: '/requests' });
  await waitText(page, '업체 승인 완료 · 결제 대기');
  await periodBtn(page).filter({ hasText: '전체 기간' }).waitFor();
  await statusBtn(page).filter({ hasText: '전체 상태' }).waitFor();
  const total = await cards(page).count();
  eq(await countText(page), `요청 묶음 ${total}건`, '기본 건수');
  truthy(await page.getByText('요청 접수일 2026.', { exact: false }).count() >= total, '목록의 요청 접수일 라벨');

  // 전체 상태 ↔ 개별 상태 선택 규칙
  await statusBtn(page).click();
  const dlg = page.getByRole('dialog', { name: '요청 상태' });
  truthy(await dlg.getByRole('checkbox', { name: '전체 상태', exact: true }).isChecked(), '시트 기본값: 전체 상태');
  await dlg.getByRole('checkbox', { name: '승인 완료·결제 대기', exact: true }).check();
  eq(await dlg.getByRole('checkbox', { name: '전체 상태', exact: true }).isChecked(), false, '개별 선택 시 전체 상태 해제');
  await dlg.getByRole('checkbox', { name: '승인 완료·결제 대기', exact: true }).uncheck();
  truthy(await dlg.getByRole('checkbox', { name: '전체 상태', exact: true }).isChecked(), '모두 해제하면 전체 상태');
  await dlg.getByRole('checkbox', { name: '승인 완료·결제 대기', exact: true }).check();
  await dlg.getByRole('checkbox', { name: '예약 확정', exact: true }).check();
  await dlg.getByRole('checkbox', { name: '전체 상태', exact: true }).check();
  eq(await dlg.getByRole('checkbox', { name: '예약 확정', exact: true }).isChecked(), false, '전체 상태 선택 시 개별 해제');
  await dlg.getByRole('button', { name: '닫기' }).click();
  await statusBtn(page).filter({ hasText: '전체 상태' }).waitFor();
  eq(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')?.startsWith('상태 필터')), true, '닫은 뒤 포커스 복귀');

  await pickStatuses(page, ['승인 완료·결제 대기', '예약 확정']);
  eq(search(page), '?status=approved_pending_payment%2Cbooked', 'URL 쿼리');
  await countText(page);
  await statusBtn(page).filter({ hasText: '상태 2개' }).waitFor();
  const shown = await badges(page);
  truthy(shown.length > 0 && shown.every((b) => ['업체 승인 완료 · 결제 대기', '예약 확정'].includes(b)), `표시 상태: ${shown}`);
  truthy(shown.includes('예약 확정') && shown.includes('업체 승인 완료 · 결제 대기'), '결제 대기와 예약 확정이 각각 보임');
  eq(await countText(page), `요청 묶음 ${await cards(page).count()}건`, '필터 후 건수 = 표시 카드 수');

  await statusBtn(page).click();
  const dlg2 = page.getByRole('dialog', { name: '요청 상태' });
  truthy(await dlg2.getByRole('checkbox', { name: '예약 확정', exact: true }).isChecked(), '시트에 적용값 표시');
  await dlg2.getByRole('checkbox', { name: '승인 완료·결제 대기', exact: true }).uncheck();
  await dlg2.getByRole('button', { name: '적용', exact: true }).click();
  await page.waitForURL((u) => u.search === '?status=booked');
  await statusBtn(page).filter({ hasText: '예약 확정' }).waitFor();
  await page.getByRole('button', { name: '필터 초기화' }).click();
  await page.waitForURL((u) => u.search === '');
  await statusBtn(page).filter({ hasText: '전체 상태' }).waitFor();
  await page.locator('.filter-bar__summary p', { hasText: `요청 묶음 ${total}건` }).waitFor();
  eq(await cards(page).count(), total, '초기화 후 전체 목록');
  eq(await page.getByRole('button', { name: '필터 초기화' }).count(), 0, '기본값이면 초기화 버튼 없음');
});

await test('요청 필터: 직접 선택 기간 오류·적용(경계 포함) + 상태 AND → 결과 없음 → 초기화', async (page) => {
  await page.setViewportSize({ width: 360, height: 760 });
  await start(page, { path: '/requests' });
  await waitText(page, '업체 승인 완료 · 결제 대기');
  await periodBtn(page).click();
  const dlg = page.getByRole('dialog', { name: '요청 접수일' });
  await waitText(page, '방문 예정일이 아니에요');
  await dlg.getByRole('radio', { name: '직접 선택', exact: true }).check();
  await dlg.getByRole('button', { name: '적용', exact: true }).click();
  await waitText(page, '시작일을 입력해 주세요');
  await dlg.getByLabel('시작일', { exact: true }).fill('2026-10-12');
  await dlg.getByLabel('종료일', { exact: true }).fill('2026-10-10');
  await dlg.getByRole('button', { name: '적용', exact: true }).click();
  await waitText(page, '종료일은 시작일과 같거나 늦어야 해요');
  await dlg.getByLabel('종료일', { exact: true }).fill('2026-10-12');
  await waitText(page, '선택 기간: 2026.10.12 ~ 2026.10.12');
  await ((n) => process.env.E2E_SHOTS !== '0' && page.screenshot({ path: join(ROOT, `e2e/screens/360_filter_${n}.png`) }))('period_sheet');
  await dlg.getByRole('button', { name: '적용', exact: true }).click();
  await dlg.waitFor({ state: 'detached' });
  await periodBtn(page).filter({ hasText: '2026.10.12 ~ 2026.10.12' }).waitFor();
  // 10-12에 접수된 요청: rq-2(20:00), rq-10(09:00)
  await page.locator('.filter-bar__summary', { hasText: '요청 묶음 2건' }).waitFor();
  const labels = await page.locator('main .request-list > li').allInnerTexts();
  eq(labels.length, 2, '하루 기간 결과 수');
  truthy(labels.every((t) => t.includes('요청 접수일 2026.10.12')), '모두 10-12 접수');

  // 바꾸다 Esc로 닫으면 기존 적용값 유지
  await periodBtn(page).click();
  await page.getByRole('dialog', { name: '요청 접수일' }).getByRole('radio', { name: '최근 7일', exact: true }).check();
  await page.keyboard.press('Escape');
  await periodBtn(page).filter({ hasText: '2026.10.12 ~ 2026.10.12' }).waitFor();

  await pickStatuses(page, ['철회']); // 철회 요청(rq-6)은 10-10 접수 → AND 결과 없음
  await waitText(page, '선택한 조건에 맞는 요청이 없어요.');
  await ((n) => process.env.E2E_SHOTS !== '0' && page.screenshot({ path: join(ROOT, `e2e/screens/360_filter_${n}.png`) }))('no_result');
  eq(await countText(page), '요청 묶음 0건', '결과 없음 건수');
  truthy(!(await page.locator('main').innerText()).includes('아직 보낸 수리 요청이 없어요'), '요청 없음과 구분');
  await page.locator('.empty').getByRole('button', { name: '필터 초기화' }).click();
  await page.waitForURL((u) => u.search === '');
  await waitText(page, '업체 승인 완료 · 결제 대기');
  await periodBtn(page).filter({ hasText: '전체 기간' }).waitFor();
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
  await pickStatuses(page, ['업체 검토 중']);
  eq(search(page), '?status=reviewing%2Cneeds_info', '두 번째 적용');
  await page.goBack();
  await page.waitForURL((u) => u.search === '?status=needs_info');
  await page.waitForTimeout(200);
  eq((await badges(page)).join(), '추가 정보 필요', '뒤로가기로 이전 조건');
  // 하단 탭으로 다시 들어와도 마지막 적용값
  await page.locator('.tabbar').getByRole('link', { name: '내 정보' }).click();
  await page.locator('.tabbar').getByRole('link', { name: '내 요청' }).click();
  await page.waitForURL((u) => u.search === '?status=needs_info');

  await page.goto(`${BASE}/requests?period=custom&from=2026-99-01&to=x&status=zzz`);
  await page.waitForURL((u) => u.pathname === '/requests' && u.search === '');
  await periodBtn(page).filter({ hasText: '전체 기간' }).waitFor();
  await statusBtn(page).filter({ hasText: '전체 상태' }).waitFor();
});

await test('요청 필터: 목록 위치 유지(상세 → 뒤로)', async (page) => {
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
});

await test('요청 필터: 로그아웃·계정 전환 시 필터 초기화', async (page) => {
  await start(page, { path: '/requests' });
  await waitText(page, '업체 승인 완료 · 결제 대기');
  await pickStatuses(page, ['철회']);
  await page.locator('.tabbar').getByRole('link', { name: '내 정보' }).click();
  await page.getByRole('button', { name: '로그아웃' }).click();
  await onPath(page, '/login');
  truthy(!(await page.evaluate(() => JSON.stringify({ ...sessionStorage }))).includes('list-filter'), '로그아웃 후 저장된 필터');
  page.fake.add({ email: 'user-c@ongimae.test', password: 'user-c-pass' });
  await page.getByLabel('이메일', { exact: true }).fill('user-c@ongimae.test');
  await page.getByLabel('비밀번호', { exact: true }).fill('user-c-pass');
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await onPath(page, '/');
  await page.locator('.tabbar').getByRole('link', { name: '내 요청' }).click();
  await waitText(page, '업체 승인 완료 · 결제 대기');
  eq(search(page), '', '새 계정 쿼리');
  await statusBtn(page).filter({ hasText: '전체 상태' }).waitFor();
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
  await page.getByRole('link', { name: '예약 상세 보기' }).click();
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
  await page.getByRole('button', { name: '개발용 시나리오 도구 열기' }).click();
  await page.locator('select[aria-label="요청 선택"]').selectOption('rq-3');
  await page.getByRole('button', { name: '조건 버전 올리기' }).click();
  await page.getByRole('button', { name: '닫기' }).click();
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

await test('개발 도구: 업체 승인 이벤트 → 알림 진입(S-02) → 결제 대기 / 상태 변경 후 최신 안내', async (page) => {
  await start(page, { path: '/requests/rq-1' });
  await page.getByRole('button', { name: '개발용 시나리오 도구 열기' }).click();
  await page.locator('select[aria-label="요청 선택"]').selectOption('rq-1');
  await page.getByRole('button', { name: '업체 승인' }).click(); // 방문 시각 없이 승인하면 거절
  await waitText(page, '업체 제안 방문 시각이 필요해요');
  await page.getByLabel('업체 제안 방문 시각').fill('20:00'); // 고객 가능 시간 밖
  await page.getByRole('button', { name: '업체 승인' }).click();
  await waitText(page, '고객 가능 시간(09:00~12:00, 13:00~16:00) 안의 시각이어야 해요');
  await page.getByLabel('업체 제안 방문 시각').fill('10:30');
  await page.getByRole('button', { name: '업체 승인' }).click();
  await waitText(page, '승인했어요');
  eq((await db(page)).approvals.find((a) => a.requestId === 'rq-1').visitTime, '10:30', '업체 제안 방문 시각');
  const noticeId = (await db(page)).notices[0].id;
  await page.getByRole('button', { name: '닫기' }).click();
  await page.getByRole('button', { name: '개발용 시나리오 도구 열기' }).click();
  await page.getByRole('button', { name: '승인 만료' }).click();
  await page.getByRole('button', { name: '닫기' }).click();
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
  await page.getByRole('button', { name: '개발용 시나리오 도구 열기' }).click();
  await page.locator('select[aria-label="예약 선택"]').selectOption('bk-k5');
  await page.getByRole('button', { name: '자재 선결제·주문됨' }).click();
  await page.getByRole('button', { name: '닫기' }).click();
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

// ───────── 인증(Supabase Auth — e2e에서는 가짜 서버) ─────────
const field = (page, label) => page.getByLabel(label, { exact: true });
const loginBtn = (page) => page.getByRole('button', { name: '로그인', exact: true });
async function signInUi(page, { email, password }) {
  await field(page, '이메일').fill(email);
  await field(page, '비밀번호').fill(password);
  await loginBtn(page).click();
}
const waitPath = (page, p) => page.waitForURL((u) => u.pathname === p);
const pathOf = (page) => new URL(page.url()).pathname;
const hasSbSession = (page) => page.evaluate((k) => !!localStorage.getItem(k), SB_STORAGE);
const storageDump = (page) => page.evaluate(() => JSON.stringify({ ...sessionStorage }) + JSON.stringify({ ...localStorage }));
/** 내부 화면(하단 탭·업체 찾기 안내 카드)이 한 번이라도 그려졌는지 기록한다 — 로그인 확인 전 노출 점검용 */
const watchInternalFlash = (page) => page.addInitScript(() => {
  window.__internalSeen = [];
  new MutationObserver(() => { if (document.querySelector('.tabbar, .guide, .top-nav')) window.__internalSeen.push(location.pathname); })
    .observe(document, { subtree: true, childList: true });
});

await test('인증 진입: 비로그인 앱 실행·내부 URL 직접 접근은 로그인 화면(내부 화면 미노출)', async (page) => {
  await watchInternalFlash(page);
  await start(page, { path: '/', login: false });
  for (const p of ['/', '/providers?category=c2', '/providers/p1', '/requests/rq-3', '/bookings/bk-k2', '/ledger', '/me', '/guide', '/없는화면']) {
    await page.goto(`${BASE}${p}`);
    await waitPath(page, '/login');
    await waitText(page, '아직 회원이 아니신가요?');
  }
  eq(JSON.stringify(await page.evaluate(() => window.__internalSeen)), '[]', '로그인 전 내부 화면 노출');
  eq(await page.locator('.tabbar').count(), 0, '로그인 화면 하단 탭');
});

await test('인증: 회원가입 → 가입 완료 → 로그인 화면 → 로그인 → 업체 찾기', async (page) => {
  await start(page, { path: '/login', login: false });
  await page.getByRole('link', { name: '회원가입' }).click();
  await waitPath(page, '/signup');
  await waitText(page, '8자 이상 입력해 주세요'); // 비밀번호 기준 안내(설정값)
  await field(page, '이메일').fill('new-user@ongimae.test');
  await field(page, '비밀번호').fill('newpass-01');
  await field(page, '비밀번호 확인').fill('newpass-01');
  await page.getByRole('button', { name: '가입하기' }).click();
  await waitPath(page, '/signup/done');
  await waitText(page, '회원가입이 완료됐어요');
  truthy(page.fake.calls.includes('POST /signup'), 'Supabase 가입 요청');
  truthy(page.fake.calls.includes('POST /logout'), '가입 직후 로그아웃');
  eq(await hasSbSession(page), false, '가입 후 세션이 남음');
  await page.getByRole('link', { name: '로그인하러 가기' }).click();
  await waitPath(page, '/login');
  eq(await field(page, '이메일').inputValue(), 'new-user@ongimae.test', '이메일 미리 채움');
  await field(page, '비밀번호').fill('newpass-01');
  await field(page, '비밀번호').press('Enter'); // Enter 제출
  await waitPath(page, '/');
  await waitText(page, '싸고 공동 예약이란?');
  truthy(!(await storageDump(page)).includes('newpass-01'), '브라우저 저장소에 비밀번호가 남음');
});

await test('인증: 이메일 확인이 켜진 환경이면 확인 메일 안내, 확인 전 로그인은 확인 필요 안내', async (page) => {
  await start(page, { path: '/signup', login: false });
  page.fake.confirmEmail = true;
  await field(page, '이메일').fill('confirm-me@ongimae.test');
  await field(page, '비밀번호').fill('newpass-02');
  await field(page, '비밀번호 확인').fill('newpass-02');
  await page.getByRole('button', { name: '가입하기' }).click();
  await waitText(page, '확인 메일을 보냈어요');
  truthy(!page.fake.calls.includes('POST /logout'), '세션 없는 가입에서 로그아웃 호출');
  await page.getByRole('link', { name: '로그인하러 가기' }).click();
  await field(page, '비밀번호').fill('newpass-02');
  await loginBtn(page).click();
  await waitText(page, '이메일 확인이 필요해요');
});

await test('인증: 입력 검증·잘못된 비밀번호·네트워크 실패 후 다시 시도·중복 제출 방지', async (page) => {
  await start(page, { path: '/login', login: false });
  // 임시: 이메일·비밀번호 칸이 모두 채워져야 로그인 버튼이 활성화된다(AuthPages.tsx 주석 참고)
  eq(await loginBtn(page).isDisabled(), true, '빈 입력에서 버튼 비활성');
  await field(page, '이메일').fill('abc');
  eq(await loginBtn(page).isDisabled(), true, '비밀번호 없을 때 버튼 비활성');
  await field(page, '비밀번호').fill('x');
  eq(await loginBtn(page).isDisabled(), false, '두 칸 입력 시 버튼 활성');
  await loginBtn(page).click();
  await waitText(page, '이메일 형식을 확인해 주세요');
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-invalid') === 'true'); // 첫 오류로 포커스
  await signInUi(page, { email: E2E_USER.email, password: 'wrong-password' });
  await waitText(page, '이메일 또는 비밀번호를 확인해주세요');
  const body = await page.locator('main').innerText();
  truthy(!body.includes('wrong-password'), '오류 안내에 비밀번호 포함');
  eq(pathOf(page), '/login', '실패 후 위치');
  page.fake.offline = true;
  await field(page, '비밀번호').fill(E2E_USER.password);
  await loginBtn(page).click();
  await waitText(page, '네트워크에 연결할 수 없어요');
  page.fake.offline = false;
  page.fake.delayMs = 700;
  const before = page.fake.calls.filter((c) => c === 'POST /token?password').length;
  await page.getByRole('button', { name: '다시 시도' }).click();
  await loginBtn(page).click({ force: true }).catch(() => {}); // 처리 중 연타
  eq(await loginBtn(page).isDisabled(), true, '처리 중 버튼 잠금');
  await waitPath(page, '/');
  eq(page.fake.calls.filter((c) => c === 'POST /token?password').length - before, 1, '로그인 요청 수');
  // 회원가입 검증
  await page.evaluate(() => localStorage.clear());
  await page.goto(`${BASE}/signup`);
  await field(page, '이메일').fill('a@b.co');
  await field(page, '비밀번호').fill('short');
  await field(page, '비밀번호 확인').fill('different');
  await page.getByRole('button', { name: '가입하기' }).click();
  await waitText(page, '비밀번호는 8자 이상 입력해 주세요');
  await waitText(page, '비밀번호가 일치하지 않아요');
  page.fake.offline = true;
  await field(page, '비밀번호').fill('longenough-1');
  await field(page, '비밀번호 확인').fill('longenough-1');
  await page.getByRole('button', { name: '가입하기' }).click();
  await waitText(page, '네트워크에 연결할 수 없어요');
  page.fake.offline = false;
  await page.getByRole('button', { name: '다시 시도' }).click();
  await waitText(page, '회원가입이 완료됐어요');
});

await test('인증: 새로고침해도 세션 유지, 세션이 무효면 로그인 화면', async (page) => {
  await start(page, { path: '/login', login: false });
  await signInUi(page, E2E_USER);
  await waitPath(page, '/');
  await page.reload();
  await waitText(page, '싸고 공동 예약이란?');
  eq(pathOf(page), '/', '새로고침 후 위치');
  await page.goto(`${BASE}/bookings/bk-k2`);
  await waitText(page, '예약 상세').catch(() => {});
  eq(pathOf(page), '/bookings/bk-k2', '새로고침 후 내부 화면 직접 접근');
  // 서버에서 세션이 무효가 되면(예: 다른 곳에서 폐기) 다음 실행 때 로그인 화면으로
  page.fake.revokeAll();
  await page.reload();
  await waitPath(page, '/login');
  eq(await hasSbSession(page), false, '무효 세션 정리');
});

await test('인증: 시작할 때 네트워크가 끊겨도 저장된 세션으로 진입(로그인 화면으로 보내지 않음)', async (page) => {
  await start(page, { path: '/' });
  page.fake.offline = true;
  await page.reload();
  await waitText(page, '싸고 공동 예약이란?');
  eq(pathOf(page), '/', '오프라인 시작 위치');
});

await test('인증: 로그아웃 → 로그인 화면, 뒤로가기·내부 화면 접근 차단', async (page) => {
  await start(page, { path: '/requests' });
  await waitText(page, '업체 승인 완료 · 결제 대기');
  await page.locator('.tabbar').getByRole('link', { name: '내 정보' }).click();
  await waitText(page, E2E_USER.email);
  await page.getByRole('button', { name: '로그아웃' }).click();
  await waitPath(page, '/login');
  eq(await hasSbSession(page), false, '로그아웃 후 세션');
  const d = await db(page);
  eq(d.ownerAccountId, null, '로그아웃 후 목업 상태 주인');
  await page.goBack();
  await page.waitForTimeout(300);
  eq(pathOf(page), '/login', '뒤로가기 후 위치');
  for (const p of ['/requests', '/bookings/bk-k2', '/me']) {
    await page.goto(`${BASE}${p}`);
    await waitPath(page, '/login');
  }
});

await test('인증: 계정 전환 시 이전 사용자의 요청·예약·방문 지역이 남지 않는다', async (page) => {
  await start(page, { path: '/providers/p1/request?group=g1' });
  await page.getByLabel('어떤 작업인가요?').fill('계정A 전용 작업');
  await page.getByLabel('동·호수').fill('101동 101호');
  await page.getByRole('button', { name: '09:00~12:00' }).click();
  await page.getByRole('button', { name: '요청 보내기' }).click();
  await waitText(page, '요청을 보냈어요');
  const ownerA = (await db(page)).ownerAccountId;
  await page.goto(`${BASE}/me`);
  await page.getByRole('button', { name: '로그아웃' }).click();
  await waitPath(page, '/login');
  truthy(!(await storageDump(page)).includes('계정A 전용 작업'), '로그아웃 후 저장소에 A의 요청');
  page.fake.add({ email: 'user-b@ongimae.test', password: 'user-b-pass' });
  await signInUi(page, { email: 'user-b@ongimae.test', password: 'user-b-pass' });
  await waitPath(page, '/');
  await page.locator('.tabbar').getByRole('link', { name: '내 요청' }).click();
  await waitText(page, '업체 승인 완료 · 결제 대기'); // 데모 시드는 새로 시작
  truthy(!(await page.locator('main').innerText()).includes('계정A 전용 작업'), 'B에게 A의 요청이 보임');
  const d = await db(page);
  truthy(d.ownerAccountId && d.ownerAccountId !== ownerA, '목업 상태 주인 교체');
  truthy(!JSON.stringify(d).includes('계정A 전용 작업'), 'B의 목업 상태에 A의 요청');
  eq(JSON.parse(await page.evaluate((k) => sessionStorage.getItem(k) ?? '{}', APP_KEY)).addressId ?? null, null, 'A의 방문 지역');
});

await test('인증: 비밀번호 재설정 — 동일 안내, 링크 없이 열면 만료 안내, 복구 링크로 변경 후 새 비밀번호 로그인', async (page) => {
  await start(page, { path: '/login', login: false });
  await page.getByRole('link', { name: '비밀번호를 잊으셨나요?' }).click();
  await field(page, '이메일').fill('nobody@ongimae.test');
  await page.getByRole('button', { name: '재설정 링크 받기' }).click();
  await waitText(page, '메일함을 확인해 주세요');
  const a = (await page.locator('main').innerText()).replace('nobody@ongimae.test', 'X');
  await page.getByRole('link', { name: '다시 요청하기' }).click();
  await field(page, '이메일').fill(E2E_USER.email);
  await page.getByRole('button', { name: '재설정 링크 받기' }).click();
  await waitText(page, '메일함을 확인해 주세요');
  eq((await page.locator('main').innerText()).replace(E2E_USER.email, 'X'), a, '계정 유무와 관계없이 같은 안내');
  await page.goto(`${BASE}/password/new`);
  await waitText(page, '재설정 링크가 만료됐거나 올바르지 않아요');
  // 재설정 메일 링크(implicit flow 해시)로 진입
  const s = page.fake.issue(page.fake.users.get(E2E_USER.email));
  const hash = new URLSearchParams({ access_token: s.access_token, refresh_token: s.refresh_token, expires_in: '3600', expires_at: String(s.expires_at), token_type: 'bearer', type: 'recovery' });
  await page.goto(`${BASE}/login`); // 메일 링크는 새 페이지로 열린다(같은 경로의 해시만 바뀌면 다시 읽지 않음)
  await page.goto(`${BASE}/password/new#${hash}`);
  await waitText(page, '새 비밀번호를 입력해 주세요');
  await field(page, '새 비밀번호').fill('changed-pass-1');
  await field(page, '새 비밀번호 확인').fill('changed-pass-1');
  await page.getByRole('button', { name: '비밀번호 변경' }).click();
  await waitPath(page, '/login');
  await waitText(page, '비밀번호를 바꿨어요');
  eq(await hasSbSession(page), false, '변경 후 복구 세션 정리');
  await signInUi(page, { email: E2E_USER.email, password: 'changed-pass-1' });
  await waitPath(page, '/');
});

await test('인증 화면 접근성: 라벨·autocomplete·비밀번호 표시 버튼·하단 탭 없음', async (page) => {
  await start(page, { path: '/login', login: false });
  for (const [p, expected] of [['/login', ['email', 'current-password']], ['/signup', ['email', 'new-password', 'new-password']], ['/password/reset', ['email']]]) {
    await page.goto(`${BASE}${p}`);
    await page.waitForSelector('form');
    const info = await page.evaluate(() => Array.from(document.querySelectorAll('main input')).map((el) => ({
      named: !!((el.id && document.querySelector(`label[for="${el.id}"]`)) || el.getAttribute('aria-label')), ac: el.getAttribute('autocomplete'),
    })));
    eq(info.filter((i) => !i.named).length, 0, `${p} 이름 없는 입력`);
    eq(JSON.stringify(info.map((i) => i.ac)), JSON.stringify(expected), `${p} autocomplete`);
    eq(await page.locator('.tabbar, .top-nav').count(), 0, `${p} 내비게이션`);
    eq(await page.locator('h1').count(), 1, `${p} h1`);
  }
  await page.goto(`${BASE}/login`);
  const pw = field(page, '비밀번호');
  eq(await pw.getAttribute('type'), 'password', '기본 숨김');
  await page.getByRole('button', { name: '비밀번호 표시' }).click();
  eq(await pw.getAttribute('type'), 'text', '표시');
  await page.getByRole('button', { name: '비밀번호 숨기기' }).click();
  eq(await pw.getAttribute('type'), 'password', '다시 숨김');
  // 키보드만으로 이메일 → 비밀번호 → 표시 버튼 → 로그인 버튼(두 칸이 채워져 활성화된 상태)
  await field(page, '이메일').fill(E2E_USER.email);
  await pw.fill('anything');
  await field(page, '이메일').focus();
  await page.keyboard.press('Tab'); eq(await page.evaluate(() => document.activeElement?.getAttribute('autocomplete')), 'current-password', 'Tab 순서 1');
  await page.keyboard.press('Tab'); eq(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), '비밀번호 표시', 'Tab 순서 2');
  await page.keyboard.press('Tab'); eq(await page.evaluate(() => document.activeElement?.textContent), '로그인', 'Tab 순서 3');
});

// ───────── 키보드·접근성 ─────────
await test('접근성: 모든 입력에 이름이 있고 키보드로 대화상자를 닫을 수 있다', async (page) => {
  await start(page, { path: '/providers/p1/request?group=g1' });
  const unnamed = await page.evaluate(() => Array.from(document.querySelectorAll('input,textarea,select')).filter((el) => {
    if (el.closest('.dev-panel')) return false;
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
/** 로그아웃 상태로 확인하는 인증 화면 */
const AUTH_ROUTES = ['/login', '/signup', '/password/reset', '/password/reset/sent', '/password/new'];
await test('브랜드: 탭 제목·파비콘·헤더 로고(싸고 홈)·인증 화면 로고, 화면에 이전 서비스명 없음', async (page) => {
  await start(page, { path: '/' });
  truthy((await page.title()).startsWith('싸고'), `탭 제목: ${await page.title()}`);
  const icon = await page.locator('link[rel="icon"]').getAttribute('href');
  const res = await page.request.get(`${BASE}${icon}`);
  truthy(res.ok() && (await res.text()).includes('#315DA8'), '파비콘');
  const home = page.getByRole('link', { name: '싸고 홈', exact: true });
  await home.waitFor();
  eq(await home.locator('svg[aria-hidden="true"]').count(), 1, '헤더 심볼은 스크린리더에서 숨김');
  await page.locator('.guide__art[aria-hidden="true"]').waitFor();
  const bad = [];
  for (const r of ROUTES) {
    await page.goto(`${BASE}${r}`); await page.waitForTimeout(250);
    if ((await page.locator('body').innerText()).includes('온김에')) bad.push(r);
  }
  eq(await page.locator('.guide__art').count(), 0, '일러스트는 업체 찾기에만'); // 마지막 화면(/guide)
  await page.evaluate(() => localStorage.clear());
  for (const r of ['/login', '/signup']) {
    await page.goto(`${BASE}${r}`); await page.waitForURL((u) => u.pathname === r);
    await waitText(page, '싸게 고치고');
    if ((await page.locator('body').innerText()).includes('온김에')) bad.push(r);
  }
  truthy(!bad.length, `이전 서비스명이 남은 화면: ${bad.join(', ')}`);
});

mkdirSync(join(ROOT, 'e2e/screens'), { recursive: true });
for (const w of WIDTHS) {
  await test(`반응형 ${w}px: 모든 화면에서 가로 넘침·잘림 없음`, async (page) => {
    await start(page, { path: '/' });
    const bad = [];
    const all = [...ROUTES.map((r) => [r, '']), ...AUTH_ROUTES.map((r) => [r, 'out'])];
    for (const [r, mode] of all) {
      if (mode === 'out') await page.evaluate(() => localStorage.clear()); // 세션 제거 → 로그아웃 상태
      await page.goto(`${BASE}${r}`);
      if (mode === 'out') await page.waitForURL((u) => u.pathname === r);
      await page.waitForTimeout(350);
      const info = await page.evaluate(() => {
        const vw = document.documentElement.clientWidth;
        const over = document.documentElement.scrollWidth > vw + 1;
        // 텍스트·버튼이 화면 밖으로 나가거나 부모에서 잘리는지
        const clipped = [];
        for (const el of document.querySelectorAll('main *, header *')) {
          if (el.closest('.dev-panel,.dev-fab,.sr-only') || el.classList.contains('sr-only')) continue;
          const cs = getComputedStyle(el);
          if (cs.display === 'none' || cs.visibility === 'hidden') continue;
          const rc = el.getBoundingClientRect();
          if (rc.width === 0 || rc.height === 0) continue;
          if (rc.right > vw + 1 || rc.left < -1) clipped.push(`${el.tagName}.${el.className}`.slice(0, 50));
          if (el.children.length === 0 && el.scrollWidth > el.clientWidth + 1 && cs.overflow !== 'visible') clipped.push(`clip:${el.tagName}.${el.className}`.slice(0, 50));
        }
        return { over, clipped: clipped.slice(0, 3) };
      });
      if (info.over || info.clipped.length) bad.push(`${mode ? '(로그아웃) ' : ''}${r} ${info.over ? '[가로 스크롤]' : ''} ${info.clipped.join(',')}`);
      if (process.env.E2E_SHOTS !== '0') await page.screenshot({ path: join(ROOT, `e2e/screens/${w}_${mode ? `${mode}_` : ''}${r.replace(/[^a-z0-9]+/gi, '_')}.png`), fullPage: true });
    }
    truthy(!bad.length, bad.join(' / '));
  }, { width: w });
}

// ───────── 임시 데모 로그인(Supabase 값 없는 빌드) ─────────
// Supabase 연결 전 상태를 그대로 재현한다: VITE_SUPABASE_* 없이 빌드해 별도 포트로 띄운다.
if (!only || '데모 로그인'.includes(only) || only.includes('데모')) {
  const DEMO_PORT = 4175;
  const DEMO_BASE = `http://localhost:${DEMO_PORT}`;
  const env = { ...process.env }; for (const k of Object.keys(env)) if (k.startsWith('VITE_SUPABASE')) delete env[k];
  const built = vite(['build', '--mode', 'demo', '--outDir', 'dist-demo-auth', '--emptyOutDir'], { env, stdio: 'pipe' });
  const demoServer = spawn(process.execPath, [VITE, 'preview', '--outDir', 'dist-demo-auth', '--port', String(DEMO_PORT), '--strictPort'], { cwd: ROOT, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { if ((await fetch(DEMO_BASE)).ok) break; } catch { /* wait */ } await new Promise((r) => setTimeout(r, 200)); }
  await test('데모 로그인(Supabase 미연결): 처음 쓰는 이메일로 바로 로그인 → 새로고침 유지 → 로그아웃 → 틀린 비밀번호 거절', async (page) => {
    truthy(built.status === 0, '데모 빌드 실패');
    const f = (l) => page.getByLabel(l, { exact: true });
    await page.goto(`${DEMO_BASE}/requests`);
    await page.waitForURL((u) => u.pathname === '/login');
    await waitText(page, '데모 로그인 · 실제 계정이 아니에요');
    await f('이메일').fill('first-time@ongimae.test');
    await f('비밀번호').fill('demo-pass-1');
    await page.getByRole('button', { name: '로그인', exact: true }).click();
    await page.waitForURL((u) => u.pathname === '/');
    await waitText(page, '싸고 공동 예약이란?');
    truthy(!(await page.evaluate(() => JSON.stringify({ ...localStorage }))).includes('demo-pass-1'), '비밀번호 원문 저장');
    await page.reload();
    await waitText(page, '싸고 공동 예약이란?');
    await page.goto(`${DEMO_BASE}/me`);
    await waitText(page, 'first-time@ongimae.test');
    await page.getByRole('button', { name: '로그아웃' }).click();
    await page.waitForURL((u) => u.pathname === '/login');
    await f('이메일').fill('first-time@ongimae.test');
    await f('비밀번호').fill('wrong-pass-1');
    await page.getByRole('button', { name: '로그인', exact: true }).click();
    await waitText(page, '이메일 또는 비밀번호를 확인해주세요');
    await f('비밀번호').fill('demo-pass-1');
    await page.getByRole('button', { name: '로그인', exact: true }).click();
    await page.waitForURL((u) => u.pathname === '/');
  });
  try { demoServer.kill(); } catch { /* ignore */ }
}

// ═════════ 정리 ═════════
await browser.close();
stopServer();

// 운영 빌드에 개발 도구가 포함되지 않았는지 확인
let prodOk = null;
if (!only) {
  const env = { ...process.env }; for (const k of Object.keys(env)) if (k.startsWith('VITE_')) delete env[k];
  const r = vite(['build', '--outDir', 'dist-prod', '--emptyOutDir'], { encoding: 'utf8', stdio: 'pipe', env });
  const files = readdirSync(join(ROOT, 'dist-prod/assets')).filter((f) => f.endsWith('.js'));
  const leaked = files.filter((f) => /개발용 시나리오|service_role/.test(readFileSync(join(ROOT, 'dist-prod/assets', f), 'utf8')));
  prodOk = r.status === 0 && leaked.length === 0 && !files.some((f) => f.startsWith('DevPanel'));
  results.push({ name: '운영 빌드에는 개발용 시나리오 도구가 포함되지 않는다', ok: prodOk, ms: 0, error: prodOk ? undefined : `포함됨: ${leaked.join(',')}` });
  console.log(`  ${prodOk ? '✓' : '✕'} 운영 빌드에는 개발용 시나리오 도구가 포함되지 않는다`);
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
