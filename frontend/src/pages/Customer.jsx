import { useEffect, useState } from "react";
import { api, clock } from "../api.js";
import { usePoll } from "../usePoll.js";
import { TopBar } from "../App.jsx";

const STATUS = {
  pending: "Being packed",
  ready: "Ready for pickup, driver on the way",
  picked_up: "Picked up by your driver",
  cancelled: "Cancelled",
};

export default function Customer({ user, onLogout }) {
  const [menu, setMenu] = useState({ items: [], combos: [] });
  const [cart, setCart] = useState({});
  const [orders, setOrders] = useState([]);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    api("/api/menu").then(setMenu).catch((e) => setError(e.message));
  }, []);
  usePoll(() => api("/api/my-orders").then(setOrders));

  const name = (id) => menu.items.find((i) => i.id === id)?.name ?? id;
  const count = Object.values(cart).reduce((a, b) => a + b, 0);
  const bump = (id, by) =>
    setCart((c) => ({ ...c, [id]: Math.min(20, Math.max(0, (c[id] ?? 0) + by)) }));
  const addCombo = (combo) =>
    Object.entries(combo.items).forEach(([id, qty]) => bump(id, qty));

  async function place() {
    setSending(true);
    setError("");
    try {
      await api("/api/orders", { items: cart });
      setCart({});
      setOrders(await api("/api/my-orders"));
    } catch (e) {
      setError(e.message);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="shell">
      <TopBar user={user} onLogout={onLogout} />
      <main className="two-col">
        <section className="card">
          <h2>Order</h2>
          {menu.combos.map((c) => (
            <button key={c.id} className="combo" onClick={() => addCombo(c)}>
              <strong>Add a {c.name}</strong>
              <span className="muted">{Object.keys(c.items).map(name).join(", ")}</span>
            </button>
          ))}
          <ul className="menu">
            {menu.items.map((item) => (
              <li key={item.id}>
                <span className="menu__name">{item.name}</span>
                <span className="qty">
                  <button aria-label={`One less ${item.name}`} onClick={() => bump(item.id, -1)}>−</button>
                  <output>{cart[item.id] ?? 0}</output>
                  <button aria-label={`One more ${item.name}`} onClick={() => bump(item.id, 1)}>+</button>
                </span>
              </li>
            ))}
          </ul>
          {error && <p className="error">{error}</p>}
          <button className="btn btn--dark btn--full" disabled={!count || sending} onClick={place}>
            {count ? `Place order (${count} ${count === 1 ? "item" : "items"})` : "Add something to order"}
          </button>
        </section>

        <section className="card">
          <h2>Your orders</h2>
          {orders.length === 0 && <p className="muted">Your orders and their status show up here.</p>}
          <div className="stack">
            {orders.map((o) => (
              <article key={o.id} className="slip">
                <header className="slip__head">
                  <span className="slip__num">#{o.id}</span>
                  <span className="muted">{clock(o.placed_at)}</span>
                </header>
                <ul className="slip__items">
                  {Object.entries(o.items).map(([id, qty]) => (
                    <li key={id}><b>{qty}</b> {name(id)}</li>
                  ))}
                </ul>
                <p className={`status status--${o.status}`}>{STATUS[o.status] ?? o.status}</p>
              </article>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
