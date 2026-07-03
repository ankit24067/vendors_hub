import os
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")


class Config:
    SECRET_KEY = os.getenv("SECRET_KEY", "dev-secret-change-me")
    MOCK_MODE = os.getenv("MOCK_MODE", "true").lower() == "true"

    GOOGLE_SHEET_ID = os.getenv(
        "GOOGLE_SHEET_ID", "1NuKu423Gu1Pmdi6Pf_-F5-4UhEL5zQmEYV0z_QzVtVM"
    )
    # The existing tab that holds Mirraw's reorder demands (must match exactly).
    GOOGLE_DEMAND_TAB = os.getenv("GOOGLE_DEMAND_TAB", "reorder_sheet")
    GOOGLE_OAUTH_CREDS_PATH = os.getenv(
        "GOOGLE_OAUTH_CREDS_PATH", str(BASE_DIR / "credentials" / "credentials.json")
    )
    SHEETS_TOKEN_PATH = os.getenv(
        "SHEETS_TOKEN_PATH", str(BASE_DIR / "credentials" / "token_rw.pickle")
    )

    ADMIN_DOMAIN = os.getenv("ADMIN_DOMAIN", "mirraw.com")
    UPLOAD_DIR = str(BASE_DIR / "uploads")
    PORT = int(os.getenv("PORT", "8000"))

    # ── auth tokens ──────────────────────────────────────────────────────
    JWT_SECRET = os.getenv("JWT_SECRET", os.getenv("SECRET_KEY", "dev-secret-change-me"))
    ACCESS_TTL = int(os.getenv("ACCESS_TTL", "900"))               # 15 min access JWT
    REFRESH_TTL = int(os.getenv("REFRESH_TTL", str(7 * 24 * 3600)))  # 7 day refresh
    COOKIE_SECURE = os.getenv("COOKIE_SECURE", "false").lower() == "true"  # True behind HTTPS
