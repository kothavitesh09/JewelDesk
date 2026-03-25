import re
from datetime import datetime, timezone


def utcnow():
    return datetime.now(timezone.utc)


def format_date_for_pdf(dt: datetime) -> str:
    # Example: 23/03/26 (matches the printed bill style more closely)
    return dt.strftime("%d/%m/%y")


def format_date_for_ui(dt: datetime) -> str:
    # Example: 23-03-2026 14:35
    return dt.strftime("%Y-%m-%d %H:%M")


def safe_float(v, default=None):
    try:
        if v is None:
            return default
        if isinstance(v, str):
            v = v.strip()
            if not v:
                return default
        return float(v)
    except Exception:
        return default


def parse_hsn(value: str) -> str:
    # Keep as string; allow user input like "12" or "0123"
    if value is None:
        return ""
    s = str(value).strip()
    # HSN is numeric, but keep leading zeros if user provided them.
    s = re.sub(r"[^0-9]", "", s)
    return s


def indian_number_to_words(n: int) -> str:
    """
    Convert integer n into Indian-style words.
    Supports up to trillions safely for invoice use-cases.
    """

    if n == 0:
        return "Zero"

    ones = [
        "",
        "One",
        "Two",
        "Three",
        "Four",
        "Five",
        "Six",
        "Seven",
        "Eight",
        "Nine",
    ]
    teens = [
        "Ten",
        "Eleven",
        "Twelve",
        "Thirteen",
        "Fourteen",
        "Fifteen",
        "Sixteen",
        "Seventeen",
        "Eighteen",
        "Nineteen",
    ]
    tens = [
        "",
        "",
        "Twenty",
        "Thirty",
        "Forty",
        "Fifty",
        "Sixty",
        "Seventy",
        "Eighty",
        "Ninety",
    ]

    def two_digit_words(x: int) -> str:
        if x < 10:
            return ones[x]
        if 10 <= x < 20:
            return teens[x - 10]
        t = x // 10
        o = x % 10
        if o == 0:
            return tens[t]
        return f"{tens[t]} {ones[o]}".strip()

    def three_digit_words(x: int) -> str:
        h = x // 100
        r = x % 100
        if h == 0:
            return two_digit_words(r)
        if r == 0:
            return f"{ones[h]} Hundred"
        return f"{ones[h]} Hundred {two_digit_words(r)}".strip()

    parts = []

    trillions = n // 10**12
    if trillions:
        parts.append(f"{three_digit_words(trillions)} Trillion")
        n %= 10**12

    billions = n // 10**9
    if billions:
        parts.append(f"{three_digit_words(billions)} Billion")
        n %= 10**9

    lakhs = n // 10**5
    if lakhs:
        parts.append(f"{three_digit_words(lakhs)} Lakh")
        n %= 10**5

    thousands = n // 10**3
    if thousands:
        parts.append(f"{three_digit_words(thousands)} Thousand")
        n %= 10**3

    if n:
        parts.append(three_digit_words(n))

    return " ".join([p for p in parts if p]).strip()


def rupees_in_words(amount: float) -> str:
    """
    Example:
      1234.56 -> "Rupees One Thousand Two Hundred Thirty Four And Paise Fifty Six Only"
    """

    if amount is None:
        amount = 0.0
    amount = float(amount)
    if amount < 0:
        amount = abs(amount)

    rupees = int(amount)
    paise = int(round((amount - rupees) * 100))

    rupees_words = indian_number_to_words(rupees)
    if paise == 0:
        return f"Rupees {rupees_words} Only"
    paise_words = indian_number_to_words(paise)
    return f"Rupees {rupees_words} And Paise {paise_words} Only"


def format_invoice_no(seq: int) -> str:
    # Common counter style; easy to print/read.
    return f"{seq:06d}"

