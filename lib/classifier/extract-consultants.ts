import Anthropic from "@anthropic-ai/sdk";
import { CLASSIFIER_MODEL } from "./extract";
import {
  buildConsultantsPrompt,
  type MasterListEntry,
} from "./prompts/consultants";
import {
  consultantsResponseSchema,
  recordConsultantsToolSchema,
  type ConsultantsResponse,
} from "./schemas/consultants";

/**
 * v1.5-consultants extraction entry points.
 *
 * Block 2 of Workstream 2 ships the text-only path. The keyword filter
 * in extract-consultant-pages.ts narrows the CAFR to ~5-10 pages of
 * the fee schedule; this function sends that excerpt to Sonnet and
 * validates the structured response.
 *
 * Files API and full-PDF base64 paths are deferred. If the unpdf-text
 * pipeline ever fails on a Category A plan, add extractConsultantsFromPdf
 * + extractConsultantsFromPdfFile entries mirroring the cafr-allocation
 * pattern in extract.ts.
 */

export type ConsultantsExtractResult = {
  response: ConsultantsResponse;
  tokensUsed: number;
  inputTokens: number;
  outputTokens: number;
  stopReason: string | null;
};

export type ExtractConsultantsFromTextArgs = {
  excerptText: string;
  planName: string;
  fiscalYearEnd: string | null;
  masterList: MasterListEntry[];
  retainedPages: number[];
  totalPages: number;
};

export async function extractConsultantsFromText(
  args: ExtractConsultantsFromTextArgs,
): Promise<ConsultantsExtractResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("missing ANTHROPIC_API_KEY");

  const promptText = buildConsultantsPrompt({
    planName: args.planName,
    fiscalYearEnd: args.fiscalYearEnd,
    masterList: args.masterList,
  });

  const header =
    `This excerpt was extracted from a multi-hundred-page CAFR/ACFR by ` +
    `keyword-filtering for consultant fee schedules. Retained pages: ` +
    `${args.retainedPages.join(", ")} (of ${args.totalPages} total). ` +
    `Use the per-page "=== Page N ===" markers as the source_page value ` +
    `when emitting consultants.`;

  const client = new Anthropic({ apiKey });
  const message = await client.messages.create({
    model: CLASSIFIER_MODEL,
    max_tokens: 4096,
    tools: [recordConsultantsToolSchema],
    tool_choice: { type: "tool", name: "record_consultants" },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `<cafr_consultant_excerpt>\n${header}\n\n${args.excerptText}\n</cafr_consultant_excerpt>`,
          },
          { type: "text", text: promptText },
        ],
      },
    ],
  });

  const toolUse = message.content.find(
    (b): b is Extract<typeof b, { type: "tool_use" }> => b.type === "tool_use",
  );
  if (!toolUse || toolUse.name !== "record_consultants") {
    throw new Error(
      `consultant classifier did not call record_consultants tool (stop_reason=${message.stop_reason})`,
    );
  }

  const parsed = consultantsResponseSchema.safeParse(toolUse.input);
  if (!parsed.success) {
    throw new Error(
      `consultant classifier output failed schema validation: ${parsed.error.message}`,
    );
  }

  return {
    response: parsed.data,
    inputTokens: message.usage.input_tokens,
    outputTokens: message.usage.output_tokens,
    tokensUsed: message.usage.input_tokens + message.usage.output_tokens,
    stopReason: message.stop_reason,
  };
}
