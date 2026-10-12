# 2차 인계: Supabase·외부 서비스 연결 시 필요한 작업

1차는 `Repository` 계약(`src/data/repositories/types.ts`)과 `AuthRepository` 계약(`src/data/repositories/auth.ts`)만 UI가 안다. **인증은 이미 Supabase Auth로 연결됐다**(`src/data/auth/`). 2차는 데이터 계약의 Supabase 구현체를 만들어 `src/app/context.tsx`의 `createDefaultServices`에서 `MockRepository`만 교체한다.

## 데이터 계약(제안, 확정 아님)
요청(`RepairRequest`)·승인 조건(`Approval`, 조건 버전)·예약(`Booking`+`workStatus`)·그룹(`GroupRecord`, 공개용 `PublicGroup`)·거래(`Transaction`)·환불(`Refund`)·공제(`Deduction`)·변경 제안(`ChangeProposal`)·지연·자재(`MaterialOffer`, 결제/주문 분리)·추가 작업·최종 내역(`FinalStatement`)·리뷰 — `src/domain/types.ts`.
금액은 정수 원, 시각은 오프셋 포함 ISO(KST 표시).

## 서버가 반드시 해야 할 일 (목업은 흉내만 냄)
1. **권한/RLS**: 고객은 본인 요청·예약·거래만, 업체는 자기 요청 건만. 다른 고객의 주소·동호수·사진·작업·정확한 거리·지도 핀은 어떤 응답에도 포함 금지(공개 그룹은 집계만).
2. **자격 판단 서버화**: 아파트 동일 단지 / 그 외 최초 확정 예약지 300m, 기준점 이동 금지. 현재는 `eligibleGroups`가 내부 키로 흉내.
3. **결제**: PG 결제·웹훅 서명 검증, 결제 대상 금액·조건 버전 서버 재검증, 멱등성 키 저장, 결과 불명 시 조회로만 확정(재결제 금지). 클라이언트 값 불신.
4. **금액 계산을 서버가 재계산**: `domain/pricing.ts`를 서버에서 같은 규칙으로 구현(마감 시 세대별 `floor`, 0세대 분모 금지, 선결제 재사용 금지).
5. **기한·마감**: 결제 기한 = min(승인+24h, 마감), 승인은 마감 1시간 전까지, 마감 최대 전날 18:00 — 스케줄러/DB 제약. 승인 만료·그룹 마감·종료(재확인 생성)를 서버 이벤트로.
6. **환불**: PG 환불 요청/완료/실패/불명 상태 동기화(“요청 접수”와 “실제 반영” 구분).
7. **알림**: 채널·템플릿 미정. S-02 진입은 서버에서 대상 상태 스냅샷과 현재 상태를 비교해 stale 안내.
8. **파일 업로드**: 사진 저장소·악성 파일 검사·개인정보 가림.
9. **인증과 데이터 권한**: 인증은 연결됨(아래 절). 데이터 연결 시 모든 테이블에 RLS(`auth.uid()` 기준 본인 행), 쓰기·결제는 서버(Edge Functions 등)에서 세션 검증. `getProfile`·`updateProfile`(이름·연락처 수정)은 `auth.uid()` 본인 프로필 조회·수정으로. 요청·예약의 연락처는 제출·확정 당시 스냅숏(`contact`)으로 저장하고 프로필을 참조하지 않는다. 알림 링크 접근 시 권한 재확인.
10. **주소 검색·거리 계산 공급자**, 단지 판별 데이터.

## 인증 — 현재 없음(로그인 없는 데모, 2026-10-12)
인증 코드와 `@supabase/supabase-js`는 제거됐다. 지금은 모든 방문자가 가상 데모 고객(`src/app/account.ts`의 고정 id)이다. 데이터를 Supabase로 옮길 때는 인증을 다시 도입하고 `useAccountId()`가 인증된 사용자 id를 돌려주게 바꾼 뒤, 모든 테이블에 `auth.uid()` 기준 RLS를 적용한다. 익명 방문자를 실제 고객 계정 하나에 묶거나 RLS를 끄지 않는다. 아래 표는 제거 전 구현의 기록이다(git 기록에서 복원 가능).

## (기록) 인증(Supabase Auth) — 제거 전 연결 지점
| 계약(`AuthRepository`) | 구현(`SupabaseAuthRepository`) |
|---|---|
| `restoreSession` | `auth.getSession()` 후 `auth.getUser()`로 서버 확인. 무효면 `signOut({ scope: 'local' })` |
| `subscribe` | `auth.onAuthStateChange` → SIGNED_IN·TOKEN_REFRESHED·USER_UPDATED / SIGNED_OUT / PASSWORD_RECOVERY |
| `signIn` | `auth.signInWithPassword` |
| `signUp` | `auth.signUp`(emailRedirectTo `/login`). 세션이 생기면 즉시 로컬 로그아웃 |
| `signOut` | `auth.signOut({ scope: 'local' })` |
| `requestPasswordReset` | `auth.resetPasswordForEmail`(redirectTo `/password/new`) |
| `updatePassword` | 복구 세션에서 `auth.updateUser({ password })` |

- 클라이언트는 `src/data/auth/supabaseClient.ts` 하나. publishable/anon 키만 쓰고 service role·secret 키는 브라우저에 두지 않는다.
- **현재 라우트 보호(`RequireAuth`)는 화면 이동 제어일 뿐이다.** 보호 대상이 목업이라 지금은 충분하지만, 데이터를 연결하면 서버·RLS 권한 검증이 필수다(프런트 보호만으로 데이터 보안이 완성되지 않음).
- 데이터 연결 시 `main.tsx`의 `onAccount`(목업 상태 교체)는 제거하고, 계정이 바뀔 때 클라이언트 캐시만 비운다(`AppStateProvider`의 계정별 재생성은 유지 가능).
- 출시 전: 이메일 확인 정책 재검토(데모는 끔), 비밀번호 정책·SMTP·리디렉트 URL 허용 목록, 세션 저장 위치(`docs/decisions.md`).

## 환경 변수(예시, 값은 저장소에 두지 않음)
`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`(또는 `VITE_SUPABASE_ANON_KEY`, 공개 가능 값, RLS 전제), `VITE_AUTH_PASSWORD_MIN_LENGTH`. service role/PG secret은 서버 전용 — `.env.example` 참고.

## 제거·교체 대상
`src/data/mock/*`, `src/dev/*`, `VITE_ENABLE_DEV_TOOLS`, 화면의 “모의” 표시(결제 연동 시).
