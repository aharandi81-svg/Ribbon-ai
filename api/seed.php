<?php
// اسکریپت واردسازی اولیه — فقط یک‌بار، بعد از اجرای db/schema.sql روی دیتابیس خالی، اجرا شود
// (از خط فرمان: php seed.php — یا با باز کردن مستقیم این آدرس در مرورگر). دیتابیس غذاهای شرکت
// کاترینگ (data/dishes.json) را می‌خواند و به‌عنوان اولین محتوای جدول‌ها می‌نویسد؛ تنظیمات و
// سناریوی پیش‌فرض هم دقیقاً همان مقادیری هستند که src/data/defaultSettings.ts در حالت مرورگرمحور
// استفاده می‌کند، تا تجربه‌ی اولیه یکسان بماند.
//
// هشدار: اجرای دوباره‌ی این اسکریپت هر چیزی را که در برنامه ویرایش کرده‌اید (قیمت‌ها، غذاهای
// اضافه‌شده، تنظیمات) با دیتای اولیه جایگزین می‌کند — فقط برای راه‌اندازی اول استفاده شود.

require __DIR__ . '/_pdo.php';
require __DIR__ . '/_snapshot.php';

$dishesPath = __DIR__ . '/../data/dishes.json';
$dishes = json_decode(file_get_contents($dishesPath), true);
if (!is_array($dishes)) {
    fwrite(STDERR, "خواندن {$dishesPath} ناموفق بود.\n");
    exit(1);
}

// دقیقاً همان مقادیر src/data/defaultSettings.ts — نگاه کنید به آن فایل اگر تغییرشان دادید.
$defaultPlan = [
    'guestCount' => 180,
    'perPersonBudget' => 30000000,
    'confidenceFactor' => 1,
    'expectedAttendanceRate' => 0.95,
    'mealType' => 'شام',
    'categoryBudgetShare' => [
        'غذای اصلی' => 0.58,
        'پیش‌غذا' => 0.15,
        'دسر' => 0.1,
        'نوشیدنی' => 0.17,
    ],
    'selectedItems' => [],
    'dishConstraints' => new stdClass(),
];

$defaultMenuOptimizer = [
    'proteinTargetGramsPerGuest' => 300,
    'proteinMaxMultiplier' => 1.3,
    'proteinSourceDistributionTarget' => ['red-meat' => 40, 'white-meat' => 25, 'fish-shrimp' => 10],
    'targetMenuProfiles' => [
        'A' => ['id' => 'A', 'label' => 'پروفایل A (پروتئین‌محور متعادل)', 'proteinSharePercent' => 40, 'fatSharePercent' => 30, 'carbSharePercent' => 30],
        'B' => ['id' => 'B', 'label' => 'پروفایل B (پروتئین‌محور بالا)', 'proteinSharePercent' => 50, 'fatSharePercent' => 25, 'carbSharePercent' => 25],
    ],
    'activeTargetProfileId' => 'A',
    'dishScoreWeights' => [
        'macroFit' => 20, 'proteinDensity' => 15, 'costEfficiency' => 15, 'wasteRiskSafety' => 10,
        'dataConfidence' => 10, 'kitchenFeasibility' => 15, 'varietyContribution' => 10, 'guestAppealProxy' => 5,
    ],
    'menuScoreWeights' => [
        'proteinFit' => 25, 'macroFit' => 20, 'proteinDiversity' => 15, 'menuVariety' => 15,
        'kitchenFeasibility' => 10, 'costFit' => 10, 'avgDishScore' => 5,
    ],
    'budgetOverrunBehavior' => 'penalize',
    'budgetOverrunTolerancePercent' => 0.05,
    'numberOfProposals' => 5,
    'minDishesPerCategory' => ['غذای اصلی' => 2, 'پیش‌غذا' => 1, 'دسر' => 1, 'نوشیدنی' => 1],
    'maxDishesPerCategory' => ['غذای اصلی' => 4, 'پیش‌غذا' => 3, 'دسر' => 2, 'نوشیدنی' => 2],
];

$defaultSettings = [
    'tierWeights' => ['شاخص' => 1.5, 'استاندارد' => 1.0, 'اقتصادی' => 0.6],
    'defaultCoverageByTier' => ['شاخص' => 0.4, 'استاندارد' => 0.7, 'اقتصادی' => 1.0],
    'tierCostCeilingShare' => ['شاخص' => 0.12, 'استاندارد' => 0.07, 'اقتصادی' => 0.035],
    'confidenceFactorByWasteRisk' => ['فسادپذیر' => 1.05, 'قابل‌نگهداری' => 1.15],
    'nutritionTargets' => ['totalGramsPerGuest' => 520, 'carbShare' => 0.25, 'proteinShare' => 0.25, 'vegShare' => 0.5],
    'cookingMethodCapacity' => [
        'گریل' => 3, 'کبابی' => 3, 'سرخ‌کردنی' => 3, 'آب‌پز/بخارپز' => 5,
        'خورشتی/آرام‌پز' => 5, 'فر' => 5, 'سرد/بدون پخت' => 8,
    ],
    'menuOptimizer' => $defaultMenuOptimizer,
];

$snapshot = [
    'fileFormatVersion' => 1,
    'savedAt' => gmdate('c'),
    'dishes' => $dishes,
    'plan' => $defaultPlan,
    'settings' => $defaultSettings,
    'ingredientPriceLog' => new stdClass(),
    'customIngredients' => new stdClass(),
];

$pdo = buffet_planner_pdo();
write_snapshot($pdo, $snapshot);

$count = count($dishes);
echo "انجام شد — {$count} غذا، تنظیمات و سناریوی پیش‌فرض در دیتابیس ذخیره شد.\n";
