import { useState } from 'react';
import { useRepo } from '../../app/context';
import { useAsync } from '../../app/hooks';
import { Icon } from '../../components/Icon';
import { AsyncView, EmptyState, Field } from '../../components/ui';
import type { Address } from '../../domain/types';

/**
 * 지역·건물(기본) 주소 검색·선택. 업체 찾기의 탐색 주소 설정과 신청서의 방문 건물 변경에서 함께 쓴다.
 * 검색어·선택한 주소는 URL이나 로그에 남기지 않는다. 동·호수는 여기서 받지 않는다.
 */
export function AddressSearch({ selectedId, onPick }: { selectedId: string | null; onPick: (a: Address) => void }) {
  const repo = useRepo();
  const [kw, setKw] = useState('');
  const [q, setQ] = useState('');
  const res = useAsync(() => repo.searchAddresses(q), [repo, q]);
  return (
    <div className="stack">
      <form onSubmit={(e) => { e.preventDefault(); e.stopPropagation(); setQ(kw); }} className="stack" role="search">
        <Field label="주소 검색" hint="모의 주소 검색이에요. 예: 햇살, 달빛, 숲길">
          {(p) => <input {...p} className="input" value={kw} onChange={(e) => setKw(e.target.value)} placeholder="도로명·지번·건물명" enterKeyHint="search" autoComplete="off" />}
        </Field>
        <button className="btn btn--primary btn--block" type="submit"><Icon name="search" size={18} />검색</button>
      </form>
      <AsyncView state={res}>
        {(list) => list.length === 0 ? (
          <EmptyState icon="pin" title="검색 결과가 없어요">다른 단어로 검색해 보세요.</EmptyState>
        ) : (
          <ul className="card card--flush divided" aria-label="검색 결과">
            {list.map((a) => (
              <li key={a.id}>
                <button type="button" className="list-row" style={{ width: '100%', border: 0, textAlign: 'left' }} onClick={() => onPick(a)} aria-pressed={selectedId === a.id}>
                  <div className="list-row__main">
                    <span className="list-row__title">{a.label}</span>
                    <span className="small muted">{a.line1}</span>
                  </div>
                  {selectedId === a.id ? <span className="badge badge--info">선택됨</span> : <Icon name="chevron" size={18} />}
                </button>
              </li>
            ))}
          </ul>
        )}
      </AsyncView>
    </div>
  );
}
