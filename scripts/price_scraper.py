"""
جستجوی قیمت مواد اولیه در parsehshop.ir و digikala.com و ذخیره در اکسل.

استفاده:
    python price_scraper.py                       # لیست پیش‌فرض داخل اسکریپت
    python price_scraper.py آرد شکر "روغن مایع"    # لیست از خط فرمان
    python price_scraper.py -f items.txt -o out.xlsx
    python price_scraper.py --debug شکر            # پاسخ خام سایت‌ها در پوشه debug_raw

بدون مرورگر؛ فقط requests + BeautifulSoup + openpyxl.

ستون‌های اکسل: نام ماده، نام محصول، مقدار، واحد، قیمت (تومان)،
قیمت هر کیلو/لیتر (تومان)، سایت، لینک محصول.
وزن از عنوان محصول خوانده می‌شود (مثلاً «آرد ۱ کیلوگرمی» یا «روغن ۱/۵ لیتری»).
"""

import argparse
import os
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

# با --debug پاسخ خام سایت‌ها برای اولین ماده در این پوشه ذخیره می‌شود
DEBUG_DIR = None
DEBUG_SAVED = set()


def debug_save(name, text):
    """اگر --debug فعال است، text را (فقط بار اول برای هر name) در DEBUG_DIR/name ذخیره کن."""
    if not DEBUG_DIR or name in DEBUG_SAVED:
        return
    os.makedirs(DEBUG_DIR, exist_ok=True)
    with open(os.path.join(DEBUG_DIR, name), "w", encoding="utf-8") as fh:
        fh.write(text)
    DEBUG_SAVED.add(name)
    print(f"[debug] {os.path.join(DEBUG_DIR, name)} ذخیره شد.")


def debug_fetch(name, url, **kwargs):
    """در حالت --debug صفحه/پاسخ url را بگیر و ذخیره کن؛ خطا اجرای اصلی را قطع نکند."""
    if not DEBUG_DIR or name in DEBUG_SAVED or not url:
        return
    try:
        resp = session.get(url, timeout=TIMEOUT, **kwargs)
        debug_save(name, f"<!-- {resp.status_code} {resp.url} -->\n{resp.text}")
    except requests.RequestException as exc:
        print(f"[debug] {url}: {exc}")


# عدد با جداکننده هزارگان (, ٬ ،) و اعشار اختیاری (. ٫)؛ یا هزارگان با نقطه (1.250.000)
DOT_THOUSANDS_RE = re.compile(r"\d{1,3}(?:[.٫]\d{3})+")
PRICE_NUMBER_RE = re.compile(
    r"\d{1,3}(?:[,٬،]\d{3})+(?:[.٫]\d+)?|" + DOT_THOUSANDS_RE.pattern + r"(?!\d)|\d+(?:[.٫]\d+)?"
)
MIN_PRICE = 1000  # قیمت کمتر از ۱۰۰۰ تومان قطعاً اشتباه خوانده شده


def to_int_price(text):
    """
    '۱۲۵,۰۰۰ تومان' -> 125000 ؛ اگر عددی نبود None.
    فقط اولین عدد (غیر از درصد تخفیف) خوانده می‌شود و اعشار دور ریخته می‌شود:
    '۲۰٪ ۱۲۵,۰۰۰ تومان' -> 125000 ؛ '۱۲۵٬۰۰۰٫۰۰' -> 125000 ؛ '1.250.000' -> 1250000.
    """
    if not text:
        return None
    text = text.translate(PERSIAN_DIGITS)
    for match in PRICE_NUMBER_RE.finditer(text):
        if re.match(r"\s*(?:[%٪]|درصد)", text[match.end():]):
            continue  # درصد تخفیف
        number = match.group()
        if not DOT_THOUSANDS_RE.fullmatch(number):
            number = re.split(r"[.٫]", number)[0]  # اعشار
        return int(re.sub(r"\D", "", number))
    return None


# ---------------------------------------------------------------- weight
# (الگوی واحد، ضریب تبدیل، واحد پایه) — داخل هر گروه، طولانی‌تر اول تا «کیلوگرم» با «گرم» اشتباه نشود
UNITS = [
    (r"کیلو\s*گرم|کیلو|kg", 1000, "گرم"),
    (r"میلی\s*گرم|mg", 0.001, "گرم"),
    (r"میلی\s*لیتر|سی\s*سی|ml|cc", 1, "میلی‌لیتر"),
    (r"گرم|gr|g", 1, "گرم"),
    (r"لیتر|lit", 1000, "میلی‌لیتر"),
]
NUMBER = r"(\d+(?:\.\d+)?)"
UNIT_RE = re.compile(
    NUMBER + r"\s*(?:" + "|".join(f"(?P<u{i}>{pattern})" for i, (pattern, _, _) in enumerate(UNITS)) + r")(?![a-z])"
)
# ضرب در تعداد فقط با الگوی صریح «۶ عدد × ۴۰۰ گرم» یا «۴۰۰ گرم × ۶ عدد»
PACK_RE = re.compile(r"(\d+)\s*عدد\S*\s*[×x*]\s*$|^\S*\s*[×x*]\s*(\d+)\s*عدد")


def parse_weight(title):
    """
    «شکر سفید ۹۰۰ گرمی» -> (900, 'گرم') ؛ «روغن ۱/۵ لیتری» -> (1500, 'میلی‌لیتر')
    «۶ عدد × ۲۰۰ گرم» -> (1200, 'گرم') ؛ «بسته ۶ عددی ۲۰۰ گرمی» -> (200, 'گرم')
    اگر وزن پیدا نشد (None, None).
    """
    if not title:
        return None, None
    text = title.translate(PERSIAN_DIGITS).replace("‌", " ").lower()
    # جداکننده هزارگان: ۱٬۰۰۰ و 1,500
    text = re.sub(r"(\d)[,٬،](?=\d{3}(?!\d))", r"\1", text)
    # اعشار فارسی: ۱/۵ و ۱٫۵ یعنی 1.5
    text = re.sub(r"(\d)\s*[/٫]\s*(\d)", r"\1.\2", text)
    match = UNIT_RE.search(text)  # اولین واحد به ترتیب متن
    if not match:
        return None, None
    index = next(i for i in range(len(UNITS)) if match.group(f"u{i}"))
    _, factor, base = UNITS[index]
    qty = float(match.group(1)) * factor
    pack = PACK_RE.search(text[:match.start()]) or PACK_RE.search(text[match.end():])
    if pack:
        count = int(pack.group(1) or pack.group(2))
        if count > 1:
            qty *= count
    return round(qty, 3), base


# ---------------------------------------------------------------- name matching
# کلماتی که در عنوان محصول «اضافه» حساب نمی‌شوند (وزن، بسته‌بندی، ...)
NOISE_WORDS = {
    "گرم", "گرمی", "کیلو", "کیلویی", "کیلوگرم", "کیلوگرمی", "لیتر", "لیتری", "میلی",
    "میلیلیتر", "میلیلیتری", "سی", "سیسی", "بسته", "عدد", "عددی", "بستهای", "پک",
    "ای", "وزن", "حجم", "مقدار", "حدود", "تقریبی", "g", "gr", "kg", "ml", "cc", "x",
}
WORD_SUFFIXES = ("", "ی", "ای", "یی", "ها", "های", "هایی")
# اگر این کلمات در عنوان باشند ولی در نام ماده نه، احتمالاً محصول چیز دیگری است
# (گوجه فرنگی ≠ سس گوجه فرنگی، سیب زمینی ≠ چیپس سیب زمینی)؛ رد نمی‌شود، فقط رتبه‌اش بدتر می‌شود.
# «پودر» و «دانه» عمداً نیستند: «پودر زردچوبه» و «فلفل سیاه دانه» همان ادویه‌اند.
NEGATIVE_WORDS = {"چیپس", "طعم", "اسانس", "عصاره", "پفک", "سس"}


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
    در غیر این صورت هرچه کمتر، بهتر: (تعداد کلمات منفی، پشت‌سرهم نیامدن، تعداد کلمات اضافه، اضافه‌ها، منفی‌ها).
    مثلاً برای «آرد»، «آرد ۱ کیلویی» از «آرد تمپورا» بهتر است.
    """
    q_words, t_words = normalize(query), normalize(title)
    if not q_words:
        return None
    negatives = [
        neg for neg in sorted(NEGATIVE_WORDS)
        if not any(word_matches(neg, qw) for qw in q_words) and any(word_matches(neg, tw) for tw in t_words)
    ]
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
    return (len(negatives), 0 if contiguous else 1, len(extras), extras, negatives)


def pick_best(query, candidates):
    """
    بهترین محصول از نظر تطابق نام؛ در تساوی، ترتیب خود سایت حفظ می‌شود.
    به محصول انتخاب‌شده کلید "match" اضافه می‌شود:
      «دقیق»                 همه کلمات پشت‌سرهم، بدون کلمه اضافه
      «دقیق (اضافه: لادن)»   همه کلمات پشت‌سرهم، فقط برند/صفت اضافه دارد
      «تقریبی (...)»          ترتیب کلمات فرق دارد یا کلمه منفی (سس، چیپس، ...) دارد
    و کلید "comparable": آیا قیمت هر کیلو برایش معنادار است (هر حالتی جز «تقریبی»).
    """
    scored = [(match_score(query, c["title"]), i, c) for i, c in enumerate(candidates)]
    scored = [s for s in scored if s[0] is not None]
    if not scored:
        return None
    (negatives, gap, _, extras, neg_words), _, best = min(scored, key=lambda s: (s[0][:3], s[1]))
    if negatives:
        match = f"تقریبی (کلمه منفی: {' '.join(neg_words)})"
    elif gap:
        match = "تقریبی (ترتیب کلمات فرق دارد)"
    elif extras:
        match = f"دقیق (اضافه: {' '.join(extras)})"
    else:
        match = "دقیق"
    return {**best, "match": match, "comparable": not negatives and not gap}


# ---------------------------------------------------------------- parsehshop
PARSEH_SEARCH = "https://parsehshop.ir/search"
PARSEH_DEBUG_FILE = "parseh_debug.html"


RIAL_RE = re.compile(r"ریال|﷼|\bIRR\b|\bRIAL\b", re.IGNORECASE)
TOMAN_RE = re.compile(r"تومان|\bIRT\b|\bTOMAN\b", re.IGNORECASE)
# در HTML پرستاشاپ: var prestashop = {..."currency":{..."iso_code":"IRR","sign":"﷼"...}}
PAGE_CURRENCY_RE = re.compile(r'"currency"\s*:\s*\{[^{}]*?"iso_code"\s*:\s*"([A-Za-z]{3})"')


def detect_currency(*texts):
    """'rial' یا 'toman' از روی اولین متنی که واحد پول در آن صریح آمده؛ وگرنه None."""
    for text in texts:
        text = str(text or "")
        if RIAL_RE.search(text):
            return "rial"
        if TOMAN_RE.search(text):
            return "toman"
    return None


def price_to_toman(text, currency=None):
    """
    '۱۲۵,۰۰۰ تومان' -> 125000 ؛ '۱,۲۵۰,۰۰۰ ریال' -> 125000.
    currency ('rial'/'toman') اگر داده شود بر متن مقدم است؛ اگر هیچ‌کدام نبود تومان فرض می‌شود.
    """
    price = to_int_price(str(text or ""))
    if price and (currency or detect_currency(text)) == "rial":
        price //= 10
    return price


def valid_price(price, title=""):
    """قیمت زیر MIN_PRICE تومان (مثلاً ۹۹ به‌جای ۹۹٬۰۰۰) کنار گذاشته می‌شود و هشدار چاپ می‌شود."""
    if price and price < MIN_PRICE:
        print(f"[هشدار] قیمت {price} تومان برای «{title}» نامعتبر است (کمتر از {MIN_PRICE:,}) و نادیده گرفته شد.")
        return None
    return price or None


def is_truthy_flag(value):
    return value not in (False, 0, "0", "", None)


def parseh_json_available(product):
    """
    کالای ناموجود پرستاشاپ. اگر فیلد availability هست فقط به آن تکیه می‌شود
    (در فروشگاهی که مدیریت موجودی خاموش است quantity همیشه ۰ است)؛
    وگرنه available_for_order. quantity عمداً بررسی نمی‌شود.
    """
    if product.get("availability"):
        return str(product["availability"]).lower() != "unavailable"
    if "available_for_order" in product:
        return is_truthy_flag(product["available_for_order"])
    return True


def parse_parseh_json(data):
    """
    پاسخ JSON جستجوی AJAX پرستاشاپ -> لیست محصولات موجود و قیمت‌دار.
    قیمت از price_amount (عدد خام) خوانده می‌شود، نه price (رشته فرمت‌شده)؛
    واحد پول از فیلد currency (اگر بود) یا از رشته price.
    """
    if not isinstance(data, dict):
        return []
    page_currency = data.get("currency")
    if isinstance(page_currency, dict):
        page_currency = page_currency.get("iso_code") or page_currency.get("sign")
    candidates = []
    for product in data.get("products") or []:
        if not isinstance(product, dict) or not parseh_json_available(product):
            continue
        formatted = str(product.get("price") or "")
        currency = detect_currency(product.get("currency_iso_code"), page_currency, formatted)
        amount = product.get("price_amount")
        if isinstance(amount, (int, float)) and amount > 0:
            price = int(amount) // 10 if currency == "rial" else int(amount)
        else:
            price = price_to_toman(formatted, currency)
        price = valid_price(price, product.get("name"))
        if price:
            candidates.append({
                "title": " ".join(BeautifulSoup(product.get("name") or "", "html.parser").get_text(" ").split()),
                "price": price,
                "url": product.get("url") or product.get("link") or "",
            })
    return candidates


UNAVAILABLE_SELECTORS = ".product-unavailable, .out-of-stock, .product-flag.out_of_stock"


def parse_parseh_html(html, base_url=PARSEH_SEARCH):
    """HTML صفحه جستجوی پرستاشاپ (قالب ۱.۷ و ۱.۶) -> لیست محصولات موجود و قیمت‌دار."""
    soup = BeautifulSoup(html, "html.parser")
    page_match = PAGE_CURRENCY_RE.search(html)
    page_currency = detect_currency(page_match.group(1)) if page_match else None
    cards = soup.select(
        "article.product-miniature, .js-product-miniature, "      # پرستاشاپ ۱.۷
        "ul.product_list li.ajax_block_product, .product-container"  # پرستاشاپ ۱.۶
    )
    candidates, seen = [], set()
    for card in cards:
        if card.select_one(UNAVAILABLE_SELECTORS) or "ناموجود" in card.get_text():
            continue
        # قیمت قدیمی خط‌خورده و درصد تخفیف نباید با قیمت فعلی قاطی شوند
        for old in card.select(".regular-price, .old-price, .discount, .discount-percentage, .price-percent-reduction"):
            old.decompose()
        price_el = first_match(
            card, ".product-price-and-shipping .price", "span.price", ".product-price", ".price"
        )
        if not price_el:
            continue
        currency = detect_currency(price_el.get_text(), price_el.parent.get_text() if price_el.parent else "") \
            or page_currency
        link = first_match(card, ".product-title a", "a.product-name", "h3 a", "h2 a", "a[href]")
        price = valid_price(price_to_toman(price_el.get_text(), currency), link.get_text(strip=True) if link else "")
        if not price:
            continue  # بدون قیمت
        url = urljoin(base_url, link["href"]) if link and link.get("href") else ""
        if url in seen:  # کارت‌های تودرتو (article + .product-container) تکراری نشوند
            continue
        seen.add(url)
        candidates.append({
            "title": (link.get("title") or link.get_text(" ", strip=True)) if link else "",
            "price": price,
            "url": url,
        })
    return candidates


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
    debug_save("parseh_search.json", resp.text)
    try:
        candidates = parse_parseh_json(resp.json())
    except ValueError:
        candidates = []
    if candidates:
        debug_fetch("parseh_search.html", PARSEH_SEARCH, params=params)
        debug_fetch("parseh_product.html", candidates[0]["url"])
        return candidates

    # ۲) HTML
    resp = session.get(PARSEH_SEARCH, params=params, timeout=TIMEOUT)
    resp.raise_for_status()
    debug_save("parseh_search.html", resp.text)
    candidates = parse_parseh_html(resp.text, resp.url)
    if candidates:
        debug_fetch("parseh_product.html", candidates[0]["url"])

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
    debug_save("digikala_search.json", resp.text)
    candidates = parse_digikala_json(resp.json())
    if candidates:
        dkp = re.search(r"dkp-(\d+)", candidates[0]["url"])
        if dkp:
            debug_fetch("digikala_product.json", f"https://api.digikala.com/v2/product/{dkp.group(1)}/")
    return candidates


def parse_digikala_json(data):
    """پاسخ API جستجوی دیجی‌کالا -> لیست محصولات قیمت‌دار (قیمت API ریال است -> تومان)."""
    candidates = []
    data = (data.get("data") if isinstance(data, dict) else None) or {}
    for product in data.get("products") or []:
        if not isinstance(product, dict):
            continue
        variant = product.get("default_variant") or {}
        if not isinstance(variant, dict):
            continue
        price = (variant.get("price") or {}).get("selling_price")
        price = valid_price(int(price) // 10, product.get("title_fa")) if price else None
        if not price:
            continue
        uri = (product.get("url") or {}).get("uri") or f"/product/dkp-{product.get('id')}/"
        candidates.append({
            "title": product.get("title_fa") or "",
            "price": price,
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
            # قیمت هر کیلو/لیتر به تومان (قیمت ÷ مقدار به گرم/میلی‌لیتر × ۱۰۰۰)؛
            # برای تطابق تقریبی خالی می‌ماند چون ممکن است محصول دیگری باشد
            per_unit = round(price * 1000 / qty) if price and qty and result.get("comparable") else None
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
                label += f"  |  {qty:g} {unit}  |  هر {PER_UNIT_LABEL[unit]} {per_unit:,} تومان"
            if result.get("match"):
                label += f"  |  {result['title']}  [{result['match']}]"
            print(f"{item:<15} {site:<15} {label}")
            if result.get("url"):
                print(f"{'':<15} {result['url']}")
            time.sleep(DELAY)
    return rows


PER_UNIT_LABEL = {"گرم": "کیلو", "میلی‌لیتر": "لیتر"}

COLUMNS = [
    ("نام ماده", 20),
    ("نام محصول", 45),
    ("تطابق نام", 24),
    ("مقدار", 10),
    ("واحد", 11),
    ("قیمت (تومان)", 15),
    ("قیمت هر کیلو/لیتر (تومان)", 26),
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
            ws.cell(row=r, column=7).number_format = "#,##0"
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
    parser.add_argument(
        "--debug", nargs="?", const="debug_raw", metavar="DIR",
        help="پاسخ خام JSON/HTML سایت‌ها برای اولین ماده را در این پوشه ذخیره کن (پیش‌فرض debug_raw)",
    )
    args = parser.parse_args()
    global DEBUG_DIR
    DEBUG_DIR = args.debug

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
