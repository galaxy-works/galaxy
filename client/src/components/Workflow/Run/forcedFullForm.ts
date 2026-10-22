/** The workflow-shape flags `WorkflowRunModel` computes that decide whether the simple run form can be used. */
export interface RunFormShape {
    hasReplacementParametersInToolForm: boolean;
    hasOpenToolSteps: boolean;
    hasWorkflowResourceParameters: boolean;
}

export type ForcedFullFormReason =
    | "hasReplacementParameters"
    | "hasDisconnectedInputs"
    | "hasWorkflowResourceParameters";

/**
 * Why this workflow must be run with the full (legacy) run form, if it must.
 * When several apply, the precedence matches the order the run form has always reported them in.
 */
export function getForcedFullFormReason(model: RunFormShape): ForcedFullFormReason | undefined {
    // Just render the whole form for resource request parameters (kind of
    // niche - I'm not sure anyone is using these currently anyway).
    if (model.hasWorkflowResourceParameters) {
        return "hasWorkflowResourceParameters";
    }
    // If there are required parameters in a tool form (a disconnected runtime
    // input), we have to render the tool form steps and cannot use the
    // simplified tool form.
    if (model.hasOpenToolSteps) {
        return "hasDisconnectedInputs";
    }
    // These only work with PJA - the API doesn't evaluate them at
    // all outside that context currently. The main workflow form renders
    // these dynamically and takes care of all the validation and setup details
    // on the frontend. If these are implemented on the backend at some
    // point this restriction can be lifted.
    if (model.hasReplacementParametersInToolForm) {
        return "hasReplacementParameters";
    }
    return undefined;
}
