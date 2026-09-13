type TreeKey = string | number

export type TreeNode<T> = T & {
    children: TreeNode<T>[]
}

type BuildTreeOptions<T> = {
    getId: (item: T) => TreeKey
    getParentId: (item: T) => TreeKey | null
}

export function buildTree<T>(
    items: T[],
    { getId, getParentId }: BuildTreeOptions<T>,
): TreeNode<T>[] {
    const nodes = new Map<TreeKey, TreeNode<T>>()

    for (const item of items) {
        nodes.set(getId(item), {
            ...item,
            children: [],
        })
    }

    const roots: TreeNode<T>[] = []

    for (const node of nodes.values()) {
        const parentId = getParentId(node)

        const parent = parentId !== null ? nodes.get(parentId) : undefined

        if (parent) {
            parent.children.push(node)
        } else {
            roots.push(node)
        }
    }

    return roots
}
