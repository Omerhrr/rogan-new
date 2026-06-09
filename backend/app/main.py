"""
ROGAN LIVE - Main FastAPI Application
Mounts all routers, middleware, WebSocket endpoint, and startup logic.
"""

import os
import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, Query
from fastapi.middleware.cors import CORSMiddleware
from slowapi.errors import RateLimitExceeded

from app.config import settings
from app.database import Base, engine
from app.routes import auth, creators, dm, gifts, notifications, streams, wallet
from app.routes import moderation, tasks, subscriptions
from app.routes import marketplace, pk_battles, web3, oauth
from app.routes import stream_keys, mediamtx, private_shows
from app.middleware.rate_limit import limiter, custom_rate_limit_exceeded_handler
from app.websocket.handler import websocket_endpoint


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
                print(f"🔄 Auto-renewal processed: {stats}")
            finally:
                db.close()
        except Exception as e:
            print(f"❌ Auto-renewal task error: {e}")


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

    print(f"🚀 {settings.APP_NAME} v{settings.APP_VERSION} started")
    print(f"📊 Database: {settings.DATABASE_URL}")
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
)

# CORS middleware — only allow wildcard in DEBUG mode; production uses configured origins
cors_origins = ["*"] if settings.DEBUG else settings.CORS_ORIGINS
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
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

# WebSocket endpoint — accepts token query param for JWT auth
@app.websocket("/ws/{stream_id}/{user_id}")
async def ws_endpoint(
    websocket: WebSocket,
    stream_id: str,
    user_id: str,
    token: str = Query(None),
):
    """WebSocket endpoint for real-time stream communication."""
    await websocket_endpoint(websocket, stream_id, user_id, token=token)


# Health check
@app.get("/health")
def health_check():
    """Health check endpoint."""
    return {
        "status": "healthy",
        "app": settings.APP_NAME,
        "version": settings.APP_VERSION,
    }


# Root endpoint
@app.get("/")
def root():
    """Root endpoint with API info."""
    return {
        "app": settings.APP_NAME,
        "version": settings.APP_VERSION,
        "docs": "/docs",
        "health": "/health",
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=8000,
        reload=settings.DEBUG,
    )
