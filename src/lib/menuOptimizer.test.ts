import { describe, expect, it } from 'vitest'
import { defaultMenuOptimizerSettings } from '../data/defaultSettings'
import {
  computeDishScore,
  computeMenuScore,
  generateMenuProposals,
  kitchenFeasibilityScoreForMenu,
  macroFitScoreForMenu,
  menuVarietyScore,
  proteinDiversityScore,
  proteinFitScore,
} from './menuOptimizer'
import type { AppSettings, Dish, EventPlan, ProteinSourceType, TargetMenuProfile } from '../types'

const settings: AppSettings = {
  tierWeights: { 'شاخص': 1.5, 'استاندارد': 1.0, 'اقتصادی': 0.6 },
  defaultCoverageByTier: { 'شاخص': 0.4, 'استاندارد': 0.7, 'اقتصادی': 1.0 },
  tierCostCeilingShare: { 'شاخص': 0.12, 'استاندارد': 0.07, 'اقتصادی': 0.035 },
  confidenceFactorByWasteRisk: { 'فسادپذیر': 1.05, 'قابل‌نگهداری': 1.15 },
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
  // این تست‌ها اغلب دیش‌های ساختگی با proteinSource پیش‌فرض makeDish (همه plant-other) می‌سازند
  // که ربطی به تست ۱۶ (Hard Constraint سهم منابع پروتئین) ندارد — تحمل ۱۰۰ یعنی این محدودیت
  // تازه برای بقیه‌ی تست‌ها عملاً بی‌اثر می‌ماند؛ تست ۱۶ خودش یک تنظیمات جداگانه با تحمل واقعی می‌سازد.
  menuOptimizer: { ...defaultMenuOptimizerSettings, proteinSourceDistributionTolerancePercent: 100 },
}

function makeDish(overrides: Partial<Dish> & { id: string }): Dish {
  return {
    name: overrides.id,
    category: 'غذای اصلی',
    macro: { carb: 25, protein: 25, veg: 50, fat: 0 },
    costPerServing: 300_000,
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
    nutrition: { proteinGrams: 50, carbGrams: 30, fatGrams: 20, fiberGrams: null, calories: null },
    needsNutritionReview: false,
    proteinSource: 'plant-other',
    proteinSourceVerified: true,
    defaultCookingMethod: 'گریل',
    defaultCookingMethodVerified: true,
    ...overrides,
  }
}

function makePlan(overrides: Partial<EventPlan> = {}): EventPlan {
  return {
    guestCount: 10,
    perPersonBudget: 1_000_000,
    confidenceFactor: 1,
    expectedAttendanceRate: 1,
    mealType: 'شام',
    categoryBudgetShare: { 'غذای اصلی': 0.58, 'پیش‌غذا': 0.15, 'دسر': 0.1, 'نوشیدنی': 0.17 },
    selectedItems: [],
    dishConstraints: {},
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// 1) حیاتی‌ترین قانون کل موتور: پروتئین همیشه از گرم واقعی نوترینت می‌آید، نه وزن پرس.
// ---------------------------------------------------------------------------
describe('1. nutrition grams vs portion weight', () => {
  it('never uses referencePortionGrams as a stand-in for protein grams', () => {
    // یک پرس ۵۰۰ گرمی برنج سفید تقریباً پروتئین صفر دارد؛ اگر باگ رخ دهد و وزن پرس به‌جای
    // گرم پروتئین جمع شود، عدد به‌غلط ۵۰۰ می‌شود.
    const rice = makeDish({ id: 'rice', referencePortionGrams: 500, nutrition: { proteinGrams: 4, carbGrams: 110, fatGrams: 5, fiberGrams: null, calories: null } })
    const score = computeMenuScore({ dishes: [rice], costPerGuest: 30_000, guestCount: 1, settings, plan: makePlan({ guestCount: 1 }), avgDishScore: 50 })
    expect(score.totalProteinGrams).toBe(4)
    expect(score.totalProteinGrams).not.toBe(500)
  })
})

// ---------------------------------------------------------------------------
// 2) مثال عددی دقیق مشخصات: ۱۰ مهمان × ۳۰۰ گرم = ۳۰۰۰ گرم پروتئین هدف کل رویداد.
// ---------------------------------------------------------------------------
describe('2. worked numeric example — 10 guests × 300g/guest', () => {
  it('computes total target protein as exactly 3000g and scores an exact match at 100', () => {
    const guestCount = 10
    const target = guestCount * defaultMenuOptimizerSettings.proteinTargetGramsPerGuest
    expect(target).toBe(3000)
    expect(proteinFitScore(3000, target)).toBeCloseTo(100, 5)
  })

  it('falls off smoothly (not a step function) as actual protein deviates from the 3000g target', () => {
    const target = 3000
    const at10PercentOver = proteinFitScore(3300, target)
    const at30PercentOver = proteinFitScore(3900, target)
    const atTarget = proteinFitScore(3000, target)
    expect(atTarget).toBeGreaterThan(at10PercentOver)
    expect(at10PercentOver).toBeGreaterThan(at30PercentOver)
    expect(at30PercentOver).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// 3) Hard Constraint: عبور از سقف پروتئین باید کل ترکیب را باطل کند، نه فقط امتیاز را کم کند.
// ---------------------------------------------------------------------------
describe('3. hard constraint — protein maximum invalidates a combo', () => {
  it('excludes proposals whose total protein exceeds proteinMaxMultiplier × target from the generated set', () => {
    const guestCount = 2
    // پروتئین هدف = ۲ × ۳۰۰ = ۶۰۰ گرم؛ سقف مجاز = ۱٫۳× = ۷۸۰ گرم.
    const hugeProteinDish = makeDish({
      id: 'huge-protein-main',
      category: 'غذای اصلی',
      nutrition: { proteinGrams: 700, carbGrams: 10, fatGrams: 10, fiberGrams: null, calories: null },
    })
    const dishes = [hugeProteinDish, makeDish({ id: 'app', category: 'پیش‌غذا' }), makeDish({ id: 'dessert', category: 'دسر' }), makeDish({ id: 'drink', category: 'نوشیدنی' })]
    const plan = makePlan({
      guestCount,
      dishConstraints: { 'huge-protein-main': 'must-include' },
    })
    const localSettings: AppSettings = {
      ...settings,
      menuOptimizer: {
        ...defaultMenuOptimizerSettings,
        minDishesPerCategory: { 'غذای اصلی': 1, 'پیش‌غذا': 1, 'دسر': 1, 'نوشیدنی': 1 },
        maxDishesPerCategory: { 'غذای اصلی': 1, 'پیش‌غذا': 1, 'دسر': 1, 'نوشیدنی': 1 },
      },
    }
    const { proposals } = generateMenuProposals(dishes, plan, localSettings)
    for (const p of proposals) {
      expect(p.dishes.some((d) => d.dishId === 'huge-protein-main')).toBe(false)
    }
  })
})

// ---------------------------------------------------------------------------
// 4) Macro Fit Score: باید فاصله‌ی واقعی از پروفایل هدف باشد، نه یک آستانه‌ی دستی.
// ---------------------------------------------------------------------------
describe('4. macro fit score — distance-based, not a manual threshold', () => {
  const profileA: TargetMenuProfile = { id: 'A', label: 'A', proteinSharePercent: 40, fatSharePercent: 30, carbSharePercent: 30 }

  it('scores a perfect match at 100', () => {
    // پروتئین ۴۰، چربی ۳۰، کربوهیدرات ۳۰ گرم → دقیقاً همان سهم‌های پروفایل A.
    expect(macroFitScoreForMenu(40, 30, 30, profileA)).toBeCloseTo(100, 5)
  })

  it('scores progressively lower as the distance from the target grows', () => {
    const near = macroFitScoreForMenu(45, 28, 27, profileA)
    const far = macroFitScoreForMenu(80, 10, 10, profileA)
    expect(near).toBeGreaterThan(far)
    expect(near).toBeLessThan(100)
  })
})

// ---------------------------------------------------------------------------
// 5) Protein Diversity Score: توزیع واقعی منابع پروتئین در برابر هدف تنظیمات.
// ---------------------------------------------------------------------------
describe('5. protein diversity score', () => {
  it('scores 100 when the actual source distribution exactly matches the configured target', () => {
    // هدف پیش‌فرض: red-meat 40, white-meat 25, fish-shrimp 10, plant-other (ضمنی) 25.
    const grams: Record<ProteinSourceType, number> = { 'red-meat': 40, 'white-meat': 25, 'fish-shrimp': 10, 'plant-other': 25 }
    expect(proteinDiversityScore(grams, defaultMenuOptimizerSettings)).toBeCloseTo(100, 5)
  })

  it('penalizes a menu built entirely from a single protein source', () => {
    const allRedMeat: Record<ProteinSourceType, number> = { 'red-meat': 100, 'white-meat': 0, 'fish-shrimp': 0, 'plant-other': 0 }
    expect(proteinDiversityScore(allRedMeat, defaultMenuOptimizerSettings)).toBeLessThan(70)
  })
})

// ---------------------------------------------------------------------------
// 6) Menu Variety Score: تنوع منبع پروتئین/روش پخت/دسته باید امتیاز بدهد.
// ---------------------------------------------------------------------------
describe('6. menu variety score', () => {
  it('scores a menu with repeated protein source and cooking method lower than a diverse one', () => {
    const uniform = [
      makeDish({ id: 'a', proteinSource: 'red-meat', defaultCookingMethod: 'گریل', category: 'غذای اصلی' }),
      makeDish({ id: 'b', proteinSource: 'red-meat', defaultCookingMethod: 'گریل', category: 'غذای اصلی' }),
    ]
    const diverse = [
      makeDish({ id: 'c', proteinSource: 'red-meat', defaultCookingMethod: 'گریل', category: 'غذای اصلی' }),
      makeDish({ id: 'd', proteinSource: 'fish-shrimp', defaultCookingMethod: 'فر', category: 'پیش‌غذا' }),
    ]
    expect(menuVarietyScore(diverse)).toBeGreaterThan(menuVarietyScore(uniform))
  })
})

// ---------------------------------------------------------------------------
// 7) Kitchen Feasibility: عبور از ظرفیت یک ایستگاه پخت باید امتیاز را کم کند.
// ---------------------------------------------------------------------------
describe('7. kitchen feasibility penalty', () => {
  it('penalizes when more dishes use a cooking method than its configured capacity', () => {
    const capacity = settings.cookingMethodCapacity // گریل ظرفیت ۳ دارد
    const withinCapacity = [
      makeDish({ id: 'a', defaultCookingMethod: 'گریل' }),
      makeDish({ id: 'b', defaultCookingMethod: 'گریل' }),
    ]
    const overCapacity = [
      makeDish({ id: 'a', defaultCookingMethod: 'گریل' }),
      makeDish({ id: 'b', defaultCookingMethod: 'گریل' }),
      makeDish({ id: 'c', defaultCookingMethod: 'گریل' }),
      makeDish({ id: 'd', defaultCookingMethod: 'گریل' }),
      makeDish({ id: 'e', defaultCookingMethod: 'گریل' }),
    ]
    expect(kitchenFeasibilityScoreForMenu(withinCapacity, capacity)).toBe(100)
    expect(kitchenFeasibilityScoreForMenu(overCapacity, capacity)).toBeLessThan(100)
  })
})

// ---------------------------------------------------------------------------
// 8) رفتار عبور از بودجه: exclude باید Hard Constraint باشد (حذف کامل)، penalize باید فقط
//    امتیاز را کم کند (بدون حذف).
// ---------------------------------------------------------------------------
describe('8. budget overrun behavior — exclude vs penalize', () => {
  const guestCount = 1
  const expensiveDish = makeDish({ id: 'expensive-main', category: 'غذای اصلی', costPerServing: 5_000_000 })
  const cheapItems = [
    makeDish({ id: 'app', category: 'پیش‌غذا', costPerServing: 10_000 }),
    makeDish({ id: 'dessert', category: 'دسر', costPerServing: 10_000 }),
    makeDish({ id: 'drink', category: 'نوشیدنی', costPerServing: 10_000 }),
  ]
  const localMenuOptSettings = {
    ...defaultMenuOptimizerSettings,
    minDishesPerCategory: { 'غذای اصلی': 1, 'پیش‌غذا': 1, 'دسر': 1, 'نوشیدنی': 1 },
    maxDishesPerCategory: { 'غذای اصلی': 1, 'پیش‌غذا': 1, 'دسر': 1, 'نوشیدنی': 1 },
    // این تست درباره‌ی رفتار عبور از بودجه است، نه سهم منابع پروتئین — همه‌ی دیش‌های ساختگی
    // اینجا proteinSource پیش‌فرض makeDish (plant-other) را دارند، پس Hard Constraint سهم
    // پروتئین باید اینجا بی‌اثر بماند.
    proteinSourceDistributionTolerancePercent: 100,
  }
  const plan = makePlan({ guestCount, perPersonBudget: 100_000, dishConstraints: { 'expensive-main': 'must-include' } })

  it('excludes the over-budget combo entirely when behavior is "exclude"', () => {
    const localSettings: AppSettings = { ...settings, menuOptimizer: { ...localMenuOptSettings, budgetOverrunBehavior: 'exclude', budgetOverrunTolerancePercent: 0.05 } }
    const { proposals } = generateMenuProposals([expensiveDish, ...cheapItems], plan, localSettings)
    for (const p of proposals) {
      expect(p.dishes.some((d) => d.dishId === 'expensive-main')).toBe(false)
    }
  })

  it('keeps the over-budget combo but with a reduced cost score when behavior is "penalize"', () => {
    const localSettings: AppSettings = { ...settings, menuOptimizer: { ...localMenuOptSettings, budgetOverrunBehavior: 'penalize', budgetOverrunTolerancePercent: 0.05 } }
    const { proposals } = generateMenuProposals([expensiveDish, ...cheapItems], plan, localSettings)
    const withExpensive = proposals.find((p) => p.dishes.some((d) => d.dishId === 'expensive-main'))
    expect(withExpensive).toBeDefined()
    expect(withExpensive!.costScore).toBeLessThan(100)
  })
})

// ---------------------------------------------------------------------------
// 9) محدودیت‌های دستی هر غذا: Must Include باید همیشه حاضر باشد، Must Exclude هرگز حاضر نباشد.
// ---------------------------------------------------------------------------
describe('9. per-dish Must Include / Must Exclude constraints', () => {
  const mustIncludeDish = makeDish({ id: 'signature-dish', category: 'غذای اصلی' })
  const bannedDish = makeDish({ id: 'banned-dish', category: 'غذای اصلی' })
  // یک غذای اصلی سوم بدون محدودیت — چون پیش‌فرض تنظیمات حداقل ۲ قلم برای «غذای اصلی» می‌خواهد.
  const others = [
    makeDish({ id: 'main2', category: 'غذای اصلی' }),
    makeDish({ id: 'app', category: 'پیش‌غذا' }),
    makeDish({ id: 'dessert', category: 'دسر' }),
    makeDish({ id: 'drink', category: 'نوشیدنی' }),
  ]
  const plan = makePlan({
    guestCount: 20,
    dishConstraints: { 'signature-dish': 'must-include', 'banned-dish': 'must-exclude' },
  })

  it('includes the must-include dish in every generated proposal', () => {
    const { proposals } = generateMenuProposals([mustIncludeDish, bannedDish, ...others], plan, settings)
    expect(proposals.length).toBeGreaterThan(0)
    for (const p of proposals) {
      expect(p.dishes.some((d) => d.dishId === 'signature-dish')).toBe(true)
    }
  })

  it('never includes the must-exclude dish in any generated proposal', () => {
    const { proposals } = generateMenuProposals([mustIncludeDish, bannedDish, ...others], plan, settings)
    for (const p of proposals) {
      expect(p.dishes.some((d) => d.dishId === 'banned-dish')).toBe(false)
    }
  })
})

// ---------------------------------------------------------------------------
// 10) Data Integrity: غذای بدون قیمت هرگز نباید توسط موتور به‌صورت خودکار انتخاب شود.
// ---------------------------------------------------------------------------
describe('10. data integrity — dishes with no price are excluded, never guessed', () => {
  it('never auto-selects a dish whose costPerServing is null', () => {
    const noPriceDish = makeDish({ id: 'no-price', category: 'غذای اصلی', costPerServing: null, needsPrice: true })
    const others = [
      makeDish({ id: 'main2', category: 'غذای اصلی' }),
      makeDish({ id: 'main3', category: 'غذای اصلی' }),
      makeDish({ id: 'app', category: 'پیش‌غذا' }),
      makeDish({ id: 'dessert', category: 'دسر' }),
      makeDish({ id: 'drink', category: 'نوشیدنی' }),
    ]
    const plan = makePlan({ guestCount: 15 })
    const { proposals, warnings } = generateMenuProposals([noPriceDish, ...others], plan, settings)
    expect(proposals.length).toBeGreaterThan(0)
    for (const p of proposals) {
      expect(p.dishes.some((d) => d.dishId === 'no-price')).toBe(false)
    }
    expect(warnings.some((w) => w.includes('قیمت نامشخص'))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// امتیاز اضافی: Dish Score و Menu Score باید دو عدد مستقل باشند (طبق تأکید صریح مشخصات).
// ---------------------------------------------------------------------------
describe('extra: Dish Score ≠ Menu Score', () => {
  it('a menu can have a high average dish score but a low menu score due to poor protein diversity', () => {
    const guestCount = 10
    const strongButUniform = [
      makeDish({ id: 'main1', category: 'غذای اصلی', proteinSource: 'red-meat', nutrition: { proteinGrams: 150, carbGrams: 20, fatGrams: 30, fiberGrams: null, calories: null } }),
      makeDish({ id: 'main2', category: 'غذای اصلی', proteinSource: 'red-meat', nutrition: { proteinGrams: 150, carbGrams: 20, fatGrams: 30, fiberGrams: null, calories: null } }),
    ]
    const dishScores = strongButUniform.map((d) => computeDishScore(d, settings).total)
    const menuScore = computeMenuScore({
      dishes: strongButUniform,
      costPerGuest: 60_000,
      guestCount,
      settings,
      plan: makePlan({ guestCount }),
      avgDishScore: (dishScores[0] + dishScores[1]) / 2,
    })
    // تنوع پروتئین صفر است (فقط گوشت قرمز) — حتی اگر امتیاز هر غذا به‌تنهایی خوب باشد.
    expect(menuScore.proteinDiversity).toBeLessThan(50)
  })
})

// ---------------------------------------------------------------------------
// 11) رگرسیون: موتور نباید برای وعده‌ی شام غذای مخصوص صبحانه پیشنهاد بدهد — همان فیلتر
//     مرتبط‌بودن با نوع وعده که صفحه‌ی انتخاب غذا هم استفاده می‌کند.
// ---------------------------------------------------------------------------
describe('11. meal-type relevance filter', () => {
  it('never proposes a breakfast-only dish for a دinner (شام) event unless explicitly must-included', () => {
    const pancake = makeDish({ id: 'pancake', category: 'غذای اصلی', isBreakfastItem: true })
    const others = [
      makeDish({ id: 'main2', category: 'غذای اصلی' }),
      makeDish({ id: 'main3', category: 'غذای اصلی' }),
      makeDish({ id: 'app', category: 'پیش‌غذا' }),
      makeDish({ id: 'dessert', category: 'دسر' }),
      makeDish({ id: 'drink', category: 'نوشیدنی' }),
    ]
    const plan = makePlan({ guestCount: 20, mealType: 'شام' })
    const { proposals } = generateMenuProposals([pancake, ...others], plan, settings)
    expect(proposals.length).toBeGreaterThan(0)
    for (const p of proposals) {
      expect(p.dishes.some((d) => d.dishId === 'pancake')).toBe(false)
    }
  })
})

// ---------------------------------------------------------------------------
// 12) رگرسیون حیاتی: پروتئین کل منو باید متناسب با تعداد پرس واقعی هر غذا (فرمول خودکار سهم
//     پوشش موجود در بقیه‌ی اپ) مقیاس بگیرد، نه فقط جمع خام گرم پروتئین یک پرس از هر غذا —
//     وگرنه برای رویدادهای چندنفره، پروتئین کل به‌شدت دست‌کم‌تخمین زده می‌شود.
// ---------------------------------------------------------------------------
describe('12. menu-level protein totals scale with real serving counts, not a flat per-dish sum', () => {
  it('a 100-guest event serves far more total protein than the sum of one portion per dish', () => {
    const guestCount = 100
    const oneDishPerCategory = [
      makeDish({ id: 'main1', category: 'غذای اصلی' }),
      makeDish({ id: 'app', category: 'پیش‌غذا' }),
      makeDish({ id: 'dessert', category: 'دسر' }),
      makeDish({ id: 'drink', category: 'نوشیدنی' }),
    ]
    const naiveSumOfSinglePortions = oneDishPerCategory.reduce((s, d) => s + d.nutrition.proteinGrams, 0)
    const menuScore = computeMenuScore({
      dishes: oneDishPerCategory,
      costPerGuest: 60_000,
      guestCount,
      settings,
      plan: makePlan({ guestCount }),
      avgDishScore: 50,
    })
    // با یک غذای منحصر در هر دسته، سهم پوشش آن ۱۰۰٪ است، پس باید تقریباً guestCount پرس از هر
    // کدام تولید شود — یعنی پروتئین کل باید نزدیک guestCount برابر جمع خام یک‌پرسی باشد.
    expect(menuScore.totalProteinGrams).toBeGreaterThan(naiveSumOfSinglePortions * 50)
  })
})

// ---------------------------------------------------------------------------
// 13) رگرسیون: وقتی نوع وعده چند وعده را با هم پوشش می‌دهد (مثلاً «صبحانه و ناهار»)، منوی
//     پیشنهادی باید واقعاً از هر دو وعده داشته باشد — نه اینکه کل ترکیب فقط یکی از دو وعده را
//     پوشش دهد (چون امتیاز غذاهای غیرصبحانه‌ای معمولاً بالاتر است و بدون این قید، Beam Search
//     به‌طور طبیعی فقط همان‌ها را انتخاب می‌کند).
// ---------------------------------------------------------------------------
describe('13. multi-meal-slot events must mix breakfast and lunch/dinner dishes', () => {
  it('includes at least one breakfast dish and one non-breakfast dish in غذای اصلی for "صبحانه و ناهار"', () => {
    // عمداً غذاهای غیرصبحانه‌ای را با Dish Score خیلی بالاتر می‌سازیم تا اگر قید مخلوط‌بودن
    // اعمال نشود، Beam Search به‌طور طبیعی هر دو اسلات کوتاه‌لیست را با آن‌ها پر کند.
    const breakfastMain = makeDish({
      id: 'breakfast-main',
      category: 'غذای اصلی',
      isBreakfastItem: true,
      costPerServing: 50_000,
      nutrition: { proteinGrams: 5, carbGrams: 30, fatGrams: 10, fiberGrams: null, calories: null },
    })
    const lunchMains = Array.from({ length: 5 }, (_, i) =>
      makeDish({
        id: `lunch-main-${i}`,
        category: 'غذای اصلی',
        isBreakfastItem: false,
        costPerServing: 300_000,
        nutrition: { proteinGrams: 100, carbGrams: 30, fatGrams: 20, fiberGrams: null, calories: null },
      }),
    )
    const others = [
      makeDish({ id: 'app', category: 'پیش‌غذا' }),
      makeDish({ id: 'dessert', category: 'دسر' }),
      makeDish({ id: 'drink', category: 'نوشیدنی' }),
    ]
    const plan = makePlan({ guestCount: 50, mealType: 'صبحانه و ناهار' })
    const { proposals } = generateMenuProposals([breakfastMain, ...lunchMains, ...others], plan, settings)

    expect(proposals.length).toBeGreaterThan(0)
    for (const p of proposals) {
      const mains = p.dishes.filter((d) => d.category === 'غذای اصلی')
      expect(mains.some((d) => d.dishId === 'breakfast-main')).toBe(true)
      expect(mains.some((d) => d.dishId !== 'breakfast-main')).toBe(true)
    }
  })

  it('does not require mixing for a single-slot meal type (شام)', () => {
    const breakfastMain = makeDish({ id: 'breakfast-main', category: 'غذای اصلی', isBreakfastItem: true })
    const lunchMain1 = makeDish({ id: 'lunch-main-1', category: 'غذای اصلی', isBreakfastItem: false })
    const lunchMain2 = makeDish({ id: 'lunch-main-2', category: 'غذای اصلی', isBreakfastItem: false })
    const others = [
      makeDish({ id: 'app', category: 'پیش‌غذا' }),
      makeDish({ id: 'dessert', category: 'دسر' }),
      makeDish({ id: 'drink', category: 'نوشیدنی' }),
    ]
    const plan = makePlan({ guestCount: 50, mealType: 'شام' })
    const { proposals } = generateMenuProposals([breakfastMain, lunchMain1, lunchMain2, ...others], plan, settings)
    expect(proposals.length).toBeGreaterThan(0)
    // برای «شام» غذای صبحانه‌ای اصلاً نباید در استخر کاندید باشد (طبق تست ۱۱).
    for (const p of proposals) {
      expect(p.dishes.some((d) => d.dishId === 'breakfast-main')).toBe(false)
    }
  })
})

// ---------------------------------------------------------------------------
// 14) رگرسیون: هزینه کل هر قلم پیشنهاد باید دقیقاً برابر costPerServing × servingCount باشد
//     (همان قراردادی که MenuProposalDish در types.ts وعده می‌دهد). قبلاً servingCount از روی
//     coverageCount (سهم پوشش قطعی، بدون ذخیره‌ی احتیاطی) پر می‌شد در حالی که totalCost از روی
//     batchQuantity (شامل ذخیره‌ی احتیاطی ضریب اطمینان) محاسبه می‌شد — یعنی تقسیم totalCost بر
//     costPerServing عددی متفاوت از servingCount نمایش‌داده‌شده می‌داد. این تست دقیقاً همان
//     ناسازگاری را برای هر قلم هر پیشنهاد بررسی می‌کند تا دوباره رخ ندهد.
// ---------------------------------------------------------------------------
describe('14. proposal totalCost must equal costPerServing × servingCount for every dish', () => {
  it('keeps servingCount (batch quantity) and totalCost internally consistent', () => {
    // ریسک هدررفت فسادپذیر با ضریب اطمینان ۱٫۰۵ در تنظیمات تست یعنی batchQuantity واقعاً از
    // coverageCount بزرگ‌تر می‌شود — اگر باگ برگردد این عدم‌تطابق فوراً آشکار می‌شود.
    const mains = Array.from({ length: 4 }, (_, i) =>
      makeDish({
        id: `main-${i}`,
        category: 'غذای اصلی',
        wasteRisk: 'فسادپذیر',
        costPerServing: 250_000 + i * 10_000,
      }),
    )
    const others = [
      makeDish({ id: 'app-1', category: 'پیش‌غذا' }),
      makeDish({ id: 'app-2', category: 'پیش‌غذا' }),
      makeDish({ id: 'dessert-1', category: 'دسر' }),
      makeDish({ id: 'dessert-2', category: 'دسر' }),
      makeDish({ id: 'drink-1', category: 'نوشیدنی' }),
      makeDish({ id: 'drink-2', category: 'نوشیدنی' }),
    ]
    const plan = makePlan({ guestCount: 120, confidenceFactor: 1.2 })
    const { proposals } = generateMenuProposals([...mains, ...others], plan, settings)

    expect(proposals.length).toBeGreaterThan(0)
    let sawInflatedBatch = false
    for (const p of proposals) {
      for (const d of p.dishes) {
        if (d.costPerServing == null || d.totalCost == null) continue
        expect(d.totalCost).toBe(d.costPerServing * d.servingCount)
        // batchQuantity (servingCount) هرگز نباید از سهم پوشش قطعی (coverageCount) کمتر باشد.
        expect(d.servingCount).toBeGreaterThanOrEqual(d.coverageCount)
        if (d.servingCount > d.coverageCount) sawInflatedBatch = true
      }
    }
    // با ضریب اطمینان مؤثر > ۱ (فسادپذیر × plan.confidenceFactor=1.2)، حداقل یک قلم باید واقعاً
    // ذخیره‌ی احتیاطی داشته باشد — وگرنه این تست خودش هیچ‌چیزی را واقعاً بررسی نمی‌کرد.
    expect(sawInflatedBatch).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 15) رگرسیون: وقتی یک دسته چند گزینه دارد که هرکدام روی یک محور متفاوت (هزینه در برابر
//     چگالی پروتئین) برتری دارند، Strategy های مختلف باید واقعاً بتوانند گزینه‌ی متفاوتی از
//     همان دسته انتخاب کنند. قبلاً beamCombineAcrossCategories برای هر دسته فقط BEAM_WIDTH منوی
//     جزئیِ برتر را بر اساس امتیاز خامِ «میانگین Dish Score تا این لحظه» نگه می‌داشت — چون این
//     امتیاز میانگین بین همه‌ی دسته‌ها مشترک است (نه مخصوص هر Strategy)، اگر یک ترکیب خاص از یک
//     دسته با هر چیزی امتیاز بالایی می‌گرفت، می‌توانست تنها بازمانده‌ی آن دسته در کل Beam شود —
//     یعنی حتی وقتی cost-optimized و nutrition-optimized باید دو گزینه‌ی کاملاً متفاوت انتخاب
//     کنند، هر دو مجبور بودند از همان یک گزینه‌ی بازمانده استفاده کنند. این دقیقاً همان چیزی است
//     که کاربر «غذاهای تکراری، مستقل از فرمول انتخابی» گزارش کرد.
// ---------------------------------------------------------------------------
describe('15. cross-proposal variety — different strategies must be able to pick different options from the same category', () => {
  it('cost-optimized and nutrition-optimized pick different پیش‌غذا options when the choices trade off cost vs. protein', () => {
    const mains = Array.from({ length: 4 }, (_, i) => makeDish({ id: `main-${i}`, category: 'غذای اصلی', costPerServing: 300_000 + i * 5_000 }))
    // یک گزینه‌ی ارزان و کم‌پروتئین (بهترین برای cost-optimized) و یک گزینه‌ی گران‌تر و
    // پرپروتئین (بهترین برای nutrition-optimized) — به‌همراه دو گزینه‌ی میانی.
    const starters = [
      makeDish({ id: 'app-cheap', category: 'پیش‌غذا', costPerServing: 20_000, nutrition: { proteinGrams: 2, carbGrams: 15, fatGrams: 2, fiberGrams: null, calories: null } }),
      makeDish({ id: 'app-mid-1', category: 'پیش‌غذا', costPerServing: 60_000, nutrition: { proteinGrams: 10, carbGrams: 15, fatGrams: 5, fiberGrams: null, calories: null } }),
      makeDish({ id: 'app-mid-2', category: 'پیش‌غذا', costPerServing: 90_000, nutrition: { proteinGrams: 15, carbGrams: 15, fatGrams: 6, fiberGrams: null, calories: null } }),
      makeDish({ id: 'app-protein', category: 'پیش‌غذا', costPerServing: 150_000, nutrition: { proteinGrams: 30, carbGrams: 15, fatGrams: 8, fiberGrams: null, calories: null } }),
    ]
    const others = [
      makeDish({ id: 'dessert-1', category: 'دسر' }),
      makeDish({ id: 'drink-1', category: 'نوشیدنی' }),
    ]
    const plan = makePlan({ guestCount: 100, perPersonBudget: 2_000_000 })
    const testSettings: AppSettings = {
      ...settings,
      menuOptimizer: {
        ...settings.menuOptimizer,
        numberOfProposals: 5,
        minDishesPerCategory: { ...settings.menuOptimizer.minDishesPerCategory, 'پیش‌غذا': 1, 'دسر': 1, 'نوشیدنی': 1 },
        maxDishesPerCategory: { ...settings.menuOptimizer.maxDishesPerCategory, 'پیش‌غذا': 1, 'دسر': 1, 'نوشیدنی': 1 },
      },
    }
    const { proposals } = generateMenuProposals([...mains, ...starters, ...others], plan, testSettings)

    const starterPickFor = (strategyId: string) =>
      proposals.find((p) => p.strategyId === strategyId)?.dishes.find((d) => d.category === 'پیش‌غذا')?.dishId

    const costPick = starterPickFor('cost-optimized')
    const nutritionPick = starterPickFor('nutrition-optimized')
    expect(costPick).toBeDefined()
    expect(nutritionPick).toBeDefined()
    // اگر Beam زودتر از موعد فقط یک گزینه‌ی «پیش‌غذا» را زنده نگه دارد، این دو همیشه برابر
    // می‌شوند — دقیقاً باگی که این تست باید از بازگشتش جلوگیری کند.
    expect(costPick).not.toBe(nutritionPick)
  })
})

// ---------------------------------------------------------------------------
// 16) Hard Constraint: سهم منابع پروتئین (گوشت قرمز/سفید/ماهی‌میگو) دیگر صرفاً یک امتیاز نرم
//     نیست — طبق درخواست کاربر («سهم گوشت و مرغ و ماهی را حتماً اعمال کن»)، هر ترکیبی که بیش از
//     تحمل مجاز از هدف تنظیمات فاصله بگیرد باید کاملاً رد شود، حتی اگر از هر نظر دیگری
//     (هزینه/Dish Score) گزینه‌ی برتر باشد.
// ---------------------------------------------------------------------------
describe('16. hard constraint — protein source distribution must actually be enforced', () => {
  it('rejects a combo whose main course is a source far outside the tolerance, even when it is otherwise the best option', () => {
    // هدف: ۱۰۰٪ گوشت قرمز (تحمل ۱۰ واحد درصد) — یعنی فقط main-red واقعاً مجاز است.
    // main-plant عمداً ارزان‌تر و امتیاز کلی‌اش بالاتر ساخته شده تا بدون این Hard Constraint
    // همیشه همان انتخاب می‌شد؛ اگر این تست pass شود یعنی محدودیت واقعاً «حتماً اعمال» می‌شود.
    // main-red باید سهم غالب پروتئین «سفره» (غذای اصلی/پیش‌غذا/دسر، بدون نوشیدنی) را تشکیل دهد
    // تا رسیدن به هدف ۱۰۰٪ گوشت قرمز واقعاً ممکن باشد — پس پیش‌غذا/دسر عمداً کم‌پروتئین‌اند.
    const mainRedMeat = makeDish({
      id: 'main-red',
      category: 'غذای اصلی',
      proteinSource: 'red-meat',
      costPerServing: 400_000,
      nutrition: { proteinGrams: 200, carbGrams: 10, fatGrams: 10, fiberGrams: null, calories: null },
    })
    const mainPlantOther = makeDish({
      id: 'main-plant',
      category: 'غذای اصلی',
      proteinSource: 'plant-other',
      costPerServing: 100_000,
      nutrition: { proteinGrams: 200, carbGrams: 10, fatGrams: 10, fiberGrams: null, calories: null },
    })
    const lowProteinSide = (id: string, category: 'پیش‌غذا' | 'دسر' | 'نوشیدنی') =>
      makeDish({ id, category, proteinSource: 'plant-other', costPerServing: 20_000, nutrition: { proteinGrams: 5, carbGrams: 10, fatGrams: 2, fiberGrams: null, calories: null } })
    const others = [lowProteinSide('app', 'پیش‌غذا'), lowProteinSide('dessert', 'دسر'), lowProteinSide('drink', 'نوشیدنی')]
    const plan = makePlan({ guestCount: 20, perPersonBudget: 2_000_000 })
    const localSettings: AppSettings = {
      ...settings,
      menuOptimizer: {
        ...defaultMenuOptimizerSettings,
        proteinSourceDistributionTarget: { 'red-meat': 100, 'white-meat': 0, 'fish-shrimp': 0 },
        proteinSourceDistributionTolerancePercent: 10,
        minDishesPerCategory: { 'غذای اصلی': 1, 'پیش‌غذا': 1, 'دسر': 1, 'نوشیدنی': 1 },
        maxDishesPerCategory: { 'غذای اصلی': 1, 'پیش‌غذا': 1, 'دسر': 1, 'نوشیدنی': 1 },
      },
    }
    const { proposals } = generateMenuProposals([mainRedMeat, mainPlantOther, ...others], plan, localSettings)

    expect(proposals.length).toBeGreaterThan(0)
    for (const p of proposals) {
      expect(p.dishes.some((d) => d.dishId === 'main-plant')).toBe(false)
      expect(p.dishes.some((d) => d.dishId === 'main-red')).toBe(true)
    }
  })

  it('drinks and desserts never count toward the protein-source share — only PLATE_CATEGORIES do', () => {
    // یک نوشیدنی با پروتئین بالا و منبع متفاوت (fish-shrimp، فرضی) نباید بتواند سهم منابع
    // پروتئین محاسبه‌شده را عوض کند — این محدودیت فقط درباره‌ی غذاست، نه بوفه‌ی نوشیدنی.
    const mainRedMeat = makeDish({
      id: 'main-red',
      category: 'غذای اصلی',
      proteinSource: 'red-meat',
      costPerServing: 400_000,
      nutrition: { proteinGrams: 200, carbGrams: 10, fatGrams: 10, fiberGrams: null, calories: null },
    })
    const highProteinDrink = makeDish({
      id: 'drink-fish',
      category: 'نوشیدنی',
      proteinSource: 'fish-shrimp',
      costPerServing: 20_000,
      // به‌قدر کافی بزرگ که اگر (به‌اشتباه) در محاسبه‌ی سهم منابع لحاظ شود، سهم گوشت قرمز را از
      // ۹۵٪ به ۵۶٪ (فاصله‌ی ۴۴ واحد، فراتر از تحمل ۱۰) برساند، ولی نه آن‌قدر بزرگ که به‌تنهایی
      // سقف مجاز پروتئین کل رویداد (Hard Constraint دیگری، بی‌ربط به این تست) را رد کند.
      nutrition: { proteinGrams: 150, carbGrams: 0, fatGrams: 0, fiberGrams: null, calories: null },
    })
    const lowProteinSide = (id: string, category: 'پیش‌غذا' | 'دسر') =>
      makeDish({ id, category, proteinSource: 'plant-other', costPerServing: 20_000, nutrition: { proteinGrams: 5, carbGrams: 10, fatGrams: 2, fiberGrams: null, calories: null } })
    const others = [lowProteinSide('app', 'پیش‌غذا'), lowProteinSide('dessert', 'دسر')]
    const plan = makePlan({ guestCount: 20, perPersonBudget: 2_000_000 })
    const localSettings: AppSettings = {
      ...settings,
      menuOptimizer: {
        ...defaultMenuOptimizerSettings,
        proteinSourceDistributionTarget: { 'red-meat': 100, 'white-meat': 0, 'fish-shrimp': 0 },
        proteinSourceDistributionTolerancePercent: 10,
        minDishesPerCategory: { 'غذای اصلی': 1, 'پیش‌غذا': 1, 'دسر': 1, 'نوشیدنی': 1 },
        maxDishesPerCategory: { 'غذای اصلی': 1, 'پیش‌غذا': 1, 'دسر': 1, 'نوشیدنی': 1 },
      },
    }
    const { proposals } = generateMenuProposals([mainRedMeat, highProteinDrink, ...others], plan, localSettings)

    // اگر نوشیدنی در محاسبه لحاظ می‌شد، سهم گوشت قرمز به‌شدت رقیق می‌شد و هیچ ترکیبی هدف ۱۰۰٪ را
    // برآورده نمی‌کرد؛ چون این‌طور نیست، حداقل یک پیشنهاد معتبر (با main-red) باید وجود داشته باشد.
    expect(proposals.length).toBeGreaterThan(0)
    expect(proposals.some((p) => p.dishes.some((d) => d.dishId === 'main-red'))).toBe(true)
  })
})
