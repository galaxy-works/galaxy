<script setup lang="ts">
/** Asks which project to put the selected items into, and whether to move them out of their other projects. */
import { ref, watch } from "vue";

import GCheckbox from "@/components/BaseComponents/GCheckbox.vue";
import GModal from "@/components/BaseComponents/GModal.vue";
import ProjectPicker from "@/components/Projects/ProjectPicker.vue";

const props = withDefaults(
    defineProps<{
        show: boolean;
        title?: string;
    }>(),
    {
        title: "Add to project",
    },
);

const emit = defineEmits<{
    (e: "update:show", show: boolean): void;
    (e: "ok", path: string, move: boolean): void;
}>();

const path = ref("");
const move = ref(false);

watch(
    () => props.show,
    (show) => {
        if (show) {
            path.value = "";
            move.value = false;
        }
    },
);

function onOk() {
    if (path.value) {
        emit("ok", path.value, move.value);
    }
}
</script>

<template>
    <GModal
        :show="show"
        :title="title"
        confirm
        size="small"
        ok-text="Add"
        :ok-disabled="!path"
        ok-disabled-title="Choose or type a project"
        overflow-visible
        @update:show="emit('update:show', $event)"
        @ok="onOk">
        <ProjectPicker id="add-to-project-picker" v-model="path" />
        <GCheckbox id="add-to-project-move" v-model="move" class="mt-2">
            Move (replace the current project tags)
        </GCheckbox>
    </GModal>
</template>
