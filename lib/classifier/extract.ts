import Anthropic from "@anthropic-ai/sdk";
import { buildClassifierPrompt } from "./prompt";
import { buildGpPressReleasePrompt } from "./prompts/gp-press-release";
import { buildPressReleasePrompt } from "./prompts/press-release";
import { buildCafrAllocationPrompt } from "./prompts/cafr-allocation";
import { buildIpsPrompt } from "./prompts/ips";
import {
  ipsResponseSchema,
  recordIpsAllocationsToolSchema,
  type IpsResponse,
} from "./schemas/ips";
import {
  classifierResponseSchema,
  recordSignalsToolSchema,
  type ClassifierResponse,
} from "./schema";
import {
  cafrAllocationResponseSchema,
  recordAllocationsToolSchema,
  type CafrAllocationResponse,
} from "./schemas/cafr-allocation";
import { FILES_API_BETA } from "./files-api";

export const CLASSIFIER_MODEL = "claude-sonnet-4-6";

export type ExtractResult = {
  response: ClassifierResponse;
  tokensUsed: number;
  inputTokens: number;
  outputTokens: number;
  stopReason: string | null;
};

// Shared inner helper: given already-built prompt text and a message-content
// block (either a PDF document block or a plain-text block for press
// releases), call the classifier tool and validate. Factored out so the two
// public extract* functions differ only in how the document content is
// shaped.
async function callClassifier(
  promptText: string,
  // Intentionally loose: the Files-API content block shape (source.type
  // = "file") is only part of the beta messages types, not the stable
  // Messages types. Cast happens at the call site.
  docBlock: unknown,
  opts: { useFilesApi?: boolean } = {},
): Promise<ExtractResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("missing ANTHROPIC_API_KEY");

  const client = new Anthropic({ apiKey });

  // When the document content block references a file_id (Files API
  // beta), route through client.beta.messages.create with the beta
  // header. Otherwise use the stable messages endpoint. Both return
  // the same response shape.
  const message = opts.useFilesApi
    ? await client.beta.messages.create({
        model: CLASSIFIER_MODEL,
        max_tokens: 4096,
        tools: [recordSignalsToolSchema],
        tool_choice: { type: "tool", name: "record_signals" },
        messages: [
          {
            role: "user",
            content: [
              docBlock as Anthropic.Beta.Messages.BetaContentBlockParam,
              { type: "text", text: promptText },
            ],
          },
        ],
        betas: [FILES_API_BETA],
      })
    : await client.messages.create({
        model: CLASSIFIER_MODEL,
        max_tokens: 4096,
        tools: [recordSignalsToolSchema],
        tool_choice: { type: "tool", name: "record_signals" },
        messages: [
          {
            role: "user",
            content: [
              docBlock as Anthropic.Messages.ContentBlockParam,
              { type: "text", text: promptText },
            ],
          },
        ],
      });

  const toolUse = message.content.find(
    (b): b is Extract<typeof b, { type: "tool_use" }> => b.type === "tool_use",
  );
  if (!toolUse || toolUse.name !== "record_signals") {
    throw new Error(
      `classifier did not call record_signals tool (stop_reason=${message.stop_reason})`,
    );
  }

  const parsed = classifierResponseSchema.safeParse(toolUse.input);
  if (!parsed.success) {
    throw new Error(
      `classifier output failed schema validation: ${parsed.error.message}`,
    );
  }

  const inputTokens = message.usage.input_tokens;
  const outputTokens = message.usage.output_tokens;

  return {
    response: parsed.data,
    inputTokens,
    outputTokens,
    tokensUsed: inputTokens + outputTokens,
    stopReason: message.stop_reason,
  };
}

export type CafrExtractResult = {
  response: CafrAllocationResponse;
  tokensUsed: number;
  inputTokens: number;
  outputTokens: number;
  stopReason: string | null;
};

// Parallel to callClassifier, but talks to the CAFR-specific tool schema and
// validates against the CAFR response shape. Allows more output tokens because
// a CAFR can legitimately produce 10+ allocation rows plus an AUM figure.
async function callCafrClassifier(
  promptText: string,
  docBlock: unknown,
  opts: { useFilesApi?: boolean } = {},
): Promise<CafrExtractResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("missing ANTHROPIC_API_KEY");

  const client = new Anthropic({ apiKey });

  const message = opts.useFilesApi
    ? await client.beta.messages.create({
        model: CLASSIFIER_MODEL,
        max_tokens: 8192,
        tools: [recordAllocationsToolSchema],
        tool_choice: { type: "tool", name: "record_allocations" },
        messages: [
          {
            role: "user",
            content: [
              docBlock as Anthropic.Beta.Messages.BetaContentBlockParam,
              { type: "text", text: promptText },
            ],
          },
        ],
        betas: [FILES_API_BETA],
      })
    : await client.messages.create({
        model: CLASSIFIER_MODEL,
        max_tokens: 8192,
        tools: [recordAllocationsToolSchema],
        tool_choice: { type: "tool", name: "record_allocations" },
        messages: [
          {
            role: "user",
            content: [
              docBlock as Anthropic.Messages.ContentBlockParam,
              { type: "text", text: promptText },
            ],
          },
        ],
      });

  const toolUse = message.content.find(
    (b): b is Extract<typeof b, { type: "tool_use" }> => b.type === "tool_use",
  );
  if (!toolUse || toolUse.name !== "record_allocations") {
    throw new Error(
      `cafr classifier did not call record_allocations tool (stop_reason=${message.stop_reason})`,
    );
  }

  const parsed = cafrAllocationResponseSchema.safeParse(toolUse.input);
  if (!parsed.success) {
    throw new Error(
      `cafr classifier output failed schema validation: ${parsed.error.message}`,
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

export type ExtractCafrArgs = {
  pdfBase64: string;
  planName: string;
  fiscalYearEnd: string | null;
};

export async function extractAllocationsFromCafrPdf(
  args: ExtractCafrArgs,
): Promise<CafrExtractResult> {
  const prompt = buildCafrAllocationPrompt({
    planName: args.planName,
    fiscalYearEnd: args.fiscalYearEnd,
  });
  return callCafrClassifier(prompt, {
    type: "document",
    source: {
      type: "base64",
      media_type: "application/pdf",
      data: args.pdfBase64,
    },
  });
}

export type ExtractCafrFileArgs = {
  fileId: string;
  planName: string;
  fiscalYearEnd: string | null;
};

/**
 * CAFR classifier entry that references a Files API `file_id` instead
 * of inlining the PDF as base64. Used for oversized ACFRs (Colorado
 * PERA FY2024 at 84 MB, NYSTRS FY2025 at 47.8 MB). Same prompt,
 * same tool, same response shape as `extractAllocationsFromCafrPdf`.
 */
export async function extractAllocationsFromCafrPdfFile(
  args: ExtractCafrFileArgs,
): Promise<CafrExtractResult> {
  const prompt = buildCafrAllocationPrompt({
    planName: args.planName,
    fiscalYearEnd: args.fiscalYearEnd,
  });
  return callCafrClassifier(
    prompt,
    {
      type: "document",
      source: {
        type: "file",
        file_id: args.fileId,
      },
    },
    { useFilesApi: true },
  );
}

export type ExtractCafrTextArgs = {
  excerptText: string;
  planName: string;
  fiscalYearEnd: string | null;
  totalPages: number;
};

/**
 * CAFR classifier entry for PDFs pdf-lib rejects as malformed (Minnesota
 * SBI annual reports, several PSERS / MPSERS ACFRs observed in this
 * batch). After unpdf extracts page-level text we send the full text to
 * Anthropic wrapped in <cafr_text_excerpt> — the CAFR prompt works fine
 * on text because the policy table is still discoverable even without
 * the base64 PDF's layout. The wrapper header tells the model this is
 * untrusted content and that "=== Page N ===" markers are the
 * source_page values to emit.
 */
export async function extractAllocationsFromCafrText(
  args: ExtractCafrTextArgs,
): Promise<CafrExtractResult> {
  const prompt = buildCafrAllocationPrompt({
    planName: args.planName,
    fiscalYearEnd: args.fiscalYearEnd,
  });
  const header =
    `This text was extracted from a CAFR / Annual Report PDF that the ` +
    `primary PDF parser could not open structurally. Page layout may be ` +
    `imperfect but the asset-allocation policy table is still present. ` +
    `Total pages in source: ${args.totalPages}. Use the "=== Page N ===" ` +
    `markers as the source_page value when emitting allocations.`;
  return callCafrClassifier(prompt, {
    type: "text",
    text: `<cafr_text_excerpt>\n${header}\n\n${args.excerptText}\n</cafr_text_excerpt>`,
  });
}

export type ExtractFromPdfArgs = {
  pdfBase64: string;
  planName: string;
  meetingDate: string | null;
};

export async function extractSignalsFromPdf(
  args: ExtractFromPdfArgs,
): Promise<ExtractResult> {
  const prompt = buildClassifierPrompt({
    planName: args.planName,
    meetingDate: args.meetingDate,
  });
  return callClassifier(prompt, {
    type: "document",
    source: {
      type: "base64",
      media_type: "application/pdf",
      data: args.pdfBase64,
    },
  });
}

export type ExtractFromPdfFileArgs = {
  fileId: string;
  planName: string;
  meetingDate: string | null;
};

/**
 * Pension-signal classifier entry that references a Files API
 * `file_id` instead of inlining the PDF as base64. Used for PDFs too
 * large to fit inside the 32 MB inline request ceiling. Same prompt,
 * same tool, same response shape as `extractSignalsFromPdf`.
 */
export async function extractSignalsFromPdfFile(
  args: ExtractFromPdfFileArgs,
): Promise<ExtractResult> {
  const prompt = buildClassifierPrompt({
    planName: args.planName,
    meetingDate: args.meetingDate,
  });
  return callClassifier(
    prompt,
    {
      type: "document",
      source: {
        type: "file",
        file_id: args.fileId,
      },
    },
    { useFilesApi: true },
  );
}

export type ExtractFromTextArgs = {
  text: string;
  gpName: string;
  publishedAt: string | null;
};

export async function extractSignalsFromText(
  args: ExtractFromTextArgs,
): Promise<ExtractResult> {
  const prompt = buildGpPressReleasePrompt({
    gpName: args.gpName,
    publishedAt: args.publishedAt,
  });
  // Press releases are plain text — send as a text block, not a document
  // block. We label the body clearly so the model can tell system prompt
  // from untrusted document content (supports the injection-defense rule in
  // the prompt).
  return callClassifier(prompt, {
    type: "text",
    text: `<press_release>\n${args.text}\n</press_release>`,
  });
}

export type ExtractFromPlanPressReleaseTextArgs = {
  text: string;
  planName: string;
  publishedAt: string | null;
};

/**
 * Plan-side press-release classifier entry. Sister to
 * `extractSignalsFromText` (GP-side). Same response schema, same record
 * tool — the difference lives in the prompt, which is tuned for plan
 * releases announcing commitments / target changes / pacing changes
 * rather than GP fund closes.
 */
export async function extractSignalsFromPlanPressReleaseText(
  args: ExtractFromPlanPressReleaseTextArgs,
): Promise<ExtractResult> {
  const prompt = buildPressReleasePrompt({
    planName: args.planName,
    publishedAt: args.publishedAt,
  });
  return callClassifier(prompt, {
    type: "text",
    text: `<press_release>\n${args.text}\n</press_release>`,
  });
}

export type IpsExtractResult = {
  response: IpsResponse;
  tokensUsed: number;
  inputTokens: number;
  outputTokens: number;
  stopReason: string | null;
};

export type ExtractFromIpsTextArgs = {
  text: string;
  planName: string;
  effectiveDateHint: string | null;
};

/**
 * IPS allocation classifier entry. Takes the unpdf-extracted IPS body
 * text from documents.content_text (populated at scrape time) and runs
 * it through the IPS prompt + record_ips_allocations tool.
 *
 * Sister to extractAllocationsFromCafrText, but the IPS path is simpler:
 * the scraper already ran unpdf at ingest time, so there is no PDF
 * download/parse round-trip here.
 */
export async function extractIpsAllocationsFromText(
  args: ExtractFromIpsTextArgs,
): Promise<IpsExtractResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("missing ANTHROPIC_API_KEY");

  const client = new Anthropic({ apiKey });

  const prompt = buildIpsPrompt({
    planName: args.planName,
    effectiveDateHint: args.effectiveDateHint,
  });

  const message = await client.messages.create({
    model: CLASSIFIER_MODEL,
    max_tokens: 4096,
    tools: [recordIpsAllocationsToolSchema],
    tool_choice: { type: "tool", name: "record_ips_allocations" },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `<ips>\n${args.text}\n</ips>`,
          },
          { type: "text", text: prompt },
        ],
      },
    ],
  });

  const toolUse = message.content.find(
    (b): b is Extract<typeof b, { type: "tool_use" }> => b.type === "tool_use",
  );
  if (!toolUse || toolUse.name !== "record_ips_allocations") {
    throw new Error(
      `ips classifier did not call record_ips_allocations tool (stop_reason=${message.stop_reason})`,
    );
  }

  const parsed = ipsResponseSchema.safeParse(toolUse.input);
  if (!parsed.success) {
    throw new Error(
      `ips classifier output failed schema validation: ${parsed.error.message}`,
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

export type ExtractFromAgendaExcerptArgs = {
  excerptText: string;
  planName: string;
  meetingDate: string | null;
  retainedPages: number[];
  totalPages: number;
};

/**
 * Classifier entry for agenda-packet documents that have been page-filtered
 * by `extract-commitment-pages`. Uses the standard pension prompt but feeds
 * a text block (rather than a base64 PDF) so long packets don't have to
 * fit inside the 300-page cap. The wrapping tag + header make it obvious
 * to the model which content is untrusted and provide a provenance hint
 * that not every page from the source doc is shown.
 */
export async function extractSignalsFromAgendaExcerpt(
  args: ExtractFromAgendaExcerptArgs,
): Promise<ExtractResult> {
  const prompt = buildClassifierPrompt({
    planName: args.planName,
    meetingDate: args.meetingDate,
  });
  const header =
    `This excerpt was extracted from a multi-hundred-page Board of Investments ` +
    `agenda packet. Only pages that matched commitment-vote keywords (motion, ` +
    `seconded, unanimously approved, commitment of $, etc.) and their immediate ` +
    `neighbors are included. Retained pages: ${args.retainedPages.join(", ")} ` +
    `(of ${args.totalPages} total). Use the per-page "=== Page N ===" markers as ` +
    `the source_page value when emitting signals.`;
  return callClassifier(prompt, {
    type: "text",
    text: `<agenda_packet_excerpt>\n${header}\n\n${args.excerptText}\n</agenda_packet_excerpt>`,
  });
}
