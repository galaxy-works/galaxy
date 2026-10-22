import { getLocalVue } from "@tests/vitest/helpers";
import { shallowMount } from "@vue/test-utils";
import flushPromises from "flush-promises";
import { createPinia, setActivePinia } from "pinia";
import { describe, expect, it } from "vitest";

import { useServerMock } from "@/api/client/__mocks__/index";

import InvocationRerunOrigin from "./InvocationRerunOrigin.vue";

const { server, http } = useServerMock();

const localVue = getLocalVue();

const invocation = {
    id: "new-invocation-id",
    steps: [
        { order_index: 0, workflow_step_label: "input" },
        { order_index: 1, workflow_step_label: "Cut columns" },
    ],
};

async function mountOrigin(request: Record<string, unknown>) {
    server.use(
        http.get("/api/invocations/{invocation_id}/request", ({ response }) => {
            return response(200).json({ workflow_id: "workflow-id", history_id: "history-id", ...request } as never);
        }),
    );
    const pinia = createPinia();
    setActivePinia(pinia);
    const wrapper = shallowMount(InvocationRerunOrigin as object, {
        propsData: { invocation },
        localVue,
        pinia,
    });
    await flushPromises();
    return wrapper;
}

describe("InvocationRerunOrigin", () => {
    it("links the source invocation and names the edited step", async () => {
        const wrapper = await mountOrigin({ rerun_of_invocation_id: "source-invocation-id", rerun_step_index: 1 });
        const line = wrapper.find("[data-description='invocation rerun origin']");
        expect(line.exists()).toBe(true);
        expect(line.text()).toContain("Rerun of invocation");
        expect(line.text()).toContain("step 2 (Cut columns)");
        const link = wrapper.find("[data-description='invocation rerun origin link']");
        expect(link.attributes("to")).toBe("/workflows/invocations/source-invocation-id");
    });

    it("renders nothing for an invocation that is not a rerun", async () => {
        const wrapper = await mountOrigin({});
        expect(wrapper.find("[data-description='invocation rerun origin']").exists()).toBe(false);
    });
});
