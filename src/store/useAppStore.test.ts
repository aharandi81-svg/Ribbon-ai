import { describe, it, expect, beforeEach } from 'vitest'
import { useAppStore } from './useAppStore'
import { generateMenuProposals } from '../lib/menuOptimizer'

/**
 * رگرسیون باگ «محاسبه منو هوشمند اصلاً کار نمی‌کند»: یک dishConstraint («الزامی» یا هر نوع
 * دیگر) روی شناسه‌ی غذایی که دیگر در کاتالوگ نیست (مثلاً بعد از ادغام نسخه‌های تکراری در یک
 * به‌روزرسانی دیتابیس) باید هنگام بارگذاری پاک شود — وگرنه «الزامی» روی شناسه‌ای که هرگز در
 * هیچ ترکیب کاندیدی حاضر نیست، موتور پیشنهاد منو را برای همیشه صفر پیشنهاد برمی‌گرداند.
 */
describe('reconcilePlan (via loadSnapshot) drops stale dish constraints/selections', () => {
  beforeEach(() => {
    useAppStore.getState().resetPlan()
  })

  it('removes a must-include constraint pointing at a dish id no longer in the catalog', () => {
    const staleId = 'this-dish-id-no-longer-exists-in-catalog'
    useAppStore.getState().loadSnapshot({
      dishes: useAppStore.getState().dishes,
      plan: { ...useAppStore.getState().plan, dishConstraints: { [staleId]: 'must-include' } },
      settings: useAppStore.getState().settings,
      ingredientPriceLog: {},
      customIngredients: {},
    })

    const { dishes, plan, settings } = useAppStore.getState()
    expect(plan.dishConstraints[staleId]).toBeUndefined()

    const { proposals } = generateMenuProposals(dishes, plan, settings)
    expect(proposals.length).toBeGreaterThan(0)
  })

  it('drops a selectedItem pointing at a removed dish id', () => {
    const staleId = 'this-dish-id-no-longer-exists-in-catalog'
    useAppStore.getState().loadSnapshot({
      dishes: useAppStore.getState().dishes,
      plan: {
        ...useAppStore.getState().plan,
        selectedItems: [{ itemId: 'x1', dishId: staleId, tier: 'استاندارد', portionSize: 200 }],
      },
      settings: useAppStore.getState().settings,
      ingredientPriceLog: {},
      customIngredients: {},
    })

    expect(useAppStore.getState().plan.selectedItems.some((it) => it.dishId === staleId)).toBe(false)
  })

  it('keeps a must-include constraint for a dish that still exists', () => {
    const realId = useAppStore.getState().dishes[0].id
    useAppStore.getState().loadSnapshot({
      dishes: useAppStore.getState().dishes,
      plan: { ...useAppStore.getState().plan, dishConstraints: { [realId]: 'must-include' } },
      settings: useAppStore.getState().settings,
      ingredientPriceLog: {},
      customIngredients: {},
    })

    expect(useAppStore.getState().plan.dishConstraints[realId]).toBe('must-include')
  })
})
