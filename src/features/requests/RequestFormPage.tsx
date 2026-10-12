import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useBackTo } from '../../app/backNav';
import { focusFirstError } from '../../app/focusFirstError';
import { describeError } from '../../domain/errors';
import { FORM_PROGRESS } from '../../domain/progressStep';
import { ProgressSteps } from '../../components/ProgressSteps';
import { ActionBar, Page } from '../../app/Page';
import { useAppState, useRepo } from '../../app/context';
import { useAction, useAsync, useAttemptKey } from '../../app/hooks';
import { addHours, formatDate, formatDateTime, seoulYmd } from '../../domain/time';
import { formatSlot } from '../../domain/visitTime';
import { formatWon } from '../../domain/money';
import { expectedFeeForJoiner } from '../../domain/pricing';
import { Icon } from '../../components/Icon';
import { AsyncView, Banner, Button, Dialog, EmptyState, Field, KV, LinkButton, Section } from '../../components/ui';
import { SAVED_ADDRESS_LOADED, detailError, savedDetailFor } from '../../domain/address';
import { NAME_MAX, PHONE_HINT, formatPhone, nameError, phoneDigits, phoneError } from '../../domain/profile';
import type { Address } from '../../domain/types';
import { AddressSearch } from '../discovery/AddressSearch';

interface TaskDraft { key: number; title: string; description: string; photoNames: string[] }
const DEFAULT_SLOTS = ['09:00–12:00', '13:00–16:00', '16:00–19:00'];
let seq = 1;
const blank = (): TaskDraft => ({ key: seq++, title: '', description: '', photoNames: [] });

/**
 * C-05 수리 요청서. 요청만으로는 예약이 확정되지 않는다.
 * 방문 주소 = 건물(기본 주소) + 상세 주소. 건물은 업체 찾기 탐색 주소로 시작하지만 여기서 바꿔도 탐색 주소는 바뀌지 않는다.
 * 저장한 재사용 주소는 같은 건물일 때만 상세 주소를 자동 입력하고, ‘다음 신청에도 이 주소 사용’은 기본 미선택이다.
 * 이름·연락처는 내 정보(공통 고객 정보)를 기본값으로 한 번만 채운다. 고객이 고친 값은 내 정보가 바뀌어도 덮어쓰지 않고,
 * 여기서 고쳐도 내 정보는 바뀌지 않는다. 제출하면 이 요청에 제출 당시 값으로 저장된다.
 */
export function RequestFormPage() {
  const { id = '' } = useParams();
  const [sp] = useSearchParams();
  const groupId = sp.get('group');
  const isNew = sp.get('new') === '1';
  const repo = useRepo();
  const nav = useNavigate();
  const { addressId, bundleId, setBundleId } = useAppState();
  // 이 신청의 방문 건물. 시작값은 탐색 주소이며, 바꿔도 탐색 주소는 그대로 둔다.
  const [baseId, setBaseId] = useState<string | null>(addressId);
  // 공동 날짜 참여 자격은 정확한 방문 건물 기준으로 다시 확인한다
  const provider = useAsync(() => repo.getProvider(id, baseId), [repo, id, baseId]);
  const address = useAsync(() => (baseId ? repo.getAddress(baseId) : Promise.resolve(null)), [repo, baseId]);
  const saved = useAsync(() => repo.getSavedVisitAddress(), [repo]);
  const bundle = useAsync(() => (bundleId ? repo.getBundle(bundleId) : Promise.resolve(null)), [repo, bundleId]);
  const profile = useAsync(() => repo.getProfile(), [repo]);
  const action = useAction();
  const attempt = useAttemptKey('req');

  const [tasks, setTasks] = useState<TaskDraft[]>([blank()]);
  const [slots, setSlots] = useState<string[]>([]);
  const [newDate, setNewDate] = useState('');
  const [detail, setDetail] = useState('');
  const [autofilled, setAutofilled] = useState<string | null>(null); // 자동 입력한 저장 상세 주소
  const [saveForNext, setSaveForNext] = useState(false); // 고객이 직접 선택(기본 미선택)
  const [picking, setPicking] = useState(false);
  const [baseChanged, setBaseChanged] = useState(false);
  const [touched, setTouched] = useState(false);
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const contactEdited = useRef({ name: false, phone: false }); // 고객이 직접 고친 항목
  const contactFilled = useRef(false);
  const prefilled = useRef(false);
  // 제출 오류 → 첫 오류로 이동: 제출할 때마다 증가시키고, 오류 문구가 렌더링된 뒤(effect) 화면 순서상 첫 오류로 한 번만 이동한다
  const formRef = useRef<HTMLFormElement>(null);
  const errOrder = useRef<string[]>([]);
  const [focusTick, setFocusTick] = useState(0);
  const [errCount, setErrCount] = useState(0);
  useEffect(() => {
    if (focusTick && formRef.current) focusFirstError(formRef.current, errOrder.current);
  }, [focusTick]);
  const filledFor = useRef<string | null>(null);

  // 같은 건물(건물 식별자 + 기본 주소 일치)일 때만 저장한 상세 주소를 자동 입력한다. 고객은 제출 전에 확인·수정할 수 있다.
  useEffect(() => {
    const base = address.data;
    if (!base || filledFor.current === base.id) return;
    if (saved.data === undefined && !saved.error) return; // 저장 주소를 불러오는 중
    filledFor.current = base.id;
    const d = savedDetailFor(saved.data ?? null, base);
    if (d !== null && !detail) { setDetail(d); setAutofilled(d); }
  }, [address.data, saved.data, saved.error]); // eslint-disable-line react-hooks/exhaustive-deps

  // 내 정보로 이름·연락처를 한 번만 채운다. 이미 직접 입력한 항목은 건드리지 않고, 이후 내 정보가 바뀌어도 다시 채우지 않는다.
  useEffect(() => {
    const p = profile.data;
    if (!p || contactFilled.current) return;
    contactFilled.current = true;
    if (!contactEdited.current.name) setContactName(p.name);
    if (!contactEdited.current.phone) setContactPhone(formatPhone(p.phone));
  }, [profile.data]);

  /** 신청서에서 방문 건물을 바꾸면 이전 건물의 상세 주소(자동 입력 포함)를 비우고 다시 확인하게 한다. */
  const changeBase = (a: Address) => {
    setPicking(false);
    if (a.id === baseId) return;
    setBaseChanged(!!detail);
    setBaseId(a.id);
    setDetail('');
    setAutofilled(null);
    setSaveForNext(false);
    filledFor.current = null;
  };

  useEffect(() => {
    if (prefilled.current || !bundle.data) return;
    prefilled.current = true;
    setTasks(bundle.data.tasks.map((t) => ({ key: seq++, title: t.title, description: t.description, photoNames: [...t.photoNames] })));
  }, [bundle.data]);

  // 상단 뒤로가기: 업체 상세에서 왔으면 그 기록으로 한 번만 돌아가고(선택한 날짜·그룹 유지), 직접 진입이면 업체 상세로 교체한다.
  // 업체 정보를 찾을 수 없으면 업체 찾기로 보낸다. 경로는 앱 내부 경로만 쓴다.
  const providerPath = `/providers/${encodeURIComponent(id)}`;
  const providerMissing = !!provider.error && describeError(provider.error).code === 'not_found';
  const onBack = useBackTo(providerPath, providerMissing || !id ? '/' : providerPath);

  return (
    <Page title="수리 요청서" onBack={onBack} progress={providerMissing ? null : <ProgressSteps progress={FORM_PROGRESS} />}>
      {providerMissing ? (
        <EmptyState icon="tool" title="업체 정보를 찾을 수 없어요" action={<LinkButton to="/" variant="primary">업체 찾기로 가기</LinkButton>}>
          주소가 잘못됐거나 더 이상 제공되지 않는 업체예요. 업체 찾기에서 다시 골라 주세요.
        </EmptyState>
      ) : (
      <AsyncView state={provider}>
        {(p) => {
          const group = groupId ? p.groups.find((g) => g.id === groupId) : undefined;
          const joint = !isNew && !!groupId;
          const groupMissing = joint && !group;
          const now = repo.now();
          const minDate = seoulYmd(addHours(now, 48));
          const slotOptions = group?.slots ?? DEFAULT_SLOTS;
          const apartment = address.data?.kind === 'apartment';

          const taskErr = (i: number, t: TaskDraft) => (!t.title.trim() ? `작업 ${i + 1}에 어떤 수리가 필요한지 입력해 주세요. 예: 주방 수전 교체` : null);
          const err = {
            tasks: tasks.some((t) => !t.title.trim()) ? '작업 내용을 입력해 주세요.' : null,
            slots: slots.length === 0 ? '방문받을 수 있는 시간을 하나 이상 선택해 주세요.' : null,
            date: !joint && !newDate ? '희망 방문 날짜를 선택해 주세요.' : !joint && newDate < minDate ? `${formatDate(minDate)} 이후 날짜를 선택해 주세요.` : null,
            base: !address.data ? '방문할 건물 주소를 선택해 주세요.' : null,
            detail: address.data ? detailError(address.data.kind, detail) : null,
            name: nameError(contactName),
            phone: phoneError(contactPhone),
          };
          const valid = !Object.values(err).some(Boolean) && !groupMissing;
          // 화면 순서대로의 오류 대상(작업 → 건물 주소 → 상세 주소 → 이름 → 연락처 → 희망 날짜 → 가능 시간). 안내 문구는 오류가 아니다
          errOrder.current = [
            ...tasks.filter((t) => !t.title.trim()).map((t) => `task-${t.key}`),
            ...(err.base ? ['base'] : []), ...(err.detail ? ['detail'] : []), ...(err.name ? ['name'] : []), ...(err.phone ? ['phone'] : []),
            ...(err.date ? ['date'] : []), ...(err.slots ? ['slots'] : []),
          ];

          const submit = () => {
            setTouched(true);
            if (!valid) {
              // 제출 중단: 입력값·사진은 그대로 두고, 렌더링 뒤 첫 오류로 이동한다(Enter 제출도 같은 경로)
              setErrCount(errOrder.current.length);
              setFocusTick((n) => n + 1);
              return;
            }
            setErrCount(0);
            void action.run(async () => {
              const r = await repo.createRequest({
                providerId: p.id, groupId: joint ? groupId : null, newDateWish: joint ? undefined : newDate, slots,
                tasks: tasks.map((t) => ({ title: t.title.trim(), description: t.description.trim(), photoNames: t.photoNames })),
                addressId: address.data!.id, addressDetail: detail.trim(), saveAddressForNext: saveForNext,
                contact: { name: contactName.trim(), phone: phoneDigits(contactPhone) },
                bundleId: bundleId ?? undefined, idempotencyKey: attempt.get(),
              });
              setBundleId(null);
              // 제출에 성공한 뒤에만 저장 완료를 알린다(실패·취소 시에는 저장했다고 표시하지 않음)
              nav(`/requests/${r.id}`, { state: { flash: saveForNext
                ? '요청을 보냈어요. 다음 신청에 쓸 주소도 저장했어요. 업체가 검토하는 동안에는 예약이 확정되지 않아요.'
                : '요청을 보냈어요. 업체가 검토하는 동안에는 예약이 확정되지 않아요.' } });
            });
          };

          return (
            <form ref={formRef} className="stack stack--lg" noValidate onSubmit={(e) => { e.preventDefault(); submit(); }}>
              {/* 제출 실패를 한 번만 알린다(각 오류 문구는 낭독하지 않고 입력과 연결 — 포커스가 옮겨지면 읽힌다) */}
              <p className="sr-only" role="status">{touched && errCount > 0 && errOrder.current.length > 0 ? `요청을 보내지 못했어요. 고칠 항목 ${errOrder.current.length}개 중 첫 항목으로 이동했어요.` : ''}</p>
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
                    <Field label="어떤 작업인가요?" error={touched ? taskErr(i, t) : null} liveError={false}>
                      {(fp) => <input {...fp} data-err-target={`task-${t.key}`} className="input" value={t.title} maxLength={40} placeholder="예: 주방 수전 교체" onChange={(e) => setTasks(tasks.map((x) => x.key === t.key ? { ...x, title: e.target.value } : x))} />}
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
                  <div className="stack--sm stack">
                    <p className="small muted">도로명·지번 주소·건물명</p>
                    <AsyncView state={address} loading={<p className="muted">주소를 불러오는 중이에요</p>}>
                      {(a) => a ? (
                        <div className="row row--between row--top">
                          <div className="grow"><p className="strong">{a.label}</p><p className="small">{a.line1}</p></div>
                          <Button variant="secondary" sm onClick={() => setPicking(true)}>다른 주소</Button>
                        </div>
                      ) : (
                        <div className="stack--sm stack" data-err-region>
                          <Button variant="primary" block onClick={() => setPicking(true)} data-err-target="base" aria-describedby={touched && err.base ? 'req-base-err' : undefined}><Icon name="pin" size={18} />방문할 건물 주소 선택</Button>
                          {touched && err.base && <p className="field__error" id="req-base-err">{err.base}</p>}
                        </div>
                      )}
                    </AsyncView>
                    {baseId && baseId !== addressId && <p className="xs muted">이 신청에만 쓰는 주소예요. 업체 찾기의 지역·건물 주소는 그대로예요.</p>}
                  </div>
                  {baseChanged && !detail && <Banner tone="info" title="건물 주소가 바뀌어 상세 주소를 비웠어요">새 주소의 상세 주소를 다시 확인해 주세요.</Banner>}
                  {autofilled !== null && <Banner tone="info" title={SAVED_ADDRESS_LOADED}>{detail !== autofilled ? '저장한 주소와 다르게 수정했어요. 아래에서 저장을 선택하면 다음 신청에 바뀐 주소를 써요.' : undefined}</Banner>}
                  {saved.error !== undefined && <p className="xs muted">저장한 주소를 불러오지 못했어요. 상세 주소를 직접 입력해 주세요.</p>}
                  <Field label={apartment ? '상세 주소' : '상세 주소 (선택)'} error={touched ? err.detail : null} liveError={false}
                    hint="동·호수, 층 등 방문에 필요한 정보예요. 요청을 받은 업체와 나만 볼 수 있어요.">
                    {(fp) => <input {...fp} data-err-target="detail" className="input" value={detail} maxLength={60} autoComplete="off" disabled={!address.data}
                      onChange={(e) => setDetail(e.target.value)} placeholder={apartment ? '예: 301동 1204호' : '예: 2층, 대문 옆 초인종'} />}
                  </Field>
                  <label className="save-address">
                    <input type="checkbox" checked={saveForNext} disabled={!address.data} onChange={(e) => setSaveForNext(e.target.checked)} />
                    <span className="stack--sm stack" style={{ gap: 2 }}>
                      <span className="strong small">다음 신청에도 이 주소 사용</span>
                      <span className="xs muted">요청을 보내면 이 건물과 상세 주소를 저장해, 같은 건물로 다시 신청할 때 자동으로 채워요. 선택하지 않으면 이전에 저장한 주소를 바꾸지 않아요.</span>
                    </span>
                  </label>
                </div>
              </Section>
              {picking && (
                <Dialog title="방문할 건물 주소" onClose={() => setPicking(false)} closeLabel="닫기" actions={null}>
                  <p className="small muted">건물을 바꾸면 이전 건물의 상세 주소는 비워져요.</p>
                  <AddressSearch selectedId={baseId} onPick={changeBase} />
                </Dialog>
              )}

              <Section title="연락받을 정보">
                <div className="card stack">
                  <p className="small muted">업체가 방문 일정을 안내할 때 쓰는 이름·연락처예요. 내 정보에 저장된 값으로 채웠고, 이 요청에만 바꿔 쓸 수 있어요(내 정보는 그대로예요). 데모라 가상 정보를 입력해도 돼요.</p>
                  {profile.error !== undefined && <p className="xs muted">내 정보를 불러오지 못했어요. 이름·연락처를 직접 입력해 주세요.</p>}
                  <Field label="이름" error={touched ? err.name : null} liveError={false}>
                    {(fp) => <input {...fp} data-err-target="name" className="input" value={contactName} maxLength={NAME_MAX + 10} autoComplete="off"
                      onChange={(e) => { contactEdited.current.name = true; setContactName(e.target.value); }} />}
                  </Field>
                  <Field label="연락처" hint={PHONE_HINT} error={touched ? err.phone : null} liveError={false}>
                    {(fp) => <input {...fp} data-err-target="phone" className="input" type="tel" inputMode="tel" value={contactPhone} maxLength={20} autoComplete="off" placeholder="010-0000-0000"
                      onChange={(e) => { contactEdited.current.phone = true; setContactPhone(e.target.value); }} />}
                  </Field>
                </div>
              </Section>

              <Section title="고객 가능 시간">
                {!joint && (
                  <Field label="희망 방문 날짜" error={touched ? err.date : null} liveError={false} hint="새 날짜로 요청하면 업체가 승인하면서 접수 마감을 정해요.">
                    {(fp) => <input {...fp} data-err-target="date" type="date" className="input" min={minDate} value={newDate} onChange={(e) => setNewDate(e.target.value)} />}
                  </Field>
                )}
                <p className="small muted">방문받을 수 있는 시간 범위를 골라 주세요. 업체가 이 범위 안에서 방문(도착) 시각을 제안하고, 예약금을 결제하면 그 시각으로 예약이 확정돼요.</p>
                <div data-err-region className="stack--sm stack">
                <div role="group" aria-label="고객 가능 시간 (여러 개 선택 가능)" className="chips" aria-describedby={touched && err.slots ? 'req-slots-err' : undefined}>
                  {slotOptions.map((s, si) => (
                    <button key={s} type="button" className="chip" aria-pressed={slots.includes(s)} data-err-target={si === 0 ? 'slots' : undefined}
                      aria-describedby={si === 0 && touched && err.slots ? 'req-slots-err' : undefined} onClick={() => setSlots(slots.includes(s) ? slots.filter((x) => x !== s) : [...slots, s])}>
                      {slots.includes(s) && <Icon name="check" size={16} />}{formatSlot(s)}
                    </button>
                  ))}
                </div>
                {touched && err.slots && <p className="field__error" id="req-slots-err">{err.slots}</p>}
                </div>
              </Section>

              {action.error && (
                <div className="stack--sm stack">
                  <Banner tone="danger" title={action.error.title}>{action.error.hint} 입력한 내용은 그대로 있어요.</Banner>
                  <Button variant="secondary" block busy={action.busy} onClick={submit}>다시 보내기</Button>
                </div>
              )}
              <ActionBar note="요청만으로는 예약이 확정되지 않아요. 업체 승인 후 예약금을 결제해야 확정돼요.">
                <Button variant="primary" block type="submit" busy={action.busy} disabled={groupMissing}>요청 보내기</Button>
              </ActionBar>
            </form>
          );
        }}
      </AsyncView>
      )}
    </Page>
  );
}
