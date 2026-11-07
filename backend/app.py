"""PackRight backend (Flask). Built at NOVA 2026 with help from Claude.

Step 2: database, demo accounts, login, and role checks.
Step 3: menu and customer orders.
Step 4: staff queue and the camera tray check.
"""

import json
import os
import secrets
import sqlite3
from datetime import datetime, timezone
from functools import wraps

from dotenv import load_dotenv
from flask import Flask, g, jsonify, request, session
from werkzeug.security import check_password_hash, generate_password_hash

from vision import AIError, look_at_tray

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
    id              INTEGER PRIMARY KEY,
    customer_id     INTEGER NOT NULL REFERENCES users(id),
    status          TEXT NOT NULL DEFAULT 'pending',  -- pending, ready, picked_up, cancelled
    pickup_code     TEXT NOT NULL,                    -- written on the bag label
    placed_at       TEXT NOT NULL,                    -- UTC, ISO 8601
    ready_at        TEXT,
    picked_up_at    TEXT,
    failed_checks   INTEGER NOT NULL DEFAULT 0,
    override_reason TEXT
);
CREATE TABLE IF NOT EXISTS order_items (
    order_id INTEGER NOT NULL REFERENCES orders(id),
    item     TEXT NOT NULL,
    qty      INTEGER NOT NULL
);
"""

DEMO_ACCOUNTS = ["customer", "staff", "driver"]  # password = username, role = username

with open(os.path.join(BASE, "menu.json"), encoding="utf-8") as f:
    MENU = json.load(f)
ITEMS = {item["id"]: item for item in MENU["items"]}
MAX_QTY = 20


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


def make_pickup_code():
    """4 characters, skipping look-alikes like 0/O and 1/I."""
    return "".join(secrets.choice("ABCDEFGHJKLMNPQRSTUVWXYZ23456789") for _ in range(4))


def items_of(order_id):
    rows = db().execute("SELECT item, qty FROM order_items WHERE order_id = ?", (order_id,))
    return {r["item"]: r["qty"] for r in rows}


def order_json(row, with_code=False):
    data = {
        "id": row["id"],
        "status": row["status"],
        "placed_at": row["placed_at"],
        "ready_at": row["ready_at"],
        "picked_up_at": row["picked_up_at"],
        "items": items_of(row["id"]),
    }
    if with_code:  # only staff see the code that goes on the bag
        data["pickup_code"] = row["pickup_code"]
    return data


# ---------- menu and customer orders ----------

@app.get("/api/menu")
def menu():
    # Proxy descriptions stay on the server; the browser only needs names.
    return jsonify(
        items=[{"id": i["id"], "name": i["name"]} for i in MENU["items"]],
        combos=MENU["combos"],
    )


@app.post("/api/orders")
@role_required("customer")
def place_order():
    wanted = (request.get_json(silent=True) or {}).get("items") or {}
    cart = {}
    for item, qty in wanted.items():
        if item not in ITEMS:
            return fail(f"{item} isn't on the menu.", 400)
        if type(qty) is not int or not 0 <= qty <= MAX_QTY:
            return fail(f"Quantity must be a whole number from 0 to {MAX_QTY}.", 400)
        if qty:
            cart[item] = qty
    if not cart:
        return fail("Your order is empty.", 400)

    conn = db()
    cur = conn.execute(
        "INSERT INTO orders (customer_id, pickup_code, placed_at) VALUES (?, ?, ?)",
        (session["uid"], make_pickup_code(), utc_now()),
    )
    conn.executemany(
        "INSERT INTO order_items (order_id, item, qty) VALUES (?, ?, ?)",
        [(cur.lastrowid, item, qty) for item, qty in cart.items()],
    )
    conn.commit()
    row = conn.execute("SELECT * FROM orders WHERE id = ?", (cur.lastrowid,)).fetchone()
    return jsonify(order_json(row)), 201


@app.get("/api/my-orders")
@role_required("customer")
def my_orders():
    rows = db().execute(
        "SELECT * FROM orders WHERE customer_id = ? ORDER BY id DESC LIMIT 15",
        (session["uid"],),
    ).fetchall()
    return jsonify([order_json(r) for r in rows])


# ---------- staff: queue and tray check ----------

def waiting_orders():
    return db().execute(
        "SELECT * FROM orders WHERE status = 'pending' ORDER BY placed_at, id"
    ).fetchall()


def compare(seen, ticket):
    """What's missing and what's extra, in plain code."""
    missing = {i: ticket.get(i, 0) - seen.get(i, 0) for i in ITEMS if seen.get(i, 0) < ticket.get(i, 0)}
    extra = {i: seen.get(i, 0) - ticket.get(i, 0) for i in ITEMS if seen.get(i, 0) > ticket.get(i, 0)}
    return missing, extra


def best_match(seen, orders):
    """Auto-matching: the waiting order whose ticket is closest to what the
    camera saw. Orders come oldest first, so ties go to the oldest."""
    def distance(order):
        ticket = items_of(order["id"])
        return sum(abs(seen.get(i, 0) - ticket.get(i, 0)) for i in ITEMS)
    return min(orders, key=distance)


@app.get("/api/queue")
@role_required("staff")
def queue():
    ready = db().execute(
        "SELECT * FROM orders WHERE status IN ('ready', 'picked_up') ORDER BY ready_at DESC LIMIT 6"
    ).fetchall()
    return jsonify(
        waiting=[order_json(r, with_code=True) for r in waiting_orders()],
        ready=[order_json(r, with_code=True) for r in ready],
    )


@app.post("/api/check")
@role_required("staff")
def check_tray():
    image = (request.get_json(silent=True) or {}).get("image", "")
    if not image.startswith("data:image/jpeg;base64,"):
        return fail("Expected a JPEG snapshot from the camera.", 400)
    orders = waiting_orders()
    if not orders:
        return fail("No orders are waiting.", 409)

    try:
        seen, note = look_at_tray(image, MENU["items"])  # image used once, never saved
    except AIError as e:
        return fail(str(e), e.code)  # AI trouble doesn't count against the order

    order = best_match(seen, orders)
    ticket = items_of(order["id"])
    missing, extra = compare(seen, ticket)
    conn = db()
    if not missing and not extra:
        result, ready_at = "green", utc_now()
        conn.execute("UPDATE orders SET status = 'ready', ready_at = ? WHERE id = ?",
                     (ready_at, order["id"]))
    else:
        result, ready_at = "red", None
        conn.execute("UPDATE orders SET failed_checks = failed_checks + 1 WHERE id = ?",
                     (order["id"],))
    conn.commit()
    failed = conn.execute("SELECT failed_checks FROM orders WHERE id = ?",
                          (order["id"],)).fetchone()[0]
    return jsonify(result=result, order_id=order["id"], ticket=ticket, seen=seen,
                   missing=missing, extra=extra, note=note, failed_checks=failed,
                   ready_at=ready_at)


if __name__ == "__main__":
    setup_database()
    print("PackRight database ready. Demo accounts: customer, staff, driver")
    app.run(port=5000, debug=True)
