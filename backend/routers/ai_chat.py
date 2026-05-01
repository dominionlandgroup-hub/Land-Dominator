"""AI chat assistant for Land Dominator."""
import os
from collections import Counter
from typing import List

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from services.supabase_client import get_supabase

try:
    import anthropic as _anthropic
    _ANTHROPIC_AVAILABLE = True
except ImportError:
    _ANTHROPIC_AVAILABLE = False

router = APIRouter(prefix="/ai", tags=["ai"])

SYSTEM_PROMPT = (
    "You are a land investing assistant inside Land Dominator, a CRM for vacant land flippers. "
    "You help users find markets, analyze comps, price properties, build campaigns, and manage "
    "their pipeline. Be direct, specific, and action-oriented. Never be vague. Always tell the user "
    "exactly what to do next. You know land flipping inside and out — APN, LP estimates, due "
    "diligence, blind offers, mail houses, title companies, double closes, assignments. "
    "Keep responses concise and scannable. Use short paragraphs or bullet points. "
    "When the user asks about specific numbers (leads, counties, deals), pull from the live CRM "
    "data provided in this system prompt and give exact numbers.\n\n"
    "MARKET RESEARCH: When users ask market questions (where to mail, which counties are hot, "
    "state overviews, county comparisons), use the get_market_research tool to fetch real AI-powered "
    "analysis. Always give specific county names, current price ranges, and explain WHY. "
    "Tell them exactly what Land Portal filters to use. Offer to build a campaign in any county.\n\n"
    "WORKFLOW ENGINE: Land Dominator has a full automated workflow:\n"
    "• Buy Box Builder (Settings page) — define target state/county, acreage range, price ceiling, "
    "offer %, mail house email, weekly budget, cost per piece ($0.55 default).\n"
    "• Campaign Budget Calculator — each campaign tracks total_budget, weekly_budget, "
    "cost_per_piece, send_day, mail_house_email, amount_spent.\n"
    "• Mail Calendar — schedule weekly mail drops per campaign. Each drop applies suppression: "
    "skips statuses {due_diligence, closed_won, under_contract, offer_sent}, 'Do Not Mail' tags, "
    "and properties mailed within the last 90 days. Approve a drop, then Send to auto-generate "
    "a CSV mailing list + PDF authorization, email both to the mail house, and mark properties as mailed.\n"
    "• Weekly Monday Summary — auto-email to dupeedamien@gmail.com with pending drops, new leads, "
    "deal pipeline, and budget remaining.\n"
    "When the user asks workflow questions, explain these features and guide them through the UI steps."
)

MODEL = "claude-sonnet-4-5"


def _get_crm_context() -> str:
    """Build a compact CRM summary to inject into every AI request."""
    try:
        sb = get_supabase()

        # Pull a representative sample of properties (status + county + state only)
        sample = (
            sb.table("crm_properties")
            .select("status, county, state")
            .range(0, 4999)
            .execute()
            .data
        )
        sample_count = len(sample)

        # Try to get real total
        try:
            count_res = sb.table("crm_properties").select("id", count="exact").execute()
            total = count_res.count if count_res.count is not None else sample_count
        except Exception:
            total = f"{sample_count}+" if sample_count == 5000 else sample_count

        status_counts = Counter(p.get("status") or "lead" for p in sample)
        county_counts = Counter(
            f"{p['county']}, {p.get('state', '')}"
            for p in sample
            if p.get("county")
        )
        top_counties = county_counts.most_common(10)

        # Deals
        try:
            deals = sb.table("crm_deals").select("stage").limit(200).execute().data
            deal_counts = Counter(d.get("stage", "lead") for d in deals)
        except Exception:
            deal_counts: Counter = Counter()

        lines = [
            f"TOTAL PROPERTIES: {total:,}",
            "STATUS BREAKDOWN: " + " | ".join(
                f"{k}: {v}" for k, v in sorted(status_counts.items())
            ),
            "TOP COUNTIES BY PROPERTY COUNT:",
        ]
        for county, count in top_counties:
            lines.append(f"  {county}: {count:,}")

        if deal_counts:
            lines.append(
                "DEAL PIPELINE: " + " | ".join(f"{k}: {v}" for k, v in deal_counts.items())
            )

        return "\n".join(lines)

    except Exception as exc:
        return f"(CRM data temporarily unavailable: {exc})"


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    messages: List[ChatMessage]


_MARKET_TOOLS = [
    {
        "name": "get_market_research",
        "description": (
            "Look up AI-powered market research for a US state or specific county. "
            "Use this when the user asks about where to invest, which counties are good, "
            "market conditions, or wants county recommendations."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "type": {
                    "type": "string",
                    "enum": ["state", "county"],
                    "description": "Whether to research a full state or a specific county"
                },
                "state": {"type": "string", "description": "Full state name, e.g. Tennessee"},
                "county": {"type": "string", "description": "County name (required if type=county)"},
                "strategy": {
                    "type": "string",
                    "enum": ["infill_lots", "rural_acreage", "subdivide_and_sell"],
                    "description": "Investing strategy to tailor the research"
                }
            },
            "required": ["type", "state"]
        }
    }
]


async def _call_market_research_tool(tool_input: dict) -> str:
    """Execute the market research tool by calling the market_research router directly."""
    try:
        from routers.market_research import research_state, research_county
        from routers.market_research import StateResearchRequest, CountyResearchRequest

        if tool_input.get("type") == "county":
            req = CountyResearchRequest(
                county=tool_input.get("county", ""),
                state=tool_input.get("state", ""),
                strategy=tool_input.get("strategy", "infill_lots"),
            )
            result = await research_county(req)
        else:
            req = StateResearchRequest(
                state=tool_input.get("state", ""),
                strategy=tool_input.get("strategy", "infill_lots"),
            )
            result = await research_state(req)

        import json
        return json.dumps(result, default=str)
    except Exception as exc:
        return f"Market research unavailable: {exc}"


@router.post("/chat")
async def chat(request: ChatRequest) -> dict:
    if not _ANTHROPIC_AVAILABLE:
        raise HTTPException(
            status_code=503,
            detail="anthropic package not installed. Add 'anthropic' to requirements.txt.",
        )

    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        raise HTTPException(
            status_code=503,
            detail="ANTHROPIC_API_KEY environment variable is not set.",
        )

    context = _get_crm_context()
    system = SYSTEM_PROMPT + f"\n\nLIVE CRM DATA (as of this request):\n{context}"
    messages = [{"role": m.role, "content": m.content} for m in request.messages]

    try:
        client = _anthropic.Anthropic(api_key=api_key)

        # Agentic loop to handle tool use
        for _ in range(5):
            response = client.messages.create(
                model=MODEL,
                max_tokens=1024,
                system=system,
                tools=_MARKET_TOOLS,
                messages=messages,
            )

            if response.stop_reason == "end_turn":
                text = next((b.text for b in response.content if hasattr(b, "text")), "")
                return {"response": text}

            if response.stop_reason == "tool_use":
                messages.append({"role": "assistant", "content": response.content})
                tool_results = []
                for block in response.content:
                    if block.type == "tool_use":
                        result = await _call_market_research_tool(block.input)
                        tool_results.append({
                            "type": "tool_result",
                            "tool_use_id": block.id,
                            "content": result,
                        })
                messages.append({"role": "user", "content": tool_results})
            else:
                break

        # Fallback: return last text block
        text = next((b.text for b in response.content if hasattr(b, "text")), "")
        return {"response": text}

    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
