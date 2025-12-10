import { IResourceNode } from "./scene/iscene"

export interface ITemplate {
    templateName: string

    renderMenu(nodeSelf: IResourceNode, handleContextMenu: (node: IResourceNode, menuItem: any) => void): React.JSX.Element | null

    handleMenuOpen(nodeSelf: IResourceNode, menuItem: any): void | Promise<void>
}