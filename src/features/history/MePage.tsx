import { Link } from 'react-router-dom';
import { Page } from '../../app/Page';
import { useRepo } from '../../app/context';
import { useAsync } from '../../app/hooks';
import { Icon } from '../../components/Icon';
import { AsyncView, Banner, Section } from '../../components/ui';

/**
 * C-24 내 정보. 로그인 없는 데모라 계정 이메일·로그인·로그아웃이 없고, 가상 데모 고객 프로필만 보여준다.
 * 주소 메뉴는 두지 않는다: 지역·건물 설정은 업체 찾기 상단, 상세 주소 입력·저장은 수리 신청서에서 한다.
 */
export function MePage() {
  const repo = useRepo();
  const q = useAsync(() => repo.getProfile(), [repo]);
  return (
    <Page title="내 정보" tabs>
      <h2 style={{ fontSize: 'var(--fs-xl)' }}>내 정보</h2>
      <AsyncView state={q}>
        {(p) => (
          <div className="card row">
            <span className="avatar" aria-hidden><Icon name="user" /></span>
            <div className="grow"><p className="strong">{p.name}</p><p className="small muted">데모 고객 · {p.phoneMasked}</p></div>
          </div>
        )}
      </AsyncView>
      <Section title="내역·안내">
        <ul className="card card--flush divided">
          <li><Link className="list-row" to="/ledger"><Icon name="wallet" /><span className="list-row__main"><span className="list-row__title">결제·환불 내역</span></span><Icon name="chevron" size={18} /></Link></li>
          <li><Link className="list-row" to="/guide"><Icon name="info" /><span className="list-row__main"><span className="list-row__title">이용 안내·약관·개인정보</span></span><Icon name="chevron" size={18} /></Link></li>
        </ul>
      </Section>
      <Banner tone="info" title="로그인 없는 데모예요">하나의 가상 데모 고객으로 체험해요. 요청·예약·결제 내역은 가상 데이터이고 이 브라우저 탭에만 저장돼요. 결제·환불·알림은 모두 모의예요.</Banner>
    </Page>
  );
}
