import type { WorkflowInvocationRequest } from "@/api/invocations";
import { visitInputs } from "@/components/Form/utilities";

export type StepParameters = Record<string, unknown>;
type RunInput = Record<string, any>;
type RunStep = Record<string, any>;

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
 * Connected inputs are dropped from that bag the same way the full run form does it. The
 * lineage fields let the job cache prefer the source invocation's jobs and the new invocation
 * link back to it.
 */
export function buildStepRerunPayload(
    request: WorkflowInvocationRequest,
    invocationId: string,
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
        rerun_of_invocation_id: invocationId,
        rerun_step_index: stepIndex,
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
