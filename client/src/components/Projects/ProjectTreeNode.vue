<script setup lang="ts">
import { faFolder, faFolderOpen } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/vue-fontawesome";

import { isWithinProject, type ProjectNode } from "./projectTags";

defineProps<{
    node: ProjectNode;
    selectedPath?: string;
    /** Number of histories plus workflows tagged exactly with each path */
    counts: Record<string, number>;
}>();

const emit = defineEmits<{
    (e: "select", path: string): void;
}>();
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
            <span class="text-muted small">({{ counts[node.path] ?? 0 }})</span>
        </button>
        <ul v-if="node.children.length" class="list-unstyled ml-3 mb-0">
            <ProjectTreeNode
                v-for="child in node.children"
                :key="child.path"
                :node="child"
                :selected-path="selectedPath"
                :counts="counts"
                @select="emit('select', $event)" />
        </ul>
    </li>
</template>
