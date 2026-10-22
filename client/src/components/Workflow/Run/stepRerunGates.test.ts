import { describe, expect, it } from "vitest";

import { WorkflowRunModel } from "./model";
import { evaluateStepRerunGates, type StepRerunGateModel } from "./stepRerunGates";
import sampleRunData1 from "./testdata/run1.json";

function buildModel(overrides: Partial<StepRerunGateModel> = {}): StepRerunGateModel {
    return {
        steps: [
            { step_type: "data_input" },
            { step_type: "tool" },
            { step_type: "subworkflow" },
            { step_type: "tool", messages: { input1: "This parameter was upgraded" } },
        ],
        hasReplacementParametersInToolForm: false,
        hasOpenToolSteps: false,
        hasWorkflowResourceParameters: false,
        ...overrides,
    };
}

describe("evaluateStepRerunGates", () => {
    it("allows a clean tool step", () => {
        expect(evaluateStepRerunGates(buildModel(), 1)).toEqual({ eligible: true });
    });

    it("allows a tool step with an empty messages object", () => {
        const model = buildModel({ steps: [{ step_type: "tool", messages: {} }] });
        expect(evaluateStepRerunGates(model, 0)).toEqual({ eligible: true });
    });

    it("rejects a step index the workflow does not have", () => {
        const result = evaluateStepRerunGates(buildModel(), 7);
        expect(result).toMatchObject({ eligible: false, code: "missing-step" });
    });

    it("rejects steps inside a subworkflow's own invocation", () => {
        const result = evaluateStepRerunGates(buildModel(), 1, { isSubworkflowInvocation: true });
        expect(result).toMatchObject({ eligible: false, code: "subworkflow-invocation" });
    });

    it("rejects non-tool steps", () => {
        expect(evaluateStepRerunGates(buildModel(), 0)).toMatchObject({ eligible: false, code: "not-tool-step" });
        expect(evaluateStepRerunGates(buildModel(), 2)).toMatchObject({ eligible: false, code: "not-tool-step" });
    });

    it("rejects tool steps with upgrade messages", () => {
        const result = evaluateStepRerunGates(buildModel(), 3);
        expect(result).toMatchObject({ eligible: false, code: "upgrade-messages" });
    });

    it("rejects workflows with replacement parameters inside tool steps", () => {
        const result = evaluateStepRerunGates(buildModel({ hasReplacementParametersInToolForm: true }), 1);
        expect(result).toMatchObject({ eligible: false, code: "replacement-parameters" });
    });

    it("rejects workflows with disconnected required runtime inputs", () => {
        const result = evaluateStepRerunGates(buildModel({ hasOpenToolSteps: true }), 1);
        expect(result).toMatchObject({ eligible: false, code: "disconnected-inputs" });
    });

    it("rejects workflows with workflow resource parameters", () => {
        const result = evaluateStepRerunGates(buildModel({ hasWorkflowResourceParameters: true }), 1);
        expect(result).toMatchObject({ eligible: false, code: "resource-parameters" });
    });

    it("reports the same workflow-shape reason the full run form shows when several apply", () => {
        const model = buildModel({
            hasReplacementParametersInToolForm: true,
            hasOpenToolSteps: true,
            hasWorkflowResourceParameters: true,
        });
        expect(evaluateStepRerunGates(model, 1)).toMatchObject({ code: "resource-parameters" });
    });

    it("gives every failed gate a distinct, user-facing reason", () => {
        const failures = [
            evaluateStepRerunGates(buildModel(), 7),
            evaluateStepRerunGates(buildModel(), 1, { isSubworkflowInvocation: true }),
            evaluateStepRerunGates(buildModel(), 0),
            evaluateStepRerunGates(buildModel(), 3),
            evaluateStepRerunGates(buildModel({ hasReplacementParametersInToolForm: true }), 1),
            evaluateStepRerunGates(buildModel({ hasOpenToolSteps: true }), 1),
            evaluateStepRerunGates(buildModel({ hasWorkflowResourceParameters: true }), 1),
        ];
        const reasons = failures.map((result) => (result.eligible ? "" : result.reason));
        expect(reasons.every((reason) => reason.length > 20)).toBe(true);
        expect(new Set(reasons).size).toBe(reasons.length);
    });

    it("reads the predicates from a real WorkflowRunModel", () => {
        // run1.json has a tool step with a disconnected required data input
        const model = new WorkflowRunModel(sampleRunData1);
        expect(evaluateStepRerunGates(model, 1)).toMatchObject({ eligible: false, code: "disconnected-inputs" });
    });
});
