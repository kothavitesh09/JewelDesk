from io import BytesIO
from datetime import datetime, time
from typing import List, Dict, Any, Optional

import pandas as pd

from db import bills_collection, require_db
from utils import format_invoice_no, format_weight


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
    "Amt in Cash",
    "Amt in Bank",
    "Exchange Wt",
    "Exchange Amt",
    "Discount",
]


def _to_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


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
    cash_amount: Any = "",
    bank_amount: Any = "",
    exchange_weight: Any = "",
    exchange_amount: Any = "",
    discount: Any = "",
    bill_tax_type: str = "",
    bill_cgst: Any = 0,
    bill_sgst: Any = 0,
    bill_igst: Any = 0,
    bill_taxable_total: Any = 0,
    item_count: int = 1,
    item: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    item = item or {}
    is_exchange = payment_mode == "exchange"
    taxable_amount = item.get("amount", "")
    tax_type = str(item.get("tax_type") or bill_tax_type or "").strip().lower()

    cgst_amount = ""
    sgst_amount = ""
    igst_amount = ""

    taxable_value = _to_float(taxable_amount, 0.0) if taxable_amount != "" else 0.0
    taxable_total = _to_float(bill_taxable_total, 0.0)
    row_share = taxable_value / taxable_total if taxable_total > 0 else 1 / max(item_count, 1)

    if taxable_amount != "":
        if any(key in item for key in ("cgst", "sgst", "igst")):
            cgst_amount = round(_to_float(item.get("cgst"), 0.0), 2)
            sgst_amount = round(_to_float(item.get("sgst"), 0.0), 2)
            igst_amount = round(_to_float(item.get("igst"), 0.0), 2)
        elif any(_to_float(value, 0.0) for value in (bill_cgst, bill_sgst, bill_igst)):
            cgst_amount = round(_to_float(bill_cgst, 0.0) * row_share, 2)
            sgst_amount = round(_to_float(bill_sgst, 0.0) * row_share, 2)
            igst_amount = round(_to_float(bill_igst, 0.0) * row_share, 2)
        elif tax_type == "igst":
            cgst_amount = 0.0
            sgst_amount = 0.0
            igst_amount = round(taxable_value * 0.03, 2)
        else:
            cgst_amount = round(taxable_value * 0.015, 2)
            sgst_amount = round(taxable_value * 0.015, 2)
            igst_amount = 0.0

    total_amount = taxable_amount
    if taxable_amount != "":
        total_amount = round(
            taxable_value
            + _to_float(cgst_amount, 0.0)
            + _to_float(sgst_amount, 0.0)
            + _to_float(igst_amount, 0.0),
            2,
        )

    return {
        "Date": date_str,
        "Bill No": invoice_no_text,
        "GST No": party_gst_no,
        "Customer Name": customer_name,
        "Item Name": item.get("particulars") or "",
        "UOM (GMS)": "GMS" if item.get("qty_gms") is not None else "",
        "Qty": format_weight(item.get("qty_gms")) if item.get("qty_gms") is not None else "",
        "Rate": item.get("rate_per_g") if item.get("rate_per_g") is not None else "",
        "Taxable": taxable_amount,
        "CGST Amount": cgst_amount,
        "SGST Amount": sgst_amount,
        "IGST Amount": igst_amount,
        "Total Amount": total_amount,
        "Mode of Payment": "Cash + Bank" if payment_mode == "cash_bank" else (payment_mode.title() if payment_mode else ""),
        "Amt in Cash": cash_amount if payment_mode in {"cash_bank", "exchange"} else "",
        "Amt in Bank": bank_amount if payment_mode in {"cash_bank", "exchange"} else "",
        "Exchange Wt": format_weight(exchange_weight) if is_exchange and exchange_weight not in (None, "") else "",
        "Exchange Amt": exchange_amount if is_exchange else "",
        "Discount": discount,
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
                "cash_amount": 1,
                "bank_amount": 1,
                "exchange_weight": 1,
                "exchange_amount": 1,
                "discount": 1,
                "tax_type": 1,
                "total": 1,
                "cgst": 1,
                "sgst": 1,
                "igst": 1,
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
        cash_amount = bill.get("cash_amount", "")
        bank_amount = bill.get("bank_amount", "")
        exchange_weight = bill.get("exchange_weight", "")
        exchange_amount = bill.get("exchange_amount", "")
        discount = bill.get("discount", 0)
        bill_tax_type = str(bill.get("tax_type") or "").strip().lower()
        bill_cgst = bill.get("cgst", 0)
        bill_sgst = bill.get("sgst", 0)
        bill_igst = bill.get("igst", 0)
        bill_taxable_total = bill.get("total", 0)

        if invoice_no_text is None or created_at is None:
            continue

        date_str = created_at.strftime("%d-%m-%Y")
        items = bill.get("items", []) or []

        if not items:
            rows.append(
                _build_row(
                    invoice_no_text,
                    date_str,
                    party_gst_no,
                    customer_name,
                    payment_mode,
                    cash_amount,
                    bank_amount,
                    exchange_weight,
                    exchange_amount,
                    discount,
                    bill_tax_type=bill_tax_type,
                    bill_cgst=bill_cgst,
                    bill_sgst=bill_sgst,
                    bill_igst=bill_igst,
                    bill_taxable_total=bill_taxable_total,
                )
            )
            continue

        for item in items:
            rows.append(
                _build_row(
                    invoice_no_text,
                    date_str,
                    party_gst_no,
                    customer_name,
                    payment_mode,
                    cash_amount,
                    bank_amount,
                    exchange_weight,
                    exchange_amount,
                    discount,
                    bill_tax_type=bill_tax_type,
                    bill_cgst=bill_cgst,
                    bill_sgst=bill_sgst,
                    bill_igst=bill_igst,
                    bill_taxable_total=bill_taxable_total,
                    item_count=len(items),
                    item=item,
                )
            )

    df = pd.DataFrame(rows, columns=EXCEL_HEADERS)

    output = BytesIO()
    with pd.ExcelWriter(output, engine="openpyxl") as writer:
        sheet_name = "Invoices"
        df.to_excel(writer, index=False, sheet_name=sheet_name)
    output.seek(0)
    return output.read()
