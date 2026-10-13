import type { ProviderService, TaskItem } from './types';

/** 요청서에서 고른 작업 한 건(고른 등록 작업 ID + 작업별 설명·사진) */
export interface SelectedTaskInput {
  serviceId: string;
  description: string;
  photoNames: string[];
}

/**
 * 고른 작업을 요청에 저장할 작업 목록으로 바꾼다(작업 ID는 저장소가 붙인다).
 * - 이 업체의 등록 작업만 허용한다. 다른 업체(이전 업체) 작업 ID·없는 ID·같은 작업 중복·0개면 null(제출 거부).
 * - 작업명은 지금 등록된 이름을 요청 당시 이름으로 저장한다(이후 업체가 이름을 바꿔도 이 요청은 그대로).
 * - 순서는 업체 작업 목록의 표시 순서로 맞춘다(고른 순서와 무관하게 늘 같은 순서).
 */
export function resolveSelectedTasks(services: ProviderService[], tasks: SelectedTaskInput[]): Omit<TaskItem, 'id'>[] | null {
  if (!tasks.length) return null;
  const ids = tasks.map((t) => t.serviceId);
  if (new Set(ids).size !== ids.length) return null;
  const order = new Map(services.map((s, i) => [s.id, i]));
  if (ids.some((id) => !order.has(id))) return null;
  return [...tasks]
    .sort((a, b) => order.get(a.serviceId)! - order.get(b.serviceId)!)
    .map((t) => ({ serviceId: t.serviceId, title: services[order.get(t.serviceId)!].name, description: t.description.trim(), photoNames: [...t.photoNames] }));
}

/** 화면의 선택 상태(작업 ID 집합)를 업체 작업 목록 순서로 정리한다. 지금 목록에 없는 ID(이전 업체 작업 등)는 버린다. */
export const orderSelected = (services: ProviderService[], selected: Iterable<string>): ProviderService[] => {
  const set = new Set(selected);
  return services.filter((s) => set.has(s.id));
};
