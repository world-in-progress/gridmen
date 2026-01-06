import { toast } from 'sonner'
import * as api from '../noodle/apis'
import { ITemplate } from "../iTemplate"
import { ResourceNode, ResourceTree } from "../scene/scene"
import { IResourceNode } from "../scene/iscene"
import { useLayerStore } from '@/store/storeSet'
import { IViewContext } from "@/views/IViewContext"
import { Delete, Edit3, Info, MapPinPlus } from "lucide-react"
import { ContextMenuContent, ContextMenuItem } from '@/components/ui/context-menu'
import PatchCreation from './patchCreation'

enum PatchMenuItem {
    CHECK_PATCH = 'Check Patch',
    EDIT_PATCH = 'Edit Patch',
    DELETE_PATCH = 'Delete Patch',
}

export default class PatchTemplate implements ITemplate {
    static templateName: string = 'patch'
    templateName: string = PatchTemplate.templateName

    static viewModels = {
        'MapView': {
            check: PatchTemplate.checkMapView,
            create: PatchTemplate.creationMapView,
            edit: PatchTemplate.editMapView
        }
    }

    static checkMapView(nodeSelf: IResourceNode, context: IViewContext): Function {
        return () => null
    }

    static creationMapView(node: IResourceNode, context: IViewContext): Function {
        return () => PatchCreation({ node, context })
    }

    static editMapView(nodeSelf: IResourceNode, context: IViewContext): Function {
        return () => null
    }

    renderMenu(node: IResourceNode, handleContextMenu: (node: IResourceNode, menuItem: any) => void): React.JSX.Element {
        return (
            <ContextMenuContent>
                <ContextMenuItem className='cursor-pointer' onSelect={() => { handleContextMenu(node, PatchMenuItem.CHECK_PATCH) }}>
                    <Info className='w-4 h-4' />
                    <span>Check </span>
                </ContextMenuItem>

                {(node as ResourceNode).tree.leadIP === undefined && (
                    <>
                        <ContextMenuItem className='cursor-pointer' onSelect={() => { handleContextMenu(node, PatchMenuItem.EDIT_PATCH) }
                        }>
                            <Edit3 className='w-4 h-4' />
                            <span>Edit </span>
                        </ContextMenuItem>
                        < ContextMenuItem className='cursor-pointer flex bg-red-500 hover:!bg-red-600' onSelect={() => { handleContextMenu(node, PatchMenuItem.DELETE_PATCH) }}>
                            <Delete className='w-4 h-4 text-white rotate-180' />
                            <span className='text-white' > Delete </span>
                        </ContextMenuItem>
                    </>
                )}
            </ContextMenuContent>
        )
    }

    async handleMenuOpen(node: IResourceNode, menuItem: any): Promise<void> {
        switch (menuItem) {
            case PatchMenuItem.CHECK_PATCH:
                console.log('Check')
                console.log(node as ResourceNode)
                useLayerStore.getState().addSchemaLayerToResourceNode(node as ResourceNode)
                // (nodeSelf.tree as ResourceTree).startEditingNode(nodeSelf as ResourceNode)
                break
            case PatchMenuItem.EDIT_PATCH:
                console.log('Edit')
                useLayerStore.getState().addSchemaLayerToResourceNode(node as ResourceNode)
                // (nodeSelf.tree as ResourceTree).startEditingNode(nodeSelf as ResourceNode)
                break
            case PatchMenuItem.DELETE_PATCH:
                {
                    await api.node.unmountNode(node.key)
                    toast.success(`Patch ${node.name} deleted successfully`)
                    await (node.tree as ResourceTree).refresh()
                }
                break
        }
    }
}