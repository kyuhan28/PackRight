import { useEffect, useState } from "react";
import { api } from "./api.js";
import Login from "./pages/Login.jsx";
import Customer from "./pages/Customer.jsx";
import Staff from "./pages/Staff.jsx";

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
  return (
    <div className="shell">
      <TopBar user={user} onLogout={logout} />
      <main className="placeholder">The {user.role} page arrives in the next step.</main>
    </div>
  );
}

export function TopBar({ user, title, onLogout }) {
  return (
    <header className="topbar">
      <span className="brand">PackRight</span>
      {title && <span className="topbar__title">{title}</span>}
      <span className="topbar__user">
        {user.username}
        <button className="link" onClick={onLogout}>Log out</button>
      </span>
    </header>
  );
}
