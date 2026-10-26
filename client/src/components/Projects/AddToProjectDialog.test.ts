import { createTestingPinia } from "@pinia/testing";
import { getLocalVue } from "@tests/vitest/helpers";
import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";

import AddToProjectDialog from "./AddToProjectDialog.vue";

function mountDialog() {
    return mount(AddToProjectDialog as object, {
        global: getLocalVue(),
        pinia: createTestingPinia({ createSpy: vi.fn }),
        props: { show: true },
        attachTo: document.body,
    });
}

function addButton(wrapper: ReturnType<typeof mountDialog>) {
    return wrapper.findAll("button").find((button) => button.text() === "Add")!;
}

describe("AddToProjectDialog", () => {
    it("needs a project before it can add", async () => {
        const wrapper = mountDialog();
        await addButton(wrapper).trigger("click");
        expect(wrapper.emitted("ok")).toBeUndefined();
    });

    it("emits the normalized path, adding by default", async () => {
        const wrapper = mountDialog();
        await wrapper.find("#add-to-project-picker").setValue("Lung/ScRNA");
        await addButton(wrapper).trigger("click");
        expect(wrapper.emitted("ok")).toEqual([["lung/scrna", false]]);
    });

    it("emits move when the move box is checked", async () => {
        const wrapper = mountDialog();
        await wrapper.find("#add-to-project-picker").setValue("lung");
        await wrapper.find("#add-to-project-move").setValue(true);
        await addButton(wrapper).trigger("click");
        expect(wrapper.emitted("ok")).toEqual([["lung", true]]);
    });
});
