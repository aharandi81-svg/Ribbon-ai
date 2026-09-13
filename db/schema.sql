-- اسکیمای MySQL برای اجرای سلف‌هاست این پروژه زیر XAMPP/Laragon.
-- اجرا: در phpMyAdmin (یا خط فرمان mysql) کل این فایل را روی یک دیتابیس خالی اجرا کنید.
--
-- معماری ذخیره‌سازی: چون کل اپلیکیشن (React) قبلاً حالت را به‌صورت یک «عکس‌فوری» کامل
-- (dishes + plan + settings + ingredientPriceLog + customIngredients) در کنار هم می‌خواند/می‌نویسد
-- (نگاه کنید به src/lib/fileStorage.ts::DatabaseSnapshot که همین ساختار را برای حالت آفلاینِ
-- «فایل واقعی» هم پیاده کرده)، api/db.php هم دقیقاً همین یک عکس‌فوری را در قالب چند جدول اینجا
-- ذخیره می‌کند: هر بار ذخیره‌ی خودکار، محتوای این جداول به‌طور کامل با آخرین وضعیت اپ جایگزین
-- می‌شود (نه upsert ردیف‌به‌ردیف) — برای این تعداد رکورد (~۲۰۰ غذا) این کار در حد میلی‌ثانیه است
-- و منطق سرور را بسیار ساده نگه می‌دارد.

CREATE TABLE IF NOT EXISTS dishes (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  category VARCHAR(64) NOT NULL,
  macro JSON NOT NULL,
  cost_per_serving DECIMAL(14,2) NULL,
  cost_source VARCHAR(64) NOT NULL,
  price_variance_flag TINYINT(1) NOT NULL DEFAULT 0,
  needs_price TINYINT(1) NOT NULL DEFAULT 0,
  events_used_in JSON NOT NULL,
  ingredients_cost_total DECIMAL(14,2) NULL,
  reference_portion_grams INT NOT NULL,
  portion_source VARCHAR(64) NOT NULL,
  needs_portion_estimate TINYINT(1) NOT NULL DEFAULT 0,
  dietary_tags JSON NOT NULL,
  dietary_tags_verified TINYINT(1) NOT NULL DEFAULT 0,
  is_breakfast_item TINYINT(1) NOT NULL DEFAULT 0,
  waste_risk VARCHAR(32) NOT NULL,
  waste_risk_verified TINYINT(1) NOT NULL DEFAULT 0,
  observed_coverage_percent DECIMAL(8,6) NULL,
  observed_events_recorded INT NOT NULL DEFAULT 0,
  nutrition JSON NOT NULL,
  needs_nutrition_review TINYINT(1) NOT NULL DEFAULT 0,
  protein_source VARCHAR(32) NOT NULL,
  protein_source_verified TINYINT(1) NOT NULL DEFAULT 0,
  default_cooking_method VARCHAR(32) NULL,
  default_cooking_method_verified TINYINT(1) NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- مواد اولیه‌ی هر غذا (کارت رسپی) — قیمت واحد اینجا فقط «مرجع پایه» است، قیمت واقعیِ فعلی از
-- ingredient_price_log می‌آید (نگاه کنید به توضیح Ingredient.unitPrice در src/types.ts).
CREATE TABLE IF NOT EXISTS dish_ingredients (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  dish_id VARCHAR(64) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  name VARCHAR(255) NOT NULL,
  quantity DECIMAL(14,4) NOT NULL,
  unit VARCHAR(32) NOT NULL,
  unit_price DECIMAL(14,2) NULL,
  line_total DECIMAL(14,2) NULL,
  FOREIGN KEY (dish_id) REFERENCES dishes(id) ON DELETE CASCADE,
  INDEX idx_dish_ingredients_dish (dish_id),
  INDEX idx_dish_ingredients_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- تاریخچه‌ی تغییر قیمت هر ماده اولیه — جدیدترین رکورد هر نام، قیمت «فعلی» همان ماده در کل اپ است.
CREATE TABLE IF NOT EXISTS ingredient_price_log (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  ingredient_name VARCHAR(255) NOT NULL,
  price DECIMAL(14,2) NOT NULL,
  changed_at DATETIME NOT NULL,
  INDEX idx_price_log_name (ingredient_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- مواد اولیه‌ی «دستی»‌ای که از صفحه‌ی «مواد اولیه» تعریف شده‌اند و ممکن است هنوز در هیچ غذایی
-- استفاده نشده باشند.
CREATE TABLE IF NOT EXISTS custom_ingredients (
  name VARCHAR(255) NOT NULL PRIMARY KEY,
  unit VARCHAR(32) NOT NULL,
  category_group VARCHAR(64) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- سناریوی فعلی رویداد — تک‌کاربره است، پس فقط یک ردیف (id=1) دارد.
CREATE TABLE IF NOT EXISTS plan (
  id TINYINT NOT NULL PRIMARY KEY DEFAULT 1,
  guest_count INT NOT NULL,
  per_person_budget DECIMAL(14,2) NOT NULL,
  confidence_factor DECIMAL(6,3) NOT NULL,
  expected_attendance_rate DECIMAL(6,4) NOT NULL,
  meal_type VARCHAR(32) NOT NULL,
  category_budget_share JSON NOT NULL,
  selected_items JSON NOT NULL,
  dish_constraints JSON NOT NULL,
  CONSTRAINT chk_plan_singleton CHECK (id = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- تنظیمات کلی اپ (وزن رده‌ها، اهداف تغذیه، موتور بهینه‌سازی منو و ...) — تک‌کاربره، یک ردیف.
CREATE TABLE IF NOT EXISTS settings (
  id TINYINT NOT NULL PRIMARY KEY DEFAULT 1,
  tier_weights JSON NOT NULL,
  default_coverage_by_tier JSON NOT NULL,
  tier_cost_ceiling_share JSON NOT NULL,
  confidence_factor_by_waste_risk JSON NOT NULL,
  nutrition_targets JSON NOT NULL,
  cooking_method_capacity JSON NOT NULL,
  menu_optimizer JSON NOT NULL,
  CONSTRAINT chk_settings_singleton CHECK (id = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
