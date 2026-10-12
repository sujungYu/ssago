import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Page } from '../../app/Page';
import { useAuth } from '../../app/auth';
import { useAction } from '../../app/hooks';
import { emailError, newPasswordErrors, validateSignIn, validateSignUp } from '../../domain/auth';
import { RepoError, describeError } from '../../domain/errors';
import { Icon } from '../../components/Icon';
import { Banner, Button, Field, LinkButton, PasswordInput } from '../../components/ui';

/*
 * S-04 로그인·회원가입·비밀번호 재설정. 인증은 Supabase Auth(이메일·비밀번호)로 실제 처리한다.
 * 이 화면들은 하단 탭·상단 메뉴를 숨긴다. 비밀번호는 상태에만 두고 저장·로그하지 않는다.
 */

type NavState = { email?: string; flash?: string; needsConfirm?: boolean } | null;

/** 제출 후 첫 번째 오류 입력란으로 포커스를 옮긴다 */
function focusFirstInvalid(form: HTMLFormElement | null) {
  requestAnimationFrame(() => form?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
}

function AuthLayout({ title, back, children }: { title: string; back?: string; children: ReactNode }) {
  return (
    <Page title={title} back={back} focus>
      <div className="auth stack stack--lg">{children}</div>
    </Page>
  );
}

function Heading({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="stack stack--sm">
      <h2 style={{ fontSize: 'var(--fs-xl)' }}>{title}</h2>
      {children && <p className="muted small">{children}</p>}
    </div>
  );
}

function ResultHead({ icon, tone, title, children }: { icon: string; tone?: 'success' | 'warn'; title: string; children?: ReactNode }) {
  return (
    <div className="stack stack--sm">
      <span className={`auth__icon${tone ? ` auth__icon--${tone}` : ''}`} aria-hidden><Icon name={icon} size={28} /></span>
      <h2 style={{ fontSize: 'var(--fs-xl)' }}>{title}</h2>
      {children && <p className="muted">{children}</p>}
    </div>
  );
}

/** 연결 미설정 안내. 모의 성공으로 대신하지 않는다. */
function NotConfigured() {
  const d = describeError(new RepoError('auth_not_configured'));
  return <Banner tone="danger" title={d.title}>{d.hint}</Banner>;
}

/**
 * ⚠️ 임시: Supabase 연결 전 데모 로그인 표시(kind === 'demo'). 실제 계정으로 오인하지 않게 인증 화면마다 보여 준다.
 * Supabase 연결 후에는 표시되지 않는다.
 */
function DemoNotice({ children }: { children?: ReactNode }) {
  return (
    <Banner tone="warn" title="데모 로그인 · 실제 계정이 아니에요">
      {children ?? 'Supabase 연결 전 임시 로그인이에요. 가입한 계정은 이 브라우저에만 저장되고 다른 기기에서는 로그인할 수 없어요. 실제로 쓰는 비밀번호는 입력하지 마세요.'}
    </Banner>
  );
}

function AuthModeNotice({ demoText }: { demoText?: string }) {
  const { auth } = useAuth();
  if (!auth.configured) return <NotConfigured />;
  if (auth.kind === 'demo') return <DemoNotice>{demoText}</DemoNotice>;
  return null;
}

/** 제출 오류. 네트워크 오류는 다시 시도 버튼을 함께 준다. */
function SubmitError({ error, onRetry }: { error: ReturnType<typeof describeError> | null; onRetry: () => void }) {
  if (!error) return null;
  return (
    <div className="stack stack--sm">
      <Banner tone="danger" title={error.title}>{error.hint}</Banner>
      {(error.code === 'auth_network' || error.code === 'auth_failed') && (
        <Button variant="secondary" block onClick={onRetry}><Icon name="refresh" size={18} />다시 시도</Button>
      )}
    </div>
  );
}

const emailInput = (fp: { id: string }, value: string, onChange: (v: string) => void, disabled?: boolean) => (
  <input {...fp} className="input" type="email" name="email" autoComplete="email" inputMode="email" autoCapitalize="none" spellCheck={false}
    value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
);

// ───────── 로그인 ─────────
export function LoginPage() {
  const { auth, state } = useAuth();
  const nav = useNavigate();
  const st = useLocation().state as NavState;
  const action = useAction();
  const formRef = useRef<HTMLFormElement>(null);
  const [email, setEmail] = useState(st?.email ?? '');
  const [password, setPassword] = useState('');
  const [touched, setTouched] = useState(false);

  if (state.status === 'signedIn') return <Navigate to="/" replace />;

  const errs = validateSignIn({ email, password });
  const send = () => void action.run(async () => {
    await auth.signIn({ email, password });
    nav('/', { replace: true });
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (Object.keys(errs).length) { focusFirstInvalid(formRef.current); return; }
    send();
  };

  return (
    <AuthLayout title="로그인">
      <div className="stack stack--sm">
        <p className="auth__logo" aria-hidden>온김에</p>
        <p className="muted small">이웃과 같은 날 부르고, 출장비는 함께 나눠요</p>
      </div>
      <AuthModeNotice demoText="Supabase 연결 전 임시 로그인이에요. 처음 입력한 이메일은 데모 계정이 바로 만들어져 로그인되고, 이 브라우저에만 저장돼요. 실제로 쓰는 비밀번호는 입력하지 마세요." />
      <form ref={formRef} className="stack" noValidate onSubmit={submit} aria-label="로그인">
        <Field label="이메일" error={touched ? errs.email : null}>{(fp) => emailInput(fp, email, setEmail)}</Field>
        <Field label="비밀번호" error={touched ? errs.password : null}>
          {(fp) => <PasswordInput {...fp} name="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />}
        </Field>
        <SubmitError error={action.error} onRetry={send} />
        {/*
          임시(Supabase 연결 전): 이메일·비밀번호 칸에 값이 있으면 버튼을 활성화한다.
          Supabase 값이 없으면 데모 로그인(DemoAuthRepository, 이 브라우저 안에서만 유효)으로 로그인되고, 값이 있으면 Supabase Auth로 로그인한다.
          형식 오류 등 나머지 검증은 제출 시 각 입력란 아래에 표시한다.
          연결 후 다시 정할 것: 이 활성화 기준을 유지할지, 항상 활성화 후 제출 시 검증할지.
        */}
        <Button variant="primary" block type="submit" busy={action.busy} disabled={!email.trim() || !password}>로그인</Button>
      </form>
      <div className="stack stack--sm">
        <div className="auth__links"><Link to="/password/reset">비밀번호를 잊으셨나요?</Link></div>
        <div className="auth__links"><span>아직 회원이 아니신가요?</span><Link to="/signup">회원가입</Link></div>
      </div>
    </AuthLayout>
  );
}

// ───────── 회원가입 ─────────
export function SignUpPage() {
  const { auth, state } = useAuth();
  const nav = useNavigate();
  const action = useAction();
  const formRef = useRef<HTMLFormElement>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [touched, setTouched] = useState(false);
  const min = auth.passwordMinLength;

  if (state.status === 'signedIn' && !action.busy) return <Navigate to="/" replace />;

  const errs = validateSignUp({ email, password, confirm }, min);
  const send = () => void action.run(async () => {
    const r = await auth.signUp({ email, password });
    nav('/signup/done', { replace: true, state: { email: email.trim(), needsConfirm: r.needsEmailConfirmation } });
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (Object.keys(errs).length) { focusFirstInvalid(formRef.current); return; }
    send();
  };

  return (
    <AuthLayout title="회원가입" back="/login">
      <Heading title="이메일로 가입하기">주소는 수리를 요청할 때 입력해요.</Heading>
      <AuthModeNotice />
      <form ref={formRef} className="stack" noValidate onSubmit={submit} aria-label="회원가입">
        <Field label="이메일" error={touched ? errs.email : null}>{(fp) => emailInput(fp, email, setEmail)}</Field>
        <Field label="비밀번호" hint={`${min}자 이상 입력해 주세요.`} error={touched ? errs.password : null}>
          {(fp) => <PasswordInput {...fp} name="new-password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />}
        </Field>
        <Field label="비밀번호 확인" error={touched ? errs.confirm : null}>
          {(fp) => <PasswordInput {...fp} name="confirm-password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />}
        </Field>
        <SubmitError error={action.error} onRetry={send} />
        <Button variant="primary" block type="submit" busy={action.busy} disabled={!auth.configured}>가입하기</Button>
      </form>
      <div className="auth__links"><span>이미 가입하셨나요?</span><Link to="/login">로그인</Link></div>
    </AuthLayout>
  );
}

export function SignUpDonePage() {
  const st = useLocation().state as NavState;
  if (!st?.email) return <Navigate to="/login" replace />;
  return (
    <AuthLayout title="회원가입">
      {st.needsConfirm ? (
        <ResultHead icon="mail" title="확인 메일을 보냈어요">
          <span className="strong">{st.email}</span>(으)로 보낸 메일의 링크를 눌러 이메일을 확인한 뒤 로그인해 주세요. 메일이 보이지 않으면 스팸함도 확인해 주세요.
        </ResultHead>
      ) : (
        <ResultHead icon="check" tone="success" title="회원가입이 완료됐어요">
          <span className="strong">{st.email}</span>(으)로 로그인해 주세요.
        </ResultHead>
      )}
      <AuthModeNotice demoText="데모 계정이라 이 브라우저에서만 로그인할 수 있어요." />
      <LinkButton to="/login" state={{ email: st.email }} variant="primary" block replace>로그인하러 가기</LinkButton>
    </AuthLayout>
  );
}

// ───────── 비밀번호 재설정 ─────────
export function ResetRequestPage() {
  const { auth } = useAuth();
  const nav = useNavigate();
  const action = useAction();
  const formRef = useRef<HTMLFormElement>(null);
  const [email, setEmail] = useState('');
  const [touched, setTouched] = useState(false);
  const err = emailError(email);
  const send = () => void action.run(async () => {
    await auth.requestPasswordReset(email);
    nav('/password/reset/sent', { state: { email: email.trim() } });
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (err) { focusFirstInvalid(formRef.current); return; }
    send();
  };
  return (
    <AuthLayout title="비밀번호 재설정" back="/login">
      <Heading title="가입한 이메일을 입력해 주세요">비밀번호를 다시 설정할 수 있는 링크를 메일로 보내 드려요.</Heading>
      <AuthModeNotice demoText="데모 로그인에서는 재설정 메일을 보낼 수 없어요. 비밀번호를 잊었다면 새 이메일로 다시 가입해 주세요." />
      <form ref={formRef} className="stack" noValidate onSubmit={submit} aria-label="비밀번호 재설정 요청">
        <Field label="이메일" error={touched ? err : null}>{(fp) => emailInput(fp, email, setEmail)}</Field>
        <SubmitError error={action.error} onRetry={send} />
        <Button variant="primary" block type="submit" busy={action.busy} disabled={!auth.configured}>재설정 링크 받기</Button>
      </form>
    </AuthLayout>
  );
}

export function ResetSentPage() {
  const st = useLocation().state as NavState;
  return (
    <AuthLayout title="비밀번호 재설정" back="/login">
      {/* 계정 유무와 관계없이 같은 안내 */}
      <ResultHead icon="mail" title="메일함을 확인해 주세요">
        {st?.email && <><span className="strong">{st.email}</span>(으)로 </>}가입된 계정이 있다면 비밀번호 재설정 링크를 보냈어요. 메일이 보이지 않으면 스팸함도 확인해 주세요.
      </ResultHead>
      <AuthModeNotice demoText="데모 로그인에서는 실제로 메일이 발송되지 않아요." />
      <div className="stack stack--sm">
        <LinkButton to="/login" variant="primary" block>로그인으로 돌아가기</LinkButton>
        <LinkButton to="/password/reset" variant="secondary" block>다시 요청하기</LinkButton>
      </div>
    </AuthLayout>
  );
}

/** 재설정 메일의 링크로 들어온 복구 세션에서만 새 비밀번호를 저장한다. */
export function NewPasswordPage() {
  const { auth, state } = useAuth();
  const nav = useNavigate();
  const action = useAction();
  const formRef = useRef<HTMLFormElement>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [touched, setTouched] = useState(false);
  const min = auth.passwordMinLength;

  if (!(state.status === 'signedIn' && state.recovery) && !action.busy) {
    return (
      <AuthLayout title="새 비밀번호 설정" back="/login">
        <ResultHead icon="warn" tone="warn" title="재설정 링크가 만료됐거나 올바르지 않아요">
          비밀번호 재설정을 다시 요청해 주세요. 가장 최근에 받은 메일의 링크를 사용해 주세요.
        </ResultHead>
        <div className="stack stack--sm">
          <LinkButton to="/password/reset" variant="primary" block>재설정 다시 요청하기</LinkButton>
          <LinkButton to="/login" variant="secondary" block>로그인으로 돌아가기</LinkButton>
        </div>
      </AuthLayout>
    );
  }

  const errs = newPasswordErrors({ password, confirm }, min);
  const send = () => void action.run(async () => {
    await auth.updatePassword(password);
    // 복구 세션을 닫고 새 비밀번호로 다시 로그인하게 한다.
    await auth.signOut();
    nav('/login', { replace: true, state: { flash: '비밀번호를 바꿨어요. 새 비밀번호로 로그인해 주세요.' } });
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (Object.keys(errs).length) { focusFirstInvalid(formRef.current); return; }
    send();
  };
  return (
    <AuthLayout title="새 비밀번호 설정">
      <Heading title="새 비밀번호를 입력해 주세요">{`${min}자 이상 입력해 주세요.`}</Heading>
      <form ref={formRef} className="stack" noValidate onSubmit={submit} aria-label="새 비밀번호 설정">
        <Field label="새 비밀번호" error={touched ? errs.password : null}>
          {(fp) => <PasswordInput {...fp} name="new-password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />}
        </Field>
        <Field label="새 비밀번호 확인" error={touched ? errs.confirm : null}>
          {(fp) => <PasswordInput {...fp} name="confirm-password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />}
        </Field>
        <SubmitError error={action.error} onRetry={send} />
        <Button variant="primary" block type="submit" busy={action.busy}>비밀번호 변경</Button>
      </form>
    </AuthLayout>
  );
}
