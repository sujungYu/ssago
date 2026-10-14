import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useHistoryBack } from './backNav';
import { Icon } from '../components/Icon';
import { BrandLogo } from '../components/brand/Brand';
import { Banner, CountBadge, Skeleton } from '../components/ui';
import { useTodoCounts } from './hooks';

/**
 * 상단·하단 메뉴. ‘내 예약’은 보낸 요청·확정된 예약·완료·취소를 함께 보여주는 메뉴라
 * 요청 상세·비교 요청·요청 보완·승인 조건 확인(/requests/…)과 예약 상세(/bookings/…)에서도 활성으로 표시한다.
 */
const TABS: { to: string; label: string; icon: string; match: string[] }[] = [
  { to: '/', label: '업체 찾기', icon: 'find', match: ['/'] },
  { to: '/bookings', label: '내 예약', icon: 'calendar', match: ['/bookings', '/requests'] },
  { to: '/me', label: '내 정보', icon: 'user', match: ['/me'] },
];
const isTabActive = (t: (typeof TABS)[number], pathname: string) =>
  t.match.some((m) => (m === '/' ? pathname === '/' : pathname === m || pathname.startsWith(`${m}/`)));

/** 헤더 + 본문 + (최상위 화면에서만) 하단 탭. 고정 하단 버튼은 ActionBar로 흐름 안에 둔다. */
/**
 * back: 앱 안에서 들어온 화면이면 그 이전 화면으로 기록을 되돌린다(useHistoryBack). 돌아갈 화면이 없을 때는
 * 경로 문자열이면 그 화면, 'history'면 업체 찾기로 현재 기록을 교체한다.
 * onBack을 주면 화면이 직접 정한 뒤로가기(예: 출발 화면으로 한 번만 돌아가기, useBackTo)를 쓴다.
 * progress: 수리 요청 → 예약 확정 진행 표시(ProgressSteps). 헤더 아래·본문 위에 둔다.
 * title: 조회 결과로 정하는 제목은 불러오는 동안 null을 넘긴다. 기본 문구가 먼저 보였다가 바뀌지 않게 제목 자리를 비워 둔다.
 */
export function Page({ title, back, onBack, tabs, progress, children }: { title: string | null; back?: string; onBack?: () => void; tabs?: boolean; progress?: ReactNode; children: ReactNode }) {
  const loc = useLocation();
  const goBack = useHistoryBack(back && back !== 'history' ? back : '/');
  const notice = (loc.state as { notice?: string } | null)?.notice;
  // 안내 제목: 기본은 알림 진입용. 다른 이동 안내(예: 없앤 카테고리)는 noticeTitle로 바꾼다
  const noticeTitle = (loc.state as { noticeTitle?: string } | null)?.noticeTitle ?? '알림 이후 내용이 바뀌었어요';
  const sent = (loc.state as { flash?: string } | null)?.flash;
  // ‘내 예약’ 옆 확인 필요 합계(보낸 요청 + 확정된 예약, spec 5.48). 0건이면 숨김
  const todo = useTodoCounts();
  const todoTotal = todo ? todo.requests + todo.active : undefined;
  const heading = title ?? <><span className="sr-only">제목을 불러오는 중이에요</span><span className="app-header__title-skeleton"><Skeleton h={22} /></span></>;
  return (
    <div className="app">
      <a href="#main" className="skip-link">본문으로 건너뛰기</a>
      <header className="app-header">
        <div className="app-header__inner">
          {onBack ? (
            <button type="button" className="icon-btn" aria-label="뒤로 가기" onClick={onBack}><Icon name="back" /></button>
          ) : back === 'history' ? (
            <button type="button" className="icon-btn" aria-label="뒤로 가기" onClick={goBack}><Icon name="back" /></button>
          ) : back ? (
            // 링크 주소는 돌아갈 화면이 없을 때의 대체 경로(새 탭 열기용). 누르면 앱 안 이전 화면으로 기록을 되돌린다.
            <Link to={back} className="icon-btn" aria-label="뒤로 가기" onClick={(e) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; e.preventDefault(); goBack(); }}><Icon name="back" /></Link>
          ) : (
            <Link to="/" className="app-header__brand" aria-label="싸고 홈"><BrandLogo /></Link>
          )}
          {(back || onBack) && <h1 className="app-header__title" style={{ fontSize: 'var(--fs-lg)' }}>{heading}</h1>}
          {!back && !onBack && <h1 className="sr-only">{title ?? '불러오는 중이에요'}</h1>}
          <nav className="top-nav" aria-label="주요 메뉴">
            {/* ‘업체 찾기’는 처음 화면(홈)으로 가는 메뉴라 홈 아이콘을 앞에 둔다. 아이콘은 장식(aria-hidden), 링크 이름은 ‘업체 찾기 홈으로 이동’ */}
            {TABS.map((t) => t.to === '/' ? (
              <Link key={t.to} to={t.to} aria-current={isTabActive(t, loc.pathname) ? 'page' : undefined} aria-label="업체 찾기 홈으로 이동" className="top-nav__home"><Icon name="home" size={19} /><span>{t.label}</span></Link>
            ) : <Link key={t.to} to={t.to} aria-current={isTabActive(t, loc.pathname) ? 'page' : undefined}>{t.label}{t.to === '/bookings' && <CountBadge n={todoTotal} />}</Link>)}
          </nav>
        </div>
      </header>
      <main id="main" className={`main${tabs ? ' main--tabs' : ''}`}>
        <div className="stack stack--lg">
          {progress}
          {notice && <Banner tone="warn" title={noticeTitle}>{notice}</Banner>}
          {sent && <Banner tone="success" title={sent} />}
          {children}
        </div>
      </main>
      {tabs && (
        <nav className="tabbar" aria-label="하단 메뉴">
          <ul>
            {TABS.map((t) => (
              <li key={t.to}>
                <Link to={t.to} aria-current={isTabActive(t, loc.pathname) ? 'page' : undefined}><Icon name={t.icon} /><span className="tabbar__label">{t.label}{t.to === '/bookings' && <CountBadge n={todoTotal} />}</span></Link>
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
