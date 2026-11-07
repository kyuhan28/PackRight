import { useEffect, useRef, useState } from "react";
import { api, clock } from "../api.js";
import { usePoll } from "../usePoll.js";
import { TopBar } from "../App.jsx";
import Camera from "../Camera.jsx";
import AccuracyTest from "../AccuracyTest.jsx";
import { buzz, chime, say } from "../sounds.js";
import { iconOf } from "../icons.js";
import Stats from "../Stats.jsx";

const GREEN_SECONDS = 3; // green clears itself so the next order can start

// Kitchen-display ticket aging: amber after 3 minutes waiting, red after 6.
const AMBER_MIN = 3, RED_MIN = 6;
const minutesWaiting = (iso) => Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
const ageClass = (m) => (m >= RED_MIN ? " slip--late" : m >= AMBER_MIN ? " slip--aging" : "");

export default function Staff({ user, onLogout }) {
  const cam = useRef(null);
  const [menu, setMenu] = useState([]);
  const [queue, setQueue] = useState({ waiting: [], ready: [] });
  const [requests, setRequests] = useState([]);
  const [stats, setStats] = useState(null);
  const [printing, setPrinting] = useState(null); // the order whose slip is printing
  const [reason, setReason] = useState("");
  const [testing, setTesting] = useState(false); // accuracy test mode
  const [sound, setSound] = useState(true);
  // Kitchen screens often run dark to cut glare; start from the system setting.
  const [dark, setDark] = useState(() => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false);
  const tester = useRef(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const refresh = () =>
    Promise.all([api("/api/queue"), api("/api/station-requests"), api("/api/menu"), api("/api/stats")])
      .then(([q, r, m, st]) => {
        setQueue(q);
        setRequests(r);
        setMenu(m.items);
        setStats(st);
      });
  usePoll(refresh);

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
      const r = await api("/api/check", { image });
      setResult(r);
      setReason("");
      if (sound) {
        if (r.result === "green") { chime(); say(`Order ${r.order_id} ready.`); }
        else if (r.result === "cancelled") { buzz(); say(`Order ${r.order_id} cancelled. Everything on it sold out.`); }
        else {
          buzz();
          const what = Object.keys(r.missing).length ? `missing ${list(r.missing)}` : `remove ${list(r.extra)}`;
          say(`Order ${r.order_id}, ${what}.`);
        }
      }
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  // Space runs a check (or a test), except while typing in a text box.
  const waitingRef = useRef(false);
  const latest = useRef(null);
  latest.current = () => (testing ? tester.current?.run() : waitingRef.current && check());
  useEffect(() => {
    const typing = (el) => el?.tagName === "TEXTAREA" || el?.tagName === "SELECT" ||
      (el?.tagName === "INPUT" && !["checkbox", "radio"].includes(el.type));
    const down = (e) => {
      if (e.code !== "Space" || e.repeat || typing(document.activeElement)) return;
      e.preventDefault();
      document.activeElement?.blur(); // a focused button would also "click"
      latest.current();
    };
    const up = (e) => { if (e.code === "Space" && !typing(document.activeElement)) e.preventDefault(); };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, []);

  // Print one slip: render it, open the print dialog, then clear it.
  useEffect(() => {
    if (!printing) return undefined;
    const done = () => setPrinting(null);
    window.addEventListener("afterprint", done, { once: true });
    const t = setTimeout(() => window.print(), 60);
    return () => { clearTimeout(t); window.removeEventListener("afterprint", done); };
  }, [printing]);

  async function resetDemo() {
    if (!window.confirm("Clear every order, check and sold-out mark so the demo starts again at #1? Accounts and accuracy test results stay.")) return;
    try {
      await api("/api/demo/reset", {});
      setResult(null);
      await refresh();
    } catch (e) {
      setError(e.message);
    }
  }

  async function override() {
    try {
      await api(`/api/orders/${result.order_id}/override`, { reason });
      setResult(null);
      await refresh();
    } catch (e) {
      setError(e.message);
    }
  }

  async function toggleSoldOut(item) {
    await api(`/api/menu/${item.id}/sold-out`, { sold_out: !item.sold_out }).catch((e) => setError(e.message));
    await refresh();
  }

  async function stationDone(id) {
    await api(`/api/station-requests/${id}/done`, {}).catch((e) => setError(e.message));
    await refresh();
  }

  const who = (r) =>
    r.decided_by === "agent" ? "Decided by the AI agent"
      : r.decided_by === "agent+rules" ? "AI agent, with standard rules filling gaps"
      : "Standard rules";

  const red = result?.result === "red" ? result : null;
  const cancelled = result?.result === "cancelled" ? result : null;
  const green = result?.result === "green" ? result : null;
  const waiting = queue.waiting.length > 0;
  waitingRef.current = waiting && !busy;

  return (
    <div className={`shell${dark ? " theme-dark" : ""}`}>
      <TopBar user={user} title="Packing station" onLogout={onLogout} />
      {!testing && <Stats stats={stats} />}
      <main className="station">
        <section className={`stage${red ? " stage--red" : ""}`}>
          <div className="stage__view">
            <Camera ref={cam} />
            {green && (
              <div className="flash" role="status">
                <span className="flash__stamp" aria-hidden>Ready</span>
                <p className="flash__big">✓ Order #{green.order_id} ready</p>
                <p>{green.matched_by === "slip" ? "Matched by the order slip." : "Matched by its items."}</p>
                <p>Driver notified at {clock(green.ready_at)}. {who(green)}.</p>
              </div>
            )}
          </div>
          {!testing && <button className="btn btn--check" onClick={check} disabled={busy || !waiting}>
            {busy ? "Checking tray…" : !waiting ? "No orders waiting" : red ? "Check again" : "Check tray"}
          </button>}
          {busy && <div className="progress"><span /></div>}
          {error && <p className="error">{error}</p>}
          <div className="toggles">
            <label><input type="checkbox" checked={sound} onChange={(e) => setSound(e.target.checked)} /> Sound and voice</label>
            <label><input type="checkbox" checked={dark} onChange={(e) => setDark(e.target.checked)} /> Dark screen</label>
            <label><input type="checkbox" checked={testing} onChange={(e) => { setTesting(e.target.checked); setResult(null); }} /> Accuracy test mode</label>
            <button className="link reset-demo" onClick={resetDemo}>Reset demo</button>
            <span className="muted">Press Space to {testing ? "test" : "check"}</span>
          </div>
        </section>

        <aside className="rail">
          {testing ? (
            <AccuracyTest ref={tester} menu={menu} snapshot={() => cam.current?.snapshot()} />
          ) : (<>
          {cancelled && (
            <div className="popup popup--amber" role="alert">
              <button className="popup__x" aria-label="Dismiss" onClick={() => setResult(null)}>×</button>
              <p className="popup__big">▲ Order #{cancelled.order_id} cancelled</p>
              {cancelled.tips.map((t) => <p key={t} className="popup__tip">{t}</p>)}
              <ul className="popup__actions">{cancelled.actions.map((a) => <li key={a.text}>{a.text}</li>)}</ul>
              <p className="popup__small">{who(cancelled)}. Clear the tray for the next order.</p>
            </div>
          )}
          {red && (
            <div className="popup" role="alert">
              <button className="popup__x" aria-label="Dismiss" onClick={() => setResult(null)}>×</button>
              <p className="popup__small">
                Order #{red.order_id}, {red.matched_by === "slip" ? "matched by its order slip" : "closest match by items"}
              </p>
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
              {red.tips.map((t) => <p key={t} className="popup__tip">{t}</p>)}
              {red.actions.length > 0 && (
                <ul className="popup__actions">
                  {red.actions.map((a) => <li key={a.text}>{a.text}</li>)}
                </ul>
              )}
              {red.note && <p className="popup__small">AI saw: {red.note}</p>}
              <p className="popup__small">{who(red)}. Failed checks: {red.failed_checks}</p>
              {red.agent_problem && <p className="popup__small">{red.agent_problem}</p>}
              {red.can_override && (
                <div className="override">
                  <label>
                    Still wrong after {red.failed_checks} checks? Mark it ready with a reason:
                    <input value={reason} onChange={(e) => setReason(e.target.value)}
                      placeholder="The bottle was hidden behind the box" />
                  </label>
                  <button className="btn btn--light" disabled={reason.trim().length < 3} onClick={override}>
                    Override and mark ready
                  </button>
                </div>
              )}
            </div>
          )}

          <h2>Waiting to pack <span className="count">{queue.waiting.length}</span></h2>
          {!waiting && <p className="muted">New orders show up here.</p>}
          <div className="stack">
            {queue.waiting.map((o) => {
              const waited = minutesWaiting(o.placed_at);
              return (
              <article key={o.id} className={`slip${red?.order_id === o.id ? " slip--active" : ""}${ageClass(waited)}`}>
                <header className="slip__head">
                  <span className="slip__num">#{o.id}</span>
                  <span className="slip__age">
                    {waited < 1 ? "just now" : `${waited} min`}{waited >= RED_MIN && <b className="late"> late</b>}
                  </span>
                </header>
                <ul className="slip__items">
                  {Object.entries(o.items).map(([id, n]) => {
                    const out = menu.find((m) => m.id === id)?.sold_out;
                    return <li key={id} className={out ? "is-crossed" : ""}><b>{n}</b> <span aria-hidden>{iconOf(id)}</span> {name(id)}{out && " (sold out)"}</li>;
                  })}
                </ul>
                <p className="slip__label">
                  Bag label: <strong>#{o.id} {o.pickup_code}</strong>
                  <button className="btn btn--small slip__print" onClick={() => setPrinting(o)}>Print slip</button>
                </p>
              </article>
              );
            })}
          </div>

          <h2>Menu availability</h2>
          <ul className="avail">
            {menu.map((m) => (
              <li key={m.id}>
                <span className="avail__item"><span aria-hidden>{iconOf(m.id)}</span> {m.name}</span>
                <button className={`btn btn--small ${m.sold_out ? "btn--out" : "btn--in"}`}
                  aria-pressed={!!m.sold_out} onClick={() => toggleSoldOut(m)}>
                  {m.sold_out ? "Sold out, tap to restock" : "Available, tap if sold out"}
                </button>
              </li>
            ))}
          </ul>

          <h2>Station requests</h2>
          {requests.length === 0 && <p className="muted">Missing items get sent to the right station here.</p>}
          <ul className="requests">
            {requests.map((r) => (
              <li key={r.id}>
                <span>
                  <strong>{r.station}</strong>: {r.qty} {r.item} for #{r.order_id}
                  <small className="muted">{r.sent_by === "agent" ? "Sent by the AI agent" : "Sent by standard rules"}</small>
                </span>
                <button className="btn btn--small" onClick={() => stationDone(r.id)}>Done</button>
              </li>
            ))}
          </ul>

          <h2>Driver updates</h2>
          {queue.ready.length === 0 && <p className="muted">Drivers are notified here when an order passes.</p>}
          <ul className="notices">
            {queue.ready.map((o) => (
              <li key={o.id} className={o.status === "picked_up" ? "is-picked" : ""}>
                {o.status === "picked_up"
                  ? `Order #${o.id} picked up, right bag confirmed`
                  : `Driver notified: order #${o.id} ready`}
                <span className="muted">{clock(o.status === "picked_up" ? o.picked_up_at : o.ready_at)}</span>
              </li>
            ))}
          </ul>
          </>)}
        </aside>
      </main>
      {printing && (
        <div className="print-slip" aria-hidden>
          <p className="print-slip__brand">PackRight</p>
          <p className="print-slip__num">#{printing.id}</p>
          <p className="print-slip__code">Bag code <b>{printing.pickup_code}</b></p>
          <ul className="print-slip__items">
            {Object.entries(printing.items).map(([id, n]) => <li key={id}>{n} × {name(id)}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}
