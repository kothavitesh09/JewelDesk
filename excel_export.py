from io import BytesIO
from datetime import datetime, time
from typing import List, Dict, Any, Optional

import pandas as pd

from db import bills_collection, require_db
from utils import format_invoice_no


EXCEL_HEADERS = [
    "Date",
    "Bill No",
    "GST No",
    "Customer Name",
    "Item Name",
    "UOM (GMS)",
    "Qty",
    "Rate",
    "Taxable",
    "CGST Amount",
    "SGST Amount",
    "IGST Amount",
    "Total Amount",
    "Mode of Payment",
]


def _parse_yyyy_mm_dd(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        return datetime.strptime(value, "%Y-%m-%d")
    except Exception:
        return None


def _date_range_filter(from_date: Optional[str], to_date: Optional[str]) -> Dict[str, Any]:
    start_dt = _parse_yyyy_mm_dd(from_date)
    end_dt = _parse_yyyy_mm_dd(to_date)

    query: Dict[str, Any] = {}
    if start_dt:
        query["created_at"] = {"$gte": datetime.combine(start_dt, time.min)}
    if end_dt:
        if "created_at" in query:
            query["created_at"]["$lte"] = datetime.combine(end_dt, time.max)
        else:
            query["created_at"] = {"$lte": datetime.combine(end_dt, time.max)}
    return query


def _build_row(
    invoice_no_text: str,
    date_str: str,
    party_gst_no: str,
    customer_name: str,
    payment_mode: str,
    item: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    item = item or {}
    taxable_amount = item.get("amount", "")
    total_amount = item.get("invoice_amount", taxable_amount)
    tax_type = str(item.get("tax_type") or "").strip().lower()

    cgst_amount = ""
    sgst_amount = ""
    igst_amount = ""

    if taxable_amount != "" and total_amount != "":
        tax_amount = round(float(total_amount) - float(taxable_amount), 2)
        if tax_type == "igst":
            igst_amount = tax_amount
            cgst_amount = 0.0
            sgst_amount = 0.0
        else:
            half_tax = round(tax_amount / 2, 2)
            cgst_amount = half_tax
            sgst_amount = round(tax_amount - half_tax, 2)
            igst_amount = 0.0

    return {
        "Date": date_str,
        "Bill No": invoice_no_text,
        "GST No": party_gst_no,
        "Customer Name": customer_name,
        "Item Name": item.get("particulars") or "",
        "UOM (GMS)": "GMS" if item.get("qty_gms") is not None else "",
        "Qty": item.get("qty_gms") if item.get("qty_gms") is not None else "",
        "Rate": item.get("rate_per_g") if item.get("rate_per_g") is not None else "",
        "Taxable": taxable_amount,
        "CGST Amount": cgst_amount,
        "SGST Amount": sgst_amount,
        "IGST Amount": igst_amount,
        "Total Amount": total_amount,
        "Mode of Payment": "Cash + Bank" if payment_mode == "cash_bank" else (payment_mode.title() if payment_mode else ""),
    }


def export_bills_to_excel_bytes(from_date: Optional[str], to_date: Optional[str], user_id: Optional[str] = None) -> bytes:
    require_db()
    query = _date_range_filter(from_date, to_date)
    if user_id:
        query["user_id"] = user_id
    bills: List[Dict[str, Any]] = list(
        bills_collection.find(
            query,
            projection={
                "invoice_no": 1,
                "invoice_no_text": 1,
                "created_at": 1,
                "customer_name": 1,
                "party_gst_no": 1,
                "payment_mode": 1,
                "items": 1,
            },
        )
        .sort("created_at", 1)
    )

    rows: List[Dict[str, Any]] = []

    for bill in bills:
        invoice_no = bill.get("invoice_no")
        invoice_no_text = bill.get("invoice_no_text")
        if not invoice_no_text and invoice_no is not None:
            try:
                invoice_no_text = format_invoice_no(int(invoice_no))
            except Exception:
                invoice_no_text = str(invoice_no)

        created_at = bill.get("created_at")
        party_gst_no = (bill.get("party_gst_no") or "").strip()
        customer_name = bill.get("customer_name") or ""
        payment_mode = str(bill.get("payment_mode") or "").strip()

        if invoice_no_text is None or created_at is None:
            continue

        date_str = created_at.strftime("%d-%m-%Y")
        items = bill.get("items", []) or []

        if not items:
            rows.append(_build_row(invoice_no_text, date_str, party_gst_no, customer_name, payment_mode))
            continue

        for item in items:
            rows.append(_build_row(invoice_no_text, date_str, party_gst_no, customer_name, payment_mode, item))

    df = pd.DataFrame(rows, columns=EXCEL_HEADERS)

    output = BytesIO()
    with pd.ExcelWriter(output, engine="openpyxl") as writer:
        sheet_name = "Invoices"
        df.to_excel(writer, index=False, sheet_name=sheet_name)
    output.seek(0)
    return output.read()
