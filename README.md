# 온김에 — 사용자 화면 (1차: 목업 데이터)

가까운 이웃과 같은 업체·같은 날 방문을 예약하고 출장비를 확정 세대 수로 나누는 생활 수리 공동 예약 서비스의 **고객용 웹 화면**입니다.
외부 키·서버 없이 실행·빌드되며, 모든 결제·환불·알림·주소 검색은 **모의**입니다. 업체·운영자 화면은 범위 밖입니다.

## 실행

```bash
npm install
npm run dev          # 개발 서버 (우측 상단 DEV 버튼 = 시나리오 도구)
npm run build        # 운영 빌드 — 개발 도구 미포함
npm run build:demo   # 데모 빌드 — 개발 도구 포함 (.env.demo)
npm run preview      # 빌드 결과 확인
npm test             # 단위·저장소 규칙 테스트 (Vitest)
npm run e2e          # 데모 빌드 후 실제 브라우저(Chromium) 흐름·반응형 점검 → docs/e2e-report.md
```

e2e는 playwright-core를 쓰며 브라우저는 내려받지 않습니다(`/opt/pw-browsers/chromium` 또는 `CHROME_PATH`).
`E2E_ONLY=결제 npm run e2e`처럼 이름으로 일부만, `E2E_SKIP_BUILD=1`로 빌드 생략, `E2E_SHOTS=0`으로 스크린샷 생략.

## 구조

| 위치 | 역할 |
|---|---|
| `src/domain/` | 순수 규칙: 출장비 분담·취소·정산·날짜 변경 금액(`pricing.ts`), 기한·결제 가능 판단(`rules.ts`), 시간(Asia/Seoul)·금액(정수 원) |
| `src/data/repositories/types.ts` | **데이터 접근 계약**(`Repository`). 화면은 이것만 안다 |
| `src/data/mock/` | 계약의 목업 구현(시드, 상태 변경 엔진, 멱등성). 2차에서 Supabase 구현체로 교체 |
| `src/app/` | 라우터, 저장소 주입(`context.tsx`), 조회·쓰기 훅 |
| `src/components/`, `src/styles/` | 디자인 토큰과 공통 컴포넌트 |
| `src/features/*` | 화면(IA의 C-01~C-25, S-01~S-05) |
| `src/dev/` | 시나리오 도구 — `import.meta.env.DEV` 또는 `VITE_ENABLE_DEV_TOOLS=true`일 때만 lazy 로드 |

요청·예약·작업·결제·환불·변경 제안 상태는 서로 다른 필드로 분리되어 있습니다(`src/domain/types.ts`).

## 개발용 시나리오 도구

우측 상단 **DEV** 버튼. 시나리오 초기화(전체/간소/빈 상태), 결제 결과(성공/실패/처리 중/확인 중)·조회 실패·주소 판단 장애 설정,
업체 승인·추가 정보 요청·거절·승인 만료·조건 변경, 그룹 마감·종료, 지연·업체 변경 제안·자재 조건·추가 작업·작업 완료(잔금/0원/환불),
환불 상태 변경, 시계 이동, 모의 알림 진입, 상태별 바로가기를 실제 시간을 기다리지 않고 재현합니다. 운영 빌드에는 들어가지 않습니다.

## 문서

- `spec.md` — 요청 명세 원문 · `docs/reference/` — Notion 기획 문서 6종 사본
- `docs/screen-map.md` 화면 ID 매핑 · `docs/decisions.md` 결정·충돌·미정 · `docs/design-differences.md` 디자인 확인 범위와 차이
- `docs/supabase-handoff.md` 2차 데이터 계약·작업 목록 · `docs/verification-log.md` 검증 기록 · `docs/e2e-report.md` e2e 결과

## 주의

- 결제·환불 화면에는 항상 “모의” 표시가 있습니다. 실제 결제 정보는 입력받지 않습니다.
- 저장소에는 비밀 값·실제 개인정보가 없습니다. 이름·주소·전화번호는 모두 가상입니다.
