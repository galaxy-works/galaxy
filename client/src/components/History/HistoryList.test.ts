import { createTestingPinia } from "@pinia/testing";
import { getFakeRegisteredUser } from "@tests/test-data";
import { createTestRouter, getLocalVue, suppressBootstrapVueWarnings } from "@tests/vitest/helpers";
import { mount } from "@vue/test-utils";
import flushPromises from "flush-promises";
import { setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";

import { useServerMock } from "@/api/client/__mocks__";
import { type AnyHistoryEntry, getMyHistories, getPublishedHistories, getSharedHistories } from "@/api/histories";
import { raisedToasts } from "@/composables/__mocks__/toast";
import { updateHistoryFields } from "@/stores/services/history.services";
import { useUserStore } from "@/stores/userStore";

import HistoryCard from "./HistoryCard.vue";
import HistoryList from "./HistoryList.vue";
import HistoryCardList from "@/components/History/HistoryCardList.vue";

const { confirm } = vi.hoisted(() => ({ confirm: vi.fn() }));

vi.mock("@/composables/confirmDialog", () => ({
    useConfirmDialog: () => ({ confirm }),
}));
vi.mock("@/composables/toast");
vi.mock("@/api/histories", async (importOriginal) => ({
    ...(await importOriginal<object>()),
    getMyHistories: vi.fn(),
    getSharedHistories: vi.fn(),
    getPublishedHistories: vi.fn(),
}));

vi.mock("@/stores/services/history.services", async (importOriginal) => ({
    ...(await importOriginal<object>()),
    updateHistoryFields: vi.fn(),
}));

const { server, http } = useServerMock();

const localVue = getLocalVue();
const router = createTestRouter();

const FAKE_USER = getFakeRegisteredUser({ id: "user_id", email: "me@example.org", username: "me" });

function history(id: string, name: string, username: string): AnyHistoryEntry {
    return {
        id,
        name,
        username,
        deleted: false,
        purged: false,
        published: false,
        tags: [],
    } as unknown as AnyHistoryEntry;
}

const SHARED = [history("shared_1", "First Shared", "owner"), history("shared_2", "Second Shared", "owner")];
const MINE = [history("mine_1", "Mine", "me")];

let failSecond = false;

async function mountHistoryList(activeList: "my" | "shared" | "published", path?: string) {
    const pinia = createTestingPinia({ createSpy: vi.fn, stubActions: false });
    setActivePinia(pinia);
    useUserStore().currentUser = FAKE_USER;
    let mountRouter = router;
    if (path) {
        mountRouter = createRouter({
            history: createMemoryHistory(),
            routes: [{ path: "/:pathMatch(.*)*", component: { template: "<div></div>" } }],
        });
        await mountRouter.push(path);
        await mountRouter.isReady();
    }
    const wrapper = mount(HistoryList as object, {
        props: { activeList },
        global: { ...localVue, stubs: { ...localVue.stubs, HistoryCard: true } },
        pinia,
        router: mountRouter,
    });
    await flushPromises();
    return wrapper;
}

function cardList(wrapper: Awaited<ReturnType<typeof mountHistoryList>>) {
    return wrapper.findComponent(HistoryCardList);
}

async function selectAll(wrapper: Awaited<ReturnType<typeof mountHistoryList>>, histories: AnyHistoryEntry[]) {
    const cards = wrapper.findAllComponents(HistoryCard);
    for (const h of histories) {
        cards.find((card) => card.props("history").id === h.id)?.vm.$emit("select", h);
    }
    await flushPromises();
}

function deleteKeyEvent(): KeyboardEvent {
    const target = document.createElement("div");
    target.classList.add("history-card-in-list");
    return { key: "Delete", shiftKey: false, target, preventDefault: () => {} } as unknown as KeyboardEvent;
}

function interceptRequests() {
    const unshared: string[] = [];
    const deleted: string[] = [];
    server.use(
        http.put("/api/histories/{history_id}/unshare_with_me", ({ params, response }) => {
            unshared.push(params.history_id);
            if (params.history_id === "shared_2" && failSecond) {
                return response("4XX").json({ err_msg: "History not found", err_code: 404 }, { status: 404 });
            }
            return response(204).empty();
        }),
        http.delete("/api/histories/{history_id}", ({ params, response }) => {
            deleted.push(params.history_id);
            return response(200).json({} as never);
        }),
    );
    return { unshared, deleted };
}

describe("HistoryList", () => {
    beforeEach(() => {
        suppressBootstrapVueWarnings();
        vi.clearAllMocks();
        failSecond = false;
        vi.mocked(getSharedHistories).mockResolvedValue({ data: SHARED, total: 2 } as never);
        vi.mocked(getMyHistories).mockResolvedValue({ data: MINE, total: 1 } as never);
        vi.mocked(getPublishedHistories).mockResolvedValue({ data: [], total: 0 } as never);
        server.use(
            http.get("/api/histories", ({ response }) => {
                return response(200).json([]);
            }),
            http.get("/api/workflows", ({ response }) => {
                return response(200).json([]);
            }),
        );
    });

    it("offers only Remove from Shared for histories selected in the shared view", async () => {
        const wrapper = await mountHistoryList("shared");
        expect(cardList(wrapper).props("selectable")).toBe(true);

        await selectAll(wrapper, SHARED);

        expect(wrapper.find("#history-list-footer-bulk-unshare-button").text()).toContain("Remove from Shared (2)");
        expect(wrapper.find("#history-list-footer-bulk-delete-button").exists()).toBe(false);
        expect(wrapper.find("#history-list-footer-bulk-purge-button").exists()).toBe(false);
        expect(wrapper.find("#history-list-footer-bulk-add-tags-button").exists()).toBe(false);
        expect(wrapper.find("#history-list-footer-bulk-open-multiview-button").exists()).toBe(false);
    });

    it("keeps the owner bulk actions and no Remove from Shared in my view", async () => {
        const wrapper = await mountHistoryList("my");
        await selectAll(wrapper, MINE);

        expect(wrapper.find("#history-list-footer-bulk-delete-button").exists()).toBe(true);
        expect(wrapper.find("#history-list-footer-bulk-unshare-button").exists()).toBe(false);
    });

    it("keeps every share when removal is not confirmed", async () => {
        const { unshared } = interceptRequests();
        confirm.mockResolvedValue(false);
        const wrapper = await mountHistoryList("shared");
        await selectAll(wrapper, SHARED);

        await wrapper.find("#history-list-footer-bulk-unshare-button").trigger("click");
        await flushPromises();

        expect(confirm).toHaveBeenCalledTimes(1);
        expect(unshared).toEqual([]);
        expect(raisedToasts()).toEqual([]);
    });

    it("reports the histories whose share could not be removed and keeps them selected", async () => {
        failSecond = true;
        const { unshared } = interceptRequests();
        confirm.mockResolvedValue(true);
        const wrapper = await mountHistoryList("shared");
        await selectAll(wrapper, SHARED);
        vi.mocked(getSharedHistories).mockClear();

        await wrapper.find("#history-list-footer-bulk-unshare-button").trigger("click");
        await flushPromises();

        expect(unshared).toEqual(["shared_1", "shared_2"]);
        expect(getSharedHistories).toHaveBeenCalledTimes(1);
        expect(raisedToasts()).toEqual([
            { variant: "success", message: "Removed 1 history from your shared histories." },
            { variant: "error", message: "Failed to remove 1 shared history: 'Second Shared' (History not found)" },
        ]);
        expect(wrapper.find("#history-list-footer-bulk-unshare-button").text()).toContain("Remove from Shared (1)");
    });

    it("does nothing on the Delete key in the shared view", async () => {
        const { unshared, deleted } = interceptRequests();
        confirm.mockResolvedValue(true);
        const wrapper = await mountHistoryList("shared");

        cardList(wrapper).vm.$emit("on-key-down", SHARED[0], deleteKeyEvent());
        await flushPromises();

        expect(confirm).not.toHaveBeenCalled();
        expect(deleted).toEqual([]);
        expect(unshared).toEqual([]);
    });

    it("asks to delete on the Delete key in my view", async () => {
        confirm.mockResolvedValue(false);
        const wrapper = await mountHistoryList("my");

        cardList(wrapper).vm.$emit("on-key-down", MINE[0], deleteKeyEvent());
        await flushPromises();

        expect(confirm).toHaveBeenCalledTimes(1);
        expect(confirm.mock.calls[0]?.[1]).toMatchObject({ title: "Delete History" });
    });

    it("starts with an empty filter by default", async () => {
        const wrapper = await mountHistoryList("my", "/histories/list");

        expect((wrapper.find("#history-list-filter input").element as HTMLInputElement).value).toBe("");
        expect(getMyHistories).toHaveBeenCalledWith(expect.objectContaining({ search: "" }));
    });

    it("applies the filter query parameter as the initial filter", async () => {
        const wrapper = await mountHistoryList("my", "/histories/list?filter=tag:lung");

        expect((wrapper.find("#history-list-filter input").element as HTMLInputElement).value).toBe("tag:lung");
        expect(getMyHistories).toHaveBeenLastCalledWith(expect.objectContaining({ search: "tag:lung" }));
    });

    // Only the shared and published lists know the user: filter that ?owner= sets
    it("combines the filter and owner query parameters", async () => {
        const wrapper = await mountHistoryList("published", "/histories/list_published?filter=tag:lung&owner=alice");

        const value = (wrapper.find("#history-list-filter input").element as HTMLInputElement).value;
        expect(value).toContain("tag:lung");
        expect(value).toContain("user:'alice'");
    });

    describe("add to project", () => {
        async function addSelectedToProject(path: string, move: boolean) {
            const histories = [
                { ...history("h1", "One", "me"), tags: ["project:brain", "keep"] },
                { ...history("h2", "Two", "me"), tags: [] },
            ];
            vi.mocked(getMyHistories).mockResolvedValue({ data: histories, total: 2 } as never);
            const wrapper = await mountHistoryList("my", "/histories/list");
            await selectAll(wrapper, histories);
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

            expect(vi.mocked(updateHistoryFields)).toHaveBeenCalledTimes(2);
            expect(vi.mocked(updateHistoryFields)).toHaveBeenCalledWith("h1", {
                tags: ["project:brain", "keep", "project:lung"],
            });
            expect(vi.mocked(updateHistoryFields)).toHaveBeenCalledWith("h2", { tags: ["project:lung"] });
        });

        it("replaces the other project tags when moving", async () => {
            await addSelectedToProject("lung", true);

            expect(vi.mocked(updateHistoryFields)).toHaveBeenCalledWith("h1", { tags: ["keep", "project:lung"] });
            expect(vi.mocked(updateHistoryFields)).toHaveBeenCalledWith("h2", { tags: ["project:lung"] });
        });
    });
});
