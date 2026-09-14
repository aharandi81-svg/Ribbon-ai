import { CATEGORIES, COOKING_METHODS, DIETARY_TAGS, PROTEIN_SOURCES, WASTE_RISK_LEVELS } from '../types'
import type { Category, CookingMethod, DietaryTag, Dish, ProteinSourceType, WasteRisk } from '../types'

const CATEGORY_BY_LABEL = new Map<string, Category>(CATEGORIES.map((c) => [c, c]))
const DIETARY_TAG_SET = new Set<string>(DIETARY_TAGS)
const WASTE_RISK_SET = new Set<string>(WASTE_RISK_LEVELS)
const PROTEIN_SOURCE_SET = new Set<string>(PROTEIN_SOURCES)
const COOKING_METHOD_SET = new Set<string>(COOKING_METHODS)

const YES = 'بله'
const NO = 'خیر'

const HEADERS = {
  id: 'شناسه',
  name: 'نام غذا',
  category: 'دسته',
  carb: 'کربوهیدرات ٪',
  protein: 'پروتئین ٪',
  veg: 'سبزیجات و میوه ٪',
  fat: 'چربی ٪',
  costPerServing: 'هزینه هر پرس (ریال)',
  costSource: 'منبع هزینه',
  needsPrice: 'نیاز به قیمت',
  priceVarianceFlag: 'پراکندگی قیمت بالا',
  referencePortionGrams: 'وزن هر پرس (گرم)',
  portionSource: 'منبع وزن پرس',
  needsPortionEstimate: 'وزن پرس برآوردی است',
  dietaryTags: 'برچسب رژیمی (خودکار)',
  dietaryTagsVerified: 'برچسب رژیمی تأیید دستی شده',
  wasteRisk: 'ریسک هدررفت',
  wasteRiskVerified: 'ریسک هدررفت تأیید دستی شده',
  observedCoveragePercent: 'سهم پوشش مشاهده‌شده (میانگین رویدادهای قبلی)',
  observedEventsRecorded: 'تعداد رویدادهای ثبت‌شده',
  eventsUsedIn: 'رویدادهای مرجع',
  proteinGramsPerPortion: 'پروتئین خالص هر پرس (گرم)',
  carbGramsPerPortion: 'کربوهیدرات خالص هر پرس (گرم)',
  fatGramsPerPortion: 'چربی خالص هر پرس (گرم)',
  needsNutritionReview: 'نیاز به بازبینی تغذیه‌ای',
  proteinSource: 'منبع پروتئین غالب',
  proteinSourceVerified: 'منبع پروتئین تأیید دستی شده',
  defaultCookingMethod: 'روش پخت پیش‌فرض',
  defaultCookingMethodVerified: 'روش پخت پیش‌فرض تأیید دستی شده',
} as const

function dishRows(dishes: Dish[]) {
  return dishes.map((d) => ({
    [HEADERS.id]: d.id,
    [HEADERS.name]: d.name,
    [HEADERS.category]: d.category,
    [HEADERS.carb]: d.macro.carb,
    [HEADERS.protein]: d.macro.protein,
    [HEADERS.veg]: d.macro.veg,
    [HEADERS.fat]: d.macro.fat,
    [HEADERS.costPerServing]: d.costPerServing ?? '',
    [HEADERS.costSource]: d.costSource,
    [HEADERS.needsPrice]: d.needsPrice ? YES : NO,
    [HEADERS.priceVarianceFlag]: d.priceVarianceFlag ? YES : NO,
    [HEADERS.referencePortionGrams]: d.referencePortionGrams,
    [HEADERS.portionSource]: d.portionSource,
    [HEADERS.needsPortionEstimate]: d.needsPortionEstimate ? YES : NO,
    [HEADERS.dietaryTags]: d.dietaryTags.join('، '),
    [HEADERS.dietaryTagsVerified]: d.dietaryTagsVerified ? YES : NO,
    [HEADERS.wasteRisk]: d.wasteRisk,
    [HEADERS.wasteRiskVerified]: d.wasteRiskVerified ? YES : NO,
    [HEADERS.observedCoveragePercent]: d.observedCoveragePercent != null ? Math.round(d.observedCoveragePercent * 1000) / 10 : '',
    [HEADERS.observedEventsRecorded]: d.observedEventsRecorded,
    [HEADERS.eventsUsedIn]: d.eventsUsedIn.join('، '),
    [HEADERS.proteinGramsPerPortion]: d.nutrition.proteinGrams,
    [HEADERS.carbGramsPerPortion]: d.nutrition.carbGrams,
    [HEADERS.fatGramsPerPortion]: d.nutrition.fatGrams,
    [HEADERS.needsNutritionReview]: d.needsNutritionReview ? YES : NO,
    [HEADERS.proteinSource]: d.proteinSource,
    [HEADERS.proteinSourceVerified]: d.proteinSourceVerified ? YES : NO,
    [HEADERS.defaultCookingMethod]: d.defaultCookingMethod ?? '',
    [HEADERS.defaultCookingMethodVerified]: d.defaultCookingMethodVerified ? YES : NO,
  }))
}

// این تایپ رسمی نیست (رانتایم Artifact آن را در window.claude تزریق می‌کند، نه پکیج ما)،
// فقط برای type-safety محلی همین فایل تعریف شده.
interface ClaudeDownloadsNamespace {
  save: (req: { filename: string; data: string }) => Promise<{ status: 'saved' }>
}
interface ClaudeGlobal {
  use: (name: string) => Promise<ClaudeDownloadsNamespace | null>
}

function getClaudeHost(): ClaudeGlobal | null {
  const w = window as unknown as { claude?: ClaudeGlobal }
  // نسخه‌ی قدیمی‌تر «chat artifact» یک window.claude تخت دارد که use ندارد؛ آن حالت را
  // نادیده می‌گیریم و مستقیم به دانلود استاندارد مرورگر برمی‌گردیم.
  return typeof w.claude?.use === 'function' ? w.claude : null
}

export interface ExportResult {
  status: 'saved' | 'declined' | 'fallback-download' | 'error'
  message?: string
}

/**
 * خروجی دیتابیس غذا. داخل پیش‌نمایش Artifact، فایل مستقیماً توسط کد صفحه قابل دانلود
 * نیست (سندباکس آن را مسدود می‌کند) و پسوند xlsx هم در فهرست مجاز قابلیت downloads نیست؛
 * در آن محیط از قابلیت downloads با فرمت CSV استفاده می‌شود. در اپ واقعی (خارج از
 * Artifact) با XLSX.writeFile یک دانلود مستقیم .xlsx ایجاد می‌شود.
 */
export async function exportDishesToXlsx(dishes: Dish[], baseFilename = 'دیتابیس-غذاها'): Promise<ExportResult> {
  const XLSX = await import('xlsx')
  const rows = dishRows(dishes)
  const claude = getClaudeHost()

  if (claude) {
    try {
      const downloads = await claude.use('downloads')
      if (downloads) {
        const sheet = XLSX.utils.json_to_sheet(rows)
        const csv = XLSX.utils.sheet_to_csv(sheet)
        // یک BOM در ابتدای فایل برای اینکه اکسل کاراکترهای فارسی UTF-8 را درست بخواند.
        await downloads.save({ filename: `${baseFilename}.csv`, data: '﻿' + csv })
        return { status: 'saved' }
      }
    } catch (err) {
      const code = (err as { code?: string } | null)?.code
      if (code === 'declined') return { status: 'declined' }
      return { status: 'error', message: (err as { message?: string } | null)?.message ?? 'ذخیره فایل ناموفق بود.' }
    }
  }

  const sheet = XLSX.utils.json_to_sheet(rows)
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, sheet, 'غذاها')
  XLSX.writeFile(workbook, `${baseFilename}.xlsx`)
  return { status: 'fallback-download' }
}

export interface ImportResult {
  updated: Dish[]
  added: Dish[]
  warnings: string[]
}

function toNumberOrNull(v: unknown): number | null {
  if (v === '' || v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function slugify(name: string): string {
  const base = name
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
  return base || 'dish'
}

export async function importDishesFromFile(file: File, existing: Dish[]): Promise<ImportResult> {
  const XLSX = await import('xlsx')
  const buffer = await file.arrayBuffer()
  const workbook = XLSX.read(buffer, { type: 'array' })
  const firstSheetName = workbook.SheetNames[0]
  const sheet = workbook.Sheets[firstSheetName]
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })

  const byId = new Map(existing.map((d) => [d.id, d]))
  const byName = new Map(existing.map((d) => [d.name.trim(), d]))

  const updated: Dish[] = []
  const added: Dish[] = []
  const warnings: string[] = []
  const usedIds = new Set(existing.map((d) => d.id))

  rows.forEach((row, i) => {
    const rowNum = i + 2 // +1 for header row, +1 for 1-indexing
    const name = String(row[HEADERS.name] ?? '').trim()
    if (!name) {
      warnings.push(`ردیف ${rowNum}: نام غذا خالی است — نادیده گرفته شد.`)
      return
    }

    const rawCategory = String(row[HEADERS.category] ?? '').trim()
    let category = CATEGORY_BY_LABEL.get(rawCategory)
    if (!category) {
      category = 'غذای اصلی'
      warnings.push(`ردیف ${rowNum} («${name}»): دسته «${rawCategory}» نامعتبر است — به «غذای اصلی» تنظیم شد.`)
    }

    const macroRaw = {
      carb: Number(row[HEADERS.carb]) || 0,
      protein: Number(row[HEADERS.protein]) || 0,
      veg: Number(row[HEADERS.veg]) || 0,
      fat: Number(row[HEADERS.fat]) || 0,
    }
    const macroSum = macroRaw.carb + macroRaw.protein + macroRaw.veg + macroRaw.fat
    const macro =
      macroSum > 0
        ? {
            carb: Math.round((macroRaw.carb / macroSum) * 1000) / 10,
            protein: Math.round((macroRaw.protein / macroSum) * 1000) / 10,
            veg: Math.round((macroRaw.veg / macroSum) * 1000) / 10,
            fat: Math.round((macroRaw.fat / macroSum) * 1000) / 10,
          }
        : { carb: 25, protein: 25, veg: 25, fat: 25 }
    if (macroSum > 0 && Math.abs(macroSum - 100) > 1) {
      warnings.push(`ردیف ${rowNum} («${name}»): جمع ماکرو ${macroSum.toFixed(1)}٪ بود — به ۱۰۰٪ نرمال‌سازی شد.`)
    }
    if (macroSum === 0) {
      warnings.push(`ردیف ${rowNum} («${name}»): هیچ مقدار ماکرویی داده نشده — مقدار پیش‌فرض مساوی (۲۵٪ هرکدام) گذاشته شد.`)
    }

    const costPerServing = toNumberOrNull(row[HEADERS.costPerServing])
    const referencePortionGrams = toNumberOrNull(row[HEADERS.referencePortionGrams])
    if (referencePortionGrams == null) {
      warnings.push(`ردیف ${rowNum} («${name}»): وزن هر پرس مشخص نشده — مقدار قبلی/پیش‌فرض حفظ شد.`)
    }

    const idFromFile = String(row[HEADERS.id] ?? '').trim()
    const target = (idFromFile && byId.get(idFromFile)) || byName.get(name)

    const dietaryTagsRaw = String(row[HEADERS.dietaryTags] ?? '').trim()
    const dietaryTags: DietaryTag[] = dietaryTagsRaw
      ? (dietaryTagsRaw
          .split(/[،,]/)
          .map((t) => t.trim())
          .filter((t) => DIETARY_TAG_SET.has(t)) as DietaryTag[])
      : (target?.dietaryTags ?? [])

    const rawWasteRisk = String(row[HEADERS.wasteRisk] ?? '').trim()
    const wasteRisk: WasteRisk = WASTE_RISK_SET.has(rawWasteRisk)
      ? (rawWasteRisk as WasteRisk)
      : (target?.wasteRisk ?? 'فسادپذیر')

    const observedCoveragePercentRaw = toNumberOrNull(row[HEADERS.observedCoveragePercent])
    const observedCoveragePercent =
      observedCoveragePercentRaw != null ? observedCoveragePercentRaw / 100 : (target?.observedCoveragePercent ?? null)
    const observedEventsRecordedRaw = toNumberOrNull(row[HEADERS.observedEventsRecorded])
    const observedEventsRecorded = observedEventsRecordedRaw ?? target?.observedEventsRecorded ?? 0

    const rawProteinSource = String(row[HEADERS.proteinSource] ?? '').trim()
    const proteinSource: ProteinSourceType = PROTEIN_SOURCE_SET.has(rawProteinSource)
      ? (rawProteinSource as ProteinSourceType)
      : (target?.proteinSource ?? 'plant-other')

    const rawDefaultCookingMethod = String(row[HEADERS.defaultCookingMethod] ?? '').trim()
    const defaultCookingMethod: CookingMethod | null = COOKING_METHOD_SET.has(rawDefaultCookingMethod)
      ? (rawDefaultCookingMethod as CookingMethod)
      : (target?.defaultCookingMethod ?? null)

    const proteinGramsRaw = toNumberOrNull(row[HEADERS.proteinGramsPerPortion])
    const carbGramsRaw = toNumberOrNull(row[HEADERS.carbGramsPerPortion])
    const fatGramsRaw = toNumberOrNull(row[HEADERS.fatGramsPerPortion])
    const nutrition = {
      proteinGrams: proteinGramsRaw ?? target?.nutrition.proteinGrams ?? 0,
      carbGrams: carbGramsRaw ?? target?.nutrition.carbGrams ?? 0,
      fatGrams: fatGramsRaw ?? target?.nutrition.fatGrams ?? 0,
      fiberGrams: target?.nutrition.fiberGrams ?? null,
      calories: target?.nutrition.calories ?? null,
    }
    if (proteinGramsRaw == null && carbGramsRaw == null && fatGramsRaw == null && !target) {
      warnings.push(`ردیف ${rowNum} («${name}»): مقدار درشت‌مغذی (گرم) داده نشده — این غذا در Menu Optimization Engine «نیاز به بازبینی تغذیه‌ای» علامت می‌خورد.`)
    }

    const patch: Omit<Dish, 'id' | 'eventsUsedIn' | 'ingredients' | 'ingredientsCostTotal'> = {
      name,
      category,
      macro,
      costPerServing,
      costSource: String(row[HEADERS.costSource] ?? (target?.costSource ?? 'ایمپورت اکسل')),
      needsPrice: costPerServing == null,
      priceVarianceFlag: String(row[HEADERS.priceVarianceFlag] ?? '').trim() === YES,
      referencePortionGrams: referencePortionGrams ?? target?.referencePortionGrams ?? 250,
      portionSource: target?.portionSource ?? 'ایمپورت اکسل',
      needsPortionEstimate:
        String(row[HEADERS.needsPortionEstimate] ?? '').trim() === YES || (target ? target.needsPortionEstimate : true),
      dietaryTags,
      isBreakfastItem: target?.isBreakfastItem ?? false,
      dietaryTagsVerified: row[HEADERS.dietaryTagsVerified] != null
        ? String(row[HEADERS.dietaryTagsVerified]).trim() === YES
        : (target?.dietaryTagsVerified ?? false),
      wasteRisk,
      wasteRiskVerified: row[HEADERS.wasteRiskVerified] != null
        ? String(row[HEADERS.wasteRiskVerified]).trim() === YES
        : (target?.wasteRiskVerified ?? false),
      observedCoveragePercent,
      observedEventsRecorded,
      nutrition,
      needsNutritionReview:
        row[HEADERS.needsNutritionReview] != null
          ? String(row[HEADERS.needsNutritionReview]).trim() === YES
          : (target?.needsNutritionReview ?? (proteinGramsRaw == null && carbGramsRaw == null && fatGramsRaw == null)),
      proteinSource,
      proteinSourceVerified: row[HEADERS.proteinSourceVerified] != null
        ? String(row[HEADERS.proteinSourceVerified]).trim() === YES
        : (target?.proteinSourceVerified ?? false),
      defaultCookingMethod,
      defaultCookingMethodVerified: row[HEADERS.defaultCookingMethodVerified] != null
        ? String(row[HEADERS.defaultCookingMethodVerified]).trim() === YES
        : (target?.defaultCookingMethodVerified ?? false),
      dataReviewed: target?.dataReviewed ?? false,
    }

    if (target) {
      updated.push({ ...target, ...patch })
    } else {
      let id = idFromFile || slugify(name)
      while (usedIds.has(id)) id = `${id}-2`
      usedIds.add(id)
      added.push({
        id,
        eventsUsedIn: [],
        ingredients: null,
        ingredientsCostTotal: null,
        ...patch,
      })
    }
  })

  return { updated, added, warnings }
}
