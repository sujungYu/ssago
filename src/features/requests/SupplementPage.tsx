import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ActionBar, Page } from '../../app/Page';
import { useRepo } from '../../app/context';
import { useAction, useAsync, useAttemptKey } from '../../app/hooks';
import { Icon } from '../../components/Icon';
import { AsyncView, Banner, Button, Field } from '../../components/ui';

/** C-09 요청서 보완 */
export function SupplementPage() {
  const { id = '' } = useParams();
  const repo = useRepo();
  const nav = useNavigate();
  const q = useAsync(() => repo.getRequest(id), [repo, id]);
  const action = useAction();
  const key = useAttemptKey('sup');
  const [msg, setMsg] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [touched, setTouched] = useState(false);
  return (
    <Page title="요청서 보완" back={`/requests/${id}`}>
      <AsyncView state={q}>
        {(d) => d.request.status !== 'needs_info' || !d.request.infoRequest ? (
          <Banner tone="info" title="지금은 보완할 내용이 없어요">업체가 추가 정보를 요청하면 이 화면에서 보완할 수 있어요.</Banner>
        ) : (
          <form className="stack stack--lg" noValidate onSubmit={(e) => {
            e.preventDefault(); setTouched(true);
            if (!msg.trim() && !photos.length) return;
            void action.run(async () => {
              await repo.supplementRequest(id, { message: msg.trim(), photoNames: photos, idempotencyKey: key.get() });
              nav(`/requests/${id}`, { state: { flash: '보완한 내용을 보냈어요. 업체가 다시 검토해요.' } });
            });
          }}>
            <Banner tone="warn" title={`${d.provider.name}의 요청`}>{d.request.infoRequest.message}</Banner>
            <Field label="보완 내용" error={touched && !msg.trim() && !photos.length ? '내용을 입력하거나 사진을 추가해 주세요.' : null}>
              {(p) => <textarea {...p} className="textarea" value={msg} maxLength={500} onChange={(e) => setMsg(e.target.value)} />}
            </Field>
            <Field label="사진 (선택)" hint="모의 화면이라 파일 이름만 기록돼요.">
              {(p) => <input {...p} type="file" accept="image/*" multiple className="input" onChange={(e) => setPhotos(Array.from(e.target.files ?? []).slice(0, 5).map((f) => f.name))} />}
            </Field>
            {photos.length > 0 && <div className="chips">{photos.map((n) => <span key={n} className="photo-chip"><Icon name="camera" size={14} />{n}</span>)}</div>}
            {action.error && <Banner tone="danger" title={action.error.title}>{action.error.hint}</Banner>}
            <ActionBar><Button type="submit" variant="primary" block busy={action.busy}>보완 내용 보내기</Button></ActionBar>
          </form>
        )}
      </AsyncView>
    </Page>
  );
}
