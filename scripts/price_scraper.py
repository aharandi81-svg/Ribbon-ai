"""
جستجوی قیمت مواد اولیه در parsehshop.ir و digikala.com و ذخیره در اکسل.

استفاده:
    python price_scraper.py                       # لیست پیش‌فرض داخل اسکریپت
    python price_scraper.py آرد شکر "روغن مایع"    # لیست از خط فرمان
    python price_scraper.py -f items.txt -o out.xlsx

بدون مرورگر؛ فقط requests + BeautifulSoup + openpyxl.

ستون‌های اکسل: نام ماده، نام محصول، مقدار، واحد، قیمت (تومان)،
قیمت هر گرم/میلی‌لیتر (ریال)، سایت، لینک محصول.
وزن از عنوان محصول خوانده می‌شود (مثلاً «آرد ۱ کیلوگرمی» یا «روغن ۱/۵ لیتری»).
"""

import argparse
import re
import time
from urllib.parse import urljoin

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


# ---------------------------------------------------------------- weight
# (الگوی واحد، ضریب تبدیل، واحد پایه) — واحدهای طولانی‌تر اول، تا «کیلوگرم» با «گرم» اشتباه نشود
UNITS = [
    (r"کیلو\s*گرم|کیلو|kg", 1000, "گرم"),
    (r"میلی\s*گرم|mg", 0.001, "گرم"),
    (r"گرم|gr|g", 1, "گرم"),
    (r"میلی\s*لیتر|سی\s*سی|ml|cc", 1, "میلی‌لیتر"),
    (r"لیتر|lit", 1000, "میلی‌لیتر"),
]
NUMBER = r"(\d+(?:\.\d+)?)"
PACK_RE = re.compile(r"(\d+)\s*عدد")


def parse_weight(title):
    """
    «شکر سفید ۹۰۰ گرمی» -> (900, 'گرم') ؛ «روغن ۱/۵ لیتری» -> (1500, 'میلی‌لیتر')
    «بسته ۶ عددی ۲۰۰ گرمی» -> (1200, 'گرم') ؛ اگر وزن پیدا نشد (None, None).
    """
    if not title:
        return None, None
    text = title.translate(PERSIAN_DIGITS).replace("‌", " ").lower()
    # اعشار فارسی: ۱/۵ و ۱٫۵ یعنی 1.5
    text = re.sub(r"(\d)\s*[/٫]\s*(\d)", r"\1.\2", text)
    for pattern, factor, base in UNITS:
        match = re.search(NUMBER + r"\s*(?:" + pattern + r")(?![a-z])", text)
        if match:
            qty = float(match.group(1)) * factor
            pack = PACK_RE.search(text)
            if pack and int(pack.group(1)) > 1:
                qty *= int(pack.group(1))
            return round(qty, 3), base
    return None, None


# ---------------------------------------------------------------- parsehshop
def search_parsehshop(query):
    """
    parsehshop.ir روی ووکامرس است؛ جستجو با ?s=...&post_type=product.
    اگر فقط یک نتیجه باشد ووکامرس مستقیم به صفحه محصول ریدایرکت می‌کند،
    پس هر دو حالت (لیست نتایج / صفحه محصول) پوشش داده شده.
    خروجی: {"title", "price" (تومان), "url"} یا None.
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
    url = None
    if container is not None:
        link = container.select_one("a.woocommerce-LoopProduct-link, a[href]")
        url = urljoin(resp.url, link["href"]) if link else None
        title_el = container.select_one(
            ".woocommerce-loop-product__title, h2, h3, .product-title"
        )
    else:
        # حالت ۲: صفحه تکی محصول
        container = soup.select_one(".summary, .product .entry-summary, div.product")
        if container is None:
            return None
        url = resp.url
        title_el = soup.select_one("h1.product_title, h1")

    price_el = container.select_one(".price")
    if price_el is None:
        return None
    # اگر تخفیف دارد، قیمت جدید داخل <ins> است
    amount = price_el.select_one("ins .amount") or price_el.select_one(".amount") or price_el
    return {
        "title": title_el.get_text(strip=True) if title_el else "",
        "price": to_int_price(amount.get_text()),
        "url": url,
    }


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
        if not isinstance(variant, dict):
            continue
        price = (variant.get("price") or {}).get("selling_price")
        if not price:
            continue
        uri = (product.get("url") or {}).get("uri") or f"/product/dkp-{product.get('id')}/"
        return {
            "title": product.get("title_fa") or "",
            "price": int(price) // 10,
            "url": urljoin("https://www.digikala.com", uri),
        }
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
                result = search(item)
            except (requests.RequestException, ValueError) as exc:
                print(f"[خطا] {site} / {item}: {exc}")
                result = None
            result = result or {}
            price = result.get("price")
            qty, unit = parse_weight(result.get("title"))
            # قیمت هر گرم به ریال (قیمت تومان × ۱۰ ÷ مقدار)
            per_unit = round(price * 10 / qty, 1) if price and qty else None
            rows.append({
                "item": item,
                "title": result.get("title") or "",
                "qty": qty,
                "unit": unit,
                "price": price,
                "per_unit": per_unit,
                "site": site,
                "url": result.get("url") or "",
            })
            label = f"{price:,} تومان" if price else "پیدا نشد"
            if per_unit:
                label += f"  |  {qty:g} {unit}  |  هر {unit} {per_unit:,} ریال"
            print(f"{item:<15} {site:<15} {label}")
            if result.get("url"):
                print(f"{'':<15} {result['url']}")
            time.sleep(DELAY)
    return rows


COLUMNS = [
    ("نام ماده", 20),
    ("نام محصول", 45),
    ("مقدار", 10),
    ("واحد", 11),
    ("قیمت (تومان)", 15),
    ("قیمت هر گرم/میلی‌لیتر (ریال)", 26),
    ("سایت", 15),
    ("لینک محصول", 50),
]


def save_excel(rows, path):
    wb = Workbook()
    ws = wb.active
    ws.title = "قیمت‌ها"
    ws.sheet_view.rightToLeft = True

    ws.append([name for name, _ in COLUMNS])
    for cell in ws[1]:
        cell.font = Font(bold=True, color="FFFFFF")
        cell.fill = PatternFill("solid", fgColor="4472C4")
        cell.alignment = Alignment(horizontal="center")
    for idx, (_, width) in enumerate(COLUMNS, start=1):
        ws.column_dimensions[ws.cell(row=1, column=idx).column_letter].width = width

    for row in rows:
        ws.append([
            row["item"],
            row["title"],
            row["qty"] if row["qty"] else "نامشخص",
            row["unit"] or "",
            row["price"] if row["price"] else "پیدا نشد",
            row["per_unit"] if row["per_unit"] else "",
            row["site"],
            row["url"],
        ])
        r = ws.max_row
        if row["price"]:
            ws.cell(row=r, column=5).number_format = "#,##0"
        if row["per_unit"]:
            ws.cell(row=r, column=6).number_format = "#,##0.0"
        if row["url"]:
            link = ws.cell(row=r, column=8)
            link.hyperlink = row["url"]
            link.style = "Hyperlink"

    wb.save(path)


def main():
    parser = argparse.ArgumentParser(description="استخراج قیمت مواد اولیه")
    parser.add_argument("items", nargs="*", help="نام مواد اولیه")
    parser.add_argument("-f", "--file", help="فایل متنی؛ هر خط یک ماده")
    parser.add_argument("-o", "--output", default="prices.xlsx", help="فایل اکسل خروجی")
    args = parser.parse_args()

    items = list(args.items)
    if args.file:
        with open(args.file, encoding="utf-8-sig") as fh:
            items += [line.strip() for line in fh if line.strip()]
    if not items:
        items = DEFAULT_ITEMS

    rows = collect(items)
    save_excel(rows, args.output)
    print(f"\nذخیره شد: {args.output}")


if __name__ == "__main__":
    main()
