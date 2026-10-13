import { useEffect, useRef, useState } from 'react';
import type { PortfolioCase, PortfolioPhotoRole, ProviderProfile } from '../../domain/types';
import { Icon } from '../../components/Icon';
import { PhotoLightbox, ShowcaseImg } from '../../components/PhotoLightbox';
import { Section } from '../../components/ui';

/** 데모 콘텐츠 안내 문구(가상 업체의 소개·사례는 실제 업체·실제 실적이 아니다) */
export const DEMO_IMAGE_LABEL = '데모 이미지';
export const DEMO_PORTFOLIO_NOTE = '실제 실적이 아닌 데모 이미지예요.';
const ROLE_LABEL: Record<PortfolioPhotoRole, string> = { before: '작업 전', after: '작업 후', single: '작업 사진' };

/**
 * 업체 소개: 소개 이미지 + 소개글. 넓은 화면은 이미지와 글을 나란히, 좁은 화면은 이미지 아래에 글을 둔다.
 * 내용은 모두 업체 데이터(profile)에서 오고 업체별 문구를 이 컴포넌트에 두지 않는다.
 */
export function ProviderIntro({ intro, profile }: { intro: string; profile: ProviderProfile }) {
  return (
    <Section title="업체 소개">
      <div className="card pv-intro">
        <div className="pv-intro__media">
          <ShowcaseImg image={profile.photo} eager />
          {profile.demo && <span className="demo-tag">{DEMO_IMAGE_LABEL}</span>}
        </div>
        <div className="pv-intro__text">
          <p>{intro}</p>
          <p className="small">{profile.about}</p>
        </div>
      </div>
    </Section>
  );
}

/**
 * 작업 사례: 사례 카드(사진 + 제목 + 설명)를 한 줄 가로 스크롤 목록으로 보여준다. 카드는 고정 너비라 다음 카드 일부가 보여 넘길 수 있음을 알린다.
 * 전·후 사진은 한 카드 안에 나란히, 한 장뿐인 사례는 한 장만 보여주고, 카드 전체가 함께 움직인다(사진만 따로 넘기지 않음).
 * 넘길 카드가 있으면 넓은 화면에서 제목 오른쪽에 이전·다음 버튼을 둔다(카드 단위 이동, 처음·끝에서는 비활성). 터치·트랙패드는 그대로 스크롤한다.
 * 화면 밖 카드의 사진 버튼에 키보드 포커스가 가면 그 카드가 보이도록 목록이 따라 움직인다.
 * 사진을 누르면 확대 보기(PhotoLightbox)가 열리고 같은 사례의 사진끼리 넘겨 볼 수 있다.
 */
export function ProviderPortfolio({ cases }: { cases: PortfolioCase[] }) {
  const [view, setView] = useState<{ caseId: string; index: number } | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const prevRef = useRef<HTMLButtonElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  // 넘길 수 있는 방향(목록이 넘치지 않으면 둘 다 false → 이동 버튼을 그리지 않는다)
  const [edge, setEdge] = useState({ prev: false, next: false });
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const update = () => {
      const max = el.scrollWidth - el.clientWidth;
      const next = { prev: el.scrollLeft > 1, next: el.scrollLeft < max - 1 };
      setEdge((cur) => (cur.prev === next.prev && cur.next === next.next ? cur : next));
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    ro?.observe(el);
    return () => { el.removeEventListener('scroll', update); ro?.disconnect(); };
  }, [cases.length]);
  // 누른 버튼이 끝에 닿아 비활성화되면 포커스를 반대쪽 버튼으로 옮긴다(포커스가 사라지지 않게)
  useEffect(() => {
    const active = document.activeElement;
    if (active === nextRef.current && !edge.next && edge.prev) prevRef.current?.focus();
    else if (active === prevRef.current && !edge.prev && edge.next) nextRef.current?.focus();
  }, [edge]);
  if (cases.length === 0) return null;
  /** 카드 한 장(카드 너비 + 간격)만큼 이동 */
  const move = (dir: -1 | 1) => {
    const el = listRef.current;
    const card = el?.querySelector<HTMLElement>('.pf-card');
    if (!el || !card) return;
    const gap = parseFloat(getComputedStyle(el).columnGap) || 0;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    el.scrollBy({ left: dir * (card.offsetWidth + gap), behavior: reduce ? 'auto' : 'smooth' });
  };
  const viewing = view ? cases.find((c) => c.id === view.caseId) : undefined;
  const nav = (edge.prev || edge.next) && (
    <div className="pf-nav">
      <button ref={prevRef} type="button" className="pf-nav__btn" aria-label="이전 작업 사례" aria-controls="pf-list" disabled={!edge.prev} onClick={() => move(-1)}><Icon name="back" size={18} /></button>
      <button ref={nextRef} type="button" className="pf-nav__btn" aria-label="다음 작업 사례" aria-controls="pf-list" disabled={!edge.next} onClick={() => move(1)}><Icon name="chevron" size={18} /></button>
    </div>
  );
  return (
    <Section title="작업 사례" aside={nav} headClassName="section__head--pf">
      {cases.some((c) => c.demo) && <p className="xs muted pf-note">{DEMO_PORTFOLIO_NOTE}</p>}
      {/* 화면 밖 카드의 사진 버튼에 포커스가 가면 그 카드 전체가 보이게 옮긴다(스크롤 스냅이 일부만 보이는 위치에서 되돌리지 않게) */}
      <ul className="pf-list" id="pf-list" ref={listRef} tabIndex={0} aria-label={`작업 사례 ${cases.length}개`}
        onFocus={(e) => (e.target as HTMLElement).closest('.pf-card')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })}>
        {cases.map((c) => (
          <li key={c.id} className="card pf-card">
            <div className={`pf-card__photos pf-card__photos--${c.photos.length}`}>
              {c.photos.map((ph, i) => (
                <button key={ph.src} type="button" className="pf-thumb" aria-haspopup="dialog" aria-label={`${c.title} ${ROLE_LABEL[ph.role]} 사진 크게 보기`}
                  onClick={() => setView({ caseId: c.id, index: i })}>
                  <ShowcaseImg image={ph} />
                  <span className="pf-thumb__role" aria-hidden>{ROLE_LABEL[ph.role]}</span>
                  <span className="pf-thumb__zoom" aria-hidden><Icon name="search" size={14} /></span>
                </button>
              ))}
            </div>
            <h3 className="pf-card__title">{c.title}</h3>
            <p className="small muted">{c.description}</p>
          </li>
        ))}
      </ul>
      {view && viewing && (
        <PhotoLightbox title={viewing.title} index={view.index} onIndex={(index) => setView({ caseId: viewing.id, index })} onClose={() => setView(null)}
          items={viewing.photos.map((ph) => ({ image: ph, label: ROLE_LABEL[ph.role] }))} note={viewing.demo ? DEMO_PORTFOLIO_NOTE : undefined} />
      )}
    </Section>
  );
}
