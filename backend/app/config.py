"""
ROGAN LIVE - Backend Configuration
Stack: FastAPI + SQLAlchemy + Redis + SlowAPI
"""

import os
import secrets
import warnings
from pydantic_settings import BaseSettings

_INSECURE_JWT_DEFAULT = "rogan-live-super-secret-key-change-in-prod"


class Settings(BaseSettings):
    # App
    APP_NAME: str = "Rogan Live"
    APP_VERSION: str = "3.2-web2.5-final"
    DEBUG: bool = False  # SAFE DEFAULT: False. Override with DEBUG=true in .env for local dev.
    API_PREFIX: str = "/api/v1"

    # Database - SQLite for dev, PostgreSQL for production
    DATABASE_URL: str = "postgresql://rogan:rogan_secret@localhost:5432/rogan_live"

    # Redis
    REDIS_URL: str = "redis://localhost:6379/0"
    REDIS_ENABLED: bool = True

    # JWT Auth — JWT_SECRET MUST be set via environment variable in production.
    # The default value here is intentionally insecure and will trigger a warning on startup.
    JWT_SECRET: str = _INSECURE_JWT_DEFAULT
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRATION_MINUTES: int = 60 * 24 * 7  # 7 days

    # MediaMTX webhook shared secret — set MEDIAMTX_WEBHOOK_SECRET in production.
    MEDIAMTX_WEBHOOK_SECRET: str = ""

    # Google OAuth
    GOOGLE_CLIENT_ID: str = os.getenv("GOOGLE_CLIENT_ID", "")
    GOOGLE_CLIENT_SECRET: str = os.getenv("GOOGLE_CLIENT_SECRET", "")

    # CORS — JSON array string or comma-separated list of allowed origins.
    # In .env: CORS_ORIGINS=["https://yourdomain.com","https://www.yourdomain.com"]
    @property
    def cors_origins_list(self) -> list:
        raw = os.getenv("CORS_ORIGINS", '["http://localhost:3000","http://localhost:5173"]')
        import json
        try:
            return json.loads(raw)
        except Exception:
            return [o.strip() for o in raw.split(",") if o.strip()]
    CORS_ORIGINS: list = ["http://localhost:3000", "http://localhost:5173"]

    # MediaMTX
    MEDIAMTX_HOST: str = os.getenv("MEDIAMTX_HOST", "mediamtx")
    MEDIAMTX_API_PORT: int = 9997
    MEDIAMTX_RTMP_PORT: int = 1935
    MEDIAMTX_HLS_PORT: int = 8888
    MEDIAMTX_WEBRTC_PORT: int = 8889
    # Public-facing HLS base URL accessible from the browser.
    # In dev: "http://localhost:8888" (direct mediamtx) or "" to use the
    # Next.js /live/* proxy (relative URLs constructed by the frontend).
    # In production: set to your CDN or public mediamtx URL.
    MEDIAMTX_PUBLIC_HLS_BASE: str = os.getenv("MEDIAMTX_PUBLIC_HLS_BASE", "http://localhost:8888")

    # Public base URL for generating absolute media URLs
    PUBLIC_BASE_URL: str = os.getenv("PUBLIC_BASE_URL", "http://localhost:8000")

    # Economy
    ROGAN_TK_PEG: float = 1.0  # 1 ROGAN = 1 TK
    PLATFORM_FEE_RATE: float = 0.10  # 10% Phase 1
    WITHDRAW_FEE_RATE: float = 0.02  # 2%

    # Wallet / Crypto
    ROGAN_CONTRACT_ADDRESS: str = os.getenv("ROGAN_CONTRACT_ADDRESS", "0x6914D994d82Bf0cC9d64cF32978d81868Ac5f1a9")
    ROGAN_DEXSCREENER_PAIR: str = os.getenv("ROGAN_DEXSCREENER_PAIR", "0x1b0fb286fd0f0b48e9af0a5b7bdd2fabda60a55a")
    PLATFORM_WALLET_ADDRESS: str = os.getenv("PLATFORM_WALLET_ADDRESS", "") # Platform hot wallet
    BASE_RPC_URL: str = os.getenv("BASE_RPC_URL", "https://mainnet.base.org")
    ROGAN_DECIMALS: int = 18
    TK_PER_USD: float = 10.0            # $1 = 10 TK
    MIN_DEPOSIT_USD: float = 0.10       # $0.10 minimum deposit (= 1 TK)
    ROGAN_PRICE_FALLBACK_USD: float = float(os.getenv("ROGAN_PRICE_FALLBACK_USD", "0.000001"))
    ROGAN_PRICE_CACHE_TTL: int = 300    # kept for compat, price now admin-set

    # Stripe
    STRIPE_SECRET_KEY: str = os.getenv("STRIPE_SECRET_KEY", "")
    STRIPE_PUBLISHABLE_KEY: str = os.getenv("STRIPE_PUBLISHABLE_KEY", "")
    STRIPE_WEBHOOK_SECRET: str = os.getenv("STRIPE_WEBHOOK_SECRET", "")

    # Media storage
    VOICE_DIR: str = os.getenv("VOICE_DIR", "/app/media/voice")
    IMAGES_DIR: str = os.getenv("IMAGES_DIR", "/app/media/images")

    # Rate Limiting
    RATE_LIMIT_GIFTS: str = "10/second"
    RATE_LIMIT_DM: str = "5/second"
    RATE_LIMIT_AUTH: str = "5/minute"

    class Config:
        env_file = ".env"
        extra = "ignore"


settings = Settings()
