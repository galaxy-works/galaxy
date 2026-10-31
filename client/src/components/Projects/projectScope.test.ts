import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";
import { ref } from "vue";

import { useProjectContextStore } from "@/stores/projectContextStore";

import { joinFilterText, useProjectScope } from "./projectScope";

describe("projectScope", () => {
    beforeEach(() => {
        setActivePinia(createPinia());
    });

    it("joins filter terms and drops the empty ones", () => {
        expect(joinFilterText("tag:project:lung", "name:foo")).toBe("tag:project:lung name:foo");
        expect(joinFilterText("", " name:foo ")).toBe("name:foo");
        expect(joinFilterText("tag:project:lung", "")).toBe("tag:project:lung");
        expect(joinFilterText(undefined, null, "")).toBe("");
    });

    it("adds the current project's term only where the scope applies", () => {
        const store = useProjectContextStore();
        const applies = ref(true);
        const { scopeFilter, withScope } = useProjectScope(applies);
        expect(withScope("name:foo")).toBe("name:foo");

        store.setCurrentProject("lung");
        expect(scopeFilter.value).toBe("tag:project:lung");
        expect(withScope("name:foo")).toBe("tag:project:lung name:foo");

        applies.value = false;
        expect(scopeFilter.value).toBe("");
        expect(withScope("name:foo")).toBe("name:foo");
    });

    it("tests tag lists against the current project", () => {
        const store = useProjectContextStore();
        const { inScope } = useProjectScope();
        expect(inScope(["anything"])).toBe(true);

        store.setCurrentProject("lung");
        expect(inScope(["project:lung/scrna", "other"])).toBe(true);
        expect(inScope(["project:Lungs"])).toBe(false);
        expect(inScope([])).toBe(false);
        expect(inScope(undefined)).toBe(false);
    });
});
