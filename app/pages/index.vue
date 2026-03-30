<script setup lang="ts">
interface ExamQuestion {
  question: string;
  options: string[];
  correctIndex: number;
}

interface VideoSummary {
  title: string;
  author: string;
  transcriptLanguage: string;
}

interface GenerateQuestionsResponse {
  video: VideoSummary;
  questions: ExamQuestion[];
}

const demoVideoUrl = "https://www.youtube.com/watch?v=UF8uR6Z6KLc";

const languageOptions = [
  { value: "zh", label: "中文" },
  { value: "en", label: "EN" },
];

const { t, locale, setLocale } = useI18n();

useSeoMeta({
  title: () => t("title"),
  ogTitle: () => t("title"),
  description: () => t("description"),
  ogDescription: () => t("description"),
});

const selectedLocale = ref(locale.value);
const videoUrl = ref("");
const videoSummary = ref<VideoSummary | null>(null);
const examQuestions = ref<ExamQuestion[]>([]);
const selectedAnswers = ref<number[]>([]);
const errorMessage = ref("");
const isLoading = ref(false);
const isSubmitted = ref(false);

const hasQuestions = computed(() => examQuestions.value.length > 0);

const canSubmit = computed(() => hasQuestions.value && !selectedAnswers.value.includes(-1));

const score = computed(
  () =>
    examQuestions.value.filter(
      (question, index) => selectedAnswers.value[index] === question.correctIndex,
    ).length,
);

const outputLanguageLabel = computed(
  () =>
    languageOptions.find((option) => option.value === locale.value)?.label ??
    locale.value.toUpperCase(),
);

const transcriptLanguageLabel = computed(
  () => videoSummary.value?.transcriptLanguage.toUpperCase() ?? "EN",
);

watch(locale, (nextLocale) => {
  if (selectedLocale.value !== nextLocale) {
    selectedLocale.value = nextLocale;
  }
});

watch(selectedLocale, (nextLocale) => {
  if (locale.value !== nextLocale) {
    setLocale(nextLocale);
  }
});

async function generateQuestions() {
  const normalizedUrl = videoUrl.value.trim();

  if (!normalizedUrl) {
    return;
  }

  isLoading.value = true;
  isSubmitted.value = false;
  errorMessage.value = "";

  try {
    const result = await $fetch<GenerateQuestionsResponse>("/api/generate", {
      method: "POST",
      body: { url: normalizedUrl, language: locale.value },
    });

    videoUrl.value = normalizedUrl;
    videoSummary.value = result.video;
    examQuestions.value = result.questions;
    selectedAnswers.value = result.questions.map(() => -1);
  } catch (error: unknown) {
    videoSummary.value = null;
    examQuestions.value = [];
    selectedAnswers.value = [];
    errorMessage.value = readErrorMessage(error);
  } finally {
    isLoading.value = false;
  }
}

function resetQuiz() {
  videoUrl.value = "";
  videoSummary.value = null;
  examQuestions.value = [];
  selectedAnswers.value = [];
  errorMessage.value = "";
  isSubmitted.value = false;
}

function tryDemo() {
  videoUrl.value = demoVideoUrl;
  return generateQuestions();
}

function submitAnswers() {
  isSubmitted.value = true;
}

function selectAnswer(questionIndex: number, optionIndex: number) {
  if (!isSubmitted.value) {
    selectedAnswers.value[questionIndex] = optionIndex;
  }
}

function getOptionClass(questionIndex: number, optionIndex: number, correctIndex: number) {
  const baseClass = "w-full rounded-xl border px-4 py-3 text-left text-sm transition sm:text-base";
  const isSelected = selectedAnswers.value[questionIndex] === optionIndex;
  const isCorrect = optionIndex === correctIndex;

  if (isSubmitted.value) {
    if (isCorrect) {
      return `${baseClass} border-success bg-success/10 text-success`;
    }

    if (isSelected) {
      return `${baseClass} border-error bg-error/10 text-error`;
    }

    return `${baseClass} border-default text-toned`;
  }

  if (isSelected) {
    return `${baseClass} border-primary bg-primary/10 text-primary`;
  }

  return `${baseClass} border-default text-highlighted hover:border-primary/40 hover:bg-elevated`;
}

function readErrorMessage(error: unknown) {
  const fetchError = error as {
    data?: { statusMessage?: string };
    message?: string;
  };

  return fetchError.data?.statusMessage ?? fetchError.message ?? String(error);
}
</script>

<template>
  <div class="min-h-screen">
    <UContainer class="flex min-h-screen max-w-4xl flex-col px-4 py-6">
      <header class="flex items-center justify-end gap-3">
        <UButton
          color="neutral"
          variant="ghost"
          icon="i-lucide-github"
          href="https://github.com/jerryshell/yexam"
          target="_blank"
        />
        <UColorModeButton />
        <USelect v-model="selectedLocale" :items="languageOptions" size="sm" class="w-24" />
      </header>

      <main class="flex flex-1 items-center justify-center py-8">
        <div v-if="!hasQuestions" class="w-full max-w-2xl space-y-6">
          <div class="space-y-4 text-center">
            <UBadge color="neutral" variant="subtle">{{ t("heroBadge") }}</UBadge>
            <h1 class="text-4xl font-semibold tracking-tight text-highlighted sm:text-5xl">
              {{ t("title") }}
            </h1>
            <p class="text-base text-toned sm:text-lg">
              {{ t("description") }}
            </p>
          </div>

          <UCard>
            <div class="space-y-4">
              <UFormField :label="t('inputLabel')" :description="t('inputHint')">
                <UInput
                  v-model="videoUrl"
                  :placeholder="t('placeholder')"
                  icon="i-lucide-link"
                  size="xl"
                  :disabled="isLoading"
                  @keyup.enter="generateQuestions"
                />
              </UFormField>

              <UAlert
                v-if="isLoading"
                color="primary"
                variant="subtle"
                icon="i-lucide-loader-circle"
                :title="t('loadingMessage')"
              />

              <UAlert
                v-if="errorMessage"
                color="error"
                variant="subtle"
                icon="i-lucide-circle-alert"
                :title="errorMessage"
              />

              <div class="flex flex-col gap-3 sm:flex-row">
                <UButton
                  class="flex-1 justify-center"
                  size="xl"
                  :loading="isLoading"
                  :disabled="!videoUrl.trim()"
                  @click="generateQuestions"
                >
                  {{ t("generate") }}
                </UButton>
                <UButton
                  color="neutral"
                  variant="outline"
                  size="xl"
                  class="justify-center"
                  :loading="isLoading"
                  @click="tryDemo"
                >
                  {{ t("tryDemo") }}
                </UButton>
              </div>
            </div>
          </UCard>
        </div>

        <div v-else class="w-full max-w-3xl space-y-4">
          <UCard>
            <div class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div class="space-y-1">
                <p class="text-sm text-toned">{{ t("sourceVideo") }}</p>
                <h2 class="text-xl font-semibold text-highlighted">
                  {{ videoSummary?.title }}
                </h2>
                <p class="text-sm text-toned">
                  {{ t("videoAuthor", { author: videoSummary?.author }) }}
                </p>
              </div>

              <div class="flex flex-wrap gap-2">
                <UBadge color="neutral" variant="subtle">
                  {{ t("questionCount", { count: examQuestions.length }) }}
                </UBadge>
                <UBadge color="neutral" variant="soft">
                  {{ t("transcriptBadge", { language: transcriptLanguageLabel }) }}
                </UBadge>
                <UBadge color="primary" variant="soft">
                  {{ t("outputBadge", { language: outputLanguageLabel }) }}
                </UBadge>
              </div>
            </div>
          </UCard>

          <UCard v-for="(question, questionIndex) in examQuestions" :key="questionIndex">
            <div class="space-y-4">
              <p class="text-base font-medium text-highlighted sm:text-lg">
                {{ questionIndex + 1 }}. {{ question.question }}
              </p>

              <div class="space-y-2">
                <button
                  v-for="(option, optionIndex) in question.options"
                  :key="optionIndex"
                  type="button"
                  :class="getOptionClass(questionIndex, optionIndex, question.correctIndex)"
                  :disabled="isSubmitted"
                  @click="selectAnswer(questionIndex, optionIndex)"
                >
                  {{ option }}
                </button>
              </div>
            </div>
          </UCard>

          <UCard>
            <div class="space-y-4">
              <p v-if="isSubmitted" class="text-center text-2xl font-semibold text-highlighted">
                {{ t("score", { correct: score, total: examQuestions.length }) }}
              </p>

              <div class="flex flex-col gap-3 sm:flex-row">
                <UButton
                  v-if="!isSubmitted"
                  class="flex-1 justify-center"
                  size="xl"
                  :disabled="!canSubmit"
                  @click="submitAnswers"
                >
                  {{ t("submit") }}
                </UButton>
                <UButton
                  class="flex-1 justify-center"
                  size="xl"
                  :color="isSubmitted ? 'primary' : 'neutral'"
                  :variant="isSubmitted ? 'solid' : 'outline'"
                  @click="resetQuiz"
                >
                  {{ t("tryAgain") }}
                </UButton>
              </div>
            </div>
          </UCard>
        </div>
      </main>
    </UContainer>
  </div>
</template>
