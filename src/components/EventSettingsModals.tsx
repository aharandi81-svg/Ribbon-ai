import { useState } from 'react'
import { useAppStore } from '../store/useAppStore'
import { AccentLabel, Button, ErrorBadge, Field, FormattedNumberInput, Modal, NumberInput, Select, StatTile, WarningBadge } from './ui'
import {
  BUDGET_OVERRUN_BEHAVIORS,
  BUDGET_OVERRUN_BEHAVIOR_LABELS,
  CATEGORIES,
  COOKING_METHODS,
  MEAL_TYPES,
  NUMBER_OF_PROPOSALS_OPTIONS,
  PROTEIN_SOURCE_DISTRIBUTION_KEYS,
  PROTEIN_SOURCE_LABELS,
  TARGET_MENU_PROFILE_IDS,
  TIERS,
  WASTE_RISK_LEVELS,
} from '../types'
import type { DishScoreWeights, MenuScoreWeights, NumberOfProposalsOption } from '../types'
import { formatPercent, formatRial } from '../lib/format'

const DISH_SCORE_WEIGHT_LABELS: Record<keyof DishScoreWeights, string> = {
  macroFit: 'هم‌راستایی ماکرو با پروفایل هدف',
  proteinDensity: 'چگالی پروتئین',
  costEfficiency: 'کارایی هزینه (پروتئین/هزینه)',
  wasteRiskSafety: 'ایمنی ریسک هدررفت',
  dataConfidence: 'اطمینان داده',
  kitchenFeasibility: 'امکان‌سنجی آشپزخانه',
  varietyContribution: 'سهم در تنوع منو',
  guestAppealProxy: 'اقبال مهمانان (سابقه واقعی)',
}

const MENU_SCORE_WEIGHT_LABELS: Record<keyof MenuScoreWeights, string> = {
  proteinFit: 'تناسب پروتئین با هدف',
  macroFit: 'هم‌راستایی ماکرو با پروفایل هدف',
  proteinDiversity: 'تنوع منابع پروتئین',
  menuVariety: 'تنوع کلی منو',
  kitchenFeasibility: 'امکان‌سنجی آشپزخانه',
  costFit: 'تناسب هزینه با بودجه',
  avgDishScore: 'میانگین امتیاز غذاها',
}

function ModalFooter({ onClose }: { onClose: () => void }) {
  return (
    <div className="mt-5 flex justify-end border-t border-slate-100 pt-4 dark:border-slate-800">
      <Button onClick={onClose}>بستن</Button>
    </div>
  )
}

/** همه‌ی این پاپ‌آپ‌ها بلافاصله با هر تغییر روی store اعمال می‌شوند (مثل رفتار قبلی فرم‌های
 * درون‌صفحه‌ای) — پس فقط دکمه‌ی «بستن» دارند، نه «ذخیره/انصراف» جداگانه. */
export function CoreParamsModal({ onClose }: { onClose: () => void }) {
  const plan = useAppStore((s) => s.plan)
  const setPlanField = useAppStore((s) => s.setPlanField)
  const totalBudget = plan.guestCount * plan.perPersonBudget

  return (
    <Modal title="پارامترهای اصلی رویداد" onClose={onClose} widthClassName="max-w-3xl">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="تعداد میهمانان">
          <NumberInput value={plan.guestCount} min={1} onChange={(v) => setPlanField('guestCount', v)} />
        </Field>
        <Field label="بودجه سرانه (ریال)">
          <FormattedNumberInput value={plan.perPersonBudget} onChange={(v) => setPlanField('perPersonBudget', v)} />
        </Field>
        <Field
          label="ضریب اطمینان دستی رویداد"
          hint="ضریب اضافه روی ضریب پایه‌ی هر غذا (بر اساس ریسک هدررفت آن، در تنظیمات پیشرفته) — پیش‌فرض ۱"
        >
          <NumberInput value={plan.confidenceFactor} min={1} step={0.05} onChange={(v) => setPlanField('confidenceFactor', v)} />
        </Field>
        <Field label="نرخ حضور مورد انتظار (٪)" hint="جدا از ضریب اطمینان — درصد دعوت‌شدگانی که واقعاً می‌آیند">
          <NumberInput
            value={Math.round(plan.expectedAttendanceRate * 100)}
            min={0}
            max={100}
            onChange={(v) => setPlanField('expectedAttendanceRate', v / 100)}
          />
        </Field>
        <Field label="نوع وعده">
          <Select value={plan.mealType} onChange={(v) => setPlanField('mealType', v)} options={MEAL_TYPES} />
        </Field>
      </div>
      <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">
        بودجه کل رویداد: <span className="font-semibold text-slate-800 dark:text-slate-200">{formatRial(totalBudget)}</span>
      </p>
      <ModalFooter onClose={onClose} />
    </Modal>
  )
}

export function CategoryBudgetModal({ onClose }: { onClose: () => void }) {
  const plan = useAppStore((s) => s.plan)
  const setCategoryBudgetShare = useAppStore((s) => s.setCategoryBudgetShare)
  const shareSum = CATEGORIES.reduce((sum, c) => sum + (plan.categoryBudgetShare[c] ?? 0), 0)
  const shareOver = shareSum - 1 > 0.001
  const shareUnder = 1 - shareSum > 0.001

  return (
    <Modal title="سهم بودجه هر دسته از سرانه" onClose={onClose} widthClassName="max-w-4xl">
      {shareOver && (
        <ErrorBadge>
          جمع سهم‌ها {formatPercent(shareSum)} شده — یک یا چند دسته دیگر را کم کنید یا بودجه سرانه را افزایش دهید
        </ErrorBadge>
      )}
      {shareUnder && (
        <WarningBadge>جمع سهم‌ها {formatPercent(shareSum)} است؛ {formatPercent(1 - shareSum)} از بودجه سرانه هنوز تخصیص نیافته</WarningBadge>
      )}
      <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {CATEGORIES.map((category) => {
          const value = plan.categoryBudgetShare[category] ?? 0
          const perGuestAmount = plan.perPersonBudget * value
          const totalAmount = plan.guestCount * perGuestAmount
          return (
            <div
              key={category}
              className="rounded-xl border border-slate-200 bg-white p-5 transition-shadow hover:shadow-sm dark:border-slate-700 dark:bg-slate-800/60"
            >
              <AccentLabel className="mb-1">{category}</AccentLabel>
              <div className="mb-4 flex items-baseline gap-1">
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={Math.round(value * 100)}
                  onChange={(e) => setCategoryBudgetShare(category, Number(e.target.value) / 100)}
                  className="w-16 border-0 bg-transparent p-0 text-3xl font-bold text-slate-900 focus:outline-none focus:ring-0 dark:text-slate-100"
                />
                <span className="text-xl font-bold text-slate-400 dark:text-slate-500">٪</span>
              </div>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={value}
                onChange={(e) => setCategoryBudgetShare(category, Number(e.target.value))}
                className="w-full accent-amber-600"
              />
              <div className="mt-4">
                <StatTile label="سهم هر مهمان" value={formatRial(perGuestAmount)} />
              </div>
              <p className="mt-2 text-xs text-slate-400 dark:text-slate-500">
                سهم کل رویداد: <span className="font-medium text-slate-500 dark:text-slate-400">{formatRial(totalAmount)}</span>
              </p>
            </div>
          )
        })}
      </div>
      <ModalFooter onClose={onClose} />
    </Modal>
  )
}

export function OptimizerSettingsModal({ onClose }: { onClose: () => void }) {
  const settings = useAppStore((s) => s.settings)
  const setMenuOptimizerSettings = useAppStore((s) => s.setMenuOptimizerSettings)
  const [showWeights, setShowWeights] = useState(false)
  const opt = settings.menuOptimizer
  const proteinDistSum = PROTEIN_SOURCE_DISTRIBUTION_KEYS.reduce((s, k) => s + opt.proteinSourceDistributionTarget[k], 0)
  const plantOtherShare = Math.max(0, 100 - proteinDistSum)

  return (
    <Modal title="تنظیمات Menu Optimization Engine" onClose={onClose} widthClassName="max-w-5xl">
      <p className="mb-4 text-xs text-slate-400 dark:text-slate-500">
        پروفایل‌های زیر صرفاً دو الگوی داخلی قابل‌تنظیم برای هدف‌گذاری ترکیب پروتئین/چربی/کربوهیدرات منو هستند — به هیچ
        عنوان استاندارد پزشکی یا رژیم درمانی تأییدشده نیستند.
      </p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="پروتئین هدف هر مهمان (گرم)" hint="پیش‌فرض ۳۰۰ گرم — کاملاً قابل تغییر">
          <NumberInput
            value={opt.proteinTargetGramsPerGuest}
            min={0}
            onChange={(v) => setMenuOptimizerSettings({ proteinTargetGramsPerGuest: v })}
          />
        </Field>
        <Field label="ضریب سقف پروتئین (Hard Constraint)" hint="عبور از این ضریب × هدف، کل ترکیب را باطل می‌کند">
          <NumberInput
            value={opt.proteinMaxMultiplier}
            min={1}
            step={0.05}
            onChange={(v) => setMenuOptimizerSettings({ proteinMaxMultiplier: v })}
          />
        </Field>
        <Field label="پروفایل هدف فعال">
          <Select value={opt.activeTargetProfileId} onChange={(v) => setMenuOptimizerSettings({ activeTargetProfileId: v })} options={TARGET_MENU_PROFILE_IDS} />
        </Field>
        <Field label="تعداد پیشنهاد منو">
          <select
            value={opt.numberOfProposals}
            onChange={(e) => setMenuOptimizerSettings({ numberOfProposals: Number(e.target.value) as NumberOfProposalsOption })}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
          >
            {NUMBER_OF_PROPOSALS_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {TARGET_MENU_PROFILE_IDS.map((id) => {
          const profile = opt.targetMenuProfiles[id]
          const sum = profile.proteinSharePercent + profile.fatSharePercent + profile.carbSharePercent
          return (
            <div
              key={id}
              className={`rounded-lg border p-3 ${opt.activeTargetProfileId === id ? 'border-amber-400 bg-amber-50/40 dark:bg-amber-900/10' : 'border-slate-200 dark:border-slate-700'}`}
            >
              <p className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-300">{profile.label}</p>
              <div className="grid grid-cols-3 gap-2">
                <Field label="پروتئین ٪">
                  <NumberInput
                    value={profile.proteinSharePercent}
                    min={0}
                    max={100}
                    onChange={(v) => setMenuOptimizerSettings({ targetMenuProfiles: { ...opt.targetMenuProfiles, [id]: { ...profile, proteinSharePercent: v } } })}
                  />
                </Field>
                <Field label="چربی ٪">
                  <NumberInput
                    value={profile.fatSharePercent}
                    min={0}
                    max={100}
                    onChange={(v) => setMenuOptimizerSettings({ targetMenuProfiles: { ...opt.targetMenuProfiles, [id]: { ...profile, fatSharePercent: v } } })}
                  />
                </Field>
                <Field label="کربوهیدرات ٪">
                  <NumberInput
                    value={profile.carbSharePercent}
                    min={0}
                    max={100}
                    onChange={(v) => setMenuOptimizerSettings({ targetMenuProfiles: { ...opt.targetMenuProfiles, [id]: { ...profile, carbSharePercent: v } } })}
                  />
                </Field>
              </div>
              {Math.abs(sum - 100) > 0.5 && <p className="mt-1 text-xs text-red-600 dark:text-red-400">جمع سه سهم باید ۱۰۰ باشد (الان {sum}).</p>}
            </div>
          )
        })}
      </div>

      <div className="mt-5">
        <h4 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-300">توزیع هدف منابع پروتئین (٪) — Hard Constraint</h4>
        <p className="mb-2 text-xs text-slate-400 dark:text-slate-500">
          سهم واقعی هر منبع بر مبنای گرم واقعی پروتئین کارت رسپی/دیتابیس غذا (نه تعداد قلم) محاسبه و اجباراً اعمال می‌شود — هر ترکیبی که بیش از «تحمل مجاز»
          زیر از این هدف فاصله بگیرد، از پیشنهادهای تولیدشده کاملاً حذف می‌شود.
        </p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {PROTEIN_SOURCE_DISTRIBUTION_KEYS.map((key) => (
            <Field key={key} label={PROTEIN_SOURCE_LABELS[key]}>
              <NumberInput
                value={opt.proteinSourceDistributionTarget[key]}
                min={0}
                max={100}
                onChange={(v) => setMenuOptimizerSettings({ proteinSourceDistributionTarget: { ...opt.proteinSourceDistributionTarget, [key]: v } })}
              />
            </Field>
          ))}
          <Field label={`${PROTEIN_SOURCE_LABELS['plant-other']} (ضمنی)`}>
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-400">{plantOtherShare}٪</div>
          </Field>
        </div>
        {proteinDistSum > 100 && <p className="mt-1 text-xs text-red-600 dark:text-red-400">جمع سه سهم بالا از ۱۰۰٪ عبور کرده — سهم گیاهی/سایر منفی می‌شود.</p>}
        <div className="mt-3 max-w-xs">
          <Field label="تحمل مجاز انحراف از هدف (واحد درصد)" hint="مثلاً ۲۰ یعنی سهم واقعی هر منبع می‌تواند تا ۲۰ واحد درصد از هدف بالا فاصله داشته باشد؛ عبور از آن ترکیب را کاملاً رد می‌کند">
            <NumberInput
              value={opt.proteinSourceDistributionTolerancePercent}
              min={0}
              max={100}
              onChange={(v) => setMenuOptimizerSettings({ proteinSourceDistributionTolerancePercent: v })}
            />
          </Field>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="رفتار عبور از بودجه سرانه">
          <Select value={opt.budgetOverrunBehavior} onChange={(v) => setMenuOptimizerSettings({ budgetOverrunBehavior: v })} options={BUDGET_OVERRUN_BEHAVIORS} />
          <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">{BUDGET_OVERRUN_BEHAVIOR_LABELS[opt.budgetOverrunBehavior]}</p>
        </Field>
        <Field label="تحمل مجاز عبور از بودجه (٪)" hint="پیش از اعمال رفتار بالا">
          <NumberInput
            value={Math.round(opt.budgetOverrunTolerancePercent * 100)}
            min={0}
            max={100}
            onChange={(v) => setMenuOptimizerSettings({ budgetOverrunTolerancePercent: v / 100 })}
          />
        </Field>
      </div>

      <div className="mt-5">
        <h4 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-300">حداقل/حداکثر تعداد قلم غذا به تفکیک دسته در هر پیشنهاد</h4>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {CATEGORIES.map((category) => (
            <div key={category} className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
              <AccentLabel className="mb-3">{category}</AccentLabel>
              <div className="grid grid-cols-2 gap-2">
                <Field label="حداقل">
                  <NumberInput
                    value={opt.minDishesPerCategory[category]}
                    min={0}
                    className="w-full"
                    onChange={(v) => setMenuOptimizerSettings({ minDishesPerCategory: { ...opt.minDishesPerCategory, [category]: v } })}
                  />
                </Field>
                <Field label="حداکثر">
                  <NumberInput
                    value={opt.maxDishesPerCategory[category]}
                    min={0}
                    className="w-full"
                    onChange={(v) => setMenuOptimizerSettings({ maxDishesPerCategory: { ...opt.maxDishesPerCategory, [category]: v } })}
                  />
                </Field>
              </div>
            </div>
          ))}
        </div>
      </div>

      <button type="button" onClick={() => setShowWeights((v) => !v)} className="mt-5 text-sm font-medium text-amber-700 hover:underline dark:text-amber-400">
        {showWeights ? '▲ بستن وزن‌های امتیازدهی' : '▼ وزن‌های امتیازدهی Dish Score و Menu Score'}
      </button>
      {showWeights && (
        <div className="mt-4 flex flex-col gap-6">
          <div>
            <h4 className="mb-1 text-sm font-semibold text-slate-700 dark:text-slate-300">وزن زیرمعیارهای Dish Score (امتیاز ذاتی هر غذا، ۰ تا ۱۰۰)</h4>
            <p className="mb-2 text-xs text-slate-400 dark:text-slate-500">Dish Score با Menu Score یکی نیست — این‌ها فقط به رتبه‌بندی/کوتاه‌لیست‌کردن غذاهای منفرد کمک می‌کنند.</p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {(Object.keys(opt.dishScoreWeights) as (keyof DishScoreWeights)[]).map((key) => (
                <Field key={key} label={DISH_SCORE_WEIGHT_LABELS[key]}>
                  <NumberInput value={opt.dishScoreWeights[key]} min={0} onChange={(v) => setMenuOptimizerSettings({ dishScoreWeights: { ...opt.dishScoreWeights, [key]: v } })} />
                </Field>
              ))}
            </div>
          </div>
          <div>
            <h4 className="mb-1 text-sm font-semibold text-slate-700 dark:text-slate-300">وزن زیرمعیارهای Menu Score (امتیاز کل یک ترکیب منو، ۰ تا ۱۰۰)</h4>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {(Object.keys(opt.menuScoreWeights) as (keyof MenuScoreWeights)[]).map((key) => (
                <Field key={key} label={MENU_SCORE_WEIGHT_LABELS[key]}>
                  <NumberInput value={opt.menuScoreWeights[key]} min={0} onChange={(v) => setMenuOptimizerSettings({ menuScoreWeights: { ...opt.menuScoreWeights, [key]: v } })} />
                </Field>
              ))}
            </div>
          </div>
        </div>
      )}
      <ModalFooter onClose={onClose} />
    </Modal>
  )
}

export function AdvancedConstantsModal({ onClose }: { onClose: () => void }) {
  const plan = useAppStore((s) => s.plan)
  const settings = useAppStore((s) => s.settings)
  const setTierWeight = useAppStore((s) => s.setTierWeight)
  const setDefaultCoverageByTier = useAppStore((s) => s.setDefaultCoverageByTier)
  const setTierCostCeilingShare = useAppStore((s) => s.setTierCostCeilingShare)
  const setConfidenceFactorByWasteRisk = useAppStore((s) => s.setConfidenceFactorByWasteRisk)
  const setCookingMethodCapacity = useAppStore((s) => s.setCookingMethodCapacity)
  const setNutritionTarget = useAppStore((s) => s.setNutritionTarget)

  return (
    <Modal title="تنظیمات پیشرفته (ثابت‌های قابل‌ویرایش)" onClose={onClose} widthClassName="max-w-5xl">
      <div className="flex flex-col gap-6">
        <div>
          <h4 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-300">وزن هر رده (برای تخصیص وزنی بودجه)</h4>
          <p className="mb-2 text-xs text-slate-400 dark:text-slate-500">
            توجه: رده فقط نحوه‌ی تقسیم بودجه‌ی یک دسته بین آیتم‌های آن دسته را مشخص می‌کند — کیفیت خودِ غذا از دیتابیس
            غذا می‌آید و با تغییر رده عوض نمی‌شود. رده «شاخص» یعنی «بودجه بیشتری به این آیتم اختصاص بده»، نه «این غذا
            را با کیفیت بالاتری بپز».
          </p>
          <div className="grid grid-cols-3 gap-3">
            {TIERS.map((tier) => (
              <Field key={tier} label={tier}>
                <NumberInput value={settings.tierWeights[tier]} min={0} step={0.1} onChange={(v) => setTierWeight(tier, v)} />
              </Field>
            ))}
          </div>
        </div>

        <div>
          <h4 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-300">وزن پایه‌ی تقاضای هر رده (٪) — ورودی فرمول خودکار سهم پوشش</h4>
          <p className="mb-2 text-xs text-slate-400 dark:text-slate-500">
            این عدد دیگر مستقیماً روی هیچ آیتمی نمی‌نشیند — وقتی غذایی هنوز سابقه‌ی مصرف واقعی از رویدادهای قبلی ندارد،
            همین عدد به‌عنوان «وزن تقاضا»ی آن در فرمول خودکار سهم پوشش استفاده می‌شود (در کنار هم‌راستایی با فرمول تقسیم
            سفره) و بین غذاهای هم‌دسته نرمال‌سازی می‌شود — نگاه کنید به توضیح کامل فرمول در صفحه «انتخاب غذا».
          </p>
          <div className="grid grid-cols-3 gap-3">
            {TIERS.map((tier) => (
              <Field key={tier} label={tier}>
                <NumberInput
                  value={Math.round(settings.defaultCoverageByTier[tier] * 100)}
                  min={0}
                  max={100}
                  onChange={(v) => setDefaultCoverageByTier(tier, v / 100)}
                />
              </Field>
            ))}
          </div>
        </div>

        <div>
          <h4 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-300">
            سقف هزینه هر پرس به تفکیک رده — به‌صورت سهمی از بودجه سرانه (مبنای هشدار کارشناس مالی)
          </h4>
          <p className="mb-2 text-xs text-slate-400 dark:text-slate-500">چون این سقف نسبت به بودجه سرانه محاسبه می‌شود، با تغییر بودجه رویداد هم خودش را تنظیم می‌کند.</p>
          <div className="grid grid-cols-3 gap-3">
            {TIERS.map((tier) => (
              <Field key={tier} label={tier} hint={formatRial(plan.perPersonBudget * settings.tierCostCeilingShare[tier])}>
                <NumberInput
                  value={Math.round(settings.tierCostCeilingShare[tier] * 1000) / 10}
                  min={0}
                  max={100}
                  step={0.5}
                  onChange={(v) => setTierCostCeilingShare(tier, v / 100)}
                />
              </Field>
            ))}
          </div>
        </div>

        <div>
          <h4 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-300">
            ضریب اطمینان پایه به تفکیک ریسک هدررفت (مبنای «تعداد پخت» — نگاه کنید به توضیح فرمول در صفحه انتخاب غذا)
          </h4>
          <p className="mb-2 text-xs text-slate-400 dark:text-slate-500">
            غذای فسادپذیر باید ضریب پایین‌تری بگیرد چون پرس اضافه‌اش هدر می‌رود؛ غذای قابل‌نگهداری می‌تواند ضریب بالاتری
            بگیرد چون کمبودش گران‌تر از اضافه‌اش تمام می‌شود. ریسک هدررفت هر غذا در دیتابیس غذا قابل ویرایش است.
          </p>
          <div className="grid grid-cols-2 gap-3">
            {WASTE_RISK_LEVELS.map((risk) => (
              <Field key={risk} label={risk}>
                <NumberInput value={settings.confidenceFactorByWasteRisk[risk]} min={1} step={0.05} onChange={(v) => setConfidenceFactorByWasteRisk(risk, v)} />
              </Field>
            ))}
          </div>
        </div>

        <div>
          <h4 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-300">ظرفیت هر ایستگاه پخت (حداکثر غذای هم‌زمان پیش از هشدار آشپز خبره)</h4>
          <p className="mb-2 text-xs text-slate-400 dark:text-slate-500">ظرفیت واقعی هر روش پخت متفاوت است (مثلاً فر چند سینی را هم‌زمان می‌پزد ولی ایستگاه گریل محدودتر است).</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {COOKING_METHODS.map((method) => (
              <Field key={method} label={method}>
                <NumberInput value={settings.cookingMethodCapacity[method]} min={1} onChange={(v) => setCookingMethodCapacity(method, v)} />
              </Field>
            ))}
          </div>
        </div>

        <div>
          <h4 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-300">استاندارد تغذیه‌ای «فرمول تقسیم سفره» (Harvard Healthy Eating Plate / USDA MyPlate)</h4>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Field label="کل گرم بشقاب هر میهمان">
              <NumberInput value={settings.nutritionTargets.totalGramsPerGuest} min={0} onChange={(v) => setNutritionTarget('totalGramsPerGuest', v)} />
            </Field>
            <Field label="سهم کربوهیدرات (٪)">
              <NumberInput value={Math.round(settings.nutritionTargets.carbShare * 100)} min={0} max={100} onChange={(v) => setNutritionTarget('carbShare', v / 100)} />
            </Field>
            <Field label="سهم پروتئین (٪)">
              <NumberInput value={Math.round(settings.nutritionTargets.proteinShare * 100)} min={0} max={100} onChange={(v) => setNutritionTarget('proteinShare', v / 100)} />
            </Field>
            <Field label="سهم سبزیجات و میوه (٪)">
              <NumberInput value={Math.round(settings.nutritionTargets.vegShare * 100)} min={0} max={100} onChange={(v) => setNutritionTarget('vegShare', v / 100)} />
            </Field>
          </div>
          <p className="mt-2 text-xs text-slate-400 dark:text-slate-500">چربی سهم مستقلی از بشقاب ندارد و صرفاً اطلاعاتی نمایش داده می‌شود (بدون هدف یا رنگ هشدار).</p>
        </div>
      </div>
      <ModalFooter onClose={onClose} />
    </Modal>
  )
}
