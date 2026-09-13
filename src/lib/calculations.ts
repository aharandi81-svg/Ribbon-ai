import type { AppSettings, Category, CookingMethod, Dish, EventPlan, Ingredient, Macro, MacroKey, SelectedItem } from '../types'

const MACRO_KEYS: MacroKey[] = ['carb', 'protein', 'veg', 'fat']
const DRINK_CATEGORY: Category = 'نوشیدنی'
// دسته‌هایی که در محاسبه‌ی ترکیب تغذیه‌ای سفره لحاظ می‌شوند (نوشیدنی طبق مستند محصول مستثناست).
// export شده چون menuOptimizer.ts هم برای محدودکردن محاسبه‌ی سهم منابع پروتئین به همین دسته‌های
// «سفره‌ای» (نه نوشیدنی) از آن استفاده می‌کند — نگاه کنید به gramsBySourceFromServings آنجا.
export const PLATE_CATEGORIES: Category[] = ['غذای اصلی', 'پیش‌غذا', 'دسر']

export function zeroMacro(): Macro {
  return { carb: 0, protein: 0, veg: 0, fat: 0 }
}

/** جمع بهای مواد اولیه یک غذا از روی lineTotal هر قلم — null اگر هیچ‌کدام قیمت واحد نداشته
 * باشند (نه صفر، چون صفر یعنی «رایگان» نه «داده نداریم»؛ نگاه کنید به Dish.ingredientsCostTotal). */
export function computeIngredientsCostTotal(ingredients: Ingredient[] | null | undefined): number | null {
  if (!ingredients || ingredients.length === 0) return null
  const totals = ingredients
    .map((ing) => ing.lineTotal ?? (ing.unitPrice != null ? ing.unitPrice * ing.quantity : null))
    .filter((n): n is number => n != null)
  if (totals.length === 0) return null
  return totals.reduce((s, n) => s + n, 0)
}

export function categoryBudgetAmount(plan: EventPlan, category: Category): number {
  return plan.guestCount * plan.perPersonBudget * (plan.categoryBudgetShare[category] ?? 0)
}

export function tierWeight(item: SelectedItem, settings: AppSettings): number {
  return settings.tierWeights[item.tier]
}

/**
 * ضریب اطمینان مؤثر یک غذا = ضریب پایه‌ی ریسک هدررفت آن غذا (تنظیمات) × ضریب اطمینان دستی رویداد
 * (پیش‌فرض ۱). این جایگزین یک ضریب ثابت سراسری شد چون اعمال همان حاشیه‌ی امنیت روی غذای فسادپذیر
 * و قابل‌نگهداری هزینه‌ی هدررفت کاملاً متفاوتی دارد — نگاه کنید به تعریف WasteRisk در types.ts.
 */
export function effectiveConfidenceFactor(dish: Dish | undefined, plan: EventPlan, settings: AppSettings): number {
  const base = dish ? settings.confidenceFactorByWasteRisk[dish.wasteRisk] : 1
  return base * plan.confidenceFactor
}

/** مجموع وزن رده‌ای همه‌ی آیتم‌های یک دسته غذایی مشخص در سناریو. */
export function sumWeightsInCategory(
  items: SelectedItem[],
  dishesById: Map<string, Dish>,
  category: Category,
  settings: AppSettings,
): number {
  return items
    .filter((it) => dishesById.get(it.dishId)?.category === category)
    .reduce((sum, it) => sum + tierWeight(it, settings), 0)
}

/**
 * امتیاز هم‌راستایی ترکیب ماکروی خودِ این غذا با استاندارد «فرمول تقسیم سفره»
 * (Harvard Healthy Eating Plate: پیش‌فرض ۲۵٪ کربوهیدرات/۲۵٪ پروتئین/۵۰٪ سبزیجات — از تنظیمات).
 * عدد پیوسته بین ۰ (کاملاً دور از الگو) تا ۱ (دقیقاً منطبق با الگو)، از روی مجموع قدرمطلق
 * فاصله‌ی هر سه درصد ماکرو تا هدف مربوطه‌اش. نوشیدنی از این محاسبه مستثناست چون اصلاً بخشی از
 * جمع‌بندی «سفره» نیست (نگاه کنید به computeMacroStatus) و مقایسه‌اش با الگوی غذای جامد بی‌معناست.
 */
export function macroAlignmentScore(dish: Dish | undefined, settings: AppSettings): number {
  if (!dish || !PLATE_CATEGORIES.includes(dish.category)) return 1
  const { carbShare, proteinShare, vegShare } = settings.nutritionTargets
  const deviation =
    Math.abs(dish.macro.carb / 100 - carbShare) +
    Math.abs(dish.macro.protein / 100 - proteinShare) +
    Math.abs(dish.macro.veg / 100 - vegShare)
  // حداکثر فاصله‌ی نظری بین دو توزیع درصدی روی این سه محور ۲ است؛ نتیجه را در ۰..۱ کلمپ می‌کنیم.
  return Math.max(0, 1 - deviation / 2)
}

/**
 * سهم پوشش دیگر یک عدد دستی روی هر ردیف نیست — خودِ سیستم آن را با هر تغییر در فهرست
 * انتخاب‌شده‌ها بازمحاسبه می‌کند: هر آیتم یک «وزن خام» تقاضا دارد که از دو عامل تشکیل می‌شود —
 * (۱) داده‌ی واقعی مصرف از رویدادهای قبلی همان غذا، وگرنه پیش‌فرض رده، و (۲) میزان هم‌راستایی
 * ترکیب ماکروی همان غذا با استاندارد فرمول تقسیم سفره — غذایی که ترکیبش به الگوی سالم نزدیک‌تر
 * است، در ازای همان تقاضا/رده، سهم پوشش بیشتری می‌گیرد. این وزن بین همه‌ی آیتم‌های همان دسته
 * نرمال‌سازی می‌شود تا جمع سهم‌های یک دسته همیشه معنادار بماند (یک «پرس معادل» به ازای هر مهمان) —
 * نه اینکه هر آیتم مستقل از بقیه یک عدد ثابت رده‌ای بگیرد.
 */
export function rawCoverageWeight(item: SelectedItem, dish: Dish | undefined, settings: AppSettings): number {
  const demandWeight = dish?.observedCoveragePercent ?? settings.defaultCoverageByTier[item.tier]
  return demandWeight * macroAlignmentScore(dish, settings)
}

/** مجموع وزن خام پوشش همه‌ی آیتم‌های یک دسته — مبنای نرمال‌سازی سهم پوشش هر آیتم آن دسته. */
export function sumCoverageWeightInCategory(
  items: SelectedItem[],
  dishesById: Map<string, Dish>,
  category: Category,
  settings: AppSettings,
): number {
  return items
    .filter((it) => dishesById.get(it.dishId)?.category === category)
    .reduce((sum, it) => sum + rawCoverageWeight(it, dishesById.get(it.dishId), settings), 0)
}

export interface ItemCalc {
  itemId: string
  dishId: string
  dish: Dish | undefined
  category: Category | undefined
  coveragePercent: number
  /** = round(guestCount × نرخ حضور × coveragePercent) — همیشه از روی مقادیر لحظه‌ای برنامه
   * محاسبه می‌شود، نه یک عدد ثابتِ ذخیره‌شده، تا با تغییر تعداد میهمانان یا نرخ حضور خودش
   * را به‌روز کند. */
  coverageCount: number
  portionSize: number
  weight: number
  budgetShare: number
  confidenceFactor: number
  batchQuantity: number
  /** پخت پلکانی: batchQuantity - coverageCount — بخش «ذخیره‌ی احتیاطی» که به‌جای پخت قطعی
   * همراه با بقیه، بسته به ریسک هدررفت غذا بهتر است نپخته/آماده نگه داشته شود (فسادپذیر) یا
   * از قبل کامل آماده شود (قابل‌نگهداری). نگاه کنید به computeItemCalc. */
  reserveQuantity: number
  /** هزینه‌ی ریالی ذخیره‌ی احتیاطی، فقط برای غذاهای فسادپذیرِ قیمت‌دار — یعنی اگر این مقدار
   * اضافه اصلاً مصرف نشود، این عدد هدر می‌رود. برای غذای قابل‌نگهداری یا بدون قیمت صفر/نامشخص است. */
  wasteRiskAmount: number | null
  maxAffordableQty: number | null // null یعنی نامحدود/نامشخص (بدون قیمت)
  totalItemCost: number | null
  gramsPerGuestAvg: number
  gramsPerGuest: Macro
  overBudget: boolean
}

/**
 * محاسبه‌ی کامل یک ردیف انتخابی طبق فرمول‌های بخش ۴ مستند محصول.
 * weightSumInCategory و coverageWeightSumInCategory باید از قبل برای همه‌ی آیتم‌های همان دسته
 * محاسبه شده باشند.
 */
export function computeItemCalc(
  item: SelectedItem,
  dish: Dish | undefined,
  plan: EventPlan,
  settings: AppSettings,
  weightSumInCategory: number,
  coverageWeightSumInCategory: number,
): ItemCalc {
  const weight = tierWeight(item, settings)
  const category = dish?.category
  const categoryBudget = category ? categoryBudgetAmount(plan, category) : 0
  const budgetShare = weightSumInCategory > 0 ? (weight / weightSumInCategory) * categoryBudget : 0

  // سهم پوشش دیگر ورودی دستی نیست — خودِ سیستم آن را از نرمال‌سازی وزن خام این آیتم در برابر
  // مجموع وزن خام کل دسته می‌سازد؛ نگاه کنید به rawCoverageWeight/sumCoverageWeightInCategory.
  const coveragePercent =
    coverageWeightSumInCategory > 0 ? rawCoverageWeight(item, dish, settings) / coverageWeightSumInCategory : 0

  // پویا: هر بار از روی guestCount و expectedAttendanceRateِ لحظه‌ای برنامه محاسبه می‌شود،
  // نه یک عدد ثابتی که فقط در لحظه‌ی افزودن آیتم ذخیره شده باشد.
  const coverageCount = Math.round(plan.guestCount * plan.expectedAttendanceRate * coveragePercent)
  const confidenceFactor = effectiveConfidenceFactor(dish, plan, settings)
  const batchQuantity = Math.round(coverageCount * confidenceFactor)
  const reserveQuantity = Math.max(0, batchQuantity - coverageCount)

  const costPerServing = dish?.costPerServing ?? null
  const maxAffordableQty = costPerServing && costPerServing > 0 ? Math.floor(budgetShare / costPerServing) : null
  const totalItemCost = costPerServing != null ? costPerServing * batchQuantity : null
  const wasteRiskAmount =
    dish?.wasteRisk === 'فسادپذیر' && costPerServing != null ? costPerServing * reserveQuantity : null

  const gramsPerGuestAvg = plan.guestCount > 0 ? (coverageCount / plan.guestCount) * item.portionSize : 0

  const gramsPerGuest = zeroMacro()
  if (dish) {
    for (const key of MACRO_KEYS) {
      gramsPerGuest[key] = gramsPerGuestAvg * (dish.macro[key] / 100)
    }
  }

  const overBudget = totalItemCost != null && totalItemCost > budgetShare

  return {
    itemId: item.itemId,
    dishId: item.dishId,
    dish,
    category,
    coveragePercent,
    coverageCount,
    portionSize: item.portionSize,
    weight,
    budgetShare,
    confidenceFactor,
    batchQuantity,
    reserveQuantity,
    wasteRiskAmount,
    maxAffordableQty,
    totalItemCost,
    gramsPerGuestAvg,
    gramsPerGuest,
    overBudget,
  }
}

export function computeAllItemCalcs(plan: EventPlan, dishesById: Map<string, Dish>, settings: AppSettings): ItemCalc[] {
  const weightSums = new Map<Category, number>()
  const coverageWeightSums = new Map<Category, number>()
  for (const item of plan.selectedItems) {
    const category = dishesById.get(item.dishId)?.category
    if (!category || weightSums.has(category)) continue
    weightSums.set(category, sumWeightsInCategory(plan.selectedItems, dishesById, category, settings))
    coverageWeightSums.set(category, sumCoverageWeightInCategory(plan.selectedItems, dishesById, category, settings))
  }

  return plan.selectedItems.map((item) => {
    const dish = dishesById.get(item.dishId)
    const category = dish?.category
    const weightSum = category ? (weightSums.get(category) ?? 0) : 0
    const coverageWeightSum = category ? (coverageWeightSums.get(category) ?? 0) : 0
    return computeItemCalc(item, dish, plan, settings, weightSum, coverageWeightSum)
  })
}

export interface CategoryPlateAverage {
  category: Category
  avgPortionGrams: number
  avgMacro: Macro
  grams: Macro
}

/**
 * میانگین وزنی (بر اساس تعداد پوشش) وضعیت یک دسته در بشقاب یک مهمان معمولی.
 *
 * چرا میانگین، نه جمع؟ در بوفه، یک مهمان از هر دسته معمولاً حدوداً یک بار سرو می‌گیرد،
 * نه یک پرس کامل از هر آیتم انتخابی آن دسته. اگر بجای میانگین جمع بزنیم، افزودن غذای
 * سوم/چهارم به یک دسته بدون هیچ تغییری در رفتار واقعی مهمان، عدد گرم را چند برابر
 * می‌کند و هشدار تغذیه‌ای همیشه قرمز می‌شود (صرف‌نظر از انتخاب واقعی) — این همان اشکالی
 * است که با این مدل رفع شده: افزودن گزینه‌ی بیشتر به یک دسته، میانگین را رقیق می‌کند،
 * نه اینکه جمع را بزرگ‌تر کند.
 */
export function computeCategoryPlateAverage(itemCalcs: ItemCalc[], category: Category): CategoryPlateAverage {
  const calcsInCategory = itemCalcs.filter((c) => c.category === category)
  const weightSum = calcsInCategory.reduce((s, c) => s + c.coverageCount, 0)

  if (weightSum <= 0) {
    return { category, avgPortionGrams: 0, avgMacro: zeroMacro(), grams: zeroMacro() }
  }

  const avgPortionGrams = calcsInCategory.reduce((s, c) => s + c.coverageCount * c.portionSize, 0) / weightSum

  const massWeightSum = calcsInCategory.reduce((s, c) => s + c.coverageCount * c.portionSize, 0)
  const avgMacro = zeroMacro()
  if (massWeightSum > 0 && calcsInCategory.length > 0) {
    for (const key of MACRO_KEYS) {
      avgMacro[key] =
        calcsInCategory.reduce((s, c) => s + c.coverageCount * c.portionSize * (c.dish?.macro[key] ?? 0), 0) / massWeightSum
    }
  }

  const grams = zeroMacro()
  for (const key of MACRO_KEYS) {
    grams[key] = avgPortionGrams * (avgMacro[key] / 100)
  }

  return { category, avgPortionGrams, avgMacro, grams }
}

export interface MacroStatus {
  totalGrams: Macro
  targetGrams: Macro
  statusPercent: Macro
  categoryAverages: CategoryPlateAverage[]
}

/** جمع‌بندی ترکیب تغذیه‌ای در سطح کل سفره؛ نوشیدنی‌ها طبق مستند محصول در جمع لحاظ نمی‌شوند. */
export function computeMacroStatus(itemCalcs: ItemCalc[], settings: AppSettings): MacroStatus {
  const categoryAverages = PLATE_CATEGORIES.map((category) => computeCategoryPlateAverage(itemCalcs, category))

  const totalGrams = zeroMacro()
  for (const avg of categoryAverages) {
    for (const key of MACRO_KEYS) {
      totalGrams[key] += avg.grams[key]
    }
  }

  const { totalGramsPerGuest, carbShare, proteinShare, vegShare } = settings.nutritionTargets
  const targetGrams: Macro = {
    carb: totalGramsPerGuest * carbShare,
    protein: totalGramsPerGuest * proteinShare,
    veg: totalGramsPerGuest * vegShare,
    // چربی سهم مستقل بشقاب ندارد؛ صرفاً برای نمایش اطلاعاتی نگه داشته می‌شود (بدون هدف/رنگ هشدار).
    fat: 0,
  }

  const statusPercent = zeroMacro()
  for (const key of MACRO_KEYS) {
    statusPercent[key] = targetGrams[key] > 0 ? totalGrams[key] / targetGrams[key] : 0
  }

  return { totalGrams, targetGrams, statusPercent, categoryAverages }
}

export interface PlanSummary {
  itemCalcs: ItemCalc[]
  totalCost: number
  estimatedTotalCost: number
  totalBudget: number
  hasMissingPrices: boolean
  missingPriceCount: number
  macro: MacroStatus
}

/**
 * برای آیتم‌های بدون قیمت، به‌جای نادیده گرفتن کامل هزینه، میانگین هزینه‌ی سایر غذاهای
 * قیمت‌دار همان دسته را به‌عنوان برآورد جایگزین می‌کند — فقط برای نمایش «هزینه تخمینی»
 * در کنار «هزینه قطعی»، تا نوار بودجه با حذف کامل یک آیتم گران بدون قیمت، کاذباً سبز نشود.
 */
function estimateMissingCost(dish: Dish, dishesById: Map<string, Dish>): number | null {
  const sameCategoryPriced = Array.from(dishesById.values()).filter(
    (d) => d.category === dish.category && d.costPerServing != null,
  )
  if (sameCategoryPriced.length === 0) return null
  const avg = sameCategoryPriced.reduce((s, d) => s + (d.costPerServing ?? 0), 0) / sameCategoryPriced.length
  return avg
}

export function computePlanSummary(plan: EventPlan, dishesById: Map<string, Dish>, settings: AppSettings): PlanSummary {
  const itemCalcs = computeAllItemCalcs(plan, dishesById, settings)
  const totalCost = itemCalcs.reduce((sum, c) => sum + (c.totalItemCost ?? 0), 0)

  const estimatedTotalCost = itemCalcs.reduce((sum, c) => {
    if (c.totalItemCost != null) return sum + c.totalItemCost
    if (!c.dish) return sum
    const estimate = estimateMissingCost(c.dish, dishesById)
    return sum + (estimate ?? 0) * c.batchQuantity
  }, 0)

  const totalBudget = plan.guestCount * plan.perPersonBudget
  const missingPriceCount = itemCalcs.filter((c) => c.totalItemCost == null).length
  const macro = computeMacroStatus(itemCalcs, settings)
  return {
    itemCalcs,
    totalCost,
    estimatedTotalCost,
    totalBudget,
    hasMissingPrices: missingPriceCount > 0,
    missingPriceCount,
    macro,
  }
}

export interface CookingMethodCount {
  method: CookingMethod
  count: number
  dishNames: string[]
  capacity: number
  overCapacity: boolean
}

/** شاخص پیچیدگی آشپزخانه: تعداد غذا (اصلی/پیش‌غذا/دسر) به تفکیک روش پخت، در برابر ظرفیت واقعی همان ایستگاه. */
export function computeCookingComplexity(
  plan: EventPlan,
  dishesById: Map<string, Dish>,
  settings: AppSettings,
): CookingMethodCount[] {
  const counts = new Map<CookingMethod, string[]>()
  for (const item of plan.selectedItems) {
    const dish = dishesById.get(item.dishId)
    if (!dish || dish.category === DRINK_CATEGORY || !item.cookingMethod) continue
    const list = counts.get(item.cookingMethod) ?? []
    list.push(dish.name)
    counts.set(item.cookingMethod, list)
  }
  return Array.from(counts.entries())
    .map(([method, dishNames]) => {
      const capacity = settings.cookingMethodCapacity[method]
      return { method, count: dishNames.length, dishNames, capacity, overCapacity: dishNames.length > capacity }
    })
    .sort((a, b) => b.count - a.count)
}

/** سقف هزینه هر پرس یک رده، به‌صورت ریالی — از سهم بودجه سرانه محاسبه می‌شود تا با هر بودجه‌ای مقیاس شود. */
export function tierCostCeilingAmount(plan: EventPlan, settings: AppSettings, tier: SelectedItem['tier']): number {
  return plan.perPersonBudget * settings.tierCostCeilingShare[tier]
}
