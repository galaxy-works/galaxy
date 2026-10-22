import { type ForcedFullFormReason, getForcedFullFormReason, type RunFormShape } from "./forcedFullForm";

/** The parts of `WorkflowRunModel` the gates read. */
export interface StepRerunGateModel extends RunFormShape {
    steps: { step_type?: string; messages?: unknown }[];
}

export interface StepRerunInvocationContext {
    /** The invocation being viewed is a subworkflow's own invocation, not the top-level one. */
    isSubworkflowInvocation?: boolean;
}

export type StepRerunGateCode =
    | "missing-step"
    | "subworkflow-invocation"
    | "not-tool-step"
    | "upgrade-messages"
    | "replacement-parameters"
    | "disconnected-inputs"
    | "resource-parameters";

export type StepRerunGateResult = { eligible: true } | { eligible: false; reason: string; code: StepRerunGateCode };

const WORKFLOW_SHAPE_GATES: Record<ForcedFullFormReason, { code: StepRerunGateCode; reason: string }> = {
    hasReplacementParameters: {
        code: "replacement-parameters",
        reason: "This workflow uses replacement parameters inside tool steps, so steps can't be edited individually yet.",
    },
    hasDisconnectedInputs: {
        code: "disconnected-inputs",
        reason: "This workflow has tool steps with required inputs that are set when the workflow is run rather than connected, so steps can't be edited individually yet.",
    },
    hasWorkflowResourceParameters: {
        code: "resource-parameters",
        reason: "This workflow uses workflow resource parameters, so steps can't be edited individually yet.",
    },
};

function hasMessages(messages: unknown): boolean {
    if (!messages) {
        return false;
    }
    if (Array.isArray(messages)) {
        return messages.length > 0;
    }
    return typeof messages !== "object" || Object.keys(messages).length > 0;
}

function fail(code: StepRerunGateCode, reason: string): StepRerunGateResult {
    return { eligible: false, code, reason };
}

/**
 * Whether one step of a finished invocation can be edited and rerun on its own. The workflow-shape gates
 * apply to the whole workflow, not just the edited step, so the answer is the same for every step.
 */
export function evaluateStepRerunGates(
    model: StepRerunGateModel,
    stepIndex: number,
    context: StepRerunInvocationContext = {},
): StepRerunGateResult {
    const step = model.steps[stepIndex];
    if (!step) {
        return fail("missing-step", `This workflow has no step ${stepIndex + 1}, so it can't be edited and rerun.`);
    }
    if (context.isSubworkflowInvocation) {
        return fail(
            "subworkflow-invocation",
            "This is a subworkflow's invocation. Steps inside a subworkflow can't be edited individually yet; rerun the workflow that contains it instead.",
        );
    }
    if (step.step_type !== "tool") {
        return fail(
            "not-tool-step",
            `Only tool steps can be edited and rerun; step ${stepIndex + 1} is a ${(step.step_type ?? "non-tool").replace(/_/g, " ")} step.`,
        );
    }
    if (hasMessages(step.messages)) {
        return fail(
            "upgrade-messages",
            `The tool in step ${stepIndex + 1} has changed since this workflow was saved and its parameters need upgrading, so it can't be edited individually until the workflow is updated in the editor.`,
        );
    }
    const forcedReason = getForcedFullFormReason(model);
    if (forcedReason) {
        const gate = WORKFLOW_SHAPE_GATES[forcedReason];
        return fail(gate.code, gate.reason);
    }
    return { eligible: true };
}
