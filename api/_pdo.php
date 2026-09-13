<?php
// اتصال مشترک PDO — همه‌ی endpointها همین فایل را include می‌کنند تا تنظیمات دیتابیس فقط
// یک‌جا (config.php) تعریف شده باشد.

function buffet_planner_pdo(): PDO
{
    // متغیرهای محیطی BUFFET_DB_* فقط برای تست خودکار همین پروژه (روی SQLite) استفاده می‌شوند —
    // در استقرار واقعی روی XAMPP/Laragon این‌ها تنظیم نمی‌شوند و همیشه از config.php (MySQL) خوانده می‌شود.
    $driverOverride = getenv('BUFFET_DB_DRIVER');

    if ($driverOverride === 'sqlite') {
        $path = getenv('BUFFET_DB_PATH') ?: (__DIR__ . '/../db/buffet_planner.sqlite');
        $pdo = new PDO('sqlite:' . $path);
        $pdo->exec('PRAGMA foreign_keys = ON');
    } else {
        $config = require __DIR__ . '/config.php';
        $dsn = sprintf(
            'mysql:host=%s;port=%s;dbname=%s;charset=%s',
            $config['host'],
            $config['port'],
            $config['database'],
            $config['charset'],
        );
        $pdo = new PDO($dsn, $config['username'], $config['password']);
    }

    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
    return $pdo;
}
