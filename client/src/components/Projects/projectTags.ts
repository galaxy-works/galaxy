/**
 * Helpers for the tags-based project view. A "project" is nothing more than a
 * `project:<path>` tag on a history or workflow; `/` in the path nests projects.
 */

export const PROJECT_TAG_NAME = "project";

export interface ProjectNode {
    /** Full path, e.g. `lung/scrna` */
    path: string;
    /** Last path segment, e.g. `scrna` */
    label: string;
    children: ProjectNode[];
}

export interface ProjectNodeCounts {
    /** All histories in the node, shared ones included */
    histories: number;
    /** All workflows in the node, shared ones included */
    workflows: number;
    /** Of those, the ones other users shared with this user */
    sharedHistories: number;
    sharedWorkflows: number;
}

/** Project paths carried by a tag list, normalized to lower case with no empty segments. */
export function projectPathsOf(tags: string[] | undefined | null): string[] {
    const paths = new Set<string>();
    for (const tag of tags ?? []) {
        const separator = tag.indexOf(":");
        if (separator < 0) {
            continue;
        }
        if (tag.slice(0, separator).toLowerCase() !== PROJECT_TAG_NAME) {
            continue;
        }
        const path = normalizeProjectPath(tag.slice(separator + 1));
        if (path) {
            paths.add(path);
        }
    }
    return [...paths];
}

export function normalizeProjectPath(path: string): string {
    return path
        .toLowerCase()
        .split("/")
        .map((segment) => segment.trim())
        .filter((segment) => segment.length > 0)
        .join("/");
}

/**
 * Why a path can't be a project, or undefined when it can. Whitespace, `,` and `;` are reserved by
 * the tag grammar, a `:` would split the tag's value, and quotes break the list pages' exact filter.
 */
export function projectPathProblem(path: string): string | undefined {
    if (/[,;:'"]/.test(path)) {
        return "A project path can't contain commas, semicolons, colons or quotes.";
    }
    if (path.split("/").some((segment) => /\s/.test(segment.trim()))) {
        return "A project path can't contain spaces; use `/` to nest.";
    }
    return undefined;
}

export function projectTag(path: string): string {
    return `${PROJECT_TAG_NAME}:${path}`;
}

/**
 * The tag as the given items actually spell it for `path`. Quoted tag searches on the list
 * pages are case-sensitive and exact, so the normalized path alone might match nothing.
 */
export function exactProjectTag(tagLists: Iterable<string[] | null | undefined>, path: string): string {
    for (const tags of tagLists) {
        for (const tag of tags ?? []) {
            if (projectPathsOf([tag])[0] === path) {
                return tag;
            }
        }
    }
    return projectTag(path);
}

/** A history or workflow list filter matching exactly this tag. */
export function tagListFilter(tag: string): string {
    return `tag:'${tag}'`;
}

/**
 * A history or workflow list filter scoping to `path`. Exact when subprojects are excluded. With
 * subprojects the unquoted form is used, which the server matches as `project` name plus a value
 * *containing* the path, so `lung` also catches `lung/scrna` (and, until the server grows a prefix
 * match, a sibling like `lungs`).
 */
export function projectScopeFilter(path: string, includeSubprojects = true): string {
    const tag = projectTag(path);
    return includeSubprojects ? `tag:${tag}` : tagListFilter(tag);
}

/** True when `path` is `nodePath` itself or nested below it. */
export function isWithinProject(path: string, nodePath: string): boolean {
    return path === nodePath || path.startsWith(`${nodePath}/`);
}

/** Builds a sorted tree, creating intermediate nodes for paths like `a/b/c` even if nothing is tagged `a/b`. */
export function buildProjectTree(paths: Iterable<string>): ProjectNode[] {
    const roots: ProjectNode[] = [];
    for (const path of paths) {
        let siblings = roots;
        let prefix = "";
        for (const segment of path.split("/")) {
            prefix = prefix ? `${prefix}/${segment}` : segment;
            let node = siblings.find((candidate) => candidate.path === prefix);
            if (!node) {
                node = { path: prefix, label: segment, children: [] };
                siblings.push(node);
            }
            siblings = node.children;
        }
    }
    sortTree(roots);
    return roots;
}

function sortTree(nodes: ProjectNode[]) {
    nodes.sort((a, b) => a.label.localeCompare(b.label));
    nodes.forEach((node) => sortTree(node.children));
}

export function countNodes(nodes: ProjectNode[]): number {
    return nodes.reduce((total, node) => total + 1 + countNodes(node.children), 0);
}

/**
 * Histories and workflows in each node of the tree, subprojects included. An item tagged with
 * both a project and one of its subprojects counts once for the parent. Items shared with the
 * user count towards the totals and are also counted on their own.
 */
export function countProjectItems(
    nodes: ProjectNode[],
    historyPaths: Iterable<string[]>,
    workflowPaths: Iterable<string[]>,
    shared: { histories?: Iterable<string[]>; workflows?: Iterable<string[]> } = {},
): Record<string, ProjectNodeCounts> {
    const histories = [...historyPaths];
    const workflows = [...workflowPaths];
    const sharedHistories = [...(shared.histories ?? [])];
    const sharedWorkflows = [...(shared.workflows ?? [])];
    const counts: Record<string, ProjectNodeCounts> = {};
    const count = (items: string[][], nodePath: string) =>
        items.filter((paths) => paths.some((path) => isWithinProject(path, nodePath))).length;
    const visit = (node: ProjectNode) => {
        const sharedHistoryCount = count(sharedHistories, node.path);
        const sharedWorkflowCount = count(sharedWorkflows, node.path);
        counts[node.path] = {
            histories: count(histories, node.path) + sharedHistoryCount,
            workflows: count(workflows, node.path) + sharedWorkflowCount,
            sharedHistories: sharedHistoryCount,
            sharedWorkflows: sharedWorkflowCount,
        };
        node.children.forEach(visit);
    };
    nodes.forEach(visit);
    return counts;
}
