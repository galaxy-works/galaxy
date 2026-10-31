import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";

import { useServerMock } from "@/api/client/__mocks__";
import { useProjectStore } from "@/stores/projectStore";
import { useUserStore } from "@/stores/userStore";

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
let sharedHistoryQueries: URLSearchParams[];
let sharedWorkflowQueries: URLSearchParams[];

function user(id: string) {
    return { id, email: `${id}@example.org`, username: id, isAnonymous: false } as any;
}

function isSharedRequest(request: Request) {
    return new URL(request.url).searchParams.get("show_shared") === "true";
}

/** Answers the own and the shared requests separately, like the server does. */
function serve(
    histories: object[],
    workflows: object[],
    sharedHistories: object[] = [],
    sharedWorkflows: object[] = [],
) {
    server.use(
        http.get("/api/histories", ({ request, response }) => {
            const query = new URL(request.url).searchParams;
            if (isSharedRequest(request)) {
                sharedHistoryQueries.push(query);
                return response(200).json(sharedHistories as any);
            }
            historyRequests += 1;
            historySearches.push(query.get("search"));
            return response(200).json(histories as any);
        }),
        http.get("/api/workflows", ({ request, response }) => {
            if (isSharedRequest(request)) {
                sharedWorkflowQueries.push(new URL(request.url).searchParams);
                return response(200).json(sharedWorkflows as any);
            }
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
    sharedHistoryQueries = [];
    sharedWorkflowQueries = [];
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

    it("reset clears the lists and drops a load that is still in flight", async () => {
        let releaseSlow: () => void = () => {};
        const slow = new Promise<void>((resolve) => (releaseSlow = resolve));
        server.use(
            http.get("/api/histories", async ({ response }) => {
                await slow;
                return response(200).json([history("h1", "Lung run", ["project:lung"])] as any);
            }),
            http.get("/api/workflows", ({ response }) => response(200).json([])),
        );
        const store = useProjectStore();
        const inFlight = store.fetch();
        expect(store.loading).toBe(true);

        store.reset();
        expect(store.loading).toBe(false);

        releaseSlow();
        await inFlight;
        expect(store.histories).toEqual([]);
        expect(store.loaded).toBe(false);

        serve([history("h2", "Brain run", ["project:brain"])], []);
        await store.fetch();
        expect(store.histories.map((h) => h.id)).toEqual(["h2"]);
    });

    it("resets when the current user changes, but not when the user first loads", async () => {
        serve([history("h1", "Lung run", ["project:lung"])], []);
        const userStore = useUserStore();
        const store = useProjectStore();
        await store.fetch();

        userStore.currentUser = user("alice");
        expect(store.loaded).toBe(true);
        expect(store.histories).toHaveLength(1);

        userStore.currentUser = user("bob");
        expect(store.loaded).toBe(false);
        expect(store.histories).toEqual([]);

        serve([history("h2", "Bob run", ["project:brain"])], []);
        await store.fetch();
        expect(store.histories.map((h) => h.id)).toEqual(["h2"]);
        expect(historyRequests).toBe(2);
    });

    describe("items shared with the user", () => {
        function shared<T extends object>(item: T, owner: string) {
            return "model_class" in item && item.model_class === "History"
                ? { ...item, username: owner }
                : { ...item, owner };
        }

        it("asks for the shared histories and workflows apart from the user's own", async () => {
            serve([], []);
            await useProjectStore().fetch();

            expect(sharedHistoryQueries).toHaveLength(1);
            const historyQuery = sharedHistoryQueries[0]!;
            expect(historyQuery.get("show_own")).toBe("false");
            expect(historyQuery.get("show_published")).toBe("false");
            expect(historyQuery.get("search")).toBe("project:");
            expect(historyQuery.get("view")).toBe("summary");
            expect(historyQuery.get("keys")).toBe("username");

            expect(sharedWorkflowQueries).toHaveLength(1);
            const workflowQuery = sharedWorkflowQueries[0]!;
            expect(workflowQuery.get("show_published")).toBe("false");
            // show_shared alone also returns the user's own workflows
            expect(workflowQuery.get("search")).toBe("project: is:shared_with_me");
        });

        it("keeps shared items in their own lists and takes their paths into the tree", async () => {
            useUserStore().currentUser = user("alice");
            serve(
                [history("h1", "Mine", ["project:lung"])],
                [workflow("w1", "Mine", ["project:lung"])],
                [shared(history("h2", "Lab mate's", ["project:lung/scrna"]), "bob")],
                [shared(workflow("w2", "Lab mate's", ["project:methods"]), "bob")],
            );
            const store = useProjectStore();
            await store.fetch();

            expect(store.histories.map((h) => h.id)).toEqual(["h1"]);
            expect(store.workflows.map((w) => w.id)).toEqual(["w1"]);
            expect(store.sharedHistories.map((h) => h.id)).toEqual(["h2"]);
            expect(store.sharedWorkflows.map((w) => w.id)).toEqual(["w2"]);
            expect(store.sharedHistoryIds.has("h2")).toBe(true);
            expect(store.sharedHistoryIds.has("h1")).toBe(false);
            expect(store.historyProjects.get("h2")).toEqual(["lung/scrna"]);
            expect(store.workflowProjects.get("w2")).toEqual(["methods"]);
            expect(store.projectPaths).toEqual(["lung", "lung/scrna", "methods"]);
            expect(store.sharedError).toBeUndefined();
        });

        it("never counts one of the user's own items as shared", async () => {
            useUserStore().currentUser = user("alice");
            serve(
                [history("h1", "Mine", ["project:lung"])],
                [],
                [shared(history("h1", "Mine", ["project:lung"]), "alice")],
                [
                    shared(workflow("w1", "Mine too", ["project:lung"]), "alice"),
                    shared(workflow("w2", "Untagged", []), "bob"),
                ],
            );
            const store = useProjectStore();
            await store.fetch();

            expect(store.sharedHistories).toEqual([]);
            expect(store.sharedWorkflows).toEqual([]);
        });

        it("keeps the user's own lists and notes the failure when the shared half fails", async () => {
            serve([history("h1", "Mine", ["project:lung"])], [workflow("w1", "Mine", ["project:lung"])]);
            server.use(
                http.get("/api/histories", ({ request, response }) => {
                    if (isSharedRequest(request)) {
                        return response("5XX").json({ err_code: 500001, err_msg: "Shares broke" }, { status: 500 });
                    }
                    return response(200).json([history("h1", "Mine", ["project:lung"])] as any);
                }),
            );
            const store = useProjectStore();
            await store.fetch();

            expect(store.error).toBeUndefined();
            expect(store.loaded).toBe(true);
            expect(store.sharedError).toContain("Shares broke");
            expect(store.histories.map((h) => h.id)).toEqual(["h1"]);
            expect(store.workflows.map((w) => w.id)).toEqual(["w1"]);
            expect(store.sharedHistories).toEqual([]);

            serve([history("h1", "Mine", ["project:lung"])], [], [history("h2", "Shared", ["project:lung"])]);
            await store.refresh();
            expect(store.sharedError).toBeUndefined();
            expect(store.sharedHistories.map((h) => h.id)).toEqual(["h2"]);
        });

        it("drops shared items on reset", async () => {
            serve([], [], [history("h2", "Shared", ["project:lung"])]);
            const store = useProjectStore();
            await store.fetch();
            expect(store.sharedHistories).toHaveLength(1);

            store.reset();
            expect(store.sharedHistories).toEqual([]);
            expect(store.projectPaths).toEqual([]);
        });
    });
});
