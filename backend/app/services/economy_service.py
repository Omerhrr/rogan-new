"""
ROGAN LIVE - Economy Service
Dual-token model: TK (off-chain) <-> ROGAN (on-chain settlement)
Fixed peg: 1 ROGAN = 1 TK
"""

from app.config import settings

# Gift prices in TK
GIFT_PRICES = {
    "rose": 1,
    "heart": 5,
    "diamond": 10,
    "rocket": 50,
    "crown": 100,
}


def get_gift_price(gift_type: str) -> int:
    """Get the TK price for a gift type. Raises ValueError if unknown."""
    price = GIFT_PRICES.get(gift_type)
    if price is None:
        raise ValueError(
            f"Unknown gift type: {gift_type}. Valid types: {list(GIFT_PRICES.keys())}"
        )
    return price


def calculate_platform_fee(amount: float) -> float:
    """Calculate platform fee on a given amount. Phase 1: 10%."""
    return round(amount * settings.PLATFORM_FEE_RATE, 2)


def calculate_creator_earnings(amount: float) -> float:
    """Calculate creator earnings after platform fee. Phase 1: 90%."""
    return round(amount * (1 - settings.PLATFORM_FEE_RATE), 2)


def calculate_withdraw_fee(amount: float) -> float:
    """Calculate withdrawal fee. 2%."""
    return round(amount * settings.WITHDRAW_FEE_RATE, 2)


def tk_to_rogan(tk: float) -> float:
    """Convert TK to ROGAN at 1:1 peg."""
    return round(tk * settings.ROGAN_TK_PEG, 4)


def rogan_to_tk(rogan: float) -> float:
    """Convert ROGAN to TK at 1:1 peg."""
    return round(rogan * settings.ROGAN_TK_PEG, 4)


def validate_gift_type(gift_type: str) -> bool:
    """Check if a gift type is valid."""
    return gift_type in GIFT_PRICES
