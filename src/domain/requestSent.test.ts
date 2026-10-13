import { describe, expect, it } from 'vitest';
import { summarizeSentRequest } from './requestSent';

describe('summarizeSentRequest', () => {
  it('단일 작업·단일 업체', () => {
    expect(summarizeSentRequest(['창문 보수'], ['한빛설비'])).toEqual({ task: '창문 보수', compare: false, providerCount: 1, providers: '한빛설비' });
  });
  it('여러 작업은 대표 작업 + 외 N건', () => {
    expect(summarizeSentRequest(['욕실 수전 교체', '배수 트랩 교체', ' '], ['한빛설비']).task).toBe('욕실 수전 교체 외 1건');
    expect(summarizeSentRequest(['a', 'b', 'c'], ['x']).task).toBe('a 외 2건');
  });
  it('비교 요청은 업체 수 안내, 3곳까지 이름 나열', () => {
    const s = summarizeSentRequest(['창문 보수'], ['한빛설비', '새봄수리']);
    expect(s).toMatchObject({ compare: true, providerCount: 2, providers: '2개 업체', providerNames: '한빛설비, 새봄수리', compareNote: '2개 업체에 수리 요청을 보냈어요' });
  });
  it('업체가 많으면 긴 목록 대신 수 중심', () => {
    const s = summarizeSentRequest(['창문 보수'], ['A', 'B', 'C', 'D', 'E']);
    expect(s.providers).toBe('5개 업체');
    expect(s.providerNames).toBe('A, B 외 3곳');
  });
});
