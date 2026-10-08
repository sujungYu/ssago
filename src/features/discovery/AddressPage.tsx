import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Page } from '../../app/Page';
import { useAppState, useRepo } from '../../app/context';
import { useAsync } from '../../app/hooks';
import { Icon } from '../../components/Icon';
import { AsyncView, Banner, EmptyState, Field } from '../../components/ui';

/** C-02 방문 지역 설정. 모의 주소 검색이며 자동 위치 수집·주소 저장은 하지 않는다(미정). */
export function AddressPage() {
  const repo = useRepo();
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const back = sp.get('back') || '/';
  const { addressId, setAddressId } = useAppState();
  const [kw, setKw] = useState('');
  const [q, setQ] = useState('');
  const res = useAsync(() => repo.searchAddresses(q), [repo, q]);
  return (
    <Page title="방문 지역 설정" back={back}>
      <form onSubmit={(e) => { e.preventDefault(); setQ(kw); }} className="stack" role="search">
        <Field label="주소 검색" hint="모의 주소 검색이에요. 예: 햇살, 달빛, 숲길">
          {(p) => <input {...p} className="input" value={kw} onChange={(e) => setKw(e.target.value)} placeholder="도로명·단지명" enterKeyHint="search" />}
        </Field>
        <button className="btn btn--primary btn--block" type="submit"><Icon name="search" size={18} />검색</button>
      </form>
      <Banner tone="info">주소는 참여할 수 있는 공동 예약을 찾는 데만 써요. 정확한 동·호수는 요청서에서 입력하고, 요청을 받은 업체와 나만 볼 수 있어요.</Banner>
      <AsyncView state={res}>
        {(list) => list.length === 0 ? (
          <EmptyState icon="pin" title="검색 결과가 없어요">다른 단어로 검색해 보세요.</EmptyState>
        ) : (
          <ul className="card card--flush divided" aria-label="검색 결과">
            {list.map((a) => (
              <li key={a.id}>
                <button
                  type="button" className="list-row" style={{ width: '100%', border: 0, textAlign: 'left' }}
                  onClick={() => { setAddressId(a.id); nav(back); }} aria-pressed={addressId === a.id}
                >
                  <div className="list-row__main">
                    <span className="list-row__title">{a.label}</span>
                    <span className="small muted">{a.line1}</span>
                  </div>
                  {addressId === a.id ? <span className="badge badge--info">선택됨</span> : <Icon name="chevron" size={18} />}
                </button>
              </li>
            ))}
          </ul>
        )}
      </AsyncView>
    </Page>
  );
}
