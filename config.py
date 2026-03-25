import os
from pathlib import Path


def _load_local_env() -> None:
    env_path = Path(__file__).resolve().with_name(".env")
    if not env_path.exists():
        return

    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if key and key not in os.environ:
            os.environ[key] = value


_load_local_env()


def _env(name: str, default: str) -> str:
    value = os.environ.get(name)
    return value.strip() if isinstance(value, str) and value.strip() else default


# MongoDB
MONGODB_URI = os.environ.get("MONGO_URI")
MONGODB_DB = _env("MONGODB_DB", "gold_jewellers")
MONGODB_BILLS_COLLECTION = _env("MONGODB_BILLS_COLLECTION", "bills")
MONGODB_COUNTERS_COLLECTION = _env("MONGODB_COUNTERS_COLLECTION", "counters")


# Shop details
SHOP_NAME = _env("SHOP_NAME", "VIJAYA GRANDHI JEWELLERS")
SHOP_ADDRESS = _env(
    "SHOP_ADDRESS",
    "# 34-1-16, Temple Street, Kakinada, Andhra Pradesh - 533001",
)
SHOP_GSTIN = _env("SHOP_GSTIN", "37XXXXXXXXXXXX")
SHOP_PHONE = _env("SHOP_PHONE", "+91-XXXXXXXXXX")


# Invoice details
INVOICE_TITLE = _env("INVOICE_TITLE", "TAX INVOICE CASH / CREDIT")
STATE_NAME = _env("STATE_NAME", "Andhra Pradesh")
STATE_CODE = _env("STATE_CODE", "37")
JURISDICTION_TEXT = _env("JURISDICTION_TEXT", "Subject to Kakinada Jurisdiction")


# Bank details
BANK_NAME = _env("BANK_NAME", "Kotak Mahindra Bank")
BANK_BRANCH = _env("BANK_BRANCH", "Jawahar Street, Kakinada")
BANK_ACCOUNT_NO = _env("BANK_ACCOUNT_NO", "9059006660")
BANK_IFSC = _env("BANK_IFSC", "KKBK6007839")


# Bill template
BILL_TEMPLATE_PATH = _env("BILL_TEMPLATE_PATH", "Billing Format.xlsx")
