/** 화면 시간 표시는 모두 Asia/Seoul 기준이다. */
export const TZ = 'Asia/Seoul';
const HOUR = 3600_000;

const dateTimeFmt = new Intl.DateTimeFormat('ko-KR', {
  timeZone: TZ, month: 'long', day: 'numeric', weekday: 'short', hour: 'numeric', minute: '2-digit', hour12: false,
});
const dateFmt = new Intl.DateTimeFormat('ko-KR', { timeZone: TZ, month: 'long', day: 'numeric', weekday: 'short' });
const dateYmdFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });

export function toDate(iso: string): Date {
  return new Date(iso);
}

/** 예: 10월 15일 (목) 18:00 */
export function formatDateTime(iso: string): string {
  const parts = dateTimeFmt.formatToParts(toDate(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const hh = get('hour').padStart(2, '0');
  return `${get('month')} ${get('day')}일 (${get('weekday')}) ${hh}:${get('minute')}`;
}

/** YYYY-MM-DD → 10월 16일 (금) */
export function formatDate(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00+09:00`);
  const parts = dateFmt.formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('month')} ${get('day')}일 (${get('weekday')})`;
}

/** ISO 일시 → Asia/Seoul 기준 YYYY-MM-DD */
export function seoulYmd(iso: string): string {
  return dateYmdFmt.format(toDate(iso));
}

export function addHours(iso: string, hours: number): string {
  return new Date(toDate(iso).getTime() + hours * HOUR).toISOString();
}

export function hoursBetween(fromIso: string, toIso: string): number {
  return (toDate(toIso).getTime() - toDate(fromIso).getTime()) / HOUR;
}

/** 방문 전날 18:00 (KST). 그룹 마감의 가장 늦은 시점. */
export function latestCloseAt(visitYmd: string): string {
  const visit = new Date(`${visitYmd}T00:00:00+09:00`);
  return new Date(visit.getTime() - 6 * HOUR).toISOString();
}

/** "남은 시간" 표현. 기준 시각은 목업 시계(now)를 받는다. */
export function formatRemaining(nowIso: string, targetIso: string): string {
  const diff = toDate(targetIso).getTime() - toDate(nowIso).getTime();
  if (diff <= 0) return '기한이 지났어요';
  const totalMin = Math.floor(diff / 60_000);
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  if (d > 0) return `${d}일 ${h}시간 남음`;
  if (h > 0) return `${h}시간 ${m}분 남음`;
  return `${m}분 남음`;
}
