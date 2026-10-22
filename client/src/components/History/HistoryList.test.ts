import { createTestingPinia } from "@pinia/testing";
import { getLocalVue, suppressBootstrapVueWarnings } from "@tests/vitest/helpers";
import { mount } from "@vue/test-utils";
import flushPromises from "flush-promises";
import { setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";

import { useServerMock } from "@/api/client/__mocks__";
import { getMyHistories, getPublishedHistories } from "@/api/histories";

import HistoryList from "./HistoryList.vue";

const { server, http } = useServerMock();

vi.mock("@/api/histories", () => ({
    getMyHistories: vi.fn(),
    getSharedHistories: vi.fn(),
    getPublishedHistories: vi.fn(),
    getArchivedHistories: vi.fn(),
}));

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
});
