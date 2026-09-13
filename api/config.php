<?php
// تنظیمات اتصال به دیتابیس — قبل از استفاده این مقادیر را با مشخصات MySQL خودتان
// (همانی که در XAMPP/Laragon و phpMyAdmin ساختید) جایگزین کنید.
//
// در Laragon/XAMPP پیش‌فرض معمولاً همین‌هاست: هاست=127.0.0.1، کاربر=root، رمز=خالی.

return [
    'driver' => 'mysql',
    'host' => '127.0.0.1',
    'port' => '3306',
    'database' => 'buffet_planner',
    'username' => 'root',
    'password' => '',
    'charset' => 'utf8mb4',
];
