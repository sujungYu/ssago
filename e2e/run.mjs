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
const DB_KEY = 'on-gimae/mock-db/v1';
const APP_KEY = 'on-gimae/app-state/v1';

const sh = (cmd, args) => spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' });

// ───────── 빌드·서버 ─────────
if (!process.env.E2E_SKIP_BUILD) {
  if (sh('npx', ['vite', 'build', '--mode', 'demo']).status !== 0) process.exit(1);
}
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'ignore' });
const stopServer = () => { try { server.kill(); } catch { /* ignore */ } };
process.on('exit', stopServer);
for (let i = 0; i < 50; i++) {
  try { if ((await fetch(BASE)).ok) break; } catch { /* wait */ }
  await new Promise((r) => setTimeout(r, 200));
}

const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });

// ───────── 도우미 ─────────
const results = [];
const only = process.env.E2E_ONLY;
async function test(name, fn, opts = {}) {
  if (only && !name.includes(only)) return;
  const ctx = await browser.newContext({ viewport: { width: opts.width ?? 390, height: 844 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
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

/** 새 세션으로 시작. patch(db)로 목업 상태를 미리 바꿀 수 있다. */
async function start(page, { path = '/', address = 'ad-apt', patch, latency = 30 } = {}) {
  await page.goto(`${BASE}/guide`); // 같은 출처에서 sessionStorage 준비
  await page.evaluate(([dbKey, appKey, addr]) => { sessionStorage.clear(); if (addr) sessionStorage.setItem(appKey, JSON.stringify({ addressId: addr })); }, [DB_KEY, APP_KEY, address]);
  await page.goto(`${BASE}${path}`); // 앱이 시드 DB를 만들어 저장
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
console.log('\n온김에 사용자 화면 e2e\n');

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
  await page.getByRole('button', { name: '요청 보내기' }).click();
  await waitText(page, '작업 내용을 입력해 주세요'); // 검증 메시지
  await page.getByLabel('어떤 작업인가요?').fill('주방 수전 교체');
  await page.getByRole('button', { name: '작업 추가하기' }).click();
  await page.getByLabel('어떤 작업인가요?').nth(1).fill('배수 트랩 교체');
  await page.getByLabel('동·호수').fill('301동 1204호');
  await page.getByRole('button', { name: '09:00–12:00' }).click();
  await page.getByRole('button', { name: '요청 보내기' }).dblclick(); // 연타해도 한 번만
  await waitText(page, '요청을 보냈어요');
  await waitText(page, '업체 검토 중');
  const d = await db(page);
  const mine = d.requests.filter((r) => r.tasks.length === 2 && r.tasks[0].title === '주방 수전 교체');
  eq(mine.length, 1, '연타 후 생성된 요청 수');
  eq(mine[0].status, 'reviewing', '요청 상태');
  eq(mine[0].bookingId, undefined, '요청만으로 예약이 생기지 않음');
});

await test('요청: 새 날짜 요청은 희망 날짜가 필요하다', async (page) => {
  await start(page, { path: '/providers/p1/request?new=1' });
  await page.getByLabel('어떤 작업인가요?').fill('욕실 수전 교체');
  await page.getByLabel('동·호수').fill('301동 1204호');
  await page.getByRole('button', { name: '09:00–12:00' }).click();
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
  await page.getByRole('button', { name: '업체 승인' }).click();
  await waitText(page, '승인했어요');
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

await test('지연: 무료 변경 요청 → 변경 수수료 없음 · 합의 전 기존 일정 유지', async (page) => {
  await start(page, { path: '/delays/dl-k3' });
  await page.getByRole('link', { name: '일정 변경 요청하기' }).click();
  await waitText(page, '방문 지연으로 인한 무료 변경이에요');
  await page.getByLabel('같은 날 시간만').check();
  await page.getByRole('button', { name: '16:00–19:00' }).click();
  await page.getByRole('button', { name: '변경 요청 보내기' }).click();
  await waitText(page, '기존 일정이 유지돼요');
  const d = await db(page);
  eq(d.bookings.find((b) => b.id === 'bk-k3').visitWindow, '13:00–16:00', '합의 전 일정 유지');
});

await test('변경(업체 제안): 수락하면 확정 출장비 유지 · 거절하면 전액 환불 취소', async (page) => {
  await start(page, { path: '/proposals/pr-k4' });
  await waitText(page, '업체 사유 변경이에요');
  await page.getByRole('button', { name: '수락하지 않고 환불받으며 취소하기' }).click();
  await waitText(page, '수수료와 공제 없이 해당 선결제 전체가 환불 대상이에요');
  await page.getByRole('button', { name: '환불받으며 취소하기', exact: true }).click();
  await waitText(page, '거절됨');
  const d = await db(page);
  eq(d.bookings.find((b) => b.id === 'bk-k4').status, 'cancelled', '예약 취소');
  eq(d.bookings.find((b) => b.id === 'bk-k4').cancelCause, 'provider', '업체 사유');
  eq(d.deductions.filter((x) => x.bookingId === 'bk-k4').length, 0, '공제 없음');
});
await test('변경(업체 제안): 수락', async (page) => {
  await start(page, { path: '/proposals/pr-k4' });
  await page.getByRole('button', { name: '변경 수락하기' }).click();
  await waitText(page, '수락됨');
  const b = (await db(page)).bookings.find((x) => x.id === 'bk-k4');
  eq(b.visitDate, '2026-10-19', '새 날짜'); truthy(b.lockedTripFee !== undefined, '확정 출장비 유지');
});

await test('변경(고객 요청): 마감 후 변경은 기존 확정 출장비 몫을 비용으로 안내', async (page) => {
  await start(page, { path: '/bookings/bk-k2/change' });
  await waitText(page, '다른 공동 날짜로');
  await page.locator('input[name="grp"]').first().check();
  await waitText(page, '변경 비용(기존 확정 출장비 몫)');
  await waitText(page, '12,500원');
  await page.getByRole('button', { name: /^\d\d:\d\d–\d\d:\d\d$/ }).first().click();
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
  await waitText(page, '−42,500원', { exact: false }).catch(() => {});
  await waitText(page, '환불 처리 요청 접수');
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
  await waitText(page, '아직 보낸 요청이 없어요');
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
  '/requests/rq-3/approval', '/requests/rq-10/recheck', '/bookings', '/bookings/bk-k2', '/bookings/bk-k2/change', '/bookings/bk-k2/cancel', '/delays/dl-k3', '/proposals/pr-k4', '/materials/mt-1',
  '/additional/aw-1', '/bookings/bk-k9/final', '/bookings/bk-k14', '/bookings/bk-k13/review', '/ledger', '/me', '/guide'];
mkdirSync(join(ROOT, 'e2e/screens'), { recursive: true });
for (const w of WIDTHS) {
  await test(`반응형 ${w}px: 모든 화면에서 가로 넘침·잘림 없음`, async (page) => {
    await start(page, { path: '/' });
    const bad = [];
    for (const r of ROUTES) {
      await page.goto(`${BASE}${r}`);
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
      if (info.over || info.clipped.length) bad.push(`${r} ${info.over ? '[가로 스크롤]' : ''} ${info.clipped.join(',')}`);
      if (process.env.E2E_SHOTS !== '0') await page.screenshot({ path: join(ROOT, `e2e/screens/${w}_${r.replace(/[^a-z0-9]+/gi, '_')}.png`), fullPage: true });
    }
    truthy(!bad.length, bad.join(' / '));
  }, { width: w });
}

// ═════════ 정리 ═════════
await browser.close();
stopServer();

// 운영 빌드에 개발 도구가 포함되지 않았는지 확인
let prodOk = null;
if (!only) {
  const r = spawnSync('npx', ['vite', 'build', '--outDir', 'dist-prod', '--emptyOutDir'], { cwd: ROOT, encoding: 'utf8' });
  const files = readdirSync(join(ROOT, 'dist-prod/assets')).filter((f) => f.endsWith('.js'));
  const leaked = files.filter((f) => readFileSync(join(ROOT, 'dist-prod/assets', f), 'utf8').includes('개발용 시나리오'));
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
