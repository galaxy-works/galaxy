<script setup lang="ts">
/**
 * Chooses a project path: pick one of the existing projects or type a new one (`/` nests).
 * The model is always the normalized path, while the input keeps what was typed.
 */
import { storeToRefs } from "pinia";
import { computed, onMounted, ref, watch } from "vue";

import { useProjectStore } from "@/stores/projectStore";

import { normalizeProjectPath, projectPathProblem, projectTag } from "./projectTags";

import GFormInput from "@/components/BaseComponents/Form/GFormInput.vue";

defineOptions({
    // Under @vue/compat, keep v-model on modelValue instead of Vue 2's value/input
    compatConfig: { COMPONENT_V_MODEL: false },
});

const props = withDefaults(
    defineProps<{
        modelValue?: string;
        id?: string;
    }>(),
    {
        modelValue: "",
        id: "project-picker",
    },
);

const emit = defineEmits<{
    (e: "update:modelValue", path: string): void;
}>();

const projectStore = useProjectStore();
const { projectPaths } = storeToRefs(projectStore);

const text = ref(props.modelValue);
const problem = computed(() => projectPathProblem(text.value ?? ""));
const normalized = computed(() => (problem.value ? "" : normalizeProjectPath(text.value ?? "")));
const sortedPaths = computed(() => [...projectPaths.value].sort((a, b) => a.localeCompare(b)));
const isNew = computed(() => Boolean(normalized.value) && !projectPaths.value.includes(normalized.value));

watch(
    () => props.modelValue,
    (value) => {
        if (value !== normalized.value) {
            text.value = value;
        }
    },
);

function onInput(value: string | null) {
    text.value = value ?? "";
    emit("update:modelValue", normalized.value);
}

onMounted(() => projectStore.fetch());
</script>

<template>
    <div class="project-picker">
        <label :for="id" class="mb-1">Project</label>
        <GFormInput
            :id="id"
            :model-value="text"
            :list="`${id}-paths`"
            placeholder="Choose a project or type a new one, e.g. lung/scrna"
            autocomplete="off"
            @update:model-value="onInput" />
        <datalist :id="`${id}-paths`">
            <option v-for="path in sortedPaths" :key="path" :value="path" />
        </datalist>
        <small v-if="problem" class="form-text text-danger" data-project-picker-problem>{{ problem }}</small>
        <small v-else-if="normalized" class="form-text text-muted" data-project-picker-preview>
            Tags with <code>{{ projectTag(normalized) }}</code>
            <span v-if="isNew">(new project)</span>
        </small>
    </div>
</template>
