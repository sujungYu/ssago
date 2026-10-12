import { Icon } from './Icon';
import { FLOW_LABEL, FLOW_STEPS, PROGRESS_NOTE_TEXT, type Progress } from '../domain/progressStep';

/**
 * 진행 표시(안내용, 누를 수 없음). 내 요청·내 예약 두 과정이 같은 컴포넌트를 쓰고, 단계 목록은 FLOW_STEPS 설정에서 온다.
 * 단계는 progressOfRequest / progressOfBooking / progressOfPayment가 업무 상태에서 정한다.
 * 상태는 색만으로 구분하지 않는다: 완료 = 체크 + ‘완료’(스크린리더), 현재 = 굵은 블루 번호·글씨 + aria-current="step", 이후 = 회색 번호.
 * 좁은 화면에서는 짧은 라벨을 보여주고 전체 라벨은 스크린리더용으로 남긴다(가로 스크롤 없음).
 * 종료(kind='ended')에는 그리지 않는다 — 화면의 기존 종료 상태·사유를 그대로 보여준다. 한 화면에는 하나만 둔다(Page의 progress).
 */
export function ProgressSteps({ progress }: { progress: Progress | null }) {
  if (!progress || progress.view.kind === 'ended') return null;
  const { flow, view } = progress;
  const steps = FLOW_STEPS[flow];
  const cur = view.kind === 'step' ? view.step : steps.length + 1; // complete = 모두 완료
  return (
    <nav className="steps" aria-label={FLOW_LABEL[flow]} data-flow={flow}>
      <ol className="steps__list" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}>
        {steps.map((s) => {
          const state = s.no < cur ? 'done' : s.no === cur ? 'current' : 'todo';
          return (
            <li key={s.no} className={`steps__item steps__item--${state}`} aria-current={state === 'current' ? 'step' : undefined}>
              <span className="steps__mark" aria-hidden>{state === 'done' ? <Icon name="check" size={14} /> : s.no}</span>
              <span className="steps__label steps__label--full">{s.label}</span>
              <span className="steps__label steps__label--short" aria-hidden>{s.short}</span>
              <span className="sr-only">{state === 'done' ? ' 완료' : state === 'current' ? ' 현재 단계' : ' 예정'}</span>
            </li>
          );
        })}
      </ol>
      {view.note && <p className={`steps__note${view.kind === 'complete' ? ' steps__note--done' : ''}`} role="status">{PROGRESS_NOTE_TEXT[view.note]}</p>}
    </nav>
  );
}
