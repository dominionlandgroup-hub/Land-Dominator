"""Communications router — Telnyx calls, SMS, and Cartesia AI voice agent (Myra)."""
import asyncio
import hashlib
import json
import os
import re
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

import httpx
from fastapi import APIRouter, BackgroundTasks, Body, HTTPException, Query, Request, Response
from pydantic import BaseModel

from services.supabase_client import get_supabase

router = APIRouter(tags=["communications"])

print("=== Communications router loaded - ready for calls ===")

# ── Config ─────────────────────────────────────────────────────────────────────

def _telnyx_key() -> str:    return os.getenv("TELNYX_API_KEY", "")
def _telnyx_phone() -> str:  return os.getenv("TELNYX_PHONE_NUMBER", "")
def _cartesia_key() -> str:  return os.getenv("CARTESIA_API_KEY", "")
def _cartesia_voice() -> str: return os.getenv("CARTESIA_VOICE_ID", "")
def _admin_email() -> str:   return os.getenv("ADMIN_EMAIL", "dupeedamien@gmail.com")
def _sendgrid_key() -> str:  return os.getenv("SENDGRID_API_KEY", "")

def _base_url() -> str:
    return os.getenv("BACKEND_URL", "https://land-dominator-production.up.railway.app")

def _callback_phone() -> str:
    return os.getenv("TELNYX_CALLBACK_NUMBER", "")


# ── In-memory call state ────────────────────────────────────────────────────────
_call_states: dict[str, dict] = {}

# Keyed by call_control_id — set when outbound call is initiated, consumed when agent answers
pending_outbound: dict[str, dict] = {}  # call_control_id → {seller_phone, seller_name, property_id, bridge_id}

# Flag set to True once warmup finishes — inbound calls wait if False
_warmup_done: bool = False


# ── Disk-backed TTS audio cache ─────────────────────────────────────────────────
_AUDIO_DIR = Path("/tmp/tts_cache")
_AUDIO_DIR.mkdir(parents=True, exist_ok=True)

# All static phrases pre-cached with Cartesia at startup.
# _WARMUP_KEYS is set dynamically after _PHRASES is defined (see below).

# Static phrase texts used for Polly <Say> fallback when Cartesia cache is absent.
_PHRASES: dict[str, str] = {
    "greeting": (
        "Thank you for calling Dominion Land Group, this is Myra. "
        "How can I help you?"
    ),
    "collect_name":          "Can I get your name?",
    "collect_asking_price":  "I understand. What number were you thinking?",
    "collect_callback_time": "What is the best time to reach you?",
    "confirm_callback":      "Is that the best number to reach you?",
    "close_hot_base":        "Got it. Someone will call you within 24 to 48 hours. Have a great day.",
    "close_cold": (
        "That is completely fine. "
        "Would it be okay if we followed up in a few months in case things change?"
    ),
    "follow_up_yes":  "We will reach out in a few months. Take care.",
    "not_interested": "No problem. Take care.",
    "still_there":    "Are you still there?",
    "goodbye":        "Thank you for calling. Have a great day.",
    "wrong_number":   "Sorry about that.",
    "opt_out":        "Done. You will not hear from us again.",
    "live_transfer":  "Hold on one moment. Let me connect you.",
    "voicemail": (
        "Hi, this is Myra with Dominion Land Group. "
        "We reached out about your property recently and just wanted to connect. "
        "Give us a call back at {telnyx_number} or reply to our text. "
        "Talk soon."
    ),
}

# All static phrases are pre-cached at startup
_WARMUP_KEYS: frozenset[str] = frozenset(_PHRASES.keys())

# ── FAQ knowledge base ────────────────────────────────────────────────────────────
_DEFAULT_FAQ: list[dict] = [
    {
        "question_keywords": ["how does this work", "how does it work", "how it works", "explain the process", "walk me through", "what is the process", "how do you"],
        "answer": "Simple. We sign a purchase agreement. Attorney does title search. We do our due diligence. Once everything clears we schedule closing. 30 days or less. We cover all closing costs except back taxes. Payment by wire or check.",
    },
    {
        "question_keywords": ["are you legit", "are you legitimate", "is this legit", "is this legitimate", "real company", "really real", "is this a scam", "scam", "fraud", "fake"],
        "answer": "We never ask for money upfront. You only get paid at closing through a licensed title company. You can look us up at dominionlandgroup.land.",
    },
    {
        "question_keywords": ["what is dominion", "dominion land group", "who is dominion", "what company", "your company", "who are you", "what do you do"],
        "answer": "Dominion Land Group. We buy vacant land directly from owners in Florida, Tennessee, North Carolina, South Carolina, Georgia, and Texas.",
    },
    {
        "question_keywords": ["why do you want", "why are you buying", "why buy my land", "why do you buy", "what do you do with it", "why are you calling me", "why did you call"],
        "answer": "We saw you own vacant land and wanted to see if you had any interest in selling.",
    },
    {
        "question_keywords": ["how long does it take", "how long to close", "how long will it", "timeline", "when would i get paid", "how soon", "how long"],
        "answer": "30 days or less.",
    },
    {
        "question_keywords": ["who pays closing", "closing costs", "fees", "cost to me"],
        "answer": "We do. Except back taxes.",
    },
    {
        "question_keywords": ["what is a title company", "title company", "title agent", "escrow"],
        "answer": "They handle the closing paperwork and make sure you get paid. Either by wire or check, your choice.",
    },
    {
        "question_keywords": ["how will i get paid", "get paid", "payment", "wire transfer", "check"],
        "answer": "The title company handles payment. Wire transfer or check, whichever you prefer.",
    },
    {
        "question_keywords": ["are you a realtor", "realtor", "real estate agent", "agent", "mls", "listing"],
        "answer": "No. We are direct buyers.",
    },
    {
        "question_keywords": ["are you a builder", "builder", "developer", "build on it"],
        "answer": "We work with builders. We buy the land directly from owners.",
    },
    {
        "question_keywords": ["do you have a website", "website", "web site", "online", "dominionlandgroup"],
        "answer": "Yes. dominionlandgroup.land",
    },
    {
        "question_keywords": ["where are you located", "where are you", "your office", "charlotte", "location"],
        "answer": "Charlotte, North Carolina.",
    },
    {
        "question_keywords": ["how did you get my number", "where did you get my number", "how did you find me", "public records", "county records"],
        "answer": "Property records are public through the county. We found your number there.",
    },
    {
        "question_keywords": ["how long in business", "how long have you been", "years in business", "established"],
        "answer": "Several years.",
    },
    {
        "question_keywords": ["what states", "what areas", "where do you buy", "coverage", "do you buy in"],
        "answer": "Florida, Tennessee, North Carolina, South Carolina, Georgia, and Texas.",
    },
    {
        "question_keywords": ["tell me more", "what's this about", "whats this about", "what is this about", "what's going on", "what is this"],
        "answer": "We buy vacant land directly from owners for cash. No agents, no fees, 30 days or less to close.",
    },
]

_FAQ_FALLBACK_ANSWER = (
    "I will have Damien call you back and he can answer everything. When works for you?"
)


def _audio_path(cache_key: str) -> Path:
    return _AUDIO_DIR / f"{cache_key}.wav"


def _all_core_cached() -> bool:
    """True only when every warmup phrase has a cached WAV file on disk."""
    return all(_audio_path(k).exists() for k in _WARMUP_KEYS)


def _cached_url(cache_key: str) -> Optional[str]:
    """Return URL if the file is already on disk, else None. Zero latency."""
    if _audio_path(cache_key).exists():
        return f"{_base_url()}/api/calls/audio/{cache_key}"
    return None


async def _tts_generate(text: str, cache_key: str) -> bool:
    """Generate Cartesia TTS and cache to disk as WAV. Returns True on success."""
    api_key = _cartesia_key()
    voice_id = _cartesia_voice()
    if not api_key or not voice_id:
        return False
    path = _audio_path(cache_key)
    if path.exists():
        return True
    try:
        import cartesia as _cartesia_mod

        def _do_tts() -> bytes:
            client = _cartesia_mod.Cartesia(api_key=api_key)
            resp = client.tts.generate(
                model_id="sonic-2",
                transcript=text,
                voice={"mode": "id", "id": voice_id},
                output_format={
                    "container": "wav",
                    "encoding": "pcm_s16le",
                    "sample_rate": 8000,
                },
            )
            return resp.read()

        audio_bytes = await asyncio.to_thread(_do_tts)
        if audio_bytes:
            path.write_bytes(audio_bytes)
            return True
        print(f"[comms] Cartesia returned empty audio for key={cache_key}")
    except Exception as exc:
        print(f"[comms] Cartesia TTS error for key={cache_key}: {exc}")
    return False


@router.get("/api/calls/audio/{cache_key}")
async def serve_tts_audio(cache_key: str) -> Response:
    """Serve pre-cached Cartesia WAV directly. No processing — pure file read."""
    path = _audio_path(cache_key)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Audio not found")
    return Response(
        path.read_bytes(),
        media_type="audio/wav",
        headers={
            "Cache-Control": "public, max-age=86400",
            "Accept-Ranges": "bytes",
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.get("/api/calls/health")
async def calls_health() -> dict:
    """Health check for the voice agent system."""
    cached_core = sum(1 for k in _WARMUP_KEYS if _audio_path(k).exists())
    all_ready = _all_core_cached()
    return {
        "status": "ok",
        "warmup_done": _warmup_done,
        "core_cached": f"{cached_core}/{len(_WARMUP_KEYS)} core phrases ready",
        "voice_mode": "cartesia" if all_ready else "polly",
        "polly_fallback": "active" if not all_ready else "standby",
    }


@router.get("/api/sms/health")
async def sms_health() -> dict:
    """Health check confirming the inbound SMS webhook is registered and reachable."""
    return {
        "status": "ok",
        "sms_ready": True,
        "inbound_webhook": "/api/sms/inbound",
        "telnyx_phone": _telnyx_phone() or "NOT_CONFIGURED",
    }


@router.get("/api/calls/faq")
async def get_faq() -> list:
    """Return the current FAQ list (DB or built-in defaults)."""
    return await _load_faq()


@router.post("/api/calls/faq")
async def save_faq(request: Request) -> dict:
    """Save FAQ list to crm_settings and clear in-memory cache."""
    body = await request.json()
    faq_list = body if isinstance(body, list) else body.get("faq", [])
    try:
        sb = get_supabase()
        r = sb.table("crm_settings").select("id").eq("key", "agent_faq").limit(1).execute()
        if r.data:
            sb.table("crm_settings").update({"value": faq_list}).eq("key", "agent_faq").execute()
        else:
            sb.table("crm_settings").insert({"key": "agent_faq", "value": faq_list}).execute()
        _faq_cache["data"] = faq_list
        _faq_cache["ts"] = 0.0
        return {"status": "ok", "count": len(faq_list)}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


async def warmup() -> None:
    """Pre-cache ALL static phrases with Cartesia in parallel at startup.
    Server accepts calls immediately via Polly <Say> while warmup runs."""
    global _warmup_done
    if not _cartesia_key() or not _cartesia_voice():
        print("[comms] Cartesia not configured — Polly fallback active for all calls")
        _warmup_done = True
        return

    keys_to_cache = [(k, _PHRASES[k]) for k in _WARMUP_KEYS if k in _PHRASES]
    print(f"[comms] Warmup starting — {len(keys_to_cache)} phrases in parallel...")

    # Generate all phrases concurrently with a per-phrase 8 s timeout
    async def _cache_one(key: str, text: str) -> bool:
        try:
            return await asyncio.wait_for(_tts_generate(text, key), timeout=8.0)
        except asyncio.TimeoutError:
            print(f"[comms] Warmup timeout for {key}", flush=True)
            return False
        except Exception as exc:
            print(f"[comms] Warmup error for {key}: {exc}", flush=True)
            return False

    results = await asyncio.gather(*[_cache_one(k, t) for k, t in keys_to_cache])
    ok = sum(results)

    _warmup_done = True
    voice_mode = "Cartesia" if _all_core_cached() else "mixed Cartesia+Polly"
    print(f"[comms] Warmup done — {ok}/{len(keys_to_cache)} cached, voice mode: {voice_mode}", flush=True)


# ── Dynamic TTS helpers — use static cache; fall back to Polly <Say> instantly ──

def _say(text: str, audio_url: Optional[str] = None) -> str:
    """Return a <Play> or <Say> XML element. <Say> is instant (no latency)."""
    if audio_url:
        return f'<Play>{audio_url}</Play>'
    safe = (
        text.replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
            .replace('"', "&quot;")
    )
    return f'<Say voice="Polly.Joanna-Neural"><prosody rate="medium">{safe}</prosody></Say>'


def _phrase(key: str) -> str:
    """Return a <Play> if ALL core phrases are Cartesia-cached, else Polly <Say>."""
    text = _PHRASES.get(key, key)
    if _all_core_cached() and _audio_path(key).exists():
        url = f"{_base_url()}/api/calls/audio/{key}"
        return f'<Play>{url}</Play>'
    return _say(text)


def _say_dynamic(text: str, cache_key: str) -> str:
    """For dynamic text: use cached mp3 if available, else Polly <Say>."""
    url = _cached_url(cache_key)
    return _say(text, url)


# ── TeXML builders ────────────────────────────────────────────────────────────────

def _texml_gather(
    next_step: str,
    inner_xml: str,
    call_sid: str,
    with_recording: bool = False,
    hints: str = "zero one two three four five six seven eight nine dash hyphen oh yes no",
    timeout: int = 5,
    speech_timeout: int = 2,
) -> Response:
    """Build a Gather TeXML with proper timeouts that never hang up on silence."""
    action = f"{_base_url()}/api/calls/gather/{next_step}"
    timeout_url = f"{action}?timedout=1"

    record_attrs = ""
    if with_recording:
        status_cb = f"{_base_url()}/api/calls/recording-status"
        record_attrs = (
            f'\n          record="record-from-ringing"'
            f'\n          recordingStatusCallback="{status_cb}"'
            f'\n          recordingStatusCallbackMethod="POST"'
        )

    xml = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        "<Response>\n"
        f'  <Gather input="speech dtmf" action="{action}" method="POST"\n'
        f'          timeout="{timeout}" speechTimeout="{speech_timeout}" language="en-US"\n'
        f'          profanityFilter="false"\n'
        f'          hints="{hints}"\n'
        f'          actionOnEmptyResult="true"{record_attrs}>\n'
        f"    {inner_xml}\n"
        "  </Gather>\n"
        f'  <Redirect method="POST">{timeout_url}</Redirect>\n'
        "</Response>"
    )
    return Response(xml, media_type="text/xml")


def _texml_hangup(inner_xml: str) -> Response:
    xml = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        "<Response>\n"
        f"  {inner_xml}\n"
        "  <Hangup/>\n"
        "</Response>"
    )
    return Response(xml, media_type="text/xml")


# ── Acquisitions manager helper ──────────────────────────────────────────────────

_acq_manager_cache: dict = {"name": None, "ts": 0.0}
_ACQ_MANAGER_TTL = 300.0


def _get_acq_manager_name() -> str:
    import time as _time
    now = _time.time()
    if _acq_manager_cache["name"] is not None and now - _acq_manager_cache["ts"] < _ACQ_MANAGER_TTL:
        return _acq_manager_cache["name"]
    try:
        sb = get_supabase()
        r = sb.table("crm_settings").select("value").eq("key", "acquisitions_manager_name").limit(1).execute()
        if r.data:
            name = str(r.data[0].get("value") or "Damien").strip()
            _acq_manager_cache["name"] = name
            _acq_manager_cache["ts"] = now
            return name
    except Exception:
        pass
    _acq_manager_cache["name"] = "Damien"
    _acq_manager_cache["ts"] = now
    return "Damien"


# ── Offer price range ────────────────────────────────────────────────────────────

def _offer_price_range(offer_price) -> tuple[str, str]:
    """Return (low_str, high_str) rounded to nearest $1,000."""
    try:
        price = float(offer_price)
        low = int(round(price * 0.90 / 1000) * 1000)
        high = int(round(price * 1.15 / 1000) * 1000)
        return f"${low:,}", f"${high:,}"
    except Exception:
        return "", ""


# ── Lookup property by address (for call flow) ───────────────────────────────────

async def _lookup_by_address(address: str) -> Optional[dict]:
    """Fuzzy address search in crm_properties."""
    if not address:
        return None
    try:
        sb = get_supabase()
        clean = address.strip()
        r = (
            sb.table("crm_properties")
            .select("*")
            .ilike("situs_address", f"%{clean[:30]}%")
            .limit(1)
            .execute()
        )
        if r.data:
            return r.data[0]
        # Try property_address field
        r = (
            sb.table("crm_properties")
            .select("*")
            .ilike("property_address", f"%{clean[:30]}%")
            .limit(1)
            .execute()
        )
        if r.data:
            return r.data[0]
    except Exception:
        pass
    return None


# ── Utility helpers ──────────────────────────────────────────────────────────────

def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _normalize_phone(phone: str) -> str:
    digits = re.sub(r"\D", "", phone)
    if len(digits) == 10:
        return f"+1{digits}"
    if len(digits) == 11 and digits.startswith("1"):
        return f"+{digits}"
    return phone


def _form_get(form, *keys: str) -> str:
    for k in keys:
        for variant in (k, k.lower(), k.upper()):
            v = form.get(variant)
            if v:
                return str(v)
    return ""


async def _lookup_phone(phone: str) -> Optional[dict]:
    try:
        sb = get_supabase()
        norm = _normalize_phone(phone)
        digits = re.sub(r"\D", "", phone)[-10:]
        # Try owner_phone exact match
        r = sb.table("crm_properties").select("*").eq("owner_phone", norm).limit(1).execute()
        if r.data:
            return r.data[0]
        # Try phone_1 (skip-traced mobile) exact match
        r = sb.table("crm_properties").select("*").eq("phone_1", norm).limit(1).execute()
        if r.data:
            return r.data[0]
        # Partial fallback: owner_phone
        r = sb.table("crm_properties").select("*").ilike("owner_phone", f"%{digits}").limit(1).execute()
        if r.data:
            return r.data[0]
        # Partial fallback: phone_1
        r = sb.table("crm_properties").select("*").ilike("phone_1", f"%{digits}").limit(1).execute()
        if r.data:
            return r.data[0]
    except Exception:
        pass
    return None


async def _create_unmatched_lead(phone: str, caller_name: str = "", property_address: str = "") -> dict:
    try:
        sb = get_supabase()
        notes_parts = [f"Inbound call {_now()[:10]}"]
        if caller_name:
            notes_parts.append(f"Name: {caller_name}")
        if property_address:
            notes_parts.append(f"Address: {property_address}")
        row = {
            "owner_phone": _normalize_phone(phone),
            "status": "lead",
            "notes": " | ".join(notes_parts),
            "updated_at": _now(),
        }
        if caller_name:
            parts = caller_name.strip().split(" ", 1)
            row["owner_first_name"] = parts[0]
            if len(parts) > 1:
                row["owner_last_name"] = parts[1]
        r = sb.table("crm_properties").insert(row).execute()
        return r.data[0] if r.data else {}
    except Exception as exc:
        print(f"[comms] create_unmatched_lead error: {exc}")
        return {}


async def _log_comm(
    property_id: Optional[str],
    comm_type: str,
    phone: str,
    direction: str = "inbound",
    transcript: Optional[str] = None,
    summary: Optional[str] = None,
    lead_score: Optional[str] = None,
    message_body: Optional[str] = None,
    call_id: Optional[str] = None,
    duration_seconds: Optional[int] = None,
    recording_url: Optional[str] = None,
    caller_offer_code: Optional[str] = None,
    disposition: Optional[str] = None,
    callback_requested_at: Optional[str] = None,
) -> dict:
    try:
        sb = get_supabase()
        row: dict = {
            "property_id": property_id,
            "type": comm_type,
            "phone_number": phone,
            "direction": direction,
            "transcript": transcript,
            "summary": summary,
            "lead_score": lead_score,
            "message_body": message_body,
            "call_id": call_id,
            "duration_seconds": duration_seconds,
            "created_at": _now(),
            "is_read": direction != "inbound",  # inbound = unread by default
        }
        if recording_url is not None:
            row["recording_url"] = recording_url
        if caller_offer_code is not None:
            row["caller_offer_code"] = caller_offer_code
        if disposition is not None:
            row["disposition"] = disposition
        if callback_requested_at is not None:
            row["callback_requested_at"] = callback_requested_at
        r = sb.table("crm_communications").insert(row).execute()
        return r.data[0] if r.data else {}
    except Exception as exc:
        print(f"[comms] log_comm error: {exc}")
        return {}


async def _update_comm(comm_id: str, **fields) -> None:
    """Update an existing crm_communications record by id."""
    try:
        sb = get_supabase()
        updates = {k: v for k, v in fields.items() if v is not None}
        if updates:
            sb.table("crm_communications").update(updates).eq("id", comm_id).execute()
    except Exception as exc:
        print(f"[comms] update_comm error: {exc}")


async def _notify_email(subject: str, html: str, to_email: Optional[str] = None) -> None:
    api_key = _sendgrid_key()
    if not api_key:
        return
    try:
        from_email = os.getenv("SENDGRID_FROM_EMAIL", "dominionlandgroup@gmail.com")
        recipient = to_email or _admin_email()
        async with httpx.AsyncClient(timeout=15) as client:
            await client.post(
                "https://api.sendgrid.com/v3/mail/send",
                json={
                    "personalizations": [{"to": [{"email": recipient}]}],
                    "from": {"email": from_email, "name": "Land Dominator"},
                    "subject": subject,
                    "content": [{"type": "text/html", "value": html}],
                },
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
            )
    except Exception as exc:
        print(f"[comms] notify email error: {exc}")


def _score_interest(speech: str) -> str:
    """Rule-based interest scoring from seller's response."""
    up = speech.upper()
    hot_words = ["YES", "YEAH", "YEP", "SURE", "ABSOLUTELY", "DEFINITELY",
                 "INTERESTED", "ACCEPT", "WANT", "READY", "SELL"]
    cold_words = ["NO", "NOT INTERESTED", "WRONG", "REMOVE", "STOP", "UNSUBSCRIBE",
                  "DO NOT", "DONT", "NOT SELLING"]
    for w in cold_words:
        if w in up:
            return "cold"
    for w in hot_words:
        if w in up:
            return "hot"
    return "warm"


async def _score_with_claude(transcript_parts: list[dict]) -> tuple[str, str, str, Optional[str]]:
    """Return (score, summary_with_next_action, disposition, callback_time) using Claude."""
    try:
        import anthropic
        api_key = os.getenv("ANTHROPIC_API_KEY", "")
        if not api_key:
            return "warm", "Call completed.", "MAYBE", None
        transcript_text = "\n".join(
            f"[{t['step'].upper()}] Agent: {t.get('agent', '')}\nCaller: {t.get('speech', '[no response]')}"
            for t in transcript_parts
        )
        client = anthropic.Anthropic(api_key=api_key)
        rsp = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=600,
            messages=[{
                "role": "user",
                "content": (
                    "Analyze this land seller call transcript.\n\n"
                    "LEAD SCORE:\n"
                    "hot: seller is ready to sell at or near the offered price\n"
                    "warm: seller is interested but has questions or wants to negotiate\n"
                    "cold: seller is not interested or property is not available\n\n"
                    "DISPOSITION (pick one):\n"
                    "INTERESTED: seller expressed interest in selling\n"
                    "MAYBE: seller was neutral, non-committal, or call was too short to tell\n"
                    "NOT_INTERESTED: seller explicitly said no or remove from list\n"
                    "NO_ANSWER: nobody answered or call dropped immediately\n"
                    "WRONG_NUMBER: caller said wrong number or doesn't own the property\n"
                    "CALLBACK_NEEDED: seller asked to be called back at a specific time\n\n"
                    "CALLBACK TIME: If seller requested a callback, extract the time/date they mentioned (e.g. 'tomorrow at 2pm', 'Monday morning'). Otherwise null.\n\n"
                    "Next action examples:\n"
                    "- INTERESTED: 'Call back within 24 hours to discuss closing timeline'\n"
                    "- MAYBE: 'Send follow-up text with offer details within 48 hours'\n"
                    "- NOT_INTERESTED: 'Remove from active list, do not contact'\n"
                    "- CALLBACK_NEEDED: 'Call back at requested time'\n\n"
                    f"Transcript:\n{transcript_text}\n\n"
                    'Respond ONLY with JSON: {"score": "hot|warm|cold", "disposition": "INTERESTED|MAYBE|NOT_INTERESTED|NO_ANSWER|WRONG_NUMBER|CALLBACK_NEEDED", "callback_time": null, "summary": "2-3 sentence summary", "next_action": "one sentence recommended action"}'
                ),
            }],
        )
        result = json.loads(rsp.content[0].text.strip())
        score = result.get("score", "warm").lower()
        disposition = result.get("disposition", "MAYBE")
        callback_time = result.get("callback_time")
        summary = result.get("summary", "Call completed.")
        next_action = result.get("next_action", "")
        if next_action:
            summary = f"{summary} Next action: {next_action}"
        return score, summary, disposition, callback_time
    except Exception as exc:
        print(f"[comms] Claude scoring error: {exc}")
        return "warm", "Call completed.", "MAYBE", None


async def _lookup_by_name_county(name: str, county: str) -> list[dict]:
    """Fuzzy search crm_properties by owner name and county."""
    try:
        sb = get_supabase()
        name_clean = name.strip()
        county_clean = county.strip().lower().replace(" county", "").strip()
        # Try exact first
        r = (
            sb.table("crm_properties")
            .select("id,owner_full_name,owner_first_name,owner_last_name,apn,county,state,campaign_code,offer_price,campaign_id")
            .ilike("owner_full_name", f"%{name_clean}%")
            .ilike("county", f"%{county_clean}%")
            .limit(5)
            .execute()
        )
        if r.data:
            return r.data
        # Try first name only + county
        name_parts = name_clean.split()
        if len(name_parts) >= 1:
            r = (
                sb.table("crm_properties")
                .select("id,owner_full_name,owner_first_name,owner_last_name,apn,county,state,campaign_code,offer_price,campaign_id")
                .ilike("owner_first_name", f"%{name_parts[0]}%")
                .ilike("county", f"%{county_clean}%")
                .limit(5)
                .execute()
            )
            if r.data:
                return r.data
    except Exception as exc:
        print(f"[comms] _lookup_by_name_county error: {exc}")
    return []


# ── FAQ detection ────────────────────────────────────────────────────────────────

_FAQ_KEYWORDS = [
    "how does this work", "how does it work",
    "are you legit", "are you legitimate", "is this legit", "is this legitimate",
    "what is dominion", "dominion land group",
    "how much are you", "how much is",
    "why do you want", "why are you buying",
    "is this a scam", "this a scam", "sounds like a scam",
    "how long does it take", "how long to close", "how long will it",
    "tell me more", "what do you do", "who are you",
    "what's this about", "whats this about", "what is this about",
]


def _is_faq_question(speech: str) -> bool:
    low = speech.lower()
    return any(kw in low for kw in _FAQ_KEYWORDS)


# FAQ cache (5-minute TTL)
_faq_cache: dict = {"data": None, "ts": 0.0}
_FAQ_CACHE_TTL = 300.0


async def _load_faq() -> list[dict]:
    import time
    now = time.time()
    if _faq_cache["data"] is not None and now - _faq_cache["ts"] < _FAQ_CACHE_TTL:
        return _faq_cache["data"]
    try:
        sb = get_supabase()
        r = sb.table("crm_settings").select("value").eq("key", "agent_faq").limit(1).execute()
        if r.data:
            raw = r.data[0]["value"]
            faq = raw if isinstance(raw, list) else []
            if faq:
                _faq_cache["data"] = faq
                _faq_cache["ts"] = now
                return faq
    except Exception as exc:
        print(f"[comms] _load_faq error: {exc}")
    _faq_cache["data"] = _DEFAULT_FAQ
    _faq_cache["ts"] = now
    return _DEFAULT_FAQ


def _match_faq_answer(speech: str, faq_list: list[dict]) -> "str | None":
    low = speech.lower()
    for item in faq_list:
        keywords = item.get("question_keywords", [])
        if any(kw.lower() in low for kw in keywords):
            return item.get("answer")
    return None


def _looks_like_question(speech: str) -> bool:
    low = speech.lower().strip()
    return bool(re.search(
        r"^(how|what|why|who|when|where|is this|are you|do you|can you|will you|tell me|explain)",
        low,
    ))


def _get_step_retries(state: dict, step: str) -> int:
    return state.get("retries", {}).get(step, 0)


def _inc_step_retries(call_sid: str, state: dict, step: str) -> int:
    retries = state.setdefault("retries", {})
    retries[step] = retries.get(step, 0) + 1
    if call_sid in _call_states:
        _call_states[call_sid].setdefault("retries", {})[step] = retries[step]
    return retries[step]


# ── Call flow helpers ─────────────────────────────────────────────────────────────

async def _build_offer_intro(call_sid: str, state: dict) -> Response:
    """Build the dynamic offer-intro TeXML and return it as a gather response."""
    mgr = _get_acq_manager_name()
    address = state.get("property_address", "")
    city = state.get("property_city", "")
    state_abbr = state.get("property_state", "")
    offer_price = state.get("offer_price")
    location = ", ".join(filter(None, [city, state_abbr]))
    address_full = " ".join(filter(None, [address, location]))

    if offer_price:
        low_str, high_str = _offer_price_range(offer_price)
        if address_full:
            intro_text = (
                f"Yes, we reached out because we saw you own some vacant land at {address_full}. "
                f"Based on what we know about your property we are looking at somewhere "
                f"in the range of {low_str} to {high_str} cash. "
                "Is that something worth having a conversation about?"
            )
        else:
            intro_text = (
                f"Yes, we reached out because we saw you own some vacant land. "
                f"Based on what we know about your property we are looking at somewhere "
                f"in the range of {low_str} to {high_str} cash. "
                "Is that something worth having a conversation about?"
            )
    elif address_full:
        intro_text = (
            f"Yes, we reached out because we saw you own some vacant land at {address_full} "
            "and wanted to see if selling is something you would consider. Is it?"
        )
    else:
        intro_text = (
            "Yes, we reached out because we saw you own some vacant land "
            "and wanted to see if selling is something you would consider. Is it?"
        )

    # Store for transcript logging in call_gather
    if call_sid in _call_states:
        _call_states[call_sid]["_offer_intro_text"] = intro_text
    state["_offer_intro_text"] = intro_text

    return _texml_gather("offer_intro", _say(intro_text), call_sid)


async def _do_live_transfer(call_sid: str, state: dict, background_tasks: BackgroundTasks) -> Response:
    """Bridge caller to acquisitions manager. Whisper to manager before connecting."""
    mgr = _get_acq_manager_name()
    address = state.get("property_address", "") or state.get("unmatched_info", "")
    asking = state.get("seller_asking_price", "")
    whisper = (
        f"{mgr} — seller on the line. "
        f"Property: {address or 'unknown'}. "
        f"Asking: {asking or 'not stated'}. "
        "Connecting now."
    )
    transfer_to = "+12023215846"
    api_key = _telnyx_key()
    if api_key and call_sid:
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                await client.post(
                    f"https://api.telnyx.com/v2/calls/{call_sid}/actions/speak",
                    json={"payload": whisper, "voice": "female", "language": "en-US"},
                    headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                )
                await asyncio.sleep(0.5)
                await client.post(
                    f"https://api.telnyx.com/v2/calls/{call_sid}/actions/transfer",
                    json={"to": transfer_to},
                    headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                )
        except Exception as exc:
            print(f"[comms] live transfer error: {exc}")
    background_tasks.add_task(_finalize_call, call_sid)
    return _texml_hangup(_phrase("live_transfer"))


# ── AI Voice helpers ─────────────────────────────────────────────────────────────

_VOICE_AI_MAX_EXCHANGES = 10
_VOICE_AI_SYSTEM = (
    "You are Myra, an assistant for Dominion Land Group.\n"
    "You answer calls from land owners who received a text or mailer about their land.\n"
    "Keep responses SHORT - max 2 sentences for phone. This is a voice call.\n"
    "Goal: get their name, interest level, and best callback time for Damien.\n"
    "Never give an exact offer price - say Damien will call with details.\n"
    "If they want to talk to someone now, say you will connect them.\n"
    "If they say stop or remove me, say you will take care of it.\n"
    "Be warm and natural. Never hang up on the caller. Always respond.\n"
    "If asked 'are you real' or 'are you a bot', say you are Myra, an assistant."
)


_TTS_TIMEOUT = 2.0  # max seconds to wait for Cartesia before falling back to Polly


async def _get_response_audio(text: str) -> str:
    """Return <Play> or <Say> XML.

    Priority:
      1. Disk cache hit → instant Cartesia <Play>
      2. Cartesia generation within 2 s → <Play>  (task keeps running if it times out)
      3. Polly <Say> → zero latency fallback

    When we fall back to Polly, the Cartesia task continues in the background
    (via asyncio.shield) and caches the result for the next call.
    """
    if not text:
        return ""
    # 1. Static phrase cache (zero latency)
    for key, phrase_text in _PHRASES.items():
        if phrase_text.strip() == text.strip() and _audio_path(key).exists():
            url = f"{_base_url()}/api/calls/audio/{key}"
            return f'<Play>{url}</Play>'
    # 2. Dynamic hash cache (zero latency)
    cache_key = f"dyn_{hashlib.md5(text.encode()).hexdigest()[:16]}"
    if _audio_path(cache_key).exists():
        url = f"{_base_url()}/api/calls/audio/{cache_key}"
        return f'<Play>{url}</Play>'
    # 3. Try Cartesia with hard 2 s cap; shield keeps it running after timeout
    tts_task = asyncio.create_task(_tts_generate(text, cache_key))
    try:
        success = await asyncio.wait_for(asyncio.shield(tts_task), timeout=_TTS_TIMEOUT)
        if success:
            url = f"{_base_url()}/api/calls/audio/{cache_key}"
            return f'<Play>{url}</Play>'
    except asyncio.TimeoutError:
        print(f"[voice-ai] Cartesia >{_TTS_TIMEOUT}s — Polly now, Cartesia caching in bg: {text[:50]!r}", flush=True)
    except Exception as exc:
        print(f"[voice-ai] Cartesia error — Polly fallback: {exc}", flush=True)
    # 4. Polly instant fallback
    return _say(text)


async def _claude_call_response(speech: str, state: dict) -> Optional[str]:
    """Call Claude API and return Myra's response text for voice call."""
    try:
        import anthropic as _anthropic
    except ImportError:
        return None
    api_key = os.getenv("ANTHROPIC_API_KEY", "")
    if not api_key:
        return None

    # Build property context for system prompt
    address = state.get("property_address", "")
    city = state.get("property_city", "")
    state_abbr = state.get("property_state", "")
    offer_price = state.get("offer_price")
    full_address = " ".join(filter(None, [address, city, state_abbr]))

    system = _VOICE_AI_SYSTEM
    if full_address:
        system += f"\nCaller's property address: {full_address}."
    if offer_price:
        low_s, high_s = _offer_price_range(offer_price)
        system += f"\nOur price range for their property: {low_s} to {high_s}."

    # Build messages from stored AI transcript (last 10 exchanges)
    ai_transcript = state.get("ai_transcript", [])
    messages = [{"role": e["role"], "content": e["content"]} for e in ai_transcript[-10:]]
    if not messages or messages[-1]["role"] != "user":
        messages.append({"role": "user", "content": speech})

    try:
        def _call():
            client = _anthropic.Anthropic(api_key=api_key)
            msg = client.messages.create(
                model="claude-sonnet-4-6",
                max_tokens=100,
                system=system,
                messages=messages,
            )
            return next((b.text for b in msg.content if hasattr(b, "text")), "").strip()

        result = await asyncio.to_thread(_call)
        print(f"[voice-ai] Claude response: {result[:80]!r}", flush=True)
        return result or None
    except Exception as exc:
        print(f"[voice-ai] Claude error: {exc}", flush=True)
        return None


# Scripted fallbacks when Claude is unavailable — keeps conversation going
_CLAUDE_FALLBACKS = [
    "I want to make sure I help you properly. Can you tell me your name and I will have someone from our team call you back?",
    "Let me make sure I connect you with the right person. What is the best number to reach you?",
    "I want to get you the right information. Could you share your name so we can follow up?",
]
_fallback_idx: int = 0


def _get_fallback_response() -> str:
    global _fallback_idx
    resp = _CLAUDE_FALLBACKS[_fallback_idx % len(_CLAUDE_FALLBACKS)]
    _fallback_idx += 1
    return resp


def _detect_call_hot_signals(speech: str, state: dict, call_sid: str) -> None:
    """Update interest_score to 'hot' only if seller explicitly expresses interest in selling."""
    low = speech.lower()
    # Require genuine interest signals — NOT simple acknowledgments ("yes", "okay", "sure")
    hot_phrases = [
        "interested in selling", "want to sell", "willing to sell", "open to selling",
        "sell the land", "sell my land", "sell the property", "sell my property",
        "how much", "what's your offer", "what is your offer", "what would you pay",
        "tell me more", "let's talk", "lets talk", "sounds good to me",
        "definitely", "absolutely", "ready to sell", "thinking about selling",
        "been thinking about selling", "considering selling",
    ]
    if any(p in low for p in hot_phrases):
        state["interest_score"] = "hot"
        if call_sid in _call_states:
            _call_states[call_sid]["interest_score"] = "hot"
        print(f"[voice-ai] HOT signal detected: {speech[:60]!r}", flush=True)


# ── Inbound call ──────────────────────────────────────────────────────────────────

@router.post("/api/calls/inbound")
async def inbound_call(request: Request) -> Response:
    """Telnyx TeXML webhook — answers inbound call with Myra AI voice agent.
    Always answers. Cartesia audio for greeting; falls back to Polly if unavailable."""
    call_sid = f"call_{_now()}"
    caller = ""
    try:
        form = await request.form()
        call_sid = _form_get(form, "CallSid", "call_control_id") or call_sid
        caller = _form_get(form, "From", "from_")
    except Exception:
        try:
            body = await request.json()
            data = body.get("data", {}).get("payload", body)
            call_sid = data.get("call_control_id", data.get("CallSid", call_sid))
            from_data = data.get("from", {})
            caller = from_data.get("phone_number", "") if isinstance(from_data, dict) else str(from_data)
        except Exception:
            pass

    # Always answer — no business hours check

    # Look up caller's property
    prop: dict = {}
    if caller:
        try:
            found = await _lookup_phone(caller)
            if found:
                prop = found
        except Exception:
            pass

    _call_states[call_sid] = {
        "caller": caller,
        "property_id": prop.get("id"),
        "offer_price": prop.get("offer_price"),
        "property_address": prop.get("situs_address") or prop.get("property_address") or "",
        "property_city": prop.get("situs_city") or prop.get("property_city") or "",
        "property_state": prop.get("situs_state") or prop.get("state") or "",
        "owner_name": prop.get("owner_full_name") or prop.get("owner_first_name") or "",
        "caller_name": None,
        "interest_score": "warm",
        "seller_asking_price": None,
        "callback_time": None,
        "transcript": [],          # legacy format for _finalize_call
        "ai_transcript": [],       # Claude messages format
        "exchange_count": 0,
        "silence_retries": 0,
        "started_at": _now(),
        "retries": {},
        "comm_id": None,
    }

    # Log call immediately so missed calls are always recorded
    try:
        comm = await _log_comm(
            property_id=prop.get("id"),
            comm_type="call_inbound",
            phone=caller,
            direction="inbound",
            call_id=call_sid,
            summary="Call in progress...",
        )
        if comm.get("id"):
            _call_states[call_sid]["comm_id"] = comm["id"]
    except Exception as exc:
        print(f"[comms] inbound log error: {exc}")

    # Play greeting instantly — use static cache (zero latency), fall back to Polly <Say>
    greeting_xml = _phrase("greeting")
    cached = "cache-hit" if _audio_path("greeting").exists() else "polly-fallback"
    print(f"[voice-ai] Greeting for {caller}: {cached}", flush=True)
    return _texml_gather("ai_response", greeting_xml, call_sid, with_recording=True)


# Compiled once at module level — NOT inside the request handler
_STOP_RE = re.compile(r"\b(stop|remove me|take me off|unsubscribe|do not call|don'?t call|don'?t contact)\b", re.I)
_WRONG_RE = re.compile(r"\b(wrong number|wrong person|don'?t own|not my|no property|who is this)\b", re.I)
_TRANSFER_RE = re.compile(
    r"\b(transfer me|connect me to someone|put me through|speak with a real person|talk to a real person|"
    r"real person please|get me a human|speak to a human|talk to a human|i want a human|i need a human|"
    r"talk to damien|speak to damien|get damien|get me damien|"
    r"talk to your manager|speak to your manager|get me your manager)\b",
    re.I,
)


@router.post("/api/calls/gather/{step}")
async def call_gather(step: str, request: Request, background_tasks: BackgroundTasks) -> Response:
    """Telnyx gather callback — Myra AI voice agent loop."""
    # Parse form (TeXML posts form data)
    call_sid = ""
    speech = ""
    timed_out = False
    try:
        form = await request.form()
        call_sid = _form_get(form, "CallSid", "call_control_id")
        speech = _form_get(form, "SpeechResult", "speech_result")
        # timedout may arrive as query param OR form field
        timed_out = (form.get("timedout") == "1") or (request.query_params.get("timedout") == "1")
    except Exception as exc:
        print(f"[voice-ai] gather parse error: {exc}", flush=True)

    print(f"[voice-ai] gather step={step} call_sid={call_sid!r} speech={speech[:60]!r} timed_out={timed_out}", flush=True)

    state = _call_states.get(call_sid, {})
    low = (speech or "").lower().strip()

    def _upd(**kw) -> None:
        state.update(kw)
        if call_sid in _call_states:
            _call_states[call_sid].update(kw)

    # ── Explicit STOP / opt-out ───────────────────────────────────────────
    if speech and _STOP_RE.search(low):
        caller = state.get("caller", "")
        prop_id = state.get("property_id")
        if prop_id:
            try:
                get_supabase().table("crm_properties").update(
                    {"opted_out": True, "sms_status": "opted_out", "updated_at": _now()}
                ).eq("id", prop_id).execute()
            except Exception:
                pass
        if caller:
            try:
                get_supabase().table("crm_sms_opt_out").upsert(
                    {"phone_number": caller, "opted_out_at": _now(), "source": "inbound_call"},
                    on_conflict="phone_number",
                ).execute()
            except Exception:
                pass
        _upd(interest_score="cold")
        background_tasks.add_task(_finalize_call, call_sid)
        return _texml_hangup(await _get_response_audio(_PHRASES["opt_out"]))

    # ── Wrong number ──────────────────────────────────────────────────────
    if speech and _WRONG_RE.search(low):
        background_tasks.add_task(_finalize_call, call_sid)
        return _texml_hangup(await _get_response_audio(_PHRASES["wrong_number"]))

    # ── Explicit live transfer request ONLY ──────────────────────────────
    if speech and _TRANSFER_RE.search(low):
        print(f"[voice-ai] Explicit transfer requested: {speech[:60]!r}", flush=True)
        return await _do_live_transfer(call_sid, state, background_tasks)

    # ── No speech / silence — ask again, never transfer ──────────────────
    if not speech:
        silence = state.get("silence_retries", 0) + 1
        _upd(silence_retries=silence)
        print(f"[voice-ai] Silence #{silence} for {call_sid}", flush=True)
        if silence >= 4:
            background_tasks.add_task(_finalize_call, call_sid)
            return _texml_hangup(await _get_response_audio(
                "Thank you for calling Dominion Land Group. We will follow up with you soon. Goodbye."
            ))
        if silence == 1:
            prompt = "I am sorry, I did not catch that. How can I help you today?"
        else:
            prompt = "Are you still there? How can I help you today?"
        return _texml_gather("ai_response", _say(prompt), call_sid)

    _upd(silence_retries=0)

    # ── Max exchanges — ask for callback time, then end ───────────────────
    exchanges = state.get("exchange_count", 0)
    if exchanges >= 8:
        handoff = "I want to make sure Damien follows up with you personally. What is the best time to reach you?"
        if exchanges >= 9:
            background_tasks.add_task(_finalize_call, call_sid)
            return _texml_hangup(await _get_response_audio(
                "Perfect. Damien will be in touch. Have a great day."
            ))
        _upd(exchange_count=exchanges + 1)
        return _texml_gather("ai_response", await _get_response_audio(handoff), call_sid)

    # ── Detect HOT interest ───────────────────────────────────────────────
    _detect_call_hot_signals(speech, state, call_sid)

    # ── Update transcripts ────────────────────────────────────────────────
    ai_transcript = state.setdefault("ai_transcript", [])
    ai_transcript.append({"role": "user", "content": speech})
    state.setdefault("transcript", []).append(
        {"step": "ai_response", "agent": "", "speech": speech, "timed_out": False}
    )

    # ── Call Claude AI ────────────────────────────────────────────────────
    ai_text = await _claude_call_response(speech, state)

    if not ai_text:
        # Claude unavailable — use scripted fallback, NEVER auto-transfer
        ai_text = _get_fallback_response()
        print(f"[voice-ai] Claude unavailable — using fallback: {ai_text[:60]!r}", flush=True)

    # ── Update transcript with assistant turn ────────────────────────────
    ai_transcript.append({"role": "assistant", "content": ai_text})
    _upd(exchange_count=exchanges + 1, ai_transcript=ai_transcript)

    # ── Generate audio (2 s cap → Polly fallback, Cartesia caches in bg) ─
    response_xml = await _get_response_audio(ai_text)

    # Pre-generate Cartesia for the "still there?" prompt in background —
    # it will be ready if the next gather fires after silence.
    asyncio.create_task(_tts_generate(_PHRASES["still_there"], "still_there"))

    return _texml_gather("ai_response", response_xml, call_sid)


# ── Recording status callback ────────────────────────────────────────────────────

@router.post("/api/calls/recording-status")
async def recording_status(request: Request) -> dict:
    """Receive Telnyx recording-ready webhook and store recording URL."""
    print("=== RECORDING WEBHOOK RECEIVED ===", flush=True)

    # Try JSON body first (Telnyx sends JSON webhooks)
    body: dict = {}
    try:
        body = await request.json()
        print(f"[recording] Full payload: {json.dumps(body, indent=2)}", flush=True)
        print(f"[recording] Top-level keys: {list(body.keys())}", flush=True)
    except Exception:
        # Fall back to form data (TeXML callbacks)
        try:
            form = await request.form()
            body = dict(form)
            print(f"[recording] Form keys: {list(body.keys())}", flush=True)
        except Exception as exc:
            print(f"[recording] Could not parse request: {exc}", flush=True)

    # Extract nested payload — Telnyx wraps in data.payload
    nested = body.get("data", {}).get("payload", {})

    recording_url = (
        nested.get("recording_url")
        or nested.get("public_recording_url")
        or (nested.get("recording_urls") or {}).get("mp3")
        or (nested.get("recording_urls") or {}).get("wav")
        or body.get("recording_url")
        or body.get("public_recording_url")
        or body.get("RecordingUrl")
        or (body.get("recording_urls") or {}).get("mp3")
        or (body.get("recording_urls") or {}).get("wav")
        or body.get("payload", {}).get("recording_url")
        or body.get("payload", {}).get("public_recording_url")
        or ""
    )

    call_sid = (
        nested.get("call_leg_id")
        or nested.get("call_control_id")
        or nested.get("call_session_id")
        or nested.get("CallSid")
        or body.get("call_leg_id")
        or body.get("call_control_id")
        or body.get("call_session_id")
        or body.get("CallSid")
        or body.get("payload", {}).get("call_leg_id")
        or body.get("payload", {}).get("call_control_id")
        or ""
    )

    print(f"[recording] Extracted call_sid={call_sid!r}", flush=True)
    print(f"[recording] Extracted recording_url={recording_url!r}", flush=True)

    if call_sid and recording_url:
        try:
            sb = get_supabase()
            # Match by call_id (stored as call_control_id or call_leg_id)
            r = sb.table("crm_communications").update(
                {"recording_url": recording_url}
            ).eq("call_id", call_sid).execute()
            affected = len(r.data) if r.data else 0
            print(f"[recording] Saved — call_id={call_sid} rows_updated={affected} url={recording_url}", flush=True)
            if affected == 0:
                # Try matching by call_session_id stored as call_id
                call_session = nested.get("call_session_id") or body.get("call_session_id", "")
                if call_session and call_session != call_sid:
                    r2 = sb.table("crm_communications").update(
                        {"recording_url": recording_url}
                    ).eq("call_id", call_session).execute()
                    print(f"[recording] Retry by call_session_id={call_session} rows_updated={len(r2.data or [])}", flush=True)
        except Exception as exc:
            print(f"[recording] DB error: {exc}", flush=True)
    else:
        print(f"[recording] Missing call_sid or recording_url — cannot save", flush=True)

    return {"status": "ok"}


# ── Telnyx call hangup webhook ───────────────────────────────────────────────────

@router.post("/api/calls/hangup")
async def call_hangup(request: Request) -> dict:
    """
    Receive Telnyx call.hangup event.
    Updates duration_seconds in crm_communications if not already set.
    This covers calls that end before _finalize_call runs (abrupt hangups).
    """
    call_sid = ""
    billing_secs: Optional[int] = None
    try:
        body = await request.json()
        payload = body.get("data", {}).get("payload", {})
        call_sid = payload.get("call_control_id", payload.get("call_session_id", ""))
        billing_secs = payload.get("billing_duration_secs") or payload.get("duration_secs")
        if billing_secs is not None:
            billing_secs = int(billing_secs)
    except Exception as exc:
        print(f"[comms] hangup parse error: {exc}")
        return {"status": "ok"}

    if call_sid:
        try:
            sb = get_supabase()
            existing = (
                sb.table("crm_communications")
                .select("id, duration_seconds, summary")
                .eq("call_id", call_sid)
                .execute()
            )
            if existing.data:
                row = existing.data[0]
                updates: dict = {}
                # Set duration if not already stored
                if billing_secs and not row.get("duration_seconds"):
                    updates["duration_seconds"] = billing_secs
                # If still "Call in progress..." the call ended before finalize ran
                if row.get("summary") == "Call in progress...":
                    duration = billing_secs or 0
                    if duration < 5:
                        updates["summary"] = "Missed call — caller hung up immediately"
                        updates["lead_score"] = None
                    else:
                        updates["summary"] = f"Call ended — duration {duration}s. Review manually."
                if updates:
                    sb.table("crm_communications").update(updates).eq("id", row["id"]).execute()
        except Exception as exc:
            print(f"[comms] hangup DB error: {exc}")

    return {"status": "ok"}


# ── Call finalization ────────────────────────────────────────────────────────────

async def _finalize_call(call_sid: str) -> None:
    state = _call_states.pop(call_sid, {})
    if not state:
        return

    transcript = state.get("transcript", [])
    property_id = state.get("property_id")
    caller = state.get("caller", "")
    interest_score = state.get("interest_score", "warm")
    caller_name = state.get("caller_name", "")
    seller_asking_price = state.get("seller_asking_price")
    callback_time_spoken = state.get("callback_time")
    prop_address = state.get("property_address", "")
    prop_city = state.get("property_city", "")
    prop_state_abbr = state.get("property_state", "")
    mgr = _get_acq_manager_name()

    # Compute call duration
    duration_seconds: Optional[int] = None
    started_at = state.get("started_at")
    if started_at:
        try:
            start = datetime.fromisoformat(started_at.replace("Z", "+00:00"))
            duration_seconds = max(0, int((datetime.now(timezone.utc) - start).total_seconds()))
        except Exception:
            pass

    transcript_text = "\n".join(
        f"[{t['step'].upper()}] Agent: {t.get('agent', t['step'])}\n"
        f"Caller: {t.get('speech', '[no response]')}"
        for t in transcript
    )

    # Use Claude for final scoring
    score, summary, disposition, callback_time = await _score_with_claude(transcript)
    if score == "warm" and interest_score == "hot":
        score = "hot"
    elif score == "warm" and interest_score == "cold":
        score = "cold"

    # Enrich summary
    parts = []
    if caller_name:
        parts.append(f"Name: {caller_name}")
    if prop_address:
        parts.append(f"Property: {' '.join(filter(None, [prop_address, prop_city, prop_state_abbr]))}")
    if seller_asking_price:
        parts.append(f"Asking: {seller_asking_price}")
    if callback_time_spoken:
        parts.append(f"Best time: {callback_time_spoken}")
    if parts:
        summary = ". ".join(parts) + ". " + summary

    callback_requested_at: Optional[str] = None
    cb_time = callback_time_spoken or callback_time
    if cb_time and disposition in ("CALLBACK_NEEDED", "INTERESTED"):
        callback_requested_at = f"{_now()[:10]} (caller said: {cb_time})"

    comm_id = state.get("comm_id")
    if comm_id:
        await _update_comm(
            comm_id,
            property_id=property_id,
            transcript=transcript_text,
            summary=summary,
            lead_score=score,
            duration_seconds=duration_seconds,
            disposition=disposition,
            callback_requested_at=callback_requested_at,
        )
    else:
        await _log_comm(
            property_id=property_id,
            comm_type="call_inbound",
            phone=caller,
            direction="inbound",
            transcript=transcript_text,
            summary=summary,
            lead_score=score,
            call_id=call_sid,
            duration_seconds=duration_seconds,
            disposition=disposition,
            callback_requested_at=callback_requested_at,
        )

    if property_id:
        try:
            sb = get_supabase()
            updates: dict = {"updated_at": _now()}

            if caller_name:
                existing = sb.table("crm_properties").select("owner_first_name,notes,tags").eq("id", property_id).execute()
                row = existing.data[0] if existing.data else {}
                if not row.get("owner_first_name"):
                    parts_name = caller_name.strip().split(" ", 1)
                    updates["owner_first_name"] = parts_name[0]
                    if len(parts_name) > 1:
                        updates["owner_last_name"] = parts_name[1]
            else:
                existing = sb.table("crm_properties").select("tags").eq("id", property_id).execute()
                row = existing.data[0] if existing.data else {}

            if seller_asking_price:
                try:
                    updates["seller_asking_price"] = float(re.sub(r"[^\d.]", "", seller_asking_price))
                except Exception:
                    pass

            if disposition == "INTERESTED" or score == "hot":
                updates["status"] = "prospect"
            elif disposition == "NOT_INTERESTED":
                updates["status"] = "due_diligence"
            elif score == "warm" and disposition not in ("NOT_INTERESTED", "WRONG_NUMBER"):
                updates["status"] = "prospect"

            existing_tags: list = (row.get("tags") if "row" in dir() else []) or []
            if isinstance(existing_tags, str):
                try:
                    existing_tags = json.loads(existing_tags)
                except Exception:
                    existing_tags = []
            new_tags = list(existing_tags)
            _tag_map = {
                "INTERESTED": "hot_lead",
                "NOT_INTERESTED": "not_interested",
                "WRONG_NUMBER": "wrong_number",
                "CALLBACK_NEEDED": "callback_requested",
            }
            if disposition in _tag_map:
                tag = _tag_map[disposition]
                if tag not in new_tags:
                    new_tags.append(tag)
            if score == "hot" and "hot_lead" not in new_tags:
                new_tags.append("hot_lead")
            if "attempted" not in new_tags:
                new_tags.append("attempted")
            if new_tags != existing_tags:
                updates["tags"] = new_tags

            sb.table("crm_properties").update(updates).eq("id", property_id).execute()
        except Exception as exc:
            print(f"[comms] property update error: {exc}")

    if score == "hot" or disposition == "INTERESTED":
        prop_data: dict = {}
        try:
            if property_id:
                r = get_supabase().table("crm_properties").select("*").eq("id", property_id).execute()
                prop_data = r.data[0] if r.data else {}
            elif caller:
                # Re-lookup by phone in case initial lookup missed it
                found2 = await _lookup_phone(caller)
                if found2:
                    prop_data = found2
                    property_id = found2.get("id")
        except Exception:
            pass

        # Skip HOT alert if caller can't be identified at all
        if not property_id and not (prop_data.get("owner_full_name") or caller_name):
            print(f"[voice-ai] HOT alert skipped — no property match for {caller}", flush=True)
        else:
            owner = prop_data.get("owner_full_name") or caller_name or "Unknown"
            address_disp = " ".join(filter(None, [
                prop_data.get("situs_address") or prop_address,
                prop_data.get("situs_city") or prop_city,
                prop_data.get("situs_state") or prop_state_abbr,
            ]))
            apn = prop_data.get("apn", "")
            county = prop_data.get("county", "")
            offer = prop_data.get("offer_price")
            offer_str = f"${int(offer):,}" if offer else "N/A"
            asking_str = seller_asking_price or "not stated"
            cb_display = callback_time_spoken or callback_time or "not stated"

            # SMS to Damien
            try:
                api_key = _telnyx_key()
                from_phone_e164 = _telnyx_phone()
                if api_key and from_phone_e164:
                    raw = re.sub(r"\D", "", from_phone_e164)
                    from_e164 = f"+1{raw}" if len(raw) == 10 else (f"+{raw}" if len(raw) == 11 else from_phone_e164)
                    sms_body = (
                        f"HOT LEAD\n"
                        f"Name: {owner}\n"
                        f"Property: {address_disp or apn or 'unknown'}\n"
                        f"Asking: {asking_str}\n"
                        f"Best time: {cb_display}\n"
                        f"View: https://land-dominator-frontend-production.up.railway.app/inbox"
                    )
                    payload: dict = {"from": from_e164, "to": "+12023215846", "text": sms_body}
                    profile_id = os.getenv("TELNYX_MESSAGING_PROFILE_ID", "")
                    if profile_id:
                        payload["messaging_profile_id"] = profile_id
                    async with httpx.AsyncClient(timeout=15) as client:
                        await client.post(
                            "https://api.telnyx.com/v2/messages",
                            json=payload,
                            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                        )
            except Exception as exc:
                print(f"[comms] HOT call alert SMS error: {exc}")

            # Auto-create deal
            try:
                sb = get_supabase()
                if property_id:
                    existing_deal = sb.table("crm_deals").select("id").eq("property_id", property_id).limit(1).execute()
                    if not existing_deal.data:
                        deal_title = " — ".join(filter(None, [owner, apn, county])).strip(" —")
                        offer_low = round(float(offer) * 0.90 / 1000) * 1000 if offer else None
                        offer_high = round(float(offer) * 1.15 / 1000) * 1000 if offer else None
                        sb.table("crm_deals").insert({
                            "title": deal_title or "Unknown Property",
                            "property_id": property_id,
                            "stage": "new_lead",
                            "value": float(offer) if offer else None,
                            "owner_name": owner,
                            "property_address": address_disp,
                            "offer_price": float(offer) if offer else None,
                            "offer_low": offer_low,
                            "offer_high": offer_high,
                            "source": "CALL",
                            "seller_phone": caller,
                            "stage_entered_at": _now(),
                            "notes": f"Auto-created from HOT call. Asking: {asking_str}. Best time: {cb_display}",
                            "tags": ["call", "hot_lead"],
                            "updated_at": _now(),
                        }).execute()
            except Exception as exc:
                print(f"[comms] auto-create deal (call) error: {exc}")

            html = (
                f"<h2 style='color:#B71C1C'>🔥 HOT LEAD — Inbound Call</h2>"
                f"<ul>"
                f"<li><strong>Name:</strong> {owner}</li>"
                f"<li><strong>Phone:</strong> {caller}</li>"
                f"<li><strong>Property:</strong> {address_disp or apn or '—'}</li>"
                f"<li><strong>County:</strong> {county}</li>"
                f"<li><strong>Our Offer Range:</strong> {offer_str}</li>"
                f"<li><strong>Seller Asking:</strong> {asking_str}</li>"
                f"<li><strong>Best Callback Time:</strong> {cb_display}</li>"
                f"</ul>"
                f"<p><strong>Summary:</strong> {summary}</p>"
                f"<p><a href='https://land-dominator-frontend-production.up.railway.app/inbox'>Open Seller Inbox →</a></p>"
            )
            subject = f"🔥 HOT LEAD — {owner} — {address_disp or county}"
            await _notify_email(subject, html)
            await _notify_email(subject, html, to_email="dominionlandgroup@gmail.com")


async def _finalize_unmatched_call(call_sid: str) -> None:
    state = _call_states.pop(call_sid, {})
    if not state:
        return
    caller = state.get("caller", "")
    info = state.get("unmatched_info", "")
    caller_name = state.get("caller_name") or ""
    transcript = state.get("transcript", [])
    transcript_text = "\n".join(
        f"[{t['step'].upper()}] Agent: {t.get('agent', t['step'])}\nCaller: {t.get('speech', '[no response]')}"
        for t in transcript
    )

    # Compute call duration
    duration_seconds: Optional[int] = None
    started_at = state.get("started_at")
    if started_at:
        try:
            start = datetime.fromisoformat(started_at.replace("Z", "+00:00"))
            duration_seconds = max(0, int((datetime.now(timezone.utc) - start).total_seconds()))
        except Exception:
            pass

    prop = await _create_unmatched_lead(caller, caller_name=caller_name, property_address=info)
    property_id = prop.get("id")

    # Tag unmatched lead
    if property_id:
        try:
            get_supabase().table("crm_properties").update(
                {"tags": ["attempted"], "updated_at": _now()}
            ).eq("id", property_id).execute()
        except Exception:
            pass

    detail = info or caller_name or "N/A"
    comm_id = state.get("comm_id")
    summary_text = f"Could not match to property. Caller provided: {detail}. Next action: Review manually."
    if comm_id:
        await _update_comm(
            comm_id,
            property_id=property_id,
            transcript=transcript_text,
            summary=summary_text,
            lead_score="cold",
            duration_seconds=duration_seconds,
            disposition="MAYBE",
        )
    else:
        await _log_comm(
            property_id=property_id,
            comm_type="call_inbound",
            phone=caller,
            direction="inbound",
            transcript=transcript_text,
            summary=summary_text,
            lead_score="cold",
            call_id=call_sid,
            duration_seconds=duration_seconds,
            disposition="MAYBE",
        )


# ── Inbound SMS ──────────────────────────────────────────────────────────────────

@router.post("/api/sms/inbound")
async def inbound_sms(request: Request, background_tasks: BackgroundTasks) -> dict:
    from_phone = ""
    to_phone = ""
    message_text = ""
    try:
        body = await request.json()
        payload = body.get("data", {}).get("payload", body)
        from_data = payload.get("from", {})
        from_phone = from_data.get("phone_number", "") if isinstance(from_data, dict) else str(from_data)
        message_text = payload.get("text", payload.get("body", ""))
        # Extract which Telnyx number received this message — use it for the reply
        to_data = payload.get("to", [])
        if isinstance(to_data, list) and to_data:
            first_to = to_data[0]
            to_phone = first_to.get("phone_number", "") if isinstance(first_to, dict) else str(first_to)
        elif isinstance(to_data, dict):
            to_phone = to_data.get("phone_number", "")
        elif isinstance(to_data, str):
            to_phone = to_data
    except Exception:
        try:
            form = await request.form()
            from_phone = _form_get(form, "From", "from_")
            message_text = _form_get(form, "Body", "text")
            to_phone = _form_get(form, "To", "to_")
        except Exception:
            pass

    # Fall back to primary number if we couldn't determine which number received it
    if not to_phone:
        to_phone = os.getenv("TELNYX_PHONE_NUMBER", "")

    print(f"=== INBOUND SMS: from={from_phone} to={to_phone} msg={message_text[:200]!r}", flush=True)

    if from_phone:
        background_tasks.add_task(_process_inbound_sms, from_phone, message_text, to_phone)
    else:
        print("[sms] WARNING: inbound SMS has no from_phone — ignoring", flush=True)
    return {"status": "ok"}


_SMS_HOT_WORDS = {"YES", "INTERESTED", "HOW", "WHAT", "TELL", "MAYBE", "SURE", "INFO", "DETAILS", "YEAH", "YEP", "OK", "OKAY", "ACCEPT", "WANT", "READY", "SELL"}
_SMS_STOP_WORDS = {"STOP", "UNSUBSCRIBE", "REMOVE", "CANCEL", "END", "QUIT"}

# ── AI SMS Bot (Claude-powered) ──────────────────────────────────────────────

_CLAUDE_SMS_MODEL = os.getenv("CLAUDE_SMS_MODEL", "claude-sonnet-4-6")
_DAMIEN_PHONE = "+12023215846"
_SMS_MAX_EXCHANGES = 5  # max back-and-forth before handoff
_SMS_BOT_ENABLED = os.getenv("SMS_BOT_ENABLED", "false").lower() == "true"

# Dedup guard: phone -> epoch float of last reply attempt; skip if < 30s ago
_sms_reply_inflight: dict = {}


def _to_e164(phone: str) -> str:
    d = re.sub(r"\D", "", phone)
    if len(d) == 10:
        return f"+1{d}"
    if len(d) == 11 and d.startswith("1"):
        return f"+{d}"
    return phone


async def _send_sms_reply(api_key: str, from_phone: str, to_phone: str, text: str) -> bool:
    """Send a single SMS via Telnyx. Returns True on success."""
    try:
        payload: dict = {"from": _to_e164(from_phone), "to": _to_e164(to_phone), "text": text}
        profile_id = os.getenv("TELNYX_MESSAGING_PROFILE_ID", "")
        if profile_id:
            payload["messaging_profile_id"] = profile_id
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.post(
                "https://api.telnyx.com/v2/messages",
                json=payload,
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            )
            print(f"[ai-sms] send to {to_phone} → HTTP {r.status_code}", flush=True)
            return r.status_code < 300
    except Exception as exc:
        print(f"[ai-sms] send error: {exc}", flush=True)
        return False


async def _ai_sms_reply(
    from_phone: str,
    message_text: str,
    prop: dict,
    property_id: Optional[str],
    received_on: str = "",
) -> None:
    """Generate a Claude AI reply and send it back via SMS. Rate-limited to _SMS_MAX_EXCHANGES."""
    import anthropic as _anthropic

    api_key = _telnyx_key()
    # Reply FROM the same number that received the inbound message.
    # Falls back to the primary TELNYX_PHONE_NUMBER if unknown.
    telnyx_from = prop.get("sms_from_number") or received_on or _telnyx_phone()
    anthropic_key = os.getenv("ANTHROPIC_API_KEY", "")

    print(f"[sms-bot] Replying from {telnyx_from} to {from_phone}", flush=True)

    if not api_key or not telnyx_from:
        print("[ai-sms] missing TELNYX config — skipping AI reply", flush=True)
        return
    if not anthropic_key:
        print("[ai-sms] missing ANTHROPIC_API_KEY — skipping AI reply", flush=True)
        return

    sb = get_supabase()
    norm_phone = _normalize_phone(from_phone)

    # --- Get conversation history for this phone ---
    history_rows: list[dict] = []
    try:
        h_r = (
            sb.table("crm_communications")
            .select("direction,message_body,created_at")
            .eq("phone_number", norm_phone)
            .in_("type", ["sms_inbound", "sms_outbound"])
            .order("created_at", desc=False)
            .limit(30)
            .execute()
        )
        history_rows = h_r.data or []
    except Exception as exc:
        print(f"[ai-sms] history fetch error: {exc}", flush=True)

    # --- Rate limit: count AI outbound replies already sent ---
    outbound_count = sum(1 for r in history_rows if r.get("direction") == "outbound")
    if outbound_count >= _SMS_MAX_EXCHANGES:
        handoff = "I'll have Damien reach out to you directly. What's the best time to reach you?"
        await _send_sms_reply(api_key, telnyx_from, from_phone, handoff)
        await _log_comm(
            property_id=property_id, comm_type="sms_outbound", phone=from_phone,
            direction="outbound", message_body=handoff,
        )
        print(f"[ai-sms] rate limit ({outbound_count} exchanges) for {from_phone} — sent handoff", flush=True)
        return

    # --- Format conversation history ---
    history_lines = []
    for r in history_rows:
        body = (r.get("message_body") or "").strip()
        if not body:
            continue
        role = "Seller" if r.get("direction") == "inbound" else "Myra"
        history_lines.append(f"{role}: {body}")
    conversation_history = "\n".join(history_lines) if history_lines else "(no prior messages)"

    # --- Build property context ---
    address = prop.get("property_address") or prop.get("situs_address") or ""
    city = prop.get("property_city") or prop.get("situs_city") or prop.get("city") or ""
    state_abbr = prop.get("state") or prop.get("situs_state") or ""
    county = prop.get("county") or ""
    acreage = prop.get("acreage")
    offer_price = float(prop.get("offer_price") or 0)
    offer_low = int(offer_price * 0.90 / 1000) * 1000 if offer_price else 0
    offer_high = int(offer_price * 1.10 / 1000) * 1000 if offer_price else 0
    full_address = " ".join(filter(None, [address, city, state_abbr])) or "their property"

    prop_block = (
        f"Their property info:\n"
        f"- Address: {full_address}\n"
        + (f"- County: {county}, {state_abbr}\n" if county else "")
        + (f"- Acreage: {acreage} acres\n" if acreage else "")
        + (f"- Our price range: ${offer_low:,} to ${offer_high:,}\n" if offer_low and offer_high else "")
    )

    system_prompt = (
        f"You are Myra, a friendly acquisition assistant for Dominion Land Group.\n"
        f"You are having a text conversation with a land owner.\n\n"
        f"{prop_block}\n"
        f"Your goal:\n"
        f"1. Qualify their interest in selling\n"
        f"2. Get their asking price if they have one\n"
        f"3. Schedule a callback with Damien\n"
        f"4. Disqualify politely if not interested\n\n"
        f"Rules:\n"
        f"- Keep responses SHORT — this is SMS, max 2 sentences\n"
        f"- Never give an exact offer price — always give a range\n"
        f"- Never say 'cash offer' or use spam trigger words\n"
        f"- If they want to talk now, say Damien can call them\n"
        f"- If they say STOP, immediately say you will remove them and stop replying\n"
        f"- Be warm and natural, not robotic\n"
        f"- If they ask something you can't answer, say Damien will call them\n\n"
        f"Conversation history:\n{conversation_history}\n\n"
        f"Latest message from seller: {message_text}\n\n"
        f"Respond naturally in 1-2 sentences max."
    )

    # --- Call Claude API (sync client in thread pool) ---
    ai_response = ""
    try:
        def _call_claude() -> str:
            client = _anthropic.Anthropic(api_key=anthropic_key)
            msg = client.messages.create(
                model=_CLAUDE_SMS_MODEL,
                max_tokens=150,
                messages=[{"role": "user", "content": system_prompt}],
            )
            return next((b.text for b in msg.content if hasattr(b, "text")), "").strip()

        ai_response = await asyncio.to_thread(_call_claude)
        print(f"[ai-sms] Claude → {from_phone}: {ai_response[:120]!r}", flush=True)
    except Exception as exc:
        print(f"[ai-sms] Claude API error: {exc}", flush=True)
        return

    if not ai_response:
        print(f"[ai-sms] empty Claude response — not sending", flush=True)
        return

    # --- Send reply via Telnyx ---
    sent = await _send_sms_reply(api_key, telnyx_from, from_phone, ai_response)
    if not sent:
        return

    # --- Log outbound AI reply ---
    await _log_comm(
        property_id=property_id, comm_type="sms_outbound", phone=from_phone,
        direction="outbound", message_body=ai_response,
    )

    # --- Detect outcomes from seller's message ---
    await _detect_sms_ai_outcomes(from_phone, message_text, ai_response, prop, property_id, sb)


async def _detect_sms_ai_outcomes(
    from_phone: str,
    seller_msg: str,
    ai_response: str,
    prop: dict,
    property_id: Optional[str],
    sb,
) -> None:
    """Detect HOT, asking price, callback time from seller message and update DB."""
    if not property_id:
        return

    msg_lower = seller_msg.lower()

    # --- Detect asking price (e.g. "$50,000", "50k", "want 45000") ---
    asking_price: Optional[float] = None
    price_m = re.search(r"\$[\d,]+(?:k)?|\b(\d{2,3})[,.]?000\b|\b(\d+)k\b", seller_msg, re.IGNORECASE)
    if price_m:
        raw = price_m.group(0).replace("$", "").replace(",", "").lower()
        try:
            if raw.endswith("k"):
                asking_price = float(raw[:-1]) * 1000
            else:
                asking_price = float(raw)
            if asking_price < 100:
                asking_price = None  # likely not a real price
        except Exception:
            asking_price = None

    # --- Detect callback time ---
    callback_words = [
        "call me", "call back", "reach me", "tomorrow", "monday", "tuesday",
        "wednesday", "thursday", "friday", "morning", "afternoon", "evening",
        "anytime", "best time", "9am", "10am", "11am", "noon", "1pm", "2pm",
        "3pm", "4pm", "5pm", "this week", "next week",
    ]
    has_callback = any(w in msg_lower for w in callback_words)

    # --- Detect confirmed interest ---
    interest_words = [
        "interested", "yes", "sure", "okay", "yeah", "tell me", "how much",
        "what's your offer", "what is your offer", "sell", "consider", "maybe",
        "possibly", "sounds good", "let's talk", "lets talk", "go ahead",
    ]
    has_interest = any(w in msg_lower for w in interest_words)

    is_hot = has_callback or has_interest

    updates: dict = {"updated_at": _now()}

    if asking_price:
        try:
            updates["seller_asking_price"] = asking_price
        except Exception:
            pass
        print(f"[ai-sms] asking price ${asking_price:,.0f} detected for {from_phone}", flush=True)

    if is_hot:
        updates["status"] = "prospect"
        updates["sms_status"] = "hot"
        print(f"[ai-sms] HOT detected for {from_phone} — interest={has_interest} callback={has_callback}", flush=True)
    elif prop.get("sms_status") in ("day1_sent", "day3_sent"):
        updates["sms_status"] = "replied"
        try:
            prop_r = sb.table("crm_properties").select("tags").eq("id", property_id).single().execute()
            existing_tags = (prop_r.data or {}).get("tags") or []
            if "hot_lead" not in existing_tags:
                updates["tags"] = list(existing_tags) + ["hot_lead"]
        except Exception:
            pass

    if len(updates) > 1:
        try:
            sb.table("crm_properties").update(updates).eq("id", property_id).execute()
        except Exception as exc:
            print(f"[ai-sms] property update error: {exc}", flush=True)

    if is_hot:
        # Auto-create deal if none exists
        try:
            existing = sb.table("crm_deals").select("id").eq("property_id", property_id).limit(1).execute()
            if not existing.data:
                owner = prop.get("owner_full_name") or prop.get("owner_first_name") or "Unknown"
                apn = prop.get("apn", "")
                county = prop.get("county", "")
                op = prop.get("offer_price")
                deal_val = asking_price or (float(op) if op else None)
                offer_l = round(float(op) * 0.90 / 1000) * 1000 if op else None
                offer_h = round(float(op) * 1.10 / 1000) * 1000 if op else None
                addr = prop.get("property_address") or prop.get("situs_address") or ""
                sb.table("crm_deals").insert({
                    "title": f"{owner} — {apn} — {county}".strip(" —"),
                    "property_id": property_id,
                    "stage": "contacted",
                    "value": deal_val,
                    "owner_name": owner,
                    "property_address": addr,
                    "offer_price": float(op) if op else None,
                    "offer_low": offer_l,
                    "offer_high": offer_h,
                    "source": "AI SMS",
                    "seller_phone": from_phone,
                    "stage_entered_at": _now(),
                    "notes": f"AI SMS qualified. Seller said: {seller_msg}"
                    + (f"\nAsking price: ${asking_price:,.0f}" if asking_price else ""),
                    "tags": ["sms", "hot_lead", "ai_qualified"],
                    "updated_at": _now(),
                }).execute()
                print(f"[ai-sms] deal created for {from_phone}", flush=True)
        except Exception as exc:
            print(f"[ai-sms] deal creation error: {exc}", flush=True)

        # HOT alert to Damien
        try:
            api_key = _telnyx_key()
            telnyx_from = _telnyx_phone()
            if api_key and telnyx_from:
                owner = prop.get("owner_full_name") or prop.get("owner_first_name") or "Unknown"
                apn = prop.get("apn", "")
                addr = prop.get("property_address") or prop.get("situs_address") or ""
                op = prop.get("offer_price")
                price_str = (
                    f"${int(asking_price):,} (their ask)" if asking_price
                    else (f"${int(op):,} (our offer)" if op else "TBD")
                )
                alert = "\n".join(filter(None, [
                    f"🔥 HOT SMS LEAD — {owner}",
                    f"Property: {addr or apn}",
                    f"Their message: {seller_msg}",
                    f"Price: {price_str}",
                    f"https://land-dominator-frontend-production.up.railway.app/inbox",
                ]))
                async with httpx.AsyncClient(timeout=15) as client:
                    await client.post(
                        "https://api.telnyx.com/v2/messages",
                        json={"from": _to_e164(telnyx_from), "to": _DAMIEN_PHONE, "text": alert},
                        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                    )
                print(f"[ai-sms] HOT alert sent to Damien for {from_phone}", flush=True)
        except Exception as exc:
            print(f"[ai-sms] HOT alert send error: {exc}", flush=True)


async def _process_inbound_sms(from_phone: str, message_text: str, received_on: str = "") -> None:
    import time as _time
    # Dedup: if we already handled a message from this number in the last 30s, skip
    _now_f = _time.time()
    _last = _sms_reply_inflight.get(from_phone, 0)
    if _now_f - _last < 30:
        print(f"[sms-bot] SKIP duplicate from {from_phone} — already handled {_now_f - _last:.1f}s ago", flush=True)
        return
    _sms_reply_inflight[from_phone] = _now_f
    # Prune stale entries to avoid unbounded growth
    stale = [k for k, v in _sms_reply_inflight.items() if _now_f - v > 120]
    for k in stale:
        _sms_reply_inflight.pop(k, None)

    print(f"[sms-bot] Inbound from {from_phone}: {message_text!r}", flush=True)
    print(f"[sms-bot] Looking up property...", flush=True)
    prop = await _lookup_phone(from_phone)
    if not prop:
        prop = {"id": None}

    property_id = prop.get("id")
    print(f"[sms-bot] Property found: {property_id is not None} (id={property_id})", flush=True)
    await _log_comm(
        property_id=property_id,
        comm_type="sms_inbound",
        phone=from_phone,
        direction="inbound",
        message_body=message_text,
    )

    msg_up = message_text.upper().strip()
    words = set(re.split(r"\W+", msg_up))

    is_stop = bool(words & _SMS_STOP_WORDS) or any(w in msg_up for w in _SMS_STOP_WORDS)
    is_hot = not is_stop and bool(words & _SMS_HOT_WORDS)

    sb = get_supabase()

    if is_stop:
        # Add to suppression list
        try:
            sb.table("crm_sms_opt_out").upsert(
                {"phone_number": from_phone, "opted_out_at": _now(), "source": "sms_reply"},
                on_conflict="phone_number",
            ).execute()
        except Exception:
            pass
        # Mark property as opted_out
        if property_id:
            try:
                sb.table("crm_properties").update(
                    {"opted_out": True, "sms_status": "opted_out", "updated_at": _now()}
                ).eq("id", property_id).execute()
            except Exception:
                pass

    elif is_hot and property_id:
        # Flag as HOT: update status + sms_status + add tag
        try:
            prop_r = sb.table("crm_properties").select("tags").eq("id", property_id).single().execute()
            existing_tags = prop_r.data.get("tags") or [] if prop_r.data else []
            if "hot_lead" not in existing_tags:
                existing_tags = list(existing_tags) + ["hot_lead"]
            sb.table("crm_properties").update({
                "status": "prospect",
                "sms_status": "hot",
                "tags": existing_tags,
                "updated_at": _now(),
            }).eq("id", property_id).execute()
        except Exception:
            pass

        # Auto-create a deal if one doesn't exist for this property yet
        try:
            existing_deal = sb.table("crm_deals").select("id").eq("property_id", property_id).limit(1).execute()
            if not existing_deal.data:
                owner_name = prop.get("owner_full_name") or prop.get("owner_first_name") or "Unknown"
                deal_title = f"{owner_name} — {prop.get('apn', '')} — {prop.get('county', '')}"
                offer_price = prop.get("offer_price") or prop.get("comp_derived_value")
                address = prop.get("situs_address") or prop.get("property_address") or ""
                city = prop.get("situs_city") or prop.get("city") or ""
                state_abbr = prop.get("situs_state") or prop.get("state") or ""
                address_disp = " ".join(filter(None, [address, city, state_abbr]))
                offer_low = round(float(offer_price) * 0.90 / 1000) * 1000 if offer_price else None
                offer_high = round(float(offer_price) * 1.15 / 1000) * 1000 if offer_price else None
                sb.table("crm_deals").insert({
                    "title": deal_title.strip(" —"),
                    "property_id": property_id,
                    "stage": "new_lead",
                    "value": float(offer_price) if offer_price else None,
                    "owner_name": owner_name,
                    "property_address": address_disp,
                    "offer_price": float(offer_price) if offer_price else None,
                    "offer_low": offer_low,
                    "offer_high": offer_high,
                    "source": "SMS",
                    "seller_phone": from_phone,
                    "stage_entered_at": _now(),
                    "notes": f"Auto-created from HOT SMS reply: {message_text}",
                    "tags": ["sms", "hot_lead"],
                    "updated_at": _now(),
                }).execute()
        except Exception as exc:
            print(f"[comms] auto-create deal error: {exc}")

    # --- AI SMS reply (disabled — set SMS_BOT_ENABLED=true to re-enable) ---
    if not _SMS_BOT_ENABLED:
        print(f"[sms-bot] DISABLED (SMS_BOT_ENABLED=false) — message logged, no reply sent", flush=True)
    elif not is_stop:
        print(f"[sms-bot] Calling Claude AI (model={_CLAUDE_SMS_MODEL})...", flush=True)
        try:
            await _ai_sms_reply(from_phone, message_text, prop, property_id, received_on=received_on)
            print(f"[sms-bot] AI reply sent to {from_phone}", flush=True)
        except Exception as exc:
            print(f"[sms-bot] AI SMS reply error: {exc}", flush=True)
    else:
        print(f"[sms-bot] STOP word detected — no AI reply sent", flush=True)

    owner = prop.get("owner_full_name") or prop.get("owner_first_name") or "Unknown"
    apn = prop.get("apn", "")
    county = prop.get("county", "")
    code = prop.get("campaign_code", "")
    address = prop.get("situs_address") or prop.get("property_address") or ""
    city = prop.get("situs_city") or prop.get("city") or ""
    state = prop.get("situs_state") or prop.get("state") or ""
    offer_price = prop.get("offer_price")
    location = ", ".join(filter(None, [city, state]))
    address_full = " ".join(filter(None, [address, location]))

    if is_hot:
        # SMS alert to Damien
        try:
            api_key = _telnyx_key()
            from_phone_e164 = _telnyx_phone()
            if api_key and from_phone_e164:
                price_str = f"${int(offer_price):,}" if offer_price else "TBD"
                sms_body = (
                    f"🔥 HOT LEAD - {owner} replied to your offer on {address_full or apn}\n"
                    f"Offer: {price_str} | Their reply: {message_text}\n"
                    f"Open Seller Inbox: https://land-dominator-frontend-production.up.railway.app/inbox"
                )
                raw = re.sub(r"\D", "", from_phone_e164)
                from_e164 = f"+1{raw}" if len(raw) == 10 else (f"+{raw}" if len(raw) == 11 else from_phone_e164)
                payload: dict = {"from": from_e164, "to": "+12023215846", "text": sms_body}
                profile_id = os.getenv("TELNYX_MESSAGING_PROFILE_ID", "")
                if profile_id:
                    payload["messaging_profile_id"] = profile_id
                async with httpx.AsyncClient(timeout=15) as client:
                    await client.post(
                        "https://api.telnyx.com/v2/messages",
                        json=payload,
                        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                    )
        except Exception as exc:
            print(f"[comms] HOT alert SMS error: {exc}")

    if is_stop:
        subject = f"🚫 STOP Reply — {owner} — {apn}"
        status_html = "<p style='color:#DC2626;font-weight:bold'>✗ Opted out — added to suppression list</p>"
    elif is_hot:
        subject = f"🔥 HOT Response — {owner} — {apn}"
        status_html = "<p style='color:#2E7D32;font-weight:bold'>✅ HOT — Status set to Prospect, tagged hot_lead, deal created</p>"
    else:
        subject = f"SMS Reply — {owner} — {apn}"
        status_html = ""

    price_display = f"${int(offer_price):,}" if offer_price else "—"
    html = (
        "<h2>Inbound SMS Reply</h2>"
        f"<ul>"
        f"<li><strong>From:</strong> {from_phone}</li>"
        f"<li><strong>Owner:</strong> {owner}</li>"
        f"<li><strong>APN:</strong> {apn}</li>"
        f"<li><strong>Address:</strong> {address_full or '—'}</li>"
        f"<li><strong>County:</strong> {county}</li>"
        f"<li><strong>Offer Price:</strong> {price_display}</li>"
        f"<li><strong>Campaign Code:</strong> {code}</li>"
        f"</ul>"
        f"<p><strong>Message:</strong> {message_text}</p>"
        + status_html
        + "<p><a href='https://land-dominator-frontend-production.up.railway.app/inbox'>Open Seller Inbox →</a></p>"
    )
    # Always send to admin; for HOT leads also send to dominionlandgroup@gmail.com
    await _notify_email(subject, html)
    if is_hot:
        await _notify_email(subject, html, to_email="dominionlandgroup@gmail.com")


# ── Outbound SMS ─────────────────────────────────────────────────────────────────

class SmsSendRequest(BaseModel):
    property_id: Optional[str] = None
    to_phone: str
    message: str


@router.post("/crm/sms/send")
async def send_sms(body: SmsSendRequest) -> dict:
    api_key = _telnyx_key()
    from_phone = _telnyx_phone()
    if not api_key:
        raise HTTPException(status_code=503, detail="TELNYX_API_KEY not configured")
    if not from_phone:
        raise HTTPException(status_code=503, detail="TELNYX_PHONE_NUMBER not configured")

    # Ensure E.164 format (+1XXXXXXXXXX)
    raw = re.sub(r"\D", "", from_phone)
    if len(raw) == 10:
        from_phone = f"+1{raw}"
    elif len(raw) == 11 and raw.startswith("1"):
        from_phone = f"+{raw}"
    # else trust whatever was configured

    # Normalize to-number to E.164
    to_digits = re.sub(r"\D", "", body.to_phone)
    if len(to_digits) == 10:
        to_phone_e164 = f"+1{to_digits}"
    elif len(to_digits) == 11 and to_digits.startswith("1"):
        to_phone_e164 = f"+{to_digits}"
    else:
        to_phone_e164 = body.to_phone  # pass through and let Telnyx reject with clear error

    try:
        payload: dict = {"from": from_phone, "to": to_phone_e164, "text": body.message}
        profile_id = os.getenv("TELNYX_MESSAGING_PROFILE_ID", "")
        if profile_id:
            payload["messaging_profile_id"] = profile_id
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.post(
                "https://api.telnyx.com/v2/messages",
                json=payload,
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            )
            if r.status_code >= 400:
                err_text = r.text
                print(f"[comms] SMS send error {r.status_code}: {err_text}")
                # Parse Telnyx error code for a user-friendly message
                try:
                    err_json = r.json()
                    telnyx_code = err_json.get("errors", [{}])[0].get("code", "")
                except Exception:
                    telnyx_code = ""
                if telnyx_code == "40013" or "40013" in err_text:
                    raise HTTPException(
                        status_code=400,
                        detail=(
                            "SMS failed: Your Telnyx number needs to be enabled for messaging. "
                            "Go to Telnyx portal → Numbers → your number → enable SMS/MMS."
                        ),
                    )
                raise HTTPException(status_code=r.status_code, detail=f"Telnyx: {err_text[:300]}")
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    comm = await _log_comm(
        property_id=body.property_id,
        comm_type="sms_outbound",
        phone=body.to_phone,
        direction="outbound",
        message_body=body.message,
    )
    return {"sent": True, "communication_id": comm.get("id")}


# ── List / stats ──────────────────────────────────────────────────────────────────

@router.get("/crm/communications")
async def list_communications(
    property_id: Optional[str] = Query(None),
    comm_type: Optional[str] = Query(None),
    lead_score: Optional[str] = Query(None),
    limit: int = Query(200),
) -> list:
    sb = get_supabase()
    try:
        q = (
            sb.table("crm_communications")
            .select("*")
            .order("created_at", desc=True)
            .limit(limit)
        )
        if property_id:
            q = q.eq("property_id", property_id)
        if comm_type:
            q = q.eq("type", comm_type)
        if lead_score:
            q = q.eq("lead_score", lead_score)
        comms = q.execute().data

        prop_ids = list({c["property_id"] for c in comms if c.get("property_id")})
        prop_map: dict = {}
        if prop_ids:
            props = (
                sb.table("crm_properties")
                .select("id,owner_full_name,owner_first_name,owner_last_name,apn,county,state,campaign_code,offer_price,owner_phone")
                .in_("id", prop_ids)
                .execute()
                .data
            )
            prop_map = {p["id"]: p for p in props}
        for c in comms:
            c["property"] = prop_map.get(c.get("property_id") or "", {})
        return comms
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/crm/properties/{property_id}/communications")
async def list_property_communications(property_id: str) -> list:
    sb = get_supabase()
    try:
        r = (
            sb.table("crm_communications")
            .select("*")
            .eq("property_id", property_id)
            .order("created_at", desc=True)
            .execute()
        )
        return r.data
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/crm/communications/stats")
async def communication_stats() -> dict:
    sb = get_supabase()
    try:
        week_ago = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
        all_c = sb.table("crm_communications").select("type,lead_score,created_at,duration_seconds").execute().data
        calls = [c for c in all_c if (c.get("type") or "").startswith("call")]
        texts = [c for c in all_c if (c.get("type") or "").startswith("sms")]
        hot_week = sum(1 for c in all_c if c.get("lead_score") == "hot" and (c.get("created_at") or "") >= week_ago)
        talk_secs = sum(c.get("duration_seconds") or 0 for c in calls)
        return {
            "total_conversations": len(all_c),
            "calls_total": len(calls),
            "calls_inbound": sum(1 for c in calls if c.get("type") == "call_inbound"),
            "texts_total": len(texts),
            "texts_outbound": sum(1 for c in texts if c.get("type") == "sms_outbound"),
            "hot_leads_this_week": hot_week,
            "talk_time_seconds": talk_secs,
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/crm/communications/unread-count")
async def get_unread_count() -> dict:
    """Return count of unread inbound conversation threads (grouped by phone number)."""
    sb = get_supabase()
    try:
        r = (
            sb.table("crm_communications")
            .select("phone_number")
            .eq("is_read", False)
            .eq("direction", "inbound")
            .execute()
        )
        phones = {c["phone_number"] for c in r.data if c.get("phone_number")}
        return {"count": len(phones)}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


class MarkReadRequest(BaseModel):
    phone_numbers: Optional[list[str]] = None
    mark_all: bool = False


@router.post("/crm/communications/mark-read")
async def mark_communications_read(body: MarkReadRequest) -> dict:
    """Mark communications as read — by phone number list or all at once."""
    sb = get_supabase()
    try:
        if body.mark_all:
            sb.table("crm_communications").update({"is_read": True}).eq("is_read", False).execute()
        elif body.phone_numbers:
            for phone in body.phone_numbers:
                sb.table("crm_communications").update({"is_read": True}).eq("phone_number", phone).execute()
        return {"ok": True}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.patch("/crm/communications/read-thread")
async def patch_thread_read(phone: str = Query(...), body: dict = Body(...)) -> dict:
    """Set all communications in a thread as read or unread."""
    sb = get_supabase()
    try:
        read = bool(body.get("read", True))
        sb.table("crm_communications").update({"is_read": read}).eq("phone_number", phone).execute()
        return {"ok": True}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


# ── Test endpoint ─────────────────────────────────────────────────────────────────

@router.get("/api/calls/test-code")
async def test_offer_code(spoken: str = Query(..., description="Spoken code string to test, e.g. 'zero two thirty seven'")) -> dict:
    """Debug endpoint: shows how a spoken code is converted and whether it matches a property."""
    candidates = _extract_code_candidates(spoken)
    prop = await _lookup_offer_code(spoken)
    return {
        "spoken": spoken,
        "candidates": candidates,
        "found": prop is not None,
        "property": {
            "id": prop.get("id"),
            "campaign_code": prop.get("campaign_code"),
            "county": prop.get("county"),
            "state": prop.get("state"),
            "owner_full_name": prop.get("owner_full_name"),
        } if prop else None,
    }


# ── Outbound calling ──────────────────────────────────────────────────────────────

class OutboundCallRequest(BaseModel):
    property_id: Optional[str] = None
    to_number: str
    seller_name: Optional[str] = None
    callback_number: Optional[str] = None


def _e164(number: str) -> str:
    digits = re.sub(r"\D", "", number)
    if len(digits) == 10:
        return f"+1{digits}"
    if len(digits) == 11 and digits.startswith("1"):
        return f"+{digits}"
    return number if number.startswith("+") else f"+{digits}"


@router.get("/crm/calls/callback-number")
async def get_callback_number() -> dict:
    """Return configured callback number (agent bridge phone) for UI display."""
    phone = _callback_phone()
    if not phone:
        return {"phone": "", "formatted": ""}
    digits = re.sub(r"\D", "", phone)
    if len(digits) == 11 and digits.startswith("1"):
        digits = digits[1:]
    formatted = f"({digits[:3]}) {digits[3:6]}-{digits[6:]}" if len(digits) == 10 else phone
    return {"phone": phone, "formatted": formatted}


@router.post("/crm/calls/outbound")
async def initiate_outbound_call(body: OutboundCallRequest) -> dict:
    """Two-leg bridge call: calls agent first, then bridges to seller when agent answers."""
    api_key = _telnyx_key()
    from_phone = _telnyx_phone()
    connection_id = os.getenv("TELNYX_CONNECTION_ID", "")
    # Prefer callback_number from request body, then env var, then hardcoded Damien's phone
    callback_number = body.callback_number or _callback_phone() or "+12023215846"

    if not api_key:
        raise HTTPException(status_code=503, detail="TELNYX_API_KEY not configured")
    if not from_phone:
        raise HTTPException(status_code=503, detail="TELNYX_PHONE_NUMBER not configured")
    if not connection_id:
        raise HTTPException(
            status_code=503,
            detail=(
                "TELNYX_CONNECTION_ID not configured. "
                "Go to Telnyx portal → Voice → TeXML Applications → your app → "
                "copy the Connection ID → add it to Railway as TELNYX_CONNECTION_ID."
            ),
        )
    if not callback_number:
        raise HTTPException(
            status_code=503,
            detail=(
                "TELNYX_CALLBACK_NUMBER not configured. "
                "Add your personal phone number to Railway as TELNYX_CALLBACK_NUMBER."
            ),
        )

    seller_e164 = _e164(body.to_number)
    callback_e164 = _e164(callback_number)

    bridge_id = f"bridge_{uuid.uuid4().hex[:12]}"
    # webhook_url fires for ALL call events on the agent leg (answered, hangup, etc.)
    outbound_webhook = f"{_base_url()}/api/calls/outbound-answered"

    print(f"[comms] Initiating outbound bridge call", flush=True)
    print(f"[comms]   Step 1 — calling agent: {callback_e164}", flush=True)
    print(f"[comms]   Will bridge to seller: {seller_e164}", flush=True)
    print(f"[comms]   Connection ID: {connection_id}", flush=True)
    print(f"[comms]   From: {from_phone}", flush=True)
    print(f"[comms]   Webhook: {outbound_webhook}", flush=True)

    try:
        payload: dict = {
            "connection_id": connection_id,
            "from": from_phone,
            "to": callback_e164,
            "webhook_url": outbound_webhook,
            "webhook_url_method": "POST",
        }
        async with httpx.AsyncClient(timeout=20) as client:
            r = await client.post(
                "https://api.telnyx.com/v2/calls",
                json=payload,
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            )
            print(f"[comms] Telnyx response: {r.status_code} {r.text[:800]}", flush=True)
            if r.status_code >= 400:
                telnyx_detail = (
                    r.json().get("errors", [{}])[0].get("detail", r.text[:300])
                    if r.headers.get("content-type", "").startswith("application/json")
                    else r.text[:300]
                )
                raise HTTPException(status_code=r.status_code, detail=f"Telnyx error: {telnyx_detail}")
            call_data = r.json().get("data", {})
            call_id = call_data.get("call_control_id", "")
            print(f"[comms] Outbound call initiated — call_control_id={call_id}", flush=True)
    except HTTPException:
        raise
    except Exception as exc:
        print(f"[comms] Outbound call exception: {exc}", flush=True)
        raise HTTPException(status_code=500, detail=str(exc))

    # Store pending call info keyed by call_control_id so outbound-answered can find it
    pending_outbound[call_id] = {
        "seller_phone": seller_e164,
        "seller_name": body.seller_name or "",
        "property_id": body.property_id,
        "bridge_id": bridge_id,
        "started_at": _now(),
    }
    _call_states[bridge_id] = pending_outbound[call_id]  # keep bridge_id lookup too

    comm = await _log_comm(
        property_id=body.property_id,
        comm_type="call_outbound",
        phone=seller_e164,
        direction="outbound",
        call_id=call_id,
        summary=f"Outbound bridge call to {body.seller_name or seller_e164} initiated",
    )
    return {
        "call_id": call_id,
        "bridge_id": bridge_id,
        "to": seller_e164,
        "from": callback_e164,
        "communication_id": comm.get("id"),
    }


@router.post("/api/calls/bridge-announce/{bridge_id}")
async def bridge_announce(bridge_id: str, request: Request) -> Response:
    """TeXML for leg A (agent's phone). Announces then dials seller to bridge both parties."""
    state = _call_states.get(bridge_id, {})
    seller_phone = state.get("seller_phone", "")
    seller_name = state.get("seller_name", "")

    if not seller_phone:
        xml = (
            '<?xml version="1.0" encoding="UTF-8"?>\n'
            "<Response>\n"
            "  <Say>Sorry, that call session has expired.</Say>\n"
            "  <Hangup/>\n"
            "</Response>"
        )
        return Response(xml, media_type="text/xml")

    announcement = f"Connecting you to {seller_name} now." if seller_name else "Connecting you to the seller now."
    safe_ann = announcement.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

    status_cb = f"{_base_url()}/api/calls/recording-status"
    xml = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        "<Response>\n"
        f'  <Say voice="Polly.Joanna-Neural"><prosody rate="medium">{safe_ann}</prosody></Say>\n'
        f'  <Dial record="record-from-ringing"\n'
        f'        recordingStatusCallback="{status_cb}"\n'
        f'        recordingStatusCallbackMethod="POST">{seller_phone}</Dial>\n'
        "</Response>"
    )
    return Response(xml, media_type="text/xml")


@router.post("/api/calls/outbound-answered")
async def outbound_answered(request: Request) -> Response:
    """
    Telnyx Call Control webhook for the agent-leg of an outbound bridge call.
    Fires for all events on that call (initiated, answered, hangup, etc.).
    When event_type == call.answered: bridge the agent to the seller via transfer action.
    """
    try:
        body = await request.json()
    except Exception:
        return Response(status_code=200)

    event_type = str(body.get("data", {}).get("event_type", ""))
    ev_payload = body.get("data", {}).get("payload", {})
    call_control_id = ev_payload.get("call_control_id", "")

    print(f"[comms] outbound-answered event: {event_type} call_control_id={call_control_id}", flush=True)

    if event_type != "call.answered":
        # Accept all other events silently (initiated, hangup, etc.)
        return Response(status_code=200)

    # Agent answered — look up which seller to bridge to
    state = pending_outbound.get(call_control_id)
    if not state:
        # Fallback: scan _call_states for matching call_control_id
        for k, v in _call_states.items():
            if v.get("call_control_id") == call_control_id:
                state = v
                break

    if not state:
        print(f"[comms] WARNING: no pending_outbound entry for call_control_id={call_control_id}", flush=True)
        return Response(status_code=200)

    seller_phone = state.get("seller_phone", "")
    seller_name = state.get("seller_name", "") or seller_phone
    property_id = state.get("property_id")

    print(f"[comms] Agent answered — bridging to seller: {seller_phone} ({seller_name})", flush=True)

    api_key = _telnyx_key()
    if not api_key or not seller_phone:
        print(f"[comms] Cannot bridge: api_key={'set' if api_key else 'MISSING'} seller_phone={seller_phone!r}", flush=True)
        return Response(status_code=200)

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            # Step 1: Speak a brief announcement to the agent
            speak_r = await client.post(
                f"https://api.telnyx.com/v2/calls/{call_control_id}/actions/speak",
                json={
                    "payload": f"Connecting you to {seller_name} now.",
                    "voice": "female",
                    "language": "en-US",
                    "command_id": "bridge_announce",
                },
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            )
            print(f"[comms] Speak result: {speak_r.status_code} {speak_r.text[:200]}", flush=True)

            # Step 2: Transfer / bridge to the seller
            transfer_r = await client.post(
                f"https://api.telnyx.com/v2/calls/{call_control_id}/actions/transfer",
                json={"to": seller_phone},
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            )
            print(f"[comms] Bridge result: {transfer_r.status_code} {transfer_r.text[:300]}", flush=True)

            if transfer_r.status_code >= 400:
                print(f"[comms] Transfer FAILED — {transfer_r.status_code}: {transfer_r.text[:300]}", flush=True)
            else:
                print(f"[comms] Bridge SUCCESS — agent connected to {seller_phone}", flush=True)
    except Exception as exc:
        print(f"[comms] Bridge exception: {exc}", flush=True)

    # Clean up pending state
    pending_outbound.pop(call_control_id, None)

    # Log the bridge event
    try:
        await _log_comm(
            property_id=property_id,
            comm_type="call_outbound",
            phone=seller_phone,
            direction="outbound",
            call_id=call_control_id,
            summary=f"Bridge connected — agent answered, transferred to {seller_name}",
        )
    except Exception as log_exc:
        print(f"[comms] Bridge log error (non-fatal): {log_exc}", flush=True)

    return Response(status_code=200)


@router.post("/api/calls/outbound-amd")
async def outbound_amd_webhook(request: Request) -> Response:
    """
    Telnyx AMD webhook for outbound calls.
    When answering machine is detected, drop pre-recorded voicemail and hang up.
    """
    try:
        payload = await request.json()
    except Exception:
        return Response(status_code=200)

    event_type = str(payload.get("data", {}).get("event_type", ""))
    ev_payload = payload.get("data", {}).get("payload", {})
    call_control_id = ev_payload.get("call_control_id", "")
    amd_result = ev_payload.get("result", "")  # "machine" | "human" | "not_sure"

    if event_type == "call.answered.amd" and amd_result == "machine" and call_control_id:
        api_key = _telnyx_key()
        telnyx_number = os.getenv("TELNYX_PHONE_NUMBER", "")
        if api_key:
            try:
                # Build voicemail text with actual callback number
                vm_text = _PHRASES["voicemail"].replace("{telnyx_number}", telnyx_number or "our number")
                vm_cache_key = f"voicemail_{hash(vm_text) & 0xFFFFFF:06x}"
                await _tts_generate(vm_text, vm_cache_key)
                voicemail_url = f"{_base_url()}/api/calls/audio/{vm_cache_key}"

                async with httpx.AsyncClient(timeout=10) as client:
                    # Play the voicemail
                    await client.post(
                        f"https://api.telnyx.com/v2/calls/{call_control_id}/actions/playback_start",
                        json={"audio_url": voicemail_url, "loop": 1},
                        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                    )
                    await asyncio.sleep(30)
                    await client.post(
                        f"https://api.telnyx.com/v2/calls/{call_control_id}/actions/hangup",
                        json={},
                        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                    )

                # Mark voicemail_left on the property
                call_state = pending_outbound.get(call_control_id, {})
                prop_id = call_state.get("property_id")
                if prop_id:
                    try:
                        get_supabase().table("crm_properties").update(
                            {"sms_status": "voicemail_left", "updated_at": _now()}
                        ).eq("id", prop_id).execute()
                    except Exception:
                        pass
            except Exception as exc:
                print(f"[comms] Voicemail drop error: {exc}")

    return Response(status_code=200)


# ── Migration SQL ─────────────────────────────────────────────────────────────────

COMMUNICATIONS_MIGRATION_SQL = """
CREATE TABLE IF NOT EXISTS crm_communications (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  property_id       UUID REFERENCES crm_properties(id) ON DELETE SET NULL,
  type              TEXT,
  phone_number      TEXT,
  duration_seconds  INTEGER,
  recording_url     TEXT,
  transcript        TEXT,
  summary           TEXT,
  lead_score        TEXT,
  direction         TEXT,
  message_body      TEXT,
  call_id           TEXT,
  caller_offer_code TEXT
);

ALTER TABLE crm_communications ADD COLUMN IF NOT EXISTS caller_offer_code TEXT;

ALTER TABLE crm_properties ADD COLUMN IF NOT EXISTS seller_asking_price NUMERIC;

CREATE INDEX IF NOT EXISTS idx_crm_comms_property ON crm_communications(property_id);
CREATE INDEX IF NOT EXISTS idx_crm_comms_created  ON crm_communications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_comms_type     ON crm_communications(type);
CREATE INDEX IF NOT EXISTS idx_crm_comms_score    ON crm_communications(lead_score);
"""
