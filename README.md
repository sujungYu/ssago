# 온김에 — 사용자 화면 (1차: 목업 데이터)

가까운 이웃과 같은 업체·같은 날 방문을 예약하고 출장비를 확정 세대 수로 나누는 생활 수리 공동 예약 서비스의 **고객용 웹 화면**입니다.
**로그인·회원가입은 Supabase Auth에 실제로 연결**하고, 예약·업체·작업·결제·환불·알림·주소 검색 데이터는 **목업(모의)**입니다. 업체·운영자 화면은 범위 밖입니다.
앱은 로그인 후에만 이용할 수 있습니다(비로그인 → 로그인 화면). Supabase 환경 값이 없으면 빌드·실행은 되지만 “로그인 서버 연결이 설정되지 않았어요”를 안내하고 로그인할 수 없습니다.

## 실행

```bash
npm install
cp .env.example .env.local   # Supabase URL·publishable 키 입력 (아래 “Supabase Auth 설정”)
npm run dev          # 개발 서버 (우측 상단 DEV 버튼 = 시나리오 도구)
npm run build        # 운영 빌드 — 개발 도구 미포함
npm run build:demo   # 데모 빌드 — 개발 도구 포함 (.env.demo)
npm run preview      # 빌드 결과 확인
npm test             # 단위·저장소 규칙 테스트 (Vitest)
npm run e2e          # 데모 빌드 후 실제 브라우저(Chromium) 흐름·반응형 점검 → docs/e2e-report.md
```

e2e는 playwright-core를 쓰며 브라우저는 내려받지 않습니다(`/opt/pw-browsers/chromium` 또는 `CHROME_PATH`).
Windows(PowerShell) 예: `$env:CHROME_PATH="C:\Program Files\Google\Chrome\Application\chrome.exe"; npm run e2e`
e2e의 인증 흐름은 **실제 Supabase 프로젝트가 아니라 브라우저 요청을 가로채는 가짜 Supabase Auth 서버**로 확인합니다(`e2e/run.mjs`의 `FakeSupabase`). 실제 프로젝트 설정·메일 발송은 e2e로 확인되지 않습니다.
`E2E_ONLY=결제 npm run e2e`처럼 이름으로 일부만, `E2E_SKIP_BUILD=1`로 빌드 생략, `E2E_SHOTS=0`으로 스크린샷 생략.

## 구조

| 위치 | 역할 |
|---|---|
| `src/domain/` | 순수 규칙: 출장비 분담·취소·정산·날짜 변경 금액(`pricing.ts`), 기한·결제 가능 판단(`rules.ts`), 시간(Asia/Seoul)·금액(정수 원) |
| `src/data/repositories/types.ts` | **데이터 접근 계약**(`Repository`). 화면은 이것만 안다 |
| `src/data/mock/` | 계약의 목업 구현(시드, 상태 변경 엔진, 멱등성). 2차에서 Supabase 구현체로 교체 |
| `src/app/` | 라우터(로그인 필요 구간 `RequireAuth`), 저장소·인증 주입(`context.tsx`, `auth.tsx`), 조회·쓰기 훅 |
| `src/data/repositories/auth.ts` | **인증 계약**(`AuthRepository`) |
| `src/data/auth/` | Supabase 클라이언트(`supabaseClient.ts`)와 Supabase Auth 구현(`supabaseAuthRepository.ts`) |
| `src/components/`, `src/styles/` | 디자인 토큰과 공통 컴포넌트 |
| `src/features/*` | 화면(IA의 C-01~C-25, S-01~S-05). 로그인·회원가입·비밀번호 재설정은 `features/auth/AuthPages.tsx` |
| `src/dev/` | 시나리오 도구 — `import.meta.env.DEV` 또는 `VITE_ENABLE_DEV_TOOLS=true`일 때만 lazy 로드 |

요청·예약·작업·결제·환불·변경 제안 상태는 서로 다른 필드로 분리되어 있습니다(`src/domain/types.ts`).

## 개발용 시나리오 도구

우측 상단 **DEV** 버튼. 시나리오 초기화(전체/간소/빈 상태), 결제 결과(성공/실패/처리 중/확인 중)·조회 실패·주소 판단 장애 설정,
업체 승인·추가 정보 요청·거절·승인 만료·조건 변경, 그룹 마감·종료, 지연·업체 변경 제안·자재 조건·추가 작업·작업 완료(잔금/0원/환불),
환불 상태 변경, 시계 이동, 모의 알림 진입, 상태별 바로가기를 실제 시간을 기다리지 않고 재현합니다. 운영 빌드에는 들어가지 않습니다.

## ⚠️ 임시 데모 로그인 (Supabase 연결 전)
Supabase 값(`VITE_SUPABASE_URL`·키)이 **없으면** 앱은 임시 데모 로그인으로 동작합니다(`src/data/auth/demoAuthRepository.ts`).
- 로그인 화면에서 **처음 입력한 이메일은 데모 계정이 바로 만들어져 로그인**됩니다(6자 이상 비밀번호). 같은 이메일을 다시 쓰면 그 비밀번호를 확인합니다. 회원가입 화면으로 가입해도 됩니다.
- 계정·로그인 상태는 **이 브라우저의 localStorage에만** 저장됩니다(비밀번호는 솔트+SHA-256 해시만). 다른 기기·브라우저와 공유되지 않고 실제 계정이 아닙니다. 화면에 “데모 로그인 · 실제 계정이 아니에요”가 표시됩니다.
- 메일을 보낼 수 없어 비밀번호 재설정은 끝까지 진행되지 않습니다.
- Supabase 값을 넣으면 자동으로 Supabase Auth로 바뀝니다. **연결 후 데모 분기(`src/app/context.tsx`)와 `demoAuthRepository.ts`를 삭제**합니다. 출시 빌드에 데모 로그인이 남으면 안 됩니다.

## Supabase Auth 설정

이 저장소에는 실제 Supabase 프로젝트 값이 없습니다. 아래 설정은 **대시보드에서 직접 확인·적용해야 하며, 이 저장소의 코드만으로 적용되지 않습니다.**

1. **프로젝트 값** — 대시보드 → Project Settings → API Keys(또는 Data API)에서
   - Project URL → `VITE_SUPABASE_URL`
   - **publishable 키**(`sb_publishable_...`) → `VITE_SUPABASE_PUBLISHABLE_KEY` (기존 프로젝트는 anon 키를 `VITE_SUPABASE_ANON_KEY`에 넣어도 됨)
   - `.env.local`에 넣고 개발 서버를 다시 시작합니다. **service_role / secret 키는 절대 넣지 마세요**(VITE_ 변수는 브라우저 번들에 그대로 들어갑니다).
2. **이메일·비밀번호 로그인 켜기** — Authentication → Sign In / Providers → Email 사용. 소셜 로그인은 이번 범위가 아닙니다.
3. **데모용: 이메일 확인 끄기** — 같은 Email 설정의 **Confirm email**을 끄면 가입 직후 로그인할 수 있습니다.
   - 켜져 있으면 앱은 “확인 메일을 보냈어요”를 안내하고, 확인 전 로그인에는 “이메일 확인이 필요해요”를 보여 줍니다.
   - ⚠️ **데모 전용 설정입니다. 실제 출시 전 이메일 확인 정책을 다시 검토해야 합니다**(`docs/decisions.md`).
4. **비밀번호 기준** — 같은 화면의 Minimum password length(기본 6)·Password requirements와 `VITE_AUTH_PASSWORD_MIN_LENGTH`를 같은 값으로 맞춥니다. 화면은 이 값으로 미리 안내하고, 최종 판정은 Supabase가 합니다(조합 규칙 위반 등은 “사용할 수 없는 비밀번호예요”로 안내).
5. **리디렉트 URL** — Authentication → URL Configuration
   - Site URL: 배포 주소(로컬은 `http://localhost:5173`)
   - Redirect URLs: `http://localhost:5173/login`, `http://localhost:5173/password/new` (배포 주소도 같은 경로로 추가). 가입 확인·비밀번호 재설정 메일의 링크가 이 주소로 돌아옵니다.
6. **메일 발송** — 기본 메일 발송은 시간당 횟수 제한이 있습니다. 재설정·확인 메일을 많이 쓰면 SMTP 설정이 필요합니다.

설정 후 확인할 것: 가입 → “회원가입이 완료됐어요” → 로그인 → 업체 찾기. 대시보드 Authentication → Users에 계정이 생겼는지 확인합니다.

### 인증 동작 요약
- 비밀번호 보관·검증·세션 관리는 Supabase Auth가 합니다. 앱은 비밀번호를 별도 테이블·브라우저 저장소·로그에 남기지 않습니다.
- 세션은 Supabase SDK 기본값대로 브라우저 localStorage에 저장되어 **새로고침해도 유지**되고, SDK가 자동 갱신합니다. 앱 시작 시 세션 확인이 끝날 때까지 로딩 화면만 보여 줍니다.
- 저장된 세션이 서버에서 무효면 지우고 로그인 화면으로 보냅니다. 시작할 때 네트워크만 끊긴 경우에는 저장된 세션으로 진입합니다.
- 회원가입 후 세션이 생겨도 바로 로그아웃하고 로그인 화면으로 안내합니다.
- 로그아웃하거나 다른 계정으로 로그인하면 목업 상태(요청·예약·거래)·방문 지역·화면 캐시를 초기화합니다. 각 계정은 같은 **가상 데모 데이터**에서 시작합니다.
- ⚠️ 화면의 로그인 보호(`RequireAuth`)는 이동 제어일 뿐 **데이터 보안이 아닙니다.** 지금 보호 대상은 목업이지만, 실제 데이터를 연결하면 서버와 RLS가 매 요청 권한을 검증해야 합니다.

## 문서

- `spec.md` — 요청 명세 원문 · `docs/reference/` — Notion 기획 문서 6종 사본
- `docs/screen-map.md` 화면 ID 매핑 · `docs/decisions.md` 결정·충돌·미정 · `docs/design-differences.md` 디자인 확인 범위와 차이
- `docs/supabase-handoff.md` 2차 데이터 계약·작업 목록 · `docs/verification-log.md` 검증 기록 · `docs/e2e-report.md` e2e 결과

## 주의

- 결제·환불 화면에는 항상 “모의” 표시가 있습니다. 실제 결제 정보는 입력받지 않습니다.
- 저장소에는 비밀 값·실제 개인정보가 없습니다. 이름·주소·전화번호는 모두 가상입니다.
