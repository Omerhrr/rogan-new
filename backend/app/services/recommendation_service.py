"""
ROGAN LIVE - Recommendation Service (Phase 4)
Collaborative filtering, content-based, trending streams, Redis caching.
"""

import json
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from sqlalchemy import desc, func
from sqlalchemy.orm import Session

from app.models.models import Gift, Stream, User
from app.utils.redis_client import redis_client

# Redis cache TTL for recommendations
RECOMMENDATION_CACHE_TTL = 300  # 5 minutes

# Trending weight factors
TRENDING_VIEWER_WEIGHT = 0.4
TRENDING_GIFT_WEIGHT = 0.4
TRENDING_RECENCY_WEIGHT = 0.2


def get_recommendations(
    db: Session,
    user_id: str,
    limit: int = 10,
) -> Dict[str, Any]:
    """Get personalized stream recommendations for a user.
    Combines collaborative filtering, content-based, and trending.
    Falls back to trending when insufficient user data.
    """
    cache_key = f"recommendations:{user_id}:{limit}"

    # Try cache first
    try:
        cached = redis_client.get(cache_key)
        if cached:
            return json.loads(cached)
    except Exception:
        pass

    recommendations: List[Dict[str, Any]] = []

    # 1. Try collaborative filtering
    collab_recs = _collaborative_filtering(db, user_id, limit // 2)
    recommendations.extend(collab_recs)

    # 2. Try content-based
    content_recs = _content_based(db, user_id, limit // 2)
    recommendations.extend(content_recs)

    # 3. Fill remaining with trending
    remaining = limit - len(recommendations)
    if remaining > 0:
        # Exclude already recommended streams
        excluded_ids = {r["stream_id"] for r in recommendations}
        trending_recs = _get_trending(db, remaining, excluded_ids)
        recommendations.extend(trending_recs)

    # Fallback: if no recommendations, just use trending
    if not recommendations:
        recommendations = _get_trending(db, limit)

    # Deduplicate
    seen = set()
    unique_recs = []
    for rec in recommendations:
        if rec["stream_id"] not in seen:
            seen.add(rec["stream_id"])
            unique_recs.append(rec)

    result = {
        "streams": unique_recs[:limit],
        "total": len(unique_recs[:limit]),
    }

    # Cache result
    try:
        redis_client.set(cache_key, json.dumps(result, default=str), ex=RECOMMENDATION_CACHE_TTL)
    except Exception:
        pass

    return result


def get_trending_streams(
    db: Session,
    limit: int = 20,
    category: Optional[str] = None,
) -> Dict[str, Any]:
    """Get trending streams weighted by viewer count, gift volume, and recency."""
    cache_key = f"trending:{limit}:{category}"

    try:
        cached = redis_client.get(cache_key)
        if cached:
            return json.loads(cached)
    except Exception:
        pass

    streams = _get_trending(db, limit, category=category)

    result = {
        "streams": streams,
        "total": len(streams),
    }

    try:
        redis_client.set(cache_key, json.dumps(result, default=str), ex=RECOMMENDATION_CACHE_TTL)
    except Exception:
        pass

    return result


def _collaborative_filtering(
    db: Session,
    user_id: str,
    limit: int,
) -> List[Dict[str, Any]]:
    """Collaborative filtering: 'viewers who watched X also watched Y'.
    Based on gift overlap: users who gifted to the same creators.
    """
    if limit <= 0:
        return []

    # Find creators the user has gifted to
    user_gifted_creators = (
        db.query(Gift.receiver_id)
        .filter(Gift.sender_id == user_id)
        .distinct()
        .all()
    )
    user_creator_ids = {r[0] for r in user_gifted_creators}

    if not user_creator_ids:
        return []

    # Find other users who gifted to the same creators
    similar_users = (
        db.query(Gift.sender_id)
        .filter(
            Gift.receiver_id.in_(user_creator_ids),
            Gift.sender_id != user_id,
        )
        .group_by(Gift.sender_id)
        .order_by(desc(func.count(Gift.id)))
        .limit(50)
        .all()
    )
    similar_user_ids = {r[0] for r in similar_users}

    if not similar_user_ids:
        return []

    # Find creators that similar users gifted to but our user hasn't
    recommended_creator_ids = (
        db.query(Gift.receiver_id)
        .filter(
            Gift.sender_id.in_(similar_user_ids),
            ~Gift.receiver_id.in_(user_creator_ids),
        )
        .group_by(Gift.receiver_id)
        .order_by(desc(func.count(Gift.id)))
        .limit(limit)
        .all()
    )
    creator_ids = [r[0] for r in recommended_creator_ids]

    if not creator_ids:
        return []

    # Find live streams from these creators
    streams = (
        db.query(Stream)
        .filter(
            Stream.creator_id.in_(creator_ids),
            Stream.is_live == True,
        )
        .order_by(desc(Stream.viewer_count))
        .limit(limit)
        .all()
    )

    return [_stream_to_recommendation(s, "collaborative") for s in streams]


def _content_based(
    db: Session,
    user_id: str,
    limit: int,
) -> List[Dict[str, Any]]:
    """Content-based: match stream categories/tags to user preferences.
    Based on categories of streams the user has previously watched/gifted.
    """
    if limit <= 0:
        return []

    # Find categories the user is interested in (based on gifted streams)
    user_categories = (
        db.query(Stream.category)
        .join(Gift, Gift.stream_id == Stream.id)
        .filter(
            Gift.sender_id == user_id,
            Stream.category != None,
        )
        .group_by(Stream.category)
        .order_by(desc(func.count(Stream.id)))
        .limit(5)
        .all()
    )
    category_list = [r[0] for r in user_categories if r[0]]

    if not category_list:
        return []

    # Find live streams in those categories, excluding streams the user has gifted to
    user_gifted_streams = (
        db.query(Gift.stream_id)
        .filter(Gift.sender_id == user_id)
        .distinct()
        .all()
    )
    gifted_stream_ids = {r[0] for r in user_gifted_streams}

    streams = (
        db.query(Stream)
        .filter(
            Stream.category.in_(category_list),
            Stream.is_live == True,
            ~Stream.id.in_(gifted_stream_ids),
        )
        .order_by(desc(Stream.viewer_count))
        .limit(limit)
        .all()
    )

    return [_stream_to_recommendation(s, "content_based") for s in streams]


def _get_trending(
    db: Session,
    limit: int,
    excluded_ids: Optional[set] = None,
    category: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """Get trending streams weighted by viewer count, gift volume, recency."""
    query = db.query(Stream).filter(Stream.is_live == True)

    if category:
        query = query.filter(Stream.category == category)

    if excluded_ids:
        query = query.filter(~Stream.id.in_(excluded_ids))

    # Get candidate streams
    streams = query.order_by(desc(Stream.viewer_count)).limit(limit * 3).all()

    if not streams:
        return []

    # Score each stream
    now = datetime.utcnow()
    max_viewers = max((s.viewer_count for s in streams), default=1) or 1
    max_gifts = 1

    # Get gift counts for these streams
    stream_ids = [s.id for s in streams]
    gift_counts = {}
    if stream_ids:
        gift_data = (
            db.query(Gift.stream_id, func.sum(Gift.amount))
            .filter(Gift.stream_id.in_(stream_ids))
            .group_by(Gift.stream_id)
            .all()
        )
        gift_counts = {r[0]: r[1] for r in gift_data}
        max_gifts = max(gift_counts.values(), default=1) or 1

    scored_streams = []
    for stream in streams:
        viewer_score = (stream.viewer_count / max_viewers) * TRENDING_VIEWER_WEIGHT
        gift_score = (gift_counts.get(stream.id, 0) / max_gifts) * TRENDING_GIFT_WEIGHT

        # Recency score: newer streams get higher score
        if stream.created_at:
            hours_ago = (now - stream.created_at).total_seconds() / 3600
            recency_score = max(0, 1 - hours_ago / 24) * TRENDING_RECENCY_WEIGHT
        else:
            recency_score = 0

        total_score = viewer_score + gift_score + recency_score
        scored_streams.append((stream, total_score))

    # Sort by score
    scored_streams.sort(key=lambda x: x[1], reverse=True)

    return [
        _stream_to_recommendation(s, "trending", score)
        for s, score in scored_streams[:limit]
    ]


def _stream_to_recommendation(
    stream: Stream,
    reason: str,
    score: float = 0.0,
) -> Dict[str, Any]:
    """Convert a Stream model to a recommendation dict."""
    creator_name = None
    if stream.creator:
        creator_name = stream.creator.display_name or stream.creator.username

    return {
        "stream_id": stream.id,
        "title": stream.title,
        "creator_id": stream.creator_id,
        "creator_name": creator_name,
        "viewer_count": stream.viewer_count or 0,
        "category": stream.category,
        "thumbnail": stream.thumbnail,
        "score": round(score, 4),
        "reason": reason,
    }


def get_creator_recommendations(
    db: Session,
    user_id: str,
    limit: int = 10,
) -> Dict[str, Any]:
    """Get creator recommendations for new users (based on popularity)."""
    cache_key = f"creator_recs:{user_id}:{limit}"

    try:
        cached = redis_client.get(cache_key)
        if cached:
            return json.loads(cached)
    except Exception:
        pass

    # Find most popular creators by total gift volume
    popular_creators = (
        db.query(
            User.id,
            User.username,
            User.display_name,
            User.avatar,
            func.sum(Gift.amount).label("total_gifts"),
        )
        .join(Gift, Gift.receiver_id == User.id)
        .filter(User.role.in_(["creator", "admin"]))
        .group_by(User.id)
        .order_by(desc("total_gifts"))
        .limit(limit)
        .all()
    )

    result = {
        "creators": [
            {
                "creator_id": c.id,
                "username": c.username,
                "display_name": c.display_name,
                "avatar": c.avatar,
                "total_gift_volume": float(c.total_gifts) if c.total_gifts else 0,
            }
            for c in popular_creators
        ],
        "total": len(popular_creators),
    }

    try:
        redis_client.set(cache_key, json.dumps(result, default=str), ex=RECOMMENDATION_CACHE_TTL)
    except Exception:
        pass

    return result
