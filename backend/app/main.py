"""
ROGAN LIVE - Main FastAPI Application
Mounts all routers, middleware, WebSocket endpoint, and startup logic.
"""

import logging
import os
import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from slowapi.errors import RateLimitExceeded
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request as StarletteRequest

logger = logging.getLogger(__name__)


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Add security headers to every response."""

    async def dispatch(self, request: StarletteRequest, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
        return response

from app.config import settings
from app.database import Base, engine
from app.routes import auth, creators, dm, gifts, notifications, streams, wallet
from app.routes import moderation, tasks, subscriptions
from app.routes import marketplace, pk_battles, web3, oauth
from app.routes import stream_keys, mediamtx, private_shows
from app.routes import admin as admin_routes
from app.middleware.rate_limit import limiter, custom_rate_limit_exceeded_handler
from app.websocket.handler import websocket_endpoint
from app.websocket.dm_handler import dm_websocket_endpoint, user_websocket_endpoint


async def _auto_renewal_task():
    """Background task: process subscription auto-renewals daily."""
    while True:
        try:
            await asyncio.sleep(86400)  # Run every 24 hours
            from app.database import SessionLocal
            from app.services.subscription_service import process_auto_renewals

            db = SessionLocal()
            try:
                stats = process_auto_renewals(db)
                logger.info("Auto-renewal processed: %s", stats)
            finally:
                db.close()
        except Exception as e:
            logger.error("Auto-renewal task error: %s", e, exc_info=True)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup: create database tables (if not using Alembic), start background tasks."""
    # Import all models so Base.metadata knows about them
    import app.models.models  # noqa: F401

    # Only auto-create tables when NOT using Alembic migrations
    # (SQLite dev mode or missing alembic.ini)
    use_alembic = os.getenv("USE_ALEMBIC", "false").lower() == "true"
    if not use_alembic:
        Base.metadata.create_all(bind=engine)
        print("📋 Tables created via Base.metadata.create_all()")
    else:
        print("📋 Alembic migrations detected — skipping auto table creation")

    # Scrub credentials from DB URL before logging
    _db_safe = settings.DATABASE_URL.split("@")[-1] if "@" in settings.DATABASE_URL else settings.DATABASE_URL
    print(f"🚀 {settings.APP_NAME} v{settings.APP_VERSION} started")
    print(f"📊 Database: @{_db_safe}")
    print(f"🔑 Redis enabled: {settings.REDIS_ENABLED}")

    # Start background tasks
    renewal_task = asyncio.create_task(_auto_renewal_task())

    yield

    # Cleanup
    renewal_task.cancel()
    print(f"👋 {settings.APP_NAME} shutting down")


# Create FastAPI app
app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    lifespan=lifespan,
    redirect_slashes=False,  # FIX: prevent 307 redirects when frontend omits trailing slash
)

# Security headers — must be added before CORS so it wraps everything
app.add_middleware(SecurityHeadersMiddleware)

# CORS middleware.
# FIX: allow_origins=["*"] + allow_credentials=True is rejected by browsers.
# Always use the explicit origins list — in dev these are the local dev-server addresses.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

# Rate limiter
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, custom_rate_limit_exceeded_handler)

# Include routers with API prefix
# Phase 1
app.include_router(auth.router, prefix=settings.API_PREFIX)
app.include_router(streams.router, prefix=settings.API_PREFIX)
app.include_router(gifts.router, prefix=settings.API_PREFIX)
app.include_router(wallet.router, prefix=settings.API_PREFIX)
app.include_router(dm.router, prefix=settings.API_PREFIX)
app.include_router(notifications.router, prefix=settings.API_PREFIX)
app.include_router(creators.router, prefix=settings.API_PREFIX)
app.include_router(moderation.router, prefix=settings.API_PREFIX)
app.include_router(tasks.router, prefix=settings.API_PREFIX)

# Phase 3
app.include_router(subscriptions.router, prefix=settings.API_PREFIX)
app.include_router(marketplace.router, prefix=settings.API_PREFIX)
app.include_router(pk_battles.router, prefix=settings.API_PREFIX)

# Phase 4
app.include_router(web3.router, prefix=settings.API_PREFIX)
app.include_router(oauth.router, prefix=settings.API_PREFIX)

# Phase 5 — Stream Keys, MediaMTX, Private Shows
app.include_router(stream_keys.router, prefix=settings.API_PREFIX)
app.include_router(mediamtx.router, prefix=settings.API_PREFIX)
app.include_router(private_shows.router, prefix=settings.API_PREFIX)

# Admin
app.include_router(admin_routes.router, prefix=settings.API_PREFIX)

@app.get("/health")
async def health_check():
    return {"status": "ok"}


# Serve uploaded media files (avatars, banners, voice notes)
import os as _os
_os.makedirs(settings.VOICE_DIR, exist_ok=True)
_os.makedirs(settings.IMAGES_DIR, exist_ok=True)
app.mount("/media/voice", StaticFiles(directory=settings.VOICE_DIR), name="voice")
app.mount("/media/images", StaticFiles(directory=settings.IMAGES_DIR), name="images")


# User-level WebSocket — global real-time notifications (new DM toasts, etc.)
@app.websocket("/ws/user/{user_id}")
async def ws_user_endpoint(
    websocket: WebSocket,
    user_id: str,
    token: str = Query(None),
):
    """Per-user notification WebSocket. Stays connected for the whole session."""
    await user_websocket_endpoint(websocket, user_id, token=token)


# DM WebSocket endpoint — real-time typing indicators, call signaling, photo relay
@app.websocket("/ws/dm/{conversation_id}/{user_id}")
async def ws_dm_endpoint(
    websocket: WebSocket,
    conversation_id: str,
    user_id: str,
    token: str = Query(None),
):
    """WebSocket endpoint for DM conversations."""
    await dm_websocket_endpoint(websocket, conversation_id, user_id, token=token)


# Stream WebSocket endpoint — accepts token query param for JWT auth
@app.websocket("/ws/{stream_id}/{user_id}")
async def ws_endpoint(
    websocket: WebSocket,
    stream_id: str,
    user_id: str,
    token: str = Query(None),
):
    """WebSocket endpoint for real-time stream communication."""
    await websocket_endpoint(websocket, stream_id, user_id, token=token)


# PK Battle WebSocket endpoint — real-time score updates for a battle room
# Uses the same ConnectionManager as the stream WS — battle_id acts as the room key.
@app.websocket("/ws/pk/{battle_id}/{user_id}")
async def ws_pk_endpoint(
    websocket: WebSocket,
    battle_id: str,
    user_id: str,
    token: str = Query(None),
):
    """WebSocket endpoint for PK battle real-time score updates.
    All participants (viewers + both creators) connect here when a battle is active.
    Score updates, battle_started, and battle_ended events are broadcast to the room.
    """
    from app.websocket.handler import manager, _verify_ws_token
    from fastapi import status as http_status

    if not token:
        await websocket.close(code=http_status.WS_1008_POLICY_VIOLATION, reason="Missing token")
        return

    payload = _verify_ws_token(token)
    if not payload or payload.get("user_id") != user_id:
        await websocket.close(code=http_status.WS_1008_POLICY_VIOLATION, reason="Invalid token")
        return

    await manager.connect(websocket, battle_id, user_id)

    try:
        # Keep the connection open — this endpoint is receive-only for clients.
        # All PK events are server-pushed (no client → server messages).
        while True:
            try:
                await websocket.receive_text()
            except Exception:
                break
    except Exception:
        pass
    finally:
        await manager.disconnect(websocket, stream_id)
