import { IResourceNode } from "../scene/iscene"

export default class DefaultPageContext {
    serialize(): any {}

    static deserialize(input: any): DefaultPageContext {
        return new DefaultPageContext()
    }

    static async create(node: IResourceNode): Promise<DefaultPageContext> {
        return new DefaultPageContext()
    }
}