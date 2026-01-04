import { toast } from 'sonner'
import * as api from '../noodle/apis'
import DefaultEdit from "./defaultEdit"
import { ITemplate } from "../iTemplate"
import DefaultCheck from "./defaultCheck"
import { ResourceNode, ResourceTree } from '../scene/scene'
import DefaultCreation from "./defaultCreation"
import { IResourceNode } from "../scene/iscene"
import { IViewContext } from "@/views/IViewContext"
import { Check, Delete, Edit, Edit3, FilePlus, FolderPlus, Info, MapPinPlus } from "lucide-react"
import { ContextMenuContent, ContextMenuItem } from '@/components/ui/context-menu'

enum DefaultMenuItem {
    NEW_RESOURCE = 'New Resource',
    NEW_FOLDER = 'New Folder',
    DELETE_FOLDER = 'Delete Folder'
}

export default class DefaultTemplate implements ITemplate {
    static templateName: string = 'default'
    templateName: string = DefaultTemplate.templateName

    static viewModels = {
        'MapView': {
            check: DefaultTemplate.checkMapView,
            create: DefaultTemplate.creationMapView,
            edit: DefaultTemplate.editMapView
        },
        'TableView': {
            check: DefaultTemplate.checkTableView,
            create: DefaultTemplate.creationTableView,
            edit: DefaultTemplate.editTableView
        }
    }

    static checkMapView(nodeSelf: IResourceNode, context: IViewContext): Function {
        return () => DefaultCheck()
    }

    static creationMapView(nodeSelf: IResourceNode, context: IViewContext): Function {
        return () => DefaultCreation()
    }

    static editMapView(nodeSelf: IResourceNode, context: IViewContext): Function {
        return () => DefaultEdit()
    }

    static checkTableView(nodeSelf: IResourceNode, context: IViewContext): Function {
        return () => null
    }

    static creationTableView(nodeSelf: IResourceNode, context: IViewContext): Function {
        return () => null
    }

    static editTableView(nodeSelf: IResourceNode, context: IViewContext): Function {
        return () => null
    }

    renderMenu(node: IResourceNode, handleContextMenu: (node: IResourceNode, menuItem: any) => void): React.JSX.Element | null {
        return (
            (node as ResourceNode).tree.leadIP === undefined ? (
                <ContextMenuContent>
                    <ContextMenuItem className='cursor-pointer' onSelect={() => { handleContextMenu(node, DefaultMenuItem.NEW_RESOURCE) }}>
                        <FilePlus className='w-4 h-4' />
                        <span>New Resource</span>
                    </ContextMenuItem>
                    <ContextMenuItem className='cursor-pointer' onSelect={() => { handleContextMenu(node, DefaultMenuItem.NEW_FOLDER) }}>
                        <FolderPlus className='w-4 h-4' />
                        <span>New Folder</span>
                    </ContextMenuItem>
                    <ContextMenuItem className='cursor-pointer flex bg-red-500 hover:!bg-red-600' onSelect={() => { handleContextMenu(node, DefaultMenuItem.DELETE_FOLDER) }}>
                        <Delete className='w-4 h-4 text-white rotate-180' />
                        <span className='text-white'>Delete</span>
                    </ContextMenuItem>
                </ContextMenuContent>
            ) : (<></>)
        )
    }

    async handleMenuOpen(node: IResourceNode, menuItem: any): Promise<void> {
        switch (menuItem) {
            case DefaultMenuItem.NEW_RESOURCE:
                console.log('NEW_RESOURCE')
                break
            case DefaultMenuItem.NEW_FOLDER:
                console.log('NEW_FOLDER')
                break
            case DefaultMenuItem.DELETE_FOLDER:
                await api.node.unmountNode(node.key)
                toast.success(`Folder ${node.name} deleted successfully`)
                await (node.tree as ResourceTree).refresh()
                break
        }
    }
}