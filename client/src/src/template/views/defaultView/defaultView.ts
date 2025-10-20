import { IResourceNode } from "@/template/scene/iscene";
import { IView } from "./iViewNode";

export default class DefaultView implements IView {
    static classKey = 'default'
    semanticPath = 'default'
    children: string[] = []

    get name(): string {
        return this.semanticPath.split('.').pop() || ''
    }

    viewModelFactory(nodeSelf: IResourceNode): Function {
        return null as any
    }
}