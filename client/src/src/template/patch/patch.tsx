import { toast } from 'sonner'
import * as api from '../api/apis'
import PatchEdit from './patchEdit'
import PatchCheck from './patchCheck'
import { linkNode } from '../api/node'
import { ITemplate } from "../iTemplate"
import PatchCreation from './patchCreation'
import { IResourceNode } from "../scene/iscene"
import { IViewContext } from "@/views/IViewContext"
import { ResourceNode, ResourceTree } from "../scene/scene"
import { Delete, Edit3, Info, FilePlusCorner } from "lucide-react"
import { useLayerStore, useToolPanelStore } from '@/store/storeSet'
import { ContextMenuContent, ContextMenuItem } from '@/components/ui/context-menu'

enum PatchMenuItem {
    CREATE_PATCH = 'Create Patch',
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

    static checkMapView(node: IResourceNode, context: IViewContext): Function {
        return () => PatchCheck({ node, context })
    }

    static creationMapView(node: IResourceNode, context: IViewContext): Function {
        return () => PatchCreation({ node, context })
    }

    static editMapView(node: IResourceNode, context: IViewContext): Function {
        return () => PatchEdit({ node, context })
    }

    renderMenu(node: IResourceNode, handleContextMenu: (node: IResourceNode, menuItem: any) => void): React.JSX.Element {
        return (
            <ContextMenuContent>
                {node.isTemp && (<ContextMenuItem className='cursor-pointer' onSelect={() => { handleContextMenu(node, PatchMenuItem.CREATE_PATCH) }}>
                    <FilePlusCorner className='w-4 h-4' />
                    <span>Create</span>
                </ContextMenuItem>)}
                {!node.isTemp && (<ContextMenuItem className='cursor-pointer' onSelect={() => { handleContextMenu(node, PatchMenuItem.CHECK_PATCH) }}>
                    <Info className='w-4 h-4' />
                    <span>Check</span>
                </ContextMenuItem>)}

                {(node as ResourceNode).tree.leadIP === undefined && (
                    <>
                        {!node.isTemp && (
                            <ContextMenuItem className='cursor-pointer' onSelect={() => { handleContextMenu(node, PatchMenuItem.EDIT_PATCH) }}>
                                <Edit3 className='w-4 h-4' />
                                <span>Edit</span>
                            </ContextMenuItem>)}

                        < ContextMenuItem className='cursor-pointer flex bg-red-500 hover:!bg-red-600' onSelect={() => { handleContextMenu(node, PatchMenuItem.DELETE_PATCH) }}>
                            <Delete className='w-4 h-4 text-white rotate-180' />
                            <span className='text-white' >Delete</span>
                        </ContextMenuItem>
                    </>
                )}
            </ContextMenuContent>
        )
    }

    async handleMenuOpen(node: IResourceNode, menuItem: any): Promise<void> {
        switch (menuItem) {
            case PatchMenuItem.CREATE_PATCH:
                useToolPanelStore.getState().setActiveTab('create')
                break
            case PatchMenuItem.CHECK_PATCH: {
                const patchInfo = await api.node.getNodeParams(node.nodeInfo);
                (node as ResourceNode).mountParams = patchInfo
                useLayerStore.getState().addNodeToLayerGroup(node as ResourceNode)
            }
                break
            case PatchMenuItem.EDIT_PATCH: {
                if (!(node as ResourceNode).lockId) {
                    const linkResponse = await linkNode('gridmen/IPatch/1.0.0', node.nodeInfo, 'w');
                    (node as ResourceNode).lockId = linkResponse.lock_id
                }
                const patchInfo = await api.patch.getPatchMeta(node.nodeInfo, (node as ResourceNode).lockId!);
                (node as ResourceNode).mountParams = patchInfo
                useLayerStore.getState().addNodeToLayerGroup(node as ResourceNode)
            }
                break
            case PatchMenuItem.DELETE_PATCH:
                {
                    if (node.isTemp) {
                        ; (node as ResourceNode).tree.tempNodeExist = false
                        await (node.tree as ResourceTree).removeNode(node)
                        toast.success(`Patch ${node.name} deleted successfully`)
                        return
                    }

                    await api.node.unmountNode(node.nodeInfo)
                    toast.success(`Patch ${node.name} deleted successfully`)
                    await (node.tree as ResourceTree).refresh()
                }
                break
        }
    }
}