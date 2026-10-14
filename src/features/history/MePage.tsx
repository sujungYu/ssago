import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Page } from '../../app/Page';
import { useRepo } from '../../app/context';
import { focusFirstError } from '../../app/focusFirstError';
import { useAction, useAsync } from '../../app/hooks';
import { Icon } from '../../components/Icon';
import { AsyncView, Banner, Button, Dialog, Field, Section } from '../../components/ui';
import { NAME_MAX, formatPhone, nameError, phoneError } from '../../domain/profile';
import type { CustomerProfile } from '../../domain/types';

/**
 * C-24 내 정보. 로그인 없는 데모라 계정 이메일·로그인·로그아웃이 없고, 가상 데모 고객 프로필만 보여준다.
 * 주소 메뉴는 두지 않는다: 지역·건물 설정은 업체 찾기 상단, 상세 주소 입력·저장은 수리 신청서에서 한다.
 * 이름·연락처는 ‘수정’으로 바꿀 수 있다(인증 아님). 바꾼 값은 이후 새 수리 요청서의 기본값이 되고, 이미 제출된 요청·예약은 그대로다.
 */
export function MePage() {
  const repo = useRepo();
  const q = useAsync(() => repo.getProfile(), [repo]);
  const [editing, setEditing] = useState(false);
  const [done, setDone] = useState(false);
  // 저장 직후에는 저장 결과를 바로 보여 준다(조용한 재조회를 기다리지 않음). 재조회 결과가 오면 그 값을 쓴다.
  const [justSaved, setJustSaved] = useState<{ p: CustomerProfile; of: CustomerProfile | undefined } | null>(null);
  const shown = justSaved && justSaved.of === q.data ? justSaved.p : undefined;
  return (
    <Page title="내 정보" tabs>
      <h2 style={{ fontSize: 'var(--fs-xl)' }}>내 정보</h2>
      {done && <Banner tone="success" title="정보를 수정했어요." />}
      <AsyncView state={q}>
        {(loaded) => { const p = shown ?? loaded; return (
          <>
            <div className="card row">
              <span className="avatar" aria-hidden><Icon name="user" /></span>
              <div className="grow"><p className="strong">{p.name}</p><p className="small muted">{p.phoneMasked}</p></div>
              <Button variant="secondary" sm aria-haspopup="dialog" aria-label="내 정보 수정" onClick={() => { setDone(false); setEditing(true); }}>수정</Button>
            </div>
            {editing && <ProfileEditDialog profile={p} onClose={() => setEditing(false)} onSaved={(next) => { setJustSaved({ p: next, of: q.data }); setEditing(false); setDone(true); }} />}
          </>
        ); }}
      </AsyncView>
      <Section title="내역·안내">
        <ul className="card card--flush divided">
          <li><Link className="list-row" to="/ledger"><Icon name="wallet" /><span className="list-row__main"><span className="list-row__title">결제·환불 내역</span></span><Icon name="chevron" size={18} /></Link></li>
          <li><Link className="list-row" to="/guide"><Icon name="info" /><span className="list-row__main"><span className="list-row__title">서비스 이용 안내</span></span><Icon name="chevron" size={18} /></Link></li>
        </ul>
      </Section>
      <Banner tone="info" title="로그인 없는 데모예요">
        하나의 가상 데모 고객으로 체험해요. 요청·예약·결제 내역과 내 정보(이름·연락처)는 가상 데이터로 이 브라우저 탭에만 저장돼요. 새로고침해도 유지되고, 탭을 닫으면 처음 상태로 돌아가요. 결제·환불·알림은 모두 모의예요.
      </Banner>
    </Page>
  );
}

/**
 * 내 정보 수정(이름·연락처). 입력값은 이 대화상자 안에서만 들고 있다가 ‘저장하기’에 성공했을 때만 반영한다.
 * 취소·닫기·Escape·바깥 누르기는 변경을 버린다. 저장 중에는 닫히지 않고 다시 누를 수 없다.
 */
function ProfileEditDialog({ profile, onClose, onSaved }: { profile: CustomerProfile; onClose: () => void; onSaved: (p: CustomerProfile) => void }) {
  const repo = useRepo();
  const action = useAction();
  const [name, setName] = useState(profile.name);
  const [phone, setPhone] = useState(formatPhone(profile.phone));
  const [touched, setTouched] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const [focusTick, setFocusTick] = useState(0);
  const err = { name: nameError(name), phone: phoneError(phone) };
  const order = [...(err.name ? ['name'] : []), ...(err.phone ? ['phone'] : [])];
  useEffect(() => {
    if (focusTick && formRef.current) focusFirstError(formRef.current, order);
  }, [focusTick]); // eslint-disable-line react-hooks/exhaustive-deps

  const close = () => { if (!action.busy) onClose(); };
  const save = () => {
    setTouched(true);
    if (order.length) { setFocusTick((n) => n + 1); return; }
    void action.run(async () => {
      onSaved(await repo.updateProfile({ name, phone }));
    });
  };

  return (
    <Dialog title="내 정보 수정" onClose={close} closeLabel="닫기" actions={
      <div className="dialog-actions-row">
        <Button block onClick={close} disabled={action.busy}>취소</Button>
        <Button variant="primary" block type="submit" form="profile-edit-form" busy={action.busy}>저장하기</Button>
      </div>
    }>
      <form id="profile-edit-form" ref={formRef} className="stack" noValidate onSubmit={(e) => { e.preventDefault(); save(); }}>
        <p className="small muted">연락처 인증이 아니에요. 데모라 실제 이름·전화번호 대신 가상 정보를 입력해도 돼요.</p>
        <Field label="이름" error={touched ? err.name : null} liveError={false}>
          {(fp) => <input {...fp} data-err-target="name" className="input" value={name} maxLength={NAME_MAX + 10} autoComplete="off" onChange={(e) => setName(e.target.value)} />}
        </Field>
        <Field label="연락처" error={touched ? err.phone : null} liveError={false}>
          {(fp) => <input {...fp} data-err-target="phone" className="input" type="tel" inputMode="tel" value={phone} maxLength={20} autoComplete="off" placeholder="010-0000-0000" onChange={(e) => setPhone(e.target.value)} />}
        </Field>
        <p className="xs muted">바꾼 정보는 새로 작성하는 수리 요청서에 기본으로 채워져요. 이미 보낸 요청과 확정된 예약의 연락처는 바뀌지 않아요.</p>
        {touched && order.length > 0 && <p className="sr-only" role="status">{`저장하지 못했어요. 고칠 항목 ${order.length}개 중 첫 항목으로 이동했어요.`}</p>}
        {action.error && (
          <Banner tone="danger" title={action.error.code === 'invalid' ? '입력한 내용을 확인해 주세요.' : '정보를 저장하지 못했어요.'}>
            입력한 내용은 그대로 있어요. 잠시 후 다시 저장해 주세요.
          </Banner>
        )}
      </form>
    </Dialog>
  );
}
