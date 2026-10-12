import { useNavigate, useSearchParams } from 'react-router-dom';
import { Page } from '../../app/Page';
import { useAppState } from '../../app/context';
import { Banner } from '../../components/ui';
import { AddressSearch } from './AddressSearch';

/**
 * C-02 업체 찾기 지역·건물 주소 설정. 고른 주소는 이 사용자의 탐색 주소로 저장돼 재접속 시 기본값이 된다.
 * 동·호수는 받지 않는다(신청서에서 입력). 기존 요청·예약의 방문 주소는 바뀌지 않는다. 자동 위치 수집은 하지 않는다.
 */
export function AddressPage() {
  const nav = useNavigate();
  const [sp] = useSearchParams();
  // 앱 안 경로만 허용(외부 주소로 이동하지 않음)
  const raw = sp.get('back') || '/';
  const back = raw.startsWith('/') && !raw.startsWith('//') ? raw : '/';
  const { addressId, setAddressId } = useAppState();
  return (
    <Page title="지역·건물 주소 설정" back={back}>
      <Banner tone="info">업체 찾기에서 참여할 수 있는 공동 예약 후보를 찾는 데 써요. 동·호수는 수리 신청서에서 입력하고, 요청을 받은 업체와 나만 볼 수 있어요.</Banner>
      <AddressSearch selectedId={addressId} onPick={(a) => { setAddressId(a.id); nav(back); }} />
    </Page>
  );
}
