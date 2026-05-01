from datetime import datetime, timedelta, timezone
import json
import os
import re

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional

from services.supabase_client import get_supabase

router = APIRouter(tags=["market_research"])


class StateResearchRequest(BaseModel):
    state: str
    strategy: str = "infill_lots"
    acreage_min: float = 0.1
    acreage_max: float = 2.0


class CountyResearchRequest(BaseModel):
    county: str
    state: str
    strategy: str = "infill_lots"


def _call_claude_with_research(prompt: str) -> str:
    import anthropic

    api_key = os.getenv("ANTHROPIC_API_KEY", "")
    client = anthropic.Anthropic(api_key=api_key)

    try:
        response = client.beta.messages.create(
            model="claude-sonnet-4-5",
            max_tokens=8192,
            tools=[{"type": "web_search_20250305", "name": "web_search", "max_uses": 5}],
            messages=[{"role": "user", "content": prompt}],
            betas=["web-search-2025-03-05"],
        )
        text_parts = []
        for block in response.content:
            if hasattr(block, "text"):
                text_parts.append(block.text)
        return "\n".join(text_parts)
    except Exception:
        response = client.messages.create(
            model="claude-sonnet-4-5",
            max_tokens=4096,
            messages=[{"role": "user", "content": prompt}],
        )
        text_parts = []
        for block in response.content:
            if hasattr(block, "text"):
                text_parts.append(block.text)
        return "\n".join(text_parts)


def _get_cached(key: str) -> Optional[dict]:
    try:
        sb = get_supabase()
        r = sb.table("crm_settings").select("value,updated_at").eq("key", key).execute()
        if not r.data:
            return None
        row = r.data[0]
        updated_at_str = row.get("updated_at")
        if not updated_at_str:
            return None
        updated_at = datetime.fromisoformat(updated_at_str.replace("Z", "+00:00"))
        if updated_at.tzinfo is None:
            updated_at = updated_at.replace(tzinfo=timezone.utc)
        now = datetime.now(tz=timezone.utc)
        if now - updated_at > timedelta(days=7):
            return None
        value = row.get("value")
        if isinstance(value, dict):
            return {"data": value, "last_updated": updated_at_str}
        return None
    except Exception:
        return None


def _save_cache(key: str, value: dict) -> None:
    try:
        sb = get_supabase()
        now_iso = datetime.now(tz=timezone.utc).isoformat()
        sb.table("crm_settings").upsert(
            {"key": key, "value": value, "updated_at": now_iso},
            on_conflict="key",
        ).execute()
    except Exception:
        pass


def _parse_json_response(text: str) -> Optional[dict]:
    try:
        return json.loads(text)
    except (json.JSONDecodeError, ValueError):
        pass

    match = re.search(r"\{[\s\S]*\}", text)
    if match:
        try:
            return json.loads(match.group(0))
        except (json.JSONDecodeError, ValueError):
            pass

    return None


@router.post("/market-research/state")
async def research_state(request: StateResearchRequest):
    state_lower = request.state.lower().replace(" ", "_")
    today = datetime.now(tz=timezone.utc).strftime("%Y-%m-%d")
    cache_key = f"market_research_{state_lower}_{today}"

    cached = _get_cached(cache_key)
    if cached is not None:
        result = cached["data"]
        result["cached"] = True
        result["last_updated"] = cached["last_updated"]
        return result

    strategy_descriptions = {
        "infill_lots": "infill lot development — buying small lots in established neighborhoods for new home construction",
        "rural_acreage": "rural acreage — buying larger parcels of rural land for recreational, agricultural, or future development use",
        "subdivide_and_sell": "subdivide and sell — buying larger parcels and subdividing them into smaller lots for resale",
    }
    strategy_desc = strategy_descriptions.get(request.strategy, request.strategy)

    prompt = f"""Research the land lot sales market in {request.state} for 2026 with a focus on the strategy of {strategy_desc}.

Please find and analyze:
1. Current land lot sales market conditions in {request.state} in 2026
2. The fastest growing counties by population growth
3. New construction permits and builder activity by county
4. Which counties are best suited for the strategy: {request.strategy}
5. Typical price ranges for lots sized between {request.acreage_min} and {request.acreage_max} acres

Return ONLY valid JSON with no markdown formatting, code blocks, or extra text. The JSON must match this exact schema:

{{
  "state": "{request.state}",
  "strategy": "{request.strategy}",
  "market_summary": "2-3 sentence overview of the {request.state} land market in 2026",
  "counties": [
    {{
      "county": "County Name",
      "state": "State Abbreviation",
      "rank": 1,
      "why_good": "2-3 sentences why this county is good for {request.strategy}",
      "price_range_low": 20000,
      "price_range_high": 80000,
      "builder_demand": "High",
      "recommended_acreage_min": 0.15,
      "recommended_acreage_max": 1.0,
      "population_trend": "Growing rapidly",
      "dom_estimate": 35,
      "key_cities": ["City1", "City2"]
    }}
  ]
}}

Include exactly 5 counties ranked from best to worst opportunity. Return ONLY the JSON object."""

    try:
        raw_text = _call_claude_with_research(prompt)
        parsed = _parse_json_response(raw_text)

        if parsed is None:
            result = {
                "state": request.state,
                "strategy": request.strategy,
                "market_summary": "Unable to parse market research results.",
                "counties": [],
                "cached": False,
                "error": "Failed to parse JSON response from AI",
            }
            return result

        _save_cache(cache_key, parsed)
        parsed["cached"] = False
        return parsed

    except Exception as e:
        return {
            "state": request.state,
            "strategy": request.strategy,
            "market_summary": "An error occurred while fetching market research.",
            "counties": [],
            "cached": False,
            "error": str(e),
        }


@router.post("/market-research/county")
async def research_county(request: CountyResearchRequest):
    state_lower = request.state.lower().replace(" ", "_")
    county_lower = request.county.lower().replace(" ", "_")
    today = datetime.now(tz=timezone.utc).strftime("%Y-%m-%d")
    cache_key = f"market_research_{state_lower}_{county_lower}_{today}"

    cached = _get_cached(cache_key)
    if cached is not None:
        result = cached["data"]
        result["cached"] = True
        result["last_updated"] = cached["last_updated"]
        return result

    strategy_descriptions = {
        "infill_lots": "infill lot development — buying small lots in established neighborhoods for new home construction",
        "rural_acreage": "rural acreage — buying larger parcels of rural land for recreational, agricultural, or future development use",
        "subdivide_and_sell": "subdivide and sell — buying larger parcels and subdividing them into smaller lots for resale",
    }
    strategy_desc = strategy_descriptions.get(request.strategy, request.strategy)

    prompt = f"""Research the land investment market in {request.county} County, {request.state} for a strategy of {strategy_desc}.

Please find and analyze:
1. Recent land sales (2024-2026) in {request.county} County, {request.state}
2. Builder permits and new construction activity in the county
3. Population growth data and trends
4. Recommended lot sizes for the strategy: {request.strategy}
5. Key cities and growth areas within the county
6. Overall investment recommendation

Return ONLY valid JSON with no markdown formatting, code blocks, or extra text. The JSON must match this exact schema:

{{
  "county": "{request.county}",
  "state": "{request.state}",
  "analysis": "Detailed 3-4 paragraph analysis of the county market conditions, builder activity, population trends, and investment potential",
  "builder_demand": "High",
  "price_range_low": 20000,
  "price_range_high": 80000,
  "recommended_acreage_min": 0.15,
  "recommended_acreage_max": 1.0,
  "dom_estimate": 35,
  "key_cities": ["City1", "City2"],
  "population_growth": "15% over 5 years",
  "recommendation": "Strong Buy"
}}

The recommendation field should be one of: "Strong Buy", "Buy", "Hold", "Avoid". Return ONLY the JSON object."""

    try:
        raw_text = _call_claude_with_research(prompt)
        parsed = _parse_json_response(raw_text)

        if parsed is None:
            result = {
                "county": request.county,
                "state": request.state,
                "analysis": "Unable to parse county research results.",
                "builder_demand": "Unknown",
                "price_range_low": 0,
                "price_range_high": 0,
                "recommended_acreage_min": 0.1,
                "recommended_acreage_max": 2.0,
                "dom_estimate": 0,
                "key_cities": [],
                "population_growth": "Unknown",
                "recommendation": "Hold",
                "cached": False,
                "error": "Failed to parse JSON response from AI",
            }
            return result

        _save_cache(cache_key, parsed)
        parsed["cached"] = False
        return parsed

    except Exception as e:
        return {
            "county": request.county,
            "state": request.state,
            "analysis": "An error occurred while fetching county research.",
            "builder_demand": "Unknown",
            "price_range_low": 0,
            "price_range_high": 0,
            "recommended_acreage_min": 0.1,
            "recommended_acreage_max": 2.0,
            "dom_estimate": 0,
            "key_cities": [],
            "population_growth": "Unknown",
            "recommendation": "Hold",
            "cached": False,
            "error": str(e),
        }
