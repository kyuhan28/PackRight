import { useEffect, useState } from "react";
import { api } from "./api.js";
import { usePoll } from "./usePoll.js";
import { Mark } from "./App.jsx";

// The screen above the pickup counter: order numbers only, big enough to read from the door.
export default function PickupBoard() {
  const [board, setBoard] = useState({ packing: [], ready: [] });
  const [offline, setOffline] = useState(false);
  const [now, setNow] = useState(() => new Date());
  usePoll(() => api("/api/board").then((b) => { setBoard(b); setOffline(false); }).catch(() => setOffline(true)), 2500);
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 15000);
    return () => clearInterval(t);
  }, []);

  return (
    <main className="board">
      <header className="board__top">
        <span className="brand board__brand"><Mark size={40} /> PackRight</span>
        <span className="board__clock">{now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
      </header>
      <div className="board__cols">
        <section className="board__col">
          <h2 className="board__head">Being packed</h2>
          <ul className="board__nums">
            {board.packing.map((id) => <li key={id} className="board__num">{id}</li>)}
          </ul>
          {board.packing.length === 0 && <p className="board__empty">Nothing in the kitchen right now</p>}
        </section>
        <section className="board__col board__col--ready">
          <h2 className="board__head">Ready for pickup</h2>
          <ul className="board__nums" aria-live="polite">
            {board.ready.map((id) => <li key={id} className="board__num board__num--ready">{id}</li>)}
          </ul>
          {board.ready.length === 0 && <p className="board__empty">Ready orders appear here</p>}
        </section>
      </div>
      {offline && <p className="board__offline">Reconnecting…</p>}
    </main>
  );
}
