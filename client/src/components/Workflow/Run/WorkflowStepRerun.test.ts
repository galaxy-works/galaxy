import { getLocalVue } from "@tests/vitest/helpers";
import { shallowMount } from "@vue/test-utils";
import flushPromises from "flush-promises";
import { createPinia } from "pinia";
import { describe, expect, it, vi } from "vitest";

import { getRunData, invokeWorkflow } from "./services";

import WorkflowStepRerun from "./WorkflowStepRerun.vue";
import GButton from "@/components/BaseComponents/GButton.vue";
import WorkflowRunDefaultStep from "@/components/Workflow/Run/WorkflowRunDefaultStep.vue";

vi.mock("./services", () => ({ getRunData: vi.fn(), invokeWorkflow: vi.fn() }));
vi.mock("vue-router", async (importOriginal) => ({
    ...((await importOriginal()) as object),
    useRouter: () => ({ push: vi.fn() }),
}));

const localVue = getLocalVue();

function runData(toolInputs: Record<string, unknown>[]) {
    return {
        name: "Workflow",
        id: "workflow-id",
        history_id: "history-id",
        has_upgrade_messages: false,
        step_version_changes: [],
        workflow_resource_parameters: {},
        steps: [{ step_type: "tool", step_name: "Cut", inputs: toolInputs, output_connections: [] }],
    };
}

async function mountStepRerun(data: ReturnType<typeof runData>) {
    vi.mocked(getRunData).mockResolvedValue(data);
    const wrapper = shallowMount(WorkflowStepRerun as object, {
        propsData: {
            invocationId: "invocation-id",
            stepIndex: 0,
            request: { workflow_id: "workflow-id", history_id: "history-id", parameters: {} },
        },
        localVue,
        pinia: createPinia(),
    });
    await flushPromises();
    return wrapper;
}

describe("WorkflowStepRerun", () => {
    it("shows the gate reason and the full rerun link instead of the step form for a gated workflow", async () => {
        const wrapper = await mountStepRerun(runData([{ name: "input1", type: "data", optional: false, value: null }]));
        const gate = wrapper.find("[data-description='step rerun gate']");
        expect(gate.attributes("data-gate-code")).toBe("disconnected-inputs");
        expect(gate.text()).toContain("steps can't be edited individually yet");
        const link = wrapper.find("[data-description='step rerun full rerun link']");
        expect(link.attributes("to")).toBe("/workflows/rerun?invocation_id=invocation-id");
        expect(link.text()).toBe("Opens the full run form; this run's step settings are not carried over.");
        expect(wrapper.findComponent(WorkflowRunDefaultStep).exists()).toBe(false);
    });

    it("renders the step form for an eligible step", async () => {
        const wrapper = await mountStepRerun(runData([{ name: "delimiter", type: "text", value: "," }]));
        expect(wrapper.find("[data-description='step rerun gate']").exists()).toBe(false);
        expect(wrapper.findComponent(WorkflowRunDefaultStep).exists()).toBe(true);
    });

    it("names the source invocation and the edited step in the submit payload", async () => {
        const wrapper = await mountStepRerun(runData([{ name: "delimiter", type: "text", value: "," }]));
        vi.mocked(invokeWorkflow).mockResolvedValue({ id: "new-invocation-id" });
        wrapper.findComponent(GButton).vm.$emit("click");
        await flushPromises();
        expect(invokeWorkflow).toHaveBeenCalledTimes(1);
        const [workflowId, payload] = vi.mocked(invokeWorkflow).mock.calls[0]!;
        expect(workflowId).toBe("workflow-id");
        expect(payload).toMatchObject({
            rerun_of_invocation_id: "invocation-id",
            rerun_step_index: 0,
            use_cached_job: true,
        });
    });
});
