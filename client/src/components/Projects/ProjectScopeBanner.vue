<script setup lang="ts">
import { faFolderOpen } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/vue-fontawesome";
import { storeToRefs } from "pinia";

import { useProjectContextStore } from "@/stores/projectContextStore";

import GLink from "@/components/BaseComponents/GLink.vue";

const projectContextStore = useProjectContextStore();
const { currentProject, includeSubprojects } = storeToRefs(projectContextStore);
</script>

<template>
    <div v-if="currentProject" class="project-scope-banner small mb-2" data-description="project scope banner">
        <FontAwesomeIcon :icon="faFolderOpen" fixed-width class="text-muted" />
        <span>
            In project <span class="font-weight-bold">{{ currentProject }}</span
            >{{ includeSubprojects ? " and its subprojects" : "" }}
        </span>
        <span class="text-muted" aria-hidden="true">&middot;</span>
        <GLink data-description="project scope clear" @click="projectContextStore.clearCurrentProject()">
            Show all projects
        </GLink>
    </div>
</template>

<style scoped>
.project-scope-banner {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--spacing-1);
}
</style>
