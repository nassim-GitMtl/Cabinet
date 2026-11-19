import { z } from "zod";
import type { Question } from "@/server/db/schema";
import type { LocalizedText } from "@/server/db/schema/_shared";

const text = z.string().trim().min(1, "required").max(500, "tooLong");
const optional = z.string().trim().max(500, "tooLong").optional().transform((value) => value || undefined);

const questionSchema = z.object({
  id: z.string().trim().regex(/^[a-z][a-z0-9_]{1,49}$/, "health.editor.errors.questionId"),
  kind: z.enum(["yes_no", "text"]),
  labelFr: text,
  labelEn: optional,
  labelAr: optional,
  detailFr: optional,
  detailEn: optional,
  detailAr: optional,
  sensitive: z.boolean().default(false),
  alertLabelFr: optional,
  alertLabelEn: optional,
  alertLabelAr: optional,
  alertKind: z.enum(["medical", "allergy", "medication"]).nullable().optional(),
});

export const questionnaireDraftSchema = z.object({
  titleFr: text,
  titleEn: optional,
  titleAr: optional,
  questions: z.array(questionSchema).min(1, "health.editor.errors.questionsRequired").max(40, "health.editor.errors.tooManyQuestions"),
}).superRefine((value, ctx) => {
  const seen = new Set<string>();
  value.questions.forEach((question, index) => {
    if (seen.has(question.id)) ctx.addIssue({ code: "custom", path: ["questions", index, "id"], message: "health.editor.errors.duplicateId" });
    seen.add(question.id);
    if (question.kind === "text" && question.detailFr) ctx.addIssue({ code: "custom", path: ["questions", index, "detailFr"], message: "health.editor.errors.textDetail" });
  });
});

export type QuestionnaireDraftInput = z.infer<typeof questionnaireDraftSchema>;

const localized = (fr: string, en?: string, ar?: string): LocalizedText => ({ fr, ...(en ? { en } : {}), ...(ar ? { ar } : {}) });

export function questionnaireDraftToRecord(input: QuestionnaireDraftInput): { title: LocalizedText; questions: Question[] } {
  return {
    title: localized(input.titleFr, input.titleEn, input.titleAr),
    questions: input.questions.map((question) => ({
      id: question.id,
      kind: question.kind,
      label: localized(question.labelFr, question.labelEn, question.labelAr),
      ...(question.kind === "yes_no" && question.detailFr ? { detailPrompt: localized(question.detailFr, question.detailEn, question.detailAr) } : {}),
      ...(question.sensitive ? { sensitive: true } : {}),
      ...(question.alertLabelFr ? { alertLabel: localized(question.alertLabelFr, question.alertLabelEn, question.alertLabelAr) } : {}),
      ...(question.alertKind ? { alertKind: question.alertKind } : {}),
    })),
  };
}
