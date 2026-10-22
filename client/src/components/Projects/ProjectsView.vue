<script setup lang="ts">
/**
 * Spike: a client-only "Projects" page that is nothing more than a view over
 * `project:<path>` tags on the current user's histories and workflows. There is no
 * project model on the server; `/` in the tag value nests projects.
 */
import { faFolderOpen } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/vue-fontawesome";
import { storeToRefs } from "pinia";
import { computed, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";

import { GalaxyApi } from "@/api";
import type { WorkflowInvocation } from "@/api/invocations";
import { useProjectStore } from "@/stores/projectStore";
import { useUserStore } from "@/stores/userStore";
import { useWorkflowStore } from "@/stores/workflowStore";
import { errorMessageAsString } from "@/utils/simple-error";

import { buildProjectTree, countNodes, isWithinProject, projectPathsOf } from "./projectTags";

import GAlert from "@/components/BaseComponents/GAlert.vue";
import GLink from "@/components/BaseComponents/GLink.vue";
import BreadcrumbHeading from "@/components/Common/BreadcrumbHeading.vue";
import Heading from "@/components/Common/Heading.vue";
import LoadingSpan from "@/components/LoadingSpan.vue";
import ProjectTreeNode from "@/components/Projects/ProjectTreeNode.vue";
import StatelessTags from "@/components/TagsMultiselect/StatelessTags.vue";
import UtcDate from "@/components/UtcDate.vue";

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
// Mirrors the store, but also counts "not fetched yet" as loading so the first render shows the spinner.
const loading = computed(() => projectStore.loading || (!projectStore.loaded && !projectStore.error));
const selectedPath = ref<string | undefined>(props.path);
const includeSubprojects = ref(true);

const invocationsLoading = ref(false);
const invocationError = ref<string>();
const invocations = ref<ProjectInvocation[]>([]);

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

const selectedHistories = computed(() => histories.value.filter((h) => inScope(historyProjects.value.get(h.id) ?? [])));
const selectedWorkflows = computed(() =>
    workflows.value.filter((w) => inScope(workflowProjects.value.get(w.id) ?? [])),
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
    invocations.value = [];
    invocationError.value = undefined;
    if (!selectedPath.value) {
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
        invocations.value = rows;
    } catch (error) {
        invocationError.value = errorMessageAsString(error);
    } finally {
        invocationsLoading.value = false;
    }
}

async function describeInvocation(invocation: WorkflowInvocation): Promise<ProjectInvocation> {
    const history = histories.value.find((h) => h.id === invocation.history_id);
    const historyPaths = history ? (historyProjects.value.get(history.id) ?? []) : [];
    // `invocation.workflow_id` is a workflow *instance* id; resolve it to the stored workflow.
    await workflowStore.fetchWorkflowForInstanceIdCached(invocation.workflow_id);
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

function onTagClick(tag: string) {
    const [path] = projectPathsOf([tag]);
    if (path) {
        selectProject(path);
    }
}

watch(
    () => props.path,
    (path) => {
        selectedPath.value = path;
    },
);
watch([selectedPath, includeSubprojects, loading], () => loadInvocations());

onMounted(async () => {
    if (projectStore.loaded) {
        // Cached lists never flip `loading`, so the watch above will not load invocations for us.
        loadInvocations();
    } else {
        await projectStore.fetch();
    }
});
</script>

<template>
    <div id="projects-view" class="overflow-auto d-flex flex-column">
        <BreadcrumbHeading :items="breadcrumbItems" />
        <GAlert v-if="userStore.isAnonymous" variant="warning" show>Log in to see your projects.</GAlert>
        <GAlert v-else-if="errorMessage" variant="danger" show>{{ errorMessage }}</GAlert>
        <LoadingSpan v-else-if="loading" message="Loading projects" />
        <GAlert v-else-if="tree.length === 0" variant="info" show>
            No projects yet. Tag a history or workflow with <code>project:name</code> (use <code>/</code> to nest, e.g.
            <code>project:lung/scrna</code>) and it will show up here.
        </GAlert>
        <div v-else class="d-flex flex-row flex-grow-1">
            <div class="project-tree pr-3 mr-3 border-right" style="min-width: 16rem">
                <Heading h2 size="sm" separator>Projects ({{ countNodes(tree) }})</Heading>
                <ul class="list-unstyled">
                    <ProjectTreeNode
                        v-for="node in tree"
                        :key="node.path"
                        :node="node"
                        :selected-path="selectedPath"
                        :counts="exactCounts"
                        @select="selectProject" />
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
                        <label class="ml-auto mb-0 small">
                            <input v-model="includeSubprojects" type="checkbox" class="mr-1" />
                            Include subprojects
                        </label>
                    </div>

                    <Heading h3 size="sm" separator>Histories ({{ selectedHistories.length }})</Heading>
                    <p v-if="selectedHistories.length === 0" class="text-muted small">No histories in this project.</p>
                    <table v-else class="table table-sm project-items">
                        <thead>
                            <tr>
                                <th>Name</th>
                                <th>Items</th>
                                <th>Tags</th>
                                <th>Updated</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="history in selectedHistories" :key="history.id" data-project-history>
                                <td>
                                    <GLink :to="`/histories/view?id=${history.id}`">{{ history.name }}</GLink>
                                </td>
                                <td>{{ history.count }}</td>
                                <td>
                                    <StatelessTags :value="history.tags" disabled clickable @tag-click="onTagClick" />
                                </td>
                                <td><UtcDate :date="history.update_time" mode="elapsed" /></td>
                            </tr>
                        </tbody>
                    </table>

                    <Heading h3 size="sm" separator>Workflows ({{ selectedWorkflows.length }})</Heading>
                    <p v-if="selectedWorkflows.length === 0" class="text-muted small">No workflows in this project.</p>
                    <table v-else class="table table-sm project-items">
                        <thead>
                            <tr>
                                <th>Name</th>
                                <th>Tags</th>
                                <th>Updated</th>
                                <th></th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="workflow in selectedWorkflows" :key="workflow.id" data-project-workflow>
                                <td>
                                    <GLink :to="`/workflows/run?id=${workflow.id}`">{{ workflow.name }}</GLink>
                                </td>
                                <td>
                                    <StatelessTags :value="workflow.tags" disabled clickable @tag-click="onTagClick" />
                                </td>
                                <td><UtcDate :date="workflow.update_time" mode="elapsed" /></td>
                                <td class="text-right">
                                    <GLink :to="`/workflows/edit?id=${workflow.id}`" thin>Edit</GLink>
                                    <span class="text-muted"> | </span>
                                    <GLink :to="`/workflows/${workflow.id}/invocations`" thin>Invocations</GLink>
                                </td>
                            </tr>
                        </tbody>
                    </table>

                    <Heading h3 size="sm" separator>Invocations ({{ invocations.length }})</Heading>
                    <LoadingSpan v-if="invocationsLoading" message="Loading invocations" />
                    <GAlert v-else-if="invocationError" variant="danger" show>{{ invocationError }}</GAlert>
                    <p v-else-if="invocations.length === 0" class="text-muted small">
                        No invocations in this project's histories or of this project's workflows.
                    </p>
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
                                <td>{{ row.invocation.state }}</td>
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
                </template>
            </div>
        </div>
    </div>
</template>
