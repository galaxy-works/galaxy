import { createTestingPinia } from "@pinia/testing";
import { getLocalVue } from "@tests/vitest/helpers";
import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";

import { useProjectContextStore } from "@/stores/projectContextStore";

import ProjectScopeBanner from "./ProjectScopeBanner.vue";

function mountBanner(project: string | null, includeSubprojects = true) {
    const pinia = createTestingPinia({ createSpy: vi.fn, stubActions: false });
    const store = useProjectContextStore(pinia);
    store.setCurrentProject(project);
    store.includeSubprojects = includeSubprojects;
    const wrapper = mount(ProjectScopeBanner as object, { global: getLocalVue(), pinia });
    return { wrapper, store };
}

describe("ProjectScopeBanner", () => {
    it("renders nothing without a current project", () => {
        const { wrapper } = mountBanner(null);
        expect(wrapper.find("[data-description='project scope banner']").exists()).toBe(false);
    });

    it("names the project and its subprojects", () => {
        const { wrapper } = mountBanner("lung");
        const text = wrapper.find("[data-description='project scope banner']").text().replace(/\s+/g, " ");
        expect(text).toContain("In project lung and its subprojects");
        expect(text).toContain("Show all projects");
    });

    it("leaves out the subprojects when they are excluded", () => {
        const { wrapper } = mountBanner("lung", false);
        const text = wrapper.find("[data-description='project scope banner']").text();
        expect(text).toContain("In project lung");
        expect(text).not.toContain("subprojects");
    });

    it("clears the context from its link", async () => {
        const { wrapper, store } = mountBanner("lung");
        await wrapper.find("[data-description='project scope clear']").trigger("click");
        expect(store.currentProject).toBeNull();
        expect(wrapper.find("[data-description='project scope banner']").exists()).toBe(false);
    });
});
