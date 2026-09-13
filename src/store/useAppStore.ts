import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { dishes as initialDishes } from '../data/dishes'
import { defaultEventPlan, defaultSettings } from '../data/defaultSettings'
import { computeIngredientsCostTotal } from '../lib/calculations'
import type { CustomIngredientDef, CustomIngredients } from '../lib/ingredients'
import type {
  AppSettings,
  Category,
  CookingMethod,
  Dish,
  DishConstraintType,
  EventPlan,
  IngredientPriceLogEntry,
  MenuOptimizerSettings,
  MenuProposal,
  NewDishInput,
  SelectedItem,
  Tier,
  WasteRisk,
} from '../types'

function makeId(): string {
  return Math.random().toString(36).slice(2, 10)
}

interface AppState {
  dishes: Dish[]
  plan: EventPlan
  settings: AppSettings
  /** تاریخچه‌ی تغییر قیمت هر ماده اولیه، به‌ازای نام — جدیدترین رکورد همیشه اول آرایه. مستقل از
   * dishes نگه داشته می‌شود (نه داخل Dish.ingredients) تا هم با هر انتشار جدید دیتابیس غذا
   * (reconcileDishes) پاک نشود، هم یک تغییر قیمت بلافاصله روی همه‌ی غذاهای استفاده‌کننده از آن
   * ماده اثر بگذارد — نگاه کنید به src/lib/ingredients.ts. */
  ingredientPriceLog: Record<string, IngredientPriceLogEntry[]>
  /** ثبت قیمت جدید یک ماده اولیه — بلافاصله اعمال می‌شود (بدون نیاز به تأیید/ذخیره‌ی جداگانه)
   * و روی همه‌ی غذاهایی که از این ماده استفاده می‌کنند اثر می‌گذارد، چون قیمت مؤثر از این لاگ
   * محاسبه می‌شود نه از یک کپی محلی روی هر غذا. */
  setIngredientPrice: (name: string, unitPrice: number) => void
  /** مواد اولیه‌ی «دستی»‌ای که کاربر از صفحه‌ی «مواد اولیه» تعریف کرده و هنوز ممکن است در هیچ
   * غذایی استفاده نشده باشند — تا بشود بعداً از منوی «افزودن ماده اولیه» در فرم ویرایش غذا
   * انتخابشان کرد. نگاه کنید به src/lib/ingredients.ts::buildIngredientRows. */
  customIngredients: CustomIngredients
  /** تعریف یک ماده اولیه‌ی کاملاً جدید (نامی که قبلاً در هیچ غذا یا فهرست دستی‌ای نبوده). قیمت
   * اولیه (اگر داده شود) بلافاصله به‌عنوان اولین رکورد ingredientPriceLog همان نام ثبت می‌شود. */
  addCustomIngredient: (name: string, def: CustomIngredientDef, initialPrice: number | null) => void
  /** جایگزینی کامل وضعیت برنامه با یک عکس‌فوری بارگذاری‌شده از فایل دیتابیس روی دیسک (نگاه کنید
   * به src/lib/fileStorage.ts و FileDatabaseBar) — از همان reconcile*های استفاده‌شده در merge()ی
   * persist رد می‌شود تا اگر فایل قدیمی/ناقص بود، ساختار نهایی هنوز معتبر بماند. */
  loadSnapshot: (snapshot: {
    dishes?: Dish[]
    plan?: Partial<EventPlan>
    settings?: Partial<AppSettings>
    ingredientPriceLog?: Record<string, IngredientPriceLogEntry[]>
    customIngredients?: CustomIngredients
  }) => void

  setPlanField: <K extends keyof EventPlan>(key: K, value: EventPlan[K]) => void
  setCategoryBudgetShare: (category: Category, value: number) => void

  addSelectedItem: (category: Category, dishId: string) => void
  updateSelectedItem: (itemId: string, patch: Partial<SelectedItem>) => void
  removeSelectedItem: (itemId: string) => void

  setSettings: (patch: Partial<AppSettings>) => void
  setTierWeight: (tier: Tier, value: number) => void
  setDefaultCoverageByTier: (tier: Tier, value: number) => void
  setTierCostCeilingShare: (tier: Tier, value: number) => void
  setNutritionTarget: (key: keyof AppSettings['nutritionTargets'], value: number) => void
  setCookingMethodCapacity: (method: CookingMethod, value: number) => void
  setConfidenceFactorByWasteRisk: (risk: WasteRisk, value: number) => void
  setMenuOptimizerSettings: (patch: Partial<MenuOptimizerSettings>) => void

  setDishConstraint: (dishId: string, constraint: DishConstraintType | null) => void
  /** جایگزینی کامل ردیف‌های انتخابی پلن با خروجی یک پیشنهاد منوی موتور بهینه‌سازی. */
  applyMenuProposal: (proposal: MenuProposal) => void

  updateDish: (dishId: string, patch: Partial<Dish>) => void
  upsertDishes: (updated: Dish[], added: Dish[]) => void
  bulkAdjustPrices: (percent: number) => number
  addDish: (input: NewDishInput) => string
  removeDish: (dishId: string) => void
  removeDishes: (dishIds: string[]) => void
  /** ثبت مصرف واقعی یک آیتم بعد از پایان رویداد — میانگین متحرک observedCoveragePercent همان
   * غذا را به‌روزرسانی می‌کند تا در رویدادهای بعدی به‌جای حدس اولیه، از داده‌ی واقعی استفاده شود. */
  recordActualConsumption: (itemId: string, actualServed: number) => void

  resetPlan: () => void
}

// فیلدهای واقعاً «ویرایش کاربر» روی یک غذا — بقیه فیلدها (ماکرو خام‌استخراج‌شده، مواد اولیه،
// برچسب رژیمی خودکار و ...) همیشه باید از کاتالوگ تازه‌ی dishes.json بیایند، نه از localStorage
// قدیمی، وگرنه هر بار که دیتابیس غذا در یک نسخه جدید اصلاح می‌شود کاربرانی که قبلاً از اپ استفاده
// کرده‌اند برای همیشه روی داده‌ی قدیمی گیر می‌کنند.
const USER_EDITABLE_DISH_FIELDS = [
  'name',
  'category',
  'macro',
  'costPerServing',
  'costSource',
  'needsPrice',
  'priceVarianceFlag',
  'referencePortionGrams',
  'needsPortionEstimate',
  'dietaryTagsVerified',
  'wasteRisk',
  'wasteRiskVerified',
  // این دو داده‌ی یادگرفته‌شده از رویدادهای واقعی‌اند (نگاه کنید به recordActualConsumption)،
  // نه خروجی استخراج اکسل — باید حتماً هر بار که dishes.json به‌روزرسانی می‌شود حفظ شوند،
  // وگرنه با هر انتشار جدید حلقه‌ی یادگیری از صفر شروع می‌شود.
  'observedCoveragePercent',
  'observedEventsRecorded',
  // تشخیص خودکارِ منبع پروتئین/روش پخت پیش‌فرض هم مثل wasteRisk مستقیماً از دیتابیس غذا
  // قابل‌ویرایش است (نگاه کنید به DishDatabasePage) و باید مثل آن حفظ شود.
  'proteinSource',
  'proteinSourceVerified',
  'defaultCookingMethod',
  'defaultCookingMethodVerified',
  // فهرست مواد اولیه‌ی یک غذا (نه قیمتشان — آن از ingredientPriceLog سراسری می‌آید) از فرم ویرایش
  // غذا قابل افزودن/حذف است (نگاه کنید به DishFormModal) — پس مثل بقیه‌ی ویرایش‌های کاربر باید
  // با هر انتشار جدید دیتابیس غذا حفظ شود.
  'ingredients',
  'ingredientsCostTotal',
] as const

function reconcileDishes(persisted: Dish[] | undefined): Dish[] {
  if (!persisted || persisted.length === 0) return initialDishes
  const persistedById = new Map(persisted.map((d) => [d.id, d]))
  const freshIds = new Set(initialDishes.map((d) => d.id))

  const reconciled = initialDishes.map((fresh) => {
    const old = persistedById.get(fresh.id)
    if (!old) return fresh
    const patch: Partial<Dish> = {}
    for (const key of USER_EDITABLE_DISH_FIELDS) {
      if (old[key] !== undefined) (patch as Record<string, unknown>)[key] = old[key]
    }
    return { ...fresh, ...patch }
  })

  // غذاهایی که کاربر خودش (مثلاً از ایمپورت اکسل) اضافه کرده و در کاتالوگ تازه نیستند، حفظ می‌شوند.
  const userAdded = persisted.filter((d) => !freshIds.has(d.id))
  return [...reconciled, ...userAdded]
}

function reconcileSettings(persisted: Partial<AppSettings> | undefined): AppSettings {
  if (!persisted) return defaultSettings
  return {
    tierWeights: { ...defaultSettings.tierWeights, ...persisted.tierWeights },
    defaultCoverageByTier: { ...defaultSettings.defaultCoverageByTier, ...persisted.defaultCoverageByTier },
    tierCostCeilingShare: { ...defaultSettings.tierCostCeilingShare, ...persisted.tierCostCeilingShare },
    confidenceFactorByWasteRisk: {
      ...defaultSettings.confidenceFactorByWasteRisk,
      ...persisted.confidenceFactorByWasteRisk,
    },
    nutritionTargets: { ...defaultSettings.nutritionTargets, ...persisted.nutritionTargets },
    cookingMethodCapacity: { ...defaultSettings.cookingMethodCapacity, ...persisted.cookingMethodCapacity },
    menuOptimizer: {
      ...defaultSettings.menuOptimizer,
      ...persisted.menuOptimizer,
      proteinSourceDistributionTarget: {
        ...defaultSettings.menuOptimizer.proteinSourceDistributionTarget,
        ...persisted.menuOptimizer?.proteinSourceDistributionTarget,
      },
      targetMenuProfiles: {
        ...defaultSettings.menuOptimizer.targetMenuProfiles,
        ...persisted.menuOptimizer?.targetMenuProfiles,
      },
      dishScoreWeights: { ...defaultSettings.menuOptimizer.dishScoreWeights, ...persisted.menuOptimizer?.dishScoreWeights },
      menuScoreWeights: { ...defaultSettings.menuOptimizer.menuScoreWeights, ...persisted.menuOptimizer?.menuScoreWeights },
      minDishesPerCategory: {
        ...defaultSettings.menuOptimizer.minDishesPerCategory,
        ...persisted.menuOptimizer?.minDishesPerCategory,
      },
      maxDishesPerCategory: {
        ...defaultSettings.menuOptimizer.maxDishesPerCategory,
        ...persisted.menuOptimizer?.maxDishesPerCategory,
      },
    },
  }
}

function reconcilePlan(persisted: Partial<EventPlan> | undefined): EventPlan {
  if (!persisted) return defaultEventPlan
  return {
    ...defaultEventPlan,
    ...persisted,
    categoryBudgetShare: { ...defaultEventPlan.categoryBudgetShare, ...persisted.categoryBudgetShare },
    dishConstraints: { ...defaultEventPlan.dishConstraints, ...persisted.dishConstraints },
  }
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      dishes: initialDishes,
      plan: defaultEventPlan,
      settings: defaultSettings,
      ingredientPriceLog: {},
      customIngredients: {},

      setIngredientPrice: (name, unitPrice) =>
        set((state) => ({
          ingredientPriceLog: {
            ...state.ingredientPriceLog,
            [name]: [{ price: unitPrice, changedAt: new Date().toISOString() }, ...(state.ingredientPriceLog[name] ?? [])],
          },
        })),

      addCustomIngredient: (name, def, initialPrice) => {
        set((state) => ({ customIngredients: { ...state.customIngredients, [name]: def } }))
        if (initialPrice != null && initialPrice > 0) get().setIngredientPrice(name, initialPrice)
      },

      loadSnapshot: (snapshot) =>
        set(() => ({
          dishes: reconcileDishes(snapshot.dishes),
          settings: reconcileSettings(snapshot.settings),
          plan: reconcilePlan(snapshot.plan),
          ingredientPriceLog: snapshot.ingredientPriceLog ?? {},
          customIngredients: snapshot.customIngredients ?? {},
        })),

      setPlanField: (key, value) =>
        set((state) => ({ plan: { ...state.plan, [key]: value } })),

      setCategoryBudgetShare: (category, value) =>
        set((state) => ({
          plan: {
            ...state.plan,
            categoryBudgetShare: { ...state.plan.categoryBudgetShare, [category]: value },
          },
        })),

      addSelectedItem: (category, dishId) => {
        const { dishes } = get()
        const tier: Tier = 'استاندارد'
        const dish = dishes.find((d) => d.id === dishId)
        // سهم پوشش دیگر اینجا تعیین نمی‌شود — خودِ سیستم آن را هر بار از روی وزن خام این آیتم
        // (داده‌ی واقعی رویدادهای قبلی یا پیش‌فرض رده) در برابر کل دسته حساب می‌کند؛ نگاه کنید
        // به rawCoverageWeight در lib/calculations.ts.
        const newItem: SelectedItem = {
          itemId: makeId(),
          dishId,
          tier,
          portionSize: dish?.referencePortionGrams ?? 250,
          cookingMethod: category === 'نوشیدنی' ? undefined : 'گریل',
        }
        set((state) => ({ plan: { ...state.plan, selectedItems: [...state.plan.selectedItems, newItem] } }))
      },

      updateSelectedItem: (itemId, patch) =>
        set((state) => ({
          plan: {
            ...state.plan,
            selectedItems: state.plan.selectedItems.map((it) => (it.itemId === itemId ? { ...it, ...patch } : it)),
          },
        })),

      removeSelectedItem: (itemId) =>
        set((state) => ({
          plan: { ...state.plan, selectedItems: state.plan.selectedItems.filter((it) => it.itemId !== itemId) },
        })),

      setSettings: (patch) => set((state) => ({ settings: { ...state.settings, ...patch } })),

      setTierWeight: (tier, value) =>
        set((state) => ({ settings: { ...state.settings, tierWeights: { ...state.settings.tierWeights, [tier]: value } } })),

      setDefaultCoverageByTier: (tier, value) =>
        set((state) => ({
          settings: { ...state.settings, defaultCoverageByTier: { ...state.settings.defaultCoverageByTier, [tier]: value } },
        })),

      setTierCostCeilingShare: (tier, value) =>
        set((state) => ({
          settings: { ...state.settings, tierCostCeilingShare: { ...state.settings.tierCostCeilingShare, [tier]: value } },
        })),

      setNutritionTarget: (key, value) =>
        set((state) => ({
          settings: { ...state.settings, nutritionTargets: { ...state.settings.nutritionTargets, [key]: value } },
        })),

      setCookingMethodCapacity: (method, value) =>
        set((state) => ({
          settings: { ...state.settings, cookingMethodCapacity: { ...state.settings.cookingMethodCapacity, [method]: value } },
        })),

      setConfidenceFactorByWasteRisk: (risk, value) =>
        set((state) => ({
          settings: {
            ...state.settings,
            confidenceFactorByWasteRisk: { ...state.settings.confidenceFactorByWasteRisk, [risk]: value },
          },
        })),

      setMenuOptimizerSettings: (patch) =>
        set((state) => ({
          settings: { ...state.settings, menuOptimizer: { ...state.settings.menuOptimizer, ...patch } },
        })),

      setDishConstraint: (dishId, constraint) =>
        set((state) => {
          const dishConstraints = { ...state.plan.dishConstraints }
          if (constraint == null) delete dishConstraints[dishId]
          else dishConstraints[dishId] = constraint
          return { plan: { ...state.plan, dishConstraints } }
        }),

      applyMenuProposal: (proposal) =>
        set((state) => {
          const selectedItems: SelectedItem[] = proposal.dishes.map((d) => ({
            itemId: makeId(),
            dishId: d.dishId,
            tier: 'استاندارد',
            portionSize: d.portionGrams,
            cookingMethod: d.cookingMethod ?? undefined,
          }))
          return { plan: { ...state.plan, selectedItems } }
        }),

      updateDish: (dishId, patch) =>
        set((state) => ({ dishes: state.dishes.map((d) => (d.id === dishId ? { ...d, ...patch } : d)) })),

      upsertDishes: (updated, added) =>
        set((state) => {
          const updatedById = new Map(updated.map((d) => [d.id, d]))
          const merged = state.dishes.map((d) => updatedById.get(d.id) ?? d)
          return { dishes: [...merged, ...added] }
        }),

      bulkAdjustPrices: (percent) => {
        let count = 0
        set((state) => ({
          dishes: state.dishes.map((d) => {
            if (d.costPerServing == null) return d
            count += 1
            return { ...d, costPerServing: Math.round((d.costPerServing * (1 + percent / 100)) / 1000) * 1000 }
          }),
        }))
        return count
      },

      addDish: (input) => {
        const id = `manual-${makeId()}`
        const newDish: Dish = {
          id,
          name: input.name.trim() || 'غذای جدید',
          category: input.category,
          macro: input.macro,
          costPerServing: input.costPerServing,
          costSource: 'دستی (افزوده‌شده در اپ)',
          priceVarianceFlag: false,
          needsPrice: input.costPerServing == null,
          eventsUsedIn: [],
          ingredients: input.ingredients ?? null,
          ingredientsCostTotal: computeIngredientsCostTotal(input.ingredients),
          referencePortionGrams: input.referencePortionGrams,
          portionSource: 'دستی (افزوده‌شده در اپ)',
          needsPortionEstimate: false,
          dietaryTags: input.dietaryTags,
          dietaryTagsVerified: true,
          isBreakfastItem: input.isBreakfastItem,
          wasteRisk: input.wasteRisk,
          wasteRiskVerified: true,
          observedCoveragePercent: null,
          observedEventsRecorded: 0,
          nutrition: input.nutrition,
          needsNutritionReview: false,
          proteinSource: input.proteinSource,
          proteinSourceVerified: true,
          defaultCookingMethod: input.defaultCookingMethod,
          defaultCookingMethodVerified: input.defaultCookingMethod != null,
        }
        set((state) => ({ dishes: [...state.dishes, newDish] }))
        return id
      },

      removeDish: (dishId) =>
        set((state) => ({
          dishes: state.dishes.filter((d) => d.id !== dishId),
          plan: {
            ...state.plan,
            selectedItems: state.plan.selectedItems.filter((it) => it.dishId !== dishId),
          },
        })),

      removeDishes: (dishIds) =>
        set((state) => {
          const idSet = new Set(dishIds)
          return {
            dishes: state.dishes.filter((d) => !idSet.has(d.id)),
            plan: {
              ...state.plan,
              selectedItems: state.plan.selectedItems.filter((it) => !idSet.has(it.dishId)),
            },
          }
        }),

      recordActualConsumption: (itemId, actualServed) =>
        set((state) => {
          const item = state.plan.selectedItems.find((it) => it.itemId === itemId)
          if (!item) return state
          const expectedGuests = state.plan.guestCount * state.plan.expectedAttendanceRate
          if (expectedGuests <= 0) return state
          // درصد واقعی مصرف نسبت به مهمانان حاضر — سقف ۲ (۲۰۰٪) برای جلوگیری از خراب‌کردن
          // میانگین با یک ورودی اشتباه تایپی (مثلاً صفر اضافه).
          const actualPercent = Math.min(2, Math.max(0, actualServed / expectedGuests))
          return {
            dishes: state.dishes.map((d) => {
              if (d.id !== item.dishId) return d
              const prevCount = d.observedEventsRecorded
              // اگر هنوز داده‌ی قبلی نیست، همین رویداد اول مبنا می‌شود (نه یک پیش‌بینی نرمال‌شده‌ی
              // نامعتبر که ربطی به مصرف واقعی ندارد).
              const prevAvg = d.observedCoveragePercent ?? actualPercent
              // میانگین متحرک ساده: هر رویداد جدید وزن مساوی با رویدادهای قبلی دارد.
              const nextAvg = (prevAvg * prevCount + actualPercent) / (prevCount + 1)
              return { ...d, observedCoveragePercent: nextAvg, observedEventsRecorded: prevCount + 1 }
            }),
          }
        }),

      resetPlan: () => set({ plan: defaultEventPlan }),
    }),
    {
      name: 'buffet-planner-storage',
      version: 2,
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<AppState>
        return {
          ...current,
          dishes: reconcileDishes(p.dishes),
          settings: reconcileSettings(p.settings),
          plan: reconcilePlan(p.plan),
          // ذخیره‌شده در localStorage و دیتای کاملاً جدید و کاربرساخته است، هیچ‌وقت با کاتالوگ
          // تازه‌ی dishes.json تداخل ندارد — پس برخلاف dishes، نیازی به reconcile ندارد.
          ingredientPriceLog: p.ingredientPriceLog ?? {},
          customIngredients: p.customIngredients ?? {},
        }
      },
    },
  ),
)
