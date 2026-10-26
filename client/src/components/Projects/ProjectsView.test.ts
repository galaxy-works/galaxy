import { createTestingPinia } from "@pinia/testing";
import { getLocalVue, suppressBootstrapVueWarnings } from "@tests/vitest/helpers";
import { mount } from "@vue/test-utils";
import flushPromises from "flush-promises";
import { setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter, type Router } from "vue-router";

import { useServerMock } from "@/api/client/__mocks__";

import ProjectsView from "./ProjectsView.vue";

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

function serve(histories: object[], workflows: object[], invocations: object[] = INVOCATIONS) {
    server.use(
        http.get("/api/histories", ({ response }) => {
            historyRequests += 1;
            return response(200).json(histories as any);
        }),
        http.get("/api/workflows", ({ response }) => response(200).json(workflows as any)),
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
    props: ["histories"],
    emits: ["tagClick", "refreshList"],
    template: "<div class='history-card-list-stub' />",
};

const WorkflowCardListStub = {
    name: "WorkflowCardList",
    props: ["workflows", "selectable", "filterable"],
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

function shownHistoryIds(wrapper: Awaited<ReturnType<typeof mountView>>["wrapper"]) {
    const list = wrapper.findComponent({ name: "HistoryCardList" });
    return list.exists() ? list.props("histories").map((h: { id: string }) => h.id) : [];
}

function shownWorkflowIds(wrapper: Awaited<ReturnType<typeof mountView>>["wrapper"]) {
    const list = wrapper.findComponent({ name: "WorkflowCardList" });
    return list.exists() ? list.props("workflows").map((w: { id: string }) => w.id) : [];
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
        expect(wrapper.find("[data-project-path='lung']").text()).toContain("(2)");
        expect(wrapper.text()).toContain("Select a project");
        expect(wrapper.findComponent({ name: "HistoryCardList" }).exists()).toBe(false);
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
});
