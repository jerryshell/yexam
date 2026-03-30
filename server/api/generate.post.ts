import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText } from "ai";
import type { H3Event } from "h3";
import {
  InMemoryCache,
  YoutubeTranscriptDisabledError,
  YoutubeTranscriptInvalidVideoIdError,
  YoutubeTranscriptInvalidLangError,
  YoutubeTranscriptNotAvailableError,
  YoutubeTranscriptNotAvailableLanguageError,
  YoutubeTranscriptTooManyRequestError,
  YoutubeTranscriptVideoUnavailableError,
  fetchTranscript,
  toPlainText,
  type TranscriptResult,
} from "youtube-transcript-plus";
import { z } from "zod";

const requestSchema = z.object({
  url: z.string().trim().min(1),
  language: z.enum(["zh", "en"]).default("zh"),
});

const questionSchema = z.object({
  question: z.string().trim().min(1),
  options: z.array(z.string().trim().min(1)).length(4),
  correctIndex: z.number().int().min(0).max(3),
});

const questionsSchema = z.object({
  questions: z.array(questionSchema).length(5),
});

const responseSchema = z.object({
  video: z.object({
    title: z.string().trim().min(1),
    author: z.string().trim().min(1),
    transcriptLanguage: z.string().trim().min(1),
  }),
  questions: questionsSchema.shape.questions,
});

const transcriptCache = new InMemoryCache(1000 * 60 * 10);

export default defineEventHandler(async (event) => {
  const { url, language } = await readRequestBody(event);
  const { apiKey, modelName } = readModelConfig();
  const transcriptResult = await fetchEnglishTranscript(url);
  const prompt = createQuestionPrompt({
    language,
    title: transcriptResult.videoDetails.title,
    author: transcriptResult.videoDetails.author,
    transcript: toPlainText(transcriptResult.segments, " "),
  });
  const openrouter = createOpenRouter({ apiKey });
  const { text } = await generateText({
    model: openrouter.chat(modelName),
    providerOptions: { openrouter: { response_format: { type: "json_object" } } },
    prompt,
  });

  if (!text) {
    throw createError({ statusCode: 500, statusMessage: "Empty response from AI." });
  }

  try {
    const { questions } = questionsSchema.parse(JSON.parse(text));

    return responseSchema.parse({
      video: {
        title: transcriptResult.videoDetails.title || "YouTube Video",
        author: transcriptResult.videoDetails.author || "YouTube",
        transcriptLanguage: transcriptResult.segments[0]?.lang || "en",
      },
      questions,
    });
  } catch (error) {
    console.error("JSON parse error:", error);
    throw createError({ statusCode: 500, statusMessage: "Failed to parse AI response." });
  }
});

async function readRequestBody(event: H3Event) {
  const body = await readBody(event);
  const result = requestSchema.safeParse(body);

  if (!result.success) {
    throw createError({
      statusCode: 400,
      statusMessage: result.error.issues[0]?.message ?? "Invalid request body.",
    });
  }

  return result.data;
}

function readModelConfig() {
  const apiKey = import.meta.env.OPENROUTER_API_KEY;
  const modelName = import.meta.env.OPENROUTER_MODEL;

  if (!apiKey || !modelName) {
    throw createError({
      statusCode: 500,
      statusMessage: "Missing OPENROUTER_API_KEY or OPENROUTER_MODEL.",
    });
  }

  return { apiKey, modelName };
}

async function fetchEnglishTranscript(url: string): Promise<TranscriptResult> {
  try {
    return await fetchTranscript(url, {
      lang: "en",
      cache: transcriptCache,
      retries: 2,
      retryDelay: 1000,
      videoDetails: true,
    });
  } catch (error) {
    throw toHttpError(error);
  }
}

function createQuestionPrompt(input: {
  language: "zh" | "en";
  title: string;
  author: string;
  transcript: string;
}) {
  const languageInstruction =
    input.language === "zh"
      ? "请用简体中文生成问题和选项。"
      : "Generate the questions and options in English.";

  return `${languageInstruction}

Based on the following YouTube video transcript, generate exactly 5 single-choice questions to test understanding.

Video title: ${input.title}
Channel: ${input.author}
Transcript language: English

Requirements:
- Each question has exactly 4 options
- Only one correct answer per question
- correctIndex is 0-based (0, 1, 2, or 3)
- Questions should cover key concepts from the transcript
- Avoid duplicate questions
- Return valid JSON only

Transcript:
${input.transcript}

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
}`;
}

function toHttpError(error: unknown) {
  if (error instanceof YoutubeTranscriptInvalidVideoIdError) {
    return createError({ statusCode: 400, statusMessage: "Invalid YouTube video ID or URL." });
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
    const availableLanguages = formatAvailableLanguages(error.availableLangs);
    return createError({
      statusCode: 404,
      statusMessage: availableLanguages
        ? `English transcripts are not available for this video. Available languages: ${availableLanguages}.`
        : "English transcripts are not available for this video.",
      data: { videoId: error.videoId, lang: error.lang, availableLangs: error.availableLangs },
    });
  }

  if (error instanceof YoutubeTranscriptInvalidLangError) {
    return createError({
      statusCode: 400,
      statusMessage: `Invalid transcript language: ${error.lang}.`,
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

function formatAvailableLanguages(languages: string[]) {
  return languages.filter(Boolean).join(", ");
}
