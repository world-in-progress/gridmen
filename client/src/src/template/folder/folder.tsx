import { ITemplate } from "../iTemplate";
import { IResourceNode } from "../scene/iscene";
import * as api from '../noodle/apis'
import { IViewContext } from "@/views/IViewContext"
import { Check, Delete, Edit, Edit3, Info, MapPinPlus } from "lucide-react"
import { ResourceTree } from "../scene/scene"
import { ContextMenuContent, ContextMenuItem } from '@/components/ui/context-menu'
import { toast } from 'sonner'

enum FolderMenuItem {
    Delete_FOLDER = 'Delete Folder'
}

export default class FolderTemplate implements ITemplate {
    static templateName: null = null
    templateName: null = FolderTemplate.templateName

    renderMenu(node: IResourceNode, handleContextMenu: (node: IResourceNode, menuItem: any) => void): React.JSX.Element | null {
        return (
            <ContextMenuContent>
                <ContextMenuItem className='cursor-pointer flex bg-red-500 hover:!bg-red-600' onSelect={() => { handleContextMenu(node, FolderMenuItem.Delete_FOLDER) }}>
                    <Delete className='w-4 h-4 text-white rotate-180' />
                    <span className='text-white'>Delete</span>
                </ContextMenuItem>
            </ContextMenuContent>
        )
    }

    async handleMenuOpen(node: IResourceNode, menuItem: any): Promise<void> {
        switch (menuItem) {
            case FolderMenuItem.Delete_FOLDER:
                console.log('hello 1')
                {
                    await api.node.unmountNode(node.key)
                    toast.success(`Folder ${node.name} deleted successfully`)
                    await (node.tree as ResourceTree).refresh()
                }
                break
        }
    }
}