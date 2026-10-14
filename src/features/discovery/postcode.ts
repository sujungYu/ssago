import type { PostcodeResult } from '../../domain/address';

/**
 * 카카오 우편번호 서비스 스크립트 불러오기(공식 가이드 https://postcode.map.kakao.com/guide — API 키·사용량 제한 없음).
 * 필요한 화면에서만 한 번 불러온다. 실패·시간 초과면 거부하고 다음 시도에서 다시 불러온다(가상 검색 결과로 대체하지 않음).
 */
export const POSTCODE_SRC = 'https://t1.kakaocdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js';
const LOAD_TIMEOUT_MS = 10000;

export interface PostcodeInstance { embed(el: HTMLElement, opts?: { q?: string; autoClose?: boolean }): void }
export type PostcodeCtor = new (opts: {
  oncomplete: (data: PostcodeResult) => void;
  width?: string | number; height?: string | number; focusInput?: boolean; submitMode?: boolean;
}) => PostcodeInstance;

const ctor = (): PostcodeCtor | undefined => (window as unknown as { kakao?: { Postcode?: PostcodeCtor } }).kakao?.Postcode;

let pending: Promise<PostcodeCtor> | null = null;

export function loadPostcode(): Promise<PostcodeCtor> {
  const ready = ctor();
  if (ready) return Promise.resolve(ready);
  if (pending) return pending;
  pending = new Promise<PostcodeCtor>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = POSTCODE_SRC;
    s.async = true;
    let done = false;
    const fail = () => {
      if (done) return;
      done = true; clearTimeout(timer); s.remove(); pending = null;
      reject(new Error('postcode_load_failed'));
    };
    const timer = setTimeout(fail, LOAD_TIMEOUT_MS);
    s.onerror = fail;
    s.onload = () => {
      // 스크립트가 내부 모듈을 이어서 불러오므로 생성자가 생길 때까지 잠시 기다린다(시간 초과 안에서)
      const check = () => {
        if (done) return;
        const C = ctor();
        if (C) { done = true; clearTimeout(timer); resolve(C); } else setTimeout(check, 50);
      };
      check();
    };
    document.head.appendChild(s);
  });
  return pending;
}
