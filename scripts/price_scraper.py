"""
جستجوی قیمت مواد اولیه در parsehshop.ir، digikala.com، bonakbazar.com و dastavval.com و ذخیره در اکسل.

استفاده:
    python price_scraper.py                       # لیست پیش‌فرض داخل اسکریپت
    python price_scraper.py آرد شکر "روغن مایع"    # لیست از خط فرمان
    python price_scraper.py -f items.txt -o out.xlsx
    python price_scraper.py --debug شکر            # پاسخ خام سایت‌ها در پوشه debug_raw

بدون مرورگر؛ فقط requests + BeautifulSoup + openpyxl.

ستون‌های اکسل: نام ماده، نام محصول، مقدار، واحد، قیمت (تومان)،
قیمت هر کیلو/لیتر (تومان)، سایت، لینک محصول.
وزن از عنوان محصول خوانده می‌شود (مثلاً «آرد ۱ کیلوگرمی» یا «روغن ۱/۵ لیتری»).
برگه دوم «مقایسه»: هر ماده یک ردیف، هر سایت یک ستون، قیمت به ریال به ازای هر گرم.
"""

import argparse
import json
import os
import re
import time
from urllib.parse import urljoin, urlsplit

import requests
from bs4 import BeautifulSoup
from openpyxl import Workbook
from openpyxl.comments import Comment
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


# ---------------------------------------------------------------- bonakbazar / dastavval
# ساختار جستجوی این دو سایت از بیرون ایران قابل بررسی نبود؛ پس چند آدرس جستجوی رایج
# امتحان می‌شود و پاسخ (JSON یا HTML) به چند روش عمومی خوانده می‌شود. اولین آدرسی که
# محصول برگرداند برای بقیه مواد همان سایت به خاطر سپرده می‌شود.
GENERIC_SITES = {
    "bonakbazar.com": {
        "key": "bonak",
        "searches": [
            ("https://mobile.bonakbazar.com/search", "q"),
            ("https://bonakbazar.com/search", "q"),
            ("https://bonakbazar.com/products", "search"),
            ("https://mobile.bonakbazar.com/products", "search"),
        ],
        "currency": "rial",   # صفحه‌های بنک‌بازار «قیمت واحد: ۴۲۰٬۰۰۰ ریال» (هر کیلو) نشان می‌دهند
        "product_url": "https://bonakbazar.com/products/{id}",
    },
    "dastavval.com": {
        "key": "dastavval",
        "searches": [
            ("https://www.dastavval.com/search", "q"),
            ("https://www.dastavval.com/", "s"),        # ووکامرس: ?s=...&post_type=product
            ("https://www.dastavval.com/search", "query"),
            ("https://www.dastavval.com/products", "search"),
        ],
        "currency": None,     # نامشخص؛ اگر واحد در متن نبود، مثل بقیه کد تومان فرض می‌شود
        "product_url": None,
    },
}
WORKING_SEARCH = {}  # سایت -> اندیس آدرس جستجویی که جواب داد

NAME_KEYS = ("title_fa", "name_fa", "fa_name", "persian_name", "title", "name", "product_name", "productName")
PRICE_KEYS = ("final_price", "selling_price", "sale_price", "special_price", "unit_price", "unitPrice",
              "price_amount", "price", "min_price", "minPrice", "lowPrice", "amount")
URL_KEYS = ("url", "link", "permalink", "href", "slug", "uri")
UNIT_KEYS = ("unit", "unit_title", "unitTitle", "unit_name", "unitName", "sale_unit", "saleUnit",
             "packaging", "package", "weight", "weight_title", "size")
CURRENCY_KEYS = ("currency", "price_currency", "priceCurrency", "currency_code", "currency_iso_code")
PRODUCT_LINK_RE = re.compile(r"/(?:products?|p|item|goods|kala)/", re.IGNORECASE)
# «۱۲۰,۰۰۰ تومان» -> («120,000»، «تومان»)؛ متن قبلاً به ارقام انگلیسی تبدیل شده
PRICE_AMOUNT_RE = re.compile(r"(\d{1,3}(?:[,٬،.]\d{3})+|\d{4,})\s*(ریال|تومان|﷼)")


def _number(value):
    """عدد قیمت از int/float/رشته/دیکشنری تودرتو ({"selling_price": ...} یا {"value": ...})."""
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return int(value) if value > 0 else None
    if isinstance(value, str):
        return to_int_price(value)
    if isinstance(value, dict):
        for key in PRICE_KEYS + ("value",):
            if key in value:
                found = _number(value[key])
                if found:
                    return found
    return None


def _unit_text(product):
    """متن واحد فروش (مثلاً «کیلوگرم» یا «کارتن ۱۶ کیلویی») برای خواندن وزن به‌جای عنوان."""
    parts = []
    for key in UNIT_KEYS:
        value = product.get(key)
        if isinstance(value, dict):
            value = next((value[k] for k in NAME_KEYS if isinstance(value.get(k), str)), None)
        if isinstance(value, (str, int, float)) and not isinstance(value, bool) and str(value).strip():
            parts.append(str(value).strip())
    text = " ".join(parts)
    if not text:
        return ""
    # «کیلوگرم» تنها یعنی «۱ کیلوگرم»
    if not re.search(r"\d", text.translate(PERSIAN_DIGITS)) and parse_weight("1 " + text)[0]:
        text = "1 " + text
    return text if parse_weight(text)[0] else ""


def candidates_from_json(data, site_currency=None, product_url=None, base_url=""):
    """
    هر دیکشنری JSON که نام + قیمت دارد یک محصول است (هر عمقی، هر ساختاری).
    واحد پول از فیلد currency یا رشته قیمت؛ وگرنه پیش‌فرض سایت.
    """
    found, seen = [], set()

    def walk(node):
        if isinstance(node, list):
            for child in node:
                walk(child)
            return
        if not isinstance(node, dict):
            return
        name = next((node[k] for k in NAME_KEYS if isinstance(node.get(k), str) and node[k].strip()), None)
        price_key = next((k for k in PRICE_KEYS if k in node and _number(node[k])), None)
        if name and price_key:
            raw = node[price_key]
            currency = detect_currency(*(node.get(k) for k in CURRENCY_KEYS), raw if isinstance(raw, str) else "")
            if currency is None and isinstance(node.get(price_key), dict):
                currency = detect_currency(*(node[price_key].get(k) for k in CURRENCY_KEYS))
            currency = currency or site_currency
            price = _number(raw)
            price = valid_price(price // 10 if currency == "rial" else price, name)
            url = next((node[k] for k in URL_KEYS if isinstance(node.get(k), str) and node[k]), "")
            if not url and product_url and node.get("id"):
                url = product_url.format(id=node["id"])
            title = " ".join(BeautifulSoup(name, "html.parser").get_text(" ").split())
            if price and (title, price) not in seen:
                seen.add((title, price))
                found.append({
                    "title": title,
                    "price": price,
                    "url": urljoin(base_url, url) if url else "",
                    "weight_text": _unit_text(node),
                })
            return  # داخل یک محصول (تنوع‌ها، ...) دوباره محصول جدا نمی‌شود
        for child in node.values():
            walk(child)

    walk(data)
    return found


def candidates_from_html(html, base_url, site_currency=None, product_url=None):
    """
    ۱) داده ساختاریافته JSON-LD (schema.org Product)
    ۲) JSON داخل صفحه (__NEXT_DATA__ و script های application/json)
    ۳) کارت‌ها: لینک محصول + نزدیک‌ترین متن قیمت‌دار (ریال/تومان)
    """
    soup = BeautifulSoup(html, "html.parser")
    found = []

    for script in soup.select('script[type="application/ld+json"]'):
        try:
            data = json.loads(script.string or "")
        except ValueError:
            continue
        for node in _iter_dicts(data):
            if node.get("@type") not in ("Product", ["Product"]):
                continue
            offers = node.get("offers") or {}
            offers = offers[0] if isinstance(offers, list) and offers else offers
            if not isinstance(offers, dict):
                continue
            currency = detect_currency(offers.get("priceCurrency")) or site_currency
            price = _number(offers.get("price") or offers.get("lowPrice"))
            price = valid_price(price // 10 if price and currency == "rial" else price, node.get("name"))
            if price and node.get("name"):
                found.append({"title": node["name"], "price": price,
                              "url": urljoin(base_url, node.get("url") or ""), "weight_text": ""})
    if found:
        return found

    for script in soup.select('script#__NEXT_DATA__, script[type="application/json"]'):
        try:
            data = json.loads(script.string or "")
        except ValueError:
            continue
        found += candidates_from_json(data, site_currency, product_url, base_url)
    if found:
        return found

    for old in soup.select("del, s, .old-price, .regular-price, .discount, .discount-percent"):
        old.decompose()
    seen = set()
    for link in soup.select("a[href]"):
        url = urljoin(base_url, link["href"])
        if url in seen or not PRODUCT_LINK_RE.search(urlsplit(url).path):
            continue
        container, price_match = link, None
        for _ in range(5):  # تا ۵ سطح بالاتر دنبال کارتی بگرد که قیمت دارد
            price_match = PRICE_AMOUNT_RE.search(container.get_text(" ", strip=True).translate(PERSIAN_DIGITS))
            if price_match or container.parent is None:
                break
            container = container.parent
        if not price_match:
            continue
        image = container.find("img", alt=True)
        heading = container.find(["h1", "h2", "h3", "h4"])
        title = (link.get("title") or link.get_text(" ", strip=True)
                 or (heading.get_text(" ", strip=True) if heading else "") or (image["alt"] if image else ""))
        # فقط عددی که درست کنار «ریال/تومان» آمده (نه وزن «۱ کیلو» در همان کارت)
        price = valid_price(price_to_toman(price_match.group(1), detect_currency(price_match.group(2))), title)
        if title and price:
            seen.add(url)
            found.append({"title": " ".join(title.split()), "price": price, "url": url, "weight_text": ""})
    return found


def _iter_dicts(node):
    if isinstance(node, dict):
        yield node
        for child in node.values():
            yield from _iter_dicts(child)
    elif isinstance(node, list):
        for child in node:
            yield from _iter_dicts(child)


def search_generic(site, query):
    """آدرس‌های جستجوی سایت را به ترتیب امتحان کن؛ اولین آدرسی که محصول داد به خاطر سپرده می‌شود."""
    conf = GENERIC_SITES[site]
    order = list(range(len(conf["searches"])))
    if site in WORKING_SEARCH:
        order = [WORKING_SEARCH[site]]
    last_error = None
    for i in order:
        url, param = conf["searches"][i]
        params = {param: query}
        if param == "s":
            params["post_type"] = "product"
        try:
            resp = session.get(url, params=params, timeout=TIMEOUT)
            resp.raise_for_status()
        except requests.RequestException as exc:
            last_error = exc
            continue
        debug_save(f"{conf['key']}_search_{i + 1}.txt", f"<!-- {resp.status_code} {resp.url} -->\n{resp.text}")
        try:
            candidates = candidates_from_json(resp.json(), conf["currency"], conf["product_url"], resp.url)
        except ValueError:
            candidates = candidates_from_html(resp.text, resp.url, conf["currency"], conf["product_url"])
        if candidates:
            if site not in WORKING_SEARCH:
                print(f"[{site}] جستجو با {url}?{param}=... جواب داد.")
            WORKING_SEARCH[site] = i
            debug_fetch(f"{conf['key']}_product.html", candidates[0]["url"])
            return candidates
        last_error = None
    if last_error and site not in WORKING_SEARCH:
        raise last_error
    return []


def search_bonakbazar(query):
    return search_generic("bonakbazar.com", query)


def search_dastavval(query):
    return search_generic("dastavval.com", query)


SITES = {
    "parsehshop.ir": search_parsehshop,
    "digikala.com": search_digikala,
    "bonakbazar.com": search_bonakbazar,
    "dastavval.com": search_dastavval,
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
            # اگر سایت واحد فروش جدا داده (مثلاً قیمت «هر کیلوگرم» در بنک‌بازار)، وزن از همان خوانده می‌شود
            qty, unit = parse_weight(result.get("weight_text") or result.get("title"))
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
                # ریال به ازای هر گرم (مایعات: هر میلی‌لیتر) برای برگه مقایسه
                "rial_per_gram": round(price * 10 / qty, 2) if per_unit else None,
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

    add_comparison_sheet(wb, rows)
    wb.save(path)


def add_comparison_sheet(wb, rows):
    """
    برگه «مقایسه»: هر ماده یک ردیف، هر سایت یک ستون، داخل خانه قیمت به ریال به ازای هر گرم
    (برای مایعات هر میلی‌لیتر). خانه به محصول لینک دارد و نام محصول به‌صورت یادداشت روی آن است؛
    ارزان‌ترین قیمت هر ردیف سبز می‌شود.
    """
    sites = list(dict.fromkeys(row["site"] for row in rows))
    items = list(dict.fromkeys(row["item"] for row in rows))
    by_key = {(row["item"], row["site"]): row for row in rows}

    ws = wb.create_sheet("مقایسه (ریال به ازای هر گرم)")
    ws.sheet_view.rightToLeft = True
    ws.append(["نام ماده"] + sites + ["ارزان‌ترین سایت"])
    for cell in ws[1]:
        cell.font = Font(bold=True, color="FFFFFF")
        cell.fill = PatternFill("solid", fgColor="4472C4")
        cell.alignment = Alignment(horizontal="center")
    ws.column_dimensions["A"].width = 24
    for idx in range(2, len(sites) + 3):
        ws.column_dimensions[ws.cell(row=1, column=idx).column_letter].width = 18
    ws.freeze_panes = "B2"

    for item in items:
        values = []
        for site in sites:
            row = by_key.get((item, site)) or {}
            values.append(row.get("rial_per_gram"))
        priced = [(v, site) for v, site in zip(values, sites) if v]
        cheapest = min(priced)[1] if priced else ""
        ws.append([item] + [v if v else "—" for v in values] + [cheapest])
        r = ws.max_row
        for col, (site, value) in enumerate(zip(sites, values), start=2):
            cell = ws.cell(row=r, column=col)
            cell.alignment = Alignment(horizontal="center")
            if not value:
                continue
            row = by_key[(item, site)]
            cell.number_format = "#,##0.00"
            cell.hyperlink = row["url"] or None
            cell.font = Font(color="0563C1", underline="single")
            unit = "میلی‌لیتر" if row["unit"] == "میلی‌لیتر" else "گرم"
            cell.comment = Comment(f"{row['title']}\n{row['price']:,} تومان / {row['qty']:g} {row['unit']}\n"
                                   f"ریال به ازای هر {unit}", "price_scraper")
            if site == cheapest:
                cell.fill = PatternFill("solid", fgColor="C6EFCE")

    ws.append([])
    ws.append(["قیمت‌ها به ریال به ازای هر گرم هستند (برای مایعات، هر میلی‌لیتر). «—» یعنی محصول مطابق "
               "پیدا نشد یا وزنش در عنوان نبود. نام محصول با بردن موس روی هر قیمت دیده می‌شود."])


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
