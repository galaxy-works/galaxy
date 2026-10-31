/**
 * The project a workflow run's new history goes into, for the run forms while projects are
 * treated as a field. The invocation API can't tag the history it creates, so the tag is added
 * once the run has been submitted and the new history's id is known.
 */
import { storeToRefs } from "pinia";
import { computed, ref } from "vue";

import { Toast } from "@/composables/toast";
import { useHistoryStore } from "@/stores/historyStore";
import { useProjectContextStore } from "@/stores/projectContextStore";
import { useProjectStore } from "@/stores/projectStore";
import { updateHistoryFields } from "@/stores/services/history.services";
import { errorMessageAsString } from "@/utils/simple-error";

import { projectPathsOf } from "./projectTags";
import { withProjectTag } from "./useProjectActions";

export function useNewHistoryProject() {
    const projectContextStore = useProjectContextStore();
    const { projectsAsField } = storeToRefs(projectContextStore);
    const historyStore = useHistoryStore();
    const projectStore = useProjectStore();

    const defaultProject = computed(
        () => projectContextStore.currentProject ?? projectPathsOf(historyStore.currentHistory?.tags)[0] ?? "",
    );
    // Follows the default (the current history may still be loading) until the user picks something.
    const chosenProject = ref<string>();
    const newHistoryProject = computed({
        get: () => chosenProject.value ?? defaultProject.value,
        set: (path: string) => {
            chosenProject.value = path;
        },
    });

    /**
     * Tags the histories the submitted run created with the chosen project. Never throws: the
     * run itself has already succeeded, so a failure here is only a warning.
     */
    async function tagNewHistories(invocations: unknown) {
        const path = newHistoryProject.value;
        if (!projectsAsField.value || !path) {
            return;
        }
        const list = (Array.isArray(invocations) ? invocations : [invocations]) as { history_id?: string }[];
        const historyIds = [...new Set(list.map((invocation) => invocation?.history_id).filter(Boolean))] as string[];
        if (historyIds.length === 0) {
            return;
        }
        try {
            for (const historyId of historyIds) {
                const tags = historyStore.getHistoryById(historyId, false)?.tags ?? [];
                await updateHistoryFields(historyId, { tags: withProjectTag(tags, path) });
            }
        } catch (error) {
            Toast.warning(
                `The workflow was submitted, but its new history could not be added to project ${path}: ${errorMessageAsString(error)}`,
            );
        }
        await projectStore.refresh();
    }

    return { projectsAsField, newHistoryProject, tagNewHistories };
}
