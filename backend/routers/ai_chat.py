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
    "their pipeline. You have access to the user's property data, campaign history, and deal "
    "pipeline. Be direct, specific, and action-oriented. Never be vague. Always tell the user "
    "exactly what to do next. You know land flipping inside and out — APN, LP estimates, due "
    "diligence, blind offers, mail houses, title companies, double closes, assignments. "
    "Keep responses concise and scannable. Use short paragraphs or bullet points. "
    "When the user asks about specific numbers (leads, counties, deals), pull from the live CRM "
    "data provided in this system prompt and give exact numbers."
)

MODEL = "claude-sonnet-4-20250514"


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

    try:
        client = _anthropic.Anthropic(api_key=api_key)
        response = client.messages.create(
            model=MODEL,
            max_tokens=1024,
            system=system,
            messages=[{"role": m.role, "content": m.content} for m in request.messages],
        )
        return {"response": response.content[0].text}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
