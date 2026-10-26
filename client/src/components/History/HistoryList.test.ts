import { createTestingPinia } from "@pinia/testing";
import { getLocalVue, suppressBootstrapVueWarnings } from "@tests/vitest/helpers";
import { mount } from "@vue/test-utils";
import flushPromises from "flush-promises";
import { setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";

import { useServerMock } from "@/api/client/__mocks__";
import { getMyHistories, getPublishedHistories } from "@/api/histories";
import { updateHistoryFields } from "@/stores/services/history.services";

import HistoryList from "./HistoryList.vue";

const { server, http } = useServerMock();

vi.mock("@/api/histories", async (importOriginal) => ({
    ...(await importOriginal<object>()),
    getMyHistories: vi.fn(),
    getSharedHistories: vi.fn(),
    getPublishedHistories: vi.fn(),
    getArchivedHistories: vi.fn(),
}));

vi.mock("@/stores/services/history.services", async (importOriginal) => ({
    ...(await importOriginal<object>()),
    updateHistoryFields: vi.fn(),
}));

const mockedUpdateHistoryFields = updateHistoryFields as ReturnType<typeof vi.fn>;
const mockedGetMyHistories = getMyHistories as ReturnType<typeof vi.fn>;
const mockedGetPublishedHistories = getPublishedHistories as ReturnType<typeof vi.fn>;

async function mountHistoryList(path: string, activeList = "my") {
    const pinia = createTestingPinia({ createSpy: vi.fn, stubActions: false });
    setActivePinia(pinia);

    const router = createRouter({
        history: createMemoryHistory(),
        routes: [{ path: "/:pathMatch(.*)*", component: { template: "<div></div>" } }],
    });
    await router.push(path);
    await router.isReady();

    const wrapper = mount(HistoryList as object, {
        global: getLocalVue(),
        pinia,
        router,
        props: { activeList },
    });

    await flushPromises();

    return wrapper;
}

describe("HistoryList", () => {
    beforeEach(() => {
        suppressBootstrapVueWarnings();
        vi.clearAllMocks();
        mockedGetMyHistories.mockResolvedValue({ data: [], total: 0 });
        mockedGetPublishedHistories.mockResolvedValue({ data: [], total: 0 });
        server.use(
            http.get("/api/configuration", ({ response }) => {
                return response(200).json({});
            }),
            http.get("/api/histories", ({ response }) => {
                return response(200).json([]);
            }),
            http.get("/api/workflows", ({ response }) => {
                return response(200).json([]);
            }),
        );
    });

    it("starts with an empty filter by default", async () => {
        const wrapper = await mountHistoryList("/histories/list");

        expect((wrapper.find("#history-list-filter input").element as HTMLInputElement).value).toBe("");
        expect(mockedGetMyHistories).toHaveBeenCalledWith(expect.objectContaining({ search: "" }));
    });

    it("applies the filter query parameter as the initial filter", async () => {
        const wrapper = await mountHistoryList("/histories/list?filter=tag:lung");

        expect((wrapper.find("#history-list-filter input").element as HTMLInputElement).value).toBe("tag:lung");
        expect(mockedGetMyHistories).toHaveBeenLastCalledWith(expect.objectContaining({ search: "tag:lung" }));
    });

    // Only the shared and published lists know the user: filter that ?owner= sets
    it("combines the filter and owner query parameters", async () => {
        const wrapper = await mountHistoryList("/histories/list_published?filter=tag:lung&owner=alice", "published");

        const value = (wrapper.find("#history-list-filter input").element as HTMLInputElement).value;
        expect(value).toContain("tag:lung");
        expect(value).toContain("user:'alice'");
    });

    describe("add to project", () => {
        async function addSelectedToProject(path: string, move: boolean) {
            mockedGetMyHistories.mockResolvedValue({
                data: [
                    { id: "h1", name: "One", tags: ["project:brain", "keep"] },
                    { id: "h2", name: "Two", tags: [] },
                ],
                total: 2,
            });
            const wrapper = await mountHistoryList("/histories/list");
            await wrapper.find("#list-header-select-all").setValue(true);
            await wrapper.find("#history-list-footer-bulk-add-to-project-button").trigger("click");
            await flushPromises();
            await wrapper.find("#add-to-project-picker").setValue(path);
            if (move) {
                await wrapper.find("#add-to-project-move").setValue(true);
            }
            const dialog = wrapper.find("#add-to-project-picker").element.closest("dialog")!;
            const add = Array.from(dialog.querySelectorAll("button")).find(
                (button) => button.textContent?.trim() === "Add",
            );
            add!.click();
            await flushPromises();
            return wrapper;
        }

        it("adds the project tag to each selected history", async () => {
            await addSelectedToProject("lung", false);

            expect(mockedUpdateHistoryFields).toHaveBeenCalledTimes(2);
            expect(mockedUpdateHistoryFields).toHaveBeenCalledWith("h1", {
                tags: ["project:brain", "keep", "project:lung"],
            });
            expect(mockedUpdateHistoryFields).toHaveBeenCalledWith("h2", { tags: ["project:lung"] });
        });

        it("replaces the other project tags when moving", async () => {
            await addSelectedToProject("lung", true);

            expect(mockedUpdateHistoryFields).toHaveBeenCalledWith("h1", { tags: ["keep", "project:lung"] });
            expect(mockedUpdateHistoryFields).toHaveBeenCalledWith("h2", { tags: ["project:lung"] });
        });
    });
});
