import { ITemplate } from "../iTemplate"

export interface IResourceNode {
    id: string
    key: string
    name: string
    nodeInfo: string
    aligned: boolean
    isTemp?: boolean
    tree: IResourceTree
    template: ITemplate | null
    template_name: string | null
    parent: IResourceNode | null
    children: Map<string, IResourceNode>
}

export interface IResourceTree {
    root: IResourceNode

    setRoot(root: IResourceNode): Promise<void>
    alignNodeInfo(node: IResourceNode, force: boolean): Promise<void>
}