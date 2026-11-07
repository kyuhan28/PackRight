import { useEffect, useRef, useState } from "react";
import { api, clock } from "../api.js";
import { usePoll } from "../usePoll.js";
import { TopBar } from "../App.jsx";
import Camera from "../Camera.jsx";

const GREEN_SECONDS = 3; // green clears itself so the next order can start

export default function Staff({ user, onLogout }) {
  const cam = useRef(null);
  const [menu, setMenu] = useState([]);
  const [queue, setQueue] = useState({ waiting: [], ready: [] });
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api("/api/menu").then((m) => setMenu(m.items)).catch((e) => setError(e.message));
  }, []);
  usePoll(() => api("/api/queue").then(setQueue));

  useEffect(() => {
    if (result?.result !== "green") return;
    const t = setTimeout(() => setResult(null), GREEN_SECONDS * 1000);
    return () => clearTimeout(t);
  }, [result]);

  const name = (id) => menu.find((m) => m.id === id)?.name ?? id;
  const list = (counts) => Object.entries(counts).map(([id, n]) => `${n} ${name(id)}`).join(", ");

  async function check() {
    const image = cam.current?.snapshot();
    if (!image) return setError("The camera isn't ready yet.");
    setBusy(true);
    setError("");
    try {
      setResult(await api("/api/check", { image }));
      setQueue(await api("/api/queue"));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const red = result?.result === "red" ? result : null;
  const green = result?.result === "green" ? result : null;
  const waiting = queue.waiting.length > 0;

  return (
    <div className="shell">
      <TopBar user={user} title="Packing station" onLogout={onLogout} />
      <main className="station">
        <section className={`stage${red ? " stage--red" : ""}`}>
          <div className="stage__view">
            <Camera ref={cam} />
            {green && (
              <div className="flash" role="status">
                <span className="flash__stamp" aria-hidden>Ready</span>
                <p className="flash__big">✓ Order #{green.order_id} ready</p>
                <p>Driver notified at {clock(green.ready_at)}</p>
              </div>
            )}
          </div>
          <button className="btn btn--check" onClick={check} disabled={busy || !waiting}>
            {busy ? "Checking tray…" : !waiting ? "No orders waiting" : red ? "Check again" : "Check tray"}
          </button>
          {busy && <div className="progress"><span /></div>}
          {error && <p className="error">{error}</p>}
        </section>

        <aside className="rail">
          {red && (
            <div className="popup" role="alert">
              <button className="popup__x" aria-label="Dismiss" onClick={() => setResult(null)}>×</button>
              <p className="popup__small">Order #{red.order_id}</p>
              <p className="popup__big">
                ✕ {Object.keys(red.missing).length ? `Missing ${list(red.missing)}` : `Remove ${list(red.extra)}`}
              </p>
              <table className="compare">
                <thead><tr><th>Item</th><th>Ticket</th><th>On tray</th></tr></thead>
                <tbody>
                  {menu.filter((m) => red.ticket[m.id] || red.seen[m.id]).map((m) => {
                    const want = red.ticket[m.id] ?? 0, got = red.seen[m.id] ?? 0;
                    return (
                      <tr key={m.id} className={want === got ? "" : "compare__off"}>
                        <td>{m.name}</td><td>{want}</td><td>{got}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {red.note && <p className="popup__small">AI saw: {red.note}</p>}
              <p className="popup__small">Fix the tray, then check again. Failed checks: {red.failed_checks}</p>
            </div>
          )}

          <h2>Waiting to pack</h2>
          {!waiting && <p className="muted">New orders show up here.</p>}
          <div className="stack">
            {queue.waiting.map((o) => (
              <article key={o.id} className={`slip${red?.order_id === o.id ? " slip--active" : ""}`}>
                <header className="slip__head">
                  <span className="slip__num">#{o.id}</span>
                  <span className="muted">{clock(o.placed_at)}</span>
                </header>
                <ul className="slip__items">
                  {Object.entries(o.items).map(([id, n]) => <li key={id}><b>{n}</b> {name(id)}</li>)}
                </ul>
                <p className="slip__label">Bag label: <strong>#{o.id} {o.pickup_code}</strong></p>
              </article>
            ))}
          </div>

          <h2>Driver updates</h2>
          {queue.ready.length === 0 && <p className="muted">Drivers are notified here when an order passes.</p>}
          <ul className="notices">
            {queue.ready.map((o) => (
              <li key={o.id}>
                Driver notified: order #{o.id} ready
                <span className="muted">{clock(o.ready_at)}</span>
              </li>
            ))}
          </ul>
        </aside>
      </main>
    </div>
  );
}
