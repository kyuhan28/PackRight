# PackRight

**Every order, packed right, before the bag is sealed.**

*Built at NOVA 2026 (ScottyLabs, Carnegie Mellon) for the DoorDash tracks.*

During peak hours, restaurant staff pack orders from many channels at once,
and three mistakes keep happening: **missing items, swapped orders, and wrong
driver handoffs.** PackRight catches all three with one overhead camera, an AI
check, and a driver confirmation step.

## How it works

1. A worker places the packed order on a tray under an overhead camera and
   presses **Space**.
2. A **vision-language model** counts the menu items in one photo and reads
   the order slip if one is on the tray. The photo is used once and never saved.
3. **Plain code** matches the tray to the right waiting order (the slip number
   first, otherwise the closest item counts) and works out what's missing or
   extra.
4. A **tool-calling AI agent** gets those verified facts and proposes actions:
   mark the order ready, ask the right kitchen station for a missing item,
   handle a sold-out item, or message the customer.
5. **Code checks every proposal** before it runs, and standard rules fill in
   anything the agent skips or if the AI is unavailable.
6. At pickup, the **driver ticks every item** on a checklist and types the
   **confirmation code** written on the bag. A wrong code is caught and names
   the order the bag really belongs to.

In short: **the AI sees and decides; the code verifies.**

## Features

**Staff packing station**
- Live camera with a tray guide; red result appears beside the camera so the
  tray stays visible; green flash with a "Ready" stamp
- Ticket vs. On tray comparison, AI agent instructions, and who decided
  (agent, agent plus rules, or rules)
- Station requests (Grill, Fryer, Drinks, Bakery) sent automatically
- Override after 3 failed checks, with a typed reason that's logged
- Sold-out toggle per item; the agent removes or swaps sold-out items and
  messages the customer; orders with nothing left are cancelled
- Impact dashboard: errors caught, first-check pass rate, average time to
  ready, sold-out orders adjusted, agent decision share, wrong bags stopped
- Accuracy test mode: precision, recall, tray accuracy, latency, phantom items
- Ticket aging (amber at 3 minutes, red and "late" at 6), sound and voice
  cues, Space to check, dark screen

**Customer**
- Menu with a Burger Combo shortcut, live order tracker, queue position and
  ETA, sold-out warnings, and messages about changes

**Driver**
- Ready orders with an item checklist and a 4-character confirmation code

## Accuracy

Measured with the built-in accuracy test mode on *[number]* test trays
(single items, full orders, duplicates, clutter, touching items, and a bare
white table):

| Metric | Result |
|---|---|
| Tray accuracy (every count right) | *[ ]%* |
| Precision | *[ ]%* |
| Recall | *[ ]%* |
| Average time per check | *[ ] s* |
| Phantom items (could cause a false green) | *[ ]* |

**Why precision matters most:** a missed item causes a false red, which a
worker fixes or overrides. An imagined item can cause a false green, which
sends a wrong order out.

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React, Vite, JavaScript, CSS; browser camera, Canvas, Web Audio, Speech Synthesis |
| Backend | Python, Flask (JSON API), Werkzeug (password hashing, sessions) |
| Database | SQLite |
| AI | OpenRouter API; NVIDIA Nemotron 3 Nano Omni (vision and tool calling) |
| Camera | iPhone as a USB webcam through Camo |
| Development | GitHub Codespaces, Git |

## Run it

**Backend**
```
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```
Create `backend/.env` (never commit it):
```
OPENROUTER_API_KEY=your-key
OPENROUTER_MODEL=nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free
FLASK_SECRET_KEY=a-long-random-string
AGENT_ENABLED=true
```
Then `python app.py`.

**Frontend** (second terminal)
```
cd frontend
npm install
npm run dev
```
Open port 5173. Demo accounts: `customer`, `staff`, and `driver`, each with
the password equal to the username.

To reset all data, stop Flask and delete `backend/packright.db`.

## Known limitations

- Glare and light objects on a bright white table can confuse the model; a
  dark surface under the tray helps.
- Items hidden behind each other may be missed.
- Two orders with identical contents look the same; the order slip solves this.
- The camera can't see inside closed boxes, so modifications like "no pickles"
  can't be verified.
- A false green (the model imagining an item) is possible; future work is a
  short undo window and showing what the AI saw on green too.
- The free model is shared and can be slow or busy; each check takes about
  3 seconds, plus one more AI call when the agent is on.

## What's next

- Fine-tune a small, fast detector on real restaurant items, keeping the
  vision-language model for new items
- Take two or three frames per check and combine the counts
- Confidence levels and an undo window on green
- Integration with real point-of-sale and delivery systems

## Privacy and security

- Camera photos are sent to the AI once and never stored or logged; the camera
  points down at the tray, away from people.
- Passwords are hashed. The API key lives only in `backend/.env`, which Git
  ignores.

## Pre-existing work disclosure

Planning documents and a separate, throwaway practice prototype were made
before NOVA 2026. No code from the practice prototype is in this repo; all
application code here was written during the event (November 7, 2026,
11:00 AM to 5:00 PM).

## What the AI did

We built PackRight with help from **Claude (Anthropic)**. Claude helped plan
the project, researched options, and wrote much of the application code
during the event, step by step at our direction, testing each step before we
installed it. We made the design decisions, set up and ran everything, tested
it with real props and the real camera, redesigned the UI, added the driver
checklist idea, and are responsible for all code in this repo. Every planning
decision and its reasoning is recorded in our planning tracker.

The app itself uses AI at runtime through OpenRouter, as described above.

## Licenses and credits

| Component | License |
|---|---|
| React, Vite, @vitejs/plugin-react | MIT |
| Flask, Werkzeug | BSD-3-Clause |
| requests | Apache-2.0 |
| python-dotenv | BSD-3-Clause |
| Kokonut UI DotField and FlowField (kokonutui.com) | MIT (license headers kept in each file) |
| Atkinson Hyperlegible, Barlow Condensed (Google Fonts) | SIL Open Font License |
| OpenRouter API and the NVIDIA model | Provider terms of service |
| Camo (Reincubate), used on the demo laptop only | Proprietary, free tier |

Item icons are standard emoji, drawn by each device's system font.

## Team

*[Your name]*: build, engineering, and demo
*[Teammate's name]*: pitch and presentation
