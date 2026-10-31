/**
 * Project-tagged histories and workflows for the tags-only Projects view. Kept in a store
 * so navigating away from /projects and back reuses the lists instead of refetching them.
 *
 * A project is each owner's own tag, but the view also takes in items other users shared with
 * this user under the same path. Those are kept in their own lists: sharing stays per item, and
 * nothing here may offer to retag them.
 */
import { defineStore } from "pinia";
import { computed, ref, watch } from "vue";

import { GalaxyApi, type HistorySummary, isRegisteredUser } from "@/api";
import type { WorkflowSummary } from "@/api/workflows";
import { projectPathsOf, projectTag } from "@/components/Projects/projectTags";
import { useUserStore } from "@/stores/userStore";
import { errorMessageAsString } from "@/utils/simple-error";

/** Everything tagged `project:<anything>`: the raw search term matches on tag name only. */
const PROJECT_SEARCH = projectTag("");

/** The raw search term also matches item *names* containing "project:", so filter on the tags themselves. */
function withProjects<T extends { tags?: string[] | null }>(items: T[]): T[] {
    return items.filter((item) => projectPathsOf(item.tags).length > 0);
}

export const useProjectStore = defineStore("projectStore", () => {
    /** The user's own project-tagged histories and workflows. */
    const histories = ref<HistorySummary[]>([]);
    const workflows = ref<WorkflowSummary[]>([]);
    /** Project-tagged histories and workflows other users shared with this user. */
    const sharedHistories = ref<HistorySummary[]>([]);
    const sharedWorkflows = ref<WorkflowSummary[]>([]);
    const loading = ref(false);
    const loaded = ref(false);
    const error = ref<string>();
    /** Set when only the shared half failed; the own lists are still good. */
    const sharedError = ref<string>();

    const historyProjects = computed(
        () => new Map([...histories.value, ...sharedHistories.value].map((h) => [h.id, projectPathsOf(h.tags)])),
    );
    const workflowProjects = computed(
        () => new Map([...workflows.value, ...sharedWorkflows.value].map((w) => [w.id, projectPathsOf(w.tags)])),
    );
    const sharedHistoryIds = computed(() => new Set(sharedHistories.value.map((h) => h.id)));
    const sharedWorkflowIds = computed(() => new Set(sharedWorkflows.value.map((w) => w.id)));
    /** Every project path tagged on at least one own or shared history or workflow, without duplicates. */
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
        sharedError.value = undefined;
        try {
            const [historyResult, workflowResult, sharedResult] = await Promise.all([
                GalaxyApi().GET("/api/histories", {
                    params: {
                        query: {
                            view: "summary",
                            // HistoryCard only offers owner actions on entries that carry a username.
                            keys: "username",
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
                loadShared(),
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
            histories.value = withProjects(historyResult.data as HistorySummary[]);
            workflows.value = withProjects(workflowResult.data as unknown as WorkflowSummary[]);
            if ("error" in sharedResult) {
                sharedError.value = sharedResult.error;
                sharedHistories.value = [];
                sharedWorkflows.value = [];
            } else {
                // Guards against the server ever handing back one of the user's own items as shared.
                const ownHistoryIds = new Set(histories.value.map((h) => h.id));
                const ownWorkflowIds = new Set(workflows.value.map((w) => w.id));
                sharedHistories.value = withProjects(sharedResult.histories).filter(
                    (h) =>
                        !ownHistoryIds.has(h.id) &&
                        !userStore.matchesCurrentUsername("username" in h ? String(h.username) : undefined),
                );
                sharedWorkflows.value = withProjects(sharedResult.workflows).filter(
                    (w) => !ownWorkflowIds.has(w.id) && !userStore.matchesCurrentUsername(w.owner),
                );
            }
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

    /** The shared half never rejects, so its failure can't take the user's own lists down with it. */
    async function loadShared(): Promise<
        { histories: HistorySummary[]; workflows: WorkflowSummary[] } | { error: string }
    > {
        try {
            const [historyResult, workflowResult] = await Promise.all([
                GalaxyApi().GET("/api/histories", {
                    params: {
                        query: {
                            view: "summary",
                            keys: "username",
                            search: PROJECT_SEARCH,
                            show_own: false,
                            show_published: false,
                            show_shared: true,
                            sort_by: "update_time",
                            sort_desc: true,
                        },
                    },
                }),
                GalaxyApi().GET("/api/workflows", {
                    params: {
                        query: {
                            // show_shared returns the user's own workflows too (and the server
                            // matches nothing when is:shared_with_me is combined with a raw term),
                            // so the owner check below is what separates the shared ones out.
                            search: PROJECT_SEARCH,
                            show_published: false,
                            show_shared: true,
                            skip_step_counts: true,
                            sort_by: "update_time",
                            sort_desc: true,
                        },
                    },
                }),
            ]);
            const failure = historyResult.error ?? workflowResult.error;
            if (failure) {
                return { error: errorMessageAsString(failure) };
            }
            return {
                histories: historyResult.data as HistorySummary[],
                workflows: workflowResult.data as unknown as WorkflowSummary[],
            };
        } catch (e) {
            return { error: errorMessageAsString(e) };
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

    /** Forgets the lists and drops any in-flight load, so the next fetch starts over. */
    function reset() {
        generation += 1;
        pending = undefined;
        histories.value = [];
        workflows.value = [];
        sharedHistories.value = [];
        sharedWorkflows.value = [];
        loading.value = false;
        loaded.value = false;
        error.value = undefined;
        sharedError.value = undefined;
    }

    // The lists are per user. Only a switch away from a known user resets; the first load of the
    // user at startup (no id yet -> id) must not throw away a fetch the page already started.
    const userStore = useUserStore();
    watch(
        () => (isRegisteredUser(userStore.currentUser) ? userStore.currentUser.id : undefined),
        (id, previous) => {
            if (previous !== undefined && id !== previous) {
                reset();
            }
        },
        { flush: "sync" },
    );

    return {
        histories,
        workflows,
        sharedHistories,
        sharedWorkflows,
        sharedHistoryIds,
        sharedWorkflowIds,
        historyProjects,
        workflowProjects,
        projectPaths,
        loading,
        loaded,
        error,
        sharedError,
        fetch,
        refresh,
        reset,
    };
});
