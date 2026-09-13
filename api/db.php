<?php
// یک endpoint واحد که کل وضعیت اپ (همان DatabaseSnapshot که src/lib/fileStorage.ts هم برای حالت
// «فایل واقعی» تعریف کرده) را می‌خواند/می‌نویسد. سمت فرانت (src/lib/apiStorage.ts) دقیقاً همین
// یک آدرس را صدا می‌زند: GET برای بارگذاری اولیه، POST برای ذخیره‌ی خودکار بعد از هر تغییر.
//
// چون تعداد رکوردها کم است (~۲۰۰ غذا) و کل اپ همیشه «کل وضعیت» را یک‌جا می‌فرستد، هر POST به‌جای
// upsert ردیف‌به‌ردیف، محتوای جدول‌های مرتبط را کامل با آخرین وضعیت جایگزین می‌کند (نگاه کنید به
// write_snapshot در _snapshot.php) — منطق سرور را خیلی ساده نگه می‌دارد.

header('Content-Type: application/json; charset=utf-8');
// فقط برای توسعه‌ی محلی — چون فرانت و بک‌اند هر دو روی همان کامپیوتر کاربر هستند، ریسک امنیتی
// واقعی ندارد؛ اگر بخواهید از دستگاه دیگری هم به آن وصل شوید کافی‌ست این خط را باز بگذارید.
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

require __DIR__ . '/_pdo.php';
require __DIR__ . '/_snapshot.php';

function fail(int $code, string $message): never
{
    http_response_code($code);
    echo json_encode(['error' => $message], JSON_UNESCAPED_UNICODE);
    exit;
}

$pdo = buffet_planner_pdo();

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    echo json_encode(read_snapshot($pdo), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $raw = file_get_contents('php://input');
    $snapshot = json_decode($raw, true);
    if (!is_array($snapshot) || !isset($snapshot['dishes'], $snapshot['plan'], $snapshot['settings'])) {
        fail(400, 'بدنه‌ی درخواست یک عکس‌فوریِ معتبر نیست.');
    }
    try {
        write_snapshot($pdo, $snapshot);
    } catch (Throwable $e) {
        fail(500, 'ذخیره‌سازی ناموفق بود: ' . $e->getMessage());
    }
    echo json_encode(['status' => 'ok'], JSON_UNESCAPED_UNICODE);
    exit;
}

fail(405, 'متد پشتیبانی نمی‌شود.');
