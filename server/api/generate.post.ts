import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText } from "ai";
import { InMemoryCache, fetchTranscript } from "youtube-transcript-plus";
import { z } from "zod";

const questionSchema = z.object({
  question: z.string(),
  options: z.array(z.string()),
  correctIndex: z.number().min(0).max(3),
});

const questionsSchema = z.object({
  questions: z.array(questionSchema),
});

const cache = new InMemoryCache(1000 * 60 * 10);

function extractVideoId(input: string) {
  const match = input.match(
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)?([a-zA-Z0-9_-]{11})/,
  );
  return match?.[1] ?? input;
}

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig();
  const openrouter = createOpenRouter({ apiKey: config.openrouterApiKey });

  const { url, language = "zh" } = await readBody(event);

  if (!url) {
    throw createError({ statusCode: 400, message: "URL is required" });
  }

  const videoId = extractVideoId(url);
  const transcript = (await fetchTranscript(videoId, { lang: "en", cache }))
    .map((item) => item.text)
    .join(" ");

  const languagePrompt =
    language === "zh"
      ? "请用简体中文生成问题和选项。"
      : "Generate the questions and options in English.";

  const { text } = await generateText({
    model: openrouter.chat(config.openrouterModel),
    providerOptions: { openrouter: { response_format: { type: "json_object" } } },
    prompt: `Based on the following YouTube video transcript, generate 5 single-choice questions to test understanding. Each question should have 4 options with only one correct answer.

${languagePrompt}

Transcript:
${transcript}

Return a JSON object in this exact format:
{
  "questions": [
    {
      "question": "The question text",
      "options": ["Option A", "Option B", "Option C", "Option D"],
      "correctIndex": 0
    }
  ]
}`,
  });

  if (!text) {
    throw createError({ statusCode: 500, message: "Empty response from AI" });
  }

  try {
    return questionsSchema.parse(JSON.parse(text));
  } catch (error) {
    console.error("JSON parse error:", error);
    throw createError({ statusCode: 500, message: "Failed to parse AI response" });
  }
});
