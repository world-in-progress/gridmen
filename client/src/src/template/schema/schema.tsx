import { toast } from 'sonner'
import * as api from '../noodle/apis'
import SchemaEdit from "./schemaEdit"
import SchemaCheck from "./schemaCheck"
import { ITemplate } from "../iTemplate"
import SchemaCreation from "./schemaCreation"
import { IResourceNode } from "../scene/iscene"
import { useLayerStore } from '@/store/storeSet'
import { IViewContext } from "@/views/IViewContext"
import { ResourceNode, ResourceTree } from "../scene/scene"
import { Delete, Edit3, FilePlusCorner, Info } from "lucide-react"
import { ContextMenuContent, ContextMenuItem } from '@/components/ui/context-menu'

enum SchemaMenuItem {
    CREATE_SCHEMA = 'Create Schema',
    CHECK_SCHEMA = 'Check Schema',
    EDIT_SCHEMA = 'Edit Schema',
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
        return () => SchemaCheck({ node, context })
    }
    static creationMapView(node: IResourceNode, context: IViewContext): Function {
        return () => SchemaCreation({ node, context })
    }
    static editMapView(node: IResourceNode, context: IViewContext): Function {
        return () => SchemaEdit({ node, context })
    }

    renderMenu(node: IResourceNode, handleContextMenu: (node: IResourceNode, menuItem: any) => void): React.JSX.Element {
        return (
            <ContextMenuContent>
                {node.isTemp && (<ContextMenuItem className='cursor-pointer' onSelect={() => { handleContextMenu(node, SchemaMenuItem.CHECK_SCHEMA) }}>
                    <FilePlusCorner className='w-4 h-4' />
                    <span>Create</span>
                </ContextMenuItem>)}
                {!node.isTemp && (<ContextMenuItem className='cursor-pointer' onSelect={() => { handleContextMenu(node, SchemaMenuItem.CHECK_SCHEMA) }}>
                    <Info className='w-4 h-4' />
                    <span>Check</span>
                </ContextMenuItem>)}

                {(node as ResourceNode).tree.leadIP === undefined && (
                    <>
                        <ContextMenuItem className='cursor-pointer' onSelect={() => { handleContextMenu(node, SchemaMenuItem.EDIT_SCHEMA) }}>
                            <Edit3 className='w-4 h-4' />
                            <span>Edit</span>
                        </ContextMenuItem>
                        <ContextMenuItem className='cursor-pointer flex bg-red-500 hover:!bg-red-600' onSelect={() => { handleContextMenu(node, SchemaMenuItem.DELETE_SCHEMA) }}>
                            <Delete className='w-4 h-4 text-white rotate-180' />
                            <span className='text-white'>Delete</span>
                        </ContextMenuItem>
                    </>
                )}
            </ContextMenuContent>
        )
    }

    async handleMenuOpen(node: IResourceNode, menuItem: any): Promise<void> {
        switch (menuItem) {
            case SchemaMenuItem.CREATE_SCHEMA:

                break
            case SchemaMenuItem.CHECK_SCHEMA: {
                const schemaInfo = await api.node.getNodeParams(node.key, (node as ResourceNode).tree.leadIP !== undefined ? true : false)
                    ; (node as ResourceNode).mountParams = schemaInfo
                useLayerStore.getState().addNodeToLayerGroup(node as ResourceNode)
            }
                break
            case SchemaMenuItem.EDIT_SCHEMA:
                {
                    const schemaInfo = await api.node.getNodeParams(node.key, (node as ResourceNode).tree.leadIP !== undefined ? true : false)
                        ; (node as ResourceNode).mountParams = schemaInfo
                    useLayerStore.getState().addNodeToLayerGroup(node as ResourceNode)
                }
                break
            case SchemaMenuItem.DELETE_SCHEMA:
                {
                    if (node.isTemp) {
                        ; (node as ResourceNode).tree.tempNodeExist = false
                        await (node.tree as ResourceTree).removeNode(node)
                        toast.success(`Schema ${node.name} deleted successfully`)
                        return
                    }

                    await api.node.unmountNode(node.key)
                    toast.success(`Schema ${node.name} deleted successfully`)
                    await (node.tree as ResourceTree).refresh()
                }
                break
        }
    }
}

