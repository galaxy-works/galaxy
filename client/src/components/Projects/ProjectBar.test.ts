import { createTestingPinia } from "@pinia/testing";
import { getLocalVue } from "@tests/vitest/helpers";
import { mount } from "@vue/test-utils";
import { setActivePinia } from "pinia";
import { describe, expect, it, vi } from "vitest";

import { useProjectContextStore } from "@/stores/projectContextStore";
import { useProjectStore } from "@/stores/projectStore";

import ProjectBar from "./ProjectBar.vue";

function history(id: string, tags: string[]) {
    return { id, name: id, tags };
}

function mountBar(props: Record<string, unknown> = {}, asField = true) {
    const pinia = createTestingPinia({ createSpy: vi.fn });
    setActivePinia(pinia);
    const projectStore = useProjectStore();
    projectStore.histories = [
        history("h1", ["project:Lung"]),
        history("h2", ["project:lung/scrna"]),
        history("h3", ["project:spatial", "qc"]),
    ] as any;
    useProjectContextStore().projectsAsField = asField;
    const wrapper = mount(ProjectBar as object, {
        props,
        global: { ...getLocalVue(), plugins: [pinia] },
    });
    return { wrapper, projectStore };
}

function chipLabels(wrapper: ReturnType<typeof mountBar>["wrapper"]) {
    return wrapper.findAll("[data-project-bar-chip]").map((chip) => chip.text());
}

function pressed(wrapper: ReturnType<typeof mountBar>["wrapper"]) {
    return wrapper
        .findAll("[data-project-bar-chip]")
        .filter((chip) => chip.attributes("aria-pressed") === "true")
        .map((chip) => chip.text());
}

describe("ProjectBar", () => {
    it("renders nothing while projects are shown as tags", () => {
        const { wrapper, projectStore } = mountBar({}, false);

        expect(wrapper.find("[data-project-bar]").exists()).toBe(false);
        expect(projectStore.fetch).not.toHaveBeenCalled();
    });

    it("offers All plus the top-level projects and loads them", () => {
        const { wrapper, projectStore } = mountBar();

        expect(chipLabels(wrapper)).toEqual(["All", "lung", "spatial"]);
        expect(projectStore.fetch).toHaveBeenCalled();
    });

    it("marks the chip given by value as active", () => {
        expect(pressed(mountBar({ value: "lung" }).wrapper)).toEqual(["lung"]);
        expect(pressed(mountBar({ value: null }).wrapper)).toEqual(["All"]);
    });

    it("emits the path and the exact list filter for a project, as the item spells it", async () => {
        const { wrapper } = mountBar();

        await wrapper.find("[data-project-bar-chip='lung']").trigger("click");

        expect(wrapper.emitted("select")).toEqual([["lung"]]);
        expect(wrapper.emitted("update:filterText")).toEqual([["tag:'project:Lung'"]]);
    });

    it("clears the filter for All", async () => {
        const { wrapper } = mountBar({ value: "lung" });

        await wrapper.find("[data-project-bar-chip='']").trigger("click");

        expect(wrapper.emitted("select")).toEqual([[null]]);
        expect(wrapper.emitted("update:filterText")).toEqual([[""]]);
    });

    it("works out the active chip from the filter text when no value is given", () => {
        expect(pressed(mountBar({ filterText: "tag:'project:Lung'" }).wrapper)).toEqual(["lung"]);
        expect(pressed(mountBar({ filterText: "" }).wrapper)).toEqual(["All"]);
        expect(pressed(mountBar({ filterText: "tag:'project:lung/scrna'" }).wrapper)).toEqual([]);
        expect(pressed(mountBar({ filterText: "name:foo" }).wrapper)).toEqual([]);
    });
});
