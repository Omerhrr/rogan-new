"""
ROGAN LIVE - Redis Client
Wrapper around Redis with in-memory fallback when REDIS_ENABLED is False.
"""

import json
import threading
from typing import Any, Optional

from app.config import settings


class InMemoryRedis:
    """Dict-based in-memory fallback that mimics the redis interface."""

    def __init__(self):
        self._data: dict = {}
        self._expiry: dict = {}
        self._pubsub_channels: dict = {}  # channel -> list of callback functions
        self._lock = threading.Lock()

    def get(self, key: str) -> Optional[bytes]:
        with self._lock:
            self._cleanup_expired(key)
            value = self._data.get(key)
            if value is None:
                return None
            return value.encode("utf-8") if isinstance(value, str) else value

    def set(self, key: str, value: Any, ex: Optional[int] = None) -> bool:
        import time

        with self._lock:
            self._data[key] = value if isinstance(value, str) else str(value)
            if ex is not None:
                self._expiry[key] = time.time() + ex
            elif key in self._expiry:
                del self._expiry[key]
            return True

    def delete(self, *keys: str) -> int:
        with self._lock:
            count = 0
            for key in keys:
                if key in self._data:
                    del self._data[key]
                    self._expiry.pop(key, None)
                    count += 1
            return count

    def expire(self, key: str, seconds: int) -> bool:
        import time

        with self._lock:
            if key in self._data:
                self._expiry[key] = time.time() + seconds
                return True
            return False

    def exists(self, key: str) -> bool:
        with self._lock:
            self._cleanup_expired(key)
            return key in self._data

    def publish(self, channel: str, message: str) -> int:
        """Publish a message to a channel. Calls registered callbacks."""
        with self._lock:
            callbacks = self._pubsub_channels.get(channel, [])
            for callback in callbacks:
                try:
                    callback(channel, message)
                except Exception:
                    pass
            return len(callbacks)

    def subscribe(self, channel: str, callback=None) -> None:
        """Subscribe to a channel with a callback function."""
        with self._lock:
            if channel not in self._pubsub_channels:
                self._pubsub_channels[channel] = []
            if callback:
                self._pubsub_channels[channel].append(callback)

    def _cleanup_expired(self, key: str) -> None:
        import time

        if key in self._expiry and self._expiry[key] <= time.time():
            self._data.pop(key, None)
            del self._expiry[key]

    def ping(self) -> bool:
        return True

    def flushdb(self) -> bool:
        with self._lock:
            self._data.clear()
            self._expiry.clear()
            return True


def _create_redis_client():
    """Create the appropriate redis client based on configuration."""
    if settings.REDIS_ENABLED:
        try:
            import redis

            client = redis.from_url(
                settings.REDIS_URL,
                decode_responses=False,
                socket_connect_timeout=5,
                socket_timeout=5,
            )
            # Test connection
            client.ping()
            return client
        except Exception as e:
            print(f"Warning: Redis connection failed, falling back to in-memory: {e}")
            return InMemoryRedis()
    else:
        return InMemoryRedis()


# Singleton instance
redis_client = _create_redis_client()
