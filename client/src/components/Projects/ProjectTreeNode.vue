<script setup lang="ts">
import { faFolder, faFolderOpen } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/vue-fontawesome";
import { computed } from "vue";

import { pluralize } from "@/utils/strings";

import { isWithinProject, type ProjectNode, type ProjectNodeCounts } from "./projectTags";

const props = defineProps<{
    node: ProjectNode;
    selectedPath?: string;
    /** Histories and workflows in each path, subprojects included */
    counts: Record<string, ProjectNodeCounts>;
    /** Runs in the selected project, once they are loaded */
    selectedRuns?: number;
}>();

const emit = defineEmits<{
    (e: "select", path: string): void;
}>();

const nodeCounts = computed(
    () => props.counts[props.node.path] ?? { histories: 0, workflows: 0, sharedHistories: 0, sharedWorkflows: 0 },
);
const runs = computed(() => (props.node.path === props.selectedPath ? props.selectedRuns : undefined));

function countOf(count: number, singular: string, plural?: string, shared = 0) {
    const text = `${count} ${pluralize(count, singular, plural)}`;
    return shared ? `${text} (${shared} shared with you)` : text;
}

const countsTitle = computed(() => {
    const parts = [
        countOf(nodeCounts.value.histories, "history", "histories", nodeCounts.value.sharedHistories),
        countOf(nodeCounts.value.workflows, "workflow", undefined, nodeCounts.value.sharedWorkflows),
    ];
    if (runs.value !== undefined) {
        parts.push(countOf(runs.value, "run"));
    }
    return parts.join(", ");
});
</script>

<template>
    <li class="project-tree-node">
        <button
            class="project-tree-label btn btn-link text-left p-0"
            :class="{ 'font-weight-bold': node.path === selectedPath }"
            :data-project-path="node.path"
            @click="emit('select', node.path)">
            <FontAwesomeIcon
                :icon="selectedPath && isWithinProject(selectedPath, node.path) ? faFolderOpen : faFolder"
                fixed-width />
            {{ node.label }}
            <span class="text-muted small" :title="countsTitle" data-project-counts>
                {{ nodeCounts.histories }} · {{ nodeCounts.workflows }}
            </span>
            <span v-if="runs !== undefined" class="text-muted small" :title="countsTitle" data-project-runs>
                · {{ countOf(runs, "run") }}
            </span>
        </button>
        <slot name="actions" :node="node" />
        <ul v-if="node.children.length" class="list-unstyled ml-3 mb-0">
            <ProjectTreeNode
                v-for="child in node.children"
                :key="child.path"
                :node="child"
                :selected-path="selectedPath"
                :counts="counts"
                :selected-runs="selectedRuns"
                @select="emit('select', $event)">
                <template v-slot:actions="slotProps">
                    <slot name="actions" v-bind="slotProps" />
                </template>
            </ProjectTreeNode>
        </ul>
    </li>
</template>
