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


# ---------------------------------------------------------------- name matching
# کلماتی که در عنوان محصول «اضافه» حساب نمی‌شوند (وزن، بسته‌بندی، ...)
NOISE_WORDS = {
    "گرم", "گرمی", "کیلو", "کیلویی", "کیلوگرم", "کیلوگرمی", "لیتر", "لیتری", "میلی",
    "میلیلیتر", "میلیلیتری", "سی", "سیسی", "بسته", "عدد", "عددی", "بستهای", "پک",
    "ای", "وزن", "حجم", "مقدار", "حدود", "تقریبی", "g", "gr", "kg", "ml", "cc", "x",
}
WORD_SUFFIXES = ("", "ی", "ای", "یی", "ها", "های", "هایی")


def normalize(text):
    """یکسان‌سازی حروف و ارقام عربی/فارسی، نیم‌فاصله و علائم، برای مقایسه نام‌ها."""
    text = (text or "").translate(PERSIAN_DIGITS).lower()
    text = text.translate(str.maketrans({"ي": "ی", "ك": "ک", "ة": "ه", "ۀ": "ه", "أ": "ا", "إ": "ا", "ؤ": "و"}))
    text = text.replace("ئی", "یی").replace("ئ", "ی")
    text = re.sub(r"[ً-ٰٟـ]", "", text)  # اعراب و کشیده
    text = text.replace("‌", " ")
    return re.sub(r"[^\w/]+", " ", text).split()


def word_matches(query_word, title_word):
    """«پلو» با «پلویی» یا «دکمه» با «دکمه‌ای» یکی حساب می‌شود، اما «خیار» با «خیارشور» نه."""
    return any(title_word == query_word + suffix for suffix in WORD_SUFFIXES)


def match_score(query, title):
    """
    None اگر همه کلمات نام ماده در عنوان محصول نباشد.
    در غیر این صورت هرچه کمتر، بهتر: (پشت‌سرهم نیامدن، تعداد کلمات اضافه).
    مثلاً برای «آرد»، «آرد ۱ کیلویی» از «آرد تمپورا» بهتر است.
    """
    q_words, t_words = normalize(query), normalize(title)
    if not q_words:
        return None
    positions = []
    for qw in q_words:
        hits = [i for i, tw in enumerate(t_words) if word_matches(qw, tw) and i not in positions]
        if not hits:
            return None
        positions.append(hits[0])
    contiguous = positions == list(range(positions[0], positions[0] + len(positions)))
    extras = [
        tw for i, tw in enumerate(t_words)
        if i not in positions and tw not in NOISE_WORDS and not re.fullmatch(r"[\d/.]+[a-z]*", tw)
    ]
    return (0 if contiguous else 1, len(extras), extras)


def pick_best(query, candidates):
    """
    بهترین محصول از نظر تطابق نام؛ در تساوی، ترتیب خود سایت حفظ می‌شود.
    به محصول انتخاب‌شده کلید "match" اضافه می‌شود: «دقیق» یا «تقریبی (اضافه: ...)».
    """
    scored = [(match_score(query, c["title"]), i, c) for i, c in enumerate(candidates)]
    scored = [s for s in scored if s[0] is not None]
    if not scored:
        return None
    (gap, _, extras), _, best = min(scored, key=lambda s: (s[0][:2], s[1]))
    if not gap and not extras:
        match = "دقیق"
    else:
        match = "تقریبی" + (f" (اضافه: {' '.join(extras)})" if extras else " (ترتیب کلمات فرق دارد)")
    return {**best, "match": match}


# ---------------------------------------------------------------- parsehshop
PARSEH_SEARCH = "https://parsehshop.ir/search"
PARSEH_DEBUG_FILE = "parseh_debug.html"


def price_to_toman(text):
    """'۱۲۵,۰۰۰ تومان' -> 125000 ؛ اگر واحد «ریال» بود تقسیم بر ۱۰."""
    price = to_int_price(text)
    if price and "ریال" in text:
        price //= 10
    return price


def first_match(node, *selectors):
    """اولین selector که جواب داد (به ترتیب اولویت، نه ترتیب در صفحه)."""
    for selector in selectors:
        found = node.select_one(selector)
        if found is not None:
            return found
    return None


def search_parsehshop(query):
    """
    parsehshop.ir روی پرستاشاپ (PrestaShop) است، نه ووکامرس.
    ۱) اول جستجوی AJAX پرستاشاپ ۱.۷ که JSON برمی‌گرداند (مطمئن‌ترین راه).
    ۲) اگر JSON نبود، HTML صفحه جستجو با BeautifulSoup خوانده می‌شود
       (قالب‌های پرستاشاپ ۱.۷ و ۱.۶).
    اگر هیچ محصولی پیدا نشد، HTML صفحه در parseh_debug.html ذخیره می‌شود تا بررسی شود.
    خروجی: لیست محصولات قیمت‌دار [{"title", "price" (تومان), "url"}, ...]
    """
    params = {"controller": "search", "s": query, "search_query": query}

    # ۱) JSON
    resp = session.get(
        PARSEH_SEARCH,
        params={**params, "ajax": 1, "resultsPerPage": 50},
        headers={"X-Requested-With": "XMLHttpRequest", "Accept": "application/json"},
        timeout=TIMEOUT,
    )
    resp.raise_for_status()
    try:
        products = resp.json().get("products") or []
    except ValueError:
        products = []
    candidates = []
    for product in products:
        price = price_to_toman(str(product.get("price") or ""))
        if price:
            candidates.append({
                "title": " ".join(BeautifulSoup(product.get("name") or "", "html.parser").get_text(" ").split()),
                "price": price,
                "url": product.get("url") or product.get("link") or "",
            })
    if candidates:
        return candidates

    # ۲) HTML
    resp = session.get(PARSEH_SEARCH, params=params, timeout=TIMEOUT)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")
    cards = soup.select(
        "article.product-miniature, .js-product-miniature, "      # پرستاشاپ ۱.۷
        "ul.product_list li.ajax_block_product, .product-container"  # پرستاشاپ ۱.۶
    )
    seen = set()
    for card in cards:
        price_el = first_match(
            card, ".product-price-and-shipping .price", "span.price", ".product-price", ".price"
        )
        price = price_to_toman(price_el.get_text()) if price_el else None
        if not price:
            continue  # ناموجود / بدون قیمت
        link = first_match(card, ".product-title a", "a.product-name", "h3 a", "h2 a", "a[href]")
        url = urljoin(resp.url, link["href"]) if link and link.get("href") else ""
        if url in seen:  # کارت‌های تودرتو (article + .product-container) تکراری نشوند
            continue
        seen.add(url)
        candidates.append({
            "title": (link.get("title") or link.get_text(" ", strip=True)) if link else "",
            "price": price,
            "url": url,
        })

    if not candidates:
        with open(PARSEH_DEBUG_FILE, "w", encoding="utf-8") as fh:
            fh.write(resp.text)
        print(f"[parsehshop] محصولی برای «{query}» پیدا نشد؛ HTML صفحه در {PARSEH_DEBUG_FILE} ذخیره شد.")
    return candidates


# ---------------------------------------------------------------- digikala
def search_digikala(query):
    """
    صفحه جستجوی دیجی‌کالا با جاوااسکریپت رندر می‌شود و HTML خامش قیمت ندارد،
    پس از همان API عمومی‌ای استفاده می‌کنیم که خود سایت صدا می‌زند (JSON).
    قیمت API به ریال است؛ به تومان تبدیل می‌شود.
    خروجی: لیست محصولات قیمت‌دار (ناموجودها قیمت ندارند و حذف می‌شوند).
    """
    resp = session.get(
        "https://api.digikala.com/v1/search/",
        params={"q": query, "page": 1},
        timeout=TIMEOUT,
    )
    resp.raise_for_status()
    candidates = []
    for product in resp.json().get("data", {}).get("products", []):
        variant = product.get("default_variant") or {}
        if not isinstance(variant, dict):
            continue
        price = (variant.get("price") or {}).get("selling_price")
        if not price:
            continue
        uri = (product.get("url") or {}).get("uri") or f"/product/dkp-{product.get('id')}/"
        candidates.append({
            "title": product.get("title_fa") or "",
            "price": int(price) // 10,
            "url": urljoin("https://www.digikala.com", uri),
        })
    return candidates


SITES = {
    "parsehshop.ir": search_parsehshop,
    "digikala.com": search_digikala,
}


def collect(items):
    rows = []
    for item in items:
        for site, search in SITES.items():
            try:
                candidates = search(item)
            except (requests.RequestException, ValueError) as exc:
                print(f"[خطا] {site} / {item}: {exc}")
                candidates = []
            result = pick_best(item, candidates) or {}
            price = result.get("price")
            qty, unit = parse_weight(result.get("title"))
            # قیمت هر گرم به ریال (قیمت تومان × ۱۰ ÷ مقدار)
            per_unit = round(price * 10 / qty, 1) if price and qty else None
            rows.append({
                "item": item,
                "title": result.get("title") or "",
                "match": result.get("match") or "",
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
            if result.get("match"):
                label += f"  |  {result['title']}  [{result['match']}]"
            print(f"{item:<15} {site:<15} {label}")
            if result.get("url"):
                print(f"{'':<15} {result['url']}")
            time.sleep(DELAY)
    return rows


COLUMNS = [
    ("نام ماده", 20),
    ("نام محصول", 45),
    ("تطابق نام", 24),
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
            row["match"],
            row["qty"] if row["qty"] else "نامشخص",
            row["unit"] or "",
            row["price"] if row["price"] else "پیدا نشد",
            row["per_unit"] if row["per_unit"] else "",
            row["site"],
            row["url"],
        ])
        r = ws.max_row
        if row["price"]:
            ws.cell(row=r, column=6).number_format = "#,##0"
        if row["per_unit"]:
            ws.cell(row=r, column=7).number_format = "#,##0.0"
        if row["match"].startswith("تقریبی"):
            ws.cell(row=r, column=3).fill = PatternFill("solid", fgColor="FFF2CC")
        if row["url"]:
            link = ws.cell(row=r, column=9)
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
