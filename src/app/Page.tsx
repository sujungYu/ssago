import type { ReactNode } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { BrandLogo } from '../components/brand/Brand';
import { Banner } from '../components/ui';

const TABS = [
  { to: '/', label: '업체 찾기', icon: 'find', end: true },
  { to: '/requests', label: '내 요청', icon: 'list' },
  { to: '/bookings', label: '내 예약', icon: 'calendar' },
  { to: '/me', label: '내 정보', icon: 'user' },
];

/** 헤더 + 본문 + (최상위 화면에서만) 하단 탭. 고정 하단 버튼은 ActionBar로 흐름 안에 둔다. */
/**
 * back: 'history'면 기록에서 한 칸 뒤로(없으면 업체 찾기), 경로 문자열이면 그 화면으로 이동하는 링크.
 * onBack을 주면 화면이 직접 정한 뒤로가기(예: 출발 화면으로 한 번만 돌아가기, useBackTo)를 쓴다.
 * progress: 수리 요청 → 예약 확정 진행 표시(ProgressSteps). 헤더 아래·본문 위에 둔다.
 */
export function Page({ title, back, onBack, tabs, progress, children }: { title: string; back?: string; onBack?: () => void; tabs?: boolean; progress?: ReactNode; children: ReactNode }) {
  const loc = useLocation();
  const nav = useNavigate();
  const notice = (loc.state as { notice?: string } | null)?.notice;
  const sent = (loc.state as { flash?: string } | null)?.flash;
  return (
    <div className="app">
      <a href="#main" className="skip-link">본문으로 건너뛰기</a>
      <header className="app-header">
        <div className="app-header__inner">
          {onBack ? (
            <button type="button" className="icon-btn" aria-label="뒤로 가기" onClick={onBack}><Icon name="back" /></button>
          ) : back === 'history' ? (
            <button type="button" className="icon-btn" aria-label="뒤로 가기" onClick={() => ((window.history.state?.idx ?? 0) > 0 ? nav(-1) : nav('/'))}><Icon name="back" /></button>
          ) : back ? (
            <Link to={back} className="icon-btn" aria-label="뒤로 가기"><Icon name="back" /></Link>
          ) : (
            <Link to="/" className="app-header__brand" aria-label="싸고 홈"><BrandLogo /></Link>
          )}
          {(back || onBack) && <h1 className="app-header__title" style={{ fontSize: 'var(--fs-lg)' }}>{title}</h1>}
          {!back && !onBack && <h1 className="sr-only">{title}</h1>}
          <nav className="top-nav" aria-label="주요 메뉴">
            {/* ‘업체 찾기’는 처음 화면(홈)으로 가는 메뉴라 홈 아이콘을 앞에 둔다. 아이콘은 장식(aria-hidden), 링크 이름은 ‘업체 찾기 홈으로 이동’ */}
            {TABS.map((t) => t.to === '/' ? (
              <NavLink key={t.to} to={t.to} end={t.end} aria-label="업체 찾기 홈으로 이동" className="top-nav__home"><Icon name="home" size={19} /><span>{t.label}</span></NavLink>
            ) : <NavLink key={t.to} to={t.to} end={t.end}>{t.label}</NavLink>)}
          </nav>
        </div>
      </header>
      <main id="main" className={`main${tabs ? ' main--tabs' : ''}`}>
        <div className="stack stack--lg">
          {progress}
          {notice && <Banner tone="warn" title="알림 이후 내용이 바뀌었어요">{notice}</Banner>}
          {sent && <Banner tone="success" title={sent} />}
          {children}
        </div>
      </main>
      {tabs && (
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
