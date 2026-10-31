<script setup lang="ts">
import { faCaretDown, faCaretRight, faFolder, faFolderOpen, faLayerGroup } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/vue-fontawesome";
import { dropdownHideKey } from "@galaxyproject/galaxy-ui";
import { BNavItemDropdown } from "bootstrap-vue";
import { storeToRefs } from "pinia";
import { computed, provide, ref } from "vue";

import { buildProjectTree, type ProjectNode } from "@/components/Projects/projectTags";
import { useProjectContextStore } from "@/stores/projectContextStore";
import { useProjectStore } from "@/stores/projectStore";

import GCheckbox from "@/components/BaseComponents/GCheckbox.vue";
import GDropdownDivider from "@/components/BaseComponents/GDropdownDivider.vue";
import GDropdownForm from "@/components/BaseComponents/GDropdownForm.vue";
import GDropdownItem from "@/components/BaseComponents/GDropdownItem.vue";
import GDropdownText from "@/components/BaseComponents/GDropdownText.vue";

const MAX_LABEL_LENGTH = 24;

interface Row {
    node: ProjectNode;
    depth: number;
}

const projectContextStore = useProjectContextStore();
const { currentProject, includeSubprojects, projectsAsField } = storeToRefs(projectContextStore);
const projectStore = useProjectStore();

const dropdown = ref<InstanceType<typeof BNavItemDropdown>>();

// BNavItemDropdown's hide() does not refocus the toggle by default, unlike GDropdown's
provide(dropdownHideKey, (restoreFocus = true) => {
    dropdown.value?.hide(restoreFocus);
});

/** The current path cut to fit the masthead, keeping its end since that is the part that tells subprojects apart. */
const label = computed(() => {
    const path = currentProject.value;
    if (!path) {
        return "All projects";
    }
    return path.length > MAX_LABEL_LENGTH ? `…${path.slice(-(MAX_LABEL_LENGTH - 1))}` : path;
});

const tree = computed(() => buildProjectTree(projectStore.projectPaths));
const expandedPaths = ref(new Set<string>());

const rows = computed(() => {
    const result: Row[] = [];
    const visit = (nodes: ProjectNode[], depth: number) => {
        for (const node of nodes) {
            result.push({ node, depth });
            if (expandedPaths.value.has(node.path)) {
                visit(node.children, depth + 1);
            }
        }
    };
    visit(tree.value, 0);
    return result;
});

function setExpanded(path: string, expanded: boolean) {
    const next = new Set(expandedPaths.value);
    if (expanded) {
        next.add(path);
    } else {
        next.delete(path);
    }
    expandedPaths.value = next;
}

// Listened for on the tree rather than each row: a listener on GDropdownItem doesn't reach its anchor.
function onTreeKeydown(event: KeyboardEvent) {
    const path = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-project-path]")?.dataset.projectPath;
    if (path && (event.key === "ArrowRight" || event.key === "ArrowLeft")) {
        event.preventDefault();
        setExpanded(path, event.key === "ArrowRight");
    }
}

function toggle(path: string) {
    setExpanded(path, !expandedPaths.value.has(path));
}

async function onShow() {
    await projectStore.fetch();
    // Top-level projects open, so two levels show, plus whatever leads down to the current project.
    const next = new Set(expandedPaths.value);
    tree.value.forEach((node) => next.add(node.path));
    const segments = currentProject.value?.split("/") ?? [];
    for (let i = 1; i < segments.length; i++) {
        next.add(segments.slice(0, i).join("/"));
    }
    expandedPaths.value = next;
}
</script>

<template>
    <BNavItemDropdown
        id="project-context"
        ref="dropdown"
        v-g-tooltip.hover.bottom
        title="Current project"
        right
        @show="onShow">
        <template v-slot:button-content>
            <FontAwesomeIcon fixed-width :icon="currentProject ? faFolderOpen : faLayerGroup" />
            <span
                class="project-context-label"
                data-description="current project label"
                :title="currentProject ?? undefined">
                {{ label }}
            </span>
        </template>
        <GDropdownItem
            :active="!currentProject"
            data-description="all projects"
            @click="projectContextStore.clearCurrentProject()">
            <FontAwesomeIcon fixed-width :icon="faLayerGroup" />
            <span>All projects</span>
        </GDropdownItem>
        <GDropdownDivider />
        <GDropdownText v-if="projectStore.error">
            <span class="text-danger">{{ projectStore.error }}</span>
        </GDropdownText>
        <GDropdownText v-else-if="!projectStore.loaded">
            <span class="text-muted">Loading projects...</span>
        </GDropdownText>
        <GDropdownText v-else-if="rows.length === 0">
            <span class="text-muted">No projects yet</span>
        </GDropdownText>
        <div v-else class="project-context-tree" @keydown="onTreeKeydown">
            <GDropdownItem
                v-for="row in rows"
                :key="row.node.path"
                :active="row.node.path === currentProject"
                :data-project-path="row.node.path"
                :title="row.node.path"
                :style="{ paddingLeft: `${1 + row.depth}rem` }"
                @click="projectContextStore.setCurrentProject(row.node.path)">
                <span
                    v-if="row.node.children.length"
                    class="project-context-toggle"
                    role="button"
                    tabindex="-1"
                    data-description="toggle subprojects"
                    :aria-label="`${expandedPaths.has(row.node.path) ? 'Collapse' : 'Expand'} ${row.node.path}`"
                    :aria-expanded="expandedPaths.has(row.node.path)"
                    @click.stop.prevent="toggle(row.node.path)">
                    <FontAwesomeIcon
                        fixed-width
                        :icon="expandedPaths.has(row.node.path) ? faCaretDown : faCaretRight" />
                </span>
                <FontAwesomeIcon v-else fixed-width class="invisible" :icon="faCaretRight" />
                <FontAwesomeIcon fixed-width :icon="faFolder" />
                <span>{{ row.node.label }}</span>
            </GDropdownItem>
        </div>
        <GDropdownDivider />
        <GDropdownForm form-class="px-3 py-2">
            <div data-description="include subprojects">
                <GCheckbox v-model="includeSubprojects">Include subprojects</GCheckbox>
            </div>
            <div data-description="projects as field">
                <GCheckbox v-model="projectsAsField">Show projects as a field</GCheckbox>
            </div>
        </GDropdownForm>
        <GDropdownDivider />
        <GDropdownItem to="/projects" data-description="manage projects">Manage projects</GDropdownItem>
    </BNavItemDropdown>
</template>

<style scoped>
.project-context-label {
    display: inline-block;
    max-width: 14rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    vertical-align: bottom;
}

.project-context-tree {
    max-height: 50vh;
    overflow-y: auto;
}
</style>
