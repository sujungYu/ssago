import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ActionBar, Page } from '../../app/Page';
import { useAppState, useRepo } from '../../app/context';
import { useAction, useAsync, useAttemptKey } from '../../app/hooks';
import { addHours, formatDate, formatDateTime, seoulYmd } from '../../domain/time';
import { formatSlot } from '../../domain/visitTime';
import { formatWon } from '../../domain/money';
import { expectedFeeForJoiner } from '../../domain/pricing';
import { Icon } from '../../components/Icon';
import { AsyncView, Banner, Button, Field, KV, Section } from '../../components/ui';

interface TaskDraft { key: number; title: string; description: string; photoNames: string[] }
const DEFAULT_SLOTS = ['09:00–12:00', '13:00–16:00', '16:00–19:00'];
let seq = 1;
const blank = (): TaskDraft => ({ key: seq++, title: '', description: '', photoNames: [] });

/** C-05 수리 요청서. 요청만으로는 예약이 확정되지 않는다. */
export function RequestFormPage() {
  const { id = '' } = useParams();
  const [sp] = useSearchParams();
  const groupId = sp.get('group');
  const isNew = sp.get('new') === '1';
  const repo = useRepo();
  const nav = useNavigate();
  const { addressId, bundleId, setBundleId } = useAppState();
  const provider = useAsync(() => repo.getProvider(id, addressId), [repo, id, addressId]);
  const address = useAsync(() => (addressId ? repo.getAddress(addressId) : Promise.resolve(null)), [repo, addressId]);
  const bundle = useAsync(() => (bundleId ? repo.getBundle(bundleId) : Promise.resolve(null)), [repo, bundleId]);
  const action = useAction();
  const attempt = useAttemptKey('req');

  const [tasks, setTasks] = useState<TaskDraft[]>([blank()]);
  const [slots, setSlots] = useState<string[]>([]);
  const [newDate, setNewDate] = useState('');
  const [detail, setDetail] = useState('');
  const [touched, setTouched] = useState(false);
  const prefilled = useRef(false);

  useEffect(() => {
    if (prefilled.current || !bundle.data) return;
    prefilled.current = true;
    setTasks(bundle.data.tasks.map((t) => ({ key: seq++, title: t.title, description: t.description, photoNames: [...t.photoNames] })));
  }, [bundle.data]);

  const back = `/providers/${id}`;
  if (addressId === null) {
    return (
      <Page title="수리 요청서" back={back}>
        <Banner tone="info" title="방문 지역을 먼저 설정해 주세요">요청서에는 수리받을 주소가 필요해요.</Banner>
        <Link className="btn btn--primary btn--block" to={`/address?back=${encodeURIComponent(`/providers/${id}/request?${sp.toString()}`)}`}>방문 지역 설정하기</Link>
      </Page>
    );
  }

  return (
    <Page title="수리 요청서" back={back}>
      <AsyncView state={provider}>
        {(p) => {
          const group = groupId ? p.groups.find((g) => g.id === groupId) : undefined;
          const joint = !isNew && !!groupId;
          const groupMissing = joint && !group;
          const now = repo.now();
          const minDate = seoulYmd(addHours(now, 48));
          const slotOptions = group?.slots ?? DEFAULT_SLOTS;
          const apartment = address.data?.kind === 'apartment';

          const err = {
            tasks: tasks.some((t) => !t.title.trim()) ? '작업 내용을 입력해 주세요.' : null,
            slots: slots.length === 0 ? '고객 가능 시간을 하나 이상 선택해 주세요.' : null,
            date: !joint && !newDate ? '희망 방문 날짜를 선택해 주세요.' : !joint && newDate < minDate ? `${formatDate(minDate)} 이후 날짜를 선택해 주세요.` : null,
            detail: apartment && !detail.trim() ? '동·호수를 입력해 주세요.' : null,
          };
          const valid = !Object.values(err).some(Boolean) && !groupMissing;

          const submit = () => {
            setTouched(true);
            if (!valid) return;
            void action.run(async () => {
              const r = await repo.createRequest({
                providerId: p.id, groupId: joint ? groupId : null, newDateWish: joint ? undefined : newDate, slots,
                tasks: tasks.map((t) => ({ title: t.title.trim(), description: t.description.trim(), photoNames: t.photoNames })),
                addressId, addressDetail: detail.trim(), bundleId: bundleId ?? undefined, idempotencyKey: attempt.get(),
              });
              setBundleId(null);
              nav(`/requests/${r.id}`, { state: { flash: '요청을 보냈어요. 업체가 검토하는 동안에는 예약이 확정되지 않아요.' } });
            });
          };

          return (
            <form className="stack stack--lg" noValidate onSubmit={(e) => { e.preventDefault(); submit(); }}>
              <div className="card">
                <KV rows={[
                  { k: '업체', v: p.name },
                  { k: '요청 방식', v: joint && group ? '공동 예약 날짜 참여' : '새 날짜 요청' },
                  ...(group ? [
                    { k: '방문 날짜', v: formatDate(group.date) },
                    { k: '접수 마감', v: <span className="nowrap">{formatDateTime(group.closeAt)}</span> },
                    { k: '내 예상 출장비', v: <span className="money">약 {formatWon(expectedFeeForJoiner(group.totalTripFee, group.confirmedHouseholds))}</span> },
                  ] : []),
                ]} />
              </div>
              {groupMissing && (
                <Banner tone="warn" title="이 공동 예약에는 지금 참여할 수 없어요">접수가 끝났거나 현재 주소로 참여할 수 없는 일정이에요. 업체 상세에서 다른 날짜를 고르거나 새 날짜로 요청해 주세요.</Banner>
              )}
              {bundleId && <Banner tone="info" title="같은 작업을 다른 업체에도 요청하고 있어요">앞서 보낸 요청과 한 묶음으로 비교할 수 있어요. 한 업체를 예약하면 나머지 요청은 종료돼요.</Banner>}

              <Section title="작업 내용">
                {tasks.map((t, i) => (
                  <div key={t.key} className="card stack">
                    <div className="row row--between">
                      <h3>작업 {i + 1}</h3>
                      {tasks.length > 1 && <Button variant="ghost" sm onClick={() => setTasks(tasks.filter((x) => x.key !== t.key))}>삭제</Button>}
                    </div>
                    <Field label="어떤 작업인가요?" error={touched && !t.title.trim() ? '작업 내용을 입력해 주세요.' : null}>
                      {(fp) => <input {...fp} className="input" value={t.title} maxLength={40} placeholder="예: 주방 수전 교체" onChange={(e) => setTasks(tasks.map((x) => x.key === t.key ? { ...x, title: e.target.value } : x))} />}
                    </Field>
                    <Field label="자세한 설명" hint="증상, 크기, 모델명을 알려주시면 정확한 승인에 도움이 돼요.">
                      {(fp) => <textarea {...fp} className="textarea" value={t.description} maxLength={500} onChange={(e) => setTasks(tasks.map((x) => x.key === t.key ? { ...x, description: e.target.value } : x))} />}
                    </Field>
                    <Field label="사진 (선택)" hint="모의 화면이라 파일은 올라가지 않고 파일 이름만 기록돼요. 얼굴·연락처가 보이지 않게 찍어 주세요.">
                      {(fp) => (
                        <input {...fp} type="file" accept="image/*" multiple className="input"
                          onChange={(e) => setTasks(tasks.map((x) => x.key === t.key ? { ...x, photoNames: Array.from(e.target.files ?? []).slice(0, 5).map((f) => f.name) } : x))} />
                      )}
                    </Field>
                    {t.photoNames.length > 0 && <div className="chips">{t.photoNames.map((n) => <span key={n} className="photo-chip"><Icon name="camera" size={14} />{n}</span>)}</div>}
                  </div>
                ))}
                {tasks.length < 5 && <Button variant="secondary" onClick={() => setTasks([...tasks, blank()])}><Icon name="plus" size={18} />작업 추가하기</Button>}
              </Section>

              <Section title="방문 주소">
                <div className="card stack">
                  <AsyncView state={address} loading={<p className="muted">주소를 불러오는 중이에요</p>}>
                    {(a) => a && (
                      <div className="row row--between row--top">
                        <div className="grow"><p className="strong">{a.label}</p><p className="small muted">{a.line1}</p></div>
                        <Link className="btn btn--secondary btn--sm" to={`/address?back=${encodeURIComponent(`/providers/${id}/request?${sp.toString()}`)}`}>변경</Link>
                      </div>
                    )}
                  </AsyncView>
                  <Field label={apartment ? '동·호수' : '상세 주소 (선택)'} error={touched ? err.detail : null} hint="요청을 받은 업체와 나만 볼 수 있어요. 공동 예약 이웃에게는 보이지 않아요.">
                    {(fp) => <input {...fp} className="input" value={detail} onChange={(e) => setDetail(e.target.value)} placeholder="예: 301동 1204호" />}
                  </Field>
                </div>
              </Section>

              <Section title="고객 가능 시간">
                {!joint && (
                  <Field label="희망 방문 날짜" error={touched ? err.date : null} hint="새 날짜로 요청하면 업체가 승인하면서 접수 마감을 정해요.">
                    {(fp) => <input {...fp} type="date" className="input" min={minDate} value={newDate} onChange={(e) => setNewDate(e.target.value)} />}
                  </Field>
                )}
                <p className="small muted">방문받을 수 있는 시간 범위를 골라 주세요. 업체가 이 범위 안에서 방문(도착) 시각을 제안하고, 예약금을 결제하면 그 시각으로 예약이 확정돼요.</p>
                <div role="group" aria-label="고객 가능 시간 (여러 개 선택 가능)" className="chips">
                  {slotOptions.map((s) => (
                    <button key={s} type="button" className="chip" aria-pressed={slots.includes(s)} onClick={() => setSlots(slots.includes(s) ? slots.filter((x) => x !== s) : [...slots, s])}>
                      {slots.includes(s) && <Icon name="check" size={16} />}{formatSlot(s)}
                    </button>
                  ))}
                </div>
                {touched && err.slots && <p className="field__error" role="alert">{err.slots}</p>}
              </Section>

              {action.error && <Banner tone="danger" title={action.error.title}>{action.error.hint}</Banner>}
              <ActionBar note="요청만으로는 예약이 확정되지 않아요. 업체 승인 후 예약금을 결제해야 확정돼요.">
                <Button variant="primary" block type="submit" busy={action.busy} disabled={groupMissing}>요청 보내기</Button>
              </ActionBar>
            </form>
          );
        }}
      </AsyncView>
    </Page>
  );
}
