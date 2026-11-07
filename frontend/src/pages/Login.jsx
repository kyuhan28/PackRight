import { useState } from "react";
import { api } from "../api.js";

export default function Login({ onLogin }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  async function submit(e) {
    e.preventDefault();
    setError("");
    try {
      onLogin(await api("/api/login", { username, password }));
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <main className="login">
      <form className="card login__card" onSubmit={submit}>
        <h1 className="brand brand--big">PackRight</h1>
        <p className="muted">Every order, packed right.</p>
        <label>
          Username
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
        </label>
        <label>
          Password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && <p className="error">{error}</p>}
        <button className="btn btn--dark">Sign in</button>
      </form>
    </main>
  );
}
