<script setup lang="ts">
import { computed } from "vue";

import type { WorkflowInvocationElementView } from "@/api/invocations";
import { useInvocationStore } from "@/stores/invocationStore";

import GLink from "@/components/BaseComponents/GLink.vue";

const props = defineProps<{
    invocation: WorkflowInvocationElementView;
}>();

const invocationStore = useInvocationStore();

const lineage = computed(() => {
    const request = invocationStore.getInvocationRequestById(props.invocation.id);
    if (!request?.rerun_of_invocation_id) {
        return null;
    }
    return { sourceId: request.rerun_of_invocation_id, stepIndex: request.rerun_step_index ?? null };
});

const stepText = computed(() => {
    const stepIndex = lineage.value?.stepIndex;
    if (stepIndex === null || stepIndex === undefined) {
        return "";
    }
    // The rerun runs the same workflow, so this invocation's step at that index is the edited one.
    const label = props.invocation.steps.find((step) => step.order_index === stepIndex)?.workflow_step_label;
    return `, step ${stepIndex + 1}${label ? ` (${label})` : ""}`;
});
</script>

<template>
    <p v-if="lineage" class="mb-1 mt-2" data-description="invocation rerun origin">
        Rerun of invocation
        <GLink :to="`/workflows/invocations/${lineage.sourceId}`" data-description="invocation rerun origin link">{{
            lineage.sourceId
        }}</GLink
        >{{ stepText }}
    </p>
</template>
