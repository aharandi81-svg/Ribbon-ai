"""تست‌های واحد پارس قیمت/وزن/تطبیق نام در price_scraper (بدون شبکه).

اجرا:  python -m pytest scripts/tests
"""

import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import price_scraper as ps  # noqa: E402


# ---------------------------------------------------------------- to_int_price (۱)
@pytest.mark.parametrize("text, expected", [
    ("۱۲۵,۰۰۰ تومان", 125000),
    ("۲۰٪ ۱۲۵,۰۰۰ تومان", 125000),            # درصد تخفیف قاطی نشود
    ("-20% 125,000 تومان", 125000),
    ("۱۲۵,۰۰۰ ۱۰۰,۰۰۰ تومان", 125000),        # فقط اولین عدد
    ("۱۲۵٬۰۰۰٫۰۰", 125000),                    # اعشار دور ریخته شود
    ("125,000.00 تومان", 125000),
    ("١٢٥٬٠٠٠ تومان", 125000),                  # ارقام عربی
    ("125000", 125000),
    ("ناموجود", None),
    ("", None),
    (None, None),
])
def test_to_int_price(text, expected):
    assert ps.to_int_price(text) == expected


# ---------------------------------------------------------------- currency (۲)
@pytest.mark.parametrize("text, currency, expected", [
    ("۱,۲۵۰,۰۰۰ ریال", None, 125000),
    ("1,250,000 ﷼", None, 125000),
    ("1,250,000 IRR", None, 125000),
    ("۱۲۵,۰۰۰ تومان", None, 125000),
    ("1,250,000", "rial", 125000),             # واحد صریح بر متن مقدم است
    ("125,000", "toman", 125000),
])
def test_price_to_toman(text, currency, expected):
    assert ps.price_to_toman(text, currency) == expected


# ---------------------------------------------------------------- parse_weight (۳، ۴)
@pytest.mark.parametrize("title, expected", [
    ("شکر سفید ۹۰۰ گرمی", (900, "گرم")),
    ("روغن ۱/۵ لیتری", (1500, "میلی‌لیتر")),
    ("آرد ۱ کیلوگرمی", (1000, "گرم")),
    ("برنج ۱۰ کیلویی", (10000, "گرم")),
    ("زعفران ۵۰۰ میلی گرم", (0.5, "گرم")),
    ("۱٬۰۰۰ گرمی", (1000, "گرم")),            # جداکننده هزارگان
    ("شیر 1,500 میلی لیتر", (1500, "میلی‌لیتر")),
    ("بسته ۶ عددی ۴۰۰ گرمی", (400, "گرم")),    # بدون × ضرب نشود
    ("نوشابه ۳۰۰ میلی لیتر بسته ۶ عددی", (300, "میلی‌لیتر")),
    ("۶ عدد × ۴۰۰ گرم", (2400, "گرم")),        # الگوی صریح
    ("۴۰۰ گرمی × ۶ عدد", (2400, "گرم")),
    ("۲ کیلو و ۵۰۰ گرم", (2000, "گرم")),       # اولین واحد به ترتیب متن
    ("قند", (None, None)),
    ("", (None, None)),
])
def test_parse_weight(title, expected):
    assert ps.parse_weight(title) == expected


# ---------------------------------------------------------------- name matching (۵)
@pytest.mark.parametrize("query, title", [
    ("کرفس", "دانه کرفس ۱۰۰ گرمی"),
    ("پیاز", "پودر پیاز ۸۰ گرمی"),
    ("سیب زمینی", "چیپس سیب زمینی"),
    ("لیمو", "اسانس لیمو"),
])
def test_negative_words_reject(query, title):
    assert ps.match_score(query, title) is None


def test_negative_word_in_query_is_allowed():
    assert ps.match_score("پودر پیاز", "پودر پیاز ۸۰ گرمی") is not None
    assert ps.match_score("بکینگ پودر", "بکینگ پودر ۵۰۰ گرمی") is not None


def test_pick_best_prefers_exact():
    best = ps.pick_best("کرفس", [
        {"title": "دانه کرفس ۱۰۰ گرمی", "price": 1, "url": "a"},
        {"title": "کرفس ۵۰۰ گرمی", "price": 2, "url": "b"},
    ])
    assert best["url"] == "b" and best["match"] == "دقیق"


def test_collect_leaves_per_unit_empty_for_approximate(monkeypatch):
    monkeypatch.setattr(ps, "DELAY", 0)
    monkeypatch.setattr(ps, "SITES", {
        "exact": lambda q: [{"title": "شکر ۹۰۰ گرمی", "price": 90000, "url": "u1"}],
        "approx": lambda q: [{"title": "شکر قهوه‌ای ۵۰۰ گرمی", "price": 50000, "url": "u2"}],
    })
    exact, approx = ps.collect(["شکر"])
    assert exact["per_unit"] == 100000              # تومان به ازای هر کیلو (۷)
    assert approx["match"].startswith("تقریبی") and approx["per_unit"] is None
    assert approx["price"] == 50000


# ---------------------------------------------------------------- parsehshop JSON (۱، ۲، ۶)
def test_parseh_json_uses_price_amount_and_currency():
    data = {"products": [
        {"name": "شکر ۹۰۰ گرمی", "price": "۹۰۰,۰۰۰ ریال", "price_amount": 900000.0, "url": "u1"},
        {"name": "آرد", "price": "۲۰٪ ۵۰,۰۰۰ تومان", "price_amount": 50000, "url": "u2"},
        {"name": "روغن", "price": "۱۲۵٬۰۰۰٫۰۰ تومان", "url": "u3"},   # بدون price_amount
    ]}
    assert [c["price"] for c in ps.parse_parseh_json(data)] == [90000, 50000, 125000]


def test_parseh_json_explicit_currency_field():
    data = {"currency": {"iso_code": "IRR", "sign": "﷼"},
            "products": [{"name": "شکر", "price": "900,000", "price_amount": 900000, "url": "u"}]}
    assert ps.parse_parseh_json(data)[0]["price"] == 90000


def test_parseh_json_skips_unavailable():
    data = {"products": [
        {"name": "a", "price_amount": 1000, "availability": "unavailable"},
        {"name": "b", "price_amount": 1000, "available_for_order": "0"},
        {"name": "c", "price_amount": 1000, "quantity": 0},
        {"name": "d", "price_amount": 1000, "quantity": 0, "allow_oosp": 1},
        {"name": "e", "price_amount": 1000, "quantity": 5, "available_for_order": 1},
    ]}
    assert [c["title"] for c in ps.parse_parseh_json(data)] == ["d", "e"]


@pytest.mark.parametrize("data", [None, [], {}, {"products": None}])
def test_parseh_json_empty(data):
    assert ps.parse_parseh_json(data) == []


# ---------------------------------------------------------------- parsehshop HTML (۱، ۲، ۶)
HTML_17 = """
<script>var prestashop = {"currency":{"name":"Rial","iso_code":"IRR","sign":"ریال"}};</script>
<article class="product-miniature">
  <h3 class="product-title"><a href="/p/1-sugar.html">شکر ۹۰۰ گرمی</a></h3>
  <div class="product-price-and-shipping">
    <span class="regular-price">1,000,000</span>
    <span class="discount-percentage">-10%</span>
    <span class="price">900,000</span>
  </div>
</article>
<article class="product-miniature">
  <h3 class="product-title"><a href="/p/2-flour.html">آرد</a></h3>
  <ul class="product-flags"><li class="product-flag out_of_stock">ناموجود</li></ul>
  <div class="product-price-and-shipping"><span class="price">500,000</span></div>
</article>
"""


def test_parseh_html_discount_currency_and_stock():
    rows = ps.parse_parseh_html(HTML_17, "https://parsehshop.ir/search")
    assert rows == [{"title": "شکر ۹۰۰ گرمی", "price": 90000, "url": "https://parsehshop.ir/p/1-sugar.html"}]


def test_parseh_html_toman_text():
    html = """<article class="product-miniature"><h3 class="product-title"><a href="/x">قند</a></h3>
    <span class="price">۲۰٪ ۱۲۵,۰۰۰ تومان</span></article>"""
    assert ps.parse_parseh_html(html)[0]["price"] == 125000


# ---------------------------------------------------------------- digikala (۹)
@pytest.mark.parametrize("data", [{"data": None}, {}, None, {"data": {"products": None}}])
def test_digikala_empty_data(data):
    assert ps.parse_digikala_json(data) == []


def test_digikala_rial_to_toman():
    data = {"data": {"products": [
        {"id": 1, "title_fa": "شکر", "default_variant": {"price": {"selling_price": 1250000}},
         "url": {"uri": "/product/dkp-1/"}},
        {"id": 2, "title_fa": "ناموجود", "default_variant": []},
    ]}}
    assert ps.parse_digikala_json(data) == [
        {"title": "شکر", "price": 125000, "url": "https://www.digikala.com/product/dkp-1/"}
    ]
