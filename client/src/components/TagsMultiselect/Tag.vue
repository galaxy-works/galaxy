<script setup lang="ts">
import { faFolder, faTimes } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/vue-fontawesome";
import { computed } from "vue";

import { projectPathsOf } from "@/components/Projects/projectTags";
import { useProjectContextStore } from "@/stores/projectContextStore";
import { keyedColorScheme } from "@/utils/color";

import GButton from "@/components/BaseComponents/GButton.vue";

interface TagProps {
    option: string;
    search?: string;
    editable?: boolean;
    clickable?: boolean;
}

const props = defineProps<TagProps>();

const emit = defineEmits<{
    (e: "click", tag: string): void;
    (e: "deleted", tag: string): void;
}>();

const projectContextStore = useProjectContextStore();

/** The path as tagged, when this tag should show as a project badge rather than a tag. */
const projectPath = computed(() => {
    if (!projectContextStore.projectsAsField || projectPathsOf([props.option]).length === 0) {
        return undefined;
    }
    return props.option.slice(props.option.indexOf(":") + 1);
});

// A project badge is neutral so it reads as a field value, not as one more coloured tag.
const NEUTRAL_COLOR = {
    primary: "var(--color-grey-100)",
    darker: "var(--color-grey-300)",
    dimmed: "var(--color-grey-200)",
};

const color = computed(() => (projectPath.value === undefined ? keyedColorScheme(props.option) : NEUTRAL_COLOR));

function onClick() {
    emit("click", props.option);
}

function onDelete() {
    emit("deleted", props.option);
}

const named = computed(() => props.option?.startsWith("#"));
const searched = computed(() => props.option?.toLowerCase() === props.search?.toLowerCase());
</script>

<template>
    <div
        class="tag btn-transparent-background"
        :data-option="props.option"
        :class="{ editable, clickable, searched, 'project-badge': projectPath !== undefined }"
        :title="projectPath !== undefined ? `Project: ${projectPath}` : undefined"
        :style="`--color-primary: ${color.primary}; --color-darker: ${color.darker}; --color-dimmed: ${color.dimmed}`"
        @click.prevent.stop="onClick"
        @mousedown.prevent.stop>
        <span v-if="projectPath !== undefined">
            <FontAwesomeIcon :icon="faFolder" class="mr-1" data-project-badge-icon />{{ projectPath }}
        </span>
        <span v-else :class="{ 'font-weight-bold': named }">
            {{ props.option }}
        </span>
        <GButton
            v-if="editable"
            size="small"
            transparent
            inline
            icon-only
            class="px-1 py-0 tag-delete-button"
            :aria-label="`Remove tag ${props.option}`"
            tabindex="-1"
            @click.prevent.stop="onDelete">
            <FontAwesomeIcon :icon="faTimes"></FontAwesomeIcon>
        </GButton>
    </div>
</template>

<style lang="scss" scoped>
@import "@/style/scss/theme/blue.scss";

.tag {
    display: inline-flex;
    align-items: baseline;

    margin-right: 0.25rem;
    margin-bottom: 0.1rem;

    font-size: $font-size-base * 0.95;
    color: black;
    border-radius: 4px;

    background-color: var(--color-primary);
    transition: background-color 0.1s;

    padding: 0 0.5rem;
    &.editable {
        padding: 0 0.25rem;
    }

    position: relative;

    &:before {
        content: "";
        width: 100%;
        height: 100%;
        top: 0;
        left: 0;
        position: absolute;
        border-color: var(--color-darker);
        border-radius: inherit;
        pointer-events: none;

        border-style: solid;
        border-width: 0 2px 1px 0;
    }

    &.clickable {
        cursor: pointer;

        &:hover {
            background-color: var(--color-dimmed);
        }
    }

    &.searched {
        outline: 2px solid $brand-danger;
    }
}
</style>
