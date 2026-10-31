import { createTestingPinia } from "@pinia/testing";
import { setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Toast } from "@/composables/toast";
import { useHistoryStore } from "@/stores/historyStore";
import { useProjectContextStore } from "@/stores/projectContextStore";
import { useProjectStore } from "@/stores/projectStore";
import { updateHistoryFields } from "@/stores/services/history.services";

import { useNewHistoryProject } from "./useNewHistoryProject";

vi.mock("@/composables/toast");
vi.mock("@/stores/services/history.services", () => ({ updateHistoryFields: vi.fn() }));

function setup({ asField = true, currentProject = null as string | null, currentHistoryTags = [] as string[] } = {}) {
    setActivePinia(createTestingPinia({ createSpy: vi.fn }));
    const contextStore = useProjectContextStore();
    contextStore.projectsAsField = asField;
    contextStore.currentProject = currentProject;
    const historyStore = useHistoryStore();
    // @ts-expect-error: getters are writable under createTestingPinia
    historyStore.currentHistory = { id: "current", tags: currentHistoryTags };
    return { ...useNewHistoryProject(), projectStore: useProjectStore() };
}

describe("useNewHistoryProject", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("defaults to the current project, then the current history's project, then nothing", () => {
        expect(setup({ currentProject: "lung", currentHistoryTags: ["project:brain"] }).newHistoryProject.value).toBe(
            "lung",
        );
        expect(setup({ currentHistoryTags: ["qc", "project:Brain/MRI"] }).newHistoryProject.value).toBe("brain/mri");
        expect(setup().newHistoryProject.value).toBe("");
    });

    it("keeps a path the user picked, even an empty one", () => {
        const { newHistoryProject } = setup({ currentProject: "lung" });
        newHistoryProject.value = "";
        expect(newHistoryProject.value).toBe("");
        newHistoryProject.value = "spatial";
        expect(newHistoryProject.value).toBe("spatial");
    });

    it("tags each new history once and refreshes the projects", async () => {
        const { tagNewHistories, projectStore } = setup({ currentProject: "lung" });

        await tagNewHistories([
            { id: "i1", history_id: "new1" },
            { id: "i2", history_id: "new1" },
            { id: "i3", history_id: "new2" },
        ]);

        expect(vi.mocked(updateHistoryFields).mock.calls).toEqual([
            ["new1", { tags: ["project:lung"] }],
            ["new2", { tags: ["project:lung"] }],
        ]);
        expect(projectStore.refresh).toHaveBeenCalledTimes(1);
    });

    it("still inherits the current project while projects are shown as tags", async () => {
        await setup({ asField: false, currentProject: "lung", currentHistoryTags: ["project:brain"] }).tagNewHistories([
            { history_id: "new1" },
        ]);

        expect(vi.mocked(updateHistoryFields).mock.calls).toEqual([["new1", { tags: ["project:lung"] }]]);
    });

    it("does nothing without a project, and ignores the current history's project while projects are tags", async () => {
        await setup().tagNewHistories([{ history_id: "new1" }]);
        await setup({ asField: false, currentHistoryTags: ["project:brain"] }).tagNewHistories([
            { history_id: "new1" },
        ]);

        expect(updateHistoryFields).not.toHaveBeenCalled();
    });

    it("only warns when tagging fails", async () => {
        vi.mocked(updateHistoryFields).mockRejectedValueOnce(new Error("boom"));
        const { tagNewHistories, projectStore } = setup({ currentProject: "lung" });

        await expect(tagNewHistories([{ history_id: "new1" }])).resolves.toBeUndefined();

        expect(Toast.warning).toHaveBeenCalledWith(expect.stringContaining("could not be added to project lung"));
        expect(projectStore.refresh).toHaveBeenCalled();
    });
});
