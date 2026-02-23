from __future__ import annotations

import json
import logging
import os
import smtplib
from datetime import datetime, timezone
from email.message import EmailMessage
from typing import Any
from urllib import error as urllib_error
from urllib import request as urllib_request

from app.settings import get_settings

logger = logging.getLogger("app.notification_alerts")


def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _normalize_alarm_codes(raw: Any) -> list[str]:
    if not isinstance(raw, list):
        return []
    values: list[str] = []
    for item in raw:
        normalized = str(item or "").strip()
        if normalized:
            values.append(normalized)
    return values


def _post_json(
    *,
    url: str,
    payload: dict[str, Any],
    timeout_seconds: int = 10,
    headers: dict[str, str] | None = None,
) -> dict[str, Any]:
    body = json.dumps(payload).encode("utf-8")
    request = urllib_request.Request(
        url=url,
        data=body,
        method="POST",
        headers={"Content-Type": "application/json"},
    )
    for key, value in (headers or {}).items():
        normalized_key = str(key or "").strip()
        normalized_value = str(value or "").strip()
        if normalized_key and normalized_value:
            request.add_header(normalized_key, normalized_value)

    try:
        with urllib_request.urlopen(request, timeout=max(1, timeout_seconds)) as response:
            status_code = int(getattr(response, "status", 200) or 200)
            response_body = response.read(512).decode("utf-8", errors="ignore")
            return {
                "ok": 200 <= status_code < 300,
                "status_code": status_code,
                "error": None if 200 <= status_code < 300 else response_body,
            }
    except urllib_error.HTTPError as exc:
        error_body = exc.read(512).decode("utf-8", errors="ignore")
        return {
            "ok": False,
            "status_code": int(exc.code),
            "error": error_body or str(exc),
        }
    except Exception as exc:  # pragma: no cover - network/timeout defensive path
        return {
            "ok": False,
            "status_code": None,
            "error": str(exc),
        }


def _send_alarm_email(*, recipients: list[str], subject: str, body: str) -> dict[str, Any]:
    smtp_host = (os.getenv("SMTP_HOST") or "").strip()
    smtp_port_raw = (os.getenv("SMTP_PORT") or "587").strip()
    smtp_user = (os.getenv("SMTP_USER") or "").strip()
    smtp_pass = os.getenv("SMTP_PASS") or ""
    smtp_from = (os.getenv("SMTP_FROM") or "").strip()
    smtp_use_tls = (os.getenv("SMTP_USE_TLS") or "true").strip().lower() not in {
        "0",
        "false",
        "no",
    }
    smtp_port = int(smtp_port_raw) if smtp_port_raw.isdigit() else 587

    if not recipients:
        return {
            "configured": False,
            "ok": False,
            "sent": 0,
            "error": "NO_RECIPIENTS",
        }
    if not smtp_host or not smtp_from:
        return {
            "configured": False,
            "ok": False,
            "sent": 0,
            "error": "SMTP_NOT_CONFIGURED",
        }

    email = EmailMessage()
    email["From"] = smtp_from
    email["To"] = ", ".join(recipients)
    email["Subject"] = subject
    email.set_content(body)

    with smtplib.SMTP(smtp_host, smtp_port, timeout=15) as smtp_client:
        if smtp_use_tls:
            smtp_client.starttls()
        if smtp_user:
            smtp_client.login(smtp_user, smtp_pass)
        smtp_client.send_message(email)
    return {
        "configured": True,
        "ok": True,
        "sent": len(recipients),
        "error": None,
    }


def dispatch_daily_report_alarm(
    *,
    daily_report_health: dict[str, Any],
    cleared: bool,
) -> dict[str, Any]:
    settings = get_settings()
    alarms = _normalize_alarm_codes(daily_report_health.get("alarms"))
    report_date = str(daily_report_health.get("report_date") or "-")
    evaluated_at_utc = str(daily_report_health.get("evaluated_at_utc") or _utcnow_iso())
    status_text = "CLEARED" if cleared else "ALARM"
    title = f"[{status_text}] Daily report job health ({report_date})"
    body = (
        f"status={daily_report_health.get('status') or '-'} "
        f"targets={daily_report_health.get('push_total_targets') or 0} "
        f"sent={daily_report_health.get('push_sent') or 0} "
        f"failed={daily_report_health.get('push_failed') or 0} "
        f"email_sent={daily_report_health.get('email_sent') or 0}"
    )
    if alarms and not cleared:
        body = f"{body} alarms={','.join(alarms)}"

    payload = {
        "event": "DAILY_REPORT_HEALTH",
        "status": status_text,
        "report_date": report_date,
        "evaluated_at_utc": evaluated_at_utc,
        "alarms": alarms,
        "summary": {
            "job_exists": bool(daily_report_health.get("job_exists")),
            "archive_exists": bool(daily_report_health.get("archive_exists")),
            "status": daily_report_health.get("status"),
            "push_total_targets": int(daily_report_health.get("push_total_targets") or 0),
            "push_sent": int(daily_report_health.get("push_sent") or 0),
            "push_failed": int(daily_report_health.get("push_failed") or 0),
            "email_sent": int(daily_report_health.get("email_sent") or 0),
            "target_zero": bool(daily_report_health.get("target_zero")),
        },
    }

    webhook_url = (settings.notification_alarm_webhook_url or "").strip()
    webhook_token = (settings.notification_alarm_webhook_token or "").strip()
    webhook_result = {
        "configured": bool(webhook_url),
        "ok": False,
        "status_code": None,
        "error": None,
    }
    if webhook_url:
        webhook_headers: dict[str, str] = {}
        if webhook_token:
            webhook_headers["Authorization"] = f"Bearer {webhook_token}"
        webhook_result = {
            "configured": True,
            **_post_json(url=webhook_url, payload=payload, headers=webhook_headers),
        }

    discord_webhook_url = (settings.notification_alarm_discord_webhook_url or "").strip()
    discord_result = {
        "configured": bool(discord_webhook_url),
        "ok": False,
        "status_code": None,
        "error": None,
    }
    if discord_webhook_url:
        discord_payload = {
            "content": f"**{title}**\n{body}",
        }
        discord_result = {
            "configured": True,
            **_post_json(url=discord_webhook_url, payload=discord_payload),
        }

    telegram_token = (settings.notification_alarm_telegram_bot_token or "").strip()
    telegram_chat_id = (settings.notification_alarm_telegram_chat_id or "").strip()
    telegram_result = {
        "configured": bool(telegram_token and telegram_chat_id),
        "ok": False,
        "status_code": None,
        "error": None,
    }
    if telegram_token and telegram_chat_id:
        telegram_url = f"https://api.telegram.org/bot{telegram_token}/sendMessage"
        telegram_payload = {
            "chat_id": telegram_chat_id,
            "text": f"{title}\n{body}",
            "disable_notification": bool(cleared),
        }
        telegram_result = {
            "configured": True,
            **_post_json(url=telegram_url, payload=telegram_payload),
        }

    email_targets = [
        value.strip()
        for value in (settings.notification_alarm_email_to or "").split(",")
        if value.strip()
    ]
    email_result = {
        "configured": bool(email_targets),
        "ok": False,
        "sent": 0,
        "error": None,
    }
    if email_targets:
        try:
            email_result = _send_alarm_email(
                recipients=email_targets,
                subject=title,
                body=body,
            )
        except Exception as exc:  # pragma: no cover - smtp runtime defensive path
            email_result = {
                "configured": True,
                "ok": False,
                "sent": 0,
                "error": str(exc),
            }

    channels = {
        "webhook": webhook_result,
        "discord": discord_result,
        "telegram": telegram_result,
        "email": email_result,
    }
    successful_channels = sum(
        1
        for result in channels.values()
        if bool(result.get("configured")) and bool(result.get("ok"))
    )
    configured_channels = sum(1 for result in channels.values() if bool(result.get("configured")))

    summary = {
        "title": title,
        "body": body,
        "status": status_text,
        "configured_channels": configured_channels,
        "successful_channels": successful_channels,
        "channels": channels,
    }
    logger.info("notification_daily_report_alarm_dispatch", extra=summary)
    return summary
