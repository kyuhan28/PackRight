"""PackRight backend (Flask). Built at NOVA 2026 with help from Claude.

Step 2: database, demo accounts, login, and role checks.
"""

import os
import sqlite3
from datetime import datetime, timezone
from functools import wraps

from dotenv import load_dotenv
from flask import Flask, g, jsonify, request, session
from werkzeug.security import check_password_hash, generate_password_hash

BASE = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(BASE, ".env"))
DB_FILE = os.path.join(BASE, "packright.db")

app = Flask(__name__)
app.secret_key = os.environ.get("FLASK_SECRET_KEY")
if not app.secret_key:
    raise SystemExit("Add FLASK_SECRET_KEY to backend/.env")
app.config.update(SESSION_COOKIE_SAMESITE="Lax", MAX_CONTENT_LENGTH=8 * 1024 * 1024)

TABLES = """
CREATE TABLE IF NOT EXISTS users (
    id       INTEGER PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    pw_hash  TEXT NOT NULL,
    role     TEXT NOT NULL            -- customer, staff, or driver
);
CREATE TABLE IF NOT EXISTS orders (
    id            INTEGER PRIMARY KEY,
    customer_id   INTEGER NOT NULL REFERENCES users(id),
    status        TEXT NOT NULL DEFAULT 'pending',   -- pending, ready
    placed_at     TEXT NOT NULL,                     -- UTC, ISO 8601
    ready_at      TEXT,
    failed_checks INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS order_items (
    order_id INTEGER NOT NULL REFERENCES orders(id),
    item     TEXT NOT NULL,
    qty      INTEGER NOT NULL
);
"""

DEMO_ACCOUNTS = ["customer", "staff", "driver"]  # password = username, role = username


def utc_now():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def db():
    """One database connection per request, closed automatically."""
    if "db" not in g:
        g.db = sqlite3.connect(DB_FILE)
        g.db.row_factory = sqlite3.Row
    return g.db


@app.teardown_appcontext
def close_db(_exc):
    conn = g.pop("db", None)
    if conn:
        conn.close()


def setup_database():
    conn = sqlite3.connect(DB_FILE)
    conn.executescript(TABLES)
    for name in DEMO_ACCOUNTS:
        conn.execute(
            "INSERT OR IGNORE INTO users (username, pw_hash, role) VALUES (?, ?, ?)",
            (name, generate_password_hash(name), name),
        )
    conn.commit()
    conn.close()


def fail(message, code):
    return jsonify(error=message), code


def role_required(role):
    """Only let logged-in users with this role through."""
    def wrap(view):
        @wraps(view)
        def inner(*args, **kwargs):
            if "uid" not in session:
                return fail("Please log in.", 401)
            if session["role"] != role:
                return fail(f"Only {role} accounts can do that.", 403)
            return view(*args, **kwargs)
        return inner
    return wrap


# ---------- login ----------

@app.post("/api/login")
def login():
    body = request.get_json(silent=True) or {}
    user = db().execute(
        "SELECT * FROM users WHERE username = ?", (body.get("username", ""),)
    ).fetchone()
    if user is None or not check_password_hash(user["pw_hash"], body.get("password", "")):
        return fail("Wrong username or password.", 401)
    session.clear()
    session.update(uid=user["id"], username=user["username"], role=user["role"])
    return jsonify(username=user["username"], role=user["role"])


@app.post("/api/logout")
def logout():
    session.clear()
    return jsonify(ok=True)


@app.get("/api/me")
def me():
    if "uid" not in session:
        return fail("Not logged in.", 401)
    return jsonify(username=session["username"], role=session["role"])


# Placeholder so we can test role checks now; Step 4 fills it in.
@app.get("/api/queue")
@role_required("staff")
def queue():
    return jsonify(pending=[], ready=[])


if __name__ == "__main__":
    setup_database()
    print("PackRight database ready. Demo accounts: customer, staff, driver")
    app.run(port=5000, debug=True)
