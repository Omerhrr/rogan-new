#!/usr/bin/env python3
"""
ROGAN LIVE - Comprehensive Integration Test Suite
Run with: python test_integration.py
"""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)
BASE = "/api/v1"

# ─── Helper ────────────────────────────────────────────────────────

def login(email: str, password: str = "password123"):
    r = client.post(f"{BASE}/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, f"Login failed for {email}: {r.text}"
    data = r.json()
    return data["token"], data["user"]["id"], data["user"]


def auth_header(token: str):
    return {"Authorization": f"Bearer {token}"}


# ─── Tests ─────────────────────────────────────────────────────────

def test_health():
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "healthy"


def test_auth_flow():
    # Register
    r = client.post(f"{BASE}/auth/register", json={
        "email": "inttest@test.com", "username": "inttest", "password": "password123"
    })
    assert r.status_code == 201
    token = r.json()["token"]
    user_id = r.json()["user"]["id"]

    # Login
    r = client.post(f"{BASE}/auth/login", json={
        "email": "inttest@test.com", "password": "password123"
    })
    assert r.status_code == 200

    # Get /me
    r = client.get(f"{BASE}/auth/me", headers=auth_header(token))
    assert r.status_code == 200
    assert r.json()["email"] == "inttest@test.com"

    # Update profile
    r = client.put(f"{BASE}/auth/me", headers=auth_header(token),
                   json={"display_name": "Integration Test User", "bio": "Test bio"})
    assert r.status_code == 200
    assert r.json()["display_name"] == "Integration Test User"


def test_wallet_operations():
    token, user_id, _ = login("user1@rogan.live")

    # Get wallet
    r = client.get(f"{BASE}/wallet/", headers=auth_header(token))
    assert r.status_code == 200
    initial_balance = r.json()["tk_balance"]

    # Deposit
    r = client.post(f"{BASE}/wallet/deposit", headers=auth_header(token),
                    json={"amount": 100})
    assert r.status_code == 200
    assert r.json()["new_tk_balance"] == initial_balance + 100

    # Link wallet
    r = client.post(f"{BASE}/wallet/link", headers=auth_header(token),
                    json={"wallet_address": "0xABC1234567890123456789012345678901234AB"})
    assert r.status_code == 200

    # Withdraw
    r = client.post(f"{BASE}/wallet/withdraw", headers=auth_header(token),
                    json={"tk_amount": 25})
    assert r.status_code == 200
    assert r.json()["rogan_amount"] == 24.5  # 25 - 2% fee = 24.5

    # Transactions
    r = client.get(f"{BASE}/wallet/transactions", headers=auth_header(token))
    assert r.status_code == 200
    assert r.json()["total"] > 0


def test_stream_operations():
    token, user_id, _ = login("creator1@rogan.live")

    # List live streams
    r = client.get(f"{BASE}/streams/live")
    assert r.status_code == 200
    streams = r.json()["streams"]
    assert len(streams) > 0
    stream_id = streams[0]["id"]

    # Stream detail - stream_key should be hidden for non-creator
    r = client.get(f"{BASE}/streams/{stream_id}")
    assert r.status_code == 200
    # stream_key should only show for creator's own streams


def test_gift_flow():
    token, user_id, _ = login("creator1@rogan.live")
    token2, user_id2, _ = login("user2@rogan.live")

    # Get a stream
    streams = client.get(f"{BASE}/streams/live").json()["streams"]

    # Send gift
    r = client.post(f"{BASE}/gifts/send", headers=auth_header(token2), json={
        "stream_id": streams[0]["id"],
        "gift_type": "diamond",
        "message": "Great stream!"
    })
    assert r.status_code == 201
    assert r.json()["creator_earnings"] == 9.0  # 10 TK * 90%

    # Gift stats
    r = client.get(f"{BASE}/gifts/stats/{streams[0]['creator_id']}")
    assert r.status_code == 200
    assert r.json()["total_gifts_received"] > 0


def test_dm_flow():
    token, user_id, _ = login("creator1@rogan.live")
    token2, user_id2, _ = login("user2@rogan.live")

    # Send DM
    r = client.post(f"{BASE}/dm/send", headers=auth_header(token2), json={
        "receiver_id": user_id,
        "content": "Hello creator!"
    })
    assert r.status_code == 201

    # Conversations
    r = client.get(f"{BASE}/dm/conversations", headers=auth_header(token2))
    assert r.status_code == 200
    assert len(r.json()) > 0

    # Messages
    r = client.get(f"{BASE}/dm/messages/{user_id}", headers=auth_header(token2))
    assert r.status_code == 200
    assert r.json()["total"] > 0


def test_notifications():
    token, _, _ = login("user1@rogan.live")

    r = client.get(f"{BASE}/notifications/", headers=auth_header(token))
    assert r.status_code == 200

    r = client.get(f"{BASE}/notifications/unread-count", headers=auth_header(token))
    assert r.status_code == 200
    assert "unread_count" in r.json()


def test_creator_dashboard():
    token, _, _ = login("creator1@rogan.live")

    r = client.get(f"{BASE}/creators/dashboard", headers=auth_header(token))
    assert r.status_code == 200
    data = r.json()
    assert "tk_balance" in data
    assert "recent_streams" in data
    assert "gift_stats" in data


def test_moderation():
    token, _, _ = login("user1@rogan.live")
    streams = client.get(f"{BASE}/streams/live").json()["streams"]
    stream_id = streams[0]["id"]

    r = client.post(f"{BASE}/moderation/report", headers=auth_header(token), json={
        "target_id": stream_id,
        "target_type": "stream",
        "reason": "Inappropriate content"
    })
    assert r.status_code in [200, 201]


def test_task_marketplace():
    token, _, _ = login("creator1@rogan.live")

    # Create listing
    r = client.post(f"{BASE}/tasks/listings", headers=auth_header(token), json={
        "title": "Gaming Coaching",
        "description": "1 hour coaching session",
        "price": 50.0,
        "category": "Gaming"
    })
    assert r.status_code in [200, 201]

    # Browse
    r = client.get(f"{BASE}/tasks/listings")
    assert r.status_code == 200
    assert r.json()["total"] > 0


def test_subscriptions():
    token, creator_id, _ = login("creator1@rogan.live")
    token2, _, _ = login("user3@rogan.live")

    # Subscribe
    r = client.post(f"{BASE}/subscriptions/subscribe", headers=auth_header(token2), json={
        "creator_id": creator_id,
        "tier": "basic"
    })
    assert r.status_code in [200, 201]

    # My subs
    r = client.get(f"{BASE}/subscriptions/mine", headers=auth_header(token2))
    assert r.status_code == 200
    assert r.json()["total"] > 0

    # Cancel
    sub_id = r.json()["subscriptions"][0]["id"]
    r = client.delete(f"{BASE}/subscriptions/{sub_id}", headers=auth_header(token2))
    assert r.status_code == 200


def test_security():
    # Invalid token
    r = client.get(f"{BASE}/auth/me", headers={"Authorization": "Bearer invalid"})
    assert r.status_code == 401

    # Self-gift blocked
    token, user_id, _ = login("creator1@rogan.live")
    streams = client.get(f"{BASE}/streams/live").json()["streams"]
    for s in streams:
        if s["creator_id"] == user_id:
            r = client.post(f"{BASE}/gifts/send", headers=auth_header(token), json={
                "stream_id": s["id"], "gift_type": "rose"
            })
            assert r.status_code == 400
            break

    # Insufficient balance
    token_new, _, _ = login("user10@rogan.live")
    r = client.post(f"{BASE}/gifts/send", headers=auth_header(token_new), json={
        "stream_id": streams[0]["id"], "gift_type": "crown"
    })
    assert r.status_code == 400

    # Withdraw without wallet
    r = client.post(f"{BASE}/wallet/deposit", headers=auth_header(token_new), json={"amount": 50})
    r = client.post(f"{BASE}/wallet/withdraw", headers=auth_header(token_new), json={"tk_amount": 10})
    assert r.status_code == 400

    # Duplicate subscription
    r = client.post(f"{BASE}/subscriptions/subscribe", headers=auth_header(token_new), json={
        "creator_id": user_id, "tier": "basic"
    })
    if r.status_code in [200, 201]:
        r2 = client.post(f"{BASE}/subscriptions/subscribe", headers=auth_header(token_new), json={
            "creator_id": user_id, "tier": "premium"
        })
        assert r2.status_code == 409


# ─── Runner ────────────────────────────────────────────────────────

if __name__ == "__main__":
    tests = [
        ("Health Check", test_health),
        ("Auth Flow", test_auth_flow),
        ("Wallet Operations", test_wallet_operations),
        ("Stream Operations", test_stream_operations),
        ("Gift Flow", test_gift_flow),
        ("DM Flow", test_dm_flow),
        ("Notifications", test_notifications),
        ("Creator Dashboard", test_creator_dashboard),
        ("Moderation", test_moderation),
        ("Task Marketplace", test_task_marketplace),
        ("Subscriptions", test_subscriptions),
        ("Security", test_security),
    ]

    passed = 0
    failed = 0
    for name, test_fn in tests:
        try:
            test_fn()
            print(f"  PASS: {name}")
            passed += 1
        except AssertionError as e:
            print(f"  FAIL: {name} - {e}")
            failed += 1
        except Exception as e:
            print(f"  ERROR: {name} - {e}")
            failed += 1

    print(f"\n{'='*50}")
    print(f"Results: {passed} passed, {failed} failed, {passed+failed} total")
    print(f"{'='*50}")
    sys.exit(0 if failed == 0 else 1)
