"""Communications router — Telnyx calls, SMS, and ElevenLabs AI voice agent."""
import json
import os
import re
from datetime import datetime, timedelta, timezone
from typing import Optional

import httpx
from fastapi import APIRouter, BackgroundTasks, HTTPException, Query, Request, Response
from pydantic import BaseModel

from services.supabase_client import get_supabase

router = APIRouter(tags=["communications"])

# ── Config ─────────────────────────────────────────────────────────────


def _telnyx_key() -> str:
    return os.getenv("TELNYX_API_KEY", "")


def _telnyx_phone() -> str:
    return os.getenv("TELNYX_PHONE_NUMBER", "")


def _elevenlabs_key() -> str:
    return os.getenv("ELEVENLABS_API_KEY", "")


def _elevenlabs_voice() -> str:
    return os.getenv("ELEVENLABS_VOICE_ID", "21m00Tcm4TlvDq8ikWAM")  # "Rachel" default


def _admin_email() -> str:
    return os.getenv("ADMIN_EMAIL", "dupeedamien@gmail.com")


def _sendgrid_key() -> str:
    return os.getenv("SENDGRID_API_KEY", "")


def _base_url() -> str:
    return os.getenv(
        "BACKEND_URL",
        "https://land-dominator-production.up.railway.app",
    )


# ── In-memory call state (per Railway instance) ────────────────────────
_call_states: dict[str, dict] = {}

# In-memory ElevenLabs TTS audio cache  {cache_key: bytes}
_audio_cache: dict[str, bytes] = {}

# ── Conversation script ────────────────────────────────────────────────

_STEPS = [
    (
        "greeting",
        (
            "Thank you for calling Dominion Land Group. My name is Alex. "
            "I understand you received a letter from us about your property. "
            "Could I please get your name and the offer code from the letter?"
        ),
    ),
    (
        "availability",
        "Thank you for that. Is your property still available for sale?",
    ),
    (
        "liens",
        "Got it. Are there any liens, back taxes, or other encumbrances on the property?",
    ),
    (
        "access",
        (
            "Understood. Does the property have road access? "
            "And what is your timeline for selling — are you looking to close quickly or is there some flexibility?"
        ),
    ),
    ("price", None),  # Dynamic — uses offer_price from state
    (
        "close",
        (
            "Thank you so much for your time today. "
            "We will review everything and be in touch with you shortly. Have a wonderful day!"
        ),
    ),
]


def _step_text(step_id: str, state: dict) -> str:
    for sid, text in _STEPS:
        if sid == step_id:
            if text is None:
                offer = state.get("offer_price")
                offer_str = f"${int(offer):,}" if offer else "the amount stated in our letter"
                return (
                    f"We sent you a cash offer of {offer_str} for your property. "
                    "Would you be open to accepting that offer? "
                    "We can close quickly with no commissions or fees on your side."
                )
            return text
    return "Thank you for calling. Have a great day!"


def _next_step(current: str) -> Optional[str]:
    ids = [s[0] for s in _STEPS]
    try:
        idx = ids.index(current)
    except ValueError:
        return None
    return ids[idx + 1] if idx + 1 < len(ids) else None


# ── TeXML helpers ──────────────────────────────────────────────────────


def _xml_escape(text: str) -> str:
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def _texml_gather(step_id: str, call_sid: str, say_text: str, audio_url: Optional[str] = None) -> Response:
    nxt = _next_step(step_id)
    action = f"{_base_url()}/api/calls/gather/{nxt or 'done'}"
    redirect = f"{_base_url()}/api/calls/gather/{nxt or 'done'}?timedout=1"

    if audio_url:
        inner = f'<Play>{audio_url}</Play>'
    else:
        safe = _xml_escape(say_text)
        inner = f'<Say voice="Polly.Joanna-Neural">{safe}</Say>'

    xml = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        "<Response>\n"
        f'  <Gather input="speech" action="{action}" method="POST"\n'
        '          timeout="10" speechTimeout="3" language="en-US">\n'
        f"    {inner}\n"
        "  </Gather>\n"
        f'  <Redirect method="POST">{redirect}</Redirect>\n'
        "</Response>"
    )
    return Response(xml, media_type="text/xml")


def _texml_hangup(say_text: str, audio_url: Optional[str] = None) -> Response:
    if audio_url:
        inner = f'<Play>{audio_url}</Play>'
    else:
        safe = _xml_escape(say_text)
        inner = f'<Say voice="Polly.Joanna-Neural">{safe}</Say>'
    xml = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        "<Response>\n"
        f"  {inner}\n"
        "  <Hangup/>\n"
        "</Response>"
    )
    return Response(xml, media_type="text/xml")


# ── ElevenLabs TTS ─────────────────────────────────────────────────────


async def _tts_audio(text: str, cache_key: str) -> Optional[str]:
    """Generate ElevenLabs TTS, cache it, and return URL. Falls back to None."""
    api_key = _elevenlabs_key()
    voice_id = _elevenlabs_voice()
    if not api_key or not voice_id:
        return None
    if cache_key in _audio_cache:
        return f"{_base_url()}/api/calls/audio/{cache_key}"
    try:
        async with httpx.AsyncClient(timeout=20) as client:
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
                _audio_cache[cache_key] = r.content
                return f"{_base_url()}/api/calls/audio/{cache_key}"
    except Exception as exc:
        print(f"[comms] ElevenLabs TTS error: {exc}")
    return None


@router.get("/api/calls/audio/{cache_key}")
async def serve_tts_audio(cache_key: str) -> Response:
    if cache_key not in _audio_cache:
        raise HTTPException(status_code=404, detail="Audio not found")
    return Response(_audio_cache[cache_key], media_type="audio/mpeg")


# ── Utility helpers ────────────────────────────────────────────────────


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
        # Try exact
        r = sb.table("crm_properties").select("*").eq("owner_phone", _normalize_phone(phone)).limit(1).execute()
        if r.data:
            return r.data[0]
        # Try partial
        r = sb.table("crm_properties").select("*").ilike("owner_phone", f"%{digits}").limit(1).execute()
        if r.data:
            return r.data[0]
    except Exception:
        pass
    return None


async def _create_lead(phone: str) -> dict:
    try:
        sb = get_supabase()
        now = _now()
        row = {
            "owner_phone": _normalize_phone(phone),
            "status": "lead",
            "notes": f"Created from inbound call {now[:10]}",
            "updated_at": now,
        }
        r = sb.table("crm_properties").insert(row).execute()
        return r.data[0] if r.data else {}
    except Exception:
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
) -> dict:
    try:
        sb = get_supabase()
        row = {
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


async def _score_with_claude(transcript_parts: list[dict]) -> tuple[str, str]:
    """Return (score, summary) using Claude to analyze the call."""
    try:
        import anthropic  # type: ignore

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
            messages=[
                {
                    "role": "user",
                    "content": (
                        "Analyze this land seller call transcript. Score the lead and summarize.\n\n"
                        "Lead score definitions:\n"
                        "- HOT: Seller is ready to sell at or near the offered price\n"
                        "- WARM: Seller is interested but negotiating price, timeline, or has questions\n"
                        "- COLD: Seller is not interested, property not available, or hung up\n\n"
                        f"Transcript:\n{transcript_text}\n\n"
                        'Respond ONLY with JSON: {"score": "hot|warm|cold", "summary": "2-3 sentence summary"}'
                    ),
                }
            ],
        )
        result = json.loads(rsp.content[0].text.strip())
        return result.get("score", "warm").lower(), result.get("summary", "Call completed.")
    except Exception as exc:
        print(f"[comms] Claude scoring error: {exc}")
        return "warm", "Call completed."


# ── Inbound call endpoints ─────────────────────────────────────────────


@router.post("/api/calls/inbound")
async def inbound_call(request: Request, background_tasks: BackgroundTasks) -> Response:
    """Telnyx TeXML webhook for inbound calls."""
    try:
        form = await request.form()
        call_sid = _form_get(form, "CallSid", "call_control_id") or f"call_{_now()}"
        caller = _form_get(form, "From", "from_")
    except Exception:
        try:
            body = await request.json()
            data = body.get("data", {}).get("payload", body)
            call_sid = data.get("call_control_id", data.get("CallSid", f"call_{_now()}"))
            from_data = data.get("from", {})
            caller = from_data.get("phone_number", "") if isinstance(from_data, dict) else str(from_data)
        except Exception:
            call_sid = f"call_{_now()}"
            caller = ""

    # CRM lookup
    prop = await _lookup_phone(caller)
    if not prop:
        prop = await _create_lead(caller)

    property_id = prop.get("id")
    offer_price = prop.get("offer_price")

    _call_states[call_sid] = {
        "caller": caller,
        "property_id": property_id,
        "offer_price": offer_price,
        "owner_name": prop.get("owner_first_name") or prop.get("owner_full_name", ""),
        "transcript": [],
        "started_at": _now(),
    }

    text = _step_text("greeting", _call_states[call_sid])
    audio_url = await _tts_audio(text, f"{call_sid}_greeting")
    return _texml_gather("greeting", call_sid, text, audio_url)


@router.post("/api/calls/gather/{step}")
async def call_gather(step: str, request: Request, background_tasks: BackgroundTasks) -> Response:
    """Telnyx gather callback — process speech and return next TeXML step."""
    try:
        form = await request.form()
        call_sid = _form_get(form, "CallSid", "call_control_id")
        speech = _form_get(form, "SpeechResult", "speech_result")
        timed_out = form.get("timedout") == "1"
    except Exception:
        call_sid = ""
        speech = ""
        timed_out = False

    state = _call_states.get(call_sid, {})

    # Append to transcript
    if call_sid in _call_states:
        _call_states[call_sid]["transcript"].append(
            {"step": step, "agent": _step_text(step, state), "speech": speech, "timed_out": timed_out}
        )

    if step == "done" or not _next_step(step):
        background_tasks.add_task(_finalize_call, call_sid)
        close_text = _step_text("close", state)
        audio_url = await _tts_audio(close_text, f"{call_sid}_close")
        return _texml_hangup(close_text, audio_url)

    nxt = _next_step(step)
    nxt_text = _step_text(nxt, state)  # type: ignore[arg-type]
    audio_url = await _tts_audio(nxt_text, f"{call_sid}_{nxt}")
    return _texml_gather(nxt, call_sid, nxt_text, audio_url)  # type: ignore[arg-type]


async def _finalize_call(call_sid: str) -> None:
    """Score with Claude, update CRM, send HOT lead notification."""
    state = _call_states.pop(call_sid, {})
    if not state:
        return

    transcript = state.get("transcript", [])
    property_id = state.get("property_id")
    caller = state.get("caller", "")

    score, summary = await _score_with_claude(transcript)
    transcript_text = "\n".join(
        f"[{t['step'].upper()}] Agent: {t.get('agent', '')}\n"
        f"Caller: {t.get('speech', '[no response]')}"
        for t in transcript
    )

    await _log_comm(
        property_id=property_id,
        comm_type="call_inbound",
        phone=caller,
        direction="inbound",
        transcript=transcript_text,
        summary=summary,
        lead_score=score,
        call_id=call_sid,
    )

    if property_id:
        try:
            sb = get_supabase()
            updates: dict = {"updated_at": _now()}
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
        owner = prop_data.get("owner_full_name") or state.get("owner_name") or "Unknown"
        apn = prop_data.get("apn", "")
        county = prop_data.get("county", "")
        code = prop_data.get("campaign_code", "")
        html = (
            "<h2 style='color:#B71C1C'>🔥 HOT LEAD ALERT</h2>"
            f"<ul>"
            f"<li><strong>Owner:</strong> {owner}</li>"
            f"<li><strong>Phone:</strong> {caller}</li>"
            f"<li><strong>APN:</strong> {apn}</li>"
            f"<li><strong>County:</strong> {county}</li>"
            f"<li><strong>Campaign Code:</strong> {code}</li>"
            f"</ul>"
            f"<p><strong>Summary:</strong> {summary}</p>"
            f"<p><a href='https://land-dominator-production.up.railway.app'>Open Land Dominator →</a></p>"
        )
        await _notify_email(f"🔥 HOT LEAD — {owner} — {apn} — {county}", html)


# ── Inbound SMS ─────────────────────────────────────────────────────────


@router.post("/api/sms/inbound")
async def inbound_sms(request: Request, background_tasks: BackgroundTasks) -> dict:
    """Telnyx webhook for inbound SMS messages."""
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
        prop = await _create_lead(from_phone)

    property_id = prop.get("id") if prop else None

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


# ── Outbound SMS ─────────────────────────────────────────────────────────


class SmsSendRequest(BaseModel):
    property_id: str
    to_phone: str
    message: str


@router.post("/crm/sms/send")
async def send_sms(body: SmsSendRequest) -> dict:
    """Send an outbound SMS via Telnyx and log it."""
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


# ── List / stats ───────────────────────────────────────────────────────


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

        # Enrich with property snapshot
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


# ── Migration SQL ──────────────────────────────────────────────────────

COMMUNICATIONS_MIGRATION_SQL = """
CREATE TABLE IF NOT EXISTS crm_communications (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  property_id      UUID REFERENCES crm_properties(id) ON DELETE SET NULL,
  type             TEXT,
  phone_number     TEXT,
  duration_seconds INTEGER,
  recording_url    TEXT,
  transcript       TEXT,
  summary          TEXT,
  lead_score       TEXT,
  direction        TEXT,
  message_body     TEXT,
  call_id          TEXT
);

CREATE INDEX IF NOT EXISTS idx_crm_comms_property  ON crm_communications(property_id);
CREATE INDEX IF NOT EXISTS idx_crm_comms_created   ON crm_communications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_comms_type      ON crm_communications(type);
CREATE INDEX IF NOT EXISTS idx_crm_comms_score     ON crm_communications(lead_score);
"""
