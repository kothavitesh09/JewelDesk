from io import BytesIO
import os
from pathlib import Path
from typing import Any, Dict, Iterable, List, Tuple

from openpyxl import load_workbook
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas

from config import BANK_ACCOUNT_NO, BANK_BRANCH, BANK_IFSC, BANK_NAME, BILL_TEMPLATE_PATH, SHOP_ADDRESS, SHOP_GSTIN, SHOP_NAME, STATE_CODE, STATE_NAME
from utils import format_date_for_pdf, format_invoice_no, rupees_in_words


TEMPLATE_SHEET_MAX_COL = 6
TEMPLATE_SHEET_MAX_ROW = 32


def _money(value: Any) -> str:
    try:
        return f"{float(value):,.2f}"
    except Exception:
        return "0.00"


def _qty(value: Any) -> str:
    try:
        num = float(value)
    except Exception:
        return ""
    if num == 0:
        return ""
    return f"{num:,.3f}".rstrip("0").rstrip(".")


def _rate(value: Any) -> str:
    try:
        return f"{float(value):,.2f}"
    except Exception:
        return ""


def _find_template_path() -> Path:
    configured = Path(BILL_TEMPLATE_PATH)
    if not configured.is_absolute():
        configured = Path(__file__).resolve().parent / configured

    template_path_candidates = (
        configured,
        Path(__file__).with_name("Billing Format.xlsx"),
        Path(r"C:\Users\Kotha Vitesh\Downloads\Billing Format.xlsx"),
    )
    for path in template_path_candidates:
        if path.exists():
            return path
    raise FileNotFoundError("Billing Format.xlsx template not found.")


def _load_template_sheet():
    workbook = load_workbook(_find_template_path())
    return workbook.active


def _column_widths(ws) -> List[float]:
    widths: List[float] = []
    for idx in range(1, TEMPLATE_SHEET_MAX_COL + 1):
        letter = chr(64 + idx)
        widths.append(float(ws.column_dimensions[letter].width or 10.0))
    return widths


def _row_heights(ws) -> List[float]:
    heights: List[float] = []
    for idx in range(1, TEMPLATE_SHEET_MAX_ROW + 1):
        heights.append(float(ws.row_dimensions[idx].height or 18.0))
    return heights


def _positions(lengths: Iterable[float], start: float, total_span: float) -> List[float]:
    source = list(lengths)
    scale = total_span / sum(source)
    result = [start]
    current = start
    for value in source:
        current += value * scale
        result.append(current)
    return result


def _merge_map(ws) -> Dict[str, Tuple[int, int, int, int]]:
    mapping: Dict[str, Tuple[int, int, int, int]] = {}
    for merged in ws.merged_cells.ranges:
        min_col, min_row, max_col, max_row = merged.bounds
        top_left = ws.cell(min_row, min_col).coordinate
        for row in range(min_row, max_row + 1):
            for col in range(min_col, max_col + 1):
                mapping[ws.cell(row, col).coordinate] = (min_row, min_col, max_row, max_col)
        mapping[top_left] = (min_row, min_col, max_row, max_col)
    return mapping


def _box_for(row: int, col: int, row_edges: List[float], col_edges: List[float], merge: Tuple[int, int, int, int] | None = None):
    min_row, min_col, max_row, max_col = merge or (row, col, row, col)
    left = col_edges[min_col - 1]
    right = col_edges[max_col]
    top = row_edges[min_row - 1]
    bottom = row_edges[max_row]
    return left, bottom, right, top


def _font_name(cell) -> str:
    return "Helvetica-Bold" if cell.font and cell.font.bold else "Helvetica"


def _font_size(cell) -> float:
    size = float(cell.font.sz or 10.0) if cell.font else 10.0
    return max(7.0, min(size, 14.0))


def _wrap_lines(text: str, font_name: str, font_size: float, max_width: float, allow_wrap: bool) -> List[str]:
    parts: List[str] = []
    for raw_line in str(text or "").splitlines() or [""]:
        if not allow_wrap:
            parts.append(raw_line)
            continue
        words = raw_line.split()
        if not words:
            parts.append("")
            continue
        line = words[0]
        for word in words[1:]:
            candidate = f"{line} {word}"
            if stringWidth(candidate, font_name, font_size) <= max_width:
                line = candidate
            else:
                parts.append(line)
                line = word
        parts.append(line)
    return parts


def _draw_text_in_box(c: canvas.Canvas, text: str, box, cell, padding: float = 3.5):
    if text in (None, ""):
        return

    left, bottom, right, top = box
    font_name = _font_name(cell)
    font_size = _font_size(cell)
    align = (cell.alignment.horizontal or "left") if cell.alignment else "left"
    vertical = (cell.alignment.vertical or "center") if cell.alignment else "center"
    max_width = max(10, right - left - (padding * 2))
    max_height = max(8, top - bottom - (padding * 2))
    allow_wrap = bool(getattr(cell.alignment, "wrap_text", False)) or ("\n" in str(text))

    lines: List[str] = []
    line_height = 0.0
    total_height = 0.0
    while font_size >= 6.0:
        lines = _wrap_lines(str(text), font_name, font_size, max_width, allow_wrap)
        widest = max((stringWidth(line, font_name, font_size) for line in lines), default=0)
        line_height = font_size * 1.15
        total_height = line_height * len(lines)
        if widest <= max_width and total_height <= max_height:
            break
        font_size -= 0.4

    if vertical == "top":
        y = top - padding - font_size
    elif vertical == "bottom":
        y = bottom + padding + total_height - line_height
    else:
        y = bottom + ((top - bottom) + total_height) / 2 - line_height

    c.setFont(font_name, font_size)
    for line in lines:
        width = stringWidth(line, font_name, font_size)
        if align == "center":
            x = left + (right - left - width) / 2
        elif align == "right":
            x = right - padding - width
        else:
            x = left + padding
        c.drawString(x, y, line)
        y -= line_height


def _draw_border_side(c: canvas.Canvas, side, x1: float, y1: float, x2: float, y2: float):
    if not side or not side.style:
        return

    if side.style == "double":
        line_width = 0.8
        offset = 1.1
        c.setLineWidth(line_width)
        if abs(y1 - y2) < 0.01:
            c.line(x1, y1 - offset, x2, y2 - offset)
            c.line(x1, y1 + offset, x2, y2 + offset)
        else:
            c.line(x1 - offset, y1, x2 - offset, y2)
            c.line(x1 + offset, y1, x2 + offset, y2)
        return

    widths = {
        "hair": 0.3,
        "thin": 0.6,
        "medium": 1.0,
        "thick": 1.4,
    }
    c.setLineWidth(widths.get(side.style, 0.6))
    c.line(x1, y1, x2, y2)


def _draw_borders(c: canvas.Canvas, ws, row_edges: List[float], col_edges: List[float]):
    merges = _merge_map(ws)

    def same_merged_block(row_a: int, col_a: int, row_b: int, col_b: int) -> bool:
        coord_a = ws.cell(row_a, col_a).coordinate
        coord_b = ws.cell(row_b, col_b).coordinate
        merge_a = merges.get(coord_a)
        merge_b = merges.get(coord_b)
        return merge_a is not None and merge_a == merge_b

    for row in range(1, TEMPLATE_SHEET_MAX_ROW + 1):
        for col in range(1, TEMPLATE_SHEET_MAX_COL + 1):
            cell = ws.cell(row, col)
            left, bottom, right, top = _box_for(row, col, row_edges, col_edges)
            if col == 1 or not same_merged_block(row, col, row, col - 1):
                _draw_border_side(c, cell.border.left, left, bottom, left, top)
            if col == TEMPLATE_SHEET_MAX_COL or not same_merged_block(row, col, row, col + 1):
                _draw_border_side(c, cell.border.right, right, bottom, right, top)
            if row == 1 or not same_merged_block(row, col, row - 1, col):
                _draw_border_side(c, cell.border.top, left, top, right, top)
            if row == TEMPLATE_SHEET_MAX_ROW or not same_merged_block(row, col, row + 1, col):
                _draw_border_side(c, cell.border.bottom, left, bottom, right, bottom)


def _amount_to_words_under_1000(value: int) -> str:
    ones = [
        "Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
        "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
        "Seventeen", "Eighteen", "Nineteen",
    ]
    tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"]

    if value < 20:
        return ones[value]
    if value < 100:
        return tens[value // 10] + ("" if value % 10 == 0 else f" {ones[value % 10]}")
    return f"{ones[value // 100]} Hundred" + ("" if value % 100 == 0 else f" {_amount_to_words_under_1000(value % 100)}")


def _amount_to_words(value: float) -> str:
    try:
        return rupees_in_words(float(value))
    except Exception:
        return ""


def _dynamic_cell_values(invoice: Dict[str, Any], items: List[Dict[str, Any]], last_page: bool) -> Dict[str, str]:
    invoice_no_text = invoice.get("invoice_no_text")
    if not invoice_no_text and invoice.get("invoice_no") is not None:
        try:
            invoice_no_text = format_invoice_no(int(invoice.get("invoice_no")))
        except Exception:
            invoice_no_text = str(invoice.get("invoice_no"))

    dynamic: Dict[str, str] = {
        "A8": f"M/s {str(invoice.get('customer_name') or '').strip()}",
        "F3": format_date_for_pdf(invoice["created_at"]) if invoice.get("created_at") else "",
        "F4": str(invoice_no_text or ""),
        "F5": STATE_NAME,
        "F6": str(STATE_CODE),
        "F8": str(invoice.get("party_gst_no") or "").strip(),
        "F9": "",
        "F10": "",
    }

    for idx, item in enumerate(items, start=12):
        dynamic[f"A{idx}"] = str(idx - 11)
        dynamic[f"B{idx}"] = str(item.get("particulars") or "")
        dynamic[f"C{idx}"] = str(item.get("hsn_code") or "")
        dynamic[f"D{idx}"] = _qty(item.get("qty_gms"))
        dynamic[f"E{idx}"] = _rate(item.get("rate_per_g"))
        dynamic[f"F{idx}"] = _money(item.get("invoice_amount", item.get("amount", 0)))

    if last_page:
        dynamic["B26"] = _amount_to_words(invoice.get("final_amount", 0))
        dynamic["F21"] = _money(invoice.get("total", 0))
        dynamic["F22"] = _money(invoice.get("cgst", 0))
        dynamic["F23"] = _money(invoice.get("sgst", 0))
        dynamic["F24"] = _money(invoice.get("igst", 0))
        dynamic["F25"] = _money(invoice.get("final_amount", 0))
        dynamic["B27"] = SHOP_NAME
        dynamic["B28"] = BANK_NAME
        dynamic["B29"] = BANK_BRANCH
        dynamic["B30"] = BANK_ACCOUNT_NO
        dynamic["B31"] = BANK_IFSC
    else:
        dynamic["B26"] = "Continued on next page..."

    return dynamic


def _draw_logo(c: canvas.Canvas, box):
    logo_path = os.path.join(os.path.dirname(__file__), "static", "images", "shop_logo.png")
    if not os.path.exists(logo_path):
        return
    try:
        img = ImageReader(logo_path)
        iw, ih = img.getSize()
        left, bottom, right, top = box
        target_h = min((top - bottom) - 10, 22 * mm)
        target_w = target_h * (iw / ih) if ih else target_h
        max_w = (right - left) - 6
        if target_w > max_w:
            target_w = max_w
            target_h = target_w * (ih / iw) if iw else target_w
        x = left + ((right - left) - target_w) / 2
        y = bottom + ((top - bottom) - target_h) / 2
        c.drawImage(img, x, y, width=target_w, height=target_h, preserveAspectRatio=True, mask="auto")
    except Exception:
        return


def _render_page(c: canvas.Canvas, ws, invoice: Dict[str, Any], items: List[Dict[str, Any]], last_page: bool):
    page_w, page_h = A4
    left_margin = 8 * mm
    right_margin = 8 * mm
    top_margin = 12 * mm
    bottom_margin = 10 * mm
    usable_w = page_w - left_margin - right_margin
    usable_h = page_h - top_margin - bottom_margin

    col_edges = _positions(_column_widths(ws), left_margin, usable_w)
    y_positions = _positions(_row_heights(ws), bottom_margin, usable_h)
    row_edges = [page_h - y for y in y_positions]

    c.setLineJoin(1)
    c.setLineCap(1)
    c.setStrokeColorRGB(0, 0, 0)
    c.setFillColorRGB(0, 0, 0)

    _draw_borders(c, ws, row_edges, col_edges)

    merges = _merge_map(ws)
    skip_rows = set() if last_page else set(range(21, 33))
    dynamic = _dynamic_cell_values(invoice, items, last_page)

    for row in range(1, TEMPLATE_SHEET_MAX_ROW + 1):
        for col in range(1, TEMPLATE_SHEET_MAX_COL + 1):
            cell = ws.cell(row, col)
            coord = cell.coordinate
            merge = merges.get(coord)
            if merge:
                min_row, min_col, _, _ = merge
                if row != min_row or col != min_col:
                    continue

            if row in skip_rows and coord not in dynamic:
                continue

            box = _box_for(row, col, row_edges, col_edges, merge)
            text = dynamic.get(coord, cell.value)
            _draw_text_in_box(c, text, box, cell)

    _draw_logo(c, _box_for(3, 1, row_edges, col_edges, (3, 1, 6, 1)))

    if not last_page:
        notice_box = _box_for(24, 1, row_edges, col_edges, (24, 1, 25, 6))
        temp_cell = ws["A24"]
        _draw_text_in_box(c, "Continued on next page", notice_box, temp_cell)


def generate_invoice_pdf_bytes(invoice: Dict[str, Any], shop_overrides: Dict[str, str] | None = None) -> bytes:
    ws = _load_template_sheet()
    items = list(invoice.get("items") or [])
    pages = [items[i:i + 9] for i in range(0, len(items), 9)] or [[]]

    buffer = BytesIO()
    c = canvas.Canvas(buffer, pagesize=A4)

    for idx, page_items in enumerate(pages):
        _render_page(c, ws, invoice, page_items, last_page=(idx == len(pages) - 1))
        c.showPage()

    c.save()
    buffer.seek(0)
    return buffer.read()
