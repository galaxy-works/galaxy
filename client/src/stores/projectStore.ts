/**
 * Project-tagged histories and workflows for the tags-only Projects view. Kept in a store
 * so navigating away from /projects and back reuses the lists instead of refetching them.
 */
import { defineStore } from "pinia";
import { computed, ref } from "vue";

import { GalaxyApi, type HistorySummary } from "@/api";
import type { WorkflowSummary } from "@/api/workflows";
import { projectPathsOf, projectTag } from "@/components/Projects/projectTags";
import { errorMessageAsString } from "@/utils/simple-error";

/** Everything tagged `project:<anything>`: the raw search term matches on tag name only. */
const PROJECT_SEARCH = projectTag("");

export const useProjectStore = defineStore("projectStore", () => {
    const histories = ref<HistorySummary[]>([]);
    const workflows = ref<WorkflowSummary[]>([]);
    const loading = ref(false);
    const loaded = ref(false);
    const error = ref<string>();

    const historyProjects = computed(() => new Map(histories.value.map((h) => [h.id, projectPathsOf(h.tags)])));
    const workflowProjects = computed(() => new Map(workflows.value.map((w) => [w.id, projectPathsOf(w.tags)])));
    /** Every project path tagged on at least one history or workflow, without duplicates. */
    const projectPaths = computed(() => [
        ...new Set([...historyProjects.value.values(), ...workflowProjects.value.values()].flat()),
    ]);

    let pending: Promise<void> | undefined;
    // Bumped per load so a slow response from an earlier refresh can't overwrite a newer one.
    let generation = 0;

    function start() {
        const request = load().finally(() => {
            if (pending === request) {
                pending = undefined;
            }
        });
        pending = request;
        return request;
    }

    async function load() {
        const requestGeneration = ++generation;
        loading.value = true;
        error.value = undefined;
        try {
            const [historyResult, workflowResult] = await Promise.all([
                GalaxyApi().GET("/api/histories", {
                    params: {
                        query: {
                            view: "summary",
                            search: PROJECT_SEARCH,
                            show_own: true,
                            show_published: false,
                            show_shared: false,
                            sort_by: "update_time",
                            sort_desc: true,
                        },
                    },
                }),
                GalaxyApi().GET("/api/workflows", {
                    params: {
                        query: {
                            search: PROJECT_SEARCH,
                            show_published: false,
                            show_shared: false,
                            skip_step_counts: true,
                            sort_by: "update_time",
                            sort_desc: true,
                        },
                    },
                }),
            ]);
            if (requestGeneration !== generation) {
                return;
            }
            const failure = historyResult.error ?? workflowResult.error;
            if (failure) {
                error.value = errorMessageAsString(failure);
                loaded.value = false;
                return;
            }
            // The raw search term also matches item *names* containing "project:", so filter on the tags themselves.
            histories.value = (historyResult.data as HistorySummary[]).filter((h) => projectPathsOf(h.tags).length > 0);
            workflows.value = (workflowResult.data as unknown as WorkflowSummary[]).filter(
                (w) => projectPathsOf(w.tags).length > 0,
            );
            loaded.value = true;
        } catch (e) {
            if (requestGeneration === generation) {
                error.value = errorMessageAsString(e);
                loaded.value = false;
            }
        } finally {
            if (requestGeneration === generation) {
                loading.value = false;
            }
        }
    }

    /** Loads the lists unless they are already loaded; concurrent callers share one request. */
    async function fetch() {
        if (loaded.value) {
            return;
        }
        return pending ?? start();
    }

    /** Reloads the lists, e.g. after tags changed elsewhere. */
    async function refresh() {
        return start();
    }

    return {
        histories,
        workflows,
        historyProjects,
        workflowProjects,
        projectPaths,
        loading,
        loaded,
        error,
        fetch,
        refresh,
    };
});
