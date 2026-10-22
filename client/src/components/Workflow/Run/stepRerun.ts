import type { InvocationJobsSummary, WorkflowInvocationRequest } from "@/api/invocations";
import { visitInputs } from "@/components/Form/utilities";
import { isTerminal } from "@/components/WorkflowInvocationState/util";

import type { WorkflowRunModel } from "./model";

export type StepParameters = Record<string, unknown>;
type RunInput = Record<string, any>;
type RunStep = Record<string, any>;

export type StepRerunGate = { ok: true } | { ok: false; reason: string };

/** Invocation states after which the scheduler is done with the invocation */
const SCHEDULING_TERMINAL_STATES = ["scheduled", "cancelled", "failed", "completed"];

/** Conditionals pick their case from the test parameter's value, so more passes than nesting depth are never needed in practice. */
const MAX_OVERLAY_PASSES = 5;

/** The form shows the server's ``text_value`` for some inputs, so refresh it for scalar overrides. */
function previewText(input: RunInput, value: unknown): string | undefined {
    if (Array.isArray(input.options)) {
        const option = input.options.find(
            (entry: unknown) => Array.isArray(entry) && String(entry[1]) === String(value),
        );
        if (option) {
            return String(option[0]);
        }
    }
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        return String(value);
    }
    return undefined;
}

/**
 * Set the values that ran onto a run-model inputs tree, in place. The request's step parameters
 * are the flat ``cond|param`` names the full run form submits; conditionals pick their case from
 * the test parameter's current value, so keep visiting until no new name is placed. Repeats keep
 * the cardinality the workflow saved. Every value is left in an open field rather than behind the
 * run form's collapsed "Edit" toggle, which would start from the tool default.
 */
export function applyStepOverrides(
    inputs: RunInput[],
    overrides: StepParameters,
): { placed: string[]; unplaced: string[] } {
    const placed = new Set<string>();
    for (let pass = 0; pass < MAX_OVERLAY_PASSES; pass++) {
        let changed = false;
        visitInputs(inputs, (input: RunInput, name: string) => {
            if (name in overrides && !placed.has(name)) {
                input.value = overrides[name];
                const preview = previewText(input, overrides[name]);
                if (preview !== undefined) {
                    input.text_value = preview;
                }
                placed.add(name);
                changed = true;
            }
        });
        if (!changed) {
            break;
        }
    }
    visitInputs(inputs, (input: RunInput) => {
        delete input.collapsible_value;
        delete input.collapsible_preview;
    });
    return {
        placed: Array.from(placed),
        unplaced: Object.keys(overrides).filter((name) => !placed.has(name)),
    };
}

/**
 * The exported request posted back with one step's bag replaced by the edited form values.
 * Connected inputs are dropped from that bag the same way the full run form does it.
 */
export function buildStepRerunPayload(
    request: WorkflowInvocationRequest,
    stepIndex: number,
    stepData: StepParameters,
    connectedNames: Iterable<string>,
) {
    const connected = new Set(connectedNames);
    const editedStepParameters: StepParameters = {};
    for (const [inputName, inputValue] of Object.entries(stepData)) {
        if (!connected.has(inputName)) {
            editedStepParameters[inputName] = inputValue;
        }
    }
    return {
        history_id: request.history_id,
        inputs: request.inputs,
        inputs_by: request.inputs_by,
        replacement_params: request.replacement_params,
        resource_params: request.resource_params,
        preferred_object_store_id: request.preferred_object_store_id,
        preferred_intermediate_object_store_id: request.preferred_intermediate_object_store_id,
        preferred_outputs_object_store_id: request.preferred_outputs_object_store_id,
        use_cached_job: true,
        parameters: { ...(request.parameters ?? {}), [String(stepIndex)]: editedStepParameters },
        parameters_normalized: true,
        instance: true,
        require_exact_tool_versions: false,
    };
}

/**
 * Order indices of every step reachable from ``stepIndex`` through ``output_connections``
 * (the run data's per-step edges, keyed by ``input_step_index``), excluding the step itself.
 */
export function downstreamSteps(runModelSteps: RunStep[], stepIndex: number): number[] {
    const reached = new Set<number>();
    const queue = [stepIndex];
    let currentIndex: number | undefined;
    while ((currentIndex = queue.shift()) !== undefined) {
        const current = runModelSteps.find((step) => step?.step_index === currentIndex);
        for (const connection of current?.output_connections ?? []) {
            const target = connection.input_step_index;
            if (typeof target === "number" && target !== stepIndex && !reached.has(target)) {
                reached.add(target);
                queue.push(target);
            }
        }
    }
    return Array.from(reached).sort((a, b) => a - b);
}

/**
 * Why a single-step rerun cannot be offered for this step, or ``{ ok: true }``. The workflow-wide
 * checks are the ones that force the whole-workflow run form off its simple mode, read from the
 * same ``WorkflowRunModel`` flags.
 */
export function evaluateStepRerunGates(
    runModel: WorkflowRunModel,
    runData: { steps?: RunStep[] },
    step: number,
    invocation: { state?: string } | null | undefined,
    jobsSummary?: InvocationJobsSummary | null,
): StepRerunGate {
    const runStep = runModel.steps[step];
    if (!runStep) {
        return { ok: false, reason: `This workflow has no step with index ${step}.` };
    }
    if (runStep.step_type !== "tool") {
        return {
            ok: false,
            reason: `Only tool steps can be edited and rerun; step ${step + 1} is a ${runStep.step_type} step.`,
        };
    }
    const schedulingDone = SCHEDULING_TERMINAL_STATES.includes(invocation?.state ?? "");
    if (!schedulingDone || (jobsSummary && !isTerminal(jobsSummary))) {
        return {
            ok: false,
            reason: "This invocation is still running; a step can be edited and rerun once it has finished.",
        };
    }
    if (runModel.hasReplacementParametersInToolForm) {
        return {
            ok: false,
            reason: "This workflow uses ${...} replacement parameters inside tool steps, which only the full run form can fill in.",
        };
    }
    if (runModel.hasOpenToolSteps) {
        return {
            ok: false,
            reason: "This workflow has required inputs set at run time on tool steps, which only the full run form can collect.",
        };
    }
    if (runModel.hasWorkflowResourceParameters) {
        return {
            ok: false,
            reason: "This workflow requests resource parameters, which only the full run form can collect.",
        };
    }
    const messages = runData.steps?.[step]?.messages;
    if (messages && Object.keys(messages).length > 0) {
        return {
            ok: false,
            reason: "The tool in this step has changed since the workflow was saved and needs its upgrade reviewed in the full run form.",
        };
    }
    return { ok: true };
}
