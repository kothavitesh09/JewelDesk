import re
import secrets
import uuid
from collections import defaultdict
from datetime import datetime, timedelta
from functools import wraps
from io import BytesIO
from pathlib import Path

import bcrypt
import cloudinary
import cloudinary.uploader
import jwt
from flask import Flask, g, jsonify, make_response, redirect, render_template, request, send_file, url_for
from werkzeug.utils import secure_filename

from config import (
    ADMIN_COOKIE_NAME,
    ADMIN_JWT_EXPIRES_HOURS,
    ADMIN_PASSWORD,
    ADMIN_USERNAME,
    APP_SECRET_KEY,
    AUTH_COOKIE_NAME,
    CLOUDINARY_API_KEY,
    CLOUDINARY_API_SECRET,
    CLOUDINARY_CLOUD_NAME,
    JWT_ALGORITHM,
    JWT_EXPIRES_DAYS,
    JWT_SECRET_KEY,
    STATE_NAME,
    UPLOAD_DIR,
    UPLOAD_MAX_MB,
)
from db import (
    audit_logs_collection,
    bills_collection,
    counters_collection,
    ensure_indexes,
    get_db_error,
    get_next_invoice_no,
    get_next_sequence,
    inventory_collection,
    is_db_available,
    items_collection,
    pending_users_collection,
    purchases_collection,
    users_collection,
)
from excel_export import export_bills_to_excel_bytes
from pdf_generator import generate_invoice_pdf_bytes
from utils import format_invoice_no, parse_hsn, safe_float, utcnow


app = Flask(__name__, template_folder="templates", static_folder="static")
app.config["SECRET_KEY"] = APP_SECRET_KEY
app.config["MAX_CONTENT_LENGTH"] = UPLOAD_MAX_MB * 1024 * 1024

VALID_METAL_TYPES = {"Gold", "Silver", "Gold Pure", "Silver Pure"}
ALLOWED_IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg"}
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
PHONE_RE = re.compile(r"^[0-9+\-\s]{7,20}$")
UPLOAD_PATH = Path(__file__).resolve().parent / UPLOAD_DIR
USE_CLOUDINARY = bool(CLOUDINARY_CLOUD_NAME and CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET)

if USE_CLOUDINARY:
    cloudinary.config(
        cloud_name=CLOUDINARY_CLOUD_NAME,
        api_key=CLOUDINARY_API_KEY,
        api_secret=CLOUDINARY_API_SECRET,
        secure=True,
    )


def _normalize_metal_type(value: str, default: str = "Gold"):
    raw = str(value or "").strip().casefold()
    mapping = {
        "gold": "Gold",
        "silver": "Silver",
        "gold pure": "Gold Pure",
        "pure gold": "Gold Pure",
        "silver pure": "Silver Pure",
        "pure silver": "Silver Pure",
    }
    return mapping.get(raw, default)


def _inventory_lookup_key(item_name: str, metal_type: str):
    return (str(item_name or "").strip().casefold(), _normalize_metal_type(metal_type))


def _bad_request(message: str):
    return jsonify({"error": message}), 400


def _db_unavailable_response():
    return jsonify({"error": get_db_error() or "MongoDB is not available."}), 503


def _public_id(prefix: str) -> str:
    token = secrets.token_urlsafe(12).replace("-", "").replace("_", "")
    return f"{prefix}_{token[:18]}"


def _normalize_email(value: str) -> str:
    return str(value or "").strip().lower()


def _clean_text(value: str, max_len: int = 200) -> str:
    cleaned = " ".join(str(value or "").strip().split())
    return cleaned[:max_len]


def _asset_url(path_value: str | None) -> str | None:
    if not path_value:
        return None
    path_str = str(path_value).strip()
    if path_str.startswith("http://") or path_str.startswith("https://"):
        return path_str
    return url_for("static", filename=path_str.replace("\\", "/"))


def _hash_password(raw_password: str) -> str:
    return bcrypt.hashpw(raw_password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def _check_password(raw_password: str, password_hash: str) -> bool:
    if not raw_password or not password_hash:
        return False
    try:
        return bcrypt.checkpw(raw_password.encode("utf-8"), password_hash.encode("utf-8"))
    except Exception:
        return False


def _encode_token(payload: dict, expires_delta: timedelta) -> str:
    now = utcnow()
    token_payload = {**payload, "iat": int(now.timestamp()), "exp": int((now + expires_delta).timestamp())}
    return jwt.encode(token_payload, JWT_SECRET_KEY, algorithm=JWT_ALGORITHM)


def _decode_token(token: str | None):
    if not token:
        return None
    try:
        return jwt.decode(token, JWT_SECRET_KEY, algorithms=[JWT_ALGORITHM])
    except jwt.PyJWTError:
        return None


def _set_cookie(response, cookie_name: str, token: str, expires_delta: timedelta):
    response.set_cookie(
        cookie_name,
        token,
        httponly=True,
        secure=False,
        samesite="Lax",
        max_age=int(expires_delta.total_seconds()),
        path="/",
    )


def _clear_cookie(response, cookie_name: str):
    response.set_cookie(cookie_name, "", expires=0, max_age=0, path="/")


def _record_audit(action: str, actor_type: str, actor_id: str | None = None, user_id: str | None = None, details: dict | None = None):
    if not is_db_available():
        return
    audit_logs_collection.insert_one(
        {
            "user_id": user_id or actor_id or "system",
            "public_id": _public_id("audit"),
            "action": action,
            "actor_type": actor_type,
            "actor_id": actor_id,
            "details": details or {},
            "created_at": utcnow(),
        }
    )


def _validate_image_upload(file_storage, field_label: str):
    if file_storage is None or not file_storage.filename:
        raise ValueError(f"{field_label} is required.")
    filename = secure_filename(file_storage.filename)
    ext = Path(filename).suffix.lower()
    mimetype = str(file_storage.mimetype or "").lower()
    if ext not in ALLOWED_IMAGE_EXTENSIONS:
        raise ValueError(f"{field_label} must be a PNG or JPG image.")
    if not mimetype.startswith("image/"):
        raise ValueError(f"{field_label} must be an image file.")
    return filename, ext


def _store_image(file_storage, subfolder: str, prefix: str) -> str:
    _, ext = _validate_image_upload(file_storage, prefix.replace("_", " ").title())
    if USE_CLOUDINARY:
        file_storage.stream.seek(0)
        upload_result = cloudinary.uploader.upload(
            file_storage.stream,
            folder=f"jeweldesk/{subfolder}",
            public_id=f"{prefix}_{uuid.uuid4().hex}",
            resource_type="image",
            overwrite=True,
        )
        secure_url = str(upload_result.get("secure_url") or "").strip()
        if not secure_url:
            raise ValueError("Image upload failed. Please try again.")
        return secure_url

    target_dir = UPLOAD_PATH / subfolder
    target_dir.mkdir(parents=True, exist_ok=True)
    file_name = f"{prefix}_{uuid.uuid4().hex}{ext}"
    target_path = target_dir / file_name
    file_storage.save(target_path)
    return str((Path(UPLOAD_DIR) / subfolder / file_name).as_posix())


def _serialize_pending_user(doc):
    return {
        "id": doc.get("public_id"),
        "shop_name": doc.get("shop_name"),
        "owner_name": doc.get("owner_name"),
        "email": doc.get("email"),
        "phone": doc.get("phone"),
        "shop_gstin": doc.get("shop_gstin"),
        "shop_address": doc.get("shop_address"),
        "status": doc.get("status"),
        "logo_url": _asset_url(doc.get("logo_path")),
        "shop_name_image_url": _asset_url(doc.get("shop_name_image_path")),
        "created_at": doc.get("created_at"),
    }


def _serialize_user_summary(doc):
    return {
        "shop_name": doc.get("shop_name"),
        "owner_name": doc.get("owner_name"),
        "email": doc.get("email"),
        "phone": doc.get("phone"),
        "shop_gstin": doc.get("shop_gstin"),
        "shop_address": doc.get("shop_address"),
        "status": doc.get("status"),
        "logo_url": _asset_url(doc.get("logo_path")),
        "shop_name_image_url": _asset_url(doc.get("shop_name_image_path")),
    }


def _serialize_inventory_item(doc):
    available_weight = round(float(doc.get("available_weight", 0) or 0), 3)
    threshold = round(float(doc.get("reorder_threshold", 0) or 0), 3)
    status = "Normal"
    if available_weight <= threshold:
        status = "Low"
    if available_weight < 0 or (threshold and available_weight <= threshold * 0.5):
        status = "Critical"

    return {
        "id": doc.get("public_id"),
        "item_name": doc.get("item_name", "Unnamed Item"),
        "metal_type": doc.get("metal_type", "Gold"),
        "available_weight": available_weight,
        "reorder_threshold": threshold,
        "status": status,
        "updated_at": doc.get("updated_at").isoformat() if doc.get("updated_at") else None,
    }


def _serialize_purchase(doc):
    return {
        "id": doc.get("public_id"),
        "purchase_no": doc.get("purchase_no"),
        "supplier_name": doc.get("supplier_name", ""),
        "purchase_date": doc.get("purchase_date").date().isoformat() if doc.get("purchase_date") else None,
        "date": doc.get("created_at").isoformat() if doc.get("created_at") else None,
        "total_amount": round(float(doc.get("total_amount", 0) or 0), 2),
        "items": [
            {
                "item_name": item.get("item_name", ""),
                "metal_type": item.get("metal_type", "Gold"),
                "weight": round(float(item.get("weight", 0) or 0), 3),
                "rate": round(float(item.get("rate", 0) or 0), 2),
                "amount": round(float(item.get("amount", 0) or 0), 2),
            }
            for item in doc.get("items", []) or []
        ],
    }


def _serialize_bill(doc, include_items: bool = False):
    payload = {
        "invoice_no": doc.get("invoice_no"),
        "invoice_no_text": doc.get("invoice_no_text") or doc.get("invoice_no"),
        "date": doc.get("created_at").isoformat() if doc.get("created_at") else None,
        "customer_name": doc.get("customer_name"),
        "customer_address": doc.get("customer_address"),
        "customer_phone": doc.get("customer_phone"),
        "party_gst_no": doc.get("party_gst_no"),
        "payment_mode": doc.get("payment_mode", "cash"),
        "cash_amount": round(float(doc.get("cash_amount", 0) or 0), 2),
        "bank_amount": round(float(doc.get("bank_amount", 0) or 0), 2),
        "tax_type": doc.get("tax_type", "cgst_sgst"),
        "total": doc.get("total", 0),
        "cgst": doc.get("cgst", 0),
        "sgst": doc.get("sgst", 0),
        "igst": doc.get("igst", 0),
        "final_amount": doc.get("final_amount", 0),
        "shop_name": doc.get("shop_name"),
    }
    if include_items:
        payload["items"] = doc.get("items", [])
    return payload


def _current_user_id() -> str:
    if not g.user:
        raise RuntimeError("Authenticated user is required.")
    return g.user["user_id"]


def _load_current_user():
    payload = _decode_token(request.cookies.get(AUTH_COOKIE_NAME))
    if not payload or payload.get("kind") != "user":
        return None
    public_id = str(payload.get("sub") or "").strip()
    if not public_id or not is_db_available():
        return None
    return users_collection.find_one({"public_id": public_id, "status": "active"})


def _load_current_admin():
    payload = _decode_token(request.cookies.get(ADMIN_COOKIE_NAME))
    if not payload or payload.get("kind") != "admin":
        return None
    if payload.get("sub") != ADMIN_USERNAME:
        return None
    return {"username": ADMIN_USERNAME}


@app.before_request
def _attach_identity():
    g.user = _load_current_user()
    g.admin = _load_current_admin()


@app.context_processor
def _template_context():
    branding = {}
    if g.user:
        branding = {
            "shop_name": g.user.get("shop_name", ""),
            "logo_path": g.user.get("logo_path", ""),
            "shop_name_image_path": g.user.get("shop_name_image_path", ""),
            "shop_gstin": g.user.get("shop_gstin", ""),
            "shop_address": g.user.get("shop_address", ""),
            "shop_phone": g.user.get("phone", ""),
            "logo_url": _asset_url(g.user.get("logo_path")),
            "shop_name_image_url": _asset_url(g.user.get("shop_name_image_path")),
        }
    return {
        "current_user": g.user,
        "current_admin": g.admin,
        "user_branding": branding,
        "asset_url": _asset_url,
    }


def _unauthorized_response(api: bool = False, admin: bool = False):
    if api:
        return jsonify({"error": "Authentication required."}), 401
    endpoint = "admin_login" if admin else "login"
    return redirect(url_for(endpoint, next=request.path))


def login_required(api: bool = False):
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            if not g.user:
                return _unauthorized_response(api=api)
            return func(*args, **kwargs)

        return wrapper

    return decorator


def admin_required(api: bool = False):
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            if not g.admin:
                return _unauthorized_response(api=api, admin=True)
            return func(*args, **kwargs)

        return wrapper

    return decorator


def _parse_date_query(param_name: str):
    value = request.args.get(param_name)
    if not value:
        return None
    return datetime.strptime(value, "%Y-%m-%d")


def _normalize_invoice_payload(data):
    customer_name = _clean_text(data.get("customer_name", ""), 160)
    if not customer_name:
        raise ValueError("Customer Name is required.")

    customer_address = _clean_text(data.get("customer_address", ""), 300) or None
    customer_phone = _clean_text(data.get("customer_phone", ""), 30) or None
    party_gst_no = _clean_text(data.get("party_gst_no", ""), 30) or None
    payment_mode = str(data.get("payment_mode", "cash")).strip().lower()
    if payment_mode not in {"cash", "bank", "cash_bank"}:
        raise ValueError("payment_mode must be 'cash', 'bank', or 'cash_bank'.")

    tax_type = str(data.get("tax_type", "cgst_sgst")).strip().lower()
    if tax_type not in {"cgst_sgst", "igst"}:
        raise ValueError("tax_type must be either 'cgst_sgst' or 'igst'.")

    items = data.get("items", [])
    if not isinstance(items, list) or not items:
        raise ValueError("At least one item is required.")

    normalized_items = []
    total = 0.0
    cgst_total = 0.0
    sgst_total = 0.0
    igst_total = 0.0

    for i, it in enumerate(items, start=1):
        particulars = _clean_text(it.get("particulars", ""), 180)
        if not particulars:
            raise ValueError(f"Item #{i}: Particulars is required.")

        hsn_code = parse_hsn(it.get("hsn_code", ""))
        item_type = _normalize_metal_type(it.get("item_type", "Gold"))
        quantity = safe_float(it.get("quantity"), 0.0)
        gross_weight = safe_float(it.get("gross_weight"), 0.0)
        stone_weight = safe_float(it.get("stone_weight"), 0.0)
        qty_gms = safe_float(it.get("qty_gms"), None)
        value_addition = safe_float(it.get("value_addition"), 0.0)
        stone_amount = safe_float(it.get("stone_amount"), 0.0)
        invoice_amount = safe_float(it.get("amount"), None)
        if qty_gms is None or qty_gms <= 0:
            raise ValueError(f"Item #{i}: Weight (grams) must be > 0.")
        if invoice_amount is None or invoice_amount <= 0:
            raise ValueError(f"Item #{i}: Amount must be > 0.")
        if item_type not in VALID_METAL_TYPES:
            raise ValueError(f"Item #{i}: Type must be Gold, Gold Pure, Silver, or Silver Pure.")

        raw_total = float(invoice_amount) / 1.03
        if tax_type == "igst":
            igst_item = round(raw_total * 0.03, 2)
            cgst_item = 0.0
            sgst_item = 0.0
            taxable_amount = round(float(invoice_amount) - igst_item, 2)
        else:
            cgst_item = round(raw_total * 0.015, 2)
            sgst_item = round(raw_total * 0.015, 2)
            igst_item = 0.0
            taxable_amount = round(float(invoice_amount) - cgst_item - sgst_item, 2)

        rate_per_g = round(float(taxable_amount) / float(qty_gms), 2)
        total += taxable_amount
        cgst_total += cgst_item
        sgst_total += sgst_item
        igst_total += igst_item

        normalized_items.append(
            {
                "particulars": particulars,
                "hsn_code": hsn_code,
                "item_type": item_type,
                "quantity": int(quantity) if quantity and quantity > 0 else 0,
                "gross_weight": round(gross_weight, 3),
                "stone_weight": round(stone_weight, 3),
                "qty_gms": round(qty_gms, 3),
                "value_addition": round(value_addition, 3),
                "rate_per_g": round(rate_per_g, 2),
                "amount": taxable_amount,
                "stone_amount": round(stone_amount, 2),
                "invoice_amount": round(float(invoice_amount), 2),
                "tax_type": tax_type,
            }
        )

    total = round(total, 2)
    cgst = round(cgst_total, 2)
    sgst = round(sgst_total, 2)
    igst = round(igst_total, 2)
    final_amount = round(total + cgst + sgst + igst, 2)

    if payment_mode == "cash_bank":
        cash_amount = safe_float(data.get("cash_amount"), None)
        bank_amount = safe_float(data.get("bank_amount"), None)
        if cash_amount is None or cash_amount <= 0:
            raise ValueError("cash_amount must be greater than 0 for cash_bank payment mode.")
        if bank_amount is None or bank_amount <= 0:
            raise ValueError("bank_amount must be greater than 0 for cash_bank payment mode.")
        if round(cash_amount + bank_amount, 2) != final_amount:
            raise ValueError("cash_amount + bank_amount must equal the final invoice amount.")
    elif payment_mode == "bank":
        cash_amount = 0.0
        bank_amount = final_amount
    else:
        cash_amount = final_amount
        bank_amount = 0.0

    return {
        "customer_name": customer_name,
        "customer_address": customer_address,
        "customer_phone": customer_phone,
        "party_gst_no": party_gst_no,
        "payment_mode": payment_mode,
        "cash_amount": round(cash_amount, 2),
        "bank_amount": round(bank_amount, 2),
        "tax_type": tax_type,
        "items": normalized_items,
        "total": total,
        "cgst": cgst,
        "sgst": sgst,
        "igst": igst,
        "final_amount": final_amount,
    }


def _parse_purchase_payload(data, user_id: str):
    supplier_name = _clean_text(data.get("supplier_name", ""), 160)
    if not supplier_name:
        raise ValueError("Supplier Name is required.")

    purchase_date_raw = str(data.get("purchase_date", "")).strip()
    if not purchase_date_raw:
        raise ValueError("Date is required.")

    try:
        purchase_date = datetime.strptime(purchase_date_raw, "%Y-%m-%d")
    except ValueError as exc:
        raise ValueError("Date must be in YYYY-MM-DD format.") from exc

    items = data.get("items", [])
    if not isinstance(items, list) or not items:
        raise ValueError("At least one purchase item is required.")

    inventory_docs = list(inventory_collection.find({"user_id": user_id}, projection={"item_name": 1, "metal_type": 1}))
    inventory_map = {
        _inventory_lookup_key(doc.get("item_name", ""), doc.get("metal_type", "Gold")): doc
        for doc in inventory_docs
    }

    normalized_items = []
    total_amount = 0.0

    for index, item in enumerate(items, start=1):
        item_name = _clean_text(item.get("item_name", ""), 160)
        if not item_name:
            raise ValueError(f"Item row #{index}: Item Name is required.")

        metal_type = _normalize_metal_type(item.get("metal_type", "Gold"))
        inventory_doc = inventory_map.get(_inventory_lookup_key(item_name, metal_type))
        if not inventory_doc:
            raise ValueError(f"Item row #{index}: '{item_name}' is not available in Inventory.")
        if metal_type not in VALID_METAL_TYPES:
            raise ValueError(f"Item row #{index}: Type must be Gold, Gold Pure, Silver, or Silver Pure.")

        weight = safe_float(item.get("weight"), None)
        rate = safe_float(item.get("rate"), None)
        if weight is None or weight <= 0:
            raise ValueError(f"Item row #{index}: Weight must be greater than 0.")
        if rate is None or rate <= 0:
            raise ValueError(f"Item row #{index}: Rate must be greater than 0.")

        amount = round(weight * rate, 2)
        total_amount += amount
        normalized_items.append(
            {
                "item_name": inventory_doc.get("item_name", item_name),
                "metal_type": metal_type,
                "weight": round(weight, 3),
                "rate": round(rate, 2),
                "amount": amount,
            }
        )

    return {
        "supplier_name": supplier_name,
        "purchase_date": purchase_date,
        "items": normalized_items,
        "total_amount": round(total_amount, 2),
    }


def _apply_inventory_delta(user_id: str, items, multiplier: int):
    deltas = defaultdict(float)
    for item in items or []:
        item_name = _clean_text(item.get("item_name", ""), 160)
        if not item_name:
            continue
        metal_type = _normalize_metal_type(item.get("metal_type", "Gold"))
        deltas[(item_name, metal_type)] += float(item.get("weight", 0) or item.get("qty_gms", 0) or 0) * multiplier

    for (item_name, metal_type), delta in deltas.items():
        inventory_doc = inventory_collection.find_one({"user_id": user_id, "item_name": item_name, "metal_type": metal_type})
        if not inventory_doc:
            raise ValueError(f"Inventory item '{item_name}' ({metal_type}) is missing.")
        inventory_collection.update_one(
            {"_id": inventory_doc["_id"]},
            {"$inc": {"available_weight": delta}, "$set": {"updated_at": utcnow()}},
        )


@app.get("/")
def root():
    if g.admin:
        return redirect(url_for("admin_panel"))
    if g.user:
        return redirect(url_for("reports_page"))
    return redirect(url_for("login"))


@app.route("/create-account", methods=["GET", "POST"])
def create_account():
    if g.user:
        return redirect(url_for("reports_page"))

    context = {"error": None, "success": None, "form": {}}
    if request.method == "POST":
        if not is_db_available():
            context["error"] = get_db_error() or "MongoDB is not available."
            return render_template("create_account.html", **context), 503

        shop_name = _clean_text(request.form.get("shop_name", ""), 120)
        owner_name = _clean_text(request.form.get("owner_name", ""), 120)
        email = _normalize_email(request.form.get("email", ""))
        phone = _clean_text(request.form.get("phone", ""), 20)
        shop_gstin = _clean_text(request.form.get("shop_gstin", ""), 30).upper()
        shop_address = _clean_text(request.form.get("shop_address", ""), 300)
        password = str(request.form.get("password", "")).strip()
        context["form"] = {
            "shop_name": shop_name,
            "owner_name": owner_name,
            "email": email,
            "phone": phone,
            "shop_gstin": shop_gstin,
            "shop_address": shop_address,
        }

        try:
            if not shop_name:
                raise ValueError("Shop Name is required.")
            if not owner_name:
                raise ValueError("Owner Name is required.")
            if not EMAIL_RE.match(email):
                raise ValueError("Enter a valid email address.")
            if not PHONE_RE.match(phone):
                raise ValueError("Enter a valid phone number.")
            if not shop_gstin:
                raise ValueError("Shop GSTIN is required.")
            if not shop_address:
                raise ValueError("Shop Address is required.")
            if len(password) < 8:
                raise ValueError("Password must be at least 8 characters.")
            _validate_image_upload(request.files.get("shop_logo"), "Shop Logo")
            _validate_image_upload(request.files.get("shop_name_image"), "Shop Name Image")
            if users_collection.find_one({"email": email}):
                raise ValueError("An active account already exists for this email.")
            if pending_users_collection.find_one({"email": email, "status": "pending"}):
                raise ValueError("A registration request is already pending for this email.")
            pending_users_collection.delete_many({"email": email, "status": "rejected"})

            logo_path = _store_image(request.files["shop_logo"], "logos", "logo")
            shop_name_image_path = _store_image(request.files["shop_name_image"], "shop-names", "shop_name")
            pending_doc = {
                "public_id": _public_id("pending"),
                "shop_name": shop_name,
                "owner_name": owner_name,
                "email": email,
                "phone": phone,
                "shop_gstin": shop_gstin,
                "shop_address": shop_address,
                "password_hash": _hash_password(password),
                "logo_path": logo_path,
                "shop_name_image_path": shop_name_image_path,
                "status": "pending",
                "created_at": utcnow(),
                "updated_at": utcnow(),
            }
            pending_users_collection.insert_one(pending_doc)
            _record_audit("signup_requested", "user", actor_id=pending_doc["public_id"], details={"email": email, "shop_name": shop_name})
            context["success"] = "Registration request submitted. An admin will review it from the approval panel."
            context["form"] = {}
        except ValueError as exc:
            context["error"] = str(exc)

    return render_template("create_account.html", **context)


@app.route("/login", methods=["GET", "POST"])
def login():
    if g.user:
        return redirect(url_for("reports_page"))

    error = None
    email = _normalize_email(request.form.get("email", "")) if request.method == "POST" else ""
    if request.method == "POST":
        if not is_db_available():
            return render_template("login.html", error=get_db_error() or "MongoDB is not available.", email=email), 503

        password = str(request.form.get("password", "")).strip()
        user = users_collection.find_one({"email": email, "status": "active"})
        if not user:
            pending = pending_users_collection.find_one({"email": email, "status": "pending"})
            rejected = pending_users_collection.find_one({"email": email, "status": "rejected"})
            if pending:
                error = "Your account is still pending admin approval."
            elif rejected:
                error = "Your registration was rejected. Please contact the admin."
            else:
                error = "Invalid email or password."
        elif not _check_password(password, user.get("password_hash", "")):
            error = "Invalid email or password."
        else:
            token = _encode_token({"sub": user["public_id"], "kind": "user"}, timedelta(days=JWT_EXPIRES_DAYS))
            response = make_response(redirect(request.args.get("next") or url_for("reports_page")))
            _set_cookie(response, AUTH_COOKIE_NAME, token, timedelta(days=JWT_EXPIRES_DAYS))
            _record_audit("user_login", "user", actor_id=user["user_id"], user_id=user["user_id"])
            return response

    return render_template("login.html", error=error, email=email)


@app.post("/logout")
def logout():
    response = make_response(redirect(url_for("login")))
    if g.user:
        _record_audit("user_logout", "user", actor_id=g.user["user_id"], user_id=g.user["user_id"])
    _clear_cookie(response, AUTH_COOKIE_NAME)
    return response


@app.route("/admin/login", methods=["GET", "POST"])
def admin_login():
    if g.admin:
        return redirect(url_for("admin_panel"))

    error = None
    username = str(request.form.get("username", "")).strip() if request.method == "POST" else ""
    if request.method == "POST":
        password = str(request.form.get("password", "")).strip()
        if username == ADMIN_USERNAME and password == ADMIN_PASSWORD:
            token = _encode_token({"sub": ADMIN_USERNAME, "kind": "admin"}, timedelta(hours=ADMIN_JWT_EXPIRES_HOURS))
            response = make_response(redirect(url_for("admin_panel")))
            _set_cookie(response, ADMIN_COOKIE_NAME, token, timedelta(hours=ADMIN_JWT_EXPIRES_HOURS))
            _record_audit("admin_login", "admin", actor_id=ADMIN_USERNAME, user_id=ADMIN_USERNAME)
            return response
        error = "Invalid admin credentials."

    return render_template("admin_login.html", error=error, username=username)


@app.post("/admin/logout")
def admin_logout():
    response = make_response(redirect(url_for("admin_login")))
    if g.admin:
        _record_audit("admin_logout", "admin", actor_id=ADMIN_USERNAME, user_id=ADMIN_USERNAME)
    _clear_cookie(response, ADMIN_COOKIE_NAME)
    return response


@app.get("/admin")
@admin_required()
def admin_panel():
    if not is_db_available():
        return render_template("admin_panel.html", db_error=get_db_error() or "MongoDB is not available.", pending_users=[], active_users=[]), 503

    pending_users = [_serialize_pending_user(doc) for doc in pending_users_collection.find({"status": "pending"}).sort("created_at", 1)]
    active_users = [_serialize_user_summary(doc) for doc in users_collection.find({"status": "active"}).sort("shop_name", 1)]
    return render_template("admin_panel.html", db_error=None, pending_users=pending_users, active_users=active_users)


@app.post("/admin/pending-users/<pending_id>/approve")
@admin_required()
def approve_pending_user(pending_id: str):
    if not is_db_available():
        return redirect(url_for("admin_panel"))

    pending_user = pending_users_collection.find_one({"public_id": pending_id, "status": "pending"})
    if not pending_user:
        return redirect(url_for("admin_panel"))

    if users_collection.find_one({"email": pending_user["email"]}):
        pending_users_collection.update_one(
            {"_id": pending_user["_id"]},
            {"$set": {"status": "rejected", "updated_at": utcnow(), "rejection_reason": "Duplicate active user"}},
        )
        return redirect(url_for("admin_panel"))

    user_id = _public_id("user")
    user_doc = {
        "user_id": user_id,
        "public_id": user_id,
        "shop_name": pending_user["shop_name"],
        "owner_name": pending_user["owner_name"],
        "email": pending_user["email"],
        "phone": pending_user["phone"],
        "shop_gstin": pending_user.get("shop_gstin"),
        "shop_address": pending_user.get("shop_address"),
        "password_hash": pending_user["password_hash"],
        "logo_path": pending_user.get("logo_path"),
        "shop_name_image_path": pending_user.get("shop_name_image_path"),
        "status": "active",
        "role": "user",
        "created_at": pending_user.get("created_at") or utcnow(),
        "approved_at": utcnow(),
        "updated_at": utcnow(),
    }
    users_collection.insert_one(user_doc)
    pending_users_collection.delete_one({"_id": pending_user["_id"]})
    _record_audit("user_approved", "admin", actor_id=ADMIN_USERNAME, user_id=user_id, details={"email": user_doc["email"], "shop_name": user_doc["shop_name"]})
    return redirect(url_for("admin_panel"))


@app.post("/admin/pending-users/<pending_id>/reject")
@admin_required()
def reject_pending_user(pending_id: str):
    if not is_db_available():
        return redirect(url_for("admin_panel"))

    pending_user = pending_users_collection.find_one({"public_id": pending_id, "status": "pending"})
    if pending_user:
        pending_users_collection.update_one(
            {"_id": pending_user["_id"]},
            {"$set": {"status": "rejected", "updated_at": utcnow(), "rejected_at": utcnow()}},
        )
        _record_audit("user_rejected", "admin", actor_id=ADMIN_USERNAME, details={"email": pending_user.get("email"), "shop_name": pending_user.get("shop_name")})
    return redirect(url_for("admin_panel"))


@app.route("/account", methods=["GET", "POST"])
@login_required()
def account_page():
    if not is_db_available():
        return render_template("account.html", error=get_db_error() or "MongoDB is not available.", success=None), 503

    error = None
    success = None
    if request.method == "POST":
        updates = {
            "owner_name": _clean_text(request.form.get("owner_name", g.user.get("owner_name", "")), 120),
            "phone": _clean_text(request.form.get("phone", g.user.get("phone", "")), 20),
            "shop_gstin": _clean_text(request.form.get("shop_gstin", g.user.get("shop_gstin", "")), 30).upper(),
            "shop_address": _clean_text(request.form.get("shop_address", g.user.get("shop_address", "")), 300),
            "updated_at": utcnow(),
        }
        try:
            if not updates["owner_name"]:
                raise ValueError("Owner Name is required.")
            if not PHONE_RE.match(updates["phone"]):
                raise ValueError("Enter a valid phone number.")
            if not updates["shop_gstin"]:
                raise ValueError("Shop GSTIN is required.")
            if not updates["shop_address"]:
                raise ValueError("Shop Address is required.")
            logo_file = request.files.get("shop_logo")
            name_image_file = request.files.get("shop_name_image")
            if logo_file and logo_file.filename:
                updates["logo_path"] = _store_image(logo_file, "logos", "logo")
            if name_image_file and name_image_file.filename:
                updates["shop_name_image_path"] = _store_image(name_image_file, "shop-names", "shop_name")

            users_collection.update_one({"_id": g.user["_id"]}, {"$set": updates})
            g.user = users_collection.find_one({"_id": g.user["_id"]})
            success = "Branding updated successfully."
            _record_audit("branding_updated", "user", actor_id=g.user["user_id"], user_id=g.user["user_id"])
        except ValueError as exc:
            error = str(exc)

    return render_template("account.html", error=error, success=success)


@app.get("/billing")
@login_required()
def billing_page():
    return render_template("billing.html")


@app.get("/reports")
@login_required()
def reports_page():
    return render_template("reports.html")


@app.get("/purchases")
@login_required()
def purchases_page():
    return render_template("purchases.html")


@app.get("/inventory")
@login_required()
def inventory_page():
    return render_template("inventory.html")


@app.get("/sales")
@login_required()
def sales_page():
    return render_template("sales.html")


@app.get("/inventory-items")
@login_required(api=True)
def list_inventory_items():
    if not is_db_available():
        return _db_unavailable_response()

    search = _clean_text(request.args.get("search", ""), 160)
    metal_type = _normalize_metal_type(request.args.get("type", ""), default="")
    query = {"user_id": _current_user_id()}
    if search:
        query["item_name"] = {"$regex": re.escape(search), "$options": "i"}
    if metal_type in VALID_METAL_TYPES:
        query["metal_type"] = metal_type

    docs = inventory_collection.find(query).sort([("metal_type", 1), ("item_name", 1)])
    return jsonify({"items": [_serialize_inventory_item(doc) for doc in docs]})


@app.post("/inventory-items")
@login_required(api=True)
def create_inventory_item():
    if not is_db_available():
        return _db_unavailable_response()

    try:
        data = request.get_json(force=True)
    except Exception:
        return _bad_request("Invalid JSON body.")

    user_id = _current_user_id()
    item_name = _clean_text(data.get("item_name", ""), 160)
    metal_type = _normalize_metal_type(data.get("metal_type", "Gold"))
    reorder_threshold = safe_float(data.get("reorder_threshold"), 10.0)

    if not item_name:
        return _bad_request("Item Name is required.")
    if metal_type not in VALID_METAL_TYPES:
        return _bad_request("Type must be Gold, Gold Pure, Silver, or Silver Pure.")
    if inventory_collection.find_one({"user_id": user_id, "item_name": item_name, "metal_type": metal_type}):
        return _bad_request("Item already exists for this material type.")

    now = utcnow()
    doc = {
        "user_id": user_id,
        "public_id": _public_id("inv"),
        "item_name": item_name,
        "metal_type": metal_type,
        "available_weight": 0.0,
        "reorder_threshold": round(float(reorder_threshold or 0), 3),
        "created_at": now,
        "updated_at": now,
    }
    inventory_collection.insert_one(doc)
    items_collection.update_one(
        {"user_id": user_id, "name": item_name, "metal_type": metal_type},
        {
            "$set": {"updated_at": now},
            "$setOnInsert": {
                "user_id": user_id,
                "public_id": _public_id("item"),
                "name": item_name,
                "metal_type": metal_type,
                "created_at": now,
            },
        },
        upsert=True,
    )
    return jsonify(_serialize_inventory_item(doc))


@app.put("/inventory-items/<item_id>")
@login_required(api=True)
def update_inventory_item(item_id: str):
    if not is_db_available():
        return _db_unavailable_response()

    try:
        data = request.get_json(force=True)
    except Exception:
        return _bad_request("Invalid JSON body.")

    user_id = _current_user_id()
    existing = inventory_collection.find_one({"user_id": user_id, "public_id": item_id})
    if not existing:
        return jsonify({"error": "Inventory item not found."}), 404

    item_name = _clean_text(data.get("item_name", ""), 160)
    if not item_name:
        return _bad_request("Item Name is required.")

    duplicate = inventory_collection.find_one(
        {
            "user_id": user_id,
            "item_name": item_name,
            "metal_type": existing.get("metal_type", "Gold"),
            "public_id": {"$ne": item_id},
        }
    )
    if duplicate:
        return _bad_request("Item already exists for this material type.")

    inventory_collection.update_one({"_id": existing["_id"]}, {"$set": {"item_name": item_name, "updated_at": utcnow()}})
    updated = inventory_collection.find_one({"_id": existing["_id"]})
    return jsonify(_serialize_inventory_item(updated))


@app.delete("/inventory-items/<item_id>")
@login_required(api=True)
def delete_inventory_item(item_id: str):
    if not is_db_available():
        return _db_unavailable_response()

    result = inventory_collection.delete_one({"user_id": _current_user_id(), "public_id": item_id})
    if result.deleted_count == 0:
        return jsonify({"error": "Inventory item not found."}), 404
    return jsonify({"message": "Inventory item deleted successfully.", "id": item_id})


@app.get("/purchases-data")
@login_required(api=True)
def list_purchases():
    if not is_db_available():
        return _db_unavailable_response()

    docs = purchases_collection.find({"user_id": _current_user_id()}).sort("created_at", -1).limit(100)
    return jsonify({"purchases": [_serialize_purchase(doc) for doc in docs]})


@app.post("/purchases")
@login_required(api=True)
def create_purchase():
    if not is_db_available():
        return _db_unavailable_response()

    try:
        data = request.get_json(force=True)
    except Exception:
        return _bad_request("Invalid JSON body.")

    user_id = _current_user_id()
    try:
        purchase_payload = _parse_purchase_payload(data, user_id)
    except ValueError as exc:
        return _bad_request(str(exc))

    purchase_no = get_next_sequence("purchase_no", user_id)
    now = utcnow()
    doc = {
        "user_id": user_id,
        "public_id": _public_id("purchase"),
        "purchase_no": int(purchase_no),
        "supplier_name": purchase_payload["supplier_name"],
        "purchase_date": purchase_payload["purchase_date"],
        "created_at": now,
        "updated_at": now,
        "items": purchase_payload["items"],
        "total_amount": purchase_payload["total_amount"],
    }

    try:
        purchases_collection.insert_one(doc)
        _apply_inventory_delta(user_id, doc["items"], 1)
    except ValueError as exc:
        purchases_collection.delete_one({"public_id": doc["public_id"], "user_id": user_id})
        return _bad_request(str(exc))

    return jsonify(_serialize_purchase(doc))


@app.put("/purchases/<purchase_id>")
@login_required(api=True)
def update_purchase(purchase_id: str):
    if not is_db_available():
        return _db_unavailable_response()

    try:
        data = request.get_json(force=True)
    except Exception:
        return _bad_request("Invalid JSON body.")

    user_id = _current_user_id()
    existing = purchases_collection.find_one({"user_id": user_id, "public_id": purchase_id})
    if not existing:
        return jsonify({"error": "Purchase not found."}), 404

    try:
        purchase_payload = _parse_purchase_payload(data, user_id)
    except ValueError as exc:
        return _bad_request(str(exc))

    old_inventory_removed = False
    try:
        _apply_inventory_delta(user_id, existing.get("items", []), -1)
        old_inventory_removed = True
        _apply_inventory_delta(user_id, purchase_payload["items"], 1)
    except ValueError as exc:
        if old_inventory_removed:
            try:
                _apply_inventory_delta(user_id, existing.get("items", []), 1)
            except ValueError:
                pass
        return _bad_request(str(exc))

    purchases_collection.update_one(
        {"_id": existing["_id"]},
        {
            "$set": {
                "supplier_name": purchase_payload["supplier_name"],
                "purchase_date": purchase_payload["purchase_date"],
                "items": purchase_payload["items"],
                "total_amount": purchase_payload["total_amount"],
                "updated_at": utcnow(),
            }
        },
    )
    updated = purchases_collection.find_one({"_id": existing["_id"]})
    return jsonify(_serialize_purchase(updated))


@app.delete("/purchases/<purchase_id>")
@login_required(api=True)
def delete_purchase(purchase_id: str):
    if not is_db_available():
        return _db_unavailable_response()

    user_id = _current_user_id()
    existing = purchases_collection.find_one({"user_id": user_id, "public_id": purchase_id})
    if not existing:
        return jsonify({"error": "Purchase not found."}), 404

    try:
        _apply_inventory_delta(user_id, existing.get("items", []), -1)
    except ValueError as exc:
        return _bad_request(str(exc))

    purchases_collection.delete_one({"_id": existing["_id"]})
    return jsonify({"message": "Purchase deleted successfully.", "id": purchase_id})


@app.post("/create-bill")
@login_required(api=True)
def create_bill():
    if not is_db_available():
        return _db_unavailable_response()

    try:
        data = request.get_json(force=True)
    except Exception:
        return _bad_request("Invalid JSON body.")

    try:
        invoice_payload = _normalize_invoice_payload(data)
    except ValueError as exc:
        return _bad_request(str(exc))

    user_id = _current_user_id()
    provided_invoice_no = str(data.get("invoice_no", "") or "").strip()
    invoice_no_text = None

    if provided_invoice_no:
        if provided_invoice_no.isdigit():
            invoice_seq = int(provided_invoice_no)
            if invoice_seq <= 0:
                return _bad_request("invoice_no must be > 0.")
            if bills_collection.find_one({"user_id": user_id, "invoice_no": invoice_seq}):
                return _bad_request("Invoice number already exists.")
            invoice_no_text = provided_invoice_no
            counters_collection.update_one({"_id": f"invoice_no:{user_id}"}, {"$max": {"seq": invoice_seq}}, upsert=True)
        else:
            invoice_seq = get_next_invoice_no(user_id)
            invoice_no_text = provided_invoice_no
    else:
        invoice_seq = get_next_invoice_no(user_id)
        invoice_no_text = format_invoice_no(invoice_seq)

    invoice_doc = {
        "user_id": user_id,
        "public_id": _public_id("invoice"),
        "invoice_no": invoice_seq,
        "invoice_no_text": invoice_no_text or format_invoice_no(invoice_seq),
        "created_at": utcnow(),
        "updated_at": utcnow(),
        "state": STATE_NAME,
        "shop_name": g.user.get("shop_name"),
        "shop_gstin": g.user.get("shop_gstin"),
        "shop_address": g.user.get("shop_address"),
        "shop_phone": g.user.get("phone"),
        "logo_path": g.user.get("logo_path"),
        "shop_name_image_path": g.user.get("shop_name_image_path"),
        **invoice_payload,
    }
    bills_collection.insert_one(invoice_doc)
    return jsonify(_serialize_bill(invoice_doc, include_items=True))


@app.get("/bills")
@login_required(api=True)
def list_bills():
    if not is_db_available():
        return _db_unavailable_response()

    from_date = _parse_date_query("from")
    to_date = _parse_date_query("to")
    if from_date is None and to_date is None:
        to_date = datetime.now()
        from_date = to_date - timedelta(days=30)

    query = {"user_id": _current_user_id()}
    if from_date is not None:
        query["created_at"] = {"$gte": from_date}
    if to_date is not None:
        end = to_date + timedelta(days=1)
        query["created_at"] = query.get("created_at", {})
        query["created_at"]["$lt"] = end

    docs = bills_collection.find(query).sort("created_at", -1).limit(500)
    return jsonify({"bills": [_serialize_bill(doc, include_items=True) for doc in docs]})


@app.get("/dashboard-data")
@login_required(api=True)
def dashboard_data():
    if not is_db_available():
        return _db_unavailable_response()

    user_id = _current_user_id()
    from_date = _parse_date_query("from")
    to_date = _parse_date_query("to")
    if from_date is None and to_date is None:
        to_date = datetime.now()
        from_date = to_date - timedelta(days=30)

    bill_query = {"user_id": user_id}
    purchase_query = {"user_id": user_id}
    if from_date is not None:
        bill_query["created_at"] = {"$gte": from_date}
        purchase_query["created_at"] = {"$gte": from_date}
    if to_date is not None:
        end = to_date + timedelta(days=1)
        bill_query["created_at"] = bill_query.get("created_at", {})
        purchase_query["created_at"] = purchase_query.get("created_at", {})
        bill_query["created_at"]["$lt"] = end
        purchase_query["created_at"]["$lt"] = end

    bills = list(bills_collection.find(bill_query).sort("created_at", -1).limit(500))
    purchases = list(purchases_collection.find(purchase_query).sort("created_at", -1).limit(100))
    inventory = list(inventory_collection.find({"user_id": user_id}))

    today = datetime.now().date()
    yesterday = today - timedelta(days=1)

    def day_total(docs, field_name, target_date):
        total = 0.0
        for doc in docs:
            created_at = doc.get("created_at")
            if created_at and created_at.date() == target_date:
                total += float(doc.get(field_name, 0) or 0)
        return round(total, 2)

    sales_today = day_total(bills, "final_amount", today)
    sales_yesterday = day_total(bills, "final_amount", yesterday)
    purchases_today = day_total(purchases, "total_amount", today)
    purchases_yesterday = day_total(purchases, "total_amount", yesterday)
    net_profit = round(sales_today - purchases_today, 2)

    metal_rows = {
        "pure Gold": {"label": "Pure Gold", "qty": 0.0, "taxable": 0.0, "cgst": 0.0, "sgst": 0.0, "igst": 0.0, "total": 0.0},
        "pure Silver": {"label": "Pure Silver", "qty": 0.0, "taxable": 0.0, "cgst": 0.0, "sgst": 0.0, "igst": 0.0, "total": 0.0},
        "Gold": {"label": "Gold", "qty": 0.0, "taxable": 0.0, "cgst": 0.0, "sgst": 0.0, "igst": 0.0, "total": 0.0},
        "Silver": {"label": "Silver", "qty": 0.0, "taxable": 0.0, "cgst": 0.0, "sgst": 0.0, "igst": 0.0, "total": 0.0},
    }
    top_items = {}
    payment = {"cash": 0.0, "bank": 0.0}

    for bill in bills:
        items = bill.get("items", []) or []
        item_count = len(items) or 1
        payment_mode = str(bill.get("payment_mode", "cash")).lower()
        if payment_mode == "cash_bank":
            payment["cash"] += float(bill.get("cash_amount", 0) or 0)
            payment["bank"] += float(bill.get("bank_amount", 0) or 0)
        else:
            payment[payment_mode if payment_mode in payment else "cash"] += float(bill.get("final_amount", 0) or 0)

        for item in items:
            particulars = str(item.get("particulars", "") or "")
            item_name_lower = particulars.lower()
            if "silver" in item_name_lower and "pure" in item_name_lower:
                key = "pure Silver"
            elif "silver" in item_name_lower:
                key = "Silver"
            elif "pure" in item_name_lower:
                key = "pure Gold"
            else:
                key = "Gold"

            row = metal_rows[key]
            row["qty"] += float(item.get("qty_gms", 0) or 0)
            row["taxable"] += float(item.get("amount", 0) or 0)
            row["cgst"] += float(bill.get("cgst", 0) or 0) / item_count
            row["sgst"] += float(bill.get("sgst", 0) or 0) / item_count
            row["igst"] += float(bill.get("igst", 0) or 0) / item_count
            row["total"] += float(item.get("invoice_amount", item.get("amount", 0)) or 0)

            top_item = top_items.setdefault(particulars or "Untitled Item", {"name": particulars or "Untitled Item", "qty": 0.0, "revenue": 0.0})
            top_item["qty"] += float(item.get("qty_gms", 0) or 0)
            top_item["revenue"] += float(item.get("invoice_amount", item.get("amount", 0)) or 0)

    total_row = {"label": "Total", "qty": 0.0, "taxable": 0.0, "cgst": 0.0, "sgst": 0.0, "igst": 0.0, "total": 0.0}
    for row in metal_rows.values():
        for key in ("qty", "taxable", "cgst", "sgst", "igst", "total"):
            total_row[key] += row[key]

    inventory_rows = []
    low_stock_alerts = []
    total_stock_weight = 0.0
    for item in inventory:
        available = float(item.get("available_weight", 0) or 0)
        threshold = float(item.get("reorder_threshold", 0) or 0)
        total_stock_weight += available
        status = "Normal"
        if available <= threshold:
            status = "Low"
        if available < 0 or (threshold and available <= threshold * 0.5):
            status = "Critical"
        inventory_row = {
            "item_name": item.get("item_name", "Unnamed Item"),
            "available_weight": round(available, 3),
            "status": status,
            "updated_at": item.get("updated_at").isoformat() if item.get("updated_at") else None,
        }
        inventory_rows.append(inventory_row)
        if status != "Normal":
            low_stock_alerts.append(inventory_row)

    inventory_rows.sort(key=lambda row: row["available_weight"])
    low_stock_alerts.sort(key=lambda row: row["available_weight"])

    trend = {}
    for bill in bills:
        created_at = bill.get("created_at")
        if not created_at:
            continue
        key = created_at.strftime("%Y-%m-%d")
        trend.setdefault(key, 0.0)
        trend[key] += float(bill.get("final_amount", 0) or 0)

    return jsonify(
        {
            "kpis": {
                "today_sales": sales_today,
                "today_sales_previous": sales_yesterday,
                "today_purchases": purchases_today,
                "today_purchases_previous": purchases_yesterday,
                "net_profit": net_profit,
                "total_stock_weight": round(total_stock_weight, 3),
                "low_stock_alerts": len(low_stock_alerts),
            },
            "branding": {
                "shop_name": g.user.get("shop_name"),
                "logo_url": _asset_url(g.user.get("logo_path")),
                "shop_name_image_url": _asset_url(g.user.get("shop_name_image_path")),
            },
            "monthly_summary": list(metal_rows.values()) + [total_row],
            "payment_summary": {
                "cash": round(payment["cash"], 2),
                "bank": round(payment["bank"], 2),
                "total": round(payment["cash"] + payment["bank"], 2),
            },
            "top_selling_items": sorted(top_items.values(), key=lambda item: item["revenue"], reverse=True)[:5],
            "inventory_snapshot": inventory_rows[:8],
            "recent_sales": [{"id": bill.get("invoice_no_text") or bill.get("invoice_no"), "name": bill.get("customer_name") or "Walk-in Customer", "amount": round(float(bill.get("final_amount", 0) or 0), 2)} for bill in bills[:5]],
            "recent_purchases": [{"id": str(purchase.get("purchase_no") or purchase.get("public_id")), "name": purchase.get("supplier_name") or "Supplier", "amount": round(float(purchase.get("total_amount", 0) or 0), 2)} for purchase in purchases[:5]],
            "low_stock_alerts": low_stock_alerts[:6],
            "sales_trend": [{"date": key, "amount": round(value, 2)} for key, value in sorted(trend.items())],
        }
    )


@app.get("/bills/<int:invoice_no>")
@login_required(api=True)
def get_bill(invoice_no: int):
    if not is_db_available():
        return _db_unavailable_response()

    invoice = bills_collection.find_one({"user_id": _current_user_id(), "invoice_no": invoice_no})
    if not invoice:
        return jsonify({"error": "Invoice not found"}), 404
    return jsonify(_serialize_bill(invoice, include_items=True))


@app.put("/bills/<int:invoice_no>")
@login_required(api=True)
def update_bill(invoice_no: int):
    if not is_db_available():
        return _db_unavailable_response()

    try:
        data = request.get_json(force=True)
    except Exception:
        return _bad_request("Invalid JSON body.")

    user_id = _current_user_id()
    existing = bills_collection.find_one({"user_id": user_id, "invoice_no": invoice_no})
    if not existing:
        return jsonify({"error": "Invoice not found"}), 404

    try:
        invoice_payload = _normalize_invoice_payload(data)
    except ValueError as exc:
        return _bad_request(str(exc))

    bills_collection.update_one(
        {"_id": existing["_id"]},
        {
            "$set": {
                **invoice_payload,
                "shop_name": g.user.get("shop_name"),
                "shop_gstin": g.user.get("shop_gstin"),
                "shop_address": g.user.get("shop_address"),
                "shop_phone": g.user.get("phone"),
                "logo_path": g.user.get("logo_path"),
                "shop_name_image_path": g.user.get("shop_name_image_path"),
                "state": STATE_NAME,
                "updated_at": utcnow(),
            }
        },
    )
    updated = bills_collection.find_one({"_id": existing["_id"]})
    return jsonify(_serialize_bill(updated, include_items=True))


@app.delete("/bills/<int:invoice_no>")
@login_required(api=True)
def delete_bill(invoice_no: int):
    if not is_db_available():
        return _db_unavailable_response()

    result = bills_collection.delete_one({"user_id": _current_user_id(), "invoice_no": invoice_no})
    if result.deleted_count == 0:
        return jsonify({"error": "Invoice not found"}), 404
    return jsonify({"message": "Invoice deleted successfully.", "invoice_no": invoice_no})


@app.get("/export-excel")
@login_required()
def export_excel():
    if not is_db_available():
        return redirect(url_for("reports_page"))

    from_date = (request.args.get("from") or "").strip() or None
    to_date = (request.args.get("to") or "").strip() or None
    excel_bytes = export_bills_to_excel_bytes(from_date, to_date, user_id=_current_user_id())

    return send_file(
        BytesIO(excel_bytes),
        mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        as_attachment=True,
        download_name="invoices.xlsx",
    )


@app.get("/generate-pdf")
@login_required()
def generate_pdf():
    if not is_db_available():
        return redirect(url_for("reports_page"))

    invoice_no = request.args.get("invoice_no")
    if not invoice_no:
        return jsonify({"error": "invoice_no query param is required"}), 400

    try:
        invoice_no_int = int(str(invoice_no).strip())
    except Exception:
        return jsonify({"error": "invoice_no must be numeric"}), 400

    invoice = bills_collection.find_one({"user_id": _current_user_id(), "invoice_no": invoice_no_int})
    if not invoice:
        return jsonify({"error": "Invoice not found"}), 404

    pdf_bytes = generate_invoice_pdf_bytes(
        invoice,
        shop_overrides={
            "logo_path": g.user.get("logo_path") or invoice.get("logo_path"),
            "shop_name_image_path": g.user.get("shop_name_image_path") or invoice.get("shop_name_image_path"),
            "shop_name": g.user.get("shop_name") or invoice.get("shop_name"),
            "shop_gstin": g.user.get("shop_gstin") or invoice.get("shop_gstin"),
            "shop_address": g.user.get("shop_address") or invoice.get("shop_address"),
            "shop_phone": g.user.get("phone") or invoice.get("shop_phone"),
        },
    )

    download_flag = str(request.args.get("download", "1")) != "0"
    response = send_file(
        BytesIO(pdf_bytes),
        mimetype="application/pdf",
        as_attachment=download_flag,
        download_name=f"invoice_{invoice_no_int}.pdf",
    )
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response


if __name__ == "__main__":
    try:
        ensure_indexes()
        UPLOAD_PATH.mkdir(parents=True, exist_ok=True)
    except Exception as exc:
        print(f"Warning: startup check failed: {exc}")
    app.run(host="0.0.0.0", port=5000, debug=False)
