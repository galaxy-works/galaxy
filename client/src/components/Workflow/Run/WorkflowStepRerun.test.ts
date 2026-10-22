import { getLocalVue } from "@tests/vitest/helpers";
import { mount } from "@vue/test-utils";
import flushPromises from "flush-promises";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { h } from "vue";

import type { WorkflowInvocationRequest } from "@/api/invocations";

import { getRunData } from "./services";

import WorkflowStepRerun from "./WorkflowStepRerun.vue";

type AnyRecord = Record<string, any>;

const invocationStore = {
    fetchInvocationById: vi.fn(),
    fetchInvocationJobsSummaryForId: vi.fn(),
    getInvocationLoadError: vi.fn(),
};

vi.mock("@/stores/invocationStore", () => ({
    useInvocationStore: () => invocationStore,
}));

vi.mock("./services", () => ({
    getRunData: vi.fn(),
    invokeWorkflow: vi.fn(),
}));

vi.mock("@/components/Workflow/Run/WorkflowRunDefaultStep.vue", () => ({
    default: {
        name: "WorkflowRunDefaultStep",
        props: ["model", "validationScrollTo", "historyId"],
        render: () => h("div", { class: "run-default-step" }),
    },
}));

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
function branchedRunData(extra: AnyRecord = {}): AnyRecord {
    return {
        name: "Branched",
        id: "workflow-id",
        history_id: "history-id",
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
        ...extra,
    };
}

const request = {
    workflow_id: "workflow-id",
    history_id: "history-id",
    inputs: { "0": { id: "dataset-id", src: "hda" } },
    parameters: { "1": { lines: 20 } },
} as unknown as WorkflowInvocationRequest;

async function mountStepRerun(stepIndex: number) {
    const wrapper = mount(WorkflowStepRerun as object, {
        props: { invocationId: "invocation-id", stepIndex, request },
        global: getLocalVue(),
    });
    await flushPromises();
    return wrapper;
}

describe("WorkflowStepRerun", () => {
    beforeEach(() => {
        vi.mocked(getRunData).mockReset();
        vi.mocked(getRunData).mockResolvedValue(branchedRunData());
        invocationStore.fetchInvocationById.mockReset();
        invocationStore.fetchInvocationById.mockResolvedValue({ id: "invocation-id", state: "scheduled" });
        invocationStore.fetchInvocationJobsSummaryForId.mockReset();
        invocationStore.fetchInvocationJobsSummaryForId.mockResolvedValue({
            populated_state: "ok",
            states: { ok: 4 },
        });
    });

    it("renders the step form when every gate passes", async () => {
        const wrapper = await mountStepRerun(1);
        expect(wrapper.find(".run-default-step").exists()).toBe(true);
        expect(wrapper.find(".workflow-step-rerun-gate").exists()).toBe(false);
        expect(wrapper.find("#rerun-step").exists()).toBe(true);
    });

    it("lists the edited step and its downstream steps, leaving the sibling branch out", async () => {
        const wrapper = await mountStepRerun(1);
        const plan = wrapper.find(".workflow-step-rerun-plan");
        const entries = plan.findAll("li").map((entry) => entry.text().replace(/\s+/g, " "));
        expect(entries).toEqual(["2: Filter (edited)", "3: sorted rows", "5: Concatenate"]);
        expect(plan.text()).not.toContain("Count");
        expect(plan.text()).toContain("The remaining steps are expected to reuse their previous jobs.");
    });

    it("lists only the edited step when nothing is downstream of it", async () => {
        const wrapper = await mountStepRerun(3);
        const entries = wrapper.findAll(".workflow-step-rerun-plan li").map((entry) => entry.text());
        expect(entries).toHaveLength(1);
        expect(entries[0]).toContain("4: Count");
    });

    it("explains a failed gate and links to the whole-workflow rerun instead of showing the form", async () => {
        vi.mocked(getRunData).mockResolvedValue(
            branchedRunData({ workflow_resource_parameters: { priority: { name: "priority" } } }),
        );
        const wrapper = await mountStepRerun(1);
        const gate = wrapper.find(".workflow-step-rerun-gate");
        expect(gate.text()).toContain("resource parameters");
        expect(gate.text()).toContain("Opens the full run form; this run's step settings are not carried over.");
        expect(gate.find("a").attributes("href")).toContain("/workflows/rerun?invocation_id=invocation-id");
        expect(wrapper.find(".run-default-step").exists()).toBe(false);
        expect(wrapper.find("#rerun-step").exists()).toBe(false);
    });

    it("gates an invocation that has not finished", async () => {
        invocationStore.fetchInvocationById.mockResolvedValue({ id: "invocation-id", state: "ready" });
        const wrapper = await mountStepRerun(1);
        expect(wrapper.find(".workflow-step-rerun-gate").text()).toContain("still running");
        expect(wrapper.find(".run-default-step").exists()).toBe(false);
    });
});
