import { createTestingPinia } from "@pinia/testing";
import { setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useServerMock } from "@/api/client/__mocks__";
import { useHistoryStore } from "@/stores/historyStore";
import { useProjectStore } from "@/stores/projectStore";

import { childProjectPath, useProjectActions, withProjectTag } from "./useProjectActions";

const { server, http } = useServerMock();

function history(id: string, name: string, tags: string[]) {
    return { id, name, tags, model_class: "History", update_time: "2026-10-21T00:00:00", count: 0 };
}

let updates: { id: string; body: any }[];
let createdNames: (string | null)[];
let projectRequests: number;

beforeEach(() => {
    setActivePinia(createTestingPinia({ createSpy: vi.fn, stubActions: false }));
    updates = [];
    createdNames = [];
    projectRequests = 0;
    server.use(
        http.untyped.get("/history/create_new_current", ({ request }) => {
            const name = new URL(request.url).searchParams.get("name");
            createdNames.push(name);
            return Response.json(history("new1", name ?? "Unnamed history", []));
        }),
        http.get("/api/histories/count", ({ response }) => response(200).json(1)),
        http.put("/api/histories/{history_id}", async ({ params, request, response }) => {
            const body = (await request.json()) as any;
            updates.push({ id: params.history_id, body });
            return response(200).json(history(params.history_id, "Updated", body.tags) as any);
        }),
        http.get("/api/histories", ({ response }) => {
            projectRequests += 1;
            return response(200).json([]);
        }),
        http.get("/api/workflows", ({ response }) => response(200).json([])),
    );
});

describe("withProjectTag", () => {
    it("adds the project tag and keeps everything else", () => {
        expect(withProjectTag(["qc", "project:brain"], "Lung/ScRNA")).toEqual([
            "qc",
            "project:brain",
            "project:lung/scrna",
        ]);
    });

    it("does not add a project the tags already carry", () => {
        expect(withProjectTag(["project:Lung"], "lung")).toEqual(["project:Lung"]);
    });

    it("drops other project tags when moving", () => {
        expect(withProjectTag(["qc", "project:brain", "Project:old/x", "name:keep"], "lung", true)).toEqual([
            "qc",
            "name:keep",
            "project:lung",
        ]);
        expect(withProjectTag(["project:brain", "project:lung"], "lung", true)).toEqual(["project:lung"]);
    });
});

describe("childProjectPath", () => {
    it("joins and normalizes", () => {
        expect(childProjectPath("lung", " ScRNA ")).toBe("lung/scrna");
        expect(childProjectPath(undefined, "Brain/")).toBe("brain");
    });
});

describe("useProjectActions", () => {
    it("creates a current history tagged with the project and refreshes the projects", async () => {
        const { createHistoryInProject } = useProjectActions();
        const historyStore = useHistoryStore();
        const projectStore = useProjectStore();

        const id = await createHistoryInProject("Lung/ScRNA", "Run 1");

        expect(id).toBe("new1");
        expect(createdNames).toEqual(["Run 1"]);
        expect(updates).toEqual([{ id: "new1", body: { tags: ["project:lung/scrna"] } }]);
        expect(historyStore.currentHistoryId).toBe("new1");
        expect(historyStore.currentHistory?.tags).toEqual(["project:lung/scrna"]);
        expect(projectStore.refresh).toHaveBeenCalled();
        expect(projectRequests).toBe(1);
    });

    it("names the new history 'Unnamed history' when no name is given", async () => {
        const { createHistoryInProject } = useProjectActions();
        await createHistoryInProject("lung", "  ");
        expect(createdNames).toEqual(["Unnamed history"]);
    });

    it("refuses an empty project path", async () => {
        const { createHistoryInProject } = useProjectActions();
        await expect(createHistoryInProject(" / ")).rejects.toThrow();
        expect(createdNames).toEqual([]);
    });

    it("adds histories to a project, skipping ones already in it", async () => {
        const { addHistoriesToProject } = useProjectActions();
        await addHistoriesToProject(
            [
                { id: "h1", tags: ["qc", "project:brain"] },
                { id: "h2", tags: ["project:lung"] },
                { id: "h3", tags: null },
            ],
            "Lung",
        );
        expect(updates).toEqual([
            { id: "h1", body: { tags: ["qc", "project:brain", "project:lung"] } },
            { id: "h3", body: { tags: ["project:lung"] } },
        ]);
        expect(useProjectStore().refresh).toHaveBeenCalled();
    });

    it("moves histories into a project, dropping their other project tags", async () => {
        const { addHistoriesToProject } = useProjectActions();
        await addHistoriesToProject(
            [
                { id: "h1", tags: ["qc", "project:brain"] },
                { id: "h2", tags: ["project:lung"] },
            ],
            "lung",
            true,
        );
        expect(updates).toEqual([{ id: "h1", body: { tags: ["qc", "project:lung"] } }]);
    });

    it("still refreshes the projects when an update fails", async () => {
        server.use(
            http.put("/api/histories/{history_id}", ({ response }) =>
                response("5XX").json({ err_code: 500001, err_msg: "Update broke" }, { status: 500 }),
            ),
        );
        const { addHistoriesToProject } = useProjectActions();
        await expect(addHistoriesToProject([{ id: "h1", tags: [] }], "lung")).rejects.toThrow("Update broke");
        expect(useProjectStore().refresh).toHaveBeenCalled();
    });
});
