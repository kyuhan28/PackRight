"""PackRight backend (Flask). Built at NOVA 2026 with help from Claude.

Step 2: database, demo accounts, login, and role checks.
Step 3: menu and customer orders.
Step 4: staff queue and the camera tray check.
Step 5: tool-calling agent, station requests, and the 3-strike override.
Step 6: accuracy test mode (precision, recall, tray accuracy, latency).
Step 7: sold-out items, handled by the agent with code-checked limits.
Step 8: impact dashboard.
Step 9: order slip reading and the driver handoff check.
Step 10: customer queue position and ETA.
"""

import json
import os
import secrets
import sqlite3
import time
from datetime import datetime, timezone
from functools import wraps

from dotenv import load_dotenv
from flask import Flask, g, jsonify, request, session
from werkzeug.security import check_password_hash, generate_password_hash

import agent
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
CREATE TABLE IF NOT EXISTS checks (            -- one row per tray check; no images
    id         INTEGER PRIMARY KEY,
    order_id   INTEGER NOT NULL REFERENCES orders(id),
    result     TEXT NOT NULL,                  -- green, red, override
    seen       TEXT,                           -- what the AI counted (JSON)
    decided_by TEXT,                           -- agent, agent+rules, rules, staff
    note       TEXT,
    at         TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sold_out (          -- items the kitchen has run out of
    item TEXT PRIMARY KEY,
    at   TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS notices (           -- messages shown to the customer
    id       INTEGER PRIMARY KEY,
    order_id INTEGER NOT NULL REFERENCES orders(id),
    message  TEXT NOT NULL,
    sent_by  TEXT NOT NULL,                    -- agent or rules
    at       TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS handoffs (          -- every driver pickup attempt
    id       INTEGER PRIMARY KEY,
    order_id INTEGER NOT NULL REFERENCES orders(id),
    code     TEXT NOT NULL,                    -- what the driver typed
    ok       INTEGER NOT NULL,
    at       TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS eval_runs (         -- accuracy test: truth vs. what the AI saw
    id      INTEGER PRIMARY KEY,
    truth   TEXT NOT NULL,                     -- JSON counts typed in by staff
    seen    TEXT NOT NULL,                     -- JSON counts from the AI
    seconds REAL NOT NULL,
    at      TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS station_requests (
    id       INTEGER PRIMARY KEY,
    order_id INTEGER NOT NULL REFERENCES orders(id),
    station  TEXT NOT NULL,
    item     TEXT NOT NULL,
    qty      INTEGER NOT NULL,
    sent_by  TEXT NOT NULL,                    -- agent or rules
    done     INTEGER NOT NULL DEFAULT 0,
    at       TEXT NOT NULL
);
"""

DEMO_ACCOUNTS = ["customer", "staff", "driver"]  # password = username, role = username

with open(os.path.join(BASE, "menu.json"), encoding="utf-8") as f:
    MENU = json.load(f)
ITEMS = {item["id"]: item for item in MENU["items"]}
MAX_QTY = 20
OVERRIDE_AFTER = 3  # failed checks before staff may override


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


def sold_out_now():
    return {r["item"] for r in db().execute("SELECT item FROM sold_out")}


def order_json(row, with_code=False):
    data = {
        "id": row["id"],
        "status": row["status"],
        "placed_at": row["placed_at"],
        "ready_at": row["ready_at"],
        "picked_up_at": row["picked_up_at"],
        "items": items_of(row["id"]),
        "notices": [r["message"] for r in db().execute(
            "SELECT message FROM notices WHERE order_id = ? ORDER BY id", (row["id"],))],
    }
    if with_code:  # only staff see the code that goes on the bag
        data["pickup_code"] = row["pickup_code"]
    return data


# ---------- menu and customer orders ----------

@app.get("/api/menu")
def menu():
    # Proxy descriptions stay on the server; the browser only needs names.
    sold = sold_out_now()
    return jsonify(
        items=[{"id": i["id"], "name": i["name"], "sold_out": i["id"] in sold} for i in MENU["items"]],
        combos=MENU["combos"],
    )


@app.post("/api/menu/<item>/sold-out")
@role_required("staff")
def set_sold_out(item):
    if item not in ITEMS:
        return fail("That item isn't on the menu.", 404)
    if (request.get_json(silent=True) or {}).get("sold_out"):
        db().execute("INSERT OR IGNORE INTO sold_out (item, at) VALUES (?, ?)", (item, utc_now()))
    else:
        db().execute("DELETE FROM sold_out WHERE item = ?", (item,))
    db().commit()
    return jsonify(ok=True)


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
    gone = [ITEMS[i]["name"] for i in cart if i in sold_out_now()]
    if gone:
        return fail(f"Sorry, {', '.join(gone)} just sold out. Remove it to order.", 409)

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
    sold = sold_out_now()
    queue_ids = [o["id"] for o in waiting_orders()]  # oldest first
    done = db().execute("SELECT placed_at, ready_at FROM orders WHERE ready_at IS NOT NULL").fetchall()
    # ETA = (orders ahead + this one) x average time to ready, or 2 minutes until we have data.
    per_order = (sum(seconds_between(d["placed_at"], d["ready_at"]) for d in done) / len(done)) if done else 120
    out = []
    for r in rows:
        data = order_json(r)
        if r["status"] == "pending":
            data["sold_out_items"] = [ITEMS[i]["name"] for i in data["items"] if i in sold]
            if r["id"] in queue_ids:
                ahead = queue_ids.index(r["id"])
                data["orders_ahead"] = ahead
                data["eta_minutes"] = max(1, round((ahead + 1) * per_order / 60))
        out.append(data)
    return jsonify(out)


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


def best_match(seen, orders, slip=None):
    """Auto-matching. A readable order slip wins; otherwise pick the waiting
    order whose ticket is closest to what the camera saw (L1 distance).
    Orders come oldest first, so ties go to the oldest."""
    by_slip = next((o for o in orders if o["id"] == slip), None)
    if by_slip is not None:
        return by_slip, "slip"
    def distance(order):
        ticket = items_of(order["id"])
        return sum(abs(seen.get(i, 0) - ticket.get(i, 0)) for i in ITEMS)
    return min(orders, key=distance), "items"


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
        seen, slip, note = look_at_tray(image, MENU["items"])  # image used once, never saved
    except AIError as e:
        return fail(str(e), e.code)  # AI trouble doesn't count against the order

    order, matched_by = best_match(seen, orders, slip)
    oid = order["id"]
    ticket = items_of(oid)
    missing, extra = compare(seen, ticket)
    complete = not missing and not extra

    sold = sold_out_now()

    # The agent proposes actions from facts that code has already verified.
    facts = {
        "order_id": oid,
        "matched_by": "order slip on the tray" if matched_by == "slip" else "closest item counts",
        "complete": complete,
        "ticket": {ITEMS[i]["name"]: n for i, n in ticket.items()},
        "on_tray": {ITEMS[i]["name"]: n for i, n in seen.items() if n},
        "missing": [{"item_id": i, "name": ITEMS[i]["name"], "qty": n,
                     "station": ITEMS[i]["station"]} for i, n in missing.items() if i not in sold],
        "sold_out_missing": [{"item_id": i, "name": ITEMS[i]["name"], "qty": n}
                             for i, n in missing.items() if i in sold],
        "extra": [{"item_id": i, "name": ITEMS[i]["name"], "qty": n} for i, n in extra.items()],
        "available_items": [{"item_id": i, "name": ITEMS[i]["name"]} for i in ITEMS if i not in sold],
    }
    proposals, agent_problem = [], ""
    if agent.is_on():
        try:
            proposals = agent.propose(facts)
        except AIError as e:
            agent_problem = f"Agent unavailable, standard rules used ({e})."
    mine = [(n, a) for n, a in proposals if a.get("order_id", oid) == oid]  # only this order

    conn = db()
    done, tips, ready_at, rules_helped, told_customer = [], [], None, False, False
    requested = set()

    def tell_customer(message, by):
        conn.execute("INSERT INTO notices (order_id, message, sent_by, at) VALUES (?, ?, ?, ?)",
                     (oid, message[:200], by, utc_now()))
        done.append({"by": by, "text": "Messaged the customer"})

    # 1. Ticket changes. The agent may only remove or swap items that are
    #    BOTH sold out AND missing from the tray.
    new_ticket = dict(ticket)
    for name, args in mine:
        if name == "remove_item":
            item = args.get("item_id")
            if item in new_ticket and item in sold and item in missing:
                del new_ticket[item]
                done.append({"by": "agent", "text": f"Removed sold-out {ITEMS[item]['name']}"})
        elif name == "swap_item":
            old, new = args.get("from_item_id"), args.get("to_item_id")
            if (old in new_ticket and old in sold and old in missing
                    and new in ITEMS and new not in sold and new != old):
                qty = new_ticket.pop(old)
                new_ticket[new] = new_ticket.get(new, 0) + qty
                done.append({"by": "agent", "text": f"Swapped sold-out {ITEMS[old]['name']} for {ITEMS[new]['name']}"})
        elif name == "notify_customer" and str(args.get("message", "")).strip():
            tell_customer(str(args["message"]).strip(), "agent")
            told_customer = True
    for item in list(new_ticket):  # safety net: drop any sold-out item still missing
        if item in sold and item in missing:
            del new_ticket[item]
            done.append({"by": "rules", "text": f"Removed sold-out {ITEMS[item]['name']}"})
            rules_helped = True
    if new_ticket != ticket:
        if not told_customer:
            gone = ", ".join(ITEMS[i]["name"] for i in ticket if new_ticket.get(i, 0) < ticket[i])
            tell_customer(f"Sorry, {gone} sold out, so we adjusted your order.", "rules")
            rules_helped = True
        conn.execute("DELETE FROM order_items WHERE order_id = ?", (oid,))
        conn.executemany("INSERT INTO order_items (order_id, item, qty) VALUES (?, ?, ?)",
                         [(oid, i, n) for i, n in new_ticket.items()])
        ticket = new_ticket
        missing, extra = compare(seen, ticket)  # re-check against the new ticket
        complete = bool(ticket) and not missing and not extra

    def send_request(item, qty, by):
        # One open request per order and item, so re-checks don't pile up duplicates.
        open_one = conn.execute("SELECT id FROM station_requests WHERE order_id = ? AND item = ? AND done = 0",
                                (oid, item)).fetchone()
        if open_one:
            conn.execute("UPDATE station_requests SET qty = ? WHERE id = ?", (qty, open_one["id"]))
        else:
            conn.execute(
                "INSERT INTO station_requests (order_id, station, item, qty, sent_by, at) "
                "VALUES (?, ?, ?, ?, ?, ?)", (oid, ITEMS[item]["station"], item, qty, by, utc_now()))
        requested.add(item)
        done.append({"by": by, "text": f"Asked {ITEMS[item]['station']} for {qty} {ITEMS[item]['name']}"})

    if not ticket:
        # Everything on the order sold out: cancel rather than send an empty bag.
        conn.execute("UPDATE orders SET status = 'cancelled' WHERE id = ?", (oid,))
        conn.execute("UPDATE station_requests SET done = 1 WHERE order_id = ?", (oid,))
        tips.append(f"Order #{oid} was cancelled because everything on it sold out.")
    else:
        # 2. Readiness and fix requests, judged against the (possibly new) ticket.
        for name, args in mine:
            if name == "mark_ready" and complete and not ready_at:
                ready_at = utc_now()
                done.append({"by": "agent", "text": "Marked ready and notified the driver"})
            elif name == "request_fix":
                item, qty = args.get("item_id"), args.get("qty")
                if (item in missing and item not in sold and item not in requested
                        and type(qty) is int and 0 < qty <= missing[item]):
                    send_request(item, qty, "agent")
            elif name == "tell_packer" and str(args.get("message", "")).strip():
                tips.append(str(args["message"]).strip()[:160])

        # Safety net: the standard rules handle anything the agent skipped.
        if complete and not ready_at:
            ready_at, rules_helped = utc_now(), True
            done.append({"by": "rules", "text": "Marked ready and notified the driver"})
        for item, qty in missing.items():
            if item not in requested:
                send_request(item, qty, "rules")
                rules_helped = True
        if not tips and missing:
            tips.append("Add the missing items when the station sends them, then check again.")
        if not tips and extra:
            tips.append("Take the extra items off the tray, then check again.")

    if ready_at:
        conn.execute("UPDATE orders SET status = 'ready', ready_at = ? WHERE id = ?", (ready_at, oid))
        conn.execute("UPDATE station_requests SET done = 1 WHERE order_id = ?", (oid,))  # no longer needed
    elif ticket:
        conn.execute("UPDATE orders SET failed_checks = failed_checks + 1 WHERE id = ?", (oid,))
    decided_by = "rules" if (agent_problem or not agent.is_on()) else ("agent+rules" if rules_helped else "agent")
    result = "cancelled" if not ticket else ("green" if ready_at else "red")
    conn.execute("INSERT INTO checks (order_id, result, seen, decided_by, note, at) VALUES (?, ?, ?, ?, ?, ?)",
                 (oid, result, json.dumps(seen), decided_by, note, utc_now()))
    conn.commit()
    failed = conn.execute("SELECT failed_checks FROM orders WHERE id = ?", (oid,)).fetchone()[0]

    return jsonify(result=result, order_id=oid, matched_by=matched_by, slip=slip,
                   ticket=ticket, seen=seen, missing=missing,
                   extra=extra, note=note, failed_checks=failed, ready_at=ready_at,
                   actions=done, tips=tips, decided_by=decided_by, agent_problem=agent_problem,
                   can_override=result == "red" and failed >= OVERRIDE_AFTER)


@app.post("/api/orders/<int:oid>/override")
@role_required("staff")
def override(oid):
    reason = ((request.get_json(silent=True) or {}).get("reason") or "").strip()
    if len(reason) < 3:
        return fail("Type a short reason first.", 400)
    conn = db()
    order = conn.execute("SELECT * FROM orders WHERE id = ?", (oid,)).fetchone()
    if order is None or order["status"] != "pending":
        return fail("That order isn't waiting anymore.", 409)
    if order["failed_checks"] < OVERRIDE_AFTER:
        return fail(f"Override unlocks after {OVERRIDE_AFTER} failed checks.", 403)
    now = utc_now()
    conn.execute("UPDATE orders SET status = 'ready', ready_at = ?, override_reason = ? WHERE id = ?",
                 (now, reason, oid))
    conn.execute("UPDATE station_requests SET done = 1 WHERE order_id = ?", (oid,))
    conn.execute("INSERT INTO checks (order_id, result, decided_by, note, at) VALUES (?, 'override', 'staff', ?, ?)",
                 (oid, reason, now))
    conn.commit()
    return jsonify(order_id=oid, ready_at=now)


@app.get("/api/station-requests")
@role_required("staff")
def station_requests():
    rows = db().execute("SELECT * FROM station_requests WHERE done = 0 ORDER BY id").fetchall()
    return jsonify([{"id": r["id"], "order_id": r["order_id"], "station": r["station"],
                     "item": ITEMS[r["item"]]["name"], "qty": r["qty"], "sent_by": r["sent_by"]}
                    for r in rows])


@app.post("/api/station-requests/<int:rid>/done")
@role_required("staff")
def station_request_done(rid):
    db().execute("UPDATE station_requests SET done = 1 WHERE id = ?", (rid,))
    db().commit()
    return jsonify(ok=True)


# ---------- driver handoff ----------
# The driver types the code written on the bag they were handed. If it
# doesn't match their order, they're holding the wrong bag.

@app.get("/api/driver/orders")
@role_required("driver")
def driver_orders():
    rows = db().execute("SELECT * FROM orders WHERE status = 'ready' ORDER BY ready_at, id").fetchall()
    return jsonify([order_json(r) for r in rows])  # no pickup codes for drivers


@app.post("/api/driver/pickup")
@role_required("driver")
def driver_pickup():
    body = request.get_json(silent=True) or {}
    oid, code = body.get("order_id"), str(body.get("code", "")).strip().upper()
    conn = db()
    order = conn.execute("SELECT * FROM orders WHERE id = ?", (oid,)).fetchone()
    if order is None or order["status"] != "ready":
        return fail("That order isn't ready for pickup.", 409)
    # The driver must tick every item on the checklist before confirming.
    if set(body.get("checked") or []) != set(items_of(oid)):
        return fail("Check off every item in the bag first.", 400)
    ok = code == order["pickup_code"]
    conn.execute("INSERT INTO handoffs (order_id, code, ok, at) VALUES (?, ?, ?, ?)",
                 (oid, code, int(ok), utc_now()))
    if not ok:
        conn.commit()
        other = conn.execute("SELECT id FROM orders WHERE pickup_code = ? AND id != ?", (code, oid)).fetchone()
        hint = f" That bag belongs to order #{other['id']}." if other else ""
        return jsonify(ok=False, message=f"Wrong bag for order #{oid}.{hint}")
    now = utc_now()
    conn.execute("UPDATE orders SET status = 'picked_up', picked_up_at = ? WHERE id = ?", (now, oid))
    conn.commit()
    return jsonify(ok=True, message=f"Right bag. Order #{oid} picked up.")


# ---------- impact dashboard ----------

def ratio(a, b):
    return round(100 * a / b) if b else None


def seconds_between(start, end):
    fmt = "%Y-%m-%dT%H:%M:%SZ"
    return (datetime.strptime(end, fmt) - datetime.strptime(start, fmt)).total_seconds()


@app.get("/api/stats")
@role_required("staff")
def stats():
    conn = db()
    count = lambda sql: conn.execute(sql).fetchone()[0]
    done_orders = conn.execute(
        "SELECT placed_at, ready_at FROM orders WHERE ready_at IS NOT NULL").fetchall()
    # Each order's first check: did it pass on the first try?
    firsts = [r[0] for r in conn.execute(
        "SELECT result FROM checks c WHERE id = (SELECT MIN(id) FROM checks WHERE order_id = c.order_id) "
        "AND result IN ('green', 'red')")]
    decided = [r[0] for r in conn.execute(
        "SELECT decided_by FROM checks WHERE result IN ('green', 'red', 'cancelled')")]
    pack = [seconds_between(r["placed_at"], r["ready_at"]) for r in done_orders]
    return jsonify(
        errors_caught=count("SELECT COUNT(*) FROM checks WHERE result = 'red'"),
        orders_completed=len(done_orders),
        first_try=ratio(firsts.count("green"), len(firsts)),
        avg_pack_seconds=round(sum(pack) / len(pack)) if pack else None,
        sold_out_saves=count("SELECT COUNT(DISTINCT order_id) FROM notices"),
        overrides=count("SELECT COUNT(*) FROM checks WHERE result = 'override'"),
        agent_share=ratio(sum(d in ("agent", "agent+rules") for d in decided), len(decided)),
        wrong_bags=count("SELECT COUNT(*) FROM handoffs WHERE ok = 0"),
    )


# ---------- accuracy test mode ----------
# Staff place a tray, enter what's really on it, and the AI's counts are
# compared with the truth. No orders change and no agent call is made.

def unit_scores(truth, seen):
    """Count-level true positives, false positives, false negatives."""
    tp = sum(min(truth.get(i, 0), seen.get(i, 0)) for i in ITEMS)
    fp = sum(max(seen.get(i, 0) - truth.get(i, 0), 0) for i in ITEMS)
    fn = sum(max(truth.get(i, 0) - seen.get(i, 0), 0) for i in ITEMS)
    return tp, fp, fn


@app.post("/api/eval")
@role_required("staff")
def eval_run():
    body = request.get_json(silent=True) or {}
    image, truth = body.get("image", ""), body.get("truth") or {}
    if not image.startswith("data:image/jpeg;base64,"):
        return fail("Expected a JPEG snapshot from the camera.", 400)
    if any(i not in ITEMS or type(n) is not int or n < 0 for i, n in truth.items()):
        return fail("The true counts must be whole numbers for menu items.", 400)
    truth = {i: truth.get(i, 0) for i in ITEMS}
    start = time.monotonic()
    try:
        seen, _slip, note = look_at_tray(image, MENU["items"])
    except AIError as e:
        return fail(str(e), e.code)
    seconds = round(time.monotonic() - start, 1)
    db().execute("INSERT INTO eval_runs (truth, seen, seconds, at) VALUES (?, ?, ?, ?)",
                 (json.dumps(truth), json.dumps(seen), seconds, utc_now()))
    db().commit()
    return jsonify(truth=truth, seen=seen, note=note, seconds=seconds, exact=truth == seen)


@app.get("/api/eval/summary")
@role_required("staff")
def eval_summary():
    runs = db().execute("SELECT * FROM eval_runs ORDER BY id DESC").fetchall()
    tp = fp = fn = exact = 0
    per_item = {i: {"tp": 0, "fp": 0, "fn": 0} for i in ITEMS}
    recent = []
    for r in runs:
        truth, seen = json.loads(r["truth"]), json.loads(r["seen"])
        a, b, c = unit_scores(truth, seen)
        tp, fp, fn = tp + a, fp + b, fn + c
        exact += truth == seen
        for i in ITEMS:
            per_item[i]["tp"] += min(truth[i], seen.get(i, 0))
            per_item[i]["fp"] += max(seen.get(i, 0) - truth[i], 0)
            per_item[i]["fn"] += max(truth[i] - seen.get(i, 0), 0)
        if len(recent) < 8:
            recent.append({"id": r["id"], "truth": truth, "seen": seen,
                           "seconds": r["seconds"], "exact": truth == seen})
    seconds = [r["seconds"] for r in runs]
    return jsonify(
        runs=len(runs),
        tray_accuracy=ratio(exact, len(runs)),
        precision=ratio(tp, tp + fp),
        recall=ratio(tp, tp + fn),
        avg_seconds=round(sum(seconds) / len(seconds), 1) if seconds else None,
        # Items the AI "saw" that weren't there: each one could cause a false green.
        phantom_items=fp,
        items=[{"id": i, "name": ITEMS[i]["name"],
                "precision": ratio(v["tp"], v["tp"] + v["fp"]),
                "recall": ratio(v["tp"], v["tp"] + v["fn"])} for i, v in per_item.items()],
        recent=recent,
    )


@app.post("/api/eval/reset")
@role_required("staff")
def eval_reset():
    db().execute("DELETE FROM eval_runs")
    db().commit()
    return jsonify(ok=True)


# ---------- pickup board and demo reset ----------

@app.get("/api/board")
def board():
    """Public pickup screen: order numbers only, nothing personal."""
    rows = db().execute(
        "SELECT id, status FROM orders WHERE status IN ('pending', 'ready') ORDER BY id"
    ).fetchall()
    return jsonify(
        packing=[r["id"] for r in rows if r["status"] == "pending"],
        ready=[r["id"] for r in rows if r["status"] == "ready"],
    )


@app.post("/api/demo/reset")
@role_required("staff")
def demo_reset():
    """Clear orders and everything about them, so each demo starts at #1.
    Accounts and accuracy-test results stay."""
    conn = db()
    for table in ("order_items", "checks", "notices", "handoffs", "station_requests", "sold_out", "orders"):
        conn.execute(f"DELETE FROM {table}")
    conn.commit()
    return jsonify(ok=True)


if __name__ == "__main__":
    setup_database()
    print("PackRight database ready. Demo accounts: customer, staff, driver")
    app.run(port=5000, debug=True)
