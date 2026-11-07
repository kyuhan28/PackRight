import { useRef, useState } from "react";
import { api, clock } from "../api.js";
import { usePoll } from "../usePoll.js";
import { TopBar } from "../App.jsx";
import { iconOf } from "../icons.js";

// Four big boxes, one character each, sized for a phone in one hand.
// Typing moves forward, Backspace moves back, and pasting fills all four.
function CodeBoxes({ value, onChange, label }) {
  const boxes = [useRef(null), useRef(null), useRef(null), useRef(null)];
  const chars = value.padEnd(4, " ").slice(0, 4).split("");

  function typed(i, e) {
    const text = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (text.length > 1) {               // pasted a whole code
      onChange(text.slice(0, 4));
      boxes[Math.min(text.length, 4) - 1].current?.focus();
      return;
    }
    const next = chars.slice();
    next[i] = text || " ";
    onChange(next.join("").trimEnd());
    if (text && i < 3) boxes[i + 1].current?.focus();
  }

  function key(i, e) {
    if (e.key === "Backspace" && chars[i] === " " && i > 0) boxes[i - 1].current?.focus();
  }

  return (
    <fieldset className="codeboxes">
      <legend>{label}</legend>
      {chars.map((c, i) => (
        <input key={i} ref={boxes[i]} value={c.trim()} maxLength={4} autoComplete="off"
          autoCapitalize="characters" aria-label={`Character ${i + 1}`}
          onChange={(e) => typed(i, e)} onKeyDown={(e) => key(i, e)} />
      ))}
    </fieldset>
  );
}

function PickupCard({ order, names, onDone }) {
  const [code, setCode] = useState("");
  const [checked, setChecked] = useState({}); // item id -> ticked
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const items = Object.entries(order.items);
  const allChecked = items.every(([id]) => checked[id]);
  const full = code.replace(/ /g, "").length === 4;
  const tick = (id) => setChecked((c) => ({ ...c, [id]: !c[id] }));

  async function confirm() {
    setBusy(true);
    try {
      const r = await api("/api/driver/pickup", {
        order_id: order.id, code, checked: items.map(([id]) => id).filter((id) => checked[id]),
      });
      setResult(r);
      if (r.ok) setTimeout(onDone, 2000);
    } catch (e) {
      setResult({ ok: false, message: e.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className={`card pickup${result ? (result.ok ? " pickup--ok" : " pickup--bad") : ""}`}>
      <header className="slip__head">
        <span className="slip__num">#{order.id}</span>
        <span className="muted">Ready {clock(order.ready_at)}</span>
      </header>
      <fieldset className="checklist">
        <legend>1. Look in the bag and tick each item</legend>
        {items.map(([id, n]) => (
          <label key={id} className={checked[id] ? "is-ticked" : ""}>
            <input type="checkbox" checked={!!checked[id]} onChange={() => tick(id)} />
            <span aria-hidden>{iconOf(id)}</span> {n} {names[id] ?? id}
          </label>
        ))}
      </fieldset>
      <CodeBoxes value={code} onChange={setCode} label="2. Type the confirmation code on the bag" />
      <button className="btn btn--dark btn--full" disabled={busy || !full || !allChecked} onClick={confirm}>
        {!allChecked ? "Tick every item first" : !full ? "Enter the 4-character code" : "Confirm pickup"}
      </button>
      {result && <p className="pickup__result">{result.ok ? "✓" : "✕"} {result.message}</p>}
    </article>
  );
}

export default function Driver({ user, onLogout }) {
  const [orders, setOrders] = useState([]);
  const [names, setNames] = useState({});
  const load = () =>
    Promise.all([api("/api/driver/orders"), api("/api/menu")]).then(([o, m]) => {
      setOrders(o);
      setNames(Object.fromEntries(m.items.map((i) => [i.id, i.name])));
    });
  usePoll(load);

  return (
    <div className="shell">
      <TopBar user={user} title="Driver pickup" onLogout={onLogout} />
      <main className="driver">
        <h2>Ready for pickup</h2>
        {orders.length === 0 && <p className="muted">Orders show up here as soon as they pass their tray check.</p>}
        <div className="driver__grid">
          {orders.map((o) => <PickupCard key={o.id} order={o} names={names} onDone={load} />)}
        </div>
      </main>
    </div>
  );
}
