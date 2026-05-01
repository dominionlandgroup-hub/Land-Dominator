"""Communications router — Telnyx calls, SMS, and ElevenLabs AI voice agent."""
import asyncio
import hashlib
import json
import os
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

import httpx
from fastapi import APIRouter, BackgroundTasks, HTTPException, Query, Request, Response
from pydantic import BaseModel

from services.supabase_client import get_supabase

router = APIRouter(tags=["communications"])

# ── Config ─────────────────────────────────────────────────────────────────────

def _telnyx_key() -> str:    return os.getenv("TELNYX_API_KEY", "")
def _telnyx_phone() -> str:  return os.getenv("TELNYX_PHONE_NUMBER", "")
def _elevenlabs_key() -> str: return os.getenv("ELEVENLABS_API_KEY", "")
def _elevenlabs_voice() -> str: return os.getenv("ELEVENLABS_VOICE_ID", "21m00Tcm4TlvDq8ikWAM")
def _admin_email() -> str:   return os.getenv("ADMIN_EMAIL", "dupeedamien@gmail.com")
def _sendgrid_key() -> str:  return os.getenv("SENDGRID_API_KEY", "")

def _base_url() -> str:
    return os.getenv("BACKEND_URL", "https://land-dominator-production.up.railway.app")


# ── In-memory call state ────────────────────────────────────────────────────────
_call_states: dict[str, dict] = {}


# ── Disk-backed TTS audio cache ─────────────────────────────────────────────────
_AUDIO_DIR = Path("/tmp/tts_cache")
_AUDIO_DIR.mkdir(parents=True, exist_ok=True)

# Static phrases — keyed by a short stable name so cache survives restarts
_PHRASES: dict[str, str] = {
    "greeting": (
        "Thank you for calling Dominion Land Group. "
        "Do you have the offer code from the letter we sent you? "
        "It's located just below your mailing address. "
        "The code is usually two numbers, a dash, then one to three more numbers. "
        "For example zero-two dash thirty-seven."
    ),
    "code_found": (
        "Perfect, I found your file. "
        "Are you calling because you're interested in our offer?"
    ),
    "confirm_wrong": (
        "My apologies. Let me look that up again. "
        "Can you repeat the offer code from the letter?"
    ),
    "confirm_yes": (
        "Great. Are you calling because you're interested in our offer?"
    ),
    "code_not_found_1": (
        "I want to make sure I get that right. "
        "Can you say each part slowly? "
        "First the numbers before the dash, pause, then the numbers after the dash."
    ),
    "code_not_found_2": (
        "Let me try one more time. "
        "What are the numbers before the dash?"
    ),
    "code_not_found_3": (
        "No problem at all. "
        "Let me get your information another way. "
        "Can I get your first and last name?"
    ),
    "ask_name": "Can I get your name please?",
    "ask_callback": "Is the best number to reach you back at this number?",
    "close": "Thank you. Someone from our team will be in touch with you very shortly.",
}


def _audio_path(cache_key: str) -> Path:
    return _AUDIO_DIR / f"{cache_key}.mp3"


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
                    "voice_settings": {"stability": 0.5, "similarity_boost": 0.8},
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


async def _tts_url(phrase_key: str, text: Optional[str] = None) -> Optional[str]:
    """Return audio URL from disk cache, or generate if missing."""
    actual_text = text or _PHRASES.get(phrase_key, "")
    if not actual_text:
        return None
    path = _audio_path(phrase_key)
    if path.exists():
        return f"{_base_url()}/api/calls/audio/{phrase_key}"
    ok = await _tts_generate(actual_text, phrase_key)
    return f"{_base_url()}/api/calls/audio/{phrase_key}" if ok else None


@router.get("/api/calls/audio/{cache_key}")
async def serve_tts_audio(cache_key: str) -> Response:
    path = _audio_path(cache_key)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Audio not found")
    return Response(path.read_bytes(), media_type="audio/mpeg")


async def warmup() -> None:
    """Pre-generate all static phrase audio at startup. Called from main.py."""
    if not _elevenlabs_key():
        print("[comms] ElevenLabs not configured — skipping TTS warmup")
        return
    print("[comms] Pre-warming TTS audio cache...")
    tasks = [_tts_generate(text, key) for key, text in _PHRASES.items()]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    ok = sum(1 for r in results if r is True)
    print(f"[comms] TTS warmup complete — {ok}/{len(_PHRASES)} phrases cached")


async def _tts_confirm(prop: dict) -> tuple[str, Optional[str]]:
    """Build and cache a property-specific confirmation phrase."""
    county = (prop.get("county") or "").strip()
    state = (prop.get("state") or "").strip()
    prop_id = (prop.get("id") or "unknown")[:8]
    if county and state:
        text = (
            f"Perfect I found your file. "
            f"Just to confirm, your property is in {county} County {state}. "
            "Is that correct?"
        )
    else:
        text = _PHRASES["code_found"]
    key = f"confirm_{prop_id}"
    url = await _tts_url(key, text)
    return text, url


# ── TeXML helpers ────────────────────────────────────────────────────────────────

def _xml_escape(text: str) -> str:
    return (
        text.replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
            .replace('"', "&quot;")
    )


def _say(text: str, audio_url: Optional[str] = None) -> str:
    if audio_url:
        return f'<Play>{audio_url}</Play>'
    safe = _xml_escape(text)
    return f'<Say voice="Polly.Joanna-Neural">{safe}</Say>'


def _texml_gather(
    next_step: str,
    say_text: str,
    call_sid: str,
    audio_url: Optional[str] = None,
    with_recording: bool = False,
) -> Response:
    action = f"{_base_url()}/api/calls/gather/{next_step}"
    redirect = f"{action}?timedout=1"
    inner = _say(say_text, audio_url)

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
        f'          timeout="5" speechTimeout="3" language="en-US"{record_attrs}>\n'
        f"    {inner}\n"
        "  </Gather>\n"
        f'  <Redirect method="POST">{redirect}</Redirect>\n'
        "</Response>"
    )
    return Response(xml, media_type="text/xml")


def _texml_hangup(say_text: str, audio_url: Optional[str] = None) -> Response:
    inner = _say(say_text, audio_url)
    xml = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        "<Response>\n"
        f"  {inner}\n"
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
        }
        if recording_url is not None:
            row["recording_url"] = recording_url
        if caller_offer_code is not None:
            row["caller_offer_code"] = caller_offer_code
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


async def _score_with_claude(transcript_parts: list[dict]) -> tuple[str, str]:
    """Return (score, summary) using Claude to analyze the full call."""
    try:
        import anthropic
        api_key = os.getenv("ANTHROPIC_API_KEY", "")
        if not api_key:
            return "warm", "Call completed."
        transcript_text = "\n".join(
            f"[{t['step'].upper()}] Agent: {t.get('agent', '')}\nCaller: {t.get('speech', '[no response]')}"
            for t in transcript_parts
        )
        client = anthropic.Anthropic(api_key=api_key)
        rsp = client.messages.create(
            model="claude-sonnet-4-5",
            max_tokens=400,
            messages=[{
                "role": "user",
                "content": (
                    "Analyze this land seller call. Score the lead and write a brief summary.\n\n"
                    "HOT: seller is ready to sell at or near the offered price\n"
                    "WARM: seller is interested but has questions or wants to negotiate\n"
                    "COLD: seller is not interested or property is not available\n\n"
                    f"Transcript:\n{transcript_text}\n\n"
                    'Respond ONLY with JSON: {"score": "hot|warm|cold", "summary": "2-3 sentence summary"}'
                ),
            }],
        )
        result = json.loads(rsp.content[0].text.strip())
        return result.get("score", "warm").lower(), result.get("summary", "Call completed.")
    except Exception as exc:
        print(f"[comms] Claude scoring error: {exc}")
        return "warm", "Call completed."


# ── Inbound call ──────────────────────────────────────────────────────────────────

@router.post("/api/calls/inbound")
async def inbound_call(request: Request) -> Response:
    """Telnyx TeXML webhook — answers inbound call, asks for offer code."""
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
    }

    greeting_text = _PHRASES["greeting"]
    audio_url = await _tts_url("greeting")
    return _texml_gather("greeting", greeting_text, call_sid, audio_url, with_recording=True)


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

    # ── Step: greeting (seller provides offer code) ──────────────────────
    if step == "greeting":
        if speech and not timed_out:
            # Log every attempted code
            if call_sid in _call_states:
                _call_states[call_sid].setdefault("attempted_codes", []).append(speech.strip())
            state.setdefault("attempted_codes", []).append(speech.strip())

            prop = await _lookup_offer_code(speech)
            if prop:
                state["property_id"] = prop.get("id")
                state["offer_price"] = prop.get("offer_price")
                state["owner_name"] = prop.get("owner_full_name") or prop.get("owner_first_name") or ""
                state["caller_offer_code"] = speech.strip()
                if call_sid in _call_states:
                    _call_states[call_sid].update(state)
                # Build dynamic county/state confirmation
                confirm_text, audio_url = await _tts_confirm(prop)
                return _texml_gather("confirm", confirm_text, call_sid, audio_url)
            else:
                attempts = state.get("code_attempts", 0)
                state["code_attempts"] = attempts + 1
                if call_sid in _call_states:
                    _call_states[call_sid]["code_attempts"] = attempts + 1
                if attempts == 0:
                    text = _PHRASES["code_not_found_1"]
                    audio_url = await _tts_url("code_not_found_1")
                    return _texml_gather("greeting", text, call_sid, audio_url)
                elif attempts == 1:
                    text = _PHRASES["code_not_found_2"]
                    audio_url = await _tts_url("code_not_found_2")
                    return _texml_gather("greeting", text, call_sid, audio_url)
                else:
                    text = _PHRASES["code_not_found_3"]
                    audio_url = await _tts_url("code_not_found_3")
                    return _texml_gather("unmatched", text, call_sid, audio_url)
        else:
            # Timed out or no speech — replay greeting once, then fall to name fallback
            attempts = state.get("code_attempts", 0)
            if attempts < 1:
                state["code_attempts"] = 1
                if call_sid in _call_states:
                    _call_states[call_sid]["code_attempts"] = 1
                text = _PHRASES["greeting"]
                audio_url = await _tts_url("greeting")
                return _texml_gather("greeting", text, call_sid, audio_url)
            text = _PHRASES["code_not_found_3"]
            audio_url = await _tts_url("code_not_found_3")
            return _texml_gather("unmatched", text, call_sid, audio_url)

    # ── Step: confirm (verify county/state with seller) ──────────────────
    elif step == "confirm":
        speech_up = (speech or "").upper()
        confirmed = any(w in speech_up for w in [
            "YES", "YEAH", "YEP", "SURE", "CORRECT", "RIGHT", "THAT'S RIGHT",
            "THATS RIGHT", "ABSOLUTELY", "THAT IS CORRECT", "YUP", "UH HUH",
        ])
        denied = any(w in speech_up for w in [
            "NO", "NOPE", "WRONG", "INCORRECT", "NOT RIGHT", "THAT'S NOT",
        ])
        if confirmed or (speech and not denied):
            # Treat ambiguous/no-response as yes (common for confused callers)
            background_tasks.add_task(_tts_generate, _PHRASES["ask_name"], "ask_name")
            text = _PHRASES["confirm_yes"]
            audio_url = await _tts_url("confirm_yes")
            return _texml_gather("interest", text, call_sid, audio_url)
        else:
            # Caller said no — let them retry the code
            text = _PHRASES["confirm_wrong"]
            audio_url = await _tts_url("confirm_wrong")
            return _texml_gather("greeting", text, call_sid, audio_url)

    # ── Step: interest (are you interested in our offer?) ────────────────
    elif step == "interest":
        score = _score_interest(speech) if speech else "warm"
        if call_sid in _call_states:
            _call_states[call_sid]["interest_score"] = score
        background_tasks.add_task(_tts_generate, _PHRASES["ask_callback"], "ask_callback")
        text = _PHRASES["ask_name"]
        audio_url = await _tts_url("ask_name")
        return _texml_gather("name", text, call_sid, audio_url)

    # ── Step: name ───────────────────────────────────────────────────────
    elif step == "name":
        if speech and not timed_out:
            if call_sid in _call_states:
                _call_states[call_sid]["caller_name"] = speech.strip()
        text = _PHRASES["ask_callback"]
        audio_url = await _tts_url("ask_callback")
        return _texml_gather("callback", text, call_sid, audio_url)

    # ── Step: callback (is this the best number?) ────────────────────────
    elif step == "callback":
        background_tasks.add_task(_finalize_call, call_sid)
        caller_name = state.get("caller_name") or _call_states.get(call_sid, {}).get("caller_name") or ""
        if caller_name:
            close_text = f"Thank you {caller_name}. Someone from our team will be in touch with you very shortly."
            close_key = f"close_{hashlib.md5(caller_name.encode()).hexdigest()[:8]}"
            audio_url = await _tts_url(close_key, close_text)
        else:
            close_text = _PHRASES["close"]
            audio_url = await _tts_url("close")
        return _texml_hangup(close_text, audio_url)

    # ── Step: unmatched (code not found — get name + address) ────────────
    elif step == "unmatched":
        if speech and not timed_out:
            if call_sid in _call_states:
                _call_states[call_sid]["unmatched_info"] = speech.strip()
        background_tasks.add_task(_finalize_unmatched_call, call_sid)
        close_text = _PHRASES["close"]
        audio_url = await _tts_url("close")
        return _texml_hangup(close_text, audio_url)

    # ── Fallback ─────────────────────────────────────────────────────────
    else:
        background_tasks.add_task(_finalize_call, call_sid)
        close_text = _PHRASES["close"]
        audio_url = await _tts_url("close")
        return _texml_hangup(close_text, audio_url)


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


# ── Call finalization ────────────────────────────────────────────────────────────

async def _finalize_call(call_sid: str) -> None:
    state = _call_states.pop(call_sid, {})
    if not state:
        return

    transcript = state.get("transcript", [])
    property_id = state.get("property_id")
    caller = state.get("caller", "")
    interest_score = state.get("interest_score", "warm")
    # Log the matched code, plus all attempts joined for full traceability
    attempted_codes = state.get("attempted_codes", [])
    caller_offer_code = (
        " | ".join(attempted_codes) if attempted_codes
        else state.get("caller_offer_code")
    )
    caller_name = state.get("caller_name", "")

    transcript_text = "\n".join(
        f"[{t['step'].upper()}] Agent: {_PHRASES.get(t['step'], t['step'])}\n"
        f"Caller: {t.get('speech', '[no response]')}"
        for t in transcript
    )

    # Use Claude for final scoring (falls back to rule-based if unavailable)
    score, summary = await _score_with_claude(transcript)
    if score == "warm" and interest_score != "warm":
        score = interest_score  # trust rule-based if Claude was neutral

    # Add caller name to summary
    if caller_name:
        summary = f"Caller name: {caller_name}. " + summary

    await _log_comm(
        property_id=property_id,
        comm_type="call_inbound",
        phone=caller,
        direction="inbound",
        transcript=transcript_text,
        summary=summary,
        lead_score=score,
        call_id=call_sid,
        caller_offer_code=caller_offer_code,
    )

    if property_id:
        try:
            sb = get_supabase()
            updates: dict = {"updated_at": _now()}
            if caller_name:
                existing = sb.table("crm_properties").select("owner_first_name,notes").eq("id", property_id).execute()
                row = existing.data[0] if existing.data else {}
                if not row.get("owner_first_name") and caller_name:
                    parts = caller_name.strip().split(" ", 1)
                    updates["owner_first_name"] = parts[0]
                    if len(parts) > 1:
                        updates["owner_last_name"] = parts[1]
            if score in ("hot", "warm"):
                updates["status"] = "prospect"
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
    prop = await _create_unmatched_lead(caller, property_address=info)
    property_id = prop.get("id")
    await _log_comm(
        property_id=property_id,
        comm_type="call_inbound",
        phone=caller,
        direction="inbound",
        transcript=transcript_text,
        summary=f"Unmatched code. Seller provided: {info or 'N/A'}",
        lead_score="cold",
        call_id=call_sid,
        caller_offer_code=caller_offer_code,
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
    property_id: str
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
                raise HTTPException(status_code=r.status_code, detail=f"Telnyx: {r.text[:300]}")
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
