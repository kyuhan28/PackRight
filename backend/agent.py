"""PackRight's tool-calling agent. Built at NOVA 2026 with help from Claude.

Code has already worked out the facts (which order, what's missing). The
agent only *proposes* actions from those facts; app.py checks each proposal
before running it, and standard rules cover anything the agent skips.
"""

import json
import os

from vision import ask_openrouter


def tool(name, description, **params):
    return {"type": "function", "function": {
        "name": name, "description": description,
        "parameters": {"type": "object", "properties": params, "required": list(params)},
    }}


TOOLS = [
    tool("mark_ready", "Mark the order ready and notify the driver. Only if nothing is missing or extra.",
         order_id={"type": "integer"}),
    tool("request_fix", "Ask the kitchen station that makes a missing item to send it.",
         order_id={"type": "integer"}, item_id={"type": "string"}, qty={"type": "integer"}),
    tool("tell_packer", "Give the person packing the tray one short instruction.",
         message={"type": "string"}),
    tool("remove_item", "Remove a SOLD-OUT item from the order.",
         order_id={"type": "integer"}, item_id={"type": "string"}),
    tool("swap_item", "Replace a SOLD-OUT item with a close available item, same quantity.",
         order_id={"type": "integer"}, from_item_id={"type": "string"}, to_item_id={"type": "string"}),
    tool("notify_customer", "Send the customer a short, polite message about their order.",
         order_id={"type": "integer"}, message={"type": "string"}),
]

INSTRUCTIONS = (
    "You run the packing station at a busy fast-food restaurant. You receive "
    "verified facts about the tray that was just checked. Use the tools: if the "
    "order is complete, mark it ready. If items are missing, request each one "
    "from its station and tell the packer what to do. If there are extra items, "
    "tell the packer to take them off. If an item is in sold_out_missing, never "
    "request it: remove it (or swap it for a close available item), message the "
    "customer politely, and mark the order ready if the rest is on the tray. "
    "Keep messages short and friendly."
)


def is_on():
    return os.environ.get("AGENT_ENABLED", "true").lower() == "true"


def propose(facts):
    """Returns a list of (tool_name, arguments). Raises AIError if the call fails."""
    reply = ask_openrouter({
        "model": os.environ.get("AGENT_MODEL") or os.environ.get("OPENROUTER_MODEL"),
        "reasoning": {"effort": "low"},
        "tools": TOOLS,
        "messages": [
            {"role": "system", "content": INSTRUCTIONS},
            {"role": "user", "content": json.dumps(facts)},
        ],
    }, "agent")
    proposals = []
    for call in reply.get("tool_calls") or []:
        fn = call.get("function") or {}
        try:
            args = json.loads(fn.get("arguments") or "{}")
        except json.JSONDecodeError:
            continue  # ignore a garbled call; the rules will cover it
        if isinstance(args, dict):
            proposals.append((fn.get("name"), args))
    return proposals
