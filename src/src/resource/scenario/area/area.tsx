import DefaultPageContext from "@/core/context/default";
import { ISceneNode } from "@/core/scene/iscene";

export class AreaPageContext extends DefaultPageContext {

    constructor() {
        super()     
    }

    static async create(node: ISceneNode): Promise<AreaPageContext> {
        return new AreaPageContext()
    }
}

export enum AreaMenuItem {
    
}