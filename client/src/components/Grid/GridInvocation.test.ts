import { createTestingPinia } from "@pinia/testing";
import { getFakeRegisteredUser } from "@tests/test-data";
import { getLocalVue } from "@tests/vitest/helpers";
import { mount } from "@vue/test-utils";
import flushPromises from "flush-promises";
import { setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useServerMock } from "@/api/client/__mocks__";
import { useProjectContextStore } from "@/stores/projectContextStore";
import { useUserStore } from "@/stores/userStore";

import GridInvocation from "./GridInvocation.vue";
import GridList from "@/components/Grid/GridList.vue";

const { server, http } = useServerMock();

const FAKE_USER = getFakeRegisteredUser({ id: "user_id", email: "me@example.org", username: "me" });

const PROJECT_HISTORIES = [
    { id: "h-lung", name: "Lung", tags: ["project:lung"] },
    { id: "h-scrna", name: "scRNA", tags: ["project:lung/scrna"] },
    { id: "h-lungs", name: "Lungs", tags: ["project:lungs"] },
];

async function mountGrid(project: string | null, props: Record<string, unknown> = {}) {
    const pinia = createTestingPinia({ createSpy: vi.fn, stubActions: false });
    setActivePinia(pinia);
    useUserStore().currentUser = FAKE_USER;
    useProjectContextStore().setCurrentProject(project);
    const wrapper = mount(GridInvocation as object, {
        props,
        global: { ...getLocalVue(), stubs: { GridList: true } },
        pinia,
    });
    await flushPromises();
    return wrapper;
}

describe("GridInvocation", () => {
    beforeEach(() => {
        server.use(
            http.get("/api/histories", ({ response }) => response(200).json(PROJECT_HISTORIES as never)),
            http.get("/api/workflows", ({ response }) => response(200).json([])),
        );
    });

    it("asks for every invocation of the user without a current project", async () => {
        const wrapper = await mountGrid(null);

        const extraProps = wrapper.findComponent(GridList).props("extraProps");
        expect(extraProps).toEqual({ user_id: "user_id" });
        expect(wrapper.find("[data-description='project scope banner']").exists()).toBe(false);
    });

    it("scopes to the histories inside the current project", async () => {
        const wrapper = await mountGrid("lung");

        const extraProps = wrapper.findComponent(GridList).props("extraProps");
        expect(extraProps.history_ids).toEqual(["h-lung", "h-scrna"]);
        expect(wrapper.find("[data-description='project scope banner']").exists()).toBe(true);
    });

    it("passes an empty scope when no history is in the project", async () => {
        const wrapper = await mountGrid("brain");

        expect(wrapper.findComponent(GridList).props("extraProps").history_ids).toEqual([]);
    });

    it("leaves a grid filtered to one history alone", async () => {
        const wrapper = await mountGrid("lung", { filteredFor: { type: "History", id: "h-other", name: "Other" } });

        const extraProps = wrapper.findComponent(GridList).props("extraProps");
        expect(extraProps.history_ids).toBeUndefined();
        expect(extraProps.history_id).toBe("h-other");
    });
});
