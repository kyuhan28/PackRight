import { useEffect, useState } from "react";
import { api } from "./api.js";
import Login from "./pages/Login.jsx";
import Customer from "./pages/Customer.jsx";
import Staff from "./pages/Staff.jsx";
import Driver from "./pages/Driver.jsx";

// After login, each role sees only its own page.
export default function App() {
  const [user, setUser] = useState(undefined); // undefined while checking

  useEffect(() => {
    api("/api/me").then(setUser).catch(() => setUser(null));
  }, []);

  const logout = () => api("/api/logout", {}).finally(() => setUser(null));

  if (user === undefined) return null;
  if (user === null) return <Login onLogin={setUser} />;
  if (user.role === "customer") return <Customer user={user} onLogout={logout} />;
  if (user.role === "staff") return <Staff user={user} onLogout={logout} />;
  if (user.role === "driver") return <Driver user={user} onLogout={logout} />;
  return (
    <div className="shell">
      <TopBar user={user} onLogout={logout} />
      <main className="placeholder">The {user.role} page arrives in the next step.</main>
    </div>
  );
}

export function Mark({ size = 28 }) {
  return (
    <svg className="mark" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect x="3" y="7" width="26" height="22" rx="4" fill="var(--ink)" />
      <path d="M9 7l3-4h8l3 4" fill="none" stroke="var(--ink)" strokeWidth="2.4" strokeLinejoin="round" />
      <path d="M10.5 18.5l4 4 7.5-8.5" fill="none" stroke="var(--go-bright)" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function TopBar({ user, title, onLogout }) {
  return (
    <header className="topbar">
      <span className="brand"><Mark /> PackRight</span>
      {title && <span className="topbar__title">{title}</span>}
      <span className="topbar__user">
        <span className="topbar__who">{user.username}</span>
        <button className="btn btn--ghost btn--small" onClick={onLogout}>Log out</button>
      </span>
    </header>
  );
}
