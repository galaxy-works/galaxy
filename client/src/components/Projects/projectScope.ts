/**
 * Scoping lists to the browser-wide current project. The scope term is kept out of a list's own
 * filter text, so the FilterMenu keeps showing only what the user typed; the two are joined only
 * when the request is built.
 */
import { computed, type Ref, ref } from "vue";

import { useProjectContextStore } from "@/stores/projectContextStore";

import { projectPathsOf } from "./projectTags";

/** Joins filter terms with a space, dropping empty ones. */
export function joinFilterText(...terms: Array<string | null | undefined>): string {
    return terms
        .map((term) => term?.trim())
        .filter(Boolean)
        .join(" ");
}

/**
 * The current project's scope for a list. `applies` turns it off for views it makes no sense in,
 * e.g. published or archived items.
 */
export function useProjectScope(applies: Ref<boolean> = ref(true)) {
    const store = useProjectContextStore();

    const scopeFilter = computed(() => (applies.value ? store.currentProjectFilter : ""));

    function withScope(text: string): string {
        return joinFilterText(scopeFilter.value, text);
    }

    /** True when a tag list carries a project inside the current one, or when nothing is scoped. */
    function inScope(tags: string[] | null | undefined): boolean {
        if (!applies.value || !store.currentProject) {
            return true;
        }
        return projectPathsOf(tags).some((path) => store.isInCurrentProject(path));
    }

    return { scopeFilter, withScope, inScope };
}
