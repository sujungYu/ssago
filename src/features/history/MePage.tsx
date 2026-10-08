import { Link } from 'react-router-dom';
import { Page } from '../../app/Page';
import { useRepo } from '../../app/context';
import { useAsync } from '../../app/hooks';
import { Icon } from '../../components/Icon';
import { AsyncView, Banner, Section } from '../../components/ui';

/** C-24 내 정보. 인증·수정·탈퇴는 미정이라 가상 고객 정보만 보여준다. */
export function MePage() {
  const repo = useRepo();
  const q = useAsync(() => repo.getProfile(), [repo]);
  return (
    <Page title="내 정보" tabs>
      <h2 style={{ fontSize: 'var(--fs-xl)' }}>내 정보</h2>
      <AsyncView state={q}>
        {(p) => (
          <>
            <div className="card row">
              <span className="avatar" aria-hidden><Icon name="user" /></span>
              <div className="grow"><p className="strong">{p.name}</p><p className="small muted">{p.phoneMasked}</p></div>
            </div>
            <Section title="저장된 주소">
              <ul className="card card--flush divided">
                {p.addresses.map((a) => (
                  <li key={a.id} className="list-row"><div className="list-row__main"><span className="list-row__title">{a.label}</span><span className="small muted">{a.line1}{a.detail ? ` ${a.detail}` : ''}</span></div></li>
                ))}
              </ul>
            </Section>
          </>
        )}
      </AsyncView>
      <Section title="내역·안내">
        <ul className="card card--flush divided">
          <li><Link className="list-row" to="/ledger"><Icon name="wallet" /><span className="list-row__main"><span className="list-row__title">결제·환불 내역</span></span><Icon name="chevron" size={18} /></Link></li>
          <li><Link className="list-row" to="/guide"><Icon name="info" /><span className="list-row__main"><span className="list-row__title">이용 안내·약관·개인정보</span></span><Icon name="chevron" size={18} /></Link></li>
        </ul>
      </Section>
      <Banner tone="info" title="연습용 화면이에요">로그인 방식과 계정 정보 수정·탈퇴는 아직 정해지지 않아 가상 고객으로 이용 중이에요. 결제·환불·알림도 모두 모의예요.</Banner>
    </Page>
  );
}
