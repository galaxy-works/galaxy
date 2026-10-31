import { createTestingPinia } from "@pinia/testing";
import { getLocalVue } from "@tests/vitest/helpers";
import { mount } from "@vue/test-utils";
import flushPromises from "flush-promises";
import { describe, expect, it, vi } from "vitest";

import { useServerMock } from "@/api/client/__mocks__";
import { useProjectContextStore } from "@/stores/projectContextStore";
import { useProjectStore } from "@/stores/projectStore";

import ProjectMembershipNotice from "./ProjectMembershipNotice.vue";

const { server, http } = useServerMock();

const NOTICE = "[data-description='project membership notice']";

function mountNotice(project: string | null, tags: string[]) {
    const pinia = createTestingPinia({ createSpy: vi.fn, stubActions: false });
    useProjectContextStore(pinia).setCurrentProject(project);
    const wrapper = mount(ProjectMembershipNotice as object, {
        global: getLocalVue(),
        pinia,
        props: { history: { id: "h1", tags } },
    });
    return { wrapper, projectStore: useProjectStore(pinia) };
}

describe("ProjectMembershipNotice", () => {
    it("stays hidden without a current project", () => {
        const { wrapper } = mountNotice(null, []);
        expect(wrapper.find(NOTICE).exists()).toBe(false);
    });

    it("stays hidden when the history is in the project", () => {
        const { wrapper } = mountNotice("lung", ["project:lung/scrna"]);
        expect(wrapper.find(NOTICE).exists()).toBe(false);
    });

    it("says when the history is outside the project and adds it on request", async () => {
        const updates: { id: string; tags: string[] }[] = [];
        server.use(
            http.put("/api/histories/{history_id}", async ({ params, request, response }) => {
                const body = (await request.json()) as { tags: string[] };
                updates.push({ id: params.history_id, tags: body.tags });
                return response(200).json({ id: params.history_id, tags: body.tags } as never);
            }),
            http.get("/api/histories", ({ response }) => response(200).json([])),
            http.get("/api/workflows", ({ response }) => response(200).json([])),
        );
        const { wrapper, projectStore } = mountNotice("lung", ["qc", "project:lungs"]);

        expect(wrapper.find(NOTICE).text()).toContain("Not in project lung");
        await wrapper.find("[data-description='add to current project']").trigger("click");
        await flushPromises();

        expect(updates).toEqual([{ id: "h1", tags: ["qc", "project:lungs", "project:lung"] }]);
        expect(projectStore.refresh).toHaveBeenCalled();
    });
});
