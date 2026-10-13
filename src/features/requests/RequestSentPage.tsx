import { COMPARE_REQUESTS_ENABLED } from '../../domain/demoScope';
import { useEffect, useRef } from 'react';
import { Link, Navigate, useLocation, useParams } from 'react-router-dom';
import { Page } from '../../app/Page';
import { useRepo } from '../../app/context';
import { useAsync } from '../../app/hooks';
import { RepoError } from '../../domain/errors';
import { summarizeSentRequest } from '../../domain/requestSent';
import { listPath } from '../../domain/reservationTabs';
import { Icon } from '../../components/Icon';
import { Banner, EmptyState, ErrorState, KV, LinkButton, LoadingBlock } from '../../components/ui';
import type { BundleDetail, RequestDetail } from '../../data/repositories/types';

/**
 * 수리 요청 완료(C-05 제출 성공 직후). 요청서에서 새 요청 제출이 성공했을 때만 이 주소로 바꿔(replace) 들어온다.
 * 이 화면은 저장된 요청을 조회해서 보여줄 뿐 요청을 만들지 않는다(새로고침·뒤로가기·버튼으로 다시 제출되지 않음).
 * 요청 완료 안내이지 예약 확정이 아니다 — 업체 승인 후 예약금을 결제해야 예약이 확정된다.
 * 이미 검토가 지난 요청(승인·보완 요청·거절·예약 연결 등)으로 들어오면 완료 안내 대신 상세로 보낸다(상세는 여기로 돌려보내지 않아 반복 없음).
 */
export function RequestSentPage() {
  const { id = '' } = useParams();
  const repo = useRepo();
  const loc = useLocation();
  const addressSaved = (loc.state as { addressSaved?: boolean } | null)?.addressSaved === true;
  const q = useAsync(async () => {
    const d = await repo.getRequest(id);
    const b = await repo.getBundle(d.request.bundleId);
    return { d, b };
  }, [repo, id]);

  return (
    <Page title="수리 요청 완료" tabs>
      {q.error ? (
        q.error instanceof RepoError && q.error.code === 'not_found' ? (
          <EmptyState icon="list" title="요청 내용을 찾을 수 없어요"
            action={<LinkButton to={listPath('requests')} variant="primary">보낸 요청 보기</LinkButton>}>
            주소가 잘못됐거나 확인할 수 없는 요청이에요. 보낸 요청에서 진행 상황을 확인해 주세요.
          </EmptyState>
        ) : (
          <>
            <ErrorState error={q.error} onRetry={q.reload} />
            <LinkButton to={listPath('requests')} variant="secondary" block>보낸 요청 보기</LinkButton>
          </>
        )
      ) : q.data ? (
        <Sent d={q.data.d} b={q.data.b} addressSaved={addressSaved} />
      ) : <LoadingBlock />}
    </Page>
  );
}

function Sent({ d, b, addressSaved }: { d: RequestDetail; b: BundleDetail; addressSaved: boolean }) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  const r = d.request;
  // 업체별 하나(같은 묶음 안 같은 업체 요청은 한 번만 센다)
  // 비교 요청을 쓰지 않는 데모에서는 이 요청의 업체만(개별 요청)
  const providers = COMPARE_REQUESTS_ENABLED ? [...new Map(b.items.map((i) => [i.provider.id, i.provider.name])).values()] : [d.provider.name];
  const s = summarizeSentRequest(r.tasks.map((t) => t.title), providers);
  const detailTo = s.compare ? `/requests/bundle/${b.bundleId}` : `/requests/${r.id}`;
  const fresh = r.status === 'reviewing' && !r.bookingId && !r.infoRequest;
  // 제목: 단일 = ‘수리 요청을 보냈어요’, 비교 = ‘N개 업체에 수리 요청을 보냈어요’. 화면에 들어오면 제목으로 포커스를 옮겨 화면 낭독기가 결과부터 읽게 한다
  useEffect(() => { if (fresh) titleRef.current?.focus(); }, [fresh]);
  if (!fresh) return <Navigate to={detailTo} replace />;

  return (
    <div className="sent">
      <div className="sent__head">
        <span className="sent__icon" aria-hidden><Icon name="check" size={30} /></span>
        <h2 ref={titleRef} tabIndex={-1} className="sent__title">{s.compareNote ?? '수리 요청을 보냈어요'}</h2>
        <p className="muted">업체가 작업 가능 여부와 견적을 확인하고 있어요.</p>
        {addressSaved && <p className="small muted">다음 신청에 쓸 주소도 저장했어요.</p>}
      </div>
      <div className="card">
        <KV rows={[
          { k: '요청한 수리', v: s.task },
          { k: '요청한 업체', v: s.compare ? <>{s.providers}{s.providerNames && <span className="sent__names">{s.providerNames}</span>}</> : s.providers },
        ]} />
      </div>
      <Banner tone="info" title="아직 예약이 확정된 것은 아니에요.">업체 승인 후 예약금을 결제하면 예약이 확정돼요.</Banner>
      <div className="stack stack--sm">
        <LinkButton to={detailTo} variant="primary" block>요청 내용 확인하기</LinkButton>
        <p className="small muted sent__foot"><Link to={listPath('requests')}>보낸 요청</Link>에서 진행 상황을 확인할 수 있어요.</p>
      </div>
    </div>
  );
}
