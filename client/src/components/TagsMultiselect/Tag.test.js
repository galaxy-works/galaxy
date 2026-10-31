import { getLocalVue } from "@tests/vitest/helpers";
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import { useProjectContextStore } from "@/stores/projectContextStore";

import Tag from "./Tag.vue";

const localVue = getLocalVue();

const mountWithProps = (props) => {
    return mount(Tag, {
        props: props,
        global: localVue,
    });
};

describe("Tag", () => {
    it("displays it's option", () => {
        {
            const tag = mountWithProps({ option: "my_tag" });
            expect(tag.text()).toBe("my_tag");
        }

        {
            const tag = mountWithProps({ option: "a_longer_tag_name" });
            expect(tag.text()).toBe("a_longer_tag_name");
        }
    });

    it("shows it's clickable", async () => {
        const tag = mountWithProps({ option: "my_tag" });

        expect(tag.classes()).not.toContain("clickable");

        tag.setProps({ clickable: true });
        await tag.vm.$nextTick();

        expect(tag.classes()).toContain("clickable");
    });

    it("can be clicked", async () => {
        const tag = mountWithProps({ option: "my_tag", clickable: true });

        expect(tag.classes()).toContain("clickable");

        tag.trigger("click");
        await tag.vm.$nextTick();

        expect(tag.emitted("click")).toBeTruthy();
        expect(tag.emitted("click")).toHaveLength(1);
        expect(tag.emitted("click")[0]).toEqual(["my_tag"]);

        tag.trigger("click");
        await tag.vm.$nextTick();

        expect(tag.emitted("click")).toHaveLength(2);
        expect(tag.emitted("click")).toStrictEqual([["my_tag"], ["my_tag"]]);
    });

    it("changes appearance when editable", async () => {
        const tag = mountWithProps({ option: "my_tag" });

        expect(tag.classes()).not.toContain("editable");
        expect(tag.find(".tag-delete-button").exists()).not.toBe(true);

        tag.setProps({ editable: true });
        await tag.vm.$nextTick();

        expect(tag.classes()).toContain("editable");
        expect(tag.find(".tag-delete-button").exists()).toBe(true);
    });

    it("can be deleted", async () => {
        const tag = mountWithProps({ option: "my_tag", editable: true });

        expect(tag.find(".tag-delete-button").exists()).toBe(true);

        tag.find(".tag-delete-button").trigger("click");
        await tag.vm.$nextTick();

        expect(tag.emitted("deleted")).toBeTruthy();
        expect(tag.emitted("deleted")).toHaveLength(1);
        expect(tag.emitted("deleted")[0]).toEqual(["my_tag"]);

        expect(tag.emitted("click")).toBeFalsy();
    });

    it("names its delete button after the tag", () => {
        const tag = mountWithProps({ option: "my_tag", editable: true });

        expect(tag.find(".tag-delete-button").attributes("aria-label")).toBe("Remove tag my_tag");
    });

    it("displays named tags bold", () => {
        {
            const wrapper = mountWithProps({ option: "my_tag" });
            const span = wrapper.find(".tag span");
            expect(span.classes()).not.toContain("font-weight-bold");
        }

        {
            const wrapper = mountWithProps({ option: "#named_tag" });
            const span = wrapper.find(".tag span");
            expect(span.classes()).toContain("font-weight-bold");
        }
    });

    it("highlights when searched", async () => {
        const tag = mountWithProps({ option: "my_tag" });

        expect(tag.classes()).not.toContain("searched");

        tag.setProps({ search: "my_tag" });
        await tag.vm.$nextTick();

        expect(tag.classes()).toContain("searched");
    });

    describe("project tags", () => {
        function mountProjectTag(props, asField) {
            const tag = mountWithProps(props);
            useProjectContextStore().projectsAsField = asField;
            return tag;
        }

        it("stays an ordinary tag while projects are shown as tags", async () => {
            const tag = mountProjectTag({ option: "project:lung/scrna" }, false);
            await tag.vm.$nextTick();

            expect(tag.text()).toBe("project:lung/scrna");
            expect(tag.classes()).not.toContain("project-badge");
            expect(tag.find("[data-project-badge-icon]").exists()).toBe(false);
        });

        it("renders as a folder badge without the prefix when projects are a field", async () => {
            const tag = mountProjectTag({ option: "project:Lung/scrna" }, true);
            await tag.vm.$nextTick();

            expect(tag.text()).toBe("Lung/scrna");
            expect(tag.classes()).toContain("project-badge");
            expect(tag.find("[data-project-badge-icon]").exists()).toBe(true);
            expect(tag.attributes("title")).toBe("Project: Lung/scrna");
            expect(tag.attributes("style")).toContain("--color-primary: var(--color-grey-100)");
        });

        it("still emits the full tag on click and delete", async () => {
            const tag = mountProjectTag({ option: "project:lung", clickable: true, editable: true }, true);
            await tag.vm.$nextTick();

            await tag.trigger("click");
            expect(tag.emitted("click")).toEqual([["project:lung"]]);

            await tag.find(".tag-delete-button").trigger("click");
            expect(tag.emitted("deleted")).toEqual([["project:lung"]]);
            expect(tag.find(".tag-delete-button").attributes("aria-label")).toBe("Remove tag project:lung");
        });

        it("leaves other tags alone when projects are a field", async () => {
            const plain = mountProjectTag({ option: "qc" }, true);
            const named = mountProjectTag({ option: "#sample" }, true);
            const empty = mountProjectTag({ option: "project:" }, true);
            await plain.vm.$nextTick();

            expect(plain.classes()).not.toContain("project-badge");
            expect(named.find(".tag span").classes()).toContain("font-weight-bold");
            expect(named.text()).toBe("#sample");
            expect(empty.classes()).not.toContain("project-badge");
        });
    });
});
