# 화면 매핑 (IA 화면 ID → 구현)

| ID | 화면 | 경로 | 파일 |
|---|---|---|---|
| C-01 | 업체 찾기 | `/` | features/discovery/HomePage |
| C-02 | 방문 지역 설정 | `/address` | AddressPage |
| C-03 | 카테고리별 업체 목록 | `/providers?category=` | ProviderListPage |
| C-04 | 업체 상세 | `/providers/:id` | ProviderDetailPage |
| C-05 | 수리 요청서 | `/providers/:id/request?group=\|new=1` | requests/RequestFormPage |
| C-06 | 내 요청 | `/requests` | RequestsPage |
| C-07 | 비교 요청 묶음 | `/requests/bundle/:id` | BundlePage |
| C-08 | 업체별 요청 상세 | `/requests/:id` | RequestDetailPage |
| C-09 | 요청서 보완 | `/requests/:id/supplement` | SupplementPage |
| C-10 | 요청 철회 확인 | C-08 내 대화상자 | RequestDetailPage |
| C-11 | 승인 내용 확인 | `/requests/:id/approval` | payment/ApprovalPage |
| C-12 | 새 그룹 조건 재확인 | `/requests/:id/recheck` | ApprovalPage(mode=recheck) |
| C-13 | 내 예약 | `/bookings` | bookings/BookingsPage |
| C-14 | 예약 상세 | `/bookings/:id` | BookingDetailPage |
| C-15 | 날짜·시간 변경 요청 | `/bookings/:id/change` | changes/ChangeRequestPage |
| C-16 | 변경 제안 확인 | `/proposals/:id` | ProposalPage |
| C-17 | 취소·환불 금액 확인 | `/bookings/:id/cancel` | CancelPage |
| C-18 | 지연 안내·대응 | `/delays/:id` | DelayPage |
| C-19 | 자재 조건·진행 | `/materials/:id` | work/MaterialPage |
| C-20 | 추가 작업 확인 | `/additional/:id` | AdditionalPage |
| C-21 | 최종 금액 확인 | `/bookings/:id/final` | FinalStatementPage |
| C-22 | 결제·환불 상세 | `/ledger/:id` | history/LedgerPages |
| C-23 | 리뷰 작성 | `/bookings/:id/review` | ReviewPage |
| C-24 | 내 정보 | `/me` | MePage |
| C-25 | 결제·환불 내역 | `/ledger` | LedgerPages |
| S-01 | 결제 진행·결과(모의) | `/pay/:txId` (진행은 각 화면의 버튼 상태) | payment/PaymentResultPage |
| S-02 | 알림 진입 | `/notice/:id` | system/SystemPages |
| S-03 | 약관·개인정보·이용 안내 | `/guide` | SystemPages (요약만) |
| S-04a | 로그인 | `/login` | features/auth/AuthPages (LoginPage) |
| S-04b | 회원가입 | `/signup` | SignUpPage |
| S-04c | 가입 완료(확인 메일 필요 시 안내) | `/signup/done` | SignUpDonePage |
| S-04d | 비밀번호 재설정 요청 | `/password/reset` | ResetRequestPage |
| S-04e | 재설정 안내 | `/password/reset/sent` | ResetSentPage |
| S-04f | 새 비밀번호(메일 링크 복구 세션) | `/password/new` | NewPasswordPage |
| S-05 | 상태·접근 안내 | `*`, 조회 실패 | SystemPages, ErrorState |

S-04는 Supabase Auth 이메일·비밀번호로 실제 동작한다. 인증 화면은 하단 탭·상단 메뉴를 숨긴다.
S-04를 뺀 모든 경로(C-01~C-25, S-01~S-03, S-05, `*`)는 `RequireAuth` 아래에 있어 비로그인이면 `/login`으로 이동한다. C-24 내 정보에 로그인 이메일·로그아웃이 있다.
