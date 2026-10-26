<script setup lang="ts">
/**
 * Creates a new current history in a project. With `newProject`, it first asks for the name
 * of a new (sub)project under `parentPath`: projects only exist through tags, so the new
 * history is what brings the project into being.
 */
import { computed, ref, watch } from "vue";

import { errorMessageAsString } from "@/utils/simple-error";

import { projectTag } from "./projectTags";
import { childProjectPath, DEFAULT_HISTORY_NAME, useProjectActions } from "./useProjectActions";

import GFormInput from "@/components/BaseComponents/Form/GFormInput.vue";
import GAlert from "@/components/BaseComponents/GAlert.vue";
import GModal from "@/components/BaseComponents/GModal.vue";

const props = defineProps<{
    show: boolean;
    /** The project to create the history in, or the parent of the new project */
    parentPath?: string;
    /** Ask for a new subproject (or top-level project without `parentPath`) name */
    newProject?: boolean;
}>();

const emit = defineEmits<{
    (e: "update:show", show: boolean): void;
    (e: "created", path: string): void;
}>();

const { createHistoryInProject } = useProjectActions();

const projectName = ref("");
const historyName = ref("");
const busy = ref(false);
const errorMessage = ref<string>();

const targetPath = computed(() =>
    props.newProject ? childProjectPath(props.parentPath, projectName.value) : childProjectPath(props.parentPath, ""),
);
const title = computed(() => {
    if (!props.newProject) {
        return `New history in ${props.parentPath}`;
    }
    return props.parentPath ? `New subproject of ${props.parentPath}` : "New project";
});

watch(
    () => props.show,
    (show) => {
        if (show) {
            projectName.value = "";
            historyName.value = "";
            errorMessage.value = undefined;
        }
    },
);

async function onOk() {
    if (!targetPath.value || busy.value) {
        return;
    }
    busy.value = true;
    errorMessage.value = undefined;
    try {
        await createHistoryInProject(targetPath.value, historyName.value);
        emit("created", targetPath.value);
        emit("update:show", false);
    } catch (error) {
        errorMessage.value = errorMessageAsString(error);
    } finally {
        busy.value = false;
    }
}
</script>

<template>
    <GModal
        :show="show"
        :title="title"
        confirm
        size="small"
        ok-text="Create"
        :close-on-ok="false"
        :ok-disabled="!targetPath || busy"
        ok-disabled-title="Enter a project name"
        :cancel-disabled="busy"
        @update:show="emit('update:show', $event)"
        @ok="onOk">
        <div v-if="newProject" class="mb-3">
            <label for="project-history-dialog-project" class="mb-1">Project name</label>
            <GFormInput
                id="project-history-dialog-project"
                v-model="projectName"
                :placeholder="parentPath ? 'e.g. scrna' : 'e.g. lung'" />
        </div>
        <p class="small text-muted" data-project-history-dialog-help>
            <template v-if="newProject">A project is a tag; this creates a new history tagged </template>
            <template v-else>This creates a new history tagged </template>
            <code>{{ projectTag(targetPath || "...") }}</code> and makes it your current history.
        </p>
        <label for="project-history-dialog-history" class="mb-1">History name</label>
        <GFormInput id="project-history-dialog-history" v-model="historyName" :placeholder="DEFAULT_HISTORY_NAME" />
        <GAlert v-if="errorMessage" variant="danger" show class="mt-2 mb-0">{{ errorMessage }}</GAlert>
    </GModal>
</template>
