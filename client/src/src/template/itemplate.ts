import { NodeTemplateFunctionSet } from "@/registry/viewRegistry"
import { IResourceNode } from "./scene/iscene"
import { IViewContext } from "./views/IViewContext"

export interface INodeTemplate {

    templateName: string

    viewModels: {
        [templateName: string]: NodeTemplateFunctionSet
    }
}