import * as api from '../noodle/apis'
import DefaultPageContext from "../context/default"
import ContextStorage from "../context/contextStorage"
import { IResourceNode, IResourceTree } from "./iscene"
import { TEMPLATE_REGISTRY } from '@/registry/templateRegistry'
import { ITemplate } from '../iTemplate'

export class ResourceNode implements IResourceNode {
    key: string
    lockId: string = ''
    aligned: boolean = false
    tree: ResourceTree
    template: ITemplate | null
    parent: IResourceNode | null
    children: Map<string, IResourceNode> = new Map()

    private _context: any

    get id(): string { return this.key }
    get name(): string { return this.key.split('.').pop() || '' }
    get template_name(): string { return this.template?.templateName || '' }


    // private _pageContext: DefaultPageContext | undefined | null = null

    constructor(tree: ResourceTree, node_key: string, parent: IResourceNode | null, template: ITemplate | null) {
        this.key = node_key
        this.tree = tree
        this.parent = parent
        this.template = template
        this._context = undefined
    }


}

interface TreeUpdateCallback {
    (): void
}

interface ResourceTreeHandlers {
    onNodeMenuOpen: (node: IResourceNode, menuItem: any) => void
    onNodeRemove: (node: IResourceNode) => void
    onNodeClick: (node: IResourceNode) => void
    onNodeDoubleClick: (node: IResourceNode) => void
}

export class ResourceTree implements IResourceTree {
    root!: IResourceNode
    scene: Map<string, IResourceNode> = new Map()

    leadIP?: string

    cs: ContextStorage = ContextStorage.getInstance()

    private handleNodeClick: (node: IResourceNode) => void = () => { }
    private handleNodeDoubleClick: (node: IResourceNode) => void = () => { }
    private handleNodeMenuOpen: (node: IResourceNode, menuItem: any) => void = () => { }
    private handleNodeRemove: (node: IResourceNode) => void = () => { }

    private updateCallbacks: Set<TreeUpdateCallback> = new Set()
    private expandedNodes: Set<string> = new Set()

    editingNodeIds: Set<string> = new Set()
    selectedNode: IResourceNode | null = null
    tempNodeExist: boolean = false


    constructor(leadIP?: string) {
        this.leadIP = leadIP
    }

    bindHandlers(handlers: ResourceTreeHandlers): void {
        this.handleNodeMenuOpen = handlers.onNodeMenuOpen
        this.handleNodeRemove = handlers.onNodeRemove
        this.handleNodeClick = handlers.onNodeClick
        this.handleNodeDoubleClick = handlers.onNodeDoubleClick
    }

    getNodeMenuHandler(): (node: IResourceNode, menuItem: any) => void {
        return this.handleNodeMenuOpen
    }

    async setRoot(root: IResourceNode): Promise<void> {
        if (this.root) {
            console.debug('ResourceTree: setRoot: root already set')
            return
        }

        this.root = root
        this.scene.set(root.id, root)
        await this.alignNodeInfo(root)
        this.expandedNodes.add(root.id)
    }

    async alignNodeInfo(node: IResourceNode, force: boolean = false): Promise<void> {
        if (node.aligned && !force) return

        const meta = await api.node.getNodeInfo({ node_key: node.key }, this.leadIP ? true : false)

        const oldChildrenMap = node.children
        node.children = new Map()


        ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
        // Update parent-child relationship
        if (meta.children && meta.children.length > 0) {
            for (const child of meta.children) {
                if (oldChildrenMap.has(child.node_key)) {
                    node.children.set(child.node_key, oldChildrenMap.get(child.node_key)!)
                    continue // skip if child node already exists
                }

                const childNode = new ResourceNode(this, child.node_key, node, TEMPLATE_REGISTRY[child.template_name])
                node.children.set(childNode.id, childNode) // Add child to the node's children map
                this.scene.set(childNode.id, childNode) // add child node to the scene map
            }
        }
        ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

        // Release the old children map
        oldChildrenMap.clear()

        // Mark as aligned after loading
        node.aligned = true
    }

    async expandNode(targetNode: IResourceNode): Promise<boolean> {
        if (!targetNode) return false

        // Get all parent nodes
        const path: IResourceNode[] = []
        let current: IResourceNode | null = targetNode
        while (current) {
            path.unshift(current)
            current = current.parent
        }

        // Expand all parent nodes
        for (let i = 0; i < path.length - 1; i++) {
            const node = path[i]
            if (!this.expandedNodes.has(node.id)) {
                await this.alignNodeInfo(node)
                this.expandedNodes.add(node.id)
            }
        }

        // Select the target node
        this.notifyDomUpdate()
        return true
    }

    subscribe(callback: TreeUpdateCallback): () => void {
        this.updateCallbacks.add(callback)
        return () => {
            this.updateCallbacks.delete(callback)
        }
    }

    notifyDomUpdate(): void {
        this.updateCallbacks.forEach(callback => callback())
    }

    async toggleNodeExpansion(node: IResourceNode, forceOpen: boolean = false): Promise<void> {
        if (forceOpen || !this.expandedNodes.has(node.id)) {
            this.expandedNodes.add(node.id)
            if (!node.aligned) await this.alignNodeInfo(node)
        } else {
            this.expandedNodes.delete(node.id)
        }
    }

    async clickNode(node: IResourceNode): Promise<void> {
        this.selectedNode = node

        // If the node is a resource folder, toggle its expansion
        if (node.template_name === 'default') {
            await this.toggleNodeExpansion(node)
        }

        this.handleNodeClick(node) // notify all trees that the node is currently selected
        this.notifyDomUpdate()
    }

    async doubleClickNode(node: IResourceNode): Promise<void> {
        // If the node is a resource folder, force open its expansion
        if (node.template_name === 'default') {
            await this.toggleNodeExpansion(node, true)
        }

        this.handleNodeDoubleClick(node) // notify all trees to focus on the node
        this.notifyDomUpdate()
    }

    stopEditingNode(node: IResourceNode): void {

    }

    async removeNode(node: IResourceNode): Promise<void> {
        const parent = node.parent as ResourceNode
        parent.children.delete(node.id)

        this.scene.delete(node.id)
        await this.alignNodeInfo(parent, true)

        if (this.editingNodeIds.has(node.id))
            await this.stopEditingNode(node)

        this.handleNodeRemove(node) // notify all trees that the node has been removed
        this.notifyDomUpdate()
    }

    isNodeExpanded(nodeId: string): boolean {
        return this.expandedNodes.has(nodeId)
    }

    async refresh(): Promise<void> {
        if (!this.root) return

        // Refresh root node and all expanded nodes
        await this.alignNodeInfo(this.root, true)

        // Refresh all expanded nodes
        for (const nodeId of this.expandedNodes) {
            const node = this.scene.get(nodeId)
            if (node) {
                await this.alignNodeInfo(node, true)
            }
        }

        this.notifyDomUpdate()
    }

    static async create(leadIP?: string): Promise<ResourceTree> {
        try {
            const tree = new ResourceTree(leadIP)

            const rootNodeMeta = await api.node.getNodeInfo({ node_key: '.' }, leadIP ? true : false)
            const rootNode = new ResourceNode(tree, rootNodeMeta.node_key, null, TEMPLATE_REGISTRY[rootNodeMeta.template_name])

            await tree.setRoot(rootNode)

            return tree
        } catch (error) {
            throw new Error(`Failed to create resource tree: ${error}`)
        }
    }
}