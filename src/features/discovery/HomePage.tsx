import { Link } from 'react-router-dom';
import { Page } from '../../app/Page';
import { useAppState, useRepo } from '../../app/context';
import { useAsync } from '../../app/hooks';
import { Icon } from '../../components/Icon';
import { AsyncView, Banner, GuideCard, LinkButton, Section, Skeleton } from '../../components/ui';

export function HomePage() {
  const repo = useRepo();
  const { addressId } = useAppState();
  const cats = useAsync(() => repo.listCategories(), [repo]);
  const addr = useAsync(() => (addressId ? repo.getAddress(addressId) : Promise.resolve(null)), [repo, addressId]);
  return (
    <Page title="업체 찾기" tabs>
      <Section title="방문 지역">
        {addressId === null ? (
          <div className="card stack">
            <p>수리받을 곳을 정하면, 같은 날 함께 참여할 수 있는 공동 예약이 있는지 알려드려요.</p>
            <LinkButton to="/address?back=/" variant="primary" block><Icon name="pin" size={18} />방문 지역 설정하기</LinkButton>
          </div>
        ) : (
          <AsyncView state={addr} loading={<Skeleton h={72} />}>
            {(a) => a && (
              <div className="card row row--between">
                <div className="grow">
                  <p className="strong">{a.label}</p>
                  <p className="small muted">{a.line1}</p>
                </div>
                <LinkButton to="/address?back=/" variant="secondary" sm>변경</LinkButton>
              </div>
            )}
          </AsyncView>
        )}
      </Section>

      <GuideCard illustrated />

      <Section title="어떤 수리가 필요하세요?">
        <AsyncView state={cats} loading={<Skeleton h={60} n={5} />}>
          {(list) => (
            <ul className="cat-grid">
              {list.map((c) => (
                <li key={c.id}>
                  <Link className="cat" to={`/providers?category=${c.id}`}>
                    <Icon name={c.icon} /><span>{c.name}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </AsyncView>
      </Section>
      <Banner tone="info" title="요청만으로는 예약이 확정되지 않아요">업체가 승인하고 예약금을 결제해야 예약이 확정돼요.</Banner>
    </Page>
  );
}
