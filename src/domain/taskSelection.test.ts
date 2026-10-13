import { describe, expect, it } from 'vitest';
import { orderSelected, resolveSelectedTasks } from './taskSelection';

const S = [{ id: 's1', name: '수전 교체' }, { id: 's2', name: '배수 트랩 교체' }, { id: 's3', name: '실리콘 재시공' }];
const t = (serviceId: string, description = '') => ({ serviceId, description, photoNames: [] as string[] });

describe('resolveSelectedTasks', () => {
  it('등록 작업 이름을 요청 당시 이름으로 저장하고 업체 목록 순서로 정렬', () => {
    expect(resolveSelectedTasks(S, [t('s3', ' 욕실 '), t('s1', '주방·욕실 각각')])).toEqual([
      { serviceId: 's1', title: '수전 교체', description: '주방·욕실 각각', photoNames: [] },
      { serviceId: 's3', title: '실리콘 재시공', description: '욕실', photoNames: [] },
    ]);
  });
  it('0개·중복·다른 업체 작업은 거부', () => {
    expect(resolveSelectedTasks(S, [])).toBeNull();
    expect(resolveSelectedTasks(S, [t('s1'), t('s1')])).toBeNull();
    expect(resolveSelectedTasks(S, [t('s1'), t('other-provider')])).toBeNull();
    expect(resolveSelectedTasks([], [t('s1')])).toBeNull();
  });
});

describe('orderSelected', () => {
  it('업체 목록 순서, 목록에 없는 ID는 버림', () => {
    expect(orderSelected(S, ['s3', 'x', 's1']).map((s) => s.id)).toEqual(['s1', 's3']);
  });
});
