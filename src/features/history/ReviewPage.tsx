import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ActionBar, Page } from '../../app/Page';
import { useRepo } from '../../app/context';
import { useAction, useAsync, useAttemptKey } from '../../app/hooks';
import { Icon } from '../../components/Icon';
import { AsyncView, Banner, Button, Field, LinkButton, Stars } from '../../components/ui';

/** C-23 리뷰 작성. 정산이 완료된 실제 이용 건만 가능하다. */
export function ReviewPage() {
  const { id = '' } = useParams();
  const repo = useRepo();
  const nav = useNavigate();
  const q = useAsync(() => repo.getReviewContext(id), [repo, id]);
  const action = useAction();
  const key = useAttemptKey('rev');
  const [rating, setRating] = useState(0);
  const [body, setBody] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [touched, setTouched] = useState(false);
  return (
    <Page title="리뷰 작성" back={`/bookings/${id}`}>
      <AsyncView state={q}>
        {(c) => c.existing ? (
          <>
            <Banner tone="success" title="이미 리뷰를 작성했어요" />
            <div className="card stack--sm stack"><Stars value={c.existing.rating} /><p>{c.existing.body}</p></div>
            <LinkButton to={`/bookings/${id}`} variant="primary" block>예약 상세 보기</LinkButton>
          </>
        ) : !c.eligible ? (
          <>
            <Banner tone="info" title="정산이 끝난 이용 건에서 리뷰를 쓸 수 있어요">최종 금액 확인과 정산이 끝나면 리뷰를 작성할 수 있어요.</Banner>
            <LinkButton to={`/bookings/${id}`} variant="primary" block>예약 상세 보기</LinkButton>
          </>
        ) : (
          <form className="stack stack--lg" noValidate onSubmit={(e) => {
            e.preventDefault(); setTouched(true);
            if (!rating || !body.trim()) return;
            void action.run(async () => { await repo.createReview({ bookingId: id, rating, body: body.trim(), photoNames: photos, idempotencyKey: key.get() }); nav(`/bookings/${id}`, { state: { flash: '리뷰를 등록했어요.' } }); });
          }}>
            <p><b>{c.providerName}</b> 이용은 어떠셨나요?</p>
            <fieldset className="stack--sm stack" style={{ border: 0, margin: 0, padding: 0 }}>
              <legend className="field__label">별점</legend>
              <div className="chips">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button key={n} type="button" className="chip" aria-pressed={rating === n} onClick={() => setRating(n)} aria-label={`${n}점`}><Icon name="star" size={18} />{n}</button>
                ))}
              </div>
              {touched && !rating && <p className="field__error" role="alert">별점을 선택해 주세요.</p>}
            </fieldset>
            <Field label="후기" error={touched && !body.trim() ? '후기를 입력해 주세요.' : null}>
              {(p) => <textarea {...p} className="textarea" value={body} maxLength={500} onChange={(e) => setBody(e.target.value)} />}
            </Field>
            <Field label="사진 (선택)" hint="얼굴·연락처·정확한 주소가 보이지 않게 해 주세요. 모의 화면이라 파일 이름만 기록돼요.">
              {(p) => <input {...p} type="file" accept="image/*" multiple className="input" onChange={(e) => setPhotos(Array.from(e.target.files ?? []).slice(0, 3).map((f) => f.name))} />}
            </Field>
            {photos.length > 0 && <div className="chips">{photos.map((n) => <span key={n} className="photo-chip"><Icon name="camera" size={14} />{n}</span>)}</div>}
            <Banner tone="info" title="개인정보를 지켜 주세요">후기는 다른 이용자에게 공개돼요. 이웃의 정보나 내 주소·연락처는 적지 않아요.</Banner>
            {action.error && <Banner tone="danger" title={action.error.title}>{action.error.hint}</Banner>}
            <ActionBar><Button type="submit" variant="primary" block busy={action.busy}>리뷰 등록하기</Button></ActionBar>
          </form>
        )}
      </AsyncView>
    </Page>
  );
}
