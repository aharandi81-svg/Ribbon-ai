import { describe, expect, it } from 'vitest'
import { defaultMenuOptimizerSettings } from '../data/defaultSettings'
import type { AppSettings, Dish, EventPlan, SelectedItem } from '../types'
import { chefRecommendations, financialRecommendations } from './recommendations'

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
    dataReviewed: false,
    ...overrides,
  }
}

function makePlan(overrides: Partial<EventPlan> = {}): EventPlan {
  return {
    guestCount: 100,
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

describe('chefRecommendations — pooled reserve insight', () => {
  it('suggests a pooled reserve when a category has 2+ dishes each with an individual reserve', () => {
    const a = makeDish({ id: 'a', wasteRisk: 'فسادپذیر' })
    const b = makeDish({ id: 'b', wasteRisk: 'فسادپذیر' })
    const dishesById = new Map([
      ['a', a],
      ['b', b],
    ])
    const items: SelectedItem[] = [
      { itemId: '1', dishId: 'a', tier: 'استاندارد', portionSize: 250 },
      { itemId: '2', dishId: 'b', tier: 'استاندارد', portionSize: 250 },
    ]
    const plan = makePlan({ confidenceFactor: 1.2, selectedItems: items }) // نیاز به margin>0 برای وجود reserve
    const recs = chefRecommendations(plan, dishesById, settings)
    expect(recs.some((r) => r.id === 'pooled-reserve-غذای اصلی')).toBe(true)
  })

  it('does not suggest pooling for a single dish in a category', () => {
    const a = makeDish({ id: 'a', wasteRisk: 'فسادپذیر' })
    const dishesById = new Map([['a', a]])
    const items: SelectedItem[] = [{ itemId: '1', dishId: 'a', tier: 'استاندارد', portionSize: 250 }]
    const plan = makePlan({ confidenceFactor: 1.2, selectedItems: items })
    const recs = chefRecommendations(plan, dishesById, settings)
    expect(recs.some((r) => r.id.startsWith('pooled-reserve-'))).toBe(false)
  })
})

describe('financialRecommendations — waste-risk exposure insight', () => {
  it('flags meaningful monetary exposure from perishable dishes above the 2% threshold', () => {
    // هزینه پرس بالا + ذخیره‌ی قابل‌توجه → ریسک هدررفت باید نسبت بزرگی از بودجه کوچک بشود
    const expensive = makeDish({ id: 'e', wasteRisk: 'فسادپذیر', costPerServing: 500_000 })
    const dishesById = new Map([['e', expensive]])
    const items: SelectedItem[] = [{ itemId: '1', dishId: 'e', tier: 'استاندارد', portionSize: 250 }]
    const plan = makePlan({ perPersonBudget: 100_000, confidenceFactor: 1.5, selectedItems: items })
    const recs = financialRecommendations(plan, dishesById, settings)
    expect(recs.some((r) => r.id === 'waste-risk-exposure')).toBe(true)
  })

  it('stays quiet when waste exposure is a tiny fraction of the total budget', () => {
    const cheap = makeDish({ id: 'c', wasteRisk: 'فسادپذیر', costPerServing: 1_000 })
    const dishesById = new Map([['c', cheap]])
    const items: SelectedItem[] = [{ itemId: '1', dishId: 'c', tier: 'استاندارد', portionSize: 250 }]
    const plan = makePlan({ perPersonBudget: 10_000_000, confidenceFactor: 1.05, selectedItems: items })
    const recs = financialRecommendations(plan, dishesById, settings)
    expect(recs.some((r) => r.id === 'waste-risk-exposure')).toBe(false)
  })

  it('never flags exposure for reusable (non-perishable) dishes', () => {
    const reusable = makeDish({ id: 'r', wasteRisk: 'قابل‌نگهداری', costPerServing: 500_000 })
    const dishesById = new Map([['r', reusable]])
    const items: SelectedItem[] = [{ itemId: '1', dishId: 'r', tier: 'استاندارد', portionSize: 250 }]
    const plan = makePlan({ perPersonBudget: 100_000, confidenceFactor: 1.5, selectedItems: items })
    const recs = financialRecommendations(plan, dishesById, settings)
    expect(recs.some((r) => r.id === 'waste-risk-exposure')).toBe(false)
  })
})
