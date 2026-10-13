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
  ],  // ───── 추가 업체(p9~p35, providersExtra.ts). categoryId = 그 작업이 속한 카테고리(업체 소속 카테고리와 등록 작업의 일치 점검에 쓴다) ─────
  // 창가손길
  p9: [
    { id: 'sv-p9-screen', name: '방충망 교체', categoryId: 'c1' },
    { id: 'sv-p9-roller', name: '방충망 롤러 교체', categoryId: 'c1' },
    { id: 'sv-p9-lock', name: '창문 잠금장치 교체', categoryId: 'c5' },
    { id: 'sv-p9-strip', name: '창문 틈새막이 시공', categoryId: 'c5' },
    { id: 'sv-p9-blind', name: '블라인드 설치', categoryId: 'c7' },
  ],
  // 바람길창호
  p10: [
    { id: 'sv-p10-screen', name: '방충망 교체', categoryId: 'c1' },
    { id: 'sv-p10-frame', name: '방충망 틀 수리', categoryId: 'c1' },
    { id: 'sv-p10-winroller', name: '창문 롤러 교체', categoryId: 'c5' },
    { id: 'sv-p10-strip', name: '창문 틈새막이 시공', categoryId: 'c5' },
    { id: 'sv-p10-handle', name: '문손잡이 교체', categoryId: 'c3' },
    { id: 'sv-p10-hinge', name: '경첩 조정', categoryId: 'c3' },
  ],
  // 촘촘방충망
  p11: [
    { id: 'sv-p11-screen', name: '방충망 교체', categoryId: 'c1' },
    { id: 'sv-p11-frame', name: '방충망 틀 수리', categoryId: 'c1' },
    { id: 'sv-p11-roller', name: '방충망 롤러 교체', categoryId: 'c1' },
    { id: 'sv-p11-lock', name: '창문 잠금장치 교체', categoryId: 'c5' },
  ],
  // 틈새지기
  p12: [
    { id: 'sv-p12-strip', name: '창문 틈새막이 시공', categoryId: 'c5' },
    { id: 'sv-p12-bath-silicone', name: '욕실 실리콘 보수', categoryId: 'c9' },
    { id: 'sv-p12-grout', name: '욕실 줄눈 보수', categoryId: 'c9' },
    { id: 'sv-p12-screen', name: '방충망 교체', categoryId: 'c1' },
  ],
  // 열고닫고
  p13: [
    { id: 'sv-p13-lock', name: '창문 잠금장치 교체', categoryId: 'c5' },
    { id: 'sv-p13-winroller', name: '창문 롤러 교체', categoryId: 'c5' },
    { id: 'sv-p13-handle', name: '문손잡이 교체', categoryId: 'c3' },
    { id: 'sv-p13-closer', name: '도어클로저 조정', categoryId: 'c3' },
    { id: 'sv-p13-roller', name: '방충망 롤러 교체', categoryId: 'c1' },
  ],
  // 산들창
  p14: [
    { id: 'sv-p14-screen', name: '방충망 교체', categoryId: 'c1' },
    { id: 'sv-p14-frame', name: '방충망 틀 수리', categoryId: 'c1' },
    { id: 'sv-p14-strip', name: '창문 틈새막이 시공', categoryId: 'c5' },
    { id: 'sv-p14-lock', name: '창문 잠금장치 교체', categoryId: 'c5' },
    { id: 'sv-p14-dryrack', name: '빨래건조대 설치·수리', categoryId: 'c10' },
  ],
  // 또르르창문
  p15: [
    { id: 'sv-p15-winroller', name: '창문 롤러 교체', categoryId: 'c5' },
    { id: 'sv-p15-lock', name: '창문 잠금장치 교체', categoryId: 'c5' },
    { id: 'sv-p15-roller', name: '방충망 롤러 교체', categoryId: 'c1' },
    { id: 'sv-p15-screen', name: '방충망 교체', categoryId: 'c1' },
    { id: 'sv-p15-towel', name: '수건걸이 설치', categoryId: 'c8' },
    { id: 'sv-p15-paper', name: '휴지걸이 설치', categoryId: 'c8' },
  ],
  // 햇살창틀
  p16: [
    { id: 'sv-p16-strip', name: '창문 틈새막이 시공', categoryId: 'c5' },
    { id: 'sv-p16-lock', name: '창문 잠금장치 교체', categoryId: 'c5' },
    { id: 'sv-p16-screen', name: '방충망 교체', categoryId: 'c1' },
    { id: 'sv-p16-kitchen-silicone', name: '주방 실리콘 보수', categoryId: 'c9' },
    { id: 'sv-p16-grout', name: '줄눈 보수', categoryId: 'c9' },
  ],
  // 물길수리
  p17: [
    { id: 'sv-p17-faucet', name: '수전 교체', categoryId: 'c2' },
    { id: 'sv-p17-shower', name: '샤워기 교체', categoryId: 'c2' },
    { id: 'sv-p17-trap', name: '배수 트랩 교체', categoryId: 'c2' },
    { id: 'sv-p17-bath-silicone', name: '욕실 실리콘 보수', categoryId: 'c9' },
    { id: 'sv-p17-towel', name: '수건걸이 설치', categoryId: 'c8' },
    { id: 'sv-p17-paper', name: '휴지걸이 설치', categoryId: 'c8' },
  ],
  // 똑똑수전
  p18: [
    { id: 'sv-p18-faucet', name: '세면대 수전 교체', categoryId: 'c2' },
    { id: 'sv-p18-kitchen-faucet', name: '주방 수전 교체', categoryId: 'c2' },
    { id: 'sv-p18-shower', name: '샤워기 교체', categoryId: 'c2' },
    { id: 'sv-p18-drain', name: '세면대 배수구 막힘 수리', categoryId: 'c2' },
    { id: 'sv-p18-bath-silicone', name: '욕실 실리콘 보수', categoryId: 'c9' },
  ],
  // 맑은물설비
  p19: [
    { id: 'sv-p19-trap', name: '배수 트랩 교체', categoryId: 'c2' },
    { id: 'sv-p19-drain', name: '배수구 막힘 수리', categoryId: 'c2' },
    { id: 'sv-p19-faucet', name: '수전 교체', categoryId: 'c2' },
    { id: 'sv-p19-kitchen-silicone', name: '주방 실리콘 보수', categoryId: 'c9' },
    { id: 'sv-p19-hose', name: '세탁기 급수 호스 교체', categoryId: 'c10' },
  ],
  // 욕실단짝
  p20: [
    { id: 'sv-p20-shower', name: '샤워기 교체', categoryId: 'c2' },
    { id: 'sv-p20-faucet', name: '세면대 수전 교체', categoryId: 'c2' },
    { id: 'sv-p20-bath-silicone', name: '욕실 실리콘 보수', categoryId: 'c9' },
    { id: 'sv-p20-grout', name: '욕실 줄눈 보수', categoryId: 'c9' },
    { id: 'sv-p20-towel', name: '수건걸이 설치', categoryId: 'c8' },
    { id: 'sv-p20-mirror', name: '거울 설치', categoryId: 'c8' },
  ],
  // 물샐틈없이
  p21: [
    { id: 'sv-p21-faucet', name: '수전 교체', categoryId: 'c2' },
    { id: 'sv-p21-trap', name: '배수 트랩 교체', categoryId: 'c2' },
    { id: 'sv-p21-bath-silicone', name: '욕실 실리콘 보수', categoryId: 'c9' },
    { id: 'sv-p21-kitchen-silicone', name: '주방 실리콘 보수', categoryId: 'c9' },
    { id: 'sv-p21-strip', name: '창문 틈새막이 시공', categoryId: 'c5' },
  ],
  // 주방손질
  p22: [
    { id: 'sv-p22-kitchen-faucet', name: '주방 수전 교체', categoryId: 'c2' },
    { id: 'sv-p22-trap', name: '싱크대 배수 트랩 교체', categoryId: 'c2' },
    { id: 'sv-p22-kitchen-silicone', name: '주방 실리콘 보수', categoryId: 'c9' },
    { id: 'sv-p22-hinge', name: '수납장 문 경첩 교체', categoryId: 'c4' },
    { id: 'sv-p22-drawer', name: '서랍 레일 수리', categoryId: 'c4' },
  ],
  // 욕실살림
  p23: [
    { id: 'sv-p23-faucet', name: '세면대 수전 교체', categoryId: 'c2' },
    { id: 'sv-p23-shower', name: '샤워기 교체', categoryId: 'c2' },
    { id: 'sv-p23-cabinet', name: '욕실 수납장 문 수리', categoryId: 'c4' },
    { id: 'sv-p23-towel', name: '수건걸이 설치', categoryId: 'c8' },
    { id: 'sv-p23-paper', name: '휴지걸이 설치', categoryId: 'c8' },
  ],
  // 우리집수리
  p24: [
    { id: 'sv-p24-faucet', name: '수전 교체', categoryId: 'c2' },
    { id: 'sv-p24-light', name: '조명 교체', categoryId: 'c6' },
    { id: 'sv-p24-switch', name: '스위치 교체', categoryId: 'c6' },
    { id: 'sv-p24-stopper', name: '도어스토퍼 설치', categoryId: 'c10' },
    { id: 'sv-p24-mirror', name: '거울·액자 걸기', categoryId: 'c10' },
  ],
  // 단단철물
  p25: [
    { id: 'sv-p25-hinge', name: '경첩 교체·조정', categoryId: 'c3' },
    { id: 'sv-p25-handle', name: '문손잡이 교체', categoryId: 'c3' },
    { id: 'sv-p25-drawer', name: '서랍 레일 수리', categoryId: 'c4' },
    { id: 'sv-p25-cabinet', name: '수납장 경첩 교체', categoryId: 'c4' },
    { id: 'sv-p25-lock', name: '창문 잠금장치 교체', categoryId: 'c5' },
    { id: 'sv-p25-winroller', name: '창문 롤러 교체', categoryId: 'c5' },
  ],
  // 고쳐쓰는집
  p26: [
    { id: 'sv-p26-handle', name: '문손잡이 교체', categoryId: 'c3' },
    { id: 'sv-p26-hinge', name: '경첩 조정', categoryId: 'c3' },
    { id: 'sv-p26-drawer', name: '서랍 레일 수리', categoryId: 'c4' },
    { id: 'sv-p26-cabinet', name: '수납장 문 수리', categoryId: 'c4' },
    { id: 'sv-p26-stopper', name: '도어스토퍼 설치', categoryId: 'c10' },
    { id: 'sv-p26-mirror', name: '거울·액자 걸기', categoryId: 'c10' },
  ],
  // 나무결손질
  p27: [
    { id: 'sv-p27-hinge', name: '방문 경첩 조정', categoryId: 'c3' },
    { id: 'sv-p27-handle', name: '문손잡이 교체', categoryId: 'c3' },
    { id: 'sv-p27-cabinet', name: '수납장 문 수리', categoryId: 'c4' },
    { id: 'sv-p27-drawer', name: '서랍 레일 수리', categoryId: 'c4' },
    { id: 'sv-p27-shelf', name: '선반 설치', categoryId: 'c7' },
  ],
  // 달아드림
  p28: [
    { id: 'sv-p28-light', name: '조명 교체', categoryId: 'c6' },
    { id: 'sv-p28-sensor', name: '센서등 설치', categoryId: 'c6' },
    { id: 'sv-p28-curtain', name: '커튼 레일 설치', categoryId: 'c7' },
    { id: 'sv-p28-blind', name: '블라인드 설치', categoryId: 'c7' },
    { id: 'sv-p28-towel', name: '수건걸이 설치', categoryId: 'c8' },
    { id: 'sv-p28-paper', name: '휴지걸이 설치', categoryId: 'c8' },
  ],
  // 반짝설치
  p29: [
    { id: 'sv-p29-light', name: '조명 교체', categoryId: 'c6' },
    { id: 'sv-p29-switch', name: '스위치 교체', categoryId: 'c6' },
    { id: 'sv-p29-blind', name: '블라인드 설치', categoryId: 'c7' },
    { id: 'sv-p29-shelf', name: '선반 설치', categoryId: 'c7' },
    { id: 'sv-p29-mirror', name: '거울 설치', categoryId: 'c8' },
  ],
  // 온집부속
  p30: [
    { id: 'sv-p30-outlet', name: '콘센트 교체', categoryId: 'c6' },
    { id: 'sv-p30-switch', name: '스위치 교체', categoryId: 'c6' },
    { id: 'sv-p30-towel', name: '수건걸이 설치', categoryId: 'c8' },
    { id: 'sv-p30-paper', name: '휴지걸이 설치', categoryId: 'c8' },
    { id: 'sv-p30-dryrack', name: '빨래건조대 설치·수리', categoryId: 'c10' },
    { id: 'sv-p30-stopper', name: '도어스토퍼 설치', categoryId: 'c10' },
  ],
  // 아늑한손
  p31: [
    { id: 'sv-p31-light', name: '조명 교체', categoryId: 'c6' },
    { id: 'sv-p31-switch', name: '스위치 교체', categoryId: 'c6' },
    { id: 'sv-p31-handle', name: '문손잡이 교체', categoryId: 'c3' },
    { id: 'sv-p31-cabinet', name: '수납장 경첩 교체', categoryId: 'c4' },
    { id: 'sv-p31-drawer', name: '서랍 레일 수리', categoryId: 'c4' },
  ],
  // 방방손질
  p32: [
    { id: 'sv-p32-switch', name: '스위치 교체', categoryId: 'c6' },
    { id: 'sv-p32-outlet', name: '콘센트 교체', categoryId: 'c6' },
    { id: 'sv-p32-handle', name: '문손잡이 교체', categoryId: 'c3' },
    { id: 'sv-p32-hinge', name: '경첩 조정', categoryId: 'c3' },
    { id: 'sv-p32-curtain', name: '커튼 레일 설치', categoryId: 'c7' },
  ],
  // 차곡차곡
  p33: [
    { id: 'sv-p33-drawer', name: '서랍 레일 수리', categoryId: 'c4' },
    { id: 'sv-p33-cabinet', name: '수납장 문 수리', categoryId: 'c4' },
    { id: 'sv-p33-shelf', name: '선반 설치', categoryId: 'c7' },
    { id: 'sv-p33-sensor', name: '센서등 설치', categoryId: 'c6' },
  ],
  // 현관지기
  p34: [
    { id: 'sv-p34-sensor', name: '현관 센서등 설치', categoryId: 'c6' },
    { id: 'sv-p34-switch', name: '스위치 교체', categoryId: 'c6' },
    { id: 'sv-p34-handle', name: '현관문 손잡이 교체', categoryId: 'c3' },
    { id: 'sv-p34-closer', name: '도어클로저 조정', categoryId: 'c3' },
    { id: 'sv-p34-stopper', name: '도어스토퍼 설치', categoryId: 'c10' },
  ],
  // 부엌손길
  p35: [
    { id: 'sv-p35-light', name: '주방 조명 교체', categoryId: 'c6' },
    { id: 'sv-p35-outlet', name: '콘센트 교체', categoryId: 'c6' },
    { id: 'sv-p35-cabinet', name: '수납장 문 경첩 교체', categoryId: 'c4' },
    { id: 'sv-p35-drawer', name: '서랍 레일 수리', categoryId: 'c4' },
    { id: 'sv-p35-shelf', name: '주방 선반 설치', categoryId: 'c7' },
  ],
};
