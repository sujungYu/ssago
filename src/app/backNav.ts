import { useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

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
