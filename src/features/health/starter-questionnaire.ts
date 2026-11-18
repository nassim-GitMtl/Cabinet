import type { LocalizedText } from "@/server/db/schema/_shared";
import type { Question } from "@/server/db/schema/health";

/**
 * Starter medical-history questionnaire. Generic wording for a dental clinic;
 * it is NOT a validated clinical instrument. A clinician approves it (or a
 * replacement version) before use — the app shows "to be approved" until then.
 */
export const STARTER_TITLE: LocalizedText = { fr: "Questionnaire médical", en: "Medical history questionnaire", ar: "استبيان السوابق الطبية" };

const which: LocalizedText = { fr: "Précisez", en: "Please specify", ar: "يرجى التوضيح" };

export const STARTER_QUESTIONS: Question[] = [
  { id: "allergies", alertLabel: { fr: "Allergie", en: "Allergy", ar: "حساسية" }, kind: "yes_no", alertKind: "allergy", detailPrompt: { fr: "Lesquelles (médicaments, latex, anesthésiques, aliments) ?", en: "Which ones (medicines, latex, anaesthetics, food)?", ar: "ما هي (أدوية، لاتكس، مخدر، أطعمة)؟" }, label: { fr: "Avez-vous des allergies ?", en: "Do you have any allergies?", ar: "هل لديك حساسية؟" } },
  { id: "medications", alertLabel: { fr: "Traitement en cours", en: "Current medication", ar: "علاج جارٍ" }, kind: "yes_no", alertKind: "medication", detailPrompt: { fr: "Lesquels et à quelle dose ?", en: "Which ones and what dose?", ar: "ما هي وبأي جرعة؟" }, label: { fr: "Prenez-vous des médicaments actuellement ?", en: "Are you currently taking any medicines?", ar: "هل تتناول أدوية حاليًا؟" } },
  { id: "anticoagulants", alertLabel: { fr: "Anticoagulant / antiagrégant", en: "Blood thinner", ar: "مميّع للدم" }, kind: "yes_no", alertKind: "medication", detailPrompt: which, label: { fr: "Prenez-vous un anticoagulant ou un antiagrégant (ex. aspirine) ?", en: "Do you take a blood thinner (e.g. aspirin)?", ar: "هل تتناول مميّعًا للدم (مثل الأسبرين)؟" } },
  { id: "heart", alertLabel: { fr: "Cardiopathie / valve / stimulateur", en: "Heart disease / valve / pacemaker", ar: "مرض قلبي / صمام / منظم" }, kind: "yes_no", alertKind: "medical", detailPrompt: which, label: { fr: "Avez-vous une maladie cardiaque, une prothèse valvulaire ou un stimulateur cardiaque ?", en: "Do you have heart disease, a heart valve or a pacemaker?", ar: "هل لديك مرض قلبي أو صمام صناعي أو منظم ضربات القلب؟" } },
  { id: "blood_pressure", alertLabel: { fr: "Hypertension artérielle", en: "High blood pressure", ar: "ارتفاع ضغط الدم" }, kind: "yes_no", alertKind: "medical", label: { fr: "Avez-vous une hypertension artérielle ?", en: "Do you have high blood pressure?", ar: "هل لديك ارتفاع ضغط الدم؟" } },
  { id: "diabetes", alertLabel: { fr: "Diabète", en: "Diabetes", ar: "السكري" }, kind: "yes_no", alertKind: "medical", detailPrompt: which, label: { fr: "Êtes-vous diabétique ?", en: "Do you have diabetes?", ar: "هل أنت مصاب بالسكري؟" } },
  { id: "bleeding", alertLabel: { fr: "Saignement prolongé", en: "Prolonged bleeding", ar: "نزيف مطوّل" }, kind: "yes_no", alertKind: "medical", label: { fr: "Saignez-vous longtemps après une coupure ou une extraction dentaire ?", en: "Do you bleed for a long time after a cut or a tooth extraction?", ar: "هل يستمر النزيف طويلًا بعد جرح أو قلع سن؟" } },
  { id: "infectious", alertLabel: { fr: "Maladie infectieuse", en: "Infectious disease", ar: "مرض معدٍ" }, kind: "yes_no", alertKind: "medical", sensitive: true, detailPrompt: which, label: { fr: "Avez-vous une maladie infectieuse connue (hépatite, VIH, tuberculose…) ?", en: "Do you have a known infectious disease (hepatitis, HIV, tuberculosis…)?", ar: "هل لديك مرض معدٍ معروف (التهاب الكبد، فيروس نقص المناعة، السل…)؟" } },
  { id: "pregnancy", alertLabel: { fr: "Grossesse / allaitement", en: "Pregnancy / breastfeeding", ar: "حمل / رضاعة" }, kind: "yes_no", alertKind: "medical", label: { fr: "Êtes-vous enceinte ou allaitez-vous ?", en: "Are you pregnant or breastfeeding?", ar: "هل أنتِ حامل أو مرضعة؟" } },
  { id: "bisphosphonates", alertLabel: { fr: "Bisphosphonates / traitement anticancéreux", en: "Bisphosphonates / cancer treatment", ar: "بيسفوسفونات / علاج السرطان" }, kind: "yes_no", alertKind: "medication", detailPrompt: which, label: { fr: "Avez-vous reçu un traitement contre l'ostéoporose (bisphosphonates) ou un traitement anticancéreux ?", en: "Have you had treatment for osteoporosis (bisphosphonates) or cancer?", ar: "هل تلقيت علاجًا لهشاشة العظام (البيسفوسفونات) أو للسرطان؟" } },
  { id: "smoking", kind: "yes_no", label: { fr: "Fumez-vous ?", en: "Do you smoke?", ar: "هل تدخن؟" } },
  { id: "other", alertLabel: { fr: "Antécédents", en: "Medical history", ar: "سوابق" }, kind: "text", label: { fr: "Autres maladies, opérations ou hospitalisations", en: "Other illnesses, operations or hospital stays", ar: "أمراض أو عمليات أو إقامات أخرى في المستشفى" } },
];
