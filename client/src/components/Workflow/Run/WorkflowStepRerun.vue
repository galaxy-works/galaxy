<script setup lang="ts">
import { faRedo } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/vue-fontawesome";
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";

import type { WorkflowInvocationRequest } from "@/api/invocations";
import type { FormData } from "@/components/Form/composables/useFormState";
import { visitInputs } from "@/components/Form/utilities";
import { errorMessageAsString } from "@/utils/simple-error";

import { WorkflowRunModel } from "./model";
import { getRunData, invokeWorkflow } from "./services";
import { evaluateStepRerunGates, type StepRerunGateResult } from "./stepRerunGates";

import GAlert from "@/components/BaseComponents/GAlert.vue";
import GButton from "@/components/BaseComponents/GButton.vue";
import GLink from "@/components/BaseComponents/GLink.vue";
import Heading from "@/components/Common/Heading.vue";
import LoadingSpan from "@/components/LoadingSpan.vue";
import WorkflowRunDefaultStep from "@/components/Workflow/Run/WorkflowRunDefaultStep.vue";

type StepParameters = Record<string, unknown>;

interface Props {
    invocationId: string;
    /** Order index of the step being edited */
    stepIndex: number;
    /** The exported request of the invocation being rerun */
    request: WorkflowInvocationRequest;
}

const props = defineProps<Props>();

const router = useRouter();

const loading = ref(true);
const loadError = ref("");
const submitError = ref("");
const submitting = ref(false);
const model = ref<WorkflowRunModel>();
const gateFailure = ref<Extract<StepRerunGateResult, { eligible: false }>>();
const step = ref<Record<string, any>>();
/** Names of the step's inputs whose value was set at run time on the original invocation */
const runtimeOverrides = ref<string[]>([]);
/** Run-time overrides of the original request that could not be placed on the form */
const unplacedOverrides = ref<string[]>([]);
const stepData = ref<FormData>({});
const stepValidation = ref<[string, string] | null>(null);
const validationScrollTo = ref<[string, string] | []>([]);

const stepKey = computed(() => String(props.stepIndex));
const stepTitle = computed(() => step.value?.step_label || step.value?.step_name || `Step ${props.stepIndex + 1}`);
const invocationLink = computed(() => `/workflows/invocations/${props.invocationId}`);
const fullRerunLink = computed(() => `/workflows/rerun?invocation_id=${props.invocationId}`);

/** The collapsed form element shows the server's ``text_value`` of the saved value, so refresh it for scalar overrides. */
function previewText(input: Record<string, any>, value: unknown): string | undefined {
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
 * Set the values that ran on the run-model inputs tree. The request's step parameters are
 * the flat ``cond|param`` names the full run form submits; conditionals pick their case
 * from the test parameter's current value, so keep visiting until no new name is placed.
 */
function applyOverrides(inputs: Record<string, any>[], overrides: StepParameters) {
    const placed = new Set<string>();
    for (let pass = 0; pass < 5; pass++) {
        let changed = false;
        visitInputs(inputs, (input: Record<string, any>, name: string) => {
            if (name in overrides && !placed.has(name)) {
                input.value = overrides[name];
                if (input.collapsible_value !== undefined) {
                    // "Undo" in the form restores the value that ran, not the saved workflow default
                    input.collapsible_value = overrides[name];
                }
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
    runtimeOverrides.value = Array.from(placed);
    unplacedOverrides.value = Object.keys(overrides).filter((name) => !placed.has(name));
    // The run form collapses saved values behind an "Edit" toggle that starts from the tool default;
    // here every value that ran is shown in an open field instead.
    visitInputs(inputs, (input: Record<string, any>) => {
        delete input.collapsible_value;
        delete input.collapsible_preview;
    });
}

async function load() {
    loading.value = true;
    loadError.value = "";
    try {
        const runData = await getRunData(props.request.workflow_id, undefined, true);
        const runModel = new WorkflowRunModel(runData);
        const gate = evaluateStepRerunGates(runModel, props.stepIndex);
        if (!gate.eligible) {
            gateFailure.value = gate;
            return;
        }
        const runStep = runModel.steps[props.stepIndex];
        const overrides = (props.request.parameters?.[stepKey.value] ?? {}) as StepParameters;
        applyOverrides(runStep.inputs, overrides);
        runStep.expanded = true;
        model.value = runModel;
        step.value = runStep;
    } catch (e) {
        loadError.value = errorMessageAsString(e);
    } finally {
        loading.value = false;
    }
}

function onStepChange(_index: string, data: FormData) {
    stepData.value = data;
}

function onStepValidation(_index: string, validation: [string, string] | null) {
    stepValidation.value = validation;
}

function isConnected(inputName: string) {
    return Boolean(model.value?.parms[props.stepIndex]?.[inputName]?.connected);
}

async function onRerun() {
    if (stepValidation.value) {
        validationScrollTo.value = stepValidation.value.slice() as [string, string];
        return;
    }
    const editedStepParameters: StepParameters = {};
    for (const [inputName, inputValue] of Object.entries(stepData.value)) {
        if (!isConnected(inputName)) {
            editedStepParameters[inputName] = inputValue;
        }
    }
    const request = props.request;
    const payload = {
        history_id: request.history_id,
        inputs: request.inputs,
        inputs_by: request.inputs_by,
        replacement_params: request.replacement_params,
        resource_params: request.resource_params,
        preferred_object_store_id: request.preferred_object_store_id,
        preferred_intermediate_object_store_id: request.preferred_intermediate_object_store_id,
        preferred_outputs_object_store_id: request.preferred_outputs_object_store_id,
        use_cached_job: true,
        parameters: { ...(request.parameters ?? {}), [stepKey.value]: editedStepParameters },
        parameters_normalized: true,
        instance: true,
        require_exact_tool_versions: false,
        // Lets the job cache prefer the source invocation's jobs, and the new invocation link back to it.
        rerun_of_invocation_id: props.invocationId,
        rerun_step_index: props.stepIndex,
    };
    submitting.value = true;
    submitError.value = "";
    try {
        const invocation = await invokeWorkflow(request.workflow_id, payload);
        router.push(`/workflows/invocations/${invocation.id}?success=true`);
    } catch (e) {
        submitError.value = errorMessageAsString(e);
    } finally {
        submitting.value = false;
    }
}

onMounted(load);
</script>

<template>
    <div class="workflow-step-rerun">
        <Heading h1 separator size="lg">Edit parameters and rerun</Heading>
        <LoadingSpan v-if="loading" message="Loading step" />
        <GAlert v-else-if="loadError" variant="danger" show>{{ loadError }}</GAlert>
        <GAlert
            v-else-if="gateFailure"
            variant="warning"
            show
            data-description="step rerun gate"
            :data-gate-code="gateFailure.code">
            <p>{{ gateFailure.reason }}</p>
            <GLink :to="fullRerunLink" data-description="step rerun full rerun link">
                Opens the full run form; this run's step settings are not carried over.
            </GLink>
        </GAlert>
        <div v-else-if="model && step">
            <p>
                Rerun of <b>{{ model.name }}</b> from
                <GLink :to="invocationLink">invocation {{ props.invocationId }}</GLink> with the parameters of step
                {{ props.stepIndex + 1 }} (<b>{{ stepTitle }}</b
                >) edited. Workflow inputs and every other step's settings are carried over unchanged; steps whose
                inputs and parameters are unchanged are expected to reuse their earlier jobs, and the edited step plus
                everything downstream of it recompute.
            </p>
            <p v-if="runtimeOverrides.length" class="text-muted">
                Set at run time on the original invocation: <code>{{ runtimeOverrides.join(", ") }}</code>
            </p>
            <GAlert v-if="unplacedOverrides.length" variant="warning" show>
                These run-time settings of the original invocation could not be placed on the form and are dropped:
                <code>{{ unplacedOverrides.join(", ") }}</code>
            </GAlert>
            <WorkflowRunDefaultStep
                :model="step"
                :validation-scroll-to="validationScrollTo"
                :history-id="props.request.history_id"
                @onChange="onStepChange"
                @onValidation="onStepValidation" />
            <GAlert v-if="submitError" variant="danger" show>{{ submitError }}</GAlert>
            <GButton
                id="rerun-step"
                color="blue"
                :loading="submitting"
                :disabled="submitting"
                title="Create a new invocation with this step edited"
                @click="onRerun">
                <FontAwesomeIcon :icon="faRedo" />
                Rerun workflow
            </GButton>
        </div>
    </div>
</template>
