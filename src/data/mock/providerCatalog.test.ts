/// <reference types="node" />
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { newRequestDates } from '../../domain/visitDays';
import { selectableTimes } from '../../domain/visitTime';
import { MockRepository } from './mockRepository';
import { DEMO_PHOTO_SIZE, INTRO_PHOTOS, WORK_SCENES } from './demoPhotos';
import { PROVIDER_REQUEST_DAYS } from './providerRequestDays';
import { PROVIDER_SERVICES } from './providerServices';
import { PROVIDER_SHOWCASE } from './providerShowcase';
import { EXTRA_JOINT_DAYS, EXTRA_PROVIDERS } from './providersExtra';
import { DEMO_SCHEDULE_VERSION, migrateDemoSchedule } from './scheduleMigration';
import { CATEGORIES, createSeed } from './seed';

const repo = () => new MockRepository({ latencyMs: 0 });
const PUBLIC = join(process.cwd(), 'public');
const ORIGINAL = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'];
const ORIGINAL_NAMES = ['한빛설비', '새봄수리', '밝은전기', '든든문고리', '깔끔마감', '손맵시', '맑은창방충망', '반듯설치'];

// ‘기타 수리’(c10) 제거 후 카테고리별 고유 업체 수(spec 5.34). 업체를 복제해 수를 맞추지 않는다
const CATEGORY_COUNTS: Record<string, number> = { c1: 10, c2: 10, c3: 12, c4: 10, c5: 10, c6: 10, c7: 10, c8: 11, c9: 10 };
/** 남은 카테고리에 맞는 곳이 없어 카테고리 연결 없이 업체 작업으로만 둔 작업 */
const UNCATEGORIZED = ['거울·액자 걸기'];

describe('데모 업체 구성: 카테고리 9개', () => {
  it('카테고리 9개(‘기타 수리’ 없음) 목록에 같은 업체는 한 번만, 정해진 고유 업체 수', async () => {
    const r = repo();
    expect(CATEGORIES.map((c) => c.id)).toEqual(Object.keys(CATEGORY_COUNTS));
    const phone = (id: string) => r.__db().providers.find((x) => x.id === id)!.phone;
    for (const c of CATEGORIES) {
      const list = await r.listProviders({ categoryId: c.id, addressId: 'ad-apt' });
      expect(list, c.id).toHaveLength(CATEGORY_COUNTS[c.id]);
      expect(new Set(list.map((p) => p.id)).size, c.id).toBe(list.length);
      expect(new Set(list.map((p) => p.name.replace(/\s+/g, ''))).size, c.id).toBe(list.length);
      expect(new Set(list.map((p) => phone(p.id))).size, c.id).toBe(list.length);
    }
    expect(await r.listProviders({ categoryId: 'c10', addressId: 'ad-apt' })).toEqual([]);
    expect(r.__db().providers.some((p) => p.categoryIds.includes('c10'))).toBe(false);
    // 모든 업체가 남은 카테고리 하나 이상에 속한다(목록에서 사라진 업체 없음)
    expect(r.__db().providers.every((p) => p.categoryIds.length > 0)).toBe(true);
  });

  it('고유 업체 35곳: ID·이름·연락처 중복 없음, 기존 8곳은 ID·이름 그대로', () => {
    const ps = createSeed('full').providers;
    expect(ps).toHaveLength(35);
    for (const key of ['id', 'name', 'phone'] as const) expect(new Set(ps.map((p) => p[key])).size, key).toBe(35);
    expect(ps.slice(0, 8).map((p) => p.id)).toEqual(ORIGINAL);
    expect(ps.slice(0, 8).map((p) => p.name)).toEqual(ORIGINAL_NAMES);
    expect(ps.slice(8).map((p) => p.id)).toEqual(EXTRA_PROVIDERS.map((p) => p.id));
    for (const p of ps) {
      expect(new Set(p.categoryIds).size, p.id).toBe(p.categoryIds.length);
      expect(p.categoryIds.every((c) => CATEGORIES.some((x) => x.id === c)), p.id).toBe(true);
    }
  });

  it('기존 요청·예약·리뷰 기록은 모두 기존 업체 ID를 그대로 참조한다', () => {
    const db = createSeed('full');
    const ids = new Set(db.providers.map((p) => p.id));
    const refs = [...db.requests, ...db.bookings, ...db.reviews].map((x) => x.providerId);
    expect(refs.length).toBeGreaterThan(0);
    expect(refs.every((id) => ids.has(id) && ORIGINAL.includes(id))).toBe(true);
    expect(db.groups.every((g) => ids.has(g.providerId))).toBe(true);
  });

  it('업체마다 구성이 다르다: 추가 업체의 이름·소개·작업 구성이 서로 겹치지 않고 출장비·운영 요일도 한 가지가 아니다', () => {
    const texts = (f: (p: (typeof EXTRA_PROVIDERS)[number]) => string) => new Set(EXTRA_PROVIDERS.map(f)).size;
    expect(texts((p) => p.intro)).toBe(EXTRA_PROVIDERS.length);
    expect(texts((p) => PROVIDER_SERVICES[p.id].map((s) => s.name).join('|'))).toBe(EXTRA_PROVIDERS.length);
    expect(texts((p) => String(p.soloTripFee))).toBeGreaterThanOrEqual(5);
    expect(texts((p) => PROVIDER_REQUEST_DAYS[p.id].weekdays.join(''))).toBeGreaterThanOrEqual(8);
  });
});

describe('업체 등록 작업·카테고리 일치', () => {
  it('모든 업체에 등록 작업이 있고 작업 ID는 전체에서 고유하다', () => {
    const ps = createSeed('full').providers;
    const all = ps.flatMap((p) => p.services ?? []);
    expect(ps.every((p) => (p.services ?? []).length >= 3)).toBe(true);
    expect(new Set(all.map((s) => s.id)).size).toBe(all.length);
    for (const p of ps) expect(new Set(p.services!.map((s) => s.name)).size, p.id).toBe(p.services!.length);
  });

  it('추가 업체: 소속 카테고리마다 그 카테고리의 등록 작업이 있고, 등록 작업은 모두 소속 카테고리 안에 있다(맞는 카테고리가 없는 작업만 연결 없음)', () => {
    for (const p of EXTRA_PROVIDERS) {
      for (const s of PROVIDER_SERVICES[p.id]) if (!s.categoryId) expect(UNCATEGORIZED, s.id).toContain(s.name);
      const cats = PROVIDER_SERVICES[p.id].flatMap((s) => (s.categoryId ? [s.categoryId] : []));
      expect(cats.every((c) => p.categoryIds.includes(c)), p.id).toBe(true);
      expect(p.categoryIds.every((c) => cats.includes(c)), p.id).toBe(true);
    }
  });

  it('업체 상세의 제공 작업과 요청서 작업 선택은 같은 등록 데이터(ID·이름·순서)다', async () => {
    const r = repo();
    for (const p of r.__db().providers) {
      expect((await r.getProvider(p.id, 'ad-apt')).services, p.id).toEqual(PROVIDER_SERVICES[p.id]);
    }
  });
});

describe('업체 소개·작업 사례(데모 콘텐츠)', () => {
  const ps = createSeed('full').providers;

  it('모든 업체에 소개 이미지·소개글과 작업 사례 2개 이상이 있다', async () => {
    const r = repo();
    for (const p of ps) {
      const d = await r.getProvider(p.id, null);
      expect(d.profile, p.id).not.toBeNull();
      expect(d.profile!.demo, p.id).toBe(true);
      expect(d.profile!.about.length, p.id).toBeGreaterThan(20);
      expect(d.profile!.photo.alt.length, p.id).toBeGreaterThan(5);
      expect(d.portfolio.length, p.id).toBeGreaterThanOrEqual(2);
      expect(d.portfolio.every((c) => c.demo), p.id).toBe(true);
    }
  });

  it('사례는 그 업체의 등록 작업에만 있고, 사례 ID는 전체에서 고유하다', () => {
    const ids = ps.flatMap((p) => PROVIDER_SHOWCASE[p.id].portfolio.map((c) => c.id));
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of ps) {
      const services = new Set(PROVIDER_SERVICES[p.id].map((s) => s.id));
      for (const c of PROVIDER_SHOWCASE[p.id].portfolio) {
        expect(services.has(c.serviceId), c.id).toBe(true);
        expect(c.title.length > 3 && c.description.length > 10, c.id).toBe(true);
      }
      expect(new Set(PROVIDER_SHOWCASE[p.id].portfolio.map((c) => c.serviceId)).size, p.id).toBe(PROVIDER_SHOWCASE[p.id].portfolio.length);
    }
  });

  it('전·후는 같은 장면의 한 쌍만 묶고, 아니면 한 장(single)이다', () => {
    for (const p of ps) {
      for (const c of PROVIDER_SHOWCASE[p.id].portfolio) {
        const roles = c.photos.map((x) => x.role).join(',');
        expect(['before,after', 'single'], c.id).toContain(roles);
        if (roles === 'before,after') {
          const [b, a] = c.photos;
          expect(b.src.endsWith('-before-thumb.webp') && a.src.endsWith('-after-thumb.webp'), c.id).toBe(true);
          expect(b.src.replace('-before-thumb.webp', ''), c.id).toBe(a.src.replace('-after-thumb.webp', ''));
          expect(b.alt, c.id).not.toBe(a.alt);
        }
      }
    }
  });

  it('이미지는 모두 프로젝트 자산(public/demo)의 사진 파일이고(일러스트 SVG·외부 주소 없음), 썸네일과 확대 보기가 같은 사진이다', () => {
    for (const p of ps) {
      const s = PROVIDER_SHOWCASE[p.id];
      for (const img of [s.profile.photo, ...s.portfolio.flatMap((c) => c.photos)]) {
        expect(img.src, p.id).toMatch(/^\/demo\/(intro|work)\/[a-zA-Z0-9-]+-thumb\.webp$/);
        expect(img.fullSrc, p.id).toBe(img.src.replace('-thumb.webp', '.webp'));
        expect(existsSync(join(PUBLIC, img.src)), img.src).toBe(true);
        expect(existsSync(join(PUBLIC, img.fullSrc!)), img.fullSrc).toBe(true);
        expect(statSync(join(PUBLIC, img.src)).size, img.src).toBeLessThan(80 * 1024);
        expect(statSync(join(PUBLIC, img.fullSrc!)).size, img.fullSrc).toBeLessThan(300 * 1024);
        expect([img.width, img.height]).toEqual([DEMO_PHOTO_SIZE.width, DEMO_PHOTO_SIZE.height]);
        expect(img.alt.trim().length, img.src).toBeGreaterThan(5);
      }
    }
  });

  it('자산 폴더에 일러스트(SVG)가 남아 있지 않고, 모든 장면·분야 사진이 실제로 쓰인다', () => {
    const files = ['work', 'intro'].flatMap((d) => readdirSync(join(PUBLIC, 'demo', d)).map((f) => `/demo/${d}/${f}`));
    expect(files.filter((f) => !f.endsWith('.webp'))).toEqual([]);
    expect(files).toHaveLength((Object.keys(WORK_SCENES).length * 2 + Object.keys(INTRO_PHOTOS).length) * 2);
    const used = new Set(ps.flatMap((p) => [PROVIDER_SHOWCASE[p.id].profile.photo, ...PROVIDER_SHOWCASE[p.id].portfolio.flatMap((c) => c.photos)]).flatMap((i) => [i.src, i.fullSrc!]));
    expect(files.filter((f) => !used.has(f))).toEqual([]);
  });

  it('소개 사진은 그 업체의 소속 분야 사진이고(같은 분야끼리 함께 씀), 사례 사진 묶음이 똑같은 업체가 없다', () => {
    // ‘c10’ 소개 사진(공구함)은 여러 작업을 함께 하는 업체(p24·p26) 소개용으로 그대로 쓴다(카테고리 ‘기타 수리’는 없앰)
    for (const p of ps) {
      const k = PROVIDER_SHOWCASE[p.id].profile.photo.src.match(/intro\/(c\d+)-thumb/)![1];
      if (k !== 'c10') expect(p.categoryIds, p.id).toContain(k);
    }
    const sets = ps.map((p) => PROVIDER_SHOWCASE[p.id].portfolio.flatMap((c) => c.photos.map((x) => x.src)).sort().join('|'));
    expect(new Set(sets).size).toBe(ps.length);
    expect(new Set(ps.map((p) => PROVIDER_SHOWCASE[p.id].profile.about)).size).toBe(ps.length);
  });

  it('소개·사례 문구에 확인되지 않은 실적·자격 표현을 넣지 않는다', () => {
    const banned = /자격증|보험|보증|경력|\d+\s*년|\d+\s*건|만족|1위|최고|전문가|공식|인증|대표|직원|기사님/;
    for (const p of ps) {
      const s = PROVIDER_SHOWCASE[p.id];
      const text = [s.profile.about, s.profile.photo.alt, ...s.portfolio.flatMap((c) => [c.title, c.description, ...c.photos.map((x) => x.alt)])].join(' ');
      expect(text.match(banned)?.[0] ?? null, p.id).toBeNull();
    }
    for (const p of EXTRA_PROVIDERS) {
      expect(p.intro, p.id).toContain('가상 업체');
      expect(`${p.name} ${p.intro} ${p.scope.join(' ')}`.match(/리모델링|철거|구조 변경|증축|확장 공사/)?.[0] ?? null, p.id).toBeNull();
    }
  });
});

describe('추가 업체의 날짜 선택·수리 요청 흐름', () => {
  it('공동 예약: 10/19~25 중 서로 다른 날짜 3개·날짜당 그룹 하나, 접수 마감 전날 18:00, 출장비는 기존 계산 기준', async () => {
    const r = repo();
    for (const p of EXTRA_PROVIDERS) {
      const d = await r.getProvider(p.id, 'ad-apt');
      const days = EXTRA_JOINT_DAYS[p.id];
      expect(d.groups.map((g) => g.date), p.id).toEqual(days.map((x) => `2026-10-${x.day}`));
      expect(new Set(days.map((x) => x.day)).size, p.id).toBe(3);
      for (const g of d.groups) {
        const day = Number(g.date.slice(-2));
        expect(day >= 19 && day <= 25, g.id).toBe(true);
        expect(g.closeAt, g.id).toBe(`2026-10-${day - 1}T18:00:00+09:00`);
        expect(g.confirmedHouseholds + g.pendingSeats, g.id).toBeLessThan(g.capacity);
        expect(await r.listJointGroups(p.id, 'ad-apt', g.date), g.id).toHaveLength(1);
      }
      // 다른 지역 주소에서는 참여 가능한 공동 예약이 없다(실제 지역 매칭은 없음 — 가상 주소 기준 키 일치)
      expect((await r.getProvider(p.id, 'ad-far')).groups, p.id).toEqual([]);
    }
  });

  it('새 요청: 모든 추가 업체에 접수 기준이 있고 고를 수 있는 날짜가 있다', async () => {
    const r = repo();
    for (const p of EXTRA_PROVIDERS) {
      const d = await r.getProvider(p.id, 'ad-apt');
      expect(d.newRequest, p.id).toEqual(PROVIDER_REQUEST_DAYS[p.id]);
      expect(newRequestDates(d.newRequest, r.now()).length, p.id).toBeGreaterThan(5);
    }
  });

  it('모든 추가 업체: 공동 예약 요청과 새 요청을 등록 작업 여러 개로 제출할 수 있다', async () => {
    const r = repo();
    const base = { addressId: 'ad-apt', addressDetail: '301동 1204호', saveAddressForNext: false, contact: { name: '김온다 (가상 고객)', phone: '01000000000' } };
    for (const p of EXTRA_PROVIDERS) {
      const d = await r.getProvider(p.id, 'ad-apt');
      const tasks = d.services.slice(0, 2).map((s) => ({ serviceId: s.id, description: '데모 요청', photoNames: [] }));
      const g = d.groups[0];
      const joint = await r.createRequest({ ...base, providerId: p.id, groupId: g.id, slots: [selectableTimes(g.slots)[0]], tasks, idempotencyKey: `t-joint-${p.id}` });
      expect([joint.providerId, joint.groupId, joint.status], p.id).toEqual([p.id, g.id, 'reviewing']);
      expect(joint.tasks.map((t) => t.title), p.id).toEqual(d.services.slice(0, 2).map((s) => s.name));
      const date = newRequestDates(d.newRequest, r.now())[0];
      const fresh = await r.createRequest({ ...base, providerId: p.id, groupId: null, newDateWish: date, slots: ['10:00'], tasks: tasks.slice(0, 1), idempotencyKey: `t-new-${p.id}` });
      expect([fresh.providerId, fresh.groupId, fresh.newDateWish, fresh.status], p.id).toEqual([p.id, null, date, 'reviewing']);
      expect((await r.getRequest(fresh.id)).provider.name, p.id).toBe(p.name);
    }
  });
});

describe('저장 상태 이전: 업체 8곳으로 저장된 탭', () => {
  it('새 업체와 그 일정만 더하고 기존 업체·기록은 그대로 둔다', async () => {
    const seed = createSeed('full');
    const old = createSeed('full');
    old.scheduleVersion = DEMO_SCHEDULE_VERSION - 1;
    old.providers = old.providers.filter((p) => ORIGINAL.includes(p.id));
    old.groups = old.groups.filter((g) => ORIGINAL.includes(g.providerId));
    old.providers[0].name = '한빛설비(저장값)';
    const before = { requests: JSON.stringify(old.requests), bookings: JSON.stringify(old.bookings) };
    expect(migrateDemoSchedule(old, seed)).toBe(true);
    expect(old.providers.map((p) => p.id)).toEqual(seed.providers.map((p) => p.id));
    expect(old.providers[0].name).toBe('한빛설비(저장값)');
    expect(old.groups.map((g) => g.id).sort()).toEqual(seed.groups.map((g) => g.id).sort());
    expect(JSON.stringify(old.requests)).toBe(before.requests);
    expect(JSON.stringify(old.bookings)).toBe(before.bookings);
    const r = new MockRepository({ seed: old, latencyMs: 0 });
    expect(await r.listProviders({ categoryId: 'c5', addressId: 'ad-apt' })).toHaveLength(10);
    expect(migrateDemoSchedule(old, seed)).toBe(false);
  });
});
