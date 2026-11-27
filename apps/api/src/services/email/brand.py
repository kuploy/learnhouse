"""FORK (kuploy-learnhouse#37): the operator's name and logo for outgoing email."""

import logging
import os
import re
from dataclasses import dataclass

from sqlmodel import select

from src.core.deployment_mode import get_deployment_mode
from src.db.organizations import Organization
from src.services.email.utils import get_base_url_from_request

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class EmailBrand:
    name: str
    home_url: str
    logo_url: str | None = None


async def get_email_brand(db_session, request, org=None) -> EmailBrand | None:
    """
    The brand to put on an email, or None to keep the built-in one.

    Emails with no organization of their own (welcome, platform password reset)
    take the instance's organization when there is exactly one, outside SaaS.
    Never raises: an email must not fail over its branding.
    """
    try:
        if org is None:
            if get_deployment_mode() == "saas":
                return None
            orgs = (await db_session.execute(select(Organization).limit(2))).scalars().all()
            if len(orgs) != 1:
                return None
            org = orgs[0]

        name = " ".join(str(org.name).split())
        if not name:
            return None
        home_url = get_base_url_from_request(request).rstrip("/")

        logo_url = None
        if org.logo_image:
            # Same order the web app uses to build media addresses.
            media_url = (
                os.environ.get("NEXT_PUBLIC_LEARNHOUSE_MEDIA_URL")
                or os.environ.get("NEXT_PUBLIC_LEARNHOUSE_BACKEND_URL")
                or home_url
            ).rstrip("/")
            logo_url = f"{media_url}/content/orgs/{org.org_uuid}/logos/{org.logo_image}"

        return EmailBrand(name=name, home_url=home_url, logo_url=logo_url)
    except Exception:
        logger.warning("Could not load email branding", exc_info=True)
        return None


def sender_name(name: str) -> str:
    """`name` made safe for the display part of a From header."""
    return " ".join(re.sub(r'[<>",;:@\\]', " ", name).split())
