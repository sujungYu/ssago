/**
 * 수리 요청 완료 화면의 요약 문구. 제출에 성공한 실제 요청(작업 제목)과 같은 비교 묶음의 업체 이름으로 만든다.
 * - 작업이 여러 개면 대표 작업(첫 작업) + ‘외 N건’.
 * - 업체가 하나면 업체 이름. 비교 요청(묶음에 업체 2곳 이상)이면 ‘N개 업체에 수리 요청을 보냈어요’로 안내하고,
 *   업체 이름은 SENT_NAMES_MAX곳까지만 나열한다(많으면 긴 목록 대신 업체 수 중심).
 * 방문 일정·응답 예상 시간은 확정된 값이 아니므로 요약에 넣지 않는다.
 */
export const SENT_NAMES_MAX = 3;

export interface SentSummary {
  task: string;
  /** 비교 요청 여부(같은 묶음에 업체 2곳 이상) */
  compare: boolean;
  providerCount: number;
  /** 업체 칸에 보일 값: 단일 = 업체 이름, 비교 = ‘N개 업체’ */
  providers: string;
  /** 비교 요청일 때 업체 이름(SENT_NAMES_MAX곳 이하일 때만), 많으면 ‘A, B 외 N곳’ */
  providerNames?: string;
  /** 비교 요청 안내 문장 */
  compareNote?: string;
}

export function summarizeSentRequest(taskTitles: string[], providerNames: string[]): SentSummary {
  const titles = taskTitles.map((t) => t.trim()).filter(Boolean);
  const task = titles.length > 1 ? `${titles[0]} 외 ${titles.length - 1}건` : titles[0] ?? '';
  const names = providerNames; // 업체별 하나(호출하는 쪽에서 업체 ID로 중복 제거)
  const n = names.length;
  if (n <= 1) return { task, compare: false, providerCount: n, providers: names[0] ?? '' };
  return {
    task, compare: true, providerCount: n, providers: `${n}개 업체`,
    providerNames: n <= SENT_NAMES_MAX ? names.join(', ') : `${names.slice(0, 2).join(', ')} 외 ${n - 2}곳`,
    compareNote: `${n}개 업체에 수리 요청을 보냈어요`,
  };
}
