from io import BytesIO
from datetime import datetime, time
from typing import List, Dict, Any, Optional

import pandas as pd

from db import bills_collection, require_db
from utils import format_invoice_no


EXCEL_HEADERS = [
    "Invoice No",
    "Date",
    "Customer Name",
    "Item",
    "HSN Code",
    "Weight",
    "Rate",
    "Amount",
    "CGST",
    "SGST",
    "Total",
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
    customer_name: str,
    total: Any,
    cgst: Any,
    sgst: Any,
    item: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    item = item or {}
    return {
        "Invoice No": invoice_no_text,
        "Date": date_str,
        "Customer Name": customer_name,
        "Item": item.get("particulars") or "",
        "HSN Code": item.get("hsn_code") or "",
        "Weight": item.get("qty_gms") if item.get("qty_gms") is not None else "",
        "Rate": item.get("rate_per_g") if item.get("rate_per_g") is not None else "",
        "Amount": item.get("invoice_amount", item.get("amount", "")),
        "CGST": cgst if cgst is not None else "",
        "SGST": sgst if sgst is not None else "",
        "Total": total if total is not None else "",
    }


def export_bills_to_excel_bytes(from_date: Optional[str], to_date: Optional[str]) -> bytes:
    require_db()
    query = _date_range_filter(from_date, to_date)
    bills: List[Dict[str, Any]] = list(
        bills_collection.find(
            query,
            projection={
                "invoice_no": 1,
                "invoice_no_text": 1,
                "created_at": 1,
                "customer_name": 1,
                "items": 1,
                "total": 1,
                "cgst": 1,
                "sgst": 1,
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
        customer_name = bill.get("customer_name") or ""
        total = bill.get("total")
        cgst = bill.get("cgst")
        sgst = bill.get("sgst")

        if invoice_no_text is None or created_at is None:
            continue

        date_str = created_at.strftime("%Y-%m-%d %H:%M")
        items = bill.get("items", []) or []

        if not items:
            rows.append(_build_row(invoice_no_text, date_str, customer_name, total, cgst, sgst))
            continue

        for item in items:
            rows.append(_build_row(invoice_no_text, date_str, customer_name, total, cgst, sgst, item))

    df = pd.DataFrame(rows, columns=EXCEL_HEADERS)

    output = BytesIO()
    with pd.ExcelWriter(output, engine="openpyxl") as writer:
        sheet_name = "Invoices"
        df.to_excel(writer, index=False, sheet_name=sheet_name)
    output.seek(0)
    return output.read()
