import { getLocalVue } from "@tests/vitest/helpers";
import { mount } from "@vue/test-utils";
import flushPromises from "flush-promises";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as ProjectActions from "./useProjectActions";

import ProjectHistoryDialog from "./ProjectHistoryDialog.vue";

const createHistoryInProject = vi.fn();

vi.mock("./useProjectActions", async (importOriginal) => ({
    ...(await importOriginal<typeof ProjectActions>()),
    useProjectActions: () => ({ createHistoryInProject }),
}));

function mountDialog(props: { parentPath?: string; newProject?: boolean }) {
    return mount(ProjectHistoryDialog as object, {
        global: getLocalVue(),
        props: { show: true, ...props },
        attachTo: document.body,
    });
}

async function clickCreate(wrapper: ReturnType<typeof mountDialog>) {
    const create = wrapper.findAll("button").find((button) => button.text() === "Create");
    await create!.trigger("click");
    await flushPromises();
}

describe("ProjectHistoryDialog", () => {
    beforeEach(() => {
        createHistoryInProject.mockReset();
        createHistoryInProject.mockResolvedValue("new1");
    });

    it("creates a history in the given project", async () => {
        const wrapper = mountDialog({ parentPath: "lung" });
        expect(wrapper.find("#project-history-dialog-project").exists()).toBe(false);
        await wrapper.find("#project-history-dialog-history").setValue("Run 1");
        await clickCreate(wrapper);

        expect(createHistoryInProject).toHaveBeenCalledWith("lung", "Run 1");
        expect(wrapper.emitted("created")).toEqual([["lung"]]);
        expect(wrapper.emitted("update:show")?.at(-1)).toEqual([false]);
    });

    it("creates a new subproject through a history tagged with it", async () => {
        const wrapper = mountDialog({ parentPath: "lung", newProject: true });
        await wrapper.find("#project-history-dialog-project").setValue(" ScRNA ");

        const help = wrapper.find("[data-project-history-dialog-help]").text();
        expect(help).toContain("A project is a tag");
        expect(help).toContain("project:lung/scrna");

        await clickCreate(wrapper);
        expect(createHistoryInProject).toHaveBeenCalledWith("lung/scrna", "");
        expect(wrapper.emitted("created")).toEqual([["lung/scrna"]]);
    });

    it("needs a name for a new project", async () => {
        const wrapper = mountDialog({ newProject: true });
        await clickCreate(wrapper);
        expect(createHistoryInProject).not.toHaveBeenCalled();
        expect(wrapper.emitted("created")).toBeUndefined();
    });

    it("stays open and shows the error when creation fails", async () => {
        createHistoryInProject.mockRejectedValue(new Error("Creation broke"));
        const wrapper = mountDialog({ newProject: true });
        await wrapper.find("#project-history-dialog-project").setValue("brain");
        await clickCreate(wrapper);

        expect(wrapper.text()).toContain("Creation broke");
        expect(wrapper.emitted("created")).toBeUndefined();
        expect(wrapper.emitted("update:show")?.some(([show]) => show === false)).toBeFalsy();
    });
});
