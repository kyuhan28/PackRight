"""Ask the vision model what is on the tray. It only reports counts;
app.py decides what they mean. Built at NOVA 2026 with help from Claude."""

import json
import os
import time

import requests

URL = "https://openrouter.ai/api/v1/chat/completions"


class AIError(Exception):
    def __init__(self, message, code=502):
        super().__init__(message)
        self.code = code


def ask_openrouter(body, label):
    """Send one chat request; return the reply message. Raises AIError."""
    key = os.environ.get("OPENROUTER_API_KEY")
    if not key:
        raise AIError("Add OPENROUTER_API_KEY to backend/.env", 500)
    start = time.monotonic()
    try:
        r = requests.post(URL, json=body, timeout=60,
                          headers={"Authorization": f"Bearer {key}"})
    except requests.RequestException:
        raise AIError("Can't reach the AI service. Check the internet connection.")
    print(f"[{label}] {time.monotonic() - start:.1f}s using {body['model']}")
    if r.status_code != 200:
        try:
            why = r.json()["error"]["message"]
        except (ValueError, KeyError, TypeError):
            why = r.text[:200]
        raise AIError(f"AI error {r.status_code}: {why}", 429 if r.status_code == 429 else 502)
    try:
        return r.json()["choices"][0]["message"]
    except (ValueError, KeyError, IndexError):
        raise AIError("The AI sent back something unexpected.")


def tray_prompt(items):
    wanted = "\n".join(f'- "{i["id"]}": {i["looks_like"]}' for i in items)
    shape = ", ".join(f'"{i["id"]}": 0' for i in items)
    return (
        "Look at this overhead photo of a packing tray in a restaurant.\n"
        f"Count only these items:\n{wanted}\n"
        "Ignore anything else, like pens, keys, cables, hands, or the table.\n"
        "If a paper slip with an order number like #12 is on the tray, put that number in "
        '"slip". Otherwise use null.\n'
        "Answer with JSON only, exactly like this, replacing the zeros with counts:\n"
        f'{{"counts": {{{shape}}}, "slip": null, "note": "one short sentence about what you see"}}'
    )


def read_counts(text, items):
    """Pull the JSON out of the reply and check every count. Trust nothing."""
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end < start:
        raise AIError("The AI reply had no JSON. Try again.")
    try:
        data = json.loads(text[start:end + 1])
    except json.JSONDecodeError:
        raise AIError("The AI reply wasn't valid JSON. Try again.")
    counts = {}
    for item in items:
        n = (data.get("counts") or {}).get(item["id"], 0)
        if type(n) is not int or n < 0:
            raise AIError(f"The AI gave a strange count for {item['name']}. Try again.")
        counts[item["id"]] = n
    slip = data.get("slip")
    if type(slip) is not int or slip <= 0:
        slip = None  # anything odd counts as "no slip seen"
    return counts, slip, str(data.get("note", ""))


def look_at_tray(image_data_url, items):
    """Returns (counts, slip_number_or_None, note). The image is not stored anywhere."""
    message = ask_openrouter({
        "model": os.environ.get("OPENROUTER_MODEL"),
        "reasoning": {"effort": "low"},  # counting needs little thinking
        "messages": [{"role": "user", "content": [
            {"type": "text", "text": tray_prompt(items)},
            {"type": "image_url", "image_url": {"url": image_data_url}},
        ]}],
    }, "vision")
    return read_counts(message.get("content") or "", items)
