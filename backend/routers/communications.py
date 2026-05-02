"""Communications router — Telnyx calls, SMS, and ElevenLabs AI voice agent."""
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
def _elevenlabs_key() -> str: return os.getenv("ELEVENLABS_API_KEY", "")
def _elevenlabs_voice() -> str: return os.getenv("ELEVENLABS_VOICE_ID", "21m00Tcm4TlvDq8ikWAM")
def _admin_email() -> str:   return os.getenv("ADMIN_EMAIL", "dupeedamien@gmail.com")
def _sendgrid_key() -> str:  return os.getenv("SENDGRID_API_KEY", "")

def _base_url() -> str:
    return os.getenv("BACKEND_URL", "https://land-dominator-production.up.railway.app")

def _callback_phone() -> str:
    return os.getenv("TELNYX_CALLBACK_NUMBER", "")


# ── In-memory call state ────────────────────────────────────────────────────────
_call_states: dict[str, dict] = {}

# Flag set to True once warmup finishes — inbound calls wait if False
_warmup_done: bool = False


# ── Disk-backed TTS audio cache ─────────────────────────────────────────────────
_AUDIO_DIR = Path("/tmp/tts_cache")
_AUDIO_DIR.mkdir(parents=True, exist_ok=True)

# Every phrase the agent will ever say — keyed by stable filename (no .mp3)
# RULE: No dynamic content here. Dynamic parts use Polly <Say> at zero latency.
_PHRASES: dict[str, str] = {
    "greeting": (
        "Thank you for calling Dominion Land Group. "
        "My name is Myra, an AI assistant. "
        "I'm here to gather a few details and connect you with a team member. "
        "Can I start with the offer code from the letter we sent you?"
    ),
    "offer_code_hint": (
        "It's a short code located just below your mailing address on the letter. "
        "It looks like two numbers, a dash, then a few more numbers."
    ),
    "not_found": (
        "I want to make sure I have that right. "
        "Can you repeat the code slowly?"
    ),
    "got_it_name": "Got it. And can I get your first and last name please?",
    "no_code_name": "No problem. Can I get your first and last name?",
    "no_code_county": "And what county is the property located in?",
    "interested": (
        "Are you calling because you received our offer and are interested in selling?"
    ),
    "confirm_callback": "Is that the best number for our team to reach you?",
    "close_hot": (
        "Perfect. Someone from our team will be in touch with you very shortly. "
        "Have a great day."
    ),
    "close_cold": (
        "I understand. I will make a note and pass this along to our team. "
        "Have a great day."
    ),
    "still_there": "Are you still there? Take your time.",
    "goodbye": "Thank you for calling. Have a great day.",
    "voicemail": (
        "Hi, this is Dominion Land Group calling about your property. "
        "We sent you a letter with a cash offer and would love to connect. "
        "Please call us back at your earliest convenience. Thank you!"
    ),
    "faq_redirect": (
        "That is a great question. For detailed answers you can visit our FAQ page at "
        "dominionlandgroup.land. A team member will also be happy to answer any questions "
        "when they call you back. Now can I get your first and last name so our team "
        "can follow up with you?"
    ),
}


def _audio_path(cache_key: str) -> Path:
    return _AUDIO_DIR / f"{cache_key}.mp3"


def _cached_url(cache_key: str) -> Optional[str]:
    """Return URL if the file is already on disk, else None. Zero latency."""
    if _audio_path(cache_key).exists():
        return f"{_base_url()}/api/calls/audio/{cache_key}"
    return None


async def _tts_generate(text: str, cache_key: str) -> bool:
    """Generate ElevenLabs TTS and cache to disk. Returns True on success."""
    api_key = _elevenlabs_key()
    voice_id = _elevenlabs_voice()
    if not api_key:
        return False
    path = _audio_path(cache_key)
    if path.exists():
        return True
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.post(
                f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}",
                json={
                    "text": text,
                    "model_id": "eleven_turbo_v2_5",
                    "voice_settings": {
                        "stability": 0.35,
                        "similarity_boost": 0.8,
                        "style": 0.0,
                        "use_speaker_boost": True,
                        "speed": 1.15,
                    },
                },
                headers={
                    "xi-api-key": api_key,
                    "Content-Type": "application/json",
                    "accept": "audio/mpeg",
                },
            )
            if r.status_code == 200:
                path.write_bytes(r.content)
                return True
            print(f"[comms] ElevenLabs {r.status_code}: {r.text[:200]}")
    except Exception as exc:
        print(f"[comms] ElevenLabs TTS error: {exc}")
    return False


@router.get("/api/calls/audio/{cache_key}")
async def serve_tts_audio(cache_key: str) -> Response:
    path = _audio_path(cache_key)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Audio not found")
    return Response(
        path.read_bytes(),
        media_type="audio/mpeg",
        headers={"Cache-Control": "public, max-age=86400"},
    )


@router.get("/api/calls/health")
async def calls_health() -> dict:
    """Health check for the voice agent system."""
    cached = sum(1 for key in _PHRASES if _audio_path(key).exists())
    return {
        "status": "ok",
        "warmup_done": _warmup_done,
        "tts_cache": f"{cached}/{len(_PHRASES)} files ready",
        "polly_fallback": "active" if not _warmup_done else "standby",
    }


async def warmup() -> None:
    """Pre-generate ALL static phrase audio at startup. Called from main.py.
    Runs in background — server accepts calls immediately via Polly fallback."""
    global _warmup_done
    if not _elevenlabs_key():
        print("[comms] ElevenLabs not configured — voice cache skipped (Polly fallback active)")
        _warmup_done = True
        return
    print(f"[comms] Warming voice cache — {len(_PHRASES)} phrases...")
    tasks = [_tts_generate(text, key) for key, text in _PHRASES.items()]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    ok = sum(1 for r in results if r is True)
    already = sum(1 for r in results if r is True and _audio_path(list(_PHRASES.keys())[list(results).index(r)]).exists())
    _ = already  # suppress unused warning
    _warmup_done = True
    print(f"[comms] Voice cache warmed up: {ok}/{len(_PHRASES)} files ready")


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
    """Return a <Play> if cached on disk, else <Say> with Polly. Always instant."""
    url = _cached_url(key)
    return _say(_PHRASES.get(key, key), url)


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
        f'  <Gather input="speech" action="{action}" method="POST"\n'
        f'          timeout="10" speechTimeout="1" language="en-US"\n'
        f'          enhanced="true" profanityFilter="false"\n'
        f'          hints="{hints}"\n'
        f'          actionOnEmptyResult="true"{record_attrs}>\n'
        f"    {inner_xml}\n"
        "  </Gather>\n"
        # On timeout/silence: redirect back to same step with timedout flag
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


# ── Offer-code matching ──────────────────────────────────────────────────────────

_SPOKEN_DIGITS = {
    "zero": "0", "one": "1", "two": "2", "three": "3", "four": "4",
    "five": "5", "six": "6", "seven": "7", "eight": "8", "nine": "9",
    "oh": "0", "to": "2", "too": "2", "for": "4",
    "ten": "10", "eleven": "11", "twelve": "12", "thirteen": "13",
    "fourteen": "14", "fifteen": "15", "sixteen": "16", "seventeen": "17",
    "eighteen": "18", "nineteen": "19", "twenty": "20", "thirty": "30",
    "forty": "40", "fifty": "50", "sixty": "60", "seventy": "70",
    "eighty": "80", "ninety": "90",
}

_TENS_VALUES = {"twenty": 20, "thirty": 30, "forty": 40, "fifty": 50,
                "sixty": 60, "seventy": 70, "eighty": 80, "ninety": 90}
_UNITS_VALUES = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5,
                 "six": 6, "seven": 7, "eight": 8, "nine": 9, "for": 4, "to": 2, "too": 2}
_SKIP_WORDS = {"dash", "hyphen", "minus", "and", "my", "code", "is", "the",
               "it", "number", "offer", "letter", "that", "at", "a"}


def _normalize_code(code: str) -> str:
    return re.sub(r"[\s\-_]", "", code).lower()


def _speech_to_digits(speech: str) -> str:
    """Convert spoken words/numbers to a digit string.

    Handles compound numbers: 'thirty seven' → '37', 'oh two' → '02'.
    """
    words = re.split(r"[\s,]+", speech.lower())
    parts: list[str] = []
    i = 0
    while i < len(words):
        w = re.sub(r"[^\w]", "", words[i])
        if not w or w in _SKIP_WORDS:
            i += 1
            continue
        if w in _TENS_VALUES:
            tens_val = _TENS_VALUES[w]
            if i + 1 < len(words):
                nw = re.sub(r"[^\w]", "", words[i + 1])
                if nw in _UNITS_VALUES:
                    # "thirty seven" → 37
                    parts.append(str(tens_val + _UNITS_VALUES[nw]))
                    i += 2
                    continue
            parts.append(str(tens_val))
            i += 1
            continue
        if w in _SPOKEN_DIGITS:
            parts.append(_SPOKEN_DIGITS[w])
        elif re.match(r"^\d+$", w):
            parts.append(w)
        i += 1
    return "".join(parts)


def _extract_code_candidates(speech: str) -> list[str]:
    """Generate all plausible code strings from spoken input.

    Tries explicit dash splits, raw digit sequences, and spoken-word conversion.
    For each digit string, tries all campaign-record split points (1 or 2 digits
    for campaign) with zero-padded campaign number.
    """
    candidates: list[str] = []

    def _add_splits(digit_str: str) -> None:
        if not digit_str:
            return
        candidates.append(digit_str)
        for split in range(1, min(3, len(digit_str))):
            campaign_part = digit_str[:split]
            record_part = digit_str[split:]
            if record_part:
                try:
                    padded = f"{int(campaign_part):02d}-{record_part}"
                    candidates.append(padded)
                except ValueError:
                    pass
                candidates.append(f"{campaign_part}-{record_part}")

    # Strategy 1: explicit spoken dash separates campaign from record
    dash_parts = re.split(r"\b(?:dash|hyphen|minus)\b", speech.lower(), maxsplit=1)
    if len(dash_parts) == 2:
        p1 = _speech_to_digits(dash_parts[0])
        p2 = _speech_to_digits(dash_parts[1])
        if p1 and p2:
            try:
                candidates.append(f"{int(p1):02d}-{p2}")
            except ValueError:
                pass
            candidates.append(f"{p1}-{p2}")

    # Strategy 2: raw digit sequences already in speech text
    raw_patterns = re.findall(r"\d[\d\s\-]*\d|\d", speech)
    for p in raw_patterns:
        norm = _normalize_code(p)
        _add_splits(norm)

    # Strategy 3: full spoken-word → digit conversion
    spoken = _speech_to_digits(speech)
    _add_splits(spoken)

    return list(dict.fromkeys(candidates))


async def _lookup_offer_code(speech: str) -> Optional[dict]:
    """Look up a property by offer code extracted from speech.

    Tries multiple strategies: exact ILIKE, normalized string match, and
    digit-only match that ignores leading zeros on the campaign number.
    """
    candidates = _extract_code_candidates(speech)
    if not candidates:
        return None
    sb = get_supabase()

    # Pass 1 — ILIKE exact match for each candidate
    for candidate in candidates:
        try:
            r = (
                sb.table("crm_properties")
                .select("id,owner_full_name,owner_first_name,owner_last_name,apn,county,state,campaign_code,offer_price,campaign_id")
                .ilike("campaign_code", candidate)
                .limit(1)
                .execute()
            )
            if r.data:
                return r.data[0]
        except Exception:
            pass

    # Pass 2 — load all codes, compare by normalized string and digit-only
    norm_candidates = {_normalize_code(c) for c in candidates}
    digit_candidates = {re.sub(r"[^\d]", "", c) for c in candidates}
    # also add versions without leading zero on campaign (e.g. "237" matches "0237")
    expanded_digits: set[str] = set(digit_candidates)
    for d in list(digit_candidates):
        if d and d[0] == "0":
            expanded_digits.add(d[1:])
        elif len(d) >= 1:
            expanded_digits.add(f"0{d}")

    try:
        r = (
            sb.table("crm_properties")
            .select("id,owner_full_name,owner_first_name,owner_last_name,apn,county,state,campaign_code,offer_price,campaign_id")
            .not_.is_("campaign_code", "null")
            .execute()
        )
        for p in r.data or []:
            code = p.get("campaign_code") or ""
            norm = _normalize_code(code)
            digits = re.sub(r"[^\d]", "", code)
            if norm in norm_candidates:
                return p
            if digits in digit_candidates or digits in expanded_digits:
                return p
            # strip leading zero from campaign part and retry
            if len(digits) >= 2 and digits[0] == "0":
                stripped = digits[1:]
                if stripped in digit_candidates or stripped in expanded_digits:
                    return p
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
        digits = re.sub(r"\D", "", phone)[-10:]
        r = sb.table("crm_properties").select("*").eq("owner_phone", _normalize_phone(phone)).limit(1).execute()
        if r.data:
            return r.data[0]
        r = sb.table("crm_properties").select("*").ilike("owner_phone", f"%{digits}").limit(1).execute()
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


async def _notify_email(subject: str, html: str) -> None:
    api_key = _sendgrid_key()
    if not api_key:
        return
    try:
        from_email = os.getenv("SENDGRID_FROM_EMAIL", "noreply@landdominator.com")
        async with httpx.AsyncClient(timeout=15) as client:
            await client.post(
                "https://api.sendgrid.com/v3/mail/send",
                json={
                    "personalizations": [{"to": [{"email": _admin_email()}]}],
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


def _get_step_retries(state: dict, step: str) -> int:
    return state.get("retries", {}).get(step, 0)


def _inc_step_retries(call_sid: str, state: dict, step: str) -> int:
    retries = state.setdefault("retries", {})
    retries[step] = retries.get(step, 0) + 1
    if call_sid in _call_states:
        _call_states[call_sid].setdefault("retries", {})[step] = retries[step]
    return retries[step]


# ── Inbound call ──────────────────────────────────────────────────────────────────

@router.post("/api/calls/inbound")
async def inbound_call(request: Request) -> Response:
    """Telnyx TeXML webhook — answers inbound call, asks for offer code.
    Returns TeXML immediately. If ElevenLabs audio isn't cached yet, _phrase()
    falls back to Polly <Say> with zero latency — call always answers within ms."""
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

    _call_states[call_sid] = {
        "caller": caller,
        "property_id": None,
        "offer_price": None,
        "owner_name": "",
        "caller_offer_code": None,
        "attempted_codes": [],
        "caller_name": None,
        "interest_score": "warm",
        "code_attempts": 0,
        "transcript": [],
        "started_at": _now(),
        "retries": {},
    }

    return _texml_gather("greeting", _phrase("greeting"), call_sid, with_recording=True)


@router.post("/api/calls/gather/{step}")
async def call_gather(step: str, request: Request, background_tasks: BackgroundTasks) -> Response:
    """Telnyx gather callback — drives the conversation state machine."""
    try:
        form = await request.form()
        call_sid = _form_get(form, "CallSid", "call_control_id")
        speech = _form_get(form, "SpeechResult", "speech_result")
        timed_out = form.get("timedout") == "1"
    except Exception:
        call_sid = speech = ""
        timed_out = False

    state = _call_states.get(call_sid, {})
    state.setdefault("transcript", []).append({"step": step, "speech": speech, "timed_out": timed_out})

    def _on_timeout(step_name: str) -> Response:
        """Retry up to 3x on silence/timeout, then close gracefully."""
        retry_count = _inc_step_retries(call_sid, state, step_name)
        if retry_count < 3:
            return _texml_gather(step_name, _phrase("still_there"), call_sid)
        background_tasks.add_task(_finalize_call, call_sid)
        return _texml_hangup(_phrase("goodbye"))

    # ── Step: greeting — ask for offer code ──────────────────────────────
    if step == "greeting":
        if timed_out or not speech:
            return _on_timeout("greeting")

        # FAQ question — play redirect, skip to name step
        if _is_faq_question(speech):
            state["code_attempts"] = 99
            if call_sid in _call_states:
                _call_states[call_sid]["code_attempts"] = 99
            return _texml_gather("name", _phrase("faq_redirect"), call_sid)

        speech_low = speech.lower()
        asking_what = (
            any(w in speech_low for w in [
                "what", "don't know", "dont know", "no idea", "don't have",
                "dont have", "not sure", "no code", "i don't", "i dont",
                "what's that", "whats that", "explain",
            ])
            and not re.search(r"\d", speech)
        )
        if asking_what:
            return _texml_gather("greeting", _phrase("offer_code_hint"), call_sid)

        state.setdefault("attempted_codes", []).append(speech.strip())
        if call_sid in _call_states:
            _call_states[call_sid].setdefault("attempted_codes", []).append(speech.strip())

        prop = await _lookup_offer_code(speech)
        if prop:
            state["property_id"] = prop.get("id")
            state["offer_price"] = prop.get("offer_price")
            state["owner_name"] = prop.get("owner_full_name") or prop.get("owner_first_name") or ""
            state["caller_offer_code"] = speech.strip()
            if call_sid in _call_states:
                _call_states[call_sid].update(state)
            return _texml_gather("name", _phrase("got_it_name"), call_sid)

        attempts = state.get("code_attempts", 0)
        state["code_attempts"] = attempts + 1
        if call_sid in _call_states:
            _call_states[call_sid]["code_attempts"] = attempts + 1

        if attempts == 0:
            return _texml_gather("greeting", _phrase("not_found"), call_sid)
        # Second failed attempt — skip code, proceed to name
        return _texml_gather("name", _phrase("no_code_name"), call_sid)

    # ── Step: name — capture caller name, then ask if interested ─────────
    elif step == "name":
        if timed_out or not speech:
            return _on_timeout("name")

        if call_sid in _call_states:
            _call_states[call_sid]["caller_name"] = speech.strip()
        state["caller_name"] = speech.strip()

        return _texml_gather("interest", _phrase("interested"), call_sid)

    # ── Step: interest — yes → callback confirm; no → warm close ─────────
    elif step == "interest":
        if timed_out or not speech:
            return _on_timeout("interest")

        score = _score_interest(speech)
        if call_sid in _call_states:
            _call_states[call_sid]["interest_score"] = score

        if score == "cold":
            background_tasks.add_task(_finalize_call, call_sid)
            return _texml_hangup(_phrase("close_cold"))

        return _texml_gather("callback", _phrase("confirm_callback"), call_sid)

    # ── Step: callback — confirm phone number, close hot ─────────────────
    elif step == "callback":
        background_tasks.add_task(_finalize_call, call_sid)
        return _texml_hangup(_phrase("close_hot"))

    # ── Step: fallback_name — code failed, ask for name ──────────────────
    elif step == "fallback_name":
        if speech and not timed_out:
            if call_sid in _call_states:
                _call_states[call_sid]["fallback_name"] = speech.strip()
                _call_states[call_sid]["caller_name"] = speech.strip()
            state["caller_name"] = speech.strip()
        return _texml_gather("fallback_county", _phrase("no_code_county"), call_sid)

    # ── Step: fallback_county — lookup by name+county ────────────────────
    elif step == "fallback_county":
        fb_name = _call_states.get(call_sid, {}).get("fallback_name", "")
        fb_county = speech.strip() if (speech and not timed_out) else ""
        if call_sid in _call_states:
            _call_states[call_sid]["fallback_county"] = fb_county

        if fb_name and fb_county:
            matches = await _lookup_by_name_county(fb_name, fb_county)
            if matches:
                prop = matches[0]
                if call_sid in _call_states:
                    _call_states[call_sid]["property_id"] = prop.get("id")
                    _call_states[call_sid]["offer_price"] = prop.get("offer_price")
                    _call_states[call_sid]["owner_name"] = prop.get("owner_full_name") or ""
                    _call_states[call_sid].setdefault("caller_name", fb_name)
                state["property_id"] = prop.get("id")
                state["offer_price"] = prop.get("offer_price")
                state.setdefault("caller_name", fb_name)
                return _texml_gather("interest", _phrase("interested"), call_sid)

        caller = state.get("caller") or _call_states.get(call_sid, {}).get("caller", "")
        if caller:
            prop_by_phone = await _lookup_phone(caller)
            if prop_by_phone:
                if call_sid in _call_states:
                    _call_states[call_sid]["property_id"] = prop_by_phone.get("id")
                    _call_states[call_sid]["offer_price"] = prop_by_phone.get("offer_price")
                    _call_states[call_sid].setdefault("caller_name", fb_name)
                state["property_id"] = prop_by_phone.get("id")
                state.setdefault("caller_name", fb_name)
                return _texml_gather("interest", _phrase("interested"), call_sid)

        if call_sid in _call_states:
            _call_states[call_sid]["unmatched_info"] = f"{fb_name} / {fb_county}"
            _call_states[call_sid].setdefault("caller_name", fb_name)
        background_tasks.add_task(_finalize_unmatched_call, call_sid)
        return _texml_hangup(_phrase("goodbye"))

    # ── Fallback ─────────────────────────────────────────────────────────
    else:
        background_tasks.add_task(_finalize_call, call_sid)
        return _texml_hangup(_phrase("goodbye"))


# ── Recording status callback ────────────────────────────────────────────────────

@router.post("/api/calls/recording-status")
async def recording_status(request: Request) -> dict:
    """Receive Telnyx recording-ready webhook and store recording URL."""
    recording_url = ""
    call_sid = ""
    try:
        form = await request.form()
        call_sid = _form_get(form, "CallSid", "call_control_id")
        recording_url = _form_get(form, "RecordingUrl", "recording_url")
    except Exception:
        try:
            body = await request.json()
            data = body.get("data", {}).get("payload", body)
            call_sid = data.get("call_control_id", data.get("CallSid", ""))
            recording_url = data.get("recording_url", data.get("RecordingUrl", ""))
        except Exception:
            pass
    if call_sid and recording_url:
        try:
            get_supabase().table("crm_communications").update(
                {"recording_url": recording_url}
            ).eq("call_id", call_sid).execute()
        except Exception as exc:
            print(f"[comms] recording_status DB error: {exc}")
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

    if call_sid and billing_secs is not None and billing_secs > 0:
        try:
            sb = get_supabase()
            # Only update if duration_seconds is currently null/0
            existing = sb.table("crm_communications").select("id, duration_seconds").eq("call_id", call_sid).execute()
            if existing.data:
                row = existing.data[0]
                if not row.get("duration_seconds"):
                    sb.table("crm_communications").update(
                        {"duration_seconds": billing_secs}
                    ).eq("call_id", call_sid).execute()
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
    # Store only the successfully matched offer code; "NOT PROVIDED" if none matched
    caller_offer_code = state.get("caller_offer_code") or "NOT PROVIDED"
    caller_name = state.get("caller_name", "")

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
        f"[{t['step'].upper()}] Agent: {_PHRASES.get(t['step'], t['step'])}\n"
        f"Caller: {t.get('speech', '[no response]')}"
        for t in transcript
    )

    # Use Claude for final scoring (falls back to rule-based if unavailable)
    score, summary, disposition, callback_time = await _score_with_claude(transcript)
    if score == "warm" and interest_score != "warm":
        score = interest_score  # trust rule-based if Claude was neutral

    # Add caller name to summary
    if caller_name:
        summary = f"Caller name: {caller_name}. " + summary

    # Build callback_requested_at ISO string if callback time was extracted
    callback_requested_at: Optional[str] = None
    if callback_time and disposition == "CALLBACK_NEEDED":
        callback_requested_at = f"{_now()[:10]} (caller said: {callback_time})"

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
        caller_offer_code=caller_offer_code,
        disposition=disposition,
        callback_requested_at=callback_requested_at,
    )

    if property_id:
        try:
            sb = get_supabase()
            updates: dict = {"updated_at": _now()}

            # Caller name
            if caller_name:
                existing = sb.table("crm_properties").select("owner_first_name,notes,tags").eq("id", property_id).execute()
                row = existing.data[0] if existing.data else {}
                if not row.get("owner_first_name") and caller_name:
                    parts = caller_name.strip().split(" ", 1)
                    updates["owner_first_name"] = parts[0]
                    if len(parts) > 1:
                        updates["owner_last_name"] = parts[1]
            else:
                existing = sb.table("crm_properties").select("tags").eq("id", property_id).execute()
                row = existing.data[0] if existing.data else {}

            # Status based on disposition
            if disposition == "INTERESTED":
                updates["status"] = "prospect"
            elif disposition == "NOT_INTERESTED":
                updates["status"] = "due_diligence"
            elif score in ("hot", "warm") and disposition not in ("NOT_INTERESTED", "WRONG_NUMBER"):
                updates["status"] = "prospect"

            # Auto-tags
            existing_tags: list = row.get("tags") or []
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

    if score == "hot":
        prop_data: dict = {}
        try:
            r = get_supabase().table("crm_properties").select("*").eq("id", property_id).execute()
            prop_data = r.data[0] if r.data else {}
        except Exception:
            pass
        owner = prop_data.get("owner_full_name") or caller_name or "Unknown"
        apn = prop_data.get("apn", "")
        county = prop_data.get("county", "")
        code = prop_data.get("campaign_code", "")
        offer = prop_data.get("offer_price")
        offer_str = f"${int(offer):,}" if offer else "N/A"
        html = (
            "<h2 style='color:#B71C1C'>🔥 HOT LEAD ALERT</h2>"
            f"<ul>"
            f"<li><strong>Owner:</strong> {owner}</li>"
            f"<li><strong>Phone:</strong> {caller}</li>"
            f"<li><strong>APN:</strong> {apn}</li>"
            f"<li><strong>County:</strong> {county}</li>"
            f"<li><strong>Campaign Code:</strong> {code}</li>"
            f"<li><strong>Offer Price:</strong> {offer_str}</li>"
            f"</ul>"
            f"<p><strong>Summary:</strong> {summary}</p>"
            f"<p><a href='https://land-dominator-production.up.railway.app'>Open Land Dominator →</a></p>"
        )
        await _notify_email(f"🔥 HOT LEAD — {owner} — {apn} — {county}", html)


async def _finalize_unmatched_call(call_sid: str) -> None:
    state = _call_states.pop(call_sid, {})
    if not state:
        return
    caller = state.get("caller", "")
    info = state.get("unmatched_info", "")
    fallback_name = state.get("fallback_name", "")
    attempted_codes = state.get("attempted_codes", [])
    caller_offer_code = (
        " | ".join(attempted_codes) if attempted_codes
        else state.get("caller_offer_code")
    )
    transcript = state.get("transcript", [])
    transcript_text = "\n".join(
        f"[{t['step'].upper()}] Caller: {t.get('speech', '[no response]')}"
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

    caller_name = fallback_name or ""
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

    detail = info or fallback_name or "N/A"
    await _log_comm(
        property_id=property_id,
        comm_type="call_inbound",
        phone=caller,
        direction="inbound",
        transcript=transcript_text,
        summary=f"Could not match to property. Caller provided: {detail}. Next action: Review manually.",
        lead_score="cold",
        call_id=call_sid,
        duration_seconds=duration_seconds,
        caller_offer_code=caller_offer_code,
        disposition="MAYBE",
    )


# ── Inbound SMS ──────────────────────────────────────────────────────────────────

@router.post("/api/sms/inbound")
async def inbound_sms(request: Request, background_tasks: BackgroundTasks) -> dict:
    from_phone = ""
    message_text = ""
    try:
        body = await request.json()
        payload = body.get("data", {}).get("payload", body)
        from_data = payload.get("from", {})
        from_phone = from_data.get("phone_number", "") if isinstance(from_data, dict) else str(from_data)
        message_text = payload.get("text", payload.get("body", ""))
    except Exception:
        try:
            form = await request.form()
            from_phone = _form_get(form, "From", "from_")
            message_text = _form_get(form, "Body", "text")
        except Exception:
            pass
    if from_phone:
        background_tasks.add_task(_process_inbound_sms, from_phone, message_text)
    return {"status": "ok"}


async def _process_inbound_sms(from_phone: str, message_text: str) -> None:
    prop = await _lookup_phone(from_phone)
    if not prop:
        prop = {"id": None}

    property_id = prop.get("id")
    await _log_comm(
        property_id=property_id,
        comm_type="sms_inbound",
        phone=from_phone,
        direction="inbound",
        message_body=message_text,
    )

    msg_up = message_text.upper()
    is_positive = any(w in msg_up for w in ["YES", "INTERESTED", "SURE", "OK", "OKAY", "ACCEPT"])

    if property_id and is_positive:
        try:
            get_supabase().table("crm_properties").update(
                {"status": "prospect", "updated_at": _now()}
            ).eq("id", property_id).execute()
        except Exception:
            pass

    owner = prop.get("owner_full_name") or prop.get("owner_first_name") or "Unknown"
    apn = prop.get("apn", "")
    county = prop.get("county", "")
    code = prop.get("campaign_code", "")
    subject = f"{'✅ POSITIVE ' if is_positive else ''}SMS Reply — {owner} — {apn}"
    html = (
        "<h2>Inbound SMS Reply</h2>"
        f"<ul>"
        f"<li><strong>From:</strong> {from_phone}</li>"
        f"<li><strong>Owner:</strong> {owner}</li>"
        f"<li><strong>APN:</strong> {apn}</li>"
        f"<li><strong>County:</strong> {county}</li>"
        f"<li><strong>Campaign Code:</strong> {code}</li>"
        f"</ul>"
        f"<p><strong>Message:</strong> {message_text}</p>"
        + ("<p style='color:#2E7D32;font-weight:bold'>✓ Status updated to Prospect</p>" if is_positive else "")
        + "<p><a href='https://land-dominator-production.up.railway.app'>Open Land Dominator →</a></p>"
    )
    await _notify_email(subject, html)


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

    try:
        payload: dict = {"from": from_phone, "to": body.to_phone, "text": body.message}
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
    callback_number = _callback_phone()

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
    _call_states[bridge_id] = {
        "seller_phone": seller_e164,
        "seller_name": body.seller_name or "",
        "property_id": body.property_id,
        "started_at": _now(),
    }

    bridge_webhook = f"{_base_url()}/api/calls/bridge-announce/{bridge_id}"

    print(f"[comms] Initiating outbound call to agent: {callback_e164}")
    print(f"[comms] Using connection ID: {connection_id}")
    print(f"[comms] From: {from_phone}")

    try:
        payload: dict = {
            "connection_id": connection_id,
            "from": from_phone,
            "to": callback_e164,
            "webhook_url": bridge_webhook,
            "webhook_url_method": "POST",
        }
        async with httpx.AsyncClient(timeout=20) as client:
            r = await client.post(
                "https://api.telnyx.com/v2/calls",
                json=payload,
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            )
            print(f"[comms] Telnyx outbound response: {r.status_code} {r.text[:500]}")
            if r.status_code >= 400:
                telnyx_detail = r.json().get("errors", [{}])[0].get("detail", r.text[:300]) if r.headers.get("content-type", "").startswith("application/json") else r.text[:300]
                raise HTTPException(
                    status_code=r.status_code,
                    detail=f"Telnyx error: {telnyx_detail}",
                )
            call_data = r.json().get("data", {})
            call_id = call_data.get("call_control_id", "")
            print(f"[comms] Call initiated: call_control_id={call_id}")
    except HTTPException:
        raise
    except Exception as exc:
        print(f"[comms] Outbound call exception: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))

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
        voicemail_url = f"{_base_url()}/api/calls/audio/voicemail"
        api_key = _telnyx_key()
        if api_key:
            try:
                # Ensure voicemail audio is cached
                asyncio.create_task(_tts_generate(_PHRASES["voicemail"], "voicemail"))
                async with httpx.AsyncClient(timeout=10) as client:
                    # Play the voicemail
                    await client.post(
                        f"https://api.telnyx.com/v2/calls/{call_control_id}/actions/playback_start",
                        json={"audio_url": voicemail_url, "loop": 1},
                        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                    )
                    # Schedule hangup after 30s (voicemail is ~15s)
                    await asyncio.sleep(30)
                    await client.post(
                        f"https://api.telnyx.com/v2/calls/{call_control_id}/actions/hangup",
                        json={},
                        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                    )
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

CREATE INDEX IF NOT EXISTS idx_crm_comms_property ON crm_communications(property_id);
CREATE INDEX IF NOT EXISTS idx_crm_comms_created  ON crm_communications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_comms_type     ON crm_communications(type);
CREATE INDEX IF NOT EXISTS idx_crm_comms_score    ON crm_communications(lead_score);
"""
