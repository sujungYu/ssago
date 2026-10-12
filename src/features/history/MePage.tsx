import { Link } from 'react-router-dom';
import { useAuth } from '../../app/auth';
import { Page } from '../../app/Page';
import { useRepo } from '../../app/context';
import { useAction, useAsync } from '../../app/hooks';
import { Icon } from '../../components/Icon';
import { AsyncView, Banner, Button, Section } from '../../components/ui';

/**
 * C-24 내 정보. 로그인 계정(Supabase Auth) 이메일과 로그아웃. 이름·연락처는 목업 가상 고객 정보이며 계정 정보 수정·탈퇴는 미정.
 * 주소 메뉴는 두지 않는다: 지역·건물 설정은 업체 찾기 상단, 상세 주소 입력·저장은 수리 신청서에서 한다.
 */
export function MePage() {
  const repo = useRepo();
  const q = useAsync(() => repo.getProfile(), [repo]);
  const { auth, state } = useAuth();
  const email = state.status === 'signedIn' ? state.session.email : '';
  const action = useAction();
  // 로그아웃하면 인증 상태가 바뀌어 로그인 화면으로 이동하고, 목업 상태·화면 캐시가 초기화된다.
  const signOut = () => void action.run(() => auth.signOut());
  return (
    <Page title="내 정보" tabs>
      <h2 style={{ fontSize: 'var(--fs-xl)' }}>내 정보</h2>
      <AsyncView state={q}>
        {(p) => (
          <>
            <div className="card row">
              <span className="avatar" aria-hidden><Icon name="user" /></span>
              <div className="grow"><p className="strong">{email}</p><p className="small muted">데모 프로필: {p.name} · {p.phoneMasked}</p></div>
            </div>
          </>
        )}
      </AsyncView>
      <Section title="내역·안내">
        <ul className="card card--flush divided">
          <li><Link className="list-row" to="/ledger"><Icon name="wallet" /><span className="list-row__main"><span className="list-row__title">결제·환불 내역</span></span><Icon name="chevron" size={18} /></Link></li>
          <li><Link className="list-row" to="/guide"><Icon name="info" /><span className="list-row__main"><span className="list-row__title">이용 안내·약관·개인정보</span></span><Icon name="chevron" size={18} /></Link></li>
        </ul>
      </Section>
      {action.error && <Banner tone="danger" title={action.error.title}>{action.error.hint}</Banner>}
      <Button variant="secondary" block busy={action.busy} onClick={signOut}>로그아웃</Button>
      {auth.kind === 'demo' && <Banner tone="warn" title="데모 로그인 · 실제 계정이 아니에요">Supabase 연결 전 임시 로그인이에요. 이 계정은 이 브라우저에만 저장돼 있어요.</Banner>}
      <Banner tone="info" title="데모 화면이에요">요청·예약·결제 내역은 가상 데모 데이터예요. 결제·환불·알림은 모두 모의이고, 계정 정보 수정·탈퇴는 아직 정해지지 않았어요.</Banner>
    </Page>
  );
}
