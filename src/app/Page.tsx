import type { ReactNode } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { Banner } from '../components/ui';

const TABS = [
  { to: '/', label: '업체 찾기', icon: 'find', end: true },
  { to: '/requests', label: '내 요청', icon: 'list' },
  { to: '/bookings', label: '내 예약', icon: 'calendar' },
  { to: '/me', label: '내 정보', icon: 'user' },
];

/** 헤더 + 본문 + (최상위 화면에서만) 하단 탭. 고정 하단 버튼은 ActionBar로 흐름 안에 둔다. */
export function Page({ title, back, tabs, focus, children }: { title: string; back?: string; tabs?: boolean; /** 인증 화면: 메뉴·하단 탭을 숨기고 폼에 집중 */ focus?: boolean; children: ReactNode }) {
  const loc = useLocation();
  const nav = useNavigate();
  const notice = (loc.state as { notice?: string } | null)?.notice;
  const sent = (loc.state as { flash?: string } | null)?.flash;
  return (
    <div className="app">
      <a href="#main" className="skip-link">본문으로 건너뛰기</a>
      <header className="app-header">
        <div className="app-header__inner">
          {back === 'history' ? (
            <button type="button" className="icon-btn" aria-label="뒤로 가기" onClick={() => ((window.history.state?.idx ?? 0) > 0 ? nav(-1) : nav('/'))}><Icon name="back" /></button>
          ) : back ? (
            <Link to={back} className="icon-btn" aria-label="뒤로 가기"><Icon name="back" /></Link>
          ) : focus ? (
            <span className="app-header__brand">온김에</span>
          ) : (
            <Link to="/" className="app-header__brand" aria-label="온김에 홈">온김에</Link>
          )}
          {back && <h1 className="app-header__title" style={{ fontSize: 'var(--fs-lg)' }}>{title}</h1>}
          {!back && <h1 className="sr-only">{title}</h1>}
          {!focus && (
            <nav className="top-nav" aria-label="주요 메뉴">
              {TABS.map((t) => <NavLink key={t.to} to={t.to} end={t.end}>{t.label}</NavLink>)}
            </nav>
          )}
        </div>
      </header>
      <main id="main" className={`main${tabs ? ' main--tabs' : ''}`}>
        <div className="stack stack--lg">
          {notice && <Banner tone="warn" title="알림 이후 내용이 바뀌었어요">{notice}</Banner>}
          {sent && <Banner tone="success" title={sent} />}
          {children}
        </div>
      </main>
      {tabs && !focus && (
        <nav className="tabbar" aria-label="하단 메뉴">
          <ul>
            {TABS.map((t) => (
              <li key={t.to}>
                <NavLink to={t.to} end={t.end}><Icon name={t.icon} />{t.label}</NavLink>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </div>
  );
}

export function ActionBar({ children, note }: { children: ReactNode; note?: ReactNode }) {
  return (
    <div className="action-bar">
      {note && <p className="action-bar__note">{note}</p>}
      {children}
    </div>
  );
}
