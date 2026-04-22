import Anthropic from "@anthropic-ai/sdk";
import { buildClassifierPrompt } from "./prompt";
import { buildGpPressReleasePrompt } from "./prompts/gp-press-release";
import {
  classifierResponseSchema,
  recordSignalsToolSchema,
  type ClassifierResponse,
} from "./schema";

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
  docBlock: Anthropic.Messages.ContentBlockParam,
): Promise<ExtractResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("missing ANTHROPIC_API_KEY");

  const client = new Anthropic({ apiKey });

  const message = await client.messages.create({
    model: CLASSIFIER_MODEL,
    max_tokens: 4096,
    tools: [recordSignalsToolSchema],
    tool_choice: { type: "tool", name: "record_signals" },
    messages: [
      {
        role: "user",
        content: [docBlock, { type: "text", text: promptText }],
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
