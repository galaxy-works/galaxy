import { createTestingPinia } from "@pinia/testing";
import { getLocalVue } from "@tests/vitest/helpers";
import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";

import { useProjectStore } from "@/stores/projectStore";

import ProjectPicker from "./ProjectPicker.vue";

function mountPicker(paths: string[], modelValue = "") {
    const pinia = createTestingPinia({ createSpy: vi.fn });
    const store = useProjectStore(pinia);
    // @ts-expect-error computed getters are writable in testing pinia
    store.projectPaths = paths;
    const wrapper = mount(ProjectPicker as object, { global: getLocalVue(), pinia, props: { modelValue } });
    return { wrapper, store };
}

describe("ProjectPicker", () => {
    it("offers the existing projects sorted", () => {
        const { wrapper, store } = mountPicker(["lung/scrna", "brain", "lung"]);
        const options = wrapper.findAll("datalist option").map((option) => option.attributes("value"));
        expect(options).toEqual(["brain", "lung", "lung/scrna"]);
        expect(store.fetch).toHaveBeenCalled();
    });

    it("emits the normalized path of what is typed", async () => {
        const { wrapper } = mountPicker(["lung"]);
        await wrapper.find("input").setValue(" Lung / ScRNA/ ");
        expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual(["lung/scrna"]);
        expect(wrapper.find("input").element.value).toBe(" Lung / ScRNA/ ");
        expect(wrapper.find("[data-project-picker-preview]").text()).toContain("project:lung/scrna");
        expect(wrapper.find("[data-project-picker-preview]").text()).toContain("(new project)");
    });

    it("does not call an existing project new", async () => {
        const { wrapper } = mountPicker(["lung"]);
        await wrapper.find("input").setValue("LUNG");
        expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual(["lung"]);
        expect(wrapper.find("[data-project-picker-preview]").text()).not.toContain("new project");
    });

    it("shows no preview and emits an empty path for blank input", async () => {
        const { wrapper } = mountPicker([], "brain");
        expect(wrapper.find("input").element.value).toBe("brain");
        await wrapper.find("input").setValue(" / ");
        expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual([""]);
        expect(wrapper.find("[data-project-picker-preview]").exists()).toBe(false);
    });
});
