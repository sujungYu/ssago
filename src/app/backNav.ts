import { useCallback, useLayoutEffect, useRef } from 'react';
import { useLocation, useNavigate, useNavigationType } from 'react-router-dom';

/**
 * 앱 안 이동 기록(방문 기록 항목 location.key → 그 항목의 경로·바로 앞 항목 key).
 * 브라우저 기록과 같은 모양으로 유지한다: push는 현재 항목 뒤에 새 항목, replace는 같은 자리(앞 항목 유지), 뒤로·앞으로(pop)는 기록을 바꾸지 않는다.
 * 새로고침해도 이어지도록 sessionStorage(탭 단위)에 둔다.
 */
export interface TrailEntry { path: string; prev: string | null }
export type Trail = Record<string, TrailEntry>;
const TRAIL_KEY = 'nav-trail';
const TRAIL_MAX = 200;

/** 한 번의 이동을 기록에 반영한다(순수 함수). key가 'default'면 새로 연 문서의 첫 항목이라 앞 항목이 없다. */
export function recordNav(trail: Trail, action: 'PUSH' | 'REPLACE' | 'POP', key: string, path: string, lastKey: string | null): Trail {
  let prev: string | null;
  if (key === 'default') prev = null;
  else if (lastKey === null) prev = trail[key]?.prev ?? null; // 새로고침: 이미 아는 항목이면 그대로
  else if (action === 'PUSH') prev = lastKey;
  else if (action === 'REPLACE') prev = trail[lastKey]?.prev ?? null;
  else prev = trail[key]?.prev ?? null; // 뒤로·앞으로: 이미 아는 항목이면 그대로
  const next: Trail = { ...trail };
  delete next[key];
  next[key] = { path, prev };
  const keys = Object.keys(next);
  for (const k of keys.slice(0, Math.max(0, keys.length - TRAIL_MAX))) delete next[k];
  return next;
}

/**
 * 상단 뒤로가기로 몇 칸 뒤로 갈지(순수 함수). 지금 화면과 같은 화면(pathname 동일)인 앞 항목은 건너뛴다
 * — 예: 예약 상세 → 일정 변경 요청 → 제출 후 예약 상세로 교체되면, 바로 앞 항목이 같은 예약 상세라 그 앞 화면으로 간다.
 * 돌아갈 앱 안 항목이 없으면(직접 진입·외부 링크) null.
 */
export function backSteps(trail: Trail, key: string, maxSteps: number): number | null {
  const here = trail[key]?.path.split(/[?#]/)[0];
  let k: string | null = key;
  for (let steps = 1; steps <= maxSteps; steps++) {
    k = k ? trail[k]?.prev ?? null : null;
    if (!k || !trail[k]) return null;
    if (trail[k].path.split(/[?#]/)[0] !== here) return steps;
  }
  return null;
}

function loadTrail(): Trail {
  try { return JSON.parse(sessionStorage.getItem(TRAIL_KEY) ?? '{}') as Trail; } catch { return {}; }
}
function saveTrail(t: Trail) {
  try { sessionStorage.setItem(TRAIL_KEY, JSON.stringify(t)); } catch { /* 저장 불가(사생활 보호 모드 등)면 기록 없이 동작 */ }
}

/** 라우터 안 최상단에 한 번 둔다. 이동마다 앱 안 이동 기록을 갱신한다. */
export function NavTrailTracker() {
  const loc = useLocation();
  const action = useNavigationType();
  const lastKey = useRef<string | null>(null);
  const path = `${loc.pathname}${loc.search}${loc.hash}`;
  useLayoutEffect(() => {
    if (lastKey.current === loc.key) return;
    saveTrail(recordNav(loadTrail(), action, loc.key, path, lastKey.current));
    lastKey.current = loc.key;
  }, [loc.key, action, path]);
  return null;
}

/**
 * 상단 뒤로가기: 앱 안에서 들어온 화면이면 그 화면으로 브라우저 기록을 되돌린다(새 기록을 쌓지 않음, 목록 조건·위치도 그대로).
 * 돌아갈 화면이 없으면(직접 진입·새로고침 전 기록 없음) fallback으로 현재 기록을 교체한다.
 */
export function useHistoryBack(fallback: string): () => void {
  const loc = useLocation();
  const nav = useNavigate();
  return useCallback(() => {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    const steps = backSteps(loadTrail(), loc.key, idx);
    if (steps) nav(-steps);
    else nav(safeInternalPath(fallback) ?? '/', { replace: true });
  }, [loc.key, fallback, nav]);
}

/**
 * ‘직전 화면으로 한 번만’ 돌아가는 상단 뒤로가기.
 * 화면 이동 시 location.state.returnTo에 출발 화면 경로를 남기고, 돌아갈 때는 그 기록으로 history.back(-1) 한다(새 기록을 쌓지 않음).
 * 출발 기록이 없으면(직접 진입·새로고침 후) fallback으로 현재 기록을 교체(replace)해, 두 화면이 서로를 push하며 왕복하는 루프를 만들지 않는다.
 */
export interface ReturnState { returnTo?: string }

/** 앱 내부 경로만 허용(외부 URL·프로토콜 상대 주소·역슬래시 차단). 아니면 null */
export function safeInternalPath(p: unknown): string | null {
  if (typeof p !== 'string' || !p.startsWith('/') || p.startsWith('//') || p.includes('\\') || /[\r\n]/.test(p)) return null;
  return p;
}

/** 직전 화면 경로를 이동 state로 남긴다 */
export const returnState = (from: string): ReturnState => ({ returnTo: from });

/**
 * @param expected 돌아갈 화면의 경로(pathname). 출발 기록이 이 경로일 때만 history 뒤로 간다.
 * @param fallback 출발 기록이 없을 때 교체할 안전한 앱 내부 경로
 */
export function useBackTo(expected: string, fallback: string): () => void {
  const loc = useLocation();
  const nav = useNavigate();
  const from = safeInternalPath((loc.state as ReturnState | null)?.returnTo);
  return useCallback(() => {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (from && from.split('?')[0] === expected && idx > 0) nav(-1);
    else nav(safeInternalPath(fallback) ?? '/', { replace: true });
  }, [from, expected, fallback, nav]);
}
