<script setup lang="ts">
interface Question {
  question: string;
  options: string[];
  correctIndex: number;
}

interface GenerateResponse {
  questions: Question[];
}

const { t, locale, setLocale } = useI18n();

useSeoMeta({
  title: () => t("title"),
  ogTitle: () => t("title"),
  description: () => t("description"),
  ogDescription: () => t("description"),
});

const url = ref("");
const questions = ref<Question[]>([]);
const userAnswers = ref<number[]>([]);
const submitted = ref(false);
const loading = ref(false);
const error = ref("");
const selectedLocale = ref(locale.value);

const languageOptions = [
  { value: "zh", label: "中文" },
  { value: "en", label: "EN" },
];

watch(selectedLocale, (newLocale) => {
  setLocale(newLocale);
});

async function generateQuestions() {
  if (!url.value) return;

  loading.value = true;
  submitted.value = false;
  userAnswers.value = [];
  error.value = "";

  try {
    const result = await $fetch<GenerateResponse>("/api/generate", {
      method: "POST",
      body: { url: url.value, language: locale.value },
    });
    questions.value = result.questions;
    userAnswers.value = result.questions.map(() => -1);
  } catch (e: unknown) {
    const err = e as { data?: { statusMessage?: string }; message?: string };
    const message = err.data?.statusMessage ?? err.message ?? String(e);
    error.value = message;
  } finally {
    loading.value = false;
  }
}

function submitAnswers() {
  submitted.value = true;
}

function getScore() {
  return questions.value.filter((q, i) => userAnswers.value[i] === q.correctIndex).length;
}

function getOptionClass(qIndex: number, oIndex: number, correctIndex: number) {
  const isSelected = userAnswers.value[qIndex] === oIndex;
  const isCorrect = oIndex === correctIndex;
  const isWrong = submitted.value && isSelected && !isCorrect;

  if (isWrong) return "border-error bg-error/10";
  if (submitted.value && isCorrect) return "border-success bg-success/10";
  if (isSelected) return "border-primary bg-primary/10";
  return "border-muted hover:border-muted/70";
}

function reset() {
  url.value = "";
  questions.value = [];
  userAnswers.value = [];
  submitted.value = false;
  error.value = "";
}

function tryDemo() {
  url.value = "UF8uR6Z6KLc";
  generateQuestions();
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

        <div v-if="questions.length === 0" class="space-y-4">
          <UInput
            v-model="url"
            :placeholder="t('placeholder')"
            size="xl"
            class="w-full"
            @keyup.enter="generateQuestions"
          />
          <UAlert v-if="error" color="error" variant="subtle" :title="error" />
          <div class="flex gap-3">
            <UButton
              class="flex-1 justify-center"
              size="xl"
              :loading="loading"
              :disabled="!url"
              @click="generateQuestions"
            >
              {{ t("generate") }}
            </UButton>
            <UButton
              variant="outline"
              size="xl"
              class="justify-center"
              :loading="loading"
              @click="tryDemo"
            >
              {{ t("tryDemo") }}
            </UButton>
          </div>
        </div>

        <div v-else class="space-y-6">
          <div
            v-for="(q, qIndex) in questions"
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
                :disabled="submitted"
                @click="userAnswers[qIndex] = oIndex"
              >
                {{ option }}
              </button>
            </div>
          </div>

          <div v-if="submitted" class="text-center space-y-4">
            <p class="text-xl font-bold">
              {{ t("score", { correct: getScore(), total: questions.length }) }}
            </p>
            <UButton block size="xl" @click="reset">
              {{ t("tryAgain") }}
            </UButton>
          </div>
          <UButton
            v-else
            block
            size="xl"
            :disabled="userAnswers.includes(-1)"
            @click="submitAnswers"
          >
            {{ t("submit") }}
          </UButton>
        </div>
      </div>
    </div>
  </div>
</template>
