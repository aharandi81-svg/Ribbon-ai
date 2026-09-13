import { useMemo, useState } from 'react'
import { useAppStore } from '../store/useAppStore'
import { generateMenuProposals } from '../lib/menuOptimizer'
import { Button, Card, ConfirmButton, Modal, WarningBadge } from './ui'
import { MENU_STRATEGY_LABELS, PROTEIN_SOURCE_LABELS, PROTEIN_SOURCES, mealTypeIncludesBreakfast, mealTypeIncludesLunchOrDinner } from '../types'
import type { MenuProposal } from '../types'
import { formatNumber, formatRial } from '../lib/format'

const COMPARE_ROWS: { key: keyof MenuProposal | 'costPerGuest'; label: string; format: (p: MenuProposal) => string }[] = [
  { key: 'menuOptimizationScore', label: 'امتیاز کلی بهینه‌سازی منو', format: (p) => `${Math.round(p.menuOptimizationScore)} / ۱۰۰` },
  { key: 'proteinFitScore', label: 'تناسب پروتئین با هدف', format: (p) => `${Math.round(p.proteinFitScore)} / ۱۰۰` },
  { key: 'macroFitScore', label: 'هم‌راستایی ماکرو', format: (p) => `${Math.round(p.macroFitScore)} / ۱۰۰` },
  { key: 'proteinDiversityScore', label: 'تنوع منابع پروتئین', format: (p) => `${Math.round(p.proteinDiversityScore)} / ۱۰۰` },
  { key: 'menuVarietyScore', label: 'تنوع کلی منو', format: (p) => `${Math.round(p.menuVarietyScore)} / ۱۰۰` },
  { key: 'kitchenFeasibilityScore', label: 'امکان‌سنجی آشپزخانه', format: (p) => `${Math.round(p.kitchenFeasibilityScore)} / ۱۰۰` },
  { key: 'costScore', label: 'امتیاز هزینه', format: (p) => `${Math.round(p.costScore)} / ۱۰۰` },
  { key: 'avgDishScore', label: 'میانگین Dish Score', format: (p) => `${Math.round(p.avgDishScore)} / ۱۰۰` },
  { key: 'costPerGuest', label: 'هزینه هر مهمان', format: (p) => formatRial(p.costPerGuest) },
  { key: 'totalCost', label: 'هزینه کل', format: (p) => formatRial(p.totalCost) },
  { key: 'totalProteinGrams', label: 'مجموع پروتئین (گرم)', format: (p) => formatNumber(Math.round(p.totalProteinGrams)) },
]

export function MenuOptimizerPanel() {
  const plan = useAppStore((s) => s.plan)
  const settings = useAppStore((s) => s.settings)
  const dishes = useAppStore((s) => s.dishes)
  const applyMenuProposal = useAppStore((s) => s.applyMenuProposal)

  const [result, setResult] = useState<{ proposals: MenuProposal[]; warnings: string[] } | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [compareIds, setCompareIds] = useState<Set<string>>(new Set())
  const [applied, setApplied] = useState<string | null>(null)

  const proteinTarget = plan.guestCount * settings.menuOptimizer.proteinTargetGramsPerGuest

  const compareProposals = useMemo(
    () => (result?.proposals ?? []).filter((p) => compareIds.has(p.id)),
    [result, compareIds],
  )
  const expandedProposal = useMemo(
    () => (result?.proposals ?? []).find((p) => p.id === expandedId) ?? null,
    [result, expandedId],
  )

  function handleGenerate() {
    const r = generateMenuProposals(dishes, plan, settings)
    setResult(r)
    setExpandedId(null)
    setCompareIds(new Set())
    setApplied(null)
  }

  function toggleCompare(id: string) {
    setCompareIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <Card
      title={
        <div className="flex items-center gap-2">
          <span aria-hidden>🧠</span>
          <span>بهینه‌ساز هوشمند منو (AI Menu Optimizer)</span>
        </div>
      }
      className="bg-gradient-to-br from-amber-50/40 to-white dark:from-amber-900/10 dark:to-slate-900"
    >
      <p className="mb-4 text-sm text-slate-600 dark:text-slate-400">
        بر اساس تعداد میهمانان ({formatNumber(plan.guestCount)} نفر)، بودجه سرانه ({formatRial(plan.perPersonBudget)})، پروفایل هدف
        فعال («{settings.menuOptimizer.targetMenuProfiles[settings.menuOptimizer.activeTargetProfileId].label}») و هدف پروتئین کل
        رویداد ({formatNumber(Math.round(proteinTarget))} گرم = {formatNumber(plan.guestCount)} × {settings.menuOptimizer.proteinTargetGramsPerGuest} گرم)،
        چند ترکیب منوی متفاوت و قابل‌اجرا از دیتابیس واقعی غذا پیشنهاد می‌شود. برای تغییر این پارامترها به «تنظیمات
        رویداد» بروید؛ برای الزامی/ممنوع‌کردن یک غذای خاص، از دیتابیس غذا استفاده کنید.
      </p>

      <Button variant="primary" onClick={handleGenerate}>
        تولید منوهای بهینه
      </Button>

      {result && result.warnings.length > 0 && (
        <div className="mt-3 flex flex-col gap-1">
          {result.warnings.map((w, i) => (
            <WarningBadge key={i}>{w}</WarningBadge>
          ))}
        </div>
      )}

      {result && result.proposals.length === 0 && (
        <p className="mt-4 text-sm text-red-600 dark:text-red-400">
          با تنظیمات و محدودیت‌های فعلی هیچ ترکیب معتبری پیدا نشد — محدودیت‌های سخت (سقف پروتئین، سهم منابع پروتئین،
          بودجه، حداقل/حداکثر هر دسته) را در «تنظیمات رویداد» بازبینی کنید یا محدودیت‌های Must Include/Exclude را در
          دیتابیس غذا کم کنید. اگر تازه سهم گوشت/مرغ/ماهی را سخت‌گیرانه تنظیم کرده‌اید، تحمل مجاز انحراف از آن را کمی
          افزایش دهید یا مطمئن شوید دیتابیس غذا گزینه‌ی کافی از هر منبع پروتئین با قیمت مشخص دارد.
          {mealTypeIncludesBreakfast(plan.mealType) && mealTypeIncludesLunchOrDinner(plan.mealType) && (
            <>
              {' '}اگر نوع وعده («{plan.mealType}») چند وعده را با هم پوشش می‌دهد، مطمئن شوید برای هر وعده حداقل یک
              گزینه با قیمت مشخص در دیتابیس غذا موجود است و حداقل تعداد قلم هر دسته (در تنظیمات) حداقل ۲ است.
            </>
          )}
        </p>
      )}

      {result && result.proposals.length > 0 && (
        <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
          {result.proposals.map((p, idx) => {
            return (
              <div key={p.id} className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_4px_12px_rgba(15,23,42,0.05)] dark:border-slate-700/80 dark:bg-slate-800/60 dark:shadow-none">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-xs font-medium text-amber-700 dark:text-amber-400">پیشنهاد {idx + 1} — {MENU_STRATEGY_LABELS[p.strategyId]}</p>
                    <p className="mt-1 text-2xl font-bold text-slate-900 dark:text-slate-100">{Math.round(p.menuOptimizationScore)}<span className="text-sm font-normal text-slate-400 dark:text-slate-500"> / ۱۰۰</span></p>
                  </div>
                  <label className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
                    <input type="checkbox" checked={compareIds.has(p.id)} onChange={() => toggleCompare(p.id)} />
                    مقایسه
                  </label>
                </div>

                <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-slate-600 dark:text-slate-400">
                  <div className="flex justify-between"><dt>هزینه هر مهمان</dt><dd className="font-medium text-slate-800 dark:text-slate-200">{formatRial(p.costPerGuest)}</dd></div>
                  <div className="flex justify-between"><dt>مجموع پروتئین</dt><dd className="font-medium text-slate-800 dark:text-slate-200">{formatNumber(Math.round(p.totalProteinGrams))} گرم</dd></div>
                  <div className="flex justify-between"><dt>تناسب پروتئین</dt><dd>{Math.round(p.proteinFitScore)}٪</dd></div>
                  <div className="flex justify-between"><dt>تنوع منو</dt><dd>{Math.round(p.menuVarietyScore)}٪</dd></div>
                </dl>

                {p.warnings.length > 0 && (
                  <div className="mt-2 flex flex-col gap-1">
                    {p.warnings.map((w, i) => (
                      <WarningBadge key={i}>{w}</WarningBadge>
                    ))}
                  </div>
                )}

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setExpandedId(p.id)}
                    className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
                  >
                    مشاهده جزئیات کامل
                  </button>
                  <ConfirmButton
                    label="اعمال این منو"
                    confirmMessage="ردیف‌های انتخاب‌شده‌ی فعلی صفحه «انتخاب غذا» با این پیشنهاد جایگزین می‌شود."
                    confirmLabel="بله، اعمال کن"
                    onConfirm={() => {
                      applyMenuProposal(p)
                      setApplied(p.id)
                    }}
                    className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 dark:bg-slate-700 dark:hover:bg-slate-600"
                  />
                  {applied === p.id && <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">اعمال شد ✓</span>}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {expandedProposal && (
        <Modal
          title={`جزئیات کامل پیشنهاد — ${MENU_STRATEGY_LABELS[expandedProposal.strategyId]}`}
          onClose={() => setExpandedId(null)}
          widthClassName="max-w-6xl"
        >
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm text-slate-600 dark:text-slate-400 sm:grid-cols-4">
            <div className="flex flex-col"><dt className="text-xs text-slate-400 dark:text-slate-500">امتیاز کلی</dt><dd className="font-semibold text-slate-800 dark:text-slate-200">{Math.round(expandedProposal.menuOptimizationScore)} / ۱۰۰</dd></div>
            <div className="flex flex-col"><dt className="text-xs text-slate-400 dark:text-slate-500">هزینه هر مهمان</dt><dd className="font-semibold text-slate-800 dark:text-slate-200">{formatRial(expandedProposal.costPerGuest)}</dd></div>
            <div className="flex flex-col"><dt className="text-xs text-slate-400 dark:text-slate-500">هزینه کل</dt><dd className="font-semibold text-slate-800 dark:text-slate-200">{formatRial(expandedProposal.totalCost)}</dd></div>
            <div className="flex flex-col"><dt className="text-xs text-slate-400 dark:text-slate-500">مجموع پروتئین</dt><dd className="font-semibold text-slate-800 dark:text-slate-200">{formatNumber(Math.round(expandedProposal.totalProteinGrams))} گرم</dd></div>
          </div>

          {expandedProposal.warnings.length > 0 && (
            <div className="mt-3 flex flex-col gap-1">
              {expandedProposal.warnings.map((w, i) => (
                <WarningBadge key={i}>{w}</WarningBadge>
              ))}
            </div>
          )}

          <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-start text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-400">
                  <th className="px-3 py-2 text-start">غذا</th>
                  <th className="px-3 py-2 text-start">دسته</th>
                  <th className="px-3 py-2 text-start">منبع پروتئین</th>
                  <th className="px-3 py-2 text-start">پروتئین هر پرس (گرم)</th>
                  <th className="px-3 py-2 text-start">تعداد پخت</th>
                  <th className="px-3 py-2 text-start">هزینه هر پرس</th>
                  <th className="px-3 py-2 text-start">هزینه کل قلم</th>
                  <th className="px-3 py-2 text-start">Dish Score</th>
                </tr>
              </thead>
              <tbody>
                {expandedProposal.dishes.map((d) => (
                  <tr key={d.dishId} className="border-b border-slate-100 last:border-0 dark:border-slate-800">
                    <td className="px-3 py-2 font-medium text-slate-700 dark:text-slate-300">
                      {d.dishName}
                      {d.needsNutritionReview && (
                        <span className="ms-1 text-amber-600 dark:text-amber-400" title="فاقد کارت رسپی — مقدار تغذیه‌ای برآوردی">⚠️</span>
                      )}
                    </td>
                    <td className="px-3 py-2">{d.category}</td>
                    <td className="px-3 py-2">{PROTEIN_SOURCE_LABELS[d.proteinSource]}</td>
                    <td className="px-3 py-2">{Math.round(d.proteinGrams)}</td>
                    <td className="px-3 py-2">
                      {formatNumber(d.servingCount)}
                      {d.servingCount !== d.coverageCount && (
                        <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">
                          سهم پوشش قطعی: {formatNumber(d.coverageCount)} نفر
                        </p>
                      )}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">{formatRial(d.costPerServing)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{formatRial(d.totalCost)}</td>
                    <td className="px-3 py-2">{Math.round(d.dishScore)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
            {PROTEIN_SOURCES.map((src) => (
              <span key={src}>
                {PROTEIN_SOURCE_LABELS[src]}: {Math.round(expandedProposal.proteinSourceBreakdownPercent[src])}٪
              </span>
            ))}
          </div>

          <div className="mt-5 flex justify-end gap-2 border-t border-slate-100 pt-4 dark:border-slate-800">
            <ConfirmButton
              label="اعمال این منو"
              confirmMessage="ردیف‌های انتخاب‌شده‌ی فعلی صفحه «انتخاب غذا» با این پیشنهاد جایگزین می‌شود."
              confirmLabel="بله، اعمال کن"
              onConfirm={() => {
                applyMenuProposal(expandedProposal)
                setApplied(expandedProposal.id)
              }}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 dark:bg-slate-700 dark:hover:bg-slate-600"
            />
            <Button onClick={() => setExpandedId(null)}>بستن</Button>
          </div>
        </Modal>
      )}

      {compareProposals.length >= 2 && (
        <div className="mt-6 overflow-x-auto">
          <h4 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-300">مقایسه پیشنهادهای انتخاب‌شده</h4>
          <table className="w-full min-w-[500px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-start text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
                <th className="px-2 py-2 text-start">معیار</th>
                {compareProposals.map((p) => (
                  <th key={p.id} className="px-2 py-2 text-start">{MENU_STRATEGY_LABELS[p.strategyId]}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {COMPARE_ROWS.map((row) => (
                <tr key={row.key} className="border-b border-slate-100 dark:border-slate-800">
                  <td className="px-2 py-2 text-slate-500 dark:text-slate-400">{row.label}</td>
                  {compareProposals.map((p) => (
                    <td key={p.id} className="px-2 py-2 font-medium text-slate-800 dark:text-slate-200">{row.format(p)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}
