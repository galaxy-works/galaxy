/**
 * The user's project context, kept apart from the project lists in projectStore.
 *
 * Two things live here. `projectsAsField` switches the UI from showing `project:` as an ordinary
 * tag to treating it as a reserved "Project" field (badges instead of chips, project bars on the
 * lists, a picker on the run form). `currentProject` scopes the whole client to one project: the
 * lists, the switch-history dialog and the invocations grid filter to it, and new work is tagged
 * with it. Both persist per user in local storage, so they survive a reload but never reach the
 * server.
 */
import { defineStore } from "pinia";
import { computed } from "vue";

import { normalizeProjectPath, projectScopeFilter } from "@/components/Projects/projectTags";
import { useUserLocalStorage } from "@/composables/userLocalStorage";

export const useProjectContextStore = defineStore("projectContextStore", () => {
    const projectsAsField = useUserLocalStorage<boolean>("projects-as-field", false);
    // Stored as a string with "" for none: the local storage sync parses a stored value by the
    // type of the ref's current value, and a null initial value would make it try JSON on "lung".
    const currentProjectPath = useUserLocalStorage<string>("current-project", "");
    const includeSubprojects = useUserLocalStorage<boolean>("current-project-include-subprojects", true);

    const currentProject = computed<string | null>({
        get: () => currentProjectPath.value || null,
        set: (path) => setCurrentProject(path),
    });

    const hasCurrentProject = computed(() => Boolean(currentProject.value));

    /** The list filter term for the current project, or an empty string when none is set. */
    const currentProjectFilter = computed(() =>
        currentProject.value ? projectScopeFilter(currentProject.value, includeSubprojects.value) : "",
    );

    function setCurrentProject(path: string | null | undefined) {
        currentProjectPath.value = path ? normalizeProjectPath(path) : "";
    }

    function clearCurrentProject() {
        currentProjectPath.value = "";
    }

    /** True when `path` falls inside the current project (or there is no current project). */
    function isInCurrentProject(path: string): boolean {
        if (!currentProject.value) {
            return true;
        }
        const scope = currentProject.value;
        return includeSubprojects.value ? path === scope || path.startsWith(`${scope}/`) : path === scope;
    }

    return {
        projectsAsField,
        currentProjectPath,
        currentProject,
        includeSubprojects,
        hasCurrentProject,
        currentProjectFilter,
        setCurrentProject,
        clearCurrentProject,
        isInCurrentProject,
    };
});
