import { useEffect, useState } from "react";
import { api, clock } from "../api.js";
import { usePoll } from "../usePoll.js";
import { TopBar } from "../App.jsx";
import { iconOf } from "../icons.js";
import FlowField from "../kokonut/FlowField.jsx";

const STEPS = ["Placed", "Packing", "Ready", "Picked up"];
const STEP_OF = { pending: 1, ready: 2, picked_up: 3 };

const STATUS = {
  pending: "Being packed",
  ready: "Ready for pickup, driver on the way",
  picked_up: "Picked up by your driver",
  cancelled: "Cancelled because everything on it sold out",
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
  // Orders and sold-out items both refresh every 3 seconds.
  usePoll(() => Promise.all([api("/api/my-orders"), api("/api/menu")]).then(([o, m]) => {
    setOrders(o);
    setMenu(m);
  }));

  const name = (id) => menu.items.find((i) => i.id === id)?.name ?? id;
  const count = Object.values(cart).reduce((a, b) => a + b, 0);
  const soldOut = new Set(menu.items.filter((i) => i.sold_out).map((i) => i.id));
  const soldInCart = Object.keys(cart).filter((id) => cart[id] && soldOut.has(id));
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
    <div className="shell shell--customer">
      <FlowField className="customer-wind" density={0.7} speed={0.6} />
      <TopBar user={user} onLogout={onLogout} />
      <main className="two-col">
        <section className="card">
          <h2>Order</h2>
          {menu.combos.map((c) => {
            const blocked = Object.keys(c.items).some((id) => soldOut.has(id));
            return (
              <button key={c.id} className="combo" onClick={() => addCombo(c)} disabled={blocked}>
                <span className="combo__icons" aria-hidden>{Object.keys(c.items).map(iconOf).join("")}</span>
                <span>
                  <strong>Add a {c.name}</strong>
                  <span className="muted combo__what">
                    {blocked ? "Unavailable: part of it sold out" : Object.keys(c.items).map(name).join(", ")}
                  </span>
                </span>
              </button>
            );
          })}
          <ul className="menu">
            {menu.items.map((item) => (
              <li key={item.id} className={item.sold_out ? "is-out" : ""}>
                <span className="menu__item">
                  <span className="menu__icon" aria-hidden>{iconOf(item.id)}</span>
                  <span className="menu__name">
                    {item.name} {item.sold_out && <span className="tag-out">Sold out</span>}
                  </span>
                </span>
                <span className="qty">
                  <button aria-label={`One less ${item.name}`} onClick={() => bump(item.id, -1)}>−</button>
                  <output>{cart[item.id] ?? 0}</output>
                  <button aria-label={`One more ${item.name}`} onClick={() => bump(item.id, 1)}
                    disabled={item.sold_out}>+</button>
                </span>
              </li>
            ))}
          </ul>
          {soldInCart.length > 0 && (
            <p className="error">{soldInCart.map(name).join(", ")} just sold out. Remove it to order.</p>
          )}
          {error && <p className="error">{error}</p>}
          <button className="btn btn--dark btn--full" disabled={!count || sending || soldInCart.length > 0} onClick={place}>
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
                    <li key={id}><b>{qty}</b> <span aria-hidden>{iconOf(id)}</span> {name(id)}</li>
                  ))}
                </ul>
                {o.status !== "cancelled" && (
                  <ol className="track" aria-label="Order progress">
                    {STEPS.map((step, i) => (
                      <li key={step} className={i < (STEP_OF[o.status] ?? 0) + 1 ? "track__done" : ""}
                        aria-current={i === (STEP_OF[o.status] ?? 0) ? "step" : undefined}>{step}</li>
                    ))}
                  </ol>
                )}
                <p className={`status status--${o.status}`}>{STATUS[o.status] ?? o.status}</p>
                {o.status === "pending" && o.orders_ahead !== undefined && (
                  <p className="eta">
                    {o.orders_ahead === 0 ? "You're next" :
                      `${o.orders_ahead} ${o.orders_ahead === 1 ? "order" : "orders"} ahead of you`}
                    {", "}about <b>{o.eta_minutes} min</b>
                  </p>
                )}
                {o.sold_out_items?.length > 0 && (
                  <p className="notice">Heads up: {o.sold_out_items.join(", ")} just sold out. The kitchen will adjust your order.</p>
                )}
                {o.notices.map((n, i) => <p key={i} className="notice">{n}</p>)}
              </article>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
