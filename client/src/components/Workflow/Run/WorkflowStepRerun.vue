<script setup lang="ts">
import { faRedo } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/vue-fontawesome";
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";

import type { WorkflowInvocationRequest } from "@/api/invocations";
import type { FormData } from "@/components/Form/composables/useFormState";
import { errorMessageAsString } from "@/utils/simple-error";

import { WorkflowRunModel } from "./model";
import { getRunData, invokeWorkflow } from "./services";
import { applyStepOverrides, buildStepRerunPayload, downstreamSteps, type StepParameters } from "./stepRerun";
import { evaluateStepRerunGates, type StepRerunGateResult } from "./stepRerunGates";

import GAlert from "@/components/BaseComponents/GAlert.vue";
import GButton from "@/components/BaseComponents/GButton.vue";
import GLink from "@/components/BaseComponents/GLink.vue";
import Heading from "@/components/Common/Heading.vue";
import LoadingSpan from "@/components/LoadingSpan.vue";
import WorkflowRunDefaultStep from "@/components/Workflow/Run/WorkflowRunDefaultStep.vue";

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

/** The edited step and everything downstream of it, titled the way the invocation graph titles its nodes */
const stepsToRecompute = computed(() => {
    const steps = model.value?.steps ?? [];
    return [props.stepIndex, ...downstreamSteps(steps, props.stepIndex)].map((index) => {
        const runStep = steps.find((candidate) => candidate?.step_index === index);
        return { index, title: `${index + 1}: ${runStep?.step_label || runStep?.step_name || "Unknown step"}` };
    });
});

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
        const { placed, unplaced } = applyStepOverrides(runStep.inputs, overrides);
        runtimeOverrides.value = placed;
        unplacedOverrides.value = unplaced;
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

async function onRerun() {
    if (stepValidation.value) {
        validationScrollTo.value = stepValidation.value.slice() as [string, string];
        return;
    }
    const stepInputs = model.value?.parms[props.stepIndex] ?? {};
    const connectedNames = Object.keys(stepInputs).filter((name) => stepInputs[name]?.connected);
    const request = props.request;
    const payload = buildStepRerunPayload(request, props.invocationId, props.stepIndex, stepData.value, connectedNames);
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
                @on-change="onStepChange"
                @on-validation="onStepValidation" />
            <div class="mt-3 mb-3" data-description="step rerun plan">
                <Heading h2 size="sm">What will run</Heading>
                <ul>
                    <li v-for="entry in stepsToRecompute" :key="entry.index">
                        {{ entry.title }}
                        <span v-if="entry.index === props.stepIndex" class="text-muted">(edited)</span>
                    </li>
                </ul>
                <p class="text-muted mb-0">The remaining steps are expected to reuse their previous jobs.</p>
            </div>
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
