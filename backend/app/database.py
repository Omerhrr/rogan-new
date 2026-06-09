"""
ROGAN LIVE - Database Setup (SQLAlchemy)
Supports SQLite for development, PostgreSQL for production.
"""

from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

from app.config import settings

DATABASE_URL = settings.DATABASE_URL

# Handle non-SQLAlchemy URL formats (e.g. file:/path/to/db)
if DATABASE_URL.startswith("file:"):
    DATABASE_URL = "sqlite:///" + DATABASE_URL[5:]

# SQLite needs check_same_thread=False; PostgreSQL doesn't
if DATABASE_URL.startswith("sqlite"):
    engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False}, echo=False)
else:
    # PostgreSQL with connection pool
    engine = create_engine(DATABASE_URL, pool_size=10, max_overflow=20, pool_pre_ping=True, echo=False)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    """Dependency for getting DB sessions."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
