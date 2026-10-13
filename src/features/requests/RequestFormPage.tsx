import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useBackTo } from '../../app/backNav';
import { focusFirstError } from '../../app/focusFirstError';
import { describeError } from '../../domain/errors';
import { FORM_PROGRESS } from '../../domain/progressStep';
import { ProgressSteps } from '../../components/ProgressSteps';
import { Page } from '../../app/Page';
import { useAppState, useRepo } from '../../app/context';
import { useAction, useAsync, useAttemptKey } from '../../app/hooks';
import { formatDate, formatDateTime } from '../../domain/time';
import { NEW_REQUEST_BLOCK_TEXT, newRequestBlock } from '../../domain/visitDays';
import { NEW_DATE_WINDOWS, selectableTimes } from '../../domain/visitTime';
import { orderSelected } from '../../domain/taskSelection';
import { formatWon } from '../../domain/money';
import { expectedFeeForJoiner } from '../../domain/pricing';
import { Icon } from '../../components/Icon';
import { AsyncView, Banner, Button, Dialog, EmptyState, Field, KV, LinkButton, Section } from '../../components/ui';
import { SAVED_ADDRESS_LOADED, detailError, savedDetailFor } from '../../domain/address';
import { NAME_MAX, PHONE_HINT, formatPhone, nameError, phoneDigits, phoneError } from '../../domain/profile';
import type { Address } from '../../domain/types';
import { AddressSearch } from '../discovery/AddressSearch';

/** 고른 작업별 작성 내용. 작업 ID로 관리해 선택을 바꿔도 다른 작업의 내용이 섞이지 않는다 */
interface TaskDraft { description: string; photoNames: string[] }
const EMPTY_DRAFT: TaskDraft = { description: '', photoNames: [] };

/**
 * C-05 수리 요청서. 요청만으로는 예약이 확정되지 않는다.
 * 방문 주소 = 건물(기본 주소) + 상세 주소. 건물은 업체 찾기 탐색 주소로 시작하지만 여기서 바꿔도 탐색 주소는 바뀌지 않는다.
 * 저장한 재사용 주소는 같은 건물일 때만 상세 주소를 자동 입력하고, ‘다음 신청에도 이 주소 사용’은 기본 미선택이다.
 * 이름·연락처는 내 정보(공통 고객 정보)를 기본값으로 한 번만 채운다. 고객이 고친 값은 내 정보가 바뀌어도 덮어쓰지 않고,
 * 여기서 고쳐도 내 정보는 바뀌지 않는다. 제출하면 이 요청에 제출 당시 값으로 저장된다.
 * 작업은 업체 등록 작업을 칩으로 여러 개 고르고(직접 입력 없음), 고른 작업마다 설명·사진을 쓴다.
 * 업체가 바뀌면(주소의 업체 ID가 바뀜) 작성 상태를 새로 시작해 이전 업체 작업이 그대로 제출되지 않는다.
 */
export function RequestFormPage() {
  const { id = '' } = useParams();
  const [sp] = useSearchParams();
  // 업체·요청 방식(그룹/새 요청)·희망 날짜가 바뀌면 작성 상태를 새로 시작해 이전 그룹·시각이 남지 않게 한다
  return <RequestForm key={`${id}|${sp.get('group') ?? ''}|${sp.get('new') ?? ''}|${sp.get('date') ?? ''}`} id={id} />;
}

function RequestForm({ id }: { id: string }) {
  const [sp] = useSearchParams();
  const groupId = sp.get('group');
  const isNew = sp.get('new') === '1';
  // 새 요청의 희망 날짜: 업체 상세 ‘방문 날짜 선택’에서 고른 새 요청 가능 날짜(주소에 담아 새로고침해도 유지). 확정 방문일이 아니다
  const wishDate = isNew ? sp.get('date') : null;
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

  // 고른 업체 등록 작업 ID(처음엔 없음)와 작업별 작성 내용. 선택을 해제해도 작성 내용은 이 화면에 남겨 다시 고르면 복원하고,
  // 제출에는 지금 고른 작업만 넣는다.
  const [picked, setPicked] = useState<string[]>([]);
  const [drafts, setDrafts] = useState<Record<string, TaskDraft>>({});
  const [bundleUnmatched, setBundleUnmatched] = useState<string[]>([]);
  const togglePick = (sid: string) => setPicked((cur) => (cur.includes(sid) ? cur.filter((x) => x !== sid) : [...cur, sid]));
  const setDraft = (sid: string, patch: Partial<TaskDraft>) => setDrafts((d) => ({ ...d, [sid]: { ...(d[sid] ?? EMPTY_DRAFT), ...patch } }));
  // 방문 가능한 시각(고객 희망 시각, 정확한 시각 여러 개). 선택했다고 그 시각에 배정·확정되지 않는다
  const [slots, setSlots] = useState<string[]>([]);
  const [droppedTimes, setDroppedTimes] = useState<string[]>([]);
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

  // 같은 작업을 다른 업체에도 요청: 앞선 요청의 작업 중 이 업체 등록 작업과 이름이 같은 것만 미리 고르고 설명·사진을 옮긴다.
  // 이 업체가 등록하지 않은 작업은 고르지 않고 안내만 한다(다른 업체 작업이 그대로 제출되지 않음).
  useEffect(() => {
    if (prefilled.current || !bundle.data || !provider.data) return;
    prefilled.current = true;
    const byName = new Map(provider.data.services.map((s) => [s.name, s.id]));
    const hit: string[] = []; const miss: string[] = []; const next: Record<string, TaskDraft> = {};
    for (const t of bundle.data.tasks) {
      const sid = byName.get(t.title.trim());
      if (sid && !hit.includes(sid)) { hit.push(sid); next[sid] = { description: t.description, photoNames: [...t.photoNames] }; } else if (!sid) miss.push(t.title);
    }
    setPicked(hit); setDrafts(next); setBundleUnmatched(miss);
  }, [bundle.data, provider.data]);

  // 선택 가능한 방문 시각: 공동 예약은 그 그룹의 시간대, 새 날짜 요청은 공통 시간대(NEW_DATE_WINDOWS)에서 1시간 간격으로 만든다
  // (생성 기준은 domain/visitTime.ts 한 곳 — 저장소 검증도 같은 기준). 그룹을 찾을 수 없으면 고를 시각이 없다.
  const jointGroup = !isNew && groupId ? provider.data?.groups.find((g) => g.id === groupId) : undefined;
  const timeOptions = !provider.data ? [] : selectableTimes(!isNew && groupId ? (jointGroup?.slots ?? []) : NEW_DATE_WINDOWS);
  const timeKey = timeOptions.join(',');
  // 일정(그룹 시간대·업체 정보)이 바뀌어 고른 시각이 더 이상 선택 가능하지 않으면 선택을 해제하고 알린다
  useEffect(() => {
    if (!provider.data) return;
    const allowed = new Set(timeKey ? timeKey.split(',') : []);
    const gone = slots.filter((t) => !allowed.has(t));
    if (gone.length) { setSlots((cur) => cur.filter((t) => allowed.has(t))); setDroppedTimes(gone); }
  }, [timeKey, provider.data]); // eslint-disable-line react-hooks/exhaustive-deps

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
          // 희망 날짜가 없거나 지금 업체 접수 기준에 맞지 않으면(직접 진입·기준 변경) 업체 상세에서 날짜를 다시 고르게 한다
          const wishBlock = joint ? null : wishDate ? newRequestBlock(p.newRequest, wishDate, now) : 'missing';
          const apartment = address.data?.kind === 'apartment';

          // 업체 등록 작업(표시 순서)과 지금 고른 작업. 목록에 없는 ID(이전 업체 작업 등)는 고른 것으로 보지 않는다
          const services = p.services;
          const noServices = services.length === 0;
          const noTimes = !groupMissing && timeOptions.length === 0;
          const chosen = orderSelected(services, picked);
          const err = {
            tasks: !noServices && chosen.length === 0 ? '필요한 작업을 하나 이상 선택해 주세요.' : null,
            slots: !noTimes && slots.length === 0 ? '방문 가능한 시각을 하나 이상 선택해 주세요.' : null,
            base: !address.data ? '방문할 건물 주소를 선택해 주세요.' : null,
            detail: address.data ? detailError(address.data.kind, detail) : null,
            name: nameError(contactName),
            phone: phoneError(contactPhone),
          };
          // 등록 작업이 없는 업체는 고를 작업이 없으므로 제출하지 않는다(목록을 임의로 만들지 않음)
          const valid = !Object.values(err).some(Boolean) && !groupMissing && !wishBlock && !noServices && !noTimes;
          // 화면 순서대로의 오류 대상(작업 선택 → 건물 주소 → 상세 주소 → 이름 → 연락처 → 가능 시간). 안내 문구는 오류가 아니다
          errOrder.current = [
            ...(err.tasks ? ['tasks'] : []),
            ...(err.base ? ['base'] : []), ...(err.detail ? ['detail'] : []), ...(err.name ? ['name'] : []), ...(err.phone ? ['phone'] : []),
            ...(err.slots ? ['slots'] : []),
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
                providerId: p.id, groupId: joint ? groupId : null, newDateWish: joint ? undefined : wishDate!,
                slots: timeOptions.filter((t) => slots.includes(t)), // 지금 선택 가능한 시각만, 시각 순서
                // 지금 고른 작업만(해제한 작업의 작성 내용은 넣지 않음). 작업명은 저장소가 등록 작업에서 요청 당시 이름으로 채운다
                tasks: chosen.map((s) => ({ serviceId: s.id, description: (drafts[s.id]?.description ?? '').trim(), photoNames: drafts[s.id]?.photoNames ?? [] })),
                addressId: address.data!.id, addressDetail: detail.trim(), saveAddressForNext: saveForNext,
                contact: { name: contactName.trim(), phone: phoneDigits(contactPhone) },
                bundleId: bundleId ?? undefined, idempotencyKey: attempt.get(),
              });
              setBundleId(null);
              // 제출에 성공한 뒤에만 요청 완료 화면으로 간다(실패하면 이 화면에 입력을 그대로 둔다).
              // 요청서 기록을 완료 화면으로 바꿔(replace) 뒤로가기로 작성 화면에 돌아와 같은 요청을 다시 보내지 않게 한다.
              // 주소 저장 완료는 제출에 성공했을 때만 알린다.
              nav(`/requests/${r.id}/sent`, { replace: true, state: saveForNext ? { addressSaved: true } : null });
            });
          };

          return (
            <form ref={formRef} className="stack stack--lg" noValidate onSubmit={(e) => { e.preventDefault(); submit(); }}>
              {/* 제출 실패를 한 번만 알린다(각 오류 문구는 낭독하지 않고 입력과 연결 — 포커스가 옮겨지면 읽힌다) */}
              <p className="sr-only" role="status">{touched && errCount > 0 && errOrder.current.length > 0 ? `요청을 보내지 못했어요. 고칠 항목 ${errOrder.current.length}개 중 첫 항목으로 이동했어요.` : ''}</p>
              <div className="card">
                <KV rows={[
                  { k: '업체', v: p.name },
                  { k: '요청 방식', v: joint ? '공동 예약 날짜 참여' : '새 요청' },
                  ...(!joint && wishDate && !wishBlock ? [{ k: '희망 날짜', v: formatDate(wishDate) }] : []),
                  ...(group ? [
                    { k: '방문 날짜', v: formatDate(group.date) },
                    { k: '접수 마감', v: <span className="nowrap">{formatDateTime(group.closeAt)}</span> },
                    { k: '내 예상 출장비', v: <span className="money">약 {formatWon(expectedFeeForJoiner(group.totalTripFee, group.confirmedHouseholds))}</span> },
                  ] : []),
                ]} />
                {!joint && !wishBlock && (
                  <p className="xs muted">희망 날짜예요. 업체가 방문 가능 여부를 확인하고, 승인할 때 방문 날짜·시각과 접수 마감을 정해요. 요청만으로 예약이 확정되지 않아요.</p>
                )}
              </div>
              {wishBlock && (
                <div className="stack--sm stack">
                  <Banner tone="warn" title="희망 날짜를 다시 골라 주세요">
                    {wishBlock === 'missing' ? '업체 상세의 ‘방문 날짜 선택’에서 새 요청 날짜를 골라 주세요.' : `${NEW_REQUEST_BLOCK_TEXT[wishBlock]} 업체 상세에서 다른 날짜를 골라 주세요.`}
                  </Banner>
                  <Button variant="secondary" block onClick={onBack}><Icon name="calendar" size={18} />방문 날짜 다시 고르기</Button>
                </div>
              )}
              {groupMissing && (
                <Banner tone="warn" title="이 공동 예약에는 지금 참여할 수 없어요">접수가 끝났거나 현재 주소로 참여할 수 없는 일정이에요. 업체 상세에서 다른 날짜를 고르거나 새 날짜로 요청해 주세요.</Banner>
              )}
              {bundleId && <Banner tone="info" title="같은 작업을 다른 업체에도 요청하고 있어요">앞서 보낸 요청과 한 묶음으로 비교할 수 있어요. 한 업체를 예약하면 나머지 요청은 종료돼요.</Banner>}

              <Section title="작업 내용">
                {/* 업체 등록 작업 다중 선택(체크박스 칩). 방문 주소와 같은 흰 카드 안에 안내·칩을 두고(바깥 제목은 ‘작업 내용’ 하나 — 묶음 이름은 화면 낭독용으로만),
                    고른 작업마다 이 카드 아래에 설명·사진 카드가 업체 작업 목록 순서로 나타난다(카드 안에 카드를 겹치지 않음) */}
                <fieldset className="card svc-pick task-pick" data-err-region aria-describedby="req-svc-hint">
                  <legend className="sr-only">어떤 작업이 필요한가요?</legend>
                  {noServices ? (
                    <Banner tone="warn" title="이 업체에 등록된 작업이 없어요">지금은 이 업체에 요청을 보낼 수 없어요. 업체 찾기에서 다른 업체를 골라 주세요.</Banner>
                  ) : (
                    <>
                      <p className="small muted" id="req-svc-hint">업체가 제공하는 작업 중 여러 개 선택할 수 있어요.</p>
                      <div className="svc-chips">
                        {services.map((s, si) => {
                          const on = picked.includes(s.id);
                          return (
                            <label key={s.id} className="svc-chip" title={s.name}>
                              <input type="checkbox" className="svc-chip__input" checked={on} onChange={() => togglePick(s.id)}
                                data-err-target={si === 0 ? 'tasks' : undefined} aria-invalid={si === 0 && touched && !!err.tasks ? true : undefined}
                                aria-describedby={si === 0 && touched && err.tasks ? 'req-tasks-err' : undefined} />
                              <span className="svc-chip__pill">{on && <Icon name="check" size={12} />}<span className="svc-chip__text">{s.name}</span></span>
                            </label>
                          );
                        })}
                      </div>
                      {touched && err.tasks && <p className="field__error" id="req-tasks-err">{err.tasks}</p>}
                      {bundleUnmatched.length > 0 && (
                        <p className="xs muted">앞서 요청한 작업 중 {bundleUnmatched.join(', ')}은(는) 이 업체 작업 목록에 없어 선택하지 않았어요. 필요한 작업을 골라 주세요.</p>
                      )}
                    </>
                  )}
                </fieldset>
                {chosen.map((s) => {
                  const d = drafts[s.id] ?? EMPTY_DRAFT;
                  return (
                    <div key={s.id} className="card stack" data-task={s.id}>
                      <h3>{s.name}</h3>
                      <Field label="자세한 설명" hint="증상, 크기, 모델명을 알려주시면 정확한 승인에 도움이 돼요. 같은 작업이 여러 곳에 필요하면 위치와 증상을 함께 적어 주세요(예: 주방·욕실 수전 각각).">
                        {(fp) => <textarea {...fp} className="textarea" value={d.description} maxLength={500} onChange={(e) => setDraft(s.id, { description: e.target.value })} />}
                      </Field>
                      <Field label="사진 (선택)" hint="모의 화면이라 파일은 올라가지 않고 파일 이름만 기록돼요. 얼굴·연락처가 보이지 않게 찍어 주세요.">
                        {(fp) => (
                          <input {...fp} type="file" accept="image/*" multiple className="input"
                            onChange={(e) => setDraft(s.id, { photoNames: Array.from(e.target.files ?? []).slice(0, 5).map((f) => f.name) })} />
                        )}
                      </Field>
                      {d.photoNames.length > 0 && <div className="chips">{d.photoNames.map((n) => <span key={n} className="photo-chip"><Icon name="camera" size={14} />{n}</span>)}</div>}
                    </div>
                  );
                })}
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

              {/* 방문 가능한 시간: 제목은 카드 바깥, 안내·시각 칩·오류는 연락받을 정보·방문 주소와 같은 흰 카드 안. 날짜는 업체 상세에서 고른다 */}
              <Section title="방문 가능한 시간">
                <div className="card stack">
                  <fieldset className="svc-pick time-pick" data-err-region aria-describedby="req-time-hint">
                    <legend className="sr-only">방문 가능한 시각 (여러 개 선택 가능)</legend>
                    <p className="small muted time-pick__hint" id="req-time-hint">방문 가능한 시간을 여러 개 선택하면, 업체가 그중 방문 시간을 제안해요.</p>
                    {timeOptions.length === 0 ? (
                      <Banner tone="warn" title="지금 선택할 수 있는 방문 시각이 없어요">다른 날짜나 일정을 골라 주세요.</Banner>
                    ) : (
                      <div className="svc-chips">
                        {timeOptions.map((t, ti) => {
                          const on = slots.includes(t);
                          return (
                            <label key={t} className="svc-chip">
                              <input type="checkbox" className="svc-chip__input" checked={on} onChange={() => setSlots(on ? slots.filter((x) => x !== t) : [...slots, t])}
                                data-err-target={ti === 0 ? 'slots' : undefined} aria-invalid={ti === 0 && touched && !!err.slots ? true : undefined}
                                aria-describedby={ti === 0 && touched && err.slots ? 'req-slots-err' : undefined} />
                              <span className="svc-chip__pill">{on && <Icon name="check" size={12} />}<span className="svc-chip__text">{t}</span></span>
                            </label>
                          );
                        })}
                      </div>
                    )}
                    {touched && err.slots && <p className="field__error" id="req-slots-err">{err.slots}</p>}
                    {droppedTimes.length > 0 && <p className="xs muted" role="status">선택할 수 없게 된 시각({droppedTimes.join(', ')})은 선택을 해제했어요. 다시 골라 주세요.</p>}
                  </fieldset>
                </div>
              </Section>

              {action.error && (
                <div className="stack--sm stack">
                  <Banner tone="danger" title={action.error.title}>{action.error.hint} 입력한 내용은 그대로 있어요.</Banner>
                  <Button variant="secondary" block busy={action.busy} onClick={submit}>다시 보내기</Button>
                </div>
              )}
              {/* 하단 고정 없이 마지막 입력 영역 다음(폼 간격 24px)에 둔다. 아래 여백은 본문 아래 여백(32px) */}
              <Button variant="primary" block type="submit" busy={action.busy} disabled={groupMissing || !!wishBlock || noServices || noTimes}>요청 보내기</Button>
            </form>
          );
        }}
      </AsyncView>
      )}
    </Page>
  );
}
