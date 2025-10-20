import * as api from '../noodle/apis'
import DefaultPageContext from "../context/default"
import ContextStorage from "../context/contextStorage"
import { IResourceNode, IResourceTree } from "./iscene"

export class ResourceNode implements IResourceNode {
    key: string
    tree: ResourceTree
    aligned: boolean = false
    parent: IResourceNode | null
    template_name: string
    children: Map<string, IResourceNode> = new Map()

    private _pageContext: DefaultPageContext | undefined | null = null

    constructor(tree: ResourceTree, node_key: string, parent: IResourceNode | null) {
        this.key = node_key
        this.tree = tree
        this.parent = parent
        this.template_name = ''
    }
}

export class ResourceTree implements IResourceTree {
    root!: IResourceNode
    scene: Map<string, IResourceNode> = new Map()

    cs: ContextStorage = ContextStorage.getInstance()

    private expandedNodes: Set<string> = new Set()

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

        const meta = await api.scene.getTreeNodeInfo({ node_key: node.key })

        const oldChildrenMap = node.children
        node.children = new Map()


        ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
        // Update parent-child relationship
        const idPrefix = this.isPublic ? 'public:' : 'private:'
        if (meta.children && meta.children.length > 0) {
            for (const child of meta.children) {
                if (oldChildrenMap.has(idPrefix + child.node_key)) {
                    node.children.set(idPrefix + child.node_key, oldChildrenMap.get(idPrefix + child.node_key)!)
                    continue // skip if child node already exists
                }

                const childNode = new ResourceNode(this, child.node_key, node, new SCENARIO_NODE_REGISTRY[child.template_name]())
                this.scene.set(childNode.id, childNode) // add child node to the scene map
            }
        }
        ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

        // Release the old children map
        oldChildrenMap.clear()

        // Mark as aligned after loading
        node.aligned = true
    }
}