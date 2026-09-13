import type { AppSettings, CategoryBudgetShare, EventPlan, MenuOptimizerSettings } from '../types'

// همه‌ی این مقادیر از صفحه تنظیمات قابل تغییرند؛ هیچ‌کدام در موتور بهینه‌سازی منو
// (src/lib/menuOptimizer.ts) هاردکد نشده‌اند.
export const defaultMenuOptimizerSettings: MenuOptimizerSettings = {
  // پیش‌فرض مشخصات: ۳۰۰ گرم پروتئین خالص به ازای هر مهمان (نه وزن کل غذا).
  proteinTargetGramsPerGuest: 300,
  // عبور از ۱٫۳ برابر هدف (یعنی بیش از ۳۹۰ گرم برای پیش‌فرض ۳۰۰ گرمی) نامعقول تلقی می‌شود.
  proteinMaxMultiplier: 1.3,
  // سهم plant-other از باقیمانده‌ی این سه محاسبه می‌شود (اینجا: ۱۰۰-۴۰-۲۵-۱۰=۲۵٪).
  proteinSourceDistributionTarget: {
    'red-meat': 40,
    'white-meat': 25,
    'fish-shrimp': 10,
  },
  // ۳۰ واحد درصد پیش‌فرض: به‌قدر کافی سخت‌گیرانه که واقعاً اعمال شود (مثلاً سهم گوشت قرمز صفر
  // دیگر هرگز رد نمی‌شود)، ولی نه آن‌قدر تنگ که با تعداد قلم محدود هر دسته (تقسیم درصدی ذاتاً
  // درشت‌دانه) یا داده‌ی ناقص برخی غذاهای گران‌قیمت، هیچ ترکیبی پیدا نشود.
  proteinSourceDistributionTolerancePercent: 30,
  targetMenuProfiles: {
    A: { id: 'A', label: 'پروفایل A (پروتئین‌محور متعادل)', proteinSharePercent: 40, fatSharePercent: 30, carbSharePercent: 30 },
    B: { id: 'B', label: 'پروفایل B (پروتئین‌محور بالا)', proteinSharePercent: 50, fatSharePercent: 25, carbSharePercent: 25 },
  },
  activeTargetProfileId: 'A',
  dishScoreWeights: {
    macroFit: 20,
    proteinDensity: 15,
    costEfficiency: 15,
    wasteRiskSafety: 10,
    dataConfidence: 10,
    kitchenFeasibility: 15,
    varietyContribution: 10,
    guestAppealProxy: 5,
  },
  menuScoreWeights: {
    proteinFit: 25,
    macroFit: 20,
    proteinDiversity: 15,
    menuVariety: 15,
    kitchenFeasibility: 10,
    costFit: 10,
    avgDishScore: 5,
  },
  budgetOverrunBehavior: 'penalize',
  budgetOverrunTolerancePercent: 0.05,
  numberOfProposals: 5,
  minDishesPerCategory: {
    'غذای اصلی': 2,
    'پیش‌غذا': 1,
    'دسر': 1,
    'نوشیدنی': 1,
  },
  maxDishesPerCategory: {
    'غذای اصلی': 4,
    'پیش‌غذا': 3,
    'دسر': 2,
    'نوشیدنی': 2,
  },
}

// اعداد این فایل صرفاً مقادیر پیش‌فرض اولیه هستند و همگی از صفحه تنظیمات قابل ویرایش‌اند؛
// هیچ‌کدام در منطق محاسباتی هاردکد نشده‌اند (نگاه کنید به lib/calculations.ts).
export const defaultSettings: AppSettings = {
  tierWeights: {
    'شاخص': 1.5,
    'استاندارد': 1.0,
    'اقتصادی': 0.6,
  },
  // سهم پیش‌فرض تعداد پوشش هر رده از کل میهمانان — قابل بازنویسی دستی برای هر آیتم.
  // توجه: این وزن تخصیص بودجه بین آیتم‌های یک دسته را مشخص می‌کند، نه کیفیت ذاتی غذا؛
  // کیفیت واقعی از دیتابیس غذا می‌آید، نه از رده انتخابی.
  defaultCoverageByTier: {
    'شاخص': 0.4,
    'استاندارد': 0.7,
    'اقتصادی': 1.0,
  },
  // سقف هزینه هر پرس به تفکیک رده، به‌صورت سهمی از بودجه سرانه (نه عدد ثابت) تا با هر
  // اندازه بودجه‌ای مقیاس شود — مبنای هشدار «کارشناس مالی» در پنل توصیه‌ها.
  tierCostCeilingShare: {
    'شاخص': 0.12,
    'استاندارد': 0.07,
    'اقتصادی': 0.035,
  },
  // فسادپذیر (غذای گرم بوفه): حاشیه‌ی امنیت کم، چون پرس اضافه هدر می‌رود. قابل‌نگهداری (نوشیدنی
  // بطری/دسر بسته‌بندی): حاشیه‌ی امنیت بیشتر، چون کمبودش گران‌تر از اضافه‌اش تمام می‌شود.
  confidenceFactorByWasteRisk: {
    'فسادپذیر': 1.05,
    'قابل‌نگهداری': 1.15,
  },
  // استاندارد «فرمول تقسیم سفره»: Harvard Healthy Eating Plate / USDA MyPlate / AMDR
  // برای بشقاب ۵۲۰ گرمی: ۲۵٪ غلات، ۲۵٪ پروتئین، ۵۰٪ سبزیجات و میوه؛ چربی سهم مستقل ندارد.
  nutritionTargets: {
    totalGramsPerGuest: 520,
    carbShare: 0.25,
    proteinShare: 0.25,
    vegShare: 0.5,
  },
  // ظرفیت واقعی هر ایستگاه پخت پیش از فشار آمدن به آشپزخانه متفاوت است (مثلاً فر چند سینی را
  // هم‌زمان می‌پزد ولی ایستگاه گریل محدودتر است) — بنابراین آستانه هشدار به تفکیک روش تنظیم می‌شود.
  cookingMethodCapacity: {
    'گریل': 3,
    'کبابی': 3,
    'سرخ‌کردنی': 3,
    'آب‌پز/بخارپز': 5,
    'خورشتی/آرام‌پز': 5,
    'فر': 5,
    'سرد/بدون پخت': 8,
  },
  menuOptimizer: defaultMenuOptimizerSettings,
}

export const defaultCategoryBudgetShare: CategoryBudgetShare = {
  'غذای اصلی': 0.58,
  'پیش‌غذا': 0.15,
  'دسر': 0.1,
  'نوشیدنی': 0.17,
}

export const defaultEventPlan: EventPlan = {
  guestCount: 180,
  perPersonBudget: 30_000_000,
  confidenceFactor: 1,
  expectedAttendanceRate: 0.95,
  mealType: 'شام',
  categoryBudgetShare: defaultCategoryBudgetShare,
  selectedItems: [],
  dishConstraints: {},
}
