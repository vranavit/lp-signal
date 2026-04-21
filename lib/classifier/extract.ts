import Anthropic from "@anthropic-ai/sdk";
import { buildClassifierPrompt } from "./prompt";
import {
  classifierResponseSchema,
  recordSignalsToolSchema,
  type ClassifierResponse,
} from "./schema";

export const CLASSIFIER_MODEL = "claude-sonnet-4-20250514";

export type ExtractArgs = {
  pdfBase64: string;
  planName: string;
  meetingDate: string | null;
};

export type ExtractResult = {
  response: ClassifierResponse;
  tokensUsed: number;
  inputTokens: number;
  outputTokens: number;
  stopReason: string | null;
};

export async function extractSignals(args: ExtractArgs): Promise<ExtractResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("missing ANTHROPIC_API_KEY");

  const client = new Anthropic({ apiKey });
  const prompt = buildClassifierPrompt({
    planName: args.planName,
    meetingDate: args.meetingDate,
  });

  const message = await client.messages.create({
    model: CLASSIFIER_MODEL,
    max_tokens: 4096,
    tools: [recordSignalsToolSchema],
    tool_choice: { type: "tool", name: "record_signals" },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "document",
            source: {
              type: "base64",
              media_type: "application/pdf",
              data: args.pdfBase64,
            },
          },
          { type: "text", text: prompt },
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
