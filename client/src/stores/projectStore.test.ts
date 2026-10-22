import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";

import { useServerMock } from "@/api/client/__mocks__";
import { useProjectStore } from "@/stores/projectStore";

const { server, http } = useServerMock();

function history(id: string, name: string, tags: string[]) {
    return { id, name, tags, model_class: "History", update_time: "2026-10-21T00:00:00" };
}

function workflow(id: string, name: string, tags: string[]) {
    return { id, name, tags, model_class: "StoredWorkflow", update_time: "2026-10-21T00:00:00" };
}

let historyRequests: number;
let workflowRequests: number;
let historySearches: (string | null)[];

function serve(histories: object[], workflows: object[]) {
    server.use(
        http.get("/api/histories", ({ request, response }) => {
            historyRequests += 1;
            historySearches.push(new URL(request.url).searchParams.get("search"));
            return response(200).json(histories as any);
        }),
        http.get("/api/workflows", ({ response }) => {
            workflowRequests += 1;
            return response(200).json(workflows as any);
        }),
    );
}

beforeEach(() => {
    setActivePinia(createPinia());
    historyRequests = 0;
    workflowRequests = 0;
    historySearches = [];
});

describe("useProjectStore", () => {
    it("keeps only items with project tags and derives their paths", async () => {
        serve(
            [history("h1", "Lung run", ["project:Lung/ScRNA"]), history("h2", "project: in the name", ["qc"])],
            [workflow("w1", "Align", ["project:brain", "project:lung/scrna"]), workflow("w2", "Untagged", [])],
        );
        const store = useProjectStore();
        await store.fetch();

        expect(store.histories.map((h) => h.id)).toEqual(["h1"]);
        expect(store.workflows.map((w) => w.id)).toEqual(["w1"]);
        expect(store.projectPaths).toEqual(["lung/scrna", "brain"]);
        expect(store.historyProjects.get("h1")).toEqual(["lung/scrna"]);
        expect(store.workflowProjects.get("w1")).toEqual(["brain", "lung/scrna"]);
        expect(store.loaded).toBe(true);
        expect(store.loading).toBe(false);
        expect(store.error).toBeUndefined();
        expect(historySearches).toEqual(["project:"]);
    });

    it("fetches once, sharing an in-flight request and reusing the result afterwards", async () => {
        serve([history("h1", "Lung run", ["project:lung"])], []);
        const store = useProjectStore();

        await Promise.all([store.fetch(), store.fetch()]);
        await store.fetch();

        expect(historyRequests).toBe(1);
        expect(workflowRequests).toBe(1);
        expect(store.histories).toHaveLength(1);
    });

    it("refetches on refresh and replaces the lists", async () => {
        serve([history("h1", "Lung run", ["project:lung"])], []);
        const store = useProjectStore();
        await store.fetch();

        serve([history("h1", "Lung run", ["project:lung"]), history("h2", "Brain run", ["project:brain"])], []);
        await store.refresh();

        expect(historyRequests).toBe(2);
        expect(workflowRequests).toBe(2);
        expect(store.projectPaths).toEqual(["lung", "brain"]);
    });

    it("records an error and retries on the next fetch", async () => {
        server.use(
            http.get("/api/histories", ({ response }) =>
                response("5XX").json({ err_code: 500001, err_msg: "Histories broke" }, { status: 500 }),
            ),
            http.get("/api/workflows", ({ response }) => response(200).json([])),
        );
        const store = useProjectStore();
        await store.fetch();

        expect(store.error).toContain("Histories broke");
        expect(store.loaded).toBe(false);
        expect(store.loading).toBe(false);

        serve([history("h1", "Lung run", ["project:lung"])], []);
        await store.fetch();

        expect(store.error).toBeUndefined();
        expect(store.loaded).toBe(true);
        expect(store.histories).toHaveLength(1);
    });

    it("clears loaded on a failed refresh so the next fetch retries", async () => {
        serve([history("h1", "Lung run", ["project:lung"])], []);
        const store = useProjectStore();
        await store.fetch();
        expect(store.loaded).toBe(true);

        server.use(
            http.get("/api/histories", ({ response }) =>
                response("5XX").json({ err_code: 500001, err_msg: "Histories broke" }, { status: 500 }),
            ),
        );
        await store.refresh();
        expect(store.error).toContain("Histories broke");
        expect(store.loaded).toBe(false);

        serve([history("h1", "Lung run", ["project:lung"]), history("h2", "Lung run 2", ["project:lung"])], []);
        await store.fetch();
        expect(store.error).toBeUndefined();
        expect(store.histories).toHaveLength(2);
    });

    it("ignores a slow response from an earlier refresh", async () => {
        let releaseSlow: () => void = () => {};
        const slow = new Promise<void>((resolve) => (releaseSlow = resolve));
        server.use(
            http.get("/api/histories", async ({ response }) => {
                await slow;
                return response(200).json([history("old", "Stale", ["project:old"])] as any);
            }),
            http.get("/api/workflows", ({ response }) => response(200).json([])),
        );
        const store = useProjectStore();
        const first = store.refresh();

        serve([history("new", "Fresh", ["project:new"])], []);
        await store.refresh();
        expect(store.histories.map((h) => h.id)).toEqual(["new"]);
        expect(store.loading).toBe(false);

        releaseSlow();
        await first;
        expect(store.histories.map((h) => h.id)).toEqual(["new"]);
        expect(store.loading).toBe(false);
    });
});
