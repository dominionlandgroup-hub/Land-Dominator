"""Mail drop scheduling and automation router."""
import base64
import csv
import io
import os
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from services.supabase_client import get_supabase

router = APIRouter(prefix="/crm", tags=["mail-calendar"])

_SUPPRESS_STATUSES = {"due_diligence", "closed_won", "under_contract", "offer_sent"}
_DO_NOT_MAIL_TAG = "Do Not Mail"
_MAILED_COOLDOWN_DAYS = 90
_COST_PER_PIECE_DEFAULT = 0.55

_MAIL_CSV_HEADERS = [
    "Owner Full Name", "Owner First Name", "Owner Last Name",
    "Mailing Address", "City", "State", "Zip",
    "APN", "County", "Offer Price", "Campaign Code",
]
_MAIL_CSV_FIELDS = [
    "owner_full_name", "owner_first_name", "owner_last_name",
    "owner_mailing_address", "owner_mailing_city", "owner_mailing_state", "owner_mailing_zip",
    "apn", "county", "offer_price", "campaign_code",
]

# ── Schemas ────────────────────────────────────────────────────────────


class MailDropPreviewRequest(BaseModel):
    campaign_id: str
    scheduled_date: str


class MailDropCreate(BaseModel):
    campaign_id: str
    scheduled_date: str
    week_number: Optional[int] = None


# ── Helpers ────────────────────────────────────────────────────────────


def _get_eligible_properties(sb: object, campaign_id: str) -> list[dict]:
    """Return properties eligible for mailing after applying suppression rules."""
    all_props = (
        sb.table("crm_properties")
        .select(
            "id,status,tags,mailed_at,"
            "owner_full_name,owner_first_name,owner_last_name,"
            "owner_mailing_address,owner_mailing_city,owner_mailing_state,owner_mailing_zip,"
            "apn,county,offer_price,campaign_code"
        )
        .eq("campaign_id", campaign_id)
        .execute()
        .data
    )
    cutoff = datetime.now(timezone.utc) - timedelta(days=_MAILED_COOLDOWN_DAYS)
    eligible = []
    for p in all_props:
        if (p.get("status") or "lead") in _SUPPRESS_STATUSES:
            continue
        tags = p.get("tags") or []
        if _DO_NOT_MAIL_TAG in tags:
            continue
        mailed_at = p.get("mailed_at")
        if mailed_at:
            try:
                mailed_dt = datetime.fromisoformat(mailed_at.replace("Z", "+00:00"))
                if mailed_dt > cutoff:
                    continue
            except Exception:
                pass
        eligible.append(p)
    return eligible


def _generate_csv_bytes(properties: list[dict]) -> bytes:
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(_MAIL_CSV_HEADERS)
    for p in properties:
        writer.writerow([p.get(f) or "" for f in _MAIL_CSV_FIELDS])
    return buf.getvalue().encode("utf-8")


def _generate_pdf_bytes(
    campaign_name: str,
    drop_date: str,
    pieces: int,
    cost: float,
) -> bytes:
    try:
        from reportlab.lib.pagesizes import letter  # type: ignore
        from reportlab.pdfgen import canvas as rl_canvas  # type: ignore
    except ImportError:
        return b""

    buf = io.BytesIO()
    c = rl_canvas.Canvas(buf, pagesize=letter)
    w, h = letter  # noqa: F841

    c.setFont("Helvetica-Bold", 18)
    c.drawString(72, h - 72, "Land Dominator — Mail Drop Authorization")

    c.setFont("Helvetica", 12)
    y = h - 120
    for label, val in [
        ("Campaign:", campaign_name),
        ("Scheduled Date:", drop_date),
        ("Total Pieces:", f"{pieces:,}"),
        ("Estimated Cost:", f"${cost:,.2f}"),
        ("Authorized:", drop_date),
    ]:
        c.setFont("Helvetica-Bold", 12)
        c.drawString(72, y, label)
        c.setFont("Helvetica", 12)
        c.drawString(200, y, str(val))
        y -= 22

    y -= 30
    c.setFont("Helvetica", 12)
    c.drawString(72, y, "Signature: _______________________________")
    y -= 24
    c.drawString(72, y, f"Date: {datetime.now().strftime('%B %d, %Y')}")

    c.save()
    buf.seek(0)
    return buf.read()


async def _send_via_sendgrid(
    to_email: str,
    subject: str,
    html_body: str,
    csv_bytes: bytes,
    pdf_bytes: bytes,
    campaign_name: str,
) -> None:
    import httpx  # noqa: PLC0415

    api_key = os.getenv("SENDGRID_API_KEY", "")
    if not api_key:
        raise ValueError("SENDGRID_API_KEY environment variable is not set")

    from_email = os.getenv("SENDGRID_FROM_EMAIL", "dominionlandgroup@gmail.com")
    payload: dict = {
        "personalizations": [{"to": [{"email": to_email}]}],
        "from": {"email": from_email, "name": "Land Dominator"},
        "subject": subject,
        "content": [{"type": "text/html", "value": html_body}],
        "attachments": [],
    }

    if csv_bytes:
        payload["attachments"].append({
            "content": base64.b64encode(csv_bytes).decode(),
            "filename": f"{campaign_name.replace(' ', '_')}_mail_list.csv",
            "type": "text/csv",
        })

    if pdf_bytes:
        payload["attachments"].append({
            "content": base64.b64encode(pdf_bytes).decode(),
            "filename": f"{campaign_name.replace(' ', '_')}_authorization.pdf",
            "type": "application/pdf",
        })

    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(
            "https://api.sendgrid.com/v3/mail/send",
            json=payload,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
        )
        r.raise_for_status()


# ── Endpoints ──────────────────────────────────────────────────────────


@router.get("/mail-drops")
async def list_mail_drops(campaign_id: Optional[str] = Query(None)) -> list:
    sb = get_supabase()
    try:
        q = sb.table("crm_mail_drops").select("*").order("scheduled_date", desc=False)
        if campaign_id:
            q = q.eq("campaign_id", campaign_id)
        drops = q.execute().data

        camp_ids = list({d["campaign_id"] for d in drops if d.get("campaign_id")})
        camp_map: dict = {}
        if camp_ids:
            camps = (
                sb.table("crm_campaigns")
                .select("id,name")
                .in_("id", camp_ids)
                .execute()
                .data
            )
            camp_map = {c["id"]: c["name"] for c in camps}

        for d in drops:
            d["campaign_name"] = camp_map.get(d.get("campaign_id"), "")
        return drops
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/mail-drops/preview")
async def preview_mail_drop(body: MailDropPreviewRequest) -> dict:
    sb = get_supabase()
    try:
        camp_res = sb.table("crm_campaigns").select("*").eq("id", body.campaign_id).execute().data
        cost_per_piece = _COST_PER_PIECE_DEFAULT
        if camp_res:
            cost_per_piece = float(camp_res[0].get("cost_per_piece") or _COST_PER_PIECE_DEFAULT)

        total_res = (
            sb.table("crm_properties")
            .select("id", count="exact")
            .eq("campaign_id", body.campaign_id)
            .limit(0)
            .execute()
        )
        total = total_res.count or 0
        eligible = _get_eligible_properties(sb, body.campaign_id)
        suppressed = total - len(eligible)

        return {
            "campaign_id": body.campaign_id,
            "scheduled_date": body.scheduled_date,
            "total_records": total,
            "suppressed_count": suppressed,
            "eligible_count": len(eligible),
            "estimated_cost": round(len(eligible) * cost_per_piece, 2),
            "cost_per_piece": cost_per_piece,
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/mail-drops", status_code=201)
async def create_mail_drop(body: MailDropCreate) -> dict:
    sb = get_supabase()
    try:
        camp_res = sb.table("crm_campaigns").select("*").eq("id", body.campaign_id).execute().data
        if not camp_res:
            raise HTTPException(status_code=404, detail="Campaign not found")
        camp = camp_res[0]
        cost_per_piece = float(camp.get("cost_per_piece") or _COST_PER_PIECE_DEFAULT)

        eligible = _get_eligible_properties(sb, body.campaign_id)
        estimated_cost = round(len(eligible) * cost_per_piece, 2)

        now = datetime.now(timezone.utc).isoformat()
        row = {
            "campaign_id": body.campaign_id,
            "week_number": body.week_number,
            "scheduled_date": body.scheduled_date,
            "pieces_count": len(eligible),
            "estimated_cost": estimated_cost,
            "status": "scheduled",
            "created_at": now,
            "updated_at": now,
        }
        res = sb.table("crm_mail_drops").insert(row).execute()
        if not res.data:
            raise HTTPException(status_code=500, detail="Failed to create mail drop")
        created = res.data[0]
        created["campaign_name"] = camp.get("name", "")
        return created
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.patch("/mail-drops/{drop_id}/approve")
async def approve_mail_drop(drop_id: str) -> dict:
    sb = get_supabase()
    try:
        res = sb.table("crm_mail_drops").select("*").eq("id", drop_id).execute()
        if not res.data:
            raise HTTPException(status_code=404, detail="Mail drop not found")
        drop = res.data[0]
        if drop["status"] != "scheduled":
            raise HTTPException(
                status_code=400,
                detail=f"Cannot approve a drop with status '{drop['status']}'",
            )
        now = datetime.now(timezone.utc).isoformat()
        updated = sb.table("crm_mail_drops").update({
            "status": "approved",
            "approved_at": now,
            "updated_at": now,
        }).eq("id", drop_id).execute()
        return updated.data[0] if updated.data else drop
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/mail-drops/{drop_id}/send")
async def send_mail_drop(drop_id: str) -> dict:
    """Generate CSV + PDF, email to mail house, and mark properties as mailed."""
    sb = get_supabase()
    try:
        res = sb.table("crm_mail_drops").select("*").eq("id", drop_id).execute()
        if not res.data:
            raise HTTPException(status_code=404, detail="Mail drop not found")
        drop = res.data[0]
        if drop["status"] != "approved":
            raise HTTPException(
                status_code=400,
                detail=f"Mail drop must be approved before sending (current: {drop['status']})",
            )

        campaign_id = drop["campaign_id"]
        camp_res = sb.table("crm_campaigns").select("*").eq("id", campaign_id).execute().data
        if not camp_res:
            raise HTTPException(status_code=404, detail="Campaign not found")
        camp = camp_res[0]

        mail_house_email = camp.get("mail_house_email") or os.getenv("DEFAULT_MAIL_HOUSE_EMAIL", "")
        if not mail_house_email:
            raise HTTPException(
                status_code=400,
                detail="No mail house email set on campaign. Edit the campaign to add one.",
            )

        eligible = _get_eligible_properties(sb, campaign_id)
        csv_bytes = _generate_csv_bytes(eligible)
        pdf_bytes = _generate_pdf_bytes(
            camp.get("name", ""),
            drop.get("scheduled_date", ""),
            len(eligible),
            float(drop.get("estimated_cost") or 0),
        )

        html_body = f"""
        <h2>Mail Drop — {camp.get('name', '')}</h2>
        <p>Please find attached the mailing list and authorization form.</p>
        <ul>
            <li><strong>Campaign:</strong> {camp.get('name', '')}</li>
            <li><strong>Scheduled Date:</strong> {drop.get('scheduled_date', '')}</li>
            <li><strong>Total Pieces:</strong> {len(eligible):,}</li>
            <li><strong>Estimated Cost:</strong> ${float(drop.get('estimated_cost') or 0):,.2f}</li>
        </ul>
        <p>The CSV attachment contains the mailing list. The PDF is the signed authorization form.</p>
        <p>Thank you,<br>Land Dominator</p>
        """

        await _send_via_sendgrid(
            to_email=mail_house_email,
            subject=f"Mail Drop — {camp.get('name', '')} — {drop.get('scheduled_date', '')}",
            html_body=html_body,
            csv_bytes=csv_bytes,
            pdf_bytes=pdf_bytes,
            campaign_name=camp.get("name", ""),
        )

        now = datetime.now(timezone.utc).isoformat()
        cost_per_piece = float(camp.get("cost_per_piece") or _COST_PER_PIECE_DEFAULT)
        actual_cost = round(len(eligible) * cost_per_piece, 2)

        # Mark properties as mailed in batches
        prop_ids = [p["id"] for p in eligible]
        for i in range(0, len(prop_ids), 100):
            batch = prop_ids[i : i + 100]
            sb.table("crm_properties").update({"mailed_at": now}).in_("id", batch).execute()

        # Update campaign amount_spent
        current_spent = float(camp.get("amount_spent") or 0)
        sb.table("crm_campaigns").update({
            "amount_spent": round(current_spent + actual_cost, 2),
            "updated_at": now,
        }).eq("id", campaign_id).execute()

        updated = sb.table("crm_mail_drops").update({
            "status": "sent",
            "sent_at": now,
            "email_sent_to": mail_house_email,
            "pieces_count": len(eligible),
            "estimated_cost": actual_cost,
            "updated_at": now,
        }).eq("id", drop_id).execute()

        return updated.data[0] if updated.data else drop

    except HTTPException:
        raise
    except Exception as exc:
        try:
            sb.table("crm_mail_drops").update({
                "status": "error",
                "error": str(exc)[:500],
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }).eq("id", drop_id).execute()
        except Exception:
            pass
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/mail-drops/{drop_id}/csv")
async def download_mail_drop_csv(drop_id: str) -> StreamingResponse:
    sb = get_supabase()
    try:
        res = sb.table("crm_mail_drops").select("*").eq("id", drop_id).execute()
        if not res.data:
            raise HTTPException(status_code=404, detail="Mail drop not found")
        drop = res.data[0]
        campaign_id = drop["campaign_id"]

        camp_res = sb.table("crm_campaigns").select("name").eq("id", campaign_id).execute().data
        camp_name = camp_res[0]["name"] if camp_res else "campaign"

        eligible = _get_eligible_properties(sb, campaign_id)
        csv_bytes = _generate_csv_bytes(eligible)
        filename = f"{camp_name.replace(' ', '_')}_mail_list.csv"

        return StreamingResponse(
            io.BytesIO(csv_bytes),
            media_type="text/csv",
            headers={"Content-Disposition": f"attachment; filename={filename}"},
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.delete("/mail-drops/{drop_id}", status_code=204)
async def delete_mail_drop(drop_id: str) -> None:
    sb = get_supabase()
    try:
        sb.table("crm_mail_drops").delete().eq("id", drop_id).execute()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


# ── Weekly summary (also callable as API endpoint) ─────────────────────


@router.post("/send-weekly-summary", status_code=200)
async def trigger_weekly_summary() -> dict:
    """Manually trigger the weekly summary email."""
    await send_weekly_summary_task()
    return {"sent": True}


async def send_weekly_summary_task() -> None:
    """Send weekly Monday summary email to admin."""
    import httpx  # noqa: PLC0415

    api_key = os.getenv("SENDGRID_API_KEY", "")
    admin_email = os.getenv("ADMIN_EMAIL", "dupeedamien@gmail.com")
    from_email = os.getenv("SENDGRID_FROM_EMAIL", "dominionlandgroup@gmail.com")

    if not api_key:
        print("Weekly summary: SENDGRID_API_KEY not set — skipping.")
        return

    try:
        sb = get_supabase()
        pending = (
            sb.table("crm_mail_drops")
            .select("id,campaign_id,scheduled_date,pieces_count,estimated_cost")
            .in_("status", ["scheduled", "approved"])
            .execute()
            .data
        )
        week_ago = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
        new_leads_res = (
            sb.table("crm_properties")
            .select("id", count="exact")
            .eq("status", "lead")
            .gte("created_at", week_ago)
            .limit(0)
            .execute()
        )
        new_leads_count = new_leads_res.count or 0

        total_res = (
            sb.table("crm_properties")
            .select("id", count="exact")
            .limit(0)
            .execute()
        )
        total_count = total_res.count or 0

        deals = sb.table("crm_deals").select("id,stage").execute().data

        pending_html = "".join(
            f"<li>{d.get('scheduled_date', '')} — {d.get('pieces_count', 0):,} pieces — ${float(d.get('estimated_cost') or 0):,.2f}</li>"
            for d in pending
        ) or "<li>None</li>"

        html = f"""
        <h2>Land Dominator Weekly Summary — {datetime.now().strftime('%B %d, %Y')}</h2>

        <h3>Pending Mail Drops ({len(pending)})</h3>
        <ul>{pending_html}</ul>

        <h3>Properties</h3>
        <p>Total: <strong>{total_count:,}</strong> &nbsp;|&nbsp; New leads this week: <strong>{new_leads_count:,}</strong></p>

        <h3>Deal Pipeline ({len(deals)} active)</h3>
        <p>
        {', '.join(f"{stage}: {sum(1 for d in deals if d.get('stage') == stage)}"
                   for stage in ['lead','prospect','offer_sent','under_contract','due_diligence','closed_won']
                   if any(d.get('stage') == stage for d in deals))}
        </p>

        <p style="margin-top:24px">
          <a href="https://land-dominator-production.up.railway.app">Open Land Dominator →</a>
        </p>
        """

        payload = {
            "personalizations": [{"to": [{"email": admin_email}]}],
            "from": {"email": from_email, "name": "Land Dominator"},
            "subject": f"Land Dominator Weekly Summary — {datetime.now().strftime('%B %d, %Y')}",
            "content": [{"type": "text/html", "value": html}],
        }

        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.post(
                "https://api.sendgrid.com/v3/mail/send",
                json=payload,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
            )
            r.raise_for_status()
        print(f"Weekly summary sent to {admin_email}")

    except Exception as exc:
        print(f"Weekly summary error: {exc}")


# ── Migration SQL ──────────────────────────────────────────────────────

MAIL_DROP_MIGRATION_SQL = """
CREATE TABLE IF NOT EXISTS crm_mail_drops (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id         UUID REFERENCES crm_campaigns(id) ON DELETE CASCADE,
  week_number         INT,
  scheduled_date      DATE,
  pieces_count        INT,
  estimated_cost      NUMERIC,
  status              TEXT DEFAULT 'scheduled',
  approved_at         TIMESTAMPTZ,
  sent_at             TIMESTAMPTZ,
  email_sent_to       TEXT,
  records_sent        JSONB,
  suppression_summary TEXT,
  error               TEXT,
  created_at          TIMESTAMPTZ DEFAULT now(),
  updated_at          TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE crm_campaigns ADD COLUMN IF NOT EXISTS total_budget     NUMERIC;
ALTER TABLE crm_campaigns ADD COLUMN IF NOT EXISTS cost_per_piece   NUMERIC DEFAULT 0.55;
ALTER TABLE crm_campaigns ADD COLUMN IF NOT EXISTS weekly_budget    NUMERIC;
ALTER TABLE crm_campaigns ADD COLUMN IF NOT EXISTS pieces_per_week  INT;
ALTER TABLE crm_campaigns ADD COLUMN IF NOT EXISTS send_day         TEXT;
ALTER TABLE crm_campaigns ADD COLUMN IF NOT EXISTS mail_house_email TEXT;
ALTER TABLE crm_campaigns ADD COLUMN IF NOT EXISTS start_date       DATE;
ALTER TABLE crm_campaigns ADD COLUMN IF NOT EXISTS amount_spent     NUMERIC DEFAULT 0;

ALTER TABLE crm_properties ADD COLUMN IF NOT EXISTS mailed_at TIMESTAMPTZ;
"""
