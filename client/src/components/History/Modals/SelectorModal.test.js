import { getFakeRegisteredUser } from "@tests/test-data";
import { emittedArg, getLocalVue } from "@tests/vitest/helpers";
import { mount } from "@vue/test-utils";
import flushPromises from "flush-promises";
import { createPinia, setActivePinia } from "pinia";
import { describe, expect, it } from "vitest";

import { useServerMock } from "@/api/client/__mocks__";
import { useHistoryStore } from "@/stores/historyStore";
import { useProjectContextStore } from "@/stores/projectContextStore";
import { useUserStore } from "@/stores/userStore";

import SelectorModal from "./SelectorModal.vue";
import GCard from "@/components/Common/GCard.vue";

const localVue = getLocalVue();

const CURRENT_HISTORY_ID = "COOL_ID";
const getFakeHistorySummaries = (num, selectedIndex = 0) => {
    const result = Array.from({ length: num }, (_, index) => ({
        id: index === selectedIndex ? CURRENT_HISTORY_ID : `ID-${index}`,
        name: `History-${index}`,
        tags: [],
        update_time: new Date().toISOString(),
    }));

    return result;
};
const PROPS_FOR_MODAL = {
    currentHistoryId: CURRENT_HISTORY_ID,
    histories: [],
    static: true, // Force the modal visible for testing
    showModal: true,
};
const PROPS_FOR_MODAL_MULTIPLE_SELECT = {
    ...PROPS_FOR_MODAL,
    multiple: true,
};

const CURRENT_HISTORY_INDICATION_CLASS = "g-card-current";
const SELECTED_HISTORY_CLASS = "g-card-selected";

const CURRENT_USER = {
    email: "email",
    id: "user_id",
    total_disk_usage: 0,
};

const { server, http } = useServerMock();

describe("History SelectorModal.vue", () => {
    let wrapper;
    let historyStore;
    const allHistories = getFakeHistorySummaries(15);

    async function mountWith(props) {
        server.use(
            http.get("/api/histories", ({ response, query }) => {
                const offset = Number(query.get("offset")) || 0;
                const limit = Number(query.get("limit")) || 10;
                return response(200).json(allHistories.slice(offset, offset + limit));
            }),
            http.get("/api/histories/count", ({ response }) => {
                return response(200).json(allHistories.length);
            }),
        );

        const pinia = createPinia();
        wrapper = mount(SelectorModal, {
            props: props,
            global: localVue,
            pinia,
            stubs: {
                icon: { template: "<div></div>" },
            },
        });

        const userStore = useUserStore();
        userStore.setCurrentUser(getFakeRegisteredUser(CURRENT_USER));

        historyStore = useHistoryStore();
        await historyStore.loadHistories();
        await wrapper.setProps({
            histories: historyStore.histories,
        });
        historyStore.setCurrentHistoryId(props.currentHistoryId);

        await flushPromises();
    }

    it("should indicate the currently selected history", async () => {
        await mountWith(PROPS_FOR_MODAL);

        const currentHistoryRow = wrapper.find(`[data-pk="${CURRENT_HISTORY_ID}"]`);
        expect(currentHistoryRow.classes()).toContain(CURRENT_HISTORY_INDICATION_CLASS);
    });

    it("paginates the histories", async () => {
        await mountWith(PROPS_FOR_MODAL);

        let displayedRows = wrapper.findAllComponents(GCard);
        expect(displayedRows.length).toBe(10);
        expect(wrapper.find("[data-description='load more items button']").exists()).toBe(true);

        await historyStore.loadHistories();
        await wrapper.setProps({
            histories: historyStore.histories,
        });

        displayedRows = wrapper.findAllComponents(GCard);
        expect(displayedRows.length).toBe(15);
        expect(wrapper.find("[data-description='load more items button']").exists()).toBe(false);
    });

    it("emits selectHistory with the correct history ID when a row is clicked", async () => {
        await mountWith(PROPS_FOR_MODAL);

        expect(wrapper.emitted("selectHistory")).toBeUndefined();

        const targetHistoryId = "ID-2";
        const targetRow = wrapper.find(`[data-pk="${targetHistoryId}"]`);
        await targetRow.trigger("click");

        expect(wrapper.emitted("selectHistory")).toBeDefined();
        expect(emittedArg(wrapper, "selectHistory").id).toBe(targetHistoryId);
    });

    it("filters on a project from the project bar when projects are a field", async () => {
        allHistories[4].tags = ["project:lung"];
        server.use(http.get("/api/workflows", ({ response }) => response(200).json([])));
        try {
            await mountWith(PROPS_FOR_MODAL);
            expect(wrapper.find("[data-project-bar]").exists()).toBe(false);

            // The switch is stored per user, so it is set once the user is known.
            useProjectContextStore().projectsAsField = true;
            await flushPromises();
            await wrapper.find("[data-project-bar-chip='lung']").trigger("click");
            await flushPromises();
            expect(wrapper.findComponent({ name: "HistoryScrollList" }).props("filter")).toBe("tag:'project:lung'");
        } finally {
            useProjectContextStore().projectsAsField = false;
            allHistories[4].tags = [];
        }
    });

    it("shows a custom selection instruction", async () => {
        await mountWith({ ...PROPS_FOR_MODAL, selectionInstruction: "Click a history to copy datasets" });

        expect(wrapper.text()).toContain("Click a history to copy datasets");
    });

    describe("Multi-selection Mode", () => {
        it("should select multiple histories", async () => {
            await mountWith(PROPS_FOR_MODAL_MULTIPLE_SELECT);

            expect(wrapper.emitted("selectHistories")).toBeUndefined();

            const targetHistoryId1 = "ID-1";
            const targetRow1 = wrapper.find(`[data-pk="${targetHistoryId1}"]`);
            await targetRow1.trigger("click");

            const targetHistoryId2 = "ID-2";
            const targetRow2 = wrapper.find(`[data-pk="${targetHistoryId2}"]`);
            await targetRow2.trigger("click");

            const selectedHistories = wrapper.findAll(`.${SELECTED_HISTORY_CLASS}`);
            expect(selectedHistories.length).toBe(2);

            const button = wrapper.find("[data-description='change selected histories button']");

            await button.trigger("click");

            expect(emittedArg(wrapper, "selectHistories")[0].id).toBe(targetHistoryId1);
        });
    });

    describe("with a current project", () => {
        const scopedHistories = getFakeHistorySummaries(15).map((history) => {
            const tags = { "ID-3": ["project:lung"], "ID-4": ["project:lungs"], "ID-12": ["project:lung/scrna"] };
            return { ...history, tags: tags[history.id] ?? [] };
        });
        let searches;

        async function mountScoped(project) {
            searches = [];
            server.use(
                http.get("/api/histories", ({ response, query }) => {
                    const search = query.get("search");
                    if (search !== null) {
                        searches.push(search);
                        // the server's unquoted tag match is a substring match, so `lungs` comes back too
                        return response(200).json(
                            scopedHistories.filter((h) => h.tags.some((tag) => tag.startsWith("project:lung"))),
                        );
                    }
                    const offset = Number(query.get("offset")) || 0;
                    const limit = Number(query.get("limit")) || 10;
                    return response(200).json(scopedHistories.slice(offset, offset + limit));
                }),
                http.get("/api/histories/count", ({ response }) => {
                    return response(200).json(scopedHistories.length);
                }),
            );
            const pinia = createPinia();
            setActivePinia(pinia);
            useUserStore().setCurrentUser(getFakeRegisteredUser(CURRENT_USER));
            useProjectContextStore().setCurrentProject(project);
            historyStore = useHistoryStore();
            await historyStore.loadHistories();
            wrapper = mount(SelectorModal, { props: PROPS_FOR_MODAL, global: localVue, pinia });
            await flushPromises();
        }

        function shownIds() {
            return wrapper.findAllComponents(GCard).map((card) => card.attributes("data-pk"));
        }

        it("asks the server for the project's histories and shows only those inside it", async () => {
            await mountScoped("lung");

            expect(searches).toEqual(["tag:project:lung"]);
            expect(shownIds().sort()).toEqual(["ID-12", "ID-3"]);
            expect(wrapper.find("[data-description='project scope banner']").text()).toContain("In project lung");
        });

        it("shows every history again once the context is cleared", async () => {
            await mountScoped("lung");

            await wrapper.find("[data-description='project scope clear']").trigger("click");
            await flushPromises();

            expect(shownIds().length).toBeGreaterThan(2);
            expect(wrapper.find("[data-description='project scope banner']").exists()).toBe(false);
        });
    });
});
