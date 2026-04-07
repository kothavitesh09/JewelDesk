from __future__ import annotations

from typing import Optional

from pymongo import ASCENDING, MongoClient, ReturnDocument
from pymongo.errors import ConfigurationError, PyMongoError

from config import (
    MONGODB_AUDIT_LOGS_COLLECTION,
    MONGODB_BILLS_COLLECTION,
    MONGODB_COUNTERS_COLLECTION,
    MONGODB_DB,
    MONGODB_INVENTORY_COLLECTION,
    MONGODB_ITEMS_COLLECTION,
    MONGODB_OPENING_STOCK_COLLECTION,
    MONGODB_PENDING_USERS_COLLECTION,
    MONGODB_PURCHASES_COLLECTION,
    MONGODB_URI,
    MONGODB_USERS_COLLECTION,
)


DEFAULT_FALLBACK_URI = "mongodb://localhost:27017"
CLIENT_TIMEOUT_MS = 30000

_client: Optional[MongoClient] = None
_db_error: Optional[str] = None


def _try_build_client(uri: str) -> MongoClient:
    client = MongoClient(
        uri,
        serverSelectionTimeoutMS=CLIENT_TIMEOUT_MS,
        connectTimeoutMS=CLIENT_TIMEOUT_MS,
    )
    client.admin.command("ping")
    return client


def _create_client() -> tuple[Optional[MongoClient], Optional[str]]:
    uris_to_try = [MONGODB_URI]
    if MONGODB_URI != DEFAULT_FALLBACK_URI:
        uris_to_try.append(DEFAULT_FALLBACK_URI)

    errors = []
    for uri in uris_to_try:
        try:
            return _try_build_client(uri), None
        except (ConfigurationError, PyMongoError) as exc:
            errors.append(f"{uri}: {exc}")

    return None, " | ".join(errors)


_client, _db_error = _create_client()
db = _client[MONGODB_DB] if _client is not None else None
bills_collection = db[MONGODB_BILLS_COLLECTION] if db is not None else None
counters_collection = db[MONGODB_COUNTERS_COLLECTION] if db is not None else None
users_collection = db[MONGODB_USERS_COLLECTION] if db is not None else None
pending_users_collection = db[MONGODB_PENDING_USERS_COLLECTION] if db is not None else None
purchases_collection = db[MONGODB_PURCHASES_COLLECTION] if db is not None else None
inventory_collection = db[MONGODB_INVENTORY_COLLECTION] if db is not None else None
opening_stock_collection = db[MONGODB_OPENING_STOCK_COLLECTION] if db is not None else None
items_collection = db[MONGODB_ITEMS_COLLECTION] if db is not None else None
audit_logs_collection = db[MONGODB_AUDIT_LOGS_COLLECTION] if db is not None else None


def get_db_error() -> Optional[str]:
    return _db_error


def is_db_available() -> bool:
    return (
        bills_collection is not None
        and counters_collection is not None
        and users_collection is not None
        and pending_users_collection is not None
        and purchases_collection is not None
        and inventory_collection is not None
        and opening_stock_collection is not None
        and items_collection is not None
        and audit_logs_collection is not None
    )


def require_db() -> None:
    if not is_db_available():
        raise RuntimeError(_db_error or "MongoDB is not available.")


def ensure_indexes():
    require_db()
    users_collection.create_index([("user_id", ASCENDING)], unique=True)
    users_collection.create_index([("public_id", ASCENDING)], unique=True)
    users_collection.create_index([("email", ASCENDING)], unique=True)
    pending_users_collection.create_index([("public_id", ASCENDING)], unique=True)
    pending_users_collection.create_index([("email", ASCENDING)], unique=True)
    pending_users_collection.create_index([("status", ASCENDING), ("created_at", ASCENDING)])
    bills_collection.create_index([("user_id", ASCENDING), ("invoice_no", ASCENDING)], unique=True)
    bills_collection.create_index([("user_id", ASCENDING), ("created_at", ASCENDING)])
    bills_collection.create_index([("public_id", ASCENDING)], unique=True)
    purchases_collection.create_index([("user_id", ASCENDING), ("created_at", ASCENDING)])
    purchases_collection.create_index([("user_id", ASCENDING), ("public_id", ASCENDING)], unique=True)
    inventory_collection.create_index([("user_id", ASCENDING), ("updated_at", ASCENDING)])
    inventory_collection.create_index([("user_id", ASCENDING), ("public_id", ASCENDING)], unique=True)
    inventory_collection.create_index([("user_id", ASCENDING), ("item_name", ASCENDING), ("metal_type", ASCENDING)], unique=True)
    opening_stock_collection.create_index([("user_id", ASCENDING), ("created_at", ASCENDING)])
    items_collection.create_index([("user_id", ASCENDING), ("created_at", ASCENDING)])
    audit_logs_collection.create_index([("created_at", ASCENDING)])
    audit_logs_collection.create_index([("actor_type", ASCENDING), ("created_at", ASCENDING)])


def get_next_sequence(sequence_name: str, user_id: str) -> int:
    require_db()
    doc = counters_collection.find_one_and_update(
        {"_id": f"{sequence_name}:{user_id}"},
        {"$inc": {"seq": 1}},
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )
    return int(doc.get("seq", 1))


def get_next_invoice_no(user_id: str) -> int:
    return get_next_sequence("invoice_no", user_id)
