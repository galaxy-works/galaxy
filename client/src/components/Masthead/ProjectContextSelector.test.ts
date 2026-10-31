import { createTestingPinia } from "@pinia/testing";
import { getFakeRegisteredUser } from "@tests/test-data";
import { createTestRouter, getLocalVue } from "@tests/vitest/helpers";
import { mount } from "@vue/test-utils";
import flushPromises from "flush-promises";
import { setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useServerMock } from "@/api/client/__mocks__";
import { useProjectContextStore } from "@/stores/projectContextStore";
import { useProjectStore } from "@/stores/projectStore";
import { useUserStore } from "@/stores/userStore";

import ProjectContextSelector from "./ProjectContextSelector.vue";

const { server, http } = useServerMock();

const FAKE_USER = getFakeRegisteredUser({ id: "user_id", email: "me@example.org", username: "me" });

const HISTORIES = [
    { id: "h1", name: "One", tags: ["project:lung/scrna/batch-1"] },
    { id: "h2", name: "Two", tags: ["project:lung/bulk"] },
    { id: "h3", name: "Three", tags: ["project:brain"] },
];

async function mountSelector(project: string | null = null) {
    const pinia = createTestingPinia({ createSpy: vi.fn, stubActions: false });
    setActivePinia(pinia);
    useUserStore().currentUser = FAKE_USER;
    const context = useProjectContextStore();
    context.setCurrentProject(project);
    const wrapper = mount(ProjectContextSelector as object, {
        global: getLocalVue(),
        pinia,
        router: createTestRouter(),
        attachTo: document.body,
    });
    await flushPromises();
    return { wrapper, context, projectStore: useProjectStore() };
}

async function open(wrapper: Awaited<ReturnType<typeof mountSelector>>["wrapper"]) {
    await wrapper.get(".dropdown-toggle").trigger("click");
    await flushPromises();
}

function rowPaths(wrapper: Awaited<ReturnType<typeof mountSelector>>["wrapper"]) {
    return wrapper.findAll("[data-project-path]").map((row) => row.attributes("data-project-path"));
}

describe("ProjectContextSelector", () => {
    beforeEach(() => {
        server.use(
            http.get("/api/histories", ({ response }) => response(200).json(HISTORIES as never)),
            http.get("/api/workflows", ({ response }) => response(200).json([])),
        );
    });

    it("shows All projects when no project is current and loads nothing until opened", async () => {
        const { wrapper, projectStore } = await mountSelector();

        expect(wrapper.get(".dropdown-toggle").text()).toContain("All projects");
        expect(projectStore.fetch).not.toHaveBeenCalled();
        wrapper.unmount();
    });

    it("shows the current project, cut short with the full path in the title", async () => {
        const { wrapper } = await mountSelector("lung/scrna/a-rather-long-subproject-name");

        const label = wrapper.get("[data-description='current project label']");
        expect(label.attributes("title")).toBe("lung/scrna/a-rather-long-subproject-name");
        expect(label.text().length).toBeLessThanOrEqual(24);
        expect(label.text()).toContain("subproject-name");
        wrapper.unmount();
    });

    it("loads the tree on open with the top two levels showing", async () => {
        const { wrapper, projectStore } = await mountSelector();
        await open(wrapper);

        expect(projectStore.fetch).toHaveBeenCalled();
        expect(rowPaths(wrapper)).toEqual(["brain", "lung", "lung/bulk", "lung/scrna"]);
        wrapper.unmount();
    });

    it("expands a collapsed node without picking it", async () => {
        const { wrapper, context } = await mountSelector();
        await open(wrapper);

        await wrapper.get("[data-project-path='lung/scrna'] [data-description='toggle subprojects']").trigger("click");

        expect(rowPaths(wrapper)).toContain("lung/scrna/batch-1");
        expect(context.currentProject).toBeNull();
        wrapper.unmount();
    });

    it("expands and collapses with the arrow keys", async () => {
        const { wrapper } = await mountSelector();
        await open(wrapper);

        await wrapper.get("[data-project-path='lung/scrna']").trigger("keydown", { key: "ArrowRight" });
        expect(rowPaths(wrapper)).toContain("lung/scrna/batch-1");

        await wrapper.get("[data-project-path='lung/scrna']").trigger("keydown", { key: "ArrowLeft" });
        expect(rowPaths(wrapper)).not.toContain("lung/scrna/batch-1");
        wrapper.unmount();
    });

    it("opens the way down to the current project", async () => {
        const { wrapper } = await mountSelector("lung/scrna/batch-1");
        await open(wrapper);

        expect(rowPaths(wrapper)).toContain("lung/scrna/batch-1");
        expect(wrapper.get("[data-project-path='lung/scrna/batch-1']").classes()).toContain("active");
        wrapper.unmount();
    });

    it("sets and clears the current project", async () => {
        const { wrapper, context } = await mountSelector();
        await open(wrapper);

        await wrapper.get("[data-project-path='lung']").trigger("click");
        expect(context.currentProject).toBe("lung");
        expect(wrapper.get(".dropdown-toggle").text()).toContain("lung");

        await open(wrapper);
        await wrapper.get("[data-description='all projects']").trigger("click");
        expect(context.currentProject).toBeNull();
        wrapper.unmount();
    });

    it("toggles subprojects and the project field", async () => {
        const { wrapper, context } = await mountSelector("lung");
        await open(wrapper);

        await wrapper.get("[data-description='include subprojects'] input").setValue(false);
        expect(context.includeSubprojects).toBe(false);

        await wrapper.get("[data-description='projects as field'] input").setValue(true);
        expect(context.projectsAsField).toBe(true);
        wrapper.unmount();
    });

    it("links to the projects page", async () => {
        const { wrapper } = await mountSelector();

        expect(wrapper.get("[data-description='manage projects']").attributes("href")).toContain("/projects");
        wrapper.unmount();
    });
});
