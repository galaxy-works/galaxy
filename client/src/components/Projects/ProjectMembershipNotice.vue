<script setup lang="ts">
import { storeToRefs } from "pinia";
import { computed, ref } from "vue";

import { Toast } from "@/composables/toast";
import { useHistoryStore } from "@/stores/historyStore";
import { useProjectContextStore } from "@/stores/projectContextStore";
import { useProjectStore } from "@/stores/projectStore";
import { errorMessageAsString } from "@/utils/simple-error";

import { useProjectScope } from "./projectScope";
import { withProjectTag } from "./useProjectActions";

import GLink from "@/components/BaseComponents/GLink.vue";

const props = defineProps<{
    history: { id: string; tags?: string[] | null };
}>();

const { currentProject } = storeToRefs(useProjectContextStore());
const { inScope } = useProjectScope();
const adding = ref(false);

const outsideProject = computed(() => Boolean(currentProject.value) && !inScope(props.history.tags));

async function addToProject() {
    const project = currentProject.value;
    if (!project) {
        return;
    }
    adding.value = true;
    try {
        await useHistoryStore().updateHistory(props.history.id, { tags: withProjectTag(props.history.tags, project) });
        await useProjectStore().refresh();
    } catch (error) {
        Toast.error(`Could not add this history to project ${project}: ${errorMessageAsString(error)}`);
    } finally {
        adding.value = false;
    }
}
</script>

<template>
    <div
        v-if="outsideProject"
        class="project-membership-notice small text-muted mx-3 mb-1"
        data-description="project membership notice">
        <span>
            Not in project <span class="font-weight-bold">{{ currentProject }}</span>
        </span>
        <span aria-hidden="true">&middot;</span>
        <GLink
            data-description="add to current project"
            :disabled="adding"
            :title="`Tag this history with project:${currentProject}`"
            @click="addToProject">
            Add
        </GLink>
    </div>
</template>

<style scoped>
.project-membership-notice {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--spacing-1);
}
</style>
