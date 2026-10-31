<script setup lang="ts">
/**
 * A row of chips for the top-level projects, shown above a history list while projects are
 * treated as a field. Bind `v-model:filter-text` to drive a list filter directly, or use
 * `value` and `select` to keep track of the path yourself.
 */
import { faFolder } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/vue-fontawesome";
import { storeToRefs } from "pinia";
import { computed, watch } from "vue";

import { useProjectContextStore } from "@/stores/projectContextStore";
import { useProjectStore } from "@/stores/projectStore";

import { buildProjectTree, exactProjectTag, projectPathsOf, tagListFilter } from "./projectTags";

import GButton from "@/components/BaseComponents/GButton.vue";

const props = defineProps<{
    /** The active project path, `null` for All. Left out, it is read from `filterText`. */
    value?: string | null;
    /** The list's filter text, when the bar drives it through `v-model:filter-text`. */
    filterText?: string;
}>();

const emit = defineEmits<{
    (e: "select", path: string | null): void;
    (e: "update:filterText", filterText: string): void;
}>();

const projectContextStore = useProjectContextStore();
const { projectsAsField, hasCurrentProject } = storeToRefs(projectContextStore);

// Under a browser-wide project the list is already scoped; a chip for another project would
// only AND the two filters into an empty list, so the bar steps aside until the scope is cleared.
const shown = computed(() => projectsAsField.value && !hasCurrentProject.value);
const projectStore = useProjectStore();
const { histories, projectPaths } = storeToRefs(projectStore);

const topLevelPaths = computed(() => buildProjectTree(projectPaths.value).map((node) => node.path));

const EXACT_TAG_FILTER = /^tag:'([^']*)'$/;

/** The active path, `null` for All, or `undefined` when the filter is something no chip stands for. */
const activePath = computed<string | null | undefined>(() => {
    if (props.value !== undefined) {
        return props.value;
    }
    const filterText = (props.filterText ?? "").trim();
    if (!filterText) {
        return null;
    }
    const match = filterText.match(EXACT_TAG_FILTER);
    return match ? projectPathsOf([match[1]!])[0] : undefined;
});

function select(path: string | null) {
    emit("select", path);
    // The list pages match a quoted tag exactly and case-sensitively, so use the histories' own spelling.
    const filterText = path
        ? tagListFilter(
              exactProjectTag(
                  histories.value.map((h) => h.tags),
                  path,
              ),
          )
        : "";
    emit("update:filterText", filterText);
}

watch(
    projectsAsField,
    (asField) => {
        if (asField) {
            projectStore.fetch();
        }
    },
    { immediate: true },
);
</script>

<template>
    <nav v-if="shown" class="project-bar d-flex flex-wrap flex-gapx-1 mb-2" aria-label="Projects" data-project-bar>
        <GButton
            size="small"
            color="blue"
            outline
            :pressed="activePath === null"
            data-project-bar-chip=""
            @click="select(null)">
            All
        </GButton>
        <GButton
            v-for="path in topLevelPaths"
            :key="path"
            size="small"
            color="blue"
            outline
            :pressed="activePath === path"
            :title="`Histories in project ${path}`"
            :data-project-bar-chip="path"
            @click="select(path)">
            <FontAwesomeIcon :icon="faFolder" fixed-width />
            {{ path }}
        </GButton>
    </nav>
</template>
