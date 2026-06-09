"""
ROGAN LIVE - Rate Limiting Middleware (Phase 4)
Custom SlowAPI configuration with per-endpoint rate limits,
Redis-backed storage, and custom error response format.
"""

from fastapi import Request
from fastapi.responses import JSONResponse
from slowapi import Limiter
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

from app.config import settings


def get_client_identifier(request: Request) -> str:
    """Get client identifier for rate limiting.
    Uses authenticated user ID if available, falls back to IP address.
    """
    # Try to get user ID from JWT token in Authorization header
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        try:
            from jose import jwt

            token = auth_header.replace("Bearer ", "")
            payload = jwt.decode(
                token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM]
            )
            user_id = payload.get("user_id")
            if user_id:
                return f"user:{user_id}"
        except Exception:
            pass

    # Fall back to IP address
    return get_remote_address(request)


# Create the rate limiter instance
def create_rate_limiter() -> Limiter:
    """Create and configure the rate limiter with Redis storage if available."""
    # Try to use Redis storage if the real redis package is available
    try:
        import redis as redis_lib  # noqa: F401
        if settings.REDIS_ENABLED:
            storage_uri = settings.REDIS_URL
            # SlowAPI supports storage_uri parameter
            return Limiter(
                key_func=get_client_identifier,
                default_limits=["100/minute"],
                storage_uri=storage_uri,
            )
    except Exception:
        pass  # Fall back to in-memory storage

    return Limiter(
        key_func=get_client_identifier,
        default_limits=["100/minute"],  # Default: 100/min for general API
    )


# Singleton rate limiter
limiter = create_rate_limiter()


# Per-endpoint rate limit configuration
RATE_LIMITS = {
    "auth_login": "5/minute",
    "auth_register": "3/minute",
    "gifts_send": "30/minute",
    "dm_send": "60/minute",
    "wallet_ops": "10/minute",
    "api_general": "100/minute",
}


def custom_rate_limit_exceeded_handler(request: Request, exc: RateLimitExceeded) -> JSONResponse:
    """Custom error response format for rate limit exceeded."""
    return JSONResponse(
        status_code=429,
        content={
            "error": "rate_limit_exceeded",
            "message": "Too many requests. Please try again later.",
            "detail": str(exc.detail),
        },
    )
