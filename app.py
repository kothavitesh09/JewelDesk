from io import BytesIO
from datetime import datetime, timedelta

from flask import Flask, jsonify, render_template, request, send_file

from db import ensure_indexes, get_db_error, get_next_invoice_no, bills_collection, counters_collection, is_db_available
from utils import safe_float, parse_hsn, utcnow, format_invoice_no
from config import STATE_NAME
from pdf_generator import generate_invoice_pdf_bytes
from excel_export import export_bills_to_excel_bytes


app = Flask(__name__, template_folder="templates", static_folder="static")


@app.get("/")
def root():
    return render_template("billing.html")


@app.get("/billing")
def billing_page():
    return render_template("billing.html")


@app.get("/reports")
def reports_page():
    return render_template("reports.html")


def _bad_request(msg: str):
    return jsonify({"error": msg}), 400


def _db_unavailable_response():
    return jsonify({"error": get_db_error() or "MongoDB is not available."}), 503


def _serialize_bill(doc, include_items: bool = False):
    if not doc:
        return None

    payload = {
        "invoice_no": doc.get("invoice_no"),
        "invoice_no_text": doc.get("invoice_no_text") or doc.get("invoice_no"),
        "date": doc.get("created_at").isoformat() if doc.get("created_at") else None,
        "customer_name": doc.get("customer_name"),
        "party_gst_no": doc.get("party_gst_no"),
        "payment_mode": doc.get("payment_mode", "cash"),
        "tax_type": doc.get("tax_type", "cgst_sgst"),
        "total": doc.get("total", 0),
        "cgst": doc.get("cgst", 0),
        "sgst": doc.get("sgst", 0),
        "igst": doc.get("igst", 0),
        "final_amount": doc.get("final_amount", 0),
    }
    if include_items:
        payload["items"] = doc.get("items", [])
    return payload


def _normalize_invoice_payload(data):
    customer_name = str(data.get("customer_name", "")).strip()
    if not customer_name:
        raise ValueError("Customer Name is required.")

    party_gst_no = str(data.get("party_gst_no", "")).strip() or None
    payment_mode = str(data.get("payment_mode", "cash")).strip().lower()
    if payment_mode not in {"cash", "bank"}:
        raise ValueError("payment_mode must be either 'cash' or 'bank'.")

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
        particulars = str(it.get("particulars", "")).strip()
        if not particulars:
            raise ValueError(f"Item #{i}: Particulars is required.")

        hsn_code = parse_hsn(it.get("hsn_code", ""))
        qty_gms = safe_float(it.get("qty_gms"), None)
        invoice_amount = safe_float(it.get("amount"), None)

        if qty_gms is None or qty_gms <= 0:
            raise ValueError(f"Item #{i}: Weight (grams) must be > 0.")
        if invoice_amount is None or invoice_amount <= 0:
            raise ValueError(f"Item #{i}: Amount must be > 0.")

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
                "qty_gms": round(qty_gms, 3),
                "rate_per_g": round(rate_per_g, 2),
                "amount": taxable_amount,
                "invoice_amount": round(float(invoice_amount), 2),
                "tax_type": tax_type,
            }
        )

    total = round(total, 2)
    cgst = round(cgst_total, 2)
    sgst = round(sgst_total, 2)
    igst = round(igst_total, 2)
    final_amount = round(total + cgst + sgst + igst, 2)

    return {
        "customer_name": customer_name,
        "party_gst_no": party_gst_no,
        "payment_mode": payment_mode,
        "tax_type": tax_type,
        "items": normalized_items,
        "total": total,
        "cgst": cgst,
        "sgst": sgst,
        "igst": igst,
        "final_amount": final_amount,
    }


@app.post("/create-bill")
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

    provided_invoice_no = data.get("invoice_no", None)
    provided_invoice_no = str(provided_invoice_no).strip() if provided_invoice_no is not None else ""

    invoice_seq = None
    invoice_no_text = None

    if provided_invoice_no:
        if provided_invoice_no.isdigit():
            invoice_seq = int(provided_invoice_no)
            if invoice_seq <= 0:
                return _bad_request("invoice_no must be > 0.")
            if bills_collection.find_one({"invoice_no": invoice_seq}):
                return _bad_request("Invoice number already exists.")

            invoice_no_text = provided_invoice_no
            counters_collection.update_one(
                {"_id": "invoice_no"},
                {"$max": {"seq": invoice_seq}},
                upsert=True,
            )
        else:
            invoice_seq = get_next_invoice_no()
            invoice_no_text = provided_invoice_no
    else:
        invoice_seq = get_next_invoice_no()
        invoice_no_text = format_invoice_no(invoice_seq)

    if not invoice_no_text:
        invoice_no_text = format_invoice_no(invoice_seq)

    invoice_doc = {
        "invoice_no": invoice_seq,
        "invoice_no_text": invoice_no_text,
        "created_at": utcnow(),
        "state": STATE_NAME,
        **invoice_payload,
    }

    bills_collection.insert_one(invoice_doc)
    return jsonify(_serialize_bill(invoice_doc, include_items=True))


def _parse_date_query(param_name: str):
    value = request.args.get(param_name)
    if not value:
        return None
    return datetime.strptime(value, "%Y-%m-%d")


@app.get("/bills")
def list_bills():
    if not is_db_available():
        return _db_unavailable_response()

    from_date = _parse_date_query("from")
    to_date = _parse_date_query("to")

    if from_date is None and to_date is None:
        to_date = datetime.now()
        from_date = to_date - timedelta(days=30)

    query = {}
    if from_date is not None:
        query["created_at"] = {"$gte": from_date}
    if to_date is not None:
        end = to_date + timedelta(days=1)
        query["created_at"] = query.get("created_at", {})
        query["created_at"]["$lt"] = end

    docs = (
        bills_collection.find(
            query,
            projection={
                "invoice_no": 1,
                "invoice_no_text": 1,
                "created_at": 1,
                "customer_name": 1,
                "party_gst_no": 1,
                "tax_type": 1,
                "total": 1,
                "cgst": 1,
                "sgst": 1,
                "igst": 1,
                "final_amount": 1,
            },
        )
        .sort("created_at", -1)
        .limit(500)
    )

    return jsonify({"bills": [_serialize_bill(doc) for doc in docs]})


@app.get("/bills/<int:invoice_no>")
def get_bill(invoice_no: int):
    if not is_db_available():
        return _db_unavailable_response()

    invoice = bills_collection.find_one({"invoice_no": invoice_no})
    if not invoice:
        return jsonify({"error": "Invoice not found"}), 404
    return jsonify(_serialize_bill(invoice, include_items=True))


@app.put("/bills/<int:invoice_no>")
def update_bill(invoice_no: int):
    if not is_db_available():
        return _db_unavailable_response()

    try:
        data = request.get_json(force=True)
    except Exception:
        return _bad_request("Invalid JSON body.")

    existing = bills_collection.find_one({"invoice_no": invoice_no})
    if not existing:
        return jsonify({"error": "Invoice not found"}), 404

    try:
        invoice_payload = _normalize_invoice_payload(data)
    except ValueError as exc:
        return _bad_request(str(exc))

    invoice_payload["state"] = STATE_NAME

    bills_collection.update_one(
        {"invoice_no": invoice_no},
        {
            "$set": invoice_payload,
        },
    )
    updated = bills_collection.find_one({"invoice_no": invoice_no})
    return jsonify(_serialize_bill(updated, include_items=True))


@app.delete("/bills/<int:invoice_no>")
def delete_bill(invoice_no: int):
    if not is_db_available():
        return _db_unavailable_response()

    result = bills_collection.delete_one({"invoice_no": invoice_no})
    if result.deleted_count == 0:
        return jsonify({"error": "Invoice not found"}), 404
    return jsonify({"message": "Invoice deleted successfully.", "invoice_no": invoice_no})


@app.get("/export-excel")
def export_excel():
    if not is_db_available():
        return _db_unavailable_response()

    from_date = request.args.get("from")
    to_date = request.args.get("to")

    from_date = from_date.strip() if isinstance(from_date, str) else None
    to_date = to_date.strip() if isinstance(to_date, str) else None
    if from_date == "":
        from_date = None
    if to_date == "":
        to_date = None

    excel_bytes = export_bills_to_excel_bytes(from_date, to_date)
    if not excel_bytes:
        excel_bytes = export_bills_to_excel_bytes(from_date, to_date)

    return send_file(
        BytesIO(excel_bytes),
        mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        as_attachment=True,
        download_name="invoices.xlsx",
    )


@app.get("/generate-pdf")
def generate_pdf():
    if not is_db_available():
        return _db_unavailable_response()

    invoice_no = request.args.get("invoice_no")
    if not invoice_no:
        return jsonify({"error": "invoice_no query param is required"}), 400

    try:
        invoice_no_int = int(str(invoice_no).strip())
    except Exception:
        return jsonify({"error": "invoice_no must be numeric"}), 400

    download_flag = request.args.get("download", "1")
    download_flag = "0" not in str(download_flag)

    invoice = bills_collection.find_one({"invoice_no": invoice_no_int})
    if not invoice:
        return jsonify({"error": "Invoice not found"}), 404

    pdf_bytes = generate_invoice_pdf_bytes(invoice)

    if download_flag:
        response = send_file(
            BytesIO(pdf_bytes),
            mimetype="application/pdf",
            as_attachment=True,
            download_name=f"invoice_{invoice_no_int}.pdf",
        )
    else:
        response = send_file(
            BytesIO(pdf_bytes),
            mimetype="application/pdf",
            as_attachment=False,
        )

    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response


if __name__ == "__main__":
    try:
        ensure_indexes()
    except Exception as e:
        print(f"Warning: could not ensure MongoDB indexes: {e}")
    app.run(host="0.0.0.0", port=5000, debug=False)
