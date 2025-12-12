import * as api from '../noodle/apis'
import SchemaEdit from "./schemaEdit"
import SchemaCheck from "./schemaCheck"
import { ITemplate } from "../iTemplate"
import SchemaCreation from "./schemaCreation"
import { IResourceNode } from "../scene/iscene"
import { IViewContext } from "@/views/IViewContext"
import { Check, Delete, Edit, Edit3, Info, MapPinPlus } from "lucide-react"
import { ResourceTree } from "../scene/scene"
import { ContextMenuContent, ContextMenuItem } from '@/components/ui/context-menu'
import { toast } from 'sonner'

enum SchemaMenuItem {
    CHECK_SCHEMA = 'Check Schema',
    EDIT_SCHEMA = 'Edit Schema',
    CREATE_SCHEMA = 'Create Schema',
    DELETE_SCHEMA = 'Delete Schema',
}

export default class SchemaTemplate implements ITemplate {
    static templateName: string = 'schema'
    templateName: string = SchemaTemplate.templateName

    viewModels = {
        'MapView': {
            check: SchemaTemplate.checkMapView,
            create: SchemaTemplate.creationMapView,
            edit: SchemaTemplate.editMapView
        }
    }

    static checkMapView(node: IResourceNode, context: IViewContext): Function {
        return () => SchemaCheck({ context })
    }
    static creationMapView(node: IResourceNode, context: IViewContext): Function {
        // const tree = node.tree as ResourceTree
        return () => SchemaCreation({ node, context })
    }
    static editMapView(nodeSelf: IResourceNode, context: IViewContext): Function {
        return () => SchemaEdit({ context })
    }

    renderMenu(node: IResourceNode, handleContextMenu: (node: IResourceNode, menuItem: any) => void): React.JSX.Element {
        return (
            <ContextMenuContent>
                {node.name.includes(' (not confirm yet)') ? (
                    <ContextMenuItem className='cursor-pointer' onSelect={() => { handleContextMenu(node, SchemaMenuItem.CREATE_SCHEMA) }}>
                        <MapPinPlus className='w-4 h-4' />
                        <span>Create</span>
                    </ContextMenuItem>
                ) : (
                    <>
                        <ContextMenuItem className='cursor-pointer' onSelect={() => { handleContextMenu(node, SchemaMenuItem.CHECK_SCHEMA) }}>
                            <Info className='w-4 h-4' />
                            <span>Check</span>
                        </ContextMenuItem>
                        <ContextMenuItem className='cursor-pointer' onSelect={() => { handleContextMenu(node, SchemaMenuItem.EDIT_SCHEMA) }}>
                            <Edit3 className='w-4 h-4' />
                            <span>Edit</span>
                        </ContextMenuItem>
                    </>
                )}
                <ContextMenuItem className='cursor-pointer flex bg-red-500 hover:!bg-red-600' onSelect={() => { handleContextMenu(node, SchemaMenuItem.DELETE_SCHEMA) }}>
                    <Delete className='w-4 h-4 text-white rotate-180' />
                    <span className='text-white'>Delete</span>
                </ContextMenuItem>
            </ContextMenuContent>
        )
    }

    async handleMenuOpen(node: IResourceNode, menuItem: any): Promise<void> {
        switch (menuItem) {
            case SchemaMenuItem.CHECK_SCHEMA:
                console.log('hello 1')
                // (nodeSelf.tree as ResourceTree).startEditingNode(nodeSelf as ResourceNode)
                break
            case SchemaMenuItem.EDIT_SCHEMA:
                console.log('hello 2')
                // (nodeSelf.tree as ResourceTree).startEditingNode(nodeSelf as ResourceNode)
                break
            case SchemaMenuItem.CREATE_SCHEMA:
                {
                    console.log('CREATE_SCHEMA triggered', node.key)
                    // 节点已经在 handleNodeMenuOpen 中被选中了
                    // ToolPanel 会自动根据 selectedNode 更新并显示 SchemaCreation
                    // 确保 ToolPanel 切换到 'create' tab（默认就是 'create'）
                }
                break
            case SchemaMenuItem.DELETE_SCHEMA:
                {
                    await api.node.unmountNode(node.key)
                    toast.success(`Schema ${node.name} deleted successfully`)
                    await (node.tree as ResourceTree).refresh()
                }
                break
        }
    }
}

