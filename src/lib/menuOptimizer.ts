import type {
  AppSettings,
  BudgetOverrunBehavior,
  Category,
  CookingMethod,
  Dish,
  DishConstraintType,
  EventPlan,
  MenuOptimizerSettings,
  MenuProposal,
  MenuProposalDish,
  MenuScoreWeights,
  MenuStrategyId,
  ProteinSourceType,
  SelectedItem,
  TargetMenuProfile,
} from '../types'
import { MENU_STRATEGIES, PROTEIN_SOURCES, mealTypeIncludesBreakfast, mealTypeIncludesLunchOrDinner } from '../types'
import { computeAllItemCalcs } from './calculations'

// =============================================================================
// Menu Optimization Engine
// -----------------------------------------------------------------------------
// این ماژول منطق اصلی «انتخاب هوشمند غذا و پیشنهاد چند ترکیب بهینه» را پیاده می‌کند. دو
// لایه‌ی امتیازدهی کاملاً مجزا دارد که نباید با هم اشتباه گرفته شوند:
//   • Dish Score  (computeDishScore) — امتیاز ذاتی یک غذای منفرد، مستقل از بقیه‌ی منو.
//   • Menu Score  (computeMenuScoreForProposal) — امتیاز یک ترکیب کامل از چند غذا با هم؛
//     یک منو با میانگین Dish Score بالا لزوماً Menu Score بالا ندارد (مثلاً اگر تنوع منبع
//     پروتئین صفر باشد یا مجموع پروتئین از سقف مجاز رد شده باشد).
//
// هشدار حیاتی: در همه‌ی این فایل «پروتئین/کربوهیدرات/چربی» همیشه یعنی گرم واقعی از
// dish.nutrition (که خودش از درصد ماکروی واقعی رسپی × وزن پرس واقعی محاسبه شده)، هرگز وزن کل
// پرس. جمع‌کردن referencePortionGrams/portionSize به‌جای nutrition.proteinGrams یک باگ محاسباتی
// جدی است (نمونه: یک پرس ۵۰۰ گرمی برنج تقریباً پروتئین صفر دارد، نه ۵۰۰ گرم پروتئین).
// =============================================================================

export interface DishScoreBreakdown {
  total: number
  macroFit: number
  proteinDensity: number
  costEfficiency: number
  wasteRiskSafety: number
  dataConfidence: number
  kitchenFeasibility: number
  varietyContribution: number
  guestAppealProxy: number
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

function activeProfile(settings: MenuOptimizerSettings): TargetMenuProfile {
  return settings.targetMenuProfiles[settings.activeTargetProfileId]
}

/** درصد واقعی هر درشت‌مغذی از مجموع سه‌تای پروتئین/چربی/کربوهیدرات یک غذا (نه چهارتای Macro
 * قدیمی که veg هم دارد) — مبنای مقایسه با Target Menu Profile. */
function macroSharesFromNutrition(proteinGrams: number, fatGrams: number, carbGrams: number) {
  const sum = proteinGrams + fatGrams + carbGrams
  if (sum <= 0) return { proteinSharePercent: 0, fatSharePercent: 0, carbSharePercent: 0 }
  return {
    proteinSharePercent: (proteinGrams / sum) * 100,
    fatSharePercent: (fatGrams / sum) * 100,
    carbSharePercent: (carbGrams / sum) * 100,
  }
}

/** فاصله‌ی منهتن بین دو توزیع درصدی (هرکدام جمعشان ۱۰۰) نرمال‌شده به امتیاز ۰ تا ۱۰۰ — پایه‌ی
 * مشترک Macro Fit Score و Protein Diversity Score؛ حداکثر فاصله‌ی ممکن بین دو توزیع ۲۰۰ است
 * (کاملاً غیرهم‌پوشان)، پس تقسیم بر ۲ آن را به بازه‌ی ۰-۱۰۰ می‌برد. */
function distributionFitScore(actual: Record<string, number>, target: Record<string, number>): number {
  const keys = new Set([...Object.keys(actual), ...Object.keys(target)])
  let manhattan = 0
  for (const k of keys) manhattan += Math.abs((actual[k] ?? 0) - (target[k] ?? 0))
  return clamp(100 - manhattan / 2, 0, 100)
}

// ---------------------------------------------------------------------------
// Dish Score (۰-۱۰۰) — نگاه کنید به DishScoreWeights در types.ts برای وزن هر زیرمعیار.
// ---------------------------------------------------------------------------
export function computeDishScore(dish: Dish, settings: AppSettings): DishScoreBreakdown {
  const opt = settings.menuOptimizer
  const w = opt.dishScoreWeights

  // ۱. Macro Fit: هم‌راستایی ترکیب پروتئین/چربی/کربوهیدرات همین یک غذا با پروفایل هدف فعال.
  const profile = activeProfile(opt)
  const shares = macroSharesFromNutrition(dish.nutrition.proteinGrams, dish.nutrition.fatGrams, dish.nutrition.carbGrams)
  const macroFit = distributionFitScore(
    { protein: shares.proteinSharePercent, fat: shares.fatSharePercent, carb: shares.carbSharePercent },
    { protein: profile.proteinSharePercent, fat: profile.fatSharePercent, carb: profile.carbSharePercent },
  )

  // ۲. Protein Density: گرم پروتئین به ازای هر ۱۰۰ گرم پرس، نسبت به یک مرجع «چگالی پروتئین عالی»
  // (۲۵ گرم/۱۰۰گرم ~ سینه‌ی مرغ خالص) — عمداً به‌جای آستانه‌ی دستی از یک نسبت پیوسته استفاده شده.
  const REFERENCE_PROTEIN_DENSITY = 25
  const densityPer100g = dish.referencePortionGrams > 0 ? (dish.nutrition.proteinGrams / dish.referencePortionGrams) * 100 : 0
  const proteinDensity = clamp((densityPer100g / REFERENCE_PROTEIN_DENSITY) * 100, 0, 100)

  // ۳. Cost Efficiency: گرم پروتئین به ازای هر واحد هزینه — غذای بدون قیمت اصلاً امتیاز نمی‌گیرد
  // (صفر، نه حدس) چون بدون قیمت اساساً نباید توسط موتور به‌طور خودکار انتخاب شود.
  let costEfficiency = 0
  if (dish.costPerServing != null && dish.costPerServing > 0) {
    const proteinPerCost = dish.nutrition.proteinGrams / dish.costPerServing
    // نرمال‌سازی نسبت به یک مرجع محافظه‌کارانه: ۱ گرم پروتئین به ازای هر ۱۰,۰۰۰ ریال = امتیاز کامل.
    const REFERENCE_PROTEIN_PER_RIAL = 1 / 10_000
    costEfficiency = clamp((proteinPerCost / REFERENCE_PROTEIN_PER_RIAL) * 100, 0, 100)
  }

  // ۴. Waste Risk Safety: عکس ضریب اطمینان پایه‌ی ریسک هدررفت — غذای فسادپذیر (حاشیه‌ی امنیت کمتر
  // در تولید) این‌جا امتیاز ایمنی کمتری می‌گیرد، غذای قابل‌نگهداری بیشتر.
  const confidence = settings.confidenceFactorByWasteRisk[dish.wasteRisk] ?? 1
  const wasteRiskSafety = clamp(((confidence - 1) / 0.3) * 100, 0, 100)

  // ۵. Data Confidence: هر پرچم «تأییدنشده/برآوردی/نیاز به بازبینی» امتیاز اطمینان داده را کم می‌کند.
  const confidencePenalties = [
    dish.needsNutritionReview,
    dish.needsPrice,
    dish.needsPortionEstimate,
    dish.proteinSourceVerified === false,
    dish.defaultCookingMethodVerified === false,
  ].filter(Boolean).length
  const dataConfidence = clamp(100 - confidencePenalties * 20, 0, 100)

  // ۶. Kitchen Feasibility (سطح غذا): غذایی که روش پخت آن ظرفیت آشپزخانه‌ی بیشتری دارد
  // (طبق cookingMethodCapacity تنظیمات) امکان‌سنجی راحت‌تری دارد.
  const capacities = Object.values(settings.cookingMethodCapacity)
  const maxCapacity = Math.max(...capacities, 1)
  const methodCapacity = dish.defaultCookingMethod ? (settings.cookingMethodCapacity[dish.defaultCookingMethod] ?? maxCapacity) : maxCapacity
  const kitchenFeasibility = clamp((methodCapacity / maxCapacity) * 100, 0, 100)

  // ۷. Variety Contribution: پروکسی برای «چقدر این غذا به تنوع منو کمک می‌کند» — منابع پروتئین
  // کمیاب‌تر (دریایی/مرغ در برابر گوشت قرمز که معمولاً پرتکرارتر است) و برچسب رژیمی متفاوت
  // امتیاز بیشتری می‌گیرند؛ این یک پروکسی سطح-غذا است، معیار واقعی تنوع سطح-منو در
  // computeMenuVarietyScore پایین‌تر محاسبه می‌شود.
  const RARITY_BONUS: Record<ProteinSourceType, number> = {
    'fish-shrimp': 100,
    'white-meat': 80,
    'plant-other': 60,
    'red-meat': 50,
  }
  const varietyContribution = clamp(RARITY_BONUS[dish.proteinSource] + (dish.dietaryTags.length > 0 ? 10 : 0), 0, 100)

  // ۸. Guest Appeal Proxy: تنها سیگنال واقعی موجود از اقبال مهمانان، سهم پوشش مشاهده‌شده‌ی واقعی
  // رویدادهای قبلی است؛ اگر هنوز داده‌ای ثبت نشده، خنثی (۵۰) در نظر گرفته می‌شود، نه صفر یا صد.
  const guestAppealProxy = dish.observedCoveragePercent != null ? clamp(dish.observedCoveragePercent * 100, 0, 100) : 50

  const total =
    (macroFit * w.macroFit +
      proteinDensity * w.proteinDensity +
      costEfficiency * w.costEfficiency +
      wasteRiskSafety * w.wasteRiskSafety +
      dataConfidence * w.dataConfidence +
      kitchenFeasibility * w.kitchenFeasibility +
      varietyContribution * w.varietyContribution +
      guestAppealProxy * w.guestAppealProxy) /
    sumWeights(w)

  return {
    total: clamp(total, 0, 100),
    macroFit,
    proteinDensity,
    costEfficiency,
    wasteRiskSafety,
    dataConfidence,
    kitchenFeasibility,
    varietyContribution,
    guestAppealProxy,
  }
}

function sumWeights(w: object): number {
  const s = Object.values(w as Record<string, number>).reduce((a, b) => a + b, 0)
  return s > 0 ? s : 1
}

// ---------------------------------------------------------------------------
// توابع ریاضی امتیازدهی سطح-منو
// ---------------------------------------------------------------------------

/**
 * Protein Fit Score — تابع افت گاوسی حول نسبت ۱ (پروتئین واقعی = پروتئین هدف)، نه آستانه‌ی
 * دستی. sigma (پهنای منحنی) از تنظیمات قابل‌تغییر است؛ هرچه sigma کوچک‌تر، مجازات انحراف
 * تندتر. amount=exp(-((ratio-1)^2)/(2·sigma^2))·100 — در ratio=1 دقیقاً ۱۰۰، و با دورشدن از
 * ۱ به‌صورت پیوسته (نه پله‌ای) افت می‌کند.
 */
export function proteinFitScore(actualProteinGrams: number, targetProteinGrams: number, sigma = 0.15): number {
  if (targetProteinGrams <= 0) return 0
  const ratio = actualProteinGrams / targetProteinGrams
  return clamp(100 * Math.exp(-((ratio - 1) ** 2) / (2 * sigma * sigma)), 0, 100)
}

/** Macro Fit Score (سطح-منو) — فاصله‌ی توزیع درصدی واقعی پروتئین/چربی/کربوهیدرات کل منو تا
 * پروفایل هدف فعال؛ همان تابع فاصله‌ی distributionFitScore بالا، نه آستانه‌ی دستی. */
export function macroFitScoreForMenu(totalProteinGrams: number, totalFatGrams: number, totalCarbGrams: number, profile: TargetMenuProfile): number {
  const shares = macroSharesFromNutrition(totalProteinGrams, totalFatGrams, totalCarbGrams)
  return distributionFitScore(
    { protein: shares.proteinSharePercent, fat: shares.fatSharePercent, carb: shares.carbSharePercent },
    { protein: profile.proteinSharePercent, fat: profile.fatSharePercent, carb: profile.carbSharePercent },
  )
}

/** Protein Diversity Score — فاصله‌ی توزیع درصدیِ گرم پروتئین واقعی بین چهار منبع پروتئین تا
 * توزیع هدف تنظیمات (سهم plant-other به‌طور ضمنی از باقیمانده‌ی سه سهم دیگر محاسبه می‌شود). */
export function proteinDiversityScore(gramsBySource: Record<ProteinSourceType, number>, settings: MenuOptimizerSettings): number {
  const totalGrams = PROTEIN_SOURCES.reduce((s, k) => s + (gramsBySource[k] ?? 0), 0)
  if (totalGrams <= 0) return 0
  const actualPercent: Record<string, number> = {}
  for (const k of PROTEIN_SOURCES) actualPercent[k] = ((gramsBySource[k] ?? 0) / totalGrams) * 100

  const target = settings.proteinSourceDistributionTarget
  const plantOtherTarget = clamp(100 - target['red-meat'] - target['white-meat'] - target['fish-shrimp'], 0, 100)
  const targetPercent: Record<string, number> = {
    'red-meat': target['red-meat'],
    'white-meat': target['white-meat'],
    'fish-shrimp': target['fish-shrimp'],
    'plant-other': plantOtherTarget,
  }
  return distributionFitScore(actualPercent, targetPercent)
}

/** Menu Variety Score — میانگین سه نسبت تنوع (منبع پروتئین، روش پخت، دسته‌ی غذایی) هرکدام
 * نسبت به سقف معنادار خودشان (بیش از این تعداد قلم تفاوتی در «تنوع درک‌شده» ایجاد نمی‌کند). */
export function menuVarietyScore(dishes: Pick<Dish, 'proteinSource' | 'defaultCookingMethod' | 'category' | 'name'>[]): number {
  if (dishes.length === 0) return 0
  const distinctProteinSources = new Set(dishes.map((d) => d.proteinSource)).size
  const distinctCookingMethods = new Set(dishes.map((d) => d.defaultCookingMethod).filter(Boolean)).size
  const distinctCategories = new Set(dishes.map((d) => d.category)).size
  const distinctNames = new Set(dishes.map((d) => d.name)).size

  const proteinRatio = clamp(distinctProteinSources / Math.min(4, dishes.length), 0, 1)
  const cookingRatio = clamp(distinctCookingMethods / Math.min(4, dishes.length), 0, 1)
  const categoryRatio = clamp(distinctCategories / Math.min(4, dishes.length), 0, 1)
  const dishTypeRatio = clamp(distinctNames / dishes.length, 0, 1)

  return clamp(((proteinRatio + cookingRatio + categoryRatio + dishTypeRatio) / 4) * 100, 0, 100)
}

/** Kitchen Feasibility Score (سطح-منو) — برای هر روش پخت استفاده‌شده، اگر تعداد اقلامی که
 * هم‌زمان به آن ایستگاه نیاز دارند از ظرفیت تنظیمات بیشتر شود، جریمه‌ی نسبی به میزان عبور از
 * ظرفیت اعمال می‌شود؛ امتیاز نهایی میانگین (۱۰۰ - جریمه) روی همه‌ی ایستگاه‌های درگیر است. */
export function kitchenFeasibilityScoreForMenu(
  dishes: Pick<Dish, 'defaultCookingMethod'>[],
  capacity: Record<CookingMethod, number>,
): number {
  const counts = new Map<CookingMethod, number>()
  for (const d of dishes) {
    if (!d.defaultCookingMethod) continue
    counts.set(d.defaultCookingMethod, (counts.get(d.defaultCookingMethod) ?? 0) + 1)
  }
  if (counts.size === 0) return 100
  let sum = 0
  for (const [method, count] of counts) {
    const cap = capacity[method] ?? count
    const overage = Math.max(0, count - cap) / cap
    sum += clamp(100 - overage * 100, 0, 100)
  }
  return sum / counts.size
}

/**
 * Cost Score — نسبت هزینه‌ی واقعی هر مهمان به بودجه‌ی سرانه؛ رفتار عبور از بودجه از تنظیمات
 * می‌آید: 'exclude' در لایه‌ی Hard Constraint (این تابع اصلاً صدا زده نمی‌شود چون combo قبلش رد
 * شده)، 'penalize' یک افت پیوسته (نه پله‌ای) پس از تحمل مجاز اعمال می‌کند، 'allow' نادیده می‌گیرد.
 */
export function costScoreForMenu(costPerGuest: number | null, budgetPerGuest: number, behavior: BudgetOverrunBehavior, tolerancePercent: number): number {
  if (costPerGuest == null || budgetPerGuest <= 0) return 0
  if (behavior === 'allow') return costPerGuest <= budgetPerGuest ? 100 : clamp(100 - (costPerGuest / budgetPerGuest - 1) * 50, 40, 100)
  const overrunRatio = costPerGuest / budgetPerGuest - 1
  if (overrunRatio <= tolerancePercent) return 100
  // بعد از تحمل مجاز، افت پیوسته و نسبتاً تند (هر ۱۰٪ عبور اضافی ≈ ۲۵ امتیاز کسر).
  const excess = overrunRatio - tolerancePercent
  return clamp(100 - excess * 250, 0, 100)
}

// ---------------------------------------------------------------------------
// Hard / Soft Constraints
// ---------------------------------------------------------------------------

export interface ConstraintCheckResult {
  valid: boolean
  violations: string[]
}

function checkHardConstraints(
  dishes: Dish[],
  totalProteinGrams: number,
  costPerGuest: number | null,
  guestCount: number,
  plan: EventPlan,
  settings: MenuOptimizerSettings,
  mealSlotMixByCategory?: Map<Category, { hasBreakfast: boolean; hasNonBreakfast: boolean }>,
): ConstraintCheckResult {
  const violations: string[] = []

  // اگر نوع وعده رویداد چند وعده را با هم پوشش می‌دهد (مثلاً «صبحانه و ناهار») و در همان دسته
  // امکان مخلوط‌کردن واقعاً وجود دارد (هم گزینه‌ی صبحانه‌ای و هم غیرصبحانه‌ای در دیتابیس هست)،
  // ترکیب نهایی باید از هر دو نوع داشته باشد — وگرنه کل منو فقط یک وعده را پوشش می‌دهد.
  if (mealSlotMixByCategory && isMultiMealSlotEvent(plan)) {
    for (const [category, { hasBreakfast, hasNonBreakfast }] of mealSlotMixByCategory) {
      if (!hasBreakfast || !hasNonBreakfast) continue
      const inCategory = dishes.filter((d) => d.category === category)
      const comboHasBreakfast = inCategory.some((d) => d.isBreakfastItem)
      const comboHasNonBreakfast = inCategory.some((d) => !d.isBreakfastItem)
      if (!comboHasBreakfast || !comboHasNonBreakfast) {
        violations.push(
          `دسته «${category}» باید هم گزینه‌ی مناسب صبحانه و هم غذای ناهار/شام داشته باشد (چون نوع وعده «${plan.mealType}» چند وعده را با هم پوشش می‌دهد).`,
        )
      }
    }
  }

  const proteinTarget = guestCount * settings.proteinTargetGramsPerGuest
  const proteinMax = proteinTarget * settings.proteinMaxMultiplier
  if (totalProteinGrams > proteinMax) {
    violations.push(
      `پروتئین کل (${Math.round(totalProteinGrams)} گرم) از سقف مجاز (${Math.round(proteinMax)} گرم = ${settings.proteinMaxMultiplier}× هدف) عبور کرده است.`,
    )
  }

  const dishIds = new Set(dishes.map((d) => d.id))
  for (const [dishId, constraint] of Object.entries(plan.dishConstraints)) {
    if (constraint === 'must-include' && !dishIds.has(dishId)) {
      violations.push(`غذای الزامی (Must Include) با شناسه «${dishId}» در ترکیب حضور ندارد.`)
    }
    if (constraint === 'must-exclude' && dishIds.has(dishId)) {
      violations.push(`غذای ممنوع (Must Exclude) با شناسه «${dishId}» در ترکیب حضور دارد.`)
    }
  }

  const budgetPerGuest = plan.perPersonBudget
  if (settings.budgetOverrunBehavior === 'exclude' && costPerGuest != null && budgetPerGuest > 0) {
    const overrunRatio = costPerGuest / budgetPerGuest - 1
    if (overrunRatio > settings.budgetOverrunTolerancePercent) {
      violations.push(`هزینه هر مهمان (${Math.round(costPerGuest)}) بیش از تحمل مجاز از بودجه سرانه عبور کرده و رفتار تنظیمات «حذف کامل» است.`)
    }
  }

  const countByCategory = new Map<Category, number>()
  for (const d of dishes) countByCategory.set(d.category, (countByCategory.get(d.category) ?? 0) + 1)
  for (const [category, min] of Object.entries(settings.minDishesPerCategory) as [Category, number][]) {
    if ((countByCategory.get(category) ?? 0) < min) {
      violations.push(`تعداد اقلام دسته «${category}» کمتر از حداقل تنظیم‌شده (${min}) است.`)
    }
  }
  for (const [category, max] of Object.entries(settings.maxDishesPerCategory) as [Category, number][]) {
    if ((countByCategory.get(category) ?? 0) > max) {
      violations.push(`تعداد اقلام دسته «${category}» بیشتر از حداکثر تنظیم‌شده (${max}) است.`)
    }
  }

  return { valid: violations.length === 0, violations }
}

// ---------------------------------------------------------------------------
// Menu Score (سطح-منو) — ترکیب هفت زیرمعیار طبق MenuScoreWeights.
// ---------------------------------------------------------------------------

export interface MenuScoreInputs {
  dishes: Dish[]
  costPerGuest: number | null
  guestCount: number
  settings: AppSettings
  plan: EventPlan
  avgDishScore: number
}

export interface CandidateServing {
  dish: Dish
  /** تعداد پرس واقعی این غذا که برای کل رویداد پیش‌بینی می‌شود — از همان فرمول خودکار سهم پوشش
   * که در بقیه‌ی اپ استفاده می‌شود (نگاه کنید به computeAllItemCalcs در calculations.ts)، نه
   * فرض ساده‌انگارانه‌ی «هر غذا برای همه‌ی مهمانان پخش می‌شود». */
  coverageCount: number
  /** = coverageCount × ضریب اطمینان (شامل ذخیره‌ی احتیاطی) — همان مبنایی که totalItemCost با آن
   * محاسبه شده؛ نگاه کنید به batchQuantity در calculations.ts. */
  batchQuantity: number
  totalItemCost: number | null
}

/**
 * هشدار حیاتی رفع‌شده در این تابع: جمع‌کردن مستقیم dish.nutrition.proteinGrams روی همه‌ی
 * غذاهای یک ترکیب، بدون ضرب در تعداد پرس واقعی هرکدام، پروتئین کل رویداد را با پروتئین یک پرس
 * واحد اشتباه می‌گیرد و برای رویدادهای چندنفره کاملاً غلط است (مثلاً برای ۱۸۰ مهمان، جمع خام
 * چند پرس در حد صدها گرم می‌شود، در حالی که هدف واقعی ده‌ها هزار گرم است). این تابع دقیقاً همان
 * فرمول خودکار سهم پوشش موجود در بقیه‌ی اپ (rawCoverageWeight/coveragePercent/coverageCount)
 * را از طریق computeAllItemCalcs فراخوانی می‌کند تا «چند پرس از این غذا واقعاً پخته می‌شود»
 * را به‌جای فرض دلبخواه، از منطق تجاری واقعی و یک‌بار-تعریف‌شده‌ی پروژه بگیرد.
 */
export function computeCandidateServings(dishes: Dish[], plan: EventPlan, settings: AppSettings): CandidateServing[] {
  const selectedItems: SelectedItem[] = dishes.map((d) => ({
    itemId: d.id,
    dishId: d.id,
    tier: 'استاندارد',
    portionSize: d.referencePortionGrams,
    cookingMethod: d.defaultCookingMethod ?? undefined,
  }))
  const syntheticPlan: EventPlan = { ...plan, selectedItems }
  const dishesById = new Map(dishes.map((d) => [d.id, d]))
  const itemCalcs = computeAllItemCalcs(syntheticPlan, dishesById, settings)
  return itemCalcs.map((calc) => ({
    dish: dishesById.get(calc.dishId)!,
    coverageCount: calc.coverageCount,
    batchQuantity: calc.batchQuantity,
    totalItemCost: calc.totalItemCost,
  }))
}

export interface MenuScoreBreakdown {
  total: number
  proteinFit: number
  macroFit: number
  proteinDiversity: number
  menuVariety: number
  kitchenFeasibility: number
  costFit: number
  avgDishScore: number
  totalProteinGrams: number
  totalFatGrams: number
  totalCarbGrams: number
  proteinSourceBreakdownPercent: Record<ProteinSourceType, number>
}

export function computeMenuScore({ dishes, costPerGuest, guestCount, settings, plan, avgDishScore }: MenuScoreInputs): MenuScoreBreakdown {
  const opt = settings.menuOptimizer
  const w: MenuScoreWeights = opt.menuScoreWeights

  const servings = computeCandidateServings(dishes, plan, settings)
  const totalProteinGrams = servings.reduce((s, c) => s + c.coverageCount * c.dish.nutrition.proteinGrams, 0)
  const totalFatGrams = servings.reduce((s, c) => s + c.coverageCount * c.dish.nutrition.fatGrams, 0)
  const totalCarbGrams = servings.reduce((s, c) => s + c.coverageCount * c.dish.nutrition.carbGrams, 0)

  const gramsBySource: Record<ProteinSourceType, number> = { 'red-meat': 0, 'white-meat': 0, 'fish-shrimp': 0, 'plant-other': 0 }
  for (const c of servings) gramsBySource[c.dish.proteinSource] += c.coverageCount * c.dish.nutrition.proteinGrams
  const totalForBreakdown = PROTEIN_SOURCES.reduce((s, k) => s + gramsBySource[k], 0)
  const proteinSourceBreakdownPercent: Record<ProteinSourceType, number> = { 'red-meat': 0, 'white-meat': 0, 'fish-shrimp': 0, 'plant-other': 0 }
  if (totalForBreakdown > 0) {
    for (const k of PROTEIN_SOURCES) proteinSourceBreakdownPercent[k] = (gramsBySource[k] / totalForBreakdown) * 100
  }

  const proteinTarget = guestCount * opt.proteinTargetGramsPerGuest
  const proteinFit = proteinFitScore(totalProteinGrams, proteinTarget)
  const macroFit = macroFitScoreForMenu(totalProteinGrams, totalFatGrams, totalCarbGrams, activeProfile(opt))
  const proteinDiversity = proteinDiversityScore(gramsBySource, opt)
  const variety = menuVarietyScore(dishes)
  const kitchenFeasibility = kitchenFeasibilityScoreForMenu(dishes, settings.cookingMethodCapacity)
  const costFit = costScoreForMenu(costPerGuest, plan.perPersonBudget, opt.budgetOverrunBehavior, opt.budgetOverrunTolerancePercent)

  const total =
    (proteinFit * w.proteinFit +
      macroFit * w.macroFit +
      proteinDiversity * w.proteinDiversity +
      variety * w.menuVariety +
      kitchenFeasibility * w.kitchenFeasibility +
      costFit * w.costFit +
      avgDishScore * w.avgDishScore) /
    sumWeights(w)

  return {
    total: clamp(total, 0, 100),
    proteinFit,
    macroFit,
    proteinDiversity,
    menuVariety: variety,
    kitchenFeasibility,
    costFit,
    avgDishScore,
    totalProteinGrams,
    totalFatGrams,
    totalCarbGrams,
    proteinSourceBreakdownPercent,
  }
}

// ---------------------------------------------------------------------------
// جست‌وجوی ترکیب‌های کاندید — Beam Search دومرحله‌ای.
// -----------------------------------------------------------------------------
// نگاشت پراگماتیک ۱۷ گام مفهومی مشخصات روی این پیاده‌سازی واقعی (چون جست‌وجوی کامل
// ترکیبیاتی روی ~۸۰ غذای هر دسته عملاً غیرقابل‌اجراست):
//   گام‌های ۱-۴ (فیلتر مرتبط‌بودن + حذف Must Exclude + الزام قیمت + محاسبه‌ی Dish Score)
//     → buildCandidatePool
//   گام‌های ۵-۷ (کوتاه‌لیست هر دسته + تولید زیرمجموعه‌های هر دسته با اندازه‌ی مجاز)
//     → shortlistByCategory + categoryCombinations
//   گام‌های ۸-۱۲ (ترکیب مرحله‌به‌مرحله‌ی دسته‌ها با نگه‌داشتن Beam برتر + اعمال Must Include)
//     → beamCombineAcrossCategories
//   گام‌های ۱۳-۱۴ (فیلتر Hard Constraint نهایی) → filter با checkHardConstraints
//   گام‌های ۱۵-۱۷ (بازچینش بر اساس هر Strategy + انتخاب N پیشنهاد واقعاً متفاوت)
//     → generateMenuProposals
// این مسیر عملکرد را با هر حجم داده‌ی واقعی این پروژه (صدها غذا) در حد میلی‌ثانیه نگه می‌دارد.
// ---------------------------------------------------------------------------

const SHORTLIST_SIZE_PER_CATEGORY = 10
const BEAM_WIDTH = 150
/** چند جفت‌شدن برتر (با منوی جزئی مرحله‌ی قبل) برای هر ترکیب متمایز یک دسته در Beam نگه داشته
 * می‌شود — نگاه کنید به توضیح داخل beamCombineAcrossCategories. */
const PER_COMBO_KEEP = 5

interface CandidateDish {
  dish: Dish
  dishScore: number
}

function buildCandidatePool(dishes: Dish[], plan: EventPlan, settings: AppSettings): { pool: Dish[]; scores: Map<string, number>; warnings: string[] } {
  const warnings: string[] = []
  // همان فیلتر «مرتبط‌بودن با نوع وعده» که صفحه‌ی انتخاب غذا هم استفاده می‌کند (نگاه کنید به
  // CategorySection در DishSelectionPage.tsx) — وگرنه موتور برای یک رویداد شام، غذای مخصوص
  // صبحانه (مثل پنکیک) پیشنهاد می‌دهد. نوشیدنی مستقل از نوع وعده است.
  const showBreakfast = mealTypeIncludesBreakfast(plan.mealType)
  const showLunchDinner = mealTypeIncludesLunchOrDinner(plan.mealType)
  const pool = dishes.filter((d) => {
    const constraint = plan.dishConstraints[d.id]
    if (constraint === 'must-exclude') return false
    // الزام دستی کاربر (Must Include) حتی از فیلتر مرتبط‌بودن با وعده هم مهم‌تر است.
    const mealRelevant = d.category === 'نوشیدنی' || (d.isBreakfastItem ? showBreakfast : showLunchDinner)
    if (!mealRelevant && constraint !== 'must-include') return false
    if (d.costPerServing == null) {
      warnings.push(`«${d.name}»: قیمت نامشخص است (Price Required) — از تولید خودکار ترکیب کنار گذاشته شد.`)
      return false
    }
    return true
  })
  const scores = new Map<string, number>()
  for (const d of pool) scores.set(d.id, computeDishScore(d, settings).total)
  return { pool, scores, warnings }
}

/** آیا این رویداد واقعاً بیش از یک «وعده» را هم‌زمان پوشش می‌دهد (مثلاً «صبحانه و ناهار») —
 * در این حالت دسته‌هایی مثل غذای اصلی باید همزمان از هر دو نوع (صبحانه‌ای/غیرصبحانه‌ای) داشته
 * باشند، نه اینکه کل ترکیب صرفاً یکی از دو وعده را پوشش دهد. */
function isMultiMealSlotEvent(plan: EventPlan): boolean {
  return mealTypeIncludesBreakfast(plan.mealType) && mealTypeIncludesLunchOrDinner(plan.mealType)
}

function shortlistByCategory(pool: Dish[], scores: Map<string, number>, plan: EventPlan, category: Category): CandidateDish[] {
  const inCategory = pool.filter((d) => d.category === category)
  const mustInclude = inCategory.filter((d) => plan.dishConstraints[d.id] === 'must-include')
  const preferred = inCategory.filter((d) => plan.dishConstraints[d.id] === 'preferred')
  const rest = inCategory.filter((d) => !plan.dishConstraints[d.id])

  const rank = (list: Dish[]) => [...list].sort((a, b) => (scores.get(b.id) ?? 0) - (scores.get(a.id) ?? 0))
  const rankedPreferred = rank(preferred)

  // اگر نوع وعده رویداد چند وعده را با هم پوشش می‌دهد (مثلاً «صبحانه و ناهار»)، کوتاه‌لیست باید
  // از هر دو نوع (صبحانه‌ای/غیرصبحانه‌ای) نماینده داشته باشد — وگرنه چون معمولاً امتیاز غذاهای
  // غیرصبحانه‌ای بالاتر است، کل کوتاه‌لیست (و در نتیجه هر ترکیبی که از آن ساخته شود) فقط از یک
  // وعده پر می‌شود و وعده‌ی دیگر اصلاً در پیشنهاد نهایی ظاهر نمی‌شود.
  let rankedRest: Dish[]
  if (isMultiMealSlotEvent(plan) && category !== 'نوشیدنی') {
    const breakfastRest = rank(rest.filter((d) => d.isBreakfastItem))
    const nonBreakfastRest = rank(rest.filter((d) => !d.isBreakfastItem))
    if (breakfastRest.length > 0 && nonBreakfastRest.length > 0) {
      const half = Math.ceil(SHORTLIST_SIZE_PER_CATEGORY / 2)
      rankedRest = [...breakfastRest.slice(0, half), ...nonBreakfastRest.slice(0, half)]
    } else {
      rankedRest = rank(rest)
    }
  } else {
    rankedRest = rank(rest)
  }

  const combined = [...mustInclude, ...rankedPreferred, ...rankedRest].slice(0, Math.max(SHORTLIST_SIZE_PER_CATEGORY, mustInclude.length))
  const seen = new Set<string>()
  const deduped = combined.filter((d) => (seen.has(d.id) ? false : (seen.add(d.id), true)))
  return deduped.map((d) => ({ dish: d, dishScore: scores.get(d.id) ?? 0 }))
}

function combinationsOfSize<T>(items: T[], size: number): T[][] {
  if (size === 0) return [[]]
  if (size > items.length) return []
  const result: T[][] = []
  function backtrack(start: number, current: T[]) {
    if (current.length === size) {
      result.push([...current])
      return
    }
    for (let i = start; i < items.length; i++) {
      current.push(items[i])
      backtrack(i + 1, current)
      current.pop()
    }
  }
  backtrack(0, [])
  return result
}

/** همه‌ی زیرمجموعه‌های یک دسته با اندازه‌ی بین min و max، با اجبار حضور Must Include. */
function categoryCombinations(shortlist: CandidateDish[], mustIncludeIds: Set<string>, min: number, max: number): CandidateDish[][] {
  const mustHave = shortlist.filter((c) => mustIncludeIds.has(c.dish.id))
  const optional = shortlist.filter((c) => !mustIncludeIds.has(c.dish.id))
  const combos: CandidateDish[][] = []
  for (let size = Math.max(min, mustHave.length); size <= Math.min(max, shortlist.length); size++) {
    const optionalSize = size - mustHave.length
    if (optionalSize < 0) continue
    for (const extra of combinationsOfSize(optional, optionalSize)) {
      combos.push([...mustHave, ...extra])
    }
  }
  // اگر هیچ ترکیبی در بازه‌ی مجاز پیدا نشد (کوتاه‌لیست خیلی کوچک بود)، حداقل خودِ کوتاه‌لیست
  // به‌عنوان یک ترکیب واحد برگردانده می‌شود تا آن دسته کاملاً از قلم نیفتد.
  return combos.length > 0 ? combos : [shortlist]
}

interface PartialMenu {
  dishes: CandidateDish[]
  avgScoreSoFar: number
}

/**
 * پروکسی سریع «امتیاز جزئی» یک منوی نیمه‌ساخته، مخصوص هر Strategy — طراحی‌شده تا حین خودِ
 * Beam Search هم به‌کار برود (نه فقط در بازچینش نهایی). اگر همه‌ی Strategy ها از یک پروکسی
 * یکسان (مثل میانگین Dish Score خام) استفاده کنند، Beam Search همیشه به سمت همان چند ترکیب
 * «به‌طور کلی خوب» همگرا می‌شود و پیشنهادهای نهایی عملاً یکی از آب درمی‌آیند — دقیقاً همان
 * مشکلی که این تابع حل می‌کند: هر Strategy از همان مرحله‌ی جست‌وجو مسیر متفاوتی را دنبال می‌کند.
 */
function strategyPartialScore(dishes: CandidateDish[], strategy: MenuStrategyId): number {
  if (dishes.length === 0) return 0
  const avgDishScore = dishes.reduce((s, d) => s + d.dishScore, 0) / dishes.length

  if (strategy === 'cost-optimized') {
    // ارزان‌تر بودن پرس (نسبت به یک مرجع محافظه‌کارانه‌ی ۱۰۰۰,۰۰۰ ریال) امتیاز بیشتری می‌گیرد.
    const REFERENCE_COST = 1_000_000
    const avgCostScore = dishes.reduce((s, d) => s + clamp(100 - ((d.dish.costPerServing ?? 0) / REFERENCE_COST) * 100, 0, 100), 0) / dishes.length
    return avgCostScore * 0.7 + avgDishScore * 0.3
  }
  if (strategy === 'nutrition-optimized') {
    // چگالی پروتئین بالاتر و پروتئین بیشتر در همین مرحله ترجیح داده می‌شود.
    const avgProteinGrams = dishes.reduce((s, d) => s + d.dish.nutrition.proteinGrams, 0) / dishes.length
    const proteinScore = clamp((avgProteinGrams / 60) * 100, 0, 100)
    return proteinScore * 0.6 + avgDishScore * 0.4
  }
  if (strategy === 'kitchen-optimized') {
    const distinctMethods = new Set(dishes.map((d) => d.dish.defaultCookingMethod).filter(Boolean)).size
    const repeatPenalty = dishes.length > 0 ? (dishes.length - distinctMethods) / dishes.length : 0
    return clamp(100 - repeatPenalty * 100, 0, 100) * 0.6 + avgDishScore * 0.4
  }
  if (strategy === 'variety-optimized') {
    const distinctSources = new Set(dishes.map((d) => d.dish.proteinSource)).size
    const distinctMethods = new Set(dishes.map((d) => d.dish.defaultCookingMethod).filter(Boolean)).size
    const varietyProxy = clamp(((distinctSources + distinctMethods) / (dishes.length * 2)) * 100, 0, 100)
    return varietyProxy * 0.6 + avgDishScore * 0.4
  }
  return avgDishScore
}

/** Beam Search چندمرحله‌ای: دسته‌ها را یکی‌یکی اضافه می‌کند و بعد از هر مرحله فقط بهترین
 * BEAM_WIDTH منوی جزئی (بر اساس پروکسی strategyPartialScore همان Strategy) را نگه می‌دارد —
 * دقیقاً همان ایده‌ی Beam Search ولی محدود به دسته‌های واقعی پروژه. */
function beamCombineAcrossCategories(perCategoryCombos: CandidateDish[][][], strategy: MenuStrategyId): PartialMenu[] {
  let beam: PartialMenu[] = [{ dishes: [], avgScoreSoFar: 0 }]
  for (const combosForCategory of perCategoryCombos) {
    // اگر همین‌جا صرفاً BEAM_WIDTH منوی جزئیِ برتر (بر اساس امتیاز خام) نگه داشته شود، وقتی یک
    // ترکیب خاص از همین دسته (مثلاً یک زیرمجموعه‌ی «پیش‌غذا») واقعاً با هر چیزی امتیاز بالایی
    // می‌گیرد، می‌تواند تنها بازمانده‌ی این دسته در کل Beam شود و همه‌ی گزینه‌های دیگر همین دسته
    // را برای همیشه حذف کند — نتیجه: هر ۵ پیشنهاد نهایی، مستقل از Strategy، همان یک ترکیب ثابت
    // «پیش‌غذا/نوشیدنی» را نشان می‌دهند (دقیقاً همان چیزی که کاربر «غذاهای تکراری» گزارش کرد).
    // برای جلوگیری، به‌جای نگه‌داشتن فقط یک جفت‌شدن (که می‌تواند همیشه با همان «دسته‌ی غالبِ
    // مراحل قبل» جفت شود و تنوع دسته‌های قبلی را هم همین‌جا از بین ببرد)، برای هر ترکیب متمایز
    // همین دسته چند جفت‌شدن برتر (PER_COMBO_KEEP) با منوی‌های جزئی قبلی نگه داشته می‌شود — تا هم
    // تنوع همین دسته و هم بخشی از تنوع دسته‌های قبلی تا انتهای جست‌وجو زنده بماند — و فقط بعد از
    // آن BEAM_WIDTH نمونه‌ی برتر از میان همه‌ی این‌ها انتخاب می‌شود.
    const byComboKey = new Map<string, PartialMenu[]>()
    for (const partial of beam) {
      for (const combo of combosForCategory) {
        const dishes = [...partial.dishes, ...combo]
        const avgScoreSoFar = strategyPartialScore(dishes, strategy)
        const comboKey = dishSetKey(combo.map((c) => c.dish))
        const list = byComboKey.get(comboKey)
        if (list) list.push({ dishes, avgScoreSoFar })
        else byComboKey.set(comboKey, [{ dishes, avgScoreSoFar }])
      }
    }
    const next: PartialMenu[] = []
    for (const list of byComboKey.values()) {
      list.sort((a, b) => b.avgScoreSoFar - a.avgScoreSoFar)
      next.push(...list.slice(0, PER_COMBO_KEEP))
    }
    next.sort((a, b) => b.avgScoreSoFar - a.avgScoreSoFar)
    beam = next.slice(0, BEAM_WIDTH)
  }
  return beam
}

interface ScoredMenu {
  dishes: Dish[]
  servings: CandidateServing[]
  costPerGuest: number | null
  totalCost: number | null
  missingPriceDishIds: string[]
  avgDishScore: number
  menuScore: MenuScoreBreakdown
  overallScore: number
}

const STRATEGY_WEIGHT_OVERRIDES: Record<MenuStrategyId, Partial<MenuScoreWeights>> = {
  'best-balanced': {},
  'cost-optimized': { costFit: 45, proteinFit: 15, macroFit: 10, proteinDiversity: 10, menuVariety: 10, kitchenFeasibility: 5, avgDishScore: 5 },
  'nutrition-optimized': { proteinFit: 35, macroFit: 30, proteinDiversity: 15, menuVariety: 5, kitchenFeasibility: 5, costFit: 5, avgDishScore: 5 },
  'kitchen-optimized': { kitchenFeasibility: 45, proteinFit: 15, macroFit: 10, proteinDiversity: 5, menuVariety: 10, costFit: 10, avgDishScore: 5 },
  'variety-optimized': { menuVariety: 35, proteinDiversity: 30, proteinFit: 10, macroFit: 10, kitchenFeasibility: 5, costFit: 5, avgDishScore: 5 },
}

function overallScoreForStrategy(menuScore: MenuScoreBreakdown, strategy: MenuStrategyId, baseWeights: MenuScoreWeights): number {
  const w = { ...baseWeights, ...STRATEGY_WEIGHT_OVERRIDES[strategy] }
  const total =
    (menuScore.proteinFit * w.proteinFit +
      menuScore.macroFit * w.macroFit +
      menuScore.proteinDiversity * w.proteinDiversity +
      menuScore.menuVariety * w.menuVariety +
      menuScore.kitchenFeasibility * w.kitchenFeasibility +
      menuScore.costFit * w.costFit +
      menuScore.avgDishScore * w.avgDishScore) /
    sumWeights(w)
  return clamp(total, 0, 100)
}

function dishSetKey(dishes: Dish[]): string {
  return [...dishes.map((d) => d.id)].sort().join('|')
}

export interface GenerateMenuProposalsOptions {
  categories?: Category[]
}

/** نقطه‌ی ورود اصلی موتور — از روی پلن/تنظیمات/دیتابیس غذا چند پیشنهاد منوی واقعاً متفاوت
 * می‌سازد. اگر categories داده نشود، همه‌ی چهار دسته لحاظ می‌شوند. */
export function generateMenuProposals(dishes: Dish[], plan: EventPlan, settings: AppSettings, options: GenerateMenuProposalsOptions = {}): { proposals: MenuProposal[]; warnings: string[] } {
  const opt = settings.menuOptimizer
  const categories: Category[] = options.categories ?? ['غذای اصلی', 'پیش‌غذا', 'دسر', 'نوشیدنی']
  const { pool, scores, warnings } = buildCandidatePool(dishes, plan, settings)

  // برای هر دسته، آیا در استخر کاندید واقعاً هم گزینه‌ی صبحانه‌ای و هم غیرصبحانه‌ای وجود دارد؟
  // مبنای Hard Constraint «مخلوط‌بودن وعده» پایین‌تر — فقط جایی اعمال می‌شود که واقعاً ممکن باشد.
  const mealSlotMixByCategory = new Map<Category, { hasBreakfast: boolean; hasNonBreakfast: boolean }>()
  for (const category of categories) {
    if (category === 'نوشیدنی') continue
    const inCategory = pool.filter((d) => d.category === category)
    mealSlotMixByCategory.set(category, {
      hasBreakfast: inCategory.some((d) => d.isBreakfastItem),
      hasNonBreakfast: inCategory.some((d) => !d.isBreakfastItem),
    })
  }

  const perCategoryCombos: CandidateDish[][][] = categories.map((category) => {
    const shortlist = shortlistByCategory(pool, scores, plan, category)
    const mustIncludeIds = new Set(shortlist.filter((c) => plan.dishConstraints[c.dish.id] === 'must-include').map((c) => c.dish.id))
    const min = settings.menuOptimizer.minDishesPerCategory[category] ?? 1
    const max = settings.menuOptimizer.maxDishesPerCategory[category] ?? shortlist.length
    const combos = categoryCombinations(shortlist, mustIncludeIds, min, max)

    // اگر این دسته باید هم صبحانه و هم غیرصبحانه داشته باشد (نگاه کنید به mealSlotMixByCategory)،
    // ترکیب‌های تک‌نوعی همین‌جا (پیش از Beam Search) حذف می‌شوند — وگرنه هرس Beam Search
    // (که فقط بر اساس امتیاز پیش می‌رود، نه ترکیب وعده) ممکن است همه‌ی گزینه‌های واقعاً مخلوط را
    // پیش از رسیدن به بررسی نهایی Hard Constraint کنار بگذارد و هیچ پیشنهاد معتبری باقی نماند.
    const mix = mealSlotMixByCategory.get(category)
    if (mix?.hasBreakfast && mix.hasNonBreakfast) {
      const mixedOnly = combos.filter(
        (combo) => combo.some((c) => c.dish.isBreakfastItem) && combo.some((c) => !c.dish.isBreakfastItem),
      )
      if (mixedOnly.length > 0) return mixedOnly
    }
    return combos
  })

  // هر Strategy، Beam Search خودش را با پروکسی امتیازدهی مخصوص خودش اجرا می‌کند (نگاه کنید به
  // strategyPartialScore) — اگر همه از یک Beam مشترک استفاده کنند، جست‌وجو همیشه به سمت همان
  // چند ترکیب «کلی خوب» همگرا می‌شود و پیشنهادهای نهایی عملاً یکی از آب درمی‌آیند. پول نهایی
  // اتحاد (union) خروجی همه‌ی این Beam هاست، پس واقعاً از مسیرهای جست‌وجوی متفاوت آمده‌اند.
  const scoredMenusByKey = new Map<string, ScoredMenu>()
  for (const strategy of MENU_STRATEGIES) {
    const beam = beamCombineAcrossCategories(perCategoryCombos, strategy)
    for (const partial of beam) {
      const dishList = partial.dishes.map((c) => c.dish)
      const key = dishSetKey(dishList)
      if (scoredMenusByKey.has(key)) continue

      const servings = computeCandidateServings(dishList, plan, settings)
      const totalProteinGrams = servings.reduce((s, c) => s + c.coverageCount * c.dish.nutrition.proteinGrams, 0)
      const hardCheck = checkHardConstraints(dishList, totalProteinGrams, null, plan.guestCount, plan, opt, mealSlotMixByCategory)

      const missingPriceDishIds = dishList.filter((d) => d.costPerServing == null).map((d) => d.id)
      const totalCost = missingPriceDishIds.length > 0 ? null : servings.reduce((s, c) => s + (c.totalItemCost ?? 0), 0)
      const costPerGuest = totalCost != null && plan.guestCount > 0 ? totalCost / plan.guestCount : null

      // بازبینی مجدد Hard Constraint بودجه اکنون که costPerGuest واقعی محاسبه شده.
      const fullHardCheck = checkHardConstraints(dishList, totalProteinGrams, costPerGuest, plan.guestCount, plan, opt, mealSlotMixByCategory)
      if (!hardCheck.valid || !fullHardCheck.valid) continue

      const avgDishScore = dishList.length > 0 ? dishList.reduce((s, d) => s + (scores.get(d.id) ?? 0), 0) / dishList.length : 0
      const menuScore = computeMenuScore({ dishes: dishList, costPerGuest, guestCount: plan.guestCount, settings, plan, avgDishScore })
      scoredMenusByKey.set(key, {
        dishes: dishList,
        servings,
        costPerGuest,
        totalCost,
        missingPriceDishIds,
        avgDishScore,
        menuScore,
        overallScore: menuScore.total,
      })
    }
  }
  const scoredMenus = [...scoredMenusByKey.values()]

  const proposals: MenuProposal[] = []
  const usedSetKeys = new Set<string>()
  // چند بار هر شناسه‌ی غذا تا این لحظه در یکی از پیشنهادهای قبلاً انتخاب‌شده حضور داشته —
  // مبنای جریمه‌ی تنوع پایین‌تر (نگاه کنید به overlapPenalty).
  const usedDishCounts = new Map<string, number>()
  const numberOfProposals = opt.numberOfProposals
  const strategyOrder: MenuStrategyId[] =
    numberOfProposals <= 3 ? ['best-balanced', 'cost-optimized', 'nutrition-optimized'] : [...MENU_STRATEGIES]

  /**
   * چرا این تابع لازم است: shortlistByCategory هر دسته را به یک کوتاه‌لیست ثابت (بر اساس Dish
   * Score، مستقل از Strategy) محدود می‌کند؛ اگر در یک دسته چند غذا از نظر امتیاز خیلی به هم نزدیک
   * باشند (مثلاً «پیش‌غذا» با ده‌ها گزینه‌ی قیمت‌دار)، ممکن است بالاترین‌امتیاز هر Strategy روی
   * همان زیرمجموعه‌ی ثابت بیفتد و همه‌ی پیشنهادها در آن دسته عملاً یکی از آب دربیایند — همان
   * چیزی که کاربر «غذاهای تکراری» می‌بیند: هر بار همان چند غذا، مستقل از فرمول/Strategy انتخابی.
   * جمع می‌کند چند بار غذاهای یک ترکیب کاندید قبلاً در پیشنهادهای همین دور تولید استفاده شده‌اند.
   */
  function overlapPenalty(candidateDishes: Dish[]): number {
    return candidateDishes.reduce((sum, d) => sum + (usedDishCounts.get(d.id) ?? 0), 0)
  }

  // چند امتیاز (از ۱۰۰) اجازه می‌دهیم برای انتخاب یک ترکیب کم‌تکرارتر به‌جای دقیقاً بالاترین‌امتیاز
  // فدا شود — پنجره‌ای کوچک و محافظه‌کارانه تا کیفیت پیشنهاد قربانی تنوع نشود.
  const DIVERSITY_SCORE_TOLERANCE_POINTS = 8
  const DIVERSITY_CANDIDATE_WINDOW = 8

  // هر Strategy را با وزن‌های خودش بازچینش می‌کند؛ در میان چند کاندید برتر هنوز-استفاده‌نشده که
  // امتیازشان به بالاترین امتیاز نزدیک است، آن‌که کمترین همپوشانی غذا با پیشنهادهای قبلاً
  // انتخاب‌شده دارد را برمی‌دارد (نه صرفاً رتبه‌ی اول را) — تا اگر تعداد پیشنهاد خواسته‌شده بیشتر
  // از تعداد Strategy باشد، پیشنهادها واقعاً «متفاوت» بمانند، نه تکرار همان چند غذای ثابت با
  // برچسب Strategy دیگر.
  let round = 0
  while (proposals.length < numberOfProposals && round < 5) {
    let addedThisRound = false
    for (const strategy of strategyOrder) {
      if (proposals.length >= numberOfProposals) break
      const ranked = [...scoredMenus]
        .filter((m) => !usedSetKeys.has(dishSetKey(m.dishes)))
        .sort(
          (a, b) => overallScoreForStrategy(b.menuScore, strategy, opt.menuScoreWeights) - overallScoreForStrategy(a.menuScore, strategy, opt.menuScoreWeights),
        )
      if (ranked.length === 0) continue

      const topScore = overallScoreForStrategy(ranked[0].menuScore, strategy, opt.menuScoreWeights)
      const candidateWindow = ranked
        .slice(0, DIVERSITY_CANDIDATE_WINDOW)
        .filter((m) => topScore - overallScoreForStrategy(m.menuScore, strategy, opt.menuScoreWeights) <= DIVERSITY_SCORE_TOLERANCE_POINTS)
      // اگر امتیاز یکی از منوها به‌هردلیلی NaN شود (مثلاً داده‌ی ورودی ناقص)، مقایسه‌ی بالا با NaN
      // همیشه false برمی‌گردد و candidateWindow می‌تواند خالی بماند — رتبه‌ی اول خام را به‌عنوان
      // پشتیبان نگه می‌داریم تا موتور در بدترین حالت باز هم یک پیشنهاد معتبر برگرداند، نه کرش.
      const pick = candidateWindow.length > 0
        ? candidateWindow.reduce((best, m) => (overlapPenalty(m.dishes) < overlapPenalty(best.dishes) ? m : best))
        : ranked[0]

      usedSetKeys.add(dishSetKey(pick.dishes))
      for (const d of pick.dishes) usedDishCounts.set(d.id, (usedDishCounts.get(d.id) ?? 0) + 1)
      proposals.push(buildMenuProposal(pick, strategy, settings))
      addedThisRound = true
    }
    round += 1
    if (!addedThisRound) break
  }

  return { proposals, warnings }
}

function buildMenuProposal(menu: ScoredMenu, strategyId: MenuStrategyId, settings: AppSettings): MenuProposal {
  const servingByDishId = new Map(menu.servings.map((s) => [s.dish.id, s]))
  const proposalDishes: MenuProposalDish[] = menu.dishes.map((d) => {
    const serving = servingByDishId.get(d.id)
    return {
      dishId: d.id,
      dishName: d.name,
      category: d.category,
      proteinSource: d.proteinSource,
      cookingMethod: d.defaultCookingMethod,
      portionGrams: d.referencePortionGrams,
      proteinGrams: d.nutrition.proteinGrams,
      carbGrams: d.nutrition.carbGrams,
      fatGrams: d.nutrition.fatGrams,
      costPerServing: d.costPerServing,
      coverageCount: serving?.coverageCount ?? 0,
      servingCount: serving?.batchQuantity ?? 0,
      totalCost: serving?.totalItemCost ?? null,
      dishScore: computeDishScore(d, settings).total,
      needsNutritionReview: d.needsNutritionReview,
    }
  })

  const warnings: string[] = []
  if (menu.missingPriceDishIds.length > 0) {
    warnings.push('برخی اقلام این ترکیب قیمت ندارند؛ هزینه کل قابل محاسبه نیست (Price Required).')
  }
  const nutritionReviewCount = menu.dishes.filter((d) => d.needsNutritionReview).length
  if (nutritionReviewCount > 0) {
    warnings.push(`${nutritionReviewCount} قلم این ترکیب فاقد کارت رسپی واقعی‌اند و مقادیر تغذیه‌ای‌شان برآوردی است (نیاز به بازبینی).`)
  }

  return {
    id: `${strategyId}-${dishSetKey(menu.dishes).slice(0, 24)}`,
    strategyId,
    dishes: proposalDishes,
    totalProteinGrams: menu.menuScore.totalProteinGrams,
    totalCarbGrams: menu.menuScore.totalCarbGrams,
    totalFatGrams: menu.menuScore.totalFatGrams,
    costPerGuest: menu.costPerGuest,
    totalCost: menu.totalCost,
    missingPriceDishIds: menu.missingPriceDishIds,
    proteinFitScore: menu.menuScore.proteinFit,
    macroFitScore: menu.menuScore.macroFit,
    proteinDiversityScore: menu.menuScore.proteinDiversity,
    menuVarietyScore: menu.menuScore.menuVariety,
    kitchenFeasibilityScore: menu.menuScore.kitchenFeasibility,
    costScore: menu.menuScore.costFit,
    avgDishScore: menu.avgDishScore,
    menuOptimizationScore: menu.menuScore.total,
    proteinSourceBreakdownPercent: menu.menuScore.proteinSourceBreakdownPercent,
    warnings,
  }
}

export function setDishConstraintLabel(constraint: DishConstraintType | null): string {
  if (constraint === 'must-include') return 'الزامی (Must Include)'
  if (constraint === 'must-exclude') return 'ممنوع (Must Exclude)'
  if (constraint === 'preferred') return 'ترجیحی (Preferred)'
  return 'بدون محدودیت'
}
