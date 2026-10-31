import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";

import { useProjectContextStore } from "@/stores/projectContextStore";

describe("projectContextStore", () => {
    beforeEach(() => {
        setActivePinia(createPinia());
    });

    it("starts with tags shown as tags and no current project", () => {
        const store = useProjectContextStore();
        expect(store.projectsAsField).toBe(false);
        expect(store.currentProject).toBeNull();
        expect(store.hasCurrentProject).toBe(false);
        expect(store.currentProjectFilter).toBe("");
        expect(store.isInCurrentProject("anything")).toBe(true);
    });

    it("normalizes the current project and builds the scope filter from it", () => {
        const store = useProjectContextStore();
        store.setCurrentProject(" Lung/SCRNA/ ");
        expect(store.currentProject).toBe("lung/scrna");
        expect(store.currentProjectFilter).toBe("tag:project:lung/scrna");
        store.includeSubprojects = false;
        expect(store.currentProjectFilter).toBe("tag:'project:lung/scrna'");
    });

    it("tells subprojects apart from siblings with the same prefix", () => {
        const store = useProjectContextStore();
        store.setCurrentProject("lung");
        expect(store.isInCurrentProject("lung")).toBe(true);
        expect(store.isInCurrentProject("lung/scrna")).toBe(true);
        expect(store.isInCurrentProject("lungs")).toBe(false);
        store.includeSubprojects = false;
        expect(store.isInCurrentProject("lung/scrna")).toBe(false);
    });

    it("treats an empty or blank path as clearing the project", () => {
        const store = useProjectContextStore();
        store.setCurrentProject("lung");
        store.setCurrentProject("  ");
        expect(store.currentProject).toBeNull();
        store.setCurrentProject("lung");
        store.clearCurrentProject();
        expect(store.hasCurrentProject).toBe(false);
    });

    it("keeps the stored path a string so it survives a reload", () => {
        // The local storage sync parses what it finds by the type of the ref's current value;
        // a null here would make it JSON-parse "lung" and reset the key.
        const store = useProjectContextStore();
        expect(store.currentProjectPath).toBe("");
        store.currentProject = "lung";
        expect(store.currentProjectPath).toBe("lung");
        expect(store.currentProject).toBe("lung");
        store.currentProject = null;
        expect(store.currentProjectPath).toBe("");
    });
});
