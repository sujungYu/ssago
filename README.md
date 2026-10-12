# 싸고 — 사용자 화면 (1차: 목업 데이터)

**싸고**(싸게 고치고, 이전 서비스명 ‘온김에’)는 가까운 이웃과 같은 업체·같은 날 방문을 예약하고 출장비를 확정 세대 수로 나누는 생활 수리 공동 예약 서비스입니다. 이 저장소는 그 **고객용 웹 화면**입니다. 저장소·폴더명(`on-gimae`)과 DB·인증·배포 식별자는 이전 이름을 그대로 씁니다.
**로그인 없는 데모**입니다(2026-10-12 변경). 앱을 열면 바로 업체 찾기를 이용하고, 내 요청·내 예약·내 정보도 로그인 없이 볼 수 있습니다. 모든 방문자는 하나의 **가상 데모 고객**으로 체험하며, 업체·요청·예약·작업·결제·환불·알림·주소 데이터는 모두 **목업(모의)**입니다. 업체·운영자 화면은 범위 밖입니다.
⚠️ 이 방식은 현재 데모 범위입니다. 인증과 서버 접근 제어가 없으므로 **실제 다중 사용자 서비스의 접근 제어를 대체하지 않습니다.** 실제 데이터를 연결할 때는 인증과 서버·RLS 권한 검증을 함께 도입해야 합니다.

## 실행

```bash
npm install
npm run dev          # 개발 서버 (화면 없는 시나리오 훅 window.__sagoDev 포함)
npm run build        # 운영 빌드 — 개발 도구 미포함
npm run build:demo   # 데모 빌드 — 개발 도구 포함 (.env.demo)
npm run preview      # 빌드 결과 확인
npm test             # 단위·저장소 규칙 테스트 (Vitest)
npm run e2e          # 데모 빌드 후 실제 브라우저(Chromium) 흐름·반응형 점검 → docs/e2e-report.md
```

e2e는 playwright-core를 쓰며 브라우저는 내려받지 않습니다(`/opt/pw-browsers/chromium` 또는 `CHROME_PATH`).
Windows(PowerShell) 예: `$env:CHROME_PATH="C:\Program Files\Google\Chrome\Application\chrome.exe"; npm run e2e`
`E2E_ONLY=결제 npm run e2e`처럼 이름으로 일부만, `E2E_SKIP_BUILD=1`로 빌드 생략, `E2E_SHOTS=0`으로 스크린샷 생략.

## 구조

| 위치 | 역할 |
|---|---|
| `src/domain/` | 순수 규칙: 출장비 분담·취소·정산·날짜 변경 금액(`pricing.ts`), 기한·결제 가능 판단(`rules.ts`), 시간(Asia/Seoul)·금액(정수 원) |
| `src/data/repositories/types.ts` | **데이터 접근 계약**(`Repository`). 화면은 이것만 안다 |
| `src/data/mock/` | 계약의 목업 구현(시드, 상태 변경 엔진, 멱등성). 2차에서 Supabase 구현체로 교체 |
| `src/app/` | 라우터(인증 가드 없음), 저장소 주입(`context.tsx`), 가상 데모 고객 id(`account.ts`), 목록 필터 URL 관리(`listFilter.ts`), 조회·쓰기 훅 |
| `src/components/`, `src/styles/` | 디자인 토큰과 공통 컴포넌트 |
| `src/components/brand/` | 브랜드: 심볼·로고(`Brand.tsx`), 심볼 형태 값(`marks.ts`), 공동 방문 일러스트(`CoopVisitIllustration.tsx`) |
| `public/favicon.svg`, `public/brand/` | 파비콘(단순형 심볼), 앱 아이콘 원본(`app-icon.svg`), 투명 배경 심볼 SVG |
| `src/features/*` | 화면(IA의 C-01~C-25, S-01~S-05). 로그인·회원가입 화면은 없음(이전 인증 주소는 업체 찾기로 이동) |
| `src/dev/` | 시나리오 컨트롤러(`devController.ts`)와 화면 없는 훅(`devHook.ts`) — `import.meta.env.DEV` 또는 `VITE_ENABLE_DEV_TOOLS=true`일 때만 lazy 로드 |

요청·예약·작업·결제·환불·변경 제안 상태는 서로 다른 필드로 분리되어 있습니다(`src/domain/types.ts`).

## 개발용 시나리오 훅

사용자 화면에는 개발 도구 버튼·패널이 없습니다(2026-10-12, 우측 상단 DEV 버튼 제거). dev 서버·데모 빌드에서만 브라우저 콘솔·e2e에 `window.__sagoDev`(`DevController`)가 생기며, 예: `__sagoDev.approveRequest('rq-1', '10:30')`, `__sagoDev.reset('full')`. 시나리오 초기화(전체/간소/빈 상태), 결제 결과(성공/실패/처리 중/확인 중)·조회 실패·주소 판단 장애 설정,
업체 승인·추가 정보 요청·거절·승인 만료·조건 변경, 그룹 마감·종료, 지연·업체 변경 제안·자재 조건·추가 작업·작업 완료(잔금/0원/환불),
환불 상태 변경, 시계 이동, 모의 알림 진입, 상태별 바로가기를 실제 시간을 기다리지 않고 재현합니다. 운영 빌드에는 들어가지 않습니다.

## 로그인 없는 데모: 데이터 처리와 유지 범위

- **진입:** 세션 확인 없이 바로 업체 찾기. 로그인·회원가입·가입 완료·비밀번호 재설정 화면과 진입 링크, 내 정보의 계정 이메일·로그아웃은 없습니다. 이전 인증 주소(`/login`, `/signup`, `/password/*`)는 업체 찾기로 이동합니다.
- **데모 사용자:** 모든 방문자는 고정 id `demo-customer`의 가상 데모 고객입니다(`src/app/account.ts`). 사용자 구분 구조(목업 DB 소유 계정, 계정별 화면 상태, 필터 기록의 계정 표시)는 지우지 않고 이 id로 유지해, 이후 실제 계정 id로 바꿔 끼울 수 있습니다.
- **저장 위치·유지 범위:** 요청·예약·주소(탐색 주소·저장한 상세 주소)·필터는 **이 브라우저 탭의 sessionStorage**에만 저장됩니다. 새로고침·같은 탭 재방문에는 유지되고, 탭·브라우저를 닫거나 다른 기기·탭에서 열면 처음 데모 데이터로 시작합니다. 이제 로그아웃이 없으므로 로그아웃 때문에 지워지는 일은 없습니다. 개발용 시나리오 훅의 `reset()`(dev 서버·데모 빌드)으로 처음 상태로 돌릴 수 있습니다.
- **실제 데이터:** 실제 DB·개인정보에 연결하지 않습니다. 앱은 외부 서버로 데이터를 보내거나 받지 않습니다. 이전에 연결 코드만 있던 Supabase Auth는 제거했고(`@supabase/supabase-js` 의존성·`VITE_SUPABASE_*` 환경 변수 포함), Supabase 프로젝트의 계정·테이블·정책·데이터는 건드리지 않았습니다.
- **나중에 실제 데이터로 바꿀 때:** 익명 방문자 모두를 하나의 실제 고객 계정에 연결하거나, RLS를 끄거나, service role/secret 키를 브라우저에 넣지 않습니다. 인증과 서버·RLS 권한 검증을 함께 도입하고 `account.ts`의 고정 id를 인증된 사용자 id로 바꿉니다(`docs/supabase-handoff.md`).

## 배포(Vercel)

Vite SPA(React Router `BrowserRouter`)라 앱 경로를 서버가 모르면 새로고침·뒤로가기 때 404가 납니다. `vercel.json`의 rewrites가 확장자 없는 앱 경로(`/assets/` 제외)만 `index.html`로 보내고, 실제 정적 파일은 그대로, 없는 정적 파일은 404로 둡니다. API 경로는 없습니다. e2e의 ‘배포 라우팅’ 점검은 `e2e/vercel-static.mjs`(Vercel식 정적 서버 흉내)로 규칙 전후를 확인합니다 — 실제 Vercel 환경 확인을 대신하지는 않습니다.

## 문서

- `spec.md` — 요청 명세 원문 · `docs/reference/` — Notion 기획 문서 6종 사본
- `docs/screen-map.md` 화면 ID 매핑 · `docs/decisions.md` 결정·충돌·미정 · `docs/design-differences.md` 디자인 확인 범위와 차이
- `docs/supabase-handoff.md` 2차 데이터 계약·작업 목록 · `docs/verification-log.md` 검증 기록 · `docs/e2e-report.md` e2e 결과

## 주의

- 결제·환불 화면에는 항상 “모의” 표시가 있습니다. 실제 결제 정보는 입력받지 않습니다.
- 저장소에는 비밀 값·실제 개인정보가 없습니다. 이름·주소·전화번호는 모두 가상입니다.
