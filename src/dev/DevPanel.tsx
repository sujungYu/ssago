/**
 * 개발용 시나리오 패널. 운영 빌드에는 포함되지 않는다(App.tsx의 조건부 lazy import).
 * 실제 서비스 화면이 아니며, 업체 응답·시간 경과 같은 이벤트를 즉시 일으켜 상태를 재현한다.
 */
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Link } from 'react-router-dom';
import { useRepo } from '../app/context';
import { MockRepository } from '../data/mock/mockRepository';
import { DevController, type EventResult, type Preset } from './devController';

const REQ_LINKS: [string, string][] = [
  ['rq-1 검토 중', '/requests/rq-1'], ['rq-2 추가 정보 필요', '/requests/rq-2'], ['rq-3 승인·결제 대기(비교 묶음)', '/requests/rq-3'],
  ['비교 묶음 b-sink', '/requests/bundle/b-sink'], ['rq-5 거절', '/requests/rq-5'], ['rq-6 철회', '/requests/rq-6'], ['rq-7 승인 만료', '/requests/rq-7'],
  ['rq-8 다른 예약으로 종료', '/requests/rq-8'], ['rq-10 새 그룹 재확인', '/requests/rq-10'],
];
const BK_LINKS: [string, string][] = [
  ['k1 확정(마감 전)', '/bookings/bk-k1'], ['k2 마감 후·4세대', '/bookings/bk-k2'], ['k3 방문 지연', '/bookings/bk-k3'], ['k4 업체 변경 제안', '/bookings/bk-k4'],
  ['k5 자재 조건', '/bookings/bk-k5'], ['k6 추가 작업 제안', '/bookings/bk-k6'], ['k7 후속 방문', '/bookings/bk-k7'], ['k9 잔금 62,500원', '/bookings/bk-k9/final'],
  ['k10 0원 확인', '/bookings/bk-k10/final'], ['k11 환불 7,500원', '/bookings/bk-k11/final'], ['k12 금액 이견', '/bookings/bk-k12/final'], ['k13 정산 완료(잔금)', '/bookings/bk-k13'],
  ['k14 정산 완료(환불)+리뷰', '/bookings/bk-k14'], ['k15 마감 전 취소', '/bookings/bk-k15'], ['k16 마감 후 취소', '/bookings/bk-k16'], ['k17 업체 사유 취소', '/bookings/bk-k17'], ['k18 자재 공제 취소', '/bookings/bk-k18'],
];

export default function DevPanel() {
  const repo = useRepo();
  const mock = repo instanceof MockRepository ? repo : null;
  const ctl = useMemo(() => (mock ? new DevController(mock) : null), [mock]);
  const [open, setOpen] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const version = useSyncExternalStore((cb) => repo.subscribe(cb), () => (mock ? JSON.stringify(mock.__db().settings) + mock.__db().seq + mock.__db().now + mock.__db().transactions.length + mock.__db().requests.map((r) => r.status).join('') : ''));
  const snap = useMemo(() => ctl?.snapshot(), [ctl, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const [req, setReq] = useState('rq-1');
  const [grp, setGrp] = useState('g1');
  const [bk, setBk] = useState('bk-k1');
  const [rf, setRf] = useState('');

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  if (!mock || !ctl || !snap) return null;
  const say = (r: EventResult) => setLog((l) => [`${r.ok ? '✓' : '✕'} ${r.message}`, ...l].slice(0, 20));
  const B = ({ label, run }: { label: string; run: () => EventResult | Promise<EventResult> }) => (
    <button className="btn" type="button" onClick={() => void Promise.resolve(run()).then(say)}>{label}</button>
  );
  const st = snap.settings;

  return (
    <>
      <button type="button" className="dev-fab" onClick={() => setOpen(true)} aria-label="개발용 시나리오 도구 열기" title="개발용 시나리오 도구">DEV</button>
      {open && (
        <aside className="dev-panel" role="dialog" aria-label="개발용 시나리오 도구">
          <div className="row row--between"><strong>개발용 시나리오 도구</strong><button className="btn" type="button" onClick={() => setOpen(false)}>닫기</button></div>
          <p className="muted">서비스 화면이 아니에요. 업체 응답·시간 경과를 즉시 재현해요. 운영 빌드에는 포함되지 않아요.</p>
          <div>목업 시각: <b>{snap.now}</b></div>

          <section><h3>시나리오 초기화</h3><div className="row row--wrap">
            {(['full', 'lean', 'empty'] as Preset[]).map((p) => <B key={p} label={p === 'full' ? '전체 데모' : p === 'lean' ? '간소' : '빈 상태'} run={() => ctl.reset(p)} />)}
          </div></section>

          <section><h3>목업 동작 설정</h3><div className="stack--sm stack">
            <label className="row">지연(ms)
              <select value={st.latencyMs} onChange={(e) => say(ctl.setSettings({ latencyMs: Number(e.target.value) }))}>{[0, 200, 800, 2500].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
            <label className="row">다음 결제 결과
              <select value={st.payOutcome} onChange={(e) => say(ctl.setSettings({ payOutcome: e.target.value as never }))}>
                <option value="success">성공</option><option value="fail">실패</option><option value="processing">처리 중</option><option value="unknown">결과 확인 중</option></select></label>
            <label className="row">결과 확인 시
              <select value={st.resolveOutcome} onChange={(e) => say(ctl.setSettings({ resolveOutcome: e.target.value as never }))}>
                <option value="success">성공</option><option value="fail">실패</option><option value="unknown">계속 확인 중</option></select></label>
            <label className="row"><input type="checkbox" checked={st.addressServiceDown} onChange={(e) => say(ctl.setSettings({ addressServiceDown: e.target.checked }))} />주소·단지 판단 서비스 장애</label>
            <B label="다음 조회 1회 실패시키기" run={() => ctl.setSettings({ failNextQuery: true })} />
          </div></section>

          <section><h3>요청·승인 이벤트</h3>
            <select value={req} onChange={(e) => setReq(e.target.value)} aria-label="요청 선택">{snap.requests.map((r) => <option key={r.id} value={r.id}>{r.id} · {r.status} · {r.label}</option>)}</select>
            <div className="row row--wrap" style={{ marginTop: 6 }}>
              <B label="업체 승인" run={() => ctl.approveRequest(req)} /><B label="추가 정보 요청" run={() => ctl.requestInfo(req)} />
              <B label="업체 거절" run={() => ctl.rejectRequest(req)} /><B label="승인 만료" run={() => ctl.expireApproval(req)} /><B label="조건 버전 올리기" run={() => ctl.bumpApprovalVersion(req)} />
            </div></section>

          <section><h3>공동 예약 그룹 이벤트</h3>
            <select value={grp} onChange={(e) => setGrp(e.target.value)} aria-label="그룹 선택">{snap.groups.map((g) => <option key={g.id} value={g.id}>{g.id} · {g.providerId} · {g.date} · 확정{g.confirmed}/대기{g.pending}{g.closed ? ' · 마감' : ''}{g.ended ? ' · 종료' : ''}</option>)}</select>
            <div className="row row--wrap" style={{ marginTop: 6 }}><B label="그룹 마감" run={() => ctl.closeGroup(grp)} /><B label="그룹 종료(재확인 발생)" run={() => ctl.endGroupEvent(grp)} /></div></section>

          <section><h3>예약·작업 이벤트</h3>
            <select value={bk} onChange={(e) => setBk(e.target.value)} aria-label="예약 선택">{snap.bookings.map((b) => <option key={b.id} value={b.id}>{b.id} · {b.status}/{b.work} · {b.label}</option>)}</select>
            <div className="row row--wrap" style={{ marginTop: 6 }}>
              <B label="방문 지연 발생" run={() => ctl.startDelay(bk)} /><B label="업체 변경 제안" run={() => ctl.proposeProviderChange(bk)} />
              <B label="자재 조건 제시" run={() => ctl.offerMaterial(bk)} /><B label="자재 도착 지연" run={() => ctl.materialDelayed(bk)} /><B label="자재 선결제·주문됨" run={() => ctl.payAndOrderMaterial(bk)} /><B label="추가 작업 제안" run={() => ctl.proposeAdditionalWork(bk)} />
              <B label="작업 완료·잔금 있음" run={() => ctl.registerFinalStatement(bk, 'pay')} /><B label="작업 완료·0원" run={() => ctl.registerFinalStatement(bk, 'zero')} /><B label="작업 완료·환불" run={() => ctl.registerFinalStatement(bk, 'refund')} />
            </div></section>

          <section><h3>결제·환불</h3>
            <div className="row row--wrap"><B label={`확인 중 결제 결과 반영(${snap.inFlight.length})`} run={() => ctl.resolveInFlightPayments()} /></div>
            {snap.refunds.length > 0 && <div className="row row--wrap" style={{ marginTop: 6 }}>
              <select value={rf} onChange={(e) => setRf(e.target.value)} aria-label="환불 선택"><option value="">환불 선택</option>{snap.refunds.map((r) => <option key={r.id} value={r.id}>{r.id} · {r.status} · {r.amount}</option>)}</select>
              {(['requested', 'completed', 'failed', 'unknown'] as const).map((s) => <B key={s} label={s} run={() => (rf ? ctl.setRefundStatus(rf, s) : { ok: false, message: '환불을 선택하세요.' })} />)}
            </div>}</section>

          <section><h3>시계</h3><div className="row row--wrap">
            {[['+6시간', 6], ['+1일', 24], ['+2일', 48]].map(([l, h]) => <B key={String(l)} label={String(l)} run={() => ctl.setNow(new Date(new Date(snap.now).getTime() + Number(h) * 3600000).toISOString())} />)}
          </div><p className="muted">기한·마감이 지난 승인은 만료, 그룹은 마감 처리돼요.</p></section>

          <section><h3>모의 알림 (S-02)</h3>
            {snap.notices.length === 0 ? <p className="muted">이벤트를 일으키면 알림이 생겨요.</p> : <ul>{snap.notices.map((n) => <li key={n.id}><Link to={`/notice/${n.id}`} onClick={() => setOpen(false)}>{n.title}</Link></li>)}</ul>}</section>

          <section><h3>요청 상태 바로가기</h3><ul>{REQ_LINKS.map(([l, to]) => <li key={to}><Link to={to} onClick={() => setOpen(false)}>{l}</Link></li>)}</ul></section>
          <section><h3>예약 상태 바로가기</h3><ul>{BK_LINKS.map(([l, to]) => <li key={to}><Link to={to} onClick={() => setOpen(false)}>{l}</Link></li>)}</ul></section>
          <section><h3>기록</h3><div className="dev-log">{log.length ? log.map((l, i) => <div key={i}>{l}</div>) : '아직 없어요'}</div></section>
        </aside>
      )}
    </>
  );
}
