import { describe, expect, it } from "vitest";

import {
    buildProjectTree,
    countNodes,
    exactProjectTag,
    isWithinProject,
    normalizeProjectPath,
    PROJECT_TAG_NAME,
    projectPathProblem,
    projectPathsOf,
    projectTag,
    tagListFilter,
} from "./projectTags";

describe("projectPathsOf", () => {
    it("returns nothing for missing tag lists", () => {
        expect(projectPathsOf(undefined)).toEqual([]);
        expect(projectPathsOf(null)).toEqual([]);
        expect(projectPathsOf([])).toEqual([]);
    });

    it("matches the project tag name case-insensitively and lower-cases the path", () => {
        expect(projectPathsOf(["Project:Lung/ScRNA"])).toEqual(["lung/scrna"]);
        expect(projectPathsOf(["PROJECT:lung"])).toEqual(["lung"]);
    });

    it("drops empty and blank path segments", () => {
        expect(projectPathsOf(["project:/lung//scrna/"])).toEqual(["lung/scrna"]);
        expect(projectPathsOf(["project:lung/ /scrna"])).toEqual(["lung/scrna"]);
    });

    it("ignores tags with other names, plain tags and name: tags", () => {
        expect(projectPathsOf(["group:lung", "lung", "name:lung", "name:project", "projects:lung"])).toEqual([]);
    });

    it("ignores a project tag with no value", () => {
        expect(projectPathsOf(["project", "project:", "project:/", "project://"])).toEqual([]);
    });

    it("collapses tags that normalize to the same path", () => {
        expect(projectPathsOf(["project:lung", "Project:LUNG", "project:/lung/"])).toEqual(["lung"]);
    });

    it("keeps several distinct project paths in tag order", () => {
        expect(projectPathsOf(["project:lung/scrna", "qc", "project:brain"])).toEqual(["lung/scrna", "brain"]);
    });

    it("keeps colons after the first as part of the path", () => {
        expect(projectPathsOf(["project:lung:v2"])).toEqual(["lung:v2"]);
    });
});

describe("normalizeProjectPath", () => {
    it("lower-cases, trims segments and drops empty ones", () => {
        expect(normalizeProjectPath("Lung/ScRNA")).toBe("lung/scrna");
        expect(normalizeProjectPath("/lung//scrna/")).toBe("lung/scrna");
        expect(normalizeProjectPath(" lung / scrna ")).toBe("lung/scrna");
    });

    it("returns an empty string when there is no path", () => {
        expect(normalizeProjectPath("")).toBe("");
        expect(normalizeProjectPath("///")).toBe("");
    });
});

describe("projectPathProblem", () => {
    it("accepts nested paths and lets normalization handle case and stray slashes", () => {
        expect(projectPathProblem("lung/scrna")).toBeUndefined();
        expect(projectPathProblem(" Lung / ScRNA/ ")).toBeUndefined();
        expect(projectPathProblem("")).toBeUndefined();
    });

    it("rejects the tag grammar's reserved characters and quotes", () => {
        for (const path of ["lung,brain", "lung;brain", "lung:v2", "o'brien", 'say "hi"']) {
            expect(projectPathProblem(path)).toMatch(/can't contain/);
        }
    });

    it("rejects inner whitespace but not padding", () => {
        expect(projectPathProblem("lung cancer")).toMatch(/spaces/);
        expect(projectPathProblem("  lung  ")).toBeUndefined();
    });
});

describe("projectTag", () => {
    it("prefixes the path with the project tag name", () => {
        expect(PROJECT_TAG_NAME).toBe("project");
        expect(projectTag("lung/scrna")).toBe("project:lung/scrna");
        expect(projectTag("")).toBe("project:");
    });

    it("round-trips through projectPathsOf", () => {
        expect(projectPathsOf([projectTag("lung/scrna")])).toEqual(["lung/scrna"]);
    });
});

describe("isWithinProject", () => {
    it("matches the project itself", () => {
        expect(isWithinProject("lung", "lung")).toBe(true);
    });

    it("matches descendants at any depth", () => {
        expect(isWithinProject("lung/scrna", "lung")).toBe(true);
        expect(isWithinProject("lung/scrna/batch1", "lung")).toBe(true);
    });

    it("does not match a sibling that merely shares a prefix", () => {
        expect(isWithinProject("lungs", "lung")).toBe(false);
        expect(isWithinProject("lungs/scrna", "lung")).toBe(false);
        expect(isWithinProject("lung/scrna2", "lung/scrna")).toBe(false);
    });

    it("does not match ancestors or unrelated projects", () => {
        expect(isWithinProject("lung", "lung/scrna")).toBe(false);
        expect(isWithinProject("brain", "lung")).toBe(false);
    });
});

describe("buildProjectTree", () => {
    it("returns an empty forest for no paths", () => {
        expect(buildProjectTree([])).toEqual([]);
    });

    it("creates intermediate nodes for paths nobody tagged directly", () => {
        expect(buildProjectTree(["lung/scrna"])).toEqual([
            { path: "lung", label: "lung", children: [{ path: "lung/scrna", label: "scrna", children: [] }] },
        ]);
    });

    it("sorts children by label at every level", () => {
        const tree = buildProjectTree(["lung/scrna", "brain", "lung/bulk", "adrenal/z", "adrenal/a"]);
        expect(tree.map((node) => node.label)).toEqual(["adrenal", "brain", "lung"]);
        expect(tree[0]!.children.map((node) => node.label)).toEqual(["a", "z"]);
        expect(tree[2]!.children.map((node) => node.label)).toEqual(["bulk", "scrna"]);
    });

    it("collapses duplicate and overlapping paths into one node each", () => {
        const tree = buildProjectTree(["lung/scrna", "lung", "lung/scrna", "lung"]);
        expect(tree).toEqual([
            { path: "lung", label: "lung", children: [{ path: "lung/scrna", label: "scrna", children: [] }] },
        ]);
    });

    it("keeps prefix-sharing siblings apart", () => {
        const tree = buildProjectTree(["lung", "lungs"]);
        expect(tree.map((node) => node.path)).toEqual(["lung", "lungs"]);
        expect(tree.every((node) => node.children.length === 0)).toBe(true);
    });

    it("accepts any iterable", () => {
        expect(buildProjectTree(new Set(["brain"]))).toEqual([{ path: "brain", label: "brain", children: [] }]);
    });
});

describe("countNodes", () => {
    it("counts every node in the forest, including intermediate ones", () => {
        expect(countNodes([])).toBe(0);
        expect(countNodes(buildProjectTree(["lung/scrna"]))).toBe(2);
        expect(countNodes(buildProjectTree(["lung/scrna", "lung/bulk", "brain/a/b"]))).toBe(6);
    });
});

describe("exactProjectTag", () => {
    it("returns the first spelling an item uses for the path", () => {
        expect(exactProjectTag([["qc"], ["Project:Lung/ScRNA", "project:lung"]], "lung/scrna")).toBe(
            "Project:Lung/ScRNA",
        );
        expect(exactProjectTag([["project:lung/scrna"], ["project:Lung"]], "lung")).toBe("project:Lung");
    });

    it("falls back to the normalized tag when no item carries the path exactly", () => {
        expect(exactProjectTag([["project:lung/scrna"], null, undefined], "lung")).toBe("project:lung");
    });
});

describe("tagListFilter", () => {
    it("quotes the tag so the whole name:value is matched", () => {
        expect(tagListFilter("project:lung/scrna")).toBe("tag:'project:lung/scrna'");
    });
});
