import type { LocalizedText } from "../db/schema/_shared";

/**
 * Editable starter catalog seeded for new clinics.
 * PRICES ARE DEMONSTRATION VALUES ONLY (is_demo_price = true). They are not
 * official Algerian tariffs and must be replaced by the clinic during onboarding.
 */

type Unit = "procedure" | "tooth" | "surface" | "arch" | "quadrant" | "session" | "item";
type Anatomy = "none" | "tooth" | "surface" | "arch" | "quadrant";

export type StarterService = {
  code: string;
  name: LocalizedText;
  unit: Unit;
  anatomy: Anatomy;
  durationMin: number;
  /** Major units (DZD). Converted to minor units on insert. */
  demoPrice: number;
};

export type StarterCategory = { code: string; name: LocalizedText; services: StarterService[] };

const s = (
  code: string,
  fr: string,
  en: string,
  ar: string,
  demoPrice: number,
  durationMin = 30,
  unit: Unit = "procedure",
  anatomy: Anatomy = "none",
): StarterService => ({ code, name: { fr, en, ar }, unit, anatomy, durationMin, demoPrice });

export const STARTER_CATALOG: StarterCategory[] = [
  {
    code: "CONS",
    name: { fr: "Consultations et examens", en: "Consultations and examinations", ar: "الاستشارات والفحوصات" },
    services: [
      s("CONS-01", "Consultation", "Consultation", "استشارة", 1500, 20),
      s("CONS-02", "Consultation d'urgence", "Urgent consultation", "استشارة استعجالية", 2000, 20),
      s("CONS-03", "Examen bucco-dentaire", "Oral examination", "فحص الفم والأسنان", 1000, 15),
      s("CONS-04", "Visite de contrôle / suivi", "Follow-up visit", "زيارة متابعة", 1000, 15),
    ],
  },
  {
    code: "RAD",
    name: { fr: "Radiologie", en: "Radiography", ar: "الأشعة" },
    services: [
      s("RAD-01", "Radiographie rétro-alvéolaire", "Periapical radiograph", "صورة شعاعية داخل الفم", 800, 10, "item", "tooth"),
      s("RAD-02", "Radiographie panoramique", "Panoramic radiograph", "صورة بانورامية", 2500, 10, "item"),
    ],
  },
  {
    code: "PREV",
    name: { fr: "Prévention et hygiène", en: "Prevention and hygiene", ar: "الوقاية والنظافة" },
    services: [
      s("PREV-01", "Détartrage", "Scaling", "إزالة الجير", 4000, 30, "session"),
      s("PREV-02", "Polissage", "Polishing", "تلميع الأسنان", 2000, 20, "session"),
      s("PREV-03", "Application de fluor", "Fluoride application", "تطبيق الفلورايد", 1500, 15, "session"),
      s("PREV-04", "Scellement de sillons", "Fissure sealant", "سد الشقوق", 2000, 15, "tooth", "tooth"),
    ],
  },
  {
    code: "REST",
    name: { fr: "Soins conservateurs", en: "Restorative care", ar: "العلاج التحفظي" },
    services: [
      s("REST-01", "Composite 1 face", "Composite, 1 surface", "حشوة كومبوزيت سطح واحد", 4000, 30, "tooth", "surface"),
      s("REST-02", "Composite 2 faces", "Composite, 2 surfaces", "حشوة كومبوزيت سطحان", 5500, 40, "tooth", "surface"),
      s("REST-03", "Composite 3 faces ou plus", "Composite, 3+ surfaces", "حشوة كومبوزيت ثلاثة أسطح أو أكثر", 7000, 45, "tooth", "surface"),
      s("REST-04", "Ciment verre ionomère", "Glass ionomer restoration", "حشوة زجاجية شاردية", 3000, 25, "tooth", "surface"),
      s("REST-05", "Pansement provisoire", "Temporary filling", "حشوة مؤقتة", 1500, 15, "tooth", "tooth"),
    ],
  },
  {
    code: "ENDO",
    name: { fr: "Endodontie", en: "Endodontics", ar: "علاج الجذور" },
    services: [
      s("ENDO-01", "Traitement canalaire monoradiculée", "Root canal, single root", "علاج قناة الجذر - سن أحادي الجذر", 8000, 60, "tooth", "tooth"),
      s("ENDO-02", "Traitement canalaire biradiculée", "Root canal, two roots", "علاج قناة الجذر - سن ثنائي الجذر", 12000, 75, "tooth", "tooth"),
      s("ENDO-03", "Traitement canalaire pluriradiculée", "Root canal, multi-rooted", "علاج قناة الجذر - سن متعدد الجذور", 16000, 90, "tooth", "tooth"),
      s("ENDO-04", "Pulpotomie", "Pulpotomy", "بتر اللب", 4000, 30, "tooth", "tooth"),
      s("ENDO-05", "Retraitement canalaire", "Root canal retreatment", "إعادة علاج قناة الجذر", 18000, 90, "tooth", "tooth"),
    ],
  },
  {
    code: "SURG",
    name: { fr: "Chirurgie et extractions", en: "Surgery and extractions", ar: "الجراحة والقلع" },
    services: [
      s("SURG-01", "Extraction simple", "Simple extraction", "قلع بسيط", 2000, 30, "tooth", "tooth"),
      s("SURG-02", "Extraction chirurgicale", "Surgical extraction", "قلع جراحي", 6000, 45, "tooth", "tooth"),
      s("SURG-03", "Extraction dent de sagesse", "Wisdom tooth extraction", "قلع ضرس العقل", 10000, 60, "tooth", "tooth"),
    ],
  },
  {
    code: "PERIO",
    name: { fr: "Parodontologie", en: "Periodontics", ar: "علاج اللثة" },
    services: [
      s("PERIO-01", "Surfaçage radiculaire (par quadrant)", "Root planing (per quadrant)", "كشط وتسوية الجذور (لكل ربع)", 5000, 45, "quadrant", "quadrant"),
      s("PERIO-02", "Bilan parodontal", "Periodontal assessment", "تقييم اللثة", 2000, 30),
    ],
  },
  {
    code: "PROS",
    name: { fr: "Prothèse", en: "Prosthodontics", ar: "التركيبات" },
    services: [
      s("PROS-01", "Couronne céramo-métallique", "Porcelain-fused-to-metal crown", "تاج خزفي معدني", 25000, 60, "tooth", "tooth"),
      s("PROS-02", "Couronne zircone", "Zirconia crown", "تاج زيركونيا", 45000, 60, "tooth", "tooth"),
      s("PROS-03", "Élément de bridge", "Bridge unit", "عنصر جسر", 25000, 45, "tooth", "tooth"),
      s("PROS-04", "Couronne provisoire", "Temporary crown", "تاج مؤقت", 3000, 30, "tooth", "tooth"),
      s("PROS-05", "Inlay-core / faux moignon", "Post and core", "وتد وقلب", 8000, 45, "tooth", "tooth"),
      s("PROS-06", "Prothèse partielle amovible résine", "Removable partial denture (acrylic)", "طقم جزئي متحرك (راتنج)", 35000, 45, "arch", "arch"),
      s("PROS-07", "Prothèse complète (par arcade)", "Complete denture (per arch)", "طقم كامل (لكل فك)", 50000, 45, "arch", "arch"),
      s("PROS-08", "Réparation de prothèse", "Denture repair", "إصلاح الطقم", 5000, 30, "item"),
    ],
  },
  {
    code: "IMPL",
    name: { fr: "Implantologie", en: "Implantology", ar: "زراعة الأسنان" },
    services: [
      s("IMPL-01", "Pose d'implant", "Implant placement", "زرع سني", 120000, 90, "tooth", "tooth"),
      s("IMPL-02", "Couronne sur implant", "Implant-supported crown", "تاج على زرعة", 60000, 60, "tooth", "tooth"),
    ],
  },
  {
    code: "ORTHO",
    name: { fr: "Orthodontie", en: "Orthodontics", ar: "تقويم الأسنان" },
    services: [
      s("ORTHO-01", "Consultation d'orthodontie", "Orthodontic consultation", "استشارة تقويم", 2000, 30),
      s("ORTHO-02", "Appareil orthodontique fixe (par arcade)", "Fixed appliance (per arch)", "جهاز تقويم ثابت (لكل فك)", 80000, 90, "arch", "arch"),
      s("ORTHO-03", "Séance de contrôle orthodontique", "Orthodontic adjustment visit", "جلسة ضبط التقويم", 3000, 20, "session"),
    ],
  },
  {
    code: "ESTH",
    name: { fr: "Esthétique", en: "Aesthetic dentistry", ar: "تجميل الأسنان" },
    services: [s("ESTH-01", "Blanchiment", "Whitening", "تبييض الأسنان", 30000, 60, "session")],
  },
  {
    code: "PEDO",
    name: { fr: "Pédodontie", en: "Pediatric dentistry", ar: "طب أسنان الأطفال" },
    services: [
      s("PEDO-01", "Couronne pédiatrique préformée", "Pediatric preformed crown", "تاج جاهز للأطفال", 5000, 30, "tooth", "tooth"),
      s("PEDO-02", "Extraction dent temporaire", "Primary tooth extraction", "قلع سن لبني", 1500, 20, "tooth", "tooth"),
    ],
  },
];
