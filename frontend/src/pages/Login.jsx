import { useState } from "react";
import { api } from "../api.js";
import DotField from "../kokonut/DotField.jsx";
import { Mark } from "../App.jsx";

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
    <DotField className="login-dots" spacing={18}>
      <main className="login">
        <form className="card login__card" onSubmit={submit}>
          <div className="login__brand">
            <Mark size={44} />
            <h1 className="brand brand--big">PackRight</h1>
          </div>
          <p className="login__tag">Every order, packed right.</p>
          <label>
            Username
            <input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus autoComplete="username" />
          </label>
          <label>
            Password
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          </label>
          {error && <p className="error">{error}</p>}
          <button className="btn btn--dark btn--big">Sign in</button>
          <p className="login__demo">Demo accounts: <b>customer</b> and <b>staff</b> (the password is the same as the name)</p>
        </form>
      </main>
    </DotField>
  );
}
