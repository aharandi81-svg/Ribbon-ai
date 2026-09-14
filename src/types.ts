export const CATEGORIES = ['غذای اصلی', 'پیش‌غذا', 'دسر', 'نوشیدنی'] as const
export type Category = (typeof CATEGORIES)[number]

export const TIERS = ['شاخص', 'استاندارد', 'اقتصادی'] as const
export type Tier = (typeof TIERS)[number]

export const COOKING_METHODS = [
  'گریل',
  'کبابی',
  'سرخ‌کردنی',
  'آب‌پز/بخارپز',
  'خورشتی/آرام‌پز',
  'فر',
  'سرد/بدون پخت',
] as const
export type CookingMethod = (typeof COOKING_METHODS)[number]

export const MEAL_TYPES = ['صبحانه', 'ناهار', 'شام', 'صبحانه و ناهار', 'ناهار و شام', 'صبحانه، ناهار و شام'] as const
export type MealType = (typeof MEAL_TYPES)[number]

/** آیا این نوع وعده شامل صبحانه/ناهار-شام می‌شود — مبنای فیلتر مرتبط‌بودن غذا در صفحه انتخاب غذا. */
export function mealTypeIncludesBreakfast(mealType: MealType): boolean {
  return mealType === 'صبحانه' || mealType === 'صبحانه و ناهار' || mealType === 'صبحانه، ناهار و شام'
}
export function mealTypeIncludesLunchOrDinner(mealType: MealType): boolean {
  return mealType !== 'صبحانه'
}

// برچسب رژیمی به‌صورت خودکار و صرفاً از روی کلیدواژه‌ی مواد اولیه تشخیص داده می‌شود؛
// هرگز به‌عنوان تضمین ایمنی/مذهبی برای مهمانان استفاده نشود — نگاه کنید به dietaryTagsVerified.
export const DIETARY_TAGS = ['گیاهی', 'وگان'] as const
export type DietaryTag = (typeof DIETARY_TAGS)[number]

// ریسک هدررفت اگر بیشتر از نیاز واقعی پخته/آماده شود: «فسادپذیر» یعنی پرس اضافه معمولاً باید
// دور ریخته شود (غذای گرم بوفه)، «قابل‌نگهداری» یعنی پرس اضافه قابل فریز/بسته‌بندی/استفاده در
// رویداد بعد است (نوشیدنی بطری‌شده، دسر بسته‌بندی). مبنای تعیین ضریب اطمینان جداگانه هر غذا.
export const WASTE_RISK_LEVELS = ['فسادپذیر', 'قابل‌نگهداری'] as const
export type WasteRisk = (typeof WASTE_RISK_LEVELS)[number]

export interface Macro {
  carb: number
  protein: number
  veg: number
  fat: number
}

export interface Ingredient {
  name: string
  quantity: number
  unit: string
  /** قیمت واحد پایه‌ی این ماده اولیه طبق کارت رسپی اصلی (ستون «فی») به ریال — فقط مرجع اولیه‌ی
   * استخراج است، هرگز مستقیماً ویرایش نمی‌شود. قیمت واقعیِ فعلی از رویهم‌گذاشتن این مقدار با
   * آخرین رکورد ingredientPriceLog همان نام در store به دست می‌آید (نگاه کنید به
   * src/lib/ingredients.ts::currentIngredientPrice) — یعنی ویرایش قیمت یک ماده اولیه (چه از
   * صفحه‌ی «مواد اولیه» چه از فرم ویرایش یک غذای خاص) بلافاصله روی همه‌ی غذاهایی که از همان
   * ماده استفاده می‌کنند اثر می‌گذارد. */
  unitPrice?: number | null
  /** = quantity × unitPrice پایه (نه لزوماً قیمت فعلی) — فقط مرجع اولیه، نگاه کنید به توضیح بالا. */
  lineTotal?: number | null
}

/** یک رکورد از تاریخچه‌ی تغییر قیمت یک ماده اولیه — نگاه کنید به AppState.ingredientPriceLog. */
export interface IngredientPriceLogEntry {
  price: number
  /** ISO timestamp — نمایش تاریخ شمسی و ساعت در UI با Intl.DateTimeFormat انجام می‌شود
   * (نگاه کنید به formatJalaliDateTime در lib/format.ts)، نه اینجا ذخیره نمی‌شود. */
  changedAt: string
}

// ===========================================================================
// Menu Optimization Engine — منبع پروتئین غالب هر غذا (نه از روی نام، از روی مواد اولیه‌ی
// واقعی رسپی تشخیص داده می‌شود؛ نگاه کنید به scripts/extract_dishes.py::detect_protein_source).
// ===========================================================================
export const PROTEIN_SOURCES = ['red-meat', 'white-meat', 'fish-shrimp', 'plant-other'] as const
export type ProteinSourceType = (typeof PROTEIN_SOURCES)[number]

export const PROTEIN_SOURCE_LABELS: Record<ProteinSourceType, string> = {
  'red-meat': 'گوشت قرمز',
  'white-meat': 'گوشت سفید (مرغ/بوقلمون/اردک)',
  'fish-shrimp': 'ماهی و میگو',
  'plant-other': 'گیاهی/لبنی/سایر',
}

/** مقادیر مطلق واقعی درشت‌مغذی به گرم برای یک پرس مرجع غذا — هرگز نباید با وزن کل پرس اشتباه
 * گرفته شود؛ این‌ها از درصد ماکروی واقعی رسپی × وزن پرس واقعی محاسبه شده‌اند، نه فرض. fiberGrams
 * و calories فعلاً در کارت‌های رسپی استخراج‌نشده و عمداً null هستند (نگاه کنید به needsNutritionReview). */
export interface DishNutrition {
  proteinGrams: number
  carbGrams: number
  fatGrams: number
  fiberGrams: number | null
  calories: number | null
}

export interface Dish {
  id: string
  name: string
  category: Category
  macro: Macro
  costPerServing: number | null
  costSource: string
  priceVarianceFlag: boolean
  needsPrice: boolean
  eventsUsedIn: string[]
  ingredients?: Ingredient[] | null
  /** جمع بهای مواد اولیه طبق قیمت پایه‌ی کارت رسپی (نه لزوماً قیمت فعلی — نگاه کنید به توضیح
   * Ingredient.unitPrice برای مقدار زنده) — مستقل از costPerServing (که از قیمت فروش واقعی
   * رویدادهای قبلی می‌آید، نه از رسپی). کاربر می‌تواند مبلغ زنده (پس از اعمال ingredientPriceLog)
   * را به‌عنوان costPerServing اعمال کند (نگاه کنید به بخش «مواد اولیه» در فرم ویرایش غذا) —
   * تا وقتی خودش دستی این کار را نکند، costPerServing تغییر نمی‌کند. null یعنی هیچ‌کدام از
   * مواد اولیه‌ی این غذا قیمت واحد ثبت‌شده ندارند. */
  ingredientsCostTotal: number | null
  /** وزن هر پرس (گرم)، برآوردشده از کارت رسپی یا پیش‌فرض دسته — نگاه کنید به needsPortionEstimate. */
  referencePortionGrams: number
  portionSource: string
  needsPortionEstimate: boolean
  /** تشخیص خودکار و تأییدنشده از روی نام/مواد اولیه — همیشه با dietaryTagsVerified نمایش داده شود. */
  dietaryTags: DietaryTag[]
  dietaryTagsVerified: boolean
  /** تشخیص خودکار از روی نام غذا — آیا این غذا برای وعده صبحانه مناسب است (نان و پنیر، املت، پنکیک و ...). */
  isBreakfastItem: boolean
  /** تشخیص خودکار از روی دسته/نام — نگاه کنید به تعریف WasteRisk. مبنای ضریب اطمینان این غذا. */
  wasteRisk: WasteRisk
  wasteRiskVerified: boolean
  /** میانگین سهم پوششی که در رویدادهای گذشته واقعاً درست از آب درآمده (از «ثبت مصرف واقعی» بعد
   * از رویداد) — وقتی موجود باشد به‌جای پیش‌فرض کلی رده، به‌عنوان پیش‌فرض سهم پوشش این غذا در
   * رویدادهای بعدی استفاده می‌شود. null یعنی هنوز هیچ داده‌ی واقعی ثبت نشده. */
  observedCoveragePercent: number | null
  observedEventsRecorded: number
  /** درشت‌مغذی واقعی به گرم برای یک پرس مرجع (referencePortionGrams) — مبنای Menu Optimization
   * Engine؛ هرگز به‌جای وزن پرس استفاده نشود (نگاه کنید به هشدار بالای DishNutrition). */
  nutrition: DishNutrition
  /** true یعنی این غذا کارت رسپی نداشت و ماکرو از میانگین وزنی دسته گرفته شده — گرم‌های تغذیه‌ای
   * این غذا نباید در تصمیم‌گیری قطعی موتور بهینه‌سازی به‌عنوان داده‌ی دقیق در نظر گرفته شوند. */
  needsNutritionReview: boolean
  /** تشخیص خودکار و تأییدنشده از روی نام/مواد اولیه — همیشه با proteinSourceVerified نمایش داده شود. */
  proteinSource: ProteinSourceType
  proteinSourceVerified: boolean
  /** پیش‌فرض «ایستگاه پخت غالب» این غذا (متفاوت از cookingMethod انتخاب‌شده‌ی کاربر روی هر ردیف
   * پلن — این یکی ویژگی ذاتی خودِ غذا برای محاسبه‌ی امکان‌سنجی آشپزخانه در موتور بهینه‌سازی است). */
  defaultCookingMethod: CookingMethod | null
  defaultCookingMethodVerified: boolean
  /** تیک دستی کاربر برای «این ردیف را دیدم/تصحیح کردم و درست است» — برخلاف پرچم‌های Verified
   * بالا (که هرکدام فقط یک حدس خودکار مشخص را تأیید می‌کنند)، این یکی کل ردیف را پوشش می‌دهد و
   * برای ردیابی بازبینی دستی دیتابیس غذا به کار می‌رود (نگاه کنید به DishDatabasePage). ذخیره از
   * فرم ویرایش غذا هم به‌طور خودکار این را true می‌کند، هم‌راستا با بقیه‌ی پرچم‌های Verified. */
  dataReviewed: boolean
}

/** ورودی فرم «افزودن غذای جدید» — همان فیلدهایی از Dish که کاربر مستقیماً وارد می‌کند؛ بقیه‌ی
 * فیلدهای Dish (وضعیت تأیید، شناسه، سابقه‌ی مصرف واقعی و ...) توسط addDish در store ساخته می‌شوند. */
export interface NewDishInput {
  name: string
  category: Category
  macro: Macro
  costPerServing: number | null
  referencePortionGrams: number
  dietaryTags: DietaryTag[]
  isBreakfastItem: boolean
  wasteRisk: WasteRisk
  proteinSource: ProteinSourceType
  defaultCookingMethod: CookingMethod | null
  nutrition: DishNutrition
  /** فقط در حالت ویرایش پر می‌شود (از کارت رسپی) — فرم افزودن غذای جدید فعلاً امکان وارد کردن
   * دستی مواد اولیه ندارد؛ نگاه کنید به بخش «مواد اولیه» در فرم ویرایش غذا. */
  ingredients: Ingredient[] | null
}

export interface SelectedItem {
  itemId: string
  dishId: string
  tier: Tier
  portionSize: number
  cookingMethod?: CookingMethod
}

export type CategoryBudgetShare = Record<Category, number>

export interface EventPlan {
  guestCount: number
  perPersonBudget: number
  /** ضریب اطمینان دستیِ اضافه‌ی این رویداد — روی ضریب پایه‌ی هر غذا (که بر اساس ریسک هدررفت آن
   * در تنظیمات مشخص می‌شود) ضرب می‌شود. پیش‌فرض ۱ (بدون تغییر) — فقط برای رویدادهایی که برنامه‌ریز
   * دلیل خاصی برای احتیاط بیشتر/کمتر کلی دارد (مثلاً رویداد فضای باز با پیش‌بینی نامطمئن). */
  confidenceFactor: number
  /** درصد مهمانان دعوت‌شده که واقعاً حضور می‌یابند — برای پیشنهاد پیش‌فرض واقع‌بینانه‌تر تعداد پوشش. */
  expectedAttendanceRate: number
  mealType: MealType
  categoryBudgetShare: CategoryBudgetShare
  selectedItems: SelectedItem[]
  /** محدودیت دستی کاربر روی هر غذا برای Menu Optimization Engine — نگاه کنید به DishConstraintType. */
  dishConstraints: Record<string, DishConstraintType>
}

export interface NutritionTargets {
  totalGramsPerGuest: number
  carbShare: number
  proteinShare: number
  vegShare: number
}

// ===========================================================================
// Menu Optimization Engine — پروفایل ترکیب درشت‌مغذی هدف. توجه: این‌ها صرفاً دو الگوی قابل‌انتخاب
// و قابل‌تنظیم داخلی پروژه‌اند برای هدف‌گذاری نسبت پروتئین/چربی/کربوهیدرات یک منوی بوفه — به هیچ
// عنوان استاندارد پزشکی/درمانی/رژیم‌غذایی تأییدشده نیستند و نباید این‌طور به کاربر یا مهمانان
// معرفی شوند.
// ===========================================================================
export const TARGET_MENU_PROFILE_IDS = ['A', 'B'] as const
export type TargetMenuProfileId = (typeof TARGET_MENU_PROFILE_IDS)[number]

export interface TargetMenuProfile {
  id: TargetMenuProfileId
  label: string
  /** جمع سه سهم باید ۱۰۰ باشد. */
  proteinSharePercent: number
  fatSharePercent: number
  carbSharePercent: number
}

export const PROTEIN_SOURCE_DISTRIBUTION_KEYS = ['red-meat', 'white-meat', 'fish-shrimp'] as const

export const DISH_CONSTRAINT_TYPES = ['must-include', 'must-exclude', 'preferred'] as const
export type DishConstraintType = (typeof DISH_CONSTRAINT_TYPES)[number]

export const BUDGET_OVERRUN_BEHAVIORS = ['exclude', 'penalize', 'allow'] as const
export type BudgetOverrunBehavior = (typeof BUDGET_OVERRUN_BEHAVIORS)[number]
export const BUDGET_OVERRUN_BEHAVIOR_LABELS: Record<BudgetOverrunBehavior, string> = {
  exclude: 'حذف کامل ترکیب‌های خارج از بودجه',
  penalize: 'کاهش امتیاز (بدون حذف)',
  allow: 'نادیده‌گرفتن سقف بودجه',
}

export interface DishScoreWeights {
  macroFit: number
  proteinDensity: number
  costEfficiency: number
  wasteRiskSafety: number
  dataConfidence: number
  kitchenFeasibility: number
  varietyContribution: number
  guestAppealProxy: number
}

export interface MenuScoreWeights {
  proteinFit: number
  macroFit: number
  proteinDiversity: number
  menuVariety: number
  kitchenFeasibility: number
  costFit: number
  avgDishScore: number
}

export const NUMBER_OF_PROPOSALS_OPTIONS = [3, 5, 10] as const
export type NumberOfProposalsOption = (typeof NUMBER_OF_PROPOSALS_OPTIONS)[number]

export interface MenuOptimizerSettings {
  /** پیش‌فرض پروتئین هدف به ازای هر مهمان (گرم) — طبق مشخصات، ۳۰۰ گرم پیش‌فرض ولی کاملاً قابل‌تغییر. */
  proteinTargetGramsPerGuest: number
  /** بیشترین پروتئین قابل‌قبول = proteinTargetGramsPerGuest × این ضریب؛ عبور از آن یک Hard Constraint است. */
  proteinMaxMultiplier: number
  /** توزیع هدف منابع پروتئین به درصد از کل پروتئین منو؛ سهم plant-other به‌طور ضمنی از باقیمانده محاسبه می‌شود. */
  proteinSourceDistributionTarget: Record<(typeof PROTEIN_SOURCE_DISTRIBUTION_KEYS)[number], number>
  /** حداکثر انحراف مجاز (به واحد امتیاز درصد) سهم واقعی هر منبع پروتئین (بر مبنای گرم واقعی
   * پروتئین از nutrition، نه تعداد قلم) از توزیع هدف پیش از رد کامل ترکیب — Hard Constraint، نه
   * فقط یک امتیاز نرم. مثلاً ۲۰ یعنی سهم واقعی گوشت قرمز می‌تواند تا ۲۰ واحد درصد از هدف فاصله
   * داشته باشد، نه بیشتر. */
  proteinSourceDistributionTolerancePercent: number
  targetMenuProfiles: Record<TargetMenuProfileId, TargetMenuProfile>
  activeTargetProfileId: TargetMenuProfileId
  dishScoreWeights: DishScoreWeights
  menuScoreWeights: MenuScoreWeights
  budgetOverrunBehavior: BudgetOverrunBehavior
  /** درصد مجاز عبور از بودجه سرانه پیش از اعمال رفتار budgetOverrunBehavior (مثلاً ۰٫۰۵ یعنی تا ۵٪). */
  budgetOverrunTolerancePercent: number
  numberOfProposals: NumberOfProposalsOption
  /** حداقل تعداد قلم غذا از هر دسته در هر پیشنهاد — برای جلوگیری از منوهای نامتوازن (مثلاً بدون پیش‌غذا). */
  minDishesPerCategory: Record<Category, number>
  /** حداکثر تعداد قلم غذا از هر دسته در هر پیشنهاد. */
  maxDishesPerCategory: Record<Category, number>
}

export interface AppSettings {
  tierWeights: Record<Tier, number>
  defaultCoverageByTier: Record<Tier, number>
  /** سقف هزینه هر پرس به تفکیک رده، به‌صورت سهمی از بودجه سرانه (نه عدد ثابت ریالی) — با هر بودجه‌ای مقیاس می‌شود. */
  tierCostCeilingShare: Record<Tier, number>
  /** ضریب اطمینان پایه به تفکیک ریسک هدررفت غذا — به‌جای یک عدد ثابت برای همه؛ غذای فسادپذیر
   * حاشیه‌ی امنیت کمتری می‌گیرد (پرس اضافه‌اش هدر می‌رود)، غذای قابل‌نگهداری حاشیه‌ی بیشتری
   * می‌تواند بگیرد (کمبودش گران‌تر از اضافه‌اش است). */
  confidenceFactorByWasteRisk: Record<WasteRisk, number>
  nutritionTargets: NutritionTargets
  /** ظرفیت هر ایستگاه پخت: حداکثر تعداد غذای هم‌زمان با آن روش پیش از هشدار — هر روش پخت ظرفیت واقعی متفاوتی دارد. */
  cookingMethodCapacity: Record<CookingMethod, number>
  /** تمام مقادیر قابل‌تنظیم Menu Optimization Engine — نگاه کنید به src/lib/menuOptimizer.ts. */
  menuOptimizer: MenuOptimizerSettings
}

export type MacroKey = keyof Macro

// ===========================================================================
// Menu Optimization Engine — خروجی موتور: چند پیشنهاد منوی متفاوت برای یک دسته/وعده.
// ===========================================================================
export const MENU_STRATEGIES = [
  'best-balanced',
  'cost-optimized',
  'nutrition-optimized',
  'kitchen-optimized',
  'variety-optimized',
] as const
export type MenuStrategyId = (typeof MENU_STRATEGIES)[number]
export const MENU_STRATEGY_LABELS: Record<MenuStrategyId, string> = {
  'best-balanced': 'بهترین تعادل (Best Balanced)',
  'cost-optimized': 'بهینه هزینه (Cost Optimized)',
  'nutrition-optimized': 'بهینه تغذیه (Nutrition Optimized)',
  'kitchen-optimized': 'بهینه آشپزخانه (Kitchen Optimized)',
  'variety-optimized': 'بهینه تنوع (Variety Optimized)',
}

export interface MenuProposalDish {
  dishId: string
  dishName: string
  category: Category
  proteinSource: ProteinSourceType
  cookingMethod: CookingMethod | null
  portionGrams: number
  /** پروتئین/کربوهیدرات/چربی برای یک پرس مرجع (نه کل رویداد) — برای کل واقعی رویداد این عدد
   * باید در servingCount ضرب شود؛ نگاه کنید به هشدار وزن پرس در بالای DishNutrition. */
  proteinGrams: number
  carbGrams: number
  fatGrams: number
  costPerServing: number | null
  /** تعداد میهمانی که واقعاً انتظار می‌رود این غذا را بخورند (سهم پوشش خودکار × مهمانان × نرخ
   * حضور) — بدون ذخیره‌ی احتیاطی. مبنای محاسبه‌ی گرم تغذیه‌ای کل منو. */
  coverageCount: number
  /** تعداد واقعی این غذا که باید خریداری/پخته شود = coverageCount × ضریب اطمینان (شامل ذخیره‌ی
   * احتیاطی بر اساس ریسک هدررفت) — همان «تعداد پخت» در صفحه‌ی انتخاب غذا. مبنای totalCost است؛
   * هرگز با coverageCount اشتباه گرفته نشود چون معمولاً بزرگ‌تر است. */
  servingCount: number
  /** = costPerServing × servingCount (تعداد پخت شامل ذخیره، نه فقط سهم پوشش قطعی) — هزینه‌ی
   * واقعی این قلم برای کل رویداد، دقیقاً همان مبنایی که بقیه‌ی اپ (صفحه انتخاب غذا/داشبورد) با
   * آن هزینه کل را حساب می‌کند. */
  totalCost: number | null
  dishScore: number
  needsNutritionReview: boolean
}

export interface MenuProposal {
  id: string
  strategyId: MenuStrategyId
  dishes: MenuProposalDish[]
  totalProteinGrams: number
  totalCarbGrams: number
  totalFatGrams: number
  costPerGuest: number | null
  totalCost: number | null
  /** غذاهایی که هزینه‌شان نامشخص است و در totalCost/costPerGuest لحاظ نشده‌اند. */
  missingPriceDishIds: string[]
  proteinFitScore: number
  macroFitScore: number
  proteinDiversityScore: number
  menuVarietyScore: number
  kitchenFeasibilityScore: number
  costScore: number
  avgDishScore: number
  menuOptimizationScore: number
  proteinSourceBreakdownPercent: Record<ProteinSourceType, number>
  warnings: string[]
}
