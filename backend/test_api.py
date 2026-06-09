#!/usr/bin/env python3
"""Test script for Rogan Live API"""
import requests
import json
import time

BASE = "http://localhost:8000/api/v1"

def test_api():
    # 1. Login
    print("1. Testing login...")
    r = requests.post(f"{BASE}/auth/login", json={"email": "creator1@rogan.live", "password": "password123"})
    print(f"   Status: {r.status_code}")
    if r.status_code != 200:
        print(f"   Error: {r.text[:200]}")
        return
    data = r.json()
    token = data["token"]
    user = data["user"]
    headers = {"Authorization": f"Bearer {token}"}
    print(f"   ✅ Logged in as {user['username']} ({user['role']})")

    # 2. Get me
    print("2. Testing /me...")
    r = requests.get(f"{BASE}/auth/me", headers=headers)
    print(f"   Status: {r.status_code}")
    if r.status_code == 200:
        me = r.json()
        print(f"   ✅ {me['username']} ({me['role']})")

    # 3. Live streams
    print("3. Testing /streams/live...")
    r = requests.get(f"{BASE}/streams/live")
    print(f"   Status: {r.status_code}")
    if r.status_code == 200:
        streams = r.json().get("streams", [])
        print(f"   ✅ {len(streams)} live streams")
        for s in streams:
            print(f"      - {s['title']} ({s['viewer_count']} viewers)")
    
    # 4. Wallet
    print("4. Testing /wallet...")
    r = requests.get(f"{BASE}/wallet/", headers=headers)
    print(f"   Status: {r.status_code}")
    if r.status_code == 200:
        wallet_data = r.json()
        print(f"   ✅ TK Balance: {wallet_data['tk_balance']}")

    # 5. Deposit
    print("5. Testing /wallet/deposit (100 ROGAN)...")
    r = requests.post(f"{BASE}/wallet/deposit", headers=headers, json={"amount": 100})
    print(f"   Status: {r.status_code}")
    if r.status_code == 200:
        dep = r.json()
        print(f"   ✅ New Balance: {dep['tk_balance']} TK")

    # 6. DM Conversations
    print("6. Testing /dm/conversations...")
    r = requests.get(f"{BASE}/dm/conversations", headers=headers)
    print(f"   Status: {r.status_code}")
    if r.status_code == 200:
        convos = r.json().get("conversations", [])
        print(f"   ✅ {len(convos)} conversations")

    # 7. Gift stats
    print("7. Testing /gifts/stats...")
    r = requests.get(f"{BASE}/gifts/stats/{user['id']}", headers=headers)
    print(f"   Status: {r.status_code}")
    if r.status_code == 200:
        stats = r.json()
        print(f"   ✅ {stats['total_gifts']} gifts, {stats['total_tk']} TK earned")

    # 8. Creator dashboard
    print("8. Testing /creators/dashboard...")
    r = requests.get(f"{BASE}/creators/dashboard", headers=headers)
    print(f"   Status: {r.status_code}")
    if r.status_code == 200:
        dash = r.json()
        print(f"   ✅ Earnings: {dash.get('total_earnings', 0)} TK")

    # 9. Send a gift (from user1 to creator1's stream)
    print("9. Testing gift send...")
    # Login as user1
    r = requests.post(f"{BASE}/auth/login", json={"email": "user1@rogan.live", "password": "password123"})
    if r.status_code == 200:
        user1_token = r.json()["token"]
        user1_headers = {"Authorization": f"Bearer {user1_token}"}
        
        if streams:
            stream_id = streams[0]["id"]
            creator_id = streams[0]["creator"]["id"]
            r = requests.post(f"{BASE}/gifts/send", headers=user1_headers, json={
                "stream_id": stream_id,
                "gift_type": "diamond",
                "message": "Great stream!"
            })
            print(f"   Status: {r.status_code}")
            if r.status_code == 200:
                gift = r.json()
                print(f"   ✅ Gift sent! Sender balance: {gift.get('sender_balance', '?')} TK")

    # 10. Withdraw
    print("10. Testing /wallet/withdraw (50 TK)...")
    r = requests.post(f"{BASE}/wallet/withdraw", headers=headers, json={"tk_amount": 50})
    print(f"   Status: {r.status_code}")
    if r.status_code == 200:
        wd = r.json()
        print(f"   ✅ Withdrawn! ROGAN amount: {wd.get('rogan_amount', '?')}, Fee: {wd.get('fee', '?')}, New balance: {wd.get('new_balance', '?')}")

    print("\n" + "=" * 50)
    print("🎉 ALL TESTS COMPLETE!")
    print("=" * 50)

if __name__ == "__main__":
    test_api()
