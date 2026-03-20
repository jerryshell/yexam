import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText } from "ai";
import {
  InMemoryCache,
  YoutubeTranscriptDisabledError,
  YoutubeTranscriptInvalidVideoIdError,
  YoutubeTranscriptNotAvailableError,
  YoutubeTranscriptNotAvailableLanguageError,
  YoutubeTranscriptTooManyRequestError,
  YoutubeTranscriptVideoUnavailableError,
  fetchTranscript,
} from "youtube-transcript-plus";
import { z } from "zod";

const questionSchema = z.object({
  question: z.string(),
  options: z.array(z.string()),
  correctIndex: z.number().min(0).max(3),
});

const questionsSchema = z.object({
  questions: z.array(questionSchema),
});

const transcriptCache = new InMemoryCache(1000 * 60 * 10);

function extractVideoId(input: string) {
  const match = input.match(
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)?([a-zA-Z0-9_-]{11})/,
  );
  return match?.[1] ?? input;
}

function toHttpError(error: unknown) {
  if (error instanceof YoutubeTranscriptInvalidVideoIdError) {
    return createError({ statusCode: 400, statusMessage: "Invalid YouTube VideoId or URL." });
  }

  if (error instanceof YoutubeTranscriptVideoUnavailableError) {
    return createError({
      statusCode: 404,
      statusMessage: "Video unavailable, may have been deleted or access restricted.",
      data: { videoId: error.videoId },
    });
  }

  if (error instanceof YoutubeTranscriptDisabledError) {
    return createError({
      statusCode: 403,
      statusMessage: "Transcripts are disabled for this video.",
      data: { videoId: error.videoId },
    });
  }

  if (error instanceof YoutubeTranscriptNotAvailableError) {
    return createError({
      statusCode: 404,
      statusMessage: "No transcripts available for this video.",
      data: { videoId: error.videoId },
    });
  }

  if (error instanceof YoutubeTranscriptNotAvailableLanguageError) {
    return createError({
      statusCode: 404,
      statusMessage: "Requested transcript language is not available.",
      data: { videoId: error.videoId, lang: error.lang, availableLangs: error.availableLangs },
    });
  }

  if (error instanceof YoutubeTranscriptTooManyRequestError) {
    return createError({
      statusCode: 429,
      statusMessage: "Too many requests, YouTube has temporarily blocked the current IP.",
    });
  }

  return createError({
    statusCode: 500,
    statusMessage: error instanceof Error ? error.message : "Failed to fetch transcript.",
  });
}

export default defineEventHandler(async (event) => {
  const openrouter = createOpenRouter({ apiKey: import.meta.env.OPENROUTER_API_KEY });

  const { url, language = "zh" } = await readBody(event);

  if (!url) {
    throw createError({ statusCode: 400, message: "URL is required" });
  }

  const videoId = extractVideoId(url);

  if (!videoId) {
    throw createError({ statusCode: 400, statusMessage: "Invalid YouTube VideoId or URL." });
  }

  let transcript: string;
  try {
    transcript = (await fetchTranscript(videoId, { lang: "en", cache: transcriptCache }))
      .map((item) => item.text)
      .join(" ");
  } catch (error) {
    throw toHttpError(error);
  }

  const promptByLanguage =
    language === "zh"
      ? "请用简体中文生成问题和选项。"
      : "Generate the questions and options in English.";

  const { text } = await generateText({
    model: openrouter.chat(import.meta.env.OPENROUTER_MODEL!),
    providerOptions: { openrouter: { response_format: { type: "json_object" } } },
    prompt: `${promptByLanguage}

Based on the following YouTube video transcript, generate exactly 5 single-choice questions to test understanding.

Requirements:
- Each question has exactly 4 options
- Only one correct answer per question
- correctIndex is 0-based (0, 1, 2, or 3)
- Questions should cover key concepts from the transcript
- Return valid JSON only

Transcript:
${transcript}

Return a JSON object with this exact structure:
{
  "questions": [
    {
      "question": "Question 1 text",
      "options": ["Option A", "Option B", "Option C", "Option D"],
      "correctIndex": 0
    },
    {
      "question": "Question 2 text",
      "options": ["Option A", "Option B", "Option C", "Option D"],
      "correctIndex": 2
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
