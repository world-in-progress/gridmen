export interface IResourceNode {
    id: string
    key: string
    name: string
    lockId: string
    aligned: boolean
    tree: IResourceTree
    template_name: string
    parent: IResourceNode | null
    children: Map<string, IResourceNode>
}

export interface IResourceTree {
    root: IResourceNode

    setRoot(root: IResourceNode): Promise<void>
    alignNodeInfo(node: IResourceNode, force: boolean): Promise<void>
}