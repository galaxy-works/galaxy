<script setup lang="ts">
/**
 * A client-only "Projects" page that is nothing more than a view over `project:<path>` tags on
 * the current user's histories and workflows. There is no project model on the server; `/` in
 * the tag value nests projects.
 */
import { faFolderOpen, faPlus } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/vue-fontawesome";
import { storeToRefs } from "pinia";
import { computed, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";

import { GalaxyApi } from "@/api";
import type { MyHistory } from "@/api/histories";
import type { WorkflowInvocation } from "@/api/invocations";
import { useProjectStore } from "@/stores/projectStore";
import { useUserStore } from "@/stores/userStore";
import { useWorkflowStore } from "@/stores/workflowStore";
import { errorMessageAsString } from "@/utils/simple-error";

import {
    buildProjectTree,
    countNodes,
    exactProjectTag,
    isWithinProject,
    projectPathsOf,
    tagListFilter,
} from "./projectTags";

import GAlert from "@/components/BaseComponents/GAlert.vue";
import GButton from "@/components/BaseComponents/GButton.vue";
import GLink from "@/components/BaseComponents/GLink.vue";
import BreadcrumbHeading from "@/components/Common/BreadcrumbHeading.vue";
import Heading from "@/components/Common/Heading.vue";
import HelpText from "@/components/Help/HelpText.vue";
import HistoryCardList from "@/components/History/HistoryCardList.vue";
import LoadingSpan from "@/components/LoadingSpan.vue";
import ProjectHistoryDialog from "@/components/Projects/ProjectHistoryDialog.vue";
import ProjectTreeNode from "@/components/Projects/ProjectTreeNode.vue";
import UtcDate from "@/components/UtcDate.vue";
import WorkflowCardList from "@/components/Workflow/List/WorkflowCardList.vue";

interface ProjectInvocation {
    invocation: WorkflowInvocation;
    historyName: string;
    historyProjects: string[];
    workflowName: string;
    workflowProjects: string[];
    /** How this invocation landed in the selected project. */
    via: "history" | "workflow" | "both";
}

const props = defineProps<{
    /** Project path to select, from the `?path=` query */
    path?: string;
}>();

const router = useRouter();
const userStore = useUserStore();
const workflowStore = useWorkflowStore();

const projectStore = useProjectStore();
const {
    histories,
    workflows,
    historyProjects,
    workflowProjects,
    projectPaths,
    error: errorMessage,
} = storeToRefs(projectStore);
// Only the first load replaces the page with a spinner; a refresh after a card edit keeps the cards up.
const initialLoading = computed(() => !projectStore.loaded && !projectStore.error);
const selectedPath = ref<string | undefined>(props.path);
const includeSubprojects = ref(true);

const invocationsLoading = ref(false);
const invocationError = ref<string>();
const invocations = ref<ProjectInvocation[]>([]);
let invocationGeneration = 0;

const tree = computed(() => buildProjectTree(projectPaths.value));

/** Histories plus workflows tagged with exactly each path, for the tree labels. */
const exactCounts = computed(() => {
    const counts: Record<string, number> = {};
    for (const paths of [...historyProjects.value.values(), ...workflowProjects.value.values()]) {
        for (const path of paths) {
            counts[path] = (counts[path] ?? 0) + 1;
        }
    }
    return counts;
});

function inScope(paths: string[]): boolean {
    const selected = selectedPath.value;
    if (!selected) {
        return false;
    }
    return paths.some((path) => (includeSubprojects.value ? isWithinProject(path, selected) : path === selected));
}

// The store asks for `keys=username`, which is what makes these the user's own histories to the cards.
const selectedHistories = computed(
    () => histories.value.filter((h) => inScope(historyProjects.value.get(h.id) ?? [])) as MyHistory[],
);
const selectedWorkflows = computed(() =>
    workflows.value.filter((w) => inScope(workflowProjects.value.get(w.id) ?? [])),
);

/** Hand-off links to the full lists. Those match one tag exactly, so subprojects never come along. */
function listLink(listPath: string, tagLists: Iterable<string[] | null | undefined>) {
    const tag = exactProjectTag(tagLists, selectedPath.value ?? "");
    return `${listPath}?filter=${encodeURIComponent(tagListFilter(tag))}`;
}
const historyListLink = computed(() =>
    listLink(
        "/histories/list",
        histories.value.map((h) => h.tags),
    ),
);
const workflowListLink = computed(() =>
    listLink(
        "/workflows/list",
        workflows.value.map((w) => w.tags),
    ),
);
const listLinkNote = computed(() =>
    includeSubprojects.value ? `Only items tagged exactly project:${selectedPath.value}, without subprojects` : "",
);

const breadcrumbItems = computed(() => {
    const items = [{ title: "Projects", to: "/projects" }];
    if (selectedPath.value) {
        let prefix = "";
        for (const segment of selectedPath.value.split("/")) {
            prefix = prefix ? `${prefix}/${segment}` : segment;
            items.push({ title: segment, to: `/projects?path=${encodeURIComponent(prefix)}` });
        }
    }
    return items;
});

async function fetchInvocations(query: { history_id?: string; workflow_id?: string }) {
    const { data, error } = await GalaxyApi().GET("/api/invocations", {
        params: {
            query: { ...query, limit: 100, include_nested_invocations: false, sort_by: "create_time", sort_desc: true },
        },
    });
    if (error) {
        throw error;
    }
    return data as WorkflowInvocation[];
}

/** Invocations reach a project through their history or through their (stored) workflow. */
async function loadInvocations() {
    const generation = ++invocationGeneration;
    invocations.value = [];
    invocationError.value = undefined;
    if (!selectedPath.value || !projectStore.loaded) {
        invocationsLoading.value = false;
        return;
    }
    invocationsLoading.value = true;
    try {
        const pages = await Promise.all([
            ...selectedHistories.value.map((h) => fetchInvocations({ history_id: h.id })),
            ...selectedWorkflows.value.map((w) => fetchInvocations({ workflow_id: w.id })),
        ]);
        const byId = new Map<string, WorkflowInvocation>();
        pages.flat().forEach((invocation) => byId.set(invocation.id, invocation));
        const rows = await Promise.all([...byId.values()].map(describeInvocation));
        rows.sort((a, b) => b.invocation.create_time.localeCompare(a.invocation.create_time));
        if (generation === invocationGeneration) {
            invocations.value = rows;
        }
    } catch (error) {
        if (generation === invocationGeneration) {
            invocationError.value = errorMessageAsString(error);
        }
    } finally {
        if (generation === invocationGeneration) {
            invocationsLoading.value = false;
        }
    }
}

async function describeInvocation(invocation: WorkflowInvocation): Promise<ProjectInvocation> {
    const history = histories.value.find((h) => h.id === invocation.history_id);
    const historyPaths = history ? (historyProjects.value.get(history.id) ?? []) : [];
    // `invocation.workflow_id` is a workflow *instance* id; resolve it to the stored workflow.
    // One workflow that can't be resolved should not hide every other invocation.
    try {
        await workflowStore.fetchWorkflowForInstanceIdCached(invocation.workflow_id);
    } catch {
        // shown as "(unknown workflow)" below
    }
    const stored = workflowStore.getStoredWorkflowByInstanceId(invocation.workflow_id);
    const storedId = stored?.id;
    const workflowPaths = storedId ? (workflowProjects.value.get(storedId) ?? projectPathsOf(stored?.tags)) : [];
    const viaHistory = inScope(historyPaths);
    const viaWorkflow = inScope(workflowPaths);
    return {
        invocation,
        historyName: history?.name ?? "(history not in a project)",
        historyProjects: historyPaths,
        workflowName: stored?.name ?? "(unknown workflow)",
        workflowProjects: workflowPaths,
        via: viaHistory && viaWorkflow ? "both" : viaHistory ? "history" : "workflow",
    };
}

function selectProject(path?: string) {
    selectedPath.value = path;
    router.push({ path: "/projects", query: path ? { path } : {} });
}

/** A project tag selects that project here; any other tag hands off to the full list, filtered by it. */
function onTagClick(listPath: string, tag: string) {
    const [path] = projectPathsOf([tag]);
    if (path) {
        selectProject(path);
    } else {
        router.push(`${listPath}?filter=${encodeURIComponent(tagListFilter(tag))}`);
    }
}

/** The cards ask for a refresh after a tag edit or rename, which may move items between projects. */
function onCardsChanged() {
    projectStore.refresh();
}

const historyDialog = ref({ show: false, parentPath: undefined as string | undefined, newProject: false });

function openHistoryDialog(parentPath: string | undefined, newProject: boolean) {
    historyDialog.value = { show: true, parentPath, newProject };
}

watch(
    () => props.path,
    (path) => {
        selectedPath.value = path;
    },
);
// The store replaces both lists on every (re)load, so this also follows refreshes.
watch([selectedPath, includeSubprojects, histories, workflows], () => loadInvocations());

// The store resets itself when the user changes; load the new user's projects.
watch(
    () => userStore.currentUser,
    () => projectStore.fetch(),
);

onMounted(async () => {
    if (projectStore.loaded) {
        loadInvocations();
    } else {
        await projectStore.fetch();
    }
});
</script>

<template>
    <div id="projects-view" class="overflow-auto d-flex flex-column">
        <BreadcrumbHeading :items="breadcrumbItems">
            <GButton
                v-if="!userStore.isAnonymous"
                size="small"
                color="blue"
                outline
                data-description="new project"
                @click="openHistoryDialog(undefined, true)">
                <FontAwesomeIcon :icon="faPlus" />
                New project
            </GButton>
        </BreadcrumbHeading>
        <GAlert v-if="userStore.isAnonymous" variant="warning" show>Log in to see your projects.</GAlert>
        <GAlert v-else-if="errorMessage" id="projects-error" variant="danger" show>
            <p class="mb-2">Failed to load projects: {{ errorMessage }}</p>
            <GButton size="small" @click="projectStore.refresh()">Try again</GButton>
        </GAlert>
        <GAlert v-else-if="initialLoading" variant="info" show>
            <LoadingSpan message="Loading projects" />
        </GAlert>
        <GAlert v-else-if="tree.length === 0" id="projects-empty" variant="info" show>
            No projects yet. Tag a history or workflow with <code>project:name</code> (use <code>/</code> to nest, e.g.
            <code>project:lung/scrna</code>) and it will show up here.
        </GAlert>
        <div v-else class="d-flex flex-row flex-grow-1">
            <div class="project-tree pr-3 mr-3 border-right">
                <Heading h2 size="sm" separator>Projects ({{ countNodes(tree) }})</Heading>
                <ul class="list-unstyled">
                    <ProjectTreeNode
                        v-for="node in tree"
                        :key="node.path"
                        :node="node"
                        :selected-path="selectedPath"
                        :counts="exactCounts"
                        @select="selectProject">
                        <template v-slot:actions="{ node: actionNode }">
                            <GButton
                                icon-only
                                transparent
                                size="small"
                                tooltip
                                :title="`New subproject of ${actionNode.path}`"
                                :data-new-subproject="actionNode.path"
                                @click="openHistoryDialog(actionNode.path, true)">
                                <FontAwesomeIcon :icon="faPlus" />
                            </GButton>
                        </template>
                    </ProjectTreeNode>
                </ul>
            </div>
            <div class="project-details flex-grow-1">
                <p v-if="!selectedPath" class="text-muted">
                    Select a project to see its histories, workflows and invocations.
                </p>
                <template v-else>
                    <div class="d-flex align-items-center mb-2">
                        <Heading h2 size="md" class="mb-0">
                            <FontAwesomeIcon :icon="faFolderOpen" fixed-width />
                            {{ selectedPath }}
                        </Heading>
                        <LoadingSpan v-if="projectStore.loading" class="ml-2 small" message="Refreshing" />
                        <GButton
                            class="ml-2"
                            size="small"
                            color="blue"
                            outline
                            data-description="new history in project"
                            @click="openHistoryDialog(selectedPath, false)">
                            <FontAwesomeIcon :icon="faPlus" />
                            New history in this project
                        </GButton>
                        <label class="ml-auto mb-0 small">
                            <input v-model="includeSubprojects" type="checkbox" class="mr-1" />
                            Include subprojects
                        </label>
                    </div>

                    <section data-project-histories>
                        <Heading h3 size="sm" separator>Histories ({{ selectedHistories.length }})</Heading>
                        <GAlert v-if="selectedHistories.length === 0" variant="info" show>
                            No histories in this project.
                        </GAlert>
                        <HistoryCardList
                            v-else
                            :histories="selectedHistories"
                            @tagClick="(tag: string) => onTagClick('/histories/list', tag)"
                            @refreshList="onCardsChanged" />
                        <p class="small mt-1">
                            <GLink :to="historyListLink" :title="listLinkNote" data-project-history-list-link>
                                Show all in Histories list
                            </GLink>
                            <span v-if="listLinkNote" class="text-muted">(exact tag only, no subprojects)</span>
                        </p>
                    </section>

                    <section data-project-workflows>
                        <Heading h3 size="sm" separator>Workflows ({{ selectedWorkflows.length }})</Heading>
                        <GAlert v-if="selectedWorkflows.length === 0" variant="info" show>
                            No workflows in this project.
                        </GAlert>
                        <WorkflowCardList
                            v-else
                            :workflows="selectedWorkflows"
                            :selectable="false"
                            :filterable="false"
                            @tagClick="(tag: string) => onTagClick('/workflows/list', tag)"
                            @refreshList="onCardsChanged" />
                        <p class="small mt-1">
                            <GLink :to="workflowListLink" :title="listLinkNote" data-project-workflow-list-link>
                                Show all in Workflows list
                            </GLink>
                            <span v-if="listLinkNote" class="text-muted">(exact tag only, no subprojects)</span>
                        </p>
                    </section>

                    <section data-project-invocations>
                        <Heading h3 size="sm" separator>
                            Invocations<template v-if="!invocationsLoading"> ({{ invocations.length }})</template>
                        </Heading>
                        <GAlert v-if="invocationsLoading" variant="info" show>
                            <LoadingSpan message="Loading invocations" />
                        </GAlert>
                        <GAlert v-else-if="invocationError" variant="danger" show>
                            Failed to load invocations: {{ invocationError }}
                        </GAlert>
                        <GAlert v-else-if="invocations.length === 0" variant="info" show>
                            No invocations in this project's histories or of this project's workflows.
                        </GAlert>
                        <table v-else class="table table-sm project-items">
                            <thead>
                                <tr>
                                    <th>Workflow</th>
                                    <th>History</th>
                                    <th>State</th>
                                    <th>Invoked</th>
                                    <th>In this project via</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr v-for="row in invocations" :key="row.invocation.id" data-project-invocation>
                                    <td>
                                        <GLink :to="`/workflows/invocations/${row.invocation.id}`">{{
                                            row.workflowName
                                        }}</GLink>
                                    </td>
                                    <td>
                                        <GLink :to="`/histories/view?id=${row.invocation.history_id}`">{{
                                            row.historyName
                                        }}</GLink>
                                    </td>
                                    <td>
                                        <HelpText
                                            :uri="`galaxy.invocations.states.${row.invocation.state}`"
                                            :text="row.invocation.state" />
                                    </td>
                                    <td><UtcDate :date="row.invocation.create_time" mode="elapsed" /></td>
                                    <td>
                                        <span v-if="row.via === 'both'">history and workflow</span>
                                        <span v-else-if="row.via === 'history'">
                                            history
                                            <span class="text-muted small">
                                                (workflow is in
                                                {{
                                                    row.workflowProjects.length
                                                        ? row.workflowProjects.join(", ")
                                                        : "no project"
                                                }})
                                            </span>
                                        </span>
                                        <span v-else>
                                            workflow
                                            <span class="text-muted small">
                                                (history is in
                                                {{
                                                    row.historyProjects.length
                                                        ? row.historyProjects.join(", ")
                                                        : "no project"
                                                }})
                                            </span>
                                        </span>
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </section>
                </template>
            </div>
        </div>
        <ProjectHistoryDialog
            v-model:show="historyDialog.show"
            :parent-path="historyDialog.parentPath"
            :new-project="historyDialog.newProject"
            @created="selectProject" />
    </div>
</template>

<style scoped lang="scss">
.project-tree {
    min-width: 16rem;
}
</style>
