import { createTestingPinia } from "@pinia/testing";
import { getLocalVue, suppressDebugConsole } from "@tests/vitest/helpers";
import { mount, type VueWrapper } from "@vue/test-utils";
import flushPromises from "flush-promises";
import { setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { h, ref } from "vue";

import { useProjectContextStore } from "@/stores/projectContextStore";
import { updateHistoryFields } from "@/stores/services/history.services";

import { WorkflowRunModel } from "./model";
import { invokeWorkflow } from "./services";
import sampleRunData1 from "./testdata/run1.json";

import WorkflowRunFormSimple from "./WorkflowRunFormSimple.vue";

vi.mock("./services", () => ({
    invokeWorkflow: vi.fn(),
    searchHistoryContents: vi.fn(),
}));
vi.mock("@/stores/services/history.services", () => ({ updateHistoryFields: vi.fn() }));
vi.mock("@/composables/config");
vi.mock("@/composables/toast");
vi.mock("@/composables/fileSources", () => ({ useFileSources: () => ({ hasWritable: ref(false) }) }));
vi.mock("@/composables/useWorkflowInstance", () => ({
    useWorkflowInstance: () => ({ workflow: ref(null), loading: ref(false) }),
}));
// Open the run settings panel, which holds the new history options.
vi.mock("@/composables/persistentToggle", () => ({
    usePersistentToggle: () => ({ toggled: ref(true), toggle: vi.fn() }),
}));

function stub(name: string, props: string[] = []) {
    return { default: { name, props, render: () => h("div") } };
}

vi.mock("../WorkflowNavigationTitle.vue", () => ({
    default: {
        name: "WorkflowNavigationTitle",
        emits: ["on-execute"],
        setup(_: unknown, { slots }: { slots: Record<string, () => unknown> }) {
            return () => h("div", slots["workflow-title-actions"]?.() as never);
        },
    },
}));
vi.mock("../WorkflowAnnotation.vue", () => stub("WorkflowAnnotation"));
vi.mock("@/components/Form/FormDisplay.vue", () => stub("FormDisplay", ["inputs"]));
vi.mock("./WorkflowRunGraph.vue", () => stub("WorkflowRunGraph"));
vi.mock("./WorkflowHelpDisplay.vue", () => stub("WorkflowHelpDisplay"));
vi.mock("./WorkflowStorageConfiguration.vue", () => stub("WorkflowStorageConfiguration"));
vi.mock("./ExportOnCompleteWizard.vue", () => stub("ExportOnCompleteWizard"));
vi.mock("@/components/Workflow/Run/WorkflowCredentials.vue", () => stub("WorkflowCredentials"));

const globalConfig = getLocalVue();

function mountForm({ asField = true, currentProject = null as string | null } = {}) {
    const pinia = createTestingPinia({
        createSpy: vi.fn,
        initialState: {
            userStore: { currentUser: { id: "user_id" } },
            historyStore: {
                storedHistories: { current_history_id: { id: "current_history_id", name: "Current", tags: [] } },
            },
        },
    });
    setActivePinia(pinia);
    const contextStore = useProjectContextStore();
    contextStore.projectsAsField = asField;
    contextStore.currentProject = currentProject;
    return mount(WorkflowRunFormSimple as object, {
        props: {
            model: new WorkflowRunModel(JSON.parse(JSON.stringify(sampleRunData1))),
            canMutateCurrentHistory: true,
            targetHistory: "new",
        },
        global: {
            ...globalConfig,
            plugins: [...(globalConfig.plugins ?? []), pinia],
        },
    });
}

async function run(wrapper: VueWrapper) {
    wrapper.findComponent({ name: "WorkflowNavigationTitle" }).vm.$emit("on-execute");
    await flushPromises();
}

describe("WorkflowRunFormSimple project picker", () => {
    beforeEach(() => {
        suppressDebugConsole();
        vi.clearAllMocks();
        vi.mocked(invokeWorkflow).mockResolvedValue([{ id: "invocation_id", history_id: "new_history_id" }]);
    });

    it("offers a project for the new history, defaulting to the current project", async () => {
        const wrapper = mountForm({ currentProject: "lung" });
        await flushPromises();

        expect((wrapper.find("#new-history-project").element as HTMLInputElement).value).toBe("lung");
    });

    it("tags the new history with the chosen project after the run is submitted", async () => {
        const wrapper = mountForm({ currentProject: "lung" });
        await flushPromises();
        await wrapper.find("#new-history-project").setValue("lung/scrna");

        await run(wrapper);

        expect(wrapper.emitted("submissionSuccess")).toHaveLength(1);
        expect(vi.mocked(invokeWorkflow).mock.calls[0]![1]).toMatchObject({ new_history_name: "Cool Test Workflow" });
        expect(updateHistoryFields).toHaveBeenCalledWith("new_history_id", { tags: ["project:lung/scrna"] });
    });

    it("still reports success when tagging the new history fails", async () => {
        vi.mocked(updateHistoryFields).mockRejectedValueOnce(new Error("boom"));
        const wrapper = mountForm({ currentProject: "lung" });
        await flushPromises();

        await run(wrapper);

        expect(wrapper.emitted("submissionSuccess")).toHaveLength(1);
        expect(wrapper.emitted("submissionError")).toBeUndefined();
    });

    it("hides the picker while projects are shown as tags but still inherits the current project", async () => {
        const wrapper = mountForm({ asField: false, currentProject: "lung" });
        await flushPromises();

        expect(wrapper.find(".history-name-input").exists()).toBe(true);
        expect(wrapper.find("#new-history-project").exists()).toBe(false);

        await run(wrapper);

        expect(wrapper.emitted("submissionSuccess")).toHaveLength(1);
        expect(updateHistoryFields).toHaveBeenCalledWith("new_history_id", { tags: ["project:lung"] });
    });

    it("leaves the new history alone while projects are shown as tags and no project is current", async () => {
        const wrapper = mountForm({ asField: false });
        await flushPromises();
        expect(wrapper.find("#new-history-project").exists()).toBe(false);

        await run(wrapper);

        expect(wrapper.emitted("submissionSuccess")).toHaveLength(1);
        expect(updateHistoryFields).not.toHaveBeenCalled();
    });

    it("does not tag anything when the run goes to the current history", async () => {
        const wrapper = mountForm({ currentProject: "lung" });
        await flushPromises();
        await wrapper.find("#send-to-new-history").setValue(false);
        expect(wrapper.find("#new-history-project").exists()).toBe(false);

        await run(wrapper);

        expect(wrapper.emitted("submissionSuccess")).toHaveLength(1);
        expect(updateHistoryFields).not.toHaveBeenCalled();
    });
});
