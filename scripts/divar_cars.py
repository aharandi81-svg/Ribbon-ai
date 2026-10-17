"""
آگهی‌های خودروی دیوار تهران با قیمت مشخص در بازه قیمت -> CSV + نمایشگر HTML زنده.

استفاده:
    python divar_cars.py --serve          # جمع‌آوری + باز شدن نمایشگر در مرورگر (حالت run_divar_cars.bat)
    python divar_cars.py --view-only      # فقط نمایش نتایج قبلی (حالت view_cars.bat)
    python divar_cars.py --lan --password 1234 --every-hours 6
                                          # سرور شبکه: همه کامپیوترهای شبکه نمایشگر را می‌بینند،
                                          # هر ۶ ساعت آگهی‌های جدید اضافه می‌شود (حالت run_divar_server.bat)
    python divar_cars.py                  # فقط جمع‌آوری
    python divar_cars.py --min-rial 8000000000 --max-rial 15000000000
    python divar_cars.py --limit 30       # توقف بعد از ۳۰ آگهی جدید (پیش‌فرض: بدون محدودیت)

بدون مرورگر برای جمع‌آوری؛ فقط requests + BeautifulSoup.

- فقط شهر تهران و دسته «سواری و وانت» (light).
- فقط آگهی‌های قیمت‌دار بین ۵٬۰۰۰٬۰۰۰٬۰۰۰ و ۲۰٬۰۰۰٬۰۰۰٬۰۰۰ ریال («توافقی» حذف).
- هر آگهی به محض پیدا شدن (با جزئیاتش) به divar_cars.csv اضافه می‌شود، پس نمایشگر
  همان لحظه نتیجه را نشان می‌دهد و اگر وسط کار قطع شود چیزی از دست نمی‌رود.
- اجرای دوباره آگهی‌هایی را که قبلاً در CSV هست تکرار نمی‌کند و فقط جدیدها را اضافه می‌کند.
- ستون‌های عددی (قیمت، سال، کارکرد) تمیز ذخیره می‌شوند تا برای رگرسیون قیمت آماده باشند.
"""

import argparse
import base64
import csv
import hmac
import io
import json
import os
import re
import socket
import threading
import time
import webbrowser
from datetime import datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

import requests
from bs4 import BeautifulSoup

TEHRAN_CITY_ID = "1"
CATEGORY = "light"  # سواری و وانت
SEARCH_API = "https://api.divar.ir/v8/postlist/w/search"
POST_API = "https://api.divar.ir/v8/posts-v2/web/{token}"
POST_URL = "https://divar.ir/v/{token}"
LIST_PAGE = "https://divar.ir/s/tehran/car"

HERE = os.path.dirname(os.path.abspath(__file__))
CSV_NAME = "divar_cars.csv"
VIEWER_NAME = "divar_viewer.html"
PORT = 8765

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    ),
    "Accept-Language": "fa-IR,fa;q=0.9,en;q=0.8",
    "Origin": "https://divar.ir",
    "Referer": "https://divar.ir/",
}
TIMEOUT = 20
DELAY = 1.5  # مکث بین درخواست‌ها (ثانیه) تا دیوار بلاک نکند

PERSIAN_DIGITS = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")

session = requests.Session()
session.headers.update(HEADERS)


def to_int(text):
    """'۸۵۰٬۰۰۰٬۰۰۰ تومان' -> 850000000 ؛ اگر عددی نبود None."""
    if not text:
        return None
    digits = re.sub(r"\D", "", str(text).translate(PERSIAN_DIGITS))
    return int(digits) if digits else None


def price_from_texts(*texts):
    """از بین متن‌های کارت آگهی، متنی که «تومان» دارد قیمت است؛ «توافقی» یعنی بدون قیمت."""
    for text in texts:
        if text and "تومان" in text:
            return to_int(text)
    return None


def parse_mileage(text):
    """'۱۲۰٬۰۰۰' یا '۱۲۰ هزار کیلومتر' -> 120000 ؛ 'صفر' / 'کارکرد صفر' -> 0."""
    if not text:
        return None
    text = str(text).translate(PERSIAN_DIGITS)
    if "صفر" in text and not re.search(r"\d", text):
        return 0
    match = re.search(r"\d[\d,٬]*", text)
    if not match:
        return None
    number = int(re.sub(r"\D", "", match.group()))
    return number * 1000 if "هزار" in text else number


def parse_year(text):
    """'۱۳۹۸' -> 1398 ؛ 'قبل از ۱۳۶۶' -> 1366 ؛ '2019' -> 2019."""
    match = re.search(r"\d{4}", str(text or "").translate(PERSIAN_DIGITS))
    return int(match.group()) if match else None


# ---------------------------------------------------------------- لیست آگهی‌ها
def search_body(min_toman, max_toman, pagination_data=None):
    body = {
        "city_ids": [TEHRAN_CITY_ID],
        "source_view": "CATEGORY",
        "search_data": {
            "form_data": {
                "data": {
                    "category": {"str": {"value": CATEGORY}},
                    "price": {"number_range": {"minimum": str(min_toman), "maximum": str(max_toman)}},
                }
            }
        },
    }
    if pagination_data:
        body["pagination_data"] = pagination_data
    return body


def parse_post_rows(data):
    """ویجت‌های POST_ROW پاسخ API -> لیست آگهی."""
    posts = []
    for widget in data.get("list_widgets") or []:
        if widget.get("widget_type") != "POST_ROW":
            continue
        w = widget.get("data") or {}
        token = w.get("token") or ((w.get("action") or {}).get("payload") or {}).get("token")
        if not token:
            continue
        top = w.get("top_description_text") or ""
        middle = w.get("middle_description_text") or ""
        bottom = w.get("bottom_description_text") or ""
        posts.append({
            "token": token,
            "title": w.get("title") or "",
            "price": price_from_texts(middle, top, bottom),
            "list_mileage": top if "کیلومتر" in top else "",
            "place": bottom,
        })
    return posts


def iter_list_api(min_toman, max_toman, max_pages):
    """صفحه به صفحه آگهی‌ها را برمی‌گرداند (generator)، تا هر آگهی فوراً پردازش شود."""
    pagination = None
    for page in range(1, max_pages + 1):
        resp = session.post(SEARCH_API, json=search_body(min_toman, max_toman, pagination), timeout=TIMEOUT)
        resp.raise_for_status()
        data = resp.json()
        rows = parse_post_rows(data)
        print(f"\n--- صفحه {page}: {len(rows)} آگهی ---")
        if not rows:
            return
        yield from rows
        pagination = data.get("pagination", {}).get("data")
        if not pagination or data.get("pagination", {}).get("has_next_page") is False:
            return
        time.sleep(DELAY)


def iter_posts(min_toman, max_toman, max_pages):
    """
    اول API (همه صفحات)؛ اگر همان درخواست اول رد شد، صفحه HTML.
    اگر وسط کار خطا داد، خطا به بالا می‌رود تا آگهی‌های ذخیره‌شده حفظ شوند.
    """
    got_any = False
    try:
        for post in iter_list_api(min_toman, max_toman, max_pages):
            got_any = True
            yield post
    except (requests.RequestException, ValueError) as exc:
        if got_any:
            raise
        print(f"[API دیوار جواب نداد: {exc}] — خواندن صفحه HTML (فقط صفحه اول)...")
        yield from fetch_list_html(min_toman, max_toman)


def fetch_list_html(min_toman, max_toman):
    """اگر API جواب نداد: صفحه HTML دیوار (فقط صفحه اول، چون بقیه با جاوااسکریپت می‌آید)."""
    resp = session.get(LIST_PAGE, params={"price": f"{min_toman}-{max_toman}"}, timeout=TIMEOUT)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")
    posts = []
    for card in soup.select("article.kt-post-card, div.kt-post-card"):
        link = card.find("a", href=re.compile(r"/v/")) or card.find_parent("a", href=re.compile(r"/v/"))
        if link is None:
            continue
        title_el = card.select_one(".kt-post-card__title, h2")
        texts = [d.get_text(" ", strip=True) for d in
                 card.select(".kt-post-card__description, .kt-post-card__bottom-description")]
        posts.append({
            "token": link["href"].rstrip("/").split("/")[-1],
            "title": title_el.get_text(strip=True) if title_el else "",
            "price": price_from_texts(*texts),
            "list_mileage": next((t for t in texts if "کیلومتر" in t), ""),
            "place": texts[-1] if texts else "",
        })
    return posts


# ---------------------------------------------------------------- جزئیات آگهی
def walk_fields(node, fields, description, in_description=False):
    """
    هر جای JSON که جفت title/value بود یک فیلد است (کارکرد، مدل، رنگ، گیربکس، ...).
    متن توضیحات از ویجت DESCRIPTION_ROW یا هر متنی داخل بخش DESCRIPTION جمع می‌شود.
    """
    if isinstance(node, dict):
        in_description = in_description or node.get("section_name") == "DESCRIPTION"
        title, value = node.get("title"), node.get("value")
        if isinstance(title, str) and isinstance(value, str) and title.strip() and value.strip():
            fields.setdefault(title.strip(), value.strip())
        data = node.get("data") if isinstance(node.get("data"), dict) else {}
        text = data.get("text") or (node.get("text") if in_description else None)
        if isinstance(text, str) and text.strip() and (
            node.get("widget_type") == "DESCRIPTION_ROW" or in_description
        ):
            description.append(text.strip())
        for child in node.values():
            walk_fields(child, fields, description, in_description)
    elif isinstance(node, list):
        for child in node:
            walk_fields(child, fields, description, in_description)


def description_from_html(token):
    """اگر API توضیحات نداد: خود صفحه آگهی در divar.ir/v/... (متن توضیحات یا meta description)."""
    resp = session.get(POST_URL.format(token=token), timeout=TIMEOUT)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")
    el = soup.select_one(".kt-description-row__text, [class*=description-row__text]")
    if el and el.get_text(strip=True):
        return el.get_text("\n", strip=True)
    meta = soup.select_one('meta[name="description"], meta[property="og:description"]')
    return (meta.get("content") or "").strip() if meta else ""


def fetch_details(token):
    """-> (فیلدهای title/value، متن توضیحات)"""
    fields, description = {}, []
    try:
        resp = session.get(POST_API.format(token=token), timeout=TIMEOUT)
        resp.raise_for_status()
        data = resp.json()
        walk_fields(data.get("sections") or data, fields, description)
        if not description:
            seo_desc = (data.get("seo") or {}).get("description")
            if seo_desc:
                description.append(seo_desc)
    except (requests.RequestException, ValueError) as exc:
        print(f"  [API جزئیات جواب نداد: {exc}] — خواندن توضیحات از صفحه آگهی")
    if not description:
        try:
            html_desc = description_from_html(token)
            if html_desc:
                description.append(html_desc)
        except requests.RequestException as exc:
            print(f"  [صفحه آگهی باز نشد: {exc}]")
    return fields, "\n".join(dict.fromkeys(description))  # بدون متن تکراری


# ---------------------------------------------------------------- ردیف CSV
COLUMNS = [
    "token", "عنوان", "لینک", "قیمت (تومان)", "قیمت (ریال)",
    "برند و تیپ", "سال تولید", "سال (عدد)", "کارکرد", "کارکرد (کیلومتر)",
    "رنگ", "نوع سوخت", "گیربکس", "وضعیت موتور", "وضعیت شاسی", "وضعیت بدنه",
    "بیمه شخص ثالث", "معاوضه", "زمان و محله", "توضیحات", "سایر مشخصات", "زمان ثبت",
]
# فیلد دیوار -> ستون CSV (با کلمه کلیدی، چون عنوان‌ها کمی فرق می‌کنند: «شاسی جلو»، «مهلت بیمهٔ ...»)
FIELD_KEYWORDS = [
    ("برند", "برند و تیپ"), ("سال", "سال تولید"), ("کارکرد", "کارکرد"), ("رنگ", "رنگ"),
    ("سوخت", "نوع سوخت"), ("گیربکس", "گیربکس"), ("موتور", "وضعیت موتور"),
    ("شاسی", "وضعیت شاسی"), ("بدنه", "وضعیت بدنه"), ("بیمه", "بیمه شخص ثالث"),
    ("معاوضه", "معاوضه"),
]


def build_row(post, fields, description):
    row = dict.fromkeys(COLUMNS, "")
    row.update({
        "token": post["token"],
        "عنوان": post["title"],
        "لینک": POST_URL.format(token=post["token"]),
        "قیمت (تومان)": post["price"],
        "قیمت (ریال)": post["price"] * 10,
        "زمان و محله": post["place"],
        "توضیحات": description,
        "زمان ثبت": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
    })
    other = {}
    for name, value in fields.items():
        column = next((col for key, col in FIELD_KEYWORDS if key in name), None)
        if column is None:
            other[name] = value
        elif row[column]:
            row[column] += f" | {name}: {value}"  # مثلاً شاسی جلو + شاسی عقب
        else:
            row[column] = value if column != "وضعیت شاسی" else f"{name}: {value}"
    if not row["کارکرد"]:
        row["کارکرد"] = post["list_mileage"]
    row["کارکرد (کیلومتر)"] = parse_mileage(row["کارکرد"])
    row["سال (عدد)"] = parse_year(row["سال تولید"])
    row["سایر مشخصات"] = json.dumps(other, ensure_ascii=False) if other else ""
    for key, value in row.items():  # برای CSV: None -> خالی
        if value is None:
            row[key] = ""
    return row


# ---------------------------------------------------------------- CSV
class CsvStore:
    """
    هر ردیف به محض آماده شدن با یک write به انتهای فایل اضافه و flush می‌شود.
    اگر فایل در اکسل باز و قفل باشد، ردیف‌ها در حافظه می‌مانند و دفعه بعد نوشته می‌شوند.
    """

    def __init__(self, path):
        self.path = path
        self.pending = []
        self.tokens = set()
        if os.path.exists(path):
            with open(path, encoding="utf-8-sig", newline="") as fh:
                reader = csv.DictReader(fh)
                if reader.fieldnames != COLUMNS:
                    fh.close()
                    backup = path.replace(".csv", f".old-{datetime.now():%Y%m%d-%H%M%S}.csv")
                    os.replace(path, backup)
                    print(f"ستون‌های CSV قبلی فرق داشت؛ فایل قبلی به {os.path.basename(backup)} منتقل شد.")
                else:
                    self.tokens = {r["token"] for r in reader if r.get("token")}
        if not os.path.exists(path):
            with open(path, "w", encoding="utf-8-sig", newline="") as fh:  # BOM تا اکسل فارسی را درست نشان دهد
                csv.writer(fh).writerow(COLUMNS)

    def add(self, row):
        self.tokens.add(row["token"])
        self.pending.append(row)
        self.flush()

    def flush(self):
        if not self.pending:
            return True
        buf = io.StringIO()
        writer = csv.DictWriter(buf, fieldnames=COLUMNS)
        writer.writerows(self.pending)
        try:
            with open(self.path, "a", encoding="utf-8", newline="") as fh:
                fh.write(buf.getvalue())
                fh.flush()
        except PermissionError:
            print(f"  [فایل {os.path.basename(self.path)} قفل است (احتمالاً در اکسل باز است)؛ "
                  f"{len(self.pending)} ردیف بعداً نوشته می‌شود. برای دیدن زنده از نمایشگر استفاده کنید.]")
            return False
        self.pending.clear()
        return True


# ---------------------------------------------------------------- نمایشگر
class ViewerHandler(BaseHTTPRequestHandler):
    """
    فقط دو فایل سرو می‌شود: صفحه نمایشگر و CSV (نه کل پوشه)، چون در حالت شبکه
    کامپیوترهای دیگر هم به آن دسترسی دارند. اگر رمز تنظیم شده باشد، ورود لازم است.
    """
    files = {}      # مسیر URL -> (مسیر فایل، content-type)
    password = None

    def do_GET(self):
        if self.password and not self._authorized():
            self.send_response(401)
            self.send_header("WWW-Authenticate", 'Basic realm="divar", charset="UTF-8"')
            self.end_headers()
            return
        path = urlsplit(self.path).path
        if path == "/":
            self.send_response(302)
            self.send_header("Location", "/" + VIEWER_NAME)
            self.end_headers()
            return
        if path not in self.files:
            self.send_error(404)
            return
        file_path, content_type = self.files[path]
        try:
            with open(file_path, "rb") as fh:
                body = fh.read()
        except FileNotFoundError:
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")  # همیشه آخرین نسخه CSV
        self.end_headers()
        self.wfile.write(body)

    def _authorized(self):
        header = self.headers.get("Authorization", "")
        if not header.startswith("Basic "):
            return False
        try:
            _, _, given = base64.b64decode(header[6:]).partition(b":")
        except ValueError:
            return False
        # مقایسه بایت‌ها (رمز فارسی هم کار می‌کند؛ مرورگرها رمز را UTF-8 می‌فرستند)
        return hmac.compare_digest(given, self.password.encode("utf-8"))

    def log_message(self, *args):
        pass


def lan_ip():
    """IP این کامپیوتر در شبکه داخلی (بسته‌ای واقعاً ارسال نمی‌شود)."""
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
        try:
            s.connect(("10.255.255.255", 1))
            return s.getsockname()[0]
        except OSError:
            return socket.gethostbyname(socket.gethostname())


def start_viewer(csv_path, lan=False, password=None):
    ViewerHandler.files = {
        "/" + VIEWER_NAME: (os.path.join(HERE, VIEWER_NAME), "text/html; charset=utf-8"),
        "/" + CSV_NAME: (csv_path, "text/csv; charset=utf-8"),
    }
    ViewerHandler.password = password
    host = "0.0.0.0" if lan else "127.0.0.1"
    for port in range(PORT, PORT + 20):
        try:
            server = ThreadingHTTPServer((host, port), ViewerHandler)
            break
        except OSError:
            continue
    else:
        print("[پورت آزاد برای نمایشگر پیدا نشد]")
        return None
    threading.Thread(target=server.serve_forever, daemon=True).start()
    local_url = f"http://127.0.0.1:{port}/{VIEWER_NAME}"
    print(f"نمایشگر روی همین کامپیوتر: {local_url}")
    if lan:
        print("=" * 60)
        print(f"  آدرس برای بقیه کامپیوترهای شبکه:  http://{lan_ip()}:{port}")
        print("  (اگر ویندوز پیام فایروال داد، «Allow access» را بزنید)")
        print(f"  رمز ورود: {'فعال' if password else 'ندارد — هر کسی در شبکه می‌تواند ببیند'}")
        print("=" * 60)
    webbrowser.open(local_url)
    return server


def wait_for_exit():
    try:
        input("\nنمایشگر هنوز باز است. برای بستن Enter بزنید (یا پنجره را ببندید)...")
    except (EOFError, KeyboardInterrupt):
        pass


# ---------------------------------------------------------------- اجرا
def scrape(args, store):
    """یک دور جمع‌آوری؛ هر آگهی جدید همان لحظه در CSV نوشته می‌شود."""
    min_toman, max_toman = args.min_rial // 10, args.max_rial // 10
    print(f"\n[{datetime.now():%Y-%m-%d %H:%M}] بازه قیمت: {args.min_rial:,} تا {args.max_rial:,} ریال | "
          f"{len(store.tokens)} آگهی از قبل در CSV هست")
    added = skipped = 0
    try:
        for post in iter_posts(min_toman, max_toman, args.max_pages):
            price = post["price"]
            if not price or not (min_toman <= price <= max_toman):
                continue  # توافقی یا خارج از بازه (حتی اگر فیلتر سایت اعمال نشده باشد)
            if post["token"] in store.tokens:
                skipped += 1
                continue
            fields, description = ({}, "") if args.no_details else fetch_details(post["token"])
            row = build_row(post, fields, description)
            store.add(row)
            added += 1
            print(f"{added}. {row['عنوان']}  |  {price:,} تومان  |  "
                  f"{row['سال تولید'] or '-'}  |  {row['کارکرد'] or '-'}  |  {row['لینک']}")
            if args.limit and added >= args.limit:
                break
            if not args.no_details:
                time.sleep(DELAY)
    except (requests.RequestException, ValueError) as exc:
        print(f"\n[خطا هنگام خواندن صفحه بعدی: {exc}] — آگهی‌های تا اینجا ذخیره شده‌اند.")
    print(f"\n{added} آگهی جدید اضافه شد، {skipped} آگهی تکراری رد شد. فایل: {args.output}")


def save_pending(store, output):
    if store.flush():
        return
    fallback = output.replace(".csv", "-pending.csv")
    with open(fallback, "w", encoding="utf-8-sig", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=COLUMNS)
        writer.writeheader()
        writer.writerows(store.pending)
    print(f"فایل اصلی قفل بود؛ ردیف‌های باقیمانده در {os.path.basename(fallback)} ذخیره شد.")


def main():
    parser = argparse.ArgumentParser(description="خودروهای دیوار تهران در بازه قیمت -> CSV")
    parser.add_argument("--min-rial", type=int, default=5_000_000_000, help="کف قیمت به ریال")
    parser.add_argument("--max-rial", type=int, default=20_000_000_000, help="سقف قیمت به ریال")
    parser.add_argument("--limit", type=int, default=0, help="توقف بعد از این تعداد آگهی جدید (۰ یعنی بدون محدودیت)")
    parser.add_argument("--max-pages", type=int, default=200, help="حداکثر صفحات لیست (هر صفحه حدود ۲۰ آگهی)")
    parser.add_argument("--no-details", action="store_true", help="جزئیات و توضیحات خوانده نشود (سریع‌تر)")
    parser.add_argument("--serve", action="store_true", help="نمایشگر HTML را هم باز کن")
    parser.add_argument("--view-only", action="store_true", help="فقط نمایشگر؛ بدون جمع‌آوری")
    parser.add_argument("--lan", action="store_true", help="نمایشگر برای همه کامپیوترهای شبکه داخلی (به‌جای فقط همین کامپیوتر)")
    parser.add_argument("--password", default=os.environ.get("DIVAR_VIEWER_PASSWORD"),
                        help="رمز ورود نمایشگر (یا متغیر محیطی DIVAR_VIEWER_PASSWORD)")
    parser.add_argument("--every-hours", type=float, default=0,
                        help="جمع‌آوری را هر چند ساعت یک بار تکرار کن (۰ یعنی فقط یک بار)")
    parser.add_argument("-o", "--output", default=os.path.join(HERE, CSV_NAME), help="فایل CSV")
    args = parser.parse_args()

    if args.view_only:
        if start_viewer(args.output, args.lan, args.password):
            wait_for_exit()
        return

    store = CsvStore(args.output)
    server = start_viewer(args.output, args.lan, args.password) if (args.serve or args.lan) else None
    try:
        while True:
            scrape(args, store)
            save_pending(store, args.output)
            if not args.every_hours:
                break
            next_run = datetime.now() + timedelta(hours=args.every_hours)
            print(f"دور بعدی جمع‌آوری: {next_run:%H:%M} (برای توقف Ctrl+C یا بستن پنجره)")
            time.sleep(args.every_hours * 3600)
    except KeyboardInterrupt:
        print("\nمتوقف شد (Ctrl+C). آگهی‌های تا اینجا ذخیره شده‌اند.")
        save_pending(store, args.output)
        return
    if server:
        wait_for_exit()


if __name__ == "__main__":
    main()
