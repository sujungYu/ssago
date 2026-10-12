import { useCallback, useEffect, useRef, useState } from 'react';
import { describeError } from '../domain/errors';
import { useRepo } from './context';

export interface AsyncState<T> {
  data?: T;
  error?: unknown;
  loading: boolean;
  reload: () => void;
}

/**
 * 조회 + 저장소 변경 시 조용한 재조회. 실패는 error로 남기고 reload()로 다시 시도한다.
 * 결과는 그 결과를 조회한 조건(deps)에 묶인다: 조건이 바뀌면(예: 탐색 주소 변경) 새 응답이 올 때까지 이전 조건의 결과를 내주지 않고 로딩으로 둔다.
 * 늦게 도착한 이전 요청의 응답은 순번(seq)으로 버려 최신 결과를 덮어쓰지 않는다.
 */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): AsyncState<T> {
  const repo = useRepo();
  const [state, setState] = useState<{ data?: T; error?: unknown; loading: boolean; of?: unknown }>({ loading: true });
  const seq = useRef(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback((silent: boolean) => {
    const id = ++seq.current;
    if (!silent) setState((s) => (s.of === run ? { data: s.data, loading: true, of: run } : { loading: true, of: run }));
    fnRef.current().then(
      (data) => { if (id === seq.current) setState({ data, loading: false, of: run }); },
      (error) => { if (id === seq.current) setState((s) => ({ data: s.of === run ? s.data : undefined, error, loading: false, of: run })); },
    );
  }, deps);
  useEffect(() => { run(false); }, [run]);
  useEffect(() => repo.subscribe(() => run(true)), [repo, run]);
  const reload = useCallback(() => run(false), [run]);
  // 조건이 바뀐 직후(효과가 돌기 전) 렌더에서도 이전 조건의 결과를 보여주지 않는다
  if (state.of !== run) return { loading: true, reload };
  return { data: state.data, error: state.error, loading: state.loading, reload };
}

/** 제출·결제 등 쓰기 동작. 진행 중에는 다시 실행되지 않아 연타해도 한 번만 호출된다. */
export function useAction() {
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ReturnType<typeof describeError> | null>(null);
  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    if (busyRef.current) return undefined;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(describeError(e));
      return undefined;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, []);
  return { run, busy, error, clearError: () => setError(null) };
}

export function newKey(prefix = 'idem'): string {
  const rnd = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${rnd}`;
}

/** 한 번의 시도에 같은 멱등성 키를 쓴다. 결과를 모르는 재전송은 같은 키, 새 시도는 renew()로 새 키. */
export function useAttemptKey(prefix: string) {
  const ref = useRef<string>(newKey(prefix));
  return { get: () => ref.current, renew: () => { ref.current = newKey(prefix); } };
}
