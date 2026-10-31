import { createTestingPinia } from "@pinia/testing";
import { getLocalVue, suppressBootstrapVueWarnings } from "@tests/vitest/helpers";
import { mount } from "@vue/test-utils";
import flushPromises from "flush-promises";
import { setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter, type Router } from "vue-router";

import { useServerMock } from "@/api/client/__mocks__";

import ProjectsView from "./ProjectsView.vue";

// Each project load now sends four requests plus one invocation lookup per item, which pushes this
// file past the client's per-window request budget and stalls the last tests until the window resets.
vi.mock("@/api/client/rateLimiter", () => ({
    createRateLimiterMiddleware: () => ({ onRequest: ({ request }: { request: Request }) => request }),
}));

const { server, http } = useServerMock();

function history(id: string, name: string, tags: string[]) {
    return { id, name, tags, username: "alice", model_class: "History", update_time: "2026-10-21T00:00:00" };
}

function workflow(id: string, name: string, tags: string[]) {
    return {
        id,
        name,
        tags,
        owner: "alice",
        model_class: "StoredWorkflow",
        latest_workflow_id: `${id}-instance`,
        update_time: "2026-10-21T00:00:00",
    };
}

function invocation(id: string, historyId: string, workflowInstanceId: string, createTime: string) {
    return {
        id,
        history_id: historyId,
        workflow_id: workflowInstanceId,
        state: "scheduled",
        create_time: createTime,
        update_time: createTime,
        model_class: "WorkflowInvocation",
    };
}

// "lung" is tagged with a capital L on purpose: the hand-off link has to keep the item's own spelling.
const HISTORIES = [
    history("h-lung", "Lung bulk", ["project:Lung", "qc"]),
    history("h-scrna", "Lung single cell", ["project:lung/scrna"]),
    history("h-spatial", "Slides", ["project:spatial"]),
];
const WORKFLOWS = [
    workflow("w-lung", "Bulk RNA-seq", ["project:lung"]),
    workflow("w-spatial", "Spatial", ["project:spatial"]),
];
const INVOCATIONS = [
    invocation("i-lung", "h-lung", "w-lung-instance", "2026-10-20T00:00:00"),
    invocation("i-cross", "h-scrna", "w-spatial-instance", "2026-10-21T00:00:00"),
];

let historyRequests: number;

function isSharedRequest(request: Request) {
    return new URL(request.url).searchParams.get("show_shared") === "true";
}

function serve(
    histories: object[],
    workflows: object[],
    invocations: object[] = INVOCATIONS,
    shared: { histories?: object[]; workflows?: object[] } = {},
) {
    server.use(
        http.get("/api/histories", ({ request, response }) => {
            if (isSharedRequest(request)) {
                return response(200).json((shared.histories ?? []) as any);
            }
            historyRequests += 1;
            return response(200).json(histories as any);
        }),
        http.get("/api/workflows", ({ request, response }) =>
            response(200).json((isSharedRequest(request) ? (shared.workflows ?? []) : workflows) as any),
        ),
        http.get("/api/workflows/{workflow_id}", ({ params, response }) => {
            const stored = WORKFLOWS.find((w) => w.latest_workflow_id === params.workflow_id);
            return response(200).json(stored as any);
        }),
        http.get("/api/invocations", ({ request, response }) => {
            const query = new URL(request.url).searchParams;
            const historyId = query.get("history_id");
            const workflowId = query.get("workflow_id");
            const matching = (invocations as ReturnType<typeof invocation>[]).filter(
                (i) => i.history_id === historyId || (workflowId && i.workflow_id === `${workflowId}-instance`),
            );
            return response(200).json(matching as any);
        }),
    );
}

const HistoryCardListStub = {
    name: "HistoryCardList",
    props: { histories: Array, sharedView: Boolean },
    emits: ["tagClick", "refreshList"],
    template: "<div class='history-card-list-stub' />",
};

const WorkflowCardListStub = {
    name: "WorkflowCardList",
    props: { workflows: Array, selectable: Boolean, filterable: Boolean, sharedWithMeView: Boolean },
    emits: ["tagClick", "refreshList"],
    template: "<div class='workflow-card-list-stub' />",
};

async function mountView(path?: string) {
    const pinia = createTestingPinia({ createSpy: vi.fn, stubActions: false });
    setActivePinia(pinia);

    const router: Router = createRouter({
        history: createMemoryHistory(),
        routes: [{ path: "/:pathMatch(.*)*", component: { template: "<div></div>" } }],
    });
    await router.push(path ? `/projects?path=${path}` : "/projects");
    await router.isReady();

    const wrapper = mount(ProjectsView as object, {
        global: {
            ...getLocalVue(),
            stubs: { HistoryCardList: HistoryCardListStub, WorkflowCardList: WorkflowCardListStub },
        },
        pinia,
        router,
        props: path ? { path } : {},
    });
    await flushPromises();
    return { wrapper, router };
}

type Wrapper = Awaited<ReturnType<typeof mountView>>["wrapper"];

function historyList(wrapper: Wrapper, shared = false) {
    return wrapper
        .findAllComponents({ name: "HistoryCardList" })
        .find((list) => Boolean(list.props("sharedView")) === shared);
}

function workflowList(wrapper: Wrapper, shared = false) {
    return wrapper
        .findAllComponents({ name: "WorkflowCardList" })
        .find((list) => Boolean(list.props("sharedWithMeView")) === shared);
}

function shownHistoryIds(wrapper: Wrapper, shared = false) {
    return (
        historyList(wrapper, shared)
            ?.props("histories")
            .map((h: { id: string }) => h.id) ?? []
    );
}

function shownWorkflowIds(wrapper: Wrapper, shared = false) {
    return (
        workflowList(wrapper, shared)
            ?.props("workflows")
            .map((w: { id: string }) => w.id) ?? []
    );
}

function filterOf(href: string | undefined) {
    return new URL(href ?? "", "http://localhost").searchParams.get("filter");
}

describe("ProjectsView", () => {
    beforeEach(() => {
        suppressBootstrapVueWarnings();
        historyRequests = 0;
        serve(HISTORIES, WORKFLOWS);
    });

    it("builds the project tree from the tags", async () => {
        const { wrapper } = await mountView();

        const paths = wrapper.findAll("[data-project-path]").map((node) => node.attributes("data-project-path"));
        expect(paths).toEqual(["lung", "lung/scrna", "spatial"]);
        expect(wrapper.text()).toContain("Select a project");
        expect(wrapper.findComponent({ name: "HistoryCardList" }).exists()).toBe(false);
    });

    it("counts each node's histories and workflows including its subprojects", async () => {
        const { wrapper } = await mountView();

        const counts = (path: string) => wrapper.find(`[data-project-path='${path}'] [data-project-counts]`);
        expect(counts("lung").text()).toBe("2 · 1");
        expect(counts("lung").attributes("title")).toBe("2 histories, 1 workflow");
        expect(counts("lung/scrna").attributes("title")).toBe("1 history, 0 workflows");
        expect(counts("spatial").attributes("title")).toBe("1 history, 1 workflow");
        expect(wrapper.find("[data-project-runs]").exists()).toBe(false);
    });

    it("counts runs on the selected node only", async () => {
        const { wrapper } = await mountView("lung");

        const runs = wrapper.findAll("[data-project-runs]");
        expect(runs).toHaveLength(1);
        expect(runs[0]!.element.closest("[data-project-path]")!.getAttribute("data-project-path")).toBe("lung");
        expect(runs[0]!.text()).toBe("· 2 runs");
        expect(wrapper.find("[data-project-path='lung'] [data-project-counts]").attributes("title")).toBe(
            "2 histories, 1 workflow, 2 runs",
        );
    });

    it("shows the selected project's histories and workflows in the card lists", async () => {
        const { wrapper, router } = await mountView();

        await wrapper.find("[data-project-path='spatial']").trigger("click");
        await flushPromises();

        expect(router.currentRoute.value.query.path).toBe("spatial");
        expect(shownHistoryIds(wrapper)).toEqual(["h-spatial"]);
        expect(shownWorkflowIds(wrapper)).toEqual(["w-spatial"]);
        expect(wrapper.findComponent({ name: "WorkflowCardList" }).props("selectable")).toBe(false);
    });

    it("rolls subprojects up into their parent unless the toggle is off", async () => {
        const { wrapper } = await mountView("lung");

        expect(shownHistoryIds(wrapper)).toEqual(["h-lung", "h-scrna"]);
        expect(wrapper.find("[data-project-histories]").text()).toContain("Histories (2)");

        await wrapper.find("input[type='checkbox']").setValue(false);
        await flushPromises();

        expect(shownHistoryIds(wrapper)).toEqual(["h-lung"]);
        expect(wrapper.find("[data-project-histories]").text()).toContain("Histories (1)");
        expect(shownWorkflowIds(wrapper)).toEqual(["w-lung"]);
    });

    it("links to the full lists filtered on the exact project tag", async () => {
        const { wrapper } = await mountView("lung");

        const historyLink = wrapper.find("[data-project-history-list-link]");
        const workflowLink = wrapper.find("[data-project-workflow-list-link]");
        expect(historyLink.attributes("href")).toMatch(/^\/histories\/list\?/);
        expect(filterOf(historyLink.attributes("href"))).toBe("tag:'project:Lung'");
        expect(workflowLink.attributes("href")).toMatch(/^\/workflows\/list\?/);
        expect(filterOf(workflowLink.attributes("href"))).toBe("tag:'project:lung'");
        expect(wrapper.find("[data-project-histories]").text()).toContain("no subprojects");

        await wrapper.find("input[type='checkbox']").setValue(false);
        expect(wrapper.find("[data-project-histories]").text()).not.toContain("no subprojects");
    });

    it("lists invocations reached through the project's histories or workflows", async () => {
        const { wrapper } = await mountView("lung");

        const rows = wrapper.findAll("[data-project-invocation]");
        expect(rows).toHaveLength(2);
        // Newest first; the second history runs a workflow from another project.
        expect(rows[0]!.text()).toContain("Spatial");
        expect(rows[0]!.text()).toContain("workflow is in spatial");
        expect(rows[1]!.text()).toContain("history and workflow");
        expect(rows[1]!.text()).toContain("scheduled");
    });

    it("selects a project from a project tag on a card and hands other tags to the full list", async () => {
        const { wrapper, router } = await mountView("lung");

        wrapper.findComponent({ name: "HistoryCardList" }).vm.$emit("tagClick", "project:lung/scrna");
        await flushPromises();
        expect(router.currentRoute.value.query.path).toBe("lung/scrna");
        expect(shownHistoryIds(wrapper)).toEqual(["h-scrna"]);

        wrapper.findComponent({ name: "HistoryCardList" }).vm.$emit("tagClick", "qc");
        await flushPromises();
        expect(router.currentRoute.value.path).toBe("/histories/list");
        expect(router.currentRoute.value.query.filter).toBe("tag:'qc'");
    });

    it("refreshes the projects when a card reports a change", async () => {
        const { wrapper } = await mountView("lung");
        expect(historyRequests).toBe(1);

        serve([history("h-lung", "Lung bulk", ["project:Lung"])], WORKFLOWS);
        wrapper.findComponent({ name: "WorkflowCardList" }).vm.$emit("refreshList", true, true);
        await flushPromises();

        expect(historyRequests).toBe(2);
        expect(shownHistoryIds(wrapper)).toEqual(["h-lung"]);
        expect(wrapper.findAll("[data-project-path]").map((n) => n.attributes("data-project-path"))).toEqual([
            "lung",
            "spatial",
        ]);
    });

    it("shows an empty state when nothing is tagged with a project", async () => {
        serve([history("h-plain", "Plain", ["qc"])], []);
        const { wrapper } = await mountView();

        expect(wrapper.find("#projects-empty").exists()).toBe(true);
        expect(wrapper.find("[data-project-path]").exists()).toBe(false);
    });

    it("shows empty sections for a project with no items of that kind", async () => {
        const { wrapper } = await mountView("lung/scrna");

        expect(shownHistoryIds(wrapper)).toEqual(["h-scrna"]);
        expect(wrapper.findComponent({ name: "WorkflowCardList" }).exists()).toBe(false);
        expect(wrapper.find("[data-project-workflows]").text()).toContain("No workflows in this project.");
    });

    it("shows the load error and retries on request", async () => {
        server.use(
            http.get("/api/histories", ({ response }) =>
                response("5XX").json({ err_code: 500001, err_msg: "Histories broke" }, { status: 500 }),
            ),
        );
        const { wrapper } = await mountView();

        expect(wrapper.find("#projects-error").text()).toContain("Histories broke");
        expect(wrapper.find("[data-project-path]").exists()).toBe(false);

        serve(HISTORIES, WORKFLOWS);
        await wrapper.find("#projects-error button").trigger("click");
        await flushPromises();

        expect(wrapper.find("#projects-error").exists()).toBe(false);
        expect(wrapper.findAll("[data-project-path]")).toHaveLength(3);
    });

    describe("items shared with the user", () => {
        const SHARED_HISTORIES = [
            { ...history("h-mate", "Lab mate's scRNA", ["project:Lung/scrna"]), username: "bob" },
            { ...history("h-mate-2", "Lab mate's bulk", ["project:lung"]), username: "bob" },
        ];
        const SHARED_WORKFLOWS = [{ ...workflow("w-mate", "Lab mate's QC", ["project:methods"]), owner: "bob" }];

        beforeEach(() => {
            serve(HISTORIES, WORKFLOWS, INVOCATIONS, { histories: SHARED_HISTORIES, workflows: SHARED_WORKFLOWS });
        });

        it("adds shared paths to the tree and says how many items are shared", async () => {
            const { wrapper } = await mountView();

            const paths = wrapper.findAll("[data-project-path]").map((node) => node.attributes("data-project-path"));
            expect(paths).toEqual(["lung", "lung/scrna", "methods", "spatial"]);
            const counts = (path: string) => wrapper.find(`[data-project-path='${path}'] [data-project-counts]`);
            expect(counts("lung").text()).toBe("4 · 1");
            expect(counts("lung").attributes("title")).toBe("4 histories (2 shared with you), 1 workflow");
            expect(counts("methods").attributes("title")).toBe("0 histories, 1 workflow (1 shared with you)");
        });

        it("shows shared items next to the user's own, marked with their owner", async () => {
            const { wrapper } = await mountView("lung");

            expect(shownHistoryIds(wrapper)).toEqual(["h-lung", "h-scrna"]);
            expect(shownHistoryIds(wrapper, true)).toEqual(["h-mate", "h-mate-2"]);
            const section = wrapper.find("[data-project-histories]");
            expect(section.text()).toContain("Histories (4, 2 shared with you)");
            expect(section.find("[data-project-shared-histories]").text()).toContain("Shared with you by bob");
        });

        it("hands shared workflows to the card list as shared, so their tags stay read-only", async () => {
            const { wrapper } = await mountView("methods");

            expect(shownWorkflowIds(wrapper)).toEqual([]);
            expect(shownWorkflowIds(wrapper, true)).toEqual(["w-mate"]);
            expect(workflowList(wrapper, true)!.props("selectable")).toBe(false);
            expect(wrapper.find("[data-project-shared-workflows]").text()).toContain("Shared with you by bob");
            expect(wrapper.find("[data-project-workflows]").text()).not.toContain("No workflows in this project.");
        });

        it("links to the shared lists only when the project has shared items of that kind", async () => {
            const { wrapper } = await mountView("lung");

            const sharedHistoryLink = wrapper.find("[data-project-shared-history-list-link]");
            expect(sharedHistoryLink.attributes("href")).toMatch(/^\/histories\/list_shared\?/);
            expect(filterOf(sharedHistoryLink.attributes("href"))).toBe("tag:'project:lung'");
            expect(filterOf(wrapper.find("[data-project-history-list-link]").attributes("href"))).toBe(
                "tag:'project:Lung'",
            );
            expect(wrapper.find("[data-project-shared-workflow-list-link]").exists()).toBe(false);

            await wrapper.find("[data-project-path='methods']").trigger("click");
            await flushPromises();
            const sharedWorkflowLink = wrapper.find("[data-project-shared-workflow-list-link]");
            expect(sharedWorkflowLink.attributes("href")).toMatch(/^\/workflows\/list_shared_with_me\?/);
            expect(filterOf(sharedWorkflowLink.attributes("href"))).toBe("tag:'project:methods'");
            expect(wrapper.find("[data-project-shared-history-list-link]").exists()).toBe(false);
        });

        it("hands other tags on a shared card to the shared list", async () => {
            const { wrapper, router } = await mountView("lung");

            historyList(wrapper, true)!.vm.$emit("tagClick", "qc");
            await flushPromises();
            expect(router.currentRoute.value.path).toBe("/histories/list_shared");
            expect(router.currentRoute.value.query.filter).toBe("tag:'qc'");
        });

        it("keeps the user's own items and notes the failure when the shared ones can't load", async () => {
            server.use(
                http.get("/api/histories", ({ request, response }) => {
                    if (isSharedRequest(request)) {
                        return response("5XX").json({ err_code: 500001, err_msg: "Shares broke" }, { status: 500 });
                    }
                    return response(200).json(HISTORIES as any);
                }),
            );
            const { wrapper } = await mountView("lung");

            expect(wrapper.find("#projects-error").exists()).toBe(false);
            expect(wrapper.find("[data-project-shared-error]").text()).toContain("Shares broke");
            expect(shownHistoryIds(wrapper)).toEqual(["h-lung", "h-scrna"]);
            expect(historyList(wrapper, true)).toBeUndefined();
        });
    });
});
