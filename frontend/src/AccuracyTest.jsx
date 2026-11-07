import { forwardRef, useImperativeHandle, useState } from "react";
import { api } from "./api.js";
import { usePoll } from "./usePoll.js";
import { iconOf } from "./icons.js";

// Accuracy test mode: tell the app what's really on the tray, and it compares
// that with what the AI counts. Uses one AI call per test and changes no orders.
const pct = (n) => (n === null || n === undefined ? "No data" : `${n}%`);

export default forwardRef(function AccuracyTest({ menu, snapshot }, ref) {
  const [truth, setTruth] = useState({});
  const [last, setLast] = useState(null);
  const [summary, setSummary] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  usePoll(() => api("/api/eval/summary").then(setSummary), 5000);

  const bump = (id, by) => setTruth((t) => ({ ...t, [id]: Math.max(0, (t[id] ?? 0) + by) }));

  async function run() {
    if (busy) return;
    const image = snapshot();
    if (!image) return setError("The camera isn't ready yet.");
    setBusy(true);
    setError("");
    try {
      setLast(await api("/api/eval", { image, truth }));
      setSummary(await api("/api/eval/summary"));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    await api("/api/eval/reset", {});
    setLast(null);
    setSummary(await api("/api/eval/summary"));
  }

  useImperativeHandle(ref, () => ({ run }));

  return (
    <div className="evalbox">
      <h2>Accuracy test</h2>
      <p className="muted">Set what's really on the tray, then test. No orders change.</p>
      <ul className="menu menu--compact">
        {menu.map((m) => (
          <li key={m.id}>
            <span className="menu__item">
              <span className="menu__icon menu__icon--small" aria-hidden>{iconOf(m.id)}</span>
              <span className="menu__name">{m.name}</span>
            </span>
            <span className="qty">
              <button aria-label={`One less ${m.name}`} onClick={() => bump(m.id, -1)}>−</button>
              <output>{truth[m.id] ?? 0}</output>
              <button aria-label={`One more ${m.name}`} onClick={() => bump(m.id, 1)}>+</button>
            </span>
          </li>
        ))}
      </ul>
      <button className="btn btn--dark btn--full" onClick={run} disabled={busy}>
        {busy ? "Testing…" : "Test this tray"}
      </button>
      {error && <p className="error">{error}</p>}

      {last && (
        <p className={`evalbox__last ${last.exact ? "is-right" : "is-wrong"}`}>
          {last.exact ? "✓ AI got every count right" : "✕ AI counts were off"} ({last.seconds}s)
          {!last.exact && (
            <span className="muted"> AI saw: {menu.filter((m) => last.seen[m.id])
              .map((m) => `${last.seen[m.id]} ${m.name}`).join(", ") || "nothing"}</span>
          )}
        </p>
      )}

      {summary && summary.runs > 0 && (
        <>
          <div className="scores">
            <div><b>{pct(summary.tray_accuracy)}</b><span>Trays fully right</span></div>
            <div><b>{pct(summary.precision)}</b><span>Precision</span></div>
            <div><b>{pct(summary.recall)}</b><span>Recall</span></div>
            <div><b>{summary.avg_seconds}s</b><span>Avg time</span></div>
          </div>
          <p className="muted">
            {summary.runs} tests. {summary.phantom_items} phantom item(s): things the AI saw that
            weren't there, which could cause a false green.
          </p>
          <table className="evaltable">
            <thead><tr><th>Item</th><th>Precision</th><th>Recall</th></tr></thead>
            <tbody>
              {summary.items.map((i) => (
                <tr key={i.id}><td>{i.name}</td><td>{pct(i.precision)}</td><td>{pct(i.recall)}</td></tr>
              ))}
            </tbody>
          </table>
          <button className="link" onClick={reset}>Clear test results</button>
        </>
      )}
    </div>
  );
});
