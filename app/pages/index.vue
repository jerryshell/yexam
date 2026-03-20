<script setup lang="ts">
interface ExamQuestion {
  question: string;
  options: string[];
  correctIndex: number;
}

interface GenerateQuestionsResponse {
  questions: ExamQuestion[];
}

const { t, locale, setLocale } = useI18n();

useSeoMeta({
  title: () => t("title"),
  ogTitle: () => t("title"),
  description: () => t("description"),
  ogDescription: () => t("description"),
});

const videoUrl = ref("");
const examQuestions = ref<ExamQuestion[]>([]);
const selectedAnswers = ref<number[]>([]);
const isSubmitted = ref(false);
const isLoading = ref(false);
const errorMessage = ref("");
const selectedLocale = ref(locale.value);

const languageOptions = [
  { value: "zh", label: "中文" },
  { value: "en", label: "EN" },
];

watch(selectedLocale, (newLocale) => {
  setLocale(newLocale);
});

async function generateQuestions() {
  if (!videoUrl.value) return;

  isLoading.value = true;
  isSubmitted.value = false;
  selectedAnswers.value = [];
  errorMessage.value = "";

  try {
    const result = await $fetch<GenerateQuestionsResponse>("/api/generate", {
      method: "POST",
      body: { url: videoUrl.value, language: locale.value },
    });
    examQuestions.value = result.questions;
    selectedAnswers.value = result.questions.map(() => -1);
  } catch (e: unknown) {
    const err = e as { data?: { statusMessage?: string }; message?: string };
    errorMessage.value = err.data?.statusMessage ?? err.message ?? String(e);
  } finally {
    isLoading.value = false;
  }
}

function reset() {
  videoUrl.value = "";
  examQuestions.value = [];
  selectedAnswers.value = [];
  isSubmitted.value = false;
  errorMessage.value = "";
}

function tryDemo() {
  videoUrl.value = "UF8uR6Z6KLc";
  generateQuestions();
}

function submitAnswers() {
  isSubmitted.value = true;
}

function getScore() {
  return examQuestions.value.filter((q, i) => selectedAnswers.value[i] === q.correctIndex).length;
}

function getOptionClass(qIndex: number, oIndex: number, correctIndex: number) {
  const isSelected = selectedAnswers.value[qIndex] === oIndex;
  const isCorrect = oIndex === correctIndex;

  if (isSubmitted.value) {
    if (isSelected && !isCorrect) return "border-error bg-error/10";
    if (isCorrect) return "border-success bg-success/10";
  }

  if (isSelected) return "border-primary bg-primary/10";
  return "border-muted hover:border-muted/70";
}
</script>

<template>
  <div class="min-h-screen flex flex-col p-4">
    <div class="flex justify-end items-center gap-3 mb-4">
      <UButton
        color="neutral"
        variant="ghost"
        icon="i-lucide-github"
        href="https://github.com/jerryshell/yexam"
        target="_blank"
      />
      <UColorModeButton />
      <USelect v-model="selectedLocale" :items="languageOptions" size="sm" class="w-24" />
    </div>
    <div class="flex-1 flex flex-col items-center justify-center">
      <div class="w-full max-w-2xl space-y-6">
        <h1 class="text-3xl font-bold text-center">{{ t("title") }}</h1>
        <p class="text-center text-gray-500 dark:text-gray-400">{{ t("description") }}</p>

        <div v-if="examQuestions.length === 0" class="space-y-4">
          <UInput
            v-model="videoUrl"
            :placeholder="t('placeholder')"
            size="xl"
            class="w-full"
            @keyup.enter="generateQuestions"
          />
          <UAlert v-if="errorMessage" color="error" variant="subtle" :title="errorMessage" />
          <div class="flex gap-3">
            <UButton
              class="flex-1 justify-center"
              size="xl"
              :loading="isLoading"
              :disabled="!videoUrl"
              @click="generateQuestions"
            >
              {{ t("generate") }}
            </UButton>
            <UButton
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

        <div v-else class="space-y-6">
          <div
            v-for="(q, qIndex) in examQuestions"
            :key="qIndex"
            class="p-4 rounded-lg border border-muted space-y-3"
          >
            <p class="font-medium">{{ qIndex + 1 }}. {{ q.question }}</p>
            <div class="space-y-2">
              <button
                v-for="(option, oIndex) in q.options"
                :key="oIndex"
                class="w-full text-left p-3 rounded-lg border transition-colors"
                :class="getOptionClass(qIndex, oIndex, q.correctIndex)"
                :disabled="isSubmitted"
                @click="selectedAnswers[qIndex] = oIndex"
              >
                {{ option }}
              </button>
            </div>
          </div>

          <div v-if="isSubmitted" class="text-center space-y-4">
            <p class="text-xl font-bold">
              {{ t("score", { correct: getScore(), total: examQuestions.length }) }}
            </p>
            <UButton block size="xl" @click="reset">
              {{ t("tryAgain") }}
            </UButton>
          </div>
          <UButton
            v-else
            block
            size="xl"
            :disabled="selectedAnswers.includes(-1)"
            @click="submitAnswers"
          >
            {{ t("submit") }}
          </UButton>
        </div>
      </div>
    </div>
  </div>
</template>
