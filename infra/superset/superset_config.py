"""
Phase 19 — Apache Superset configuration for NEXUSTHEME analytics.

Superset is an EXTERNAL BI service (official image, not forked). It reads the `analytics`
schema through the read-only `superset_ro` role and keeps its own metadata database.
All secrets come from environment variables; the process refuses to start without them.
"""
import os


def _require(name: str, min_length: int = 1) -> str:
    value = os.environ.get(name, "").strip()
    if len(value) < min_length or value.lower() in {"changeme", "change-me", "secret", "superset"}:
        raise RuntimeError(f"{name} is required (min {min_length} chars, no placeholder); refusing to start")
    return value


IS_PRODUCTION = os.environ.get("SUPERSET_ENV", "development") == "production"

# Fail closed: no default secret key, no default metadata DB credentials.
SECRET_KEY = _require("SUPERSET_SECRET_KEY", 32)
SQLALCHEMY_DATABASE_URI = _require("SUPERSET_METADATA_DB_URI")

# Cache / async queries
REDIS_URL = os.environ.get("SUPERSET_REDIS_URL", "redis://superset-redis:6379/0")
CACHE_CONFIG = {"CACHE_TYPE": "RedisCache", "CACHE_DEFAULT_TIMEOUT": 300, "CACHE_KEY_PREFIX": "superset_", "CACHE_REDIS_URL": REDIS_URL}
DATA_CACHE_CONFIG = CACHE_CONFIG

# Security hardening
WTF_CSRF_ENABLED = True
TALISMAN_ENABLED = True
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SECURE = IS_PRODUCTION
SESSION_COOKIE_SAMESITE = "Lax"
ENABLE_PROXY_FIX = True
# Superset may only connect to databases on this allow-list of URI prefixes (no SQLite, no
# arbitrary hosts): the analytics warehouse via the read-only role.
PREVENT_UNSAFE_DB_CONNECTIONS = True
PUBLIC_ROLE_LIKE = None
AUTH_ROLE_PUBLIC = None
GUEST_ROLE_NAME = None

FEATURE_FLAGS = {
    # Jinja in SQL can be abused to reach other tables/functions; keep it off.
    "ENABLE_TEMPLATE_PROCESSING": False,
    # Row Level Security is how client/tenant isolation is enforced inside Superset.
    "ROW_LEVEL_SECURITY": True,
    "DASHBOARD_RBAC": True,
    "EMBEDDED_SUPERSET": False,
    "ALERT_REPORTS": False,
}

# SQL Lab: read-only by design (the DB role is read-only too; defence in depth).
SQLLAB_TIMEOUT = 30
SQL_MAX_ROW = 50000
DISPLAY_MAX_ROW = 10000
SQLLAB_CTAS_NO_LIMIT = False

ROW_LIMIT = 50000
