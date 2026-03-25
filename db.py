from __future__ import annotations

from typing import Optional

from pymongo import ASCENDING, MongoClient, ReturnDocument
from pymongo.errors import ConfigurationError, PyMongoError

from config import (
    MONGODB_BILLS_COLLECTION,
    MONGODB_COUNTERS_COLLECTION,
    MONGODB_DB,
    MONGODB_URI,
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


def get_db_error() -> Optional[str]:
    return _db_error


def is_db_available() -> bool:
    return bills_collection is not None and counters_collection is not None


def require_db() -> None:
    if not is_db_available():
        raise RuntimeError(_db_error or "MongoDB is not available.")


def ensure_indexes():
    require_db()
    bills_collection.create_index([("invoice_no", ASCENDING)], unique=True)
    bills_collection.create_index([("created_at", ASCENDING)])


def get_next_invoice_no() -> int:
    require_db()
    doc = counters_collection.find_one_and_update(
        {"_id": "invoice_no"},
        {"$inc": {"seq": 1}},
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )
    return int(doc.get("seq", 1))
