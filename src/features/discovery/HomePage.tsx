import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Page } from '../../app/Page';
import { useRepo } from '../../app/context';
import { useAsync } from '../../app/hooks';
import { Icon } from '../../components/Icon';
import { AsyncView, CoopGuideHint, LinkButton, Section, Skeleton } from '../../components/ui';
import { addressSubline, addressTitle, useExploreAddress } from './exploreAddress';
import { CATEGORY_ART, CATEGORY_ART_SIZE, CATEGORY_TITLE } from './categoryArt';
import { Fragment } from 'react';

/** ‘·’ 뒤에서만 줄바꿈되게 한다(의미 단위, 최대 두 줄) */
function TitleText({ text }: { text: string }) {
  const parts = text.split('·');
  return <>{parts.map((p, i) => <Fragment key={i}>{p}{i < parts.length - 1 && <>·<wbr /></>}</Fragment>)}</>;
}

export function HomePage() {
  const repo = useRepo();
  // 카테고리별 업체 목록과 같은 탐색 주소 상태를 쓴다
  const { addressId, address: addr } = useExploreAddress();
  const cats = useAsync(() => repo.listCategories(), [repo]);
  // 이미지를 불러오지 못한 카테고리: 같은 크기의 빈 이미지 영역을 두고 이름·이동은 그대로
  const [broken, setBroken] = useState<Set<string>>(() => new Set());
  return (
    <Page title="업체 찾기" tabs>
      {/* 업체 찾기 상단: 지역·건물 주소만 간결하게(동·호수는 표시하지 않음). 누르면 설정·변경 */}
      <Section title="지역·건물 주소">
        {addressId === null ? (
          <div className="card stack">
            <p>수리받을 지역·건물을 정하면, 같은 날 함께 참여할 수 있는 공동 예약 후보를 알려드려요.</p>
            <LinkButton to="/address?back=/" variant="primary" block><Icon name="pin" size={18} />지역·건물 주소 설정하기</LinkButton>
          </div>
        ) : (
          <AsyncView state={addr} loading={<Skeleton h={60} />}>
            {(a) => a && (
              <Link to="/address?back=/" className="card list-row explore-address" aria-label={`지역·건물 주소 변경: ${addressTitle(a)}`}>
                <Icon name="pin" />
                <span className="list-row__main">
                  <span className="list-row__title">{addressTitle(a)}</span>
                  {addressSubline(a) && <span className="small muted">{addressSubline(a)}</span>}
                </span>
                <span className="small strong nowrap" style={{ color: 'var(--c-primary)' }}>변경</span>
              </Link>
            )}
          </AsyncView>
        )}
      </Section>

      {/* 공동 예약 안내는 카테고리 제목 영역에 둔다: 넓은 화면은 제목 오른쪽 끝, 좁은 화면은 제목 아래 줄. 상세는 ‘이용 방법’ */}
      <Section title="어떤 수리가 필요하세요?" aside={<CoopGuideHint />} headClassName="section__head--hint">
        <AsyncView state={cats} loading={<Skeleton h={140} n={4} />}>
          {(list) => (
            <ul className="cat-grid">
              {list.map((c) => {
                const src = CATEGORY_ART[c.id];
                return (
                  <li key={c.id}>
                    {/* 카드 전체가 하나의 링크(안에 다른 버튼 없음). 이미지는 장식이라 alt를 비우고, 링크 이름은 보이는 제목과 같게 둔다(줄바꿈용 <wbr> 영향 없음) */}
                    <Link className="cat-card" to={`/providers?category=${c.id}`} aria-label={CATEGORY_TITLE[c.id] ?? c.name}>
                      <span className="cat-card__art">
                        {src && !broken.has(c.id) && (
                          <img src={src} alt="" width={CATEGORY_ART_SIZE.width} height={CATEGORY_ART_SIZE.height} decoding="async" draggable={false}
                            onError={() => setBroken((s) => new Set(s).add(c.id))} />
                        )}
                      </span>
                      <span className="cat-card__name"><TitleText text={CATEGORY_TITLE[c.id] ?? c.name} /></span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </AsyncView>
      </Section>
    </Page>
  );
}
