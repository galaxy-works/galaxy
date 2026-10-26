/**
 * Actions that put things into tag-based projects. A project only exists through
 * `project:<path>` tags, so every action here boils down to editing history tags.
 */
import { useHistoryStore } from "@/stores/historyStore";
import { useProjectStore } from "@/stores/projectStore";
import { updateHistoryFields } from "@/stores/services/history.services";

import { normalizeProjectPath, PROJECT_TAG_NAME, projectPathsOf, projectTag } from "./projectTags";

export const DEFAULT_HISTORY_NAME = "Unnamed history";

function isProjectTag(tag: string): boolean {
    const separator = tag.indexOf(":");
    return separator >= 0 && tag.slice(0, separator).toLowerCase() === PROJECT_TAG_NAME;
}

/**
 * Returns `tags` with `project:<path>` added. With `move`, every other project tag is dropped.
 * Leaves the list alone when it already carries the path (in any case or spacing).
 */
export function withProjectTag(tags: string[] | undefined | null, path: string, move = false): string[] {
    const normalized = normalizeProjectPath(path);
    const kept = (tags ?? []).filter((tag) => !move || !isProjectTag(tag) || projectPathsOf([tag])[0] === normalized);
    if (projectPathsOf(kept).includes(normalized)) {
        return kept;
    }
    return [...kept, projectTag(normalized)];
}

/** Joins a parent project path and a new child name into one normalized path. */
export function childProjectPath(parentPath: string | undefined, name: string): string {
    return normalizeProjectPath(parentPath ? `${parentPath}/${name}` : name);
}

export interface TaggedHistory {
    id: string;
    tags?: string[] | null;
}

export function useProjectActions() {
    const historyStore = useHistoryStore();
    const projectStore = useProjectStore();

    /**
     * Creates a history tagged with the project, makes it current, and returns its id.
     * This is also how a new (sub)project comes into being.
     */
    async function createHistoryInProject(path: string, name?: string): Promise<string> {
        const normalized = normalizeProjectPath(path);
        if (!normalized) {
            throw new Error("A project path is required.");
        }
        await historyStore.createNewHistory(name?.trim() || DEFAULT_HISTORY_NAME);
        const historyId = historyStore.currentHistoryId;
        if (!historyId) {
            throw new Error("The new history could not be found.");
        }
        try {
            await historyStore.updateHistory(historyId, { tags: [projectTag(normalized)] });
        } finally {
            await projectStore.refresh();
        }
        return historyId;
    }

    /**
     * Tags each history with the project, one request at a time like the bulk tag action.
     * With `move`, the histories' other project tags are dropped.
     */
    async function addHistoriesToProject(histories: TaggedHistory[], path: string, move = false): Promise<void> {
        const normalized = normalizeProjectPath(path);
        if (!normalized) {
            throw new Error("A project path is required.");
        }
        try {
            for (const history of histories) {
                const current = history.tags ?? [];
                const tags = withProjectTag(current, normalized, move);
                if (tags.length !== current.length || tags.some((tag, index) => tag !== current[index])) {
                    await updateHistoryFields(history.id, { tags });
                }
            }
        } finally {
            await projectStore.refresh();
        }
    }

    return { createHistoryInProject, addHistoriesToProject };
}
