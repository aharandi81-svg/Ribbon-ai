"""
جستجوی قیمت مواد اولیه در parsehshop.ir و digikala.com و ذخیره در اکسل.

استفاده:
    python price_scraper.py                       # لیست پیش‌فرض داخل اسکریپت
    python price_scraper.py آرد شکر "روغن مایع"    # لیست از خط فرمان
    python price_scraper.py -f items.txt -o out.xlsx

بدون مرورگر؛ فقط requests + BeautifulSoup + openpyxl.
"""

import argparse
import re
import time

import requests
from bs4 import BeautifulSoup
from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill

DEFAULT_ITEMS = ["آرد", "شکر", "روغن مایع", "بکینگ پودر", "وانیل"]

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    ),
    "Accept-Language": "fa-IR,fa;q=0.9,en;q=0.8",
}
TIMEOUT = 20
DELAY = 1.5  # مکث بین درخواست‌ها (ثانیه) تا سایت‌ها بلاک نکنند

PERSIAN_DIGITS = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")

session = requests.Session()
session.headers.update(HEADERS)


def to_int_price(text):
    """'۱۲۵,۰۰۰ تومان' -> 125000 ؛ اگر عددی نبود None."""
    if not text:
        return None
    digits = re.sub(r"\D", "", text.translate(PERSIAN_DIGITS))
    return int(digits) if digits else None


# ---------------------------------------------------------------- parsehshop
def search_parsehshop(query):
    """
    parsehshop.ir روی ووکامرس است؛ جستجو با ?s=...&post_type=product.
    اگر فقط یک نتیجه باشد ووکامرس مستقیم به صفحه محصول ریدایرکت می‌کند،
    پس هر دو حالت (لیست نتایج / صفحه محصول) پوشش داده شده.
    خروجی: قیمت به تومان یا None.
    """
    resp = session.get(
        "https://parsehshop.ir/",
        params={"s": query, "post_type": "product"},
        timeout=TIMEOUT,
    )
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")

    # حالت ۱: لیست نتایج -> اولین محصول
    container = soup.select_one("ul.products li.product, .products .product")
    # حالت ۲: صفحه تکی محصول
    if container is None:
        container = soup.select_one(".summary, .product .entry-summary, div.product")
    if container is None:
        return None

    price_el = container.select_one(".price")
    if price_el is None:
        return None
    # اگر تخفیف دارد، قیمت جدید داخل <ins> است
    amount = price_el.select_one("ins .amount") or price_el.select_one(".amount") or price_el
    return to_int_price(amount.get_text())


# ---------------------------------------------------------------- digikala
def search_digikala(query):
    """
    صفحه جستجوی دیجی‌کالا با جاوااسکریپت رندر می‌شود و HTML خامش قیمت ندارد،
    پس از همان API عمومی‌ای استفاده می‌کنیم که خود سایت صدا می‌زند (JSON).
    قیمت API به ریال است؛ به تومان تبدیل می‌شود.
    """
    resp = session.get(
        "https://api.digikala.com/v1/search/",
        params={"q": query, "page": 1},
        timeout=TIMEOUT,
    )
    resp.raise_for_status()
    products = resp.json().get("data", {}).get("products", [])
    for product in products:  # اولین نتیجه‌ای که قیمت دارد (ناموجودها قیمت ندارند)
        variant = product.get("default_variant") or {}
        if isinstance(variant, dict):
            price = (variant.get("price") or {}).get("selling_price")
            if price:
                return int(price) // 10
    return None


SITES = {
    "parsehshop.ir": search_parsehshop,
    "digikala.com": search_digikala,
}


def collect(items):
    rows = []
    for item in items:
        for site, search in SITES.items():
            try:
                price = search(item)
            except (requests.RequestException, ValueError) as exc:
                print(f"[خطا] {site} / {item}: {exc}")
                price = None
            label = f"{price:,}" if price else "پیدا نشد"
            print(f"{item:<20} {site:<15} {label}")
            rows.append((item, price, site))
            time.sleep(DELAY)
    return rows


def save_excel(rows, path):
    wb = Workbook()
    ws = wb.active
    ws.title = "قیمت‌ها"
    ws.sheet_view.rightToLeft = True

    ws.append(["نام ماده", "قیمت (تومان)", "سایت"])
    for cell in ws[1]:
        cell.font = Font(bold=True, color="FFFFFF")
        cell.fill = PatternFill("solid", fgColor="4472C4")
        cell.alignment = Alignment(horizontal="center")

    for name, price, site in rows:
        ws.append([name, price if price else "پیدا نشد", site])
        if price:
            ws.cell(row=ws.max_row, column=2).number_format = "#,##0"

    ws.column_dimensions["A"].width = 25
    ws.column_dimensions["B"].width = 18
    ws.column_dimensions["C"].width = 18
    wb.save(path)


def main():
    parser = argparse.ArgumentParser(description="استخراج قیمت مواد اولیه")
    parser.add_argument("items", nargs="*", help="نام مواد اولیه")
    parser.add_argument("-f", "--file", help="فایل متنی؛ هر خط یک ماده")
    parser.add_argument("-o", "--output", default="prices.xlsx", help="فایل اکسل خروجی")
    args = parser.parse_args()

    items = list(args.items)
    if args.file:
        with open(args.file, encoding="utf-8") as fh:
            items += [line.strip() for line in fh if line.strip()]
    if not items:
        items = DEFAULT_ITEMS

    rows = collect(items)
    save_excel(rows, args.output)
    print(f"\nذخیره شد: {args.output}")


if __name__ == "__main__":
    main()
