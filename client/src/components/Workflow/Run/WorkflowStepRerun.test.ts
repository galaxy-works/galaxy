import { getLocalVue } from "@tests/vitest/helpers";
import { shallowMount } from "@vue/test-utils";
import flushPromises from "flush-promises";
import { createPinia } from "pinia";
import { describe, expect, it, vi } from "vitest";

import { getRunData, invokeWorkflow } from "./services";

import WorkflowStepRerun from "./WorkflowStepRerun.vue";
import GButton from "@/components/BaseComponents/GButton.vue";
import WorkflowRunDefaultStep from "@/components/Workflow/Run/WorkflowRunDefaultStep.vue";

type AnyRecord = Record<string, any>;

vi.mock("./services", () => ({ getRunData: vi.fn(), invokeWorkflow: vi.fn() }));
vi.mock("vue-router", async (importOriginal) => ({
    ...((await importOriginal()) as object),
    useRouter: () => ({ push: vi.fn() }),
}));

const localVue = getLocalVue();

function runData(toolInputs: AnyRecord[]): AnyRecord {
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

function toolStep(index: number, name: string, label: string | null, targets: number[]): AnyRecord {
    return {
        step_index: index,
        step_type: "tool",
        step_name: name,
        step_label: label,
        id: `tool_${index}`,
        inputs: [
            { name: "input", type: "data", optional: false, value: null },
            { name: "lines", type: "integer", value: 10 },
        ],
        output_connections: targets.map((target) => ({
            input_step_index: target,
            output_step_index: index,
            input_name: "input",
            output_name: "out_file1",
        })),
    };
}

/** 0 -> 1 -> 2 -> 4 and 0 -> 3 (a sibling branch of step 1) */
function branchedRunData(): AnyRecord {
    return {
        ...runData([]),
        name: "Branched",
        steps: [
            {
                step_index: 0,
                step_type: "data_input",
                step_name: "Input dataset",
                step_label: "reads",
                inputs: [],
                output_connections: [1, 3].map((target) => ({
                    input_step_index: target,
                    output_step_index: 0,
                    input_name: "input",
                    output_name: "output",
                })),
            },
            toolStep(1, "Filter", null, [2]),
            toolStep(2, "Sort", "sorted rows", [4]),
            toolStep(3, "Count", null, []),
            toolStep(4, "Concatenate", null, []),
        ],
    };
}

async function mountStepRerun(data: AnyRecord, stepIndex = 0) {
    vi.mocked(getRunData).mockResolvedValue(data);
    const wrapper = shallowMount(WorkflowStepRerun as object, {
        propsData: {
            invocationId: "invocation-id",
            stepIndex,
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

    it("lists the edited step and its downstream steps, leaving the sibling branch out", async () => {
        const wrapper = await mountStepRerun(branchedRunData(), 1);
        const plan = wrapper.find("[data-description='step rerun plan']");
        const entries = plan.findAll("li").map((entry) => entry.text().replace(/\s+/g, " "));
        expect(entries).toEqual(["2: Filter (edited)", "3: sorted rows", "5: Concatenate"]);
        expect(plan.text()).not.toContain("Count");
        expect(plan.text()).toContain("The remaining steps are expected to reuse their previous jobs.");
    });

    it("lists only the edited step when nothing is downstream of it", async () => {
        const wrapper = await mountStepRerun(branchedRunData(), 3);
        const entries = wrapper.findAll("[data-description='step rerun plan'] li").map((entry) => entry.text());
        expect(entries).toHaveLength(1);
        expect(entries[0]).toContain("4: Count");
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
