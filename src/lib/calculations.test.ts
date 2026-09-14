import { describe, expect, it } from 'vitest'
import { defaultMenuOptimizerSettings } from '../data/defaultSettings'
import type { AppSettings, Dish, EventPlan, SelectedItem } from '../types'
import {
  categoryBudgetAmount,
  computeAllItemCalcs,
  computeCookingComplexity,
  computeFairSharePortionGrams,
  computeIngredientsCostTotal,
  computeMacroStatus,
  computePlanSummary,
  effectiveConfidenceFactor,
  macroAlignmentScore,
  tierCostCeilingAmount,
} from './calculations'

const settings: AppSettings = {
  tierWeights: { 'شاخص': 1.5, 'استاندارد': 1.0, 'اقتصادی': 0.6 },
  defaultCoverageByTier: { 'شاخص': 0.4, 'استاندارد': 0.7, 'اقتصادی': 1.0 },
  tierCostCeilingShare: { 'شاخص': 0.12, 'استاندارد': 0.07, 'اقتصادی': 0.035 },
  // فسادپذیر خنثی (۱) نگه داشته شده تا تست‌های قدیمی که فقط plan.confidenceFactor را بررسی
  // می‌کنند دست‌نخورده بمانند (پیش‌فرض makeDish هم «فسادپذیر» است)؛ قابل‌نگهداری متفاوت است
  // تا تفکیک ریسک هدررفت جداگانه تست شود.
  confidenceFactorByWasteRisk: { 'فسادپذیر': 1, 'قابل‌نگهداری': 1.3 },
  nutritionTargets: { totalGramsPerGuest: 520, carbShare: 0.25, proteinShare: 0.25, vegShare: 0.5 },
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

function makeDish(overrides: Partial<Dish> & { id: string }): Dish {
  return {
    name: overrides.id,
    category: 'غذای اصلی',
    macro: { carb: 25, protein: 25, veg: 50, fat: 0 },
    costPerServing: 100_000,
    costSource: 'test',
    priceVarianceFlag: false,
    needsPrice: false,
    ingredientsCostTotal: null,
    eventsUsedIn: [],
    referencePortionGrams: 250,
    portionSource: 'test',
    needsPortionEstimate: false,
    dietaryTags: [],
    dietaryTagsVerified: false,
    isBreakfastItem: false,
    wasteRisk: 'فسادپذیر',
    wasteRiskVerified: false,
    observedCoveragePercent: null,
    observedEventsRecorded: 0,
    nutrition: { proteinGrams: 62.5, carbGrams: 62.5, fatGrams: 0, fiberGrams: null, calories: null },
    needsNutritionReview: false,
    proteinSource: 'plant-other',
    proteinSourceVerified: false,
    defaultCookingMethod: 'گریل',
    defaultCookingMethodVerified: false,
    ...overrides,
  }
}

function makePlan(overrides: Partial<EventPlan> = {}): EventPlan {
  return {
    guestCount: 100,
    perPersonBudget: 1_000_000,
    confidenceFactor: 1.1,
    expectedAttendanceRate: 1,
    mealType: 'شام',
    categoryBudgetShare: { 'غذای اصلی': 0.58, 'پیش‌غذا': 0.15, 'دسر': 0.1, 'نوشیدنی': 0.17 },
    selectedItems: [],
    dishConstraints: {},
    ...overrides,
  }
}

describe('categoryBudgetAmount', () => {
  it('multiplies guests × per-person budget × share', () => {
    const plan = makePlan()
    expect(categoryBudgetAmount(plan, 'غذای اصلی')).toBeCloseTo(100 * 1_000_000 * 0.58)
  })
})

describe('tierCostCeilingAmount', () => {
  it('scales with per-person budget instead of being a fixed rial figure', () => {
    const plan = makePlan({ perPersonBudget: 1_000_000 })
    expect(tierCostCeilingAmount(plan, settings, 'شاخص')).toBeCloseTo(120_000)
    const biggerPlan = makePlan({ perPersonBudget: 10_000_000 })
    expect(tierCostCeilingAmount(biggerPlan, settings, 'شاخص')).toBeCloseTo(1_200_000)
  })
})

// ---------------------------------------------------------------------------
// computeFairSharePortionGrams: کارت رسپی یک پرس رستورانی کامل را توصیف می‌کند (مثلاً «باقالی
// پلو با گردن گوسفندی» با ۵۰۰ گرم گوشت، برای یک نفر در حالت رستورانی)، ولی در بوفه یک مهمان
// چند غذای همان دسته را با هم می‌خورد، پس فقط باید سهم منصفانه‌ی هدف تنظیمات را از این غذا
// بگیرد — نه کل پرس رسپی را.
// ---------------------------------------------------------------------------
describe('computeFairSharePortionGrams', () => {
  it('meat branch: splits the recipe portion so each of N main dishes contributes an equal share of the meat target (باقالی پلو example)', () => {
    // دقیقاً مثال کاربر: پرس رسپی ۵۰۰ گرم گوشت دارد، هدف پروتئین ۳۰۰ گرم است، ۳ غذای اصلی
    // انتخاب شده (بین حداقل ۲ و حداکثر ۴) → سهم هر غذا ۱۰۰ گرم → یک پرس رسپی باید بین ۵ مهمان
    // تقسیم شود (۵۰۰ ÷ ۱۰۰ = ۵ نفر)، یعنی سهم هر مهمان از پرس رسپی = ۵۰۰ ÷ ۵ = ۱۰۰ گرم.
    const baghaliPolo = makeDish({
      id: 'baghali-polo',
      category: 'غذای اصلی',
      proteinSource: 'red-meat',
      referencePortionGrams: 500,
      nutrition: { proteinGrams: 500, carbGrams: 0, fatGrams: 0, fiberGrams: null, calories: null },
    })
    const localSettings: AppSettings = { ...settings, menuOptimizer: { ...settings.menuOptimizer, proteinTargetGramsPerGuest: 300 } }
    expect(computeFairSharePortionGrams(baghaliPolo, 3, localSettings)).toBeCloseTo(100, 5)
  })

  it('meat branch: fewer selected dishes in the category means a bigger share per dish (not smaller)', () => {
    const dish = makeDish({
      id: 'meat-dish',
      category: 'غذای اصلی',
      proteinSource: 'white-meat',
      referencePortionGrams: 400,
      nutrition: { proteinGrams: 100, carbGrams: 0, fatGrams: 0, fiberGrams: null, calories: null },
    })
    const localSettings: AppSettings = { ...settings, menuOptimizer: { ...settings.menuOptimizer, proteinTargetGramsPerGuest: 200 } }
    const shareWithTwoDishes = computeFairSharePortionGrams(dish, 2, localSettings)
    const shareWithFourDishes = computeFairSharePortionGrams(dish, 4, localSettings)
    expect(shareWithTwoDishes).toBeGreaterThan(shareWithFourDishes)
  })

  it('weight branch: dishes with no meaningful protein target (drinks, plant-based) split the recipe portion by total weight, not protein', () => {
    // یک آب‌میوه با پرس رسپی ۱۰۰۰ گرمی — اگر ۴ نوشیدنی هم‌زمان انتخاب شده باشد، سهم هر مهمان
    // باید ¼ آن (بر مبنای totalGramsPerGuest، نه پروتئین) باشد.
    const juice = makeDish({
      id: 'juice',
      category: 'نوشیدنی',
      proteinSource: 'plant-other',
      referencePortionGrams: 1000,
      nutrition: { proteinGrams: 1, carbGrams: 50, fatGrams: 0, fiberGrams: null, calories: null },
    })
    const localSettings: AppSettings = { ...settings, nutritionTargets: { ...settings.nutritionTargets, totalGramsPerGuest: 1000 } }
    expect(computeFairSharePortionGrams(juice, 4, localSettings)).toBeCloseTo(250, 5)
  })

  it('never divides by zero when only one dish is selected in the category', () => {
    const dish = makeDish({ id: 'solo', category: 'غذای اصلی', proteinSource: 'red-meat', referencePortionGrams: 300, nutrition: { proteinGrams: 60, carbGrams: 0, fatGrams: 0, fiberGrams: null, calories: null } })
    expect(() => computeFairSharePortionGrams(dish, 0, settings)).not.toThrow()
    expect(computeFairSharePortionGrams(dish, 0, settings)).toBe(computeFairSharePortionGrams(dish, 1, settings))
  })
})

describe('weighted budget allocation (computeAllItemCalcs)', () => {
  it('splits a category budget between two items proportional to tier weight', () => {
    const dishA = makeDish({ id: 'a', costPerServing: 50_000 })
    const dishB = makeDish({ id: 'b', costPerServing: 50_000 })
    const dishesById = new Map([
      ['a', dishA],
      ['b', dishB],
    ])
    const items: SelectedItem[] = [
      { itemId: '1', dishId: 'a', tier: 'شاخص', portionSize: 200 }, // weight 1.5
      { itemId: '2', dishId: 'b', tier: 'اقتصادی', portionSize: 200 }, // weight 0.6
    ]
    const plan = makePlan({ selectedItems: items })
    const calcs = computeAllItemCalcs(plan, dishesById, settings)

    const categoryBudget = categoryBudgetAmount(plan, 'غذای اصلی')
    const weightSum = 1.5 + 0.6
    const expectedShareA = (1.5 / weightSum) * categoryBudget
    const expectedShareB = (0.6 / weightSum) * categoryBudget

    expect(calcs[0].budgetShare).toBeCloseTo(expectedShareA)
    expect(calcs[1].budgetShare).toBeCloseTo(expectedShareB)
    // شاخص + اقتصادی باید کل بودجه‌ی دسته را بدون کم و زیاد تقسیم کنند
    expect(calcs[0].budgetShare + calcs[1].budgetShare).toBeCloseTo(categoryBudget)
  })

  it('computes batch quantity, max affordable qty and total cost per the spec formulas', () => {
    const dish = makeDish({ id: 'a', costPerServing: 10_000 })
    const dishesById = new Map([['a', dish]])
    const items: SelectedItem[] = [{ itemId: '1', dishId: 'a', tier: 'استاندارد', portionSize: 250 }]
    const plan = makePlan({ selectedItems: items, confidenceFactor: 1.1 })
    const [calc] = computeAllItemCalcs(plan, dishesById, settings)

    // تک آیتم در دسته‌اش → کل سهم پوشش خودکار همان دسته (۱۰۰٪) را می‌گیرد
    expect(calc.coveragePercent).toBeCloseTo(1)
    expect(calc.coverageCount).toBe(100)
    expect(calc.batchQuantity).toBe(Math.round(100 * 1.1))
    expect(calc.totalItemCost).toBe(10_000 * calc.batchQuantity)
    expect(calc.maxAffordableQty).toBe(Math.floor(calc.budgetShare / 10_000))
    expect(calc.gramsPerGuestAvg).toBeCloseTo((100 / 100) * 250)
  })

  it('auto-computes coverage share by normalizing tier-default demand weight across a category (no manual input)', () => {
    // دو غذای هم‌رده در یک دسته: هرکدام باید دقیقاً نصف سهم پوشش دسته را بگیرند (نه یک عدد ثابت رده‌ای مستقل)
    const dishA = makeDish({ id: 'a' })
    const dishB = makeDish({ id: 'b' })
    const dishesById = new Map([
      ['a', dishA],
      ['b', dishB],
    ])
    const twoItems: SelectedItem[] = [
      { itemId: '1', dishId: 'a', tier: 'استاندارد', portionSize: 250 },
      { itemId: '2', dishId: 'b', tier: 'استاندارد', portionSize: 250 },
    ]
    const twoCalcs = computeAllItemCalcs(makePlan({ selectedItems: twoItems }), dishesById, settings)
    expect(twoCalcs[0].coveragePercent).toBeCloseTo(0.5)
    expect(twoCalcs[1].coveragePercent).toBeCloseTo(0.5)
    expect(twoCalcs[0].coveragePercent + twoCalcs[1].coveragePercent).toBeCloseTo(1)

    // افزودن یک غذای سوم هم‌رده باید سهم بقیه را خودکار رقیق کند (نه اینکه هرکدام مستقل بمانند)
    const dishesById3 = new Map(dishesById)
    dishesById3.set('c', makeDish({ id: 'c' }))
    const threeItems: SelectedItem[] = [...twoItems, { itemId: '3', dishId: 'c', tier: 'استاندارد', portionSize: 250 }]
    const threeCalcs = computeAllItemCalcs(makePlan({ selectedItems: threeItems }), dishesById3, settings)
    for (const c of threeCalcs) expect(c.coveragePercent).toBeCloseTo(1 / 3)
  })

  it('gives dishes with real observed consumption data a proportional share instead of the flat tier default', () => {
    const popular = makeDish({ id: 'popular', observedCoveragePercent: 0.9, observedEventsRecorded: 3 })
    const untried = makeDish({ id: 'untried' }) // بدون سابقه → پیش‌فرض رده (۰.۷ برای استاندارد)
    const dishesById = new Map([
      ['popular', popular],
      ['untried', untried],
    ])
    const items: SelectedItem[] = [
      { itemId: '1', dishId: 'popular', tier: 'استاندارد', portionSize: 250 },
      { itemId: '2', dishId: 'untried', tier: 'استاندارد', portionSize: 250 },
    ]
    const [popularCalc, untriedCalc] = computeAllItemCalcs(makePlan({ selectedItems: items }), dishesById, settings)
    const expectedTotal = 0.9 + 0.7
    expect(popularCalc.coveragePercent).toBeCloseTo(0.9 / expectedTotal)
    expect(untriedCalc.coveragePercent).toBeCloseTo(0.7 / expectedTotal)
    expect(popularCalc.coveragePercent).toBeGreaterThan(untriedCalc.coveragePercent)
  })

  it('normalizes coverage independently per category — one category is not diluted by another', () => {
    const main1 = makeDish({ id: 'm1', category: 'غذای اصلی' })
    const main2 = makeDish({ id: 'm2', category: 'غذای اصلی' })
    const dessert = makeDish({ id: 'd1', category: 'دسر' })
    const dishesById = new Map([
      ['m1', main1],
      ['m2', main2],
      ['d1', dessert],
    ])
    const items: SelectedItem[] = [
      { itemId: '1', dishId: 'm1', tier: 'استاندارد', portionSize: 250 },
      { itemId: '2', dishId: 'm2', tier: 'استاندارد', portionSize: 250 },
      { itemId: '3', dishId: 'd1', tier: 'استاندارد', portionSize: 120 },
    ]
    const calcs = computeAllItemCalcs(makePlan({ selectedItems: items }), dishesById, settings)
    const dessertCalc = calcs.find((c) => c.dishId === 'd1')
    // دسر تک‌غذا در دسته‌ی خودش است، پس باید ۱۰۰٪ بگیرد — صرف‌نظر از این‌که دسته‌ی غذای اصلی دو گزینه دارد
    expect(dessertCalc?.coveragePercent).toBeCloseTo(1)
  })

  it('scores macro alignment against the plate-division standard (25/25/50) continuously between 0 and 1', () => {
    const perfect = makeDish({ id: 'perfect', macro: { carb: 25, protein: 25, veg: 50, fat: 0 } })
    expect(macroAlignmentScore(perfect, settings)).toBeCloseTo(1)

    // دور از الگو: پروتئین بسیار غالب، کربوهیدرات و سبزیجات تقریباً صفر
    const proteinHeavy = makeDish({ id: 'protein-heavy', macro: { carb: 5, protein: 85, veg: 5, fat: 5 } })
    const score = macroAlignmentScore(proteinHeavy, settings)
    expect(score).toBeGreaterThanOrEqual(0)
    expect(score).toBeLessThan(1)

    // نوشیدنی از این محاسبه مستثناست (بی‌معنا مقایسه‌اش با الگوی غذای جامد) — همیشه خنثی (۱)
    const drink = makeDish({ id: 'drink', category: 'نوشیدنی', macro: { carb: 100, protein: 0, veg: 0, fat: 0 } })
    expect(macroAlignmentScore(drink, settings)).toBe(1)
  })

  it('gives a dish whose macro matches the plate-division standard a bigger coverage share than an equally-ranked but poorly-aligned dish', () => {
    const wellAligned = makeDish({ id: 'good', macro: { carb: 25, protein: 25, veg: 50, fat: 0 } })
    const poorlyAligned = makeDish({ id: 'bad', macro: { carb: 5, protein: 85, veg: 5, fat: 5 } })
    const dishesById = new Map([
      ['good', wellAligned],
      ['bad', poorlyAligned],
    ])
    const items: SelectedItem[] = [
      { itemId: '1', dishId: 'good', tier: 'استاندارد', portionSize: 250 },
      { itemId: '2', dishId: 'bad', tier: 'استاندارد', portionSize: 250 },
    ]
    const [goodCalc, badCalc] = computeAllItemCalcs(makePlan({ selectedItems: items }), dishesById, settings)
    // هر دو هم‌رده و بدون سابقه‌ی مصرف واقعی‌اند — تنها فرق‌شان هم‌راستایی ماکروست
    expect(goodCalc.coveragePercent).toBeGreaterThan(badCalc.coveragePercent)
    expect(goodCalc.coveragePercent + badCalc.coveragePercent).toBeCloseTo(1)
  })

  it('does not penalize drinks for macro misalignment since they sit outside the plate-division target', () => {
    const drinkA = makeDish({ id: 'da', category: 'نوشیدنی', macro: { carb: 100, protein: 0, veg: 0, fat: 0 } })
    const drinkB = makeDish({ id: 'db', category: 'نوشیدنی', macro: { carb: 0, protein: 0, veg: 0, fat: 100 } })
    const dishesById = new Map([
      ['da', drinkA],
      ['db', drinkB],
    ])
    const items: SelectedItem[] = [
      { itemId: '1', dishId: 'da', tier: 'استاندارد', portionSize: 250 },
      { itemId: '2', dishId: 'db', tier: 'استاندارد', portionSize: 250 },
    ]
    const [calcA, calcB] = computeAllItemCalcs(makePlan({ selectedItems: items }), dishesById, settings)
    // هر دو هم‌رده‌اند و الگوی ماکرو برایشان بی‌اثر است، پس باید مساوی تقسیم شود
    expect(calcA.coveragePercent).toBeCloseTo(0.5)
    expect(calcB.coveragePercent).toBeCloseTo(0.5)
  })

  it('applies a per-dish confidence factor based on waste risk instead of one flat number', () => {
    const perishable = makeDish({ id: 'p', wasteRisk: 'فسادپذیر', costPerServing: 10_000 })
    const reusable = makeDish({ id: 'r', wasteRisk: 'قابل‌نگهداری', costPerServing: 10_000 })
    expect(effectiveConfidenceFactor(perishable, makePlan(), settings)).toBeCloseTo(1 * 1.1)
    expect(effectiveConfidenceFactor(reusable, makePlan(), settings)).toBeCloseTo(1.3 * 1.1)

    const dishesById = new Map([
      ['p', perishable],
      ['r', reusable],
    ])
    const items: SelectedItem[] = [
      { itemId: '1', dishId: 'p', tier: 'استاندارد', portionSize: 250 },
      { itemId: '2', dishId: 'r', tier: 'استاندارد', portionSize: 250 },
    ]
    const plan = makePlan({ selectedItems: items })
    const [perishableCalc, reusableCalc] = computeAllItemCalcs(plan, dishesById, settings)

    // همان تعداد نفر، ولی چون قابل‌نگهداری ضریب بالاتری دارد، ذخیره‌ی احتیاطی‌اش بیشتر است
    expect(reusableCalc.batchQuantity).toBeGreaterThan(perishableCalc.batchQuantity)
    // ریسک هدررفت مالی فقط برای فسادپذیر معنا دارد؛ قابل‌نگهداری همیشه null است
    expect(perishableCalc.wasteRiskAmount).toBe(10_000 * perishableCalc.reserveQuantity)
    expect(reusableCalc.wasteRiskAmount).toBeNull()
  })

  it('leaves maxAffordableQty and totalItemCost null when the dish has no price', () => {
    const dish = makeDish({ id: 'a', costPerServing: null, needsPrice: true })
    const dishesById = new Map([['a', dish]])
    const items: SelectedItem[] = [{ itemId: '1', dishId: 'a', tier: 'استاندارد', portionSize: 200 }]
    const plan = makePlan({ selectedItems: items })
    const [calc] = computeAllItemCalcs(plan, dishesById, settings)

    expect(calc.maxAffordableQty).toBeNull()
    expect(calc.totalItemCost).toBeNull()
  })
})

describe('computeMacroStatus (coverage-weighted category average)', () => {
  it('excludes drinks from the plate total', () => {
    const main = makeDish({ id: 'main', category: 'غذای اصلی', macro: { carb: 25, protein: 25, veg: 50, fat: 0 } })
    const drink = makeDish({ id: 'drink', category: 'نوشیدنی', macro: { carb: 100, protein: 0, veg: 0, fat: 0 } })
    const dishesById = new Map([
      ['main', main],
      ['drink', drink],
    ])
    const items: SelectedItem[] = [
      { itemId: '1', dishId: 'main', tier: 'استاندارد', portionSize: 300 },
      { itemId: '2', dishId: 'drink', tier: 'استاندارد', portionSize: 300 },
    ]
    const plan = makePlan({ selectedItems: items })
    const calcs = computeAllItemCalcs(plan, dishesById, settings)
    const status = computeMacroStatus(calcs, settings)

    // یک غذای اصلی به‌تنهایی در یک دسته: میانگین وزنی = خودش. 300g × 25% = 75g کربوهیدرات
    expect(status.totalGrams.carb).toBeCloseTo(75)
    expect(status.targetGrams.carb).toBeCloseTo(520 * 0.25)
    expect(status.statusPercent.carb).toBeCloseTo(75 / (520 * 0.25))
  })

  it('averages (does not sum) multiple dishes within the same category, weighted by coverage', () => {
    // این تست دقیقاً همان اشکالی را می‌پوشاند که رفع شد: در بوفه یک مهمان از هر دسته
    // حدوداً یک بار سرو می‌گیرد، نه یک پرس کامل از هر آیتم انتخابی آن دسته.
    const dishA = makeDish({ id: 'a', category: 'غذای اصلی', macro: { carb: 100, protein: 0, veg: 0, fat: 0 } })
    const dishB = makeDish({ id: 'b', category: 'غذای اصلی', macro: { carb: 0, protein: 100, veg: 0, fat: 0 } })
    const dishesById = new Map([
      ['a', dishA],
      ['b', dishB],
    ])
    // پوشش برابر و اندازه پرس برابر → میانگین باید دقیقاً وسط دو غذا باشد، نه جمع آن‌ها
    const items: SelectedItem[] = [
      { itemId: '1', dishId: 'a', tier: 'استاندارد', portionSize: 300 },
      { itemId: '2', dishId: 'b', tier: 'استاندارد', portionSize: 300 },
    ]
    const plan = makePlan({ selectedItems: items })
    const calcs = computeAllItemCalcs(plan, dishesById, settings)
    const status = computeMacroStatus(calcs, settings)

    // میانگین پرس این دسته باید ۳۰۰ گرم بماند (نه ۶۰۰ گرم جمع دو آیتم)
    const mainAvg = status.categoryAverages.find((a) => a.category === 'غذای اصلی')
    expect(mainAvg?.avgPortionGrams).toBeCloseTo(300)
    expect(status.totalGrams.carb).toBeCloseTo(150) // 300g × 50%
    expect(status.totalGrams.protein).toBeCloseTo(150)
  })

  it('adding a third dish to a heavily-covered category does not blow up the total (regression)', () => {
    const dishesById = new Map(
      ['a', 'b'].map((id) => [id, makeDish({ id, category: 'غذای اصلی', macro: { carb: 25, protein: 25, veg: 50, fat: 0 } })]),
    )
    const twoItemPlan = makePlan({
      selectedItems: [
        { itemId: '1', dishId: 'a', tier: 'استاندارد', portionSize: 300 },
        { itemId: '2', dishId: 'b', tier: 'استاندارد', portionSize: 300 },
      ],
    })
    const twoItemStatus = computeMacroStatus(computeAllItemCalcs(twoItemPlan, dishesById, settings), settings)

    const dishesById3 = new Map(dishesById)
    dishesById3.set('c', makeDish({ id: 'c', category: 'غذای اصلی', macro: { carb: 25, protein: 25, veg: 50, fat: 0 } }))
    const threeItemPlan = makePlan({
      selectedItems: [
        ...twoItemPlan.selectedItems,
        { itemId: '3', dishId: 'c', tier: 'استاندارد', portionSize: 300 },
      ],
    })
    const threeItemStatus = computeMacroStatus(computeAllItemCalcs(threeItemPlan, dishesById3, settings), settings)

    // چون هر سه غذا مشخصات یکسان دارند، افزودن گزینه‌ی سوم نباید عدد نهایی را عوض کند
    expect(threeItemStatus.totalGrams.carb).toBeCloseTo(twoItemStatus.totalGrams.carb)
  })
})

describe('computePlanSummary', () => {
  it('flags missing prices without silently treating them as zero cost', () => {
    const priced = makeDish({ id: 'priced', costPerServing: 20_000 })
    const unpriced = makeDish({ id: 'unpriced', costPerServing: null, needsPrice: true })
    const dishesById = new Map([
      ['priced', priced],
      ['unpriced', unpriced],
    ])
    // portionSize == referencePortionGrams (۲۵۰) عمداً — این تست درباره‌ی رفتار «قیمت نامشخص»
    // است، نه مقیاس‌بندی هزینه بر اساس سهم پرس (نگاه کنید به computeFairSharePortionGrams)؛
    // اگر اینجا با هم فرق داشتند، هزینه‌ی مؤثر هر پرس دیگر برابر dish.costPerServing نمی‌بود.
    const items: SelectedItem[] = [
      { itemId: '1', dishId: 'priced', tier: 'استاندارد', portionSize: 250 },
      { itemId: '2', dishId: 'unpriced', tier: 'استاندارد', portionSize: 250 },
    ]
    const plan = makePlan({ selectedItems: items })
    const summary = computePlanSummary(plan, dishesById, settings)

    expect(summary.hasMissingPrices).toBe(true)
    expect(summary.missingPriceCount).toBe(1)
    const pricedCalc = summary.itemCalcs.find((c) => c.dishId === 'priced')
    expect(summary.totalCost).toBe(20_000 * (pricedCalc?.batchQuantity ?? 0))
  })

  it('estimates a fallback total for missing-price items using the category average', () => {
    const priced = makeDish({ id: 'priced', category: 'دسر', costPerServing: 20_000 })
    const unpriced = makeDish({ id: 'unpriced', category: 'دسر', costPerServing: null, needsPrice: true })
    const dishesById = new Map([
      ['priced', priced],
      ['unpriced', unpriced],
    ])
    const items: SelectedItem[] = [
      { itemId: '1', dishId: 'priced', tier: 'استاندارد', portionSize: 200 },
      { itemId: '2', dishId: 'unpriced', tier: 'استاندارد', portionSize: 200 },
    ]
    const plan = makePlan({ selectedItems: items })
    const summary = computePlanSummary(plan, dishesById, settings)

    // برآورد باید بیشتر از هزینه قطعی باشد چون آیتم بدون قیمت هم لحاظ شده
    expect(summary.estimatedTotalCost).toBeGreaterThan(summary.totalCost)
  })
})

describe('computeCookingComplexity', () => {
  it('counts dishes per cooking method across main/starter/dessert (not drinks) against real station capacity', () => {
    const grilled1 = makeDish({ id: 'g1', category: 'غذای اصلی' })
    const grilled2 = makeDish({ id: 'g2', category: 'غذای اصلی' })
    const grilled3 = makeDish({ id: 'g3', category: 'غذای اصلی' })
    const fried = makeDish({ id: 'f1', category: 'غذای اصلی' })
    const starter = makeDish({ id: 's1', category: 'پیش‌غذا' })
    const drink = makeDish({ id: 'd1', category: 'نوشیدنی' })
    const dishesById = new Map([
      ['g1', grilled1],
      ['g2', grilled2],
      ['g3', grilled3],
      ['f1', fried],
      ['s1', starter],
      ['d1', drink],
    ])
    const items: SelectedItem[] = [
      { itemId: '1', dishId: 'g1', tier: 'استاندارد', portionSize: 200, cookingMethod: 'گریل' },
      { itemId: '2', dishId: 'g2', tier: 'استاندارد', portionSize: 200, cookingMethod: 'گریل' },
      { itemId: '3', dishId: 'f1', tier: 'استاندارد', portionSize: 200, cookingMethod: 'سرخ‌کردنی' },
      { itemId: '4', dishId: 's1', tier: 'استاندارد', portionSize: 200, cookingMethod: 'گریل' },
      { itemId: '5', dishId: 'd1', tier: 'استاندارد', portionSize: 200, cookingMethod: 'گریل' },
      { itemId: '6', dishId: 'g3', tier: 'استاندارد', portionSize: 200, cookingMethod: 'گریل' },
    ]
    const plan = makePlan({ selectedItems: items })
    const complexity = computeCookingComplexity(plan, dishesById, settings)

    // پیش‌غذا هم باید حساب شود (بر خلاف نسخه قبلی)؛ نوشیدنی حساب نمی‌شود
    const grill = complexity.find((c) => c.method === 'گریل')
    expect(grill?.count).toBe(4) // g1, g2, g3, s1 — نه نوشیدنی
    expect(grill?.capacity).toBe(settings.cookingMethodCapacity['گریل'])
    expect(grill?.overCapacity).toBe(true) // 4 > ظرفیت گریل (3)
    expect(complexity.find((c) => c.method === 'سرخ‌کردنی')?.count).toBe(1)
    expect(complexity.find((c) => c.method === 'سرخ‌کردنی')?.overCapacity).toBe(false)
    expect(complexity.reduce((sum, c) => sum + c.count, 0)).toBe(5) // نوشیدنی حساب نمی‌شود
  })
})

describe('computeIngredientsCostTotal', () => {
  it('sums lineTotal across ingredients that have one', () => {
    const total = computeIngredientsCostTotal([
      { name: 'مرغ', quantity: 200, unit: 'گرم', unitPrice: 1000, lineTotal: 200_000 },
      { name: 'برنج', quantity: 300, unit: 'گرم', unitPrice: 500, lineTotal: 150_000 },
    ])
    expect(total).toBe(350_000)
  })

  it('falls back to quantity × unitPrice when lineTotal is missing', () => {
    const total = computeIngredientsCostTotal([{ name: 'روغن', quantity: 10, unit: 'سی سی', unitPrice: 2000, lineTotal: null }])
    expect(total).toBe(20_000)
  })

  it('returns null (not zero) when no ingredient has any price data', () => {
    expect(computeIngredientsCostTotal([{ name: 'نمک', quantity: 2, unit: 'گرم', unitPrice: null, lineTotal: null }])).toBeNull()
    expect(computeIngredientsCostTotal(null)).toBeNull()
    expect(computeIngredientsCostTotal([])).toBeNull()
  })

  it('sums only the priced ingredients when some are missing prices', () => {
    const total = computeIngredientsCostTotal([
      { name: 'مرغ', quantity: 200, unit: 'گرم', unitPrice: 1000, lineTotal: 200_000 },
      { name: 'ادویه مخصوص', quantity: 1, unit: 'گرم', unitPrice: null, lineTotal: null },
    ])
    expect(total).toBe(200_000)
  })
})
