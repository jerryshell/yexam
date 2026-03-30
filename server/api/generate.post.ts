import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText, NoObjectGeneratedError, Output } from "ai";
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

const generatedQuestionSchema = z.object({
  question: z.string().trim().min(1),
  options: z.array(z.string().trim().min(1)).min(4),
  correctIndex: z.number().int().min(0),
});

const generatedQuestionsSchema = z.object({
  questions: z.array(generatedQuestionSchema).min(5),
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
type GeneratedQuestion = z.infer<typeof generatedQuestionSchema>;

export default defineEventHandler(async (event) => {
  const { url, language } = await readRequestBody(event);
  const { apiKey, modelName } = readModelConfig(event);
  const transcriptResult = await fetchEnglishTranscript(url);
  const prompt = createQuestionPrompt({
    language,
    title: transcriptResult.videoDetails.title,
    author: transcriptResult.videoDetails.author,
    transcript: toPlainText(transcriptResult.segments, " "),
  });
  const questions = await generateExamQuestions({ apiKey, modelName, prompt, language });

  return responseSchema.parse({
    video: {
      title: transcriptResult.videoDetails.title || "YouTube Video",
      author: transcriptResult.videoDetails.author || "YouTube",
      transcriptLanguage: transcriptResult.segments[0]?.lang || "en",
    },
    questions,
  });
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

async function generateExamQuestions(input: {
  apiKey: string;
  modelName: string;
  prompt: string;
  language: "zh" | "en";
}) {
  const openrouter = createOpenRouter({ apiKey: input.apiKey });
  const model = openrouter.chat(input.modelName, {
    plugins: [{ id: "response-healing" }],
  });
  const prompts = [
    input.prompt,
    `${input.prompt}

Additional constraints:
- Return exactly 5 questions
- Every question must have exactly 4 unique options
- Do not number the questions
- Do not prefix options with A/B/C/D
- Do not return explanations or extra keys`,
  ];
  let lastError: unknown;

  for (const prompt of prompts) {
    try {
      const { output } = await generateText({
        model,
        output: Output.object({
          name: "youtube_exam_questions",
          description: "Five single-choice quiz questions generated from a YouTube transcript.",
          schema: generatedQuestionsSchema,
        }),
        temperature: 0.2,
        maxRetries: 1,
        prompt,
      });

      return normalizeGeneratedQuestions(output.questions);
    } catch (error) {
      lastError = error;
      console.error("AI question generation failed:", error);
    }
  }

  throw toAiGenerationError(input.language, lastError);
}

function normalizeGeneratedQuestions(questions: GeneratedQuestion[]) {
  const normalizedQuestions = questions.map((question, index) => {
    return normalizeGeneratedQuestion(question, index);
  });
  const uniqueQuestions = normalizedQuestions.filter((question, index, items) => {
    const currentQuestion = question.question.toLowerCase();
    return items.findIndex((item) => item.question.toLowerCase() === currentQuestion) === index;
  });

  if (uniqueQuestions.length < 5) {
    throw new Error("The AI generated fewer than 5 unique questions.");
  }

  return questionsSchema.parse({ questions: uniqueQuestions.slice(0, 5) }).questions;
}

function normalizeGeneratedQuestion(question: GeneratedQuestion, questionIndex: number) {
  const normalizedQuestion = normalizeQuestionText(question.question);
  const rawOptions = question.options.map(normalizeOptionText).filter(Boolean);
  const correctAnswer = rawOptions[question.correctIndex];

  if (!correctAnswer) {
    throw new Error(`Question ${questionIndex + 1} is missing a valid correct answer.`);
  }

  const options = pickNormalizedOptions(rawOptions, correctAnswer, questionIndex);
  const correctIndex = options.indexOf(correctAnswer);

  if (correctIndex === -1) {
    throw new Error(`Question ${questionIndex + 1} lost its correct answer during cleanup.`);
  }

  return {
    question: normalizedQuestion,
    options,
    correctIndex,
  };
}

function pickNormalizedOptions(rawOptions: string[], correctAnswer: string, questionIndex: number) {
  const uniqueOptions = [...new Set(rawOptions)];

  if (uniqueOptions.length < 4) {
    throw new Error(`Question ${questionIndex + 1} has fewer than 4 valid options.`);
  }

  if (uniqueOptions.length === 4) {
    return uniqueOptions;
  }

  const firstFourOptions = uniqueOptions.slice(0, 4);

  if (firstFourOptions.includes(correctAnswer)) {
    return firstFourOptions;
  }

  return [...firstFourOptions.slice(0, 3), correctAnswer];
}

function normalizeQuestionText(value: string) {
  return value.trim().replace(/^\d+\s*[.)\-:：、]\s+/, "");
}

function normalizeOptionText(value: string) {
  return value.trim().replace(/^[A-Da-d]\s*[.)\-:：、]\s+/, "");
}

function readModelConfig(event: H3Event) {
  const runtimeConfig = useRuntimeConfig(event);
  const apiKey = runtimeConfig.openrouterApiKey;
  const modelName = runtimeConfig.openrouterModel;

  if (!apiKey || !modelName) {
    throw createError({
      statusCode: 500,
      statusMessage: "Missing NUXT_OPENROUTER_API_KEY or NUXT_OPENROUTER_MODEL.",
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

function toAiGenerationError(language: "zh" | "en", error: unknown) {
  const detail = toAiErrorDetail(error);
  const statusMessage =
    language === "zh"
      ? detail
        ? `AI 返回的题目格式不稳定，自动修复失败：${detail}`
        : "AI 返回的题目格式不稳定，请重试。"
      : detail
        ? `The AI returned an invalid quiz format and automatic recovery failed: ${detail}`
        : "The AI returned an invalid quiz format. Please try again.";

  return createError({
    statusCode: 502,
    statusMessage,
  });
}

function toAiErrorDetail(error: unknown) {
  if (NoObjectGeneratedError.isInstance(error)) {
    return "";
  }

  if (error instanceof z.ZodError) {
    const issue = error.issues[0];

    if (!issue) {
      return "";
    }

    const path = issue.path.length > 0 ? issue.path.join(".") : "response";
    return `${path}: ${issue.message}`;
  }

  if (isErrorWithMessage(error)) {
    return error.message;
  }

  return "";
}

function isErrorWithMessage(error: unknown): error is Error {
  return error instanceof Error && Boolean(error.message);
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
