import { describe, expect, it } from "vitest";

import type { InvocationJobsSummary, WorkflowInvocationRequest } from "@/api/invocations";

import { WorkflowRunModel } from "./model";
import { applyStepOverrides, buildStepRerunPayload, downstreamSteps, evaluateStepRerunGates } from "./stepRerun";

type AnyRecord = Record<string, any>;

function conditionalInputs(): AnyRecord[] {
    return [
        { name: "threshold", type: "integer", value: 1, collapsible_value: 1, collapsible_preview: true },
        {
            name: "mode",
            type: "conditional",
            test_param: {
                name: "kind",
                type: "select",
                value: "fast",
                options: [
                    ["Fast", "fast"],
                    ["Thorough", "thorough"],
                ],
            },
            cases: [
                { value: "fast", inputs: [{ name: "speed", type: "integer", value: 3 }] },
                { value: "thorough", inputs: [{ name: "depth", type: "integer", value: 1 }] },
            ],
        },
    ];
}

function repeatInputs(): AnyRecord[] {
    return [
        {
            name: "queries",
            type: "repeat",
            cache: [[{ name: "q", type: "text", value: "a" }], [{ name: "q", type: "text", value: "b" }]],
        },
    ];
}

/** 0 -> 1 -> 2 -> 4 and 0 -> 3 (a sibling branch of step 1) */
function branchedRunData(overrides: { steps?: Record<number, AnyRecord>; [key: string]: unknown } = {}): AnyRecord {
    const { steps: stepOverrides = {}, ...rest } = overrides;
    const steps: AnyRecord[] = [
        {
            step_index: 0,
            step_type: "data_input",
            step_name: "Input dataset",
            step_label: "reads",
            inputs: [],
            output_connections: [
                { input_step_index: 1, output_step_index: 0, input_name: "input", output_name: "output" },
                { input_step_index: 3, output_step_index: 0, input_name: "input", output_name: "output" },
            ],
        },
        toolStep(1, "Filter", [{ input_step_index: 2, input_name: "input", output_name: "out_file1" }]),
        toolStep(2, "Sort", [{ input_step_index: 4, input_name: "input", output_name: "out_file1" }]),
        toolStep(3, "Count", []),
        toolStep(4, "Concatenate", []),
    ];
    for (const [index, override] of Object.entries(stepOverrides)) {
        Object.assign(steps[Number(index)]!, override);
    }
    return { name: "Branched", id: "workflow-id", history_id: "history-id", steps, ...rest };
}

function toolStep(index: number, name: string, outputs: AnyRecord[]): AnyRecord {
    return {
        step_index: index,
        step_type: "tool",
        step_name: name,
        step_label: null,
        id: `tool_${index}`,
        inputs: [
            { name: "input", type: "data", optional: false, value: null },
            { name: "lines", type: "integer", value: 10 },
        ],
        output_connections: outputs.map((connection) => ({ output_step_index: index, ...connection })),
    };
}

const finished = { state: "scheduled" };

function gate(runData: AnyRecord, step = 2, invocation: { state?: string } | null = finished, summary?: AnyRecord) {
    return evaluateStepRerunGates(
        new WorkflowRunModel(runData),
        runData,
        step,
        invocation,
        summary as InvocationJobsSummary | undefined,
    );
}

describe("applyStepOverrides", () => {
    it("sets flat values and opens every field", () => {
        const inputs = conditionalInputs();
        const result = applyStepOverrides(inputs, { threshold: 7 });
        expect(inputs[0]!.value).toBe(7);
        expect(inputs[0]!.collapsible_value).toBeUndefined();
        expect(inputs[0]!.collapsible_preview).toBeUndefined();
        expect(result).toEqual({ placed: ["threshold"], unplaced: [] });
    });

    it("switches a conditional case before placing the values inside it", () => {
        const inputs = conditionalInputs();
        const result = applyStepOverrides(inputs, { "mode|depth": 9, "mode|kind": "thorough" });
        const conditional = inputs[1]!;
        expect(conditional.test_param.value).toBe("thorough");
        expect(conditional.test_param.text_value).toBe("Thorough");
        expect(conditional.cases[1].inputs[0].value).toBe(9);
        expect(conditional.cases[0].inputs[0].value).toBe(3);
        expect(result.unplaced).toEqual([]);
        expect(result.placed.sort()).toEqual(["mode|depth", "mode|kind"]);
    });

    it("fills a repeat with the cardinality the workflow saved", () => {
        const inputs = repeatInputs();
        const result = applyStepOverrides(inputs, { "queries_0|q": "x", "queries_1|q": "y" });
        expect(inputs[0]!.cache.map((block: AnyRecord[]) => block[0]!.value)).toEqual(["x", "y"]);
        expect(result.unplaced).toEqual([]);
    });

    it("reports names that have no place on the form", () => {
        const inputs = repeatInputs();
        const result = applyStepOverrides(inputs, { "queries_0|q": "x", "queries_2|q": "z", gone: 1 });
        expect(inputs[0]!.cache).toHaveLength(2);
        expect(result.placed).toEqual(["queries_0|q"]);
        expect(result.unplaced).toEqual(["queries_2|q", "gone"]);
    });
});

describe("buildStepRerunPayload", () => {
    const request = {
        workflow_id: "workflow-id",
        history_id: "history-id",
        inputs: { "0": { id: "dataset-id", src: "hda" } },
        inputs_by: "step_index",
        replacement_params: { name: "value" },
        resource_params: {},
        use_cached_job: false,
        parameters: {
            "1": { lines: 10, input: { values: [] } },
            "3": { lines: 5 },
        },
    } as unknown as WorkflowInvocationRequest;

    it("replaces only the edited step's bag and drops its connected inputs", () => {
        const payload = buildStepRerunPayload(request, 1, { lines: 20, input: { values: [] } }, ["input"]);
        expect(payload.parameters).toEqual({ "1": { lines: 20 }, "3": { lines: 5 } });
        expect(payload.parameters["3"]).toBe(request.parameters!["3"]);
        expect(payload.inputs).toBe(request.inputs);
        expect(payload.replacement_params).toBe(request.replacement_params);
        expect(payload).toMatchObject({
            history_id: "history-id",
            inputs_by: "step_index",
            use_cached_job: true,
            parameters_normalized: true,
            instance: true,
        });
    });

    it("adds a bag for a step the original request had none for", () => {
        const payload = buildStepRerunPayload(request, 2, { lines: 1 }, new Set<string>());
        expect(payload.parameters["2"]).toEqual({ lines: 1 });
        expect(payload.parameters["1"]).toBe(request.parameters!["1"]);
    });
});

describe("downstreamSteps", () => {
    const steps = new WorkflowRunModel(branchedRunData()).steps;

    it("follows connections transitively and leaves sibling branches out", () => {
        expect(downstreamSteps(steps, 1)).toEqual([2, 4]);
    });

    it("returns nothing for a terminal step", () => {
        expect(downstreamSteps(steps, 3)).toEqual([]);
    });

    it("covers both branches from the shared input", () => {
        expect(downstreamSteps(steps, 0)).toEqual([1, 2, 3, 4]);
    });
});

describe("evaluateStepRerunGates", () => {
    it("allows a tool step of a finished invocation", () => {
        const summary = { populated_state: "ok", states: { ok: 4 } };
        expect(gate(branchedRunData(), 2, finished, summary)).toEqual({ ok: true });
    });

    it("refuses a step that is not a tool step", () => {
        const result = gate(branchedRunData(), 0);
        expect(result.ok).toBe(false);
        expect(!result.ok && result.reason).toContain("data_input");
    });

    it("refuses a missing step", () => {
        expect(gate(branchedRunData(), 9).ok).toBe(false);
    });

    it("refuses an invocation that is still scheduling", () => {
        const result = gate(branchedRunData(), 2, { state: "ready" });
        expect(!result.ok && result.reason).toContain("still running");
    });

    it("refuses an invocation whose jobs are still running", () => {
        const summary = { populated_state: "ok", states: { ok: 2, running: 1 } };
        expect(gate(branchedRunData(), 2, finished, summary).ok).toBe(false);
    });

    it("refuses without an invocation", () => {
        expect(gate(branchedRunData(), 2, null).ok).toBe(false);
    });

    it("refuses replacement parameters inside a tool step", () => {
        const runData = branchedRunData({
            steps: { 3: { inputs: [{ name: "label", type: "text", value: "${sample}" }] } },
        });
        const result = gate(runData);
        expect(!result.ok && result.reason).toContain("replacement parameters");
    });

    it("refuses a disconnected required runtime input", () => {
        const runData = branchedRunData({
            steps: { 3: { inputs: [{ name: "lines", type: "integer", value: { __class__: "RuntimeValue" } }] } },
        });
        const result = gate(runData);
        expect(!result.ok && result.reason).toContain("set at run time");
    });

    it("refuses workflow resource parameters", () => {
        const runData = branchedRunData({ workflow_resource_parameters: { priority: { name: "priority" } } });
        const result = gate(runData);
        expect(!result.ok && result.reason).toContain("resource parameters");
    });

    it("refuses a tool with upgrade messages", () => {
        const runData = branchedRunData({ steps: { 2: { messages: { lines: "Value reset" } } } });
        const result = gate(runData);
        expect(!result.ok && result.reason).toContain("upgrade");
    });

    it("ignores upgrade messages on other steps", () => {
        const runData = branchedRunData({ steps: { 3: { messages: { lines: "Value reset" } } } });
        expect(gate(runData)).toEqual({ ok: true });
    });
});
