import { useCallback, useEffect, useRef, useState } from 'react';
import { describeError } from '../domain/errors';
import { useRepo } from './context';

export interface AsyncState<T> {
  data?: T;
  error?: unknown;
  loading: boolean;
  reload: () => void;
}

/** 조회 + 저장소 변경 시 조용한 재조회. 실패는 error로 남기고 reload()로 다시 시도한다. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): AsyncState<T> {
  const repo = useRepo();
  const [state, setState] = useState<{ data?: T; error?: unknown; loading: boolean }>({ loading: true });
  const seq = useRef(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback((silent: boolean) => {
    const id = ++seq.current;
    if (!silent) setState((s) => ({ data: s.data, loading: true }));
    fnRef.current().then(
      (data) => { if (id === seq.current) setState({ data, loading: false }); },
      (error) => { if (id === seq.current) setState((s) => ({ data: s.data, error, loading: false })); },
    );
  }, deps);
  useEffect(() => { run(false); }, [run]);
  useEffect(() => repo.subscribe(() => run(true)), [repo, run]);
  const reload = useCallback(() => run(false), [run]);
  return { ...state, reload };
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
