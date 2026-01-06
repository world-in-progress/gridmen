import { ITemplate } from "@/template/iTemplate"
import DefaultTemplate from "@/template/default/default"
import SchemaTemplate from "@/template/schema/schema"
import PatchTemplate from "@/template/patch/patch"
import GridTemplate from "@/template/grid/grid"

const defaultTemplate = new DefaultTemplate()
const schemaTemplate = new SchemaTemplate()
const patchTemplate = new PatchTemplate()
const gridTemplate = new GridTemplate()

const _TEMPLATE_REGISTRY: Record<string, ITemplate> = {
    [defaultTemplate.templateName]: defaultTemplate,
    [schemaTemplate.templateName]: schemaTemplate,
    [patchTemplate.templateName]: patchTemplate,
    [gridTemplate.templateName]: gridTemplate,
}

export const TEMPLATE_REGISTRY = new Proxy(_TEMPLATE_REGISTRY, {
    get(target, prop: string) {
        return target[prop] || defaultTemplate
    }
})

