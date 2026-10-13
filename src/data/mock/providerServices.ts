import type { ProviderService } from '../../domain/types';

/**
 * 업체별 등록 작업(가상 데이터). 요청서의 ‘어떤 작업이 필요한가요?’ 칩이 이 목록을 그대로 보여준다(배열 순서 = 표시 순서).
 * 실제 서비스에서는 업체(파트너)가 등록·수정하는 데이터다 — 이번 데모에는 등록 화면·서버 연동이 없다.
 * ID는 업체 안에서 고유하고 이름이 바뀌어도 그대로다. 요청에는 고른 ID와 요청 당시 이름을 함께 저장한다.
 * 업체 소개의 ‘작업 범위’(scope)는 설명 문구라 그대로 두고, 고를 수 있는 작업은 여기서만 관리한다.
 */
export const PROVIDER_SERVICES: Record<string, ProviderService[]> = {
  p1: [
    { id: 'sv-p1-faucet', name: '수전 교체' },
    { id: 'sv-p1-shower', name: '샤워기 교체' },
    { id: 'sv-p1-trap', name: '배수 트랩 교체' },
    { id: 'sv-p1-drain', name: '배수구 막힘 수리' },
    { id: 'sv-p1-basin', name: '세면대 부속 교체' },
    { id: 'sv-p1-silicone', name: '실리콘 재시공' },
  ],
  p2: [
    { id: 'sv-p2-faucet', name: '수전 교체' },
    { id: 'sv-p2-handle', name: '문손잡이 교체' },
    { id: 'sv-p2-hinge', name: '경첩 교체·조정' },
    { id: 'sv-p2-drawer', name: '서랍 레일 수리' },
    { id: 'sv-p2-cabinet', name: '수납장 문 수리' },
  ],
  p3: [
    { id: 'sv-p3-light', name: '조명 교체' },
    { id: 'sv-p3-switch', name: '스위치 교체' },
    { id: 'sv-p3-outlet', name: '콘센트 교체' },
    { id: 'sv-p3-sensor', name: '센서등 설치' },
    { id: 'sv-p3-fixture', name: '생활 부속품 설치' },
  ],
  p4: [
    { id: 'sv-p4-handle', name: '문손잡이 교체' },
    { id: 'sv-p4-hinge', name: '경첩 조정' },
    { id: 'sv-p4-closer', name: '도어클로저 조정' },
    { id: 'sv-p4-screen', name: '방충망 교체' },
  ],
  p5: [
    { id: 'sv-p5-bath-silicone', name: '욕실 실리콘 보수' },
    { id: 'sv-p5-kitchen-silicone', name: '주방 실리콘 보수' },
    { id: 'sv-p5-grout', name: '줄눈 보수' },
    { id: 'sv-p5-shelf', name: '선반 설치' },
    { id: 'sv-p5-curtain', name: '커튼 레일 설치' },
  ],
  p6: [
    { id: 'sv-p6-drawer', name: '서랍 레일 수리' },
    { id: 'sv-p6-hinge', name: '수납장 경첩 교체' },
    { id: 'sv-p6-shelf', name: '선반 설치' },
    { id: 'sv-p6-blind', name: '블라인드 설치' },
    { id: 'sv-p6-door', name: '맞춤 도어 교체' },
  ],
  p7: [
    { id: 'sv-p7-screen', name: '방충망 교체' },
    { id: 'sv-p7-frame', name: '방충망 틀 수리' },
    { id: 'sv-p7-roller', name: '방충망 롤러 교체' },
  ],
  p8: [
    { id: 'sv-p8-curtain', name: '커튼 레일 설치' },
    { id: 'sv-p8-blind', name: '블라인드 설치' },
    { id: 'sv-p8-towel', name: '수건걸이 설치' },
    { id: 'sv-p8-fixture', name: '생활 부속품 설치' },
  ],
};
