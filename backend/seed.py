"""
ROGAN LIVE - Seed Script
Creates test data: 5 creators, 10 users, live streams, gifts, and DMs.
Run with: python seed.py
"""

import sys
import os

# Add the project root to the path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.database import SessionLocal, engine, Base
from app.models.models import User, Stream, Gift, DirectMessage, Wallet, Transaction
import bcrypt

def _fast_hash(password: str) -> str:
    """Fast hash for seeding - use low rounds. Production uses _hash_password with rounds=12."""
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt(4)).decode("utf-8")
from app.services.ledger_service import create_transaction, SYSTEM_USER_ID
from app.services.economy_service import GIFT_PRICES


def seed():
    """Seed the database with test data."""
    # Create tables
    import app.models.models  # noqa: F401
    Base.metadata.create_all(bind=engine)

    db = SessionLocal()

    try:
        # Clear existing data
        db.query(DirectMessage).delete()
        db.query(Gift).delete()
        db.query(Transaction).delete()
        db.query(Wallet).delete()
        db.query(Stream).delete()
        db.query(User).delete()
        db.commit()

        print("🧹 Cleared existing data")

        # ─── Create Creator Users ────────────────────────────────
        creators = []
        for i in range(1, 6):
            user = User(
                email=f"creator{i}@rogan.live",
                username=f"creator{i}",
                password_hash=_fast_hash("password123"),
                display_name=f"Creator {i}",
                bio=f"Professional streamer and content creator #{i}",
                role="creator",
                is_live=False,
                is_active=True,
            )
            db.add(user)
            creators.append(user)

        db.commit()
        for c in creators:
            db.refresh(c)

        print(f"👤 Created {len(creators)} creator users")

        # ─── Create Regular Users ────────────────────────────────
        users = []
        for i in range(1, 11):
            user = User(
                email=f"user{i}@rogan.live",
                username=f"user{i}",
                password_hash=_fast_hash("password123"),
                display_name=f"User {i}",
                bio=f"Regular viewer and supporter #{i}",
                role="user",
                is_live=False,
                is_active=True,
            )
            db.add(user)
            users.append(user)

        db.commit()
        for u in users:
            db.refresh(u)

        print(f"👤 Created {len(users)} regular users")

        # ─── Create Wallets for Creators ─────────────────────────
        for i, creator in enumerate(creators):
            wallet = Wallet(
                user_id=creator.id,
                wallet_address=f"0x{''.join([str(i)] * 40)}",
            )
            db.add(wallet)

        # Create a wallet for user1
        wallet_user1 = Wallet(
            user_id=users[0].id,
            wallet_address=f"0xABCDEF{'0' * 34}",
        )
        db.add(wallet_user1)

        db.commit()
        print(f"💰 Created wallets for creators + user1")

        # ─── Deposit TK for Users (so they can send gifts) ───────
        # Give each user 500 TK via ledger deposit
        for user in users:
            create_transaction(
                db=db,
                type="deposit",
                amount=500.0,
                from_user_id=SYSTEM_USER_ID,
                to_user_id=user.id,
                metadata={"seed": True, "initial_deposit": 500.0},
            )

        # Also give creators some starting TK
        for creator in creators:
            create_transaction(
                db=db,
                type="deposit",
                amount=1000.0,
                from_user_id=SYSTEM_USER_ID,
                to_user_id=creator.id,
                metadata={"seed": True, "initial_deposit": 1000.0},
            )

        print(f"💵 Deposited TK for all users")

        # ─── Create Live Streams ─────────────────────────────────
        streams = []
        stream_data = [
            ("Music Jam Session 🎵", "Live music and chill vibes", "Music"),
            ("Gaming Marathon 🎮", "Playing the latest releases", "Gaming"),
            ("Art & Creative 🎨", "Drawing and digital art", "Art"),
            ("Talk Show 🎤", "Discussing trending topics", "Talk"),
            ("Cooking Live 🍳", "Making delicious recipes", "Food"),
        ]

        for i, creator in enumerate(creators):
            title, description, category = stream_data[i]
            stream = Stream(
                creator_id=creator.id,
                title=title,
                description=description,
                category=category,
                is_live=True,
                is_private=False,
                viewer_count=i * 3 + 5,  # Random-ish viewer counts
            )
            db.add(stream)
            streams.append(stream)

            # Set creator as live
            creator.is_live = True

        db.commit()
        for s in streams:
            db.refresh(s)

        print(f"📺 Created {len(streams)} live streams")

        # ─── Send Gifts ──────────────────────────────────────────
        gift_types = list(GIFT_PRICES.keys())
        gifts_created = 0

        # Each user sends 2-3 gifts to random creators' streams
        for user in users:
            import random

            num_gifts = random.randint(2, 3)
            for _ in range(num_gifts):
                stream = random.choice(streams)
                gift_type = random.choice(gift_types)
                tk_amount = GIFT_PRICES[gift_type]

                gift = Gift(
                    stream_id=stream.id,
                    sender_id=user.id,
                    receiver_id=stream.creator_id,
                    gift_type=gift_type,
                    amount=tk_amount,
                    message=f"Great stream! 🎉" if random.random() > 0.5 else None,
                )
                db.add(gift)
                db.flush()  # Get the ID

                # Create ledger transactions
                # Debit sender
                create_transaction(
                    db=db,
                    type="gift_send",
                    amount=tk_amount,
                    from_user_id=user.id,
                    to_user_id=stream.creator_id,
                    reference_id=gift.id,
                    metadata={
                        "gift_id": gift.id,
                        "gift_type": gift_type,
                        "gross_amount": tk_amount,
                    },
                )

                # Platform fee (10%)
                platform_fee = round(tk_amount * 0.10, 2)
                if platform_fee > 0:
                    create_transaction(
                        db=db,
                        type="platform_fee",
                        amount=platform_fee,
                        from_user_id=stream.creator_id,
                        to_user_id=SYSTEM_USER_ID,
                        reference_id=gift.id,
                        metadata={
                            "gift_id": gift.id,
                            "fee_rate": 0.10,
                            "platform_fee": platform_fee,
                        },
                    )

                gifts_created += 1

        db.commit()
        print(f"🎁 Created {gifts_created} gifts")

        # ─── Create DM Conversations ─────────────────────────────
        dm_count = 0

        # user1 -> creator1
        dm1 = DirectMessage(
            sender_id=users[0].id,
            receiver_id=creators[0].id,
            content="Hey! Love your music streams! Can you play some jazz next time?",
            is_paid=False,
        )
        db.add(dm1)
        dm_count += 1

        dm2 = DirectMessage(
            sender_id=creators[0].id,
            receiver_id=users[0].id,
            content="Thanks for the support! I'll definitely add some jazz to the next set 🎵",
            is_paid=False,
        )
        db.add(dm2)
        dm_count += 1

        # user2 -> creator2 (paid DM)
        dm3 = DirectMessage(
            sender_id=users[1].id,
            receiver_id=creators[1].id,
            content="Want a private coaching session for my gameplay!",
            is_paid=True,
            price=50.0,
        )
        db.add(dm3)

        # Ledger for paid DM
        create_transaction(
            db=db,
            type="dm_payment",
            amount=50.0,
            from_user_id=users[1].id,
            to_user_id=creators[1].id,
            reference_id=dm3.id,
            metadata={"message_id": dm3.id, "is_paid": True, "price": 50.0},
        )
        dm_count += 1

        # user3 -> creator3
        dm4 = DirectMessage(
            sender_id=users[2].id,
            receiver_id=creators[2].id,
            content="Your art is incredible! Do you take commissions?",
            is_paid=False,
        )
        db.add(dm4)
        dm_count += 1

        dm5 = DirectMessage(
            sender_id=creators[2].id,
            receiver_id=users[2].id,
            content="Yes! Check out my service listing for commission details 🎨",
            is_paid=False,
        )
        db.add(dm5)
        dm_count += 1

        # user5 -> creator5 (paid DM)
        dm6 = DirectMessage(
            sender_id=users[4].id,
            receiver_id=creators[4].id,
            content="Private recipe request for that pasta dish!",
            is_paid=True,
            price=25.0,
        )
        db.add(dm6)

        create_transaction(
            db=db,
            type="dm_payment",
            amount=25.0,
            from_user_id=users[4].id,
            to_user_id=creators[4].id,
            reference_id=dm6.id,
            metadata={"message_id": dm6.id, "is_paid": True, "price": 25.0},
        )
        dm_count += 1

        # More conversations
        dm7 = DirectMessage(
            sender_id=users[5].id,
            receiver_id=creators[3].id,
            content="Loved the debate topic today! Any chance you'll cover AI next?",
            is_paid=False,
        )
        db.add(dm7)
        dm_count += 1

        dm8 = DirectMessage(
            sender_id=creators[3].id,
            receiver_id=users[5].id,
            content="Great idea! AI is definitely on the list for next week 🎤",
            is_paid=False,
        )
        db.add(dm8)
        dm_count += 1

        db.commit()
        print(f"💬 Created {dm_count} direct messages")

        # ─── Summary ─────────────────────────────────────────────
        print("\n" + "=" * 50)
        print("🌱 SEED COMPLETE")
        print("=" * 50)
        print(f"  Creators:  {len(creators)}")
        print(f"  Users:     {len(users)}")
        print(f"  Streams:   {len(streams)}")
        print(f"  Gifts:     {gifts_created}")
        print(f"  DMs:       {dm_count}")
        print()
        print("  Login credentials:")
        print("  ──────────────────")
        print("  Creators: creator1-5@rogan.live / password123")
        print("  Users:    user1-10@rogan.live   / password123")
        print()
        print("  Start server: uvicorn app.main:app --reload --port 8000")
        print("=" * 50)

    except Exception as e:
        print(f"❌ Seed error: {e}")
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    seed()
